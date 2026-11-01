import { Hono } from 'hono'
import { z } from 'zod'
import { gunzipSync } from 'node:zlib'
import { timingSafeEqual } from 'node:crypto'
import { sql, HttpError } from '../db'
import { body, type Env } from '../app'
import { hashPassword, startSession, currentUser } from '../lib/auth'
import { audit } from '../lib/audit'
import { ensureBucket, storageMode } from '../lib/storage'
import { DEFAULT_SETTINGS, DEFAULT_TEMPLATES } from '../../shared/settings'
import { aiConfigured } from '../lib/ai'
import { waApiConfigured } from '../lib/whatsapp'
import { normPhone } from '../../shared/rx'
import { rateLimit } from '../lib/ratelimit'
import { clientIp } from '../lib/audit'

const r = new Hono<Env>()
export const SEED_PARTS = 2

function checkToken(t?: string) {
  const want = process.env.SETUP_TOKEN || ''
  if (!want || want.length < 8) throw new HttpError(503, 'SETUP_TOKEN is not set in the Vercel settings.')
  const a = Buffer.from(String(t || '')), b = Buffer.from(want)
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new HttpError(403, 'Setup code is wrong.')
}

r.get('/status', async c => {
  const [{ n: clinics }] = await sql()`select count(*)::int as n from arx.clinics`
  const [{ n: meds }] = await sql()`select count(*)::int as n from arx.medicines where kind <> 'custom'`
  return c.json({
    database: true, clinics, medicines: meds, seed_parts: SEED_PARTS,
    env: {
      session_secret: (process.env.SESSION_SECRET || '').length >= 32, setup_token: !!process.env.SETUP_TOKEN,
      storage: storageMode(), ai: aiConfigured(), whatsapp_api: waApiConfigured(), old_database: !!process.env.OLD_DATABASE_URL,
    },
  })
})

r.post('/init', async c => {
  await rateLimit(`setup:${clientIp(c)}`, 10, 3600)
  const b = await body(c, z.object({
    token: z.string(),
    clinic_name: z.string().min(2).max(120),
    slug: z.string().regex(/^[a-z0-9-]{3,40}$/, 'use 3–40 lowercase letters, numbers or dashes'),
    doctor_name: z.string().min(2).max(120),
    phone: z.string().min(10).max(14),
    password: z.string().min(8, 'Use at least 8 characters').max(200),
  }))
  checkToken(b.token)
  const [{ n }] = await sql()`select count(*)::int as n from arx.clinics`
  if (n > 0) throw new HttpError(409, 'Setup is already done. Log in instead.')
  await ensureBucket()
  const phone = normPhone(b.phone)
  if (!/^[0-9]{10}$/.test(phone)) throw new HttpError(400, 'Mobile number must be 10 digits.')
  const user = await sql().begin(async tx => {
    const [cl] = await tx`insert into arx.clinics (slug, name, settings) values (${b.slug}, ${b.clinic_name}, ${tx.json(DEFAULT_SETTINGS as any)}) returning id`
    const [u] = await tx`insert into arx.users (clinic_id, name, phone, password_hash, role)
      values (${cl.id}, ${b.doctor_name}, ${phone}, ${await hashPassword(b.password)}, 'doctor') returning id, clinic_id, session_version, name, role`
    let i = 0
    for (const t of DEFAULT_TEMPLATES) await tx`insert into arx.templates (clinic_id, name, data, sort) values (${cl.id}, ${t.name}, ${tx.json(t.data as any)}, ${i++})`
    return u
  })
  await startSession(c, user as any)
  await audit(c, 'setup.init', 'clinic', user.clinic_id, { slug: b.slug }, user as any)
  return c.json({ ok: true })
})

/** Loads the medicine catalogue in parts from the static /seed files of this deployment. */
r.post('/seed-medicines', async c => {
  const b = await body(c, z.object({ part: z.number().int().min(0).max(SEED_PARTS - 1), token: z.string().optional() }))
  const u = await currentUser(c)
  if (!u || u.role === 'reception') checkToken(b.token)
  const url = new URL(`/seed/medicines-${String(b.part).padStart(2, '0')}.json.gz`, process.env.APP_URL || c.req.url)
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) })
  if (!res.ok) throw new HttpError(502, `Could not load seed file ${url.pathname} (${res.status}).`)
  const rows = JSON.parse(gunzipSync(Buffer.from(await res.arrayBuffer())).toString('utf8')) as [string, string, string, string, string, number | null, string][]
  const db = sql()
  if (b.part === 0) await db`delete from arx.medicines where kind <> 'custom'`
  let inserted = 0
  for (let i = 0; i < rows.length; i += 2000) {
    const chunk = rows.slice(i, i + 2000)
    await db`insert into arx.medicines (name, kind, category, manufacturer, pack, price, form)
      select * from unnest(${chunk.map(r => r[0])}::text[], ${chunk.map(r => r[1])}::text[], ${chunk.map(r => r[2] || null)}::text[],
        ${chunk.map(r => r[3] || null)}::text[], ${chunk.map(r => r[4] || null)}::text[], ${chunk.map(r => r[5])}::numeric[], ${chunk.map(r => r[6] || null)}::text[])`
    inserted += chunk.length
  }
  return c.json({ ok: true, part: b.part, inserted, parts: SEED_PARTS })
})

export default r
