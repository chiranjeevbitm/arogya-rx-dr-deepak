/* Ask Arogya: plain-language questions over the clinic's own records.
   gpt-5-nano only chooses one of a fixed set of lookups and its parameters; the server runs a
   safe, parameterised query scoped to this clinic. Without an AI key a keyword parser is used. */
import { Hono } from 'hono'
import { z } from 'zod'
import { sql } from '../db.js'
import { body, me, type Env } from '../app.js'
import { requireAuth } from '../lib/auth.js'
import { rateLimit } from '../lib/ratelimit.js'
import { aiConfigured, aiJson } from '../lib/ai.js'
import { istToday, addDaysISO, fmtDate } from '../../shared/rx.js'
import { normTest } from './patients.js'

const r = new Hono<Env>()
r.use('*', requireAuth())

type Intent = { intent: 'lab_threshold' | 'condition' | 'followups_due' | 'overdue' | 'patient_summary' | 'today_counts' | 'allergies' | 'unknown'; test: string; op: '>' | '<' | ''; value: number | null; condition: string; days: number | null; name: string }
const S = { type: 'object', additionalProperties: false, required: ['intent', 'test', 'op', 'value', 'condition', 'days', 'name'], properties: {
  intent: { type: 'string', enum: ['lab_threshold', 'condition', 'followups_due', 'overdue', 'patient_summary', 'today_counts', 'allergies', 'unknown'] },
  test: { type: 'string', description: 'Lab or vital name, e.g. HbA1c, FBS, BP systolic, TSH, S. creatinine, Hb, Weight, GRBS' },
  op: { type: 'string', enum: ['>', '<', ''] }, value: { type: ['number', 'null'] },
  condition: { type: 'string', description: 'Diabetes, Hypertension, COPD / Asthma, Thyroid disorder, CAD, CKD, Tuberculosis, Stroke, or empty' },
  days: { type: ['integer', 'null'], description: 'Time window in days' }, name: { type: 'string', description: 'Patient name if asked about one patient' } } }
const SYSTEM = `Map a clinic doctor's question (English, Hindi or Hinglish) to one lookup.
lab_threshold: patients whose latest value of a test is above/below a number (e.g. "diabetics with HbA1c above 7" → test HbA1c, op >, value 7, condition Diabetes).
condition: patients with a long-term condition. followups_due: follow-ups booked in the next N days (default 7). overdue: patients with a condition not seen for N days (default 90).
patient_summary: one named patient. today_counts: how many patients/bookings/WhatsApp today. allergies: patients with recorded allergies. unknown: anything else.`

function parseLocal(q: string): Intent {
  const s = q.toLowerCase(), base: Intent = { intent: 'unknown', test: '', op: '', value: null, condition: '', days: null, name: '' }
  const cond = /diabet|sugar|dm\b/.test(s) ? 'Diabetes' : /hypert|\bbp\b|htn/.test(s) ? 'Hypertension' : /thyroid/.test(s) ? 'Thyroid disorder' : /copd|asthma/.test(s) ? 'COPD / Asthma' : /ckd|kidney/.test(s) ? 'CKD' : ''
  const m = s.match(/(hba1c|fbs|ppbs|tsh|creatinine|hb\b|haemoglobin|weight|grbs|systolic|bp)[^0-9<>]*(above|over|more than|>|below|under|less than|<)\s*([0-9.]+)/)
  if (m) return { ...base, intent: 'lab_threshold', test: m[1] === 'bp' || m[1] === 'systolic' ? 'BP systolic' : normTest(m[1]), op: /below|under|less|</.test(m[2]) ? '<' : '>', value: +m[3], condition: cond }
  if (/allerg/.test(s)) return { ...base, intent: 'allergies' }
  if (/follow|due|this week|kal|tomorrow/.test(s)) return { ...base, intent: 'followups_due', days: /tomorrow|kal/.test(s) ? 1 : 7 }
  if (/not (seen|come)|overdue|missed/.test(s)) return { ...base, intent: 'overdue', condition: cond, days: 90 }
  if (/how many|kitne|today|aaj/.test(s)) return { ...base, intent: 'today_counts' }
  const n = s.match(/(?:summari[sz]e|about|history of|ka history)\s+([a-z .]+)/)
  if (n) return { ...base, intent: 'patient_summary', name: n[1].trim() }
  if (cond) return { ...base, intent: 'condition', condition: cond }
  return base
}

