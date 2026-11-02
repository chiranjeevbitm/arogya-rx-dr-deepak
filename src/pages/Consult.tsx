import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../lib/api'
import { useMe } from '../lib/session'
import { ageSex, fmtDate, inr, d10 } from '../lib/format'
import { Modal, Spinner, TagInput, useToast, useDialog, Field } from '../components/ui'
import Icon from '../components/Icon'
import MedSearch, { medFromHit } from '../components/MedSearch'
import { ParchiPreview, type RxData } from '../components/Parchi'
import { VoiceDialog, ScanDialog } from '../components/AiDialogs'
import { PrintArea, printOnly, useRxOutput, WhatsAppPreview } from '../components/RxActions'
import { BillDialog } from '../components/BillDialog'
import { ReceiptDialog } from '../components/Receipt'
import { safetyChecks, sigHi, vitalFlag, normFreq, FREQS, ROUTES, COMORBIDITIES, ADDICTIONS, EXAM_SIGNS, SYSTEMIC, COMMON_INVESTIGATIONS, ADVICE_PRESETS, parchiValidity, PARCHI_VALID_DAYS, type Med, type Vitals } from '../../shared/rx'

type Bundle = { history?: Hist; rx: { ver?: string; id: string; status: string; rx_date: string; data: RxData; meds: Med[]; patient_id: string; visit_id: string | null; pdf_file_id: string | null }; patient: any; visit: any }
type Template = { id: string; name: string; data: { diagnosis: string; meds: Med[]; investigations: string[]; advice: string[]; follow_up_days?: number | null } }
type Hist = { prescriptions: { id: string; rx_date: string; diagnosis: string; complaints: string; meds: Med[]; status: string; vitals: Vitals }[]; labs: { test: string; value_num: number; result_date: string; unit: string }[]; bills: any[] }

