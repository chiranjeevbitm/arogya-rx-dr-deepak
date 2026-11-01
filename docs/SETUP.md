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

## Security notes
- Patient data stays in Supabase Mumbai. Only the server connects to the database; the browser never gets a database key.
- Every login, prescription, bill, settings change and AI use is in the activity log (Settings → Security). It cannot be edited.
- Prescription PDF links sent to patients are signed and expire after 60 days.
- The old app's leaked credentials (GitHub token, database URL, Tavily key) must be rotated.
