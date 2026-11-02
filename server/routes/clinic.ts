import { Hono } from 'hono'
import { z } from 'zod'
import { sql, HttpError, dbRegion } from '../db.js'
import { body, me, P, type Env } from '../app.js'
import { requireAuth, hashPassword, forgetUser } from '../lib/auth.js'
import { audit } from '../lib/audit.js'
import { putFile, getFile } from '../lib/storage.js'
import { mergeSettings } from '../../shared/settings.js'
import { normPhone } from '../../shared/rx.js'

const r = new Hono<Env>()
r.use('*', requireAuth())

r.get('/', async c => {
  const [cl] = await sql()`select id, slug, name, settings from arx.clinics where id = ${me(c).clinic_id}`
  return c.json({ ...cl, settings: mergeSettings(cl.settings) })
})

r.put('/settings', requireAuth('doctor', 'admin'), async c => {
  const b = await body(c, z.object({ name: z.string().min(2).max(120).optional(), settings: z.record(z.string(), z.any()) }))
  const s = mergeSettings(b.settings)
  if (s.fees.upi_vpa && !/^[\w.\-]{2,}@[\w]{2,}$/.test(s.fees.upi_vpa)) throw new HttpError(400, 'UPI ID looks wrong (example: arogyaclinic@sbi).')
  const [cl] = await sql()`update arx.clinics set settings = ${sql().json(s as any)}, name = coalesce(${b.name ?? null}, name) where id = ${me(c).clinic_id} returning id, slug, name, settings`
  await audit(c, 'settings.update', 'clinic', cl.id)
  return c.json({ ...cl, settings: mergeSettings(cl.settings) })
})

r.post('/upload/:kind', requireAuth('doctor', 'admin'), async c => {
  const kind = P(c, 'kind')
  if (!['logo', 'signature'].includes(kind)) throw new HttpError(400, 'Unknown upload type.')
  const b = await body(c, z.object({ data_url: z.string().max(4_000_000) }))
  const m = b.data_url.match(/^data:(image\/(png|jpeg|webp));base64,(.+)$/)
  if (!m) throw new HttpError(400, 'Upload a PNG, JPG or WebP image.')
  const f = await putFile({ clinicId: me(c).clinic_id, kind, mime: m[1], data: Buffer.from(m[3], 'base64'), userId: me(c).id })
  const [cl] = await sql()`select settings from arx.clinics where id = ${me(c).clinic_id}`
  const s = mergeSettings(cl.settings)
  if (kind === 'logo') s.letterhead.logo_file_id = f.id; else s.letterhead.signature_file_id = f.id
  await sql()`update arx.clinics set settings = ${sql().json(s as any)} where id = ${me(c).clinic_id}`
  await audit(c, `upload.${kind}`, 'file', f.id)
  return c.json({ file_id: f.id })
})

r.get('/files/:id', async c => {
  const f = await getFile(P(c, 'id'), me(c).clinic_id)
  return new Response(new Uint8Array(f.data), { headers: { 'Content-Type': f.mime, 'Cache-Control': 'private, max-age=86400' } })
})

/* ---- staff ---- */
r.get('/staff', requireAuth('doctor', 'admin'), async c => {
  return c.json(await sql()`select id, name, phone, role, active, last_login_at, created_at from arx.users where clinic_id = ${me(c).clinic_id} order by created_at`)
})
r.post('/staff', requireAuth('doctor', 'admin'), async c => {
  const b = await body(c, z.object({ name: z.string().min(2).max(120), phone: z.string(), role: z.enum(['doctor', 'reception', 'admin']), password: z.string().min(8, 'Use at least 8 characters') }))
  const phone = normPhone(b.phone)
  if (!/^[0-9]{10}$/.test(phone)) throw new HttpError(400, 'Mobile number must be 10 digits.')
  const [u] = await sql()`insert into arx.users (clinic_id, name, phone, password_hash, role) values (${me(c).clinic_id}, ${b.name}, ${phone}, ${await hashPassword(b.password)}, ${b.role}) returning id, name, phone, role, active`
  await audit(c, 'staff.create', 'user', u.id, { role: b.role })
  return c.json(u)
})
r.patch('/staff/:id', requireAuth('doctor', 'admin'), async c => {
  const b = await body(c, z.object({ active: z.boolean().optional(), role: z.enum(['doctor', 'reception', 'admin']).optional(), password: z.string().min(8).optional(), name: z.string().min(2).optional() }))
  const id = P(c, 'id')
  if (id === me(c).id && (b.active === false || (b.role && b.role !== me(c).role))) throw new HttpError(400, 'You cannot deactivate or change your own role.')
  const ph = b.password ? await hashPassword(b.password) : null
  const [u] = await sql()`update arx.users set
      active = coalesce(${b.active ?? null}, active), role = coalesce(${b.role ?? null}, role), name = coalesce(${b.name ?? null}, name),
      password_hash = coalesce(${ph}, password_hash),
      session_version = session_version + ${b.password || b.active === false || b.role ? 1 : 0}
    where id = ${id} and clinic_id = ${me(c).clinic_id} returning id, name, phone, role, active`
  if (!u) throw new HttpError(404, 'Staff member not found.')
  forgetUser(id)
  await audit(c, 'staff.update', 'user', id, { active: b.active, role: b.role, password_reset: !!b.password })
  return c.json(u)
})