r.post('/', async c => {
  const b = await body(c, z.object({ q: z.string().min(2).max(300) }))
  const u = me(c), cid = u.clinic_id, db = sql()
  await rateLimit(`ask:${u.id}`, 120, 3600)
  let it = parseLocal(b.q)
  if (aiConfigured()) {
    try { it = await aiJson<Intent>({ kind: 'ask', clinicId: cid, userId: u.id, system: SYSTEM, schemaName: 'lookup', schema: S, effort: 'minimal', maxTokens: 800, parts: [{ type: 'input_text', text: b.q }] }) } catch { /* keep keyword result */ }
  }
  const P = (rows: any[], detail: (r: any) => string) => rows.map(r => ({ id: r.id, name: r.name, uhid: r.uhid, detail: detail(r) }))
  const condLike = it.condition ? '%' + it.condition.split(' ')[0].toLowerCase() + '%' : null
  switch (it.intent) {
    case 'lab_threshold': {
      const test = it.test.startsWith('BP') ? 'BP systolic' : normTest(it.test)
      const rows = await db`select distinct on (p.id) p.id, p.name, p.uhid, l.value_num::float as v, l.result_date
        from arx.lab_results l join arx.patients p on p.id = l.patient_id
        where l.clinic_id = ${cid} and l.test = ${test} and l.value_num is not null
          ${condLike ? db`and exists (select 1 from unnest(p.conditions) x where lower(x) like ${condLike})` : db``}
        order by p.id, l.result_date desc`
      const hit = rows.filter(r => (it.op === '<' ? r.v < (it.value ?? 0) : r.v > (it.value ?? 0))).sort((a, b) => b.v - a.v)
      return c.json({ answer: `${hit.length} patient${hit.length === 1 ? '' : 's'}${it.condition ? ` with ${it.condition.toLowerCase()}` : ''} whose latest ${test} is ${it.op === '<' ? 'below' : 'above'} ${it.value}.`, rows: P(hit.slice(0, 25), r => `${test} ${r.v} on ${fmtDate(new Date(r.result_date).toISOString().slice(0, 10))}`) })
    }
    case 'condition': {
      const rows = await db`select id, name, uhid, conditions, (select max(visit_date) from arx.visits v where v.patient_id = p.id) as last from arx.patients p
        where clinic_id = ${cid} and exists (select 1 from unnest(conditions) x where lower(x) like ${condLike || '%'}) order by name limit 50`
      return c.json({ answer: `${rows.length} patient${rows.length === 1 ? '' : 's'} with ${it.condition || 'a recorded condition'}.`, rows: P(rows, r => r.conditions.join(', ')) })
    }
    case 'followups_due': {
      const to = addDaysISO(istToday(), it.days || 7)
      const rows = await db`select coalesce(p.id, a.patient_id) as id, a.name, p.uhid, a.appt_date, a.reason from arx.appointments a left join arx.patients p on p.id = a.patient_id
        where a.clinic_id = ${cid} and a.status = 'booked' and a.appt_date between ${istToday()} and ${to} order by a.appt_date, a.appt_time limit 50`
      return c.json({ answer: `${rows.length} appointment${rows.length === 1 ? '' : 's'} booked from today to ${fmtDate(to)}.`, rows: P(rows, r => `${fmtDate(new Date(r.appt_date).toISOString().slice(0, 10))}${r.reason ? ' · ' + r.reason : ''}`) })
    }
    case 'overdue': {
      const since = addDaysISO(istToday(), -(it.days || 90))
      const rows = await db`select p.id, p.name, p.uhid, p.phone, max(v.visit_date) as last from arx.patients p left join arx.visits v on v.patient_id = p.id
        where p.clinic_id = ${cid} ${condLike ? db`and exists (select 1 from unnest(p.conditions) x where lower(x) like ${condLike})` : db``}
        group by p.id having coalesce(max(v.visit_date), (select max(rx_date) from arx.prescriptions r where r.patient_id = p.id)) < ${since} order by last nulls first limit 50`
      return c.json({ answer: `${rows.length} patient${rows.length === 1 ? '' : 's'}${it.condition ? ` with ${it.condition.toLowerCase()}` : ''} not seen in ${it.days || 90} days.`, rows: P(rows, r => (r.phone || 'no mobile') + (r.last ? ` · last ${fmtDate(new Date(r.last).toISOString().slice(0, 10))}` : '')) })
    }
    case 'patient_summary': {
      const [p] = await db`select id, name, uhid, age_years, sex, conditions, allergies from arx.patients where clinic_id = ${cid} and lower(name) operator(extensions.%) ${it.name.toLowerCase()} order by extensions.similarity(lower(name), ${it.name.toLowerCase()}) desc limit 1`
      if (!p) return c.json({ answer: `No patient found called “${it.name}”.`, rows: [] })
      const rx = await db`select rx_date, data->>'diagnosis' as dx, meds from arx.prescriptions where patient_id = ${p.id} and status = 'final' order by rx_date desc limit 3`
      const labs = await db`select distinct on (test) test, value_num::float as v, result_date from arx.lab_results where patient_id = ${p.id} and test in ('HbA1c','BP systolic','FBS','TSH','S. creatinine') order by test, result_date desc`
      const parts = [`${p.name}, ${p.age_years ?? '?'}${p.sex ?? ''}, ${p.uhid}.`, p.conditions.length ? `Conditions: ${p.conditions.join(', ')}.` : '', p.allergies.length ? `Allergic to ${p.allergies.join(', ')}.` : '',
        rx[0] ? `Last visit ${fmtDate(new Date(rx[0].rx_date).toISOString().slice(0, 10))}: ${rx[0].dx || '—'}; on ${(rx[0].meds as any[]).map(m => m.name).join(', ') || 'no medicines'}.` : 'No prescriptions yet.',
        labs.length ? `Latest: ${labs.map(l => `${l.test} ${l.v}`).join(', ')}.` : '']
      return c.json({ answer: parts.filter(Boolean).join(' '), rows: [{ id: p.id, name: p.name, uhid: p.uhid, detail: 'Open patient' }] })
    }
    case 'today_counts': {
      const d = istToday()
      const [v] = await db`select count(*)::int as n, count(*) filter (where status='done')::int as done, count(*) filter (where source in ('online','appointment'))::int as booked from arx.visits where clinic_id = ${cid} and visit_date = ${d}`
      const [m] = await db`select count(*)::int as n from arx.messages where clinic_id = ${cid} and created_at::date = ${d}::date and kind = 'rx'`
      const [a] = await db`select count(*)::int as n from arx.appointments where clinic_id = ${cid} and appt_date = ${d} and source = 'online'`
      return c.json({ answer: `Today: ${v.n} patients in the queue, ${v.done} seen. ${a.n} booked online. ${m.n} prescriptions sent on WhatsApp.`, rows: [] })
    }
    case 'allergies': {
      const rows = await db`select id, name, uhid, allergies from arx.patients where clinic_id = ${cid} and cardinality(allergies) > 0 and not ('None known' = any(allergies)) order by name limit 50`
      return c.json({ answer: `${rows.length} patient${rows.length === 1 ? '' : 's'} with recorded allergies.`, rows: P(rows, r => r.allergies.join(', ')) })
    }
    default:
      return c.json({ answer: 'I can answer questions like: “diabetic patients with HbA1c above 7”, “who is due for follow-up this week”, “hypertensive patients not seen in 3 months”, “summarise Ramesh Prasad”, “patients with allergies”, or “how many patients today”.', rows: [] })
  }
})
export default r
