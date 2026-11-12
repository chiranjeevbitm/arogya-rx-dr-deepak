import Recordings from '../components/Recordings'
import { useMemo, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { api, fileUrl } from '../lib/api'
import { useMe } from '../lib/session'
import { ageSex, fmtDate, inr, d10, istToday } from '../lib/format'
import { Modal, Spinner, useAsync, useToast, Field } from '../components/ui'
import Icon from '../components/Icon'
import TrendChart from '../components/TrendChart'
import { EditPatient } from './Consult'
import { ScanDialog } from '../components/AiDialogs'
import { ParchiViewDialog } from '../components/ParchiView'
import { BILLING_ENABLED } from '../lib/features'
import { BillDialog } from '../components/BillDialog'
import { ReceiptDialog } from '../components/Receipt'

const TARGETS: Record<string, { hi?: number; lo?: number; unit: string }> = { HbA1c: { hi: 7, lo: 4, unit: '%' }, 'BP systolic': { hi: 140, lo: 100, unit: 'mmHg' }, GRBS: { hi: 180, lo: 80, unit: 'mg/dL' }, FBS: { hi: 130, lo: 80, unit: 'mg/dL' }, Weight: { unit: 'kg' }, 'S. creatinine': { hi: 1.2, lo: .6, unit: 'mg/dL' }, TSH: { hi: 4.5, lo: .4, unit: 'mIU/L' }, Hb: { hi: 16, lo: 12, unit: 'g/dL' } }

export default function PatientPage({ id: pid }: { id?: string }) {
  const params = useParams(), id = pid || params.id, me = useMe(), toast = useToast(), nav = useNavigate()
  const d = useAsync(() => api<any>(`/patients/${id}`), [id])
  const [edit, setEdit] = useState(false), [scan, setScan] = useState(false), [lab, setLab] = useState(false), [bill, setBill] = useState(false), [receipt, setReceipt] = useState<string | null>(null), [peek, setPeek] = useState<string | null>(null)
  const [remove, setRemove] = useState(false)
  const series = useMemo(() => {
    const m = new Map<string, { date: string; value: number }[]>()
    for (const l of d.data?.labs || []) if (l.value_num != null) { const k = l.test; if (!m.has(k)) m.set(k, []); m.get(k)!.push({ date: d10(l.result_date), value: l.value_num }) }
    return [...m.entries()].filter(([k, v]) => v.length >= 1 && k !== 'BP diastolic').sort((a, b) => (Object.keys(TARGETS).indexOf(a[0]) + 1 || 99) - (Object.keys(TARGETS).indexOf(b[0]) + 1 || 99))
  }, [d.data])
  if (d.loading && !d.data) return <Spinner />
  if (d.error) return <div className="empty"><b>Patient not found</b>{d.error}</div>
  const { patient: p, prescriptions, visits, documents, bills, upcoming, labs } = d.data
  const isDoc = me.user.role !== 'reception', archived = !!p.archived_at, canRemove = me.user.role === 'doctor' || me.user.role === 'admin'
  // prescriptions, plus visits that have no prescription that day (e.g. rows brought in from the paper OPD register), newest first
  const rxDays = new Set(prescriptions.map((r: any) => d10(r.rx_date)))
  const history = [...prescriptions.map((r: any) => ({ kind: 'rx', d: d10(r.rx_date), r })), ...visits.filter((v: any) => !rxDays.has(d10(v.visit_date))).map((v: any) => ({ kind: 'visit', d: d10(v.visit_date), v }))]
    .sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : a.kind === 'rx' ? -1 : 1))
  const newRx = async () => { try { const r = await api<{ rx_id: string }>('/rx', { body: { patient_id: p.id } }); nav(`/opd/${r.rx_id}`) } catch (e: any) { toast(e.message, 'err') } }
  const queue = async () => { try { const v = await api<any>('/visits', { body: { patient_id: p.id } }); toast(`Token ${v.token} given`, 'ok'); d.reload() } catch (e: any) { toast(e.message, 'err') } }
  return <div className="stack">
    <div className="page-h">
      <div className="grow"><h1>{p.name}</h1><p>{ageSex(p)}, {p.uhid}{p.phone ? `, ${p.phone}` : ''}{p.address ? `, ${p.address}` : ''}</p>
        <div className="row wrap" style={{ marginTop: 6 }}>{p.allergies.length ? <span className="tag red">Allergy: {p.allergies.join(', ')}</span> : <span className="tag">No known allergy</span>}{p.conditions.map((c: string) => <span key={c} className="tag ink">{c}</span>)}</div>
      </div>
      <div className="row wrap">
        {archived ? <button className="btn primary" onClick={() => setRemove(true)}>Put this patient back</button> : <>
          <button className="btn" onClick={() => setEdit(true)}><Icon n="edit" />Edit</button>
          <button className="btn" onClick={queue}><Icon n="queue" />Add to today's queue</button>
          {isDoc && <button className="btn primary" onClick={newRx}><Icon n="rx" />Open in OPD</button>}
          {canRemove && <button className="btn danger" title="Hide this patient from the clinic's screens" onClick={() => setRemove(true)}>Remove patient</button>}
        </>}
      </div>
    </div>
    {archived && <div className="alert warn small"><b>Removed from the patient list</b> on {fmtDate(d10(p.archived_at))}{p.archived_by_name ? ` by ${p.archived_by_name}` : ''}{p.archive_reason ? ` — ${p.archive_reason}` : ''}. Everything below is still kept and nothing was deleted. Put the patient back to use this record again.</div>}
    {p.notes && <div className="alert info small">{p.notes}</div>}
    {upcoming.length > 0 && <div className="alert info small"><Icon n="cal" size={18} /><span>Next appointment: {upcoming.map((a: any) => `${fmtDate(d10(a.appt_date))}${a.time ? ' ' + a.time : ''}`).join(', ')}</span></div>}
    <div className="ptgrid">
      <section className="card stack">
        <div className="fs-h"><span className="lbl">Visit history</span><span className="small muted">{visits.length} visit{visits.length === 1 ? '' : 's'} · {prescriptions.length} prescription{prescriptions.length === 1 ? '' : 's'}</span></div>
        {history.length === 0 ? <div className="timeline"><div className="tl"><b>First visit</b><p>No earlier records. Use photo intake to add old prescriptions.</p></div></div> :
          <div className="timeline">{history.map((h: any) => h.kind === 'rx' ? <div key={h.r.id} className="tl">
            <div className="d row" style={{ gap: 8 }}><span className="grow">{fmtDate(d10(h.r.rx_date))}{h.r.status !== 'final' ? ' · draft' : ''}{h.r.imported ? ' · from old app' : ''}</span>
              <button className="btn sm ghost" title="Show this parchi without opening it" onClick={() => setPeek(h.r.id)}><Icon n="file" />Show parchi</button></div>
            <Link to={h.r.status === 'final' ? `/rx/${h.r.id}` : `/opd/${h.r.id}`} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
              <b>{h.r.diagnosis || h.r.complaints || 'No diagnosis written'}</b>
              <p>{(h.r.meds || []).map((m: any) => m.name).join(', ') || 'No medicines'}{h.r.vitals?.bp ? ` · BP ${h.r.vitals.bp}` : ''}{h.r.vitals?.grbs ? ` · GRBS ${h.r.vitals.grbs}` : ''}</p>
            </Link>
          </div> : <div key={h.v.id} className="tl visit-only">
            <div className="d">{fmtDate(d10(h.v.visit_date))}{h.v.source === 'opd_register' ? ' · OPD register' : h.v.status !== 'done' ? ' · ' + (h.v.status === 'waiting' ? 'waiting' : 'with doctor') : ''}</div>
            <b>{h.v.visit_type === 'new' ? 'First visit' : 'Follow-up visit'}{h.v.vitals?.session ? (h.v.vitals.session === 'am' ? ', morning' : ', evening') : ''}</b>
            <p>{[h.v.complaint, h.v.vitals?.weight ? `Weight ${h.v.vitals.weight} kg` : '', h.v.source === 'opd_register' && !h.v.complaint ? 'Seen before Arogya Rx; no prescription on record' : ''].filter(Boolean).join(' · ') || 'No prescription written for this visit'}</p>
          </div>)}</div>}
      </section>
      <aside className="stack">
        <section className="card stack">
          <div className="row"><h2 className="grow">Trends</h2><button className="btn sm" onClick={() => setLab(true)}><Icon n="plus" />Lab value</button>{me.features.ai && <button className="btn sm" onClick={() => setScan(true)}><Icon n="cam" />Scan report</button>}</div>
          {series.length === 0 ? <p className="small muted">BP, sugar, weight and lab values appear here as visits and reports are added.</p> :
            series.slice(0, 6).map(([k, pts]) => <TrendChart key={k} label={k === 'BP systolic' ? 'BP (systolic)' : k} points={pts} target={TARGETS[k]} unit={TARGETS[k]?.unit || labs.find((l: any) => l.test === k)?.unit} color={k === 'HbA1c' ? '#C8241C' : '#1626B8'} />)}
        </section>
        {documents.length > 0 && <section className="card flush"><div className="card-h" style={{ padding: '14px 16px 0' }}><h2>Scanned documents</h2></div>
          <div className="list">{documents.map((x: any) => <a key={x.id} className="li" href={x.file_id ? fileUrl(x.file_id) : undefined} target="_blank" rel="noreferrer"><Icon n="file" /><span className="grow"><b>{x.kind === 'lab_report' ? 'Lab report' : x.kind === 'old_rx' ? 'Old prescription' : 'Document'}</b> {x.extracted?.source_name}<br /><span className="small muted">{x.doc_date ? fmtDate(d10(x.doc_date)) : fmtDate(d10(x.created_at))}{x.extracted?.labs?.length ? `, ${x.extracted.labs.length} values` : ''}</span></span></a>)}</div></section>}
        {BILLING_ENABLED && <section className="card flush"><div className="card-h" style={{ padding: '14px 16px 0' }}><h2 className="grow">Bills</h2><button className="btn sm" onClick={() => setBill(true)}><Icon n="plus" />Bill</button></div>
          {bills.length === 0 ? <div className="empty small">No bills.</div> : <div className="list">{bills.map((x: any) => <button key={x.id} className="li" onClick={() => setReceipt(x.id)}><span className="grow">#{x.bill_no}, {fmtDate(d10(x.bill_date))}</span><span className={'tag ' + (x.status === 'void' ? '' : x.status === 'due' ? 'amber' : 'green')}>{x.status === 'void' ? 'Cancelled' : x.status === 'due' ? 'Unpaid' : inr(x.paid)}</span></button>)}</div>}
        </section>}
        {me.user.role === 'doctor' && <section className="card stack tight"><h2>Voice recordings</h2><Recordings patientId={p.id} limit={30} /></section>}
        {visits.length > 0 && <p className="small faint">Coming since {fmtDate(d10(visits[visits.length - 1].visit_date))}.</p>}
      </aside>
    </div>
    {edit && <EditPatient p={p} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); d.reload() }} />}
    {scan && <ScanDialog patientId={p.id} onClose={() => setScan(false)} onSaved={async r => { setScan(false); if (r.allergies.length || r.conditions.length) await api(`/patients/${p.id}`, { method: 'PUT', body: { allergies: [...new Set([...p.allergies, ...r.allergies])], conditions: [...new Set([...p.conditions, ...r.conditions])] } }); toast(`Saved ${r.labs} values`, 'ok'); d.reload() }} />}
    {lab && <LabDialog pid={p.id} onClose={() => setLab(false)} onDone={() => { setLab(false); d.reload() }} />}
    {bill && <BillDialog patient={{ id: p.id, name: p.name }} onClose={() => setBill(false)} onDone={id => { setBill(false); setReceipt(id); d.reload() }} />}
    {receipt && <ReceiptDialog billId={receipt} onClose={() => setReceipt(null)} onChange={d.reload} />}
    {peek && <ParchiViewDialog rxId={peek} onClose={() => setPeek(null)} />}
    {remove && <RemovePatientDialog p={p} restoring={archived} counts={{ visits: visits.length, prescriptions: prescriptions.length, labs: labs.length, documents: documents.length }} onClose={() => setRemove(false)} onDone={() => { setRemove(false); if (archived) d.reload(); else nav('/patients', { replace: true }) }} />}
  </div>
}

