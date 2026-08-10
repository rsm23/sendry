import type { Server as HttpServer } from 'node:http'
import type { Express } from 'express'
import { Server } from 'socket.io'
import { createAdapter } from '@socket.io/redis-adapter'
import IORedis from 'ioredis'
import { tokenHash, type AppDatabase } from './db'
import type { AppConfig } from './config'
import type { MultiChannelRuntime } from './multichannel/runtime'
import { userCanAccessFile } from './files'

function cookieValue(cookie: string | undefined, key: string) {
  return cookie?.split(';').map((item) => item.trim().split('=')).find(([name]) => name === key)?.[1]
}

export async function createRealtimeServer(server: HttpServer, app: Express, db: AppDatabase, config: AppConfig, runtime: MultiChannelRuntime) {
  const io = new Server(server, { path: '/socket.io', cors: { origin: config.appUrl, credentials: true }, transports: ['websocket', 'polling'], maxHttpBufferSize: 1_000_000 })
  let pub: IORedis | undefined, sub: IORedis | undefined
  if (config.redisUrl) {
    pub = new IORedis(config.redisUrl)
    sub = pub.duplicate()
    io.adapter(createAdapter(pub, sub))
  }

  io.use((socket, next) => {
    const bearer = String(socket.handshake.auth?.token ?? '')
    if (bearer) {
      const token = db.prepare('SELECT workspace_id FROM api_tokens WHERE token_hash=?').get(tokenHash(bearer)) as { workspace_id: string } | undefined
      if (token) { socket.data.workspaceId = token.workspace_id; socket.data.kind = 'api'; return next() }
    }
    const sessionId = cookieValue(socket.handshake.headers.cookie, 'sendry_session')
    const session = sessionId ? db.prepare(`SELECT u.id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=? AND s.expires_at>?`).get(sessionId, new Date().toISOString()) as { id: string } | undefined : undefined
    if (!session) return next(new Error('Authentication required'))
    socket.data.userId = session.id
    socket.data.kind = 'session'
    next()
  })

  io.on('connection', (socket) => {
    socket.on('brand.join', (brandId: string, acknowledge?: (result: { ok: boolean }) => void) => {
      const allowed = socket.data.kind === 'api' ? !!db.prepare('SELECT id FROM brands WHERE id=? AND workspace_id=?').get(brandId, socket.data.workspaceId) : !!db.prepare('SELECT id FROM brand_members WHERE brand_id=? AND user_id=?').get(brandId, socket.data.userId)
      if (!allowed) return acknowledge?.({ ok: false })
      void socket.join(`brand:${brandId}`)
      void socket.join(`user:${socket.data.userId ?? socket.data.workspaceId}`)
      socket.data.brandId = brandId
      socket.to(`brand:${brandId}`).emit('presence.changed', { userId: socket.data.userId, state: 'online' })
      acknowledge?.({ ok: true })
    })
    socket.on('conversation.join', (conversationId: string) => { if (socket.data.brandId) void socket.join(`conversation:${conversationId}`) })
    socket.on('file.join', (fileId: string, acknowledge?: (result: { ok: boolean }) => void) => {
      const allowed = socket.data.kind === 'session' && userCanAccessFile(db, socket.data.userId, fileId)
      if (!allowed) return acknowledge?.({ ok: false })
      void socket.join(`file:${fileId}`)
      socket.to(`file:${fileId}`).emit('file.presence', { fileId, userId: socket.data.userId, state: 'online' })
      acknowledge?.({ ok: true })
    })
    socket.on('file.leave', (fileId: string) => { void socket.leave(`file:${fileId}`) })
    socket.on('visitor.join', (visitorId: string) => void socket.join(`visitor:${visitorId}`))
    socket.on('typing.start', (payload: { conversationId: string }) => socket.to(`conversation:${payload.conversationId}`).emit('typing.started', { ...payload, userId: socket.data.userId }))
    socket.on('typing.stop', (payload: { conversationId: string }) => socket.to(`conversation:${payload.conversationId}`).emit('typing.stopped', { ...payload, userId: socket.data.userId }))
    socket.on('disconnect', () => { if (socket.data.brandId) socket.to(`brand:${socket.data.brandId}`).emit('presence.changed', { userId: socket.data.userId, state: 'offline' }) })
  })

  runtime.events.on('conversation.message', (payload: { brandId: string; conversationId: string }) => { io.to(`brand:${payload.brandId}`).to(`conversation:${payload.conversationId}`).emit('conversation.message', payload) })
  runtime.events.on('delivery.status', (payload: { brandId: string }) => io.to(`brand:${payload.brandId}`).emit('message.status', payload))
  runtime.events.on('call.status', (payload: { brandId: string }) => io.to(`brand:${payload.brandId}`).emit('call.status', payload))
  app.locals.io = io

  return async () => {
    await new Promise<void>((resolve) => io.close(() => resolve()))
    await Promise.all([pub?.quit(), sub?.quit()].filter(Boolean))
  }
}
