import postgres from 'postgres'
import { MIGRATIONS } from './migrations.js'

let _sql: postgres.Sql | null = null
let lastUse = Date.now()

/** A serverless instance can be frozen between requests; the pooler then drops its idle connections and the next query
    would hang until the platform timeout. After a pause we test the connection first and rebuild it when it is dead. */
export async function warmDb(force = false): Promise<void> {
  const idle = Date.now() - lastUse
  lastUse = Date.now()
  if (!_sql || (!force && idle < 3000)) return
  const g = gen
  try {
    await Promise.race([_sql`select 1`, new Promise((_, rej) => setTimeout(() => rej(new Error('stale db connection')), 2500))])
  } catch { resetDb(g) }
}
/** Swap in a fresh connection pool. One server instance serves many requests at once, so:
    - only the pool that actually failed is replaced (a request that started on an older pool cannot throw away the new one),
    - at most one swap every 3 s (no reset storms when several requests fail together),
    - the old pool gets 5 s to finish queries that are still running instead of having them cut off. */
let gen = 0, lastReset = 0
export const dbGen = () => gen
export function resetDb(fromGen?: number) {
  if (fromGen !== undefined && fromGen !== gen) return
  if (Date.now() - lastReset < 3000) return
  lastReset = Date.now(); gen++
  const old = _sql; _sql = null
  old?.end({ timeout: 5 }).catch(() => {})
}
const DEAD = new Set(['CONNECTION_DESTROYED', 'CONNECTION_CLOSED', 'CONNECTION_ENDED', 'CONNECTION_CONNECT_TIMEOUT', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT', '57P01', '57P02', '57P03', '08000', '08003', '08006'])
export const isDeadConnection = (e: any) => DEAD.has(e?.code) || DEAD.has(e?.errno)
export const markDbUse = () => { lastUse = Date.now() }

// Supabase's direct host (db.<ref>.supabase.co) is IPv6-only and does not resolve on Vercel.
// If one is given, switch to the IPv4 transaction pooler (this project is in eu-west-1; override with DB_POOLER_HOST).
function usePooler(raw: string): string {
  try {
    const u = new URL(raw)
    const m = /^db\.([a-z0-9]+)\.supabase\.co$/.exec(u.hostname)
    if (!m) return raw
    u.hostname = process.env.DB_POOLER_HOST || 'aws-0-eu-west-1.pooler.supabase.com'
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
    max: local ? 10 : 4,
    idle_timeout: 20,               // closing idle sockets every few seconds raced with new queries (CONNECTION_DESTROYED)
    max_lifetime: 300,
    connect_timeout: 10,
    keep_alive: 10,
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
  // fast path (almost every cold start): the newest migration is already applied, so skip the locked transaction
  let upToDate = false
  try { upToDate = (await db`select 1 from arx.schema_migrations where version = ${MIGRATIONS[MIGRATIONS.length - 1].version}`).length > 0 } catch { /* first run: table missing */ }
  if (!upToDate) await db.begin(async tx => {
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
    let [r] = await db`select value from arx.app_secrets where name = 'session'`
    if (!r) {
      await db`insert into arx.app_secrets (name, value) values ('session', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')) on conflict (name) do nothing`
      ;[r] = await db`select value from arx.app_secrets where name = 'session'`
    }
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
