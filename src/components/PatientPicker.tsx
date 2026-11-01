import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { ageSex, fmtDate, d10 } from '../lib/format'
import { Field, TagInput } from './ui'

export type Patient = { id: string; uhid: string; name: string; sex: string | null; age_years: number | null; phone: string | null; address: string | null; allergies: string[]; conditions: string[]; last_visit?: string | null }
export type NewPatient = { name: string; sex: 'M' | 'F' | 'O' | null; age_years: number | null; phone: string; address: string; allergies: string[] }

/** Search existing patients by name, mobile or OP number; or fill a new-patient form. */
export function PatientPicker({ onPick, onNew, initial }: { onPick: (p: Patient) => void; onNew: (p: NewPatient) => void; initial?: string }) {
  const [q, setQ] = useState(initial || ''), [list, setList] = useState<Patient[]>([]), [mode, setMode] = useState<'search' | 'new'>('search')
  const [np, setNp] = useState<NewPatient>({ name: '', sex: null, age_years: null, phone: '', address: '', allergies: [] })
  useEffect(() => {
    if (mode !== 'search') return
    const ac = new AbortController()
    const t = setTimeout(() => api<Patient[]>('/patients?q=' + encodeURIComponent(q), { signal: ac.signal }).then(setList).catch(() => {}), q ? 180 : 0)
    return () => { clearTimeout(t); ac.abort() }
  }, [q, mode])
  useEffect(() => { onNew(np) }, [np]) // eslint-disable-line
  if (mode === 'new') return <div className="stack">
    <div className="grid2">
      <Field label="Patient name"><input className="inp" value={np.name} onChange={e => setNp({ ...np, name: e.target.value })} autoFocus /></Field>
      <Field label="Mobile number"><input className="inp" inputMode="tel" value={np.phone} onChange={e => setNp({ ...np, phone: e.target.value })} placeholder="10 digits" /></Field>
    </div>
    <div className="grid2">
      <Field label="Age (years)"><input className="inp" inputMode="numeric" value={np.age_years ?? ''} onChange={e => setNp({ ...np, age_years: e.target.value ? Math.max(0, Math.min(125, parseInt(e.target.value) || 0)) : null })} /></Field>
      <div className="field"><span>Sex</span><div className="seg">{(['M', 'F', 'O'] as const).map(s => <button type="button" key={s} aria-pressed={np.sex === s} onClick={() => setNp({ ...np, sex: s })}>{s === 'M' ? 'Male' : s === 'F' ? 'Female' : 'Other'}</button>)}</div></div>
    </div>
    <Field label="Address / village"><input className="inp" value={np.address} onChange={e => setNp({ ...np, address: e.target.value })} /></Field>
    <div className="field"><span>Allergies</span><TagInput value={np.allergies} onChange={a => setNp({ ...np, allergies: a })} placeholder="Type and press Enter" suggestions={['Sulfa', 'Penicillin', 'NSAIDs', 'None known']} /></div>
    <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setMode('search')}>Search existing patients instead</button>
  </div>
  return <div className="stack">
    <div className="row">
      <input className="inp grow" placeholder="Name, mobile number or OP number" value={q} onChange={e => setQ(e.target.value)} autoFocus />
      <button type="button" className="btn primary" onClick={() => { setNp({ ...np, name: /\d/.test(q) ? '' : q, phone: /^\d+$/.test(q.replace(/\s/g, '')) ? q : '' }); setMode('new') }}>New patient</button>
    </div>
    <div className="card flush"><div className="list" style={{ maxHeight: 330, overflow: 'auto' }}>
      {list.length === 0 && <div className="empty"><b>{q ? 'No patient found' : 'No patients yet'}</b>{q ? 'Check the spelling, search by mobile number, or add a new patient.' : 'Add the first patient.'}</div>}
      {list.map(p => <button type="button" key={p.id} className="li" onClick={() => onPick(p)}>
        <span className="grow"><b>{p.name}</b> <span className="muted small">{ageSex(p)}</span><br /><span className="small muted">{p.uhid}{p.phone ? `, ${p.phone}` : ''}{p.last_visit ? `, last visit ${fmtDate(d10(p.last_visit))}` : ''}</span></span>
        {p.allergies?.length > 0 && <span className="tag red">Allergy: {p.allergies.join(', ')}</span>}
      </button>)}
    </div></div>
  </div>
}
