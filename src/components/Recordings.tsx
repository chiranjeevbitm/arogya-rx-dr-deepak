import { api } from '../lib/api'
import { fmtDate, d10, timeAgo } from '../lib/format'
import { useAsync, useToast } from './ui'

type Rec = { id: string; kind: 'consult' | 'intake'; patient_id: string | null; seconds: number | null; bytes: number; transcript: string | null; created_at: string; by_name: string | null; patient_name?: string | null }
const kb = (n: number) => n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`
const len = (s: number | null) => s == null ? '' : s < 60 ? `${Math.round(s)} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`

/** Voice recordings, doctor only: one patient's (patientId) or the clinic's latest. Plays from the private store. */
export default function Recordings({ patientId, limit = 50 }: { patientId?: string; limit?: number }) {
  const toast = useToast()
  const q = useAsync(() => api<{ rows: Rec[]; total: number; total_bytes: number }>(`/recordings?limit=${limit}${patientId ? `&patient_id=${patientId}` : ''}`), [patientId, limit])
  const del = async (r: Rec) => {
    if (!confirm('Delete this recording for good? The words already written stay.')) return
    try { await api(`/recordings/${r.id}`, { method: 'DELETE' }); toast('Recording deleted', 'ok'); q.reload() } catch (e: any) { toast(e.message, 'err') }
  }
  if (q.loading && !q.data) return <p className="small muted">Loading recordings…</p>
  if (q.error) return <p className="small err-text">{q.error}</p>
  const rows = q.data?.rows || []
  if (!rows.length) return <p className="small muted">{patientId ? 'No voice recordings for this patient yet.' : 'No voice recordings yet.'}</p>
  return <div className="stack tight">
    {!patientId && <p className="tiny muted">{q.data!.total} recording{q.data!.total === 1 ? '' : 's'}, {kb(q.data!.total_bytes)} in all.</p>}
    <ul className="recs">{rows.map(r => <li key={r.id}>
      <div className="row wrap small">
        <b>{fmtDate(d10(r.created_at))}</b><span className="muted">{timeAgo(r.created_at)}</span>
        {!patientId && <span>{r.patient_name || (r.kind === 'intake' ? 'New patient (before saving)' : '')}</span>}
        <span className="tag">{r.kind === 'intake' ? 'Patient details' : 'Consult'}</span>
        <span className="muted">{[len(r.seconds), kb(r.bytes), r.by_name].filter(Boolean).join(' · ')}</span>
        <span className="grow" /><button className="btn sm" onClick={() => del(r)} aria-label="Delete recording">Delete</button>
      </div>
      <audio controls preload="none" src={`/api/recordings/${r.id}/audio`} style={{ width: '100%', height: 36 }} />
      {r.transcript && <p className="small muted recs-t">“{r.transcript}”</p>}
    </li>)}</ul>
  </div>
}
