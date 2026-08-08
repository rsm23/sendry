import { createHash, randomUUID } from 'node:crypto'
import type { AppDatabase } from '../db'
import { nowIso } from '../serialize'
import { normalizeEmail, normalizePhone } from './compliance'
import type { CampaignChannel, ChannelContent, DeliveryState, MessagePurpose } from './types'

const makeId = (prefix: string) => `${prefix}_${randomUUID().replaceAll('-', '')}`
const parse = <T>(value: unknown, fallback: T): T => {
  if (typeof value !== 'string') return (value as T) ?? fallback
  try { return JSON.parse(value) as T } catch { return fallback }
}
const json = (value: unknown) => JSON.stringify(value ?? {})

export type ContactInput = {
  brand_id: string
  display_name?: string
  company?: string
  locale?: string
  timezone?: string
  identifiers?: Array<{ type: 'email' | 'phone' | 'whatsapp'; value: string; primary?: boolean }>
  attributes?: Record<string, unknown>
}

export type CampaignInput = {
  brand_id: string
  name: string
  channel: CampaignChannel
  purpose: MessagePurpose
  sender_identity_id?: string
  content: ChannelContent
  audience?: { list_ids?: string[]; contact_ids?: string[]; excluded_contact_ids?: string[] }
  tracking_policy?: Record<string, unknown>
}

export type DeliveryInput = {
  brand_id: string
  contact_id: string
  campaign_id?: string
  automation_step_id?: string
  conversation_id?: string
  channel: CampaignChannel
  purpose: MessagePurpose
  sender_identity_id?: string
  provider: string
  idempotency_key: string
  destination: string
  content: ChannelContent
}

export type MultiChannelStore = {
  kind: 'sqlite' | 'postgres'
  close(): Promise<void>
  featureEnabled(brandId: string, key: string): Promise<boolean>
  setFeatureFlag(brandId: string, key: string, enabled: boolean): Promise<void>
  getBrandPolicy(brandId: string): Promise<Record<string, unknown> | undefined>
  updateBrandPolicy(brandId: string, policy: { first_response_sla_minutes?: number; conversation_retention_days?: number; provider_payload_retention_days?: number; allowed_origins?: string[] }): Promise<Record<string, unknown> | undefined>
  listContacts(brandId: string, query?: string): Promise<Record<string, unknown>[]>
  createContact(input: ContactInput): Promise<Record<string, unknown>>
  getContact(brandId: string, contactId: string): Promise<Record<string, unknown> | undefined>
  updateContact(brandId: string, contactId: string, fields: { display_name?: string; company?: string; locale?: string; timezone?: string; attributes?: Record<string, unknown> }): Promise<Record<string, unknown> | undefined>
  exportContact(brandId: string, contactId: string): Promise<Record<string, unknown> | undefined>
  deleteContact(brandId: string, contactId: string): Promise<{ deleted: boolean; legal_hold: boolean }>
  listMergeSuggestions(brandId: string): Promise<Record<string, unknown>[]>
  resolveMergeSuggestion(brandId: string, suggestionId: string, action: 'merge' | 'reject'): Promise<Record<string, unknown> | undefined>
  recordConsent(input: { brand_id: string; contact_id: string; channel: string; purpose: MessagePurpose; status: 'granted' | 'withdrawn' | 'objected' | 'expired'; source: string; legal_basis: string; policy_version: string; proof?: Record<string, unknown>; captured_at?: string; expires_at?: string }): Promise<Record<string, unknown>>
  registerDevice(input: { brand_id: string; contact_id: string; platform: 'web' | 'ios' | 'android'; provider: 'webpush' | 'fcm'; token?: string; endpoint?: string; subscription?: Record<string, unknown>; app_id?: string; origin?: string }): Promise<Record<string, unknown>>
  listCampaigns(brandId: string): Promise<Record<string, unknown>[]>
  getCampaign(brandId: string, campaignId: string): Promise<Record<string, unknown> | undefined>
  createCampaign(input: CampaignInput): Promise<Record<string, unknown>>
  updateCampaignState(brandId: string, campaignId: string, state: string, scheduledAt?: string): Promise<Record<string, unknown> | undefined>
  listConnections(brandId: string): Promise<Record<string, unknown>[]>
  createConnection(input: { brand_id: string; channel: string; provider: string; name: string; encrypted_config: string; capabilities?: string[]; is_default?: boolean }): Promise<Record<string, unknown>>
  getConnection(connectionId: string): Promise<Record<string, unknown> | undefined>
  updateConnectionTest(connectionId: string, ok: boolean, error?: string): Promise<void>
  listSenderIdentities(brandId: string, channel?: string): Promise<Record<string, unknown>[]>
  createSenderIdentity(input: { brand_id: string; connection_id: string; channel: string; address: string; display_name?: string; external_id?: string; metadata?: Record<string, unknown> }): Promise<Record<string, unknown>>
  replaceProviderTemplates(connectionId: string, brandId: string, channel: string, templates: Array<{ external_id: string; name: string; language: string; status: string; category?: string; content: Record<string, unknown> }>): Promise<Record<string, unknown>[]>
  listConversations(brandId: string, filter: string | undefined, userId?: string): Promise<Record<string, unknown>[]>
  getConversation(brandId: string, conversationId: string): Promise<Record<string, unknown> | undefined>
  updateConversation(input: { brand_id: string; conversation_id: string; assigned_user_id?: string | null; status?: string; snoozed_until?: string | null; actor_user_id?: string }): Promise<Record<string, unknown> | undefined>
  addMessage(input: { brand_id: string; conversation_id: string; contact_id: string; channel: string; direction: 'inbound' | 'outbound' | 'internal'; kind?: string; body: string; html?: string; media?: unknown[]; provider?: string; provider_message_id?: string; sender_user_id?: string; status?: string; metadata?: Record<string, unknown> }): Promise<Record<string, unknown>>
  ingestInbound(input: { brand_id: string; contact_id: string; channel: string; body: string; html?: string; subject?: string; provider: string; provider_message_id: string; media?: unknown[]; metadata?: Record<string, unknown> }): Promise<{ conversation: Record<string, unknown>; message: Record<string, unknown> }>
  createDelivery(input: DeliveryInput): Promise<{ delivery: Record<string, unknown>; duplicate: boolean }>
  updateDelivery(deliveryId: string, state: DeliveryState, fields?: { provider_message_id?: string; error_code?: string; error_message?: string; cost?: number }): Promise<void>
  findDeliveryByProviderMessage(provider: string, providerMessageId: string): Promise<Record<string, unknown> | undefined>
  saveProviderEvent(input: { connection_id?: string; brand_id?: string; provider: string; external_id: string; event_type: string; payload: Record<string, unknown>; signature_valid: boolean }): Promise<boolean>
  addSuppression(input: { brand_id: string; channel: string; normalized_identifier: string; reason: string; source: string }): Promise<void>
  isSuppressed(brandId: string, channel: string, normalizedIdentifier: string): Promise<boolean>
  saveIdempotency(workspaceId: string, key: string, requestBody: unknown, status: number, responseBody: unknown): Promise<void>
  getIdempotency(workspaceId: string, key: string, requestBody: unknown): Promise<{ status: number; body: unknown } | undefined>
  report(brandId: string, campaignId?: string): Promise<Record<string, unknown>>
  retentionSweep(): Promise<{ provider_events: number; conversations: number }>
}

