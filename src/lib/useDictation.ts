import { useEffect, useRef, useState } from 'react'
import { api } from './api'
import { startDictation, recordAudio, micMessage, liveSpeech, splitPcm, b64, type Recorded } from './media'
import { useMe } from './session'

export type DictMode = 'record' | 'live'
const MODE_KEY = 'arx.voiceMode'

/** Speech to text for the dialogs.
    record (default): record the microphone, then the server turns it into text (Groq Whisper, free; OpenAI as backup).
      Works in every browser and is better at Hinglish than live browser speech.
    live: the browser's own live speech (Chrome/Edge), words appear while speaking; falls back to record if it gives nothing.
    status: one plain line about what is happening or what went wrong; level: microphone loudness 0..1 while recording. */
/** Where a kept recording belongs. Recordings are stored small and only the doctor can play them. */
export type KeepInfo = { kind: 'consult' | 'intake'; patient_id?: string | null; rx_id?: string | null }

export function useDictation(lang: string, toast: (m: string, kind?: 'err') => void, keep?: KeepInfo) {
  const [text, setText] = useState(''), [interim, setInterim] = useState(''), [rec, setRec] = useState<'idle' | 'live' | 'audio'>('idle'), [transcribing, setTranscribing] = useState(false)
  const murf = useMe().features.stt === 'murf'   // Murf is the only speech to text when the clinic has a Murf key: no browser live text
  const [modeS, setModeS] = useState<DictMode>(() => { try { return (localStorage.getItem(MODE_KEY) as DictMode) || 'record' } catch { return 'record' } })
  const mode: DictMode = murf ? 'record' : modeS
  const [status, setStatus] = useState(''), [level, setLevel] = useState(0), [secs, setSecs] = useState(0)
  const ctl = useRef<{ stop: () => any } | null>(null), base = useRef(''), peak = useRef(0), t0 = useRef(0), [saved, setSaved] = useState(0)
  const liveRec = useRef<Promise<Awaited<ReturnType<typeof recordAudio>> | null> | null>(null), liveText = useRef('')
  useEffect(() => () => { try { ctl.current?.stop() } catch { /* ignore */ } }, [])
  useEffect(() => { if (rec === 'idle') return; const t = setInterval(() => setSecs(Math.round((Date.now() - t0.current) / 1000)), 500); return () => clearInterval(t) }, [rec])
  const setMode = (m: DictMode) => { setModeS(m); setStatus(''); try { localStorage.setItem(MODE_KEY, m) } catch { /* private mode */ } }

  const record = async () => {
    try {
      peak.current = 0
      const a = await recordAudio(v => { setLevel(v); if (v > peak.current) peak.current = v }, { pcm: murf })
      t0.current = Date.now(); setSecs(0)
      setStatus(`Recording from ${a.label}. Speak now; the green bar should move. Then press Stop.`)
      ctl.current = { stop: async () => {
        setRec('idle'); setLevel(0)
        const quiet = peak.current < 0.04
        let audio: Recorded
        try { audio = await a.stop() } catch (e: any) { setStatus(e.message); return }
        setTranscribing(true); setStatus('Turning speech into text…')
        if (murf) return viaMurf(audio, quiet)
        try {
          const { base64, mime } = audio
          const t = await api<{ text: string; recording_id?: string | null }>('/ai/transcribe', { body: { audio_base64: base64, mime, lang: lang.startsWith('en') ? 'en' : 'hi', ...(keep ? { keep: { ...keep, seconds: audio.seconds } } : {}) } })
          if (t.recording_id) setSaved(n => n + 1)
          const words = (t.text || '').trim()
          if (!words) setStatus(quiet ? 'No sound reached the microphone. Check that the right microphone is chosen and not muted (lock icon next to the address → Microphone).' : 'No words were recognised. Speak a little louder and closer, then try again.')
          else { setText(x => (x ? x + ' ' : '') + words); setStatus('') }
        } catch (e: any) { setStatus(e.message); toast(e.message, 'err') } finally { setTranscribing(false) }
      } }
      setRec('audio')
    } catch (e: any) { setRec('idle'); const m = micMessage(e); setStatus(m); toast(m, 'err') }
  }

  /** Murf: send the 16 kHz audio in pieces (up to 45 s each, cut at pauses), join the words, then keep the small recording with them. */
  const viaMurf = async (audio: Recorded, quiet: boolean) => {
    const pieces = audio.pcm?.length ? splitPcm(audio.pcm) : []
    const words: string[] = []
    let failed: string | null = null
    try {
      if (!pieces.length) throw new Error('No audio was captured. Reload the page and try again.')
      for (let i = 0; i < pieces.length; i++) {
        if (pieces.length > 1) setStatus(`Turning speech into text… part ${i + 1} of ${pieces.length}`)
        const p = pieces[i]
        const t = await api<{ text: string }>('/ai/transcribe', { body: { pcm_base64: b64(new Uint8Array(p.buffer, p.byteOffset, p.byteLength)), rate: 16000, lang: lang.startsWith('en') ? 'en' : 'hi' }, timeoutMs: 58000 })
        if (t.text?.trim()) words.push(t.text.trim())
      }
    } catch (e: any) { failed = e.message }
    const heard = words.join(' ')
    if (heard) setText(x => (x ? x + ' ' : '') + heard)
    // keep the recording whatever happened, so nothing said is lost
    let kept = false
    if (keep) try { const r = await api<{ id: string | null }>('/recordings', { body: { ...keep, audio_base64: audio.base64, mime: audio.mime, seconds: audio.seconds, transcript: heard } }); kept = !!r.id; if (kept) setSaved(n => n + 1) } catch (e: any) { console.warn('[voice] recording not kept', e?.message) }
    if (failed) { const m = `${failed}${kept ? ' The recording was saved.' : ''}`; setStatus(m); toast(m, 'err') }
    else if (!heard) setStatus(quiet ? 'No sound reached the microphone. Check that the right microphone is chosen and not muted.' : 'No words were recognised. Speak a little louder and closer, then try again.')
    else setStatus('')
    setTranscribing(false)
  }

  /** Live text gives no audio, so record alongside it (when keeping recordings) and store it with the words heard. */
  const finishLive = async (discard: boolean) => {
    const p = liveRec.current; liveRec.current = null
    const a = p ? await p : null
    if (!a) return
    try {
      const au = await a.stop()
      if (discard || !keep) return
      const r = await api<{ id: string | null }>('/recordings', { body: { ...keep, audio_base64: au.base64, mime: au.mime, seconds: au.seconds, transcript: liveText.current } })
      if (r.id) setSaved(n => n + 1)
    } catch (e: any) { if (!discard) console.warn('[voice] recording not kept', e?.message) }
  }

  const live = () => {
    base.current = text ? text + ' ' : ''; liveText.current = ''
    t0.current = Date.now(); setSecs(0)
    const r = startDictation(lang, (f, i) => { setText(base.current + f); liveText.current = f; setInterim(i); setStatus('') }, (err, fallback, code) => {
      ctl.current = null; setInterim(''); setRec('idle')
      if (fallback) { finishLive(true).then(() => record()); setStatus(`Live speech did not work here${code ? ` (${code})` : ''}, so it is recording instead. Keep speaking, then press Stop.`); return }
      finishLive(false)
      if (err) { setStatus(err); toast(err, 'err') }
    })
    if (!r) { setStatus(liveSpeech().why); record(); return }
    if (keep) liveRec.current = recordAudio().catch(() => null)
    ctl.current = r; setRec('live'); setStatus('Listening (live). Speak now; words appear as you talk.')
  }

  const start = async () => { setStatus(''); if (mode === 'live') live(); else await record() }
  const stop = () => { const c = ctl.current; ctl.current = null; setInterim(''); setRec('idle'); setLevel(0); try { c?.stop() } catch { /* ignore */ } }
  return { text, setText, interim, rec, transcribing, start, stop, mode, setMode, status, level, secs, saved, keeping: !!keep, murf }
}
