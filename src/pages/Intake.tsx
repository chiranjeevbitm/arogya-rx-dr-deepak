import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api, fileUrl } from '../lib/api'
import { useMe } from '../lib/session'
import { fmtDate, istToday, addDaysISO, d10, timeAgo } from '../lib/format'
import { Modal, useAsync, useToast } from '../components/ui'
import Icon from '../components/Icon'
import { PatientPicker, type Patient } from '../components/PatientPicker'
import { ScanDialog } from '../components/AiDialogs'

export default function Intake() {
  const me = useMe(), toast = useToast()
  const bookings = useAsync(() => api<any[]>(`/appointments?from=${istToday()}&to=${addDaysISO(istToday(), 14)}`), [])
  const [pick, setPick] = useState(false), [scanFor, setScanFor] = useState<Patient | null>(null), [recent, setRecent] = useState<{ p: Patient; text: string }[]>([])
  const online = (bookings.data || []).filter(a => ['online', 'whatsapp'].includes(a.source) && a.status === 'booked')
  const arrive = async (a: any) => { try { const v = await api<any>(`/appointments/${a.id}/arrive`, { method: 'POST' }); toast(`${a.name} added as token ${v.token}`, 'ok'); bookings.reload() } catch (e: any) { toast(e.message, 'err') } }
  const link = `${location.origin}/book/${me.clinic.slug}`
  return <div className="stack">
    <div className="page-h"><div className="grow"><h1>Intake</h1><p>Before the visit: bookings from the website and WhatsApp with the patient’s problem. At the visit: photograph old prescriptions and lab slips.</p></div></div>
    <div className="grid2" style={{ alignItems: 'start' }}>
      <section className="card stack">
        <div className="row"><h3 className="grow">Online and WhatsApp bookings</h3><span className="tag ink">{online.length} upcoming</span></div>
        <p className="small muted">Patients book at <a href={link} target="_blank" rel="noreferrer">{link.replace(/^https?:\/\//, '')}</a>. Share this link on the clinic’s WhatsApp status and Google profile.
          <button className="btn sm ghost" onClick={() => { navigator.clipboard?.writeText(link); toast('Booking link copied', 'ok') }}><Icon n="copy" />Copy</button></p>
        {online.length === 0 ? <div className="empty small"><b>No online bookings yet</b>They appear here as soon as a patient books.</div> :
          <div className="list">{online.map(a => <div key={a.id} className="appt">
            <span className="av">{a.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()}</span>
            <span style={{ minWidth: 0 }}><b>{a.name}</b>{a.age_years != null ? <span className="small muted"> {a.age_years}{a.sex || ''}</span> : null}<br />
              <small className="muted">{fmtDate(d10(a.appt_date))}{a.time ? ', ' + a.time : ''} · {a.phone}{a.reason ? ` · ${a.reason}` : ''} · booked {timeAgo(a.created_at)}</small></span>
            <span className="row">{d10(a.appt_date) === istToday() && <button className="btn sm primary" onClick={() => arrive(a)}>Arrived</button>}
              <a className="btn sm" href={`https://wa.me/91${a.phone}?text=${encodeURIComponent(`नमस्ते ${a.name} जी, ${me.clinic.settings.letterhead.clinic_name_hi} में ${fmtDate(d10(a.appt_date))}${a.time ? ', ' + a.time : ''} का आपका समय पक्का है। पुरानी पर्ची और रिपोर्ट साथ लाएँ।`)}`} target="_blank" rel="noreferrer" title="Confirm on WhatsApp"><Icon n="wa" /></a></span>
          </div>)}</div>}
        {!me.features.whatsapp_api && <p className="small faint">With the WhatsApp API turned on, patients get an automatic confirmation and a reminder the day before.</p>}
      </section>
      <section className="card stack">
        <h3>Photo intake</h3>
        <p className="small muted">Choose the patient, then photograph the old prescription or lab report. Medicines and lab values are read for you to check, and saved to the patient’s history and trends.</p>
        <button className="btn primary" style={{ alignSelf: 'flex-start' }} disabled={!me.features.ai} onClick={() => setPick(true)}><Icon n="cam" />Scan a document</button>
        {!me.features.ai && <div className="alert info small">Turns on when the OpenAI key is added in Vercel.</div>}
        {recent.length > 0 && <div className="list">{recent.map((r, i) => <Link key={i} className="li" to={`/patients/${r.p.id}`}><Icon n="file" /><span className="grow"><b>{r.p.name}</b><br /><span className="small muted">{r.text}</span></span></Link>)}</div>}
      </section>
    </div>
    {pick && <Modal title="Whose document is this?" width={640} onClose={() => setPick(false)}><PatientPicker onPick={p => { setPick(false); setScanFor(p) }} onNew={() => {}} /></Modal>}
    {scanFor && <ScanDialog patientId={scanFor.id} onClose={() => setScanFor(null)} onSaved={async r => {
      if (r.allergies.length || r.conditions.length) await api(`/patients/${scanFor.id}`, { method: 'PUT', body: { allergies: [...new Set([...scanFor.allergies, ...r.allergies])], conditions: [...new Set([...scanFor.conditions, ...r.conditions])] } })
      setRecent(x => [{ p: scanFor, text: `${r.labs} values saved${r.summary ? ' · ' + r.summary.slice(0, 120) : ''}` }, ...x]); setScanFor(null); toast('Saved to history', 'ok')
    }} />}
  </div>
}
