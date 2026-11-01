import { forwardRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Parchi from './Parchi'
import { api } from '../lib/api'
import { elementToPdf, blobToBase64 } from '../lib/pdf'
import { useMe } from '../lib/session'
import { Modal, useToast } from './ui'
import Icon from './Icon'
import { displayName, sigHi, adviceHi, fmtDateHi, addDaysISO, type Med } from '../../shared/rx'

/** Full-size parchi kept off-screen: the source for printing and for the PDF. */
export const PrintArea = forwardRef<HTMLDivElement, React.ComponentProps<typeof Parchi>>(function PrintArea(props, ref) {
  return createPortal(<div className="print-root rx-print" style={{ position: 'fixed', left: -10000, top: 0, zIndex: -1 }} aria-hidden="true"><div ref={ref}><Parchi {...props} /></div></div>, document.body)
})

/** Prints one document on its own: a clean copy of the page is put in an isolated sheet and everything else is
    removed from the layout while printing, so the browser never adds blank pages for the hidden app behind it. */
const PAGE_H: Record<string, string> = { A5: '209.4mm', A4: '296.4mm' }
export async function printOnly(kind: 'rx' | 'receipt', size: string) {
  const src = document.querySelector<HTMLElement>(`.print-root.${kind}-print`)
  if (!src) return window.print()
  const sheet = document.createElement('div')
  sheet.id = 'print-sheet'
  const copy = src.cloneNode(true) as HTMLElement
  copy.removeAttribute('style'); copy.removeAttribute('aria-hidden')
  const live = src.querySelectorAll('canvas'), cl = copy.querySelectorAll('canvas')
  cl.forEach((c, i) => { const img = document.createElement('img'); try { img.src = (live[i] as HTMLCanvasElement).toDataURL() } catch { /* tainted canvas: skip */ } img.width = (live[i] as HTMLCanvasElement).width; img.height = (live[i] as HTMLCanvasElement).height; img.hidden = c.hidden; c.replaceWith(img) })
  sheet.appendChild(copy)
  if (kind === 'rx' && PAGE_H[size]) sheet.style.height = PAGE_H[size]
  document.body.appendChild(sheet)
  const st = document.createElement('style')
  st.textContent = `@page { size: ${size}; margin: 0 }`
  document.head.appendChild(st)
  document.documentElement.classList.add('printing')
  const done = () => { sheet.remove(); st.remove(); document.documentElement.classList.remove('printing'); window.removeEventListener('afterprint', done) }
  window.addEventListener('afterprint', done)
  await Promise.all([...sheet.querySelectorAll('img')].map(i => i.complete ? null : new Promise(r => { i.onload = i.onerror = () => r(null) })))
  window.print()
  setTimeout(done, 120000)
}

export function useRxOutput(rxId: string, page: React.RefObject<HTMLDivElement | null>, hasPdf: boolean) {
  const toast = useToast()
  const [busy, setBusy] = useState(false), [url, setUrl] = useState<string | null>(null), [made, setMade] = useState(hasPdf)
  const ensurePdf = async (): Promise<boolean> => {
    if (made) return true
    if (!page.current) return false
    setBusy(true)
    try { const blob = await elementToPdf(page.current); const r = await api<{ url: string }>(`/rx/${rxId}/pdf`, { body: { pdf_base64: await blobToBase64(blob) } }); setUrl(r.url); setMade(true); return true }
    catch (e: any) { toast('Could not make the PDF: ' + e.message, 'err'); return false } finally { setBusy(false) }
  }
  const download = async (name: string) => {
    if (!page.current) return
    const blob = await elementToPdf(page.current)
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000)
  }
  return { busy, url, made, ensurePdf, download, reset: () => setMade(false) }
}

/** The demo's WhatsApp preview: PDF bubble plus the Hindi dose schedule, then send. */
export function WhatsAppPreview({ rxId, patient, meds, advice, followDays, rxDate, ensurePdf, onClose }: { rxId: string; patient: { name: string; phone?: string | null }; meds: Med[]; advice: string[]; followDays?: number | null; rxDate: string; ensurePdf: () => Promise<boolean>; onClose: () => void }) {
  const me = useMe(), toast = useToast(), L = me.clinic.settings.letterhead
  const [busy, setBusy] = useState(false)
  const fu = followDays ? addDaysISO(rxDate, followDays) : null
  const send = async () => {
    if (!patient.phone) return toast('Add the patient’s mobile number first.', 'err')
    setBusy(true)
    try {
      await ensurePdf()
      const r = await api<any>(`/messages/rx/${rxId}`, { body: { mode: 'auto' } })
      if (r.sent) toast('Sent on WhatsApp with the PDF', 'ok')
      else { window.open(r.url, '_blank'); if (r.error) toast('Auto-send failed, opened WhatsApp instead: ' + r.error, 'err') }
      onClose()
    } catch (e: any) { toast(e.message, 'err') } finally { setBusy(false) }
  }
  return <Modal title={`WhatsApp preview · ${patient.phone || 'no mobile number'}`} width={760} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Close</button><button className="btn good" disabled={busy || !patient.phone} onClick={send}><Icon n="wa" />{busy ? 'Sending…' : me.features.whatsapp_api ? 'Send now' : 'Open WhatsApp to send'}</button></>}>
    <div className="wa-grid">
      <div className="stack small">
        <p>The patient gets the PDF and a Hindi schedule they can read at home.{fu ? ' A reminder goes out the day before the follow-up.' : ''}</p>
        <ul className="muted" style={{ paddingLeft: 18, margin: 0 }}>
          <li>{me.features.whatsapp_api ? 'Sent automatically from the clinic’s WhatsApp Business number' : 'Opens WhatsApp with the message ready; press send'}</li>
          <li>About 15 paise per message on the WhatsApp API</li>
          <li>Send only after the patient agrees at reception</li>
        </ul>
      </div>
      <div className="phone"><div className="wa-top"><span className="av" /><span><b>{L.clinic_name_en}</b><small>Business account</small></span></div>
        <div className="wa-body">
          <div className="bub"><div className="pdf"><span className="ic">PDF</span><span><b>Parchi_{patient.name.replace(/[^A-Za-z]/g, '')}.pdf</b><br /><small>1 page · {L.doctor_en}</small></span></div><div className="tm">✓✓</div></div>
          <div className="bub">नमस्ते {patient.name} जी, {L.doctor_hi} की पर्ची ऊपर है। दवा ऐसे लें:
            <ul className="wa-meds">{meds.map((m, i) => <li key={i}><b>{displayName(m)}</b>: {sigHi(m)}</li>)}</ul>
            {advice.length > 0 && <div style={{ marginTop: 6 }}>सलाह: {advice.map(a => adviceHi(a) || a).join(', ')}</div>}
            {fu && <div style={{ marginTop: 6 }}><b>{fmtDateHi(fu)}</b> को दोबारा दिखाएँ।</div>}
            <div className="tm">✓✓</div></div>
        </div></div>
    </div>
  </Modal>
}
