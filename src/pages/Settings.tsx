import { useEffect, useState } from 'react'
import { NavLink, Route, Routes, Navigate } from 'react-router-dom'
import { api, fileUrl, timings } from '../lib/api'
import { useMe, useSession } from '../lib/session'
import { compressImage } from '../lib/media'
import { fmtDate, timeAgo, istToday, d10 } from '../lib/format'
import { Modal, Spinner, useAsync, useToast, useDialog, Field, TagInput } from '../components/ui'
import Icon from '../components/Icon'
import { liveSpeech } from '../lib/media'
import Recordings from '../components/Recordings'
import { RemovePatientDialog } from './PatientPage'
import { ParchiPreview } from '../components/Parchi'
import MedSearch from '../components/MedSearch'
import { mergeSettings, PARCHI_FONTS, type ClinicSettings } from '../../shared/settings'
import { sigEn, FREQS, type Med } from '../../shared/rx'

const SAMPLE = { patient: { name: 'Ramesh Prasad', age_years: 52, sex: 'M', address: 'Ahiyapur, Muzaffarpur', uhid: 'AC-00012', allergies: [] as string[] },
  data: { complaints: 'Sugar follow-up. Tingling in both feet for 2 months.', diagnosis: 'Type 2 DM with early peripheral neuropathy', vitals: { bp: '138/86', pulse: '82', spo2: '98', grbs: '186', weight: '74' }, exam: { pallor: 'Absent', icterus: 'Absent', cyanosis: 'Absent', clubbing: 'Absent', edema: 'Absent' }, systemic: { rs: 'B/L NVBS', cvs: 'S1 S2 heard', cns: 'NAD', pa: 'Soft' }, comorbid: { diabetes: true, hypertension: true }, addiction: {}, investigations: ['HbA1c', 'Lipid profile'], advice: ['Walk 30 minutes daily', 'Avoid sugar and sweets'], follow_up: { days: 30 } },
  meds: [{ name: 'Metformin SR 500 mg Tablet', form: 'TAB', dose: '1', freq: '1-0-1', timing: 'after', days: 30, kind: 'brand' }, { name: 'Glimepiride 1 mg Tablet', form: 'TAB', dose: '1', freq: '1-0-0', timing: 'before', days: 30, kind: 'brand' }] as Med[] }

export default function Settings() {
  const me = useMe(), isDoc = me.user.role !== 'reception'
  const tabs = isDoc ? [['letterhead', 'Letterhead studio'], ['clinic', 'Hours and fees'], ['staff', 'Staff'], ['templates', 'Templates'], ['messages', 'WhatsApp and AI'], ['import', 'Import old data'], ['security', 'Security']] : [['security', 'My password']]
  return <div className="stack">
    <div className="page-h"><h1>Settings</h1></div>
    <div className="row wrap">{tabs.map(([k, l]) => <NavLink key={k} to={`/settings/${k}`} className={({ isActive }) => 'chip' + (isActive ? ' on' : '')}>{l}</NavLink>)}</div>
    <Routes>
      <Route index element={<Navigate to={isDoc ? 'letterhead' : 'security'} replace />} />
      {isDoc && <><Route path="letterhead" element={<Letterhead />} /><Route path="clinic" element={<ClinicTab />} /><Route path="staff" element={<Staff />} /><Route path="templates" element={<Templates />} /><Route path="messages" element={<Messages />} /><Route path="import" element={<Import />} /></>}
      <Route path="security" element={<Security />} />
    </Routes>
  </div>
}

function useSettingsForm() {
  const me = useMe(), { setSettings } = useSession(), toast = useToast()
  const [s, setS] = useState<ClinicSettings>(me.clinic.settings), [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false)
  const up = (fn: (s: ClinicSettings) => ClinicSettings) => { setS(fn); setDirty(true) }
  const save = async () => { setBusy(true); try { const r = await api<any>('/clinic/settings', { method: 'PUT', body: { settings: s } }); setSettings(mergeSettings(r.settings)); setDirty(false); toast('Settings saved', 'ok') } catch (e: any) { toast(e.message, 'err') } finally { setBusy(false) } }
  return { s, up, dirty, save, busy, setS }
}
const SaveBar = ({ dirty, save, busy }: { dirty: boolean; save: () => void; busy: boolean }) => dirty ? <div className="savebar"><span className="small muted grow">You have unsaved changes</span><button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save changes'}</button></div> : null

