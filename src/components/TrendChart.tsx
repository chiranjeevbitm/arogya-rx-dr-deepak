import { fmtDate } from '../lib/format'
type Pt = { date: string; value: number }
/** Small line chart with an optional target band. */
export default function TrendChart({ points, target, unit, label, color = '#1626B8' }: { points: Pt[]; target?: { hi?: number; lo?: number }; unit?: string; label: string; color?: string }) {
  const W = 420, H = 150, l = 40, r = 12, t = 12, b = 26
  const vals = points.map(p => p.value).concat([target?.hi, target?.lo].filter((x): x is number => x != null))
  let mn = Math.min(...vals), mx = Math.max(...vals)
  const pad = (mx - mn) * .18 || Math.max(1, mx * .1); mn -= pad; mx += pad
  const x = (i: number) => l + (points.length === 1 ? (W - l - r) / 2 : (i * (W - l - r)) / (points.length - 1))
  const y = (v: number) => t + (1 - (v - mn) / (mx - mn)) * (H - t - b)
  const ticks = [mn + (mx - mn) * .15, (mn + mx) / 2, mx - (mx - mn) * .15]
  const last = points[points.length - 1]
  return <figure className="chart-box" style={{ margin: 0 }}>
    <figcaption className="row small"><b>{label}</b><span className="grow" /><span className="muted">latest <b style={{ color: 'var(--text)' }}>{last.value}{unit ? ' ' + unit : ''}</b> on {fmtDate(last.date)}</span></figcaption>
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label} trend: ${points.map(p => `${fmtDate(p.date)} ${p.value}`).join(', ')}`}>
      {target?.hi != null && <rect x={l} y={y(target.hi)} width={W - l - r} height={Math.max(0, (target.lo != null ? y(target.lo) : H - b) - y(target.hi))} fill="#DFF2E7" opacity=".7" />}
      {ticks.map((v, i) => <g key={i}><line x1={l} x2={W - r} y1={y(v)} y2={y(v)} stroke="#E3E7F1" /><text x={l - 6} y={y(v) + 4} textAnchor="end">{Math.round(v * 10) / 10}</text></g>)}
      <polyline fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" points={points.map((p, i) => `${x(i)},${y(p.value)}`).join(' ')} />
      {points.map((p, i) => <circle key={i} cx={x(i)} cy={y(p.value)} r="4" fill="#fff" stroke={color} strokeWidth="2" />)}
      {points.map((p, i) => (points.length <= 8 || i % Math.ceil(points.length / 8) === 0 || i === points.length - 1) && <text key={'d' + i} x={x(i)} y={H - 8} textAnchor="middle">{fmtDate(p.date).slice(0, 5)}</text>)}
    </svg>
  </figure>
}
