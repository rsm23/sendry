import { createHash, randomUUID } from 'node:crypto'
import express, { type NextFunction, type Request, type Response } from 'express'
import multer from 'multer'
import twilio from 'twilio'
import { z } from 'zod'
import type { AppConfig } from '../config'
import type { AppDatabase } from '../db'
import { nowIso } from '../serialize'
import { signToken, verifyToken } from '../tokens'
import { assertPurposeContent, consentAllows, frenchCallWindowAllows, isSuppressionKeyword, normalizeEmail, normalizePhone, smsSegments } from './compliance'
import { decryptCredentials, encryptCredentials } from './crypto'
import type { MultiChannelRuntime } from './runtime'
import { MediaStorage } from './storage'
import { campaignCreateSchema, channelContentSchema, transactionalMessageSchema, type CampaignChannel, type ChannelContent, type MessagePurpose } from './types'
import { ingestMimeMessage, ingestSesNotification, syncImapMailbox, verifySendgridInboundSignature, verifySnsMessage } from './email-inbound'
import type { KnowledgeAgent } from '../knowledge/agent'
import { providerSupportsEmbeddings } from '../ai-providers'

const makeId = (prefix: string) => `${prefix}_${randomUUID().replaceAll('-', '')}`
const asyncRoute = (handler: (request: Request, response: Response, next: NextFunction) => Promise<unknown>) => (request: Request, response: Response, next: NextFunction) => void handler(request, response, next).catch(next)
const fail = (response: Response, status: number, error: string, code: string, details?: unknown) => response.status(status).json({ error, code, ...(details === undefined ? {} : { details }) })

function parseBody<T>(schema: z.ZodType<T>) {
  return (request: Request, response: Response, next: NextFunction) => {
    const parsed = schema.safeParse(request.body)
    if (!parsed.success) return fail(response, 422, 'Validation failed', 'VALIDATION_ERROR', z.treeifyError(parsed.error))
    request.body = parsed.data
    next()
  }
}

function scopeAllows(scopes: string[] | undefined, required: string) {
  if (!scopes || scopes.includes('*') || scopes.includes(required)) return true
  const [resource, operation] = required.split(':')
  return scopes.includes(`${resource}:*`) || scopes.includes(`*:${operation}`)
}

function brandAccess(db: AppDatabase, request: Request, brandId: string) {
  if (request.authKind === 'api') return !!db.prepare('SELECT id FROM brands WHERE id=? AND workspace_id=?').get(brandId, request.apiWorkspaceId)
  return !!db.prepare('SELECT id FROM brand_members WHERE brand_id=? AND user_id=?').get(brandId, request.authUser?.id)
}

function requireV2(db: AppDatabase, scope: string) {
  return (request: Request, response: Response, next: NextFunction) => {
    if (!request.authKind) return fail(response, 401, 'Authentication required', 'AUTHENTICATION_REQUIRED')
    if (request.authKind === 'api' && !scopeAllows(request.apiScopes, scope)) return fail(response, 403, `Bearer token lacks ${scope}`, 'SCOPE_REQUIRED', { required: scope })
    const brandId = String(request.params.brandId ?? request.body?.brand_id ?? request.query.brand_id ?? '')
    if (!brandId || !brandAccess(db, request, brandId)) return fail(response, 403, 'Brand access denied', 'BRAND_ACCESS_DENIED')
    next()
  }
}

function requireFeature(runtime: MultiChannelRuntime, key: string) {
  return asyncRoute(async (request, response, next) => {
    const brandId = String(request.params.brandId ?? request.body?.brand_id ?? '')
    if (!(await runtime.store.featureEnabled(brandId, key))) return fail(response, 404, `${key} is not enabled for the brand`, 'FEATURE_DISABLED')
    next()
  })
}

function workspaceIdForBrand(db: AppDatabase, brandId: string) {
  return (db.prepare('SELECT workspace_id FROM brands WHERE id=?').get(brandId) as { workspace_id: string } | undefined)?.workspace_id
}

function messageText(content: z.infer<typeof channelContentSchema>) {
  if (content.channel === 'email') return `${content.subject}\n${content.text}\n${content.html}`
  if (content.channel === 'push') return `${content.title}\n${content.body}`
  return content.body
}

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
}

function replyContent(channel: CampaignChannel, body: string, subject: string, media: Array<Record<string, unknown>>): ChannelContent {
  const attachments = media.flatMap((item) => typeof item.url === 'string' ? [{ url: item.url, ...(typeof item.mime_type === 'string' ? { mime_type: item.mime_type } : {}), ...(typeof item.name === 'string' ? { name: item.name } : {}) }] : [])
  if (channel === 'email') return channelContentSchema.parse({ channel, subject: subject.toLowerCase().startsWith('re:') ? subject : `Re: ${subject || 'Your message'}`, text: body, html: `<p>${escapeHtml(body).replaceAll('\n', '<br>')}</p>`, attachments })
  if (channel === 'sms') return channelContentSchema.parse({ channel, body, media: attachments, shorten_links: true })
  return channelContentSchema.parse({ channel, body, media: attachments.slice(0, 1), buttons: [] })
}

function identifierFor(contact: Record<string, unknown>, channel: CampaignChannel) {
  const identifiers = (contact.identifiers as Array<Record<string, unknown>> | undefined) ?? []
  const type = channel === 'email' ? 'email' : channel === 'push' ? undefined : channel === 'whatsapp' ? 'whatsapp' : 'phone'
  if (!type) return undefined
  return identifiers.find((item) => item.type === type && item.is_primary) ?? identifiers.find((item) => item.type === type) ?? (type === 'whatsapp' ? identifiers.find((item) => item.type === 'phone') : undefined)
}

function latestConsent(contact: Record<string, unknown>, channel: string, purpose: string) {
  const event = ((contact.consents as Array<Record<string, unknown>> | undefined) ?? []).find((item) => item.channel === channel && item.purpose === purpose)
  if (!event) return undefined
  const status = String(event.status ?? event.action)
  return { granted: status === 'granted', withdrawnAt: ['withdrawn', 'objected'].includes(status) ? String(event.captured_at ?? event.capturedAt) : null, expiresAt: (event.expires_at ?? event.expiresAt) as string | null }
}

function pickSender(identities: Record<string, unknown>[], requested?: string) {
  const sender = requested ? identities.find((item) => item.id === requested) : identities.find((item) => item.is_default || item.status === 'active') ?? identities[0]
  if (!sender) throw Object.assign(new Error('No sender identity is configured for this channel'), { status: 422, code: 'SENDER_IDENTITY_REQUIRED' })
  return sender
}

async function whatsappWindowAllows(runtime: MultiChannelRuntime, brandId: string, contactId: string, content: z.infer<typeof channelContentSchema>) {
  if (content.channel !== 'whatsapp' || content.template) return true
  const conversations = await runtime.store.listConversations(brandId, 'all')
  for (const item of conversations.filter((conversation) => conversation.contact_id === contactId && conversation.last_channel === 'whatsapp')) {
    const detail = await runtime.store.getConversation(brandId, String(item.id))
    const inbound = ((detail?.messages as Array<Record<string, unknown>> | undefined) ?? []).findLast((message) => message.direction === 'inbound' && message.channel === 'whatsapp')
    if (inbound && Date.now() - new Date(String(inbound.created_at)).getTime() <= 24 * 3600000) return true
  }
  return false
}

