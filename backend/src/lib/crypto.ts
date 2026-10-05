import crypto from 'node:crypto'

function secret() {
  const value = process.env.SESSION_SECRET
  if (!value || value.length < 32) throw new Error('SESSION_SECRET deve ter pelo menos 32 caracteres.')
  return value
}

export function randomToken(bytes = 32) { return crypto.randomBytes(bytes).toString('hex') }
export function hashToken(value: string) { return crypto.createHash('sha256').update(value).digest('hex') }
export function signValue(value: string) { return crypto.createHmac('sha256', secret()).update(value).digest('hex') }
export function verifyValue(value: string, signature: string) {
  const expected = signValue(value)
  return signature.length === expected.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
}
