/* One-time: load the clinic's OPD register (a JSON file of rows) into the database named by DATABASE_URL.
   Usage:  DATABASE_URL='postgresql://…' npx tsx scripts/import-register.mts register.json
   Safe to run twice (visits already loaded are skipped). Prints counts only. */
import { readFileSync } from 'node:fs'
import { sql } from '../server/db.js'
import { ensureSchema } from '../server/db.js'
await import('../server/app.js')   // load the app first (the route modules import each other)
const { importRegisterRows } = await import('../server/routes/import.js')

const file = process.argv[2]
if (!file || !process.env.DATABASE_URL) { console.error('Usage: DATABASE_URL=… npx tsx scripts/import-register.mts register.json'); process.exit(1) }
const rows = JSON.parse(readFileSync(file, 'utf8'))
await ensureSchema()
const [u] = await sql()`select id, clinic_id from arx.users where role in ('doctor','admin') and active order by created_at limit 1`
if (!u) { console.error('No doctor account found in this database.'); process.exit(1) }
const out = await importRegisterRows(u.clinic_id, u.id, rows)
console.log(`${rows.length} register rows →`, out)
await sql().end()
