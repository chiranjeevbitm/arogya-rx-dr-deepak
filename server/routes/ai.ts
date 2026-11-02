import { Hono } from 'hono'
import { z } from 'zod'
import { sql, HttpError } from '../db.js'
import { body, me, P, type Env } from '../app.js'
import { requireAuth } from '../lib/auth.js'
import { audit } from '../lib/audit.js'
import { rateLimit } from '../lib/ratelimit.js'
import { aiJson, aiConfigured, aiModel, transcribe } from '../lib/ai.js'
import { putFile } from '../lib/storage.js'
import { detectForm, defaultDose, defaultRoute, normFreq, istToday } from '../../shared/rx.js'

const r = new Hono<Env>()
r.use('*', requireAuth())

const S = (o: Record<string, any>) => ({ type: 'object', additionalProperties: false, properties: o, required: Object.keys(o) })
const str = { type: 'string' }
const VOICE_SCHEMA = S({
  complaints: str, diagnosis: str, exam_notes: str,
  vitals: S({ bp: str, pulse: str, spo2: str, temp: str, rr: str, grbs: str, weight: str }),
  meds: { type: 'array', items: S({ name: { ...str, description: 'Medicine name as spoken, corrected to the standard spelling (brand or generic)' }, strength: str, form: { type: 'string', enum: ['TAB', 'CAP', 'SYP', 'INJ', 'DROP', 'OINT', 'CREAM', 'INH', 'ROTACAP', 'RESP', 'SACHET', 'GEL', ''] }, dose: str, freq: { ...str, description: 'Pattern like 1-0-1, 1-0-0, 0-0-1, 1-1-1, or SOS, Weekly, STAT' }, timing: { type: 'string', enum: ['', 'after', 'before', 'empty', 'with'] }, days: { type: ['integer', 'null'] }, duration_text: str, instructions: str }) },
  investigations: { type: 'array', items: str }, advice: { type: 'array', items: str }, follow_up_days: { type: ['integer', 'null'] },
})
const VOICE_SYSTEM = `You turn a doctor's dictated consultation (Hinglish: Hindi and English mixed, Indian OPD) into a structured prescription DRAFT for the doctor to review.
Rules:
- Extract only what the doctor said. Never add a medicine, test, dose or diagnosis that was not said. Leave fields empty ("" or null) when not mentioned.
- Write complaints, diagnosis, advice and investigations in clear English (short clinical phrases). Advice lines are short patient instructions.
- Frequency: "subah" 1-0-0; "dopahar" 0-1-0; "raat/raat ko/sote samay" 0-0-1; "subah shaam/do baar/BD" 1-0-1; "teen baar/TDS" 1-1-1; "char baar/QID" 1-1-1-1; "zaroorat par/SOS" SOS; "hafte mein ek" Weekly; "OD" 1-0-0.
- Timing: "khane ke baad" after; "khane se pehle/nashte se pehle" before; "khali pet" empty.
- Duration: "paanch din" 5; "ek hafta" 7; "do hafte" 14; "ek mahina" 30; "teen mahine" 90. Use duration_text only for things like "continue".
- Dose is the amount taken each time: a count of tablets ("1", "½", "2"), or "10 ml", "2 puffs". NEVER put the strength (25 mg, 100 mg, 12.5 mcg) in dose; strength goes in strength. Default "1" for tablets/capsules if not said.
- BP like "138 by 86" becomes "138/86". Temperature in °F. Sugar/GRBS in mg/dL.
- follow_up_days from phrases like "5 din baad dikhayein".`

r.get('/status', c => c.json({ configured: aiConfigured(), model: aiModel() }))

