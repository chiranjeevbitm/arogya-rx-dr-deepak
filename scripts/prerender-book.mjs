// Makes the public booking page findable by search engines and AI assistants.
// The app itself is a login-gated SPA (noindex, and blocked in robots.txt); the
// one public page, /book/arogya-clinic, gets its own pre-rendered HTML with the
// clinic's details, booking questions and JSON-LD written into the file, so
// crawlers that never run JavaScript still read them. The React booking form
// still mounts in #root above the static section, exactly as before.
//
// Runs after `vite build`. Writes dist/book-arogya-clinic.html (served at
// /book/arogya-clinic by vercel.json), robots.txt, sitemap.xml and llms.txt.
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CLINIC as C } from './seo-clinic.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'dist')
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const safeJson = (o) => JSON.stringify(o).replace(/</g, '\\u003c')

const title = `Book Dr. Deepak Kumar online — Arogya Clinic, Ahiyapur, Muzaffarpur`
const description = `Book an appointment with Dr. Deepak Kumar (MD General Medicine) at Arogya Clinic, ${C.street}, Muzaffarpur. Open every day ${C.hoursShortEn}. Live slots for the next 7 days, confirmation on WhatsApp. Phone ${C.phone}.`

const FAQ = [
  ['How do I book an appointment with Dr. Deepak Kumar in Muzaffarpur?',
    `On this page: choose a day in the next 7 days, pick a free time, and enter the patient's name and mobile number. The confirmation comes on WhatsApp. You can also call or WhatsApp ${C.phone}.`,
    `इसी पेज पर दिन और खाली समय चुनें, मरीज़ का नाम और मोबाइल भरें — पुष्टि WhatsApp पर आएगी। या ${C.phone} पर कॉल/WhatsApp करें।`],
  ['What are the Arogya Clinic timings?',
    `Every day: morning ${C.sessions[0].en} and evening ${C.sessions[1].en}.`,
    `रोज़: ${C.sessions[0].hi} और ${C.sessions[1].hi}।`],
  ['Where is Arogya Clinic?',
    `${C.addressLine}. Google Maps: ${C.mapsUrl}`,
    `${C.addressHi}।`],
  ['Is online booking free?',
    'Yes. Reserving a slot costs nothing; the consultation fee is paid at the clinic.',
    'हाँ। ऑनलाइन समय बुक करने का कोई शुल्क नहीं है; परामर्श शुल्क क्लिनिक पर।'],
  ['What should I bring?',
    'Old prescriptions, recent lab reports and the medicines you take now. Please arrive about 10 minutes early.',
    'पुरानी पर्चियाँ, जाँच रिपोर्ट और चल रही दवाइयाँ। लगभग 10 मिनट पहले पहुँचें।'],
  ['How do I change or cancel my appointment?',
    `Call or WhatsApp the clinic on ${C.phone}.`,
    `क्लिनिक को ${C.phone} पर कॉल या WhatsApp करें।`],
]

const postal = { '@type': 'PostalAddress', streetAddress: C.street, addressLocality: C.locality, addressRegion: C.region, postalCode: C.postalCode, addressCountry: 'IN' }
const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      // Same @id, name, address and phone as the profile site, so search
      // engines and AI tools treat both sites as one clinic.
      '@type': ['MedicalClinic', 'LocalBusiness'], '@id': `${C.profileUrl}/#clinic`,
      name: C.listingName, alternateName: [C.doctor, C.clinic],
      url: `${C.profileUrl}/`, telephone: C.phoneTel, address: postal,
      geo: { '@type': 'GeoCoordinates', latitude: C.geo.lat, longitude: C.geo.lng },
      hasMap: C.mapsUrl, ...(C.sameAs.length ? { sameAs: C.sameAs } : {}),
      openingHoursSpecification: C.sessions.map((s) => ({ '@type': 'OpeningHoursSpecification', dayOfWeek: days, opens: s.from, closes: s.to })),
      medicalSpecialty: 'https://schema.org/PrimaryCare',
      employee: { '@id': `${C.profileUrl}/#doctor` },
      potentialAction: {
        '@type': 'ReserveAction',
        target: { '@type': 'EntryPoint', urlTemplate: C.bookingUrl, actionPlatform: ['https://schema.org/DesktopWebPlatform', 'https://schema.org/MobileWebPlatform'] },
        result: { '@type': 'Reservation', name: `Appointment at ${C.clinic}` },
      },
    },
    {
      '@type': 'Physician', '@id': `${C.profileUrl}/#physician`, name: C.listingName,
      url: `${C.profileUrl}/`, telephone: C.phoneTel, address: postal, hasMap: C.mapsUrl,
      employee: { '@id': `${C.profileUrl}/#doctor` },
    },
    {
      '@type': 'Person', '@id': `${C.profileUrl}/#doctor`, name: C.doctor,
      jobTitle: 'Consultant Physician (MD General Medicine)', url: `${C.profileUrl}/about`,
      worksFor: { '@id': `${C.profileUrl}/#clinic` },
    },
    {
      '@type': 'WebPage', '@id': `${C.bookingUrl}#webpage`, url: C.bookingUrl, name: title, description,
      inLanguage: ['en-IN', 'hi-IN'], about: { '@id': `${C.profileUrl}/#clinic` },
      isPartOf: { '@type': 'WebSite', url: `${C.profileUrl}/`, name: `${C.doctor} — ${C.clinic}` },
      potentialAction: { '@type': 'ReserveAction', target: C.bookingUrl },
    },
    {
      '@type': 'FAQPage', '@id': `${C.bookingUrl}#faq`, url: C.bookingUrl,
      mainEntity: FAQ.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
    },
  ],
}

