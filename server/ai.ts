import OpenAI from 'openai'
import type { AppDatabase } from './db'
import { randomUUID } from 'node:crypto'
import { nowIso } from './serialize'

export type AiContext = {
  apiKey?: string
  brandId: string
  db: AppDatabase
}

async function complete(apiKey: string | undefined, instructions: string, input: string) {
  if (!apiKey) return null
  const client = new OpenAI({ apiKey })
  const response = await client.responses.create({ model: 'gpt-5-mini', instructions, input })
  return response.output_text.trim()
}

function generatedEmailPayload(value: string) {
  const candidates = [value, value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1], value.slice(value.indexOf('{'), value.lastIndexOf('}') + 1)].filter(Boolean) as string[]
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>
      if (['title','subject','plainText','html'].every((key) => typeof parsed[key] === 'string' && String(parsed[key]).trim())) return parsed as { title: string; subject: string; plainText: string; html: string }
    } catch { /* try the next JSON representation */ }
  }
  return null
}

export async function generateSubject(ctx: AiContext, input: { content: string; current?: string; mode?: string }) {
  const mode = input.mode ?? 'concise'
  const remote = await complete(ctx.apiKey, 'Return exactly one plain-text email subject line with no labels or quotation marks.', `Mode: ${mode}\nCurrent subject: ${input.current ?? ''}\nEmail content:\n${input.content}`)
  if (remote) return { subject: remote, source: 'provider' }
  const lead = input.content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().split(/[.!?]/)[0] || 'A useful update'
  const subjects: Record<string, string> = {
    curiosity: `A closer look at ${lead.slice(0, 44)}`,
    value: `${lead.slice(0, 58)} — practical takeaways`,
    personal: `A quick note about ${lead.slice(0, 46)}`,
    concise: lead.slice(0, 68),
  }
  return { subject: subjects[mode] ?? subjects.concise, source: 'local' }
}

export async function generateEmail(ctx: AiContext, input: { task: string; design?: string; requirements?: string }) {
  const prompt = `Task:\n${input.task}\n\nDesign and content:\n${input.design ?? ''}\n\nRequirements:\n${input.requirements ?? ''}`
  const remote = await complete(ctx.apiKey, 'Create a complete accessible marketing email. Return JSON with title, subject, plainText and html fields.', prompt)
  if (remote) {
    const parsed = generatedEmailPayload(remote)
    if (parsed) return { ...parsed, source: 'provider' }
  }
  const task = input.task.trim() || 'Share a useful product update'
  const subject = task.replace(/[.!?]+$/, '').slice(0, 68)
  const title = subject.length > 42 ? `${subject.slice(0, 39)}…` : subject
  const plainText = `${task}\n\n${input.requirements?.trim() || 'Read the complete update and choose the next step.'}\n\n[unsubscribe]`
  const html = `<div style="max-width:620px;margin:auto;font-family:Arial,sans-serif;color:#17191f"><p style="color:#58606d">Atlas update</p><h1>${escapeHtml(title)}</h1><p>${escapeHtml(task)}</p><p>${escapeHtml(input.requirements?.trim() || 'We prepared the details so you can decide what to do next.')}</p><p><a href="https://example.test/update" style="display:inline-block;background:#1458e6;color:white;padding:12px 18px;text-decoration:none">Explore the update</a></p><p style="margin-top:40px;font-size:12px;color:#6b7280">[unsubscribe] · [preferences]</p></div>`
  return { title, subject, plainText, html, source: 'local' }
}

export async function improveContent(ctx: AiContext, input: { content: string; instruction?: string }) {
  const remote = await complete(ctx.apiKey, 'Improve the supplied email while preserving facts and links. Return only the improved content.', `${input.instruction ?? 'Improve clarity, structure and scannability.'}\n\n${input.content}`)
  if (remote) return { content: remote, source: 'provider' }
  const content = input.content.trim().replace(/\s{2,}/g, ' ').replace(/\bvery\b/gi, '').replace(/\bjust\b/gi, '')
  return { content, source: 'local', notes: ['Removed filler words', 'Tightened repeated whitespace', 'Preserved links and personalization tags'] }
}

