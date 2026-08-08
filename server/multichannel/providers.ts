import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import twilio from 'twilio'
import webpush from 'web-push'
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getMessaging } from 'firebase-admin/messaging'
import type { ChannelProviderAdapter, DeliveryState, ProviderSendRequest, ProviderSendResult } from './types'

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left), b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

function form(raw: Buffer) { return Object.fromEntries(new URLSearchParams(raw.toString('utf8')).entries()) }
function json(raw: Buffer) { try { return JSON.parse(raw.toString('utf8')) as Record<string, unknown> } catch { return {} } }
function mappedState(value: unknown): DeliveryState {
  const state = String(value ?? '').toLowerCase()
  if (['queued', 'accepted', 'sent', 'delivered', 'read', 'failed', 'canceled'].includes(state)) return state as DeliveryState
  if (['undelivered', 'rejected', 'expired'].includes(state)) return 'failed'
  return 'sent'
}

class StreamAdapter implements ChannelProviderAdapter {
  readonly provider = 'stream'
  readonly channels = ['email', 'sms', 'whatsapp', 'push'] as const
  async send(request: ProviderSendRequest): Promise<ProviderSendResult> {
    return { providerMessageId: `stream_${request.deliveryId}_${randomUUID()}`, state: 'sent', raw: { preview: true } }
  }
  async testConnection() { return { ok: true, detail: 'Stream sandbox is ready' } }
}

class TwilioAdapter implements ChannelProviderAdapter {
  readonly provider = 'twilio'
  readonly channels = ['sms', 'whatsapp'] as const
  async send(request: ProviderSendRequest): Promise<ProviderSendResult> {
    const client = twilio(request.credentials.account_sid, request.credentials.auth_token)
    const body = request.content.channel === 'sms' || request.content.channel === 'whatsapp' ? request.content.body : ''
    const mediaUrl = request.content.channel === 'sms' || request.content.channel === 'whatsapp' ? request.content.media.map((item) => item.url) : []
    const prefix = request.content.channel === 'whatsapp' ? 'whatsapp:' : ''
    const result = await client.messages.create({ body, to: `${prefix}${request.to.replace(/^whatsapp:/, '')}`, from: `${prefix}${request.from.replace(/^whatsapp:/, '')}`, mediaUrl: mediaUrl.length ? mediaUrl : undefined, statusCallback: request.callbackUrl })
    return { providerMessageId: result.sid, state: mappedState(result.status) === 'queued' ? 'accepted' : 'sent', raw: { status: result.status, segments: result.numSegments }, costMicros: result.price ? Math.round(Math.abs(Number(result.price)) * 1_000_000) : undefined }
  }
  validateWebhook(headers: Record<string, string | string[] | undefined>, rawBody: Buffer, url: string, credentials: Record<string, string>) {
    const signature = String(headers['x-twilio-signature'] ?? '')
    return !!signature && twilio.validateRequest(credentials.auth_token, signature, url, form(rawBody))
  }
  normalizeWebhook(_headers: Record<string, string | string[] | undefined>, rawBody: Buffer) {
    const payload = form(rawBody)
    return [{ eventId: `${payload.MessageSid ?? payload.SmsSid}:${payload.MessageStatus ?? payload.SmsStatus}`, providerMessageId: payload.MessageSid ?? payload.SmsSid, state: mappedState(payload.MessageStatus ?? payload.SmsStatus), occurredAt: new Date().toISOString(), payload }]
  }
  async testConnection(credentials: Record<string, string>) {
    const account = await twilio(credentials.account_sid, credentials.auth_token).api.v2010.accounts(credentials.account_sid).fetch()
    return { ok: account.status === 'active', detail: `Twilio account ${account.friendlyName} is ${account.status}` }
  }
}

