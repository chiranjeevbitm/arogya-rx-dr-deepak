import { Hono } from 'hono'
import type { Context } from 'hono'
import { z } from 'zod'
import { ensureSchema, HttpError, sql } from './db.js'
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

export type Env = { Variables: { user: AuthUser } }
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
  if (!c.req.path.startsWith('/api/health')) await ensureSchema()
  await next()
})

app.get('/health', c => c.json({ ok: true, at: new Date().toISOString() }))
// TEMPORARY diagnostic (removed after use)
app.get('/health/medsearch', async c => {
  const out: any = {}
  for (const q of ['dolo', 'metformin', 'azith', 'pan']) {
    try {
      const r = await sql()`select name, kind from arx.medicines
        where (lower(name) like ${q + '%'} or lower(name) operator(extensions.%) ${q} or lower(name) like ${'% ' + q + '%'})
        order by (lower(name) like ${q + '%'}) desc, (kind = 'ja') desc, extensions.similarity(lower(name), ${q}) desc, length(name) limit 25`
      out[q] = { n: r.length, first: r.slice(0, 2).map(x => x.name) }
    } catch (e: any) { out[q] = { error: String(e.message).slice(0, 160) } }
  }
  const [{ n }] = await sql()`select count(*)::int as n from arx.medicines`
  out.total = n
  return c.json(out)
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
app.route('/cron', messages)

app.notFound(c => c.json({ error: 'Not found' }, 404))
app.onError((e, c) => {
  if (e instanceof HttpError) return c.json({ error: e.message, code: e.code }, e.status as any)
  const pg = e as any
  if (pg?.code === '23505') return c.json({ error: 'This already exists.' }, 409)
  if (pg?.code === '22P02') return c.json({ error: 'Invalid id.' }, 400)
  console.error('[api]', c.req.method, c.req.path, e)
  return c.json({ error: 'Something went wrong on the server. Please try again.' }, 500)
})

export default app
