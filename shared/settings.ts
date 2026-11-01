/* Clinic settings shape and Dr. Deepak Kumar's defaults (from his printed parchi). */
import type { Med } from './rx.js'

export type Session = { label: string; start: string; end: string }
export type ClinicSettings = {
  letterhead: {
    clinic_name_hi: string; clinic_name_en: string; address_hi: string; address_en: string
    doctor_en: string; quals_en: string; doctor_hi: string; quals_hi: string
    designation: string; reg_no: string; phone: string; timings: string; validity_days: number
    signature_name: string; signature_quals: string; ink: string; accent: string
    logo_file_id: string | null; signature_file_id: string | null; use_letterhead_art: boolean; diet_image: boolean
    show_qr: boolean; qr_text: string; show_diet: boolean
    diet: { label: string; text: string }[]; footer_note: string
    print_hindi_doses: boolean; print_vitals_blank_lines: boolean
    layout: 'center' | 'left'; paper: 'A5' | 'A4'
  }
  hours: { sessions: Session[]; slot_minutes: number; closed_days: number[]; per_slot: number }
  fees: { new_visit: number; follow_up: number; follow_up_days: number; upi_vpa: string; payee_name: string; extras: { label: string; amount: number }[] }
  booking: { enabled: boolean; days_ahead: number; note: string }
  whatsapp: { clinic_number: string; auto_send_rx: boolean; reminder_day_before: boolean }
  uhid_prefix: string
}

export const DEFAULT_SETTINGS: ClinicSettings = {
  letterhead: {
    clinic_name_hi: 'आरोग्य क्लिनिक',
    clinic_name_en: 'AROGYA CLINIC',
    address_hi: 'बड़ा जगन्नाथ, शक्ति धर्मकांटा, अहियापुर, मुजफ्फरपुर, 842001',
    address_en: 'Bada Jagannath, Shakti Dharmkanta, Ahiyapur, Muzaffarpur, Bihar 842001',
    doctor_en: 'Dr. DEEPAK KUMAR',
    quals_en: 'MBBS, MD. (General Medicine)',
    doctor_hi: 'डॉ0 दीपक कुमार',
    quals_hi: 'एम0 बी0 बी0 एस0, एम0 डी0 (जेनरल मेडिसीन)',
    designation: 'Consultant Physician',
    reg_no: 'BCMR50223',
    phone: '9199943818',
    timings: 'सुबह 6–9 · शाम 3–6',
    validity_days: 21,
    signature_name: 'Dr. Deepak Kumar',
    signature_quals: 'MBBS (SKMCH), MD General Medicine (DMCH Darbhanga)',
    ink: '#1d3a8a',
    accent: '#d0201b',
    logo_file_id: null,
    signature_file_id: null,
    use_letterhead_art: false,
    diet_image: true,
    show_qr: false,
    qr_text: 'https://g.page/r/CTWQ17nqHXrMEBE/review',
    show_diet: false,
    diet: [
      { label: 'Morning Breakfast', text: '1 bowl lukewarm milk with muesli/oats · 1–2 seasonal fruits · 1 glass green tea' },
      { label: 'Lunch', text: '1 bowl daal · ¼ cup boiled rice · 50 gm paneer · seasonal fruit' },
      { label: 'Dinner', text: 'Daal 1 cup · 1–2 roti + salad · 2 boiled eggs (without yolk) or 50 gm paneer' },
    ],
    footer_note: 'This is a computer-generated prescription.',
    print_hindi_doses: true,
    print_vitals_blank_lines: false,
    layout: 'center',
    paper: 'A5',
  },
  hours: {
    sessions: [
      { label: 'Morning', start: '06:00', end: '09:00' },
      { label: 'Evening', start: '15:00', end: '18:00' },
    ],
    slot_minutes: 10,
    closed_days: [],
    per_slot: 2,
  },
  fees: { new_visit: 500, follow_up: 300, follow_up_days: 21, upi_vpa: '', payee_name: 'Arogya Clinic', extras: [{ label: 'GRBS (sugar test)', amount: 50 }, { label: 'ECG', amount: 200 }, { label: 'Injection charge', amount: 50 }, { label: 'Nebulisation', amount: 100 }] },
  booking: { enabled: true, days_ahead: 7, note: 'Please arrive 10 minutes before your time and bring old prescriptions and reports.' },
  whatsapp: { clinic_number: '919199943818', auto_send_rx: false, reminder_day_before: true },
  uhid_prefix: 'AC',
}

export function mergeSettings(s: any): ClinicSettings {
  const d = DEFAULT_SETTINGS
  s = s || {}
  return {
    ...d, ...s,
    letterhead: { ...d.letterhead, ...(s.letterhead || {}) },
    hours: { ...d.hours, ...(s.hours || {}) },
    fees: { ...d.fees, ...(s.fees || {}) },
    booking: { ...d.booking, ...(s.booking || {}) },
    whatsapp: { ...d.whatsapp, ...(s.whatsapp || {}) },
  }
}

export type TemplateData = { complaints?: string; diagnosis: string; meds: Med[]; investigations: string[]; advice: string[]; follow_up_days?: number | null }

const t = (name: string, form: string, dose: string, freq: string, timing: Med['timing'], days: number | null, extra: Partial<Med> = {}): Med =>
  ({ name, form, dose, freq, timing, days, route: form === 'INJ' ? 'IV' : 'Oral', kind: 'brand', ...extra })

