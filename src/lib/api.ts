export class ApiError extends Error { constructor(public status: number, message: string, public code?: string) { super(message) } }

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  let r: Response
  try {
    r = await fetch('/api' + path, { method: opts.method || (opts.body ? 'POST' : 'GET'), credentials: 'same-origin', headers: opts.body ? { 'Content-Type': 'application/json' } : {}, body: opts.body ? JSON.stringify(opts.body) : undefined, signal: opts.signal })
  } catch (e: any) {
    if (e?.name === 'AbortError') throw e
    throw new ApiError(0, 'No internet connection. Your work is kept on this screen; try again when you are back online.')
  }
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
