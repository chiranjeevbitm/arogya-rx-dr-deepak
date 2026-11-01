/* Files go to a private Supabase Storage bucket when configured, otherwise into Postgres (bytea).
   Patients never get a storage URL directly: they get a signed link served by our API. */
import { sql, HttpError } from '../db'

const BUCKET = 'arogya-rx'
const cfg = () => ({ url: (process.env.SUPABASE_URL || '').replace(/\/$/, ''), key: process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '' })
export const storageMode = () => (cfg().url && cfg().key ? 'supabase' : 'db') as 'supabase' | 'db'

function headers(extra: Record<string, string> = {}) {
  const { key } = cfg()
  const h: Record<string, string> = { apikey: key, ...extra }
  if (key.startsWith('eyJ')) h.Authorization = `Bearer ${key}` // legacy service_role JWT
  return h
}

export async function ensureBucket() {
  if (storageMode() !== 'supabase') return { mode: 'db' }
  const { url } = cfg()
  const r = await fetch(`${url}/storage/v1/bucket`, { method: 'POST', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false, file_size_limit: 15 * 1024 * 1024 }) })
  if (!r.ok && r.status !== 409 && !/already exists/i.test(await r.text())) throw new HttpError(502, `Could not create the storage bucket (${r.status}).`)
  return { mode: 'supabase' }
}

export async function putFile(o: { clinicId: string; kind: string; mime: string; data: Buffer; userId?: string | null; ext?: string }) {
  if (o.data.length > 15 * 1024 * 1024) throw new HttpError(413, 'File is larger than 15 MB.')
  const mode = storageMode()
  const id = crypto.randomUUID()
  const path = `${o.clinicId}/${o.kind}/${new Date().toISOString().slice(0, 7)}/${id}.${o.ext || extFor(o.mime)}`
  if (mode === 'supabase') {
    const { url } = cfg()
    const r = await fetch(`${url}/storage/v1/object/${BUCKET}/${path}`, { method: 'POST', headers: headers({ 'Content-Type': o.mime, 'x-upsert': 'true' }), body: new Uint8Array(o.data) })
    if (!r.ok) throw new HttpError(502, `Storage upload failed (${r.status}): ${(await r.text()).slice(0, 200)}`)
  }
  await sql()`insert into arx.files (id, clinic_id, kind, storage, path, mime, size, data, created_by)
    values (${id}, ${o.clinicId}, ${o.kind}, ${mode}, ${path}, ${o.mime}, ${o.data.length}, ${mode === 'db' ? o.data : null}, ${o.userId ?? null})`
  return { id, path }
}

export async function getFile(id: string, clinicId?: string) {
  const [f] = clinicId
    ? await sql()`select * from arx.files where id = ${id} and clinic_id = ${clinicId}`
    : await sql()`select * from arx.files where id = ${id}`
  if (!f) throw new HttpError(404, 'File not found.')
  if (f.storage === 'db') return { mime: f.mime as string, data: Buffer.from(f.data), name: f.path.split('/').pop() as string }
  const { url } = cfg()
  const r = await fetch(`${url}/storage/v1/object/authenticated/${BUCKET}/${f.path}`, { headers: headers() })
  if (!r.ok) throw new HttpError(502, `Storage download failed (${r.status}).`)
  return { mime: f.mime as string, data: Buffer.from(await r.arrayBuffer()), name: f.path.split('/').pop() as string }
}

function extFor(m: string) { return ({ 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' } as Record<string, string>)[m] || 'bin' }
