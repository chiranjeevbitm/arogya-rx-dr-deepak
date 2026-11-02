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
const MIC_KEY = 'arx.micId'
export const savedMic = () => { try { return localStorage.getItem(MIC_KEY) || '' } catch { return '' } }
export const saveMic = (id: string) => { try { id ? localStorage.setItem(MIC_KEY, id) : localStorage.removeItem(MIC_KEY) } catch { /* private mode */ } }
/** Microphones on this computer (names appear once microphone permission has been given). */
export async function listMics(): Promise<{ id: string; label: string }[]> {
  try { return (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput' && d.deviceId !== 'communications').map((d, i) => ({ id: d.deviceId, label: d.label || `Microphone ${i + 1}` })) } catch { return [] }
}
const SILENT_HELP = 'Choose another microphone in the list, check it is plugged in and not muted, and in Windows open Settings → Privacy & security → Microphone and turn on access for apps and desktop apps (Chrome).'

/** Record audio for server-side transcription (works in any browser with a microphone, including iPhone Safari).
    onLevel gets the loudness 0..1 many times a second. Uses the microphone chosen in the voice window, if any. */
export type Recorded = { base64: string; mime: string; seconds: number; bytes: number; pcm?: Int16Array }
/** pcm: also capture 16 kHz mono 16-bit PCM (for Murf speech to text) next to the small compressed file. */
export async function recordAudio(onLevel?: (v: number) => void, opts: { pcm?: boolean } = {}): Promise<{ label: string; stop: () => Promise<Recorded> }> {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw Object.assign(new Error('unsupported'), { name: 'NotSupportedError' })
  const base = { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }, id = savedMic()
  let stream: MediaStream
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: id ? { ...base, deviceId: { exact: id } } : base }) }
  catch (e: any) { if (id && (e?.name === 'OverconstrainedError' || e?.name === 'NotFoundError')) { saveMic(''); stream = await navigator.mediaDevices.getUserMedia({ audio: base }) } else throw e }
  const track = stream.getAudioTracks()[0], label = track?.label || 'the microphone'
  console.info('[voice] recording from', label, { muted: track?.muted, state: track?.readyState, settings: track?.getSettings?.() })
  // loudness meter, so the doctor can see the microphone is hearing him
  let ac: AudioContext | null = null, raf = 0, peak = 0, sp: ScriptProcessorNode | null = null
  const raw: Float32Array[] = []
  try {
    ac = new AudioContext(); if (ac.state === 'suspended') await ac.resume().catch(() => {})
    const an = ac.createAnalyser(); an.fftSize = 512; ac.createMediaStreamSource(stream).connect(an)
    const buf = new Uint8Array(an.fftSize)
    const tick = () => { an.getByteTimeDomainData(buf); let m = 0; for (const x of buf) m = Math.max(m, Math.abs(x - 128)); const v = Math.min(1, m / 64); if (v > peak) peak = v; onLevel?.(v); raf = requestAnimationFrame(tick) }
    tick()
    if (opts.pcm) {
      // raw samples at the device rate; turned into 16 kHz on Stop (a muted gain keeps the node running without playing back)
      sp = ac.createScriptProcessor(4096, 1, 1); const mute = ac.createGain(); mute.gain.value = 0
      sp.onaudioprocess = e => { raw.push(new Float32Array(e.inputBuffer.getChannelData(0))) }
      ac.createMediaStreamSource(stream).connect(sp); sp.connect(mute); mute.connect(ac.destination)
    }
  } catch { /* no meter, recording still works */ }
  const rate = ac?.sampleRate || 48000
  const cleanup = () => { cancelAnimationFrame(raf); try { sp?.disconnect() } catch { /* ignore */ } try { ac?.close() } catch { /* ignore */ } stream.getTracks().forEach(t => t.stop()) }
  const pick = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find(m => MediaRecorder.isTypeSupported(m))
  let rec: MediaRecorder
  // speech only, kept very small: mono Opus at 16 kbps is about 120 KB a minute and still clear for transcription
  try { rec = new MediaRecorder(stream, { ...(pick ? { mimeType: pick } : {}), audioBitsPerSecond: 16000 }) }
  catch { try { rec = new MediaRecorder(stream, pick ? { mimeType: pick } : undefined) } catch (e) { cleanup(); throw e } }
  const chunks: Blob[] = [], t0 = Date.now()
  rec.ondataavailable = e => { if (e.data?.size) chunks.push(e.data) }
  rec.start(1000)
  const mime = (rec.mimeType || pick || 'audio/webm').split(';')[0]
  return { label, stop: () => new Promise((res, rej) => {
    rec.onstop = async () => {
      const muted = track?.muted || track?.readyState === 'ended'
      cleanup()
      const b = new Blob(chunks, { type: mime }), secs = Math.round((Date.now() - t0) / 1000)
      console.info('[voice] recorded', { bytes: b.size, secs, peak: Math.round(peak * 100) / 100, muted })
      if (secs < 1) return rej(new Error('That was too short. Press Start, speak, then press Stop.'))
      if (b.size < 1500 || muted || (ac && peak < 0.01)) return rej(Object.assign(new Error(`No sound came from "${label}". ${SILENT_HELP}`), { name: 'NoAudio' }))
      const buf = new Uint8Array(await b.arrayBuffer()); let s = ''
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000))
      res({ base64: btoa(s), mime, seconds: Math.round((Date.now() - t0) / 100) / 10, bytes: b.size, ...(opts.pcm ? { pcm: to16k(raw, rate) } : {}) })
    }
    try { rec.stop() } catch { cleanup(); rej(new Error('Nothing was recorded.')) }
  }) }
}

