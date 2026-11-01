import { Hono } from 'hono'
import { z } from 'zod'
import { sql, HttpError } from '../db.js'
import { body, me, P, type Env } from '../app.js'
import { requireAuth, signLink } from '../lib/auth.js'
import { audit } from '../lib/audit.js'
import { putFile } from '../lib/storage.js'
import { mergeSettings } from '../../shared/settings.js'
import { istToday, addDaysISO, safetyChecks } from '../../shared/rx.js'
import { normTest } from './patients.js'

const r = new Hono<Env>()
r.use('*', requireAuth())

const MedIn = z.object({
  name: z.string().min(1).max(200), kind: z.enum(['ja', 'brand', 'custom']).optional(), form: z.string().max(20).optional(),
  dose: z.string().max(40).optional(), route: z.string().max(30).optional(), freq: z.string().max(40).optional(),
  timing: z.enum(['', 'after', 'before', 'empty', 'with']).optional(), days: z.number().int().min(0).max(3650).nullable().optional(),
  duration: z.string().max(40).optional(), instructions: z.string().max(200).optional(), price: z.number().nullable().optional(),
})
const RxIn = z.object({ data: z.record(z.string(), z.any()), meds: z.array(MedIn).max(30) })

async function load(c: any, id: string) {
  const [rx] = await sql()`select * from arx.prescriptions where id = ${id} and clinic_id = ${me(c).clinic_id}`
  if (!rx) throw new HttpError(404, 'Prescription not found.')
  return rx
}

export async function rxBundle(clinicId: string, id: string) {
  const [rx] = await sql()`select * from arx.prescriptions where id = ${id} and clinic_id = ${clinicId}`
  if (!rx) throw new HttpError(404, 'Prescription not found.')
  const [p] = await sql()`select * from arx.patients where id = ${rx.patient_id}`
  const [v] = rx.visit_id ? await sql()`select id, token, visit_date, visit_type, status, started_at, finished_at from arx.visits where id = ${rx.visit_id}` : [null]
  const [cl] = await sql()`select id, slug, name, settings from arx.clinics where id = ${clinicId}`
  const [doc] = rx.created_by ? await sql()`select name from arx.users where id = ${rx.created_by}` : [null]
  return { rx, patient: p, visit: v, clinic: { ...cl, settings: mergeSettings(cl.settings) }, author: doc?.name || null }
}

r.get('/:id', async c => c.json(await rxBundle(me(c).clinic_id, P(c, 'id'))))

/** New prescription for a patient outside the queue (e.g. reprint, phone consult). */
r.post('/', requireAuth('doctor', 'admin'), async c => {
  const b = await body(c, z.object({ patient_id: z.string().uuid(), copy_from: z.string().uuid().optional() }))
  const u = me(c)
  const [p] = await sql()`select id from arx.patients where id = ${b.patient_id} and clinic_id = ${u.clinic_id}`
  if (!p) throw new HttpError(404, 'Patient not found.')
  let data: any = { complaints: '', vitals: {}, exam: {}, systemic: {}, comorbid: {}, comorbid_details: {}, addiction: {}, investigations: [], advice: [], diagnosis: '', follow_up: { days: null, note: '' }, hindi: true }
  let meds: any[] = []
  if (b.copy_from) {
    const src = await load(c, b.copy_from)
    data = { ...src.data, vitals: {}, complaints: src.data.complaints || '' }
    meds = src.meds
  }
  const [n] = await sql()`insert into arx.prescriptions (clinic_id, patient_id, rx_date, data, meds, created_by)
    values (${u.clinic_id}, ${b.patient_id}, ${istToday()}, ${sql().json(data)}, ${sql().json(meds)}, ${u.id}) returning id`
  await audit(c, 'rx.create', 'prescription', n.id, { copy_from: b.copy_from })
  return c.json({ rx_id: n.id })
})

/** Autosave (drafts only). */
r.put('/:id', requireAuth('doctor', 'admin'), async c => {
  const b = await body(c, RxIn)
  const rx = await load(c, P(c, 'id'))
  if (rx.status === 'final') throw new HttpError(409, 'This prescription is final. Reopen it to make changes.')
  await sql()`update arx.prescriptions set data = ${sql().json(b.data)}, meds = ${sql().json(b.meds as any)}, updated_at = now() where id = ${rx.id}`
  return c.json({ ok: true, saved_at: new Date().toISOString() })
})

