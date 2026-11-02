/* Voice recordings of dictations. Anyone who dictates (doctor, or reception filling a new patient) stores one;
   only the doctor can list, play or delete them. Files are small Opus/AAC audio in the private storage bucket. */
import { Hono } from 'hono'
import { z } from 'zod'
import { sql, HttpError } from '../db.js'
import { body, me, P, type Env } from '../app.js'
import { requireAuth } from '../lib/auth.js'
import { audit } from '../lib/audit.js'
import { putFile, getFile, removeFile } from '../lib/storage.js'

const r = new Hono<Env>()
r.use('*', requireAuth())

const MAX_BYTES = 3 * 1024 * 1024   // about 25 minutes at 16 kbps
export const RecordingMeta = z.object({
  kind: z.enum(['consult', 'intake']).default('consult'),
  patient_id: z.string().uuid().nullable().optional(),
  rx_id: z.string().uuid().nullable().optional(),
  seconds: z.coerce.number().min(0).max(3600).optional(),
  transcript: z.string().max(8000).optional(),
})

/** Store one recording. Used by POST /recordings and by /ai/transcribe when the dialog asks to keep the audio. */
export async function saveRecording(clinicId: string, userId: string, audio: Buffer, mime: string, m: z.infer<typeof RecordingMeta>) {
  if (audio.length < 1000) return null
  if (audio.length > MAX_BYTES) throw new HttpError(413, 'The recording is too long to keep (over 3 MB).')
  const clean = mime.split(';')[0]
  if (!/^audio\/(webm|ogg|mp4|mpeg|wav|aac)$/.test(clean)) throw new HttpError(400, 'Not an audio recording.')
  if (m.patient_id) { const [p] = await sql()`select id from arx.patients where id = ${m.patient_id} and clinic_id = ${clinicId}`; if (!p) throw new HttpError(404, 'Patient not found.') }
  if (m.rx_id) { const [x] = await sql()`select id from arx.prescriptions where id = ${m.rx_id} and clinic_id = ${clinicId}`; if (!x) m.rx_id = null }
  const f = await putFile({ clinicId, kind: 'voice', mime: clean, data: audio, userId })
  const [row] = await sql()`insert into arx.recordings (clinic_id, patient_id, rx_id, file_id, kind, mime, bytes, seconds, transcript, created_by)
    values (${clinicId}, ${m.patient_id ?? null}, ${m.rx_id ?? null}, ${f.id}, ${m.kind}, ${clean}, ${audio.length}, ${m.seconds ?? null}, ${m.transcript?.trim() || null}, ${userId}) returning id`
  return row.id as string
}

r.post('/', async c => {
  const b = await body(c, RecordingMeta.extend({ audio_base64: z.string().max(4_500_000), mime: z.string().max(60) }))
  const u = me(c)
  const id = await saveRecording(u.clinic_id, u.id, Buffer.from(b.audio_base64, 'base64'), b.mime, b)
  if (id) await audit(c, 'recording.save', 'patient', b.patient_id ?? null, { recording: id })
  return c.json({ id })
})

/** Add or correct the words of a recording (the doctor may edit the text before making the draft). */
r.patch('/:id', async c => {
  const b = await body(c, z.object({ transcript: z.string().max(8000), patient_id: z.string().uuid().nullable().optional() }))
  const u = me(c)
  await sql()`update arx.recordings set transcript = ${b.transcript.trim() || null}, patient_id = coalesce(patient_id, ${b.patient_id ?? null})
    where id = ${P(c, 'id')} and clinic_id = ${u.clinic_id} and created_by = ${u.id} and created_at > now() - interval '1 day'`
  return c.json({ ok: true })
})

r.get('/', requireAuth('doctor'), async c => {
  const u = me(c), pid = c.req.query('patient_id')
  const limit = Math.min(200, Math.max(1, Number(c.req.query('limit')) || 50))
  const rows = pid
    ? await sql()`select r.id, r.kind, r.patient_id, r.rx_id, r.mime, r.bytes, r.seconds::float as seconds, r.transcript, r.created_at, u.name as by_name
        from arx.recordings r left join arx.users u on u.id = r.created_by where r.clinic_id = ${u.clinic_id} and r.patient_id = ${pid} order by r.created_at desc limit ${limit}`
    : await sql()`select r.id, r.kind, r.patient_id, r.rx_id, r.mime, r.bytes, r.seconds::float as seconds, r.transcript, r.created_at, u.name as by_name, p.name as patient_name
        from arx.recordings r left join arx.users u on u.id = r.created_by left join arx.patients p on p.id = r.patient_id where r.clinic_id = ${u.clinic_id} order by r.created_at desc limit ${limit}`
  const [t] = await sql()`select count(*)::int as n, coalesce(sum(bytes), 0)::bigint as bytes from arx.recordings where clinic_id = ${u.clinic_id}`
  return c.json({ rows, total: t.n, total_bytes: Number(t.bytes) })
})

r.get('/:id/audio', requireAuth('doctor'), async c => {
  const u = me(c)
  const [rec] = await sql()`select file_id, patient_id from arx.recordings where id = ${P(c, 'id')} and clinic_id = ${u.clinic_id}`
  if (!rec) throw new HttpError(404, 'Recording not found.')
  const f = await getFile(rec.file_id, u.clinic_id)
  await audit(c, 'recording.play', 'patient', rec.patient_id, { recording: P(c, 'id') })
  return new Response(new Uint8Array(f.data), { headers: { 'Content-Type': f.mime, 'Content-Length': String(f.data.length), 'Cache-Control': 'private, no-store' } })
})

r.delete('/:id', requireAuth('doctor'), async c => {
  const u = me(c)
  const [rec] = await sql()`select file_id, patient_id from arx.recordings where id = ${P(c, 'id')} and clinic_id = ${u.clinic_id}`
  if (!rec) throw new HttpError(404, 'Recording not found.')
  await removeFile(rec.file_id, u.clinic_id)   // the recording row goes with it (on delete cascade)
  await audit(c, 'recording.delete', 'patient', rec.patient_id, {})
  return c.json({ ok: true })
})

export default r
