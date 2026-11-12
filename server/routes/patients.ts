import { Hono } from 'hono'
import { z } from 'zod'
import { sql, HttpError, nextCounter } from '../db.js'
import { body, me, P, type Env } from '../app.js'
import { requireAuth, verifyPassword } from '../lib/auth.js'
import { audit } from '../lib/audit.js'
import { rateLimit } from '../lib/ratelimit.js'
import { mergeSettings } from '../../shared/settings.js'
import { normPhone, istToday } from '../../shared/rx.js'

const r = new Hono<Env>()
r.use('*', requireAuth())

export const PatientIn = z.object({
  name: z.string().trim().min(2, 'Enter the patient name').max(120),
  sex: z.enum(['M', 'F', 'O']).nullable().optional(),
  age_years: z.coerce.number().int().min(0).max(125).nullable().optional(),
  phone: z.string().max(20).nullable().optional(),
  address: z.string().max(300).nullable().optional(),
  allergies: z.array(z.string().max(80)).max(20).optional(),
  conditions: z.array(z.string().max(80)).max(30).optional(),
  notes: z.string().max(2000).nullable().optional(),
})

export async function createPatient(tx: any, clinicId: string, p: z.infer<typeof PatientIn>) {
  const [cl] = await tx`select settings from arx.clinics where id = ${clinicId}`
  const n = await nextCounter(tx, clinicId, 'uhid')
  const uhid = `${mergeSettings(cl.settings).uhid_prefix}-${String(n).padStart(5, '0')}`
  const phone = p.phone ? normPhone(p.phone) : null
  if (phone && !/^[0-9]{10}$/.test(phone)) throw new HttpError(400, 'Mobile number must be 10 digits.')
  const [row] = await tx`insert into arx.patients (clinic_id, uhid, name, sex, age_years, phone, address, allergies, conditions, notes)
    values (${clinicId}, ${uhid}, ${p.name.trim()}, ${p.sex ?? null}, ${p.age_years ?? null}, ${phone}, ${p.address ?? null},
      ${p.allergies ?? []}::text[], ${p.conditions ?? []}::text[], ${p.notes ?? null}) returning *`
  return row
}

/** The full patient list, a page at a time, with the total so the screen can say "101 patients".
    sort: visit (most recent visit first, default), name (A to Z), new (most recently added). */
r.get('/browse', async c => {
  const cid = me(c).clinic_id
  const limit = Math.min(200, Math.max(1, Number(c.req.query('limit')) || 50)), offset = Math.max(0, Number(c.req.query('offset')) || 0)
  const sort = c.req.query('sort') === 'name' ? 'name' : c.req.query('sort') === 'new' ? 'new' : 'visit'
  const order = sort === 'name' ? sql()`lower(p.name), p.uhid` : sort === 'new' ? sql()`p.created_at desc, p.uhid desc` : sql()`v.last_visit desc nulls last, p.updated_at desc`
  const [rows, [t]] = await sql().begin(db => Promise.all([
    db`select p.*, v.last_visit, coalesce(v.visit_count, 0)::int as visit_count
       from arx.patients p
       left join lateral (select max(visit_date) as last_visit, count(*) as visit_count from arx.visits x where x.patient_id = p.id and x.status <> 'cancelled') v on true
       where p.clinic_id = ${cid} and p.archived_at is null order by ${order} limit ${limit} offset ${offset}`,
    db`select count(*)::int as total from arx.patients where clinic_id = ${cid} and archived_at is null`,
  ]))
  return c.json({ rows, total: t.total, offset, limit, sort })
})

/** Removed (archived) patients, newest removal first, with what is being kept for each one.
    Registered before `/:id` so the word "archived" is not read as a patient id. */