/** Float samples at `rate` → 16 kHz 16-bit PCM (averaging each output sample's window, which also filters out hiss). */
export function to16k(chunks: Float32Array[], rate: number): Int16Array {
  let n = 0; for (const c of chunks) n += c.length
  const all = new Float32Array(n); let o = 0; for (const c of chunks) { all.set(c, o); o += c.length }
  const step = rate / 16000, out = new Int16Array(Math.floor(n / step))
  for (let i = 0; i < out.length; i++) {
    const a = Math.floor(i * step), b = Math.max(a + 1, Math.floor((i + 1) * step)); let sum = 0
    for (let k = a; k < b && k < n; k++) sum += all[k]
    const v = Math.max(-1, Math.min(1, sum / (b - a))); out[i] = v < 0 ? v * 0x8000 : v * 0x7fff
  }
  return out
}

/** Split 16 kHz PCM into pieces of at most `maxSec`, cutting at the quietest 100 ms in the last 6 s of each piece. */
export function splitPcm(pcm: Int16Array, maxSec = 45): Int16Array[] {
  const R = 16000, max = maxSec * R, win = R / 10, out: Int16Array[] = []
  let start = 0
  while (pcm.length - start > max) {
    let best = start + max, bestE = Infinity
    for (let w = start + max - 6 * R; w + win <= start + max; w += win) { let e = 0; for (let k = w; k < w + win; k++) e += Math.abs(pcm[k]); if (e < bestE) { bestE = e; best = w + win / 2 } }
    out.push(pcm.subarray(start, best)); start = best
  }
  out.push(pcm.subarray(start))
  return out
}

export function b64(bytes: Uint8Array): string { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s) }

/** Open the chosen microphone for a few seconds only to show its level (the "Test microphone" button). */
export async function testMic(onLevel: (v: number) => void, ms = 4000): Promise<{ label: string; peak: number }> {
  const r = await recordAudio(onLevel)
  await new Promise(res => setTimeout(res, ms))
  try { await r.stop(); return { label: r.label, peak: 1 } } catch (e: any) { if (e?.name === 'NoAudio') return { label: r.label, peak: 0 }; throw e }
}