function fmtT(sec: number) { sec = Math.max(0, Math.round(sec)); return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0') }

/** The consult: centre column of OPD & Rx, with the live parchi in `side`. */
export default function ConsultPane({ rxId, onChanged, onNext, renderSide }: { rxId: string; onChanged: () => void; onNext: () => void; renderSide: (el: React.ReactNode) => React.ReactNode }) {
  const me = useMe(), toast = useToast(), dlg = useDialog()
  const [b, setB] = useState<Bundle | null>(null), [err, setErr] = useState('')
  const [data, setData] = useState<RxData>({}), [meds, setMeds] = useState<Med[]>([])
  const [saved, setSaved] = useState<'saved' | 'dirty' | 'saving'>('saved')
  const [regular, setRegular] = useState<{ name: string; defaults: Partial<Med> }[]>([])
  const [templates, setTemplates] = useState<Template[]>([]), [hist, setHist] = useState<Hist | null>(null)
  const [voice, setVoice] = useState(false), [scan, setScan] = useState(false), [editPt, setEditPt] = useState(false), [override, setOverride] = useState<{ msg: string; then: () => void } | null>(null)
  const [wa, setWa] = useState(false), [bill, setBill] = useState(false), [receipt, setReceipt] = useState<string | null>(null), [busy, setBusy] = useState(false)
  const [now, setNow] = useState(Date.now())
  const first = useRef(true), page = useRef<HTMLDivElement>(null), ver = useRef<string | null>(null), conflictOpen = useRef(false), inflight = useRef<Promise<void>>(Promise.resolve())   // version last loaded or saved on this device
  const out = useRxOutput(rxId, page, !!b?.rx.pdf_file_id)

  const load = useCallback(async () => {
    try {
      const x = await api<Bundle>(`/rx/${rxId}?history=1`)   // prescription and patient history in one request
      setB(x); setData(x.rx.data || {}); setMeds(x.rx.meds || []); ver.current = x.rx.ver || null; first.current = true; setSaved('saved')
      if (x.history) setHist(x.history)
    } catch (e: any) { setErr(e.message) }
  }, [rxId])
  useEffect(() => { setB(null); setErr(''); load(); api<Template[]>('/templates').then(setTemplates).catch(() => {}); api<{ name: string; defaults: Partial<Med> }[]>('/medicines/regular').then(setRegular).catch(() => {}) }, [load])
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])

  const final = b?.rx.status === 'final'
  const finalizing = useRef(false)   // a save-and-finish is under way: the draft autosave must stay out of its way
  // autosave drafts
  useEffect(() => {
    if (!b || final) return
    if (first.current) { first.current = false; return }
    setSaved('dirty')
    const t = setTimeout(() => { inflight.current = inflight.current.then(async () => {   // one save at a time, so a device never conflicts with itself
      if (finalizing.current) return
      setSaved('saving')
      try { const r = await api<{ ver: string }>(`/rx/${rxId}`, { method: 'PUT', body: { data, meds, base: ver.current } }); ver.current = r.ver; setSaved('saved') } catch (e: any) {
        setSaved('dirty')
        if (e instanceof ApiError && e.code === 'RX_CONFLICT') {
          if (conflictOpen.current) return
          conflictOpen.current = true
          // the same prescription was edited on another device (e.g. the doctor's phone): let the doctor choose, never overwrite silently
          const pick = await dlg.ask('Changed on another device', { text: 'This prescription was saved from another device after you opened it. Load that version, or keep what is on this screen and overwrite it.', ok: 'Load latest', alt: 'Keep mine' })
          if (pick === 'ok') load()
          else if (pick === 'alt') { ver.current = null; setData(d => ({ ...d })) }   // next autosave writes without the version check
          conflictOpen.current = false
        } else if (e instanceof ApiError && e.status !== 0 && e.status !== 409) toast(e.message, 'err')
      }
    }) }, 900)
    return () => clearTimeout(t)
  }, [data, meds]) // eslint-disable-line
  useEffect(() => { const f = (e: BeforeUnloadEvent) => { if (saved !== 'saved') e.preventDefault() }; window.addEventListener('beforeunload', f); return () => window.removeEventListener('beforeunload', f) }, [saved])


  const patient = b?.patient
  const alerts = useMemo(() => !patient ? [] : safetyChecks(meds, { allergies: patient.allergies, conditions: [...(patient.conditions || []), ...Object.keys(data.comorbid || {}).filter(k => data.comorbid?.[k])], egfr: parseFloat(data.comorbid_details?.ckd?.egfr) || null, age: patient.age_years }), [meds, patient, data.comorbid, data.comorbid_details])
  const set = <K extends keyof RxData>(k: K, v: RxData[K]) => { if (!final) setData(d => ({ ...d, [k]: v })) }
  const setV = (k: keyof Vitals, v: string) => set('vitals', { ...(data.vitals || {}), [k]: v })
  const setMed = (i: number, p: Partial<Med>) => setMeds(ms => ms.map((m, j) => j === i ? { ...m, ...p } : m))

  const isRegular = (name: string) => regular.some(r => r.name.toLowerCase() === name.toLowerCase())
  const toggleRegular = async (m: Med) => {
    try {
      if (isRegular(m.name)) { await api(`/medicines/regular?name=${encodeURIComponent(m.name)}`, { method: 'DELETE' }); setRegular(r => r.filter(x => x.name.toLowerCase() !== m.name.toLowerCase())); toast(`${m.name} removed from regular medicines`) }
      else { const defaults = { form: m.form, dose: m.dose, freq: m.freq, timing: m.timing, days: m.days, route: m.route, kind: m.kind }; await api('/medicines/regular', { body: { name: m.name, defaults } }); setRegular(r => [...r, { name: m.name, defaults }].sort((a, b) => a.name.localeCompare(b.name))); toast(`${m.name} added to regular medicines`, 'ok') }
    } catch (e: any) { toast(e.message, 'err') }
  }
  const saveAsTemplate = async () => {
    if (!meds.length && !data.diagnosis) return toast('Add a diagnosis or medicines first.', 'err')
    const name = ((await dlg.prompt('Save as a template', { text: 'Name for this template, e.g. Diabetes follow-up.', value: data.diagnosis || '', ok: 'Save template' })) || '').trim()
    if (name.length < 2) return
    try {
      await api('/templates', { body: { name, data: { diagnosis: data.diagnosis || '', meds, investigations: data.investigations || [], advice: data.advice || [], follow_up_days: data.follow_up?.days || null } } })
      setTemplates(await api<Template[]>('/templates')); toast(`Template "${name}" saved. It is on the list above.`, 'ok')
    } catch (e: any) { toast(e.message, 'err') }
  }
  const applyTemplate = async (t: Template) => {
    let merge = false
    if (meds.length > 0) { const a = await dlg.ask(`Use "${t.name}"?`, { text: `${meds.length} medicine(s) are already on this prescription.`, ok: 'Replace them', alt: 'Add to them' }); if (!a) return; merge = a === 'alt' }
    setMeds(merge ? [...meds, ...t.data.meds.filter(m => !meds.some(x => x.name === m.name))] : t.data.meds.map(m => ({ ...m })))
    setData(d => ({ ...d, diagnosis: d.diagnosis && merge ? d.diagnosis + ', ' + t.data.diagnosis : t.data.diagnosis, investigations: [...new Set([...(d.investigations || []), ...t.data.investigations])], advice: [...new Set([...(d.advice || []), ...t.data.advice])], follow_up: t.data.follow_up_days ? { ...(d.follow_up || {}), days: t.data.follow_up_days } : d.follow_up }))
    toast(`${t.name}: ${t.data.meds.length} medicines, tests and advice filled`, 'ok')
  }
  const repeat = (p: Hist['prescriptions'][number]) => { setMeds(p.meds.map(m => ({ ...m }))); if (!data.diagnosis) set('diagnosis', p.diagnosis || ''); toast(`Repeated ${p.meds.length} medicines from ${fmtDate(d10(p.rx_date))}`, 'ok') }

  /** Finalise (if still a draft), then run the follow-up action. */
  const finalizeThen = async (then: () => void, overrideAlerts = false) => {
    if (final) return then()
    setBusy(true); finalizing.current = true
    try {
      await inflight.current.catch(() => {})   // a draft save already on its way finishes first, so it cannot land after the prescription is final
      const r = await api<{ already?: boolean }>(`/rx/${rxId}/finalize`, { body: { data, meds, override_alerts: overrideAlerts } })
      if (r?.already) await load()   // it was already final (another device, or a retry): show what is stored, not what this screen had
      setSaved('saved'); setOverride(null); out.reset()
      if (!r?.already) setB(x => x && { ...x, rx: { ...x.rx, status: 'final', pdf_file_id: null } })
      onChanged()
      setTimeout(() => { out.ensurePdf(); then() }, 350)
    } catch (e: any) { if (e.code === 'SAFETY') setOverride({ msg: e.message, then }); else toast(e.message, 'err') } finally { setBusy(false); finalizing.current = false }
  }
  const reopen = async () => { if (!(await dlg.ask('Reopen this prescription?', { text: 'The change is recorded in the activity log.', ok: 'Reopen' }))) return; try { await api(`/rx/${rxId}/reopen`, { method: 'POST' }); await load(); onChanged() } catch (e: any) { toast(e.message, 'err') } }

  if (err) return <div className="empty"><b>Could not open this prescription</b>{err}</div>
  if (!b) return <><div className="opd-main"><Spinner /></div>{renderSide(null)}</>
  const s = me.clinic.settings, v = data.vitals || {}
  const lastFinal = hist?.prescriptions.find(p => p.status === 'final' && p.id !== rxId && p.meds?.length)
  const startedAt = b.visit?.started_at ? new Date(b.visit.started_at).getTime() : null
  const finishedAt = b.visit?.finished_at ? new Date(b.visit.finished_at).getTime() : null
  const elapsed = startedAt ? ((finishedAt || (final ? startedAt : now)) - startedAt) / 1000 : null
  const summary = (() => { const p = hist?.prescriptions.find(x => x.status === 'final' && x.id !== rxId); if (!p) return null; const l = hist!.labs.filter(x => x.test === 'HbA1c').slice(-1)[0]; return `Last visit ${fmtDate(d10(p.rx_date))}: ${p.diagnosis || p.complaints || '—'}${p.vitals?.bp ? `, BP ${p.vitals.bp}` : ''}${l ? `, HbA1c ${l.value_num}%` : ''}. On ${p.meds.map(m => m.name.replace(/\s(Tablet|Capsule|Syrup)s?$/i, '')).join(', ') || 'no medicines'}.` })()
  const ro = final

  const paper = <ParchiPreview s={s} patient={patient} data={data} meds={meds} date={d10(b.rx.rx_date)} draft={!final} token={b.visit?.token} />
  return <>
    <div className="opd-main">
      <div className="pt-head">
        <div>
          <div className="pt-name">{patient.name}</div>
          <div className="pt-meta">{ageSex(patient)} · {b.visit ? `Token ${b.visit.token} · ` : ''}{patient.uhid}{patient.phone ? ` · ${patient.phone}` : ' · no mobile'}</div>
          <div className="pt-tags">
            {(patient.conditions || []).map((c: string) => <span key={c} className="tag ink">{c}</span>)}
            {(patient.allergies || []).map((a: string) => <span key={a} className="tag red">Allergic: {a}</span>)}
            {!patient.conditions?.length && !patient.allergies?.length && <span className="tag">No known conditions</span>}
            <button className="btn sm ghost" onClick={() => setEditPt(true)}><Icon n="edit" />Edit</button>
          </div>
        </div>
        <div className="row">
          {elapsed != null && <div className="timer"><span className="mono">{fmtT(elapsed)}</span><small>{final ? 'final time' : 'time on this parchi'}</small></div>}
          {!final && <span className={'savebadge' + (saved !== 'saved' ? ' dirty' : '')}><i />{saved === 'saved' ? 'Saved' : saved === 'saving' ? 'Saving…' : 'Unsaved'}</span>}
        </div>
      </div>
      {(() => { const val = parchiValidity(lastFinal?.rx_date, d10(b.rx.rx_date)); return val && lastFinal ? <div className="alert ok"><b>Parchi valid</b><span>Last prescription {val.ago === 0 ? 'today' : val.ago === 1 ? 'yesterday' : `${val.ago} days ago`} ({fmtDate(d10(lastFinal.rx_date))}). It is valid for {PARCHI_VALID_DAYS} days, until {fmtDate(val.till)} ({val.daysLeft} day{val.daysLeft === 1 ? '' : 's'} left).</span></div> : null })()}
      {summary && <div className="summary"><b>Summary of past visits:</b> {summary} {lastFinal && !ro && <button className="btn sm" style={{ marginLeft: 6 }} onClick={() => repeat(lastFinal)}>Repeat medicines</button>}</div>}
      {final && <div className="alert ok"><b>Final.</b><span className="grow">Print it, send it on WhatsApp, or call the next patient.</span><button className="btn sm" onClick={reopen}>Reopen to edit</button></div>}

      {!ro && <div className="tools">
        <button className="tool" onClick={() => setVoice(true)}><span className="ic"><Icon n="mic" /></span><span><b>Speak the consult</b><span>{me.features.ai ? 'Hinglish voice to a draft prescription' : 'Voice to a basic draft (add a free Groq key for AI)'}</span></span></button>
        <button className="tool" onClick={() => setScan(true)} disabled={!me.features.ai}><span className="ic"><Icon n="cam" /></span><span><b>Scan old parchi or report</b><span>Photo to medicines and lab values</span></span></button>
      </div>}

      <fieldset className="fs" disabled={ro}><div className="fs-h"><label htmlFor="in-co">Complaints</label></div>
        <textarea id="in-co" className="inp" rows={2} value={data.complaints || ''} onChange={e => set('complaints', e.target.value)} placeholder="e.g. Fever with chills for 3 days" />
        <div className="chips">{['Fever', 'Cough', 'Cold', 'Body ache', 'Headache', 'Burning urination', 'Acidity', 'Loose motions', 'Vomiting', 'Giddiness', 'Weakness', 'Breathlessness', 'Chest pain', 'Sugar follow-up', 'BP check'].map(c => <button key={c} type="button" className="chip" onClick={() => set('complaints', data.complaints ? data.complaints.replace(/\.?\s*$/, ', ') + c.toLowerCase() : c)}>+ {c}</button>)}</div>
      </fieldset>

      <details className="sec">
        <summary><h3>Vitals</h3><span className="small muted">{[v.bp && `BP ${v.bp}`, v.pulse && `Pulse ${v.pulse}`, v.temp && `Temp ${v.temp}`, v.spo2 && `SpO₂ ${v.spo2}`, v.grbs && `GRBS ${v.grbs}`, v.weight && `${v.weight} kg`].filter(Boolean).join(' · ') || 'Not recorded yet'}</span></summary>
      <fieldset className="sec-b fs" disabled={ro}>
        <div className="vitals">{([['bp', 'BP', '120/80'], ['pulse', 'Pulse', '72'], ['temp', 'Temp °F', '98.6'], ['spo2', 'SpO₂ %', '98'], ['rr', 'RR', '16'], ['grbs', 'GRBS', '110'], ['weight', 'Weight kg', '60']] as const).map(([k, l, ph]) =>
          <Field key={k} label={l}><input className={'inp sm mono ' + vitalFlag(k, v[k])} value={v[k] || ''} placeholder={ph} inputMode={k === 'bp' ? 'text' : 'decimal'} onChange={e => setV(k, e.target.value)} /></Field>)}</div>
      </fieldset>
      </details>

      <fieldset className="fs" disabled={ro}><div className="fs-h"><label htmlFor="in-dx">Diagnosis · one-tap templates</label>{!ro && <span className="row"><button type="button" className="btn sm ghost" onClick={saveAsTemplate}><Icon n="plus" />Save this as a template</button><Link className="btn sm ghost" to="/settings/templates">Edit templates</Link></span>}</div>
        <div className="chips">{templates.map(t => <button key={t.id} type="button" className="chip" onClick={() => applyTemplate(t)}>{t.name} <span className="faint tiny">{t.data.meds.length} Rx</span></button>)}</div>
        <input id="in-dx" className="inp" value={data.diagnosis || ''} onChange={e => set('diagnosis', e.target.value)} placeholder="Provisional diagnosis" />
      </fieldset>

      <fieldset className="fs" disabled={ro}><div className="fs-h"><span className="lbl">Medicines</span></div>
        {!ro && regular.length > 0 && <div className="chips" aria-label="Regular medicines"><span className="lbl" style={{ alignSelf: 'center' }}>★ Regular</span>{regular.map(r => <button key={r.name} type="button" className="chip" onClick={() => setMeds(ms => ms.some(m => m.name === r.name) ? ms : [...ms, medFromHit({ name: r.name, defaults: r.defaults })])}>+ {r.name}</button>)}</div>}
        {!ro && <MedSearch onPick={m => setMeds(ms => [...ms, m])} />}
        {meds.length === 0 ? <p className="small muted">Tap a template, search for a medicine, or speak the consult.</p> :
          <div>{meds.map((m, i) => <MedRow key={i} i={i} m={m} ro={ro} regular={isRegular(m.name)} onStar={() => toggleRegular(m)} alerted={alerts.some(a => a.med === i && a.level === 'crit')} set={p => setMed(i, p)} remove={() => setMeds(ms => ms.filter((_, j) => j !== i))} move={d => setMeds(ms => { const n = [...ms]; const j = i + d; if (j < 0 || j >= n.length) return ms; [n[i], n[j]] = [n[j], n[i]]; return n })} />)}</div>}
        {alerts.map((a, i) => <div key={i} className={'alert ' + a.level}><b>{a.level === 'crit' ? 'Stop' : a.level === 'warn' ? 'Check' : 'Note'}</b><span>{a.text}</span></div>)}
      </fieldset>

      <details className="sec">
        <summary><h3>Investigations and advice</h3><span className="small muted">{[(data.investigations || []).length ? `${(data.investigations || []).length} test${(data.investigations || []).length > 1 ? 's' : ''}` : '', (data.advice || []).length ? `${(data.advice || []).length} advice` : ''].filter(Boolean).join(' · ') || 'None added'}</span></summary>
        <div className="sec-b">
      <div className="two">
        <fieldset className="fs" disabled={ro}><div className="fs-h"><span className="lbl">Investigations</span></div>
          <TagInput value={data.investigations || []} onChange={x => set('investigations', x)} placeholder="Add a test" suggestions={COMMON_INVESTIGATIONS.slice(0, 18)} /></fieldset>
        <fieldset className="fs" disabled={ro}><div className="fs-h"><span className="lbl">Advice (English + हिंदी)</span></div>
          <div className="chips">{ADVICE_PRESETS.map(a => { const on = (data.advice || []).includes(a.en); return <button key={a.en} type="button" title={a.hi} className={'chip' + (on ? ' on' : '')} onClick={() => set('advice', on ? data.advice!.filter(x => x !== a.en) : [...(data.advice || []), a.en])}>{a.en}</button> })}</div>
          <TagInput value={(data.advice || []).filter(a => !ADVICE_PRESETS.some(p => p.en === a))} onChange={x => set('advice', [...(data.advice || []).filter(a => ADVICE_PRESETS.some(p => p.en === a)), ...x])} placeholder="Other advice, press Enter" />
        </fieldset>
      </div>
        </div>
      </details>

      <fieldset className="fs" disabled={ro}><div className="fs-h"><span className="lbl">Follow-up</span></div>
        <div className="row wrap"><div className="chips">{[0, 3, 5, 7, 10, 14, 30, 60, 90].map(d => <button key={d} type="button" className={'chip' + ((data.follow_up?.days || 0) === d ? ' on' : '')} onClick={() => set('follow_up', { ...(data.follow_up || {}), days: d || null })}>{d ? (d < 30 ? `${d} days` : `${d / 30} month${d > 30 ? 's' : ''}`) : 'None'}</button>)}</div>
          <label className="row" style={{ gap: 6 }}><input className="inp sm" style={{ width: 84 }} inputMode="numeric" placeholder="days" aria-label="Follow-up after (days)" title="Type any number of days" value={data.follow_up?.days ?? ''} onChange={e => { const n = parseInt(e.target.value.replace(/\D/g, '')); set('follow_up', { ...(data.follow_up || {}), days: n ? Math.min(365, n) : null }) }} /><span className="small muted">days</span></label>
          <input className="inp sm" style={{ width: 190 }} placeholder="Note, e.g. bring reports" value={data.follow_up?.note || ''} onChange={e => set('follow_up', { ...(data.follow_up || {}), note: e.target.value })} /></div>
      </fieldset>

      <details className="sec">
        <summary><h3>Examination, history and addiction</h3><span className="small muted">{[EXAM_SIGNS.filter(e => data.exam?.[e.key] && data.exam[e.key] !== 'Absent').map(e => e.label).join(', '), COMORBIDITIES.filter(c => data.comorbid?.[c.key]).map(c => c.label).join(', ')].filter(Boolean).join(' · ') || 'Optional detail'}</span></summary>
        <fieldset className="sec-b fs" disabled={ro}>
          <div className="row wrap"><span className="lbl grow">General examination</span><button type="button" className="btn sm" onClick={() => set('exam', Object.fromEntries(EXAM_SIGNS.filter(e => e.key !== 'lymph_node').map(e => [e.key, 'Absent'])))}>All absent</button></div>
          <div className="grid3">{EXAM_SIGNS.map(e => <div key={e.key} className="field"><span>{e.label}</span><div className="seg">{['Absent', 'Present'].map(o => <button type="button" key={o} aria-pressed={data.exam?.[e.key] === o} onClick={() => set('exam', { ...(data.exam || {}), [e.key]: data.exam?.[e.key] === o ? '' : o })}>{o}</button>)}</div></div>)}</div>
          <div className="row wrap"><span className="lbl grow">Systemic examination</span><button type="button" className="btn sm" onClick={() => set('systemic', Object.fromEntries(SYSTEMIC.map(x => [x.key, data.systemic?.[x.key] || x.normal])))}>Fill normal findings</button></div>
          <div className="grid2">{SYSTEMIC.map(x => <Field key={x.key} label={x.label}><input className="inp sm" value={data.systemic?.[x.key] || ''} onChange={e => set('systemic', { ...(data.systemic || {}), [x.key]: e.target.value })} placeholder={x.normal} /></Field>)}</div>
          <span className="lbl">Comorbidities</span>
          <div className="chips">{COMORBIDITIES.map(c => <button type="button" key={c.key} className={'chip' + (data.comorbid?.[c.key] ? ' on' : '')} onClick={() => set('comorbid', { ...(data.comorbid || {}), [c.key]: !data.comorbid?.[c.key] })}>{c.label}</button>)}</div>
          {COMORBIDITIES.filter(c => data.comorbid?.[c.key]).map(c => <details key={c.key} className="card" style={{ padding: '10px 12px' }}><summary style={{ cursor: 'pointer', fontWeight: 600 }}>{c.label} details</summary>
            <div className="grid3" style={{ marginTop: 10 }}>{c.fields.map(f => {
              const val = data.comorbid_details?.[c.key]?.[f.key]
              const put = (x: any) => set('comorbid_details', { ...(data.comorbid_details || {}), [c.key]: { ...(data.comorbid_details?.[c.key] || {}), [f.key]: x } })
              return f.type === 'check' ? <label key={f.key} className="check small"><input type="checkbox" checked={!!val} onChange={e => put(e.target.checked)} />{f.label}</label>
                : f.type === 'select' ? <Field key={f.key} label={f.label}><select className="inp sm" value={val || ''} onChange={e => put(e.target.value)}><option value="">—</option>{f.options!.map(o => <option key={o}>{o}</option>)}</select></Field>
                : <Field key={f.key} label={f.label}><input className="inp sm" value={val || ''} onChange={e => put(e.target.value)} /></Field>
            })}</div></details>)}
          <span className="lbl">Addiction</span>
          <div className="chips">{ADDICTIONS.map(a => <button type="button" key={a.key} className={'chip' + (data.addiction?.[a.key] ? ' on' : '')} onClick={() => set('addiction', { ...(data.addiction || {}), [a.key]: !data.addiction?.[a.key] })}>{a.label}</button>)}</div>
        </fieldset>
      </details>

      <div className="opd-actions">
        <label className="check"><input type="checkbox" checked={data.hindi !== false} disabled={ro} onChange={e => set('hindi', e.target.checked)} />Hindi line for patient</label>
        <span className="grow" />
        <button className="btn" disabled={busy} onClick={() => finalizeThen(() => printOnly('rx', s.letterhead.paper))}><Icon n="print" />Print {s.letterhead.paper}</button>
        <button className="btn" disabled={busy} onClick={() => finalizeThen(() => setWa(true))}><Icon n="wa" />WhatsApp</button>
        {b.visit && <button className="btn" onClick={() => { const x = hist?.bills?.find((y: any) => y.status !== 'void' && d10(y.bill_date) === d10(b.rx.rx_date)); x ? setReceipt(x.id) : setBill(true) }}><Icon n="rupee" />Bill</button>}
        <button className="btn primary" disabled={busy} onClick={() => finalizeThen(onNext)}><Icon n="next" />{final ? 'Call next' : 'Save & call next'}</button>
      </div>
    </div>
    {renderSide(<>
      <div className="side-h"><b>Live parchi</b><span className="tag ink">{final ? 'final' : 'updates as you type'}</span></div>
      <div className="paper-scroll">{paper}</div>
      {final && <div className="row wrap"><button className="btn sm" onClick={() => out.download(`Parchi-${patient.name.replace(/\W+/g, '_')}-${d10(b.rx.rx_date)}.pdf`)}><Icon n="down" />Download PDF</button><span className="small muted">{out.busy ? 'Making PDF…' : out.made ? 'PDF ready for WhatsApp' : ''}</span></div>}
    </>)}
    <PrintArea ref={page} s={s} patient={patient} data={data} meds={meds} date={d10(b.rx.rx_date)} draft={!final} token={b.visit?.token} />

    {voice && <VoiceDialog patientId={patient.id} onClose={() => setVoice(false)} onApply={d => {
      setVoice(false)
      setData(x => ({
        ...x,
        complaints: d.keep.complaints && d.complaints ? [x.complaints, d.complaints].filter(Boolean).join('. ') : x.complaints,
        diagnosis: d.keep.diagnosis && d.diagnosis ? d.diagnosis : x.diagnosis,
        vitals: d.keep.vitals ? { ...(x.vitals || {}), ...Object.fromEntries(Object.entries(d.vitals).filter(([, v]) => v)) } : x.vitals,
        investigations: d.keep.investigations ? [...new Set([...(x.investigations || []), ...d.investigations])] : x.investigations,
        advice: d.keep.advice ? [...new Set([...(x.advice || []), ...d.advice])] : x.advice,
        follow_up: d.keep.follow_up && d.follow_up_days ? { ...(x.follow_up || {}), days: d.follow_up_days } : x.follow_up,
      }))
      setMeds(ms => [...ms, ...d.medChoice.map(m => ({ ...medFromHit({ name: m.name, kind: m.kind, form: m.form }), ...m, freq: normFreq(m.freq) }))])
      toast('Draft added. Check it before saving.', 'ok')
    }} />}
    {scan && <ScanDialog patientId={patient.id} onClose={() => setScan(false)} onSaved={async r => {
      setScan(false)
      if (r.allergies.length || r.conditions.length) { const p = await api(`/patients/${patient.id}`, { method: 'PUT', body: { allergies: [...new Set([...(patient.allergies || []), ...r.allergies])], conditions: [...new Set([...(patient.conditions || []), ...r.conditions])] } }); setB(x => x && { ...x, patient: p }) }
      api<Hist>(`/patients/${patient.id}`).then(setHist).catch(() => {})
      toast(`Saved ${r.labs} lab value${r.labs === 1 ? '' : 's'} to history`, 'ok')
    }} />}
    {editPt && <EditPatient p={patient} onClose={() => setEditPt(false)} onSaved={p => { setB(x => x && { ...x, patient: p }); setEditPt(false) }} />}
    {override && <Modal title="Safety check" onClose={() => setOverride(null)} footer={<><button className="btn" onClick={() => setOverride(null)}>Go back and change</button><button className="btn danger" onClick={() => finalizeThen(override.then, true)}>I have checked, save anyway</button></>}>
      <div className="alert crit">{override.msg}</div><p className="small muted" style={{ marginTop: 10 }}>If you save anyway, your decision is recorded in the activity log.</p>
    </Modal>}
    {wa && <WhatsAppPreview rxId={rxId} patient={patient} meds={meds} advice={data.advice || []} followDays={data.follow_up?.days} rxDate={d10(b.rx.rx_date)} ensurePdf={out.ensurePdf} onClose={() => setWa(false)} />}
    {bill && <BillDialog patient={{ id: patient.id, name: patient.name }} visit={b.visit} onClose={() => setBill(false)} onDone={id => { setBill(false); setReceipt(id); api<Hist>(`/patients/${patient.id}`).then(setHist); onChanged() }} />}
    {receipt && <ReceiptDialog billId={receipt} onClose={() => setReceipt(null)} onChange={onChanged} />}
  </>
}