export function createWebhookRouter(db: AppDatabase, runtime: MultiChannelRuntime, config: AppConfig) {
  const router = express.Router()
  router.post('/api/v2/webhooks/voice/twilio/:connectionId', express.raw({ type: '*/*', limit: '256kb' }), asyncRoute(async (request, response) => {
    const connection = await runtime.store.getConnection(String(request.params.connectionId))
    if (!connection || connection.provider !== 'twilio' || !String(connection.channel ?? (connection.channels as string[] | undefined)?.[0]).includes('voice')) return fail(response, 404, 'Twilio Voice connection not found', 'CONNECTION_NOT_FOUND')
    const key = config.credentialEncryptionKey ?? (process.env.NODE_ENV === 'production' ? '' : config.sessionSecret), credentials = decryptCredentials(String(connection.encrypted_config ?? connection.encrypted_credentials), key)
    const raw = Buffer.isBuffer(request.body) ? request.body : Buffer.from(request.body ?? ''), params = Object.fromEntries(new URLSearchParams(raw.toString('utf8')).entries())
    const signature = String(request.headers['x-twilio-signature'] ?? ''), url = `${config.appUrl}${request.originalUrl}`
    if (!signature || !twilio.validateRequest(credentials.auth_token, signature, url, params)) return fail(response, 401, 'Webhook signature is invalid', 'INVALID_WEBHOOK_SIGNATURE')
    const callSid = params.CallSid, status = params.CallStatus ?? 'ringing', now = nowIso()
    const existing = db.prepare(`SELECT id FROM call_sessions WHERE provider='twilio' AND provider_call_id=?`).get(callSid) as { id: string } | undefined
    let callId = existing?.id
    if (!callId) {
      callId = makeId('cal')
      let contactId: string | null = null
      if (params.From) { const contact = await runtime.store.createContact({ brand_id: String(connection.brand_id), identifiers: [{ type: 'phone', value: params.From, primary: true }] }); contactId = String(contact.id) }
      db.prepare(`INSERT INTO call_sessions (id,brand_id,contact_id,provider,provider_call_id,direction,from_address,to_address,status,started_at,created_at) VALUES (?,?,?,?,?,'inbound',?,?,?,?,?)`).run(callId, connection.brand_id, contactId, 'twilio', callSid, params.From ?? '', params.To ?? '', status, now, now)
    } else db.prepare(`UPDATE call_sessions SET status=?,answered_at=CASE WHEN ?='in-progress' THEN COALESCE(answered_at,?) ELSE answered_at END,ended_at=CASE WHEN ? IN ('completed','busy','failed','no-answer','canceled') THEN ? ELSE ended_at END,duration_seconds=COALESCE(?,duration_seconds) WHERE id=?`).run(status === 'no-answer' ? 'missed' : status, status, now, status, now, Number(params.CallDuration || 0), callId)
    runtime.events.emit('call.status', { brandId: connection.brand_id, callId, providerCallId: callSid, state: status, from: params.From, to: params.To })
    if (params.CallStatus === 'ringing' || !params.CallStatus) {
      const agents = db.prepare(`SELECT u.id FROM users u JOIN brand_members bm ON bm.user_id=u.id WHERE bm.brand_id=? AND (bm.permissions LIKE '%"*"%' OR bm.permissions LIKE '%"calls"%')`).all(connection.brand_id) as Array<{ id: string }>
      const clients = agents.map((agent) => `<Client>${agent.id.replace(/[<>&'"]/g, '')}</Client>`).join('')
      return response.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?><Response><Dial timeout="30" answerOnBridge="true">${clients}</Dial><Say>${String(credentials.unavailable_message ?? 'Our team is unavailable. Please try again later.').replace(/[<>&]/g, '')}</Say></Response>`)
    }
    response.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response/>')
  }))
  router.post('/api/v2/webhooks/email/sendgrid/:connectionId', express.raw({ type: '*/*', limit: '30mb' }), asyncRoute(async (request, response) => {
    const connection = await runtime.store.getConnection(String(request.params.connectionId))
    if (!connection || connection.provider !== 'sendgrid') return fail(response, 404, 'SendGrid inbound connection not found', 'CONNECTION_NOT_FOUND')
    const key = config.credentialEncryptionKey ?? (process.env.NODE_ENV === 'production' ? '' : config.sessionSecret), credentials = decryptCredentials(String(connection.encrypted_config ?? connection.encrypted_credentials), key)
    const raw = Buffer.isBuffer(request.body) ? request.body : Buffer.from(request.body ?? '')
    if (!verifySendgridInboundSignature(raw, request.headers, credentials.webhook_secret)) return fail(response, 401, 'Webhook signature is invalid', 'INVALID_WEBHOOK_SIGNATURE')
    const form = await new Response(raw, { headers: { 'content-type': String(request.headers['content-type']) } }).formData()
    const rawEmail = form.get('email'), item = form.get('headers')
    const mime = typeof rawEmail === 'string' ? Buffer.from(rawEmail) : item && typeof item === 'string' ? Buffer.from(`${item}\r\n\r\n${String(form.get('text') ?? form.get('html') ?? '')}`) : undefined
    if (!mime) return fail(response, 422, 'Inbound MIME message is missing', 'INBOUND_MIME_REQUIRED')
    const providerMessageId = String(form.get('Message-ID') ?? form.get('message_id') ?? createHash('sha256').update(mime).digest('hex'))
    const fresh = await runtime.store.saveProviderEvent({ connection_id: String(connection.id), brand_id: String(connection.brand_id), provider: 'sendgrid', external_id: providerMessageId, event_type: 'inbound', payload: { size: mime.length }, signature_valid: true })
    if (fresh) await ingestMimeMessage(runtime, { brandId: String(connection.brand_id), provider: 'sendgrid', raw: mime, providerMessageId })
    response.status(202).json({ accepted: true })
  }))
  router.post('/api/v2/webhooks/email/ses/:connectionId', express.raw({ type: 'application/json', limit: '2mb' }), asyncRoute(async (request, response) => {
    const connection = await runtime.store.getConnection(String(request.params.connectionId))
    if (!connection || connection.provider !== 'ses') return fail(response, 404, 'SES inbound connection not found', 'CONNECTION_NOT_FOUND')
    const raw = Buffer.isBuffer(request.body) ? request.body : Buffer.from(request.body ?? ''), message = JSON.parse(raw.toString('utf8'))
    if (!(await verifySnsMessage(message))) return fail(response, 401, 'SNS signature is invalid', 'INVALID_WEBHOOK_SIGNATURE')
    const fresh = await runtime.store.saveProviderEvent({ connection_id: String(connection.id), brand_id: String(connection.brand_id), provider: 'ses', external_id: String(message.MessageId), event_type: 'inbound', payload: message, signature_valid: true })
    if (fresh && message.Type === 'Notification') { const key = config.credentialEncryptionKey ?? (process.env.NODE_ENV === 'production' ? '' : config.sessionSecret), credentials = decryptCredentials(String(connection.encrypted_config ?? connection.encrypted_credentials), key); const email = await ingestSesNotification(runtime, message, credentials); await ingestMimeMessage(runtime, { brandId: String(connection.brand_id), provider: 'ses', ...email }) }
    response.status(202).json({ accepted: true })
  }))
  router.post('/api/v2/webhooks/:provider/:connectionId', express.raw({ type: '*/*', limit: '2mb' }), asyncRoute(async (request, response) => {
    const connection = await runtime.store.getConnection(String(request.params.connectionId))
    if (!connection || connection.provider !== request.params.provider) return fail(response, 404, 'Provider connection not found', 'CONNECTION_NOT_FOUND')
    const adapter = runtime.providers.get(String(request.params.provider))
    const key = config.credentialEncryptionKey ?? (process.env.NODE_ENV === 'production' ? '' : config.sessionSecret)
    const credentials = connection.provider === 'stream' ? {} : decryptCredentials(String(connection.encrypted_config ?? connection.encrypted_credentials), key)
    const raw = Buffer.isBuffer(request.body) ? request.body : Buffer.from(request.body ?? '')
    const signatureValid = adapter.validateWebhook?.(request.headers, raw, `${config.appUrl}${request.originalUrl}`, credentials) ?? false
    if (!signatureValid) return fail(response, 401, 'Webhook signature is invalid', 'INVALID_WEBHOOK_SIGNATURE')
    const events = adapter.normalizeWebhook?.(request.headers, raw) ?? []
    for (const event of events) {
      const fresh = await runtime.store.saveProviderEvent({ connection_id: String(connection.id), brand_id: String(connection.brand_id), provider: adapter.provider, external_id: event.eventId, event_type: event.state, payload: event.payload, signature_valid: true })
      if (!fresh) continue
      await runtime.enqueueWebhook({ ...event, brandId: connection.brand_id, provider: adapter.provider }, `${adapter.provider}:${event.eventId}`)
      if (event.providerMessageId) {
        const delivery = await runtime.store.findDeliveryByProviderMessage(adapter.provider, event.providerMessageId)
        if (delivery) await runtime.store.updateDelivery(String(delivery.id), event.state)
      }
    }
    const connectionChannel = String(connection.channel ?? ((connection.channels as string[] | undefined)?.[0] ?? 'sms'))
    const inbound: Array<{ id: string; from: string; body: string; channel: string; metadata: Record<string, unknown> }> = []
    if (adapter.provider === 'twilio') {
      const payload = Object.fromEntries(new URLSearchParams(raw.toString('utf8')).entries())
      if (payload.Body && payload.From && !payload.MessageStatus) inbound.push({ id: payload.MessageSid ?? payload.SmsSid ?? createHash('sha256').update(raw).digest('hex'), from: payload.From.replace(/^whatsapp:/, ''), body: payload.Body, channel: payload.From.startsWith('whatsapp:') ? 'whatsapp' : connectionChannel, metadata: payload })
    } else if (adapter.provider === 'vonage') {
      const payload = JSON.parse(raw.toString('utf8') || '{}') as Record<string, unknown>
      const body = String(payload.text ?? ((payload.message as Record<string, unknown> | undefined)?.content as Record<string, unknown> | undefined)?.text ?? '')
      if (body && payload.from) inbound.push({ id: String(payload.message_uuid ?? payload.message_id ?? createHash('sha256').update(raw).digest('hex')), from: String(payload.from), body, channel: String(payload.channel ?? connectionChannel), metadata: payload })
    } else if (adapter.provider === 'meta') {
      const payload = JSON.parse(raw.toString('utf8') || '{}') as Record<string, unknown>
      for (const entry of (payload.entry as Array<Record<string, unknown>> | undefined) ?? []) for (const change of (entry.changes as Array<Record<string, unknown>> | undefined) ?? []) {
        const value = (change.value as Record<string, unknown> | undefined) ?? {}
        for (const message of (value.messages as Array<Record<string, unknown>> | undefined) ?? []) { const text = (message.text as Record<string, unknown> | undefined)?.body; if (text) inbound.push({ id: String(message.id), from: String(message.from), body: String(text), channel: 'whatsapp', metadata: message }) }
      }
    }
    for (const item of inbound) {
      const fresh = await runtime.store.saveProviderEvent({ connection_id: String(connection.id), brand_id: String(connection.brand_id), provider: adapter.provider, external_id: item.id, event_type: 'inbound', payload: item.metadata, signature_valid: true })
      if (!fresh) continue
      const normalized = normalizePhone(item.from)
      const contact = await runtime.store.createContact({ brand_id: String(connection.brand_id), identifiers: [{ type: item.channel === 'whatsapp' ? 'whatsapp' : 'phone', value: normalized, primary: true }] })
      if (isSuppressionKeyword(item.body)) await runtime.store.addSuppression({ brand_id: String(connection.brand_id), channel: item.channel, normalized_identifier: normalized, reason: 'recipient_keyword', source: adapter.provider })
      const result = await runtime.store.ingestInbound({ brand_id: String(connection.brand_id), contact_id: String(contact.id), channel: item.channel, body: item.body, provider: adapter.provider, provider_message_id: item.id, metadata: item.metadata })
      runtime.events.emit('conversation.message', { brandId: connection.brand_id, conversationId: result.conversation.id, message: result.message })
    }
    response.status(202).json({ accepted: true })
  }))
  return router
}

export function createMultiChannelRouter(db: AppDatabase, runtime: MultiChannelRuntime, config: AppConfig, knowledge?: KnowledgeAgent) {
  const router = express.Router()
  const storage = new MediaStorage(config)
  const upload = multer({ dest: config.uploadDir, limits: { fileSize: 25 * 1024 * 1024, files: 10 } })

  router.get('/providers/catalog', (_request, response) => response.json({ data: runtime.providers.list() }))

  router.get('/brands/:brandId/feature-flags', requireV2(db, 'providers:read'), asyncRoute(async (request, response) => {
    const keys = ['multichannel_core', 'sms', 'whatsapp', 'push', 'inbox', 'chat', 'chat_ai', 'voice']
    response.json({ data: Object.fromEntries(await Promise.all(keys.map(async (key) => [key, await runtime.store.featureEnabled(String(request.params.brandId), key)]))) })
  }))
  router.put('/brands/:brandId/feature-flags/:key', requireV2(db, 'providers:write'), parseBody(z.object({ enabled: z.boolean() })), asyncRoute(async (request, response) => {
    if (request.params.key === 'chat_ai' && request.body.enabled) {
      const brand = db.prepare(`SELECT ai_provider,ai_provider_config,ai_embedding_provider,ai_embedding_config FROM brands WHERE id=?`).get(String(request.params.brandId)) as Record<string, unknown> | undefined
      const generation = brand ? JSON.parse(String(brand.ai_provider_config || '{}')) as Record<string, unknown> : {}, embedding = brand ? JSON.parse(String(brand.ai_embedding_config || '{}')) as Record<string, unknown> : {}
      const ready = db.prepare(`SELECT COUNT(*) AS count FROM knowledge_documents WHERE brand_id=? AND status='ready'`).get(String(request.params.brandId)) as { count: number }
      if (!config.qdrantUrl || !brand?.ai_provider || !generation.model || (!(brand.ai_embedding_provider || providerSupportsEmbeddings(String(brand.ai_provider)))) || (!(embedding.model || (brand.ai_provider === 'openai' && 'text-embedding-3-small'))) || !ready.count) return fail(response, 409, 'Configure generation and embedding providers and index at least one ready source before enabling chat_ai', 'CHAT_AI_NOT_READY')
      if (!(await knowledge?.health())?.qdrant) return fail(response, 503, 'The chatbot knowledge infrastructure is unavailable', 'CHAT_AI_INFRASTRUCTURE_UNAVAILABLE')
    }
    await runtime.store.setFeatureFlag(String(request.params.brandId), String(request.params.key), request.body.enabled)
    response.json({ data: { key: request.params.key, enabled: request.body.enabled } })
  }))
  router.get('/brands/:brandId/channel-policy', requireV2(db, 'providers:read'), asyncRoute(async (request, response) => response.json({ data: await runtime.store.getBrandPolicy(String(request.params.brandId)) })))
  router.patch('/brands/:brandId/channel-policy', requireV2(db, 'providers:write'), parseBody(z.object({ first_response_sla_minutes: z.number().int().min(1).max(1440).optional(), conversation_retention_days: z.number().int().min(1).max(3650).optional(), provider_payload_retention_days: z.number().int().min(1).max(365).optional(), allowed_origins: z.array(z.url()).max(100).optional() })), asyncRoute(async (request, response) => response.json({ data: await runtime.store.updateBrandPolicy(String(request.params.brandId), request.body) })))

  router.get('/brands/:brandId/contacts', requireV2(db, 'contacts:read'), asyncRoute(async (request, response) => response.json({ data: await runtime.store.listContacts(String(request.params.brandId), String(request.query.q ?? '')) })))
  router.post('/brands/:brandId/contacts', requireV2(db, 'contacts:write'), parseBody(z.object({ display_name: z.string().max(160).default(''), company: z.string().max(160).default(''), locale: z.string().default('en'), timezone: z.string().default('Europe/Paris'), identifiers: z.array(z.object({ type: z.enum(['email', 'phone', 'whatsapp']), value: z.string().min(1), primary: z.boolean().optional() })).default([]), attributes: z.record(z.string(), z.unknown()).default({}) })), asyncRoute(async (request, response) => response.status(201).json({ data: await runtime.store.createContact({ ...request.body, brand_id: String(request.params.brandId) }) })))
  router.get('/brands/:brandId/contacts/:contactId', requireV2(db, 'contacts:read'), asyncRoute(async (request, response) => {
    const contact = await runtime.store.getContact(String(request.params.brandId), String(request.params.contactId))
    return contact ? response.json({ data: contact }) : fail(response, 404, 'Contact not found', 'CONTACT_NOT_FOUND')
  }))
  router.patch('/brands/:brandId/contacts/:contactId', requireV2(db, 'contacts:write'), parseBody(z.object({ display_name: z.string().max(160).optional(), company: z.string().max(160).optional(), locale: z.string().optional(), timezone: z.string().optional(), attributes: z.record(z.string(), z.unknown()).optional() })), asyncRoute(async (request, response) => {
    const contact = await runtime.store.updateContact(String(request.params.brandId), String(request.params.contactId), request.body)
    return contact ? response.json({ data: contact }) : fail(response, 404, 'Contact not found', 'CONTACT_NOT_FOUND')
  }))
  router.get('/brands/:brandId/contacts/:contactId/export', requireV2(db, 'contacts:read'), asyncRoute(async (request, response) => {
    const data = await runtime.store.exportContact(String(request.params.brandId), String(request.params.contactId))
    return data ? response.setHeader('content-disposition', `attachment; filename="sendry-contact-${request.params.contactId}.json"`).json({ data }) : fail(response, 404, 'Contact not found', 'CONTACT_NOT_FOUND')
  }))
  router.delete('/brands/:brandId/contacts/:contactId', requireV2(db, 'contacts:delete'), asyncRoute(async (request, response) => {
    const result = await runtime.store.deleteContact(String(request.params.brandId), String(request.params.contactId))
    if (result.legal_hold) return fail(response, 423, 'Contact is protected by a legal hold', 'LEGAL_HOLD')
    return result.deleted ? response.status(204).end() : fail(response, 404, 'Contact not found', 'CONTACT_NOT_FOUND')
  }))
  router.get('/brands/:brandId/contact-merge-suggestions', requireV2(db, 'contacts:read'), asyncRoute(async (request, response) => response.json({ data: await runtime.store.listMergeSuggestions(String(request.params.brandId)) })))
  router.post('/brands/:brandId/contact-merge-suggestions/:suggestionId/resolve', requireV2(db, 'contacts:write'), parseBody(z.object({ action: z.enum(['merge', 'reject']) })), asyncRoute(async (request, response) => {
    const suggestion = await runtime.store.resolveMergeSuggestion(String(request.params.brandId), String(request.params.suggestionId), request.body.action)
    return suggestion ? response.json({ data: suggestion }) : fail(response, 404, 'Merge suggestion not found', 'MERGE_SUGGESTION_NOT_FOUND')
  }))
  router.post('/brands/:brandId/contacts/:contactId/consents', requireV2(db, 'contacts:write'), parseBody(z.object({ channel: z.enum(['email', 'sms', 'whatsapp', 'push', 'voice']), purpose: z.enum(['marketing', 'transactional', 'support']), status: z.enum(['granted', 'withdrawn', 'objected', 'expired']), source: z.string().min(1), legal_basis: z.string().min(1), policy_version: z.string().min(1), proof: z.record(z.string(), z.unknown()).default({}), captured_at: z.iso.datetime().optional(), expires_at: z.iso.datetime().optional() })), asyncRoute(async (request, response) => {
    const event = await runtime.store.recordConsent({ ...request.body, brand_id: String(request.params.brandId), contact_id: String(request.params.contactId) })
    if (['withdrawn', 'objected'].includes(request.body.status)) {
      const contact = await runtime.store.getContact(String(request.params.brandId), String(request.params.contactId))
      const identifier = contact && identifierFor(contact, request.body.channel === 'voice' ? 'sms' : request.body.channel as CampaignChannel)
      if (identifier) await runtime.store.addSuppression({ brand_id: String(request.params.brandId), channel: request.body.channel, normalized_identifier: String(identifier.normalized_value), reason: request.body.status, source: request.body.source })
    }
    response.status(201).json({ data: event })
  }))

  router.get('/brands/:brandId/campaigns', requireV2(db, 'campaigns:read'), asyncRoute(async (request, response) => response.json({ data: await runtime.store.listCampaigns(String(request.params.brandId)) })))
  router.post('/brands/:brandId/campaigns', requireV2(db, 'campaigns:write'), parseBody(campaignCreateSchema), asyncRoute(async (request, response) => {
    if (!(await runtime.store.featureEnabled(String(request.params.brandId), 'multichannel_core')) || !(await runtime.store.featureEnabled(String(request.params.brandId), request.body.channel))) return fail(response, 404, 'This channel is not enabled for the brand', 'FEATURE_DISABLED')
    assertPurposeContent(request.body.purpose, messageText(request.body.content))
    if (request.body.content.channel === 'sms') Object.assign(request.body.content, { estimate: smsSegments(request.body.content.body) })
    response.status(201).json({ data: await runtime.store.createCampaign({ ...request.body, brand_id: String(request.params.brandId) }) })
  }))
  router.get('/brands/:brandId/campaigns/:campaignId', requireV2(db, 'campaigns:read'), asyncRoute(async (request, response) => {
    const campaign = await runtime.store.getCampaign(String(request.params.brandId), String(request.params.campaignId))
    return campaign ? response.json({ data: campaign }) : fail(response, 404, 'Campaign not found', 'CAMPAIGN_NOT_FOUND')
  }))
  router.post('/brands/:brandId/campaigns/:campaignId/schedule', requireV2(db, 'campaigns:send'), parseBody(z.object({ scheduled_at: z.iso.datetime() })), asyncRoute(async (request, response) => response.json({ data: await runtime.store.updateCampaignState(String(request.params.brandId), String(request.params.campaignId), 'scheduled', request.body.scheduled_at) })))
  router.post('/brands/:brandId/campaigns/:campaignId/send', requireV2(db, 'campaigns:send'), asyncRoute(async (request, response) => {
    const brandId = String(request.params.brandId), campaignId = String(request.params.campaignId)
    const campaign = await runtime.store.getCampaign(brandId, campaignId)
    if (!campaign) return fail(response, 404, 'Campaign not found', 'CAMPAIGN_NOT_FOUND')
    const content = channelContentSchema.parse(campaign.content)
    const channel = String(campaign.channel) as CampaignChannel
    const identities = await runtime.store.listSenderIdentities(brandId, channel)
    const sender = pickSender(identities, campaign.sender_identity_id ? String(campaign.sender_identity_id) : undefined)
    const connection = await runtime.store.getConnection(String(sender.connection_id))
    if (!connection) return fail(response, 422, 'Sender provider connection not found', 'CONNECTION_NOT_FOUND')
    const allContacts = await runtime.store.listContacts(brandId)
    type CampaignAudience = { contact_ids?: string[]; excluded_contact_ids?: string[] }
    const audience: CampaignAudience | undefined = (campaign.audience as CampaignAudience | undefined) ?? ((campaign.content as Record<string, unknown>).audience as CampaignAudience | undefined)
    const included = new Set(audience?.contact_ids ?? [])
    const excluded = new Set(audience?.excluded_contact_ids ?? [])
    const contacts = allContacts.filter((contact) => (!included.size || included.has(String(contact.id))) && !excluded.has(String(contact.id)))
    let queued = 0, blocked = 0
    for (const contact of contacts) {
      const identifier = identifierFor(contact, channel)
      if (!identifier) { blocked++; continue }
      const destination = String(identifier.normalized_value ?? identifier.value)
      const suppressed = await runtime.store.isSuppressed(brandId, channel, destination)
      const consent = latestConsent(contact, channel, String(campaign.purpose))
      if (suppressed || !consentAllows(consent, channel, String(campaign.purpose) as MessagePurpose) || !(await whatsappWindowAllows(runtime, brandId, String(contact.id), content))) { blocked++; continue }
      const result = await runtime.store.createDelivery({ brand_id: brandId, contact_id: String(contact.id), campaign_id: campaignId, channel, purpose: String(campaign.purpose) as MessagePurpose, sender_identity_id: String(sender.id), provider: String(connection.provider), idempotency_key: `${campaignId}:${contact.id}`, destination, content })
      if (!result.duplicate) await runtime.enqueueDelivery({ deliveryId: String(result.delivery.id), brandId, contactId: String(contact.id), channel, purpose: String(campaign.purpose) as MessagePurpose, destination, content, connectionId: String(connection.id), senderAddress: String(sender.address), callbackUrl: `${config.appUrl}/api/v2/webhooks/${connection.provider}/${connection.id}` })
      queued++
    }
    await runtime.store.updateCampaignState(brandId, campaignId, 'sending')
    response.status(202).json({ data: { campaign_id: campaignId, queued, blocked } })
  }))
  router.get('/brands/:brandId/campaigns/:campaignId/report', requireV2(db, 'campaigns:read'), asyncRoute(async (request, response) => response.json({ data: await runtime.store.report(String(request.params.brandId), String(request.params.campaignId)) })))

  router.post('/messages', requireV2(db, 'messages:send'), parseBody(transactionalMessageSchema), asyncRoute(async (request, response) => {
    if (!(await runtime.store.featureEnabled(request.body.brand_id, request.body.content.channel))) return fail(response, 404, 'This channel is not enabled for the brand', 'FEATURE_DISABLED')
    const idempotencyKey = String(request.headers['idempotency-key'] ?? '')
    if (!idempotencyKey) return fail(response, 400, 'Idempotency-Key is required', 'IDEMPOTENCY_KEY_REQUIRED')
    const workspaceId = workspaceIdForBrand(db, request.body.brand_id)
    if (!workspaceId) return fail(response, 404, 'Brand not found', 'BRAND_NOT_FOUND')
    const cached = await runtime.store.getIdempotency(workspaceId, idempotencyKey, request.body)
    if (cached) return response.status(cached.status).json(cached.body)
    assertPurposeContent(request.body.purpose, messageText(request.body.content))
    let contact = request.body.contact_id ? await runtime.store.getContact(request.body.brand_id, request.body.contact_id) : undefined
    if (!contact && request.body.to) contact = await runtime.store.createContact({ brand_id: request.body.brand_id, identifiers: request.body.content.channel === 'push' ? [] : [{ type: request.body.content.channel === 'email' ? 'email' : request.body.content.channel === 'whatsapp' ? 'whatsapp' : 'phone', value: request.body.to, primary: true }] })
    if (!contact) return fail(response, 404, 'Contact not found', 'CONTACT_NOT_FOUND')
    const channel = request.body.content.channel
    const identifier = request.body.to ? { value: request.body.to, normalized_value: channel === 'email' ? normalizeEmail(request.body.to) : channel === 'push' ? request.body.to : normalizePhone(request.body.to) } : identifierFor(contact, channel)
    if (!identifier) return fail(response, 422, 'Contact has no address for this channel', 'DESTINATION_REQUIRED')
    const destination = String(identifier.normalized_value ?? identifier.value)
    if (await runtime.store.isSuppressed(request.body.brand_id, channel, destination)) return fail(response, 422, 'Destination is suppressed', 'DESTINATION_SUPPRESSED')
    if (!consentAllows(latestConsent(contact, channel, request.body.purpose), channel, request.body.purpose)) return fail(response, 422, 'Channel consent is required', 'CONSENT_REQUIRED')
    if (!(await whatsappWindowAllows(runtime, request.body.brand_id, String(contact.id), request.body.content))) return fail(response, 422, 'An approved WhatsApp template is required outside the 24-hour service window', 'WHATSAPP_TEMPLATE_REQUIRED')
    const sender = pickSender(await runtime.store.listSenderIdentities(request.body.brand_id, channel), request.body.sender_identity_id)
    const connection = await runtime.store.getConnection(String(sender.connection_id))
    if (!connection) return fail(response, 422, 'Provider connection not found', 'CONNECTION_NOT_FOUND')
    const result = await runtime.store.createDelivery({ brand_id: request.body.brand_id, contact_id: String(contact.id), channel, purpose: request.body.purpose, sender_identity_id: String(sender.id), provider: String(connection.provider), idempotency_key: idempotencyKey, destination, content: request.body.content })
    await runtime.enqueueDelivery({ deliveryId: String(result.delivery.id), brandId: request.body.brand_id, contactId: String(contact.id), channel, purpose: request.body.purpose, destination, content: request.body.content, connectionId: String(connection.id), senderAddress: String(sender.address), callbackUrl: `${config.appUrl}/api/v2/webhooks/${connection.provider}/${connection.id}` })
    const payload = { data: result.delivery }
    await runtime.store.saveIdempotency(workspaceId, idempotencyKey, request.body, 202, payload)
    response.status(202).json(payload)
  }))

  router.get('/brands/:brandId/conversations', requireV2(db, 'conversations:read'), requireFeature(runtime, 'inbox'), asyncRoute(async (request, response) => response.json({ data: await runtime.store.listConversations(String(request.params.brandId), String(request.query.queue ?? 'all'), request.authUser?.id) })))
  router.get('/brands/:brandId/conversations/:conversationId', requireV2(db, 'conversations:read'), requireFeature(runtime, 'inbox'), asyncRoute(async (request, response) => {
    const conversation = await runtime.store.getConversation(String(request.params.brandId), String(request.params.conversationId))
    if (!conversation) return fail(response, 404, 'Conversation not found', 'CONVERSATION_NOT_FOUND')
    const agentState = db.prepare('SELECT widget_id,state,reason,updated_at FROM conversation_agent_states WHERE conversation_id=? AND brand_id=?').get(String(request.params.conversationId), String(request.params.brandId))
    return response.json({ data: { ...conversation, agent_state: agentState ?? null } })
  }))
  router.patch('/brands/:brandId/conversations/:conversationId', requireV2(db, 'conversations:write'), requireFeature(runtime, 'inbox'), parseBody(z.object({ assigned_user_id: z.string().nullable().optional(), status: z.enum(['open', 'waiting', 'snoozed', 'closed']).optional(), snoozed_until: z.iso.datetime().nullable().optional() })), asyncRoute(async (request, response) => {
    const brandId = String(request.params.brandId), conversationId = String(request.params.conversationId)
    const result = await runtime.store.updateConversation({ ...request.body, brand_id: brandId, conversation_id: conversationId, actor_user_id: request.authUser?.id })
    if (request.body.assigned_user_id) db.prepare(`UPDATE conversation_agent_states SET state='paused',reason='human_claimed',updated_by=?,updated_at=? WHERE conversation_id=? AND brand_id=?`).run(request.authUser?.id ?? null, nowIso(), conversationId, brandId)
    response.json({ data: result })
  }))
  router.post('/brands/:brandId/conversations/:conversationId/replies', requireV2(db, 'conversations:write'), requireFeature(runtime, 'inbox'), parseBody(z.object({ body: z.string().min(1).max(10000), channel: z.enum(['email', 'sms', 'whatsapp', 'chat']).optional(), internal: z.boolean().default(false), media: z.array(z.record(z.string(), z.unknown())).default([]) })), asyncRoute(async (request, response) => {
    const brandId = String(request.params.brandId), conversationId = String(request.params.conversationId)
    const conversation = await runtime.store.getConversation(brandId, conversationId)
    if (!conversation) return fail(response, 404, 'Conversation not found', 'CONVERSATION_NOT_FOUND')
    const channel = request.body.internal ? 'chat' : request.body.channel ?? String(conversation.last_channel ?? conversation.channel ?? 'chat')
    if (!request.body.internal) db.prepare(`UPDATE conversation_agent_states SET state='paused',reason='human_replied',updated_by=?,updated_at=? WHERE conversation_id=? AND brand_id=?`).run(request.authUser?.id ?? null, nowIso(), conversationId, brandId)
    if (request.body.internal || channel === 'chat') {
      const message = await runtime.store.addMessage({ brand_id: brandId, conversation_id: conversationId, contact_id: String(conversation.contact_id), channel: 'chat', direction: request.body.internal ? 'internal' : 'outbound', kind: request.body.internal ? 'note' : 'text', body: request.body.body, media: request.body.media, sender_user_id: request.authUser?.id, status: 'sent' })
      runtime.events.emit('conversation.message', { brandId, conversationId, message })
      return response.status(201).json({ data: message })
    }
    const campaignChannel = channel as CampaignChannel
    const contact = await runtime.store.getContact(brandId, String(conversation.contact_id))
    if (!contact) return fail(response, 404, 'Conversation contact not found', 'CONTACT_NOT_FOUND')
    const identifier = identifierFor(contact, campaignChannel)
    if (!identifier) return fail(response, 422, 'Contact has no address for this channel', 'DESTINATION_REQUIRED')
    const destination = String(identifier.normalized_value ?? identifier.value)
    if (await runtime.store.isSuppressed(brandId, campaignChannel, destination)) return fail(response, 422, 'Destination is suppressed', 'DESTINATION_SUPPRESSED')
    const content = replyContent(campaignChannel, request.body.body, String(conversation.subject ?? ''), request.body.media)
    if (!(await whatsappWindowAllows(runtime, brandId, String(conversation.contact_id), content))) return fail(response, 422, 'An approved WhatsApp template is required outside the 24-hour service window', 'WHATSAPP_TEMPLATE_REQUIRED')
    const sender = pickSender(await runtime.store.listSenderIdentities(brandId, campaignChannel))
    const connection = await runtime.store.getConnection(String(sender.connection_id))
    if (!connection) return fail(response, 422, 'Provider connection not found', 'CONNECTION_NOT_FOUND')
    const message = await runtime.store.addMessage({ brand_id: brandId, conversation_id: conversationId, contact_id: String(conversation.contact_id), channel: campaignChannel, direction: 'outbound', kind: 'text', body: request.body.body, media: request.body.media, sender_user_id: request.authUser?.id, status: 'queued' })
    const delivery = await runtime.store.createDelivery({ brand_id: brandId, conversation_id: conversationId, contact_id: String(conversation.contact_id), channel: campaignChannel, purpose: 'support', sender_identity_id: String(sender.id), provider: String(connection.provider), idempotency_key: `reply:${message.id}`, destination, content })
    if (!delivery.duplicate) await runtime.enqueueDelivery({ deliveryId: String(delivery.delivery.id), brandId, contactId: String(conversation.contact_id), channel: campaignChannel, purpose: 'support', destination, content, connectionId: String(connection.id), senderAddress: String(sender.address), callbackUrl: `${config.appUrl}/api/v2/webhooks/${connection.provider}/${connection.id}` })
    runtime.events.emit('conversation.message', { brandId, conversationId, message })
    response.status(201).json({ data: { ...message, delivery_id: delivery.delivery.id } })
  }))

  router.get('/brands/:brandId/connections', requireV2(db, 'providers:read'), asyncRoute(async (request, response) => response.json({ data: await runtime.store.listConnections(String(request.params.brandId)) })))
  router.post('/brands/:brandId/connections', requireV2(db, 'providers:write'), parseBody(z.object({ channel: z.enum(['email', 'sms', 'whatsapp', 'push', 'voice']), provider: z.enum(['stream', 'twilio', 'meta', 'vonage', 'webpush', 'fcm', 'sendgrid', 'ses', 'imap']), name: z.string().min(1), credentials: z.record(z.string(), z.string()), capabilities: z.array(z.string()).default([]), is_default: z.boolean().default(false) })), asyncRoute(async (request, response) => {
    const key = config.credentialEncryptionKey ?? (process.env.NODE_ENV === 'production' ? '' : config.sessionSecret)
    const connection = await runtime.store.createConnection({ ...request.body, brand_id: String(request.params.brandId), encrypted_config: encryptCredentials(request.body.credentials, key) })
    response.status(201).json({ data: connection })
  }))
  router.post('/brands/:brandId/connections/:connectionId/test', requireV2(db, 'providers:write'), asyncRoute(async (request, response) => {
    const connection = await runtime.store.getConnection(String(request.params.connectionId))
    if (!connection || connection.brand_id !== request.params.brandId) return fail(response, 404, 'Connection not found', 'CONNECTION_NOT_FOUND')
    const key = config.credentialEncryptionKey ?? (process.env.NODE_ENV === 'production' ? '' : config.sessionSecret)
    const credentials = decryptCredentials(String(connection.encrypted_config ?? connection.encrypted_credentials), key)
    try { const result = await runtime.providers.get(String(connection.provider)).testConnection?.(credentials) ?? { ok: true, detail: 'Configuration accepted' }; await runtime.store.updateConnectionTest(String(connection.id), result.ok, result.ok ? undefined : result.detail); response.json({ data: result }) } catch (error) { const message = error instanceof Error ? error.message : 'Connection test failed'; await runtime.store.updateConnectionTest(String(connection.id), false, message); return fail(response, 422, message, 'CONNECTION_TEST_FAILED') }
  }))
  router.post('/brands/:brandId/connections/:connectionId/imap/sync', requireV2(db, 'providers:write'), asyncRoute(async (request, response) => {
    const connection = await runtime.store.getConnection(String(request.params.connectionId))
    if (!connection || connection.brand_id !== request.params.brandId || connection.provider !== 'imap') return fail(response, 404, 'IMAP connection not found', 'CONNECTION_NOT_FOUND')
    const key = config.credentialEncryptionKey ?? (process.env.NODE_ENV === 'production' ? '' : config.sessionSecret), credentials = decryptCredentials(String(connection.encrypted_config ?? connection.encrypted_credentials), key)
    response.json({ data: await syncImapMailbox(runtime, { brandId: String(request.params.brandId), credentials }) })
  }))
  router.get('/brands/:brandId/connections/:connectionId/webhook-setup', requireV2(db, 'providers:read'), asyncRoute(async (request, response) => {
    const connection = await runtime.store.getConnection(String(request.params.connectionId))
    if (!connection || connection.brand_id !== request.params.brandId) return fail(response, 404, 'Connection not found', 'CONNECTION_NOT_FOUND')
    const provider = String(connection.provider), base = config.appUrl.replace(/\/$/, '')
    const callback = provider === 'sendgrid' || provider === 'ses' ? `${base}/api/v2/webhooks/email/${provider}/${connection.id}` : provider === 'twilio' && String(connection.channel).includes('voice') ? `${base}/api/v2/webhooks/voice/twilio/${connection.id}` : `${base}/api/v2/webhooks/${provider}/${connection.id}`
    response.json({ data: { provider, callback_url: callback, method: 'POST', raw_body_signatures: true, events: ['accepted', 'sent', 'delivered', 'read', 'failed', 'inbound'] } })
  }))
  router.post('/brands/:brandId/connections/:connectionId/templates/sync', requireV2(db, 'providers:write'), parseBody(z.object({ templates: z.array(z.object({ external_id: z.string(), name: z.string(), language: z.string(), status: z.string(), category: z.string().optional(), content: z.record(z.string(), z.unknown()) })).optional() })), asyncRoute(async (request, response) => {
    const connection = await runtime.store.getConnection(String(request.params.connectionId))
    if (!connection || connection.brand_id !== request.params.brandId) return fail(response, 404, 'Connection not found', 'CONNECTION_NOT_FOUND')
    const key = config.credentialEncryptionKey ?? (process.env.NODE_ENV === 'production' ? '' : config.sessionSecret), credentials = decryptCredentials(String(connection.encrypted_config ?? connection.encrypted_credentials), key)
    let templates = request.body.templates ?? []
    if (!request.body.templates && connection.provider === 'meta') {
      const fetchResult = await fetch(`https://graph.facebook.com/${credentials.graph_version ?? 'v23.0'}/${credentials.business_account_id}/message_templates?limit=250`, { headers: { authorization: `Bearer ${credentials.access_token}` }, signal: AbortSignal.timeout(15_000) })
      if (!fetchResult.ok) return fail(response, 422, `Meta template sync failed with ${fetchResult.status}`, 'TEMPLATE_SYNC_FAILED')
      const payload = await fetchResult.json() as { data?: Array<Record<string, unknown>> }
      templates = (payload.data ?? []).map((item) => ({ external_id: String(item.id), name: String(item.name), language: String(item.language), status: String(item.status).toLowerCase(), category: String(item.category ?? ''), content: { components: item.components } }))
    }
    if (!request.body.templates && connection.provider === 'twilio') {
      const contents = await (twilio(credentials.account_sid, credentials.auth_token) as unknown as { content: { v1: { contents: { list(input: { limit: number }): Promise<Array<Record<string, unknown>>> } } } }).content.v1.contents.list({ limit: 250 })
      templates = contents.map((item) => ({ external_id: String(item.sid), name: String(item.friendlyName ?? item.sid), language: String(item.language ?? 'en'), status: 'approved', content: { types: item.types } }))
    }
    response.json({ data: await runtime.store.replaceProviderTemplates(String(connection.id), String(request.params.brandId), String(connection.channel ?? 'whatsapp'), templates) })
  }))
  router.get('/brands/:brandId/sender-identities', requireV2(db, 'providers:read'), asyncRoute(async (request, response) => response.json({ data: await runtime.store.listSenderIdentities(String(request.params.brandId), request.query.channel ? String(request.query.channel) : undefined) })))
  router.post('/brands/:brandId/sender-identities', requireV2(db, 'providers:write'), parseBody(z.object({ connection_id: z.string(), channel: z.enum(['email', 'sms', 'whatsapp', 'push', 'voice']), address: z.string(), display_name: z.string().default(''), external_id: z.string().optional(), metadata: z.record(z.string(), z.unknown()).default({}) })), asyncRoute(async (request, response) => response.status(201).json({ data: await runtime.store.createSenderIdentity({ ...request.body, brand_id: String(request.params.brandId) }) })))

  router.post('/brands/:brandId/media', requireV2(db, 'providers:write'), upload.array('files', 10), asyncRoute(async (request, response) => {
    const files = (request.files as Express.Multer.File[] | undefined) ?? []
    const data = []
    for (const file of files) data.push(await storage.promote({ path: file.path, brandId: String(request.params.brandId), originalName: file.originalname, declaredMime: file.mimetype }))
    response.status(201).json({ data })
  }))

  router.post('/brands/:brandId/calls/token', requireV2(db, 'calls:use'), asyncRoute(async (request, response) => {
    if (!(await runtime.store.featureEnabled(String(request.params.brandId), 'voice'))) return fail(response, 404, 'Voice is not enabled for the brand', 'FEATURE_DISABLED')
    const connections = await runtime.store.listConnections(String(request.params.brandId))
    const connection = connections.find((item) => item.provider === 'twilio' && (item.channel === 'voice' || (item.channels as string[] | undefined)?.includes('voice')))
    if (!connection) return fail(response, 422, 'Twilio Voice is not configured', 'VOICE_NOT_CONFIGURED')
    const full = await runtime.store.getConnection(String(connection.id)), key = config.credentialEncryptionKey ?? (process.env.NODE_ENV === 'production' ? '' : config.sessionSecret)
    const credentials = decryptCredentials(String(full?.encrypted_config ?? full?.encrypted_credentials), key)
    const AccessToken = twilio.jwt.AccessToken, VoiceGrant = AccessToken.VoiceGrant
    const token = new AccessToken(credentials.account_sid, credentials.api_key, credentials.api_secret, { identity: request.authUser?.id ?? `api-${request.apiWorkspaceId}`, ttl: 300 })
    token.addGrant(new VoiceGrant({ outgoingApplicationSid: credentials.twiml_app_sid, incomingAllow: true }))
    response.json({ data: { token: token.toJwt(), expires_in: 300 } })
  }))
  router.post('/brands/:brandId/calls', requireV2(db, 'calls:use'), parseBody(z.object({ contact_id: z.string(), from: z.string(), to: z.string(), purpose: z.enum(['marketing', 'transactional', 'support']), scheduled_exception: z.boolean().default(false) })), asyncRoute(async (request, response) => {
    if (!(await runtime.store.featureEnabled(String(request.params.brandId), 'voice'))) return fail(response, 404, 'Voice is not enabled for the brand', 'FEATURE_DISABLED')
    const contact = await runtime.store.getContact(String(request.params.brandId), request.body.contact_id)
    if (!contact) return fail(response, 404, 'Contact not found', 'CONTACT_NOT_FOUND')
    if (request.body.purpose === 'marketing') {
      if (!consentAllows(latestConsent(contact, 'voice', 'marketing'), 'voice', 'marketing')) return fail(response, 422, 'Voice marketing consent is required', 'CONSENT_REQUIRED')
      if (new Date() >= new Date('2026-08-11T00:00:00+02:00')) { const window = frenchCallWindowAllows(new Date(), String(contact.timezone ?? 'Europe/Paris'), request.body.scheduled_exception); if (!window.allowed) return fail(response, 422, window.reason, 'CALL_WINDOW_BLOCKED') }
    }
    const callId = makeId('cal')
    db.prepare(`INSERT INTO call_sessions (id,brand_id,contact_id,assigned_user_id,provider,direction,from_address,to_address,status,started_at,created_at) VALUES (?,?,?,?,?,'outbound',?,?,'ringing',?,?)`).run(callId, request.params.brandId, request.body.contact_id, request.authUser?.id ?? null, 'twilio', request.body.from, request.body.to, nowIso(), nowIso())
    runtime.events.emit('call.status', { brandId: request.params.brandId, callId, state: 'ringing' })
    response.status(201).json({ data: { id: callId, status: 'ringing', timeout_seconds: 30 } })
  }))
  router.post('/brands/:brandId/calls/:callId/answer', requireV2(db, 'calls:use'), asyncRoute(async (request, response) => {
    const result = db.prepare(`UPDATE call_sessions SET assigned_user_id=?,status='in-progress',answered_at=? WHERE id=? AND brand_id=? AND status IN ('queued','ringing')`).run(request.authUser?.id ?? null, nowIso(), request.params.callId, request.params.brandId)
    if (!result.changes) return fail(response, 409, 'This call was already answered or ended', 'CALL_ALREADY_CLAIMED')
    runtime.events.emit('call.status', { brandId: request.params.brandId, callId: request.params.callId, state: 'in-progress', assignedUserId: request.authUser?.id })
    response.json({ data: { id: request.params.callId, status: 'in-progress', assigned_user_id: request.authUser?.id } })
  }))

  router.get('/brands/:brandId/report', requireV2(db, 'campaigns:read'), asyncRoute(async (request, response) => response.json({ data: await runtime.store.report(String(request.params.brandId)) })))
  router.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    const item = error as { message?: string; status?: number; code?: string; details?: unknown }
    fail(response, item.status ?? 500, item.message ?? 'Unexpected server error', item.code ?? 'INTERNAL_ERROR', item.details)
  })
  return router
}

