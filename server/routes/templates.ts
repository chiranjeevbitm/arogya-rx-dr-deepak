import { Hono } from 'hono'
import { z } from 'zod'
import { sql, HttpError } from '../db.js'
import { body, me, P, type Env } from '../app.js'
import { requireAuth } from '../lib/auth.js'
import { audit } from '../lib/audit.js'
import { DEFAULT_TEMPLATES } from '../../shared/settings.js'

const r = new Hono<Env>()
r.use('*', requireAuth())
const T = z.object({ name: z.string().min(2).max(60), data: z.record(z.string(), z.any()), sort: z.number().int().optional() })

r.get('/', async c => c.json(await sql()`select id, name, data, sort from arx.templates where clinic_id = ${me(c).clinic_id} order by sort, name`))
/** Adds any standard template (diabetes, hypertension, fever...) this clinic does not have yet; never changes existing ones. */
r.post('/restore-defaults', requireAuth('doctor', 'admin'), async c => {
  const have = new Set((await sql()`select lower(name) as n from arx.templates where clinic_id = ${me(c).clinic_id}`).map(x => x.n as string))
  let added = 0
  for (const d of DEFAULT_TEMPLATES) {
    if (have.has(d.name.toLowerCase())) continue
    await sql()`insert into arx.templates (clinic_id, name, data, sort) values (${me(c).clinic_id}, ${d.name}, ${sql().json(d.data as any)}, (select coalesce(max(sort),0)+1 from arx.templates where clinic_id = ${me(c).clinic_id}))`
    added++
  }
  return c.json({ added })
})
r.post('/', requireAuth('doctor', 'admin'), async c => {
  const b = await body(c, T)
  const [t] = await sql()`insert into arx.templates (clinic_id, name, data, sort) values (${me(c).clinic_id}, ${b.name}, ${sql().json(b.data)},
    coalesce(${b.sort ?? null}, (select coalesce(max(sort),0)+1 from arx.templates where clinic_id = ${me(c).clinic_id}))) returning id, name, data, sort`
  await audit(c, 'template.create', 'template', t.id)
  return c.json(t)
})
r.put('/:id', requireAuth('doctor', 'admin'), async c => {
  const b = await body(c, T)
  const [t] = await sql()`update arx.templates set name = ${b.name}, data = ${sql().json(b.data)}, sort = coalesce(${b.sort ?? null}, sort) where id = ${P(c, 'id')} and clinic_id = ${me(c).clinic_id} returning id, name, data, sort`
  if (!t) throw new HttpError(404, 'Template not found.')
  return c.json(t)
})
r.delete('/:id', requireAuth('doctor', 'admin'), async c => {
  await sql()`delete from arx.templates where id = ${P(c, 'id')} and clinic_id = ${me(c).clinic_id}`
  await audit(c, 'template.delete', 'template', P(c, 'id'))
  return c.json({ ok: true })
})
export default r
