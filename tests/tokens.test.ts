import { describe, expect, it } from 'vitest'
import { signToken, verifyToken } from '../server/tokens'

describe('signed links', () => {
  const secret = 'a-long-test-secret-for-signed-link-integrity'

  it('round-trips valid payloads and rejects tampering', () => {
    const token = signToken({ subscriberId: 'sub_1', brandId: 'brd_1' }, secret, 60)
    expect(verifyToken<{ subscriberId: string }>(token, secret)?.subscriberId).toBe('sub_1')
    expect(verifyToken(`${token}x`, secret)).toBeNull()
    expect(verifyToken(token, `${secret}-wrong`)).toBeNull()
  })

  it('rejects expired links', () => {
    const token = signToken({ subscriberId: 'sub_1' }, secret, -1)
    expect(verifyToken(token, secret)).toBeNull()
  })
})