const INKS: [string, string][] = [['#16295f', 'Navy blue'], ['#1d3a8a', 'Ink blue'], ['#1626b8', 'Royal blue'], ['#7a1f2b', 'Maroon'], ['#1f5e46', 'Green'], ['#23262e', 'Black']]
function Letterhead() {
  const { s, up, dirty, save, busy, setS } = useSettingsForm(), toast = useToast(), { setSettings } = useSession()
  const L = s.letterhead
  const set = (k: keyof ClinicSettings['letterhead'], v: any) => up(x => ({ ...x, letterhead: { ...x.letterhead, [k]: v } }))
  const upload = async (kind: 'logo' | 'signature', f?: File) => { if (!f) return; try { const data_url = await compressImage(f, 900); const r = await api<{ file_id: string }>(`/clinic/upload/${kind}`, { body: { data_url } }); const n = { ...s, letterhead: { ...s.letterhead, [kind === 'logo' ? 'logo_file_id' : 'signature_file_id']: r.file_id } }; setS(n); setSettings(n); toast('Uploaded', 'ok') } catch (e: any) { toast(e.message, 'err') } }
  const T = (k: keyof ClinicSettings['letterhead'], label: string, full?: boolean) => <div className={'field' + (full ? ' full' : '')}><label htmlFor={'lh-' + k}>{label}</label><input id={'lh-' + k} className="inp" value={String(L[k] ?? '')} onChange={e => set(k, e.target.value)} /></div>
  return <div className="stack">
    <p className="muted">Type your details. Every parchi, the PDF on WhatsApp and the receipts update at once.</p>
    <div className="studio">
      <div className="stack">
        <form className="card studio-form" autoComplete="off" onSubmit={e => e.preventDefault()}>
          {T('doctor_en', "Doctor's name")}{T('doctor_hi', 'नाम (हिंदी)')}
          {T('quals_en', 'Degrees', true)}
          {T('clinic_name_en', 'Clinic name')}{T('clinic_name_hi', 'क्लिनिक का नाम (हिंदी)')}
          {T('designation', 'Designation')}{T('reg_no', 'Registration no.')}
          {T('phone', 'Clinic phone')}<div className="field"><label>Validity (days)</label><input className="inp" inputMode="numeric" value={L.validity_days} onChange={e => set('validity_days', parseInt(e.target.value) || 0)} /></div>
          {T('address_hi', 'Address (printed on the parchi)', true)}{T('address_en', 'Address in English (receipts, booking page)', true)}
          {T('timings', 'Timings', true)}
          {T('signature_name', 'Name in the signature')}
          <div className="field"><label>Hindi dose lines</label><label className="check"><input type="checkbox" checked={L.print_hindi_doses} onChange={e => set('print_hindi_doses', e.target.checked)} />Print under each medicine</label></div>
          <div className="field"><label>Ink colour</label><div className="swatches">{INKS.map(k => <button type="button" key={k[0]} className="sw" style={{ background: k[0] }} aria-label={k[1]} title={k[1]} aria-pressed={L.ink === k[0]} onClick={() => set('ink', k[0])} />)}<input type="color" aria-label="Custom colour" value={L.ink} onChange={e => set('ink', e.target.value)} style={{ width: 32, height: 32, padding: 0, border: 0, background: 'none' }} /></div></div>
          <div className="field"><label>Layout</label><div className="seg"><button type="button" aria-pressed={L.layout === 'center'} onClick={() => set('layout', 'center')}>Centred</button><button type="button" aria-pressed={L.layout === 'left'} onClick={() => set('layout', 'left')}>Logo left</button></div></div>
          <div className="field"><label>Paper</label><div className="seg"><button type="button" aria-pressed={L.paper === 'A5'} onClick={() => set('paper', 'A5')}>A5</button><button type="button" aria-pressed={L.paper === 'A4'} onClick={() => set('paper', 'A4')}>A4</button></div></div>
          <div className="field"><label>Logo (for “Logo left”)</label><div className="row wrap">
            <label className="btn sm"><Icon n="cam" />Upload logo<input type="file" accept="image/*" hidden onChange={e => upload('logo', e.target.files?.[0])} /></label>
            <label className="check small"><input type="checkbox" checked={L.use_letterhead_art} onChange={e => set('use_letterhead_art', e.target.checked)} />Use the Arogya Clinic logo</label>
            {L.logo_file_id && <><img src={fileUrl(L.logo_file_id)} alt="" style={{ height: 32 }} /><button type="button" className="btn sm ghost" onClick={() => set('logo_file_id', null)}>Remove</button></>}</div></div>
          <div className="field full"><label>Signature image (optional)</label><div className="row wrap">
            <label className="btn sm"><Icon n="edit" />Upload signature<input type="file" accept="image/*" hidden onChange={e => upload('signature', e.target.files?.[0])} /></label>
            {L.signature_file_id && <><img src={fileUrl(L.signature_file_id)} alt="" style={{ height: 32 }} /><button type="button" className="btn sm ghost" onClick={() => set('signature_file_id', null)}>Remove</button></>}
            <span className="small muted">A photo of the signature on white paper works; it replaces the typed name.</span></div></div>
          <div className="field"><label htmlFor="lh-sigh">Signature height (mm)</label><input id="lh-sigh" className="inp" inputMode="decimal" value={L.signature_height_mm} onChange={e => set('signature_height_mm', Math.min(30, Math.max(4, parseFloat(e.target.value) || 10)))} /></div>
          <div className="field"><label>Degrees under the signature</label><label className="check"><input type="checkbox" checked={L.show_signature_quals} onChange={e => set('show_signature_quals', e.target.checked)} />Print them</label></div>
          {T('signature_quals', 'Degrees line', true)}
          {T('dsc_note', 'Digital signature note (printed under the signature)', true)}
        </form>
        <ColourStudio L={L} set={set} />
        <FontStudio L={L} set={set} />
        <SaveBar dirty={dirty} save={save} busy={busy} />
      </div>
      <div className="paper-col"><div className="side-h"><b>Live parchi</b><span className="tag ink">sample patient</span></div><div className="paper-scroll"><ParchiPreview key={L.paper} s={s} patient={SAMPLE.patient} data={SAMPLE.data} meds={SAMPLE.meds} date={istToday()} token={3} /></div></div>
    </div>
  </div>
}

type LH = ClinicSettings['letterhead']
type SetLH = (k: keyof LH, v: any) => void

const COLOUR_AREAS: { key: keyof ClinicSettings['letterhead']['colors']; label: string; hint: string }[] = [
  { key: 'header', label: 'Letterhead', hint: 'Clinic name, logo ring and the line under the header' },
  { key: 'headings', label: 'Section headings', hint: 'C/O, O/E, Diagnosis, Investigations, Advice and the ℞ mark' },
  { key: 'hindi', label: 'Hindi lines', hint: 'The Hindi dose line under each medicine and Hindi advice' },
  { key: 'signature', label: 'Signature', hint: 'The signature name (an uploaded image keeps its own colour)' },
  { key: 'footer', label: 'Footer', hint: 'The small line at the bottom of the page' },
]

/** One colour per area of the parchi. Blank means "follow the ink colour", so the page looks
    exactly as it did before any of this was touched. */
