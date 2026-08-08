import { randomUUID } from 'node:crypto'
import { basename, join } from 'node:path'
import { load } from 'cheerio'
import type { AppConfig } from './config'
import type { AppDatabase } from './db'
import { sendMessage } from './mail'
import { segmentSubscribers } from './segments'
import { nowIso } from './serialize'
import { signToken } from './tokens'
import type { MultiChannelRuntime } from './multichannel/runtime'
import { consentAllows } from './multichannel/compliance'
import type { CampaignChannel, ChannelContent, MessagePurpose } from './multichannel/types'

type Job = { id: string; type: string; payload: string; attempts: number; max_attempts: number }

export function enqueueJob(db: AppDatabase, type: string, payload: Record<string, unknown>, runAt = nowIso()) {
  const id = randomUUID()
  db.prepare('INSERT INTO jobs (id,type,payload,status,run_at,created_at) VALUES (?,?,?,\'queued\',?,?)').run(id, type, JSON.stringify(payload), runAt, nowIso())
  return id
}

function mergeTags(content: string, subscriber: Record<string, unknown>, appUrl: string, secret: string, brandId: string) {
  const custom = JSON.parse(String(subscriber.custom_values ?? '{}')) as Record<string, unknown>
  const token = signToken({ subscriberId: subscriber.id, listId: subscriber.list_id, brandId }, secret)
  const replacements: Record<string, string> = {
    '[Name]': String(subscriber.name ?? ''),
    '[Email]': String(subscriber.email ?? ''),
    '[currentday]': new Intl.DateTimeFormat('en', { weekday: 'long' }).format(new Date()),
    '[currentmonth]': new Intl.DateTimeFormat('en', { month: 'long' }).format(new Date()),
    '[currentyear]': String(new Date().getFullYear()),
    '[unsubscribe]': `${appUrl}/public/unsubscribe?t=${encodeURIComponent(token)}`,
    '[preferences]': `${appUrl}/public/preferences?t=${encodeURIComponent(token)}`,
  }
  let output = content
  for (const [key, value] of Object.entries({ ...custom, ...replacements })) {
    output = output.replaceAll(key.startsWith('[') ? key : `[${key}]`, String(value ?? ''))
  }
  output = output.replace(/\[([^,\]]+),\s*fallback=([^\]]*)\]/g, (_, key: string, fallback: string) => String(custom[key] ?? subscriber[key] ?? fallback))
  return output
}

