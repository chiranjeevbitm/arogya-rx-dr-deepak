import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../lib/api'
import { addDaysISO, fmtDate } from '../lib/format'
import { Field } from '../components/ui'

type Info = { slug: string; name: string; name_hi: string; doctor: string; doctor_hi: string; quals: string; address: string; address_hi: string; phone: string; booking: { enabled: boolean; days_ahead: number; note: string }; closed_days: number[]; today: string }
type Slot = { time: string; session: string; available: boolean }

export default function Book() {
  const { slug } = useParams()
  const [info, setInfo] = useState<Info | null>(null), [err, setErr] = useState('')
  const [day, setDay] = useState(''), [slots, setSlots] = useState<Slot[] | null>(null), [closed, setClosed] = useState(false), [time, setTime] = useState('')
  const [f, setF] = useState({ name: '', phone: '', age_years: '', sex: '' as '' | 'M' | 'F' | 'O', reason: '', website: '' })
  const [busy, setBusy] = useState(false), [done, setDone] = useState<any>(null), [formErr, setFormErr] = useState('')
  useEffect(() => { api<Info>(`/public/clinic/${slug}`).then(i => { setInfo(i); setDay(i.today); document.title = `Book: ${i.doctor}` }).catch(e => setErr(e.message)) }, [slug])
  useEffect(() => { if (!day) return; setSlots(null); setTime(''); api<{ closed: boolean; slots: Slot[] }>(`/public/clinic/${slug}/slots?date=${day}`).then(r => { setSlots(r.slots); setClosed(r.closed) }).catch(e => setFormErr(e.message)) }, [day, slug])
  if (err) return <div className="center-page"><div className="auth-card"><b>Booking page not found</b><p className="muted">{err}</p></div></div>
  if (!info) return <div className="center-page muted">Loading…</div>
  const days = Array.from({ length: info.booking.days_ahead + 1 }, (_, i) => addDaysISO(info.today, i))
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setFormErr('')
    if (!time) return setFormErr('Choose a time.')
    setBusy(true)
    try { setDone(await api(`/public/clinic/${slug}/book`, { body: { ...f, age_years: f.age_years ? +f.age_years : null, sex: f.sex || null, date: day, time } })) }
    catch (e: any) { setFormErr(e.message); if (/taken/.test(e.message)) setDay(d => d) } finally { setBusy(false) }
  }
  const head = <div className="book-head">
    <img src="/lh/logo.png" alt="" style={{ width: 72, height: 'auto' }} />
    <div className="grow"><div className="hi">{info.name_hi}</div><b>{info.doctor}</b>, {info.quals}<div className="small muted">{info.address}</div><div className="small"><a href={`tel:+91${info.phone}`}>{info.phone}</a></div></div>
  </div>
  if (done) return <div className="book-wrap stack">{head}<div className="card stack">
    <h2>Your appointment is booked</h2>
    <p style={{ fontSize: 18 }}><b>{fmtDate(day)}, {time}</b> with {info.doctor}.</p>
    <p className="muted">आपका समय बुक हो गया है। {info.booking.note}</p>
    {done.whatsapp_confirmed ? <div className="alert ok">A confirmation has been sent to your WhatsApp.</div> : done.clinic_whatsapp && <a className="btn good lg" href={done.clinic_whatsapp} target="_blank" rel="noreferrer">Tell the clinic on WhatsApp</a>}
  </div></div>
  if (!info.booking.enabled) return <div className="book-wrap stack">{head}<div className="alert info">Online booking is closed. Please call <a href={`tel:+91${info.phone}`}>{info.phone}</a>.</div></div>
  const sessions = [...new Set((slots || []).map(s => s.session))]
  return <div className="book-wrap stack">
    {head}
    <form className="card stack" onSubmit={submit}>
      <h2>Book an appointment <span className="muted" style={{ fontWeight: 400, fontSize: 15 }}>/ समय बुक करें</span></h2>
      <div className="field"><span>Day / दिन</span><div className="days">{days.map(d => { const dow = new Date(d + 'T00:00:00').getDay(); return <button type="button" key={d} className="day" aria-pressed={d === day} disabled={info.closed_days.includes(dow)} onClick={() => setDay(d)}><span className="tiny">{d === info.today ? 'Today' : new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short' })}</span><b>{+d.slice(8)}</b><span className="tiny">{new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { month: 'short' })}</span></button> })}</div></div>
      <div className="field"><span>Time / समय</span>
        {!slots ? <span className="muted small">Loading times…</span> : closed ? <div className="alert info small">The clinic is closed that day.</div> : !slots.some(s => s.available) ? <div className="alert info small">No free times left that day. Please choose another day.</div> :
          sessions.map(se => <div key={se} className="stack tight"><span className="small muted">{se}</span><div className="slots">{slots.filter(s => s.session === se).map(s => <button type="button" key={s.time} className="slot" disabled={!s.available} aria-pressed={time === s.time} onClick={() => setTime(s.time)}>{s.time}</button>)}</div></div>)}
      </div>
      <div className="grid2">
        <Field label="Patient name / मरीज़ का नाम"><input className="inp" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} required minLength={2} autoComplete="name" /></Field>
        <Field label="Mobile / मोबाइल"><input className="inp" inputMode="tel" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} required autoComplete="tel" placeholder="10 digits" /></Field>
      </div>
      <div className="grid2">
        <Field label="Age / उम्र"><input className="inp" inputMode="numeric" value={f.age_years} onChange={e => setF({ ...f, age_years: e.target.value.replace(/\D/g, '').slice(0, 3) })} /></Field>
        <div className="field"><span>Sex</span><div className="seg">{(['M', 'F', 'O'] as const).map(s => <button type="button" key={s} aria-pressed={f.sex === s} onClick={() => setF({ ...f, sex: s })}>{s === 'M' ? 'Male' : s === 'F' ? 'Female' : 'Other'}</button>)}</div></div>
      </div>
      <Field label="Problem (optional) / तकलीफ़"><input className="inp" value={f.reason} onChange={e => setF({ ...f, reason: e.target.value })} /></Field>
      <input tabIndex={-1} autoComplete="off" className="sr" aria-hidden="true" value={f.website} onChange={e => setF({ ...f, website: e.target.value })} name="website" />
      {formErr && <div className="alert crit" role="alert">{formErr}</div>}
      <button className="btn primary lg" disabled={busy}>{busy ? 'Booking…' : time ? `Book ${fmtDate(day)}, ${time}` : 'Book appointment'}</button>
      <p className="small muted">{info.booking.note}</p>
    </form>
  </div>
}
