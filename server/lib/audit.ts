import type { Context } from 'hono'
import { sql } from '../db.js'
import type { AuthUser } from './auth.js'

export function clientIp(c: Context): string {
  return (c.req.header('x-forwarded-for') || '').split(',')[0].trim() || c.req.header('x-real-ip') || ''
}
export async function audit(c: Context, action: string, entity?: string, entityId?: string | null, meta: Record<string, unknown> = {}, user?: AuthUser | null) {
  const u = user ?? (c.get('user') as AuthUser | undefined)
  try {
    await sql()`insert into arx.audit_log (clinic_id, user_id, action, entity, entity_id, meta, ip)
      values (${u?.clinic_id ?? null}, ${u?.id ?? null}, ${action}, ${entity ?? null}, ${entityId ?? null}, ${sql().json(meta as any)}, ${clientIp(c)})`
  } catch (e) { console.error('[audit]', e) }
}
