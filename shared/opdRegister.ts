/* The clinic's paper/Excel OPD register as patients and visits. Money columns (fees, tests, lab, other income, expenses)
   are never part of a row. Used by the backend import only. */

export type RegisterRow = {
  serial: number; date: string; session: 'am' | 'pm' | null
  name: string; sex: 'M' | 'F' | null; age: number | null; weight: number | null
  fresh: boolean; address: string; phone: string; note: string
}

/* ---------- who is who ---------- */
export type RegPatient = {
  key: string; name: string; sex: 'M' | 'F' | null; age: number | null; address: string; phone: string
  placeholder: boolean; visits: RegisterRow[]
}
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9ऀ-ॿ]+/g, ' ').trim()

/** Same mobile number = same person. Otherwise same name and same place, unless the ages or mobile numbers clearly differ.
    Names that are a single letter (A, B, C …) are placeholders: each row stays its own patient. */
export function groupPatients(rows: RegisterRow[]): RegPatient[] {
  const ps: RegPatient[] = []
  for (const r of [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.serial - b.serial)) {
    const placeholder = norm(r.name).replace(/ /g, '').length < 2
    let p: RegPatient | undefined
    if (!placeholder) {
      p = r.phone ? ps.find(x => !x.placeholder && x.phone === r.phone && norm(x.name).split(' ')[0] === norm(r.name).split(' ')[0]) : undefined
      if (!p) p = ps.find(x => !x.placeholder && norm(x.name) === norm(r.name) && norm(x.address) === norm(r.address)
        && (x.age == null || r.age == null || Math.abs(x.age - r.age) <= 3)
        && (!x.phone || !r.phone || x.phone === r.phone || (!r.fresh && x.age != null && r.age != null)))   // a repeat visit with a new number and a matching age is the same person
    }
    if (!p) { p = { key: String(r.serial), name: placeholder ? `Unnamed patient (${r.name || '?'})` : r.name, sex: r.sex, age: r.age, address: r.address, phone: r.phone, placeholder, visits: [] }; ps.push(p) }
    p.visits.push(r)
    p.sex = p.sex || r.sex; p.age = r.age ?? p.age; p.address = r.address || p.address; p.phone = r.phone || p.phone
    if (r.name.length > p.name.length && !placeholder && norm(r.name).startsWith(norm(p.name))) p.name = r.name
  }
  return ps
}
