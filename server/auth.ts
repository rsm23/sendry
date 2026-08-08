import type { NextFunction, Request, Response } from 'express'
import type { AppConfig } from './config'
import type { AppDatabase } from './db'
import { tokenHash } from './db'

export type AuthUser = { id: string; name: string; email: string; language: string; timezone: string; theme: string }

declare global {
  namespace Express {
    interface Request {
      authUser?: AuthUser
      authKind?: 'session' | 'api'
      apiWorkspaceId?: string
      apiScopes?: string[]
    }
  }
}

export function authMiddleware(db: AppDatabase, _config: AppConfig) {
  return (request: Request, _response: Response, next: NextFunction) => {
    const bearer = request.headers.authorization?.startsWith('Bearer ') ? request.headers.authorization.slice(7) : undefined
    if (bearer) {
      const token = db.prepare('SELECT * FROM api_tokens WHERE token_hash=?').get(tokenHash(bearer)) as { id: string; workspace_id: string; scopes: string } | undefined
      if (token) {
        request.authKind = 'api'
        request.apiWorkspaceId = token.workspace_id
        try { request.apiScopes = JSON.parse(token.scopes) as string[] } catch { request.apiScopes = [] }
        db.prepare('UPDATE api_tokens SET last_used_at=? WHERE id=?').run(new Date().toISOString(), token.id)
        return next()
      }
    }
    const sessionId = request.cookies?.sendry_session as string | undefined
    if (sessionId) {
      const user = db.prepare(`SELECT u.id,u.name,u.email,u.language,u.timezone,u.theme
        FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=? AND s.expires_at>?`).get(sessionId, new Date().toISOString()) as AuthUser | undefined
      if (user) {
        request.authUser = user
        request.authKind = 'session'
      }
    }
    next()
  }
}

export function requireAuth(request: Request, response: Response, next: NextFunction) {
  if (request.authUser || request.authKind === 'api') return next()
  response.status(401).json({ error: 'Authentication required' })
}
