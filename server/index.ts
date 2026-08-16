import { config as loadEnv } from 'dotenv'
import { createApp } from './app'
import { createRealtimeServer } from './realtime'

loadEnv()
const app = createApp()
const port = app.locals.config.port as number
const host = app.locals.config.host as string
const server = app.listen(port, host, () => {
  console.log(`Sendry API listening on http://${host}:${port}`)
})
const stopRealtimePromise = createRealtimeServer(server, app, app.locals.db, app.locals.config, app.locals.multiChannel)

const shutdown = async () => {
  app.locals.stopWorker?.()
  app.locals.stopMultiChannelWorker?.()
  const stopRealtime = await stopRealtimePromise
  await stopRealtime()
  await app.locals.multiChannel.close()
  await app.locals.knowledgeAgent.close()
  server.close(() => {
    app.locals.db.close()
    process.exit(0)
  })
}

process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())
