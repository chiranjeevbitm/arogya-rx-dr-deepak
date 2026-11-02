export class ApiError extends Error { constructor(public status: number, message: string, public code?: string) { super(message) } }

/** Round-trip times of the most recent API calls (browser view and server view), for the Speed check in Settings. */
export type Timing = { path: string; ms: number; server: number | null; at: number }
export const timings: Timing[] = []
function logTiming(path: string, t0: number, r: Response) {
  const m = /total;dur=([\d.]+)/.exec(r.headers.get('Server-Timing') || '')
  timings.push({ path: path.split('?')[0], ms: Math.round(performance.now() - t0), server: m ? Math.round(Number(m[1])) : null, at: Date.now() })
  if (timings.length > 60) timings.shift()
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; signal?: AbortSignal; timeoutMs?: number; _retried?: boolean } = {}): Promise<T> {
  const method = opts.method || (opts.body ? 'POST' : 'GET')
  // AI reading and imports legitimately take 10-50 s; everything else is cut at 15 s
  const limit = opts.timeoutMs ?? (/^\/(ai|ask|import|setup)\b/.test(path) ? 70000 : 15000)
  let r: Response | undefined, lastErr: any
  const t0 = performance.now()
  // a request that hangs (a sleeping server or a dropped connection) is cut at 15 s (see limit); reads are retried once on a fresh connection
  for (let attempt = 0; attempt < (method === 'GET' ? 2 : 1); attempt++) {
    const ctl = new AbortController(); let timedOut = false
    const timer = setTimeout(() => { timedOut = true; ctl.abort() }, limit)
    const onAbort = () => ctl.abort(); opts.signal?.addEventListener('abort', onAbort)
    try {
      r = await fetch('/api' + path, { method, credentials: 'same-origin', headers: opts.body ? { 'Content-Type': 'application/json' } : {}, body: opts.body ? JSON.stringify(opts.body) : undefined, signal: ctl.signal })
      break
    } catch (e: any) {
      if (e?.name === 'AbortError' && !timedOut) throw e
      lastErr = timedOut ? new ApiError(0, 'The server is taking too long. Wait a moment and try again.') : new ApiError(0, 'No internet connection. Your work is kept on this screen; try again when you are back online.')
    } finally { clearTimeout(timer); opts.signal?.removeEventListener('abort', onAbort) }
  }
  if (!r) throw lastErr
  logTiming(path, t0, r)
  const text = await r.text()
  // the server dropped a stale database connection and reset it: one safe retry for reads and AI drafts
  if (r.status === 503 && /DB_RETRY/.test(text) && (method === 'GET' || path.startsWith('/ai/')) && !(opts as any)._retried) return api<T>(path, { ...opts, _retried: true } as any)
  let j: any = null
  try { j = text ? JSON.parse(text) : null } catch { j = { error: text } }
  if (!r.ok) {
    if (r.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event('arx:logout'))
    throw new ApiError(r.status, j?.error || `Request failed (${r.status})`, j?.code)
  }
  return j as T
}

export const fileUrl = (id: string) => `/api/clinic/files/${id}`
