import { Hono } from 'hono'
import { z } from 'zod'
import { sql, HttpError, nextCounter } from '../db.js'
import { body, me, P, type Env } from '../app.js'
import { requireAuth } from '../lib/auth.js'
import { audit } from '../lib/audit.js'
import { PatientIn, createPatient } from './patients.js'
import { istToday, addDaysISO } from '../../shared/rx.js'
import { mergeSettings } from '../../shared/settings.js'

const r = new Hono<Env>()
r.use('*', requireAuth())

const VitalsIn = z.object({ bp: z.string().max(20).optional(), pulse: z.string().max(10).optional(), spo2: z.string().max(10).optional(), temp: z.string().max(10).optional(), rr: z.string().max(10).optional(), grbs: z.string().max(10).optional(), weight: z.string().max(10).optional() }).partial()

r.get('/', async c => {
  const d = c.req.query('date') || istToday()
  return c.json(await sql()`
    select v.*, p.name, p.uhid, p.sex, p.age_years, p.phone, p.allergies, p.conditions,
      rx.id as rx_id, rx.status as rx_status,
      lr.rx_date as last_rx_date,
      b.id as bill_id, b.paid::float as bill_paid, b.mode as bill_mode
    from arx.visits v
    join arx.patients p on p.id = v.patient_id
    left join lateral (select id, status from arx.prescriptions where visit_id = v.id order by created_at desc limit 1) rx on true
    left join lateral (select rx_date from arx.prescriptions where patient_id = v.patient_id and status = 'final' and visit_id is distinct from v.id order by rx_date desc limit 1) lr on true
    left join lateral (select id, paid, mode from arx.bills where visit_id = v.id and status <> 'void' order by created_at desc limit 1) b on true
    where v.clinic_id = ${me(c).clinic_id} and v.visit_date = ${d}
    order by case v.status when 'with_doctor' then 0 when 'waiting' then 1 when 'done' then 2 else 3 end, v.token`)
})

export async function addVisit(tx: any, cid: string, userId: string, o: { patient_id: string; complaint?: string | null; vitals?: object; source?: string; appointment_id?: string | null; visit_type?: string | null }) {
  const d = istToday()
  const [existing] = await tx`select id, token from arx.visits where clinic_id = ${cid} and patient_id = ${o.patient_id} and visit_date = ${d} and status in ('waiting','with_doctor')`
  if (existing) throw new HttpError(409, `Already in today's queue as token ${existing.token}.`)
  const [cl] = await tx`select settings from arx.clinics where id = ${cid}`
  const s = mergeSettings(cl.settings)
  let type = o.visit_type
  if (!type) {
    const [last] = await tx`select max(rx_date) as d from arx.prescriptions where patient_id = ${o.patient_id} and status = 'final'`
    type = last?.d && String(last.d instanceof Date ? last.d.toISOString().slice(0, 10) : last.d) >= addDaysISO(d, -s.fees.follow_up_days) ? 'follow_up' : 'new'
  }
  const token = await nextCounter(tx, cid, `token:${d}`)
  const [v] = await tx`insert into arx.visits (clinic_id, patient_id, visit_date, token, complaint, vitals, source, appointment_id, visit_type, created_by)
    values (${cid}, ${o.patient_id}, ${d}, ${token}, ${o.complaint ?? null}, ${tx.json((o.vitals || {}) as any)}, ${o.source || 'walk_in'}, ${o.appointment_id ?? null}, ${type}, ${userId}) returning *`
  await tx`update arx.patients set updated_at = now() where id = ${o.patient_id}`
  return v
}