function ColourStudio({ L, set }: { L: LH; set: SetLH }) {
  const C = L.colors
  const put = (k: keyof ClinicSettings['letterhead']['colors'], v: string) => set('colors', { ...C, [k]: v })
  const anySet = COLOUR_AREAS.some(a => C[a.key])
  return <details className="sec" open={anySet}>
    <summary><h3>Colours by section</h3><span className="small muted">{anySet ? `${COLOUR_AREAS.filter(a => C[a.key]).length} section${COLOUR_AREAS.filter(a => C[a.key]).length > 1 ? 's' : ''} with their own colour` : 'All following the ink colour'}</span></summary>
    <div className="sec-b stack">
      <p className="small muted" style={{ margin: 0 }}>The ink colour above moves every section at once. Set a colour here and that section stops following it; press “Follow ink” to put it back.</p>
      {COLOUR_AREAS.map(a => <div key={a.key} className="row wrap" style={{ gap: 10 }}>
        <span style={{ minWidth: 140 }}><b className="small">{a.label}</b><br /><span className="tiny muted">{a.hint}</span></span>
        <div className="swatches">{INKS.map(k => <button type="button" key={k[0]} className="sw" style={{ background: k[0] }} aria-label={`${a.label}: ${k[1]}`} title={k[1]} aria-pressed={C[a.key] === k[0]} onClick={() => put(a.key, k[0])} />)}</div>
        <input type="color" aria-label={`${a.label}: custom colour`} value={C[a.key] || L.ink} onChange={e => put(a.key, e.target.value)} style={{ width: 32, height: 32, padding: 0, border: 0, background: 'none' }} />
        {C[a.key] ? <button type="button" className="btn sm ghost" onClick={() => put(a.key, '')}>Follow ink</button> : <span className="tag">Following ink</span>}
      </div>)}
      {anySet && <button type="button" className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => set('colors', { header: '', headings: '', hindi: '', signature: '', footer: '' })}>Put every section back on the ink colour</button>}
    </div>
  </details>
}

const FONT_AREAS: { key: keyof ClinicSettings['letterhead']['fonts']; label: string; hint: string }[] = [
  { key: 'body', label: 'Whole page', hint: 'Everything that has no font of its own' },
  { key: 'clinic', label: 'Clinic name', hint: 'The big name at the top' },
  { key: 'doctor', label: 'Doctor line', hint: "The doctor's name under the clinic name" },
  { key: 'headings', label: 'Section headings', hint: 'C/O, O/E, Diagnosis and the rest' },
  { key: 'medicines', label: 'Medicine names', hint: 'The numbered list on the right' },
  { key: 'hindi', label: 'Hindi lines', hint: 'Hindi dose lines and Hindi advice' },
  { key: 'signature', label: 'Signature', hint: 'The typed signature name' },
]
const SCALES: [number, string][] = [[0.85, 'Smaller'], [0.92, 'Slightly smaller'], [1, 'Normal'], [1.1, 'Slightly bigger'], [1.25, 'Bigger'], [1.4, 'Largest']]

/** Font family and size for one area at a time. The first four families are built into the app,
    so they print the same on the clinic computer even with no internet. */