r.get('/archived', requireAuth('doctor', 'admin'), async c => {
  const cid = me(c).clinic_id
  return c.json(await sql()`select p.id, p.uhid, p.name, p.sex, p.age_years, p.phone, p.archived_at, p.archive_reason, u.name as archived_by_name,
      (select count(*)::int from arx.visits v where v.patient_id = p.id and v.status <> 'cancelled') as visit_count,
      (select count(*)::int from arx.prescriptions x where x.patient_id = p.id) as rx_count
    from arx.patients p left join arx.users u on u.id = p.archived_by
    where p.clinic_id = ${cid} and p.archived_at is not null order by p.archived_at desc limit 200`)
})

r.get('/', async c => {
  const cid = me(c).clinic_id
  const q = (c.req.query('q') || '').trim()
  if (!q) return c.json(await sql()`select p.*, (select max(visit_date) from arx.visits v where v.patient_id = p.id) as last_visit
    from arx.patients p where clinic_id = ${cid} and archived_at is null order by updated_at desc limit 30`)
  const digits = q.replace(/\D/g, '')
  if (digits.length >= 4 && digits.length === q.replace(/[\s+-]/g, '').length) {
    return c.json(await sql()`select p.*, (select max(visit_date) from arx.visits v where v.patient_id = p.id) as last_visit
      from arx.patients p where clinic_id = ${cid} and archived_at is null and phone like ${'%' + normPhone(digits).slice(-10) + '%'} order by updated_at desc limit 30`)
  }
  return c.json(await sql()`select p.*, (select max(visit_date) from arx.visits v where v.patient_id = p.id) as last_visit
    from arx.patients p
    where clinic_id = ${cid} and archived_at is null and (lower(name) like ${'%' + q.toLowerCase() + '%'} or uhid ilike ${q + '%'} or lower(name) operator(extensions.%) ${q.toLowerCase()})
    order by (lower(name) like ${q.toLowerCase() + '%'}) desc, extensions.similarity(lower(name), ${q.toLowerCase()}) desc, updated_at desc limit 30`)
})

r.post('/', async c => {
  const b = await body(c, PatientIn)
  const p = await sql().begin(tx => createPatient(tx, me(c).clinic_id, b))
  await audit(c, 'patient.create', 'patient', p.id)
  return c.json(p)
})

/** `light` (used when opening a consult): only what the consult screen shows, and the 40 most recent prescriptions. */
export async function patientDetail(cid: string, id: string, light = false) {
  const none = Promise.resolve([] as any[])
  // One connection, queries pipelined in one round trip. Seven separate queries on a 4-connection pool behind the
  // Supabase pooler were the request that kept stalling (CONNECTION_DESTROYED / timeouts) on every deployment.
  const [[p], visits, rxs, docs, labs, bills, appts] = await sql().begin(db => Promise.all([
    db`select p.*, u.name as archived_by_name from arx.patients p left join arx.users u on u.id = p.archived_by where p.id = ${id} and p.clinic_id = ${cid}`,
    light ? none : db`select id, visit_date, token, status, visit_type, complaint, source, vitals from arx.visits where patient_id = ${id} and clinic_id = ${cid} and status <> 'cancelled' order by visit_date desc, token desc limit 200`,
    db`select id, rx_date, status, data->>'diagnosis' as diagnosis, data->>'complaints' as complaints, data->'vitals' as vitals, jsonb_array_length(meds) as med_count, meds, legacy_id is not null as imported
       from arx.prescriptions where patient_id = ${id} and clinic_id = ${cid} order by rx_date desc, created_at desc limit ${light ? 40 : 200}`,
    light ? none : db`select id, kind, doc_date, extracted, file_id, created_at from arx.documents where patient_id = ${id} and clinic_id = ${cid} order by created_at desc`,
    db`select id, test, value_num::float as value_num, value_text, unit, flag, result_date, source from arx.lab_results where patient_id = ${id} and clinic_id = ${cid} order by result_date`,
    db`select id, bill_no, total::float, paid::float, mode, status, bill_date from arx.bills where patient_id = ${id} and clinic_id = ${cid} order by created_at desc limit 50`,
    light ? none : db`select id, appt_date, appt_time, status, reason, source from arx.appointments where patient_id = ${id} and clinic_id = ${cid} and appt_date >= ${istToday()} order by appt_date`,
  ]))
  if (!p) throw new HttpError(404, 'Patient not found.')
  return { patient: p, visits, prescriptions: rxs, documents: docs, labs, bills, upcoming: appts }
}

