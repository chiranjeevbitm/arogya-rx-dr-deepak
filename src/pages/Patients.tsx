import { useEffect, useState } from 'react'
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
  return <div className="stack">
    <div className="page-h"><div className="grow"><h1>Patients</h1><p>Search by name, OP number, mobile or condition.</p></div><button className="btn" onClick={() => setAsking(true)}>✦ Ask Arogya</button><button className="btn primary" onClick={() => setAdding(true)}><Icon n="plus" />New patient</button></div>
    <div className="pview">
      <div className="plist">
        <input className="inp" placeholder="e.g. Ramesh, AC-00012, 98xxxx" value={q} onChange={e => setQ(e.target.value)} aria-label="Search patients" />
        <div className="plist-h">
          <span className="small" aria-live="polite">{q.trim() ? (list ? `${list.length}${list.length === 30 ? '+' : ''} match${list.length === 1 ? '' : 'es'}` : 'Searching…') : total == null ? 'Loading…' : <><b>{total.toLocaleString('en-IN')}</b> patient{total === 1 ? '' : 's'}{list && list.length < total ? `, showing ${list.length}` : ''}</>}</span>
          {!q.trim() && <select className="inp sm" value={sort} onChange={e => pickSort(e.target.value as Sort)} aria-label="Sort patients">
            <option value="visit">Last visit</option><option value="name">Name A–Z</option><option value="new">Newest added</option></select>}
        </div>
        {err && <div className="alert warn small">{err}</div>}
        {!list && !err && Array.from({ length: 6 }, (_, i) => <div key={i} className="q-item skel" aria-hidden="true"><span className="q-tok" /><span><span className="sk-line" /><span className="sk-line short" /></span></div>)}
        {list && list.length === 0 && <div className="empty small">{q.trim() ? 'No match.' : 'No patients yet.'}</div>}
        {list?.map(x => <button key={x.id} className={'q-item' + (x.id === id ? ' on' : '')} onClick={() => nav(`/patients/${x.id}`)}>
          <span className="q-tok" style={{ fontFamily: 'var(--f-ui)', fontSize: 13 }}>{x.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}</span>
          <span style={{ minWidth: 0 }}><span className="q-name">{x.name}</span><span className="q-sub">{x.uhid} · {x.age_years ?? ''}{x.sex || ''}{x.last_visit ? ` · last ${fmtDate(d10(x.last_visit))}` : ''}{x.visit_count ? ` · ${x.visit_count} visit${x.visit_count > 1 ? 's' : ''}` : ''}{x.conditions?.length ? ' · ' + x.conditions.join(', ') : ''}</span></span>
        </button>)}
        {!q.trim() && list && total != null && list.length < total && <button className="btn sm" onClick={loadMore} disabled={more}>{more ? 'Loading…' : `Show ${Math.min(PAGE, total - list.length)} more`}</button>}
      </div>
      <div className="card">{id ? <PatientPage key={id} id={id} /> : <div className="empty">Choose a patient.</div>}</div>
    </div>
    {asking && <AskDialog onClose={() => setAsking(false)} />}
    {adding && <Modal title="New patient" width={620} onClose={() => setAdding(false)} footer={<><button className="btn" onClick={() => setAdding(false)}>Cancel</button><button className="btn primary" disabled={!np || np.name.trim().length < 2} onClick={create}>Save patient</button></>}>
      <PatientPicker onPick={p => { setAdding(false); nav(`/patients/${p.id}`) }} onNew={setNp} />
    </Modal>}
  </div>
}
