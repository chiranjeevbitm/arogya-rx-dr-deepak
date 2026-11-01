import postgres from 'postgres'
import { MIGRATIONS } from './migrations'

let _sql: postgres.Sql | null = null

export function sql(): postgres.Sql {
  if (_sql) return _sql
  const url = process.env.DATABASE_URL
  if (!url) throw new HttpError(503, 'DATABASE_URL is not set. Add it in the Vercel project settings.')
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
}

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