r.get('/:id', async c => c.json(await patientDetail(me(c).clinic_id, P(c, 'id'))))

r.put('/:id', async c => {
  const b = await body(c, PatientIn.partial())
  const phone = b.phone === undefined ? undefined : b.phone ? normPhone(b.phone) : null
  if (phone && !/^[0-9]{10}$/.test(phone)) throw new HttpError(400, 'Mobile number must be 10 digits.')
  const [p] = await sql()`update arx.patients set
      name = coalesce(${b.name ?? null}, name), sex = ${b.sex === undefined ? sql()`sex` : b.sex},
      age_years = ${b.age_years === undefined ? sql()`age_years` : b.age_years}, phone = ${phone === undefined ? sql()`phone` : phone},
      address = ${b.address === undefined ? sql()`address` : b.address},
      allergies = coalesce(${b.allergies ?? null}::text[], allergies), conditions = coalesce(${b.conditions ?? null}::text[], conditions),
      notes = ${b.notes === undefined ? sql()`notes` : b.notes}, updated_at = now()
    where id = ${P(c, 'id')} and clinic_id = ${me(c).clinic_id} and archived_at is null returning *`
  if (!p) throw new HttpError(404, 'Patient not found.')
  await audit(c, 'patient.update', 'patient', p.id, { fields: Object.keys(b) })
  return c.json(p)
})