/** Ground a spoken medicine name against the catalogue and the doctor's own favourites. */
async function ground(clinicId: string, name: string, strength: string) {
  const q = `${name} ${strength}`.trim().toLowerCase()
  const fav = await sql()`select name, defaults from arx.med_usage where clinic_id = ${clinicId}
      and extensions.similarity(lower(name), ${q}) > 0.3 order by extensions.similarity(lower(name), ${q}) desc, uses desc limit 3`
  const cat = await sql()`select name, kind, price::float as price, form from arx.medicines where (clinic_id is null or clinic_id = ${clinicId})
      and lower(name) operator(extensions.%) ${q} order by extensions.similarity(lower(name), ${q}) desc, (kind = 'ja') desc limit 5`
  const candidates = [...fav.map(f => ({ name: f.name, kind: f.defaults?.kind || 'brand', favourite: true })), ...cat.map(x => ({ name: x.name, kind: x.kind, price: x.price }))]
  return candidates.filter((x, i, a) => a.findIndex(y => y.name.toLowerCase() === x.name.toLowerCase()) === i).slice(0, 5)
}

/** The model sometimes copies the strength ("25", "100", "12.5") into the dose. For tablets and capsules a dose is a count of 4 or fewer. */
function sane(dose: string | undefined, form: string, strength: string | undefined) {
  const d = (dose || '').trim()
  if (!d) return defaultDose(form as any)
  if (['TAB', 'CAP', 'ROTACAP', 'SACHET'].includes(form)) {
    const n = parseFloat(d.replace('½', '.5').replace('¼', '.25'))
    const s = parseFloat(String(strength || '').replace(/[^\d.]/g, ''))
    if (!isNaN(n) && (n > 4 || (!isNaN(s) && n === s && n > 2))) return defaultDose(form as any)
  }
  return d
}

r.post('/voice-rx', requireAuth('doctor', 'admin'), async c => {
  const b = await body(c, z.object({ transcript: z.string().min(5, 'Nothing was heard. Try again.').max(8000), patient_id: z.string().uuid().optional() }))
  const u = me(c)
  await rateLimit(`ai:${u.id}`, 120, 3600)
  let ctx = ''
  if (b.patient_id) {
    const [p] = await sql()`select age_years, sex, allergies, conditions from arx.patients where id = ${b.patient_id} and clinic_id = ${u.clinic_id}`
    if (p) ctx = `\nPatient: ${p.age_years ?? '?'}y ${p.sex ?? ''}. Known conditions: ${(p.conditions || []).join(', ') || 'none'}. Allergies: ${(p.allergies || []).join(', ') || 'none'}.`
  }
  const out = await aiJson<any>({ kind: 'voice_rx', clinicId: u.clinic_id, userId: u.id, system: VOICE_SYSTEM, schemaName: 'rx_draft', schema: VOICE_SCHEMA, effort: 'low', maxTokens: 6000,
    parts: [{ type: 'input_text', text: `Dictation:\n"""${b.transcript}"""${ctx}` }] })
  const meds = []
  for (const m of out.meds || []) {
    const candidates = await ground(u.clinic_id, m.name, m.strength)
    const form = m.form || detectForm(candidates[0]?.name || m.name)
    meds.push({ spoken: [m.name, m.strength].filter(Boolean).join(' '), candidates, med: { name: candidates[0]?.name || [m.name, m.strength].filter(Boolean).join(' '), kind: (candidates[0]?.kind as any) || 'custom', form, dose: sane(m.dose, form, m.strength), route: defaultRoute(form), freq: normFreq(m.freq), timing: m.timing || '', days: m.days, duration: m.duration_text || '', instructions: m.instructions || '' } })
  }
  await audit(c, 'ai.voice_rx', 'patient', b.patient_id ?? null, { meds: meds.length })
  return c.json({ ...out, meds })
})

r.post('/transcribe', requireAuth('doctor', 'admin'), async c => {
  const b = await body(c, z.object({ audio_base64: z.string().max(14_000_000), mime: z.string().max(60) }))
  await rateLimit(`ai:${me(c).id}`, 120, 3600)
  return c.json({ text: await transcribe(Buffer.from(b.audio_base64, 'base64'), b.mime) })
})

