/* LLM calls via OpenAI's Responses API (default model gpt-5-nano) with strict JSON-schema output.
   Every output is a draft that the doctor reviews; nothing is saved or printed from here. */
import { sql, HttpError } from '../db.js'

export const aiConfigured = () => !!process.env.OPENAI_API_KEY
export const aiModel = () => process.env.AI_MODEL || 'gpt-5-nano'

type Part = { type: 'input_text'; text: string } | { type: 'input_image'; image_url: string; detail?: 'low' | 'high' | 'auto' }

export async function aiJson<T>(o: {
  kind: string; clinicId: string; userId: string; system: string; parts: Part[]; schemaName: string; schema: object; effort?: 'minimal' | 'low' | 'medium'; maxTokens?: number
}): Promise<T> {
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new HttpError(503, 'AI is not set up yet. Add OPENAI_API_KEY in the Vercel settings.')
  const t0 = Date.now()
  let ok = false, err: string | null = null, usage: any = {}
  try {
    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: aiModel(),
        reasoning: { effort: o.effort || 'low' },
        max_output_tokens: o.maxTokens || 4000,
        instructions: o.system,
        input: [{ role: 'user', content: o.parts }],
        text: { format: { type: 'json_schema', name: o.schemaName, strict: true, schema: o.schema } },
        store: false,
      }),
      signal: AbortSignal.timeout(55000),
    })
    const body: any = await r.json().catch(() => ({}))
    if (!r.ok) throw new HttpError(502, `AI request failed: ${body?.error?.message || r.status}`)
    usage = body.usage || {}
    const text = body.output_text ?? (body.output || []).flatMap((x: any) => x.content || []).filter((c: any) => c.type === 'output_text').map((c: any) => c.text).join('')
    if (!text) throw new HttpError(502, body.status === 'incomplete' ? 'The AI ran out of space before finishing. Try a shorter recording or a clearer photo.' : 'The AI returned no answer.')
    const out = JSON.parse(text) as T
    ok = true
    return out
  } catch (e: any) {
    err = String(e?.message || e).slice(0, 300)
    if (e instanceof HttpError) throw e
    throw new HttpError(502, e?.name === 'TimeoutError' ? 'The AI took too long. Try again.' : `AI error: ${err}`)
  } finally {
    sql()`insert into arx.ai_usage (clinic_id, user_id, kind, provider, model, input_tokens, output_tokens, ms, ok, error)
      values (${o.clinicId}, ${o.userId}, ${o.kind}, 'openai', ${aiModel()}, ${usage.input_tokens ?? null}, ${usage.output_tokens ?? null}, ${Date.now() - t0}, ${ok}, ${err})`.catch(() => {})
  }
}

/** Speech-to-text fallback for browsers without built-in recognition. */
export async function transcribe(audio: Buffer, mime: string): Promise<string> {
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new HttpError(503, 'AI is not set up yet.')
  const fd = new FormData()
  fd.append('file', new Blob([new Uint8Array(audio)], { type: mime }), 'consult.' + (mime.includes('webm') ? 'webm' : mime.includes('mp4') ? 'mp4' : 'ogg'))
  fd.append('model', process.env.AI_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe')
  fd.append('prompt', 'Doctor dictating a prescription in Hinglish (Hindi and English mixed). Medicine names, doses like 500 mg, frequencies like 1-0-1.')
  const r = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: fd, signal: AbortSignal.timeout(55000) })
  const b: any = await r.json().catch(() => ({}))
  if (!r.ok) throw new HttpError(502, `Transcription failed: ${b?.error?.message || r.status}`)
  return String(b.text || '')
}