class MetaWhatsappAdapter implements ChannelProviderAdapter {
  readonly provider = 'meta'
  readonly channels = ['whatsapp'] as const
  async send(request: ProviderSendRequest): Promise<ProviderSendResult> {
    if (request.content.channel !== 'whatsapp') throw new Error('Meta adapter only supports WhatsApp')
    const content = request.content
    const payload: Record<string, unknown> = { messaging_product: 'whatsapp', recipient_type: 'individual', to: request.to.replace(/^whatsapp:/, '') }
    if (content.template) payload.template = { name: content.template.name, language: { code: content.template.language }, components: [{ type: 'body', parameters: Object.entries(content.template.variables).map(([key, value]) => ({ type: 'text', parameter_name: key, text: value })) }] }
    else payload.text = { body: content.body, preview_url: true }
    const response = await fetch(`https://graph.facebook.com/${request.credentials.graph_version ?? 'v23.0'}/${request.credentials.phone_number_id}/messages`, { method: 'POST', headers: { authorization: `Bearer ${request.credentials.access_token}`, 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(15_000) })
    const result = await response.json() as { messages?: Array<{ id: string }>; error?: { message: string } }
    if (!response.ok || !result.messages?.[0]) throw new Error(result.error?.message ?? `Meta responded ${response.status}`)
    return { providerMessageId: result.messages[0].id, state: 'accepted', raw: result as Record<string, unknown> }
  }
  validateWebhook(headers: Record<string, string | string[] | undefined>, rawBody: Buffer, _url: string, credentials: Record<string, string>) {
    const given = String(headers['x-hub-signature-256'] ?? '').replace('sha256=', '')
    const expected = createHmac('sha256', credentials.app_secret).update(rawBody).digest('hex')
    return !!given && safeEqual(given, expected)
  }
  normalizeWebhook(_headers: Record<string, string | string[] | undefined>, rawBody: Buffer) {
    const payload = json(rawBody)
    const results: Array<{ eventId: string; providerMessageId?: string; state: DeliveryState; occurredAt: string; payload: Record<string, unknown> }> = []
    const entries = (payload.entry as Array<Record<string, unknown>> | undefined) ?? []
    for (const entry of entries) for (const change of ((entry.changes as Array<Record<string, unknown>> | undefined) ?? [])) {
      const value = (change.value as Record<string, unknown> | undefined) ?? {}
      for (const status of ((value.statuses as Array<Record<string, unknown>> | undefined) ?? [])) results.push({ eventId: `${status.id}:${status.status}`, providerMessageId: String(status.id ?? ''), state: mappedState(status.status), occurredAt: new Date(Number(status.timestamp ?? Date.now() / 1000) * 1000).toISOString(), payload: status })
    }
    return results
  }
  async testConnection(credentials: Record<string, string>) {
    const response = await fetch(`https://graph.facebook.com/${credentials.graph_version ?? 'v23.0'}/${credentials.phone_number_id}`, { headers: { authorization: `Bearer ${credentials.access_token}` }, signal: AbortSignal.timeout(10_000) })
    return { ok: response.ok, detail: response.ok ? 'Meta WhatsApp number is reachable' : `Meta responded ${response.status}` }
  }
}

class VonageAdapter implements ChannelProviderAdapter {
  readonly provider = 'vonage'
  readonly channels = ['sms', 'whatsapp'] as const
  async send(request: ProviderSendRequest): Promise<ProviderSendResult> {
    if (request.content.channel === 'sms') {
      const payload = new URLSearchParams({ api_key: request.credentials.api_key, api_secret: request.credentials.api_secret, to: request.to, from: request.from, text: request.content.body })
      if (request.callbackUrl) payload.set('callback', request.callbackUrl)
      const response = await fetch('https://rest.nexmo.com/sms/json', { method: 'POST', body: payload, signal: AbortSignal.timeout(15_000) })
      const result = await response.json() as { messages?: Array<Record<string, string>> }
      const message = result.messages?.[0]
      if (!response.ok || !message || message.status !== '0') throw new Error(message?.['error-text'] ?? `Vonage responded ${response.status}`)
      return { providerMessageId: message['message-id'], state: 'accepted', raw: message, costMicros: message['message-price'] ? Math.round(Number(message['message-price']) * 1_000_000) : undefined }
    }
    if (request.content.channel !== 'whatsapp') throw new Error('Unsupported Vonage channel')
    const token = request.credentials.jwt
    const response = await fetch('https://api.nexmo.com/v1/messages', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ from: request.from, to: request.to, channel: 'whatsapp', message_type: 'text', text: request.content.body }), signal: AbortSignal.timeout(15_000) })
    const result = await response.json() as { message_uuid?: string; title?: string }
    if (!response.ok || !result.message_uuid) throw new Error(result.title ?? `Vonage responded ${response.status}`)
    return { providerMessageId: result.message_uuid, state: 'accepted', raw: result as Record<string, unknown> }
  }
  validateWebhook(headers: Record<string, string | string[] | undefined>, rawBody: Buffer, _url: string, credentials: Record<string, string>) {
    const signature = String(headers['x-vonage-signature'] ?? '')
    if (!credentials.signature_secret) return !!headers.authorization
    return safeEqual(signature, createHmac('sha256', credentials.signature_secret).update(rawBody).digest('hex'))
  }
  normalizeWebhook(_headers: Record<string, string | string[] | undefined>, rawBody: Buffer) {
    const payload = json(rawBody), messageId = String(payload.message_uuid ?? payload.message_id ?? ''), status = String(payload.status ?? 'sent')
    return [{ eventId: `${messageId}:${status}`, providerMessageId: messageId, state: mappedState(status), occurredAt: String(payload.timestamp ?? new Date().toISOString()), payload }]
  }
  async testConnection(credentials: Record<string, string>) {
    const response = await fetch(`https://rest.nexmo.com/account/get-balance?api_key=${encodeURIComponent(credentials.api_key)}&api_secret=${encodeURIComponent(credentials.api_secret)}`, { signal: AbortSignal.timeout(10_000) })
    return { ok: response.ok, detail: response.ok ? 'Vonage account is reachable' : `Vonage responded ${response.status}` }
  }
}

