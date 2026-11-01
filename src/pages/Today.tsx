import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { api } from '../lib/api'
import { useMe } from '../lib/session'
import { ageSex, inr, istToday } from '../lib/format'
import { Modal, Spinner, useAsync, useLive, useToast, Field } from '../components/ui'
import { PatientPicker, type Patient, type NewPatient } from '../components/PatientPicker'
import { BillDialog } from '../components/BillDialog'
import { ReceiptDialog } from '../components/Receipt'
import Icon from '../components/Icon'
import { vitalFlag, type Vitals } from '../../shared/rx'

type Visit = { id: string; token: number; status: string; visit_type: string; complaint: string | null; patient_id: string; name: string; uhid: string; sex: string | null; age_years: number | null; phone: string | null; allergies: string[]; vitals: Vitals; rx_id: string | null; rx_status: string | null; bill_id: string | null; bill_paid: number | null; bill_mode: string | null; source: string }
type Appt = { id: string; name: string; phone: string; time: string | null; status: string; reason: string | null; source: string }

export default function Today() {
  const me = useMe(), nav = useNavigate(), toast = useToast()
  const isDoc = me.user.role !== 'reception'
  const q = useAsync(() => api<Visit[]>('/visits'), [])
  const sum = useAsync(() => api<any>('/clinic/summary'), [])
  const ap = useAsync(() => api<Appt[]>('/appointments'), [])
  const [adding, setAdding] = useState(false), [billFor, setBillFor] = useState<Visit | null>(null), [receipt, setReceipt] = useState<string | null>(null), [vitalsFor, setVitalsFor] = useState<Visit | null>(null)
  const reload = () => { q.reload(); sum.reload(); ap.reload() }
  useLive(() => { q.reload(); ap.reload() }, 5000)

  const open = async (v: Visit) => {
    if (!isDoc) return nav(`/patients/${v.patient_id}`)
    try { const r = await api<{ rx_id: string }>(`/visits/${v.id}/start`, { method: 'POST' }); nav(`/opd/${r.rx_id}`) } catch (e: any) { toast(e.message, 'err') }
  }
  const callNext = async () => {
    try { const r = await api<{ visit_id: string }>('/visits/next', { method: 'POST' }); const v = q.data?.find(x => x.id === r.visit_id); if (v) open(v) } catch (e: any) { toast(e.message, 'err') }
  }
  const arrive = async (a: Appt) => { try { const v = await api<any>(`/appointments/${a.id}/arrive`, { method: 'POST' }); toast(`${a.name} added as token ${v.token}`, 'ok'); reload() } catch (e: any) { toast(e.message, 'err') } }
  const setStatus = async (v: Visit, status: string) => { try { await api(`/visits/${v.id}`, { method: 'PATCH', body: { status } }); reload() } catch (e: any) { toast(e.message, 'err') } }

  const list = q.data || []
  const withDoc = list.find(v => v.status === 'with_doctor')
  const waiting = list.filter(v => v.status === 'waiting')
  const pendingAppts = (ap.data || []).filter(a => a.status === 'booked')
  const S = sum.data
  const hello = new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 17 ? 'Good afternoon' : 'Good evening'

  return <div className="stack" style={{ gap: 16 }}>
    <div className="page-h">
      <div className="grow"><h1>{hello}, {me.user.name.split(' ').slice(0, 2).join(' ')}</h1><p>{new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</p></div>
      <button className="btn primary lg" onClick={() => setAdding(true)}><Icon n="plus" />Add patient to queue</button>
    </div>

    {isDoc && <div className="now-card">
      {withDoc ? <>
        <div><div className="small" style={{ opacity: .8 }}>With you now</div><div className="big">{withDoc.token}</div></div>
        <div className="grow"><div style={{ font: '700 20px var(--f-head)' }}>{withDoc.name}</div><div style={{ opacity: .85 }}>{ageSex(withDoc)}{withDoc.complaint ? `, ${withDoc.complaint}` : ''}</div></div>
        <button className="btn lg" onClick={() => open(withDoc)}>Continue consult</button>
      </> : <>
        <div><div className="small" style={{ opacity: .8 }}>Waiting</div><div className="big">{waiting.length}</div></div>
        <div className="grow">{waiting[0] ? <><div style={{ font: '700 20px var(--f-head)' }}>Next: token {waiting[0].token}, {waiting[0].name}</div><div style={{ opacity: .85 }}>{ageSex(waiting[0])}{waiting[0].complaint ? `, ${waiting[0].complaint}` : ''}</div></> : <div style={{ font: '700 18px var(--f-head)' }}>No one is waiting.</div>}</div>
        <button className="btn lg" disabled={!waiting.length} onClick={callNext}>Call next patient</button>
      </>}
    </div>}

    {S && <div className="stat-row">
      <div className="stat"><b>{S.visits.total}</b><span>patients today, {S.visits.new_visits} new</span></div>
      <div className="stat"><b>{S.visits.waiting}</b><span>waiting</span></div>
      <div className="stat"><b>{S.appointments.booked}</b><span>appointments still to come</span></div>
      <div className="stat"><b>{inr(S.bills.collected)}</b><span>collected ({inr(S.bills.cash)} cash, {inr(S.bills.upi)} UPI)</span></div>
    </div>}

    <div className="ptgrid">
      <section className="card flush">
        <div className="card-h" style={{ padding: '14px 16px 0' }}><h2 className="grow">Today's queue</h2><button className="icon-btn" onClick={reload} aria-label="Refresh"><Icon n="refresh" /></button></div>
        {q.loading && !q.data ? <Spinner /> : list.length === 0 ? <div className="empty"><b>The queue is empty</b>Add the first patient, or mark an appointment as arrived.</div> :
          <div className="list">{list.map(v => {
            const flags = (['bp', 'pulse', 'spo2', 'temp', 'grbs'] as const).filter(k => vitalFlag(k, v.vitals?.[k]))
            return <div key={v.id} className={'qrow' + (v.status === 'done' || v.status === 'cancelled' ? ' done' : '')}>
              <span className={'tok ' + (v.status === 'with_doctor' ? 'with' : v.status === 'done' ? 'done' : '')}>{v.token}</span>
              <button className="who grow" style={{ background: 'none', border: 0, textAlign: 'left', cursor: 'pointer', padding: 0, minWidth: 0 }} onClick={() => open(v)}>
                <b className="ellipsis">{v.name}</b>
                <span>{ageSex(v)}{v.complaint ? `, ${v.complaint}` : ''}</span>
                <span className="row wrap" style={{ marginTop: 3 }}>
                  {v.visit_type === 'follow_up' && <span className="tag ink">Follow-up</span>}
                  {v.source === 'online' && <span className="tag">Booked online</span>}
                  {v.allergies?.length > 0 && <span className="tag red">Allergy: {v.allergies.join(', ')}</span>}
                  {flags.length > 0 && <span className="tag amber">Check {flags.map(f => f.toUpperCase()).join(', ')}</span>}
                  {v.status === 'cancelled' && <span className="tag">Left</span>}
                </span>
              </button>
              <div className="row wrap" style={{ justifyContent: 'flex-end' }}>
                {v.status === 'waiting' && <button className="btn sm" onClick={() => setVitalsFor(v)}>Vitals</button>}
                {v.rx_status === 'final' && <Link className="btn sm" to={`/rx/${v.rx_id}`}><Icon n="rx" />Parchi</Link>}
                {v.bill_id ? <button className="btn sm ghost" onClick={() => setReceipt(v.bill_id)}><span className="tag green">{v.bill_mode === 'due' ? 'Unpaid' : inr(v.bill_paid)}</span></button>
                  : v.status !== 'cancelled' && <button className="btn sm" onClick={() => setBillFor(v)}><Icon n="rupee" />Bill</button>}
                {v.status === 'waiting' && <button className="icon-btn" title="Patient left" aria-label="Mark as left" onClick={() => setStatus(v, 'cancelled')}><Icon n="x" /></button>}
              </div>
            </div>
          })}</div>}
      </section>

      <aside className="stack">
        <section className="card flush">
          <div className="card-h" style={{ padding: '14px 16px 0' }}><h2 className="grow">Appointments</h2><Link to="/appointments" className="btn sm ghost">All</Link></div>
          {pendingAppts.length === 0 ? <div className="empty small">No more appointments today.</div> :
            <div className="list">{pendingAppts.map(a => <div key={a.id} className="li">
              <span className="grow"><b>{a.time || 'Any time'}</b> {a.name}<br /><span className="small muted">{a.source === 'online' ? 'Booked online' : a.source === 'follow_up' ? 'Follow-up' : 'By phone'}{a.reason ? `, ${a.reason}` : ''}</span></span>
              <button className="btn sm primary" onClick={() => arrive(a)}>Arrived</button>
            </div>)}</div>}
        </section>
        {isDoc && <section className="card small">
          <h3 style={{ marginBottom: 6 }}>Online booking</h3>
          <p className="muted">Patients can book at <a href={`/book/${me.clinic.slug}`} target="_blank" rel="noreferrer">{location.host}/book/{me.clinic.slug}</a>. Share it on WhatsApp or link it from the clinic website.</p>
        </section>}
      </aside>
    </div>

    {adding && <AddToQueue onClose={() => setAdding(false)} onDone={() => { setAdding(false); reload() }} />}
    {billFor && <BillDialog patient={{ id: billFor.patient_id, name: billFor.name }} visit={billFor} onClose={() => setBillFor(null)} onDone={id => { setBillFor(null); setReceipt(id); reload() }} />}
    {receipt && <ReceiptDialog billId={receipt} onClose={() => setReceipt(null)} onChange={reload} />}
    {vitalsFor && <VitalsDialog v={vitalsFor} onClose={() => setVitalsFor(null)} onDone={() => { setVitalsFor(null); reload() }} />}
  </div>
}

function VitalsBlock({ v, set }: { v: Vitals; set: (v: Vitals) => void }) {
  const F: [keyof Vitals, string, string][] = [['bp', 'BP', '120/80'], ['pulse', 'Pulse', '/min'], ['spo2', 'SpO₂ %', ''], ['temp', 'Temp °F', ''], ['grbs', 'Sugar (GRBS)', 'mg/dL'], ['weight', 'Weight kg', '']]
  return <div className="grid3">{F.map(([k, l, ph]) => <Field key={k} label={l}><input className={'inp ' + vitalFlag(k, v[k])} inputMode={k === 'bp' ? 'text' : 'decimal'} placeholder={ph} value={v[k] || ''} onChange={e => set({ ...v, [k]: e.target.value })} /></Field>)}</div>
}

export function AddToQueue({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [picked, setPicked] = useState<Patient | null>(null), [np, setNp] = useState<NewPatient | null>(null)
  const [complaint, setComplaint] = useState(''), [vitals, setVitals] = useState<Vitals>({}), [busy, setBusy] = useState(false)
  const ready = picked || (np && np.name.trim().length >= 2)
  const save = async () => {
    setBusy(true)
    try {
      const v = await api<any>('/visits', { body: picked ? { patient_id: picked.id, complaint, vitals } : { patient: { ...np, phone: np!.phone || null, address: np!.address || null }, complaint, vitals } })
      toast(`Token ${v.token} given`, 'ok'); onDone()
    } catch (e: any) { toast(e.message, 'err') } finally { setBusy(false) }
  }
  return <Modal title="Add patient to today's queue" width={680} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!ready || busy} onClick={save}>Give token</button></>}>
    <div className="stack">
      {picked ? <div className="alert info"><span className="grow"><b>{picked.name}</b> <span className="muted">{ageSex(picked)}, {picked.uhid}</span>{picked.allergies.length > 0 && <><br /><span className="tag red">Allergy: {picked.allergies.join(', ')}</span></>}</span><button className="btn sm" onClick={() => setPicked(null)}>Change</button></div>
        : <PatientPicker onPick={setPicked} onNew={setNp} />}
      <Field label="Complaint (optional)"><input className="inp" value={complaint} onChange={e => setComplaint(e.target.value)} placeholder="e.g. fever for 3 days" /></Field>
      <details><summary className="small" style={{ cursor: 'pointer', fontWeight: 600 }}>Add vitals now</summary><div style={{ marginTop: 10 }}><VitalsBlock v={vitals} set={setVitals} /></div></details>
    </div>
  </Modal>
}

function VitalsDialog({ v, onClose, onDone }: { v: Visit; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [vitals, setVitals] = useState<Vitals>(v.vitals || {}), [complaint, setComplaint] = useState(v.complaint || '')
  const save = async () => { try { await api(`/visits/${v.id}`, { method: 'PATCH', body: { vitals, complaint } }); toast('Vitals saved', 'ok'); onDone() } catch (e: any) { toast(e.message, 'err') } }
  return <Modal title={`Token ${v.token}: ${v.name}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save vitals</button></>}>
    <div className="stack"><Field label="Complaint"><input className="inp" value={complaint} onChange={e => setComplaint(e.target.value)} /></Field><VitalsBlock v={vitals} set={setVitals} /></div>
  </Modal>
}

export { istToday }