const SCAN_SCHEMA = S({
  doc_type: { type: 'string', enum: ['old_rx', 'lab_report', 'other'] }, legible: { type: 'boolean' },
  doc_date: { ...str, description: 'YYYY-MM-DD or empty' }, source_name: { ...str, description: 'Doctor, hospital or lab name' },
  diagnoses: { type: 'array', items: str }, allergies: { type: 'array', items: str },
  medicines: { type: 'array', items: S({ name: str, dose: str, freq: str, duration: str }) },
  labs: { type: 'array', items: S({ test: str, value: str, unit: str, ref_range: str, flag: { type: 'string', enum: ['low', 'high', 'normal', 'abnormal', ''] } }) },
  notes: str,
})
const SCAN_SYSTEM = `You read a phone photo of an Indian medical document (an old prescription, usually handwritten on a printed clinic parchi, or a printed lab report) and extract structured data for a doctor to review.
Rules:
- Doctors' handwriting is normally readable with effort. ALWAYS attempt it: give your best reading of every medicine, diagnosis and finding, and add "?" after a word you are unsure of. Skip a word only if it is truly impossible to read.
- Set legible=false ONLY when you can read almost nothing. A tilted photo, glare or untidy handwriting is not a reason for legible=false.
- Typical parchi layout: printed header (clinic and doctor), printed side column of vitals and comorbidities (ignore the blank printed labels), then handwritten: date, patient name, age/sex, chief complaints, provisional diagnosis, investigation findings (2D Echo, ECG, labs with dates), and a numbered list of medicines after "Adv" or "Rx" with Tab./Cap./Syp./Inj., strength, dose pattern (1-0-1, 1x1, BD, OD, HS) and days, then referral or follow-up.
- Medicines: name and strength as written (Indian brands such as Dytor Plus, Met XL, Ecosprin Gold, Pantocid-L, Thyronorm), dose pattern in freq (e.g. 1-0-1 or "1 morning"), and duration if written.
- diagnoses: the conditions and key findings named (for example "ASD 25 mm ostium secundum", "hypothyroidism", "RBBB"). allergies only if written.
- Labs: one row per test with value, unit, reference range and flag (low/high/normal) if printed or obvious from the range.
- doc_date as YYYY-MM-DD from the "Reg. Date" or any printed date (20/10/26 means 2026-10-20).
- notes: investigation findings (echo, ECG) and referral in one or two lines.`

r.post('/scan', async c => {
  const b = await body(c, z.object({ patient_id: z.string().uuid(), image: z.string().max(8_000_000) }))
  const u = me(c)
  await rateLimit(`ai:${u.id}`, 120, 3600)
  const m = b.image.match(/^data:(image\/(jpeg|png|webp));base64,(.+)$/)
  if (!m) throw new HttpError(400, 'Send a JPG, PNG or WebP photo.')
  const [p] = await sql()`select id from arx.patients where id = ${b.patient_id} and clinic_id = ${u.clinic_id}`
  if (!p) throw new HttpError(404, 'Patient not found.')
  const file = await putFile({ clinicId: u.clinic_id, kind: 'scan', mime: m[1], data: Buffer.from(m[3], 'base64'), userId: u.id })
  const out = await aiJson<any>({ kind: 'scan', clinicId: u.clinic_id, userId: u.id, system: SCAN_SYSTEM, schemaName: 'medical_document', schema: SCAN_SCHEMA, effort: 'medium', maxTokens: 16000,
    parts: [{ type: 'input_text', text: 'Extract this document.' }, { type: 'input_image', image_url: b.image, detail: 'high' }] })
  const docDate = /^\d{4}-\d{2}-\d{2}$/.test(out.doc_date) && out.doc_date <= istToday() ? out.doc_date : null
  const [doc] = await sql()`insert into arx.documents (clinic_id, patient_id, file_id, kind, doc_date, extracted, created_by)
    values (${u.clinic_id}, ${b.patient_id}, ${file.id}, ${out.doc_type}, ${docDate}, ${sql().json(out)}, ${u.id}) returning id`
  await audit(c, 'ai.scan', 'document', doc.id, { type: out.doc_type, labs: out.labs?.length, meds: out.medicines?.length })
  return c.json({ document_id: doc.id, file_id: file.id, ...out, doc_date: docDate })
})