function MedRow({ i, m, set, remove, move, alerted, ro, regular, onStar }: { regular: boolean; onStar: () => void; i: number; m: Med; set: (p: Partial<Med>) => void; remove: () => void; move: (d: number) => void; alerted: boolean; ro: boolean }) {
  const ongoing = /^regular$/i.test((m.duration || '').trim())
  const [more, setMore] = useState(false)
  return <div className={'medrow' + (alerted ? ' alerted' : '') + (more ? ' expanded' : '')}>
    <span className="sn">{i + 1}</span>
    <div style={{ minWidth: 0 }}>
      <div className="nm nm-line">{m.form ? <span className="faint">{m.form}.</span> : null}
        {ro ? <span>{m.name}</span> : <input className="nm-edit" value={m.name} aria-label="Medicine name (edit to change)" title="Click to edit the medicine name" onChange={e => set(m.kind === 'ja' || m.kind === 'brand' ? { name: e.target.value, kind: 'custom', price: null } : { name: e.target.value })} />}
        {!ro && <button type="button" className={'icon-btn star' + (regular ? ' on' : '')} onClick={onStar} aria-pressed={regular} aria-label={regular ? 'Remove from regular medicines' : 'Add to regular medicines'} title={regular ? 'Regular medicine (click to remove)' : 'Add to regular medicines'}>{regular ? '★' : '☆'}</button>}</div>
      <div className="hi">{sigHi(m)}</div>
    </div>
    {!ro ? <button type="button" className="icon-btn" onClick={() => setMore(x => !x)} aria-label="More options" aria-expanded={more}><Icon n="edit" /></button> : <span />}
    <div className="med-ctl">
    <input className="inp sm" value={m.dose || ''} onChange={e => set({ dose: e.target.value })} aria-label="Dose" title="Dose" />
    <select className="inp sm" value={FREQS.includes(normFreq(m.freq)) ? normFreq(m.freq) : '__'} onChange={e => set({ freq: e.target.value === '__' ? m.freq : e.target.value })} aria-label="Frequency">
      {FREQS.map(f => <option key={f}>{f}</option>)}{!FREQS.includes(normFreq(m.freq)) && <option value="__">{m.freq || '—'}</option>}
    </select>
    <select className="inp sm" value={m.timing || ''} onChange={e => set({ timing: e.target.value as Med['timing'] })} aria-label="Food timing">
      <option value="">Any time</option><option value="after">After food</option><option value="before">Before food</option><option value="empty">Empty stomach</option><option value="with">With food</option>
    </select>
    <div className="days-cell">
      {!ongoing && <input className="inp sm" inputMode="numeric" value={m.days ?? ''} placeholder="days" onChange={e => set({ days: e.target.value ? Math.min(3650, parseInt(e.target.value) || 0) : null, duration: '' })} aria-label="Days" title="Days" />}
      <button type="button" className={'chip' + (ongoing ? ' on' : '')} aria-pressed={ongoing} title={ongoing ? 'Regular: no end date. Click to set days instead' : 'Take regularly, no end date'} onClick={() => set(ongoing ? { duration: '', days: null } : { duration: 'Regular', days: null })}>Regular</button>
    </div>
    </div>
    {more && <div className="med-more">
      <select className="inp sm" style={{ width: 130 }} value={m.route || 'Oral'} onChange={e => set({ route: e.target.value })} aria-label="Route">{ROUTES.map(r => <option key={r}>{r}</option>)}</select>
      <input className="inp sm" style={{ width: 130 }} value={m.duration || ''} placeholder="or e.g. Continue" onChange={e => set({ duration: e.target.value, days: e.target.value ? null : m.days })} aria-label="Duration text" />
      <input className="inp sm grow" value={m.instructions || ''} placeholder="Instructions (e.g. with warm water)" onChange={e => set({ instructions: e.target.value })} />
      <button type="button" className="btn sm" onClick={() => move(-1)}>Up</button><button type="button" className="btn sm" onClick={() => move(1)}>Down</button>
      <button type="button" className="btn sm danger" onClick={remove}><Icon n="trash" />Remove</button>
    </div>}
  </div>
}

