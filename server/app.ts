import { Hono } from 'hono'
import type { Context } from 'hono'
import { z } from 'zod'
import { ensureSchema, HttpError, warmDb, markDbUse, resetDb, isDeadConnection, sql, dbGen } from './db.js'
import type { AuthUser } from './lib/auth.js'
import auth from './routes/auth.js'
import setup from './routes/setup.js'
import clinic from './routes/clinic.js'
import patients from './routes/patients.js'
import visits from './routes/visits.js'
import rx from './routes/rx.js'
import medicines from './routes/medicines.js'
import templates from './routes/templates.js'
import appointments from './routes/appointments.js'
import publicRoutes from './routes/public.js'
import bills from './routes/bills.js'
import messages from './routes/messages.js'
import ai from './routes/ai.js'
import importer from './routes/import.js'
import ask from './routes/ask.js'
import recordings from './routes/recordings.js'

export type Env = { Variables: { user: AuthUser; dbGen: number } }
export const me = (c: Context) => c.get('user') as AuthUser
export const P = (c: Context, k: string): string => {
  const v = c.req.param(k)
  if (!v) throw new HttpError(400, `Missing ${k}.`)
  return v
}

export async function body<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  let raw: unknown
  try { raw = await c.req.json() } catch { throw new HttpError(400, 'Request body must be JSON.') }
  const r = schema.safeParse(raw)
  if (!r.success) {
    const i = r.error.issues[0]
    throw new HttpError(400, `${i.path.join('.') || 'input'}: ${i.message}`)
  }
  return r.data
}

const app = new Hono<Env>().basePath('/api')

app.use('*', async (c, next) => {
  // same-origin only for state-changing requests (CSRF defence alongside SameSite=Lax cookies)
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) && !c.req.path.startsWith('/api/public/') && !c.req.path.startsWith('/api/cron/')) {
    const origin = c.req.header('origin')
    const host = c.req.header('x-forwarded-host') || c.req.header('host')
    if (origin && host && new URL(origin).host !== host) throw new HttpError(403, 'Cross-site request blocked.')
  }
  const t0 = performance.now()
  c.set('dbGen', dbGen())
  // a query stuck on a dead socket would otherwise hang until the 60 s platform limit; give up early so the request can be retried on a fresh pool
  const budget = /^\/api\/(ai|ask|import|setup|messages\/reminders|cron)\b/.test(c.req.path) ? 58000 : /^\/api\/(visits\/(next|[^/]+\/start)|rx\/[^/]+$)/.test(c.req.path) ? 25000 : 12000
  let timer: ReturnType<typeof setTimeout> | undefined, warm = 0
  const work = (async () => {
    if (!c.req.path.startsWith('/api/health')) { await warmDb(); await ensureSchema(); warm = performance.now() - t0 }
    await next()
  })()
  work.catch(() => {})   // after a timeout the late failure is already answered; do not let it surface as an unhandled rejection
  try {
    await Promise.race([work, new Promise((_, rej) => { timer = setTimeout(() => rej(Object.assign(new Error('request timed out waiting for the database'), { code: 'REQUEST_TIMEOUT' })), budget) })])
  } finally {
    clearTimeout(timer)
    markDbUse()
    // lets the browser (and the Speed check in Settings) tell server time apart from network time
    c.header('Server-Timing', `db-ready;dur=${warm.toFixed(0)}, total;dur=${(performance.now() - t0).toFixed(0)}`)
  }
})

app.get('/health', async c => {
  if (c.req.query('db') === '1') { await warmDb(true); await ensureSchema(); await sql()`select 1` }
  return c.json({ ok: true, at: new Date().toISOString() })
})
app.route('/auth', auth)
app.route('/setup', setup)
app.route('/clinic', clinic)
app.route('/patients', patients)
app.route('/visits', visits)
app.route('/rx', rx)
app.route('/medicines', medicines)
app.route('/templates', templates)
app.route('/appointments', appointments)
app.route('/public', publicRoutes)
app.route('/bills', bills)
app.route('/messages', messages)
app.route('/ai', ai)
app.route('/import', importer)
app.route('/ask', ask)
app.route('/recordings', recordings)
app.route('/cron', messages)

app.notFound(c => c.json({ error: 'Not found' }, 404))
app.onError((e, c) => {
  if (e instanceof HttpError) return c.json({ error: e.message, code: e.code }, e.status as any)
  const pg = e as any
  if (pg?.code === '23505') return c.json({ error: 'This already exists.' }, 409)
  if (pg?.code === '22P02') return c.json({ error: 'Invalid id.' }, 400)
  // the database is overloaded or a query ran too long: do not throw connections away (reconnecting adds load), do not retry
  if (pg?.code === 'REQUEST_TIMEOUT' || pg?.code === '57014') {
    console.error('[api] slow request', pg.code, c.req.method, c.req.path)
    return c.json({ error: 'The database is slow to answer right now. Please try again in a moment.', code: 'DB_BUSY' }, 503)
  }
  if (isDeadConnection(pg)) {
    resetDb(c.get('dbGen'))
    console.error('[api] dead db connection', pg?.code || pg?.errno, c.req.method, c.req.path)
    return c.json({ error: 'The server lost its database connection. Please try again.', code: 'DB_RETRY' }, 503, { 'X-Db-Retry': '1' })
  }
  console.error('[api]', c.req.method, c.req.path, e)
  return c.json({ error: 'Something went wrong on the server. Please try again.' }, 500)
})

export default app
