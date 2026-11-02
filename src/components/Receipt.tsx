import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { api } from '../lib/api'
import { useMe } from '../lib/session'
import { inr, fmtDate, d10 } from '../lib/format'
import { Modal, useToast, useDialog } from './ui'
import Icon from './Icon'
import { printOnly } from './RxActions'
import './parchi.css'

type Bill = { id: string; bill_no: number; items: { label: string; amount: number }[]; total: number; discount: number; paid: number; mode: string; status: string; bill_date: string; name: string; uhid: string; phone: string | null; age_years: number | null; sex: string | null; void_reason: string | null }

export function upiLink(vpa: string, payee: string, amount: number, note: string) {
  return `upi://pay?pa=${encodeURIComponent(vpa)}&pn=${encodeURIComponent(payee)}&am=${amount.toFixed(2)}&cu=INR&tn=${encodeURIComponent(note)}`
}

export function ReceiptDialog({ billId, onClose, onChange }: { billId: string; onClose: () => void; onChange?: () => void }) {
  const me = useMe(), toast = useToast(), dlg = useDialog()
  const L = me.clinic.settings.letterhead, F = me.clinic.settings.fees
  const [b, setB] = useState<Bill | null>(null)
  const qr = useRef<HTMLCanvasElement>(null)
  const load = () => api<Bill>(`/bills/${billId}`).then(setB).catch(e => toast(e.message, 'err'))
  useEffect(() => { load() }, [billId]) // eslint-disable-line
  const net = b ? b.total - b.discount : 0
  const showQr = !!(b && F.upi_vpa && b.status !== 'void' && net > 0)
  useEffect(() => { if (showQr && qr.current && b) QRCode.toCanvas(qr.current, upiLink(F.upi_vpa, F.payee_name, net, `Bill ${b.bill_no}`), { width: 150, margin: 1 }) }, [showQr, b]) // eslint-disable-line
  if (!b) return null
  const settle = async (mode: string) => { try { await api(`/bills/${b.id}/settle`, { body: { mode } }); toast('Marked as paid', 'ok'); load(); onChange?.() } catch (e: any) { toast(e.message, 'err') } }
  const voidIt = async () => { const reason = await dlg.prompt('Cancel this bill?', { text: 'Why is this bill being cancelled?', ok: 'Cancel bill' }); if (!reason) return; try { await api(`/bills/${b.id}/void`, { body: { reason } }); toast('Bill cancelled'); load(); onChange?.() } catch (e: any) { toast(e.message, 'err') } }
  const wa = () => {
    if (!b.phone) return toast('No mobile number on file.', 'err')
    const text = `${L.clinic_name_en} — Receipt #${b.bill_no}\n${b.name}, ${fmtDate(d10(b.bill_date))}\n${b.items.map(i => `${i.label}: ${inr(i.amount)}`).join('\n')}${b.discount ? `\nDiscount: −${inr(b.discount)}` : ''}\nTotal: ${inr(net)} (${b.status === 'due' ? 'unpaid' : b.mode.toUpperCase()})${b.status === 'due' && F.upi_vpa ? `\nPay by UPI: ${F.upi_vpa}` : ''}\nधन्यवाद!`
    window.open(`https://wa.me/91${b.phone}?text=${encodeURIComponent(text)}`, '_blank')
  }
  return <Modal title={`Receipt #${b.bill_no}`} width={460} onClose={onClose} footer={<>
    {b.status !== 'void' && me.user.role !== 'reception' && <button className="btn danger sm" onClick={voidIt}>Cancel bill</button>}
    <span className="grow" />
    <button className="btn" onClick={wa}><Icon n="wa" />WhatsApp</button>
    <button className="btn primary" onClick={() => printOnly('receipt', 'A6')}><Icon n="print" />Print</button>
  </>}>
    <div className="rcpt print-root receipt-print" style={{ ['--lh' as any]: L.ink }}>
      <div className="lh center">
        <div className="lh-names"><span className="lh-hi">{L.clinic_name_hi}</span><span className="lh-en">| {L.clinic_name_en}</span></div>
        <div className="lh-doc" style={{ fontSize: 14 }}>{L.doctor_en} <span className="hi">· {L.doctor_hi}</span></div>
        <div className="lh-deg">{L.quals_en} · Reg. No. {L.reg_no}</div>
        <div className="lh-contact">{L.address_hi} · {L.phone}</div>
      </div>
      <div style={{ textAlign: 'center', fontWeight: 700, letterSpacing: '.12em', color: 'var(--lh)', fontSize: 12, margin: '4px 0 8px' }}>RECEIPT / रसीद</div>
      <div className="meta">
        <div><span>Receipt No </span><b>{b.bill_no}</b></div><div><span>Date </span>{fmtDate(d10(b.bill_date))}</div>
        <div><span>Name </span><b>{b.name}</b></div><div><span>OP No </span>{b.uhid}</div>
      </div>
      <table><tbody>
        {b.items.map((i, k) => <tr key={k}><td>{i.label}</td><td className="n">{inr(i.amount)}</td></tr>)}
        {b.discount > 0 && <tr><td>Discount</td><td className="n">−{inr(b.discount)}</td></tr>}
        <tr className="tot"><td>Total</td><td className="n">{inr(net)}</td></tr>
      </tbody></table>
      <div style={{ marginTop: 6 }}>{b.status === 'void' ? <b style={{ color: '#B2261E' }}>Cancelled: {b.void_reason}</b> : b.status === 'due' ? <b>Not paid yet</b> : b.mode === 'free' ? 'Free consultation' : <>Paid by <b>{b.mode.toUpperCase()}</b></>}</div>
      {showQr && b.status === 'due' && <div style={{ textAlign: 'center', marginTop: 8 }}><canvas ref={qr} /><div style={{ fontSize: 12 }}>Scan to pay {inr(net)} · {F.upi_vpa}</div></div>}
      {showQr && b.status !== 'due' && <canvas ref={qr} hidden />}
      <div className="pfoot" style={{ marginTop: 10 }}><span>धन्यवाद · Get well soon</span><span>Made with Arogya Rx</span></div>
    </div>
    {b.status === 'due' && <div className="row no-print" style={{ marginTop: 12 }}><span className="grow small muted">Mark as paid:</span>{['cash', 'upi', 'card'].map(m => <button key={m} className="btn sm" onClick={() => settle(m)}>{m === 'upi' ? 'UPI' : m[0].toUpperCase() + m.slice(1)}</button>)}</div>}
  </Modal>
}
