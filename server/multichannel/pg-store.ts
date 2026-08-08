import { createHash, randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { normalizeEmail, normalizePhone } from './compliance'
import type { CampaignInput, ContactInput, DeliveryInput, MultiChannelStore } from './store'
import type { DeliveryState } from './types'

const id = (prefix: string) => `${prefix}_${randomUUID().replaceAll('-', '')}`
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

export class PostgresMultiChannelStore implements MultiChannelStore {
  readonly kind = 'postgres' as const
  readonly pool: Pool

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: Number(process.env.PG_POOL_SIZE ?? 20), application_name: 'sendry-api' })
  }

  async close() { await this.pool.end() }

  async featureEnabled(brandId: string, key: string) {
    const { rows } = await this.pool.query<{ enabled: boolean }>('SELECT enabled FROM feature_flags WHERE brand_id=$1 AND key=$2', [brandId, key])
    return !!rows[0]?.enabled
  }

  async setFeatureFlag(brandId: string, key: string, enabled: boolean) {
    await this.pool.query(`INSERT INTO feature_flags (brand_id,key,enabled,updated_at) VALUES ($1,$2,$3,now()) ON CONFLICT (brand_id,key) DO UPDATE SET enabled=excluded.enabled,updated_at=now()`, [brandId, key, enabled])
  }

  async getBrandPolicy(brandId: string) {
    return (await this.pool.query<Record<string, unknown>>('SELECT first_response_sla_minutes,conversation_retention_days,provider_payload_retention_days,allowed_origins FROM brands WHERE id=$1', [brandId])).rows[0]
  }

  async updateBrandPolicy(brandId: string, policy: Parameters<MultiChannelStore['updateBrandPolicy']>[1]) {
    await this.pool.query(`UPDATE brands SET first_response_sla_minutes=COALESCE($1,first_response_sla_minutes),conversation_retention_days=COALESCE($2,conversation_retention_days),provider_payload_retention_days=COALESCE($3,provider_payload_retention_days),allowed_origins=COALESCE($4,allowed_origins),updated_at=now() WHERE id=$5`, [policy.first_response_sla_minutes ?? null, policy.conversation_retention_days ?? null, policy.provider_payload_retention_days ?? null, policy.allowed_origins ?? null, brandId])
    return this.getBrandPolicy(brandId)
  }

  async listContacts(brandId: string, query = '') {
    const { rows } = await this.pool.query<Record<string, unknown>>(`SELECT c.*,c.custom_fields attributes,COALESCE(jsonb_agg(jsonb_build_object('id',i.id,'type',i.type,'value',i.value,'normalized_value',i.normalized_value,'is_primary',i."primary")) FILTER (WHERE i.id IS NOT NULL),'[]') identifiers FROM contacts c LEFT JOIN contact_identifiers i ON i.contact_id=c.id WHERE c.brand_id=$1 AND c.deleted_at IS NULL AND ($2='' OR c.display_name ILIKE '%'||$2||'%' OR i.normalized_value ILIKE '%'||$2||'%') GROUP BY c.id ORDER BY c.updated_at DESC LIMIT 250`, [brandId, query])
    return rows
  }

  async createContact(input: ContactInput) {
    const identifiers = (input.identifiers ?? []).map((item) => ({ ...item, normalized: item.type === 'email' ? normalizeEmail(item.value) : normalizePhone(item.value) }))
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const email = identifiers.find((item) => item.type === 'email')
      if (email) {
        const existing = await client.query<{ id: string }>(`SELECT c.id FROM contacts c JOIN contact_identifiers i ON i.contact_id=c.id WHERE c.brand_id=$1 AND i.type='email' AND i.normalized_value=$2 FOR UPDATE`, [input.brand_id, email.normalized])
        if (existing.rows[0]) {
          for (const item of identifiers.filter((identifier) => identifier.type !== 'email')) {
            const conflict = await client.query<{ contact_id: string }>('SELECT contact_id FROM contact_identifiers WHERE brand_id=$1 AND type=$2 AND normalized_value=$3 AND contact_id<>$4', [input.brand_id, item.type, item.normalized, existing.rows[0].id])
            if (conflict.rows[0]) await client.query(`INSERT INTO contact_merge_suggestions (id,brand_id,source_contact_id,target_contact_id,reason,status,created_at) VALUES ($1,$2,$3,$4,$5,'pending',now()) ON CONFLICT (source_contact_id,target_contact_id) DO NOTHING`, [id('mrg'), input.brand_id, existing.rows[0].id, conflict.rows[0].contact_id, `Conflicting ${item.type}: ${item.normalized}`])
          }
          await client.query('COMMIT'); return (await this.getContact(input.brand_id, existing.rows[0].id))!
        }
      }
      const contactId = id('ctc')
      await client.query(`INSERT INTO contacts (id,brand_id,display_name,locale,timezone,tags,custom_fields,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,'[]',$6,now(),now())`, [contactId, input.brand_id, input.display_name ?? '', input.locale ?? 'en', input.timezone ?? 'Europe/Paris', input.attributes ?? {}])
      for (const [position, item] of identifiers.entries()) {
        const conflict = item.type === 'email' ? undefined : (await client.query<{ contact_id: string }>('SELECT contact_id FROM contact_identifiers WHERE brand_id=$1 AND type=$2 AND normalized_value=$3', [input.brand_id, item.type, item.normalized])).rows[0]
        if (conflict) await client.query(`INSERT INTO contact_merge_suggestions (id,brand_id,source_contact_id,target_contact_id,reason,status,created_at) VALUES ($1,$2,$3,$4,$5,'pending',now()) ON CONFLICT (source_contact_id,target_contact_id) DO NOTHING`, [id('mrg'), input.brand_id, contactId, conflict.contact_id, `Conflicting ${item.type}: ${item.normalized}`])
        else await client.query(`INSERT INTO contact_identifiers (id,brand_id,contact_id,type,value,normalized_value,"primary",created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,now())`, [id('cid'), input.brand_id, contactId, item.type, item.value, item.normalized, item.primary || position === 0])
      }
      await client.query('COMMIT')
      return (await this.getContact(input.brand_id, contactId))!
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
  }

  async getContact(brandId: string, contactId: string) {
    const { rows } = await this.pool.query<Record<string, unknown>>(`SELECT c.*,c.custom_fields attributes,COALESCE((SELECT jsonb_agg(jsonb_build_object('id',i.id,'type',i.type,'value',i.value,'normalized_value',i.normalized_value,'is_primary',i."primary")) FROM contact_identifiers i WHERE i.contact_id=c.id),'[]') identifiers,COALESCE((SELECT jsonb_agg(to_jsonb(e) || jsonb_build_object('status',e.action) ORDER BY e.captured_at DESC) FROM consent_events e WHERE e.contact_id=c.id),'[]') consents FROM contacts c WHERE c.brand_id=$1 AND c.id=$2 AND c.deleted_at IS NULL`, [brandId, contactId])
    return rows[0]
  }

  async updateContact(brandId: string, contactId: string, fields: Parameters<MultiChannelStore['updateContact']>[2]) {
    await this.pool.query(`UPDATE contacts SET display_name=COALESCE($1,display_name),locale=COALESCE($2,locale),timezone=COALESCE($3,timezone),custom_fields=COALESCE($4,custom_fields),updated_at=now() WHERE brand_id=$5 AND id=$6`, [fields.display_name ?? null, fields.locale ?? null, fields.timezone ?? null, fields.attributes ?? null, brandId, contactId])
    return this.getContact(brandId, contactId)
  }

  async exportContact(brandId: string, contactId: string) {
    const contact = await this.getContact(brandId, contactId)
    if (!contact) return undefined
    const conversations = await this.pool.query<Record<string, unknown>>('SELECT * FROM conversations WHERE brand_id=$1 AND contact_id=$2 ORDER BY created_at', [brandId, contactId])
    const messages = await this.pool.query<Record<string, unknown>>(`SELECT m.* FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.brand_id=$1 AND c.contact_id=$2 ORDER BY m.created_at`, [brandId, contactId])
    const calls = await this.pool.query<Record<string, unknown>>('SELECT * FROM call_events WHERE brand_id=$1 AND contact_id=$2 ORDER BY started_at', [brandId, contactId])
    const devices = await this.pool.query<Record<string, unknown>>('SELECT id,platform,origin,active,last_seen_at,created_at FROM contact_devices WHERE brand_id=$1 AND contact_id=$2', [brandId, contactId])
    return { contact, conversations: conversations.rows, messages: messages.rows, calls: calls.rows, devices: devices.rows }
  }

  async deleteContact(brandId: string, contactId: string) {
    const result = await this.pool.query<{ legal_hold: boolean }>('SELECT legal_hold FROM contacts WHERE brand_id=$1 AND id=$2', [brandId, contactId])
    if (!result.rows[0]) return { deleted: false, legal_hold: false }
    if (result.rows[0].legal_hold) return { deleted: false, legal_hold: true }
    await this.pool.query('DELETE FROM contacts WHERE brand_id=$1 AND id=$2', [brandId, contactId])
    return { deleted: true, legal_hold: false }
  }

  async listMergeSuggestions(brandId: string) {
    return (await this.pool.query<Record<string, unknown>>(`SELECT s.*,source.display_name source_name,target.display_name target_name FROM contact_merge_suggestions s JOIN contacts source ON source.id=s.source_contact_id JOIN contacts target ON target.id=s.target_contact_id WHERE s.brand_id=$1 ORDER BY s.created_at DESC`, [brandId])).rows
  }

  async resolveMergeSuggestion(brandId: string, suggestionId: string, action: 'merge' | 'reject') {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const result = await client.query<Record<string, unknown>>(`SELECT * FROM contact_merge_suggestions WHERE brand_id=$1 AND id=$2 AND status='pending' FOR UPDATE`, [brandId, suggestionId])
      const suggestion = result.rows[0]
      if (!suggestion) { await client.query('ROLLBACK'); return undefined }
      if (action === 'merge') {
        await client.query(`UPDATE contact_identifiers i SET contact_id=$1 WHERE contact_id=$2 AND NOT EXISTS (SELECT 1 FROM contact_identifiers x WHERE x.contact_id=$1 AND x.type=i.type AND x.normalized_value=i.normalized_value)`, [suggestion.target_contact_id, suggestion.source_contact_id])
        await client.query('UPDATE conversations SET contact_id=$1 WHERE contact_id=$2', [suggestion.target_contact_id, suggestion.source_contact_id])
        await client.query(`UPDATE contact_devices d SET contact_id=$1 WHERE contact_id=$2 AND NOT EXISTS (SELECT 1 FROM contact_devices x WHERE x.brand_id=d.brand_id AND x.endpoint=d.endpoint AND x.id<>d.id)`, [suggestion.target_contact_id, suggestion.source_contact_id])
        await client.query('DELETE FROM contacts WHERE id=$1', [suggestion.source_contact_id])
      } else await client.query(`UPDATE contact_merge_suggestions SET status='rejected',resolved_at=now() WHERE id=$1`, [suggestionId])
      await client.query('COMMIT')
      return { ...suggestion, status: action === 'merge' ? 'merged' : 'rejected' }
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
  }

  async recordConsent(input: Parameters<MultiChannelStore['recordConsent']>[0]) {
    const row = { id: id('cns'), ...input, captured_at: input.captured_at ?? new Date().toISOString() }
    await this.pool.query(`INSERT INTO consent_events (id,brand_id,contact_id,channel,purpose,action,legal_basis,source,policy_version,proof,captured_at,expires_at,withdrawal_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [row.id, row.brand_id, row.contact_id, row.channel, row.purpose, row.status, row.legal_basis, row.source, row.policy_version, row.proof ?? {}, row.captured_at, row.expires_at ?? null, ['withdrawn', 'objected'].includes(row.status) ? row.captured_at : null])
    return row
  }

  async registerDevice(input: Parameters<MultiChannelStore['registerDevice']>[0]) {
    const deviceId = id('dev'), endpoint = input.endpoint ?? input.token
    if (!endpoint) throw new Error('Device token or endpoint is required')
    const subscription = input.subscription ?? {}
    const keys = (subscription.keys as Record<string, string> | undefined) ?? {}
    const result = await this.pool.query<Record<string, unknown>>(`INSERT INTO contact_devices (id,brand_id,contact_id,platform,endpoint,token,public_key,auth_secret,origin,active,last_seen_at,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,now(),now()) ON CONFLICT (brand_id,endpoint) DO UPDATE SET contact_id=excluded.contact_id,token=excluded.token,public_key=excluded.public_key,auth_secret=excluded.auth_secret,origin=excluded.origin,active=true,last_seen_at=now() RETURNING *`, [deviceId, input.brand_id, input.contact_id, input.platform, endpoint, input.token ?? null, keys.p256dh ?? null, keys.auth ?? null, input.origin ?? null])
    return result.rows[0]
  }

  async listCampaigns(brandId: string) {
    return (await this.pool.query<Record<string, unknown>>('SELECT * FROM channel_campaigns WHERE brand_id=$1 ORDER BY updated_at DESC', [brandId])).rows
  }

  async getCampaign(brandId: string, campaignId: string) {
    return (await this.pool.query<Record<string, unknown>>('SELECT * FROM channel_campaigns WHERE brand_id=$1 AND id=$2', [brandId, campaignId])).rows[0]
  }

  async createCampaign(input: CampaignInput) {
    const campaignId = id('mcp')
    await this.pool.query(`INSERT INTO channel_campaigns (id,brand_id,name,channel,purpose,sender_identity_id,content,audience,tracking_policy,status,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'draft',now(),now())`, [campaignId, input.brand_id, input.name, input.channel, input.purpose, input.sender_identity_id ?? null, input.content, input.audience ?? {}, input.tracking_policy ?? {}])
    return (await this.getCampaign(input.brand_id, campaignId))!
  }

  async updateCampaignState(brandId: string, campaignId: string, state: string, scheduledAt?: string) {
    await this.pool.query(`UPDATE channel_campaigns SET status=$1,scheduled_at=$2,started_at=CASE WHEN $1='sending' THEN COALESCE(started_at,now()) ELSE started_at END,completed_at=CASE WHEN $1 IN ('sent','canceled') THEN now() ELSE completed_at END,updated_at=now() WHERE brand_id=$3 AND id=$4`, [state, scheduledAt ?? null, brandId, campaignId])
    return this.getCampaign(brandId, campaignId)
  }

  async listConnections(brandId: string) {
    return (await this.pool.query<Record<string, unknown>>(`SELECT id,brand_id,provider,channels,channels->>0 AS channel,label AS name,status,is_default,last_tested_at,created_at,updated_at FROM channel_connections WHERE brand_id=$1 ORDER BY label`, [brandId])).rows
  }

  async createConnection(input: Parameters<MultiChannelStore['createConnection']>[0]) {
    const connectionId = id('cnn')
    await this.pool.query(`INSERT INTO channel_connections (id,brand_id,provider,channels,label,encrypted_credentials,status,is_default,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,'pending',$7,now(),now())`, [connectionId, input.brand_id, input.provider, JSON.stringify([input.channel]), input.name, input.encrypted_config, !!input.is_default])
    return (await this.getConnection(connectionId))!
  }

  async getConnection(connectionId: string) {
    return (await this.pool.query<Record<string, unknown>>(`SELECT *,channels->>0 AS channel,encrypted_credentials AS encrypted_config,label AS name FROM channel_connections WHERE id=$1`, [connectionId])).rows[0]
  }

  async updateConnectionTest(connectionId: string, ok: boolean, error?: string) {
    await this.pool.query(`UPDATE channel_connections SET status=$1,last_tested_at=now(),updated_at=now() WHERE id=$2`, [ok ? 'active' : `error:${(error ?? 'connection failed').slice(0, 160)}`, connectionId])
  }

  async listSenderIdentities(brandId: string, channel?: string) {
    return (await this.pool.query<Record<string, unknown>>(`SELECT id,brand_id,connection_id,channel,label AS display_name,address,metadata,verified,CASE WHEN verified THEN 'active' ELSE 'pending' END AS status,is_default,created_at FROM sender_identities WHERE brand_id=$1 ${channel ? 'AND channel=$2' : ''} ORDER BY channel,label`, channel ? [brandId, channel] : [brandId])).rows
  }

  async createSenderIdentity(input: Parameters<MultiChannelStore['createSenderIdentity']>[0]) {
    const senderId = id('snd')
    await this.pool.query(`INSERT INTO sender_identities (id,brand_id,connection_id,channel,label,address,metadata,verified,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,false,now())`, [senderId, input.brand_id, input.connection_id, input.channel, input.display_name ?? input.address, input.address, { ...(input.metadata ?? {}), external_id: input.external_id }])
    return (await this.listSenderIdentities(input.brand_id, input.channel)).find((item) => item.id === senderId)!
  }

  async replaceProviderTemplates(connectionId: string, brandId: string, channel: string, templates: Parameters<MultiChannelStore['replaceProviderTemplates']>[3]) {
    const client = await this.pool.connect()
    try { await client.query('BEGIN'); for (const item of templates) await client.query(`INSERT INTO provider_templates (id,connection_id,brand_id,channel,external_id,name,language,status,category,content,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now()) ON CONFLICT (connection_id,external_id,language) DO UPDATE SET name=excluded.name,status=excluded.status,category=excluded.category,content=excluded.content,updated_at=now()`, [id('ptp'), connectionId, brandId, channel, item.external_id, item.name, item.language, item.status, item.category ?? null, item.content]); await client.query('COMMIT') } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
    return (await this.pool.query<Record<string, unknown>>('SELECT * FROM provider_templates WHERE connection_id=$1 ORDER BY name,language', [connectionId])).rows
  }

  async listConversations(brandId: string, filter = 'all', userId?: string) {
    const conditions = ['c.brand_id=$1'], values: unknown[] = [brandId]
    if (filter === 'mine') { values.push(userId ?? ''); conditions.push(`c.assigned_user_id=$${values.length}`) }
    if (filter === 'unassigned') conditions.push('c.assigned_user_id IS NULL')
    if (filter === 'unread') conditions.push('c.unread_count>0')
    if (filter === 'waiting') conditions.push("c.state='waiting'")
    if (filter === 'snoozed') conditions.push("c.state='snoozed'")
    return (await this.pool.query<Record<string, unknown>>(`SELECT c.*,c.state status,c.channel last_channel,ct.display_name contact_name,COALESCE((SELECT value FROM contact_identifiers i WHERE i.contact_id=ct.id AND i."primary" LIMIT 1),'') contact_address,COALESCE((SELECT body FROM messages m WHERE m.conversation_id=c.id ORDER BY m.created_at DESC LIMIT 1),'') preview FROM conversations c JOIN contacts ct ON ct.id=c.contact_id WHERE ${conditions.join(' AND ')} ORDER BY c.last_message_at DESC LIMIT 250`, values)).rows
  }

  async getConversation(brandId: string, conversationId: string) {
    const result = await this.pool.query<Record<string, unknown>>(`SELECT c.*,c.state status,c.channel last_channel,ct.display_name contact_name,ct.locale contact_locale,ct.timezone contact_timezone FROM conversations c JOIN contacts ct ON ct.id=c.contact_id WHERE c.brand_id=$1 AND c.id=$2`, [brandId, conversationId])
    if (!result.rows[0]) return undefined
    const [messages, contact] = await Promise.all([this.pool.query<Record<string, unknown>>('SELECT *,type kind,attachments media,created_by_user_id sender_user_id FROM messages WHERE conversation_id=$1 ORDER BY created_at', [conversationId]), this.getContact(brandId, String(result.rows[0].contact_id))])
    return { ...result.rows[0], contact, messages: messages.rows, events: [] }
  }

  async updateConversation(input: Parameters<MultiChannelStore['updateConversation']>[0]) {
    await this.pool.query(`UPDATE conversations SET assigned_user_id=COALESCE($1,assigned_user_id),state=COALESCE($2::conversation_state,state),snoozed_until=$3 WHERE brand_id=$4 AND id=$5`, [input.assigned_user_id ?? null, input.status ?? null, input.snoozed_until ?? null, input.brand_id, input.conversation_id])
    return this.getConversation(input.brand_id, input.conversation_id)
  }

  async addMessage(input: Parameters<MultiChannelStore['addMessage']>[0]) {
    const messageId = id('msg'), createdAt = new Date().toISOString()
    const metadata = input.metadata ?? {}
    const references = Array.isArray(metadata.references) ? metadata.references.filter((value): value is string => typeof value === 'string') : typeof metadata.references === 'string' ? [metadata.references] : []
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(`INSERT INTO messages (id,conversation_id,channel,direction,type,sender,body,html,attachments,provider_message_id,message_id_header,in_reply_to,"references",status,created_by_user_id,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`, [messageId, input.conversation_id, input.channel, input.direction, input.kind ?? 'message', input.sender_user_id ?? input.provider ?? '', input.body, input.html ?? null, JSON.stringify(input.media ?? []), input.provider_message_id ?? null, typeof metadata.message_id === 'string' ? metadata.message_id : null, typeof metadata.in_reply_to === 'string' ? metadata.in_reply_to : null, JSON.stringify(references), input.status ?? 'sent', input.sender_user_id ?? null, createdAt])
      await client.query(`UPDATE conversations SET channel=$1,last_message_at=$2,unread_count=CASE WHEN $3='inbound' THEN unread_count+1 ELSE 0 END,assigned_user_id=CASE WHEN $3='outbound' AND assigned_user_id IS NULL THEN $4 ELSE assigned_user_id END,first_responded_at=CASE WHEN $3='outbound' AND first_responded_at IS NULL THEN $2 ELSE first_responded_at END,state=CASE WHEN $3='outbound' THEN 'waiting'::conversation_state ELSE 'open'::conversation_state END WHERE id=$5`, [input.channel, createdAt, input.direction, input.sender_user_id ?? null, input.conversation_id])
      await client.query('COMMIT')
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
    return { id: messageId, ...input, created_at: createdAt }
  }

  async ingestInbound(input: Parameters<MultiChannelStore['ingestInbound']>[0]) {
    const references = input.channel === 'email' ? [input.metadata?.in_reply_to, ...(Array.isArray(input.metadata?.references) ? input.metadata.references : input.metadata?.references ? [input.metadata.references] : [])].filter((value): value is string => typeof value === 'string' && !!value) : []
    let conversation = references.length ? (await this.pool.query<Record<string, unknown>>(`SELECT c.* FROM conversations c JOIN messages m ON m.conversation_id=c.id WHERE c.brand_id=$1 AND c.state!='closed' AND (m.message_id_header=ANY($2::text[]) OR m.provider_message_id=ANY($2::text[])) ORDER BY c.last_message_at DESC LIMIT 1`, [input.brand_id, references])).rows[0] : (await this.pool.query<Record<string, unknown>>(`SELECT * FROM conversations WHERE brand_id=$1 AND contact_id=$2 AND state!='closed' ORDER BY last_message_at DESC LIMIT 1`, [input.brand_id, input.contact_id])).rows[0]
    if (!conversation) {
      const conversationId = id('cnv')
      const result = await this.pool.query<Record<string, unknown>>(`INSERT INTO conversations (id,brand_id,contact_id,channel,state,subject,unread_count,first_response_due_at,last_message_at,created_at) VALUES ($1,$2,$3,$4,'open',$5,0,now()+(SELECT first_response_sla_minutes * interval '1 minute' FROM brands WHERE id=$2),now(),now()) RETURNING *`, [conversationId, input.brand_id, input.contact_id, input.channel, input.subject ?? ''])
      conversation = result.rows[0]
    }
    const message = await this.addMessage({ brand_id: input.brand_id, conversation_id: String(conversation.id), contact_id: input.contact_id, channel: input.channel, direction: 'inbound', body: input.body, html: input.html, media: input.media, provider: input.provider, provider_message_id: input.provider_message_id, status: 'delivered', metadata: input.metadata })
    return { conversation: (await this.getConversation(input.brand_id, String(conversation.id)))!, message }
  }

  async createDelivery(input: DeliveryInput) {
    const deliveryId = id('dlv')
    const result = await this.pool.query<Record<string, unknown>>(`INSERT INTO deliveries (id,brand_id,campaign_id,automation_step_id,contact_id,sender_identity_id,channel,purpose,destination,content,state,idempotency_key,provider,queued_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'queued',$11,$12,now()) ON CONFLICT (brand_id,idempotency_key) DO NOTHING RETURNING *`, [deliveryId, input.brand_id, input.campaign_id ?? null, input.automation_step_id ?? null, input.contact_id, input.sender_identity_id ?? null, input.channel, input.purpose, input.destination, input.content, input.idempotency_key, input.provider])
    if (result.rows[0]) return { delivery: result.rows[0], duplicate: false }
    const existing = await this.pool.query<Record<string, unknown>>('SELECT * FROM deliveries WHERE brand_id=$1 AND idempotency_key=$2', [input.brand_id, input.idempotency_key])
    return { delivery: existing.rows[0], duplicate: true }
  }

  async updateDelivery(deliveryId: string, state: DeliveryState, fields: Parameters<MultiChannelStore['updateDelivery']>[2] = {}) {
    const timestampColumn: Partial<Record<DeliveryState, string>> = { accepted: 'accepted_at', sent: 'sent_at', delivered: 'delivered_at', read: 'read_at', failed: 'failed_at', canceled: 'failed_at' }
    const column = timestampColumn[state]
    await this.pool.query(`UPDATE deliveries SET state=$1,provider_message_id=COALESCE($2,provider_message_id),error_code=$3,error=$4,cost_micros=COALESCE($5,cost_micros)${column ? `,${column}=now()` : ''} WHERE id=$6`, [state, fields.provider_message_id ?? null, fields.error_code ?? null, fields.error_message ?? null, fields.cost == null ? null : Math.round(fields.cost * 1_000_000), deliveryId])
  }

  async findDeliveryByProviderMessage(provider: string, providerMessageId: string) {
    return (await this.pool.query<Record<string, unknown>>('SELECT * FROM deliveries WHERE provider=$1 AND provider_message_id=$2', [provider, providerMessageId])).rows[0]
  }

  async saveProviderEvent(input: Parameters<MultiChannelStore['saveProviderEvent']>[0]) {
    const result = await this.pool.query(`INSERT INTO provider_events (id,provider,event_id,brand_id,kind,payload,received_at) VALUES ($1,$2,$3,$4,$5,$6,now()) ON CONFLICT (provider,event_id) DO NOTHING`, [id('pev'), input.provider, `${input.external_id}:${input.event_type}`, input.brand_id ?? null, input.event_type, input.payload])
    return result.rowCount === 1
  }

  async addSuppression(input: Parameters<MultiChannelStore['addSuppression']>[0]) {
    await this.pool.query(`INSERT INTO channel_suppressions (id,brand_id,channel,normalized_identifier,reason,created_at) VALUES ($1,$2,$3,$4,$5,now()) ON CONFLICT (brand_id,channel,normalized_identifier) DO UPDATE SET reason=excluded.reason`, [id('sup'), input.brand_id, input.channel, input.normalized_identifier, `${input.reason}:${input.source}`])
    await this.pool.query(`UPDATE deliveries SET state='canceled',error_code='SUPPRESSED',error='Consent withdrawn',failed_at=now() WHERE brand_id=$1 AND channel=$2 AND destination=$3 AND state='queued'`, [input.brand_id, input.channel, input.normalized_identifier])
  }

  async isSuppressed(brandId: string, channel: string, normalizedIdentifier: string) {
    return !!(await this.pool.query('SELECT 1 FROM channel_suppressions WHERE brand_id=$1 AND channel=$2 AND normalized_identifier=$3', [brandId, channel, normalizedIdentifier])).rows[0]
  }

  async saveIdempotency(workspaceId: string, key: string, requestBody: unknown, status: number, responseBody: unknown) {
    await this.pool.query(`INSERT INTO idempotency_records (brand_id,key,request_hash,status_code,response,expires_at,created_at) SELECT b.id,$2,$3,$4,$5,now()+interval '24 hours',now() FROM brands b WHERE b.workspace_id=$1 LIMIT 1`, [workspaceId, key, hash(requestBody), status, responseBody])
  }

  async getIdempotency(workspaceId: string, key: string, requestBody: unknown) {
    const result = await this.pool.query<{ request_hash: string; status_code: number; response: unknown }>(`SELECT i.request_hash,i.status_code,i.response FROM idempotency_records i JOIN brands b ON b.id=i.brand_id WHERE b.workspace_id=$1 AND i.key=$2 AND i.expires_at>now()`, [workspaceId, key])
    if (!result.rows[0]) return undefined
    if (result.rows[0].request_hash !== hash(requestBody)) throw Object.assign(new Error('Idempotency-Key was already used with a different request'), { code: 'IDEMPOTENCY_CONFLICT', status: 409 })
    return { status: result.rows[0].status_code, body: result.rows[0].response }
  }

  async report(brandId: string, campaignId?: string) {
    const delivery = await this.pool.query<Record<string, unknown>>(`SELECT channel,state status,COUNT(*)::int count,COALESCE(SUM(cost_micros),0)::bigint cost_micros FROM deliveries WHERE brand_id=$1 ${campaignId ? 'AND campaign_id=$2' : ''} GROUP BY channel,state`, campaignId ? [brandId, campaignId] : [brandId])
    const inbox = await this.pool.query<Record<string, unknown>>(`SELECT COUNT(*)::int conversations,COUNT(first_responded_at)::int responded,AVG(EXTRACT(EPOCH FROM first_responded_at-created_at)) avg_first_response_seconds FROM conversations WHERE brand_id=$1`, [brandId])
    const calls = await this.pool.query<Record<string, unknown>>(`SELECT COUNT(*)::int calls,COUNT(answered_at)::int answered,COUNT(*) FILTER (WHERE state='missed')::int missed,AVG(duration_seconds) avg_duration_seconds FROM call_events WHERE brand_id=$1`, [brandId])
    return { delivery: delivery.rows, inbox: inbox.rows[0], calls: calls.rows[0] }
  }

  async retentionSweep() {
    const provider = await this.pool.query(`DELETE FROM provider_events p WHERE p.received_at < now() - interval '1 day' * COALESCE((SELECT provider_payload_retention_days FROM brands b WHERE b.id=p.brand_id),30)`)
    const conversations = await this.pool.query(`DELETE FROM conversations c USING brands b WHERE c.brand_id=b.id AND c.state='closed' AND c.last_message_at < now() - interval '1 day' * b.conversation_retention_days AND NOT EXISTS (SELECT 1 FROM contacts ct WHERE ct.id=c.contact_id AND ct.legal_hold)`)
    await this.pool.query('DELETE FROM idempotency_records WHERE expires_at<now()')
    return { provider_events: provider.rowCount ?? 0, conversations: conversations.rowCount ?? 0 }
  }
}
