import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { compressImage, startDictation, recordAudio } from '../lib/media'
import { istToday } from '../lib/format'
import { Modal, useToast, useElapsed } from './ui'
import Icon from './Icon'
import { sigEn, type Med } from '../../shared/rx'

export type VoiceDraft = {
  complaints: string; diagnosis: string; exam_notes: string; vitals: Record<string, string>
  meds: { spoken: string; candidates: { name: string; kind: string; price?: number; favourite?: boolean }[]; med: Med }[]
  investigations: string[]; advice: string[]; follow_up_days: number | null
}

/** Dictate → transcript → AI draft → doctor ticks what to keep. */
export function VoiceDialog({ patientId, onClose, onApply }: { patientId: string; onClose: () => void; onApply: (d: VoiceDraft & { keep: Record<string, boolean>; medChoice: Med[] }) => void }) {
  const toast = useToast()
  const [lang, setLang] = useState<'hi-IN' | 'en-IN'>('hi-IN')
  const [text, setText] = useState(''), [interim, setInterim] = useState(''), [rec, setRec] = useState<'idle' | 'live' | 'audio'>('idle')
  const [busy, setBusy] = useState(false), [draft, setDraft] = useState<VoiceDraft | null>(null), secs = useElapsed(busy)
  const [keep, setKeep] = useState<Record<string, boolean>>({}), [medSel, setMedSel] = useState<(Med | null)[]>([])
  const stopRef = useRef<{ stop: () => any } | null>(null), base = useRef('')
  useEffect(() => () => { stopRef.current?.stop() }, [])
  const start = async () => {
    base.current = text ? text + ' ' : ''
    const r = startDictation(lang, (f, i) => { setText(base.current + f); setInterim(i) }, err => { setRec('idle'); setInterim(''); if (err) toast(err, 'err') })
    if (r) { stopRef.current = r; setRec('live'); return }
    try { const a = await recordAudio(); stopRef.current = { stop: async () => { const { base64, mime } = await a.stop(); setBusy(true); try { const t = await api<{ text: string }>('/ai/transcribe', { body: { audio_base64: base64, mime } }); setText(x => (x ? x + ' ' : '') + t.text) } catch (e: any) { toast(e.message, 'err') } finally { setBusy(false) } } }; setRec('audio') }
    catch { toast('Microphone is not available on this device.', 'err') }
  }
  const stop = () => { stopRef.current?.stop(); stopRef.current = null; setRec('idle'); setInterim('') }
  const make = async () => {
    stop(); setBusy(true)
    try {
      const d = await api<VoiceDraft>('/ai/voice-rx', { body: { transcript: text, patient_id: patientId } })
      setDraft(d); setMedSel(d.meds.map(m => m.med))
      setKeep({ complaints: !!d.complaints, diagnosis: !!d.diagnosis, vitals: Object.values(d.vitals).some(Boolean), investigations: d.investigations.length > 0, advice: d.advice.length > 0, follow_up: !!d.follow_up_days })
    } catch (e: any) { toast(e.message, 'err') } finally { setBusy(false) }
  }
  if (!draft) return <Modal title="Speak the consult" width={640} onClose={() => { stop(); onClose() }} footer={<>
    <span className="grow small muted">Medicines are matched to the list. You review everything before it goes on the parchi.</span>
    <button className="btn primary" disabled={busy || text.trim().length < 5} onClick={make}>{busy ? `Making draft… ${secs} s (usually under 30)` : 'Make draft'}</button>
  </>}>
    <div className="stack">
      <div className="row wrap">
        <div className="seg"><button aria-pressed={lang === 'hi-IN'} onClick={() => setLang('hi-IN')} disabled={rec !== 'idle'}>Hinglish / Hindi</button><button aria-pressed={lang === 'en-IN'} onClick={() => setLang('en-IN')} disabled={rec !== 'idle'}>English</button></div>
        <span className="grow" />
        {rec === 'idle' ? <button className="btn primary lg" onClick={start}><Icon n="mic" />Start speaking</button>
          : <button className="btn danger lg" onClick={stop}><span className="mic-live"><i /><i /><i /><i /></span>Stop</button>}
      </div>
      <textarea className="inp" rows={7} value={text + (interim ? (text ? ' ' : '') + interim : '')} onChange={e => setText(e.target.value)} placeholder="For example: Teen din se bukhar aur gale mein dard. BP 120 by 80, temperature 101. Viral fever. Dolo 650 teen baar khane ke baad teen din, Levocetirizine raat ko paanch din. CBC. Teen din baad dikhayein." />
      {rec === 'audio' && <div className="alert info small">Recording. This browser has no live speech, so the audio is turned into text when you press Stop.</div>}
    </div>
  </Modal>

  const K = ({ k, label, children }: { k: string; label: string; children: React.ReactNode }) => <label className="row" style={{ alignItems: 'flex-start', gap: 10 }}>
    <input type="checkbox" checked={!!keep[k]} onChange={e => setKeep({ ...keep, [k]: e.target.checked })} style={{ marginTop: 4, width: 17, height: 17 }} />
    <span className="grow"><b className="small muted" style={{ display: 'block' }}>{label}</b>{children}</span></label>
  return <Modal title="Check the draft" width={720} onClose={onClose} footer={<>
    <button className="btn" onClick={() => setDraft(null)}>Back to text</button>
    <button className="btn primary" onClick={() => onApply({ ...draft, keep, medChoice: medSel.filter(Boolean) as Med[] })}>Add to prescription</button>
  </>}>
    <div className="stack">
      {draft.complaints && <K k="complaints" label="Complaints">{draft.complaints}</K>}
      {Object.values(draft.vitals).some(Boolean) && <K k="vitals" label="Vitals">{Object.entries(draft.vitals).filter(([, v]) => v).map(([k, v]) => `${k.toUpperCase()} ${v}`).join(', ')}</K>}
      {draft.diagnosis && <K k="diagnosis" label="Diagnosis">{draft.diagnosis}</K>}
      {draft.meds.length > 0 && <div className="card stack tight">
        <b className="small muted">Medicines (untick to leave one out; pick the right match)</b>
        {draft.meds.map((m, i) => <div key={i} className="row wrap" style={{ alignItems: 'flex-start' }}>
          <input type="checkbox" checked={!!medSel[i]} onChange={e => setMedSel(medSel.map((x, j) => j === i ? (e.target.checked ? m.med : null) : x))} style={{ marginTop: 10, width: 17, height: 17 }} aria-label={`Keep ${m.spoken}`} />
          <div className="grow stack tight">
            <span className="small muted">Heard: “{m.spoken}”</span>
            <select className="inp sm" value={medSel[i]?.name || m.med.name} onChange={e => setMedSel(medSel.map((x, j) => j === i ? { ...m.med, name: e.target.value, kind: (m.candidates.find(c => c.name === e.target.value)?.kind as any) || 'custom' } : x))}>
              {[...m.candidates.map(c => c.name), ...(m.candidates.some(c => c.name === m.med.name) ? [] : [m.med.name])].map(n => <option key={n} value={n}>{n}{m.candidates.find(c => c.name === n)?.favourite ? ' (your usual)' : ''}</option>)}
              {!m.candidates.length && <option value={m.spoken}>{m.spoken} (as spoken)</option>}
            </select>
            <span className="small">{sigEn(medSel[i] || m.med)}</span>
          </div>
        </div>)}
      </div>}
      {draft.investigations.length > 0 && <K k="investigations" label="Investigations">{draft.investigations.join(', ')}</K>}
      {draft.advice.length > 0 && <K k="advice" label="Advice">{draft.advice.join('; ')}</K>}
      {draft.follow_up_days ? <K k="follow_up" label="Follow-up">{draft.follow_up_days} days</K> : null}
      {draft.exam_notes && <div className="small muted">Exam notes heard: {draft.exam_notes}</div>}
    </div>
  </Modal>
}

