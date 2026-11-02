import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { istToday } from '../lib/format'
import { useAsync } from '../components/ui'
import Icon from '../components/Icon'

/* Dashboard: its own page. Month-wise visits and patients, and a breakdown of the chosen month.
   Laid out on Microsoft Fluent 2 lines: a command bar, a row of KPI cards, then cards on a 12-column grid;
   4 px spacing steps, 8 px card corners, shadow2 at rest and shadow8 on hover, Fluent motion curves
   (decelerate in, accelerate out) and durations, skeletons while loading, prefers-reduced-motion respected.
   Plain SVG and CSS, no chart library. No money figures are shown anywhere on this page. */

type MonthRow = { m: string; visits: number; new_visits: number; repeat_visits: number; patients: number; days: number; new_patients: number; prescriptions: number }
type Overview = { months: MonthRow[]; totals: { patients: number; visits: number; since: string | null } }
type Detail = {
  month: string; daily: { d: string; n: number; new_n: number }[]; sex: { k: string; n: number }[]; age: { k: string; n: number }[]
  places: { k: string; n: number }[]; session: { k: string; n: number }[]; weekday: { k: number; n: number }[]; diagnoses: { k: string; n: number }[]
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const monthLabel = (m: string, long = false) => { const [y, mo] = m.split('-').map(Number); return long ? `${MON[mo - 1]} ${y}` : `${MON[mo - 1]} ’${String(y).slice(2)}` }
const prevMonth = (m: string) => { const [y, mo] = m.split('-').map(Number); return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}` }
const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
const fmt = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 1 })
/* series colours: the clinic's ink blue first, then Fluent shared colours (pink, teal, orange, purple, grey) */
const SERIES = ['#1626B8', '#E3008C', '#038387', '#CA5010', '#8764B8', '#8A8886']

/** Counts up to the number the first time it appears and again when it changes (Fluent decelerate, 500 ms). */
function useCountUp(target: number, ms = 500) {
  const [v, setV] = useState(0), from = useRef(0)
  useEffect(() => {
    if (reduced()) { setV(target); from.current = target; return }
    let raf = 0; const t0 = performance.now(), a = from.current
    const tick = (t: number) => { const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 4); setV(a + (target - a) * e); if (k < 1) raf = requestAnimationFrame(tick); else from.current = target }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, ms])
  return v
}

/** True two frames after mount (or after `key` changes), so CSS transitions have a starting point. */
function useMounted(key?: unknown) {
  const [on, setOn] = useState(false)
  useEffect(() => { setOn(false); let r2 = 0; const r = requestAnimationFrame(() => { r2 = requestAnimationFrame(() => setOn(true)) }); return () => { cancelAnimationFrame(r); cancelAnimationFrame(r2) } }, [key])
  return on
}

/* ---------- building blocks ---------- */
function Card({ title, sub, action, span = 4, children, i = 0 }: { title: string; sub?: React.ReactNode; action?: React.ReactNode; span?: number; children: React.ReactNode; i?: number }) {
  return <section className={`fl-card s${span}`} style={{ animationDelay: `${120 + i * 50}ms` }}>
    <header className="fl-card-h"><div className="grow"><h3>{title}</h3>{sub && <p>{sub}</p>}</div>{action}</header>
    {children}
  </section>
}

function Skel({ h = 160 }: { h?: number }) { return <div className="fl-skel" style={{ height: h }} aria-hidden="true" /> }

function Badge({ tone, children }: { tone: 'up' | 'down' | 'flat'; children: React.ReactNode }) {
  return <span className={'fl-badge ' + tone}>{tone === 'up' ? '▲' : tone === 'down' ? '▼' : ''}{tone !== 'flat' && ' '}{children}</span>
}

function Spark({ values, sel }: { values: number[]; sel: number }) {
  const on = useMounted(values.join())
  if (values.length < 2) return null
  const W = 120, H = 32, max = Math.max(1, ...values), x = (i: number) => (i / (values.length - 1)) * W, y = (v: number) => H - 3 - (v / max) * (H - 6)
  const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  return <svg className="fl-spark" viewBox={`0 0 ${W} ${H}`} aria-hidden="true" preserveAspectRatio="none">
    <path d={`${line} L${W},${H} L0,${H} Z`} className="a" style={{ opacity: on ? 1 : 0 }} />
    <path d={line} pathLength={1} className="l" style={{ strokeDashoffset: on ? 0 : 1 }} />
    {sel >= 0 && <circle cx={x(sel)} cy={y(values[sel])} r="2.6" className="p" style={{ opacity: on ? 1 : 0 }} />}
  </svg>
}

function Kpi({ icon, label, value, suffix = '', decimals = 0, delta, foot, spark, sel, to, i }: { icon: string; label: string; value: number; suffix?: string; decimals?: number; delta?: { tone: 'up' | 'down' | 'flat'; text: string } | null; foot?: React.ReactNode; spark?: number[]; sel?: number; to?: string; i: number }) {
  const n = useCountUp(value), shown = decimals ? n.toFixed(decimals) : Math.round(n).toLocaleString('en-IN')
  const body = <>
    <div className="fl-kpi-top"><span className="fl-ic"><Icon n={icon} size={16} /></span><span className="fl-kpi-l">{label}</span>{to && <span className="fl-go" aria-hidden="true">›</span>}</div>
    <div className="fl-kpi-v"><b>{shown}{suffix}</b>{delta && <Badge tone={delta.tone}>{delta.text}</Badge>}</div>
    <div className="fl-kpi-f"><span className="grow">{foot}</span>{spark && <Spark values={spark} sel={sel ?? -1} />}</div>
  </>
  return to ? <Link to={to} className="fl-kpi link" style={{ animationDelay: `${i * 50}ms` }}>{body}</Link> : <div className="fl-kpi" style={{ animationDelay: `${i * 50}ms` }}>{body}</div>
}

/* ---------- month-wise columns (click one to choose the month) ---------- */
type Metric = 'visits' | 'patients' | 'new_patients'
function MonthBars({ months, metric, sel, onSel }: { months: MonthRow[]; metric: Metric; sel: string; onSel: (m: string) => void }) {
  const [hover, setHover] = useState<number | null>(null), on = useMounted(metric + months.length)
  const W = 720, H = 250, L = 36, R = 8, T = 18, B = 30, iw = W - L - R, ih = H - T - B, bw = iw / months.length
  const top = (m: MonthRow) => metric === 'visits' ? m.visits : metric === 'patients' ? m.patients : m.new_patients
  const max = Math.max(4, ...months.map(top)), nice = max <= 8 ? 2 : max <= 20 ? 5 : max <= 60 ? 10 : max <= 200 ? 25 : 100
  const ceil = Math.ceil(max / nice) * nice, y = (v: number) => T + ih - (v / ceil) * ih
  const ticks = Array.from({ length: ceil / nice + 1 }, (_, i) => i * nice)
  const h = hover != null ? months[hover] : null
  return <div className="fl-chart">
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Visits by month. Select a column to see that month." onMouseLeave={() => setHover(null)}>
      {ticks.map(t => <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className={t ? 'grid' : 'base'} /><text x={L - 8} y={y(t) + 4} textAnchor="end" className="axis">{t}</text></g>)}
      {months.map((m, i) => {
        const w = Math.min(34, bw * .56), x = L + i * bw + (bw - w) / 2
        const a = metric === 'visits' ? m.repeat_visits : top(m), b = metric === 'visits' ? m.new_visits : 0
        const hA = (a / ceil) * ih, hB = (b / ceil) * ih, isSel = m.m === sel
        return <g key={m.m} className={'col' + (isSel ? ' sel' : '') + (hover === i ? ' hov' : '') + (hover != null && hover !== i ? ' dim' : '')}
          onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} onClick={() => onSel(m.m)}
          tabIndex={0} role="button" aria-label={`${monthLabel(m.m, true)}: ${top(m)}`} aria-pressed={isSel}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSel(m.m) } }}>
          <rect x={L + i * bw + 2} y={T - 6} width={bw - 4} height={ih + B} rx="4" className="hit" />
          <g className="grow-y" style={{ transform: on ? 'scaleY(1)' : 'scaleY(0)', transformOrigin: `0 ${T + ih}px`, transitionDelay: `${i * 30}ms` }}>
            <rect x={x} y={T + ih - hA} width={w} height={Math.max(0, hA)} rx="2" className={metric === 'visits' ? 's2' : 's1'} />
            {metric === 'visits' && b > 0 && <rect x={x} y={T + ih - hA - hB} width={w} height={hB} rx="2" className="s1" />}
          </g>
          {top(m) > 0 && <text x={x + w / 2} y={y(top(m)) - 6} textAnchor="middle" className="val" style={{ opacity: on ? 1 : 0, transitionDelay: `${250 + i * 30}ms` }}>{top(m)}</text>}
          <text x={x + w / 2} y={H - 9} textAnchor="middle" className={'axis' + (isSel ? ' on' : '')}>{monthLabel(m.m).split(' ')[0]}</text>
        </g>
      })}
    </svg>
    {h && <div className="fl-tip" style={{ left: `${Math.min(84, Math.max(16, ((L + (hover! + .5) * bw) / W) * 100))}%` }} role="status">
      <b>{monthLabel(h.m, true)}</b>
      <span><i className="sw s1" />{h.new_visits} first visits</span><span><i className="sw s2" />{h.repeat_visits} repeat visits</span>
      <span className="muted">{h.patients} patients · {h.new_patients} new · {h.days} clinic days</span></div>}
    <div className="fl-legend">{metric === 'visits' ? <><span><i className="sw s1" />First visit</span><span><i className="sw s2" />Repeat visit</span></> : <span><i className="sw s1" />{metric === 'patients' ? 'Different patients seen' : 'Patients seen for the first time'}</span>}<span className="grow" /><span className="muted">Select a column to open that month</span></div>
  </div>
}

/* ---------- day by day area for the chosen month ---------- */
function DayLine({ month, daily }: { month: string; daily: Detail['daily'] }) {
  const [hover, setHover] = useState<number | null>(null), on = useMounted(month)
  const [y0, m0] = month.split('-').map(Number), days = new Date(y0, m0, 0).getDate()
  const today = istToday(), n = month === today.slice(0, 7) ? Math.max(2, Number(today.slice(8))) : days   // this month: stop at today
  const pts = Array.from({ length: n }, (_, i) => { const d = `${month}-${String(i + 1).padStart(2, '0')}`; const r = daily.find(x => x.d === d); return { day: i + 1, n: r?.n ?? 0, nw: r?.new_n ?? 0 } })
  const W = 720, H = 210, L = 32, R = 10, T = 16, B = 26, iw = W - L - R, ih = H - T - B
  const max = Math.max(3, ...pts.map(p => p.n)), x = (i: number) => L + (i / Math.max(1, n - 1)) * iw, y = (v: number) => T + ih - (v / max) * ih
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.n).toFixed(1)}`).join(' ')
  const svg = useRef<SVGSVGElement>(null)
  const move = (e: React.PointerEvent) => { const r = svg.current!.getBoundingClientRect(), px = ((e.clientX - r.left) / r.width) * W; setHover(Math.max(0, Math.min(n - 1, Math.round(((px - L) / iw) * (n - 1))))) }
  const hp = hover != null ? pts[hover] : null
  return <div className="fl-chart">
    <svg ref={svg} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Visits per day in ${monthLabel(month, true)}`} onPointerMove={move} onPointerLeave={() => setHover(null)}>
      <defs><linearGradient id="fl-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#1626B8" stopOpacity=".22" /><stop offset="1" stopColor="#1626B8" stopOpacity="0" /></linearGradient></defs>
      {[0, Math.ceil(max / 2), max].map((t, i) => <g key={i}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className={t ? 'grid' : 'base'} /><text x={L - 8} y={y(t) + 4} textAnchor="end" className="axis">{t}</text></g>)}
      <path d={`${line} L${x(n - 1)},${T + ih} L${x(0)},${T + ih} Z`} fill="url(#fl-area)" className="fade" style={{ opacity: on ? 1 : 0 }} />
      <path d={line} pathLength={1} className="ln" style={{ strokeDashoffset: on ? 0 : 1 }} />
      {hp && <line x1={x(hover!)} x2={x(hover!)} y1={T} y2={T + ih} className="cross" />}
      {pts.map((p, i) => p.n > 0 && <circle key={i} cx={x(i)} cy={y(p.n)} r={hover === i ? 5 : 3} className="dot" style={{ opacity: on ? 1 : 0, transitionDelay: `${300 + i * 12}ms` }} />)}
      {[1, 8, 15, 22, n].filter((v, i, a) => v <= n && a.indexOf(v) === i).map(d => <text key={d} x={x(d - 1)} y={H - 7} textAnchor="middle" className="axis">{d}</text>)}
    </svg>
    {hp && <div className="fl-tip" style={{ left: `${Math.min(88, Math.max(12, (x(hover!) / W) * 100))}%` }} role="status"><b>{hp.day} {MON[m0 - 1]}, {DAYS[(new Date(y0, m0 - 1, hp.day).getDay() + 6) % 7]}</b><span>{hp.n === 0 ? 'No visits' : `${hp.n} visit${hp.n > 1 ? 's' : ''}${hp.nw ? `, ${hp.nw} first-time` : ''}`}</span></div>}
  </div>
}

/* ---------- donut with legend ---------- */
function Donut({ items, label }: { items: { k: string; n: number }[]; label: string }) {
  const [hover, setHover] = useState<number | null>(null), on = useMounted(items.map(i => i.k + i.n).join())
  const total = items.reduce((a, b) => a + b.n, 0), r = 44, C = 2 * Math.PI * r
  const h = hover != null ? items[hover] : null, num = Math.round(useCountUp(h ? h.n : total))
  if (!total) return <div className="fl-empty">No visits this month.</div>
  let acc = 0
  return <div className="fl-donut">
    <svg viewBox="0 0 120 120" role="img" aria-label={label} onMouseLeave={() => setHover(null)}>
      <circle cx="60" cy="60" r={r} className="track" />
      {items.map((it, i) => {
        const len = (it.n / total) * C, off = -acc; acc += len
        return <circle key={it.k} cx="60" cy="60" r={r} fill="none" stroke={SERIES[i % SERIES.length]} strokeWidth={hover === i ? 16 : 12} className="seg"
          strokeDasharray={`${on ? Math.max(0, len - 1.5) : 0} ${C}`} strokeDashoffset={off} transform="rotate(-90 60 60)" style={{ transitionDelay: `${i * 80}ms`, opacity: hover != null && hover !== i ? .35 : 1 }}
          onMouseEnter={() => setHover(i)}><title>{it.k}: {it.n}</title></circle>
      })}
      <text x="60" y="59" textAnchor="middle" className="num">{num}</text>
      <text x="60" y="74" textAnchor="middle" className="lab">{h ? `${Math.round((h.n / total) * 100)}% · ${h.k}` : 'visits'}</text>
    </svg>
    <ul>{items.map((it, i) => <li key={it.k} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} className={hover === i ? 'on' : ''}><i style={{ background: SERIES[i % SERIES.length] }} /><span className="grow">{it.k}</span><b>{it.n}</b><small>{Math.round((it.n / total) * 100)}%</small></li>)}</ul>
  </div>
}

/* ---------- horizontal bars ---------- */
function HBars({ items, color = SERIES[0], empty }: { items: { k: string; n: number }[]; color?: string; empty: string }) {
  const on = useMounted(items.map(i => i.k + i.n).join()), max = Math.max(1, ...items.map(i => i.n)), total = items.reduce((a, b) => a + b.n, 0)
  if (!items.length) return <div className="fl-empty">{empty}</div>
  return <ul className="fl-hbars">{items.map((it, i) => <li key={it.k} title={`${it.k}: ${it.n}`}>
    <span className="l">{it.k}</span><span className="t"><span className="f" style={{ width: on ? `${(it.n / max) * 100}%` : '0%', background: color, transitionDelay: `${i * 50}ms` }} /></span><b>{it.n}</b><small>{total ? Math.round((it.n / total) * 100) : 0}%</small></li>)}</ul>
}

/* ---------- weekday columns ---------- */
function Weekdays({ rows }: { rows: Detail['weekday'] }) {
  const on = useMounted(rows.map(r => r.n).join()), [hover, setHover] = useState<number | null>(null)
  const by = new Map(rows.map(r => [r.k, r.n])), vals = DAYS.map((_, i) => by.get(i + 1) ?? 0), max = Math.max(1, ...vals), best = vals.indexOf(Math.max(...vals))
  return <div className="fl-wk">{DAYS.map((nm, i) => <div key={nm} className={'c' + (hover === i ? ' on' : '') + (i === best && vals[i] > 0 ? ' best' : '')} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} title={`${nm}: ${vals[i]}`}>
    <b>{vals[i]}</b><span className="bar"><span style={{ height: on ? `${(vals[i] / max) * 100}%` : '0%', transitionDelay: `${i * 40}ms` }} /></span><small>{nm}</small></div>)}</div>
}

/* ---------- plain-language notes about the chosen month ---------- */
function Insights({ month, cur, d, sessItems, prev }: { month: string; cur: MonthRow; d: Detail; sessItems: { k: string; n: number }[]; prev?: MonthRow }) {
  const [y0, m0] = month.split('-').map(Number)
  const busiest = [...d.daily].sort((a, b) => b.n - a.n)[0]
  const wk = [...d.weekday].sort((a, b) => b.n - a.n)[0]
  const place = d.places[0], newShare = cur.visits ? Math.round((cur.new_visits / cur.visits) * 100) : 0
  const sess = sessItems.filter(s => s.k !== 'Not noted').sort((a, b) => b.n - a.n)[0]
  const rows: { icon: string; text: React.ReactNode }[] = []
  if (busiest) rows.push({ icon: 'cal', text: <>Busiest day was <b>{Number(busiest.d.slice(8))} {MON[m0 - 1]}</b> with {busiest.n} visit{busiest.n > 1 ? 's' : ''}.</> })
  if (wk && wk.n) rows.push({ icon: 'today', text: <><b>{DAYS[wk.k - 1]}</b> is the busiest day of the week this month ({wk.n} visits).</> })
  rows.push({ icon: 'users', text: <><b>{newShare}%</b> of visits were first visits; {cur.new_patients} patient{cur.new_patients === 1 ? ' was' : 's were'} seen for the first time ever.</> })
  if (sess) rows.push({ icon: 'queue', text: <>Most patients came in the <b>{sess.k.toLowerCase()}</b> ({sess.n} visits).</> })
  if (place) rows.push({ icon: 'home', text: <>Most patients came from <b>{place.k}</b> ({place.n} visits).</> })
  if (prev && prev.visits && cur.days && prev.days) { const a = cur.visits / cur.days, b = prev.visits / prev.days; rows.push({ icon: 'chart', text: <>Average of <b>{fmt(Math.round(a * 10) / 10)}</b> patients per clinic day, {a >= b ? 'up' : 'down'} from {fmt(Math.round(b * 10) / 10)} in {monthLabel(prev.m, true)}.</> }) }
  return <ul className="fl-insights">{rows.map((r, i) => <li key={i} style={{ animationDelay: `${i * 60}ms` }}><span className="fl-ic"><Icon n={r.icon} size={15} /></span><span>{r.text}</span></li>)}</ul>
}

export default function Dashboard() {
  const ov = useAsync(() => api<Overview>('/clinic/dashboard'), [], 'dash')
  const [metric, setMetric] = useState<Metric>('visits'), [selected, setSel] = useState<string | null>(null)
  const nowM = istToday().slice(0, 7)
  const months = useMemo(() => {
    const by = new Map((ov.data?.months || []).map(m => [m.m, m])), out: MonthRow[] = []
    let m = nowM; for (let i = 0; i < 12; i++) { out.unshift(by.get(m) || { m, visits: 0, new_visits: 0, repeat_visits: 0, patients: 0, days: 0, new_patients: 0, prescriptions: 0 }); m = prevMonth(m) }
    const first = out.findIndex(x => x.visits > 0)
    return first < 0 ? out.slice(-6) : out.slice(Math.min(first, out.length - 6))   // no long run of empty months before the first record
  }, [ov.data, nowM])
  // default: the latest month with visits; in the first week of a month, the month before (a fuller picture)
  const lastWith = [...months].reverse().find(m => m.visits > 0)?.m
  const early = Number(istToday().slice(8)) <= 7 && lastWith === nowM && months.some(m => m.m === prevMonth(nowM) && m.visits > 0)
  const sel = selected || (early ? prevMonth(nowM) : lastWith) || nowM
  const detail = useAsync(() => api<Detail>('/clinic/dashboard?month=' + sel), [sel], 'dash-' + sel)
  const idx = months.findIndex(m => m.m === sel)
  const cur = months[idx] || months[months.length - 1], prev = idx > 0 ? months[idx - 1] : undefined
  const d = detail.data && detail.data.month === sel ? detail.data : null
  const partial = sel === nowM

  const head = <div className="fl-bar">
    <div className="grow"><h1>Dashboard</h1><p>{ov.data?.totals.since ? `OPD activity since ${new Date(ov.data.totals.since).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}` : 'OPD activity, month by month'}</p></div>
    <div className="fl-cmd" role="toolbar" aria-label="Choose month">
      <button type="button" className="fl-btn icon" disabled={idx <= 0} onClick={() => setSel(months[idx - 1].m)} aria-label="Previous month">‹</button>
      <select className="fl-select" value={sel} onChange={e => setSel(e.target.value)} aria-label="Month">{[...months].reverse().map(m => <option key={m.m} value={m.m}>{monthLabel(m.m, true)}{m.m === nowM ? ' (this month)' : ''}</option>)}</select>
      <button type="button" className="fl-btn icon" disabled={idx < 0 || idx >= months.length - 1} onClick={() => setSel(months[idx + 1].m)} aria-label="Next month">›</button>
      <button type="button" className="fl-btn" onClick={() => { ov.reload(); detail.reload() }} disabled={ov.loading || detail.loading}><Icon n="refresh" size={15} />{ov.loading || detail.loading ? 'Refreshing…' : 'Refresh'}</button>
    </div>
  </div>

  if (ov.loading && !ov.data) return <div className="fl-dash" aria-busy="true">{head}
    <div className="fl-kpis">{Array.from({ length: 5 }, (_, i) => <div key={i} className="fl-kpi"><Skel h={84} /></div>)}</div>
    <div className="fl-grid"><section className="fl-card s8"><Skel h={260} /></section><section className="fl-card s4"><Skel h={260} /></section></div></div>
  if (ov.error && !ov.data) return <div className="fl-dash">{head}<div className="fl-msg warn"><b>The dashboard could not load.</b> {ov.error} <button className="fl-btn" onClick={ov.reload}>Try again</button></div></div>
  if (!ov.data?.totals.visits) return <div className="fl-dash">{head}<section className="fl-card s12"><div className="fl-empty big"><b>No visits recorded yet</b>The dashboard fills in as patients are seen in OPD &amp; Rx.</div></section></div>

  const series = (f: (m: MonthRow) => number) => months.map(f)
  const pct = (a: number, b: number) => Math.round(((a - b) / b) * 100)
  const deltaOf = (a: number, b: number | undefined, unit = '%') => partial ? { tone: 'flat' as const, text: 'month so far' } : b == null || b === 0 ? null : unit === 'pt' ? { tone: a >= b ? 'up' as const : 'down' as const, text: `${Math.abs(a - b)} pts` } : { tone: a >= b ? 'up' as const : 'down' as const, text: `${Math.abs(pct(a, b))}%` }
  const repeatPct = (m?: MonthRow) => m && m.visits ? Math.round((m.repeat_visits / m.visits) * 100) : 0
  const perDay = (m?: MonthRow) => m && m.days ? Math.round((m.visits / m.days) * 10) / 10 : 0
  const vs = prev ? `vs ${monthLabel(prev.m)}` : ''
  const sexItems = (d?.sex || []).map(x => ({ k: x.k === 'M' ? 'Male' : x.k === 'F' ? 'Female' : x.k === 'O' ? 'Other' : 'Not noted', n: x.n })).sort((a, b) => b.n - a.n)
  const ageOrder = ['0-12', '13-30', '31-45', '46-60', '60+', 'Not noted'], ageItems = ageOrder.map(k => ({ k: k === 'Not noted' ? k : k + ' yrs', n: d?.age.find(a => a.k === k)?.n ?? 0 })).filter(a => a.n > 0)
  const sessItems = (d?.session || []).map(x => ({ k: x.k === 'am' ? 'Morning' : x.k === 'pm' ? 'Evening' : 'Not noted', n: x.n })).sort((a, b) => b.n - a.n)

  return <div className="fl-dash">
    {head}
    <div className="fl-kpis">
      <Kpi i={0} icon="users" label="All patients" value={ov.data.totals.patients} foot={<>{ov.data.totals.visits.toLocaleString('en-IN')} visits in all</>} to="/patients" />
      <Kpi i={1} icon="queue" label={`Visits, ${monthLabel(sel, true)}`} value={cur.visits} delta={deltaOf(cur.visits, prev?.visits)} foot={partial ? (prev ? `${monthLabel(prev.m)} had ${prev.visits}` : '') : vs} spark={series(m => m.visits)} sel={idx} />
      <Kpi i={2} icon="users" label="Patients seen" value={cur.patients} delta={deltaOf(cur.patients, prev?.patients)} foot={`${cur.new_patients} for the first time`} spark={series(m => m.patients)} sel={idx} />
      <Kpi i={3} icon="rx" label="Repeat visits" value={repeatPct(cur)} suffix="%" delta={prev && prev.visits ? deltaOf(repeatPct(cur), repeatPct(prev), 'pt') : null} foot={`${cur.repeat_visits} of ${cur.visits} visits`} spark={series(repeatPct)} sel={idx} />
      <Kpi i={4} icon="chart" label="Per clinic day" value={perDay(cur)} decimals={1} delta={prev && prev.days ? deltaOf(perDay(cur), perDay(prev)) : null} foot={`over ${cur.days} clinic day${cur.days === 1 ? '' : 's'}`} spark={series(perDay)} sel={idx} />
    </div>
    <div className="fl-grid">
      <Card i={0} span={8} title="Month by month" sub={`Last ${months.length} months`} action={<div className="fl-seg" role="group" aria-label="What to chart">{([['visits', 'Visits'], ['patients', 'Patients'], ['new_patients', 'New patients']] as const).map(([k, l]) => <button key={k} type="button" aria-pressed={metric === k} onClick={() => setMetric(k)}>{l}</button>)}</div>}>
        <MonthBars months={months} metric={metric} sel={sel} onSel={setSel} />
      </Card>
      <Card i={1} span={4} title="Month at a glance" sub={monthLabel(sel, true) + (partial ? ', so far' : '')}>{d ? <Insights month={sel} cur={cur} d={d} sessItems={sessItems} prev={prev} /> : <Skel h={220} />}</Card>
      <Card i={2} span={8} title="Day by day" sub={`Visits per day, ${monthLabel(sel, true)}`}>{d ? <DayLine month={sel} daily={d.daily} /> : <Skel h={200} />}</Card>
      <Card i={3} span={4} title="Men and women" sub="Share of visits">{d ? <Donut items={sexItems} label="Visits by sex" /> : <Skel h={180} />}</Card>
      <Card i={4} span={4} title="Age groups">{d ? <HBars items={ageItems} empty="No visits this month." /> : <Skel h={180} />}</Card>
      <Card i={5} span={4} title="Days of the week">{d ? <Weekdays rows={d.weekday} /> : <Skel h={180} />}</Card>
      <Card i={6} span={4} title="Morning and evening">{d ? <Donut items={sessItems} label="Visits by session" /> : <Skel h={180} />}</Card>
      <Card i={7} span={6} title="Where patients come from" sub="Top places by visits">{d ? <HBars items={d.places} color={SERIES[2]} empty="No addresses noted this month." /> : <Skel h={180} />}</Card>
      <Card i={8} span={6} title="Common diagnoses" sub="From final prescriptions">{d ? <HBars items={d.diagnoses.map(x => ({ k: x.k.charAt(0).toUpperCase() + x.k.slice(1), n: x.n }))} color={SERIES[1]} empty="Diagnoses appear once prescriptions are finalised in OPD & Rx." /> : <Skel h={180} />}</Card>
    </div>
  </div>
}