r.post('/:id/finalize', requireAuth('doctor', 'admin'), async c => {
  const b = await body(c, RxIn.extend({ book_follow_up: z.boolean().default(true), override_alerts: z.boolean().default(false) }))
  const u = me(c)
  const rx = await load(c, P(c, 'id'))
  const [p] = await sql()`select * from arx.patients where id = ${rx.patient_id}`
  if (!b.meds.length && !(b.data.advice || []).length && !b.data.diagnosis) throw new HttpError(400, 'Add a diagnosis, medicines or advice before finalising.')
  const egfr = parseFloat(b.data?.comorbid_details?.ckd?.egfr) || null
  const crit = safetyChecks(b.meds as any, { allergies: p.allergies, conditions: [...p.conditions, ...Object.keys(b.data.comorbid || {}).filter(k => b.data.comorbid[k])], egfr, age: p.age_years }).filter(a => a.level === 'crit')
  if (crit.length && !b.override_alerts) throw new HttpError(409, crit.map(a => a.text).join(' '), 'SAFETY')
  const today = istToday()
  await sql().begin(async tx => {
    await tx`update arx.prescriptions set data = ${tx.json(b.data)}, meds = ${tx.json(b.meds as any)}, status = 'final', finalized_at = now(), updated_at = now() where id = ${rx.id}`
    if (rx.visit_id) await tx`update arx.visits set status = 'done', finished_at = coalesce(finished_at, now()) where id = ${rx.visit_id}`
    // learn the doctor's usual dose for each medicine (powers the search defaults)
    for (const m of b.meds) {
      const d = { form: m.form, dose: m.dose, route: m.route, freq: m.freq, timing: m.timing, days: m.days, kind: m.kind }
      await tx`insert into arx.med_usage (clinic_id, name, uses, defaults) values (${u.clinic_id}, ${m.name}, 1, ${tx.json(d as any)})
        on conflict (clinic_id, name) do update set uses = arx.med_usage.uses + 1, last_used = now(), defaults = excluded.defaults`
    }
    // keep chronic conditions on the patient record
    const conds = new Set<string>(p.conditions || [])
    const LBL: Record<string, string> = { diabetes: 'Diabetes', hypertension: 'Hypertension', copd: 'COPD / Asthma', tb: 'Tuberculosis', thyroid: 'Thyroid disorder', cad: 'CAD', ckd: 'CKD', stroke: 'Stroke' }
    for (const k of Object.keys(b.data.comorbid || {})) if (b.data.comorbid[k] && LBL[k]) conds.add(LBL[k])
    await tx`update arx.patients set conditions = ${[...conds]}::text[], updated_at = now() where id = ${p.id}`
    // vitals and GRBS become trend points
    const v = b.data.vitals || {}
    await tx`delete from arx.lab_results where source = 'rx' and document_id is null and patient_id = ${p.id} and result_date = ${rx.rx_date}`
    const pts: [string, string, string][] = []
    if (v.grbs) pts.push(['GRBS', v.grbs, 'mg/dL'])
    if (v.weight) pts.push(['Weight', v.weight, 'kg'])
    const bp = String(v.bp || '').match(/(\d{2,3})\s*\/\s*(\d{2,3})/)
    if (bp) { pts.push(['BP systolic', bp[1], 'mmHg']); pts.push(['BP diastolic', bp[2], 'mmHg']) }
    for (const k of ['hba1c', 'fbs', 'ppbs'] as const) { const val = b.data?.comorbid_details?.diabetes?.[k]; if (val) pts.push([normTest(k), String(val), k === 'hba1c' ? '%' : 'mg/dL']) }
    for (const [test, val, unit] of pts) {
      const n = parseFloat(val)
      if (!isNaN(n)) await tx`insert into arx.lab_results (clinic_id, patient_id, test, value_num, value_text, unit, result_date, source) values (${u.clinic_id}, ${p.id}, ${test}, ${n}, ${val}, ${unit}, ${rx.rx_date}, 'rx')`
    }
    const fu = Number(b.data?.follow_up?.days)
    if (b.book_follow_up && fu > 0 && p.phone) {
      const date = addDaysISO(today, fu)
      const [dup] = await tx`select id from arx.appointments where patient_id = ${p.id} and appt_date = ${date} and status = 'booked'`
      if (!dup) await tx`insert into arx.appointments (clinic_id, patient_id, name, phone, age_years, sex, appt_date, reason, source, created_by)
        values (${u.clinic_id}, ${p.id}, ${p.name}, ${p.phone}, ${p.age_years}, ${p.sex}, ${date}, ${'Follow-up: ' + (b.data.diagnosis || '').slice(0, 80)}, 'follow_up', ${u.id})`
    }
  })
  await audit(c, 'rx.finalize', 'prescription', rx.id, { meds: b.meds.length, overrides: b.override_alerts ? crit.map(a => a.text) : undefined })
  return c.json({ ok: true })
})

r.post('/:id/reopen', requireAuth('doctor', 'admin'), async c => {
  const rx = await load(c, P(c, 'id'))
  await sql()`update arx.prescriptions set status = 'draft', pdf_file_id = null, updated_at = now() where id = ${rx.id}`
  await audit(c, 'rx.reopen', 'prescription', rx.id)
  return c.json({ ok: true })
})

r.delete('/:id', requireAuth('doctor', 'admin'), async c => {
  const rx = await load(c, P(c, 'id'))
  if (rx.status === 'final') throw new HttpError(409, 'Final prescriptions cannot be deleted. Reopen and edit instead.')
  await sql()`delete from arx.prescriptions where id = ${rx.id}`
  await audit(c, 'rx.delete_draft', 'prescription', rx.id)
  return c.json({ ok: true })
})

/** The browser renders the A4 parchi (perfect Hindi shaping) and uploads it here as a PDF. */
r.post('/:id/pdf', async c => {
  const rx = await load(c, P(c, 'id'))
  if (rx.status !== 'final') throw new HttpError(409, 'Finalise the prescription first.')
  const b = await body(c, z.object({ pdf_base64: z.string().max(12_000_000) }))
  const data = Buffer.from(b.pdf_base64, 'base64')
  if (data.subarray(0, 4).toString() !== '%PDF') throw new HttpError(400, 'That is not a PDF.')
  const f = await putFile({ clinicId: me(c).clinic_id, kind: 'rx_pdf', mime: 'application/pdf', data, userId: me(c).id })
  await sql()`update arx.prescriptions set pdf_file_id = ${f.id} where id = ${rx.id}`
  return c.json({ file_id: f.id, url: publicRxUrl(c, rx.id) })
})

export function publicRxUrl(c: any, id: string) {
  const base = process.env.APP_URL || new URL(c.req.url).origin
  return `${base}/api/public/rx/${id}.pdf?t=${signLink('rx', id, 60)}`
}

export default r