function mapContact(row: Record<string, unknown>): Record<string, unknown> {
  return { ...row, attributes: parse(row.attributes, {}), identifiers: parse(row.identifiers, []) }
}

function mapCampaign(row: Record<string, unknown>): Record<string, unknown> {
  return { ...row, content: parse(row.content, {}), audience: parse(row.audience, {}), tracking_policy: parse(row.tracking_policy, {}) }
}

export class SqliteMultiChannelStore implements MultiChannelStore {
  readonly kind = 'sqlite' as const
  constructor(private readonly db: AppDatabase) {}
  async close() {}

  async featureEnabled(brandId: string, key: string) {
    const row = this.db.prepare('SELECT enabled FROM feature_flags WHERE brand_id=? AND key=?').get(brandId, key) as { enabled: number } | undefined
    return !!row?.enabled
  }

  async setFeatureFlag(brandId: string, key: string, enabled: boolean) {
    this.db.prepare(`INSERT INTO feature_flags (brand_id,key,enabled,updated_at) VALUES (?,?,?,?) ON CONFLICT(brand_id,key) DO UPDATE SET enabled=excluded.enabled,updated_at=excluded.updated_at`).run(brandId, key, enabled ? 1 : 0, nowIso())
  }

  async getBrandPolicy(brandId: string): Promise<Record<string, unknown> | undefined> {
    const row = this.db.prepare('SELECT first_response_sla_minutes,conversation_retention_days,provider_payload_retention_days,allowed_origins FROM brands WHERE id=?').get(brandId) as Record<string, unknown> | undefined
    return row ? { ...row, allowed_origins: parse(row.allowed_origins, []) } : undefined
  }

  async updateBrandPolicy(brandId: string, policy: Parameters<MultiChannelStore['updateBrandPolicy']>[1]) {
    const current = await this.getBrandPolicy(brandId)
    if (!current) return undefined
    this.db.prepare(`UPDATE brands SET first_response_sla_minutes=?,conversation_retention_days=?,provider_payload_retention_days=?,allowed_origins=?,updated_at=? WHERE id=?`).run(policy.first_response_sla_minutes ?? current.first_response_sla_minutes, policy.conversation_retention_days ?? current.conversation_retention_days, policy.provider_payload_retention_days ?? current.provider_payload_retention_days, json(policy.allowed_origins ?? current.allowed_origins), nowIso(), brandId)
    return this.getBrandPolicy(brandId)
  }

  async listContacts(brandId: string, query = '') {
    const rows = this.db.prepare(`SELECT c.*, COALESCE((SELECT json_group_array(json_object('id',ci.id,'type',ci.type,'value',ci.value,'normalized_value',ci.normalized_value,'is_primary',ci.is_primary)) FROM contact_identifiers ci WHERE ci.contact_id=c.id), '[]') identifiers FROM contacts c WHERE c.brand_id=? AND (?='' OR c.display_name LIKE '%'||?||'%' OR EXISTS (SELECT 1 FROM contact_identifiers ci WHERE ci.contact_id=c.id AND ci.normalized_value LIKE '%'||?||'%')) ORDER BY c.updated_at DESC LIMIT 250`).all(brandId, query, query, query) as Record<string, unknown>[]
    return rows.map(mapContact)
  }

