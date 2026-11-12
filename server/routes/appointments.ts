import { Hono } from 'hono'
import { z } from 'zod'
import { sql, HttpError } from '../db.js'
import { body, me, P, type Env } from '../app.js'
import { requireAuth } from '../lib/auth.js'
import { audit } from '../lib/audit.js'
import { slotsFor } from '../lib/slots.js'
import { mergeSettings } from '../../shared/settings.js'
import { normPhone, istToday, fmtDate } from '../../shared/rx.js'
import { addVisit } from './visits.js'
import { createPatient } from './patients.js'
import { sendCampaign, waApiConfigured, waLink, apptText } from '../lib/whatsapp.js'

const r = new Hono<Env>()
r.use('*', requireAuth())
const D = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const Tm = z.string().regex(/^\d{2}:\d{2}$/)

r.get('/', async c => {
  const from = c.req.query('from') || istToday(), to = c.req.query('to') || from
  return c.json(await sql()`select a.*, to_char(a.appt_time,'HH24:MI') as time, p.uhid from arx.appointments a left join arx.patients p on p.id = a.patient_id
    where a.clinic_id = ${me(c).clinic_id} and a.appt_date between ${from} and ${to} order by a.appt_date, a.appt_time nulls last, a.created_at`)
})

/** Online bookings nobody has looked at yet, so the Schedule tab can show a count. */
r.get('/unseen', async c => c.json(await sql()`select a.id, a.name, a.phone, a.appt_date, to_char(a.appt_time,'HH24:MI') as time, a.reason, a.created_at
  from arx.appointments a where a.clinic_id = ${me(c).clinic_id} and a.seen_at is null and a.status = 'booked' and a.appt_date >= ${istToday()}
  order by a.created_at desc limit 50`))

r.post('/seen', async c => {
  await sql()`update arx.appointments set seen_at = now() where clinic_id = ${me(c).clinic_id} and seen_at is null`
  return c.json({ ok: true })
})

r.get('/slots', async c => {
  const [cl] = await sql()`select settings from arx.clinics where id = ${me(c).clinic_id}`
  return c.json(await slotsFor(me(c).clinic_id, mergeSettings(cl.settings), c.req.query('date') || istToday()))
})

r.post('/', async c => {
  const b = await body(c, z.object({ name: z.string().trim().min(2).max(120), phone: z.string(), date: D, time: Tm.nullable().optional(), reason: z.string().max(300).optional(), patient_id: z.string().uuid().nullable().optional(), age_years: z.number().int().min(0).max(125).nullable().optional(), sex: z.enum(['M', 'F', 'O']).nullable().optional(), source: z.enum(['phone', 'walk_in', 'whatsapp', 'follow_up']).default('phone') }))
  const phone = normPhone(b.phone)
  if (!/^[0-9]{10}$/.test(phone)) throw new HttpError(400, 'Mobile number must be 10 digits.')
  let pid = b.patient_id ?? null
  if (!pid) { const [p] = await sql()`select id from arx.patients where clinic_id = ${me(c).clinic_id} and archived_at is null and phone = ${phone} and lower(name) = ${b.name.toLowerCase()} limit 1`; pid = p?.id ?? null }
  const [a] = await sql()`insert into arx.appointments (clinic_id, patient_id, name, phone, age_years, sex, appt_date, appt_time, reason, source, created_by, seen_at)
    values (${me(c).clinic_id}, ${pid}, ${b.name}, ${phone}, ${b.age_years ?? null}, ${b.sex ?? null}, ${b.date}, ${b.time ?? null}, ${b.reason ?? null}, ${b.source}, ${me(c).id}, now()) returning *`
  await audit(c, 'appointment.create', 'appointment', a.id)
  return c.json({ ...a, whatsapp: await confirmAppointment(c, a) })
})

/** Tell the patient their appointment is booked: automatically through AiSensy when it is set up,
    otherwise hand back a ready-written WhatsApp link for staff to tap. Never blocks the booking. */