r.get('/audit', requireAuth('doctor', 'admin'), async c => {
  return c.json(await sql()`select a.id, a.action, a.entity, a.entity_id, a.meta, a.ip, a.at, u.name as user_name
    from arx.audit_log a left join arx.users u on u.id = a.user_id where a.clinic_id = ${me(c).clinic_id} order by a.at desc limit 200`)
})

/** Where the server and the database run, how long one query takes, and how many records exist.
    Used by Settings → Security → Speed check to confirm the Mumbai move and to compare counts after a restore. */
r.get('/system', requireAuth('doctor', 'admin'), async c => {
  const cid = me(c).clinic_id, db = sql()
  await db`select 1`                                   // first query pays for connection setup; time the second
  const t0 = performance.now(); await db`select 1`; const db_ms = Math.round(performance.now() - t0)
  const [n] = await db`select
      (select count(*) from arx.patients where clinic_id = ${cid})::int as patients,
      (select count(*) from arx.prescriptions where clinic_id = ${cid})::int as prescriptions,
      (select count(*) from arx.prescriptions where clinic_id = ${cid} and status = 'final')::int as final_prescriptions,
      (select count(*) from arx.visits where clinic_id = ${cid})::int as visits,
      (select count(*) from arx.bills where clinic_id = ${cid})::int as bills,
      (select count(*) from arx.lab_results where clinic_id = ${cid})::int as lab_results,
      (select count(*) from arx.documents where clinic_id = ${cid})::int as documents,
      (select count(*) from arx.files where clinic_id = ${cid})::int as files,
      (select count(*) from arx.medicines)::int as medicines`
  return c.json({ fn_region: process.env.VERCEL_REGION || null, db_region: dbRegion(), db_ms, counts: n })
})

/* ---- dashboard summary ---- */
r.get('/summary', async c => {
  const cid = me(c).clinic_id
  const d = c.req.query('date') || new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())
  const [v] = await sql()`select count(*)::int as total,
      count(*) filter (where status = 'waiting')::int as waiting, count(*) filter (where status = 'with_doctor')::int as with_doctor,
      count(*) filter (where status = 'done')::int as done, count(*) filter (where visit_type = 'new')::int as new_visits
    from arx.visits where clinic_id = ${cid} and visit_date = ${d}`
  const [a] = await sql()`select count(*) filter (where status = 'booked')::int as booked, count(*) filter (where source = 'online')::int as online
    from arx.appointments where clinic_id = ${cid} and appt_date = ${d}`
  const [b] = await sql()`select coalesce(sum(paid),0)::float as collected, coalesce(sum(paid) filter (where mode='cash'),0)::float as cash,
      coalesce(sum(paid) filter (where mode='upi'),0)::float as upi, count(*)::int as bills
    from arx.bills where clinic_id = ${cid} and bill_date = ${d} and status <> 'void'`
  const [w] = await sql()`select count(*)::int as n from arx.visits where clinic_id = ${cid} and visit_date > (${d}::date - 7)`
  const [t] = await sql()`select coalesce(avg(extract(epoch from (finished_at - started_at))) filter (where finished_at > started_at and finished_at - started_at < interval '2 hours'), 0)::float as avg_secs
    from arx.visits where clinic_id = ${cid} and visit_date = ${d} and status = 'done'`
  const [m] = await sql()`select count(*)::int as n from arx.messages where clinic_id = ${cid} and kind = 'rx' and status <> 'failed' and created_at >= (${d}::date::timestamp at time zone 'Asia/Kolkata')`
  const [sv] = await sql()`select coalesce(sum((data->'cost'->>'save')::numeric), 0)::float as saved from arx.prescriptions where clinic_id = ${cid} and rx_date = ${d} and status = 'final'`
  return c.json({ date: d, visits: v, appointments: a, bills: b, week_visits: w.n, avg_secs: t.avg_secs, wa_sent: m.n, saved: sv.saved })
})

export default r
