import { createHmac, createVerify, randomUUID, timingSafeEqual } from 'node:crypto'
import sanitizeHtml from 'sanitize-html'
import { simpleParser } from 'mailparser'
import { ImapFlow } from 'imapflow'
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3'
import type { MultiChannelRuntime } from './runtime'
import { normalizeEmail } from './compliance'

const cleanHtml = (value: string) => sanitizeHtml(value, { allowedTags: [...sanitizeHtml.defaults.allowedTags, 'img'], allowedAttributes: { a: ['href', 'title'], img: ['src', 'alt', 'width', 'height'] }, allowedSchemes: ['http', 'https', 'mailto', 'cid'] })

export async function ingestMimeMessage(runtime: MultiChannelRuntime, input: { brandId: string; provider: string; raw: Buffer; providerMessageId?: string }) {
  const parsed = await simpleParser(input.raw)
  const from = parsed.from?.value[0]?.address
  if (!from) throw new Error('Inbound email has no From address')
  const contact = await runtime.store.createContact({ brand_id: input.brandId, display_name: parsed.from?.value[0]?.name ?? '', identifiers: [{ type: 'email', value: normalizeEmail(from), primary: true }] })
  const messageId = parsed.messageId ?? input.providerMessageId ?? `inbound-${randomUUID()}@sendry.local`
  const result = await runtime.store.ingestInbound({ brand_id: input.brandId, contact_id: String(contact.id), channel: 'email', body: parsed.text ?? '', html: parsed.html ? cleanHtml(parsed.html) : undefined, subject: parsed.subject ?? '', provider: input.provider, provider_message_id: messageId, media: [...parsed.attachments].map((item) => ({ name: item.filename, mime_type: item.contentType, size: item.size, content_id: item.contentId })), metadata: { message_id: messageId, in_reply_to: parsed.inReplyTo, references: parsed.references, date: parsed.date?.toISOString(), headers: Object.fromEntries([...parsed.headers].filter(([key]) => ['reply-to', 'thread-index', 'thread-topic'].includes(key))) } })
  runtime.events.emit('conversation.message', { brandId: input.brandId, conversationId: result.conversation.id, message: result.message })
  return result
}

export function verifySendgridInboundSignature(raw: Buffer, headers: Record<string, string | string[] | undefined>, secret: string) {
  const timestamp = String(headers['x-twilio-email-event-webhook-timestamp'] ?? headers['x-sendgrid-timestamp'] ?? '')
  const supplied = String(headers['x-twilio-email-event-webhook-signature'] ?? headers['x-sendgrid-signature'] ?? '').replace(/^sha256=/, '')
  const expected = createHmac('sha256', secret).update(timestamp).update(raw).digest('base64')
  const left = Buffer.from(supplied), right = Buffer.from(expected)
  return !!timestamp && left.length === right.length && timingSafeEqual(left, right)
}

type SnsMessage = { Type: string; MessageId: string; TopicArn: string; Subject?: string; Message: string; Timestamp: string; SignatureVersion: string; Signature: string; SigningCertURL: string; SubscribeURL?: string; Token?: string }

function snsCanonical(message: SnsMessage) {
  const keys = message.Type === 'Notification' ? ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type'] : ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type']
  return keys.filter((key) => message[key as keyof SnsMessage] !== undefined).map((key) => `${key}\n${message[key as keyof SnsMessage]}\n`).join('')
}

export async function verifySnsMessage(message: SnsMessage) {
  const certUrl = new URL(message.SigningCertURL)
  if (certUrl.protocol !== 'https:' || !/^sns\.[a-z0-9-]+\.amazonaws\.com$/i.test(certUrl.hostname) || !certUrl.pathname.endsWith('.pem')) return false
  const certificate = await fetch(certUrl, { signal: AbortSignal.timeout(5_000) }).then((response) => response.text())
  const verifier = createVerify(message.SignatureVersion === '2' ? 'RSA-SHA256' : 'RSA-SHA1')
  verifier.update(snsCanonical(message))
  return verifier.verify(certificate, message.Signature, 'base64')
}

export async function ingestSesNotification(runtime: MultiChannelRuntime, message: SnsMessage, credentials: Record<string, string>) {
  const payload = JSON.parse(message.Message) as { receipt?: { action?: { bucketName?: string; objectKey?: string } }; mail?: { messageId?: string } }
  const bucket = payload.receipt?.action?.bucketName, key = payload.receipt?.action?.objectKey
  if (!bucket || !key) throw new Error('SES notification does not reference an S3 object')
  const s3 = new S3Client({ region: credentials.region, credentials: credentials.access_key_id && credentials.secret_access_key ? { accessKeyId: credentials.access_key_id, secretAccessKey: credentials.secret_access_key } : undefined })
  const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
  const bytes = await result.Body?.transformToByteArray()
  if (!bytes) throw new Error('SES S3 object is empty')
  return { raw: Buffer.from(bytes), providerMessageId: payload.mail?.messageId }
}

export async function syncImapMailbox(runtime: MultiChannelRuntime, input: { brandId: string; credentials: Record<string, string>; maxMessages?: number }) {
  const client = new ImapFlow({ host: input.credentials.host, port: Number(input.credentials.port ?? 993), secure: input.credentials.secure !== 'false', auth: { user: input.credentials.user, pass: input.credentials.password }, logger: false })
  let imported = 0
  await client.connect()
  try {
    const lock = await client.getMailboxLock(input.credentials.mailbox ?? 'INBOX')
    try {
      const messages = await client.search({ seen: false })
      for (const uid of (messages || []).slice(-(input.maxMessages ?? 50))) {
        const item = await client.download(uid, undefined, { uid: true })
        const chunks: Buffer[] = []
        for await (const chunk of item.content) chunks.push(Buffer.from(chunk))
        await ingestMimeMessage(runtime, { brandId: input.brandId, provider: 'imap', raw: Buffer.concat(chunks) })
        await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true })
        imported++
      }
    } finally { lock.release() }
  } finally { await client.logout() }
  return { imported }
}
