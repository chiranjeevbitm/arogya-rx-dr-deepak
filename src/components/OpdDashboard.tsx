import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../lib/api'
import { istToday } from '../lib/format'
import { useAsync } from './ui'

/* OPD dashboard: month-wise visits and patients, with a breakdown of the chosen month.
   Plain SVG and CSS, no chart library. Charts grow in when they appear and answer hover and click.
   No money figures are shown anywhere on this screen. */

type MonthRow = { m: string; visits: number; new_visits: number; repeat_visits: number; patients: number; days: number; new_patients: number; prescriptions: number }
type Overview = { months: MonthRow[]; totals: { patients: number; visits: number; since: string | null } }
type Detail = {
  month: string; daily: { d: string; n: number; new_n: number }[]; sex: { k: string; n: number }[]; age: { k: string; n: number }[]
  places: { k: string; n: number }[]; session: { k: string; n: number }[]; weekday: { k: number; n: number }[]; diagnoses: { k: string; n: number }[]
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monthLabel = (m: string, long = false) => { const [y, mo] = m.split('-').map(Number); return long ? `${MON[mo - 1]} ${y}` : `${MON[mo - 1]} ’${String(y).slice(2)}` }
const prevMonth = (m: string) => { const [y, mo] = m.split('-').map(Number); return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}` }
const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** Counts up to the number the first time it appears and again when the number changes. */
function useCountUp(target: number, ms = 900) {
  const [v, setV] = useState(0), from = useRef(0)
  useEffect(() => {
    if (reduced()) { setV(target); from.current = target; return }
    let raf = 0; const t0 = performance.now(), a = from.current
    const tick = (t: number) => { const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3); setV(a + (target - a) * e); if (k < 1) raf = requestAnimationFrame(tick); else from.current = target }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, ms])
  return Math.round(v)
}

/** True one frame after mount, so CSS transitions have something to start from. */
function useMounted(key?: unknown) {
  const [on, setOn] = useState(false)
  useEffect(() => { setOn(false); const r = requestAnimationFrame(() => requestAnimationFrame(() => setOn(true))); return () => cancelAnimationFrame(r) }, [key])
  return on
}

function Kpi({ label, value, suffix = '', note, tone }: { label: string; value: number; suffix?: string; note?: React.ReactNode; tone?: 'up' | 'down' }) {
  const n = useCountUp(value)
  return <div className="kpi"><span>{label}</span><b>{n.toLocaleString('en-IN')}{suffix}</b>{note != null && <em className={tone}>{note}</em>}</div>
}

/* ---------- month-wise bars (click a bar to choose the month) ---------- */
type Metric = 'visits' | 'patients' | 'new_patients'
function MonthBars({ months, metric, sel, onSel }: { months: MonthRow[]; metric: Metric; sel: string; onSel: (m: string) => void }) {
  const [hover, setHover] = useState<number | null>(null), on = useMounted(metric)
  const W = 640, H = 230, L = 34, R = 8, T = 14, B = 30, iw = W - L - R, ih = H - T - B, bw = iw / months.length
  const top = (m: MonthRow) => metric === 'visits' ? m.visits : metric === 'patients' ? m.patients : m.new_patients
  const max = Math.max(4, ...months.map(top)), nice = max <= 8 ? 2 : max <= 20 ? 5 : max <= 60 ? 10 : max <= 200 ? 50 : 100
  const ceil = Math.ceil(max / nice) * nice, y = (v: number) => T + ih - (v / ceil) * ih
  const ticks = Array.from({ length: ceil / nice + 1 }, (_, i) => i * nice)
  const h = hover != null ? months[hover] : null
  return <div className="chart-wrap">
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Visits by month. Select a bar to see that month." className="chart" onMouseLeave={() => setHover(null)}>
      {ticks.map(t => <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="grid" /><text x={L - 6} y={y(t) + 4} textAnchor="end" className="axis">{t}</text></g>)}
      {months.map((m, i) => {
        const x = L + i * bw + bw * .16, w = bw * .68, a = metric === 'visits' ? m.repeat_visits : top(m), b = metric === 'visits' ? m.new_visits : 0
        const hRep = (a / ceil) * ih, hNew = (b / ceil) * ih
        return <g key={m.m} className={'bar' + (m.m === sel ? ' sel' : '') + (hover === i ? ' hov' : '')} style={{ transitionDelay: `${i * 45}ms` }}
          onMouseEnter={() => setHover(i)} onClick={() => onSel(m.m)} tabIndex={0} role="button" aria-label={`${monthLabel(m.m, true)}: ${top(m)}`} aria-pressed={m.m === sel}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSel(m.m) } }}>
          <rect x={L + i * bw} y={T} width={bw} height={ih + B - 6} className="hit" />
          <g style={{ transform: on ? 'scaleY(1)' : 'scaleY(0)', transformOrigin: `0 ${T + ih}px`, transition: `transform .7s cubic-bezier(.2,.9,.2,1) ${i * 45}ms` }}>
            <rect x={x} y={T + ih - hRep} width={w} height={Math.max(0, hRep)} rx="3" className={metric === 'visits' ? 'b-rep' : 'b-one'} />
            {metric === 'visits' && b > 0 && <rect x={x} y={T + ih - hRep - hNew} width={w} height={hNew} rx="3" className="b-new" />}
          </g>
          {top(m) > 0 && <text x={x + w / 2} y={y(top(m)) - 5} textAnchor="middle" className="val" style={{ opacity: on ? 1 : 0, transition: `opacity .4s ${.5 + i * .045}s` }}>{top(m)}</text>}
          <text x={x + w / 2} y={H - 10} textAnchor="middle" className={'axis mlab' + (m.m === sel ? ' on' : '')}>{monthLabel(m.m).split(' ')[0]}</text>
        </g>
      })}
    </svg>
    {h && <div className="tip" style={{ left: `${Math.min(80, Math.max(20, ((L + (hover! + .5) * bw) / W) * 100))}%`, top: 4 }}><b>{monthLabel(h.m, true)}</b>
      <span>{h.visits} visits ({h.new_visits} new, {h.repeat_visits} repeat)</span><span>{h.patients} patients, {h.new_patients} first-time</span>{h.prescriptions > 0 && <span>{h.prescriptions} prescriptions</span>}</div>}
    <div className="legend">{metric === 'visits' ? <><i className="lg-new" />First visit<i className="lg-rep" />Repeat</> : <><i className="lg-one" />{metric === 'patients' ? 'Different patients seen' : 'Patients seen for the first time'}</>}</div>
  </div>
}

/* ---------- day by day line for the chosen month ---------- */
function DayLine({ month, daily }: { month: string; daily: Detail['daily'] }) {
  const [hover, setHover] = useState<number | null>(null), on = useMounted(month)
  const [y0, m0] = month.split('-').map(Number), n = new Date(y0, m0, 0).getDate()
  const pts = Array.from({ length: n }, (_, i) => { const d = `${month}-${String(i + 1).padStart(2, '0')}`; const r = daily.find(x => x.d === d); return { d, day: i + 1, n: r?.n ?? 0, nw: r?.new_n ?? 0 } })
  const W = 640, H = 200, L = 30, R = 10, T = 14, B = 26, iw = W - L - R, ih = H - T - B
  const max = Math.max(3, ...pts.map(p => p.n)), x = (i: number) => L + (i / Math.max(1, n - 1)) * iw, y = (v: number) => T + ih - (v / max) * ih
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.n).toFixed(1)}`).join(' ')
  const area = `${line} L${x(n - 1)},${T + ih} L${x(0)},${T + ih} Z`
  const svg = useRef<SVGSVGElement>(null)
  const move = (e: React.MouseEvent) => { const r = svg.current!.getBoundingClientRect(), px = ((e.clientX - r.left) / r.width) * W; setHover(Math.max(0, Math.min(n - 1, Math.round(((px - L) / iw) * (n - 1))))) }
  const hp = hover != null ? pts[hover] : null
  return <div className="chart-wrap">
    <svg ref={svg} viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label={`Visits per day in ${monthLabel(month, true)}`} onMouseMove={move} onMouseLeave={() => setHover(null)}>
      {[0, Math.ceil(max / 2), max].map((t, i) => <g key={i}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="grid" /><text x={L - 6} y={y(t) + 4} textAnchor="end" className="axis">{t}</text></g>)}
      <path d={area} className="area" style={{ opacity: on ? 1 : 0, transition: 'opacity 1s .35s' }} />
      <path d={line} pathLength={1} className="ln" style={{ strokeDasharray: 1, strokeDashoffset: on ? 0 : 1, transition: 'stroke-dashoffset 1.2s cubic-bezier(.3,.7,.2,1)' }} />
      {pts.map((p, i) => p.n > 0 && <circle key={i} cx={x(i)} cy={y(p.n)} r={hover === i ? 5 : 3} className="dot" style={{ opacity: on ? 1 : 0, transition: `opacity .3s ${.6 + i * .02}s, r .15s` }} />)}
      {[1, 8, 15, 22, n].filter((v, i, a) => a.indexOf(v) === i).map(d => <text key={d} x={x(d - 1)} y={H - 8} textAnchor="middle" className="axis">{d}</text>)}
      {hp && <line x1={x(hover!)} x2={x(hover!)} y1={T} y2={T + ih} className="cross" />}
    </svg>
    {hp && <div className="tip" style={{ left: `${(x(hover!) / W) * 100}%` }}><b>{hp.day} {monthLabel(month).split(' ')[0]}</b><span>{hp.n === 0 ? 'No visits' : `${hp.n} visit${hp.n > 1 ? 's' : ''}${hp.nw ? `, ${hp.nw} new` : ''}`}</span></div>}
  </div>
}

