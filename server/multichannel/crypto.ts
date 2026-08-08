import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

const VERSION = 'v1'

function keyBytes(value: string) {
  const normalized = value.trim()
  if (/^[a-f\d]{64}$/i.test(normalized)) return Buffer.from(normalized, 'hex')
  const decoded = Buffer.from(normalized, 'base64')
  if (decoded.length === 32) return decoded
  return createHash('sha256').update(normalized).digest()
}

export function encryptCredentials(credentials: Record<string, unknown>, encryptionKey: string) {
  if (!encryptionKey) throw new Error('CREDENTIAL_ENCRYPTION_KEY is required')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', keyBytes(encryptionKey), iv)
  cipher.setAAD(Buffer.from('sendry:channel-credentials'))
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(credentials), 'utf8'), cipher.final()])
  return [VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.')
}

export function decryptCredentials(value: string, encryptionKey: string): Record<string, string> {
  if (!encryptionKey) throw new Error('CREDENTIAL_ENCRYPTION_KEY is required')
  const [version, ivValue, tagValue, encryptedValue] = value.split('.')
  if (version !== VERSION || !ivValue || !tagValue || !encryptedValue) throw new Error('Unsupported encrypted credential payload')
  const decipher = createDecipheriv('aes-256-gcm', keyBytes(encryptionKey), Buffer.from(ivValue, 'base64url'))
  decipher.setAAD(Buffer.from('sendry:channel-credentials'))
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'))
  const decoded = Buffer.concat([decipher.update(Buffer.from(encryptedValue, 'base64url')), decipher.final()]).toString('utf8')
  return JSON.parse(decoded) as Record<string, string>
}

export function redactCredentials<T extends Record<string, unknown>>(value: T) {
  const secretPattern = /(secret|token|password|api.?key|private.?key|auth)/i
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, secretPattern.test(key) ? '••••••••' : item]))
}
