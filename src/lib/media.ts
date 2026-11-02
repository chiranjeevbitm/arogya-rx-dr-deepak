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
/** Plain-words reason a microphone could not start. */
export function micMessage(e: any): string {
  if (!window.isSecureContext || !navigator.mediaDevices) return 'The microphone needs a secure (https) page. Open the app from its https address.'
  const n = e?.name || ''
  if (n === 'NotAllowedError' || n === 'SecurityError') return 'Microphone is blocked. Tap the lock icon next to the address, set Microphone to Allow, then try again.'
  if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'No microphone was found on this device.'
  if (n === 'NotReadableError' || n === 'AbortError') return 'The microphone is being used by another app. Close it and try again.'
  return 'The microphone could not start' + (n ? ` (${n})` : '') + '.'
}

/** Live dictation with the browser's speech engine (Chrome, Edge, Android). Returns null if it cannot start.
    onEnd(err, fallback): fallback=true means live speech is not working here (no network to the speech service,
    unsupported, or it keeps restarting) and the caller should record audio instead. */
/** Whether this browser's own live speech-to-text is usable: Chrome, Edge and Android Chrome yes; Firefox has none;
    Brave has the API but it silently returns nothing; Safari's needs Siri dictation and often stops at once. */
export function liveSpeech(): { ok: boolean; why: string } {
  const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
  const ua = navigator.userAgent
  if ((navigator as any).brave) return { ok: false, why: 'Brave blocks live speech; your voice is recorded and turned into text on the server instead.' }
  if (!SR) return { ok: false, why: 'This browser has no live speech; your voice is recorded and turned into text on the server instead.' }
  if (/iPhone|iPad|Macintosh/.test(ua) && /Safari/.test(ua) && !/Chrome|CriOS|Edg/.test(ua)) return { ok: false, why: 'Safari live speech is unreliable; your voice is recorded and turned into text on the server instead.' }
  if (!navigator.onLine) return { ok: false, why: 'Offline: live speech needs the internet.' }
  return { ok: true, why: /Edg\//.test(ua) ? 'Edge live speech (Microsoft).' : 'Chrome live speech (Google).' }
}

export function startDictation(lang: string, onText: (finalText: string, interim: string) => void, onEnd: (err?: string, fallback?: boolean, code?: string) => void): Rec | null {
  const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
  if (!SR || !liveSpeech().ok) return null
  let r: any
  try { r = new SR() } catch { return null }
  r.lang = lang; r.continuous = true; r.interimResults = true
  let finalText = '', stopped = false, gotAny = false, quick = 0, startedAt = 0, done = false
  let watchdog: ReturnType<typeof setTimeout> | undefined
  const end = (err?: string, fallback?: boolean, code?: string) => { if (done) return; done = true; clearTimeout(watchdog); console.info('[voice] live speech ended', { err, fallback, code, gotAny }); onEnd(err, fallback, code) }
  r.onresult = (e: any) => {
    let interim = ''
    gotAny = true; quick = 0
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript
      if (e.results[i].isFinal) finalText += (finalText ? ' ' : '') + t.trim(); else interim += t
    }
    onText(finalText, interim)
  }
  r.onstart = () => console.info('[voice] live speech started', lang)
  r.onerror = (e: any) => {
    console.warn('[voice] live speech error', e.error, e.message)
    if (e.error === 'no-speech' || e.error === 'aborted') return
    stopped = true
    if (e.error === 'not-allowed') return end('Microphone is blocked. Tap the lock icon next to the address, set Microphone to Allow, then try again.')
    // network / service-not-allowed / language-not-supported / audio-capture: live speech is unavailable here, record instead
    end(undefined, true, e.error)
  }
  r.onend = () => {
    if (stopped) return end()
    // some phones end the session straight away without any speech; after three quick ends in a row, record instead
    if (Date.now() - startedAt < 1200 && !gotAny) quick++
    if (quick >= 3) { stopped = true; return end(undefined, true, 'ended at once') }
    try { startedAt = Date.now(); r.start() } catch { stopped = true; end(undefined, true) }
  }
  // live speech that never returns any text (blocked speech service, some company networks): after 9 s, record instead
  watchdog = setTimeout(() => { if (!gotAny && !stopped) { stopped = true; try { r.abort() } catch { /* ignore */ } end(undefined, true, 'no words in 9 s') } }, 9000)
  try { startedAt = Date.now(); r.start() } catch { clearTimeout(watchdog); return null }
  return { stop: () => { stopped = true; clearTimeout(watchdog); try { r.stop() } catch { /* already stopped */ } } }
}

/** Record audio for server-side transcription (works in any browser with a microphone, including iPhone Safari). */
export async function recordAudio(onLevel?: (v: number) => void): Promise<{ stop: () => Promise<{ base64: string; mime: string }> }> {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw Object.assign(new Error('unsupported'), { name: 'NotSupportedError' })
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
  console.info('[voice] recording from', stream.getAudioTracks()[0]?.label || 'microphone')
  // loudness meter, so the doctor can see the microphone is hearing him
  let ac: AudioContext | null = null, raf = 0
  if (onLevel) try {
    ac = new AudioContext(); const an = ac.createAnalyser(); an.fftSize = 512; ac.createMediaStreamSource(stream).connect(an)
    const buf = new Uint8Array(an.fftSize)
    const tick = () => { an.getByteTimeDomainData(buf); let m = 0; for (const x of buf) m = Math.max(m, Math.abs(x - 128)); onLevel(Math.min(1, m / 64)); raf = requestAnimationFrame(tick) }
    tick()
  } catch { /* no meter, recording still works */ }
  const cleanup = () => { cancelAnimationFrame(raf); try { ac?.close() } catch { /* ignore */ } stream.getTracks().forEach(t => t.stop()) }
  const pick = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find(m => MediaRecorder.isTypeSupported(m))
  let rec: MediaRecorder
  try { rec = new MediaRecorder(stream, pick ? { mimeType: pick } : undefined) } catch (e) { cleanup(); throw e }
  const chunks: Blob[] = []
  rec.ondataavailable = e => { if (e.data?.size) chunks.push(e.data) }
  rec.start(1000)
  const mime = (rec.mimeType || pick || 'audio/webm').split(';')[0]
  return { stop: () => new Promise((res, rej) => {
    rec.onstop = async () => {
      cleanup()
      const b = new Blob(chunks, { type: mime })
      if (b.size < 1500) return rej(new Error('Nothing was recorded. Speak after pressing Start, then press Stop.'))
      const buf = new Uint8Array(await b.arrayBuffer()); let s = ''
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000))
      res({ base64: btoa(s), mime })
    }
    try { rec.stop() } catch { cleanup(); rej(new Error('Nothing was recorded.')) }
  }) }
}
