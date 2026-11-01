/** Downscale a phone photo to keep uploads fast on 4G (long edge 1800 px, JPEG). */
export async function compressImage(file: File, maxEdge = 1800): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url })
    const k = Math.min(1, maxEdge / Math.max(img.width, img.height))
    const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k)
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
    return c.toDataURL('image/jpeg', 0.85)
  } finally { URL.revokeObjectURL(url) }
}

type Rec = { stop: () => void }
/** Live dictation with the browser's speech engine (Chrome, Edge, Android). Returns null if unsupported. */
export function startDictation(lang: string, onText: (finalText: string, interim: string) => void, onEnd: (err?: string) => void): Rec | null {
  const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
  if (!SR) return null
  const r = new SR()
  r.lang = lang; r.continuous = true; r.interimResults = true
  let finalText = '', stopped = false
  r.onresult = (e: any) => {
    let interim = ''
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript
      if (e.results[i].isFinal) finalText += (finalText ? ' ' : '') + t.trim(); else interim += t
    }
    onText(finalText, interim)
  }
  r.onerror = (e: any) => { if (e.error === 'no-speech' || e.error === 'aborted') return; stopped = true; onEnd(e.error === 'not-allowed' ? 'Microphone permission was denied. Allow it in the browser settings.' : `Speech error: ${e.error}`) }
  r.onend = () => { if (!stopped) { try { r.start() } catch { onEnd() } } else onEnd() }
  r.start()
  return { stop: () => { stopped = true; r.stop() } }
}

/** Fallback: record audio for server-side transcription. */
export async function recordAudio(): Promise<{ stop: () => Promise<{ base64: string; mime: string }> }> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4'
  const rec = new MediaRecorder(stream, { mimeType: mime })
  const chunks: Blob[] = []
  rec.ondataavailable = e => chunks.push(e.data)
  rec.start()
  return { stop: () => new Promise(res => { rec.onstop = async () => { stream.getTracks().forEach(t => t.stop()); const b = new Blob(chunks, { type: mime }); const buf = new Uint8Array(await b.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000)); res({ base64: btoa(s), mime }) }; rec.stop() }) }
}
