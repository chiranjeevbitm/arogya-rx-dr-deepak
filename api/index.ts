import { handle } from 'hono/vercel'
import app from '../server/app.js'

const h = handle(app)
/** A read that failed because the database connection died is retried once here, on the fresh pool,
    so the person never sees the error. Writes are not retried (they may have been applied). */
async function withRetry(req: Request): Promise<Response> {
  const res = await h(req)
  if (req.method === 'GET' && res.status === 503 && res.headers.get('X-Db-Retry') === '1') return h(new Request(req.url, { method: 'GET', headers: req.headers }))
  return res
}
export const GET = withRetry, POST = h, PUT = h, PATCH = h, DELETE = h, OPTIONS = h
