import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { createApp } from '../server/app'
import { openDatabase, seedDatabase, type AppDatabase } from '../server/db'
import { consentAllows, frenchCallWindowAllows, isSuppressionKeyword, normalizePhone, smsSegments } from '../server/multichannel/compliance'
import { decryptCredentials, encryptCredentials } from '../server/multichannel/crypto'

const config = { appUrl: 'http://localhost:5173', uploadDir: '/tmp/sendry-multichannel-tests', sessionSecret: 'sendry-test-session-secret-at-least-thirty-two-characters', credentialEncryptionKey: 'multichannel-test-key-at-least-32-characters', mailTransport: 'stream' as const, databasePath: ':memory:' }

describe('multi-channel contracts', () => {
  let db: AppDatabase, app: Express, agent: ReturnType<typeof request.agent>
  beforeEach(async () => {
    db = openDatabase(':memory:'); seedDatabase(db)
    app = createApp({ db, config, worker: false }); agent = request.agent(app)
    await agent.post('/api/auth/login').send({ email: 'qa@sendry.local', password: 'TestPass123!' }).expect(200)
  })
  afterEach(async () => { await app.locals.multiChannel.close(); db.close() })

  it('segments GSM-7 and UCS-2 messages at provider billing boundaries', () => {
    expect(smsSegments('a'.repeat(160))).toMatchObject({ encoding: 'GSM-7', segments: 1 })
    expect(smsSegments('a'.repeat(161))).toMatchObject({ encoding: 'GSM-7', segments: 2, perSegment: 153 })
    expect(smsSegments('🙂'.repeat(71))).toMatchObject({ encoding: 'UCS-2', segments: 2, perSegment: 67 })
  })

  it('normalizes E.164, recognizes localized objection, and evaluates consent', () => {
    expect(normalizePhone('06 12 01 02 03')).toBe('+33612010203')
    expect(isSuppressionKeyword('Arrêt')).toBe(true)
    expect(consentAllows({ granted: true }, 'sms', 'marketing')).toBe(true)
    expect(consentAllows(undefined, 'sms', 'marketing')).toBe(false)
    expect(consentAllows(undefined, 'sms', 'transactional')).toBe(true)
  })

  it('enforces the split French weekday call window', () => {
    expect(frenchCallWindowAllows(new Date('2026-08-12T09:00:00Z'), 'Europe/Paris').allowed).toBe(true)
    expect(frenchCallWindowAllows(new Date('2026-08-12T11:30:00Z'), 'Europe/Paris').allowed).toBe(false)
    expect(frenchCallWindowAllows(new Date('2026-08-15T09:00:00Z'), 'Europe/Paris').allowed).toBe(false)
    expect(frenchCallWindowAllows(new Date('2026-08-15T09:00:00Z'), 'Europe/Paris', true).allowed).toBe(true)
  })

  it('authenticates encryption and rejects tampering', () => {
    const encrypted = encryptCredentials({ auth_token: 'private', account_sid: 'AC123' }, config.credentialEncryptionKey)
    expect(encrypted).not.toContain('private')
    expect(decryptCredentials(encrypted, config.credentialEncryptionKey)).toEqual({ auth_token: 'private', account_sid: 'AC123' })
    const parts = encrypted.split('.'); parts[2] = `${parts[2][0] === 'A' ? 'B' : 'A'}${parts[2].slice(1)}`
    expect(() => decryptCredentials(parts.join('.'), config.credentialEncryptionKey)).toThrow()
  })

  it('lists seeded inbox conversations and first reply claims an unassigned conversation', async () => {
    const list = await agent.get('/api/v2/brands/brd_atlas/conversations?queue=all').expect(200)
    expect(list.body.data.length).toBeGreaterThanOrEqual(5)
    const conversation = list.body.data.find((item: { assigned_user_id?: string }) => !item.assigned_user_id)
    await agent.post(`/api/v2/brands/brd_atlas/conversations/${conversation.id}/replies`).send({ body: 'I can help with that.', channel: 'whatsapp', internal: false, media: [] }).expect(201)
    const detail = await agent.get(`/api/v2/brands/brd_atlas/conversations/${conversation.id}`).expect(200)
    expect(detail.body.data.assigned_user_id).toBe('usr_qa_admin')
  })

  it('keeps channels in one canonical-contact timeline and prioritizes email reply headers', async () => {
    const store = app.locals.multiChannel.store
    const sms = await store.ingestInbound({ brand_id: 'brd_atlas', contact_id: 'ctc_sofia', channel: 'sms', body: 'A cross-channel follow-up', provider: 'stream', provider_message_id: 'sms-thread-1' })
    expect(sms.conversation.id).toBe('cnv_sofia')
    const firstEmail = await store.ingestInbound({ brand_id: 'brd_atlas', contact_id: 'ctc_sofia', channel: 'email', body: 'A separate email thread', subject: 'Separate subject', provider: 'stream', provider_message_id: '<email-thread-1>', metadata: { message_id: '<email-thread-1>', in_reply_to: '<unknown-thread>' } })
    expect(firstEmail.conversation.id).not.toBe('cnv_sofia')
    const reply = await store.ingestInbound({ brand_id: 'brd_atlas', contact_id: 'ctc_sofia', channel: 'email', body: 'Reply in the same email thread', subject: 'Re: Separate subject', provider: 'stream', provider_message_id: '<email-thread-2>', metadata: { message_id: '<email-thread-2>', in_reply_to: '<email-thread-1>' } })
    expect(reply.conversation.id).toBe(firstEmail.conversation.id)
  })

  it('creates channel-native campaigns and rejects mismatched content', async () => {
    await agent.post('/api/v2/brands/brd_atlas/campaigns').send({ name: 'SMS test', channel: 'sms', purpose: 'marketing', content: { channel: 'sms', body: 'Hello', media: [], shorten_links: true }, audience: { contact_ids: ['ctc_sofia'], list_ids: [], excluded_contact_ids: [] }, tracking_policy: { clicks: true, opens: false } }).expect(201)
    const invalid = await agent.post('/api/v2/brands/brd_atlas/campaigns').send({ name: 'Mismatch', channel: 'sms', purpose: 'marketing', content: { channel: 'push', title: 'Wrong', body: 'Wrong', data: {} } }).expect(422)
    expect(invalid.body.code).toBe('VALIDATION_ERROR')
  })

  it('requires and replays Idempotency-Key without duplicating delivery', async () => {
    const body = { brand_id: 'brd_atlas', contact_id: 'ctc_sofia', sender_identity_id: 'snd_stream_sms', purpose: 'marketing', content: { channel: 'sms', body: 'Your requested Atlas update.', media: [], shorten_links: true } }
    await agent.post('/api/v2/messages').send(body).expect(400)
    const first = await agent.post('/api/v2/messages').set('Idempotency-Key', 'tx-test-001').send(body).expect(202)
    const second = await agent.post('/api/v2/messages').set('Idempotency-Key', 'tx-test-001').send(body).expect(202)
    expect(second.body).toEqual(first.body)
    expect((db.prepare(`SELECT COUNT(*) count FROM channel_deliveries WHERE idempotency_key='tx-test-001'`).get() as { count: number }).count).toBe(1)
    const conflict = await agent.post('/api/v2/messages').set('Idempotency-Key', 'tx-test-001').send({ ...body, content: { ...body.content, body: 'Different' } }).expect(409)
    expect(conflict.body.code).toBe('IDEMPOTENCY_CONFLICT')
  })

  it('requires a WhatsApp template outside the service window', async () => {
    const result = await agent.post('/api/v2/messages').set('Idempotency-Key', 'wa-window-001').send({ brand_id: 'brd_atlas', contact_id: 'ctc_lina', sender_identity_id: 'snd_stream_whatsapp', purpose: 'transactional', content: { channel: 'whatsapp', body: 'Your delivery is scheduled.', media: [], buttons: [] } }).expect(422)
    expect(result.body.code).toBe('WHATSAPP_TEMPLATE_REQUIRED')
  })

  it('stores provider secrets encrypted and does not return them', async () => {
    const result = await agent.post('/api/v2/brands/brd_atlas/connections').send({ channel: 'sms', provider: 'twilio', name: 'Primary Twilio', credentials: { account_sid: 'AC123', auth_token: 'top-secret' }, capabilities: [], is_default: false }).expect(201)
    expect(JSON.stringify(result.body)).not.toContain('top-secret')
    const stored = db.prepare('SELECT encrypted_config FROM channel_connections WHERE id=?').get(result.body.data.id) as { encrypted_config: string }
    expect(stored.encrypted_config).not.toContain('top-secret')
    expect(decryptCredentials(stored.encrypted_config, config.credentialEncryptionKey).auth_token).toBe('top-secret')
  })

  it('rejects forged provider webhooks before parsing events', async () => {
    const result = await request(app).post('/api/v2/webhooks/stream/cnn_stream_sms').set('content-type', 'application/x-www-form-urlencoded').send('MessageSid=SM123&MessageStatus=delivered').expect(401)
    expect(result.body.code).toBe('INVALID_WEBHOOK_SIGNATURE')
  })
})
