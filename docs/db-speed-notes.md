# Arogya Rx: making the database fast on Supabase free

## What the free plan gives (supabase.com/pricing)
- 500 MB database, shared CPU, 500 MB RAM, 5 GB egress, 1 GB file storage.
- Project is paused after 1 week with no activity. No automatic backups.

## Where the time goes in this app
1. Cold start: a Vercel function that has been idle reconnects to the pooler (TLS, ~100-300 ms) and the Supabase free instance may have sleeping CPU.
2. Round trips: each API call did one query for the session user, then the real queries. Vercel (dub1) to Supabase (eu-west-1) is about 10-20 ms per round trip, so the count matters more than query cost.
3. Query cost: the app is tiny (about 10k rows, 205k medicine rows searched in the browser), so indexes are not the bottleneck. All filter/sort columns already have indexes (clinic_id + date, trigram on names).

## Done
- Same region for function and database (dub1 / eu-west-1).
- Transaction pooler (port 6543), prepared statements off, small pool, stale-connection check.
- Medicine catalogue searched in the browser, not the server.
- Session user cached in memory for 20 s per function instance: one database round trip less on every request.
- Client-side timeouts and one retry on reads.

## Recommended next (all free)
1. Keep it warm: a free external pinger (UptimeRobot or cron-job.org, every 5 minutes) on /api/health?db=1 stops the Supabase 1-week pause and keeps the Vercel function and the pooler connection warm during clinic hours. Vercel Hobby cron only runs once a day.
2. Fewer round trips: combine queries that a screen always needs together into one SQL statement or Promise.all (OPD queue + templates + summary).
3. Check real slow queries in Supabase Dashboard > Database > Query Performance (pg_stat_statements is on by default) and run the Index Advisor on anything over ~50 ms. Run ANALYZE after the big import.
4. Keep payloads small: never select the bytea file column in list queries; paginate visit history.
5. Do not use Supabase Realtime or the REST API from the browser; the server path is faster and safer here.
6. Pool size: Supabase advises 1 connection per serverless instance; this app uses 3 so one screen can run queries in parallel. Lower to 1 only if "too many connections" ever appears.
7. Backups: the free plan has none. Schedule a weekly pg_dump (GitHub Actions, free) to keep a copy.
8. If it ever outgrows free: the Pro plan dedicated pooler runs on the database machine and has lower latency.

## Sources
- https://supabase.com/pricing
- https://supabase.com/docs/guides/database/connecting-to-postgres
- https://supabase.com/docs/guides/database/query-optimization
- https://supabase.com/docs/guides/platform/performance

## Found while testing on the live site (2 Nov)
- Runtime logs showed `CONNECTION_DESTROYED` 500s: the app closed idle database sockets every 4 s, which raced with new queries and long AI calls. Fixed: idle timeout 20 s, pool reset plus one automatic retry on the client, connection check after AI calls.