/* ---------- donut ---------- */
const COL = ['var(--ink)', 'var(--sindoor)', 'var(--neem)', '#B7791F', '#7C8BE8', '#9AA0B8']
function Donut({ items, label }: { items: { k: string; n: number }[]; label: string }) {
  const [hover, setHover] = useState<number | null>(null), on = useMounted(items.map(i => i.n).join())
  const total = items.reduce((a, b) => a + b.n, 0), r = 46, C = 2 * Math.PI * r
  let acc = 0
  const h = hover != null ? items[hover] : null
  const num = useCountUp(h ? h.n : total)
  return <div className="donut-row">
    <svg viewBox="0 0 120 120" className="donut" role="img" aria-label={label} onMouseLeave={() => setHover(null)}>
      <circle cx="60" cy="60" r={r} className="d-bg" />
      {total > 0 && items.map((it, i) => {
        const len = (it.n / total) * C, off = -acc; acc += len
        return <circle key={it.k} cx="60" cy="60" r={r} fill="none" stroke={COL[i % COL.length]} strokeWidth={hover === i ? 17 : 13}
          strokeDasharray={`${on ? Math.max(0, len - 1.5) : 0} ${C}`} strokeDashoffset={off} transform="rotate(-90 60 60)" style={{ transition: `stroke-dasharray .9s cubic-bezier(.3,.7,.2,1) ${i * .12}s, stroke-width .15s`, cursor: 'pointer' }}
          onMouseEnter={() => setHover(i)}><title>{it.k}: {it.n}</title></circle>
      })}
      <text x="60" y="58" textAnchor="middle" className="d-num">{num}</text>
      <text x="60" y="73" textAnchor="middle" className="d-lab">{h ? h.k : 'visits'}</text>
    </svg>
    <ul className="d-leg">{items.map((it, i) => <li key={it.k} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} className={hover === i ? 'on' : ''}><i style={{ background: COL[i % COL.length] }} />{it.k}<b>{it.n}</b><small>{total ? Math.round((it.n / total) * 100) : 0}%</small></li>)}</ul>
  </div>
}

