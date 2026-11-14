# Arogya Rx · Dr. Deepak Kumar, Arogya Clinic

Clinic software for **Dr. Deepak Kumar** (MBBS, MD General Medicine, Reg. BCMR50223), Arogya Clinic, Ahiyapur, Muzaffarpur.
Built on the Arogya Rx product design: prescriptions on the doctor's own letterhead in about 30 seconds, Hindi dose lines, WhatsApp delivery.

## What it does
| Screen | What it does |
| --- | --- |
| **Home** | Today's numbers, today's appointments, and **Ask Arogya**: plain-language questions over the clinic's records ("diabetics with HbA1c above 7") |
| **Schedule** | 14-day appointment book with slots from OPD hours, move, cancel, WhatsApp reminder, mark arrived (gives a token) |
| **Intake** | Online and WhatsApp bookings with the patient's problem; photo intake of old prescriptions and lab reports |
| **OPD & Rx** | Token queue, consult timer, one-tap templates, Hinglish voice-to-Rx, medicine search (Jan Aushadhi prices), allergy, duplicate and interaction checks, vitals flags, Hindi dose lines, cost box (branded vs Jan Aushadhi), live parchi, Print A5/A4, PDF, WhatsApp preview and send, bill, Save & call next |
| **Patients** | Search, visit timeline, HbA1c / BP / sugar / weight trends, scanned documents, bills, **Remove patient** (doctor's password; hides the patient everywhere, deletes nothing, reversible) |
| **Billing** | Bills with cash / UPI / card / unpaid, receipts with UPI QR, daily collection, CSV export |
| **Settings** | Letterhead studio (layout, ink, A5/A4, logo, signature), OPD hours and fees, staff logins, templates, WhatsApp and AI, import from the old app, password, removed patients, activity log |
| **/book/arogya-clinic** | Public booking page for patients |

Roles: **doctor** (everything), **reception** (registration, queue, vitals, appointments, bills), **admin**.

### Removing a patient
Only a doctor or admin can remove a patient, and only after typing their own login password again (rate limited, 10 tries per 15 minutes).
Removing **archives**, it does not delete: the patient vanishes from the patient list, search, today's queue, Ask Arogya and the patient
count, their token today and any booked appointment are cancelled, and new prescriptions, tokens, bills, lab values and scans are refused
for them — but every visit, prescription, lab value, document, bill and recording stays in the database. *Settings → Security → Removed
patients* lists them with what is being kept and puts any of them back, password again. Both actions are written to the activity log with
the patient's name and UHID. A hard delete was deliberately not built: every child table is `on delete cascade`, so one mis-tap would take
a whole medical history with it.

## Stack
- React + Vite + TypeScript frontend; Hono API as one Vercel Function (Mumbai, `bom1`)
- Postgres on **Supabase (Mumbai)** in a private `arx` schema (not exposed through the Data API, RLS on every table); files in a private Supabase Storage bucket
- Login: mobile + password (scrypt), signed httpOnly session cookie, rate-limited; append-only activity log
- AI: OpenAI **gpt-5-nano** (Responses API, strict JSON) for voice drafts, photo intake and Ask Arogya; browser speech recognition for dictation
- WhatsApp: AiSensy campaign API when configured, otherwise a ready-to-send wa.me link
- PDFs are rendered in the browser from the live parchi (correct Hindi shaping) and stored for the WhatsApp link

Setup and go-live steps: **[docs/SETUP.md](docs/SETUP.md)**.

## Local development
```bash
npm install
cp .env.example .env.local   # DATABASE_URL to any Postgres 15+, SESSION_SECRET, SETUP_TOKEN
npm run build && npm start   # http://localhost:8787, then open /setup
node tests/api-smoke.mjs     # 56 end-to-end API checks against a fresh database
```
The medicine list (`public/seed`) is built from the old app's catalogue with `npm run seed:build`: 9,924 unique medicines (2,459 Jan Aushadhi with prices, 7,465 brands).

## Search and AI visibility
The app is private (`noindex`, and `robots.txt` disallows everything except the booking page). The public page `/book/arogya-clinic`
is pre-rendered at build time by `scripts/prerender-book.mjs`: clinic facts, booking questions (English and Hindi) and JSON-LD are written
into `dist/book-arogya-clinic.html`, so crawlers that don't run JavaScript can read them. The same script writes `robots.txt`,
`sitemap.xml` and `llms.txt`. The clinic's public name, address, phone and hours live in `scripts/seo-clinic.mjs` and must match the
profile site (`Doctors-Profile/FE/src/lib/site.js`) and the Google Business Profile exactly.
