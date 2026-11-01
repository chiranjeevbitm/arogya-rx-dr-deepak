/* Clinical helpers shared by the browser and the server:
   medicine form detection, dose lines in English and Hindi, safety checks, vitals flags. */

export type Med = {
  name: string
  kind?: 'ja' | 'brand' | 'custom'
  form?: string            // TAB, CAP, SYP, INJ, DROP, OINT, INH, SACHET, CREAM, GEL, ''
  dose?: string            // "1", "½", "10 ml", "2 puffs"
  route?: string           // Oral, IV, IM, SC, Topical, Inhalation, Eye, Ear, Nasal
  freq?: string            // 1-0-1, OD, BD, TDS, QID, HS, SOS, Weekly, STAT, or free text
  timing?: '' | 'after' | 'before' | 'empty' | 'with'
  days?: number | null
  duration?: string        // free text when not a number of days, e.g. "Continue"
  instructions?: string
  price?: number | null
}

export type Vitals = { bp?: string; pulse?: string; spo2?: string; temp?: string; rr?: string; grbs?: string; weight?: string }

export const FORMS = ['TAB', 'CAP', 'SYP', 'SUSP', 'INJ', 'DROP', 'OINT', 'CREAM', 'GEL', 'INH', 'ROTACAP', 'RESP', 'SACHET', 'POWDER', 'LOTION', 'SPRAY', 'SUPP'] as const
export const ROUTES = ['Oral', 'IV', 'IM', 'SC', 'Topical', 'Inhalation', 'Nebulisation', 'Eye', 'Ear', 'Nasal', 'Sublingual', 'Per rectal']
export const FREQS = ['1-0-1', '1-0-0', '0-0-1', '0-1-0', '1-1-1', '1-1-1-1', '1-1-0', '0-1-1', '½-0-½', 'SOS', 'Weekly', 'STAT', 'Alternate day']

export function detectForm(name: string): string {
  const s = ' ' + name.toLowerCase() + ' '
  const rules: [RegExp, string][] = [
    [/\b(tablet|tab\.?|tabs)\b/, 'TAB'], [/\bcapsule|\bcap\.?\b|\bcaps\b/, 'CAP'], [/\brotacap/, 'ROTACAP'],
    [/\bsyrup|\bsyp\b/, 'SYP'], [/\bsuspension|\bsusp\b/, 'SUSP'], [/\binjection|\binj\b|\bvial\b|\bampoule/, 'INJ'],
    [/\beye drop|\bear drop|\bdrops?\b/, 'DROP'], [/\bointment|\boint\b/, 'OINT'], [/\bcream\b/, 'CREAM'], [/\bgel\b/, 'GEL'],
    [/\binhaler|\bmdi\b/, 'INH'], [/\brespules?\b|\bnebul/, 'RESP'], [/\bsachet/, 'SACHET'], [/\bpowder\b/, 'POWDER'],
    [/\blotion\b/, 'LOTION'], [/\bspray\b/, 'SPRAY'], [/\bsuppositor/, 'SUPP'],
  ]
  for (const [re, f] of rules) if (re.test(s)) return f
  return ''
}

export function defaultRoute(form: string): string {
  if (['INJ'].includes(form)) return 'IV'
  if (['OINT', 'CREAM', 'GEL', 'LOTION'].includes(form)) return 'Topical'
  if (['INH', 'ROTACAP'].includes(form)) return 'Inhalation'
  if (form === 'RESP') return 'Nebulisation'
  return 'Oral'
}

export function defaultDose(form: string): string {
  if (form === 'SYP' || form === 'SUSP') return '10 ml'
  if (form === 'INH' || form === 'SPRAY') return '2 puffs'
  if (form === 'DROP') return '2 drops'
  if (['OINT', 'CREAM', 'GEL', 'LOTION'].includes(form)) return 'Local application'
  if (form === 'SACHET') return '1 sachet'
  return '1'
}

