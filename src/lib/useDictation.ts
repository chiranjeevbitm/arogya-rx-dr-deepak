import { useEffect, useRef, useState } from 'react'
import { api } from './api'
import { startDictation, recordAudio, micMessage, liveSpeech } from './media'

export type DictMode = 'record' | 'live'
const MODE_KEY = 'arx.voiceMode'

/** Speech to text for the dialogs.
    record (default): record the microphone, then the server turns it into text (Groq Whisper, free; OpenAI as backup).
      Works in every browser and is better at Hinglish than live browser speech.
    live: the browser's own live speech (Chrome/Edge), words appear while speaking; falls back to record if it gives nothing.
    status: one plain line about what is happening or what went wrong; level: microphone loudness 0..1 while recording. */
export function useDictation(lang: string, toast: (m: string, kind?: 'err') => void) {
  const [text, setText] = useState(''), [interim, setInterim] = useState(''), [rec, setRec] = useState<'idle' | 'live' | 'audio'>('idle'), [transcribing, setTranscribing] = useState(false)
  const [mode, setModeS] = useState<DictMode>(() => { try { return (localStorage.getItem(MODE_KEY) as DictMode) || 'record' } catch { return 'record' } })
  const [status, setStatus] = useState(''), [level, setLevel] = useState(0), [secs, setSecs] = useState(0)
  const ctl = useRef<{ stop: () => any } | null>(null), base = useRef(''), peak = useRef(0), t0 = useRef(0)
  useEffect(() => () => { try { ctl.current?.stop() } catch { /* ignore */ } }, [])
  useEffect(() => { if (rec === 'idle') return; const t = setInterval(() => setSecs(Math.round((Date.now() - t0.current) / 1000)), 500); return () => clearInterval(t) }, [rec])
  const setMode = (m: DictMode) => { setModeS(m); setStatus(''); try { localStorage.setItem(MODE_KEY, m) } catch { /* private mode */ } }

  const record = async () => {
    try {
      peak.current = 0
      const a = await recordAudio(v => { setLevel(v); if (v > peak.current) peak.current = v })
      t0.current = Date.now(); setSecs(0)
      setStatus('Recording. Speak now, then press Stop.')
      ctl.current = { stop: async () => {
        setRec('idle'); setLevel(0)
        const quiet = peak.current < 0.04
        setTranscribing(true); setStatus('Turning speech into text…')
        try {
          const { base64, mime } = await a.stop()
          const t = await api<{ text: string }>('/ai/transcribe', { body: { audio_base64: base64, mime, lang: lang.startsWith('en') ? 'en' : 'hi' } })
          const words = (t.text || '').trim()
          if (!words) setStatus(quiet ? 'No sound reached the microphone. Check that the right microphone is chosen and not muted (lock icon next to the address → Microphone).' : 'No words were recognised. Speak a little louder and closer, then try again.')
          else { setText(x => (x ? x + ' ' : '') + words); setStatus('') }
        } catch (e: any) { setStatus(e.message); toast(e.message, 'err') } finally { setTranscribing(false) }
      } }
      setRec('audio')
    } catch (e: any) { setRec('idle'); const m = micMessage(e); setStatus(m); toast(m, 'err') }
  }

  const live = () => {
    base.current = text ? text + ' ' : ''
    t0.current = Date.now(); setSecs(0)
    const r = startDictation(lang, (f, i) => { setText(base.current + f); setInterim(i); setStatus('') }, (err, fallback, code) => {
      ctl.current = null; setInterim(''); setRec('idle')
      if (fallback) { setStatus(`Live speech did not work here${code ? ` (${code})` : ''}, so it is recording instead. Keep speaking, then press Stop.`); record(); return }
      if (err) { setStatus(err); toast(err, 'err') }
    })
    if (!r) { setStatus(liveSpeech().why); record(); return }
    ctl.current = r; setRec('live'); setStatus('Listening (live). Speak now; words appear as you talk.')
  }

  const start = async () => { setStatus(''); if (mode === 'live') live(); else await record() }
  const stop = () => { const c = ctl.current; ctl.current = null; setInterim(''); setRec('idle'); setLevel(0); try { c?.stop() } catch { /* ignore */ } }
  return { text, setText, interim, rec, transcribing, start, stop, mode, setMode, status, level, secs }
}
