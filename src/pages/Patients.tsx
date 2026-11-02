import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../lib/api'
import { Modal, useToast } from '../components/ui'
import Icon from '../components/Icon'
import { PatientPicker, type Patient, type NewPatient } from '../components/PatientPicker'
import PatientPage from './PatientPage'
import AskDialog from '../components/Ask'

export default function Patients() {
  const { id } = useParams(), nav = useNavigate(), toast = useToast()
  const [q, setQ] = useState(''), [list, setList] = useState<Patient[] | null>(null), [adding, setAdding] = useState(false), [asking, setAsking] = useState(false), [np, setNp] = useState<NewPatient | null>(null)
  useEffect(() => { const ac = new AbortController(); const t = setTimeout(() => api<Patient[]>('/patients?q=' + encodeURIComponent(q), { signal: ac.signal }).then(setList).catch(() => {}), 200); return () => { clearTimeout(t); ac.abort() } }, [q])
  useEffect(() => { if (!id && list?.length && window.innerWidth > 900) nav(`/patients/${list[0].id}`, { replace: true }) }, [id, list]) // eslint-disable-line
  const create = async () => { try { const p = await api<Patient>('/patients', { body: { ...np, phone: np!.phone || null, address: np!.address || null } }); setAdding(false); nav(`/patients/${p.id}`) } catch (e: any) { toast(e.message, 'err') } }
  return <div className="stack">
    <div className="page-h"><div className="grow"><h1>Patients</h1><p>Search by name, OP number, mobile or condition.</p></div><button className="btn" onClick={() => setAsking(true)}>✦ Ask Arogya</button><button className="btn primary" onClick={() => setAdding(true)}><Icon n="plus" />New patient</button></div>
    <div className="pview">
      <div className="plist">
        <input className="inp" placeholder="e.g. Ramesh, AC-00012, 98xxxx" value={q} onChange={e => setQ(e.target.value)} />
        {list && list.length === 0 && <div className="empty small">No match.</div>}
        {list?.map(x => <button key={x.id} className={'q-item' + (x.id === id ? ' on' : '')} onClick={() => nav(`/patients/${x.id}`)}>
          <span className="q-tok" style={{ fontFamily: 'var(--f-ui)', fontSize: 13 }}>{x.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}</span>
          <span style={{ minWidth: 0 }}><span className="q-name">{x.name}</span><span className="q-sub">{x.uhid} · {x.age_years ?? ''}{x.sex || ''}{x.conditions?.length ? ' · ' + x.conditions.join(', ') : ''}</span></span>
        </button>)}
      </div>
      <div className="card">{id ? <PatientPage key={id} id={id} /> : <div className="empty">Choose a patient.</div>}</div>
    </div>
    {asking && <AskDialog onClose={() => setAsking(false)} />}
    {adding && <Modal title="New patient" width={620} onClose={() => setAdding(false)} footer={<><button className="btn" onClick={() => setAdding(false)}>Cancel</button><button className="btn primary" disabled={!np || np.name.trim().length < 2} onClick={create}>Save patient</button></>}>
      <PatientPicker onPick={p => { setAdding(false); nav(`/patients/${p.id}`) }} onNew={setNp} />
    </Modal>}
  </div>
}