/* ---------- frequency ---------- */
const FREQ_MAP: Record<string, { en: string; hi: string; perDay: number }> = {
  '1-0-0': { en: 'morning', hi: 'सुबह', perDay: 1 },
  '0-1-0': { en: 'afternoon', hi: 'दोपहर', perDay: 1 },
  '0-0-1': { en: 'night', hi: 'रात को', perDay: 1 },
  '1-0-1': { en: 'morning & night', hi: 'सुबह और रात', perDay: 2 },
  '1-1-0': { en: 'morning & afternoon', hi: 'सुबह और दोपहर', perDay: 2 },
  '0-1-1': { en: 'afternoon & night', hi: 'दोपहर और रात', perDay: 2 },
  '1-1-1': { en: 'three times a day', hi: 'सुबह, दोपहर और रात', perDay: 3 },
  '1-1-1-1': { en: 'four times a day', hi: 'दिन में चार बार', perDay: 4 },
  '½-0-½': { en: 'half, morning & night', hi: 'आधी, सुबह और रात', perDay: 1 },
  OD: { en: 'once a day', hi: 'दिन में एक बार', perDay: 1 },
  BD: { en: 'twice a day', hi: 'दिन में दो बार', perDay: 2 },
  TDS: { en: 'three times a day', hi: 'दिन में तीन बार', perDay: 3 },
  QID: { en: 'four times a day', hi: 'दिन में चार बार', perDay: 4 },
  HS: { en: 'at bedtime', hi: 'सोते समय', perDay: 1 },
  SOS: { en: 'when needed', hi: 'ज़रूरत पड़ने पर', perDay: 1 },
  STAT: { en: 'immediately, once', hi: 'तुरंत, एक बार', perDay: 1 },
  Weekly: { en: 'once a week', hi: 'हफ़्ते में एक बार', perDay: 1 / 7 },
  'Alternate day': { en: 'on alternate days', hi: 'एक दिन छोड़कर', perDay: 0.5 },
}
const TIMING: Record<string, { en: string; hi: string }> = {
  after: { en: 'after food', hi: 'खाने के बाद' },
  before: { en: 'before food', hi: 'खाने से पहले' },
  empty: { en: 'empty stomach', hi: 'खाली पेट' },
  with: { en: 'with food', hi: 'खाने के साथ' },
}

export function normFreq(f?: string): string {
  if (!f) return ''
  const t = f.trim()
  const up = t.toUpperCase()
  if (FREQ_MAP[up]) return up
  if (/^weekly$/i.test(t)) return 'Weekly'
  if (/^(1\/2|0\.5)-0-(1\/2|0\.5)$/.test(t)) return '½-0-½'
  const m = t.replace(/\s/g, '').match(/^([0-9½]+)[-–]([0-9½]+)[-–]([0-9½]+)(?:[-–]([0-9½]+))?$/)
  if (m) return m.slice(1).filter(Boolean).join('-')
  return t
}

function doseHi(dose: string, form: string): string {
  const d = dose.trim()
  if (!d) return ''
  if (/^[0-9½.]+$/.test(d)) {
    const unit: Record<string, string> = { TAB: 'गोली', CAP: 'कैप्सूल', ROTACAP: 'रोटाकैप', SACHET: 'पैकेट', SUPP: 'सपोसिटरी' }
    return `${d} ${unit[form] || ''}`.trim()
  }
  return d.replace(/ml/i, 'ml').replace(/puffs?/i, 'पफ').replace(/drops?/i, 'बूंद').replace(/Local application/i, 'लगाएँ').replace(/sachet/i, 'पैकेट')
}
function doseEn(dose: string, form: string): string {
  const d = dose.trim()
  if (/^[0-9½.]+$/.test(d)) {
    const unit: Record<string, string> = { TAB: 'tab', CAP: 'cap', ROTACAP: 'rotacap', SACHET: 'sachet', SUPP: 'supp' }
    return `${d} ${unit[form] || ''}`.trim()
  }
  return d
}
function daysEn(m: Med) {
  if (m.duration) return m.duration
  if (!m.days) return ''
  if (normFreq(m.freq) === 'Weekly' && m.days % 7 === 0) return `${m.days / 7} week${m.days === 7 ? '' : 's'}`
  if (m.days % 30 === 0 && m.days >= 30) return `${m.days / 30} month${m.days === 30 ? '' : 's'}`
  return `${m.days} day${m.days === 1 ? '' : 's'}`
}
function daysHi(m: Med) {
  if (m.duration) return /continue|cont/i.test(m.duration) ? 'लगातार' : m.duration
  if (!m.days) return ''
  if (normFreq(m.freq) === 'Weekly' && m.days % 7 === 0) return `${m.days / 7} हफ़्ते`
  if (m.days % 30 === 0 && m.days >= 30) return `${m.days / 30} महीने`
  return `${m.days} दिन`
}

