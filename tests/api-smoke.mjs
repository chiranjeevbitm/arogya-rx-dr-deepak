// End-to-end API test against a running local server (npm start) with an empty database.
const B = process.env.BASE || 'http://localhost:8787'
let cookie = ''
const jar = { doctor: '', reception: '' }
async function call(method, path, body, who) {
  const h = { 'Content-Type': 'application/json', Origin: B }
  const ck = who ? jar[who] : cookie
  if (ck) h.Cookie = ck
  const r = await fetch(B + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined })
  const sc = r.headers.get('set-cookie'); if (sc) { const v = sc.split(';')[0]; if (who) jar[who] = v; else cookie = v }
  const t = await r.text(); let j; try { j = JSON.parse(t) } catch { j = t }
  return { status: r.status, j }
}
let fails = 0
const ok = (cond, msg, extra) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg + (cond ? '' : ' → ' + JSON.stringify(extra).slice(0, 300))); if (!cond) fails++ }

let r = await call('GET', '/api/setup/status'); ok(r.j.clinics === 0, 'fresh database, no clinic', r.j)
r = await call('POST', '/api/setup/init', { token: 'wrong-code-x', clinic_name: 'Arogya Clinic', slug: 'arogya-clinic', doctor_name: 'Dr. Deepak Kumar', phone: '9199943818', password: 'Deepak@2026' }); ok(r.status === 403, 'setup rejects a wrong code', r)
r = await call('POST', '/api/setup/init', { token: 'local-setup-code', clinic_name: 'Arogya Clinic', slug: 'arogya-clinic', doctor_name: 'Dr. Deepak Kumar', phone: '9199943818', password: 'Deepak@2026' }, 'doctor'); ok(r.status === 200, 'setup creates clinic + doctor', r)
r = await call('POST', '/api/setup/init', { token: 'local-setup-code', clinic_name: 'XX', slug: 'xyz-abc', doctor_name: 'XX', phone: '9000000000', password: 'whatever123' }); ok(r.status === 409, 'setup cannot run twice', r)
for (const part of [0, 1]) { r = await call('POST', '/api/setup/seed-medicines', { part }, 'doctor'); ok(r.status === 200 && r.j.inserted > 4000, `seed medicines part ${part}`, r) }
r = await call('GET', '/api/auth/me', null, 'doctor'); ok(r.j.user?.role === 'doctor' && r.j.clinic.settings.letterhead.reg_no === 'BCMR50223', 'me returns doctor + letterhead', r.j)