function FontStudio({ L, set }: { L: LH; set: SetLH }) {
  const F = L.fonts
  const put = (k: keyof ClinicSettings['letterhead']['fonts'], v: Partial<{ family: string; scale: number }>) => set('fonts', { ...F, [k]: { ...F[k], ...v } })
  return <details className="sec">
    <summary><h3>Fonts by section</h3><span className="small muted">Pick a different font or size for one part of the parchi</span></summary>
    <div className="sec-b stack">
      <p className="small muted" style={{ margin: 0 }}>The first five fonts come with the app and print the same even when the internet is down. The rest use whatever the computer has.</p>
      {FONT_AREAS.map(a => <div key={a.key} className="row wrap" style={{ gap: 10 }}>
        <span style={{ minWidth: 140 }}><b className="small">{a.label}</b><br /><span className="tiny muted">{a.hint}</span></span>
        <select className="inp sm" style={{ flex: '1 1 200px', minWidth: 0, fontFamily: F[a.key].family || undefined }} aria-label={`${a.label}: font`} value={F[a.key].family} onChange={e => put(a.key, { family: e.target.value })}>
          {PARCHI_FONTS.map(f => <option key={f.label} value={f.value} style={{ fontFamily: f.value || undefined }}>{f.label}</option>)}
        </select>
        <select className="inp sm" style={{ width: 150 }} aria-label={`${a.label}: size`} value={F[a.key].scale} onChange={e => put(a.key, { scale: parseFloat(e.target.value) })}>
          {SCALES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>)}
    </div>
  </details>
}

function ClinicTab() {
  const { s, up, dirty, save, busy } = useSettingsForm(), me = useMe()
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return <div className="stack" style={{ maxWidth: 820 }}>
    <section className="sec"><div className="sec-h"><h3>OPD hours</h3></div><div className="sec-b">
      {s.hours.sessions.map((x, i) => <div key={i} className="row wrap">
        <input className="inp sm" style={{ width: 130 }} value={x.label} onChange={e => up(v => ({ ...v, hours: { ...v.hours, sessions: v.hours.sessions.map((y, j) => j === i ? { ...y, label: e.target.value } : y) } }))} aria-label="Session name" />
        <input type="time" className="inp sm" style={{ width: 130 }} value={x.start} onChange={e => up(v => ({ ...v, hours: { ...v.hours, sessions: v.hours.sessions.map((y, j) => j === i ? { ...y, start: e.target.value } : y) } }))} aria-label="Start" />
        <span>to</span>
        <input type="time" className="inp sm" style={{ width: 130 }} value={x.end} onChange={e => up(v => ({ ...v, hours: { ...v.hours, sessions: v.hours.sessions.map((y, j) => j === i ? { ...y, end: e.target.value } : y) } }))} aria-label="End" />
        <button className="icon-btn" aria-label="Remove session" onClick={() => up(v => ({ ...v, hours: { ...v.hours, sessions: v.hours.sessions.filter((_, j) => j !== i) } }))}><Icon n="trash" /></button>
      </div>)}
      <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => up(v => ({ ...v, hours: { ...v.hours, sessions: [...v.hours.sessions, { label: 'Night', start: '20:30', end: '22:00' }] } }))}><Icon n="plus" />Add session</button>
      <div className="grid3">
        <Field label="Minutes per slot"><input className="inp" inputMode="numeric" value={s.hours.slot_minutes} onChange={e => up(v => ({ ...v, hours: { ...v.hours, slot_minutes: Math.max(5, parseInt(e.target.value) || 10) } }))} /></Field>
        <Field label="Patients per slot"><input className="inp" inputMode="numeric" value={s.hours.per_slot} onChange={e => up(v => ({ ...v, hours: { ...v.hours, per_slot: Math.max(1, parseInt(e.target.value) || 1) } }))} /></Field>
      </div>
      <div className="field"><span>Closed on</span><div className="chips">{days.map((d, i) => <button key={d} className={'chip' + (s.hours.closed_days.includes(i) ? ' on' : '')} onClick={() => up(v => ({ ...v, hours: { ...v.hours, closed_days: v.hours.closed_days.includes(i) ? v.hours.closed_days.filter(x => x !== i) : [...v.hours.closed_days, i] } }))}>{d}</button>)}</div></div>
    </div></section>
    <section className="sec"><div className="sec-h"><h3>Fees and UPI</h3></div><div className="sec-b">
      <div className="grid3">
        <Field label="New consultation (₹)"><input className="inp" inputMode="numeric" value={s.fees.new_visit} onChange={e => up(v => ({ ...v, fees: { ...v.fees, new_visit: parseInt(e.target.value) || 0 } }))} /></Field>
        <Field label="Follow-up (₹)"><input className="inp" inputMode="numeric" value={s.fees.follow_up} onChange={e => up(v => ({ ...v, fees: { ...v.fees, follow_up: parseInt(e.target.value) || 0 } }))} /></Field>
        <Field label="Follow-up fee valid for (days)"><input className="inp" inputMode="numeric" value={s.fees.follow_up_days} onChange={e => up(v => ({ ...v, fees: { ...v.fees, follow_up_days: parseInt(e.target.value) || 0 } }))} /></Field>
      </div>
      <div className="grid2">
        <Field label="Clinic UPI ID" hint="Printed as a QR on unpaid receipts"><input className="inp" placeholder="e.g. arogyaclinic@sbi" value={s.fees.upi_vpa} onChange={e => up(v => ({ ...v, fees: { ...v.fees, upi_vpa: e.target.value.trim() } }))} /></Field>
        <Field label="Name shown in UPI apps"><input className="inp" value={s.fees.payee_name} onChange={e => up(v => ({ ...v, fees: { ...v.fees, payee_name: e.target.value } }))} /></Field>
      </div>
      <span className="lbl">Other charges</span>
      {s.fees.extras.map((x, i) => <div className="row" key={i}><input className="inp sm grow" value={x.label} onChange={e => up(v => ({ ...v, fees: { ...v.fees, extras: v.fees.extras.map((y, j) => j === i ? { ...y, label: e.target.value } : y) } }))} /><input className="inp sm" style={{ width: 100 }} inputMode="numeric" value={x.amount} onChange={e => up(v => ({ ...v, fees: { ...v.fees, extras: v.fees.extras.map((y, j) => j === i ? { ...y, amount: parseInt(e.target.value) || 0 } : y) } }))} /><button className="icon-btn" aria-label="Remove" onClick={() => up(v => ({ ...v, fees: { ...v.fees, extras: v.fees.extras.filter((_, j) => j !== i) } }))}><Icon n="trash" /></button></div>)}
      <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => up(v => ({ ...v, fees: { ...v.fees, extras: [...v.fees.extras, { label: 'New charge', amount: 0 }] } }))}><Icon n="plus" />Add charge</button>
    </div></section>
    <section className="sec"><div className="sec-h"><h3>Online booking</h3></div><div className="sec-b">
      <label className="check"><input type="checkbox" checked={s.booking.enabled} onChange={e => up(v => ({ ...v, booking: { ...v.booking, enabled: e.target.checked } }))} />Patients can book online</label>
      <p className="small">Booking link: <a href={`/book/${me.clinic.slug}`} target="_blank" rel="noreferrer">{location.origin}/book/{me.clinic.slug}</a> <button className="btn sm ghost" onClick={() => navigator.clipboard?.writeText(`${location.origin}/book/${me.clinic.slug}`)}><Icon n="copy" />Copy</button></p>
      <div className="grid2"><Field label="Days ahead patients can book"><input className="inp" inputMode="numeric" value={s.booking.days_ahead} onChange={e => up(v => ({ ...v, booking: { ...v.booking, days_ahead: Math.min(60, parseInt(e.target.value) || 7) } }))} /></Field></div>
      <Field label="Note shown to patients"><input className="inp" value={s.booking.note} onChange={e => up(v => ({ ...v, booking: { ...v.booking, note: e.target.value } }))} /></Field>
    </div></section>
    <section className="sec"><div className="sec-h"><h3>WhatsApp</h3></div><div className="sec-b">
      <Field label="Clinic WhatsApp number" hint="Patients who book online can message this number, and booking alerts come here"><input className="inp" value={s.whatsapp.clinic_number} onChange={e => up(v => ({ ...v, whatsapp: { ...v.whatsapp, clinic_number: e.target.value.replace(/[^\d]/g, '') } }))} /></Field>
      <label className="check"><input type="checkbox" checked={s.whatsapp.confirm_appointments} onChange={e => up(v => ({ ...v, whatsapp: { ...v.whatsapp, confirm_appointments: e.target.checked } }))} />Confirm every appointment to the patient on WhatsApp</label>
      <p className="small muted" style={{ margin: '-4px 0 0 26px' }}>With auto-send on it goes by itself. Without it, WhatsApp opens with the Hindi message already written and staff press send.</p>
      <label className="check"><input type="checkbox" checked={s.whatsapp.alert_clinic_on_booking} onChange={e => up(v => ({ ...v, whatsapp: { ...v.whatsapp, alert_clinic_on_booking: e.target.checked } }))} />Tell the clinic number when someone books online</label>
      <label className="check"><input type="checkbox" checked={s.whatsapp.reminder_day_before} onChange={e => up(v => ({ ...v, whatsapp: { ...v.whatsapp, reminder_day_before: e.target.checked } }))} />Remind patients the day before their appointment or follow-up (needs WhatsApp auto-send)</label>
      <Field label="OP number prefix"><input className="inp" style={{ width: 120 }} value={s.uhid_prefix} onChange={e => up(v => ({ ...v, uhid_prefix: e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5) }))} /></Field>
    </div></section>
    <SaveBar dirty={dirty} save={save} busy={busy} />
  </div>
}

