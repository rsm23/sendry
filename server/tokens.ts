import { createHmac, timingSafeEqual } from 'node:crypto'

export function signToken(payload: Record<string, unknown>, secret: string, expiresInSeconds = 30 * 86400) {
  const data = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + expiresInSeconds })).toString('base64url')
  const signature = createHmac('sha256', secret).update(data).digest('base64url')
  return `${data}.${signature}`
}

export function verifyToken<T extends Record<string, unknown>>(token: string, secret: string): T | null {
  const [data, signature] = token.split('.')
  if (!data || !signature) return null
  const expected = createHmac('sha256', secret).update(data).digest('base64url')
  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    const value = JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as T & { exp?: number }
    if (!value.exp || value.exp < Math.floor(Date.now() / 1000)) return null
    return value
  } catch {
    return null
  }
}
