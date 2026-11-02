import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams, Link } from 'react-router-dom'
import { api } from '../lib/api'
import { useMe } from '../lib/session'
import { ageSex, fmtDate, d10 } from '../lib/format'
import { Spinner, useToast, useDialog } from '../components/ui'
import Icon from '../components/Icon'
import { ParchiPreview } from '../components/Parchi'
import { PrintArea, printOnly, WhatsAppPreview } from '../components/RxActions'
import { BILLING_ENABLED } from '../lib/features'
import { BillDialog } from '../components/BillDialog'
import { ReceiptDialog } from '../components/Receipt'
import { elementToPdf, blobToBase64 } from '../lib/pdf'

export default function RxView() {
  const { id } = useParams(), [sp] = useSearchParams(), me = useMe(), toast = useToast(), nav = useNavigate(), dlg = useDialog()
  const [b, setB] = useState<any>(null), [err, setErr] = useState('')
  const [pdfUrl, setPdfUrl] = useState<string | null>(null), [pdfBusy, setPdfBusy] = useState(false), [wa, setWa] = useState(false), [billing, setBilling] = useState(false), [receipt, setReceipt] = useState<string | null>(null), [billed, setBilled] = useState<string | null>(null)
  const page = useRef<HTMLDivElement>(null)
  const isNew = sp.get('new') === '1'
  const load = () => api<any>(`/rx/${id}`).then(x => { setB(x); return x }).catch(e => setErr(e.message))
  useEffect(() => { load() }, [id]) // eslint-disable-line

  // A finalised parchi gets its PDF made once, in the background, so WhatsApp has a link ready.
  const makePdf = async (): Promise<string | null> => {
    if (!page.current) return null
    setPdfBusy(true)
    try {
      const blob = await elementToPdf(page.current)
      const r = await api<{ url: string; file_id: string }>(`/rx/${id}/pdf`, { body: { pdf_base64: await blobToBase64(blob) } })
      setPdfUrl(r.url); setB((x: any) => ({ ...x, rx: { ...x.rx, pdf_file_id: r.file_id } }))
      return r.url
    } catch (e: any) { toast('Could not make the PDF: ' + e.message, 'err'); return null } finally { setPdfBusy(false) }
  }
  useEffect(() => { if (b?.rx.status === 'final' && !b.rx.pdf_file_id && !pdfBusy) { const t = setTimeout(makePdf, 600); return () => clearTimeout(t) } }, [b?.rx.id, b?.rx.status]) // eslint-disable-line
  useEffect(() => { if (b?.visit?.id) api<any[]>(`/visits?date=${d10(b.visit.visit_date)}`).then(vs => setBilled(vs.find(v => v.id === b.visit.id)?.bill_id || null)).catch(() => {}) }, [b?.visit?.id]) // eslint-disable-line

  if (err) return <div className="empty"><b>Could not open this prescription</b>{err}</div>
  if (!b) return <Spinner />
  const final = b.rx.status === 'final', p = b.patient, isDoc = me.user.role !== 'reception'

  const whatsapp = async () => {
    if (!p.phone) return toast('Add the patient’s mobile number first (Patient details).', 'err')
    let url = pdfUrl
    if (!b.rx.pdf_file_id && !url) url = await makePdf()
    try {
      const r = await api<any>(`/messages/rx/${id}`, { body: { mode: 'auto' } })
      if (r.sent) toast('Sent on WhatsApp with the PDF', 'ok')
      else { window.open(r.url, '_blank'); if (r.error) toast('Auto-send failed, opened WhatsApp instead: ' + r.error, 'err') }
    } catch (e: any) { toast(e.message, 'err') }
  }
  const download = async () => {
    if (!page.current) return
    const blob = await elementToPdf(page.current)
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `Parchi-${p.name.replace(/\W+/g, '_')}-${d10(b.rx.rx_date)}.pdf`; a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 4000)
  }
  const reopen = async () => { if (!(await dlg.ask('Reopen this prescription?', { text: 'The change is recorded in the audit log.', ok: 'Reopen' }))) return; try { await api(`/rx/${id}/reopen`, { method: 'POST' }); nav(`/opd/${id}`) } catch (e: any) { toast(e.message, 'err') } }
  const copyNew = async () => { try { const r = await api<{ rx_id: string }>('/rx', { body: { patient_id: p.id, copy_from: id } }); nav(`/opd/${r.rx_id}`) } catch (e: any) { toast(e.message, 'err') } }
  const next = async () => { try { const r = await api<{ visit_id: string }>('/visits/next', { method: 'POST' }); const s = await api<{ rx_id: string }>(`/visits/${r.visit_id}/start`, { method: 'POST' }); nav(`/opd/${s.rx_id}`) } catch (e: any) { toast(e.message, 'err') } }

  return <div className="stack">
    <div className="page-h">
      <div className="grow"><h1>{p.name}</h1><p>{ageSex(p)}, {p.uhid}, prescription of {fmtDate(d10(b.rx.rx_date))}{b.rx.legacy_id ? ' (imported from the old app)' : ''}</p></div>
      <Link to={`/patients/${p.id}`} className="btn"><Icon n="users" />Patient history</Link>
    </div>
    {isNew && final && <div className="alert ok"><b>Finalised.</b><span>Print it or send it on WhatsApp. {pdfBusy ? 'Making the PDF…' : b.rx.pdf_file_id ? 'PDF ready.' : ''}</span></div>}
    {!final && <div className="alert warn"><b>Draft.</b><span>This prescription is not final yet.</span>{isDoc && <Link className="btn sm right" to={`/opd/${id}`}>Continue editing</Link>}</div>}
    <div className="consult">
      <div className="paper-scroll" style={{ maxHeight: 'none' }}><ParchiPreview s={me.clinic.settings} patient={p} data={b.rx.data} meds={b.rx.meds} date={d10(b.rx.rx_date)} draft={!final} token={b.visit?.token} /></div>
      <div className="paper-col">
        {final && <div className="card stack">
          <button className="btn primary lg" onClick={() => printOnly('rx', me.clinic.settings.letterhead.paper)}><Icon n="print" />Print {me.clinic.settings.letterhead.paper}</button>
          <button className="btn lg good" onClick={() => setWa(true)} disabled={pdfBusy}><Icon n="wa" />WhatsApp</button>
          <button className="btn" onClick={download}><Icon n="down" />Download PDF</button>
          {!p.phone && <p className="small muted">No mobile number on file, so WhatsApp is not available.</p>}
          {BILLING_ENABLED && b.visit && (billed ? <button className="btn" onClick={() => setReceipt(billed)}><Icon n="receipt" />View receipt</button> : <button className="btn" onClick={() => setBilling(true)}><Icon n="rupee" />Make bill</button>)}
        </div>}
        {isDoc && <div className="card stack">
          {isNew && <button className="btn primary" onClick={next}><Icon n="next" />Call next patient</button>}
          <button className="btn" onClick={copyNew}><Icon n="copy" />New prescription from this one</button>
          {final && <button className="btn ghost" onClick={reopen}><Icon n="edit" />Reopen to edit</button>}
        </div>}
      </div>
    </div>
    <PrintArea ref={page} s={me.clinic.settings} patient={p} data={b.rx.data} meds={b.rx.meds} date={d10(b.rx.rx_date)} draft={!final} token={b.visit?.token} />
    {wa && <WhatsAppPreview rxId={id!} patient={p} meds={b.rx.meds} advice={b.rx.data.advice || []} followDays={b.rx.data.follow_up?.days} rxDate={d10(b.rx.rx_date)} ensurePdf={async () => !!(b.rx.pdf_file_id || pdfUrl || (await makePdf()))} onClose={() => setWa(false)} />}
    {billing && <BillDialog patient={{ id: p.id, name: p.name }} visit={b.visit} onClose={() => setBilling(false)} onDone={id => { setBilling(false); setBilled(id); setReceipt(id) }} />}
    {receipt && <ReceiptDialog billId={receipt} onClose={() => setReceipt(null)} />}
  </div>
}