function Staff() {
  const toast = useToast(), me = useMe(), dlg = useDialog()
  const list = useAsync(() => api<any[]>('/clinic/staff'), [])
  const [add, setAdd] = useState(false), [f, setF] = useState({ name: '', phone: '', role: 'reception', password: '' })
  const create = async () => { try { await api('/clinic/staff', { body: f }); toast(`${f.name} can now log in`, 'ok'); setAdd(false); setF({ name: '', phone: '', role: 'reception', password: '' }); list.reload() } catch (e: any) { toast(e.message, 'err') } }
  const patch = async (u: any, body: object, msg: string) => { try { await api(`/clinic/staff/${u.id}`, { method: 'PATCH', body }); toast(msg, 'ok'); list.reload() } catch (e: any) { toast(e.message, 'err') } }
  return <div className="stack" style={{ maxWidth: 820 }}>
    <div className="row"><p className="muted grow">Each person logs in with their own mobile number. Reception can register patients, run the queue, book appointments and make bills. Only doctors write prescriptions.</p><button className="btn primary" onClick={() => setAdd(true)}><Icon n="plus" />Add staff</button></div>
    <div className="card flush"><div className="list">{(list.data || []).map(u => <div key={u.id} className="li">
      <span className="avatar">{u.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()}</span>
      <span className="grow"><b>{u.name}</b>{u.id === me.user.id && <span className="tag" style={{ marginLeft: 6 }}>You</span>}<br /><span className="small muted">{u.phone}, {u.role === 'doctor' ? 'Doctor' : u.role === 'reception' ? 'Reception' : 'Admin'}{u.last_login_at ? `, last login ${timeAgo(u.last_login_at)}` : ', never logged in'}</span></span>
      {!u.active && <span className="tag">Turned off</span>}
      {u.id !== me.user.id && <span className="row">
        <button className="btn sm" onClick={async () => { const p = await dlg.prompt(`New password for ${u.name}`, { text: 'At least 8 characters. They are logged out everywhere.', ok: 'Reset password' }); if (p && p.length >= 8) patch(u, { password: p }, 'Password reset. They are logged out everywhere.'); else if (p) toast('Use at least 8 characters.', 'err') }}>Reset password</button>
        <button className="btn sm ghost" onClick={() => patch(u, { active: !u.active }, u.active ? 'Login turned off' : 'Login turned on')}>{u.active ? 'Turn off' : 'Turn on'}</button>
      </span>}
    </div>)}</div></div>
    {add && <Modal title="Add staff" onClose={() => setAdd(false)} footer={<><button className="btn" onClick={() => setAdd(false)}>Cancel</button><button className="btn primary" onClick={create} disabled={f.name.length < 2 || f.password.length < 8}>Add</button></>}>
      <div className="stack">
        <div className="grid2"><Field label="Name"><input className="inp" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field><Field label="Mobile (login)"><input className="inp" inputMode="tel" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} /></Field></div>
        <div className="field"><span>Role</span><div className="seg">{['reception', 'doctor', 'admin'].map(r => <button key={r} aria-pressed={f.role === r} onClick={() => setF({ ...f, role: r })}>{r === 'reception' ? 'Reception' : r === 'doctor' ? 'Doctor' : 'Admin'}</button>)}</div></div>
        <Field label="First password" hint="At least 8 characters. Ask them to change it after logging in."><input className="inp" value={f.password} onChange={e => setF({ ...f, password: e.target.value })} /></Field>
      </div>
    </Modal>}
  </div>
}

function Templates() {
  const toast = useToast(), dlg = useDialog()
  const list = useAsync(() => api<any[]>('/templates'), [])
  const [ed, setEd] = useState<any | null>(null)
  const save = async () => { try { if (ed.id) await api(`/templates/${ed.id}`, { method: 'PUT', body: { name: ed.name, data: ed.data } }); else await api('/templates', { body: { name: ed.name, data: ed.data } }); toast('Template saved', 'ok'); setEd(null); list.reload() } catch (e: any) { toast(e.message, 'err') } }
  const restore = async () => { try { const r = await api<{ added: number }>('/templates/restore-defaults', { method: 'POST' }); toast(r.added ? `Added ${r.added} standard templates` : 'You already have all the standard templates', 'ok'); list.reload() } catch (e: any) { toast(e.message, 'err') } }
  const del = async (t: any) => { if (!(await dlg.ask(`Delete the "${t.name}" template?`, { ok: 'Delete', danger: true }))) return; await api(`/templates/${t.id}`, { method: 'DELETE' }); list.reload() }
  return <div className="stack" style={{ maxWidth: 820 }}>
    <div className="row wrap"><p className="muted grow">One tap on a template fills the diagnosis, medicines, tests, advice and follow-up. Change only what differs for the patient.</p><button className="btn" onClick={restore}>Add standard templates</button><button className="btn primary" onClick={() => setEd({ name: '', data: { diagnosis: '', meds: [], investigations: [], advice: [], follow_up_days: null } })}><Icon n="plus" />New template</button></div>
    <div className="card flush"><div className="list">{(list.data || []).map(t => <div key={t.id} className="li" style={{ alignItems: 'flex-start' }}>
      <span className="grow"><b>{t.name}</b><br /><span className="small muted">{t.data.meds.map((m: Med) => m.name).join(', ')}</span></span>
      <button className="btn sm" onClick={() => setEd(JSON.parse(JSON.stringify(t)))}>Edit</button><button className="icon-btn" aria-label="Delete" onClick={() => del(t)}><Icon n="trash" /></button>
    </div>)}</div></div>
    {ed && <Modal title={ed.id ? 'Edit template' : 'New template'} width={720} onClose={() => setEd(null)} footer={<><button className="btn" onClick={() => setEd(null)}>Cancel</button><button className="btn primary" disabled={ed.name.length < 2} onClick={save}>Save template</button></>}>
      <div className="stack">
        <div className="grid2"><Field label="Name"><input className="inp" value={ed.name} onChange={e => setEd({ ...ed, name: e.target.value })} /></Field><Field label="Diagnosis"><input className="inp" value={ed.data.diagnosis} onChange={e => setEd({ ...ed, data: { ...ed.data, diagnosis: e.target.value } })} /></Field></div>
        <span className="lbl">Medicines</span>
        <MedSearch onPick={m => setEd({ ...ed, data: { ...ed.data, meds: [...ed.data.meds, m] } })} />
        {ed.data.meds.map((m: Med, i: number) => { const setM = (p: Partial<Med>) => setEd({ ...ed, data: { ...ed.data, meds: ed.data.meds.map((x: Med, j: number) => j === i ? { ...x, ...p } : x) } }); return <div key={i} className="row wrap">
          <span className="grow small"><b>{m.name}</b><br /><span className="muted">{sigEn(m)}</span></span>
          <input className="inp sm" style={{ width: 70 }} value={m.dose || ''} onChange={e => setM({ dose: e.target.value })} aria-label="Dose" />
          <select className="inp sm" style={{ width: 100 }} value={m.freq} onChange={e => setM({ freq: e.target.value })}>{FREQS.map(f => <option key={f}>{f}</option>)}</select>
          <select className="inp sm" style={{ width: 120 }} value={m.timing || ''} onChange={e => setM({ timing: e.target.value as any })}><option value="">Any time</option><option value="after">After food</option><option value="before">Before food</option><option value="empty">Empty stomach</option></select>
          <input className="inp sm" style={{ width: 64 }} value={m.days ?? ''} onChange={e => setM({ days: parseInt(e.target.value) || null })} aria-label="Days" />
          <button className="icon-btn" aria-label="Remove" onClick={() => setEd({ ...ed, data: { ...ed.data, meds: ed.data.meds.filter((_: any, j: number) => j !== i) } })}><Icon n="trash" /></button>
        </div> })}
        <div className="field"><span>Investigations</span><TagInput value={ed.data.investigations} onChange={x => setEd({ ...ed, data: { ...ed.data, investigations: x } })} /></div>
        <div className="field"><span>Advice</span><TagInput value={ed.data.advice} onChange={x => setEd({ ...ed, data: { ...ed.data, advice: x } })} /></div>
        <Field label="Follow-up after (days)"><input className="inp" style={{ width: 120 }} inputMode="numeric" value={ed.data.follow_up_days ?? ''} onChange={e => setEd({ ...ed, data: { ...ed.data, follow_up_days: parseInt(e.target.value) || null } })} /></Field>
      </div>
    </Modal>}
  </div>
}

