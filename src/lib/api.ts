export class ApiError extends Error { constructor(public status: number, message: string, public code?: string) { super(message) } }

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const method = opts.method || (opts.body ? 'POST' : 'GET')
  let r: Response | undefined, lastErr: any
  // a request that hangs (a sleeping server or a dropped connection) is cut at 15 s; reads are retried once on a fresh connection
  for (let attempt = 0; attempt < (method === 'GET' ? 2 : 1); attempt++) {
    const ctl = new AbortController(); let timedOut = false
    const timer = setTimeout(() => { timedOut = true; ctl.abort() }, 15000)
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
  const text = await r.text()
  let j: any = null
  try { j = text ? JSON.parse(text) : null } catch { j = { error: text } }
  if (!r.ok) {
    if (r.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event('arx:logout'))
    throw new ApiError(r.status, j?.error || `Request failed (${r.status})`, j?.code)
  }
  return j as T
}

export const fileUrl = (id: string) => `/api/clinic/files/${id}`
