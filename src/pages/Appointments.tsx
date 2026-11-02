import { useState } from 'react'
import { api } from '../lib/api'
import { useMe } from '../lib/session'
import { addDaysISO, istToday, dayName, fmtDate } from '../lib/format'
import { Modal, Spinner, useAsync, useToast, Field } from '../components/ui'
import Icon from '../components/Icon'

type Appt = { id: string; name: string; phone: string; time: string | null; appt_date: string; status: string; reason: string | null; source: string; uhid: string | null; age_years: number | null }

export default function Appointments() {
  const me = useMe(), toast = useToast()
  const [day, setDay] = useState(istToday()), [adding, setAdding] = useState(false), [moving, setMoving] = useState<Appt | null>(null)
  const list = useAsync(() => api<Appt[]>(`/appointments?from=${day}&to=${day}`), [day])
  const week = useAsync(() => api<Appt[]>(`/appointments?from=${istToday()}&to=${addDaysISO(istToday(), 13)}`), [])
  const counts = new Map<string, number>(); (week.data || []).filter(a => a.status === 'booked').forEach(a => counts.set(String(a.appt_date).slice(0, 10), (counts.get(String(a.appt_date).slice(0, 10)) || 0) + 1))
  const reload = () => { list.reload(); week.reload() }
  const act = async (a: Appt, path: string, body?: object, msg?: string) => { try { await api(`/appointments/${a.id}${path}`, { method: path ? 'POST' : 'PATCH', body }); if (msg) toast(msg, 'ok'); reload() } catch (e: any) { toast(e.message, 'err') } }
  const days = Array.from({ length: 14 }, (_, i) => addDaysISO(istToday(), i))
  const remind = (a: Appt) => window.open(`https://wa.me/91${a.phone}?text=${encodeURIComponent(`नमस्ते ${a.name} जी, ${me.clinic.settings.letterhead.doctor_hi} (${me.clinic.settings.letterhead.clinic_name_hi}) के यहाँ आपका समय ${fmtDate(String(a.appt_date).slice(0, 10))}${a.time ? ', ' + a.time : ''} को है। कृपया पुरानी पर्ची और रिपोर्ट साथ लाएँ।`)}`, '_blank')
  return <div className="stack">
    <div className="page-h"><div className="grow"><h1>Schedule</h1><p>Phone, website and WhatsApp bookings, and follow-ups from prescriptions.</p></div><button className="btn" onClick={() => { const l = `${location.origin}/book/${me.clinic.slug}`; (navigator.clipboard?.writeText(l) || Promise.reject()).then(() => toast('Booking link copied. Share it on WhatsApp and Google.', 'ok'), () => toast(l, 'info')) }}><Icon n="copy" />Booking link</button><button className="btn primary" onClick={() => setAdding(true)}><Icon n="plus" />Book appointment</button></div>
    <div className="days" role="group" aria-label="Day">{days.map(d => <button key={d} className="day" aria-pressed={d === day} onClick={() => setDay(d)}><span className="tiny">{d === istToday() ? 'Today' : dayName(d).split(' ')[0]}</span><b>{+d.slice(8)}</b><span className="tiny">{counts.get(d) ? `${counts.get(d)} booked` : '—'}</span></button>)}</div>
    <div className="card flush">
      {list.loading && !list.data ? <Spinner /> : (list.data || []).length === 0 ? <div className="empty"><b>No appointments on {dayName(day)}</b>Book one, or share the online booking link.</div> :
        <div className="list">{list.data!.map(a => <div key={a.id} className="li" style={{ opacity: a.status === 'cancelled' || a.status === 'no_show' ? .55 : 1 }}>
          <b style={{ minWidth: 56 }}>{a.time || 'Any'}</b>
          <span className="grow"><b>{a.name}</b>{a.age_years != null ? <span className="small muted"> {a.age_years} y</span> : null}<br /><span className="small muted">{a.phone}{a.reason ? `, ${a.reason}` : ''}</span></span>
          <span className="tag">{a.source === 'online' ? 'Online' : a.source === 'follow_up' ? 'Follow-up' : a.source === 'whatsapp' ? 'WhatsApp' : 'Phone'}</span>
          {a.status === 'booked' ? <span className="row">
            {day === istToday() && <button className="btn sm primary" onClick={() => act(a, '/arrive', undefined, `${a.name} added to the queue`)}>Arrived</button>}
            <button className="btn sm" onClick={() => remind(a)} title="Send a WhatsApp reminder"><Icon n="wa" /></button>
            <button className="btn sm" onClick={() => setMoving(a)}>Move</button>
            <button className="btn sm ghost" onClick={() => act(a, '', { status: 'cancelled' }, 'Cancelled')}>Cancel</button>
          </span> : <span className={'tag ' + (a.status === 'arrived' ? 'green' : '')}>{a.status === 'arrived' ? 'Arrived' : a.status === 'no_show' ? 'Did not come' : 'Cancelled'}</span>}
        </div>)}</div>}
    </div>
    {adding && <ApptDialog date={day} onClose={() => setAdding(false)} onDone={() => { setAdding(false); reload() }} />}
    {moving && <ApptDialog date={String(moving.appt_date).slice(0, 10)} appt={moving} onClose={() => setMoving(null)} onDone={() => { setMoving(null); reload() }} />}
  </div>
}