/* ---------- horizontal bars ---------- */
function HBars({ items, color = 'var(--ink)', empty }: { items: { k: string; n: number }[]; color?: string; empty: string }) {
  const on = useMounted(items.map(i => i.k + i.n).join()), max = Math.max(1, ...items.map(i => i.n))
  if (!items.length) return <div className="empty small">{empty}</div>
  return <ul className="hbars">{items.map((it, i) => <li key={it.k} title={`${it.k}: ${it.n}`}><span className="hb-l">{it.k}</span><span className="hb-t"><span className="hb-f" style={{ width: on ? `${(it.n / max) * 100}%` : '0%', background: color, transitionDelay: `${i * 70}ms` }} /></span><b>{it.n}</b></li>)}</ul>
}

/* ---------- weekday columns ---------- */
function Weekdays({ rows }: { rows: Detail['weekday'] }) {
  const on = useMounted(rows.map(r => r.n).join()), [hover, setHover] = useState<number | null>(null)
  const by = new Map(rows.map(r => [r.k, r.n])), max = Math.max(1, ...rows.map(r => r.n)), names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  return <div className="wk">{names.map((nm, i) => { const v = by.get(i + 1) ?? 0; return <div key={nm} className={'wk-c' + (hover === i ? ' on' : '')} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} title={`${nm}: ${v}`}>
    <b>{v}</b><span className="wk-bar"><span style={{ height: on ? `${(v / max) * 100}%` : '0%', transitionDelay: `${i * 60}ms` }} /></span><small>{nm}</small></div> })}</div>
}