r = await call('POST', '/api/auth/login', { phone: '9199943818', password: 'bad' }); ok(r.status === 401, 'login rejects wrong password', r)
r = await call('POST', '/api/clinic/staff', { name: 'Reception', phone: '9876543210', role: 'reception', password: 'Recep@2026' }, 'doctor'); ok(r.status === 200, 'doctor adds a receptionist', r)
r = await call('POST', '/api/auth/login', { phone: '+91 98765 43210', password: 'Recep@2026' }, 'reception'); ok(r.status === 200, 'receptionist logs in (phone with +91 and spaces)', r)
r = await call('GET', '/api/clinic/staff', null, 'reception'); ok(r.status === 403, 'reception cannot manage staff', r)
r = await call('GET', '/api/patients'); ok(r.status === 401, 'no cookie → 401', r)
r = await fetch(B + '/api/patients', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example', Cookie: jar.doctor }, body: '{}' }); ok(r.status === 403, 'cross-site POST blocked', r.status)

r = await call('GET', '/api/medicines?q=metformin', null, 'doctor'); ok(r.j.length > 3 && /metformin/i.test(r.j[0].name), 'medicine search: metformin', r.j.slice?.(0, 3))
r = await call('GET', '/api/medicines?q=dolo 65', null, 'doctor'); ok(r.j.length > 0, 'medicine search: brand prefix "dolo 65"', r.j.slice?.(0, 3))
r = await call('GET', '/api/medicines?q=paracetmol', null, 'doctor'); ok(r.j.some(x => /paracetamol/i.test(x.name)), 'fuzzy search handles a typo (paracetmol)', r.j.slice?.(0, 3))
r = await call('GET', '/api/medicines/ja?name=' + encodeURIComponent('Telmisartan 40 mg Tablet'), null, 'doctor'); ok(r.j && /telmisartan/i.test(r.j.name), 'Jan Aushadhi alternative found', r.j)

// reception registers a new patient into the queue
r = await call('POST', '/api/visits', { patient: { name: 'Sita Devi', sex: 'F', age_years: 45, phone: '9934000001', allergies: ['Sulfa'] }, complaint: 'Burning urination', vitals: { bp: '124/80', temp: '100.4' } }, 'reception')
ok(r.status === 200 && r.j.token === 1, 'reception registers patient → token 1', r)
const visit1 = r.j
r = await call('POST', '/api/visits', { patient_id: visit1.patient_id }, 'reception'); ok(r.status === 409, 'same patient cannot be queued twice', r)
r = await call('POST', '/api/visits', { patient: { name: 'Mohd Arif', sex: 'M', age_years: 28, phone: '9934000002' }, complaint: 'Fever 3 days' }, 'reception'); ok(r.j.token === 2, 'second patient → token 2', r)
r = await call('GET', '/api/patients?q=sita', null, 'reception'); ok(r.j[0]?.uhid === 'AC-00001', 'patient search by name, UHID AC-00001', r.j)
r = await call('GET', '/api/patients?q=9934000002', null, 'reception'); ok(r.j[0]?.name === 'Mohd Arif', 'patient search by phone', r.j)

r = await call('POST', `/api/visits/${visit1.id}/start`, {}, 'reception'); ok(r.status === 403, 'reception cannot start a consult', r)
r = await call('POST', `/api/visits/next`, {}, 'doctor'); ok(r.j.visit_id === visit1.id, 'doctor calls next → token 1', r)
r = await call('POST', `/api/visits/${visit1.id}/start`, {}, 'doctor'); ok(!!r.j.rx_id, 'consult starts with a draft prescription', r)
const rxId = r.j.rx_id
r = await call('GET', `/api/rx/${rxId}`, null, 'doctor'); ok(r.j.rx.data.vitals.bp === '124/80' && r.j.rx.data.complaints === 'Burning urination', 'draft carries reception vitals + complaint', r.j.rx?.data)
const meds = [{ name: 'Cotrimoxazole DS Tablet', kind: 'brand', form: 'TAB', dose: '1', freq: '1-0-1', timing: 'after', days: 5 }]
const data = { ...r.j.rx.data, diagnosis: 'Lower UTI', advice: ['Drink plenty of fluids'], investigations: ['Urine R/M'], follow_up: { days: 5, note: '' } }
r = await call('PUT', `/api/rx/${rxId}`, { data, meds }, 'doctor'); ok(r.status === 200, 'autosave draft', r)
r = await call('POST', `/api/rx/${rxId}/finalize`, { data, meds }, 'doctor'); ok(r.status === 409 && r.j.code === 'SAFETY' && /allergic to Sulfonamide/.test(r.j.error), 'sulfa allergy blocks finalise', r)
const meds2 = [{ name: 'Nitrofurantoin 100 mg Capsule', kind: 'brand', form: 'CAP', dose: '1', freq: '1-0-1', timing: 'after', days: 5 }, { name: 'Paracetamol 650 mg Tablet', kind: 'ja', form: 'TAB', dose: '1', freq: 'SOS', timing: 'after', days: 3 }]
r = await call('POST', `/api/rx/${rxId}/finalize`, { data, meds: meds2 }, 'doctor'); ok(r.status === 200, 'finalise with safe medicines', r)
r = await call('POST', `/api/rx/${rxId}/finalize`, { data, meds: meds2 }, 'doctor'); ok(r.status === 200 && r.j.already === true, 'finalising twice is harmless (nothing is counted twice)', r)
r = await call('PUT', `/api/rx/${rxId}`, { data, meds: meds2 }, 'doctor'); ok(r.status === 409, 'final prescription is locked', r)
r = await call('GET', '/api/visits', null, 'reception'); ok(r.j.find(v => v.id === visit1.id)?.status === 'done', 'visit marked done', r.j)
r = await call('GET', '/api/appointments?from=2000-01-01&to=2100-01-01', null, 'reception'); ok(r.j.some(a => a.source === 'follow_up' && a.name === 'Sita Devi'), 'follow-up appointment auto-booked', r.j)
r = await call('GET', '/api/medicines', null, 'doctor'); ok(r.j[0]?.name && r.j.some(m => /Nitrofurantoin/.test(m.name)), 'doctor favourites learnt', r.j)

// PDF upload + WhatsApp link
const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF').toString('base64')
r = await call('POST', `/api/rx/${rxId}/pdf`, { pdf_base64: pdf }, 'doctor'); ok(r.status === 200 && r.j.url.includes('/api/public/rx/'), 'PDF stored, public signed link', r)
const pubUrl = r.j.url
let pr = await fetch(pubUrl); ok(pr.status === 200 && pr.headers.get('content-type') === 'application/pdf', 'patient can open the PDF link', pr.status)
pr = await fetch(pubUrl.replace(/t=[^&]+/, 't=123.abc')); ok(pr.status === 403, 'tampered link rejected', pr.status)
r = await call('POST', `/api/messages/rx/${rxId}`, { mode: 'auto' }, 'reception'); ok(r.j.channel === 'link' && r.j.url.startsWith('https://wa.me/919934000001') && /सुबह और रात · खाने के बाद · 5 दिन/.test(r.j.text), 'WhatsApp link with Hindi dose lines', r.j)

// billing
r = await call('POST', '/api/bills', { patient_id: visit1.patient_id, visit_id: visit1.id, items: [{ label: 'Consultation', amount: 500 }, { label: 'GRBS', amount: 50 }], discount: 50, mode: 'upi' }, 'reception'); ok(r.j.bill_no === 1, 'bill #1 created', r)
const billId = r.j.id
r = await call('POST', '/api/bills', { patient_id: visit1.patient_id, visit_id: visit1.id, items: [{ label: 'Consultation', amount: 500 }], mode: 'cash' }, 'reception'); ok(r.status === 409, 'cannot double-bill a visit', r)
r = await call('POST', `/api/bills/${billId}/void`, { reason: 'wrong amount' }, 'reception'); ok(r.status === 403, 'reception cannot void a bill', r)
r = await call('GET', '/api/clinic/summary', null, 'doctor'); ok(r.j.bills.collected === 500 && r.j.bills.upi === 500 && r.j.visits.total === 2, 'dashboard summary totals', r.j)
r = await call('GET', '/api/bills/report/collection', null, 'doctor'); ok(r.j.days[0]?.collected === 500, 'collection report', r.j)

// public booking
r = await call('GET', '/api/public/clinic/arogya-clinic'); ok(r.j.doctor === 'Dr. DEEPAK KUMAR', 'public clinic info', r.j)
const tomorrow = new Date(Date.now() + 86400000 + 5.5 * 3600000).toISOString().slice(0, 10)
r = await call('GET', `/api/public/clinic/arogya-clinic/slots?date=${tomorrow}`); const free = r.j.slots?.find(s => s.available); ok(!!free, 'public slots available tomorrow', r.j)
r = await call('POST', '/api/public/clinic/arogya-clinic/book', { name: 'Kavita Sharma', phone: '9123456780', age_years: 38, sex: 'F', date: tomorrow, time: free.time, reason: 'Thyroid review' }); ok(r.status === 200 && r.j.ok, 'patient books online', r)
r = await call('POST', '/api/public/clinic/arogya-clinic/book', { name: 'Kavita Sharma', phone: '9123456780', date: tomorrow, time: free.time }); ok(r.status === 409, 'duplicate booking same day rejected', r)
r = await call('POST', '/api/public/clinic/arogya-clinic/book', { name: 'Bot', phone: '9123456781', date: tomorrow, time: free.time, website: 'spam' }); ok(r.status === 200, 'honeypot silently accepted', r)
r = await call('GET', `/api/appointments?from=${tomorrow}&to=${tomorrow}`, null, 'reception'); const ap = r.j.find(a => a.name === 'Kavita Sharma'); ok(ap?.source === 'online' && !r.j.some(a => a.name === 'Bot'), 'online booking visible to reception, bot ignored', r.j)

// import from old app
r = await call('GET', '/api/import/old/status', null, 'doctor'); ok(r.j.old_prescriptions === 3, 'old DB reachable: 3 prescriptions', r)
r = await call('POST', '/api/import/old', { offset: 0, limit: 150 }, 'doctor'); ok(r.j.imported === 3 && r.j.patients_created === 2 && r.j.done, 'import: 3 prescriptions, 2 patients (Ramesh deduped by OP no)', r.j)
r = await call('POST', '/api/import/old', { offset: 0, limit: 150 }, 'doctor'); ok(r.j.imported === 0 && r.j.skipped === 3, 're-running import is safe', r.j)
r = await call('GET', '/api/patients?q=ramesh', null, 'doctor'); const ram = r.j[0]
r = await call('GET', `/api/patients/${ram.id}`, null, 'doctor')
ok(r.j.prescriptions.length === 2 && r.j.patient.conditions.includes('Diabetes'), 'imported patient has 2 prescriptions + conditions', r.j.patient)
const rx1 = r.j.prescriptions.find(p => p.rx_date.startsWith('2026-08-01'))
ok(rx1 && rx1.meds[0].freq === '1-0-1' && rx1.meds[0].days === 30 && rx1.meds[0].timing === 'after', 'imported medicine mapped (1-0-1, 30 days, after food)', rx1?.meds)
ok(r.j.labs.some(l => l.test === 'HbA1c' && l.value_num === 7.2), 'imported HbA1c becomes a trend point', r.j.labs)
r = await call('GET', `/api/rx/${rx1.id}`, null, 'doctor'); ok(r.j.rx.data.comorbid_details.diabetes.neuropathy === true && r.j.rx.data.systemic.cvs.includes('S1 S2 normal'), 'comorbidity details + CVS carried over', r.j.rx.data)
// one-request "call next", and two devices pressing it together must get different patients
r = await call('POST', '/api/visits', { patient: { name: 'Ravi Kumar', sex: 'M', age_years: 33, phone: '9934000003' }, complaint: 'Cough' }, 'reception'); ok(r.status === 200, 'a third patient joins the queue', r)
r = await call('POST', '/api/visits', { patient: { name: 'Geeta Devi', sex: 'F', age_years: 51, phone: '9934000004' }, complaint: 'Knee pain' }, 'reception'); ok(r.status === 200, 'a fourth patient joins the queue', r)
const [n1, n2] = await Promise.all([call('POST', '/api/visits/next?start=1', {}, 'doctor'), call('POST', '/api/visits/next?start=1', {}, 'doctor')])
ok(n1.status === 200 && n2.status === 200 && n1.j.rx_id && n2.j.rx_id && n1.j.visit_id !== n2.j.visit_id && n1.j.rx_id !== n2.j.rx_id, 'two devices calling next together get different patients, each with a draft', [n1.j, n2.j])
r = await call('POST', `/api/visits/${n1.j.visit_id}/start`, {}, 'doctor'); ok(r.j.rx_id === n1.j.rx_id, 'starting an already opened visit returns the same draft', r)
r = await call('GET', '/api/clinic/system', null, 'doctor'); ok(r.status === 200 && r.j.counts.patients >= 4 && r.j.counts.final_prescriptions >= 1 && typeof r.j.db_ms === 'number', 'system check returns record counts and timing', r)
r = await call('GET', '/api/clinic/system', null, 'reception'); ok(r.status === 403, 'reception cannot open the system check', r)
r = await call('GET', '/api/clinic/audit', null, 'doctor'); ok(r.j.some(a => a.action === 'rx.finalize') && r.j.some(a => a.action === 'login.failed'), 'audit log records actions', r.j.slice?.(0, 3))

console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED')
process.exit(fails ? 1 : 0)
