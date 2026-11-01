import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useMe } from '../lib/session'
import { inr } from '../lib/format'
import { useAsync, useToast } from '../components/ui'
import Icon from '../components/Icon'

type Msg = { who: 'me' | 'ai'; text: string; rows?: { id: string; name: string; uhid: string; detail: string }[] }
const QUICK = ['Diabetic patients with HbA1c above 7', 'Who is due for follow-up this week?', 'Hypertensive patients not seen in 3 months', 'Patients with allergies', 'How many patients today?']
const fmtT = (s: number) => Math.floor(s / 60) + ':' + String(Math.round(s % 60)).padStart(2, '0')

export default function Home() {
  const me = useMe(), nav = useNavigate(), toast = useToast()
  const sum = useAsync(() => api<any>('/clinic/summary'), [])
  const ap = useAsync(() => api<any[]>('/appointments'), [])
  const vs = useAsync(() => api<any[]>('/visits'), [])
  const [log, setLog] = useState<Msg[]>([]), [q, setQ] = useState(''), [busy, setBusy] = useState(false)
  const ask = async (text: string) => {
    text = text.trim(); if (!text) return
    setLog(l => [...l, { who: 'me' as const, text }].slice(-8)); setQ(''); setBusy(true)
    try { const r = await api<{ answer: string; rows: Msg['rows'] }>('/ask', { body: { q: text } }); setLog(l => [...l, { who: 'ai' as const, text: r.answer, rows: r.rows }].slice(-8)) }
    catch (e: any) { setLog(l => [...l, { who: 'ai' as const, text: e.message }]) } finally { setBusy(false) }
  }
  const start = async (visitId: string) => { try { const r = await api<{ rx_id: string }>(`/visits/${visitId}/start`, { method: 'POST' }); nav(`/opd/${r.rx_id}`) } catch (e: any) { toast(e.message, 'err') } }
  const arrive = async (id: string) => { try { const v = await api<any>(`/appointments/${id}/arrive`, { method: 'POST' }); toast(`Token ${v.token} given`, 'ok'); ap.reload(); vs.reload(); sum.reload() } catch (e: any) { toast(e.message, 'err') } }
  const S = sum.data, L = me.clinic.settings.letterhead
  const first = me.user.name.replace(/^Dr\.?\s*/i, '').split(' ')[0]
  const todays = [...(ap.data || []).filter(a => a.status !== 'cancelled').map(a => ({ k: 'a' + a.id, time: a.time || '', name: a.name, sub: [a.time, a.reason, a.source === 'online' ? 'Booked online' : a.source === 'follow_up' ? 'Follow-up' : 'Phone'].filter(Boolean).join(' · '), a })),
    ...(vs.data || []).filter(v => !v.appointment_id && v.status !== 'cancelled').map(v => ({ k: 'v' + v.id, time: '', name: v.name, sub: `Token ${v.token} · ${v.complaint || 'Walk-in'}`, v }))]
  const isDoc = me.user.role !== 'reception'
  return <div className="stack" style={{ gap: 18 }}>
    <div className="page-h">
      <div className="grow"><h1>Hi {me.user.role === 'doctor' ? `Dr. ${first}` : first}, how can I help today?</h1><p>{new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })} · {L.clinic_name_en}</p></div>
      <Link className="btn primary" to="/opd"><Icon n="rx" />Open OPD</Link>
    </div>
    <div className="kpis">
      <div className="kpi"><span>Seen today</span><b>{S?.visits.done ?? '—'}</b><small>of {S?.visits.total ?? 0} in the queue</small></div>
      <div className="kpi"><span>Avg time per parchi</span><b>{S ? fmtT(S.avg_secs) : '—'}</b><small>token call to save</small></div>
      <div className="kpi"><span>WhatsApp</span><b>{S?.wa_sent ?? '—'}</b><small>parchis sent in Hindi</small></div>
      <div className="kpi"><span>{isDoc ? 'Patients saved' : 'Collected'}</span><b>{S ? inr(isDoc ? S.saved : S.bills.collected) : '—'}</b><small>{isDoc ? 'generics vs brands' : `${inr(S?.bills.cash)} cash · ${inr(S?.bills.upi)} UPI`}</small></div>
    </div>
    <div className="grid2" style={{ alignItems: 'start' }}>
      <div className="card assistant">
        <h3 style={{ marginBottom: 10 }}>✦ Ask Arogya</h3>
        <form className="q" onSubmit={e => { e.preventDefault(); ask(q) }}><input className="inp" value={q} onChange={e => setQ(e.target.value)} placeholder="Ask about patients, follow-ups or today’s list" /><button className="btn primary" disabled={busy}>Ask</button></form>
        <div className="chips" style={{ marginTop: 10 }}>{QUICK.map(x => <button key={x} className="chip" onClick={() => ask(x)}>{x}</button>)}</div>
        <div className="ans">
          {log.length === 0 && <div className="msg ai">Ask about your patients in plain words, in English or Hindi. Try a suggestion above.</div>}
          {log.map((m, i) => <div key={i} className={'msg ' + m.who}>{m.text}{m.rows && m.rows.length > 0 && <div className="stack tight" style={{ marginTop: 6 }}>{m.rows.map(r => <Link key={r.id + r.detail} to={`/patients/${r.id}`}>{r.name} <span className="muted" style={{ fontWeight: 400 }}>· {r.detail}</span></Link>)}</div>}</div>)}
          {busy && <div className="msg ai muted">Looking…</div>}
        </div>
      </div>
      <div className="card">
        <div className="row" style={{ marginBottom: 6 }}><h3 className="grow">Today’s appointments</h3><Link to="/schedule" className="btn sm ghost">Schedule</Link></div>
        {todays.length === 0 ? <div className="empty small">Nothing booked today yet.</div> : todays.map(x => <div key={x.k} className="appt">
          <span className="av">{x.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()}</span>
          <span style={{ minWidth: 0 }}><b>{x.name}</b><br /><small className="muted">{x.sub}</small></span>
          {'a' in x ? (x.a.status === 'booked' ? <button className="btn sm" onClick={() => arrive(x.a.id)}>Arrived</button> : <span className="tag green">In queue</span>)
            : x.v.status === 'done' ? <span className="tag green">Seen</span> : isDoc ? <button className="btn sm" onClick={() => start(x.v.id)}>Start consult</button> : <span className="tag">{x.v.status === 'with_doctor' ? 'With doctor' : 'Waiting'}</span>}
        </div>)}
      </div>
    </div>
  </div>
}