async function confirmAppointment(c: any, a: any): Promise<{ sent: boolean; url?: string; text?: string; error?: string } | null> {
  try {
    const [cl] = await sql()`select settings from arx.clinics where id = ${a.clinic_id}`
    const s = mergeSettings(cl?.settings)
    if (!s.whatsapp.confirm_appointments) return null
    const date = String(a.appt_date instanceof Date ? a.appt_date.toISOString().slice(0, 10) : a.appt_date).slice(0, 10)
    const time = a.appt_time ? String(a.appt_time).slice(0, 5) : ''
    const when = `${fmtDate(date)}${time ? ', ' + time : ''}`
    const L = s.letterhead
    if (waApiConfigured() && process.env.AISENSY_BOOKING_CAMPAIGN) {
      try {
        await sendCampaign({ campaign: process.env.AISENSY_BOOKING_CAMPAIGN, phone10: a.phone, name: a.name, params: [a.name, L.doctor_en, when] })
        await sql()`insert into arx.messages (clinic_id, patient_id, kind, channel, to_phone, status, created_by) values (${a.clinic_id}, ${a.patient_id}, 'booking', 'api', ${a.phone}, 'sent', ${a.created_by})`
        return { sent: true }
      } catch (e: any) {
        await sql()`insert into arx.messages (clinic_id, patient_id, kind, channel, to_phone, status, error, created_by) values (${a.clinic_id}, ${a.patient_id}, 'booking', 'api', ${a.phone}, 'failed', ${String(e.message).slice(0, 300)}, ${a.created_by})`
        const text = apptText({ name: a.name, clinicHi: L.clinic_name_hi, doctorHi: L.doctor_hi, when, note: s.booking.note, phone: L.phone })
        return { sent: false, url: waLink(a.phone, text), text, error: e.message }
      }
    }
    const text = apptText({ name: a.name, clinicHi: L.clinic_name_hi, doctorHi: L.doctor_hi, when, note: s.booking.note, phone: L.phone })
    return { sent: false, url: waLink(a.phone, text), text }
  } catch { return null }   // a message that cannot be built must never lose the appointment
}

r.patch('/:id', async c => {
  const b = await body(c, z.object({ status: z.enum(['booked', 'cancelled', 'no_show']).optional(), date: D.optional(), time: Tm.nullable().optional(), reason: z.string().max(300).optional() }))
  const [a] = await sql()`update arx.appointments set status = coalesce(${b.status ?? null}, status), appt_date = coalesce(${b.date ?? null}, appt_date),
      appt_time = ${b.time === undefined ? sql()`appt_time` : b.time}, reason = coalesce(${b.reason ?? null}, reason)
    where id = ${P(c, 'id')} and clinic_id = ${me(c).clinic_id} returning *`
  if (!a) throw new HttpError(404, 'Appointment not found.')
  await audit(c, 'appointment.update', 'appointment', a.id, b)
  return c.json(a)
})

/** Patient has arrived: link or register the patient and put them in today's queue. */
r.post('/:id/arrive', async c => {
  const u = me(c)
  const v = await sql().begin(async tx => {
    const [a] = await tx`select * from arx.appointments where id = ${P(c, 'id')} and clinic_id = ${u.clinic_id} for update`
    if (!a) throw new HttpError(404, 'Appointment not found.')
    if (a.status === 'arrived') throw new HttpError(409, 'Already marked as arrived.')
    let pid = a.patient_id
    if (!pid) pid = (await createPatient(tx, u.clinic_id, { name: a.name, phone: a.phone, age_years: a.age_years, sex: a.sex })).id
    const v = await addVisit(tx, u.clinic_id, u.id, { patient_id: pid, complaint: a.reason?.replace(/^Follow-up: /, '') || null, source: a.source === 'online' ? 'online' : 'appointment', appointment_id: a.id, visit_type: a.source === 'follow_up' ? 'follow_up' : null })
    await tx`update arx.appointments set status = 'arrived', patient_id = ${pid}, visit_id = ${v.id} where id = ${a.id}`
    return v
  })
  await audit(c, 'appointment.arrive', 'visit', v.id)
  return c.json(v)
})

export default r