function Messages() {
  const me = useMe(), toast = useToast()
  const msgs = useAsync(() => api<any[]>('/messages'), [])
  const run = async () => { try { const r = await api<any>('/messages/reminders', { method: 'POST' }); toast(r.skipped || `Sent ${r.sent} reminders${r.failed ? `, ${r.failed} failed` : ''}`, r.failed ? 'err' : 'ok'); msgs.reload() } catch (e: any) { toast(e.message, 'err') } }
  return <div className="stack" style={{ maxWidth: 900 }}>
    <div className="grid2">
      <section className="card stack tight"><h3>WhatsApp</h3>
        {me.features.whatsapp_api ? <><span className="tag green">Auto-send is on (AiSensy)</span><p className="small muted">Prescriptions go out with the PDF attached. Reminders go out the evening before each follow-up.</p><button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={run}><Icon n="bell" />Send tomorrow's reminders now</button></>
          : <><span className="tag amber">Link mode</span><p className="small muted">The Send button opens WhatsApp with the Hindi message and the PDF link already written; staff press send. To send automatically, add AiSensy (see the setup guide) and set AISENSY_API_KEY in Vercel.</p></>}
      </section>
      <section className="card stack tight"><h3>AI (voice and photo)</h3>
        {me.features.ai ? <span className="tag green">On: {me.features.ai_providers || `OpenAI ${me.features.ai_model}`}</span> : <span className="tag amber">No AI key</span>}
        <p className="small muted">Voice: Chrome and Edge write your words live for free; other browsers record and the server turns the audio into text (Groq Whisper, free, or OpenAI). The words then become a draft with AI, or with basic rules if no AI answers. Photos of old prescriptions and reports need OpenAI. Every result is a draft for the doctor to check.</p>
        {!/Groq/.test(me.features.ai_providers || '') && <p className="small muted">Free option: make a Groq account at console.groq.com, create an API key, and add it in Vercel as GROQ_API_KEY.</p>}
        <AiCheck />
        <p className="small muted">Files are stored in {me.features.storage === 'supabase' ? 'Supabase Storage (Mumbai)' : 'the database'}.</p>
      </section>
    </div>
    {me.user.role === 'doctor' && <section className="card stack tight"><h2>Voice recordings</h2><p className="small muted">Every dictation is kept as a small audio file (about 120 KB a minute) in the clinic's private store. Only the doctor's login can list, play or delete them.</p><Recordings limit={40} /></section>}
    <section className="card flush"><div className="card-h" style={{ padding: '14px 16px 0' }}><h2>Recent messages</h2></div>
      {!msgs.data?.length ? <div className="empty small">No messages yet.</div> : <div className="tbl-wrap"><table className="t"><thead><tr><th>When</th><th>Patient</th><th>Type</th><th>How</th><th>Status</th></tr></thead><tbody>
        {msgs.data.map(m => <tr key={m.id}><td className="small">{timeAgo(m.created_at)}</td><td>{m.name || m.to_phone}</td><td>{({ rx: 'Prescription', reminder: 'Reminder', booking: 'Booking', receipt: 'Receipt' } as any)[m.kind] || m.kind}</td><td>{m.channel === 'api' ? 'Automatic' : 'WhatsApp link'}</td><td>{m.status === 'failed' ? <span className="tag red" title={m.error}>Failed</span> : m.status === 'link_opened' ? <span className="tag green">PDF opened</span> : <span className="tag">Sent</span>}</td></tr>)}
      </tbody></table></div>}
    </section>
  </div>
}

