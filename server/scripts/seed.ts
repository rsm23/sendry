import { config as loadEnv } from 'dotenv'
import { Pool, type PoolClient } from 'pg'
import { openDatabase, seedDatabase, type AppDatabase } from '../db'

type Row = Record<string, unknown>

loadEnv()

const parseJson = <T>(value: unknown, fallback: T): T => {
  if (typeof value !== 'string') return (value as T | undefined) ?? fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

const postgresJson = (value: unknown) => JSON.stringify(value)

const rows = <T extends Row>(db: AppDatabase, table: string) =>
  db.prepare(`SELECT * FROM ${table}`).all() as T[]

async function seedPostgres(db: AppDatabase, client: PoolClient) {
  const migrated = await client.query<{ table_name: string | null }>(
    "SELECT to_regclass('public.workspaces')::text AS table_name",
  )
  if (!migrated.rows[0]?.table_name) {
    throw new Error('PostgreSQL is not migrated. Run `pnpm db:migrate` before `pnpm db:seed`.')
  }

  for (const item of rows<Row>(db, 'workspaces')) {
    await client.query(
      `INSERT INTO workspaces (id,name,created_at,updated_at)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (id) DO UPDATE SET name=excluded.name,updated_at=excluded.updated_at`,
      [item.id, item.name, item.created_at, item.updated_at],
    )
  }

  for (const item of rows<Row>(db, 'users')) {
    await client.query(
      `INSERT INTO users (id,email,name,timezone,created_at)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (id) DO UPDATE SET email=excluded.email,name=excluded.name,timezone=excluded.timezone`,
      [item.id, item.email, item.name, item.timezone, item.created_at],
    )
  }

  for (const item of rows<Row>(db, 'brands')) {
    await client.query(
      `INSERT INTO brands
        (id,workspace_id,name,default_timezone,first_response_sla_minutes,
         conversation_retention_days,provider_payload_retention_days,allowed_origins,
         created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (id) DO UPDATE SET
         name=excluded.name,
         default_timezone=excluded.default_timezone,
         first_response_sla_minutes=excluded.first_response_sla_minutes,
         conversation_retention_days=excluded.conversation_retention_days,
         provider_payload_retention_days=excluded.provider_payload_retention_days,
         allowed_origins=excluded.allowed_origins,
         updated_at=excluded.updated_at`,
      [
        item.id,
        item.workspace_id,
        item.name,
        item.default_timezone ?? 'Europe/Paris',
        item.first_response_sla_minutes,
        item.conversation_retention_days,
        item.provider_payload_retention_days,
        postgresJson(parseJson(item.allowed_origins, [])),
        item.created_at,
        item.updated_at,
      ],
    )
  }

  for (const item of rows<Row>(db, 'brand_members')) {
    await client.query(
      `INSERT INTO brand_members (brand_id,user_id,role,permissions)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (brand_id,user_id) DO UPDATE SET role=excluded.role,permissions=excluded.permissions`,
      [item.brand_id, item.user_id, item.role, postgresJson(parseJson(item.permissions, []))],
    )
  }

  for (const item of rows<Row>(db, 'feature_flags')) {
    await client.query(
      `INSERT INTO feature_flags (brand_id,key,enabled,updated_at)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (brand_id,key) DO UPDATE SET enabled=excluded.enabled,updated_at=excluded.updated_at`,
      [item.brand_id, item.key, Boolean(item.enabled), item.updated_at],
    )
  }

  for (const item of rows<Row>(db, 'contacts')) {
    await client.query(
      `INSERT INTO contacts
        (id,brand_id,display_name,locale,timezone,custom_fields,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO UPDATE SET
         display_name=excluded.display_name,
         locale=excluded.locale,
         timezone=excluded.timezone,
         custom_fields=excluded.custom_fields,
         updated_at=excluded.updated_at`,
      [
        item.id,
        item.brand_id,
        item.display_name,
        item.locale,
        item.timezone,
        postgresJson(parseJson(item.attributes, {})),
        item.created_at,
        item.updated_at,
      ],
    )
  }

  for (const item of rows<Row>(db, 'contact_identifiers')) {
    await client.query(
      `INSERT INTO contact_identifiers
        (id,brand_id,contact_id,type,value,normalized_value,verified_at,"primary",created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO UPDATE SET
         value=excluded.value,
         normalized_value=excluded.normalized_value,
         verified_at=excluded.verified_at,
         "primary"=excluded."primary"`,
      [
        item.id,
        item.brand_id,
        item.contact_id,
        item.type,
        item.value,
        item.normalized_value,
        item.verified_at,
        Boolean(item.is_primary),
        item.created_at,
      ],
    )
  }

  for (const item of rows<Row>(db, 'consent_events')) {
    await client.query(
      `INSERT INTO consent_events
        (id,brand_id,contact_id,channel,purpose,action,legal_basis,source,policy_version,
         proof,captured_at,expires_at,withdrawal_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (id) DO UPDATE SET
         action=excluded.action,
         proof=excluded.proof,
         expires_at=excluded.expires_at,
         withdrawal_at=excluded.withdrawal_at`,
      [
        item.id,
        item.brand_id,
        item.contact_id,
        item.channel,
        item.purpose,
        item.status,
        item.legal_basis,
        item.source,
        item.policy_version,
        postgresJson(parseJson(item.proof, {})),
        item.captured_at,
        item.expires_at,
        ['withdrawn', 'objected'].includes(String(item.status)) ? item.captured_at : null,
      ],
    )
  }

  for (const item of rows<Row>(db, 'channel_connections')) {
    await client.query(
      `INSERT INTO channel_connections
        (id,brand_id,provider,channels,label,encrypted_credentials,status,is_default,
         last_tested_at,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (id) DO UPDATE SET
         provider=excluded.provider,
         channels=excluded.channels,
         label=excluded.label,
         encrypted_credentials=excluded.encrypted_credentials,
         status=excluded.status,
         is_default=excluded.is_default,
         last_tested_at=excluded.last_tested_at,
         updated_at=excluded.updated_at`,
      [
        item.id,
        item.brand_id,
        item.provider,
        postgresJson([item.channel]),
        item.name,
        item.encrypted_config,
        item.status,
        Boolean(item.is_default),
        item.last_tested_at,
        item.created_at,
        item.updated_at,
      ],
    )
  }

  for (const item of rows<Row>(db, 'sender_identities')) {
    await client.query(
      `INSERT INTO sender_identities
        (id,brand_id,connection_id,channel,label,address,metadata,verified,is_default,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (id) DO UPDATE SET
         label=excluded.label,
         address=excluded.address,
         metadata=excluded.metadata,
         verified=excluded.verified,
         is_default=excluded.is_default`,
      [
        item.id,
        item.brand_id,
        item.connection_id,
        item.channel,
        item.display_name,
        item.address,
        postgresJson(parseJson(item.metadata, {})),
        item.status === 'active',
        true,
        item.created_at,
      ],
    )
  }

  for (const item of rows<Row>(db, 'channel_campaigns')) {
    await client.query(
      `INSERT INTO channel_campaigns
        (id,brand_id,name,channel,purpose,sender_identity_id,content,audience,tracking_policy,
         status,scheduled_at,started_at,completed_at,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (id) DO UPDATE SET
         name=excluded.name,
         sender_identity_id=excluded.sender_identity_id,
         content=excluded.content,
         status=excluded.status,
         scheduled_at=excluded.scheduled_at,
         started_at=excluded.started_at,
         completed_at=excluded.completed_at,
         updated_at=excluded.updated_at`,
      [
        item.id,
        item.brand_id,
        item.name,
        item.channel,
        item.purpose,
        item.sender_identity_id,
        postgresJson(parseJson(item.content, {})),
        postgresJson({}),
        postgresJson({}),
        item.status,
        item.scheduled_at,
        item.started_at,
        item.completed_at,
        item.created_at,
        item.updated_at,
      ],
    )
  }

  for (const item of rows<Row>(db, 'conversations')) {
    await client.query(
      `INSERT INTO conversations
        (id,brand_id,contact_id,channel,state,assigned_user_id,unread_count,priority,
         snoozed_until,first_response_due_at,first_responded_at,last_message_at,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (id) DO UPDATE SET
         channel=excluded.channel,
         state=excluded.state,
         assigned_user_id=excluded.assigned_user_id,
         unread_count=excluded.unread_count,
         snoozed_until=excluded.snoozed_until,
         first_response_due_at=excluded.first_response_due_at,
         first_responded_at=excluded.first_responded_at,
         last_message_at=excluded.last_message_at`,
      [
        item.id,
        item.brand_id,
        item.contact_id,
        item.last_channel ?? 'chat',
        item.status,
        item.assigned_user_id,
        item.unread_count,
        item.priority,
        item.snoozed_until,
        item.first_response_due_at,
        item.first_responded_at,
        item.last_message_at,
        item.created_at,
      ],
    )
  }

  for (const item of rows<Row>(db, 'conversation_messages')) {
    const metadata = parseJson<Record<string, unknown>>(item.metadata, {})
    const references = Array.isArray(metadata.references)
      ? metadata.references.filter((value): value is string => typeof value === 'string')
      : []
    await client.query(
      `INSERT INTO messages
        (id,conversation_id,channel,direction,type,sender,body,html,attachments,
         provider_message_id,message_id_header,in_reply_to,"references",status,
         created_by_user_id,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT (id) DO UPDATE SET
         channel=excluded.channel,
         direction=excluded.direction,
         type=excluded.type,
         body=excluded.body,
         html=excluded.html,
         attachments=excluded.attachments,
         status=excluded.status`,
      [
        item.id,
        item.conversation_id,
        item.channel,
        item.direction,
        item.kind,
        item.sender_user_id ?? item.provider ?? '',
        item.body,
        item.html,
        postgresJson(parseJson(item.media, [])),
        item.provider_message_id,
        metadata.message_id ?? null,
        metadata.in_reply_to ?? null,
        postgresJson(references),
        item.status,
        item.sender_user_id,
        item.created_at,
      ],
    )
  }

  for (const item of rows<Row>(db, 'call_sessions')) {
    await client.query(
      `INSERT INTO call_events
        (id,brand_id,conversation_id,contact_id,provider_call_id,direction,"from","to",state,
         assigned_user_id,duration_seconds,metadata,started_at,answered_at,ended_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (id) DO UPDATE SET
         state=excluded.state,
         duration_seconds=excluded.duration_seconds,
         metadata=excluded.metadata,
         answered_at=excluded.answered_at,
         ended_at=excluded.ended_at`,
      [
        item.id,
        item.brand_id,
        item.conversation_id,
        item.contact_id,
        item.provider_call_id,
        item.direction,
        item.from_address,
        item.to_address,
        item.status,
        item.assigned_user_id,
        item.duration_seconds,
        postgresJson({ provider: item.provider, notes: item.notes }),
        item.started_at ?? item.created_at,
        item.answered_at,
        item.ended_at,
      ],
    )
  }

  await client.query(
    `INSERT INTO provider_templates
      (id,connection_id,brand_id,channel,external_id,name,language,status,category,content,updated_at)
     VALUES
      ('ptp_delivery_update','cnn_stream_whatsapp','brd_atlas','whatsapp',
       'delivery_update','delivery_update','en','approved','utility',
       '{"body":"Your Atlas order is on its way."}'::jsonb,now())
     ON CONFLICT (connection_id,external_id,language) DO UPDATE SET
       name=excluded.name,status=excluded.status,category=excluded.category,
       content=excluded.content,updated_at=now()`,
  )
}

async function main() {
  const db = openDatabase()
  seedDatabase(db)

  const legacy = {
    users: Number((db.prepare('SELECT COUNT(*) count FROM users').get() as { count: number }).count),
    brands: Number((db.prepare('SELECT COUNT(*) count FROM brands').get() as { count: number }).count),
    campaigns: Number((db.prepare('SELECT COUNT(*) count FROM campaigns').get() as { count: number }).count),
    contacts: Number((db.prepare('SELECT COUNT(*) count FROM contacts').get() as { count: number }).count),
  }

  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    console.log(JSON.stringify({ ok: true, legacy, postgres: 'skipped (DATABASE_URL is not set)' }))
    db.close()
    return
  }

  const pool = new Pool({ connectionString: databaseUrl, max: 2, application_name: 'sendry-demo-seed' })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await seedPostgres(db, client)
    await client.query('COMMIT')
    const result = await client.query<{ contacts: string; campaigns: string; conversations: string }>(
      `SELECT
        (SELECT COUNT(*) FROM contacts)::text contacts,
        (SELECT COUNT(*) FROM channel_campaigns)::text campaigns,
        (SELECT COUNT(*) FROM conversations)::text conversations`,
    )
    console.log(JSON.stringify({
      ok: true,
      legacy,
      postgres: {
        contacts: Number(result.rows[0].contacts),
        campaigns: Number(result.rows[0].campaigns),
        conversations: Number(result.rows[0].conversations),
      },
    }))
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
    await pool.end()
    db.close()
  }
}

await main()
