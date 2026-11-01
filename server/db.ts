import postgres from 'postgres'
import { MIGRATIONS } from './migrations.js'

let _sql: postgres.Sql | null = null

// Supabase's direct host (db.<ref>.supabase.co) is IPv6-only and does not resolve on Vercel.
// If one is given, switch to the IPv4 transaction pooler (Mumbai by default; override with DB_POOLER_HOST).
function usePooler(raw: string): string {
  try {
    const u = new URL(raw)
    const m = /^db\.([a-z0-9]+)\.supabase\.co$/.exec(u.hostname)
    if (!m) return raw
    u.hostname = process.env.DB_POOLER_HOST || 'aws-1-ap-south-1.pooler.supabase.com'
    u.port = '6543'
    if (!u.username.includes('.')) u.username = `${u.username}.${m[1]}`
    return u.toString()
  } catch { return raw }
}

export function sql(): postgres.Sql {
  if (_sql) return _sql
  const raw = process.env.DATABASE_URL
  if (!raw) throw new HttpError(503, 'DATABASE_URL is not set. Add it in the Vercel project settings.')
  const url = usePooler(raw)
  const local = /localhost|127\.0\.0\.1|\/var\/run/.test(url)
  _sql = postgres(url, {
    prepare: false,                 // Supabase transaction pooler (port 6543)
    max: local ? 10 : 3,
    idle_timeout: 20,
    connect_timeout: 15,
    ssl: local ? false : 'require',
    connection: { application_name: 'arogya-rx', TimeZone: 'UTC' },
    onnotice: () => {},
  })
  return _sql
}

let schemaReady: Promise<void> | null = null
export function ensureSchema(): Promise<void> {
  if (!schemaReady) schemaReady = migrate().catch(e => { schemaReady = null; throw e })
  return schemaReady
}

async function migrate() {
  const db = sql()
  await db.begin(async tx => {
    await tx`select pg_advisory_xact_lock(727274)`
    await tx`create schema if not exists arx`
    await tx`create table if not exists arx.schema_migrations (version integer primary key, name text not null, applied_at timestamptz not null default now())`
    const done = new Set((await tx`select version from arx.schema_migrations`).map(r => r.version as number))
    for (const m of MIGRATIONS) {
      if (done.has(m.version)) continue
      await tx.unsafe(m.sql)
      await tx`insert into arx.schema_migrations (version, name) values (${m.version}, ${m.name})`
      console.log(`[db] applied migration ${m.version} ${m.name}`)
    }
  })
  // Session-signing key: SESSION_SECRET if set, otherwise generated once and kept in the database.
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    await db`insert into arx.app_secrets (name, value) values ('session', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')) on conflict (name) do nothing`
    const [r] = await db`select value from arx.app_secrets where name = 'session'`
    dbSessionSecret = r.value
  }
}
export let dbSessionSecret: string | null = null

export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message) }
}

/** Atomic per-clinic counter (UHID, bill numbers, tokens). */
export async function nextCounter(tx: postgres.Sql | postgres.TransactionSql, clinicId: string, name: string): Promise<number> {
  const [r] = await tx`
    insert into arx.counters (clinic_id, name, value) values (${clinicId}, ${name}, 1)
    on conflict (clinic_id, name) do update set value = arx.counters.value + 1
    returning value`
  return Number(r.value)
}
