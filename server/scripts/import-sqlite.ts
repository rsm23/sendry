import { createHash } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import { dirname, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { config as loadEnv } from 'dotenv'
import { Pool, type PoolClient } from 'pg'
import { normalizeEmail } from '../multichannel/compliance'

loadEnv()
const args = new Map(process.argv.slice(2).map((value, index, all) => value.startsWith('--') ? [value, all[index + 1]?.startsWith('--') ? 'true' : all[index + 1] ?? 'true'] : ['', '']))
const sourcePath = resolve(args.get('--source') ?? process.env.DATABASE_PATH ?? './data/sendry.db')
const reportPath = resolve(args.get('--report') ?? './data/import-report.json')
const dryRun = args.has('--dry-run')
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl && !dryRun) throw new Error('DATABASE_URL is required unless --dry-run is used')
if (!existsSync(sourcePath)) throw new Error(`SQLite source not found: ${sourcePath}`)

const source = new Database(sourcePath, { readonly: true, fileMustExist: true })
source.pragma('query_only = ON')
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 2, application_name: 'sendry-sqlite-import' }) : undefined
const deterministic = (prefix: string, value: string) => `${prefix}_${createHash('sha256').update(value).digest('hex').slice(0, 32)}`
const rows = <T extends Record<string, unknown>>(table: string) => source.prepare(`SELECT * FROM ${table}`).all() as T[]
const tableExists = (table: string) => !!source.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(table)

const report: Record<string, unknown> = { version: 1, source: sourcePath, source_untouched: true, dry_run: dryRun, started_at: new Date().toISOString(), counts: {}, reconciliation: {}, media: { checked: 0, missing: [] as string[] }, warnings: [] as string[] }
const counts = report.counts as Record<string, number>

async function insertBase(client: PoolClient) {
  for (const workspace of rows<{ id: string; name: string; created_at: string; updated_at: string }>('workspaces')) await client.query(`INSERT INTO workspaces (id,name,created_at,updated_at) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO UPDATE SET name=excluded.name,updated_at=excluded.updated_at`, [workspace.id, workspace.name, workspace.created_at, workspace.updated_at])
  for (const user of rows<{ id: string; email: string; name: string; timezone: string; created_at: string }>('users')) await client.query(`INSERT INTO users (id,email,name,timezone,created_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO UPDATE SET email=excluded.email,name=excluded.name,timezone=excluded.timezone`, [user.id, user.email, user.name, user.timezone, user.created_at])
  for (const brand of rows<{ id: string; workspace_id: string; name: string; created_at: string; updated_at: string }>('brands')) await client.query(`INSERT INTO brands (id,workspace_id,name,created_at,updated_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO UPDATE SET name=excluded.name,updated_at=excluded.updated_at`, [brand.id, brand.workspace_id, brand.name, brand.created_at, brand.updated_at])
  for (const member of rows<{ brand_id: string; user_id: string; role: string; permissions: string }>('brand_members')) await client.query(`INSERT INTO brand_members (brand_id,user_id,role,permissions) VALUES ($1,$2,$3,$4) ON CONFLICT (brand_id,user_id) DO UPDATE SET role=excluded.role,permissions=excluded.permissions`, [member.brand_id, member.user_id, member.role, JSON.parse(member.permissions)])
}