/** "1 tab · 1-0-1 · morning & night, after food · 5 days" */
export function sigEn(m: Med): string {
  const f = normFreq(m.freq)
  const fm = FREQ_MAP[f]
  const parts = [doseEn(m.dose || '', m.form || ''), f && fm && /\d/.test(f) ? f.split('-').join(' – ') : f, [fm?.en && /\d/.test(f) ? fm.en : '', m.timing ? TIMING[m.timing]?.en : ''].filter(Boolean).join(', '), daysEn(m)]
  if (m.route && !['Oral', ''].includes(m.route)) parts.splice(1, 0, m.route)
  return parts.filter(Boolean).join(' · ')
}
/** "1 गोली · सुबह और रात · खाने के बाद · 5 दिन" */
export function sigHi(m: Med): string {
  const f = normFreq(m.freq)
  const fm = FREQ_MAP[f]
  return [doseHi(m.dose || '', m.form || ''), fm?.hi || '', m.timing ? TIMING[m.timing]?.hi : '', daysHi(m)].filter(Boolean).join(' · ')
}

export function qty(m: Med): number | null {
  const fm = FREQ_MAP[normFreq(m.freq)]
  if (!fm || !m.days || !['TAB', 'CAP', 'SACHET', 'ROTACAP'].includes(m.form || '')) return null
  const per = /^[0-9.]+$/.test(m.dose || '') ? parseFloat(m.dose!) : m.dose === '½' ? 0.5 : 1
  if (normFreq(m.freq) === 'SOS') return null
  return Math.ceil(fm.perDay * m.days * per)
}

/* ---------- display name: "TAB. METFORMIN 500 MG" style, generic in capitals (NMC) ---------- */
export function displayName(m: Med): string {
  const form = m.form || detectForm(m.name)
  let n = m.name.replace(/\b(tablets?|capsules?|syrup|injection|suspension|ointment|cream|gel|inhaler|respules?|sachets?|eye drops?|drops)\b\s*(ip|bp|usp)?/gi, '').replace(/\s{2,}/g, ' ').trim()
  if (m.kind === 'ja') n = n.toUpperCase()
  return (form ? form + '. ' : '') + n
}

