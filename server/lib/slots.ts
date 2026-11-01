import { sql } from '../db'
import type { ClinicSettings } from '../../shared/settings'
import { istToday } from '../../shared/rx'

export type Slot = { time: string; session: string; booked: number; free: number; past: boolean }

export async function slotsFor(clinicId: string, s: ClinicSettings, date: string): Promise<{ closed: boolean; slots: Slot[] }> {
  const dow = new Date(date + 'T00:00:00Z').getUTCDay()
  if (s.hours.closed_days.includes(dow)) return { closed: true, slots: [] }
  const rows = await sql()`select to_char(appt_time, 'HH24:MI') as t, count(*)::int as n from arx.appointments
    where clinic_id = ${clinicId} and appt_date = ${date} and status in ('booked','arrived') and appt_time is not null group by 1`
  const booked = new Map(rows.map(r => [r.t as string, r.n as number]))
  const now = new Date(), today = istToday(now)
  const hm = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now).split(':').map(Number)
  const nowMin = date === today ? hm[0] * 60 + hm[1] : -1
  const out: Slot[] = []
  for (const ses of s.hours.sessions) {
    const [sh, sm] = ses.start.split(':').map(Number), [eh, em] = ses.end.split(':').map(Number)
    for (let m = sh * 60 + sm; m + s.hours.slot_minutes <= eh * 60 + em; m += s.hours.slot_minutes) {
      const t = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
      const b = booked.get(t) || 0
      out.push({ time: t, session: ses.label, booked: b, free: Math.max(0, s.hours.per_slot - b), past: date < today || (date === today && m <= nowMin + 15) })
    }
  }
  return { closed: false, slots: out }
}