function ApptDialog({ date, appt, onClose, onDone }: { date: string; appt?: Appt; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [f, setF] = useState({ name: appt?.name || '', phone: appt?.phone || '', date, time: appt?.time || '', reason: appt?.reason || '', age_years: '' as string })
  const slots = useAsync(() => api<{ closed: boolean; slots: { time: string; session: string; free: number; past: boolean }[] }>(`/appointments/slots?date=${f.date}`), [f.date])
  const save = async () => {
    try {
      if (appt) await api(`/appointments/${appt.id}`, { method: 'PATCH', body: { date: f.date, time: f.time || null } })
      else await api('/appointments', { body: { name: f.name, phone: f.phone, date: f.date, time: f.time || null, reason: f.reason || undefined, age_years: f.age_years ? +f.age_years : null } })
      toast(appt ? 'Appointment moved' : 'Appointment booked', 'ok'); onDone()
    } catch (e: any) { toast(e.message, 'err') }
  }
  return <Modal title={appt ? `Move ${appt.name}` : 'Book appointment'} width={640} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!appt && (f.name.length < 2 || f.phone.replace(/\D/g, '').length < 10)} onClick={save}>{appt ? 'Move appointment' : 'Book'}</button></>}>
    <div className="stack">
      {!appt && <div className="grid3"><Field label="Name"><input className="inp" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field><Field label="Mobile"><input className="inp" inputMode="tel" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} /></Field><Field label="Age"><input className="inp" inputMode="numeric" value={f.age_years} onChange={e => setF({ ...f, age_years: e.target.value.replace(/\D/g, '') })} /></Field></div>}
      <div className="grid2"><Field label="Date"><input type="date" className="inp" min={istToday()} value={f.date} onChange={e => setF({ ...f, date: e.target.value, time: '' })} /></Field>{!appt && <Field label="Reason"><input className="inp" value={f.reason} onChange={e => setF({ ...f, reason: e.target.value })} /></Field>}</div>
      <div className="field"><span>Time</span>
        {slots.data?.closed ? <div className="alert warn small">The clinic is closed that day.</div> :
          <div className="slots"><button className="slot" aria-pressed={!f.time} onClick={() => setF({ ...f, time: '' })}>Any</button>{(slots.data?.slots || []).map(s => <button key={s.time} className="slot" disabled={s.past || (s.free <= 0 && s.time !== appt?.time)} aria-pressed={f.time === s.time} onClick={() => setF({ ...f, time: s.time })} title={`${s.session}, ${s.free} free`}>{s.time}</button>)}</div>}
      </div>
    </div>
  </Modal>
}
