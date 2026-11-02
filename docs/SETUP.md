# Go-live checklist (Dr. Deepak Kumar)

## 1. Supabase (Mumbai)
1. supabase.com → New project → Region **South Asia (Mumbai)**. Save the database password.
2. Connect → **Transaction pooler** → copy the URI (port 6543) and put the password in it. This is `DATABASE_URL`.
3. Project Settings → API Keys → copy the **secret key** (`sb_secret_…`, or the legacy `service_role` key). This is `SUPABASE_SECRET_KEY`. The project URL is `SUPABASE_URL`.
Tables are created automatically on first start in a private `arx` schema. Nothing to run by hand.

## 2. Vercel environment variables (project `arogya-rx-dr-deepak` → Settings → Environment Variables)
| Name | Value |
| --- | --- |
| `DATABASE_URL` | Supabase transaction pooler URI (step 1) |
| `SETUP_TOKEN` | any code you choose (e.g. 12+ letters/numbers); used once on /setup, then delete it |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | step 1 (files: PDFs, scans, logo) |
| `OPENAI_API_KEY` | OpenAI key; `AI_MODEL=gpt-5-nano` is the default |
| `APP_URL` | the production URL, e.g. https://arogya-rx-dr-deepak.vercel.app |
| `OLD_DATABASE_URL` | the old app's Postgres URL (Render → dr-deepak-backend → Environment). Remove after the import |
| `CRON_SECRET` | any long random string (protects the daily reminder job) |
| `AISENSY_API_KEY` | after WhatsApp approval (step 5) |
Redeploy after changing variables.

## 3. First run
1. Open **/setup**, enter the setup code, Dr. Deepak's mobile and a password. The medicine list loads automatically.
2. Settings → **Staff** → add the receptionist's mobile and a first password.
3. Settings → **Letterhead studio** → check phone number, timings, layout (Centred or Logo left), paper size. Print one test parchi.
4. Settings → **Hours and fees** → OPD sessions, consultation and follow-up fees, clinic **UPI ID** (for the receipt QR).
5. Settings → **Import old data** → Start import. Check a few patients, then rotate the old database password on Render and remove `OLD_DATABASE_URL`.
6. Delete `SETUP_TOKEN` from Vercel.

## 4. Online booking
Share `https://<app>/book/arogya-clinic` on the clinic WhatsApp status, Google Business profile and the doctor's profile site (Book Appointment button).

## 5. WhatsApp auto-send (AiSensy)
Until this is done, the WhatsApp button opens WhatsApp with the Hindi message and the PDF link ready to send.
1. Create an AiSensy account on the clinic's number and finish Meta business verification.
2. Create and get approved three **Utility** templates, then make a **Live API campaign** for each:
   - `arogya_rx_prescription` (Document header = the PDF). Body: `नमस्ते {{1}} जी, {{2}} की पर्ची संलग्न है। दवा: {{3}}। अगली जाँच: {{4}}।`
   - `arogya_rx_followup`. Body: `नमस्ते {{1}} जी, {{2}} के यहाँ आपका समय कल {{3}} को है। पुरानी पर्ची और रिपोर्ट साथ लाएँ।`
   - `arogya_rx_booking`. Body: `नमस्ते {{1}} जी, {{2}} के यहाँ आपका समय {{3}} पर बुक हो गया है।`
3. Set `AISENSY_API_KEY` (and the campaign names if different: `AISENSY_RX_CAMPAIGN`, `AISENSY_REMINDER_CAMPAIGN`, `AISENSY_BOOKING_CAMPAIGN`).
Reminders go out daily at 6 pm IST for the next day's bookings.

## 6. Check the Mumbai setup
After any change to `DATABASE_URL` or `vercel.json`: Settings → Security → **Run speed check**. It should say the server is in `bom1` and the database in `ap-south-1`, and one database query should take under about 20 ms. The record counts shown there (patients, prescriptions, bills …) must match the old database after a move.

## 7. Backups (weekly, free)
The Supabase free plan has **no automatic backups**, and this repository is public, so the backup is encrypted before it is stored.
1. Supabase → Connect → **Session pooler** (port 5432, not the transaction pooler) → copy the URI with the password filled in.
2. GitHub → this repository → Settings → Secrets and variables → Actions → New repository secret:
   - `BACKUP_DATABASE_URL`: the session pooler URI from step 1.
   - `BACKUP_PASSPHRASE`: at least 20 random characters. **Keep a copy in your password manager; without it a backup cannot be opened.**
3. Actions → *Weekly database backup* → Run workflow once and check it turns green. It then runs every Monday at 04:00 IST and keeps the last 8 weeks.
4. If Supabase moves to a newer Postgres version and the run fails with a version mismatch, set a repository variable `PG_CLIENT_VERSION` (for example `18`).

What it covers: the whole `arx` schema (patients, prescriptions, visits, bills, settings, activity log). It does **not** cover files kept in the Supabase Storage bucket (scanned documents, logo, PDFs); download that bucket from the Supabase dashboard now and then.

Restore into an empty Supabase project:
```
gpg --decrypt arx-YYYY-MM-DD.dump.gpg > arx.dump
psql "$NEW_DIRECT_URL" -c "create schema if not exists extensions; create extension if not exists pg_trgm with schema extensions;"
pg_restore --no-owner --no-privileges --exit-on-error -d "$NEW_DIRECT_URL" arx.dump
```
Then point `DATABASE_URL` at the new project, redeploy, and compare the counts in Settings → Security → Speed check. Practise this once on a spare project before you need it.

## 8. Keep-warm
`.github/workflows/keepwarm.yml` asks `/api/health?db=1` for a reply every 5 minutes from 08:30 to 22:30 IST and once at night, so the first request of the day is not slow and the free database is never paused. GitHub can delay scheduled runs and switches them off after 60 days without repository activity, so also add a free UptimeRobot or cron-job.org monitor on `https://arogya-rx-dr-deepak.vercel.app/api/health?db=1` (5-minute interval).

## Security notes
- Patient data stays in Supabase Mumbai. Only the server connects to the database; the browser never gets a database key.
- Every login, prescription, bill, settings change and AI use is in the activity log (Settings → Security). It cannot be edited.
- Prescription PDF links sent to patients are signed and expire after 60 days.
- The old app's leaked credentials (GitHub token, database URL, Tavily key) must be rotated.
