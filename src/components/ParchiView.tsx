import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { useMe } from '../lib/session'
import { ageSex, fmtDate, d10 } from '../lib/format'
import { Modal, Spinner } from './ui'
import Icon from './Icon'
import { ParchiPreview } from './Parchi'

/** Read-only look at a past parchi. Nothing here changes the prescription on screen:
    it is for the doctor who only wants to see what was written last time. */
export function ParchiViewDialog({ rxId, onClose, onReuse }: { rxId: string; onClose: () => void; onReuse?: (medCount: number) => void }) {
  const me = useMe()
  const [b, setB] = useState<any>(null), [err, setErr] = useState('')
  useEffect(() => { let live = true; api<any>(`/rx/${rxId}`).then(x => { if (live) setB(x) }).catch(e => live && setErr(e.message)); return () => { live = false } }, [rxId])
  const final = b?.rx.status === 'final'
  const date = b ? d10(b.rx.rx_date) : ''
  return <Modal title={b ? `Parchi of ${fmtDate(date)}` : 'Parchi'} width={760} onClose={onClose} footer={b ? <>
    <span className="grow small muted">Only being shown. Nothing is copied into the prescription you are writing.</span>
    {onReuse && (b.rx.meds || []).length > 0 && <button className="btn" onClick={() => onReuse(b.rx.meds.length)}><Icon n="copy" />Repeat these medicines</button>}
    <Link className="btn" to={final ? `/rx/${rxId}` : `/opd/${rxId}`} onClick={onClose}>Open it fully</Link>
  </> : undefined}>
    {err ? <div className="empty"><b>Could not open this parchi</b>{err}</div> : !b ? <Spinner /> : <div className="stack tight">
      <p className="small muted" style={{ margin: 0 }}>{b.patient.name}, {ageSex(b.patient)}, {b.patient.uhid}{final ? '' : ' · still a draft'}{b.rx.legacy_id ? ' · imported from the old app' : ''}</p>
      <div className="paper-scroll" style={{ maxHeight: '62vh' }}>
        <ParchiPreview s={me.clinic.settings} patient={b.patient} data={b.rx.data || {}} meds={b.rx.meds || []} date={date} draft={!final} token={b.visit?.token} />
      </div>
    </div>}
  </Modal>
}

/** One chip per earlier parchi; tapping it only shows that parchi. */
export function PreviousParchis({ items, exclude, onOpen, limit = 6 }: { items: { id: string; rx_date: string; status?: string }[]; exclude?: string; onOpen: (id: string) => void; limit?: number }) {
  const list = items.filter(p => p.id !== exclude).slice(0, limit)
  if (!list.length) return null
  return <div className="chips" aria-label="Previous parchis">
    <span className="lbl" style={{ alignSelf: 'center' }}>Previous parchi</span>
    {list.map(p => <button key={p.id} type="button" className="chip" title="Show this parchi (nothing is copied)" onClick={() => onOpen(p.id)}><Icon n="file" />{fmtDate(d10(p.rx_date))}{p.status && p.status !== 'final' ? ' · draft' : ''}</button>)}
  </div>
}