export function createPublicChannelRouter(db: AppDatabase, runtime: MultiChannelRuntime, config: AppConfig, knowledge?: KnowledgeAgent) {
  const router = express.Router()
  const rate = new Map<string, { count: number; reset: number }>()
  const allow = (request: Request, response: Response) => {
    const key = `${request.ip}:${request.path}`; const current = rate.get(key); const now = Date.now()
    if (!current || current.reset < now) { rate.set(key, { count: 1, reset: now + 60_000 }); return true }
    current.count++
    if (current.count > 60) { fail(response, 429, 'Rate limit exceeded', 'RATE_LIMITED'); return false }
    return true
  }
  const widget = (publicKey: string) => db.prepare('SELECT * FROM chat_widgets WHERE public_key=? AND enabled=1').get(publicKey) as Record<string, unknown> | undefined
  const checkOrigin = (origin: string, item: Record<string, unknown>) => {
    const origins = JSON.parse(String(item.allowed_origins ?? '[]')) as string[]
    return origins.includes('*') || origins.includes(origin)
  }

  const publicMessage = (message: Record<string, unknown>) => ({ id: message.id, body: message.body, direction: message.direction, created_at: message.created_at, status: message.status })

  const launchAgent = async (response: Response, item: Record<string, unknown>, payload: { visitorId: string; conversationId: string; brandId: string }, question: string) => {
    if (!knowledge || !item.agent_enabled || !(await runtime.store.featureEnabled(payload.brandId, 'chat_ai'))) return
    const io = response.app.locals.io
    io?.to(`visitor:${payload.visitorId}`).emit('agent.typing', { conversation_id: payload.conversationId, active: true })
    await knowledge.answer({ brandId: payload.brandId, widgetId: String(item.id), conversationId: payload.conversationId, visitorId: payload.visitorId, question, onDelta: (delta) => io?.to(`visitor:${payload.visitorId}`).emit('agent.delta', { conversation_id: payload.conversationId, delta }) })
    io?.to(`visitor:${payload.visitorId}`).emit('agent.typing', { conversation_id: payload.conversationId, active: false })
  }

  router.post('/widget/:publicKey/session', asyncRoute(async (request, response) => {
    if (!allow(request, response)) return
    const item = widget(String(request.params.publicKey))
    if (!item) return fail(response, 404, 'Widget not found', 'WIDGET_NOT_FOUND')
    if (!(await runtime.store.featureEnabled(String(item.brand_id), 'chat'))) return fail(response, 404, 'Chat is not enabled', 'FEATURE_DISABLED')
    const parsed = z.object({ name: z.string().max(160).default('Visitor'), email: z.email().optional(), phone: z.string().optional(), message: z.string().min(1).max(4000), bot_token: z.string().min(8), launch_token: z.string().optional() }).safeParse(request.body)
    if (!parsed.success) return fail(response, 422, 'Validation failed', 'VALIDATION_ERROR', z.treeifyError(parsed.error))
    const launch = verifyToken<{ kind: string; widgetId: string; parentOrigin: string }>(parsed.data.launch_token ?? '', config.sessionSecret)
    const requestOrigin = String(request.headers.origin ?? '')
    const appOrigin = new URL(config.appUrl).origin
    const localPreview = (process.env.NODE_ENV !== 'production' && (!requestOrigin || requestOrigin === appOrigin)) || (Boolean(request.authUser) && requestOrigin === appOrigin)
    const parentOrigin = launch?.kind === 'widget_launch' && launch.widgetId === item.id ? launch.parentOrigin : localPreview ? requestOrigin || new URL(config.appUrl).origin : ''
    if (!parentOrigin || !checkOrigin(parentOrigin, item)) return fail(response, 403, 'Embedding origin is not allowed', 'ORIGIN_NOT_ALLOWED')
    const identifiers: Array<{ type: 'email' | 'phone'; value: string; primary: boolean }> = []
    if (parsed.data.email) identifiers.push({ type: 'email', value: parsed.data.email, primary: true })
    if (parsed.data.phone) identifiers.push({ type: 'phone', value: parsed.data.phone, primary: !parsed.data.email })
    const contact = await runtime.store.createContact({ brand_id: String(item.brand_id), display_name: parsed.data.name, identifiers })
    const inbound = await runtime.store.ingestInbound({ brand_id: String(item.brand_id), contact_id: String(contact.id), channel: 'chat', body: parsed.data.message, provider: 'widget', provider_message_id: `widget-${createHash('sha256').update(parsed.data.bot_token).digest('hex')}` })
    const conversationId = String(inbound.conversation.id)
    const visitorId = makeId('vst'), expiresAt = new Date(Date.now() + 86400_000).toISOString(), token = signToken({ visitorId, conversationId, brandId: item.brand_id, widgetId: item.id }, config.sessionSecret, 86400)
    db.prepare(`INSERT INTO chat_visitor_sessions (id,visitor_id,conversation_id,brand_id,widget_id,parent_origin,expires_at,created_at) VALUES (?,?,?,?,?,?,?,?)`).run(makeId('vss'), visitorId, conversationId, item.brand_id, item.id, parentOrigin, expiresAt, nowIso())
    response.status(201).json({ data: { token, visitor_id: visitorId, conversation_id: conversationId, greeting: item.greeting, name: item.name, agent_enabled: Boolean(item.agent_enabled) } })
    void launchAgent(response, item, { visitorId, conversationId, brandId: String(item.brand_id) }, parsed.data.message).catch(() => undefined)
  }))
  router.post('/widget/:publicKey/messages', asyncRoute(async (request, response) => {
    if (!allow(request, response)) return
    const item = widget(String(request.params.publicKey)), payload = verifyToken<{ visitorId: string; conversationId: string; brandId: string; widgetId: string }>(String(request.headers.authorization ?? '').replace(/^Bearer /, ''), config.sessionSecret)
    const session = payload ? db.prepare(`SELECT id FROM chat_visitor_sessions WHERE visitor_id=? AND conversation_id=? AND brand_id=? AND widget_id=? AND expires_at>?`).get(payload.visitorId, payload.conversationId, payload.brandId, payload.widgetId, nowIso()) : undefined
    if (!item || !payload || !session || payload.brandId !== item.brand_id || payload.widgetId !== item.id) return fail(response, 401, 'Visitor session is invalid or expired', 'VISITOR_SESSION_INVALID')
    const conversation = await runtime.store.getConversation(payload.brandId, payload.conversationId)
    if (!conversation) return fail(response, 404, 'Conversation not found', 'CONVERSATION_NOT_FOUND')
    const parsed = z.object({ body: z.string().min(1).max(4000), client_id: z.string().min(4) }).safeParse(request.body)
    if (!parsed.success) return fail(response, 422, 'Validation failed', 'VALIDATION_ERROR', z.treeifyError(parsed.error))
    const message = await runtime.store.addMessage({ brand_id: payload.brandId, conversation_id: payload.conversationId, contact_id: String(conversation.contact_id), channel: 'chat', direction: 'inbound', body: parsed.data.body, metadata: { client_id: parsed.data.client_id } })
    runtime.events.emit('conversation.message', { brandId: payload.brandId, conversationId: payload.conversationId, message })
    response.status(201).json({ data: message })
    void launchAgent(response, item, payload, parsed.data.body).catch(() => undefined)
  }))
  router.get('/widget/:publicKey/messages', asyncRoute(async (request, response) => {
    if (!allow(request, response)) return
    const item = widget(String(request.params.publicKey)), payload = verifyToken<{ visitorId: string; conversationId: string; brandId: string; widgetId: string }>(String(request.headers.authorization ?? '').replace(/^Bearer /, ''), config.sessionSecret)
    const session = payload ? db.prepare(`SELECT id FROM chat_visitor_sessions WHERE visitor_id=? AND conversation_id=? AND brand_id=? AND widget_id=? AND expires_at>?`).get(payload.visitorId, payload.conversationId, payload.brandId, payload.widgetId, nowIso()) : undefined
    if (!item || !payload || !session || payload.widgetId !== item.id) return fail(response, 401, 'Visitor session is invalid or expired', 'VISITOR_SESSION_INVALID')
    const conversation = await runtime.store.getConversation(payload.brandId, payload.conversationId)
    if (!conversation) return fail(response, 404, 'Conversation not found', 'CONVERSATION_NOT_FOUND')
    const cursor = Math.max(0, Number(Buffer.from(String(request.query.cursor ?? ''), 'base64url').toString('utf8') || 0))
    const all = ((conversation.messages as Array<Record<string, unknown>> | undefined) ?? []).map(publicMessage)
    const page = all.slice(cursor, cursor + 50), next = cursor + page.length < all.length ? Buffer.from(String(cursor + page.length)).toString('base64url') : null
    response.json({ data: page, next_cursor: next })
  }))
  router.post('/push/:brandId/subscriptions', asyncRoute(async (request, response) => {
    if (!allow(request, response)) return
    const brand = db.prepare('SELECT id FROM brands WHERE id=?').get(request.params.brandId)
    if (!brand) return fail(response, 404, 'Brand not found', 'BRAND_NOT_FOUND')
    if (!(await runtime.store.featureEnabled(String(request.params.brandId), 'push'))) return fail(response, 404, 'Push is not enabled', 'FEATURE_DISABLED')
    const parsed = z.object({ contact_id: z.string(), platform: z.enum(['web', 'ios', 'android']), provider: z.enum(['webpush', 'fcm']), token: z.string().optional(), endpoint: z.string().optional(), subscription: z.record(z.string(), z.unknown()).default({}), app_id: z.string().optional(), origin: z.string().url() }).safeParse(request.body)
    if (!parsed.success) return fail(response, 422, 'Validation failed', 'VALIDATION_ERROR', z.treeifyError(parsed.error))
    if (parsed.data.origin !== request.headers.origin) return fail(response, 403, 'Origin mismatch', 'ORIGIN_NOT_ALLOWED')
    const device = await runtime.store.registerDevice({ brand_id: String(request.params.brandId), ...parsed.data })
    response.status(201).json({ data: device })
  }))
  router.get('/widget/:publicKey/loader.js', (request, response) => {
    const item = widget(String(request.params.publicKey))
    if (!item) return response.status(404).type('text/javascript').send('')
    let parentOrigin = ''
    try { parentOrigin = new URL(String(request.headers.referer ?? '')).origin } catch { /* invalid or absent Referer */ }
    if (!parentOrigin || !checkOrigin(parentOrigin, item)) return response.status(403).type('text/javascript').send('')
    const launch = signToken({ kind: 'widget_launch', widgetId: item.id, parentOrigin }, config.sessionSecret, 300)
    response.setHeader('Cache-Control', 'private, no-store')
    response.type('text/javascript').send(`(()=>{const f=document.createElement('iframe');f.src=${JSON.stringify(`${config.appUrl}/widget/${request.params.publicKey}?launch=${encodeURIComponent(launch)}`)};f.title='Sendry chat';f.sandbox='allow-scripts allow-forms allow-same-origin';f.style='position:fixed;inset-inline-end:20px;bottom:20px;width:390px;height:620px;max-width:calc(100vw - 24px);max-height:calc(100vh - 24px);border:0;z-index:2147483647';document.body.appendChild(f)})()`)
  })
  return router
}