/** Removing a patient is the one destructive-looking action in the app, so it says plainly what it does
    (hides, never deletes) and asks the doctor for their own login password before it happens. */
export function RemovePatientDialog({ p, restoring, counts, onClose, onDone }: {
  p: any; restoring?: boolean; counts?: { visits: number; prescriptions: number; labs: number; documents: number }; onClose: () => void; onDone: () => void
}) {
  const toast = useToast()
  const [pw, setPw] = useState(''), [reason, setReason] = useState(''), [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null)
  const go = async () => {
    if (!pw || busy) return
    setBusy(true); setErr(null)
    try {
      await api(`/patients/${p.id}/${restoring ? 'restore' : 'archive'}`, { body: restoring ? { password: pw } : { password: pw, reason: reason.trim() || undefined } })
      toast(restoring ? `${p.name} is back in the patient list` : `${p.name} removed from the patient list`, 'ok')
      onDone()
    } catch (e: any) { setErr(e.message); setPw('') } finally { setBusy(false) }
  }
  const kept = counts ? [counts.visits && `${counts.visits} visit${counts.visits > 1 ? 's' : ''}`, counts.prescriptions && `${counts.prescriptions} prescription${counts.prescriptions > 1 ? 's' : ''}`,
    counts.labs && `${counts.labs} lab value${counts.labs > 1 ? 's' : ''}`, counts.documents && `${counts.documents} document${counts.documents > 1 ? 's' : ''}`].filter(Boolean).join(', ') : ''
  return <Modal title={restoring ? `Put ${p.name} back?` : `Remove ${p.name}?`} width={520} onClose={onClose} footer={<>
    <button className="btn" onClick={onClose}>Cancel</button>
    <button className={'btn ' + (restoring ? 'primary' : 'danger')} disabled={!pw || busy} onClick={go}>{busy ? 'Please wait…' : restoring ? 'Put back' : 'Remove patient'}</button>
  </>}>
    <div className="stack">
      {restoring
        ? <p style={{ margin: 0 }}>{p.name} ({p.uhid}) goes back into the patient list and search, and can be given a token and a prescription again. Nothing has to be re-entered.</p>
        : <>
          <p style={{ margin: 0 }}><b>{p.name}</b> ({p.uhid}) disappears from the patient list, search, today's queue, Ask Arogya and the patient count. Any token today and any appointment still to come are cancelled.</p>
          <div className="alert info small" style={{ margin: 0 }}>Nothing is deleted.{kept ? ` ${kept} stay in the records,` : ' The records stay,'} and you can put the patient back any time from Settings → Security → Removed patients.</div>
          <Field label="Why (optional, kept in the activity log)"><input className="inp" value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. registered twice by mistake" maxLength={200} /></Field>
        </>}
      <Field label="Type your login password to confirm">
        <input type="password" className="inp" autoComplete="current-password" autoFocus value={pw} onChange={e => setPw(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') go() }} />
      </Field>
      {err && <div className="alert warn small" style={{ margin: 0 }}>{err}</div>}
    </div>
  </Modal>
}

function LabDialog({ pid, onClose, onDone }: { pid: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [f, setF] = useState({ test: 'HbA1c', value: '', unit: '%', date: istToday() })
  const save = async () => { try { await api(`/patients/${pid}/labs`, { body: { items: [{ test: f.test, value: f.value, unit: f.unit, date: f.date }] } }); toast('Saved', 'ok'); onDone() } catch (e: any) { toast(e.message, 'err') } }
  return <Modal title="Add a lab value" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!f.value} onClick={save}>Save</button></>}>
    <div className="stack">
      <div className="chips">{Object.entries(TARGETS).filter(([k]) => k !== 'BP systolic').map(([k, v]) => <button key={k} className={'chip' + (f.test === k ? ' on' : '')} onClick={() => setF({ ...f, test: k, unit: v.unit })}>{k}</button>)}</div>
      <div className="grid3"><Field label="Test"><input className="inp" value={f.test} onChange={e => setF({ ...f, test: e.target.value })} /></Field><Field label="Value"><input className="inp" inputMode="decimal" value={f.value} onChange={e => setF({ ...f, value: e.target.value })} autoFocus /></Field><Field label="Unit"><input className="inp" value={f.unit} onChange={e => setF({ ...f, unit: e.target.value })} /></Field></div>
      <Field label="Date"><input type="date" className="inp" value={f.date} max={istToday()} onChange={e => setF({ ...f, date: e.target.value })} /></Field>
    </div>
  </Modal>
}