const headTags = `
  <meta name="description" content="${esc(description)}" />
  <meta name="robots" content="index, follow, max-snippet:-1" />
  <link rel="canonical" href="${C.bookingUrl}" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(description)}" />
  <meta property="og:url" content="${C.bookingUrl}" />
  <meta property="og:image" content="${C.profileUrl}/og.jpg" />
  <meta property="og:locale" content="en_IN" />
  <meta name="twitter:card" content="summary_large_image" />
  <script type="application/ld+json">${safeJson(jsonLd)}</script>`

const section = `
  <section id="clinic-info" class="book-wrap stack" aria-labelledby="clinic-info-h" style="padding-top:0">
    <div class="card stack">
      <h1 id="clinic-info-h" style="margin:0;font-size:20px">${esc(C.doctor)}, ${esc(C.clinic)} — Ahiyapur, Muzaffarpur</h1>
      <p style="margin:0">${esc(C.doctor)} (${esc(C.quals)}) sees patients at ${esc(C.clinic)} for diabetes, high blood pressure, thyroid problems, asthma and COPD, stomach complaints and fever.</p>
      <p class="small muted" style="margin:0">${esc(C.doctorHi)} — ${esc(C.clinicHi)}, ${esc(C.addressHi)}</p>
      <dl style="margin:0;display:grid;grid-template-columns:max-content 1fr;gap:6px 14px">
        <dt class="muted">Address / पता</dt><dd style="margin:0"><a href="${C.mapsUrl}" rel="noopener">${esc(C.addressLine)}</a></dd>
        <dt class="muted">Timings / समय</dt><dd style="margin:0">Every day ${esc(C.hoursShortEn)} · रोज़ ${esc(C.sessions[0].hi)}, ${esc(C.sessions[1].hi)}</dd>
        <dt class="muted">Phone / फ़ोन</dt><dd style="margin:0"><a href="tel:${C.phoneTel}">${esc(C.phone)}</a> (call or WhatsApp)</dd>
        <dt class="muted">About</dt><dd style="margin:0"><a href="${C.profileUrl}/">${esc(C.profileUrl.replace('https://', ''))}</a></dd>
      </dl>
    </div>
    <div class="card stack">
      <h2 style="margin:0;font-size:17px">Booking questions / बुकिंग से जुड़े सवाल</h2>
      ${FAQ.map(([q, a, hi]) => `<div class="stack tight"><h3 style="margin:0;font-size:15px">${esc(q)}</h3><p style="margin:0">${esc(a)}</p><p class="small muted" style="margin:0">${esc(hi)}</p></div>`).join('\n      ')}
    </div>
  </section>`

const template = await readFile(path.join(dist, 'index.html'), 'utf8')
for (const needle of ['<meta name="robots" content="noindex" />', '<div id="root"></div>', '</head>']) {
  if (!template.includes(needle)) throw new Error(`dist/index.html no longer contains ${needle}`)
}
const page = template
  .replace('<meta name="robots" content="noindex" />', '')
  .replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
  .replace('</head>', `${headTags}\n</head>`)
  .replace('<div id="root"></div>', `<div id="root"></div>${section}`)
await writeFile(path.join(dist, 'book-arogya-clinic.html'), page)

// Everything except the public booking page is private clinic software.
const bots = ['Googlebot', 'Bingbot', 'OAI-SearchBot', 'ChatGPT-User', 'GPTBot', 'Claude-SearchBot', 'Claude-User', 'ClaudeBot', 'PerplexityBot', 'Perplexity-User', 'Google-Extended', 'Applebot']
const rules = `Allow: /book/
Allow: /assets/
Allow: /lh/
Allow: /favicon.svg
Allow: /llms.txt
Disallow: /`
await writeFile(path.join(dist, 'robots.txt'), `# Public: the online booking page. Private: the clinic app and its API.
${bots.map((b) => `User-agent: ${b}`).join('\n')}
${rules}

User-agent: *
${rules}

Sitemap: ${C.appUrl}/sitemap.xml
`)
await writeFile(path.join(dist, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${C.bookingUrl}</loc><lastmod>${new Date().toISOString().slice(0, 10)}</lastmod></url>
</urlset>
`)
await writeFile(path.join(dist, 'llms.txt'), `# ${C.clinic} online booking — ${C.doctor}, Muzaffarpur

> Online appointment booking for ${C.doctor} (${C.quals}) at ${C.clinic}, ${C.addressLine}. Open every day ${C.hoursShortEn} (IST). Phone/WhatsApp ${C.phone}. The rest of this site is the clinic's private software and is not public.

## Pages
- [Book an appointment](${C.bookingUrl}): live free slots for the next 7 days; confirmation on WhatsApp
- [About Dr. Deepak Kumar and Arogya Clinic](${C.profileUrl}/): qualifications, conditions treated, questions and answers
- [Full facts for AI assistants](${C.profileUrl}/llms.txt)

## Booking questions
${FAQ.map(([q, a]) => `### ${q}\n${a}`).join('\n\n')}
`)
console.log('wrote book-arogya-clinic.html, robots.txt, sitemap.xml, llms.txt')