/* ---------- safety ---------- */
type Klass = { id: string; label: string; terms: string[] }
const CLASSES: Klass[] = [
  { id: 'sulfa', label: 'Sulfonamide', terms: ['sulfamethoxazole', 'cotrimoxazole', 'co-trimoxazole', 'septran', 'bactrim', 'sulfasalazine', 'sulfadiazine', 'silver sulfadiazine'] },
  { id: 'penicillin', label: 'Penicillin', terms: ['amoxicillin', 'amoxycillin', 'ampicillin', 'cloxacillin', 'dicloxacillin', 'flucloxacillin', 'piperacillin', 'penicillin', 'benzathine', 'augmentin', 'clavulan', 'mox '] },
  { id: 'cephalosporin', label: 'Cephalosporin', terms: ['cef', 'ceph', 'taxim', 'monocef', 'zifi'] },
  { id: 'nsaid', label: 'NSAID', terms: ['diclofenac', 'ibuprofen', 'aceclofenac', 'naproxen', 'ketorolac', 'etoricoxib', 'mefenamic', 'nimesulide', 'piroxicam', 'indomethacin', 'aspirin', 'zerodol', 'brufen', 'voveran', 'combiflam'] },
  { id: 'quinolone', label: 'Fluoroquinolone', terms: ['ciprofloxacin', 'ofloxacin', 'levofloxacin', 'moxifloxacin', 'norfloxacin', 'gatifloxacin'] },
  { id: 'macrolide', label: 'Macrolide', terms: ['azithromycin', 'clarithromycin', 'erythromycin', 'roxithromycin', 'azithral', 'azee'] },
  { id: 'paracetamol', label: 'Paracetamol', terms: ['paracetamol', 'acetaminophen', 'dolo', 'calpol', 'crocin', 'pcm '] },
  { id: 'ppi', label: 'Acid reducer (PPI/H2)', terms: ['pantoprazole', 'omeprazole', 'rabeprazole', 'esomeprazole', 'lansoprazole', 'ranitidine', 'famotidine', 'pan 40', 'pan-d', 'razo', 'rantac'] },
  { id: 'antihistamine', label: 'Antihistamine', terms: ['cetirizine', 'levocetirizine', 'fexofenadine', 'loratadine', 'desloratadine', 'chlorpheniramine', 'pheniramine', 'bilastine', 'allegra', 'okacet'] },
  { id: 'statin', label: 'Statin', terms: ['atorvastatin', 'rosuvastatin', 'simvastatin', 'pitavastatin'] },
  { id: 'sulfonylurea', label: 'Sulfonylurea', terms: ['glimepiride', 'gliclazide', 'glipizide', 'glibenclamide'] },
  { id: 'acei', label: 'ACE inhibitor', terms: ['enalapril', 'ramipril', 'lisinopril', 'perindopril'] },
  { id: 'arb', label: 'ARB', terms: ['telmisartan', 'losartan', 'olmesartan', 'valsartan', 'irbesartan'] },
  { id: 'steroid', label: 'Systemic steroid', terms: ['prednisolone', 'methylprednisolone', 'dexamethasone', 'deflazacort', 'hydrocortisone', 'betamethasone'] },
  { id: 'benzo', label: 'Benzodiazepine', terms: ['alprazolam', 'clonazepam', 'lorazepam', 'diazepam', 'etizolam'] },
  { id: 'clopidogrel', label: 'Clopidogrel', terms: ['clopidogrel'] },
  { id: 'metformin', label: 'Metformin', terms: ['metformin', 'glycomet'] },
  { id: 'k_sparing', label: 'Potassium-sparing diuretic', terms: ['spironolactone', 'eplerenone', 'amiloride'] },
]
export function classesOf(name: string): string[] {
  const s = ' ' + name.toLowerCase() + ' '
  return CLASSES.filter(k => k.terms.some(t => s.includes(t))).map(k => k.id)
}
const label = (id: string) => CLASSES.find(k => k.id === id)?.label || id

/** Allergy text like "Sulfa", "penicillin", "NSAIDs" → class ids. */
export function allergyClasses(allergies: string[]): string[] {
  const out = new Set<string>()
  for (const a of allergies) {
    const s = a.toLowerCase()
    if (/sulf|sulpha|septran/.test(s)) out.add('sulfa')
    if (/penic|amox|ampic/.test(s)) out.add('penicillin')
    if (/ceph|cef/.test(s)) out.add('cephalosporin')
    if (/nsaid|aspirin|diclo|ibupro|painkiller/.test(s)) out.add('nsaid')
    if (/quinol|cipro|levoflox|oflox/.test(s)) out.add('quinolone')
    if (/macrol|azithro|clarith|erythro/.test(s)) out.add('macrolide')
    for (const c of classesOf(a)) out.add(c)
  }
  return [...out]
}

export type Alert = { level: 'crit' | 'warn' | 'info'; text: string; med?: number }