function Import() {
  const toast = useToast()
  const st = useAsync(() => api<any>('/import/old/status'), [])
  const [prog, setProg] = useState<{ done: number; imported: number; patients: number } | null>(null), [busy, setBusy] = useState(false)
  const run = async () => {
    setBusy(true); let offset = 0, imported = 0, patients = 0
    try {
      for (;;) { const r = await api<any>('/import/old', { body: { offset, limit: 150 } }); imported += r.imported; patients += r.patients_created; offset = r.next_offset; setProg({ done: offset, imported, patients }); if (r.done) break }
      toast(`Imported ${imported} prescriptions for ${patients} new patients`, 'ok'); st.reload()
    } catch (e: any) { toast(e.message, 'err') } finally { setBusy(false) }
  }
  return <div className="stack" style={{ maxWidth: 720 }}>
    <p className="muted">Copies every prescription from the old DoctorAppointmentForm app into Arogya Rx: patients, vitals, examination, comorbidity details, medicines, advice and follow-up. Running it again is safe; nothing is copied twice.</p>
    {st.loading ? <Spinner /> : st.error ? <div className="alert warn">{st.error}</div> : <div className="card stack">
      <div className="row"><span className="grow">Old app: <b>{st.data.old_prescriptions}</b> prescriptions, <b>{st.data.old_medications}</b> medicine lines</span><span>Already here: <b>{st.data.imported}</b></span></div>
      {prog && <div className="alert info">Checked {prog.done} of {st.data.old_prescriptions}. Imported {prog.imported}, new patients {prog.patients}.</div>}
      <button className="btn primary" disabled={busy} onClick={run}>{busy ? 'Importing…' : st.data.imported ? 'Import anything new' : 'Start import'}</button>
      <p className="small muted">After the import, check a few patients, then rotate the old database password on Render and remove OLD_DATABASE_URL from Vercel.</p>
    </div>}
  </div>
}

/** Sends a few small requests and reports how long the trip to the server takes from this device, so slowness can be measured, not guessed. */
type SysInfo = { fn_region: string | null; db_region: string | null; db_ms: number; counts: Record<string, number> }
function SpeedCheck() {
  const me = useMe()
  const [res, setRes] = useState<{ trip: number; server: number; db: number } | null>(null), [busy, setBusy] = useState(false), [sys, setSys] = useState<SysInfo | null>(null)
  const med = (a: number[]) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : 0 }
  const run = async () => {
    setBusy(true); setRes(null); setSys(null)
    try {
      const from = timings.length
      for (let i = 0; i < 5; i++) await api('/health?db=1')
      const t = timings.slice(from)
      setRes({ trip: med(t.map(x => x.ms)), server: med(t.map(x => x.server ?? 0)), db: Math.max(...t.map(x => x.ms)) })
      if (me.user.role !== 'reception') setSys(await api<SysInfo>('/clinic/system').catch(() => null))
    } catch { setRes(null) } finally { setBusy(false) }
  }
  const home = sys && (sys.db_region !== 'ap-south-1' || (sys.fn_region && sys.fn_region !== 'bom1'))
  const slow = timings.filter(t => t.ms > 1500).length
  return <section className="sec"><div className="sec-h"><h3>Speed check</h3></div><div className="sec-b">
    <p className="small muted" style={{ margin: 0 }}>Sends 5 small requests and shows how long each takes from this device. Run it from the clinic computer and send the numbers if pages feel slow.</p>
    <div className="row"><button className="btn" disabled={busy} onClick={run}>{busy ? 'Checking…' : 'Run speed check'}</button>
      {res && <span><b>{res.trip} ms</b> per request (server work {res.server} ms, slowest {res.db} ms). {res.trip < 400 ? 'Fast.' : res.trip < 900 ? 'Acceptable.' : 'Slow: the network or the server region is the cause.'}</span>}</div>
    {sys && <div className="card stack small" style={{ gap: 6 }}>
      <div>Server: <b>{sys.fn_region || 'unknown'}</b> · Database: <b>{sys.db_region || 'unknown'}</b> · one database query takes <b>{sys.db_ms} ms</b></div>
      {home ? <div className="alert warn">The server and database should both be in Mumbai (bom1 and ap-south-1). Check vercel.json and DATABASE_URL.</div> : <div className="muted">Server and database are both in Mumbai.</div>}
      <div className="muted">Records here: {sys.counts.patients} patients, {sys.counts.prescriptions} prescriptions ({sys.counts.final_prescriptions} final), {sys.counts.visits} visits, {sys.counts.bills} bills, {sys.counts.lab_results} lab results, {sys.counts.documents} documents, {sys.counts.files} files, {sys.counts.medicines} medicines. After a database move, these should match the old database.</div>
    </div>}
    {slow > 0 && <span className="small muted">{slow} request{slow > 1 ? 's' : ''} took over 1.5 seconds since this page was opened.</span>}
  </div></section>
}

