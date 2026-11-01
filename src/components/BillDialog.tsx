import { useMemo, useState } from 'react'
import { api } from '../lib/api'
import { useMe } from '../lib/session'
import { inr } from '../lib/format'
import { Modal, useToast } from './ui'
import Icon from './Icon'

export function BillDialog({ patient, visit, onClose, onDone }: { patient: { id: string; name: string }; visit?: { id: string; visit_type?: string } | null; onClose: () => void; onDone: (billId: string) => void }) {
  const me = useMe(), F = me.clinic.settings.fees, toast = useToast()
  const base = visit?.visit_type === 'follow_up' ? { label: 'Follow-up consultation', amount: F.follow_up } : { label: 'Consultation', amount: F.new_visit }
  const [items, setItems] = useState([base]), [discount, setDiscount] = useState(0), [mode, setMode] = useState<'cash' | 'upi' | 'card' | 'free' | 'due'>('cash'), [busy, setBusy] = useState(false)
  const total = useMemo(() => items.reduce((s, i) => s + (Number(i.amount) || 0), 0), [items])
  const save = async () => {
    setBusy(true)
    try { const b = await api<{ id: string; bill_no: number }>('/bills', { body: { patient_id: patient.id, visit_id: visit?.id ?? null, items: items.filter(i => i.label).map(i => ({ label: i.label, amount: Number(i.amount) || 0 })), discount: Number(discount) || 0, mode } }); toast(`Bill #${b.bill_no} saved`, 'ok'); onDone(b.id) }
    catch (e: any) { toast(e.message, 'err') } finally { setBusy(false) }
  }
  return <Modal title={`Bill for ${patient.name}`} onClose={onClose} footer={<><span className="grow"><b style={{ fontSize: 20 }}>{inr(total - discount)}</b> {discount > 0 && <span className="muted small">after {inr(discount)} discount</span>}</span><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || total - discount < 0} onClick={save}>Save bill</button></>}>
    <div className="stack">
      {items.map((it, i) => <div className="row" key={i}>
        <input className="inp grow" value={it.label} onChange={e => setItems(items.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} aria-label="Item" />
        <input className="inp" style={{ width: 110 }} inputMode="numeric" value={it.amount} onChange={e => setItems(items.map((x, j) => j === i ? { ...x, amount: Number(e.target.value.replace(/\D/g, '')) || 0 } : x))} aria-label="Amount" />
        <button className="icon-btn" onClick={() => setItems(items.filter((_, j) => j !== i))} aria-label="Remove item" disabled={items.length === 1}><Icon n="trash" /></button>
      </div>)}
      <div className="chips">
        {[{ label: 'Consultation', amount: F.new_visit }, { label: 'Follow-up consultation', amount: F.follow_up }, ...F.extras].filter(x => !items.some(i => i.label === x.label)).map(x => <button key={x.label} className="chip" onClick={() => setItems([...items, x])}>+ {x.label} {inr(x.amount)}</button>)}
      </div>
      <div className="grid2">
        <label className="field"><span>Discount</span><input className="inp" inputMode="numeric" value={discount} onChange={e => setDiscount(Number(e.target.value.replace(/\D/g, '')) || 0)} /></label>
        <div className="field"><span>Paid by</span><div className="seg">{(['cash', 'upi', 'card', 'due', 'free'] as const).map(m => <button key={m} aria-pressed={mode === m} onClick={() => setMode(m)}>{m === 'upi' ? 'UPI' : m === 'due' ? 'Unpaid' : m[0].toUpperCase() + m.slice(1)}</button>)}</div></div>
      </div>
      {mode === 'upi' && !F.upi_vpa && <div className="alert warn small">Add the clinic's UPI ID in Settings → Fees so receipts show a QR code.</div>}
    </div>
  </Modal>
}