export const DEFAULT_TEMPLATES: { name: string; data: TemplateData }[] = [
  { name: 'Viral fever', data: { diagnosis: 'Acute febrile illness (viral)', meds: [t('Paracetamol 650 mg Tablet', 'TAB', '1', '1-1-1', 'after', 3), t('Levocetirizine 5 mg Tablet', 'TAB', '1', '0-0-1', 'after', 5), t('ORS Sachet', 'SACHET', '1 sachet', 'SOS', '', 3)], investigations: ['CBC', 'Dengue NS1'], advice: ['Drink plenty of fluids', 'Take rest', 'Come back immediately if symptoms worsen'], follow_up_days: 3 } },
  { name: 'URTI / sore throat', data: { diagnosis: 'Upper respiratory tract infection', meds: [t('Azithromycin 500 mg Tablet', 'TAB', '1', '1-0-0', 'after', 3), t('Levocetirizine 5 mg Tablet', 'TAB', '1', '0-0-1', 'after', 5), t('Paracetamol 650 mg Tablet', 'TAB', '1', 'SOS', 'after', 3)], investigations: [], advice: ['Steam inhalation twice daily', 'Drink plenty of fluids'], follow_up_days: 5 } },
  { name: 'Gastritis / APD', data: { diagnosis: 'Acid peptic disease', meds: [t('Pantoprazole 40 mg Tablet', 'TAB', '1', '1-0-0', 'empty', 14), t('Domperidone 10 mg Tablet', 'TAB', '1', '1-0-1', 'before', 5)], investigations: [], advice: ['Avoid oily and spicy food'], follow_up_days: 14 } },
  { name: 'HTN follow-up', data: { diagnosis: 'Essential hypertension', meds: [t('Telmisartan 40 mg Tablet', 'TAB', '1', '1-0-0', '', 30), t('Amlodipine 5 mg Tablet', 'TAB', '1', '0-0-1', '', 30)], investigations: ['S. creatinine', 'S. electrolytes', 'Lipid profile'], advice: ['Low salt diet', 'Walk 30 minutes daily', 'Check BP at home every week'], follow_up_days: 30 } },
  { name: 'T2DM follow-up', data: { diagnosis: 'Type 2 diabetes mellitus', meds: [t('Metformin SR 500 mg Tablet', 'TAB', '1', '1-0-1', 'after', 30), t('Glimepiride 1 mg Tablet', 'TAB', '1', '1-0-0', 'before', 30), t('Atorvastatin 10 mg Tablet', 'TAB', '1', '0-0-1', 'after', 30)], investigations: ['FBS', 'PPBS', 'HbA1c'], advice: ['Avoid sugar and sweets', 'Walk 30 minutes daily', 'Check sugar at home every week'], follow_up_days: 30 } },
  { name: 'UTI', data: { diagnosis: 'Lower urinary tract infection', meds: [t('Nitrofurantoin 100 mg Capsule', 'CAP', '1', '1-0-1', 'after', 5), t('Paracetamol 650 mg Tablet', 'TAB', '1', 'SOS', 'after', 3)], investigations: ['Urine R/M', 'Urine C/S'], advice: ['Drink plenty of fluids'], follow_up_days: 5 } },
  { name: 'Acute gastroenteritis', data: { diagnosis: 'Acute gastroenteritis', meds: [t('ORS Sachet', 'SACHET', '1 sachet', 'SOS', '', 3), t('Ondansetron 4 mg Tablet', 'TAB', '1', 'SOS', 'before', 3), t('Racecadotril 100 mg Capsule', 'CAP', '1', '1-1-1', 'after', 3), t('Zinc 20 mg Tablet', 'TAB', '1', '1-0-0', 'after', 14)], investigations: ['CBC', 'S. electrolytes'], advice: ['ORS after every loose stool', 'Come back immediately if symptoms worsen'], follow_up_days: 3 } },
  { name: 'Allergic rhinitis', data: { diagnosis: 'Allergic rhinitis', meds: [t('Montelukast 10 mg + Levocetirizine 5 mg Tablet', 'TAB', '1', '0-0-1', 'after', 10)], investigations: [], advice: ['Steam inhalation twice daily'], follow_up_days: 10 } },
  { name: 'COPD / Asthma', data: { diagnosis: 'COPD / bronchial asthma', meds: [t('Budesonide + Formoterol Rotacap', 'ROTACAP', '1', '1-0-1', '', 30, { route: 'Inhalation' }), t('Levosalbutamol Inhaler', 'INH', '2 puffs', 'SOS', '', 30, { route: 'Inhalation' }), t('Montelukast 10 mg Tablet', 'TAB', '1', '0-0-1', 'after', 30)], investigations: ['Chest X-ray PA', 'CBC'], advice: ['Stop smoking and tobacco'], follow_up_days: 30 } },
  { name: 'Iron deficiency anaemia', data: { diagnosis: 'Iron deficiency anaemia', meds: [t('Ferrous Ascorbate + Folic Acid Tablet', 'TAB', '1', '0-1-0', 'after', 90), t('Cholecalciferol 60000 IU Sachet', 'SACHET', '1 sachet', 'Weekly', 'after', 56)], investigations: ['CBC', 'S. ferritin'], advice: [], follow_up_days: 30 } },
  { name: 'Hypothyroidism', data: { diagnosis: 'Hypothyroidism', meds: [t('Levothyroxine 50 mcg Tablet', 'TAB', '1', '1-0-0', 'empty', 60)], investigations: ['TSH'], advice: ['Do not stop medicines without asking the doctor'], follow_up_days: 60 } },
  { name: 'Typhoid (enteric fever)', data: { diagnosis: 'Enteric fever', meds: [t('Cefixime 200 mg Tablet', 'TAB', '1', '1-0-1', 'after', 14), t('Paracetamol 650 mg Tablet', 'TAB', '1', '1-1-1', 'after', 5)], investigations: ['CBC', 'Widal', 'Typhidot'], advice: ['Drink plenty of fluids', 'Take rest'], follow_up_days: 5 } },
]