function Security() {
  const toast = useToast(), me = useMe(), dlg = useDialog()
  const [f, setF] = useState({ current: '', next: '', again: '' })
  const audit = useAsync(() => me.user.role !== 'reception' ? api<any[]>('/clinic/audit') : Promise.resolve([]), [])
  const change = async () => { if (f.next !== f.again) return toast('The new passwords do not match.', 'err'); try { await api('/auth/password', { body: { current: f.current, next: f.next } }); toast('Password changed. Other devices are logged out.', 'ok'); setF({ current: '', next: '', again: '' }) } catch (e: any) { toast(e.message, 'err') } }
  const label: Record<string, string> = { login: 'Logged in', 'login.failed': 'Failed login', 'rx.finalize': 'Finalised prescription', 'rx.reopen': 'Reopened prescription', 'rx.prune_drafts': 'Cleared empty drafts', 'bill.create': 'Made bill', 'bill.void': 'Cancelled bill', 'patient.create': 'Added patient', 'patient.update': 'Edited patient', 'visit.create': 'Gave token', 'settings.update': 'Changed settings', 'staff.create': 'Added staff', 'staff.update': 'Changed staff', 'whatsapp.rx.api': 'Sent Rx (auto)', 'whatsapp.rx.link': 'Sent Rx (link)', 'ai.voice_rx': 'Voice draft', 'ai.scan': 'Scanned document', 'appointment.create': 'Booked appointment', 'appointment.arrive': 'Marked arrived', 'import.start': 'Started import', 'password.change': 'Changed password', 'logout.others': 'Logged out other devices', 'patient.archive': 'Removed patient', 'patient.restore': 'Put patient back' }
  return <div className="stack" style={{ maxWidth: 820 }}>
    <section className="sec"><div className="sec-h"><h3>Change my password</h3></div><div className="sec-b">
      <div className="grid3"><Field label="Current password"><input type="password" className="inp" autoComplete="current-password" value={f.current} onChange={e => setF({ ...f, current: e.target.value })} /></Field>
        <Field label="New password"><input type="password" className="inp" autoComplete="new-password" value={f.next} onChange={e => setF({ ...f, next: e.target.value })} /></Field>
        <Field label="New password again"><input type="password" className="inp" autoComplete="new-password" value={f.again} onChange={e => setF({ ...f, again: e.target.value })} /></Field></div>
      <button className="btn primary" style={{ alignSelf: 'flex-start' }} disabled={f.next.length < 8} onClick={change}>Change password</button>
    </div></section>
    <section className="sec"><div className="sec-h"><h3>Devices</h3></div><div className="sec-b">
      <p className="small muted" style={{ margin: 0 }}>You can stay signed in on the clinic computer, a laptop and your phone at the same time; each stays signed in for 7 days of use. If a device is lost or shared, sign it out from here.</p>
      <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={async () => { if ((await dlg.ask('Log out all other devices?', { text: 'Every other phone and computer signed in with your number will need to log in again. This device stays signed in.', ok: 'Log out others', danger: true })) !== 'ok') return; try { await api('/auth/logout-others', { method: 'POST' }); toast('Other devices are logged out.', 'ok') } catch (e: any) { toast(e.message, 'err') } }}>Log out other devices</button>
    </div></section>
    <SpeedCheck />
    {me.user.role !== 'reception' && <RemovedPatients />}
    {me.user.role !== 'reception' && <section className="card flush"><div className="card-h" style={{ padding: '14px 16px 0' }}><h2>Activity log</h2><span className="small muted">Every login, prescription, bill and setting change. It cannot be edited.</span></div>
      <div className="tbl-wrap" style={{ maxHeight: 460, overflow: 'auto' }}><table className="t"><thead><tr><th>When</th><th>Who</th><th>What</th></tr></thead><tbody>
        {(audit.data || []).map(a => <tr key={a.id}><td className="small nowrap">{fmtDate(d10(a.at))} {new Date(a.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</td><td>{a.user_name || a.meta?.phone || '—'}</td><td>{label[a.action] || a.action}</td></tr>)}
      </tbody></table></div></section>}
  </div>
}

/** Patients the doctor has removed from the clinic's screens. Nothing here was deleted: every visit,
    prescription, lab value and document is still in the database and comes back with the patient. */
function RemovedPatients() {
  const a = useAsync(() => api<any[]>('/patients/archived'), [])
  const [back, setBack] = useState<any | null>(null)
  const rows = a.data || []
  return <section className="card flush">
    <div className="card-h" style={{ padding: '14px 16px 0' }}><h2 className="grow">Removed patients</h2><span className="small muted">{rows.length ? `${rows.length} removed` : 'None removed'}</span></div>
    <div className="sec-b" style={{ paddingTop: 8 }}>
      <p className="small muted" style={{ margin: 0 }}>A removed patient is hidden from the patient list, search, the queue, Ask Arogya and the patient count. Their records are never deleted — put the patient back and everything is there again.</p>
    </div>
    {a.loading && !a.data ? <div className="empty small">Loading…</div> : rows.length === 0 ? <div className="empty small">No patient has been removed.</div> :
      <div className="tbl-wrap" style={{ maxHeight: 420, overflow: 'auto' }}><table className="t"><thead><tr><th>Patient</th><th>Kept</th><th>Removed</th><th /></tr></thead><tbody>
        {rows.map(x => <tr key={x.id}>
          <td><b>{x.name}</b><br /><span className="small muted">{x.uhid}{x.phone ? ` · ${x.phone}` : ''}</span></td>
          <td className="small">{x.visit_count} visit{x.visit_count === 1 ? '' : 's'}, {x.rx_count} prescription{x.rx_count === 1 ? '' : 's'}</td>
          <td className="small nowrap">{fmtDate(d10(x.archived_at))}{x.archived_by_name ? <><br /><span className="muted">by {x.archived_by_name}</span></> : null}{x.archive_reason ? <><br /><span className="muted">{x.archive_reason}</span></> : null}</td>
          <td><button className="btn sm" onClick={() => setBack(x)}>Put back</button></td>
        </tr>)}
      </tbody></table></div>}
    {back && <RemovePatientDialog p={back} restoring onClose={() => setBack(null)} onDone={() => { setBack(null); a.reload() }} />}
  </section>
}

/** Live check of each AI provider, this browser's speech and the last AI errors. */
function AiCheck() {
  const [res, setRes] = useState<{ providers: { provider: string; ok: boolean; ms: number; note: string }[]; recent: any[] } | null>(null), [busy, setBusy] = useState(false), toast = useToast()
  const run = async () => { setBusy(true); try { setRes(await api('/ai/check')) } catch (e: any) { toast(e.message, 'err') } finally { setBusy(false) } }
  const ls = liveSpeech()
  return <div className="stack tight">
    <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={run} disabled={busy}>{busy ? 'Checking…' : 'Check AI and voice'}</button>
    {res && <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
      <li>This browser: {ls.ok ? <span className="tag green">live speech</span> : <span className="tag amber">records audio</span>} {ls.why}</li>
      {res.providers.length === 0 && <li><span className="tag red">No AI key</span> Voice still makes a basic draft; add GROQ_API_KEY (free) for AI drafts.</li>}
      {res.providers.map(p => <li key={p.provider}>{p.provider}: {p.ok ? <span className="tag green">working, {p.ms} ms</span> : <span className="tag red">{p.note}</span>}</li>)}
    </ul>}
    {res && res.recent.some(r => !r.ok) && <details className="small"><summary>Recent AI errors</summary><ul style={{ margin: 0, paddingLeft: 18 }}>{res.recent.filter(r => !r.ok).slice(0, 6).map((r, i) => <li key={i}>{timeAgo(r.created_at)} · {r.kind} · {r.provider}: {r.error}</li>)}</ul></details>}
  </div>
}
