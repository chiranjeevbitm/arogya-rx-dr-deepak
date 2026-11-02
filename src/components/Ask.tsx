import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { Modal } from './ui'

type Msg = { who: 'me' | 'ai'; text: string; rows?: { id: string; name: string; uhid: string; detail: string }[] }
const QUICK = ['Diabetic patients with HbA1c above 7', 'Who is due for follow-up this week?', 'Hypertensive patients not seen in 3 months', 'Patients with allergies', 'How many patients today?']

/** Plain-words questions about the clinic's patients, opened from the Patients screen. */
export default function AskDialog({ onClose }: { onClose: () => void }) {
  const [log, setLog] = useState<Msg[]>([]), [q, setQ] = useState(''), [busy, setBusy] = useState(false)
  const ask = async (text: string) => {
    text = text.trim(); if (!text) return
    setLog(l => [...l, { who: 'me' as const, text }].slice(-8)); setQ(''); setBusy(true)
    try { const r = await api<{ answer: string; rows: Msg['rows'] }>('/ask', { body: { q: text } }); setLog(l => [...l, { who: 'ai' as const, text: r.answer, rows: r.rows }].slice(-8)) }
    catch (e: any) { setLog(l => [...l, { who: 'ai' as const, text: e.message }]) } finally { setBusy(false) }
  }
  return <Modal title="Ask Arogya" width={640} onClose={onClose}>
<div className="assistant">
    <form className="q" onSubmit={e => { e.preventDefault(); ask(q) }}><input className="inp" value={q} onChange={e => setQ(e.target.value)} placeholder="Ask about patients, follow-ups or today’s list" /><button className="btn primary" disabled={busy}>Ask</button></form>
    <div className="chips" style={{ marginTop: 10 }}>{QUICK.map(x => <button key={x} className="chip" onClick={() => ask(x)}>{x}</button>)}</div>
    <div className="ans">
      {log.length === 0 && <div className="msg ai">Ask about your patients in plain words, in English or Hindi. Try a suggestion above.</div>}
      {log.map((m, i) => <div key={i} className={'msg ' + m.who}>{m.text}{m.rows && m.rows.length > 0 && <div className="stack tight" style={{ marginTop: 6 }}>{m.rows.map(r => <Link onClick={onClose} key={r.id + r.detail} to={`/patients/${r.id}`}>{r.name} <span className="muted" style={{ fontWeight: 400 }}>· {r.detail}</span></Link>)}</div>}</div>)}
      {busy && <div className="msg ai muted">Looking…</div>}
    </div>
  </div>
  </Modal>
}