function instrumentCampaign(db: AppDatabase, appUrl: string, secret: string, campaign: Record<string, unknown>, subscriber: Record<string, unknown>, html: string) {
  const $ = load(html, null, false)
  const clickMode = String(campaign.clicks_tracking)
  const query = new URLSearchParams(String(campaign.query_string ?? '').replace(/^\?/, ''))
  $('a[href]').each((_index, element) => {
    const href = $(element).attr('href')
    if (!href || !/^https?:\/\//i.test(href) || href.startsWith(`${appUrl}/public/`)) return
    const url = new URL(href)
    for (const [key, value] of query) if (!url.searchParams.has(key)) url.searchParams.set(key, value)
    const finalUrl = url.toString()
    db.prepare('INSERT OR IGNORE INTO campaign_links (id,campaign_id,url,created_at) VALUES (?,?,?,?)').run(randomUUID(), campaign.id, finalUrl, nowIso())
    if (clickMode !== 'off') {
      const token = signToken({ campaignId: campaign.id, subscriberId: subscriber.id, anonymous: clickMode === 'anonymous', url: finalUrl }, secret, 365 * 86400)
      $(element).attr('href', `${appUrl}/track/click/${token}`)
    } else $(element).attr('href', finalUrl)
  })
  const openMode = String(campaign.opens_tracking)
  if (openMode !== 'off') {
    const token = signToken({ campaignId: campaign.id, subscriberId: subscriber.id, anonymous: openMode === 'anonymous', brandId: campaign.brand_id }, secret, 365 * 86400)
    $.root().append(`<img src="${appUrl}/track/open/${token}.gif" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0" />`)
  }
  return $.html()
}

function instrumentAutomation(appUrl: string, secret: string, step: Record<string, unknown>, subscriber: Record<string, unknown>, html: string, deliveryId: string) {
  const $ = load(html, null, false)
  const query = new URLSearchParams(String(step.query_string ?? '').replace(/^\?/, ''))
  $('a[href]').each((_index, element) => {
    const href = $(element).attr('href')
    if (!href || !/^https?:\/\//i.test(href) || href.startsWith(`${appUrl}/public/`)) return
    const url = new URL(href)
    for (const [key, value] of query) if (!url.searchParams.has(key)) url.searchParams.set(key, value)
    const finalUrl = url.toString()
    if (step.clicks_tracking !== 'off') {
      const token = signToken({ stepId: step.step_id, deliveryId, subscriberId: subscriber.subscriber_id, anonymous: step.clicks_tracking === 'anonymous', url: finalUrl }, secret, 365 * 86400)
      $(element).attr('href', `${appUrl}/track/automation/click/${token}`)
    } else $(element).attr('href', finalUrl)
  })
  if (step.opens_tracking !== 'off') {
    const token = signToken({ stepId: step.step_id, deliveryId, subscriberId: subscriber.subscriber_id, anonymous: step.opens_tracking === 'anonymous' }, secret, 365 * 86400)
    $.root().append(`<img src="${appUrl}/track/automation/open/${token}.gif" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0" />`)
  }
  return $.html()
}

function campaignRecipients(db: AppDatabase, campaignId: string) {
  const targets = db.prepare('SELECT * FROM campaign_targets WHERE campaign_id=?').all(campaignId) as Array<{ kind: string; target_id: string; mode: string }>
  const campaign = db.prepare('SELECT c.brand_id,b.consent_campaigns_only FROM campaigns c JOIN brands b ON b.id=c.brand_id WHERE c.id=?').get(campaignId) as { brand_id: string; consent_campaigns_only: number }
  const included = new Map<string, Record<string, unknown>>()
  const excluded = new Set<string>()
  for (const target of targets) {
    const owned = target.kind === 'segment'
      ? db.prepare('SELECT s.id FROM segments s JOIN lists l ON l.id=s.list_id WHERE s.id=? AND l.brand_id=?').get(target.target_id, campaign.brand_id)
      : db.prepare('SELECT id FROM lists WHERE id=? AND brand_id=?').get(target.target_id, campaign.brand_id)
    if (!owned) continue
    const rows = target.kind === 'segment'
      ? segmentSubscribers(db, target.target_id)
      : db.prepare(`SELECT * FROM subscribers WHERE list_id=? AND status='active'`).all(target.target_id) as Record<string, unknown>[]
    for (const row of rows) {
      if (target.mode === 'exclude') excluded.add(String(row.id))
      else included.set(String(row.id), row)
    }
  }
  if (!targets.some((target) => target.mode === 'include')) return []
  const blockedEmails = new Set((db.prepare('SELECT email FROM suppressions WHERE brand_id=?').all(campaign.brand_id) as Array<{ email: string }>).map((row) => row.email.toLowerCase()))
  const blockedDomains = new Set((db.prepare('SELECT domain FROM blocked_domains WHERE brand_id=?').all(campaign.brand_id) as Array<{ domain: string }>).map((row) => row.domain.toLowerCase()))
  return [...included.values()].filter((row) => !excluded.has(String(row.id)) && (!campaign.consent_campaigns_only || !!row.consent) && !blockedEmails.has(String(row.email).toLowerCase()) && !blockedDomains.has(String(row.email).split('@')[1]?.toLowerCase()))
}

export function estimateCampaign(db: AppDatabase, campaignId: string) {
  return campaignRecipients(db, campaignId).length
}

export function effectiveTracking<T extends Record<string, unknown>>(message: T, privacyMode: unknown): T {
  if (privacyMode !== 'anonymous') return message
  return {
    ...message,
    opens_tracking: message.opens_tracking === 'off' ? 'off' : 'anonymous',
    clicks_tracking: message.clicks_tracking === 'off' ? 'off' : 'anonymous',
  }
}

async function processCampaign(db: AppDatabase, config: AppConfig, campaignId: string) {
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id=?').get(campaignId) as Record<string, unknown> | undefined
  if (!campaign) throw new Error('Campaign not found')
  if (campaign.status === 'stopped') return
  const brand = db.prepare('SELECT * FROM brands WHERE id=?').get(campaign.brand_id) as Record<string, unknown>
  const trackedCampaign = effectiveTracking(campaign, brand.privacy_mode)
  const appUrl = brand.custom_domain_enabled && brand.custom_domain
    ? `${String(brand.custom_domain_protocol || 'https')}://${String(brand.custom_domain).replace(/^https?:\/\//, '').replace(/\/$/, '')}`
    : config.appUrl
  const recipients = campaignRecipients(db, campaignId)
  const attachmentIds = JSON.parse(String(campaign.attachments ?? '[]')) as string[]
  const attachmentRows = attachmentIds.length ? db.prepare(`SELECT name,storage_name FROM files WHERE brand_id=? AND kind='file' AND id IN (${attachmentIds.map(() => '?').join(',')})`).all(brand.id, ...attachmentIds) as Array<{ name: string; storage_name: string }> : []
  const attachments = attachmentRows.map((file) => ({ filename: file.name, path: join(config.uploadDir, basename(file.storage_name)) }))
  const remaining = Number(brand.monthly_limit) < 0 ? Number.POSITIVE_INFINITY : Math.max(0, Number(brand.monthly_limit) - Number(brand.current_usage))
  if (recipients.length > remaining) throw new Error(`Monthly allowance has ${remaining} messages remaining`)
  db.prepare(`UPDATE campaigns SET status='sending',started_at=COALESCE(started_at,?),total_recipients=?,error=NULL,updated_at=? WHERE id=?`).run(nowIso(), recipients.length, nowIso(), campaignId)
  enqueueJob(db, 'rules.trigger', { brandId: brand.id, trigger: 'campaign_started', campaignId })
  let delivered = Number(campaign.delivered ?? 0)
  let failed = Number(campaign.failed ?? 0)
  for (const subscriber of recipients) {
    const state = db.prepare('SELECT status FROM campaigns WHERE id=?').get(campaignId) as { status: string }
    if (state.status === 'stopped') break
    const existing = db.prepare(`SELECT id FROM campaign_events WHERE campaign_id=? AND subscriber_id=? AND type='delivered'`).get(campaignId, subscriber.id)
    if (existing) continue
    const unsubscribeToken = signToken({ subscriberId: subscriber.id, listId: subscriber.list_id, campaignId, brandId: brand.id }, config.sessionSecret)
    try {
      const subject = mergeTags(String(campaign.subject), subscriber, appUrl, config.sessionSecret, String(brand.id))
      const mergedHtml = mergeTags(String(campaign.html_text), subscriber, appUrl, config.sessionSecret, String(brand.id))
      const html = instrumentCampaign(db, appUrl, config.sessionSecret, trackedCampaign, subscriber, mergedHtml)
      const text = mergeTags(String(campaign.plain_text), subscriber, appUrl, config.sessionSecret, String(brand.id))
      const result = await sendMessage(config, brand as never, {
        to: String(subscriber.email), name: String(subscriber.name), subject, html, text,
        headers: {
          'List-Unsubscribe': `<${appUrl}/public/unsubscribe?t=${encodeURIComponent(unsubscribeToken)}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          'X-Sendry-Campaign': campaignId,
          'X-Sendry-Subscriber': String(subscriber.id),
        },
        attachments,
      })
      delivered += 1
      db.prepare('INSERT INTO campaign_events (id,campaign_id,subscriber_id,type,occurred_at,metadata) VALUES (?,?,?,?,?,?)').run(randomUUID(), campaignId, subscriber.id, 'delivered', nowIso(), JSON.stringify({ messageId: result.messageId, mode: result.mode }))
      db.prepare('UPDATE subscribers SET last_campaign_id=?,last_activity_at=?,updated_at=? WHERE id=?').run(campaignId, nowIso(), nowIso(), subscriber.id)
    } catch (error) {
      failed += 1
      db.prepare('INSERT INTO campaign_events (id,campaign_id,subscriber_id,type,occurred_at,metadata) VALUES (?,?,?,?,?,?)').run(randomUUID(), campaignId, subscriber.id, 'failed', nowIso(), JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
    }
    db.prepare('UPDATE campaigns SET delivered=?,failed=?,updated_at=? WHERE id=?').run(delivered, failed, nowIso(), campaignId)
  }
  const final = db.prepare('SELECT status FROM campaigns WHERE id=?').get(campaignId) as { status: string }
  if (final.status !== 'stopped') {
    db.prepare(`UPDATE campaigns SET status='sent',sent_at=?,updated_at=? WHERE id=?`).run(nowIso(), nowIso(), campaignId)
    db.prepare('UPDATE brands SET current_usage=current_usage+?,updated_at=? WHERE id=?').run(delivered, nowIso(), brand.id)
    enqueueJob(db, 'rules.trigger', { brandId: brand.id, trigger: 'campaign_sent', campaignId })
    if (brand.notify_campaign_sent) {
      const owner = db.prepare(`SELECT u.email,u.name FROM users u JOIN workspaces w ON w.owner_id=u.id WHERE w.id=?`).get(brand.workspace_id) as { email: string; name: string } | undefined
      if (owner) {
        try {
          await sendMessage(config, brand as never, {
            to: owner.email,
            name: owner.name,
            subject: `Delivery complete: ${String(campaign.subject)}`,
            html: `<h1>Campaign delivery complete</h1><p><strong>${String(campaign.subject)}</strong> finished with ${delivered} delivered and ${failed} failed messages.</p>`,
            text: `Campaign delivery complete: ${String(campaign.subject)}. ${delivered} delivered, ${failed} failed.`,
          })
        } catch { /* delivery reporting must not change campaign status */ }
      }
    }
  }
}

function offsetMs(value: number, unit: string) {
  const units: Record<string, number> = { minutes: 60000, hours: 3600000, days: 86400000, weeks: 604800000, months: 2629800000 }
  return value * (units[unit] ?? units.minutes)
}

function subscriberMatchesStep(db: AppDatabase, step: Record<string, unknown>, subscriberId: string) {
  const included = new Set((JSON.parse(String(step.segment_include ?? '[]')) as string[]).flatMap((segmentId) => segmentSubscribers(db, segmentId).map((row) => String(row.id))))
  const excluded = new Set((JSON.parse(String(step.segment_exclude ?? '[]')) as string[]).flatMap((segmentId) => segmentSubscribers(db, segmentId).map((row) => String(row.id))))
  return (!included.size || included.has(subscriberId)) && !excluded.has(subscriberId)
}

export function scheduleSubscriberAutomations(db: AppDatabase, subscriberId: string) {
  const subscriber = db.prepare('SELECT * FROM subscribers WHERE id=?').get(subscriberId) as Record<string, unknown> | undefined
  if (!subscriber || subscriber.status !== 'active') return 0
  const automations = db.prepare('SELECT * FROM automations WHERE list_id=? AND enabled=1').all(subscriber.list_id) as Record<string, unknown>[]
  let created = 0
  for (const automation of automations) {
    const steps = db.prepare('SELECT * FROM automation_steps WHERE automation_id=? AND enabled=1 ORDER BY position').all(automation.id) as Record<string, unknown>[]
    for (const step of steps) {
      if (!subscriberMatchesStep(db, step, subscriberId)) continue
      let base = new Date(String(subscriber.joined_at)).getTime()
      if (automation.type !== 'drip') {
        const field = db.prepare('SELECT name FROM custom_fields WHERE id=?').get(automation.date_field_id) as { name: string } | undefined
        const custom = JSON.parse(String(subscriber.custom_values ?? '{}')) as Record<string, unknown>
        const parsed = field ? new Date(String(custom[field.name] ?? '')) : new Date('invalid')
        if (Number.isNaN(parsed.getTime())) continue
        if (automation.type === 'annual') parsed.setFullYear(new Date().getFullYear())
        base = parsed.getTime()
      }
      const direction = step.offset_direction === 'before' ? -1 : 1
      const scheduledDate = new Date(base + direction * offsetMs(Number(step.offset_value), String(step.offset_unit)))
      if (automation.type === 'annual' && scheduledDate.getTime() < Date.now()) scheduledDate.setUTCFullYear(scheduledDate.getUTCFullYear() + 1)
      const scheduledAt = scheduledDate.toISOString()
      const result = db.prepare(`INSERT OR IGNORE INTO automation_deliveries (id,step_id,subscriber_id,status,scheduled_at) VALUES (?,?,?,?,?)`).run(randomUUID(), step.id, subscriberId, 'queued', scheduledAt)
      created += result.changes
    }
  }
  return created
}

async function processAutomationDelivery(db: AppDatabase, config: AppConfig, deliveryId: string, multiChannel?: MultiChannelRuntime) {
  const row = db.prepare(`SELECT d.*,s.name,s.email,s.status AS subscriber_status,s.custom_values,s.list_id,s.consent,a.id AS automation_id,a.type AS automation_type,a.list_id AS automation_list_id,
      st.subject,st.html_text,st.plain_text,st.from_name,st.from_email,st.reply_to,st.segment_include,st.segment_exclude,st.query_string,st.opens_tracking,st.clicks_tracking,st.channel,st.sender_identity_id,st.channel_payload,st.consent_purpose,st.tracking_policy,l.brand_id
      FROM automation_deliveries d JOIN subscribers s ON s.id=d.subscriber_id JOIN automation_steps st ON st.id=d.step_id
      JOIN automations a ON a.id=st.automation_id JOIN lists l ON l.id=a.list_id WHERE d.id=?`).get(deliveryId) as Record<string, unknown> | undefined
  if (!row || row.status !== 'queued') return
  const brand = db.prepare('SELECT * FROM brands WHERE id=?').get(row.brand_id) as Record<string, unknown>
  const blocked = db.prepare(`SELECT 1 FROM suppressions WHERE brand_id=? AND email=? COLLATE NOCASE UNION SELECT 1 FROM blocked_domains WHERE brand_id=? AND domain=? COLLATE NOCASE`).get(row.brand_id, row.email, row.brand_id, String(row.email).split('@')[1])
  if (row.subscriber_status !== 'active' || blocked || !subscriberMatchesStep(db, row, String(row.subscriber_id))) { db.prepare("UPDATE automation_deliveries SET status='skipped',error='Subscriber is not eligible' WHERE id=?").run(deliveryId); return }
  if (brand.consent_automations_only && !row.consent) { db.prepare("UPDATE automation_deliveries SET status='skipped',error='Consent is required' WHERE id=?").run(deliveryId); return }
  if (Number(brand.monthly_limit) >= 0 && Number(brand.current_usage) >= Number(brand.monthly_limit)) { db.prepare("UPDATE automation_deliveries SET status='skipped',error='Monthly allowance reached' WHERE id=?").run(deliveryId); return }
  const appUrl = brand.custom_domain_enabled && brand.custom_domain
    ? `${String(brand.custom_domain_protocol || 'https')}://${String(brand.custom_domain).replace(/^https?:\/\//, '').replace(/\/$/, '')}`
    : config.appUrl
  try {
    if (row.channel !== 'email') {
      if (!multiChannel) throw new Error('Multi-channel runtime is not available')
      const channel = String(row.channel) as CampaignChannel
      const contact = db.prepare(`SELECT c.* FROM contacts c JOIN contact_identifiers i ON i.contact_id=c.id WHERE c.brand_id=? AND i.type='email' AND i.normalized_value=? LIMIT 1`).get(row.brand_id, String(row.email).toLowerCase()) as Record<string, unknown> | undefined
      if (!contact) throw new Error('Subscriber has not been imported to a canonical contact')
      const purpose = String(row.consent_purpose ?? 'marketing') as MessagePurpose
      const consentEvent = db.prepare(`SELECT status,captured_at,expires_at FROM consent_events WHERE contact_id=? AND channel=? AND purpose=? ORDER BY captured_at DESC LIMIT 1`).get(contact.id, channel, purpose) as { status: string; captured_at: string; expires_at?: string } | undefined
      if (!consentAllows(consentEvent ? { granted: consentEvent.status === 'granted', withdrawnAt: ['withdrawn', 'objected'].includes(consentEvent.status) ? consentEvent.captured_at : null, expiresAt: consentEvent.expires_at } : undefined, channel, purpose)) throw new Error('Channel consent is required')
      let destination: string | undefined
      if (channel === 'push') destination = (db.prepare(`SELECT COALESCE(token,endpoint) destination FROM contact_devices WHERE contact_id=? AND status='active' ORDER BY last_seen_at DESC LIMIT 1`).get(contact.id) as { destination?: string } | undefined)?.destination
      else destination = (db.prepare(`SELECT normalized_value destination FROM contact_identifiers WHERE contact_id=? AND type=? ORDER BY is_primary DESC LIMIT 1`).get(contact.id, channel === 'whatsapp' ? 'whatsapp' : 'phone') as { destination?: string } | undefined)?.destination
      if (!destination) throw new Error(`Contact has no ${channel} destination`)
      if (await multiChannel.store.isSuppressed(String(row.brand_id), channel, destination)) throw new Error('Destination is suppressed')
      const senders = await multiChannel.store.listSenderIdentities(String(row.brand_id), channel)
      const sender = (row.sender_identity_id ? senders.find((item) => item.id === row.sender_identity_id) : undefined) ?? senders[0]
      if (!sender) throw new Error(`No ${channel} sender identity is configured`)
      const connection = await multiChannel.store.getConnection(String(sender.connection_id))
      if (!connection) throw new Error('Sender provider connection was removed')
      const rawPayload = JSON.parse(String(row.channel_payload || '{}')) as Record<string, unknown>
      const content = JSON.parse(mergeTags(JSON.stringify(rawPayload), row, appUrl, config.sessionSecret, String(row.brand_id))) as ChannelContent
      const result = await multiChannel.store.createDelivery({ brand_id: String(row.brand_id), contact_id: String(contact.id), automation_step_id: String(row.step_id), channel, purpose, sender_identity_id: String(sender.id), provider: String(connection.provider), idempotency_key: `automation:${deliveryId}`, destination, content })
      if (!result.duplicate) await multiChannel.enqueueDelivery({ deliveryId: String(result.delivery.id), brandId: String(row.brand_id), contactId: String(contact.id), channel, purpose, destination, content, connectionId: String(connection.id), senderAddress: String(sender.address), callbackUrl: `${config.appUrl}/api/v2/webhooks/${connection.provider}/${connection.id}` })
      db.prepare(`UPDATE automation_deliveries SET status='sent',sent_at=? WHERE id=?`).run(nowIso(), deliveryId)
      db.prepare('UPDATE automation_steps SET sent_count=sent_count+1,updated_at=? WHERE id=?').run(nowIso(), row.step_id)
      return
    }
    const trackedStep = effectiveTracking(row, brand.privacy_mode)
    const mergedHtml = mergeTags(String(row.html_text), row, appUrl, config.sessionSecret, String(row.brand_id))
    const html = instrumentAutomation(appUrl, config.sessionSecret, trackedStep, row, mergedHtml, deliveryId)
    await sendMessage(config, { ...brand, from_name: row.from_name, from_email: row.from_email, reply_to: row.reply_to } as never, {
      to: String(row.email), name: String(row.name), subject: mergeTags(String(row.subject), row, appUrl, config.sessionSecret, String(row.brand_id)),
      html, text: mergeTags(String(row.plain_text), row, appUrl, config.sessionSecret, String(row.brand_id)),
      headers: { 'X-Sendry-Automation-Step': String(row.step_id), 'X-Sendry-Subscriber': String(row.subscriber_id) },
    })
    db.prepare(`UPDATE automation_deliveries SET status='sent',sent_at=? WHERE id=?`).run(nowIso(), deliveryId)
    db.prepare('UPDATE automation_steps SET sent_count=sent_count+1,updated_at=? WHERE id=?').run(nowIso(), row.step_id)
    db.prepare('UPDATE brands SET current_usage=current_usage+1,updated_at=? WHERE id=?').run(nowIso(), row.brand_id)
    db.prepare('UPDATE subscribers SET last_automation_step_id=?,last_activity_at=?,updated_at=? WHERE id=?').run(row.step_id, nowIso(), nowIso(), row.subscriber_id)
    enqueueJob(db, 'rules.trigger', { brandId: row.brand_id, trigger: 'automation_sent', automationId: row.automation_id, subscriberId: row.subscriber_id })
    if (row.automation_type === 'annual') {
      const next = new Date(String(row.scheduled_at)); next.setUTCFullYear(next.getUTCFullYear() + 1)
      db.prepare(`INSERT OR IGNORE INTO automation_deliveries (id,step_id,subscriber_id,status,scheduled_at) VALUES (?,?,?,?,?)`).run(randomUUID(), row.step_id, row.subscriber_id, 'queued', next.toISOString())
    }
  } catch (error) {
    db.prepare(`UPDATE automation_deliveries SET status='failed',error=? WHERE id=?`).run(error instanceof Error ? error.message : String(error), deliveryId)
  }
}

async function triggerRules(db: AppDatabase, config: AppConfig, payload: Record<string, unknown>) {
  const rules = db.prepare('SELECT * FROM rules WHERE brand_id=? AND trigger_type=? AND enabled=1').all(payload.brandId, payload.trigger) as Record<string, unknown>[]
  for (const rule of rules) {
    const action = JSON.parse(String(rule.action_config || '{}')) as Record<string, unknown>
    const endpoint = action.endpoint ?? action.url
    const recipient = action.email ?? action.to
    const listId = action.listId ?? action.list_id
    if (rule.action_type === 'webhook' && endpoint) enqueueJob(db, 'webhook.deliver', { ruleId: rule.id, endpoint, payload })
    if (rule.action_type === 'email' && recipient) {
      const brand = db.prepare('SELECT * FROM brands WHERE id=?').get(rule.brand_id) as Record<string, unknown>
      await sendMessage(config, brand as never, { to: String(recipient), subject: `Sendry notification: ${String(payload.trigger).replaceAll('_', ' ')}`, html: `<p>${JSON.stringify(payload)}</p>`, text: JSON.stringify(payload) })
    }
    if (rule.action_type === 'unsubscribe' && listId && payload.subscriberId) db.prepare(`UPDATE subscribers SET status='unsubscribed',updated_at=? WHERE id=? AND list_id=?`).run(nowIso(), payload.subscriberId, listId)
  }
}

async function deliverWebhook(db: AppDatabase, payload: Record<string, unknown>) {
  const endpoint = String(payload.endpoint)
  let status = 204
  let response = 'Local test endpoint accepted'
  if (!endpoint.endsWith('.test') && !endpoint.includes('.test/')) {
    try {
      const result = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload.payload) })
      status = result.status
      response = (await result.text()).slice(0, 2000)
    } catch (error) {
      status = 0
      response = error instanceof Error ? error.message : String(error)
    }
  }
  db.prepare('INSERT INTO webhook_logs (id,rule_id,endpoint,payload,status_code,response,attempted_at) VALUES (?,?,?,?,?,?,?)').run(randomUUID(), payload.ruleId ?? null, endpoint, JSON.stringify(payload.payload), status, response, nowIso())
  if (status >= 400 || status === 0) throw new Error(`Webhook failed with status ${status}`)
}

async function executeJob(db: AppDatabase, config: AppConfig, job: Job, multiChannel?: MultiChannelRuntime) {
  const payload = JSON.parse(job.payload) as Record<string, unknown>
  if (job.type === 'campaign.send') await processCampaign(db, config, String(payload.campaignId))
  else if (job.type === 'automation.deliver') await processAutomationDelivery(db, config, String(payload.deliveryId), multiChannel)
  else if (job.type === 'rules.trigger') await triggerRules(db, config, payload)
  else if (job.type === 'webhook.deliver') await deliverWebhook(db, payload)
}

export async function processNextJob(db: AppDatabase, config: AppConfig, multiChannel?: MultiChannelRuntime) {
  const job = db.prepare(`SELECT * FROM jobs WHERE status='queued' AND run_at<=? ORDER BY run_at,id LIMIT 1`).get(nowIso()) as Job | undefined
  if (!job) return false
  const claimed = db.prepare(`UPDATE jobs SET status='running',locked_at=?,attempts=attempts+1 WHERE id=? AND status='queued'`).run(nowIso(), job.id)
  if (!claimed.changes) return false
  try {
    await executeJob(db, config, job, multiChannel)
    db.prepare(`UPDATE jobs SET status='completed',completed_at=?,locked_at=NULL WHERE id=?`).run(nowIso(), job.id)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const retry = job.attempts + 1 < job.max_attempts
    db.prepare('UPDATE jobs SET status=?,run_at=?,locked_at=NULL,error=? WHERE id=?').run(retry ? 'queued' : 'failed', new Date(Date.now() + Math.pow(2, job.attempts) * 1000).toISOString(), message, job.id)
  }
  return true
}

export function scheduleDueWork(db: AppDatabase) {
  resetMonthlyUsage(db)
  const scheduled = db.prepare(`SELECT id FROM campaigns WHERE status='scheduled' AND scheduled_at<=?`).all(nowIso()) as Array<{ id: string }>
  for (const campaign of scheduled) {
    const exists = db.prepare(`SELECT id FROM jobs WHERE type='campaign.send' AND status IN ('queued','running') AND json_extract(payload,'$.campaignId')=?`).get(campaign.id)
    if (!exists) enqueueJob(db, 'campaign.send', { campaignId: campaign.id })
  }
  const deliveries = db.prepare(`SELECT id FROM automation_deliveries WHERE status='queued' AND scheduled_at<=?`).all(nowIso()) as Array<{ id: string }>
  for (const delivery of deliveries) {
    const exists = db.prepare(`SELECT id FROM jobs WHERE type='automation.deliver' AND status IN ('queued','running') AND json_extract(payload,'$.deliveryId')=?`).get(delivery.id)
    if (!exists) enqueueJob(db, 'automation.deliver', { deliveryId: delivery.id })
  }
}

export function resetMonthlyUsage(db: AppDatabase, at = new Date()) {
  const brands = db.prepare(`SELECT id,reset_day,usage_reset_at FROM brands WHERE monthly_limit>=0 AND limit_never_expires=0`).all() as Array<{ id: string; reset_day: number; usage_reset_at: string | null }>
  let changed = 0
  for (const brand of brands) {
    const day = Math.min(28, Math.max(1, Number(brand.reset_day) || 1))
    const periodStart = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), day))
    if (at.getUTCDate() < day) periodStart.setUTCMonth(periodStart.getUTCMonth() - 1)
    const lastReset = brand.usage_reset_at ? new Date(brand.usage_reset_at) : null
    if (!lastReset || Number.isNaN(lastReset.getTime()) || lastReset < periodStart) {
      changed += db.prepare('UPDATE brands SET current_usage=0,usage_reset_at=?,updated_at=? WHERE id=?').run(at.toISOString(), at.toISOString(), brand.id).changes
    }
  }
  return changed
}

export function startWorker(db: AppDatabase, config: AppConfig, multiChannel?: MultiChannelRuntime) {
  let busy = false
  const tick = async () => {
    if (busy) return
    busy = true
    try {
      scheduleDueWork(db)
      for (let index = 0; index < 25 && await processNextJob(db, config, multiChannel); index += 1) { /* drain a bounded batch */ }
    } finally { busy = false }
  }
  const timer = setInterval(tick, 1500)
  void tick()
  return () => clearInterval(timer)
}
