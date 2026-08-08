import { config as loadEnv } from 'dotenv'
import { createDatabase } from './db'
import { getConfig } from './config'
import { createMultiChannelRuntime } from './multichannel/factory'

loadEnv()
const config = getConfig()
const legacyDb = createDatabase(config.databasePath)
const runtime = createMultiChannelRuntime(legacyDb, config)
runtime.startWorkers()
console.log('Sendry multi-channel workers are running')

const shutdown = async () => {
  await runtime.close()
  legacyDb.close()
  process.exit(0)
}
process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())
