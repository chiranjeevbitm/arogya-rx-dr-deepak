import { useCallback, useEffect, useRef, useState } from 'react'
import { fmtDate, d10 } from '../lib/format'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../lib/api'
import { Modal, useToast } from '../components/ui'
import Icon from '../components/Icon'
import { PatientPicker, type Patient, type NewPatient } from '../components/PatientPicker'
import PatientPage from './PatientPage'
import AskDialog from '../components/Ask'

type Row = Patient & { visit_count?: number }
type Page = { rows: Row[]; total: number }
type Sort = 'visit' | 'name' | 'new'

export default function Patients() {
  const { id } = useParams(), nav = useNavigate(), toast = useToast()
  const [q, setQ] = useState(''), [list, setList] = useState<Row[] | null>(null), [adding, setAdding] = useState(false), [asking, setAsking] = useState(false), [np, setNp] = useState<NewPatient | null>(null)
  const [sort, setSort] = useState<Sort>(() => { try { return (localStorage.getItem('arx.psort') as Sort) || 'visit' } catch { return 'visit' } })
  const [total, setTotal] = useState<number | null>(null), [more, setMore] = useState(false), [err, setErr] = useState<string | null>(null)
  const PAGE = 60
  // no search: the whole list, a page at a time, with the total. With a search: the best 30 matches.
  useEffect(() => {
    const ac = new AbortController(); setErr(null)
    const t = setTimeout(() => {
      const go = q.trim()
        ? api<Row[]>('/patients?q=' + encodeURIComponent(q), { signal: ac.signal }).then(r => { setList(r); setTotal(null) })
        : api<Page>(`/patients/browse?sort=${sort}&limit=${PAGE}&offset=0`, { signal: ac.signal }).then(r => { setList(r.rows); setTotal(r.total) })
      go.catch(e => { if (e?.name !== 'AbortError') setErr(e.message) })
    }, q.trim() ? 200 : 0)
    return () => { clearTimeout(t); ac.abort() }
  }, [q, sort])
  const loadMore = async () => {
    if (!list) return; setMore(true)
    try { const r = await api<Page>(`/patients/browse?sort=${sort}&limit=${PAGE}&offset=${list.length}`); setList([...list, ...r.rows.filter(x => !list.some(y => y.id === x.id))]); setTotal(r.total) } catch (e: any) { toast(e.message, 'err') } finally { setMore(false) }
  }
  const pickSort = (v: Sort) => { setSort(v); setList(null); try { localStorage.setItem('arx.psort', v) } catch { /* private mode */ } }
  useEffect(() => { if (!id && list?.length && window.innerWidth > 900) nav(`/patients/${list[0].id}`, { replace: true }) }, [id, list]) // eslint-disable-line
  const create = async () => { try { const p = await api<Patient>('/patients', { body: { ...np, phone: np!.phone || null, address: np!.address || null } }); setAdding(false); nav(`/patients/${p.id}`) } catch (e: any) { toast(e.message, 'err') } }
  // Switching between patients replaces the address instead of adding to it, so Back leaves the Patients page
  // (to OPD, Schedule, wherever the doctor came from) instead of stepping through every patient looked at.
  const open = (pid: string) => nav(`/patients/${pid}`, { replace: !!id })
  const back = () => { if ((window.history.state?.idx ?? 0) > 0) nav(-1); else nav('/opd') }

  // the horizontal strip: arrows appear only when there is more to see that way; the mouse wheel scrolls it sideways
  const strip = useRef<HTMLDivElement>(null)
  const [edge, setEdge] = useState({ l: false, r: false })
  const hasMore = !q.trim() && !!list && total != null && list.length < total
  const measure = useCallback(() => {
    const el = strip.current; if (!el) return
    setEdge({ l: el.scrollLeft > 4, r: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 })
    if (hasMore && !more && el.scrollLeft + el.clientWidth > el.scrollWidth - 400) loadMore()
  }, [hasMore, more, list]) // eslint-disable-line
  useEffect(() => {
    const el = strip.current; measure(); if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => measure()); ro.observe(el); return () => ro.disconnect()
  }, [measure, id])
  useEffect(() => {
    const el = strip.current; if (!el) return
    const wheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || !e.deltaY) return
      const canGo = e.deltaY > 0 ? el.scrollLeft + el.clientWidth < el.scrollWidth - 1 : el.scrollLeft > 0
      if (!canGo) return   // at either end the page scrolls as usual
      e.preventDefault(); el.scrollLeft += e.deltaY
    }
    el.addEventListener('wheel', wheel, { passive: false }); return () => el.removeEventListener('wheel', wheel)
  }, [list])
  // keep the open patient's card in view
  useEffect(() => { strip.current?.querySelector<HTMLElement>('.q-item.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' }) }, [id, list])
  const slide = (dir: 1 | -1) => { const el = strip.current; if (el) el.scrollBy({ left: dir * Math.max(240, el.clientWidth * 0.8), behavior: 'smooth' }) }

  return <div className="stack">
    <div className="page-h pat-h">
      <button type="button" className="btn back-btn" onClick={back} title="Go back" aria-label="Go back"><Icon n="back" /><span>Back</span></button>
      <div className="grow"><h1>Patients</h1><p>Search by name, OP number, mobile or condition.</p></div>
      <button className="btn" onClick={() => setAsking(true)}>✦ Ask Arogya</button><button className="btn primary" onClick={() => setAdding(true)}><Icon n="plus" />New patient</button>
    </div>
    <section className="card ptool">
      <div className="ptool-row">
        <label className="psearch"><Icon n="search" /><input className="inp" placeholder="e.g. Ramesh, AC-00012, 98xxxx" value={q} onChange={e => setQ(e.target.value)} aria-label="Search patients" />
          {q && <button type="button" className="icon-btn" onClick={() => setQ('')} aria-label="Clear search"><Icon n="x" /></button>}</label>
        <span className="small pcount" aria-live="polite">{q.trim() ? (list ? `${list.length}${list.length === 30 ? '+' : ''} match${list.length === 1 ? '' : 'es'}` : 'Searching…') : total == null ? 'Loading…' : <><b>{total.toLocaleString('en-IN')}</b> patient{total === 1 ? '' : 's'}{list && list.length < total ? `, showing ${list.length}` : ''}</>}</span>
        {!q.trim() && <select className="inp sm" value={sort} onChange={e => pickSort(e.target.value as Sort)} aria-label="Sort patients">
          <option value="visit">Last visit</option><option value="name">Name A–Z</option><option value="new">Newest added</option></select>}
      </div>
      {err && <div className="alert warn small">{err}</div>}
      <div className={'pstrip-wrap' + (id ? '' : ' all')}>
        {edge.l && <button type="button" className="pstrip-arrow l" onClick={() => slide(-1)} aria-label="Earlier patients"><Icon n="back" /></button>}
        <div className="pstrip" ref={strip} onScroll={measure} role="list">
          {!list && !err && Array.from({ length: 6 }, (_, i) => <div key={i} className="q-item skel" aria-hidden="true"><span className="q-tok" /><span><span className="sk-line" /><span className="sk-line short" /></span></div>)}
          {list && list.length === 0 && <div className="empty small">{q.trim() ? 'No match.' : 'No patients yet.'}</div>}
          {list?.map(x => <button key={x.id} role="listitem" className={'q-item' + (x.id === id ? ' on' : '')} aria-current={x.id === id ? 'true' : undefined} onClick={() => open(x.id)}
            title={[x.name, x.uhid, x.last_visit ? 'last visit ' + fmtDate(d10(x.last_visit)) : '', x.conditions?.join(', ')].filter(Boolean).join(' · ')}>
            <span className="q-tok" style={{ fontFamily: 'var(--f-ui)', fontSize: 13 }}>{x.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}</span>
            <span style={{ minWidth: 0 }}><span className="q-name">{x.name}</span><span className="q-sub">{x.uhid} · {x.age_years ?? ''}{x.sex || ''}{x.last_visit ? ` · ${fmtDate(d10(x.last_visit)).replace(/\/\d{2}(\d{2})$/, '/$1')}` : ''}</span>
              {(x.visit_count || x.conditions?.length) ? <span className="q-sub">{[x.visit_count ? `${x.visit_count} visit${x.visit_count > 1 ? 's' : ''}` : '', x.conditions?.join(', ')].filter(Boolean).join(' · ')}</span> : null}</span>
          </button>)}
          {hasMore && <button type="button" className="q-item q-more" onClick={loadMore} disabled={more}>{more ? 'Loading…' : `Show ${Math.min(PAGE, total! - list!.length)} more`}</button>}
        </div>
        {edge.r && <button type="button" className="pstrip-arrow r" onClick={() => slide(1)} aria-label="More patients"><Icon n="next" /></button>}
      </div>
    </section>
    <div className="card">{id ? <PatientPage key={id} id={id} /> : <div className="empty">Choose a patient above.</div>}</div>
    {asking && <AskDialog onClose={() => setAsking(false)} />}
    {adding && <Modal title="New patient" width={620} onClose={() => setAdding(false)} footer={<><button className="btn" onClick={() => setAdding(false)}>Cancel</button><button className="btn primary" disabled={!np || np.name.trim().length < 2} onClick={create}>Save patient</button></>}>
      <PatientPicker onPick={p => { setAdding(false); nav(`/patients/${p.id}`) }} onNew={setNp} />
    </Modal>}
  </div>
}
