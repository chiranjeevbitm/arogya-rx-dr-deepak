import { Hono } from 'hono'
import { z } from 'zod'
import { sql, HttpError, nextCounter } from '../db'
import { body, me, P, type Env } from '../app'
import { requireAuth } from '../lib/auth'
import { audit } from '../lib/audit'
import { istToday } from '../../shared/rx'

const r = new Hono<Env>()
r.use('*', requireAuth())

r.get('/', async c => {
  const from = c.req.query('from') || istToday(), to = c.req.query('to') || from
  const rows = await sql()`select b.id, b.bill_no, b.items, b.total::float, b.discount::float, b.paid::float, b.mode, b.status, b.note, b.bill_date, b.created_at, b.void_reason,
      p.name, p.uhid, p.phone, u.name as by_name
    from arx.bills b left join arx.patients p on p.id = b.patient_id left join arx.users u on u.id = b.created_by
    where b.clinic_id = ${me(c).clinic_id} and b.bill_date between ${from} and ${to} order by b.created_at desc`
  return c.json(rows)
})

r.get('/:id', async c => {
  const [b] = await sql()`select b.*, b.total::float as total, b.paid::float as paid, b.discount::float as discount, p.name, p.uhid, p.phone, p.age_years, p.sex
    from arx.bills b left join arx.patients p on p.id = b.patient_id where b.id = ${P(c, 'id')} and b.clinic_id = ${me(c).clinic_id}`
  if (!b) throw new HttpError(404, 'Bill not found.')
  return c.json(b)
})

r.post('/', async c => {
  const b = await body(c, z.object({
    patient_id: z.string().uuid(), visit_id: z.string().uuid().nullable().optional(),
    items: z.array(z.object({ label: z.string().min(1).max(80), amount: z.number().min(0).max(1_000_000) })).min(1).max(20),
    discount: z.number().min(0).default(0), mode: z.enum(['cash', 'upi', 'card', 'free', 'due']), note: z.string().max(200).optional(),
  }))
  const u = me(c)
  const total = b.items.reduce((s, i) => s + i.amount, 0)
  if (b.discount > total) throw new HttpError(400, 'Discount is more than the total.')
  const net = total - b.discount
  const paid = b.mode === 'due' ? 0 : b.mode === 'free' ? 0 : net
  const bill = await sql().begin(async tx => {
    const [p] = await tx`select id from arx.patients where id = ${b.patient_id} and clinic_id = ${u.clinic_id}`
    if (!p) throw new HttpError(404, 'Patient not found.')
    if (b.visit_id) {
      const [ex] = await tx`select bill_no from arx.bills where visit_id = ${b.visit_id} and status <> 'void'`
      if (ex) throw new HttpError(409, `This visit already has bill #${ex.bill_no}. Void it first to re-bill.`)
    }
    const no = await nextCounter(tx, u.clinic_id, 'bill')
    const [row] = await tx`insert into arx.bills (clinic_id, bill_no, patient_id, visit_id, items, total, discount, paid, mode, status, note, bill_date, created_by)
      values (${u.clinic_id}, ${no}, ${b.patient_id}, ${b.visit_id ?? null}, ${tx.json(b.items)}, ${total}, ${b.discount}, ${paid}, ${b.mode}, ${b.mode === 'due' ? 'due' : 'paid'}, ${b.note ?? null}, ${istToday()}, ${u.id}) returning id, bill_no`
    return row
  })
  await audit(c, 'bill.create', 'bill', bill.id, { total, mode: b.mode })
  return c.json(bill)
})

r.post('/:id/settle', async c => {
  const b = await body(c, z.object({ mode: z.enum(['cash', 'upi', 'card']) }))
  const [bill] = await sql()`update arx.bills set paid = total - discount, mode = ${b.mode}, status = 'paid' where id = ${P(c, 'id')} and clinic_id = ${me(c).clinic_id} and status = 'due' returning id`
  if (!bill) throw new HttpError(404, 'No unpaid bill found.')
  await audit(c, 'bill.settle', 'bill', bill.id, b)
  return c.json({ ok: true })
})

r.post('/:id/void', requireAuth('doctor', 'admin'), async c => {
  const b = await body(c, z.object({ reason: z.string().min(3).max(200) }))
  const [bill] = await sql()`update arx.bills set status = 'void', voided_at = now(), void_reason = ${b.reason} where id = ${P(c, 'id')} and clinic_id = ${me(c).clinic_id} and status <> 'void' returning id`
  if (!bill) throw new HttpError(404, 'Bill not found or already void.')
  await audit(c, 'bill.void', 'bill', bill.id, b)
  return c.json({ ok: true })
})

/** Daily collection report for a date range. */
r.get('/report/collection', requireAuth('doctor', 'admin'), async c => {
  const from = c.req.query('from') || istToday(), to = c.req.query('to') || from
  const cid = me(c).clinic_id
  const days = await sql()`select bill_date::text as day, count(*)::int as bills,
      coalesce(sum(paid),0)::float as collected, coalesce(sum(paid) filter (where mode='cash'),0)::float as cash,
      coalesce(sum(paid) filter (where mode='upi'),0)::float as upi, coalesce(sum(paid) filter (where mode='card'),0)::float as card,
      coalesce(sum(total-discount) filter (where status='due'),0)::float as due, coalesce(sum(discount),0)::float as discount,
      count(*) filter (where mode='free')::int as free
    from arx.bills where clinic_id = ${cid} and status <> 'void' and bill_date between ${from} and ${to} group by 1 order by 1`
  const visits = await sql()`select visit_date::text as day, count(*)::int as visits, count(*) filter (where visit_type='new')::int as new_visits, count(*) filter (where visit_type<>'new')::int as follow_ups
    from arx.visits where clinic_id = ${cid} and status <> 'cancelled' and visit_date between ${from} and ${to} group by 1 order by 1`
  return c.json({ from, to, days, visits })
})

export default r
