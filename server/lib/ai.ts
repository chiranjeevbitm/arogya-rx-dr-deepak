/* LLM calls via OpenAI's Responses API (default model gpt-5-nano) with strict JSON-schema output.
   Every output is a draft that the doctor reviews; nothing is saved or printed from here. */
import { sql, HttpError, warmDb } from '../db.js'

/* Providers. Groq (free tier: Whisper speech-to-text and open models with strict JSON output) is used first when
   GROQ_API_KEY is set; OpenAI is used for photos/PDFs and as the fallback. If one provider fails (no credit, bad key,
   limit reached, down), the next one is tried. AI_PROVIDER=openai puts OpenAI first. */
const openaiKey = () => process.env.OPENAI_API_KEY || ''
const groqKey = () => process.env.GROQ_API_KEY || ''
export const aiConfigured = () => !!(openaiKey() || groqKey())
const base = () => (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')
const GROQ = 'https://api.groq.com/openai/v1'
export const aiModel = () => process.env.AI_MODEL || 'gpt-5-nano'
const groqModel = () => process.env.GROQ_MODEL || 'openai/gpt-oss-120b'
const groqSttModel = () => process.env.GROQ_TRANSCRIBE_MODEL || 'whisper-large-v3-turbo'
type Provider = 'groq' | 'openai'
/** Text-only work: Groq first when set (free), then OpenAI. Photos and PDFs: OpenAI only. */
function order(textOnly: boolean): Provider[] {
  const all: Provider[] = process.env.AI_PROVIDER === 'openai' ? ['openai', 'groq'] : ['groq', 'openai']
  return all.filter(p => (p === 'groq' ? !!groqKey() && textOnly : !!openaiKey()))
}
/** Names shown in Settings, e.g. "Groq (free) + OpenAI gpt-5-nano". */
export function aiProviders() {
  return [groqKey() ? `Groq (free) ${groqModel()}` : '', openaiKey() ? `OpenAI ${aiModel()}` : ''].filter(Boolean).join(' + ') || 'none'
}

/** One plain-words reason from a provider's error reply. */
function why(p: Provider, status: number, b: any): string {
  const name = p === 'groq' ? 'Groq' : 'OpenAI', code = b?.error?.code || b?.error?.type || '', msg = String(b?.error?.message || '')
  if (status === 401 || code === 'invalid_api_key') return `${name} key is wrong or was revoked`
  if (code === 'insufficient_quota' || /quota|billing|credit/i.test(msg)) return `${name} account has no credit left`
  if (status === 429) return `${name} limit reached for now, try again in a minute`
  if (status >= 500) return `${name} is not answering right now`
  return `${name}: ${msg || status}`
}

type Part = { type: 'input_text'; text: string } | { type: 'input_image'; image_url: string; detail?: 'low' | 'high' | 'auto' } | { type: 'input_file'; filename: string; file_data: string }

export async function aiJson<T>(o: {
  kind: string; clinicId: string; userId: string; system: string; parts: Part[]; schemaName: string; schema: object; effort?: 'minimal' | 'low' | 'medium'; maxTokens?: number
}): Promise<T> {
  const textOnly = o.parts.every(p => p.type === 'input_text')
  const list = order(textOnly)
  if (!list.length) throw new HttpError(503, textOnly ? 'AI is not set up yet. Add GROQ_API_KEY (free) or OPENAI_API_KEY in the Vercel settings.' : 'Reading photos and PDFs needs OPENAI_API_KEY in the Vercel settings.')
  const reasons: string[] = [], started = Date.now()
  for (let k = 0; k < list.length; k++) {
    const p = list[k], t0 = Date.now()
    // stay inside the 60 s function limit when a second provider is tried
    const budget = Math.max(8000, 55000 - (Date.now() - started)), limit = k < list.length - 1 ? Math.min(budget, p === 'groq' ? 30000 : 40000) : budget
    let ok = false, err: string | null = null, usage: any = {}
    try {
      const text = p === 'groq' ? await groqJson(o, limit, u => { usage = u }) : await openaiJson(o, limit, u => { usage = u })
      const out = JSON.parse(text) as T
      ok = true
      await warmDb(true)   // the connection sat idle during the AI call: check it before the next query
      return out
    } catch (e: any) {
      err = String(e?.message || e).slice(0, 300)
      reasons.push(e?.name === 'TimeoutError' ? `${p === 'groq' ? 'Groq' : 'OpenAI'} took too long` : err)
    } finally {
      sql()`insert into arx.ai_usage (clinic_id, user_id, kind, provider, model, input_tokens, output_tokens, ms, ok, error)
        values (${o.clinicId}, ${o.userId}, ${o.kind}, ${p}, ${p === 'groq' ? groqModel() : aiModel()}, ${usage.input_tokens ?? usage.prompt_tokens ?? null}, ${usage.output_tokens ?? usage.completion_tokens ?? null}, ${Date.now() - t0}, ${ok}, ${err})`.catch(() => {})
    }
  }
  throw new HttpError(502, `AI could not answer: ${reasons.join('; ')}.`)
}

async function openaiJson(o: Parameters<typeof aiJson>[0], ms: number, onUsage: (u: any) => void): Promise<string> {
  const r = await fetch(`${base()}/responses`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${openaiKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: aiModel(), reasoning: { effort: o.effort || 'low' }, max_output_tokens: o.maxTokens || 4000, instructions: o.system,
      input: [{ role: 'user', content: o.parts }], text: { format: { type: 'json_schema', name: o.schemaName, strict: true, schema: o.schema } }, store: false,
    }),
    signal: AbortSignal.timeout(ms),
  })
  const body: any = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(why('openai', r.status, body))
  onUsage(body.usage || {})
  const text = body.output_text ?? (body.output || []).flatMap((x: any) => x.content || []).filter((c: any) => c.type === 'output_text').map((c: any) => c.text).join('')
  if (!text) throw new Error(body.status === 'incomplete' ? 'OpenAI ran out of space before finishing' : 'OpenAI returned no answer')
  return text
}