class WebPushAdapter implements ChannelProviderAdapter {
  readonly provider = 'webpush'
  readonly channels = ['push'] as const
  async send(request: ProviderSendRequest): Promise<ProviderSendResult> {
    if (request.content.channel !== 'push') throw new Error('Web Push adapter only supports push')
    webpush.setVapidDetails(request.credentials.subject, request.credentials.public_key, request.credentials.private_key)
    const subscription = JSON.parse(request.to) as webpush.PushSubscription
    await webpush.sendNotification(subscription, JSON.stringify(request.content), { TTL: Number(request.credentials.ttl ?? 86400) })
    return { providerMessageId: `webpush_${request.deliveryId}`, state: 'sent' }
  }
  async testConnection(credentials: Record<string, string>) {
    return { ok: !!credentials.public_key && !!credentials.private_key && !!credentials.subject, detail: 'VAPID key pair is configured' }
  }
}

class FcmAdapter implements ChannelProviderAdapter {
  readonly provider = 'fcm'
  readonly channels = ['push'] as const
  async send(request: ProviderSendRequest): Promise<ProviderSendResult> {
    if (request.content.channel !== 'push') throw new Error('FCM adapter only supports push')
    const appName = `sendry-${createHmac('sha256', 'fcm').update(request.credentials.project_id).digest('hex').slice(0, 12)}`
    const app = getApps().find((item) => item.name === appName) ?? initializeApp({ credential: cert(JSON.parse(request.credentials.service_account_json)) }, appName)
    const messageId = await getMessaging(app).send({ token: request.to, notification: { title: request.content.title, body: request.content.body, imageUrl: request.content.image }, data: request.content.data, webpush: { fcmOptions: { link: request.content.target_url } } })
    return { providerMessageId: messageId, state: 'accepted' }
  }
  async testConnection(credentials: Record<string, string>) {
    try { JSON.parse(credentials.service_account_json); return { ok: true, detail: `FCM project ${credentials.project_id} is configured` } } catch { return { ok: false, detail: 'Invalid Firebase service account JSON' } }
  }
}

export class ProviderRegistry {
  private readonly adapters = new Map<string, ChannelProviderAdapter>()
  constructor() { for (const adapter of [new StreamAdapter(), new TwilioAdapter(), new MetaWhatsappAdapter(), new VonageAdapter(), new WebPushAdapter(), new FcmAdapter()]) this.adapters.set(adapter.provider, adapter) }
  get(provider: string) { const adapter = this.adapters.get(provider); if (!adapter) throw Object.assign(new Error(`Unsupported provider: ${provider}`), { code: 'PROVIDER_UNSUPPORTED', status: 422 }); return adapter }
  list() { return [...this.adapters.values()].map(({ provider, channels }) => ({ provider, channels })) }
}