export function safetyChecks(meds: Med[], ctx: { allergies?: string[]; conditions?: string[]; egfr?: number | null; age?: number | null; pregnant?: boolean }): Alert[] {
  const alerts: Alert[] = []
  const all = allergyClasses(ctx.allergies || [])
  const cls = meds.map(m => classesOf(m.name))
  meds.forEach((m, i) => {
    for (const c of cls[i]) {
      if (all.includes(c)) alerts.push({ level: 'crit', med: i, text: `${m.name}: patient is allergic to ${label(c)}. Remove it or record why it is safe.` })
      if (c === 'cephalosporin' && all.includes('penicillin')) alerts.push({ level: 'warn', med: i, text: `${m.name}: cephalosporin in a penicillin-allergic patient. Cross-reactivity is low but possible.` })
    }
  })
  const dupWatch = ['nsaid', 'paracetamol', 'ppi', 'antihistamine', 'statin', 'sulfonylurea', 'acei', 'arb', 'steroid', 'benzo', 'metformin', 'macrolide', 'quinolone']
  for (const c of dupWatch) {
    const idx = cls.map((k, i) => (k.includes(c) ? i : -1)).filter(i => i >= 0)
    if (idx.length > 1) alerts.push({ level: 'warn', med: idx[1], text: `Two ${label(c)} medicines: ${idx.map(i => meds[i].name).join(' + ')}.` })
  }
  const has = (c: string) => cls.some(k => k.includes(c))
  if (has('acei') && has('arb')) alerts.push({ level: 'warn', text: 'ACE inhibitor with an ARB: avoid dual RAAS blockade (kidney injury, high potassium).' })
  if ((has('acei') || has('arb')) && has('k_sparing')) alerts.push({ level: 'warn', text: 'ACE inhibitor/ARB with a potassium-sparing diuretic: check potassium.' })
  const conds = (ctx.conditions || []).join(' ').toLowerCase()
  const ckd = /ckd|kidney|renal/.test(conds) || (ctx.egfr != null && ctx.egfr < 60)
  if (ckd && has('nsaid')) alerts.push({ level: 'warn', text: 'NSAID in a patient with kidney disease.' })
  if (ctx.egfr != null && ctx.egfr < 30 && has('metformin')) alerts.push({ level: 'crit', text: `Metformin with eGFR ${ctx.egfr}: contraindicated below 30.` })
  if (/asthma|copd/.test(conds) && meds.some(m => /propranolol|atenolol|metoprolol|bisoprolol/i.test(m.name))) alerts.push({ level: 'warn', text: 'Beta-blocker in asthma/COPD: prefer a cardioselective one at a low dose.' })
  if (has('clopidogrel') && meds.some(m => /omeprazole|esomeprazole/i.test(m.name))) alerts.push({ level: 'info', text: 'Clopidogrel with omeprazole/esomeprazole reduces its effect; pantoprazole is preferred.' })
  // paracetamol total dose
  let pcm = 0
  meds.forEach(m => {
    if (!classesOf(m.name).includes('paracetamol')) return
    const mg = m.name.match(/(\d{3,4})\s*mg/i)
    const fm = FREQ_MAP[normFreq(m.freq)]
    if (mg && fm && normFreq(m.freq) !== 'SOS') pcm += parseInt(mg[1]) * fm.perDay * (parseFloat(m.dose || '1') || 1)
  })
  if (pcm > 4000) alerts.push({ level: 'crit', text: `Paracetamol adds up to ${pcm} mg a day (maximum 4,000 mg).` })
  if (ctx.age != null && ctx.age >= 65 && has('benzo')) alerts.push({ level: 'warn', text: 'Benzodiazepine in a patient over 65: fall risk.' })
  return alerts
}

/* ---------- vitals ---------- */
export type Flag = '' | 'warn' | 'crit'
export function vitalFlag(k: keyof Vitals, v?: string): Flag {
  const s = String(v || '').trim()
  if (!s) return ''
  if (k === 'bp') {
    const m = s.match(/(\d{2,3})\s*\/\s*(\d{2,3})/)
    if (!m) return ''
    const sy = +m[1], di = +m[2]
    if (sy >= 180 || di >= 110 || sy < 90) return 'crit'
    if (sy >= 140 || di >= 90) return 'warn'
    return ''
  }
  const n = parseFloat(s)
  if (isNaN(n)) return ''
  switch (k) {
    case 'pulse': return n > 130 || n < 45 ? 'crit' : n > 100 || n < 55 ? 'warn' : ''
    case 'spo2': return n < 90 ? 'crit' : n < 95 ? 'warn' : ''
    case 'temp': return n >= 103 || n < 95 ? 'crit' : n >= 99.5 ? 'warn' : ''
    case 'rr': return n > 30 || n < 8 ? 'crit' : n > 22 ? 'warn' : ''
    case 'grbs': return n >= 300 || n < 70 ? 'crit' : n >= 200 ? 'warn' : ''
    default: return ''
  }
}