type Scan = { document_id: string; doc_type: string; legible: boolean; doc_date: string | null; source_name: string; diagnoses: string[]; allergies: string[]; medicines: { name: string; dose: string; freq: string; duration: string }[]; labs: { test: string; value: string; unit: string; ref_range: string; flag: string }[]; notes: string }

/** Photo of an old prescription or lab report → structured history the doctor confirms. */
export function ScanDialog({ patientId, onClose, onSaved }: { patientId: string; onClose: () => void; onSaved: (s: { labs: number; allergies: string[]; conditions: string[]; summary: string }) => void }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false), [scan, setScan] = useState<Scan | null>(null), [preview, setPreview] = useState(''), secs = useElapsed(busy)
  const [labSel, setLabSel] = useState<boolean[]>([]), [date, setDate] = useState(istToday()), [addAllergy, setAddAllergy] = useState(true), [addDx, setAddDx] = useState(true)
  const file = useRef<HTMLInputElement>(null)
  const go = async (f: File) => {
    setBusy(true)
    try {
      const img = await compressImage(f); setPreview(img)
      const s = await api<Scan>('/ai/scan', { body: { patient_id: patientId, image: img } })
      setScan(s); setLabSel(s.labs.map(() => true)); if (s.doc_date) setDate(s.doc_date)
    } catch (e: any) { toast(e.message, 'err') } finally { setBusy(false) }
  }
  const save = async () => {
    if (!scan) return
    setBusy(true)
    try {
      const items = scan.labs.filter((_, i) => labSel[i]).map(l => ({ test: l.test, value: l.value, unit: l.unit || undefined, flag: (l.flag || null) as any, date }))
      if (items.length) await api(`/patients/${patientId}/labs`, { body: { items, document_id: scan.document_id, source: 'scan' } })
      const summary = [scan.source_name, scan.diagnoses.join(', '), scan.medicines.map(m => `${m.name} ${m.freq}`.trim()).join('; ')].filter(Boolean).join(' — ')
      onSaved({ labs: items.length, allergies: addAllergy ? scan.allergies : [], conditions: addDx ? scan.diagnoses : [], summary })
    } catch (e: any) { toast(e.message, 'err') } finally { setBusy(false) }
  }
  return <Modal title="Read an old prescription or report" width={760} onClose={onClose} footer={scan ? <><button className="btn" onClick={() => { setScan(null); setPreview('') }}>Another photo</button><button className="btn primary" disabled={busy} onClick={save}>Save to patient history</button></> : undefined}>
    <input ref={file} type="file" accept="image/*" capture="environment" hidden onChange={e => e.target.files?.[0] && go(e.target.files[0])} />
    {!scan && <div className="stack" style={{ alignItems: 'center', padding: '20px 0' }}>
      {preview && <img src={preview} alt="" style={{ maxHeight: 240, borderRadius: 8 }} />}
      <button className="btn primary lg" disabled={busy} onClick={() => file.current?.click()}><Icon n="cam" />{busy ? `Reading the document… ${secs} s (usually under 30)` : 'Take or choose a photo'}</button>
      <p className="small muted" style={{ textAlign: 'center', maxWidth: 420 }}>Lay the page flat in good light. Handwriting is read where legible; nothing is saved until you confirm.</p>
    </div>}
    {scan && <div className="grid2" style={{ alignItems: 'start' }}>
      <img src={preview} alt="Document" style={{ width: '100%', borderRadius: 8, border: '1px solid var(--line)' }} />
      <div className="stack">
        {!scan.legible && <div className="alert warn small">Much of this page was hard to read. Check every value.</div>}
        <div className="small"><b>{scan.doc_type === 'lab_report' ? 'Lab report' : scan.doc_type === 'old_rx' ? 'Old prescription' : 'Document'}</b>{scan.source_name ? `, ${scan.source_name}` : ''}</div>
        <label className="field"><span>Date of this document</span><input type="date" className="inp sm" value={date} max={istToday()} onChange={e => setDate(e.target.value)} /></label>
        {scan.labs.length > 0 && <div className="card flush"><table className="t"><thead><tr><th></th><th>Test</th><th className="num">Value</th><th>Range</th></tr></thead><tbody>
          {scan.labs.map((l, i) => <tr key={i}><td><input type="checkbox" checked={labSel[i]} onChange={e => setLabSel(labSel.map((x, j) => j === i ? e.target.checked : x))} aria-label={`Keep ${l.test}`} /></td>
            <td>{l.test}</td><td className="num"><b style={{ color: l.flag === 'high' || l.flag === 'low' ? 'var(--sindoor)' : undefined }}>{l.value}</b> {l.unit}</td><td className="small muted">{l.ref_range}</td></tr>)}
        </tbody></table></div>}
        {scan.medicines.length > 0 && <div className="small"><b className="muted">Medicines on the page</b>{scan.medicines.map((m, i) => <div key={i}>{m.name} {m.dose} {m.freq} {m.duration}</div>)}</div>}
        {scan.diagnoses.length > 0 && <label className="check small"><input type="checkbox" checked={addDx} onChange={e => setAddDx(e.target.checked)} />Add to conditions: {scan.diagnoses.join(', ')}</label>}
        {scan.allergies.length > 0 && <label className="check small"><input type="checkbox" checked={addAllergy} onChange={e => setAddAllergy(e.target.checked)} />Add allergies: {scan.allergies.join(', ')}</label>}
        {scan.notes && <p className="small muted">{scan.notes}</p>}
      </div>
    </div>}
  </Modal>
}

