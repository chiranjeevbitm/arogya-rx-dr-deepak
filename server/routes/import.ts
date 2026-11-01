/* One-time import from the old DoctorAppointmentForm database (OLD_DATABASE_URL).
   Runs in batches from Settings → Import. Re-running is safe: rows are keyed by legacy ids. */
import { Hono } from 'hono'
import { z } from 'zod'
import postgres from 'postgres'
import { sql, HttpError } from '../db.js'
import { body, me, type Env } from '../app.js'
import { requireAuth } from '../lib/auth.js'
import { audit } from '../lib/audit.js'
import { createPatient } from './patients.js'
import { detectForm, normFreq, defaultRoute } from '../../shared/rx.js'

const r = new Hono<Env>()
r.use('*', requireAuth('doctor', 'admin'))

let old: postgres.Sql | null = null
function oldDb() {
  const url = process.env.OLD_DATABASE_URL
  if (!url) throw new HttpError(503, 'OLD_DATABASE_URL is not set in the Vercel settings.')
  if (!old) old = postgres(url, { max: 2, prepare: false, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : 'require', connect_timeout: 15, onnotice: () => {} })
  return old
}

const s = (v: any) => (v == null ? '' : String(v).trim())
const yes = (v: any) => v === 1 || v === true || v === '1' || /^(yes|true|present)$/i.test(s(v))
const lines = (v: any) => s(v).split(/\r?\n|;/).map(x => x.replace(/^[•\-*\d.)\s]+/, '').trim()).filter(Boolean)

