import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../lib/api'
import { useMe } from '../lib/session'
import { ageSex } from '../lib/format'
import { useAsync, useToast } from '../components/ui'
import Icon from '../components/Icon'
import ConsultPane from './Consult'
import Today, { AddToQueue } from './Today'

type Visit = { id: string; token: number; status: string; name: string; sex: string | null; age_years: number | null; complaint: string | null; allergies: string[]; rx_id: string | null; rx_status: string | null; started_at: string | null; finished_at: string | null; patient_id: string }
const fmtT = (s: number) => Math.floor(s / 60) + ':' + String(Math.round(s % 60)).padStart(2, '0')

export default function Opd() {
  const me = useMe()
  return me.user.role === 'reception' ? <Today /> : <DoctorOpd />
}

function DoctorOpd() {
  const { rxId } = useParams(), nav = useNavigate(), toast = useToast()
  const q = useAsync(() => api<Visit[]>('/visits'), [])
  const [adding, setAdding] = useState(false)
  useEffect(() => { const t = setInterval(() => document.visibilityState === 'visible' && q.reload(), 20000); return () => clearInterval(t) }, []) // eslint-disable-line
  const list = (q.data || []).filter(v => v.status !== 'cancelled').sort((a, b) => a.token - b.token)
  const open = async (v: Visit) => {
    if (v.rx_id && v.rx_id === rxId) return
    try { const r = await api<{ rx_id: string }>(`/visits/${v.id}/start`, { method: 'POST' }); q.reload(); nav(`/opd/${r.rx_id}`) } catch (e: any) { toast(e.message, 'err') }
  }
  const next = async () => {
    try { const r = await api<{ visit_id: string }>('/visits/next', { method: 'POST' }); const s = await api<{ rx_id: string }>(`/visits/${r.visit_id}/start`, { method: 'POST' }); q.reload(); nav(`/opd/${s.rx_id}`) }
    catch (e: any) { toast(e.message, 'err'); nav('/opd') }
  }
  const waiting = list.filter(v => v.status === 'waiting')
  return <div className="stack">
    <div className="page-h"><div className="grow"><h1>OPD &amp; Rx</h1><p>Call a token, tap a template or speak the consult. The parchi on the right is exactly what prints.</p></div>
      <button className="btn" onClick={() => setAdding(true)}><Icon n="plus" />Add patient</button></div>
    <div className="opd">
      <aside className="queue">
        <h3><span>Tokens</span><span className="mono">{list.filter(v => v.status === 'done').length}/{list.length}</span></h3>
        {list.length === 0 && <p className="small muted">No tokens yet today. Reception adds patients, or use Add patient.</p>}
        {list.map(v => {
          const on = !!rxId && v.rx_id === rxId
          const t = v.started_at && v.finished_at ? (new Date(v.finished_at).getTime() - new Date(v.started_at).getTime()) / 1000 : null
          return <button key={v.id} className={'q-item' + (on ? ' on' : '') + (v.status === 'done' ? ' done' : '')} onClick={() => v.status === 'done' && v.rx_id ? nav(`/opd/${v.rx_id}`) : open(v)}>
            <span className="q-tok">{v.token}</span>
            <span style={{ minWidth: 0 }}><span className="q-name">{v.name} {v.allergies?.length > 0 && <span className="tag red" style={{ fontSize: 10 }}>ALLERGY</span>}</span>
              <span className="q-sub">{v.status === 'done' ? `Done${t ? ' · ' + fmtT(t) : ''}` : v.status === 'with_doctor' ? 'With doctor' : `${v.age_years ?? ''}${v.sex || ''}${v.complaint ? ' · ' + v.complaint : ''}`}</span></span>
          </button>
        })}
      </aside>
      {rxId ? <ConsultPane key={rxId} rxId={rxId} onChanged={q.reload} onNext={next} renderSide={el => <aside className="opd-side">{el}</aside>} />
        : <><div className="opd-main">
            <div className="now-card">
              <div><div className="small" style={{ opacity: .8 }}>Waiting</div><div className="big">{waiting.length}</div></div>
              <div className="grow">{waiting[0] ? <><div style={{ font: '700 20px var(--f-head)' }}>Next: token {waiting[0].token}, {waiting[0].name}</div><div style={{ opacity: .85 }}>{ageSex(waiting[0])}{waiting[0].complaint ? ` · ${waiting[0].complaint}` : ''}</div></> : <div style={{ font: '700 18px var(--f-head)' }}>No one is waiting.</div>}</div>
              <button className="btn lg" disabled={!waiting.length} onClick={next}>Call next patient</button>
            </div>
            <p className="muted small">Pick a token on the left to open the consult. Templates, voice, safety checks and the live parchi are all here.</p>
          </div><aside className="opd-side"><div className="side-h"><b>Live parchi</b><span className="tag">opens with a token</span></div><div className="empty small">Call a token to start a prescription.</div></aside></>}
    </div>
    {adding && <AddToQueue onClose={() => setAdding(false)} onDone={() => { setAdding(false); q.reload() }} />}
  </div>
}