async function importContacts(client?: PoolClient) {
  const lists = new Map(rows<{ id: string; brand_id: string }>('lists').map((item) => [item.id, item]))
  const subscribers = rows<{ id: string; list_id: string; name: string; email: string; status: string; custom_values: string; notes: string; source: string; consent: number; consent_at?: string; joined_at: string; updated_at: string }>('subscribers')
  const contactsByKey = new Map<string, { id: string; brandId: string; email: string; name: string; createdAt: string; updatedAt: string }>()
  for (const subscriber of subscribers) {
    const brandId = lists.get(subscriber.list_id)?.brand_id
    if (!brandId) continue
    const email = normalizeEmail(subscriber.email), key = `${brandId}:${email}`
    const existing = contactsByKey.get(key)
    if (existing) { if (!existing.name && subscriber.name) existing.name = subscriber.name; if (subscriber.updated_at > existing.updatedAt) existing.updatedAt = subscriber.updated_at }
    else contactsByKey.set(key, { id: deterministic('ctc', key), brandId, email, name: subscriber.name, createdAt: subscriber.joined_at, updatedAt: subscriber.updated_at })
  }
  counts.subscribers = subscribers.length
  counts.canonical_contacts = contactsByKey.size
  if (!client) return
  for (const contact of contactsByKey.values()) {
    await client.query(`INSERT INTO contacts (id,brand_id,display_name,locale,timezone,tags,custom_fields,created_at,updated_at) VALUES ($1,$2,$3,'en','Europe/Paris','[]','{}',$4,$5) ON CONFLICT (id) DO UPDATE SET display_name=excluded.display_name,updated_at=excluded.updated_at`, [contact.id, contact.brandId, contact.name, contact.createdAt, contact.updatedAt])
    await client.query(`INSERT INTO contact_identifiers (id,brand_id,contact_id,type,value,normalized_value,primary,created_at) VALUES ($1,$2,$3,'email',$4,$4,true,$5) ON CONFLICT (brand_id,type,normalized_value) DO UPDATE SET contact_id=excluded.contact_id,value=excluded.value`, [deterministic('cid', `${contact.brandId}:${contact.email}`), contact.brandId, contact.id, contact.email, contact.createdAt])
  }
  for (const subscriber of subscribers) {
    const list = lists.get(subscriber.list_id); if (!list) continue
    const contactId = contactsByKey.get(`${list.brand_id}:${normalizeEmail(subscriber.email)}`)!.id
    await client.query(`INSERT INTO audience_memberships (brand_id,contact_id,audience_id,status,custom_fields,joined_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (contact_id,audience_id) DO UPDATE SET status=excluded.status,custom_fields=excluded.custom_fields,updated_at=excluded.updated_at`, [list.brand_id, contactId, subscriber.list_id, subscriber.status, JSON.parse(subscriber.custom_values || '{}'), subscriber.joined_at, subscriber.updated_at])
    if (subscriber.consent) await client.query(`INSERT INTO consent_events (id,brand_id,contact_id,channel,purpose,action,legal_basis,source,policy_version,proof,captured_at) VALUES ($1,$2,$3,'email','marketing','granted','consent',$4,'legacy-import',$5,$6) ON CONFLICT (id) DO NOTHING`, [deterministic('cns', subscriber.id), list.brand_id, contactId, subscriber.source, { subscriber_id: subscriber.id, list_id: subscriber.list_id }, subscriber.consent_at ?? subscriber.joined_at])
  }
}

async function importCampaigns(client?: PoolClient) {
  const campaigns = rows<{ id: string; brand_id: string; label: string; subject: string; plain_text: string; html_text: string; status: string; scheduled_at?: string; started_at?: string; sent_at?: string; created_at: string; updated_at: string }>('campaigns')
  counts.email_campaigns = campaigns.length
  if (!client) return
  for (const campaign of campaigns) await client.query(`INSERT INTO channel_campaigns (id,brand_id,legacy_campaign_id,name,channel,purpose,content,audience,tracking_policy,status,scheduled_at,started_at,completed_at,created_at,updated_at) VALUES ($1,$2,$1,$3,'email','marketing',$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (id) DO UPDATE SET content=excluded.content,status=excluded.status,updated_at=excluded.updated_at`, [campaign.id, campaign.brand_id, campaign.label || campaign.subject, { channel: 'email', subject: campaign.subject, text: campaign.plain_text, html: campaign.html_text, attachments: [] }, { list_ids: rows<{ campaign_id: string; target_id: string; mode: string }>('campaign_targets').filter((item) => item.campaign_id === campaign.id && item.mode === 'include').map((item) => item.target_id) }, { opens: true, clicks: true }, campaign.status, campaign.scheduled_at ?? null, campaign.started_at ?? null, campaign.sent_at ?? null, campaign.created_at, campaign.updated_at])
}

function verifyMedia() {
  if (!tableExists('files')) return
  const media = rows<{ kind: string; storage_name?: string; name: string }>('files').filter((item) => item.kind === 'file')
  const state = report.media as { checked: number; missing: string[] }
  state.checked = media.length
  const uploadDir = resolve(process.env.UPLOAD_DIR ?? './data/uploads')
  for (const item of media) if (!item.storage_name || !existsSync(resolve(uploadDir, item.storage_name))) state.missing.push(item.name)
}

async function main() {
  verifyMedia()
  if (dryRun) { await importContacts(); await importCampaigns() }
  else {
    const client = await pool!.connect()
    try { await client.query('BEGIN'); await insertBase(client); await importContacts(client); await importCampaigns(client); await client.query('COMMIT') } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
    const checks = await Promise.all([
      pool!.query<{ count: string }>('SELECT COUNT(*) count FROM contacts'),
      pool!.query<{ count: string }>('SELECT COUNT(*) count FROM channel_campaigns'),
    ])
    ;(report.reconciliation as Record<string, unknown>).contacts = { expected: counts.canonical_contacts, actual: Number(checks[0].rows[0].count) }
    ;(report.reconciliation as Record<string, unknown>).campaigns = { expected: counts.email_campaigns, actual: Number(checks[1].rows[0].count) }
  }
  report.completed_at = new Date().toISOString()
  await fs.mkdir(dirname(reportPath), { recursive: true })
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify(report, null, 2))
}

main().finally(async () => { source.close(); await pool?.end() })