async function groqJson(o: Parameters<typeof aiJson>[0], ms: number, onUsage: (u: any) => void): Promise<string> {
  const r = await fetch(`${GROQ}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${groqKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: groqModel(), temperature: 0.1, max_completion_tokens: Math.max(o.maxTokens || 4000, 2000),
      reasoning_effort: o.effort === 'medium' ? 'medium' : 'low',
      messages: [{ role: 'system', content: o.system }, { role: 'user', content: o.parts.map(p => (p as any).text).join('\n\n') }],
      response_format: { type: 'json_schema', json_schema: { name: o.schemaName, strict: true, schema: o.schema } },
    }),
    signal: AbortSignal.timeout(ms),
  })
  const body: any = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(why('groq', r.status, body))
  onUsage(body.usage || {})
  const text = body.choices?.[0]?.message?.content
  if (!text) throw new Error(body.choices?.[0]?.finish_reason === 'length' ? 'Groq ran out of space before finishing' : 'Groq returned no answer')
  return text
}

/** Speech to text for browsers whose live speech does not work (Brave, Firefox, some phones, no network to the speech service).
    Groq Whisper first (free), then OpenAI. lang: 'hi' (Hinglish/Hindi) or 'en'. */
export async function transcribe(audio: Buffer, mime: string, lang: 'hi' | 'en' = 'hi'): Promise<string> {
  const list: Provider[] = (process.env.AI_PROVIDER === 'openai' ? ['openai', 'groq'] : ['groq', 'openai']).filter(p => (p === 'groq' ? groqKey() : openaiKey())) as Provider[]
  if (!list.length) throw new HttpError(503, 'Speech to text is not set up. Add GROQ_API_KEY (free) or OPENAI_API_KEY in the Vercel settings.')
  const ext = mime.includes('webm') ? 'webm' : mime.includes('mp4') ? 'mp4' : mime.includes('ogg') ? 'ogg' : mime.includes('wav') ? 'wav' : 'webm'
  // written in Roman script on purpose: Whisper tends to keep the script of the prompt, so Hinglish comes back readable
  const prompt = lang === 'en' ? 'Doctor dictating a prescription. Medicine names, doses like 500 mg, frequencies like 1-0-1, BP 130 by 80.'
    : 'Doctor dictating a prescription in Hinglish: teen din se bukhar, BP 130 by 80, Dolo 650 subah shaam khane ke baad paanch din, CBC karwa lijiye.'
  const reasons: string[] = []
  for (const p of list) {
    const fd = new FormData()
    fd.append('file', new Blob([new Uint8Array(audio)], { type: mime }), 'consult.' + ext)
    fd.append('model', p === 'groq' ? groqSttModel() : (process.env.AI_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe'))
    fd.append('prompt', prompt)
    if (lang === 'en') fd.append('language', 'en')
    if (p === 'groq') fd.append('temperature', '0')
    try {
      const r = await fetch(`${p === 'groq' ? GROQ : base()}/audio/transcriptions`, { method: 'POST', headers: { Authorization: `Bearer ${p === 'groq' ? groqKey() : openaiKey()}` }, body: fd, signal: AbortSignal.timeout(list.length > 1 && p === list[0] ? 25000 : 50000) })
      const b: any = await r.json().catch(() => ({}))
      if (!r.ok) { reasons.push(why(p, r.status, b)); continue }
      return String(b.text || '').trim()
    } catch (e: any) { reasons.push(e?.name === 'TimeoutError' ? `${p === 'groq' ? 'Groq' : 'OpenAI'} took too long` : String(e?.message || e)) }
  }
  throw new HttpError(502, `Speech to text failed: ${reasons.join('; ')}.`)
}

/** Settings → AI → Check: a tiny real call to each provider, so a missing credit or wrong key shows up before the clinic needs it. */
export async function aiCheck() {
  const out: { provider: string; ok: boolean; ms: number; note: string }[] = []
  const tiny = { kind: 'check', clinicId: '', userId: '', system: 'Reply with {"ok": true}.', parts: [{ type: 'input_text' as const, text: 'ping' }], schemaName: 'ping', schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false }, effort: 'minimal' as const, maxTokens: 300 }
  for (const p of (['groq', 'openai'] as Provider[]).filter(p => (p === 'groq' ? groqKey() : openaiKey()))) {
    const t0 = Date.now()
    try { await (p === 'groq' ? groqJson(tiny, 15000, () => {}) : openaiJson(tiny, 20000, () => {})); out.push({ provider: p === 'groq' ? `Groq ${groqModel()}` : `OpenAI ${aiModel()}`, ok: true, ms: Date.now() - t0, note: 'working' }) }
    catch (e: any) { out.push({ provider: p === 'groq' ? `Groq ${groqModel()}` : `OpenAI ${aiModel()}`, ok: false, ms: Date.now() - t0, note: e?.name === 'TimeoutError' ? 'took too long' : String(e?.message || e) }) }
  }
  return out
}