export default function OpdDashboard() {
  const ov = useAsync(() => api<Overview>('/clinic/dashboard'), [], 'dash')
  const [metric, setMetric] = useState<Metric>('visits'), [selected, setSel] = useState<string | null>(null)
  const nowM = istToday().slice(0, 7)
  const months = useMemo(() => {
    const by = new Map((ov.data?.months || []).map(m => [m.m, m])), out: MonthRow[] = []
    let m = nowM; for (let i = 0; i < 12; i++) { out.unshift(by.get(m) || { m, visits: 0, new_visits: 0, repeat_visits: 0, patients: 0, days: 0, new_patients: 0, prescriptions: 0 }); m = prevMonth(m) }
    const first = out.findIndex(x => x.visits > 0)
    return first < 0 ? out.slice(-6) : out.slice(Math.min(first, out.length - 6))   // no long run of empty months before the first record
  }, [ov.data, nowM])
  // default: the latest month that has visits
  const sel = selected || [...months].reverse().find(m => m.visits > 0)?.m || nowM
  const detail = useAsync(() => api<Detail>('/clinic/dashboard?month=' + sel), [sel], 'dash-' + sel)
  if (ov.loading && !ov.data) return <div className="empty">Loading the dashboard…</div>
  if (ov.error && !ov.data) return <div className="alert warn">{ov.error}</div>
  const cur = months.find(m => m.m === sel)!, prev = months.find(m => m.m === prevMonth(sel))
  const delta = prev && prev.visits > 0 ? Math.round(((cur.visits - prev.visits) / prev.visits) * 100) : null
  const repeatPct = cur.visits ? Math.round((cur.repeat_visits / cur.visits) * 100) : 0
  const d = detail.data && detail.data.month === sel ? detail.data : null
  const sexItems = (d?.sex || []).map(x => ({ k: x.k === 'M' ? 'Male' : x.k === 'F' ? 'Female' : x.k === 'O' ? 'Other' : 'Not noted', n: x.n })).sort((a, b) => b.n - a.n)
  const ageOrder = ['0-12', '13-30', '31-45', '46-60', '60+', 'Not noted'], ageItems = ageOrder.map(k => ({ k: k === 'Not noted' ? k : k + ' yrs', n: d?.age.find(a => a.k === k)?.n ?? 0 })).filter(a => a.n > 0)
  const sessItems = (d?.session || []).map(x => ({ k: x.k === 'am' ? 'Morning' : x.k === 'pm' ? 'Evening' : 'Not noted', n: x.n })).sort((a, b) => b.n - a.n)
  if (!ov.data?.totals.visits) return <section className="dash"><div className="dcard"><div className="empty"><b>No visits recorded yet</b>The dashboard fills in as patients are seen. To bring in the past register, go to Settings → Import old data → OPD register (Excel).</div></div></section>
  return <section className="dash" aria-label="OPD dashboard">
    <div className="dash-h">
      <div><h2>OPD dashboard</h2><p className="small muted">{ov.data.totals.since ? `Since ${new Date(ov.data.totals.since).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}. ` : ''}Tap a month to look inside it.</p></div>
      <label className="row small" style={{ gap: 6 }}>Month<select className="inp sm" value={sel} onChange={e => setSel(e.target.value)}>{[...months].reverse().map(m => <option key={m.m} value={m.m}>{monthLabel(m.m, true)}</option>)}</select></label>
    </div>
    <div className="kpis">
      <Kpi label="All patients" value={ov.data.totals.patients} note={`${ov.data.totals.visits.toLocaleString('en-IN')} visits in all`} />
      <Kpi label={`Visits in ${monthLabel(sel)}`} value={cur.visits} note={delta == null ? 'no earlier month to compare' : sel === nowM ? `month so far · ${monthLabel(prev!.m)} had ${prev!.visits}` : `${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta)}% vs ${monthLabel(prev!.m)}`} tone={delta == null || sel === nowM ? undefined : delta >= 0 ? 'up' : 'down'} />
      <Kpi label="Patients seen" value={cur.patients} note={`${cur.new_patients} for the first time`} />
      <Kpi label="Repeat visits" value={repeatPct} suffix="%" note={`${cur.repeat_visits} of ${cur.visits}`} />
      <Kpi label="Average per clinic day" value={cur.days ? Math.round((cur.visits / cur.days) * 10) / 10 : 0} note={`over ${cur.days} clinic day${cur.days === 1 ? '' : 's'}`} />
    </div>
    <div className="dgrid">
      <div className="dcard wide">
        <div className="dcard-h"><h3>Month by month</h3>
          <div className="seg" role="group" aria-label="What to chart">{([['visits', 'Visits'], ['patients', 'Patients'], ['new_patients', 'New patients']] as const).map(([k, l]) => <button key={k} type="button" aria-pressed={metric === k} onClick={() => setMetric(k)}>{l}</button>)}</div></div>
        <MonthBars months={months} metric={metric} sel={sel} onSel={setSel} />
      </div>
      <div className="dcard wide"><div className="dcard-h"><h3>Day by day, {monthLabel(sel, true)}</h3></div>{d ? <DayLine month={sel} daily={d.daily} /> : <div className="empty small">Loading…</div>}</div>
      <div className="dcard"><div className="dcard-h"><h3>Men and women</h3></div>{d ? <Donut items={sexItems} label="Visits by sex" /> : <div className="empty small">Loading…</div>}</div>
      <div className="dcard"><div className="dcard-h"><h3>Morning and evening</h3></div>{d ? <Donut items={sessItems} label="Visits by session" /> : <div className="empty small">Loading…</div>}</div>
      <div className="dcard"><div className="dcard-h"><h3>Age groups</h3></div>{d ? <HBars items={ageItems} color="var(--ink)" empty="No visits this month." /> : <div className="empty small">Loading…</div>}</div>
      <div className="dcard"><div className="dcard-h"><h3>Days of the week</h3></div>{d ? <Weekdays rows={d.weekday} /> : <div className="empty small">Loading…</div>}</div>
      <div className="dcard"><div className="dcard-h"><h3>Where patients come from</h3></div>{d ? <HBars items={d.places} color="var(--neem)" empty="No addresses noted this month." /> : <div className="empty small">Loading…</div>}</div>
      <div className="dcard"><div className="dcard-h"><h3>Common diagnoses</h3></div>{d ? <HBars items={d.diagnoses.map(x => ({ k: x.k.charAt(0).toUpperCase() + x.k.slice(1), n: x.n }))} color="var(--sindoor)" empty="Diagnoses appear once prescriptions are finalised." /> : <div className="empty small">Loading…</div>}</div>
    </div>
  </section>
}
