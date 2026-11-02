import { Hono } from 'hono'
import { z } from 'zod'
import { sql, HttpError, nextCounter } from '../db.js'
import { body, me, P, type Env } from '../app.js'
import { requireAuth } from '../lib/auth.js'
import { audit } from '../lib/audit.js'
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

r.get('/', async c => {
  const cid = me(c).clinic_id
  const q = (c.req.query('q') || '').trim()
  if (!q) return c.json(await sql()`select p.*, (select max(visit_date) from arx.visits v where v.patient_id = p.id) as last_visit
    from arx.patients p where clinic_id = ${cid} order by updated_at desc limit 30`)
  const digits = q.replace(/\D/g, '')
  if (digits.length >= 4 && digits.length === q.replace(/[\s+-]/g, '').length) {
    return c.json(await sql()`select p.*, (select max(visit_date) from arx.visits v where v.patient_id = p.id) as last_visit
      from arx.patients p where clinic_id = ${cid} and phone like ${'%' + normPhone(digits).slice(-10) + '%'} order by updated_at desc limit 30`)
  }
  return c.json(await sql()`select p.*, (select max(visit_date) from arx.visits v where v.patient_id = p.id) as last_visit
    from arx.patients p
    where clinic_id = ${cid} and (lower(name) like ${'%' + q.toLowerCase() + '%'} or uhid ilike ${q + '%'} or lower(name) operator(extensions.%) ${q.toLowerCase()})
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
  const db = sql(), none = Promise.resolve([] as any[])
  const [[p], visits, rxs, docs, labs, bills, appts] = await Promise.all([
    db`select * from arx.patients where id = ${id} and clinic_id = ${cid}`,
    light ? none : db`select id, visit_date, token, status, visit_type, complaint from arx.visits where patient_id = ${id} order by visit_date desc, token desc limit 100`,
    db`select id, rx_date, status, data->>'diagnosis' as diagnosis, data->>'complaints' as complaints, data->'vitals' as vitals, jsonb_array_length(meds) as med_count, meds, legacy_id is not null as imported
       from arx.prescriptions where patient_id = ${id} and clinic_id = ${cid} order by rx_date desc, created_at desc limit ${light ? 40 : 200}`,
    light ? none : db`select id, kind, doc_date, extracted, file_id, created_at from arx.documents where patient_id = ${id} and clinic_id = ${cid} order by created_at desc`,
    db`select id, test, value_num::float as value_num, value_text, unit, flag, result_date, source from arx.lab_results where patient_id = ${id} and clinic_id = ${cid} order by result_date`,
    db`select id, bill_no, total::float, paid::float, mode, status, bill_date from arx.bills where patient_id = ${id} and clinic_id = ${cid} order by created_at desc limit 50`,
    light ? none : db`select id, appt_date, appt_time, status, reason, source from arx.appointments where patient_id = ${id} and clinic_id = ${cid} and appt_date >= ${istToday()} order by appt_date`,
  ])
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
    where id = ${P(c, 'id')} and clinic_id = ${me(c).clinic_id} returning *`
  if (!p) throw new HttpError(404, 'Patient not found.')
  await audit(c, 'patient.update', 'patient', p.id, { fields: Object.keys(b) })
  return c.json(p)
})

r.post('/:id/labs', async c => {
  const b = await body(c, z.object({ items: z.array(z.object({ test: z.string().min(1).max(60), value: z.string().max(40), unit: z.string().max(20).optional(), flag: z.enum(['low', 'high', 'normal', 'abnormal']).nullable().optional(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })).min(1).max(50), document_id: z.string().uuid().optional(), source: z.enum(['manual', 'scan']).default('manual') }))
  const cid = me(c).clinic_id, pid = P(c, 'id')
  const [p] = await sql()`select id from arx.patients where id = ${pid} and clinic_id = ${cid}`
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

export function normTest(t: string): string {
  const s = t.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
  const map: Record<string, string> = { hba1c: 'HbA1c', glycatedhaemoglobin: 'HbA1c', glycatedhemoglobin: 'HbA1c', fbs: 'FBS', fastingbloodsugar: 'FBS', fastingglucose: 'FBS', ppbs: 'PPBS', postprandial: 'PPBS', rbs: 'RBS', randombloodsugar: 'RBS', hb: 'Hb', haemoglobin: 'Hb', hemoglobin: 'Hb', tsh: 'TSH', creatinine: 'S. creatinine', screatinine: 'S. creatinine', serumcreatinine: 'S. creatinine', egfr: 'eGFR', totalcholesterol: 'Total cholesterol', cholesterol: 'Total cholesterol', ldl: 'LDL', ldlcholesterol: 'LDL', hdl: 'HDL', triglycerides: 'Triglycerides', tg: 'Triglycerides', urea: 'Urea', bloodurea: 'Urea', uricacid: 'Uric acid', suricacid: 'Uric acid', sgpt: 'SGPT', alt: 'SGPT', sgot: 'SGOT', ast: 'SGOT', vitamind: 'Vitamin D', vitb12: 'Vitamin B12', vitaminb12: 'Vitamin B12', platelets: 'Platelets', plateletcount: 'Platelets', tlc: 'TLC', wbc: 'TLC', sodium: 'Sodium', na: 'Sodium', potassium: 'Potassium', k: 'Potassium' }
  return map[s] || t.trim()
}

export default r
