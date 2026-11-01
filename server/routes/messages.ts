import { Hono } from 'hono'
import { z } from 'zod'
import { sql, HttpError } from '../db'
import { body, me, P, type Env } from '../app'
import { requireAuth } from '../lib/auth'
import { audit } from '../lib/audit'
import { sendCampaign, waApiConfigured, waLink } from '../lib/whatsapp'
import { rxBundle, publicRxUrl } from './rx'
import { displayName, sigHi, fmtDateHi, addDaysISO, istToday, adviceHi, normPhone, fmtDate } from '../../shared/rx'
import { mergeSettings } from '../../shared/settings'

const r = new Hono<Env>()

function rxText(b: Awaited<ReturnType<typeof rxBundle>>, link: string | null) {
  const L = b.clinic.settings.letterhead
  const meds = (b.rx.meds as any[]).map((m, i) => `${i + 1}. ${displayName(m)}\n   ${sigHi(m)}${m.instructions ? ` (${m.instructions})` : ''}`).join('\n')
  const adv = (b.rx.data.advice || []).map((a: string) => `• ${adviceHi(a) || a}`).join('\n')
  const fu = Number(b.rx.data?.follow_up?.days) > 0 ? fmtDateHi(addDaysISO(String(b.rx.rx_date instanceof Date ? b.rx.rx_date.toISOString().slice(0, 10) : b.rx.rx_date), Number(b.rx.data.follow_up.days))) : ''
  return [
    `नमस्ते ${b.patient.name} जी,`, `${L.clinic_name_hi} — ${L.doctor_hi} की पर्ची:`, '', meds,
    adv ? `\nसलाह:\n${adv}` : '', fu ? `\nअगली बार ${fu} को दिखाएँ।` : '',
    link ? `\nपर्ची (PDF): ${link}` : '', `\n${L.clinic_name_en} · ${L.phone}`,
  ].filter(Boolean).join('\n')
}

r.post('/rx/:id', requireAuth(), async c => {
  const b = await body(c, z.object({ mode: z.enum(['auto', 'link']).default('auto'), phone: z.string().optional() }))
  const u = me(c)
  const bundle = await rxBundle(u.clinic_id, P(c, 'id'))
  if (bundle.rx.status !== 'final') throw new HttpError(409, 'Finalise the prescription first.')
  const phone = normPhone(b.phone || bundle.patient.phone)
  if (!/^[0-9]{10}$/.test(phone)) throw new HttpError(400, 'Add the patient’s 10-digit mobile number first.')
  const link = bundle.rx.pdf_file_id ? publicRxUrl(c, bundle.rx.id) : null
  const L = bundle.clinic.settings.letterhead
  if (b.mode === 'auto' && waApiConfigured()) {
    if (!link) throw new HttpError(409, 'The PDF is not ready yet. Try again in a moment.')
    const fuDays = Number(bundle.rx.data?.follow_up?.days)
    const medsLine = (bundle.rx.meds as any[]).map((m, i) => `${i + 1}) ${displayName(m)}: ${sigHi(m)}`).join(' | ').slice(0, 900) || '—'
    try {
      const { ref } = await sendCampaign({
        campaign: process.env.AISENSY_RX_CAMPAIGN || 'arogya_rx_prescription', phone10: phone, name: bundle.patient.name,
        params: [bundle.patient.name, L.doctor_en, medsLine, fuDays > 0 ? fmtDate(addDaysISO(istToday(), fuDays)) : '—'],
        media: { url: link, filename: `Prescription-${bundle.patient.name.replace(/\W+/g, '_')}.pdf` },
      })
      await sql()`insert into arx.messages (clinic_id, patient_id, prescription_id, kind, channel, to_phone, status, provider_ref, created_by)
        values (${u.clinic_id}, ${bundle.patient.id}, ${bundle.rx.id}, 'rx', 'api', ${phone}, 'sent', ${ref || null}, ${u.id})`
      await audit(c, 'whatsapp.rx.api', 'prescription', bundle.rx.id)
      return c.json({ sent: true, channel: 'api' })
    } catch (e: any) {
      await sql()`insert into arx.messages (clinic_id, patient_id, prescription_id, kind, channel, to_phone, status, error, created_by)
        values (${u.clinic_id}, ${bundle.patient.id}, ${bundle.rx.id}, 'rx', 'api', ${phone}, 'failed', ${String(e.message).slice(0, 300)}, ${u.id})`
      // fall through to a link so staff can still send it
      return c.json({ sent: false, channel: 'link', error: e.message, url: waLink(phone, rxText(bundle, link)) })
    }
  }
  await sql()`insert into arx.messages (clinic_id, patient_id, prescription_id, kind, channel, to_phone, status, created_by)
    values (${u.clinic_id}, ${bundle.patient.id}, ${bundle.rx.id}, 'rx', 'link', ${phone}, 'sent', ${u.id})`
  await audit(c, 'whatsapp.rx.link', 'prescription', bundle.rx.id)
  return c.json({ sent: false, channel: 'link', url: waLink(phone, rxText(bundle, link)), text: rxText(bundle, link) })
})

