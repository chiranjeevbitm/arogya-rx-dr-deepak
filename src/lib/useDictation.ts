import { useEffect, useRef, useState } from 'react'
import { api } from './api'
import { startDictation, recordAudio, micMessage } from './media'

/** Speech to text for the dialogs: live browser speech when it works, otherwise record audio and transcribe it on the server. */
export function useDictation(lang: string, toast: (m: string, kind?: 'err') => void) {
  const [text, setText] = useState(''), [interim, setInterim] = useState(''), [rec, setRec] = useState<'idle' | 'live' | 'audio'>('idle'), [transcribing, setTranscribing] = useState(false)
  const ctl = useRef<{ stop: () => any } | null>(null), base = useRef('')
  useEffect(() => () => { try { ctl.current?.stop() } catch { /* ignore */ } }, [])
  const record = async () => {
    try {
      const a = await recordAudio()
      ctl.current = { stop: async () => {
        setRec('idle'); setTranscribing(true)
        try { const { base64, mime } = await a.stop(); const t = await api<{ text: string }>('/ai/transcribe', { body: { audio_base64: base64, mime } }); setText(x => (x ? x + ' ' : '') + t.text) }
        catch (e: any) { toast(e.message, 'err') } finally { setTranscribing(false) }
      } }
      setRec('audio')
    } catch (e: any) { setRec('idle'); toast(micMessage(e), 'err') }
  }
  const start = async () => {
    base.current = text ? text + ' ' : ''
    const r = startDictation(lang, (f, i) => { setText(base.current + f); setInterim(i) }, (err, fallback) => {
      ctl.current = null; setInterim(''); setRec('idle')
      if (fallback) { record(); return }
      if (err) toast(err, 'err')
    })
    if (r) { ctl.current = r; setRec('live'); return }
    await record()
  }
  const stop = () => { const c = ctl.current; ctl.current = null; setInterim(''); setRec('idle'); try { c?.stop() } catch { /* ignore */ } }
  return { text, setText, interim, rec, transcribing, start, stop }
}
