import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api, fileUrl } from '../lib/api'
import { useMe } from '../lib/session'
import { fmtDate, timeAgo, d10 } from '../lib/format'
import { Modal, Spinner, useAsync, useToast } from '../components/ui'
import Icon from '../components/Icon'
import { ScanDialog, ScanAnalysis, type Scan } from '../components/AiDialogs'
import { PatientPicker, type Patient } from '../components/PatientPicker'

type Doc = { id: string; kind: string; doc_date: string | null; file_id: string | null; created_at: string; patient_id: string; patient_name: string; uhid: string; extracted: Partial<Scan> }

/** Every scanned report in one place: upload or photograph one for any patient, and read back
    what the AI made of the ones already on file. */
export default function Labs() {
  const me = useMe(), toast = useToast()
  const [kind, setKind] = useState('lab_report'), [q, setQ] = useState('')
  const list = useAsync(() => api<Doc[]>(`/ai/documents?kind=${kind}&q=${encodeURIComponent(q)}`), [kind, q])
  const [pick, setPick] = useState(false), [forPatient, setForPatient] = useState<Patient | null>(null), [open, setOpen] = useState<Doc | null>(null)
  const KINDS: [string, string][] = [['lab_report', 'Lab reports'], ['old_rx', 'Old prescriptions'], ['other', 'Other documents']]
  return <div className="stack">
    <div className="page-h">
      <div className="grow"><h1>Lab reports</h1><p>Photograph or upload a report for any patient. The values go into their trends and the reading is a draft for you to check.</p></div>
      <button className="btn primary" disabled={!me.features.ai} title={me.features.ai ? undefined : 'Add an AI key in Settings first'} onClick={() => setPick(true)}><Icon n="cam" />Scan or upload a report</button>
    </div>
    <div className="row wrap">
      <div className="chips">{KINDS.map(([k, l]) => <button key={k} className={'chip' + (kind === k ? ' on' : '')} onClick={() => setKind(k)}>{l}</button>)}</div>
      <span className="grow" />
      <input className="inp sm" style={{ width: 240 }} placeholder="Search patient or OP number" value={q} onChange={e => setQ(e.target.value)} aria-label="Search by patient" />
    </div>
    <div className="card flush">
      {list.loading && !list.data ? <Spinner /> : !(list.data || []).length ? <div className="empty"><b>Nothing here yet</b>Reports you scan or upload appear here, newest first.</div> :
        <div className="list">{list.data!.map(d => {
          const labs = d.extracted?.labs || [], odd = labs.filter(l => l.flag === 'high' || l.flag === 'low')
          return <button key={d.id} className="li" style={{ alignItems: 'flex-start', textAlign: 'left' }} onClick={() => setOpen(d)}>
            <Icon n="file" />
            <span className="grow"><b>{d.patient_name}</b> <span className="small muted">{d.uhid}</span><br />
              <span className="small muted">{d.doc_date ? fmtDate(d10(d.doc_date)) : timeAgo(d.created_at)}{d.extracted?.source_name ? `, ${d.extracted.source_name}` : ''}{labs.length ? `, ${labs.length} value${labs.length > 1 ? 's' : ''}` : ''}</span></span>
            {odd.length > 0 && <span className="tag red">{odd.length} out of range</span>}
            {d.extracted?.legible === false && <span className="tag amber">hard to read</span>}
          </button>
        })}</div>}
    </div>

    {pick && <Modal title="Which patient is this report for?" width={620} onClose={() => setPick(false)}>
      <PatientPicker onPick={p => { setForPatient(p); setPick(false) }} onNew={() => {}} />
    </Modal>}
    {forPatient && <ScanDialog patientId={forPatient.id} onClose={() => setForPatient(null)} onSaved={async r => {
      const p = forPatient!
      setForPatient(null)
      if (r.allergies.length || r.conditions.length) await api(`/patients/${p.id}`, { method: 'PUT', body: { allergies: [...new Set([...(p.allergies || []), ...r.allergies])], conditions: [...new Set([...(p.conditions || []), ...r.conditions])] } }).catch(() => {})
      toast(`Saved ${r.labs} lab value${r.labs === 1 ? '' : 's'} to ${p.name}`, 'ok'); list.reload()
    }} />}
    {open && <DocDialog d={open} onClose={() => setOpen(null)} />}
  </div>
}

function DocDialog({ d, onClose }: { d: Doc; onClose: () => void }) {
  const labs = d.extracted?.labs || [], cmp = (d.extracted as any)?.comparison as Scan['comparison']
  return <Modal title={`${d.patient_name}, ${d.doc_date ? fmtDate(d10(d.doc_date)) : fmtDate(d10(d.created_at))}`} width={760} onClose={onClose} footer={<>
    <span className="grow" />
    {d.file_id && <a className="btn" href={fileUrl(d.file_id)} target="_blank" rel="noreferrer"><Icon n="file" />Open the page</a>}
    <Link className="btn primary" to={`/patients/${d.patient_id}`} onClick={onClose}><Icon n="users" />Patient history</Link>
  </>}>
    <div className="stack">
      {labs.length > 0 && <div className="card flush"><table className="t"><thead><tr><th>Test</th><th className="num">Value</th><th className="num">Last time</th><th>Range</th></tr></thead><tbody>
        {labs.map((l, i) => { const p = (cmp || []).find(x => x.test === l.test); return <tr key={i}>
          <td>{l.test}</td>
          <td className="num"><b style={{ color: l.flag === 'high' || l.flag === 'low' ? 'var(--sindoor)' : undefined }}>{l.value}</b> {l.unit}</td>
          <td className="num small muted">{p?.previous ? `${p.direction === 'up' ? '↑' : p.direction === 'down' ? '↓' : ''} ${p.previous.value} ${p.previous.unit}` : '—'}</td>
          <td className="small muted">{l.ref_range}</td></tr> })}
      </tbody></table></div>}
      <ScanAnalysis s={d.extracted as Scan} />
      {d.extracted?.notes && <p className="small muted">{d.extracted.notes}</p>}
    </div>
  </Modal>
}
