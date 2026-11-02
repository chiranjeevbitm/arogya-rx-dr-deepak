import { Hono } from 'hono'
import { z } from 'zod'
import { sql, HttpError } from '../db.js'
import { body, me, type Env } from '../app.js'
import { verifyPassword, hashPassword, startSession, endSession, currentUser, requireAuth, forgetUser } from '../lib/auth.js'
import { rateLimit } from '../lib/ratelimit.js'
import { audit, clientIp } from '../lib/audit.js'
import { mergeSettings } from '../../shared/settings.js'
import { aiConfigured, aiModel } from '../lib/ai.js'
import { waApiConfigured } from '../lib/whatsapp.js'
import { storageMode } from '../lib/storage.js'
import { normPhone } from '../../shared/rx.js'

const r = new Hono<Env>()

r.post('/login', async c => {
  const b = await body(c, z.object({ phone: z.string().min(10).max(20), password: z.string().min(1).max(200) }))
  const phone = normPhone(b.phone)
  await rateLimit(`login:ip:${clientIp(c)}`, 30, 900)
  await rateLimit(`login:phone:${phone}`, 8, 900)
  const [u] = await sql()`select * from arx.users where phone = ${phone}`
  const ok = u && u.active && (await verifyPassword(b.password, u.password_hash))
  if (!ok) {
    await audit(c, 'login.failed', 'user', u?.id ?? null, { phone }, u ? { id: u.id, clinic_id: u.clinic_id } as any : null)
    throw new HttpError(401, 'Wrong mobile number or password.')
  }
  await startSession(c, u as any)
  await sql()`update arx.users set last_login_at = now() where id = ${u.id}`
  await audit(c, 'login', 'user', u.id, {}, u as any)
  return c.json({ ok: true })
})

r.post('/logout', async c => { endSession(c); return c.json({ ok: true }) })

r.get('/me', async c => {
  const u = await currentUser(c)
  if (!u) return c.json({ user: null }, 401)
  const [cl] = await sql()`select id, slug, name, settings from arx.clinics where id = ${u.clinic_id}`
  return c.json({
    user: u,
    clinic: { id: cl.id, slug: cl.slug, name: cl.name, settings: mergeSettings(cl.settings) },
    features: { ai: aiConfigured(), ai_model: aiModel(), whatsapp_api: waApiConfigured(), storage: storageMode() },
  })
})

r.post('/password', requireAuth(), async c => {
  const b = await body(c, z.object({ current: z.string(), next: z.string().min(8, 'Use at least 8 characters').max(200) }))
  const u = me(c)
  const [row] = await sql()`select password_hash, session_version from arx.users where id = ${u.id}`
  if (!(await verifyPassword(b.current, row.password_hash))) throw new HttpError(400, 'Current password is wrong.')
  const [nu] = await sql()`update arx.users set password_hash = ${await hashPassword(b.next)}, session_version = session_version + 1 where id = ${u.id} returning id, session_version`
  forgetUser(u.id)
  await startSession(c, nu as any)
  await audit(c, 'password.change', 'user', u.id)
  return c.json({ ok: true })
})

export default r