r.post('/:id/labs', async c => {
  const b = await body(c, z.object({ items: z.array(z.object({ test: z.string().min(1).max(60), value: z.string().max(40), unit: z.string().max(20).optional(), flag: z.enum(['low', 'high', 'normal', 'abnormal']).nullable().optional(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })).min(1).max(50), document_id: z.string().uuid().optional(), source: z.enum(['manual', 'scan']).default('manual') }))
  const cid = me(c).clinic_id, pid = P(c, 'id')
  const [p] = await sql()`select id from arx.patients where id = ${pid} and clinic_id = ${cid} and archived_at is null`
  if (!p) throw new HttpError(404, 'Patient not found.')
  for (const i of b.items) {
    const num = parseFloat(i.value.replace(/[^0-9.\-]/g, ''))
    await sql()`insert into arx.lab_results (clinic_id, patient_id, test, value_num, value_text, unit, flag, result_date, source, document_id)
      values (${cid}, ${pid}, ${normTest(i.test)}, ${isNaN(num) ? null : num}, ${i.value}, ${i.unit ?? null}, ${i.flag ?? null}, ${i.date}, ${b.source}, ${b.document_id ?? null})`
  }
  await audit(c, 'labs.add', 'patient', pid, { count: b.items.length })
  return c.json({ ok: true })
})
r.delete('/:id/labs/:lab', async c => {
  await sql()`delete from arx.lab_results where id = ${P(c, 'lab')} and patient_id = ${P(c, 'id')} and clinic_id = ${me(c).clinic_id}`
  await audit(c, 'labs.delete', 'lab', P(c, 'lab'))
  return c.json({ ok: true })
})

/** The doctor types their own login password again before a patient disappears from the clinic's screens.
    Rate limited per user so the password box cannot be used to guess the password. */
async function confirmPassword(c: any, password: string) {
  const u = me(c)
  await rateLimit(`pwconfirm:${u.id}`, 10, 900)
  const [row] = await sql()`select password_hash from arx.users where id = ${u.id}`
  if (!row || !(await verifyPassword(password, row.password_hash))) throw new HttpError(401, 'That is not your password.', 'BAD_PASSWORD')
}

/** Remove a patient: hides them from the patient list, search, the queue, Ask Arogya and the dashboard count.
    Nothing is deleted — visits, prescriptions, lab values, documents, bills and recordings all stay, and
    Settings → Security → Removed patients puts the patient back exactly as they were. Doctor only. */
r.post('/:id/archive', requireAuth('doctor', 'admin'), async c => {
  const b = await body(c, z.object({ password: z.string().min(1).max(200), reason: z.string().trim().max(200).optional() }))
  await confirmPassword(c, b.password)
  const u = me(c), cid = u.clinic_id, pid = P(c, 'id')
  const [p] = await sql()`select id, name, uhid, phone, archived_at from arx.patients where id = ${pid} and clinic_id = ${cid}`
  if (!p) throw new HttpError(404, 'Patient not found.')
  if (p.archived_at) throw new HttpError(409, 'This patient is already removed.')
  const [counts] = await sql().begin(db => Promise.all([
    db`select (select count(*)::int from arx.visits where patient_id = ${pid} and status <> 'cancelled') as visits,
         (select count(*)::int from arx.prescriptions where patient_id = ${pid}) as prescriptions`,
    // nothing of theirs should be left waiting on a screen: today's token and any appointment still to come are cancelled
    db`update arx.visits set status = 'cancelled' where patient_id = ${pid} and clinic_id = ${cid} and status in ('waiting', 'with_doctor')`,
    db`update arx.appointments set status = 'cancelled' where patient_id = ${pid} and clinic_id = ${cid} and status = 'booked' and appt_date >= ${istToday()}`,
    db`update arx.patients set archived_at = now(), archived_by = ${u.id}, archive_reason = ${b.reason ?? null}, updated_at = now()
       where id = ${pid} and clinic_id = ${cid}`,
  ]))
  // the activity log keeps who the patient was, so a removal is never a mystery row later
  await audit(c, 'patient.archive', 'patient', pid, { name: p.name, uhid: p.uhid, phone: p.phone, reason: b.reason ?? null, ...counts[0] })
  return c.json({ ok: true, ...counts[0] })
})

/** Put a removed patient back. Doctor only, password again. */
r.post('/:id/restore', requireAuth('doctor', 'admin'), async c => {
  const b = await body(c, z.object({ password: z.string().min(1).max(200) }))
  await confirmPassword(c, b.password)
  const cid = me(c).clinic_id, pid = P(c, 'id')
  const [p] = await sql()`update arx.patients set archived_at = null, archived_by = null, archive_reason = null, updated_at = now()
    where id = ${pid} and clinic_id = ${cid} and archived_at is not null returning id, name, uhid`
  if (!p) throw new HttpError(404, 'No removed patient with that id.')
  await audit(c, 'patient.restore', 'patient', pid, { name: p.name, uhid: p.uhid })
  return c.json({ ok: true, patient: p })
})

export function normTest(t: string): string {
  const s = t.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
  const map: Record<string, string> = { hba1c: 'HbA1c', glycatedhaemoglobin: 'HbA1c', glycatedhemoglobin: 'HbA1c', fbs: 'FBS', fastingbloodsugar: 'FBS', fastingglucose: 'FBS', ppbs: 'PPBS', postprandial: 'PPBS', rbs: 'RBS', randombloodsugar: 'RBS', hb: 'Hb', haemoglobin: 'Hb', hemoglobin: 'Hb', tsh: 'TSH', creatinine: 'S. creatinine', screatinine: 'S. creatinine', serumcreatinine: 'S. creatinine', egfr: 'eGFR', totalcholesterol: 'Total cholesterol', cholesterol: 'Total cholesterol', ldl: 'LDL', ldlcholesterol: 'LDL', hdl: 'HDL', triglycerides: 'Triglycerides', tg: 'Triglycerides', urea: 'Urea', bloodurea: 'Urea', uricacid: 'Uric acid', suricacid: 'Uric acid', sgpt: 'SGPT', alt: 'SGPT', sgot: 'SGOT', ast: 'SGOT', vitamind: 'Vitamin D', vitb12: 'Vitamin B12', vitaminb12: 'Vitamin B12', platelets: 'Platelets', plateletcount: 'Platelets', tlc: 'TLC', wbc: 'TLC', sodium: 'Sodium', na: 'Sodium', potassium: 'Potassium', k: 'Potassium' }
  return map[s] || t.trim()
}

export default r
