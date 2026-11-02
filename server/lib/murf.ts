/* Murf speech to text (streaming WebSocket, India region). The browser sends 16 kHz mono 16-bit PCM to our API;
   the server streams it to Murf (the API key never leaves the server) and returns the words.
   Docs: https://murf.ai/api/docs/api-reference/speech-to-text/stream-input */
import WebSocket from 'ws'
import { HttpError } from '../db.js'

export const murfKey = () => process.env.MURF_KEY || process.env.MURF_API_KEY || ''
export const murfConfigured = () => !!murfKey()
const URL0 = () => process.env.MURF_STT_URL || 'wss://in.api.murf.ai/v1/transcription/stream-input'

const CLOSE: Record<number, string> = {
  4001: 'Murf key is wrong or missing', 4002: 'Murf could not read the audio', 4003: 'Murf account has no credit left', 4004: 'Murf is busy (too many at once), try again',
  4005: 'Murf credit ran out during this recording', 4006: 'Murf key was revoked', 4008: 'Murf timed out waiting for audio', 4010: 'Murf billing is not answering, try again', 4011: 'Murf speech service is not answering, try again',
}

/** pcm: 16-bit little-endian mono at `rate` Hz. lang 'hi' = Hinglish/Hindi (Hindi in Devanagari, English words in Latin), 'en' = English (India).
    keywords: medicine names to favour. Audio is sent at about 4x real time in 100 ms frames. */
export function murfTranscribe(pcm: Buffer, o: { lang?: 'hi' | 'en'; rate?: number; keywords?: string[]; timeoutMs?: number } = {}): Promise<string> {
  const key = murfKey()
  if (!key) return Promise.reject(new HttpError(503, 'MURF_KEY is not set in the Vercel settings.'))
  const rate = o.rate || 16000
  const kw = (o.keywords || []).map(k => k.replace(/[,]/g, ' ').trim()).filter(k => k.length >= 3).slice(0, 40)
  const q = new URLSearchParams({ language: o.lang === 'en' ? 'en_IN' : 'hi,en_IN', text_formatting: 'true' })
  if (kw.length) { q.set('keywords', kw.join(',')); q.set('alpha', '0.6') }
  const url = `${URL0()}?${q.toString().replace(/\+/g, '%20')}`
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers: { 'api-key': key }, handshakeTimeout: 10000 })
    const finals: string[] = []; let partial = '', errMsg = '', done = false, timer: ReturnType<typeof setTimeout> | undefined
    const finish = (err?: Error) => { if (done) return; done = true; clearTimeout(timer); try { ws.terminate() } catch { /* ignore */ } err ? reject(err) : resolve(finals.join(' ').replace(/\s+/g, ' ').trim() || partial.trim()) }
    timer = setTimeout(() => finish(new HttpError(504, 'Murf took too long to answer. Try a shorter recording.')), o.timeoutMs ?? 50000)
    ws.on('open', async () => {
      try {
        ws.send(JSON.stringify({ type: 'AudioConfig', codec: 'pcm_s16le', sample_rate: String(rate), channels: '1' }))
        const frame = Math.round(rate * 0.1) * 2   // 100 ms
        for (let i = 0; i < pcm.length && !done; i += frame) {
          ws.send(pcm.subarray(i, Math.min(pcm.length, i + frame)))
          if ((i / frame) % 4 === 3) await new Promise(r => setTimeout(r, 100))   // ~4x real time
        }
        if (!done) ws.send(JSON.stringify({ type: 'CloseStream' }))
      } catch (e: any) { finish(new HttpError(502, `Murf: ${e?.message || e}`)) }
    })
    ws.on('message', (data, isBinary) => {
      if (isBinary) return
      let m: any; try { m = JSON.parse(String(data)) } catch { return }
      if (m.type === 'final' && typeof m.transcript === 'string') { if (m.transcript.trim()) finals.push(m.transcript.trim()); partial = '' }
      else if (m.type === 'partial' && typeof m.transcript === 'string') partial = m.transcript
      else if (m.type === 'Error') errMsg = String(m.message || '')
      else if (m.type === 'QuotaWarning') console.warn('[murf] low balance', m.remaining_funds)
    })
    ws.on('unexpected-response', (_req, res) => finish(new HttpError(502, res.statusCode === 401 || res.statusCode === 403 ? CLOSE[4001] : `Murf refused the connection (${res.statusCode})`)))
    ws.on('error', e => finish(new HttpError(502, `Murf connection failed: ${e.message}`)))
    ws.on('close', code => {
      if (code === 1000 || code === 1005) return finish()
      finish(new HttpError(502, CLOSE[code] || `Murf closed the connection (${code}${errMsg ? ': ' + errMsg : ''})`))
    })
  })
}

/** Settings check: half a second of silence through Murf; a clean close means the key, credit and service are fine. */
export async function murfCheck(): Promise<{ ok: boolean; ms: number; note: string }> {
  const t0 = Date.now()
  try { await murfTranscribe(Buffer.alloc(16000), { timeoutMs: 15000 }); return { ok: true, ms: Date.now() - t0, note: 'working' } }
  catch (e: any) { return { ok: false, ms: Date.now() - t0, note: String(e?.message || e) } }
}