const INTAKE_SCHEMA = S({
  name: { ...str, description: 'Full name of the patient, properly capitalised. Empty if not given.' },
  sex: { type: 'string', enum: ['M', 'F', 'O', ''] },
  age_years: { type: ['integer', 'null'] },
  phone: { ...str, description: '10 digit Indian mobile number, digits only. Empty if not given.' },
  address: { ...str, description: 'Village, town or area as given. Empty if not given.' },
  allergies: { type: 'array', items: str },
})
const INTAKE_SYSTEM = `You fill a new-patient registration form for an Indian clinic from either (a) a few words spoken by the receptionist or doctor (Hinglish or Hindi or English) or (b) a phone photo of a handwritten or printed registration slip, an old prescription header, or an ID card.
Rules:
- Extract only what is actually said or written. Never invent a name, number or address. Leave fields empty ("" or null) when not present.
- Names: write in English letters, properly capitalised, keep "Mr/Mrs/Dr" out of the name. Hindi names in Devanagari are transliterated.
- Sex: M, F or O only when stated or clearly implied (for example "beti", "mahila", "Smt", "Mrs", "S/o", "D/o", "W/o").
- Age: whole years. "6 mahine" is 0; "dedh saal" is 1. If a date of birth is written, work out the age in years from today's date given below.
- Phone: digits only, drop +91 or a leading 0; keep it only if it ends up 10 digits.
- Address: village or town and district if given, as one short line.
- Allergies only if explicitly mentioned (for example "sulfa se allergy"). Do not guess.`

r.post('/patient-intake', async c => {
  const b = await body(c, z.object({ transcript: z.string().max(4000).optional(), image: z.string().max(8_000_000).optional(), pdf: z.string().max(6_000_000).optional() }))
  const u = me(c)
  await rateLimit(`ai:${u.id}`, 120, 3600)
  const parts: any[] = [{ type: 'input_text', text: `Today is ${istToday()}.` }]
  if (b.pdf) {
    if (!/^data:application\/pdf;base64,/.test(b.pdf)) throw new HttpError(400, 'Send a PDF file.')
    parts.push({ type: 'input_text', text: 'Read the patient details from this PDF (use the first pages; ignore anything that is not about the patient).' }, { type: 'input_file', filename: 'slip.pdf', file_data: b.pdf })
  } else if (b.image) {
    if (!/^data:image\/(jpeg|png|webp);base64,/.test(b.image)) throw new HttpError(400, 'Send a JPG, PNG or WebP photo.')
    parts.push({ type: 'input_text', text: 'Read the patient details from this photo.' }, { type: 'input_image', image_url: b.image, detail: 'high' })
  } else if (b.transcript && b.transcript.trim().length >= 3) {
    parts.push({ type: 'input_text', text: `Spoken:\n"""${b.transcript.trim()}"""` })
  } else throw new HttpError(400, 'Nothing was heard. Try again.')
  const out = await aiJson<any>({ kind: 'patient_intake', clinicId: u.clinic_id, userId: u.id, system: INTAKE_SYSTEM, schemaName: 'patient_form', schema: INTAKE_SCHEMA, effort: 'low', maxTokens: 2000, parts })
  const phone = String(out.phone || '').replace(/\D/g, '').slice(-10)
  const age = Number.isInteger(out.age_years) && out.age_years >= 0 && out.age_years <= 125 ? out.age_years : null
  await audit(c, 'ai.patient_intake', 'patient', null, { via: b.pdf ? 'pdf' : b.image ? 'photo' : 'voice' })
  return c.json({ name: String(out.name || '').trim().slice(0, 80), sex: ['M', 'F', 'O'].includes(out.sex) ? out.sex : null, age_years: age, phone: phone.length === 10 ? phone : '', address: String(out.address || '').trim().slice(0, 200), allergies: (out.allergies || []).map((x: string) => String(x).trim()).filter(Boolean).slice(0, 10) })
})

r.delete('/documents/:id', async c => {
  await sql()`delete from arx.documents where id = ${P(c, 'id')} and clinic_id = ${me(c).clinic_id}`
  await audit(c, 'document.delete', 'document', P(c, 'id'))
  return c.json({ ok: true })
})

export default r
