import { Fragment, useEffect, useRef } from 'react'
import './parchi.css'
import type { ClinicSettings } from '../../shared/settings'
import { displayName, sigEn, sigHi, adviceHi, fmtDate, fmtDateHi, addDaysISO, vitalFlag, COMORBIDITIES, EXAM_SIGNS, SYSTEMIC, type Med } from '../../shared/rx'
import { fileUrl } from '../lib/api'

export type RxData = {
  complaints?: string; diagnosis?: string; vitals?: Record<string, string>; exam?: Record<string, string>; systemic?: Record<string, string>
  comorbid?: Record<string, boolean>; comorbid_details?: Record<string, Record<string, any>>; addiction?: Record<string, boolean>; addiction_note?: string
  investigations?: string[]; advice?: string[]; follow_up?: { days?: number | null; note?: string }; hindi?: boolean
}
export type ParchiPatient = { name: string; age_years?: number | null; sex?: string | null; address?: string | null; uhid?: string; phone?: string | null; allergies?: string[] }

export default function Parchi({ s, patient, data, meds, date, draft, token }: { s: ClinicSettings; patient: ParchiPatient; data: RxData; meds: Med[]; date: string; draft?: boolean; token?: number | null }) {
  const L = s.letterhead
  const v = data.vitals || {}
  const fuDays = Number(data.follow_up?.days) || 0
  const fuDate = fuDays > 0 ? addDaysISO(date, fuDays) : null
  const hindi = data.hindi !== false && L.print_hindi_doses
  const vit: [string, string, string][] = ([['BP', 'bp', 'mmHg'], ['Pulse', 'pulse', '/min'], ['Temp', 'temp', '°F'], ['SpO₂', 'spo2', '%'], ['RR', 'rr', '/min'], ['GRBS', 'grbs', 'mg/dL']] as [string, string, string][]).filter(x => v[x[1]])
  const signs = EXAM_SIGNS.filter(e => data.exam?.[e.key] && data.exam[e.key] !== 'Absent').map(e => e.label)
  const absent = EXAM_SIGNS.filter(e => data.exam?.[e.key] === 'Absent').length
  const sys = SYSTEMIC.filter(x => data.systemic?.[x.key])
  const conds = COMORBIDITIES.filter(c => data.comorbid?.[c.key]).map(c => c.label)
  const sex = patient.sex === 'M' ? 'M' : patient.sex === 'F' ? 'F' : patient.sex ? 'O' : '—'
  const logo = L.logo_file_id ? <img src={fileUrl(L.logo_file_id)} alt="" /> : L.use_letterhead_art ? <img src="/lh/logo.png" alt="" /> : '℞'
  return (
    <div className={'parchi' + (L.paper === 'A4' ? ' a4' : '')} style={{ ['--lh' as any]: L.ink }}>
      {draft && <div className="wm">DRAFT</div>}
      {L.layout === 'left'
        ? <div className="lh left"><div className="lh-logo">{logo}</div><div>
            <div className="lh-names"><span className="lh-hi">{L.clinic_name_hi}</span><span className="lh-en">{L.clinic_name_en}</span></div>
            <div className="lh-doc">{L.doctor_en} <span className="hi">· {L.doctor_hi}</span></div>
            <div className="lh-deg">{L.quals_en} · {L.designation} · Reg. {L.reg_no}</div>
            <div className="lh-contact">{L.address_en} · {L.phone}<br />{L.timings}</div></div></div>
        : <div className="lh center">
            <div className="lh-names"><span className="lh-hi">{L.clinic_name_hi}</span><span className="lh-en">| {L.clinic_name_en}</span></div>
            <div className="lh-doc">{L.doctor_en} <span className="hi">· {L.doctor_hi}</span></div>
            <div className="lh-deg">{L.quals_en} · {L.designation} · Reg. No. {L.reg_no}</div>
            <div className="lh-contact">{L.address_hi} · {L.phone}</div>
            <div className="lh-contact">{L.timings}</div></div>}
      <div className="prow">
        <div><span>Name</span><b>{patient.name}</b></div><div><span>Age/Sex</span>{patient.age_years ?? '—'} / {sex}</div><div><span>Date</span>{fmtDate(date)}</div>
        <div><span>OP No</span>{patient.uhid || '—'}</div><div><span>Wt</span>{v.weight ? `${v.weight} kg` : '—'}</div><div><span>Token</span>{token ?? '—'}</div>
      </div>
      <div className="pbody">
        <div className="pleft">
          {data.complaints && <div><h5>C/O</h5><p>{data.complaints}</p></div>}
          {(vit.length > 0 || signs.length > 0 || absent > 0 || sys.length > 0) && <div><h5>O/E</h5>
            {vit.length > 0 && <div className="pv">{vit.map(x => <Fragment key={x[0]}><span>{x[0]}</span><span className={vitalFlag(x[1] as any, v[x[1]]) ? 'hi' : ''}>{v[x[1]]} {x[2]}</span></Fragment>)}</div>}
            {(signs.length > 0 || absent > 0) && <p>{signs.length ? signs.join(', ') + ' present' : 'No pallor, icterus, cyanosis, clubbing, edema'}</p>}
            {sys.map(x => <p key={x.key}>{x.label}: {data.systemic![x.key]}</p>)}
          </div>}
          {(patient.allergies || []).length > 0 && <div><h5>Allergy</h5><p style={{ color: '#B2261E', fontWeight: 600 }}>{patient.allergies!.join(', ')}</p></div>}
          {conds.length > 0 && <div><h5>History</h5><p>{conds.join(', ')}</p></div>}
          {data.diagnosis && <div><h5>Diagnosis</h5><p><b>{data.diagnosis}</b></p></div>}
          {(data.investigations || []).length > 0 && <div><h5>Investigations</h5><p>{data.investigations!.join(', ')}</p></div>}
        </div>
        <div className="pright">
          <div className="rxs">℞</div>
          <ol className="pmeds">
            {meds.length ? meds.map((m, i) => <li key={i}>
              <div className="m-en"><b>{displayName(m)}</b>{m.kind === 'brand' && m.instructions ? '' : ''}</div>
              <div className="m-sig">{sigEn(m)}{m.instructions ? ` · ${m.instructions}` : ''}</div>
              {hindi && <div className="m-hi">{sigHi(m)}</div>}
            </li>) : <li style={{ listStyle: 'none', color: 'var(--pm)' }}>Medicines appear here as you add them.</li>}
          </ol>
          {(data.advice || []).length > 0 && <div className="padv"><h5>Advice</h5>{data.advice!.map((a, i) => <div key={i}>• {a}{hindi && adviceHi(a) ? <span className="hi"> / {adviceHi(a)}</span> : null}</div>)}</div>}
        </div>
      </div>
      <div className="pfu">
        <div className="fu">{fuDate ? <>Follow-up: {fmtDate(fuDate)}{hindi ? <span style={{ color: 'var(--lh)' }}> ({fmtDateHi(fuDate)} को दिखाएँ)</span> : null}</> : ''}{data.follow_up?.note ? <div style={{ fontWeight: 400 }}>{data.follow_up.note}</div> : null}</div>
        <div className="sign">{L.signature_file_id ? <img src={fileUrl(L.signature_file_id)} alt="" /> : <div className="s">{L.signature_name}</div>}<div className="l">{L.doctor_en} · {L.reg_no}</div></div>
      </div>
      <div className="pfoot"><span>Generic names as per NMC guidance · Valid for {L.validity_days} days</span><span>Made with Arogya Rx</span></div>
    </div>
  )
}

/** Scaled preview of the page that fits its container width. */
export function ParchiPreview(props: Parameters<typeof Parchi>[0]) {
  const wrap = useRef<HTMLDivElement>(null), inner = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = wrap.current, page = inner.current
    if (!el || !page) return
    const fit = () => { const k = el.clientWidth / page.firstElementChild!.clientWidth; page.style.transform = `scale(${k})`; el.style.height = page.offsetHeight * k + 'px' }
    fit()
    const ro = new ResizeObserver(fit); ro.observe(el); ro.observe(page)
    return () => ro.disconnect()
  }, [])
  return <div ref={wrap} style={{ position: 'relative', overflow: 'hidden' }}><div ref={inner} className="parchi-zoom" style={{ position: 'absolute', top: 0, left: 0 }}><Parchi {...props} /></div></div>
}
