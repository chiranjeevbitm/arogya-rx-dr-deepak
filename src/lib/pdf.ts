
/** Renders an A5 or A4 element to a PDF using the browser's own layout and text shaping
    (SVG foreignObject), so Hindi and spacing match the screen and the printed page exactly. */
export async function elementToPdf(el: HTMLElement): Promise<Blob> {
  await document.fonts?.ready
  await Promise.all(Array.from(el.querySelectorAll('img')).map(i => (i.complete ? null : new Promise(r => { i.onload = i.onerror = r }))))
  // the PDF libraries (about 145 KB) are fetched only when someone actually prints or downloads
  const [{ toCanvas }, { jsPDF }] = await Promise.all([import('html-to-image'), import('jspdf')]).catch(() => {
    throw new Error('The app was updated since this page was opened. Reload the page (Ctrl+Shift+R) and try again.')
  })
  const canvas = await toCanvas(el, { pixelRatio: 2, backgroundColor: '#ffffff', cacheBust: false, width: el.offsetWidth, height: el.offsetHeight })
  const a5 = el.offsetWidth < 700 // 148 mm ≈ 559 px; 210 mm ≈ 794 px
  const W = a5 ? 148 : 210, H = a5 ? 210 : 297
  const pdf = new jsPDF({ unit: 'mm', format: a5 ? 'a5' : 'a4', compress: true })
  const pxPerMm = canvas.width / W, pagePx = Math.floor(H * pxPerMm)
  for (let y = 0, page = 0; y < canvas.height; y += pagePx, page++) {
    const h = Math.min(pagePx, canvas.height - y)
    if (h < 6 * pxPerMm && page > 0) break // ignore a sliver of overflow
    const slice = document.createElement('canvas')
    slice.width = canvas.width; slice.height = h
    const g = slice.getContext('2d')!
    g.fillStyle = '#fff'; g.fillRect(0, 0, slice.width, h)
    g.drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h)
    if (page > 0) pdf.addPage()
    pdf.addImage(slice.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, W, h / pxPerMm)
  }
  return pdf.output('blob')
}
export async function blobToBase64(b: Blob): Promise<string> {
  const buf = new Uint8Array(await b.arrayBuffer())
  let s = ''
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000))
  return btoa(s)
}
