import { config as loadEnv } from 'dotenv'
import { getConfig } from '../config'
import { createDatabase } from '../db'
import { createKnowledgeAgent } from '../knowledge/agent'
import { createMultiChannelRuntime } from '../multichannel/factory'

loadEnv()
const config = getConfig(), database = createDatabase(config.databasePath), runtime = createMultiChannelRuntime(database, config), agent = createKnowledgeAgent(database, config, runtime)
const dryRun = process.argv.includes('--dry-run'), rebuildVectors = process.argv.includes('--rebuild-vectors')
const brandArgument = process.argv.find((value) => value.startsWith('--brand='))?.slice('--brand='.length)
const where = brandArgument ? 'WHERE kd.brand_id=?' : '', values = brandArgument ? [brandArgument] : []
const documents = database.prepare(`SELECT kd.*,f.trashed_at,f.current_version_id,(SELECT COUNT(*) FROM knowledge_chunks kc WHERE kc.document_id=kd.id) AS actual_chunks FROM knowledge_documents kd LEFT JOIN files f ON f.id=kd.file_id ${where}`).all(...values) as Array<Record<string, unknown>>
const report = { inspected: documents.length, stale: 0, missingSource: 0, requeued: 0, removed: 0 }

for (const document of documents) {
  const sourceUnavailable = document.trashed_at || !document.current_version_id
  const stale = document.status === 'ready' && Number(document.actual_chunks) !== Number(document.chunk_count)
  if (sourceUnavailable) report.missingSource += 1
  if (stale) report.stale += 1
  if (dryRun) continue
  if (sourceUnavailable) {
    if (await agent.removeDocument({ brandId: String(document.brand_id), widgetId: String(document.widget_id), documentId: String(document.id) })) report.removed += 1
  } else if (stale || rebuildVectors) {
    database.prepare(`UPDATE knowledge_documents SET status='failed',error_code='REPAIR_REINDEX',error_message='Queued by knowledge repair',updated_at=? WHERE id=?`).run(new Date().toISOString(), document.id)
    await agent.indexDocument({ brandId: String(document.brand_id), widgetId: String(document.widget_id), fileId: String(document.file_id) })
    report.requeued += 1
  }
}

console.log(JSON.stringify({ dryRun, rebuildVectors, brandId: brandArgument ?? null, ...report }, null, 2))
await agent.close()
await runtime.close()
database.close()