/* ---------- reference lists ---------- */
export const COMORBIDITIES: { key: string; label: string; fields: { key: string; label: string; type?: 'text' | 'check' | 'select'; options?: string[] }[] }[] = [
  { key: 'diabetes', label: 'Diabetes', fields: [
    { key: 'duration', label: 'Duration' }, { key: 'treatment', label: 'Treatment', type: 'select', options: ['OHA', 'Insulin', 'OHA + Insulin', 'Diet only'] }, { key: 'drugs', label: 'Current drugs' },
    { key: 'fbs', label: 'FBS' }, { key: 'ppbs', label: 'PPBS' }, { key: 'hba1c', label: 'HbA1c %' },
    { key: 'neuropathy', label: 'Neuropathy', type: 'check' }, { key: 'retinopathy', label: 'Retinopathy', type: 'check' }, { key: 'nephropathy', label: 'Nephropathy', type: 'check' }, { key: 'cad', label: 'CAD', type: 'check' }, { key: 'foot', label: 'Diabetic foot', type: 'check' }, { key: 'notes', label: 'Notes' }] },
  { key: 'hypertension', label: 'Hypertension', fields: [
    { key: 'duration', label: 'Duration' }, { key: 'treatment', label: 'Treatment' }, { key: 'drugs', label: 'Current drugs' }, { key: 'bp_control', label: 'BP control', type: 'select', options: ['Controlled', 'Uncontrolled'] },
    { key: 'lvh', label: 'LVH', type: 'check' }, { key: 'ckd', label: 'CKD', type: 'check' }, { key: 'retinopathy', label: 'Retinopathy', type: 'check' }, { key: 'stroke', label: 'Stroke', type: 'check' }, { key: 'notes', label: 'Notes' }] },
  { key: 'copd', label: 'COPD / Asthma', fields: [
    { key: 'duration', label: 'Duration' }, { key: 'severity', label: 'Severity / GOLD' }, { key: 'pack_years', label: 'Smoking pack-years' }, { key: 'inhalers', label: 'Inhalers' }, { key: 'exacerbations', label: 'Exacerbations / yr' },
    { key: 'pht', label: 'Pulmonary HTN', type: 'check' }, { key: 'cor_pulmonale', label: 'Cor pulmonale', type: 'check' }, { key: 'notes', label: 'Notes' }] },
  { key: 'tb', label: 'Tuberculosis', fields: [
    { key: 'type', label: 'Type', type: 'select', options: ['Pulmonary', 'Extra-pulmonary'] }, { key: 'site', label: 'Site' }, { key: 'status', label: 'Status', type: 'select', options: ['On treatment', 'Completed', 'Defaulted'] }, { key: 'duration', label: 'Duration' }, { key: 'ds', label: 'DS / DR' }, { key: 'notes', label: 'Notes' }] },
  { key: 'thyroid', label: 'Thyroid Disorder', fields: [
    { key: 'type', label: 'Type', type: 'select', options: ['Hypothyroid', 'Hyperthyroid'] }, { key: 'duration', label: 'Duration' }, { key: 'tsh', label: 'TSH' }, { key: 'drugs', label: 'Drugs' }, { key: 'notes', label: 'Notes' }] },
  { key: 'cad', label: 'CAD', fields: [
    { key: 'type', label: 'Type' }, { key: 'duration', label: 'Duration' }, { key: 'lvef', label: 'LVEF %' }, { key: 'drugs', label: 'Drugs' },
    { key: 'cabg', label: 'CABG', type: 'check' }, { key: 'pci', label: 'PCI', type: 'check' }, { key: 'stenting', label: 'Stenting', type: 'check' }, { key: 'notes', label: 'Notes' }] },
  { key: 'ckd', label: 'CKD', fields: [
    { key: 'stage', label: 'Stage' }, { key: 'egfr', label: 'eGFR' }, { key: 'dialysis', label: 'On dialysis', type: 'check' }, { key: 'dial_type', label: 'Dialysis type' }, { key: 'duration', label: 'Duration' }, { key: 'drugs', label: 'Drugs' }, { key: 'notes', label: 'Notes' }] },
  { key: 'stroke', label: 'Stroke', fields: [
    { key: 'type', label: 'Type', type: 'select', options: ['Ischaemic', 'Haemorrhagic', 'TIA'] }, { key: 'duration', label: 'When' }, { key: 'deficit', label: 'Residual deficit' }, { key: 'drugs', label: 'Drugs' }, { key: 'notes', label: 'Notes' }] },
]
export const ADDICTIONS = [
  { key: 'smoking', label: 'Smoking' }, { key: 'alcohol', label: 'Alcohol' }, { key: 'tobacco', label: 'Tobacco / Gutkha' }, { key: 'iv_drug', label: 'IV Drug Use' },
]
export const EXAM_SIGNS = [
  { key: 'pallor', label: 'Pallor' }, { key: 'icterus', label: 'Icterus' }, { key: 'cyanosis', label: 'Cyanosis' }, { key: 'clubbing', label: 'Clubbing' }, { key: 'edema', label: 'Edema' }, { key: 'lymph_node', label: 'Lymph node' },
]
export const SYSTEMIC = [
  { key: 'rs', label: 'Chest (Rs)', normal: 'B/L NVBS, no added sounds' },
  { key: 'cvs', label: 'CVS', normal: 'S1 S2 heard, no murmur' },
  { key: 'cns', label: 'CNS', normal: 'Conscious, oriented, NAD' },
  { key: 'pa', label: 'P/A', normal: 'Soft, non-tender, no organomegaly' },
]
export const COMMON_INVESTIGATIONS = ['CBC', 'ESR', 'CRP', 'FBS', 'PPBS', 'RBS', 'HbA1c', 'Lipid profile', 'LFT', 'KFT', 'S. creatinine', 'S. electrolytes', 'TSH', 'T3 T4 TSH', 'Urine R/M', 'Urine C/S', 'Widal', 'Dengue NS1', 'Dengue IgM', 'Malaria antigen', 'Typhidot', 'Chest X-ray PA', 'ECG', '2D Echo', 'USG whole abdomen', 'Sputum AFB', 'CBNAAT', 'Vitamin D', 'Vitamin B12', 'S. uric acid', 'HBsAg', 'HIV', 'HCV']