export function mapOldRx(o: any) {
  const det = (pfx: string, keys: string[]) => {
    const d: Record<string, any> = {}
    for (const k of keys) { const v = o[`${pfx}_${k}`]; if (v != null && v !== '' && v !== 0) d[k] = typeof v === 'number' && ['neuropathy', 'retinopathy', 'nephropathy', 'cad', 'foot', 'lvh', 'ckd', 'stroke', 'pht', 'cor_pulmonale', 'cabg', 'pci', 'stenting', 'dialysis'].includes(k) ? v === 1 : v }
    return d
  }
  const cvsBits = [s(o.exam_cvs), o.cvs_s1s2 ? `S1 S2 ${s(o.cvs_s1s2)}` : '', yes(o.cvs_murmur) ? `Murmur ${[o.cvs_murmur_timing, o.cvs_murmur_nature, o.cvs_murmur_site, o.cvs_murmur_radiation, o.cvs_murmur_grade && `grade ${o.cvs_murmur_grade}`].filter(Boolean).join(', ')}` : ''].filter(Boolean)
  const fuTxt = s(o.follow_up)
  const fuNum = fuTxt.match(/(\d+)\s*(day|din|d\b)/i)?.[1] || fuTxt.match(/(\d+)\s*(week|hafte)/i)?.[1] && String(+fuTxt.match(/(\d+)\s*(week|hafte)/i)![1] * 7) || fuTxt.match(/(\d+)\s*(month|mahin)/i)?.[1] && String(+fuTxt.match(/(\d+)\s*(month|mahin)/i)![1] * 30)
  const comorbid: Record<string, boolean> = {}
  for (const k of ['diabetes', 'hypertension', 'copd', 'tb', 'thyroid', 'cad', 'ckd', 'stroke']) if (yes(o[`cb_${k}`])) comorbid[k] = true
  return {
    complaints: s(o.chief_complaints), diagnosis: s(o.provisional_diagnosis),
    vitals: { bp: s(o.vital_bp), pulse: s(o.vital_pulse), spo2: s(o.vital_spo2), temp: s(o.vital_temp), rr: s(o.vital_rr), grbs: s(o.vital_grbs), weight: o.patient_weight ? s(o.patient_weight) : '' },
    exam: Object.fromEntries(['pallor', 'icterus', 'cyanosis', 'clubbing', 'edema'].map(k => [k, yes(o[`ex_${k}`]) ? 'Present' : 'Absent'])),
    systemic: { rs: s(o.exam_rs), cvs: cvsBits.join('; '), cns: s(o.exam_cns), pa: s(o.exam_pa) },
    comorbid,
    comorbid_details: {
      diabetes: det('dm', ['duration', 'treatment', 'drugs', 'fbs', 'ppbs', 'hba1c', 'neuropathy', 'retinopathy', 'nephropathy', 'cad', 'foot', 'notes']),
      hypertension: det('htn', ['duration', 'treatment', 'drugs', 'bp_control', 'lvh', 'ckd', 'retinopathy', 'stroke', 'notes']),
      copd: { ...det('copd', ['duration', 'severity', 'inhalers', 'pht', 'cor_pulmonale', 'notes']), ...(o.copd_smoking_pack_yr ? { pack_years: o.copd_smoking_pack_yr } : {}), ...(o.copd_exacerbations_yr ? { exacerbations: o.copd_exacerbations_yr } : {}) },
      tb: det('tb', ['type', 'site', 'status', 'duration', 'ds', 'notes']), thyroid: det('thyroid', ['type', 'duration', 'tsh', 'drugs', 'notes']),
      cad: det('cad', ['type', 'duration', 'lvef', 'drugs', 'cabg', 'pci', 'stenting', 'notes']), ckd: det('ckd', ['stage', 'egfr', 'dialysis', 'dial_type', 'duration', 'drugs', 'notes']),
      stroke: det('stroke', ['type', 'duration', 'deficit', 'drugs', 'notes']),
    },
    addiction: { smoking: yes(o.cb_smoking), alcohol: yes(o.cb_alcohol), tobacco: yes(o.cb_tobacco), iv_drug: yes(o.cb_iv_drug) },
    investigations: s(o.investigations).split(/\r?\n|,|;/).map(x => x.trim()).filter(Boolean),
    advice: lines(o.advice),
    follow_up: { days: fuNum ? +fuNum : null, note: fuTxt },
    hindi: true,
    imported: { op_no: s(o.patient_uhid) || null, saved_at: s(o.saved_at) },
  }
}
export function mapOldMed(m: any) {
  const name = s(m.drug_name)
  const form = detectForm(name)
  const dur = s(m.duration)
  const dn = dur.match(/^(\d+)\s*(d|day|days|din)?$/i)?.[1] ?? (dur.match(/^(\d+)\s*(w|week|weeks)$/i) ? String(+dur.match(/^(\d+)/)![1] * 7) : dur.match(/^(\d+)\s*(m|month|months)$/i) ? String(+dur.match(/^(\d+)/)![1] * 30) : null)
  const instr = s(m.instructions)
  const timing = /after\s*food|khane ke baad|\bAC\b/i.test(instr) ? 'after' : /before\s*food|khane se pehle|\bPC\b/i.test(instr) ? 'before' : /empty/i.test(instr) ? 'empty' : ''
  return { name, kind: 'brand', form, dose: s(m.dose) || '1', route: s(m.route) || defaultRoute(form), freq: normFreq(s(m.frequency)), timing, days: dn ? +dn : null, duration: dn ? '' : dur, instructions: timing ? instr.replace(/(after|before)\s*food|empty stomach/i, '').trim() : instr }
}
function isoDate(o: any) {
  for (const v of [o.patient_date, o.saved_at]) {
    const t = s(v)
    if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10)
    const m = t.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/)
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  }
  return new Date().toISOString().slice(0, 10)
}

r.get('/old/status', async c => {
  const db = oldDb()
  const [{ n }] = await db`select count(*)::int as n from prescriptions`
  const [{ m }] = await db`select count(*)::int as m from medications`
  const [{ done }] = await sql()`select count(*)::int as done from arx.prescriptions where clinic_id = ${me(c).clinic_id} and legacy_id is not null`
  return c.json({ old_prescriptions: n, old_medications: m, imported: done })
})

