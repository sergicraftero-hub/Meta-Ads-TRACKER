import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { env } from './env'

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>

// Dev fallback key keeps local setups working; production refuses to boot without ENCRYPTION_KEY (see env.ts).
const key = createHash('sha256').update(env.encryptionKey || 'adpilot-dev-only-key').digest()

/** AES-256-GCM. Output: base64(iv | tag | ciphertext). */
export function encrypt(plain: string): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key, iv)
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return Buffer.concat([iv, c.getAuthTag(), data]).toString('base64')
}

export function decrypt(blob: string): string {
  const buf = Buffer.from(blob, 'base64')
  const d = createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12))
  d.setAuthTag(buf.subarray(12, 28))
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8')
}

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16)
  const h = await scryptAsync(pw, salt, 64)
  return `scrypt$${salt.toString('base64')}$${h.toString('base64')}`
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, s, h] = stored.split('$')
  if (alg !== 'scrypt' || !s || !h) return false
  const expected = Buffer.from(h, 'base64')
  const got = await scryptAsync(pw, Buffer.from(s, 'base64'), expected.length)
  return timingSafeEqual(got, expected)
}

export const token = (bytes = 32) => randomBytes(bytes).toString('base64url')
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')
export const hmacSha256 = (secret: string, data: string | Buffer, enc: 'hex' | 'base64' = 'hex') =>
  createHmac('sha256', secret).update(data).digest(enc)

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}