export const ADVICE_PRESETS: { en: string; hi: string }[] = [
  { en: 'Drink plenty of fluids', hi: 'खूब पानी और तरल पदार्थ पिएँ' },
  { en: 'Take rest', hi: 'आराम करें' },
  { en: 'Low salt diet', hi: 'नमक कम खाएँ' },
  { en: 'Avoid sugar and sweets', hi: 'चीनी और मिठाई से परहेज़ करें' },
  { en: 'Walk 30 minutes daily', hi: 'रोज़ 30 मिनट टहलें' },
  { en: 'Avoid oily and spicy food', hi: 'तला-भुना और मसालेदार खाना न खाएँ' },
  { en: 'Steam inhalation twice daily', hi: 'दिन में दो बार भाप लें' },
  { en: 'Check sugar at home every week', hi: 'हर हफ़्ते घर पर शुगर जाँचें' },
  { en: 'Check BP at home every week', hi: 'हर हफ़्ते घर पर BP जाँचें' },
  { en: 'Stop smoking and tobacco', hi: 'धूम्रपान और तंबाकू छोड़ें' },
  { en: 'Avoid alcohol', hi: 'शराब न पिएँ' },
  { en: 'Come back immediately if symptoms worsen', hi: 'तकलीफ़ बढ़े तो तुरंत दिखाएँ' },
  { en: 'Do not stop medicines without asking the doctor', hi: 'डॉक्टर से पूछे बिना दवा बंद न करें' },
  { en: 'ORS after every loose stool', hi: 'हर दस्त के बाद ORS लें' },
  { en: 'Bring all reports at the next visit', hi: 'अगली बार सभी रिपोर्ट साथ लाएँ' },
]
export function adviceHi(en: string): string | null {
  return ADVICE_PRESETS.find(a => a.en.toLowerCase() === en.trim().toLowerCase())?.hi || null
}

/* ---------- dates in IST ---------- */
export function istToday(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}
export function addDaysISO(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
export function fmtDate(iso?: string | null): string {
  if (!iso) return ''
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}
export function fmtDateHi(iso: string): string {
  const months = ['जनवरी', 'फ़रवरी', 'मार्च', 'अप्रैल', 'मई', 'जून', 'जुलाई', 'अगस्त', 'सितंबर', 'अक्टूबर', 'नवंबर', 'दिसंबर']
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return `${d} ${months[m - 1]} ${y}`
}

export function normPhone(p?: string | null): string {
  const d = String(p || '').replace(/\D/g, '')
  if (d.length === 12 && d.startsWith('91')) return d.slice(2)
  if (d.length === 11 && d.startsWith('0')) return d.slice(1)
  return d
}
