import { Hono } from 'hono'
import { z } from 'zod'
import { sql, HttpError } from '../db.js'
import { body, me, type Env } from '../app.js'
import { requireAuth } from '../lib/auth.js'
import { detectForm } from '../../shared/rx.js'

const STARTER = ['paracetamol tablets ip 500%', 'pantoprazole%tablets%40%', 'cetirizine%tablets%10%', 'azithromycin tablets ip 500%', 'amoxicillin%capsules%500%', 'metformin%tablets ip 500%', 'amlodipine%tablets%5%', 'atorvastatin%tablets%10%', 'telmisartan%tablets%40%', 'omeprazole%capsules%20%', 'ondansetron%tablets%4%', 'diclofenac%tablets%50%', 'ibuprofen%tablets%400%', 'montelukast%tablets%10%', 'levocetirizine%tablets%5%']
const r = new Hono<Env>()
r.use('*', requireAuth())

/** Search order: the doctor's own frequently used medicines, then prefix matches, then fuzzy matches.
    Jan Aushadhi generics rank above brands with equal match quality. */
r.get('/', async c => {
  const q = (c.req.query('q') || '').trim().toLowerCase()
  const cid = me(c).clinic_id
  if (q.length < 2) {
    const used = await sql()`select name, defaults, uses from arx.med_usage where clinic_id = ${cid} order by uses desc, last_used desc limit 15`
    if (used.length >= 5) return c.json(used)
    // new clinic: suggest common generics until the doctor's own favourites build up
    const starter = await sql()`select id, name, kind, category, manufacturer, pack, price::float as price, form from arx.medicines
      where kind = 'ja' and lower(name) like any(${STARTER}::text[]) order by name limit 15`
    return c.json([...used, ...starter])
  }
  const db = sql()
  const [fav, hits] = await Promise.all([
    db`select name, defaults, uses from arx.med_usage where clinic_id = ${cid} and lower(name) like ${'%' + q + '%'} order by uses desc limit 6`,
    db`select id, name, kind, category, manufacturer, pack, price::float as price, form,
          (lower(name) like ${q + '%'}) as prefix, extensions.similarity(lower(name), ${q}) as sim
        from arx.medicines
        where (clinic_id is null or clinic_id = ${cid})
          and (lower(name) like ${q + '%'} or lower(name) operator(extensions.%) ${q} or lower(name) like ${'% ' + q + '%'})
        order by (lower(name) like ${q + '%'}) desc, (kind = 'ja') desc, extensions.similarity(lower(name), ${q}) desc, length(name)
        limit 25`,
  ])
  const seen = new Set(fav.map(f => f.name.toLowerCase()))
  return c.json([
    ...fav.map(f => ({ name: f.name, kind: f.defaults?.kind || 'brand', form: f.defaults?.form || detectForm(f.name), defaults: f.defaults, uses: f.uses, favourite: true })),
    ...hits.filter(h => !seen.has(h.name.toLowerCase())).slice(0, 20).map(h => ({ ...h, form: h.form || detectForm(h.name) })),
  ])
})

/** Cheapest Jan Aushadhi product with the same main salt(s) and strength. */
const NOISE = new Set(['tablet', 'tablets', 'capsule', 'capsules', 'syrup', 'suspension', 'injection', 'sachet', 'sachets', 'cream', 'ointment', 'drops', 'drop', 'kit', 'strip', 'forte', 'plus', 'gastro', 'resistant', 'release', 'extended', 'sustained', 'prolonged', 'delayed', 'film', 'coated', 'dispersible', 'oral', 'flavour', 'sugar', 'free', 'with', 'sodium', 'hydrochloride', 'respules', 'inhaler', 'rotacap', 'rotacaps', 'solution', 'powder', 'lotion', 'spray', 'combipack'])
r.get('/ja', async c => {
  const name = (c.req.query('name') || '').toLowerCase()
  const words = (name.match(/[a-z]{5,}/g) || []).filter(w => !NOISE.has(w))
  if (!words.length) return c.json(null)
  const mg = name.match(/(\d+(?:\.\d+)?)\s*(mg|mcg|g|iu)\b/)
  const salts = words.slice(0, 2)
  const rows = await sql()`select name, price::float as price, pack from arx.medicines where kind = 'ja' and price > 0
    and lower(name) like ${salts[0] + '%'} and lower(name) like all(${salts.map(s => '%' + s + '%')}::text[])
    ${mg ? sql()`and lower(name) ~ ${'(^|[^0-9.])' + mg[1].replace('.', '\\.') + '\\s*' + mg[2]}` : sql()``}
    order by length(name), price limit 1`
  return c.json(rows[0] || null)
})

r.post('/custom', requireAuth('doctor', 'admin'), async c => {
  const b = await body(c, z.object({ name: z.string().min(2).max(200) }))
  const [m] = await sql()`insert into arx.medicines (name, kind, form, clinic_id) values (${b.name}, 'custom', ${detectForm(b.name)}, ${me(c).clinic_id}) returning id, name, kind, form`
  return c.json(m)
})

export default r