export type IntakeFields = { name: string; sex: 'M' | 'F' | 'O' | null; age_years: number | null; phone: string; address: string; allergies: string[] }

/** New patient: say the details out loud, or photograph a registration slip / old parchi header. Nothing is saved; it only fills the form. */
export function IntakeDialog({ mode, onClose, onFilled }: { mode: 'voice' | 'photo'; onClose: () => void; onFilled: (f: IntakeFields) => void }) {
  const toast = useToast()
  const [lang, setLang] = useState<'hi-IN' | 'en-IN'>('hi-IN')
  const [text, setText] = useState(''), [interim, setInterim] = useState(''), [rec, setRec] = useState<'idle' | 'live' | 'audio'>('idle')
  const [busy, setBusy] = useState(false), secs = useElapsed(busy), [preview, setPreview] = useState('')
  const stopRef = useRef<{ stop: () => any } | null>(null), base = useRef(''), file = useRef<HTMLInputElement>(null)
  useEffect(() => () => { stopRef.current?.stop() }, [])
  const send = async (body: { transcript?: string; image?: string }) => {
    setBusy(true)
    try {
      const f = await api<IntakeFields>('/ai/patient-intake', { body })
      if (!f.name && !f.phone && f.age_years == null) { toast(mode === 'voice' ? 'Could not pick out any patient details. Try again, or type them.' : 'Could not read any patient details from this photo. Try a clearer photo, or type them.', 'err'); return }
      onFilled(f)
    } catch (e: any) { toast(e.message, 'err') } finally { setBusy(false) }
  }
  const start = async () => {
    base.current = text ? text + ' ' : ''
    const r = startDictation(lang, (f, i) => { setText(base.current + f); setInterim(i) }, err => { setRec('idle'); setInterim(''); if (err) toast(err, 'err') })
    if (r) { stopRef.current = r; setRec('live'); return }
    try { const a = await recordAudio(); stopRef.current = { stop: async () => { const { base64, mime } = await a.stop(); setBusy(true); try { const t = await api<{ text: string }>('/ai/transcribe', { body: { audio_base64: base64, mime } }); setText(x => (x ? x + ' ' : '') + t.text) } catch (e: any) { toast(e.message, 'err') } finally { setBusy(false) } } }; setRec('audio') }
    catch { toast('Microphone is not available on this device.', 'err') }
  }
  const stop = () => { stopRef.current?.stop(); stopRef.current = null; setRec('idle'); setInterim('') }
  const go = async (f: File) => { try { const img = await compressImage(f); setPreview(img); await send({ image: img }) } catch (e: any) { toast(e.message, 'err') } }
  if (mode === 'photo') return <Modal title="Fill from a photo" width={520} onClose={onClose}>
    <input ref={file} type="file" accept="image/*" capture="environment" hidden onChange={e => e.target.files?.[0] && go(e.target.files[0])} />
    <div className="stack" style={{ alignItems: 'center', padding: '12px 0' }}>
      {preview && <img src={preview} alt="" style={{ maxHeight: 220, borderRadius: 8 }} />}
      <button className="btn primary lg" disabled={busy} onClick={() => file.current?.click()}><Icon n="cam" />{busy ? `Reading… ${secs} s (usually under 20)` : 'Take or choose a photo'}</button>
      <p className="small muted" style={{ textAlign: 'center', maxWidth: 380 }}>A registration slip, the top of an old parchi, or an ID card. You check every field before saving; nothing is saved from here.</p>
    </div>
  </Modal>
  return <Modal title="Fill by speaking" width={560} onClose={() => { stop(); onClose() }} footer={<>
    <span className="grow small muted">You check every field before saving.</span>
    <button className="btn primary" disabled={busy || text.trim().length < 3} onClick={() => { stop(); send({ transcript: text }) }}>{busy ? `Filling… ${secs} s` : 'Fill the form'}</button>
  </>}>
    <div className="stack">
      <div className="row wrap">
        <div className="seg"><button aria-pressed={lang === 'hi-IN'} onClick={() => setLang('hi-IN')} disabled={rec !== 'idle'}>Hinglish / Hindi</button><button aria-pressed={lang === 'en-IN'} onClick={() => setLang('en-IN')} disabled={rec !== 'idle'}>English</button></div>
        <span className="grow" />
        {rec === 'idle' ? <button className="btn primary lg" onClick={start}><Icon n="mic" />Start speaking</button>
          : <button className="btn danger lg" onClick={stop}><span className="mic-live"><i /><i /><i /><i /></span>Stop</button>}
      </div>
      <textarea className="inp" rows={4} value={text + (interim ? (text ? ' ' : '') + interim : '')} onChange={e => setText(e.target.value)} placeholder="For example: Ramesh Kumar, 45 saal, male, mobile 98765 43210, gaon Bochaha, Muzaffarpur. Sulfa se allergy hai." />
      {rec === 'audio' && <div className="alert info small">Recording. This browser has no live speech, so the audio is turned into text when you press Stop.</div>}
    </div>
  </Modal>
}
