/* Unchanged drafts.

   Every "Open in OPD", "Call next patient" or "Repeat these medicines" creates a draft prescription at once, before the
   doctor writes anything. When nothing is then written, the draft is an exact copy of where it started, and a patient's
   Visit history filled up with "draft · No diagnosis written · No medicines" rows that say nothing.

   A draft is UNCHANGED when it is the same as one of the starting points it could have been made from:
     1. a blank prescription — allowing the complaint and vitals the receptionist put on the visit, and the chronic
        conditions / comorbidity details / addiction notes carried forward from the patient's earlier prescriptions;
     2. a copy of an earlier prescription of the same patient ("Repeat"), whose vitals start empty.
   Only drafts that were never final count: a reopened prescription is the record itself and is never hidden or pruned.
   Unchanged drafts are left out of the patient's history, and deleted once nobody has touched them for a while. */

/** Strips everything that carries no information (blank text, empty lists and objects, null, false) and sorts keys,
    so two prescriptions compare equal when they say the same thing. */
export function norm(v: any): any {
  if (v == null || v === false) return undefined
  if (typeof v === 'string') { const t = v.trim(); return t ? t : undefined }
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  if (Array.isArray(v)) { const a = v.map(norm).filter(x => x !== undefined); return a.length ? a : undefined }
  if (typeof v === 'object') {
    const o: Record<string, any> = {}
    for (const k of Object.keys(v).sort()) { const n = norm(v[k]); if (n !== undefined) o[k] = n }
    return Object.keys(o).length ? o : undefined
  }
  return v
}
const key = (v: any) => JSON.stringify(norm(v) ?? null)

/** Print options, not clinical content. */
const NOT_CONTENT = ['hindi']
/** Copied forward from the patient's earlier prescriptions when a visit's draft is made. */
const CARRIED = ['comorbid', 'comorbid_details', 'addiction', 'addiction_note']

export type RxRow = {
  id: string
  status: string
  finalized_at?: string | Date | null
  created_at: string | Date
  data: Record<string, any> | null
  meds: any[] | null
  visit_complaint?: string | null
  visit_vitals?: Record<string, any> | null
}

function content(data: Record<string, any> | null, meds: any[] | null) {
  const d: Record<string, any> = { ...(data || {}) }
  for (const k of NOT_CONTENT) delete d[k]
  return { d, meds: meds || [] }
}
const t = (x: string | Date) => new Date(x).getTime()

/** True when the draft adds nothing to where it started. `earlier` = the patient's prescriptions made before it. */
export function isUnchangedDraft(rx: RxRow, earlier: RxRow[]): boolean {
  if (rx.status !== 'draft' || rx.finalized_at) return false
  const { d, meds } = content(rx.data, rx.meds)

  // 1. blank start, plus what the visit and the patient's earlier prescriptions put in automatically
  const blank: Record<string, any> = { ...d }
  if (key(blank.complaints) === key(null) || key(blank.complaints) === key(rx.visit_complaint)) delete blank.complaints
  if (key(blank.vitals) === key(null) || key(blank.vitals) === key(rx.visit_vitals)) delete blank.vitals
  for (const k of CARRIED) if (k in blank && (key(blank[k]) === key(null) || earlier.some(e => key(e.data?.[k]) === key(blank[k])))) delete blank[k]
  if (key({ ...blank, meds }) === key(null)) return true

  // 2. a copy of an earlier prescription, untouched (vitals start empty on a copy, so a copy with vitals is a change)
  const mine = key({ ...d, meds })
  const mineNoVitals = key({ ...d, vitals: null, meds })
  const vitalsEmpty = key(d.vitals) === key(null)
  return earlier.some(e => {
    const o = content(e.data, e.meds)
    if (key({ ...o.d, meds: o.meds }) === mine) return true
    return vitalsEmpty && key({ ...o.d, vitals: null, meds: o.meds }) === mineNoVitals
  })
}

/** Ids of the unchanged drafts among one patient's prescriptions (any order). */
export function unchangedDraftIds(rows: RxRow[]): Set<string> {
  const sorted = [...rows].sort((a, b) => t(a.created_at) - t(b.created_at))
  const out = new Set<string>()
  sorted.forEach((r, i) => { if (isUnchangedDraft(r, sorted.slice(0, i))) out.add(r.id) })
  return out
}
