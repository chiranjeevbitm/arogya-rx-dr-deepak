import { sql, HttpError } from '../db'

/** Fixed-window limiter stored in Postgres (works across serverless instances). */
export async function rateLimit(key: string, max: number, windowSec: number) {
  const [r] = await sql()`
    insert into arx.rate_limits (key, count, reset_at) values (${key}, 1, now() + make_interval(secs => ${windowSec}))
    on conflict (key) do update set
      count = case when arx.rate_limits.reset_at < now() then 1 else arx.rate_limits.count + 1 end,
      reset_at = case when arx.rate_limits.reset_at < now() then now() + make_interval(secs => ${windowSec}) else arx.rate_limits.reset_at end
    returning count, reset_at`
  if (r.count > max) {
    const wait = Math.max(1, Math.ceil((new Date(r.reset_at).getTime() - Date.now()) / 60000))
    throw new HttpError(429, `Too many attempts. Try again in ${wait} minute${wait > 1 ? 's' : ''}.`)
  }
}