  async createContact(input: ContactInput) {
    const identifiers = (input.identifiers ?? []).map((identifier) => ({ ...identifier, normalized: identifier.type === 'email' ? normalizeEmail(identifier.value) : normalizePhone(identifier.value) }))
    const email = identifiers.find((identifier) => identifier.type === 'email')
    if (email) {
      const existing = this.db.prepare(`SELECT c.id FROM contacts c JOIN contact_identifiers i ON i.contact_id=c.id WHERE c.brand_id=? AND i.type='email' AND i.normalized_value=?`).get(input.brand_id, email.normalized) as { id: string } | undefined
      if (existing) {
        for (const identifier of identifiers.filter((item) => item.type !== 'email')) {
          const conflict = this.db.prepare(`SELECT contact_id FROM contact_identifiers WHERE brand_id=? AND type=? AND normalized_value=? AND contact_id<>?`).get(input.brand_id, identifier.type, identifier.normalized, existing.id) as { contact_id: string } | undefined
          if (conflict) this.db.prepare(`INSERT OR IGNORE INTO contact_merge_suggestions (id,brand_id,source_contact_id,target_contact_id,reason,status,created_at) VALUES (?,?,?,?,?,'pending',?)`).run(makeId('mrg'), input.brand_id, existing.id, conflict.contact_id, `Conflicting ${identifier.type}: ${identifier.normalized}`, nowIso())
        }
        return (await this.getContact(input.brand_id, existing.id))!
      }
    }
    const conflicts = identifiers.filter((identifier) => identifier.type !== 'email').map((identifier) => ({ identifier, row: this.db.prepare(`SELECT contact_id FROM contact_identifiers WHERE brand_id=? AND type=? AND normalized_value=?`).get(input.brand_id, identifier.type, identifier.normalized) as { contact_id: string } | undefined })).filter((item) => item.row)
    const conflictValues = new Set(conflicts.map((item) => item.identifier.normalized))
    const contactId = makeId('ctc')
    const timestamp = nowIso()
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO contacts (id,brand_id,display_name,company,locale,timezone,attributes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`).run(contactId, input.brand_id, input.display_name ?? '', input.company ?? '', input.locale ?? 'en', input.timezone ?? 'Europe/Paris', json(input.attributes), timestamp, timestamp)
      const statement = this.db.prepare(`INSERT INTO contact_identifiers (id,contact_id,brand_id,type,value,normalized_value,is_primary,created_at) VALUES (?,?,?,?,?,?,?,?)`)
      identifiers.filter((identifier) => !conflictValues.has(identifier.normalized)).forEach((identifier, position) => statement.run(makeId('cid'), contactId, input.brand_id, identifier.type, identifier.value, identifier.normalized, identifier.primary || position === 0 ? 1 : 0, timestamp))
      for (const conflict of conflicts) this.db.prepare(`INSERT OR IGNORE INTO contact_merge_suggestions (id,brand_id,source_contact_id,target_contact_id,reason,status,created_at) VALUES (?,?,?,?,?,'pending',?)`).run(makeId('mrg'), input.brand_id, contactId, conflict.row!.contact_id, `Conflicting ${conflict.identifier.type}: ${conflict.identifier.normalized}`, timestamp)
    })()
    return (await this.getContact(input.brand_id, contactId))!
  }

  async getContact(brandId: string, contactId: string): Promise<Record<string, unknown> | undefined> {
    const row = this.db.prepare(`SELECT c.*, COALESCE((SELECT json_group_array(json_object('id',ci.id,'type',ci.type,'value',ci.value,'normalized_value',ci.normalized_value,'is_primary',ci.is_primary)) FROM contact_identifiers ci WHERE ci.contact_id=c.id), '[]') identifiers FROM contacts c WHERE c.brand_id=? AND c.id=?`).get(brandId, contactId) as Record<string, unknown> | undefined
    if (!row) return undefined
    const consents = this.db.prepare('SELECT * FROM consent_events WHERE contact_id=? ORDER BY captured_at DESC').all(contactId) as Record<string, unknown>[]
    return { ...mapContact(row), consents: consents.map((item) => ({ ...item, proof: parse(item.proof, {}) })) }
  }

  async updateContact(brandId: string, contactId: string, fields: Parameters<MultiChannelStore['updateContact']>[2]) {
    const current = await this.getContact(brandId, contactId)
    if (!current) return undefined
    this.db.prepare(`UPDATE contacts SET display_name=?,company=?,locale=?,timezone=?,attributes=?,updated_at=? WHERE brand_id=? AND id=?`).run(fields.display_name ?? current.display_name, fields.company ?? current.company, fields.locale ?? current.locale, fields.timezone ?? current.timezone, json(fields.attributes ?? current.attributes), nowIso(), brandId, contactId)
    return this.getContact(brandId, contactId)
  }

  async exportContact(brandId: string, contactId: string) {
    const contact = await this.getContact(brandId, contactId)
    if (!contact) return undefined
    const conversations = await this.listConversations(brandId, 'all')
    const histories = await Promise.all(conversations.filter((item) => item.contact_id === contactId).map((item) => this.getConversation(brandId, String(item.id))))
    const calls = this.db.prepare('SELECT * FROM call_sessions WHERE brand_id=? AND contact_id=? ORDER BY created_at').all(brandId, contactId)
    const devices = this.db.prepare('SELECT id,platform,provider,app_id,status,last_seen_at,created_at FROM contact_devices WHERE brand_id=? AND contact_id=?').all(brandId, contactId)
    const audit = this.db.prepare(`SELECT * FROM audit_log WHERE brand_id=? AND (entity_id=? OR metadata LIKE '%'||?||'%') ORDER BY created_at`).all(brandId, contactId, contactId)
    return { contact, conversations: histories.filter(Boolean), calls, devices, audit }
  }

  async deleteContact(brandId: string, contactId: string) {
    const exists = this.db.prepare('SELECT id FROM contacts WHERE brand_id=? AND id=?').get(brandId, contactId)
    if (!exists) return { deleted: false, legal_hold: false }
    this.db.transaction(() => { this.db.prepare(`DELETE FROM audit_log WHERE brand_id=? AND (entity_id=? OR metadata LIKE '%'||?||'%')`).run(brandId, contactId, contactId); this.db.prepare('DELETE FROM contacts WHERE brand_id=? AND id=?').run(brandId, contactId) })()
    return { deleted: true, legal_hold: false }
  }

  async listMergeSuggestions(brandId: string) {
    return this.db.prepare(`SELECT s.*,source.display_name source_name,target.display_name target_name FROM contact_merge_suggestions s JOIN contacts source ON source.id=s.source_contact_id JOIN contacts target ON target.id=s.target_contact_id WHERE s.brand_id=? ORDER BY s.created_at DESC`).all(brandId) as Record<string, unknown>[]
  }

  async resolveMergeSuggestion(brandId: string, suggestionId: string, action: 'merge' | 'reject') {
    const suggestion = this.db.prepare(`SELECT * FROM contact_merge_suggestions WHERE brand_id=? AND id=? AND status='pending'`).get(brandId, suggestionId) as Record<string, unknown> | undefined
    if (!suggestion) return undefined
    this.db.transaction(() => {
      if (action === 'merge') {
        this.db.prepare(`UPDATE OR IGNORE contact_identifiers SET contact_id=? WHERE contact_id=?`).run(suggestion.target_contact_id, suggestion.source_contact_id)
        this.db.prepare(`UPDATE conversations SET contact_id=? WHERE contact_id=?`).run(suggestion.target_contact_id, suggestion.source_contact_id)
        this.db.prepare(`UPDATE conversation_messages SET contact_id=? WHERE contact_id=?`).run(suggestion.target_contact_id, suggestion.source_contact_id)
        this.db.prepare(`UPDATE OR IGNORE contact_devices SET contact_id=? WHERE contact_id=?`).run(suggestion.target_contact_id, suggestion.source_contact_id)
        this.db.prepare(`DELETE FROM contacts WHERE id=?`).run(suggestion.source_contact_id)
      }
      this.db.prepare(`UPDATE contact_merge_suggestions SET status=?,resolved_at=? WHERE id=?`).run(action === 'merge' ? 'merged' : 'rejected', nowIso(), suggestionId)
    })()
    return { ...suggestion, status: action === 'merge' ? 'merged' : 'rejected', resolved_at: nowIso() }
  }

  async recordConsent(input: Parameters<MultiChannelStore['recordConsent']>[0]) {
    const row = { id: makeId('cns'), ...input, proof: input.proof ?? {}, captured_at: input.captured_at ?? nowIso(), created_at: nowIso() }
    this.db.prepare(`INSERT INTO consent_events (id,brand_id,contact_id,channel,purpose,status,source,legal_basis,policy_version,proof,captured_at,expires_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(row.id, row.brand_id, row.contact_id, row.channel, row.purpose, row.status, row.source, row.legal_basis, row.policy_version, json(row.proof), row.captured_at, row.expires_at ?? null, row.created_at)
    return row
  }

  async registerDevice(input: Parameters<MultiChannelStore['registerDevice']>[0]) {
    const id = makeId('dev'), timestamp = nowIso()
    this.db.prepare(`INSERT INTO contact_devices (id,brand_id,contact_id,platform,provider,token,endpoint,subscription,app_id,status,last_seen_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,'active',?,?,?) ON CONFLICT(brand_id,provider,endpoint) DO UPDATE SET subscription=excluded.subscription,status='active',last_seen_at=excluded.last_seen_at,updated_at=excluded.updated_at`).run(id, input.brand_id, input.contact_id, input.platform, input.provider, input.token ?? null, input.endpoint ?? null, json(input.subscription), input.app_id ?? null, timestamp, timestamp, timestamp)
    return { id, ...input, active: true, last_seen_at: timestamp }
  }

  async listCampaigns(brandId: string) {
    return (this.db.prepare('SELECT * FROM channel_campaigns WHERE brand_id=? ORDER BY updated_at DESC').all(brandId) as Record<string, unknown>[]).map(mapCampaign)
  }

  async getCampaign(brandId: string, campaignId: string) {
    const row = this.db.prepare('SELECT * FROM channel_campaigns WHERE brand_id=? AND id=?').get(brandId, campaignId) as Record<string, unknown> | undefined
    return row ? mapCampaign(row) : undefined
  }

  async createCampaign(input: CampaignInput) {
    const id = makeId('mcp'), timestamp = nowIso()
    const audience = input.audience ?? {}
    this.db.prepare(`INSERT INTO channel_campaigns (id,brand_id,channel,name,purpose,sender_identity_id,content,status,timezone,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'draft','Europe/Paris',?,?)`).run(id, input.brand_id, input.channel, input.name, input.purpose, input.sender_identity_id ?? null, json({ ...input.content, audience, tracking_policy: input.tracking_policy ?? {} }), timestamp, timestamp)
    for (const listId of audience.list_ids ?? []) this.db.prepare(`INSERT INTO channel_campaign_targets (id,campaign_id,kind,target_id,mode) VALUES (?,?, 'list',?,'include')`).run(makeId('mct'), id, listId)
    return (await this.getCampaign(input.brand_id, id))!
  }

  async updateCampaignState(brandId: string, campaignId: string, state: string, scheduledAt?: string) {
    const timestamp = nowIso()
    this.db.prepare(`UPDATE channel_campaigns SET status=?,scheduled_at=?,started_at=CASE WHEN ?='sending' THEN COALESCE(started_at,?) ELSE started_at END,completed_at=CASE WHEN ? IN ('sent','canceled') THEN ? ELSE completed_at END,updated_at=? WHERE brand_id=? AND id=?`).run(state, scheduledAt ?? null, state, timestamp, state, timestamp, timestamp, brandId, campaignId)
    return this.getCampaign(brandId, campaignId)
  }

  async listConnections(brandId: string) {
    return (this.db.prepare(`SELECT id,brand_id,channel,provider,name,capabilities,status,is_default,last_tested_at,last_error,created_at,updated_at FROM channel_connections WHERE brand_id=? ORDER BY channel,name`).all(brandId) as Record<string, unknown>[]).map((row) => ({ ...row, capabilities: parse(row.capabilities, []) }))
  }

  async createConnection(input: Parameters<MultiChannelStore['createConnection']>[0]) {
    const id = makeId('cnn'), timestamp = nowIso()
    this.db.prepare(`INSERT INTO channel_connections (id,brand_id,channel,provider,name,encrypted_config,capabilities,status,is_default,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'unverified',?,?,?)`).run(id, input.brand_id, input.channel, input.provider, input.name, input.encrypted_config, json(input.capabilities ?? []), input.is_default ? 1 : 0, timestamp, timestamp)
    return (await this.getConnection(id))!
  }

  async getConnection(connectionId: string) {
    return this.db.prepare('SELECT * FROM channel_connections WHERE id=?').get(connectionId) as Record<string, unknown> | undefined
  }

  async updateConnectionTest(connectionId: string, ok: boolean, error?: string) {
    this.db.prepare(`UPDATE channel_connections SET status=?,last_tested_at=?,last_error=?,updated_at=? WHERE id=?`).run(ok ? 'active' : 'error', nowIso(), error ?? null, nowIso(), connectionId)
  }

  async listSenderIdentities(brandId: string, channel?: string) {
    const rows = channel ? this.db.prepare('SELECT * FROM sender_identities WHERE brand_id=? AND channel=? ORDER BY display_name,address').all(brandId, channel) : this.db.prepare('SELECT * FROM sender_identities WHERE brand_id=? ORDER BY channel,display_name,address').all(brandId)
    return (rows as Record<string, unknown>[]).map((row): Record<string, unknown> => ({ ...row, metadata: parse(row.metadata, {}) }))
  }

  async createSenderIdentity(input: Parameters<MultiChannelStore['createSenderIdentity']>[0]) {
    const id = makeId('snd'), timestamp = nowIso()
    this.db.prepare(`INSERT INTO sender_identities (id,connection_id,brand_id,channel,address,display_name,external_id,metadata,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id, input.connection_id, input.brand_id, input.channel, input.address, input.display_name ?? '', input.external_id ?? null, json(input.metadata), timestamp, timestamp)
    return (await this.listSenderIdentities(input.brand_id, input.channel)).find((item) => item.id === id)!
  }

  async replaceProviderTemplates(connectionId: string, brandId: string, channel: string, templates: Parameters<MultiChannelStore['replaceProviderTemplates']>[3]) {
    const statement = this.db.prepare(`INSERT INTO provider_templates (id,connection_id,brand_id,channel,external_id,name,language,status,category,content,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(connection_id,external_id,language) DO UPDATE SET name=excluded.name,status=excluded.status,category=excluded.category,content=excluded.content,updated_at=excluded.updated_at`)
    this.db.transaction(() => { for (const item of templates) statement.run(makeId('ptp'), connectionId, brandId, channel, item.external_id, item.name, item.language, item.status, item.category ?? null, json(item.content), nowIso()) })()
    return (this.db.prepare('SELECT * FROM provider_templates WHERE connection_id=? ORDER BY name,language').all(connectionId) as Record<string, unknown>[]).map((item) => ({ ...item, content: parse(item.content, {}) }))
  }

  async listConversations(brandId: string, filter = 'all', userId?: string) {
    const conditions = [`c.brand_id=?`], values: unknown[] = [brandId]
    if (filter === 'mine') { conditions.push('c.assigned_user_id=?'); values.push(userId ?? '') }
    if (filter === 'unassigned') conditions.push('c.assigned_user_id IS NULL')
    if (filter === 'unread') conditions.push('c.unread_count>0')
    if (filter === 'waiting') conditions.push("c.status='waiting'")
    if (filter === 'snoozed') conditions.push("c.status='snoozed'")
    const rows = this.db.prepare(`SELECT c.*,ct.display_name contact_name,COALESCE((SELECT value FROM contact_identifiers ci WHERE ci.contact_id=ct.id AND ci.is_primary=1 LIMIT 1),'') contact_address,COALESCE((SELECT body FROM conversation_messages m WHERE m.conversation_id=c.id ORDER BY m.created_at DESC LIMIT 1),'') preview FROM conversations c JOIN contacts ct ON ct.id=c.contact_id WHERE ${conditions.join(' AND ')} ORDER BY COALESCE(c.last_message_at,c.created_at) DESC LIMIT 250`).all(...values) as Record<string, unknown>[]
    return rows
  }

  async getConversation(brandId: string, conversationId: string): Promise<Record<string, unknown> | undefined> {
    const row = this.db.prepare(`SELECT c.*,ct.display_name contact_name,ct.locale contact_locale,ct.timezone contact_timezone FROM conversations c JOIN contacts ct ON ct.id=c.contact_id WHERE c.brand_id=? AND c.id=?`).get(brandId, conversationId) as Record<string, unknown> | undefined
    if (!row) return undefined
    const messages = this.db.prepare('SELECT * FROM conversation_messages WHERE conversation_id=? ORDER BY created_at').all(conversationId) as Record<string, unknown>[]
    const events = this.db.prepare('SELECT * FROM conversation_events WHERE conversation_id=? ORDER BY created_at').all(conversationId) as Record<string, unknown>[]
    const contact = await this.getContact(brandId, String(row.contact_id))
    return { ...row, contact, messages: messages.map((item) => ({ ...item, media: parse(item.media, []), metadata: parse(item.metadata, {}) })), events: events.map((item) => ({ ...item, payload: parse(item.payload, {}) })) }
  }

  async updateConversation(input: Parameters<MultiChannelStore['updateConversation']>[0]) {
    const current = await this.getConversation(input.brand_id, input.conversation_id)
    if (!current) return undefined
    const assigned = input.assigned_user_id === undefined ? current.assigned_user_id : input.assigned_user_id
    const status = input.status ?? current.status
    const snoozed = input.snoozed_until === undefined ? current.snoozed_until : input.snoozed_until
    this.db.prepare(`UPDATE conversations SET assigned_user_id=?,status=?,snoozed_until=?,updated_at=? WHERE brand_id=? AND id=?`).run(assigned, status, snoozed, nowIso(), input.brand_id, input.conversation_id)
    this.db.prepare(`INSERT INTO conversation_events (id,conversation_id,brand_id,type,actor_user_id,payload,created_at) VALUES (?,?,?,?,?,?,?)`).run(makeId('cve'), input.conversation_id, input.brand_id, 'conversation.updated', input.actor_user_id ?? null, json({ assigned_user_id: assigned, status, snoozed_until: snoozed }), nowIso())
    return this.getConversation(input.brand_id, input.conversation_id)
  }

  async addMessage(input: Parameters<MultiChannelStore['addMessage']>[0]) {
    const id = makeId('msg'), timestamp = nowIso()
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO conversation_messages (id,conversation_id,brand_id,contact_id,channel,direction,kind,body,html,media,provider,provider_message_id,sender_user_id,status,metadata,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, input.conversation_id, input.brand_id, input.contact_id, input.channel, input.direction, input.kind ?? 'text', input.body, input.html ?? null, json(input.media ?? []), input.provider ?? null, input.provider_message_id ?? null, input.sender_user_id ?? null, input.status ?? 'sent', json(input.metadata), timestamp)
      const autoClaim = input.direction === 'outbound' && input.sender_user_id
      this.db.prepare(`UPDATE conversations SET last_channel=?,last_message_at=?,unread_count=CASE WHEN ?='inbound' THEN unread_count+1 ELSE 0 END,assigned_user_id=CASE WHEN ? AND assigned_user_id IS NULL THEN ? ELSE assigned_user_id END,first_responded_at=CASE WHEN ? AND first_responded_at IS NULL THEN ? ELSE first_responded_at END,status=CASE WHEN ?='outbound' THEN 'waiting' ELSE 'open' END,updated_at=? WHERE id=?`).run(input.channel, timestamp, input.direction, autoClaim ? 1 : 0, input.sender_user_id ?? null, autoClaim ? 1 : 0, timestamp, input.direction, timestamp, input.conversation_id)
    })()
    return { id, ...input, created_at: timestamp }
  }

  async ingestInbound(input: Parameters<MultiChannelStore['ingestInbound']>[0]) {
    const references = input.channel === 'email' ? [input.metadata?.in_reply_to, ...(Array.isArray(input.metadata?.references) ? input.metadata.references : input.metadata?.references ? [input.metadata.references] : [])].filter((value): value is string => typeof value === 'string' && !!value) : []
    let conversation: Record<string, unknown> | undefined
    for (const reference of references) {
      conversation = this.db.prepare(`SELECT c.* FROM conversations c JOIN conversation_messages m ON m.conversation_id=c.id WHERE c.brand_id=? AND c.status!='closed' AND (m.provider_message_id=? OR json_extract(m.metadata,'$.message_id')=?) ORDER BY c.last_message_at DESC LIMIT 1`).get(input.brand_id, reference, reference) as Record<string, unknown> | undefined
      if (conversation) break
    }
    if (!conversation && !references.length) conversation = this.db.prepare(`SELECT * FROM conversations WHERE brand_id=? AND contact_id=? AND status!='closed' ORDER BY last_message_at DESC LIMIT 1`).get(input.brand_id, input.contact_id) as Record<string, unknown> | undefined
    if (!conversation) {
      const id = makeId('cnv'), timestamp = nowIso()
      const policy = await this.getBrandPolicy(input.brand_id)
      this.db.prepare(`INSERT INTO conversations (id,brand_id,contact_id,status,unread_count,first_response_due_at,last_channel,last_message_at,created_at,updated_at) VALUES (?,?,?,'open',0,?,?,?,?,?)`).run(id, input.brand_id, input.contact_id, new Date(Date.now() + Number(policy?.first_response_sla_minutes ?? 15) * 60000).toISOString(), input.channel, timestamp, timestamp, timestamp)
      conversation = this.db.prepare('SELECT * FROM conversations WHERE id=?').get(id) as Record<string, unknown>
    }
    const message = await this.addMessage({ brand_id: input.brand_id, conversation_id: String(conversation.id), contact_id: input.contact_id, channel: input.channel, direction: 'inbound', body: input.body, html: input.html, media: input.media, provider: input.provider, provider_message_id: input.provider_message_id, status: 'delivered', metadata: { ...(input.metadata ?? {}), subject: input.subject } })
    return { conversation: (await this.getConversation(input.brand_id, String(conversation.id)))!, message }
  }

  async createDelivery(input: DeliveryInput) {
    const existing = this.db.prepare('SELECT * FROM channel_deliveries WHERE brand_id=? AND idempotency_key=?').get(input.brand_id, input.idempotency_key) as Record<string, unknown> | undefined
    if (existing) return { delivery: { ...existing, payload: parse(existing.payload, {}) }, duplicate: true }
    const id = makeId('dlv'), timestamp = nowIso()
    this.db.prepare(`INSERT INTO channel_deliveries (id,brand_id,campaign_id,automation_step_id,conversation_id,contact_id,channel,purpose,sender_identity_id,provider,idempotency_key,payload,status,queued_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'queued',?)`).run(id, input.brand_id, input.campaign_id ?? null, input.automation_step_id ?? null, input.conversation_id ?? null, input.contact_id, input.channel, input.purpose, input.sender_identity_id ?? null, input.provider, input.idempotency_key, json({ destination: input.destination, content: input.content }), timestamp)
    return { delivery: { id, ...input, status: 'queued', queued_at: timestamp }, duplicate: false }
  }

  async updateDelivery(deliveryId: string, state: DeliveryState, fields: Parameters<MultiChannelStore['updateDelivery']>[2] = {}) {
    const timeColumn: Record<DeliveryState, string | undefined> = { queued: undefined, accepted: 'accepted_at', sent: 'sent_at', delivered: 'delivered_at', read: 'read_at', failed: 'failed_at', canceled: 'failed_at' }
    const column = timeColumn[state]
    this.db.prepare(`UPDATE channel_deliveries SET status=?,provider_message_id=COALESCE(?,provider_message_id),error_code=?,error_message=?,cost=COALESCE(?,cost)${column ? `,${column}=?` : ''} WHERE id=?`).run(...(column ? [state, fields.provider_message_id ?? null, fields.error_code ?? null, fields.error_message ?? null, fields.cost ?? null, nowIso(), deliveryId] : [state, fields.provider_message_id ?? null, fields.error_code ?? null, fields.error_message ?? null, fields.cost ?? null, deliveryId]))
  }

  async findDeliveryByProviderMessage(provider: string, providerMessageId: string) {
    const row = this.db.prepare('SELECT * FROM channel_deliveries WHERE provider=? AND provider_message_id=?').get(provider, providerMessageId) as Record<string, unknown> | undefined
    return row ? { ...row, payload: parse(row.payload, {}) } : undefined
  }

  async saveProviderEvent(input: Parameters<MultiChannelStore['saveProviderEvent']>[0]) {
    const result = this.db.prepare(`INSERT OR IGNORE INTO multichannel_provider_events (id,connection_id,brand_id,provider,external_id,event_type,payload,signature_valid,received_at) VALUES (?,?,?,?,?,?,?,?,?)`).run(makeId('pev'), input.connection_id ?? null, input.brand_id ?? null, input.provider, input.external_id, input.event_type, json(input.payload), input.signature_valid ? 1 : 0, nowIso())
    return result.changes > 0
  }

  async addSuppression(input: Parameters<MultiChannelStore['addSuppression']>[0]) {
    this.db.prepare(`INSERT INTO channel_suppressions (id,brand_id,channel,normalized_identifier,reason,source,created_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(brand_id,channel,normalized_identifier) DO UPDATE SET reason=excluded.reason,source=excluded.source`).run(makeId('sup'), input.brand_id, input.channel, input.normalized_identifier, input.reason, input.source, nowIso())
    this.db.prepare(`UPDATE channel_deliveries SET status='canceled',error_code='SUPPRESSED',error_message='Consent withdrawn' WHERE brand_id=? AND channel=? AND status='queued' AND json_extract(payload,'$.destination')=?`).run(input.brand_id, input.channel, input.normalized_identifier)
  }

  async isSuppressed(brandId: string, channel: string, normalizedIdentifier: string) {
    return !!this.db.prepare('SELECT id FROM channel_suppressions WHERE brand_id=? AND channel=? AND normalized_identifier=?').get(brandId, channel, normalizedIdentifier)
  }

  private requestHash(body: unknown) { return createHash('sha256').update(json(body)).digest('hex') }

  async saveIdempotency(workspaceId: string, key: string, requestBody: unknown, status: number, responseBody: unknown) {
    this.db.prepare(`INSERT INTO idempotency_records (id,workspace_id,key,request_hash,response_status,response_body,expires_at,created_at) VALUES (?,?,?,?,?,?,?,?)`).run(makeId('idem'), workspaceId, key, this.requestHash(requestBody), status, json(responseBody), new Date(Date.now() + 86400000).toISOString(), nowIso())
  }

  async getIdempotency(workspaceId: string, key: string, requestBody: unknown) {
    const row = this.db.prepare('SELECT request_hash,response_status,response_body FROM idempotency_records WHERE workspace_id=? AND key=? AND expires_at>?').get(workspaceId, key, nowIso()) as { request_hash: string; response_status: number; response_body: string } | undefined
    if (!row) return undefined
    if (row.request_hash !== this.requestHash(requestBody)) throw Object.assign(new Error('Idempotency-Key was already used with a different request'), { code: 'IDEMPOTENCY_CONFLICT', status: 409 })
    return { status: row.response_status, body: parse(row.response_body, {}) }
  }

  async report(brandId: string, campaignId?: string) {
    const where = campaignId ? 'brand_id=? AND campaign_id=?' : 'brand_id=?'
    const values = campaignId ? [brandId, campaignId] : [brandId]
    const states = this.db.prepare(`SELECT channel,status,COUNT(*) count,COALESCE(SUM(cost),0) cost FROM channel_deliveries WHERE ${where} GROUP BY channel,status`).all(...values) as Array<{ channel: string; status: string; count: number; cost: number }>
    const inbox = this.db.prepare(`SELECT COUNT(*) conversations,SUM(CASE WHEN first_responded_at IS NOT NULL THEN 1 ELSE 0 END) responded,AVG(CASE WHEN first_responded_at IS NOT NULL THEN (julianday(first_responded_at)-julianday(created_at))*86400 END) avg_first_response_seconds FROM conversations WHERE brand_id=?`).get(brandId) as Record<string, unknown>
    const calls = this.db.prepare(`SELECT COUNT(*) calls,SUM(CASE WHEN answered_at IS NOT NULL THEN 1 ELSE 0 END) answered,SUM(CASE WHEN status='missed' THEN 1 ELSE 0 END) missed,AVG(duration_seconds) avg_duration_seconds FROM call_sessions WHERE brand_id=?`).get(brandId) as Record<string, unknown>
    return { delivery: states, inbox, calls }
  }

  async retentionSweep() {
    let providerEvents = 0, conversations = 0
    const brands = this.db.prepare('SELECT id,conversation_retention_days,provider_payload_retention_days FROM brands').all() as Array<{ id: string; conversation_retention_days: number; provider_payload_retention_days: number }>
    for (const brand of brands) {
      providerEvents += this.db.prepare(`DELETE FROM multichannel_provider_events WHERE brand_id=? AND received_at < datetime('now',?)`).run(brand.id, `-${brand.provider_payload_retention_days} days`).changes
      conversations += this.db.prepare(`DELETE FROM conversations WHERE brand_id=? AND status='closed' AND updated_at < datetime('now',?)`).run(brand.id, `-${brand.conversation_retention_days} days`).changes
    }
    this.db.prepare(`DELETE FROM idempotency_records WHERE expires_at<?`).run(nowIso())
    return { provider_events: providerEvents, conversations }
  }
}