r.post('/', async c => {
  const b = await body(c, z.object({
    patient_id: z.string().uuid().optional(), patient: PatientIn.optional(),
    complaint: z.string().max(500).nullable().optional(), vitals: VitalsIn.optional(),
    visit_type: z.enum(['new', 'follow_up', 'review']).nullable().optional(),
  }))
  if (!b.patient_id && !b.patient) throw new HttpError(400, 'Choose or register a patient.')
  const u = me(c)
  const v = await sql().begin(async tx => {
    let pid = b.patient_id
    if (pid) {
      const [p] = await tx`select id from arx.patients where id = ${pid} and clinic_id = ${u.clinic_id}`
      if (!p) throw new HttpError(404, 'Patient not found.')
    } else pid = (await createPatient(tx, u.clinic_id, b.patient!)).id
    return addVisit(tx, u.clinic_id, u.id, { patient_id: pid!, complaint: b.complaint, vitals: b.vitals, visit_type: b.visit_type })
  })
  await audit(c, 'visit.create', 'visit', v.id, { token: v.token })
  return c.json(v)
})

r.patch('/:id', async c => {
  const b = await body(c, z.object({ status: z.enum(['waiting', 'with_doctor', 'done', 'cancelled']).optional(), complaint: z.string().max(500).nullable().optional(), vitals: VitalsIn.optional(), visit_type: z.enum(['new', 'follow_up', 'review']).optional() }))
  const [v] = await sql()`update arx.visits set
      status = coalesce(${b.status ?? null}, status), complaint = ${b.complaint === undefined ? sql()`complaint` : b.complaint},
      vitals = case when ${b.vitals ? sql().json(b.vitals as any) : null}::jsonb is null then vitals else vitals || ${b.vitals ? sql().json(b.vitals as any) : null}::jsonb end,
      visit_type = coalesce(${b.visit_type ?? null}, visit_type),
      finished_at = case when ${b.status ?? null} = 'done' then now() else finished_at end
    where id = ${P(c, 'id')} and clinic_id = ${me(c).clinic_id} returning *`
  if (!v) throw new HttpError(404, 'Visit not found.')
  if (b.status) await audit(c, `visit.${b.status}`, 'visit', v.id)
  return c.json(v)
})

/** Doctor opens a visit: marks it with_doctor and returns the draft prescription (created if needed). */
r.post('/:id/start', requireAuth('doctor', 'admin'), async c => {
  const u = me(c)
  const rx = await sql().begin(async tx => {
    const [v] = await tx`select * from arx.visits where id = ${P(c, 'id')} and clinic_id = ${u.clinic_id} for update`
    if (!v) throw new HttpError(404, 'Visit not found.')
    if (v.status === 'waiting') await tx`update arx.visits set status = 'with_doctor', started_at = coalesce(started_at, now()) where id = ${v.id}`
    const [ex] = await tx`select id from arx.prescriptions where visit_id = ${v.id} order by created_at desc limit 1`
    if (ex) return ex
    const data = { complaints: v.complaint || '', vitals: v.vitals || {}, exam: {}, systemic: {}, comorbid: {}, comorbid_details: {}, addiction: {}, investigations: [], advice: [], diagnosis: '', follow_up: { days: null, note: '' }, hindi: true }
    // carry chronic conditions and comorbidity details forward from the last final prescription
    const [last] = await tx`select data from arx.prescriptions where patient_id = ${v.patient_id} and status = 'final' order by rx_date desc, created_at desc limit 1`
    if (last) { data.comorbid = last.data.comorbid || {}; data.comorbid_details = last.data.comorbid_details || {}; data.addiction = last.data.addiction || {} }
    const [n] = await tx`insert into arx.prescriptions (clinic_id, patient_id, visit_id, rx_date, data, created_by)
      values (${u.clinic_id}, ${v.patient_id}, ${v.id}, ${istToday()}, ${tx.json(data as any)}, ${u.id}) returning id`
    return n
  })
  return c.json({ rx_id: rx.id })
})

/** Next waiting token. */
r.post('/next', requireAuth('doctor', 'admin'), async c => {
  const [v] = await sql()`select id from arx.visits where clinic_id = ${me(c).clinic_id} and visit_date = ${istToday()} and status = 'waiting' order by token limit 1`
  if (!v) throw new HttpError(404, 'No one is waiting.')
  return c.json({ visit_id: v.id })
})

export default r
