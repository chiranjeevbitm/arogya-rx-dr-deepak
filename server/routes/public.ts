import { Hono } from 'hono'
import { z } from 'zod'
import { sql, HttpError } from '../db.js'
import { body, P, type Env } from '../app.js'
import { verifyLink } from '../lib/auth.js'
import { rateLimit } from '../lib/ratelimit.js'
import { clientIp } from '../lib/audit.js'
import { getFile } from '../lib/storage.js'
import { slotsFor } from '../lib/slots.js'
import { mergeSettings } from '../../shared/settings.js'
import { normPhone, istToday, addDaysISO, fmtDate } from '../../shared/rx.js'
import { sendCampaign, waApiConfigured, waLink } from '../lib/whatsapp.js'

const r = new Hono<Env>()

async function clinicBySlug(slug: string): Promise<{ id: string; slug: string; name: string; settings: ReturnType<typeof mergeSettings> }> {
  const [cl] = await sql()`select id, slug, name, settings from arx.clinics where slug = ${slug}`
  if (!cl) throw new HttpError(404, 'Clinic not found.')
  return { id: cl.id, slug: cl.slug, name: cl.name, settings: mergeSettings(cl.settings) }
}

r.use('/clinic/*', async (c, next) => { c.header('Access-Control-Allow-Origin', '*'); c.header('Access-Control-Allow-Headers', 'Content-Type'); c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'); if (c.req.method === 'OPTIONS') return c.body(null, 204); await next() })

r.get('/clinic/:slug', async c => {
  const cl = await clinicBySlug(P(c, 'slug'))
  const L = cl.settings.letterhead
  return c.json({ slug: cl.slug, name: cl.name, name_hi: L.clinic_name_hi, doctor: L.doctor_en, doctor_hi: L.doctor_hi, quals: L.quals_en, address: L.address_en, address_hi: L.address_hi, phone: L.phone,
    booking: cl.settings.booking, sessions: cl.settings.hours.sessions, closed_days: cl.settings.hours.closed_days, today: istToday(), logo: !!L.logo_file_id })
})

r.get('/clinic/:slug/slots', async c => {
  const cl = await clinicBySlug(P(c, 'slug'))
  const d = c.req.query('date') || istToday()
  if (d < istToday() || d > addDaysISO(istToday(), cl.settings.booking.days_ahead)) throw new HttpError(400, 'Pick a date within the booking window.')
  const s = await slotsFor(cl.id, cl.settings, d)
  return c.json({ closed: s.closed, slots: s.slots.map(x => ({ time: x.time, session: x.session, available: x.free > 0 && !x.past })) })
})

r.post('/clinic/:slug/book', async c => {
  const cl = await clinicBySlug(P(c, 'slug'))
  if (!cl.settings.booking.enabled) throw new HttpError(403, 'Online booking is turned off. Please call the clinic.')
  const b = await body(c, z.object({ name: z.string().trim().min(2).max(80), phone: z.string(), age_years: z.coerce.number().int().min(0).max(120).nullable().optional(), sex: z.enum(['M', 'F', 'O']).nullable().optional(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), time: z.string().regex(/^\d{2}:\d{2}$/), reason: z.string().max(300).optional(), website: z.string().optional() }))
  if (b.website) return c.json({ ok: true }) // honeypot
  const phone = normPhone(b.phone)
  if (!/^[6-9][0-9]{9}$/.test(phone)) throw new HttpError(400, 'Enter a valid 10-digit mobile number.')
  await rateLimit(`book:ip:${clientIp(c)}`, 6, 3600)
  await rateLimit(`book:phone:${phone}`, 3, 86400)
  if (b.date < istToday() || b.date > addDaysISO(istToday(), cl.settings.booking.days_ahead)) throw new HttpError(400, 'Pick a date within the booking window.')
  const s = await slotsFor(cl.id, cl.settings, b.date)
  const slot = s.slots.find(x => x.time === b.time)
  if (!slot || slot.past || slot.free <= 0) throw new HttpError(409, 'That time was just taken. Please pick another.')
  const [dup] = await sql()`select id from arx.appointments where clinic_id = ${cl.id} and phone = ${phone} and appt_date = ${b.date} and status = 'booked'`
  if (dup) throw new HttpError(409, 'You already have a booking that day.')
  const [p] = await sql()`select id from arx.patients where clinic_id = ${cl.id} and phone = ${phone} and lower(name) = ${b.name.toLowerCase()} limit 1`
  const [a] = await sql()`insert into arx.appointments (clinic_id, patient_id, name, phone, age_years, sex, appt_date, appt_time, session, reason, source)
    values (${cl.id}, ${p?.id ?? null}, ${b.name}, ${phone}, ${b.age_years ?? null}, ${b.sex ?? null}, ${b.date}, ${b.time}, ${slot.session}, ${b.reason ?? null}, 'online') returning id`
  const when = `${fmtDate(b.date)}, ${b.time}`
  let confirmed = false
  if (waApiConfigured() && process.env.AISENSY_BOOKING_CAMPAIGN) {
    try {
      await sendCampaign({ campaign: process.env.AISENSY_BOOKING_CAMPAIGN, phone10: phone, name: b.name, params: [b.name, cl.settings.letterhead.doctor_en, when] })
      await sql()`insert into arx.messages (clinic_id, patient_id, kind, channel, to_phone, status) values (${cl.id}, ${p?.id ?? null}, 'booking', 'api', ${phone}, 'sent')`
      confirmed = true
    } catch (e: any) {
      await sql()`insert into arx.messages (clinic_id, patient_id, kind, channel, to_phone, status, error) values (${cl.id}, ${p?.id ?? null}, 'booking', 'api', ${phone}, 'failed', ${String(e.message).slice(0, 300)})`
    }
  }
  const clinicWa = cl.settings.whatsapp.clinic_number.replace(/\D/g, '').replace(/^91/, '')
  return c.json({ ok: true, id: a.id, when, whatsapp_confirmed: confirmed, clinic_whatsapp: clinicWa ? waLink(clinicWa, `Namaste, I booked an appointment with ${cl.settings.letterhead.doctor_en} on ${when}. Name: ${b.name}`) : null })
})

/** Signed links for patients: prescription PDF and receipt PDF. */
r.get('/rx/:file', async c => {
  const id = P(c, 'file').replace(/\.pdf$/, '')
  if (!verifyLink('rx', id, c.req.query('t') || '')) throw new HttpError(403, 'This link has expired. Ask the clinic to send it again.')
  const [rx] = await sql()`select pdf_file_id, clinic_id from arx.prescriptions where id = ${id}`
  if (!rx?.pdf_file_id) throw new HttpError(404, 'Prescription PDF not found.')
  const f = await getFile(rx.pdf_file_id, rx.clinic_id)
  await sql()`update arx.messages set status = 'link_opened' where prescription_id = ${id} and channel = 'link' and status = 'sent'`
  return new Response(new Uint8Array(f.data), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="prescription-${id.slice(0, 8)}.pdf"`, 'Cache-Control': 'private, max-age=3600' } })
})

r.get('/logo/:slug', async c => {
  const cl = await clinicBySlug(P(c, 'slug'))
  if (!cl.settings.letterhead.logo_file_id) throw new HttpError(404, 'No logo.')
  const f = await getFile(cl.settings.letterhead.logo_file_id, cl.id)
  return new Response(new Uint8Array(f.data), { headers: { 'Content-Type': f.mime, 'Cache-Control': 'public, max-age=86400' } })
})

export default r
