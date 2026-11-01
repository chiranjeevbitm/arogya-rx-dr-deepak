import { scrypt as _scrypt, randomBytes, timingSafeEqual, createHmac } from 'node:crypto'
import { promisify } from 'node:util'
import { SignJWT, jwtVerify } from 'jose'
import type { Context, Next } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { sql, HttpError } from '../db'

const scrypt = promisify(_scrypt) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>
const N = 16384, R = 8, P = 1, LEN = 64

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await scrypt(pw.normalize('NFKC'), salt, LEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 })
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`
}
export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, s, k] = stored.split('$')
  if (alg !== 'scrypt') return false
  const key = await scrypt(pw.normalize('NFKC'), Buffer.from(s, 'base64'), Buffer.from(k, 'base64').length, { N: +n, r: +r, p: +p, maxmem: 64 * 1024 * 1024 })
  const want = Buffer.from(k, 'base64')
  return key.length === want.length && timingSafeEqual(key, want)
}

export function secret(): Uint8Array {
  const s = process.env.SESSION_SECRET
  if (!s || s.length < 32) throw new HttpError(503, 'SESSION_SECRET must be set (32+ characters).')
  return new TextEncoder().encode(s)
}

export type Role = 'doctor' | 'reception' | 'admin'
export type AuthUser = { id: string; clinic_id: string; name: string; role: Role; phone: string }

const COOKIE = 'arx_session'
const TTL_HOURS = 14

export async function startSession(c: Context, u: { id: string; session_version: number }) {
  const token = await new SignJWT({ sv: u.session_version }).setProtectedHeader({ alg: 'HS256' })
    .setSubject(u.id).setIssuedAt().setExpirationTime(`${TTL_HOURS}h`).sign(secret())
  setCookie(c, COOKIE, token, { httpOnly: true, secure: isSecure(c), sameSite: 'Lax', path: '/', maxAge: TTL_HOURS * 3600 })
}
export function endSession(c: Context) { deleteCookie(c, COOKIE, { path: '/' }) }
function isSecure(c: Context) { return new URL(c.req.url).protocol === 'https:' || c.req.header('x-forwarded-proto') === 'https' }

/** Resolves the logged-in user; refreshes the cookie when it is past half-life. */
export async function currentUser(c: Context): Promise<AuthUser | null> {
  const token = getCookie(c, COOKIE)
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ['HS256'] })
    const [u] = await sql()`select id, clinic_id, name, role, phone, session_version, active from arx.users where id = ${payload.sub as string}`
    if (!u || !u.active || u.session_version !== payload.sv) return null
    const age = Date.now() / 1000 - (payload.iat || 0)
    if (age > (TTL_HOURS * 3600) / 2) await startSession(c, u as any)
    return { id: u.id, clinic_id: u.clinic_id, name: u.name, role: u.role, phone: u.phone }
  } catch { return null }
}

export function requireAuth(...roles: Role[]) {
  return async (c: Context, next: Next) => {
    const u = await currentUser(c)
    if (!u) throw new HttpError(401, 'Please log in again.')
    if (roles.length && !roles.includes(u.role)) throw new HttpError(403, 'Your role cannot do this.')
    c.set('user', u)
    await next()
  }
}

/** HMAC-signed public links (prescription PDF for the patient, receipts). */
export function signLink(kind: string, id: string, days = 30): string {
  const exp = Math.floor(Date.now() / 1000) + days * 86400
  const sig = createHmac('sha256', Buffer.from(secret())).update(`${kind}:${id}:${exp}`).digest('base64url').slice(0, 32)
  return `${exp}.${sig}`
}
export function verifyLink(kind: string, id: string, token: string): boolean {
  const [exp, sig] = String(token || '').split('.')
  if (!exp || !sig || +exp < Date.now() / 1000) return false
  const want = createHmac('sha256', Buffer.from(secret())).update(`${kind}:${id}:${exp}`).digest('base64url').slice(0, 32)
  return want.length === sig.length && timingSafeEqual(Buffer.from(want), Buffer.from(sig))
}