r.get('/', requireAuth(), async c => c.json(await sql()`select m.*, p.name from arx.messages m left join arx.patients p on p.id = m.patient_id
  where m.clinic_id = ${me(c).clinic_id} order by m.created_at desc limit 100`))

/** Follow-up reminders for tomorrow's appointments. Runs daily from Vercel Cron, or by hand from Settings. */
async function runReminders(clinicId?: string) {
  if (!waApiConfigured()) return { sent: 0, skipped: 'WhatsApp API not configured' }
  const tomorrow = addDaysISO(istToday(), 1)
  const rows = await sql()`select a.*, c.settings from arx.appointments a join arx.clinics c on c.id = a.clinic_id
    where a.appt_date = ${tomorrow} and a.status = 'booked' ${clinicId ? sql()`and a.clinic_id = ${clinicId}` : sql()``}
      and not exists (select 1 from arx.messages m where m.kind = 'reminder' and m.to_phone = a.phone and m.created_at > now() - interval '20 hours')`
  let sent = 0, failed = 0
  for (const a of rows) {
    const s = mergeSettings(a.settings)
    if (!s.whatsapp.reminder_day_before) continue
    const when = `${fmtDate(tomorrow)}${a.appt_time ? ', ' + String(a.appt_time).slice(0, 5) : ''}`
    try {
      await sendCampaign({ campaign: process.env.AISENSY_REMINDER_CAMPAIGN || 'arogya_rx_followup', phone10: a.phone, name: a.name, params: [a.name, s.letterhead.doctor_en, when] })
      await sql()`insert into arx.messages (clinic_id, patient_id, kind, channel, to_phone, status) values (${a.clinic_id}, ${a.patient_id}, 'reminder', 'api', ${a.phone}, 'sent')`
      sent++
    } catch (e: any) {
      await sql()`insert into arx.messages (clinic_id, patient_id, kind, channel, to_phone, status, error) values (${a.clinic_id}, ${a.patient_id}, 'reminder', 'api', ${a.phone}, 'failed', ${String(e.message).slice(0, 300)})`
      failed++
    }
  }
  return { sent, failed, due: rows.length }
}
r.post('/reminders', requireAuth('doctor', 'admin'), async c => { const out = await runReminders(me(c).clinic_id); await audit(c, 'reminders.run', 'clinic', me(c).clinic_id, out as any); return c.json(out) })
r.get('/reminders', async c => {
  const secret = process.env.CRON_SECRET
  if (!secret || c.req.header('authorization') !== `Bearer ${secret}`) throw new HttpError(401, 'Unauthorized')
  return c.json(await runReminders())
})

export default r
