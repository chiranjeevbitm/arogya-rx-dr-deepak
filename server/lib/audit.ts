import type { Context } from 'hono'
import { waitUntil } from '@vercel/functions'
import { sql } from '../db.js'
import type { AuthUser } from './auth.js'

export function clientIp(c: Context): string {
  return (c.req.header('x-forwarded-for') || '').split(',')[0].trim() || c.req.header('x-real-ip') || ''
}
/** Writes the activity-log row after the reply has gone out: the person never waits for it.
    On Vercel waitUntil keeps the function alive until the insert finishes; elsewhere it simply runs in the background. */
export async function audit(c: Context, action: string, entity?: string, entityId?: string | null, meta: Record<string, unknown> = {}, user?: AuthUser | null) {
  const u = user ?? (c.get('user') as AuthUser | undefined)
  const ip = clientIp(c)
  const job = (async () => {
    try {
      await sql()`insert into arx.audit_log (clinic_id, user_id, action, entity, entity_id, meta, ip)
        values (${u?.clinic_id ?? null}, ${u?.id ?? null}, ${action}, ${entity ?? null}, ${entityId ?? null}, ${sql().json(meta as any)}, ${ip})`
    } catch (e) { console.error('[audit]', e) }
  })()
  try { waitUntil(job) } catch { /* not on Vercel */ }
  if (process.env.AUDIT_SYNC === '1') await job   // tests that read the log straight away
}
