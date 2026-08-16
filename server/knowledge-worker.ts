import { config as loadEnv } from 'dotenv'
import { Worker } from 'bullmq'
import IORedis from 'ioredis'
import { getConfig } from './config'
import { createDatabase } from './db'
import { createKnowledgeAgent } from './knowledge/agent'
import { createMultiChannelRuntime } from './multichannel/factory'

loadEnv()
const config = getConfig()
if (!config.redisUrl) throw new Error('REDIS_URL is required for the knowledge worker')
if (!config.qdrantUrl) throw new Error('QDRANT_URL is required for the knowledge worker')
const database = createDatabase(config.databasePath)
const runtime = createMultiChannelRuntime(database, config)
const agent = createKnowledgeAgent(database, config, runtime)
const connection = new IORedis(config.redisUrl, { maxRetriesPerRequest: null })
const worker = new Worker<{ documentId: string }>('sendry-knowledge-index', async (job) => agent.processQueuedDocument(job.data.documentId), { connection, concurrency: config.knowledgeIndexConcurrency })
worker.on('failed', (job, error) => console.error('Knowledge indexing failed', { jobId: job?.id, error: error.message }))
console.log('Sendry knowledge worker is running')

const shutdown = async () => {
  await worker.close()
  await agent.close()
  await runtime.close()
  await connection.quit()
  database.close()
  process.exit(0)
}
process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())