export async function analyzeContent(ctx: AiContext, input: { content: string; entityType: string; entityId: string; parentId?: string }) {
  const text = input.content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  const hasUnsubscribe = /unsubscribe/i.test(input.content)
  const hasLink = /https?:\/\//i.test(input.content)
  const score = Math.max(35, Math.min(98, 62 + (hasUnsubscribe ? 12 : 0) + (hasLink ? 8 : 0) + (text.length > 180 ? 8 : 0) - (text.length > 1800 ? 10 : 0)))
  const remote = await complete(ctx.apiKey, 'Analyze this email for clarity, accessibility, deliverability and conversion. Give concise prioritized advice.', input.content)
  const analysis = remote ?? [
    `Content score: ${score}/100.`,
    hasUnsubscribe ? 'The subscription exit is present.' : 'Add an unsubscribe link before sending.',
    hasLink ? 'The message has a clear action path.' : 'Add one focused call to action.',
    text.length > 1800 ? 'Shorten the message or add stronger section headings.' : 'The length is appropriate for a focused campaign.',
  ].join(' ')
  const now = nowIso()
  const existing = ctx.db.prepare('SELECT id FROM ai_analyses WHERE brand_id=? AND entity_type=? AND entity_id=?').get(ctx.brandId, input.entityType, input.entityId) as { id: string } | undefined
  if (existing) ctx.db.prepare('UPDATE ai_analyses SET analysis=?,score=?,source=?,is_open=1,updated_at=? WHERE id=?').run(analysis, score, remote ? 'provider' : 'local', now, existing.id)
  else ctx.db.prepare('INSERT INTO ai_analyses (id,brand_id,entity_type,entity_id,analysis,score,source,is_open,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(randomUUID(), ctx.brandId, input.entityType, input.entityId, analysis, score, remote ? 'provider' : 'local', 1, now, now)
  return { analysis, score, source: remote ? 'provider' : 'local' }
}

export async function analyzeReport(ctx: AiContext, campaignId: string) {
  const campaign = ctx.db.prepare('SELECT * FROM campaigns WHERE id=? AND brand_id=?').get(campaignId, ctx.brandId) as Record<string, unknown> | undefined
  if (!campaign) throw new Error('Campaign not found')
  const events = ctx.db.prepare('SELECT type,COUNT(DISTINCT subscriber_id) AS unique_count,COUNT(*) AS total FROM campaign_events WHERE campaign_id=? GROUP BY type').all(campaignId) as Array<{ type: string; unique_count: number; total: number }>
  const metrics = Object.fromEntries(events.map((row) => [row.type, row]))
  const delivered = Number(campaign.delivered) || Number(campaign.total_recipients) || 1
  const openRate = ((metrics.open?.unique_count ?? 0) / delivered) * 100
  const clickRate = ((metrics.click?.unique_count ?? 0) / delivered) * 100
  const score = Math.max(20, Math.min(98, Math.round(72 + openRate / 3 + clickRate - ((metrics.bounce?.unique_count ?? 0) / delivered) * 100 * 4)))
  const localAnalysis = `This campaign scored ${score}/100. Unique opens reached ${openRate.toFixed(1)}% and unique clicks reached ${clickRate.toFixed(1)}%. Preserve the strongest call to action, test one subject variation, and monitor bounce and complaint trends before the next send.`
  const remote = await complete(ctx.apiKey, 'Analyze campaign performance and return a concise evidence-based assessment with prioritized next actions.', JSON.stringify({ campaign, events }))
  const analysis = remote ?? localAnalysis
  const now = nowIso()
  const existing = ctx.db.prepare('SELECT id FROM ai_analyses WHERE brand_id=? AND entity_type=? AND entity_id=?').get(ctx.brandId, 'campaign', campaignId) as { id: string } | undefined
  if (existing) ctx.db.prepare('UPDATE ai_analyses SET analysis=?,score=?,source=?,is_open=1,updated_at=? WHERE id=?').run(analysis, score, remote ? 'provider' : 'local', now, existing.id)
  else ctx.db.prepare('INSERT INTO ai_analyses (id,brand_id,entity_type,entity_id,analysis,score,source,is_open,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(randomUUID(), ctx.brandId, 'campaign', campaignId, analysis, score, remote ? 'provider' : 'local', 1, now, now)
  return { analysis, score, metrics, source: remote ? 'provider' : 'local' }
}

export async function analyzeAutomationReport(ctx: AiContext, automationId: string) {
  const automation = ctx.db.prepare(`SELECT a.*,l.brand_id,l.name AS list_name FROM automations a JOIN lists l ON l.id=a.list_id WHERE a.id=? AND l.brand_id=?`).get(automationId, ctx.brandId) as Record<string, unknown> | undefined
  if (!automation) throw new Error('Automation not found')
  const steps = ctx.db.prepare(`SELECT st.id,st.subject,
    SUM(CASE WHEN d.status='sent' THEN 1 ELSE 0 END) AS delivered,
    SUM(CASE WHEN d.status='failed' THEN 1 ELSE 0 END) AS failed,
    (SELECT COUNT(DISTINCT ae.subscriber_id) FROM automation_events ae WHERE ae.step_id=st.id AND ae.type='open') AS unique_opens,
    (SELECT COUNT(DISTINCT ae.subscriber_id) FROM automation_events ae WHERE ae.step_id=st.id AND ae.type='click') AS unique_clicks
    FROM automation_steps st LEFT JOIN automation_deliveries d ON d.step_id=st.id WHERE st.automation_id=? GROUP BY st.id ORDER BY st.position`).all(automationId) as Array<Record<string, unknown>>
  const delivered = steps.reduce((sum, step) => sum + Number(step.delivered), 0) || 1
  const opens = steps.reduce((sum, step) => sum + Number(step.unique_opens), 0)
  const clicks = steps.reduce((sum, step) => sum + Number(step.unique_clicks), 0)
  const failed = steps.reduce((sum, step) => sum + Number(step.failed), 0)
  const openRate = opens / delivered * 100
  const clickRate = clicks / delivered * 100
  const score = Math.max(20, Math.min(98, Math.round(70 + openRate / 3 + clickRate - failed / delivered * 100 * 3)))
  const localAnalysis = `This automation scored ${score}/100 across ${steps.length} email step${steps.length === 1 ? '' : 's'}. Unique opens reached ${openRate.toFixed(1)}% and unique clicks reached ${clickRate.toFixed(1)}%. Review the weakest step, test one subject variation, and keep timing changes isolated so their effect remains measurable.`
  const remote = await complete(ctx.apiKey, 'Analyze automated email-series performance. Return a concise evidence-based assessment of timing, step-level engagement, click-to-open behavior, risks and prioritized next actions.', JSON.stringify({ automation, steps }))
  const analysis = remote ?? localAnalysis
  const now = nowIso()
  const existing = ctx.db.prepare('SELECT id FROM ai_analyses WHERE brand_id=? AND entity_type=? AND entity_id=?').get(ctx.brandId, 'automation', automationId) as { id: string } | undefined
  if (existing) ctx.db.prepare('UPDATE ai_analyses SET analysis=?,score=?,source=?,is_open=1,updated_at=? WHERE id=?').run(analysis, score, remote ? 'provider' : 'local', now, existing.id)
  else ctx.db.prepare('INSERT INTO ai_analyses (id,brand_id,entity_type,entity_id,analysis,score,source,is_open,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(randomUUID(), ctx.brandId, 'automation', automationId, analysis, score, remote ? 'provider' : 'local', 1, now, now)
  return { analysis, score, metrics: { delivered, opens, clicks, failed, openRate, clickRate }, source: remote ? 'provider' : 'local' }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character] ?? character)
}