r.post('/old', async c => {
  const b = await body(c, z.object({ offset: z.number().int().min(0), limit: z.number().int().min(1).max(300).default(150) }))
  const u = me(c)
  const db = oldDb()
  const rows = await db`select * from prescriptions order by saved_at, id offset ${b.offset} limit ${b.limit}`
  const ids = rows.map(r => String(r.id))
  const meds = ids.length ? await db`select * from medications where prescription_id = any(${ids}::varchar[]) order by prescription_id, row_order, id` : []
  const byRx = new Map<string, any[]>()
  for (const m of meds) { const k = String(m.prescription_id); if (!byRx.has(k)) byRx.set(k, []); byRx.get(k)!.push(m) }
  let imported = 0, skipped = 0, patientsCreated = 0
  for (const o of rows) {
    const legacyId = String(o.id)
    const [exists] = await sql()`select 1 from arx.prescriptions where clinic_id = ${u.clinic_id} and legacy_id = ${legacyId}`
    if (exists) { skipped++; continue }
    const name = s(o.patient_name)
    if (!name) { skipped++; continue }
    const sex = /^f/i.test(s(o.patient_sex)) ? 'F' : /^m/i.test(s(o.patient_sex)) ? 'M' : s(o.patient_sex) ? 'O' : null
    const key = s(o.patient_uhid) ? `uhid:${s(o.patient_uhid).toLowerCase()}` : `n:${name.toLowerCase().replace(/\s+/g, ' ')}|${sex || ''}|${s(o.patient_address).toLowerCase().slice(0, 40)}`
    await sql().begin(async tx => {
      let [p] = await tx`select id, age_years from arx.patients where clinic_id = ${u.clinic_id} and legacy_key = ${key}`
      const age = Number.isFinite(+o.patient_age) && +o.patient_age > 0 && +o.patient_age < 125 ? Math.round(+o.patient_age) : null
      if (!p) {
        p = await createPatient(tx, u.clinic_id, { name, sex: sex as any, age_years: age, address: s(o.patient_address) || null, notes: s(o.patient_uhid) ? `Old OP No: ${s(o.patient_uhid)}` : null })
        await tx`update arx.patients set legacy_key = ${key} where id = ${p.id}`
        patientsCreated++
      } else if (age) await tx`update arx.patients set age_years = ${age} where id = ${p.id}`
      const data = mapOldRx(o)
      const ms = (byRx.get(legacyId) || []).filter(m => s(m.drug_name)).map(mapOldMed)
      const d = isoDate(o)
      await tx`insert into arx.prescriptions (clinic_id, patient_id, status, rx_date, data, meds, created_by, finalized_at, legacy_id, created_at)
        values (${u.clinic_id}, ${p.id}, 'final', ${d}, ${tx.json(data as any)}, ${tx.json(ms as any)}, ${u.id}, ${d + 'T12:00:00+05:30'}, ${legacyId}, ${d + 'T12:00:00+05:30'})`
      const conds = Object.keys(data.comorbid).map(k => ({ diabetes: 'Diabetes', hypertension: 'Hypertension', copd: 'COPD / Asthma', tb: 'Tuberculosis', thyroid: 'Thyroid disorder', cad: 'CAD', ckd: 'CKD', stroke: 'Stroke' } as any)[k])
      if (conds.length) await tx`update arx.patients set conditions = (select array(select distinct unnest(conditions || ${conds}::text[]))) where id = ${p.id}`
      const bp = data.vitals.bp.match(/(\d{2,3})\s*\/\s*(\d{2,3})/)
      const pts: [string, string][] = []
      if (bp) pts.push(['BP systolic', bp[1]], ['BP diastolic', bp[2]])
      if (data.vitals.grbs) pts.push(['GRBS', data.vitals.grbs])
      if (data.vitals.weight) pts.push(['Weight', data.vitals.weight])
      if (data.comorbid_details.diabetes.hba1c) pts.push(['HbA1c', String(data.comorbid_details.diabetes.hba1c)])
      for (const [t, v] of pts) { const n = parseFloat(v); if (!isNaN(n)) await tx`insert into arx.lab_results (clinic_id, patient_id, test, value_num, value_text, result_date, source) values (${u.clinic_id}, ${p.id}, ${t}, ${n}, ${v}, ${d}, 'rx')` }
      for (const m of ms) await tx`insert into arx.med_usage (clinic_id, name, uses, defaults, last_used) values (${u.clinic_id}, ${m.name}, 1, ${tx.json(m as any)}, ${d + 'T12:00:00+05:30'})
        on conflict (clinic_id, name) do update set uses = arx.med_usage.uses + 1`
    })
    imported++
  }
  if (b.offset === 0) await audit(c, 'import.start', 'clinic', u.clinic_id)
  return c.json({ imported, skipped, patients_created: patientsCreated, next_offset: b.offset + rows.length, done: rows.length < b.limit })
})

export default r
