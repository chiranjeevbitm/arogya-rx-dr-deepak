# Arogya Rx: connection errors, stuck OPD/Rx page, and multi-device use

Updated 2 Nov 2026. Covers the "The connection dropped. Trying again…" errors, the OPD and prescription page not loading, and using one login on several devices.

## 1. What went wrong (2 Nov, about 12:45 IST)

Vercel logs showed `GET /api/rx/...` requests timing out after 60 s and many requests failing together with dead database connections (`CONNECTION_DESTROYED`).

Cause: one Vercel function instance serves many requests at the same time, and they all share one small pool of database connections.
- When a pooled connection had gone silent (the Supabase pooler drops sockets of an idle or frozen function), a query on it waited until the 60 s platform limit. The OPD and Rx screens waited on that query, so the form never loaded.
- When one request saw a dead connection it threw the whole pool away immediately. That cut off the queries of every other request on the same instance, which then failed and threw away the new pool too. A chain of "The connection dropped" errors followed.
- The 2 Nov speed change (several queries in parallel when opening a consult) put more requests on the pool at once and made the chain more likely.

## 2. Fixed now (commit after 6d8e960)

| Fix | Where |
| --- | --- |
| A request gives up after 12 s (58 s for AI, import and setup) instead of hanging for 60 s | `server/app.ts` |
| Only the pool that failed is replaced, at most once every 3 s, and the old pool gets 5 s to finish running queries | `server/db.ts` (`resetDb`, `dbGen`) |
| A read (GET) that fails on a dead connection is retried once on the server with a fresh pool, so the person does not see an error | `api/index.ts` |
| More dropped-connection codes recognised (Postgres admin shutdown, connection failure, socket timeout) | `server/db.ts` |
| Pool size 4 per function instance (was 3) | `server/db.ts` |
| Browser waits up to 25 s for a normal request (was 15 s), so the server retry has time to finish | `src/lib/api.ts` |

Tested locally with a proxy that silently freezes database sockets. Before: the request hung, then failed. After: the request returned 200, in 12 s when the socket froze mid-use and 2.5 s when it froze while idle.

## 3. Multi-device use: current state

One login on several devices (clinic PC, laptop, phone) at the same time was already allowed: logging in on one device does not log out another. What was missing, and is now added:

| Area | Before | Now |
| --- | --- | --- |
| How long a device stays signed in | 14 h, then log in again | 7 days, renewed every 12 h of use; a device used daily stays signed in |
| Same prescription edited on two devices | Last save silently overwrote the other device's edits | Each save carries the version it started from; if another device saved in between, the doctor sees "Changed on another device" with **Load latest** or **Keep mine** |
| Autosave | Overlapping saves could race | One save at a time per device |
| Lost or shared phone | Only a password change logged other devices out | Settings → Security → **Log out other devices** (this device stays signed in) |
| OPD queue on several devices | Refreshes every 10 s and on focus | Same |

Notes:
- Logging out other devices takes effect within 20 s on other server instances (user details are cached for 20 s).
- A 7-day session is a convenience trade-off for patient data. If a device is shared, use Log out other devices or a shorter setting.

## 4. To implement next

1. **Move the database and function to Mumbai** (biggest speed gain): new free Supabase project in `ap-south-1`, `pg_dump` and `pg_restore`, `DATABASE_URL` to the new transaction pooler, `vercel.json` regions to `bom1`, keep the Ireland project 7 days as fallback, set a new database password. Vercel logs already show `region=bom1` on requests while the database is in Ireland, so every query crosses continents.
2. **Keep-warm ping** every 5 minutes on `/api/health?db=1` (cron-job.org or UptimeRobot, free). Keeps the pool and the Supabase project awake and stops most dead-socket cases.
3. **Live queue updates across devices**: replace the 10 s polling with Supabase Realtime (or a lightweight change feed) so a token added on the reception PC appears on the doctor's phone at once.
4. **Device list**: store each session in a `sessions` table (device name, last seen, IP) so the doctor can see and sign out one device instead of all.
5. **Retry writes safely**: give token add, bill and finalize an idempotency key, so a write that failed on a dead connection can be retried automatically without creating duplicates.
6. **Offline queue** for the clinic PC (service worker keeps today's queue and queues writes until the network returns).
7. **Sync settings across devices**: refresh clinic settings and templates when a tab regains focus.
8. **Finalize after pending autosave**: make finalize wait for an in-flight autosave so the harmless "prescription is final" 409 disappears.