export function EditPatient({ p, onClose, onSaved }: { p: any; onClose: () => void; onSaved: (p: any) => void }) {
  const toast = useToast()
  const [f, setF] = useState({ name: p.name, sex: p.sex, age_years: p.age_years, phone: p.phone || '', address: p.address || '', allergies: p.allergies || [], conditions: p.conditions || [], notes: p.notes || '' })
  const save = async () => { try { onSaved(await api(`/patients/${p.id}`, { method: 'PUT', body: { ...f, phone: f.phone || null, address: f.address || null, notes: f.notes || null } })); toast('Patient details saved', 'ok') } catch (e: any) { toast(e.message, 'err') } }
  return <Modal title="Patient details" width={620} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
    <div className="stack">
      <div className="grid2"><Field label="Name"><input className="inp" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field><Field label="Mobile number"><input className="inp" inputMode="tel" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} /></Field></div>
      <div className="grid2"><Field label="Age (years)"><input className="inp" inputMode="numeric" value={f.age_years ?? ''} onChange={e => setF({ ...f, age_years: e.target.value ? parseInt(e.target.value) || 0 : null })} /></Field>
        <div className="field"><span>Sex</span><div className="seg">{(['M', 'F', 'O'] as const).map(s => <button key={s} aria-pressed={f.sex === s} onClick={() => setF({ ...f, sex: s })}>{s === 'M' ? 'Male' : s === 'F' ? 'Female' : 'Other'}</button>)}</div></div></div>
      <Field label="Address"><input className="inp" value={f.address} onChange={e => setF({ ...f, address: e.target.value })} /></Field>
      <div className="field"><span>Allergies</span><TagInput value={f.allergies} onChange={a => setF({ ...f, allergies: a })} suggestions={['Sulfa', 'Penicillin', 'NSAIDs']} /></div>
      <div className="field"><span>Long-term conditions</span><TagInput value={f.conditions} onChange={a => setF({ ...f, conditions: a })} suggestions={['Diabetes', 'Hypertension', 'COPD / Asthma', 'Thyroid disorder', 'CAD', 'CKD', 'Tuberculosis', 'Stroke']} /></div>
      <Field label="Notes"><textarea className="inp" value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></Field>
    </div>
  </Modal>
}
