import { useState } from 'react'
import { api } from '../lib/api'
import { useMe } from '../lib/session'
import { inr, istToday, addDaysISO, fmtDate, d10 } from '../lib/format'
import { Spinner, useAsync } from '../components/ui'
import Icon from '../components/Icon'
import { ReceiptDialog } from '../components/Receipt'

export default function Billing() {
  const me = useMe(), isDoc = me.user.role !== 'reception'
  const [range, setRange] = useState<'today' | 'week' | 'month'>('today'), [receipt, setReceipt] = useState<string | null>(null)
  const to = istToday(), from = range === 'today' ? to : range === 'week' ? addDaysISO(to, -6) : to.slice(0, 8) + '01'
  const bills = useAsync(() => api<any[]>(`/bills?from=${from}&to=${to}`), [from])
  const rep = useAsync(() => isDoc ? api<any>(`/bills/report/collection?from=${from}&to=${to}`) : Promise.resolve(null), [from])
  const live = (bills.data || []).filter(b => b.status !== 'void')
  const sum = (f: (b: any) => boolean) => live.filter(f).reduce((s, b) => s + b.paid, 0)
  const due = live.filter(b => b.status === 'due')
  const csv = () => {
    const rows = [['Bill no', 'Date', 'Patient', 'OP no', 'Items', 'Total', 'Discount', 'Paid', 'Mode', 'Status'], ...(bills.data || []).map(b => [b.bill_no, d10(b.bill_date), b.name, b.uhid, b.items.map((i: any) => `${i.label} ${i.amount}`).join('; '), b.total, b.discount, b.paid, b.mode, b.status])]
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([rows.map(r => r.map(x => `"${String(x ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')], { type: 'text/csv' })); a.download = `arogya-collection-${from}-to-${to}.csv`; a.click()
  }
  return <div className="stack">
    <div className="page-h"><div className="grow"><h1>Billing</h1><p>{from === to ? fmtDate(to) : `${fmtDate(from)} to ${fmtDate(to)}`}</p></div>
      <div className="seg">{(['today', 'week', 'month'] as const).map(r => <button key={r} aria-pressed={range === r} onClick={() => setRange(r)}>{r === 'today' ? 'Today' : r === 'week' ? '7 days' : 'This month'}</button>)}</div>
      {isDoc && <button className="btn" onClick={csv}><Icon n="down" />Export CSV</button>}</div>
    <div className="stat-row">
      <div className="stat"><b>{inr(sum(() => true))}</b><span>collected from {live.length} bills</span></div>
      <div className="stat"><b>{inr(sum(b => b.mode === 'cash'))}</b><span>cash</span></div>
      <div className="stat"><b>{inr(sum(b => b.mode === 'upi'))}</b><span>UPI</span></div>
      <div className="stat"><b>{inr(due.reduce((s, b) => s + b.total - b.discount, 0))}</b><span>unpaid ({due.length})</span></div>
    </div>
    {isDoc && rep.data && rep.data.days.length > 1 && <div className="card tbl-wrap"><table className="t"><thead><tr><th>Day</th><th className="num">Patients</th><th className="num">New</th><th className="num">Cash</th><th className="num">UPI</th><th className="num">Total</th></tr></thead><tbody>
      {rep.data.days.map((d: any) => { const v = rep.data.visits.find((x: any) => x.day === d.day); return <tr key={d.day}><td>{fmtDate(d.day)}</td><td className="num">{v?.visits ?? 0}</td><td className="num">{v?.new_visits ?? 0}</td><td className="num">{inr(d.cash)}</td><td className="num">{inr(d.upi)}</td><td className="num"><b>{inr(d.collected)}</b></td></tr> })}
    </tbody></table></div>}
    <div className="card flush">
      {bills.loading && !bills.data ? <Spinner /> : (bills.data || []).length === 0 ? <div className="empty"><b>No bills yet</b>Make a bill from the queue on the Today screen.</div> :
        <div className="tbl-wrap"><table className="t"><thead><tr><th>No.</th><th>Patient</th><th>Items</th><th className="num">Amount</th><th>Paid by</th><th>Time</th></tr></thead><tbody>
          {bills.data!.map(b => <tr key={b.id} onClick={() => setReceipt(b.id)} style={{ cursor: 'pointer', opacity: b.status === 'void' ? .5 : 1 }}>
            <td>#{b.bill_no}</td><td><b>{b.name}</b><br /><span className="small muted">{b.uhid}</span></td><td className="small">{b.items.map((i: any) => i.label).join(', ')}</td>
            <td className="num"><b>{inr(b.total - b.discount)}</b></td>
            <td>{b.status === 'void' ? <span className="tag">Cancelled</span> : b.status === 'due' ? <span className="tag amber">Unpaid</span> : <span className="tag green">{b.mode === 'upi' ? 'UPI' : b.mode[0].toUpperCase() + b.mode.slice(1)}</span>}</td>
            <td className="small muted">{new Date(b.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}{from !== to ? `, ${fmtDate(d10(b.bill_date)).slice(0, 5)}` : ''}</td>
          </tr>)}
        </tbody></table></div>}
    </div>
    {receipt && <ReceiptDialog billId={receipt} onClose={() => setReceipt(null)} onChange={() => { bills.reload(); rep.reload() }} />}
  </div>
}
