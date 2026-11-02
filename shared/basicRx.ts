/* A basic, no-AI reading of a dictated consult (Hinglish in Roman or Devanagari script, or English).
   Used only when no AI provider answers, so voice still gives the doctor a starting draft.
   It splits the dictation into phrases and pulls out vitals, frequency, timing, days and follow-up with fixed rules.
   Deciding which phrase names a medicine is done by the caller against the medicine list. */

export type BasicPhrase = { text: string; name: string; strength: string; freq: string; timing: '' | 'after' | 'before' | 'empty'; days: number | null; form: string }
export type BasicParse = {
  vitals: { bp: string; pulse: string; spo2: string; temp: string; rr: string; grbs: string; weight: string }
  follow_up_days: number | null; phrases: BasicPhrase[]; investigations: string[]; advice: string[]; other: string[]
}

const NUM: Record<string, number> = {
  ek: 1, one: 1, do: 2, two: 2, teen: 3, tin: 3, three: 3, char: 4, chaar: 4, four: 4, paanch: 5, panch: 5, pach: 5, five: 5, chhe: 6, che: 6, chah: 6, six: 6,
  saat: 7, sat: 7, seven: 7, aath: 8, ath: 8, eight: 8, nau: 9, nine: 9, das: 10, ten: 10, pandrah: 15, fifteen: 15, bees: 20, twenty: 20, tees: 30, thirty: 30,
  'एक': 1, 'दो': 2, 'तीन': 3, 'चार': 4, 'पांच': 5, 'पाँच': 5, 'छह': 6, 'सात': 7, 'आठ': 8, 'दस': 10, 'पंद्रह': 15, 'तीस': 30,
}
const n = (w: string) => /^\d+$/.test(w) ? Number(w) : NUM[w] ?? null
const W = '(\\d+|[a-z]+|[\\u0900-\\u097F]+)'

/** "paanch din" → 5, "ek hafta" → 7, "do mahine" → 60. */
function duration(t: string): number | null {
  const m = t.match(new RegExp(`${W}\\s*(din|dino|days?|दिन|hafte|hafta|haftey|weeks?|हफ्ते|हफ़्ते|mahine|mahina|months?|महीने|महीना)`))
  if (!m) return null
  const k = n(m[1]); if (k == null) return null
  return /haft|week|हफ/.test(m[2]) ? k * 7 : /mahin|month|महीन/.test(m[2]) ? k * 30 : k
}

function frequency(t: string): string {
  if (/\b\d\s*-\s*\d\s*-\s*\d(\s*-\s*\d)?\b/.test(t)) return t.match(/\d\s*-\s*\d\s*-\s*\d(\s*-\s*\d)?/)![0].replace(/\s/g, '')
  if (/char baar|chaar baar|\bqid\b|four times|चार बार/.test(t)) return '1-1-1-1'
  if (/teen baar|tin baar|\btds\b|\btid\b|three times|तीन बार/.test(t)) return '1-1-1'
  if (/subah\s*(aur\s*)?shaam|subah[- ]shaam|do baar|\bbd\b|\bbid\b|twice|morning and (evening|night)|सुबह\s*(और\s*)?शाम|दो बार/.test(t)) return '1-0-1'
  if (/zaroorat|jarurat|\bsos\b|if needed|when needed|ज़रूरत|जरूरत/.test(t)) return 'SOS'
  if (/hafte mein ek|weekly|once a week|हफ्ते में एक/.test(t)) return 'Weekly'
  if (/dopahar|afternoon|दोपहर/.test(t)) return '0-1-0'
  if (/raat|sote samay|night|bedtime|\bhs\b|रात|सोते/.test(t)) return '0-0-1'
  if (/subah|morning|\bod\b|once (a )?daily|ek baar|सुबह|एक बार/.test(t)) return '1-0-0'
  return ''
}

function timing(t: string): BasicPhrase['timing'] {
  if (/khane se pehle|khana se pahle|nashte se pehle|before (food|meal|breakfast)|खाने से पहले|नाश्ते से पहले/.test(t)) return 'before'
  if (/khali pet|empty stomach|खाली पेट/.test(t)) return 'empty'
  if (/khane ke baad|khana ke bad|after (food|meal)|खाने के बाद/.test(t)) return 'after'
  return ''
}

function form(t: string): string {
  if (/\b(syrup|syp|सिरप)\b/.test(t)) return 'SYP'
  if (/\b(capsule|cap)\b|कैप्सूल/.test(t)) return 'CAP'
  if (/\b(injection|inj)\b|इंजेक्शन/.test(t)) return 'INJ'
  if (/\b(drops?)\b|ड्रॉप/.test(t)) return 'DROP'
  if (/\b(ointment|cream|gel)\b/.test(t)) return t.match(/\b(ointment|cream|gel)\b/)![1] === 'ointment' ? 'OINT' : t.match(/\b(cream|gel)\b/)![1].toUpperCase()
  if (/\b(inhaler)\b/.test(t)) return 'INH'
  return ''
}

/** Words that describe how to take a medicine; removed to leave the medicine name. */
const HOW = /\b(tablet|tab|tabs|goli|capsule|cap|syrup|syp|injection|inj|drops?|ointment|cream|gel|inhaler|dena|dijiye|lijiye|lena|le|lo|dein|de|do|hai|ka|ki|ke|ko|se|mein|me|par|aur|and|then|phir|teen|tin|char|chaar|do|ek|baar|times?|subah|shaam|dopahar|raat|sote|samay|khane|khana|nashte|ke|baad|bad|pehle|pahle|khali|pet|din|dino|days?|hafte|hafta|weeks?|mahine|mahina|months?|tak|for|after|before|food|meals?|morning|evening|night|daily|once|twice|bd|tds|od|qid|sos|zaroorat|jarurat|weekly|bedtime|empty|stomach|one|two|three|four|five|six|seven|ten|paanch|panch|saat|das|chhe|aath|week)\b|गोली|दवा|सुबह|शाम|दोपहर|रात|खाने|के|बाद|पहले|दिन|बार|तक|और|लीजिए|दीजिए|एक|दो|तीन|चार|पांच|पाँच|सात|दस/gi

const VITAL = /\b(bp|blood pressure|temp|temperature|tapman|pulse|nadi|spo2|oxygen|saturation|grbs|rbs|sugar|weight|wajan|vajan)\b|बीपी|तापमान|पल्स|ऑक्सीजन|शुगर|वजन/

/* Devanagari → Roman, enough to match a spoken medicine name ("डोलो" → "dolo") against the list. */
const CONS: Record<string, string> = { 'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'n', 'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'n', 'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n', 'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n', 'प': 'p', 'फ': 'f', 'ब': 'b', 'भ': 'bh', 'म': 'm', 'य': 'y', 'र': 'r', 'ल': 'l', 'व': 'v', 'श': 'sh', 'ष': 'sh', 'स': 's', 'ह': 'h', 'ज़': 'z', 'फ़': 'f', 'ड़': 'r', 'क़': 'q' }
const VOW: Record<string, string> = { 'अ': 'a', 'आ': 'a', 'इ': 'i', 'ई': 'i', 'उ': 'u', 'ऊ': 'u', 'ए': 'e', 'ऐ': 'ai', 'ओ': 'o', 'औ': 'au', 'ऑ': 'o', 'ऋ': 'ri' }
const MAT: Record<string, string> = { 'ा': 'a', 'ि': 'i', 'ी': 'i', 'ु': 'u', 'ू': 'u', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au', 'ॉ': 'o', 'ृ': 'ri', 'ं': 'n', 'ँ': 'n', 'ः': 'h' }
/** Share of three-letter pieces two words have in common (0..1), like Postgres pg_trgm. */
export const phon = (x: string) => x.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/^e|(\s)e/g, '$1a').replace(/ph/g, 'f').replace(/c(?=[eiy])/g, 's').replace(/ck|c|q/g, 'k').replace(/z/g, 'j').replace(/y/g, 'i')
  .replace(/ai|ae/g, 'a').replace(/au|ou/g, 'o').replace(/ee/g, 'i').replace(/oo/g, 'u').replace(/th/g, 't').replace(/([a-z])\1+/g, '$1').replace(/(\w)e\b/g, '$1')
export function trigramSim(a: string, b: string): number {
  const g = (x: string) => { const t = '  ' + phon(x).replace(/[^a-z0-9]+/g, ' ').trim() + ' ', set = new Set<string>(); for (let i = 0; i < t.length - 2; i++) set.add(t.slice(i, i + 3)); return set }
  const A = g(a), B = g(b); let k = 0; for (const x of A) if (B.has(x)) k++
  return A.size + B.size - k ? k / (A.size + B.size - k) : 0
}

export function roman(s: string): string {
  const ch = [...s.normalize('NFC')]; let out = ''
  for (let i = 0; i < ch.length; i++) {
    const c = ch[i], nx = ch[i + 1]
    if (CONS[c] && nx === '़' && CONS[c + '़']) { out += CONS[c + '़']; i++; const n2 = ch[i + 1]; if (n2 === '्') i++; continue }
    if (CONS[c]) { out += CONS[c]; if (nx === '्') { i++; continue } if (nx && (MAT[nx] || nx === '़')) continue; if (nx && CONS[nx] && ch[i + 2] && ch[i + 2] !== ' ') out += 'a'; continue }
    if (c === '़' || c === '्') continue
    out += VOW[c] ?? MAT[c] ?? c
  }
  return out
}

const TESTS = /\b(cbc|esr|crp|lft|kft|rft|tsh|t3|t4|hba1c|fbs|ppbs|rbs|lipid|urine|stool|x-?ray|usg|ultrasound|ecg|echo|widal|dengue|malaria|typhi|culture|ct scan|mri|sugar test|blood test|test|jaanch|janch|karwa|karva|karaiye|जांच|टेस्ट)\b/
const ADVICE = /\b(paani|pani|water|aaram|aram|rest|parhez|parhej|avoid|na khaye|mat khaye|tel|oily|masaledar|exercise|walk|tahle|tehle|garam paani|bhaap|steam|gargle|garare|namak)\b|पानी|आराम|परहेज/

export function basicParse(transcript: string): BasicParse {
  const t = ' ' + transcript.toLowerCase().replace(/[“”"]/g, ' ').replace(/\s+/g, ' ') + ' '
  const vitals = { bp: '', pulse: '', spo2: '', temp: '', rr: '', grbs: '', weight: '' }
  const bp = t.match(/(?:bp|blood pressure|बीपी)?\s*(\d{2,3})\s*(?:by|\/|over|बाय|बाई)\s*(\d{2,3})/)
  if (bp && Number(bp[1]) > Number(bp[2]) && Number(bp[1]) >= 70) vitals.bp = `${bp[1]}/${bp[2]}`
  const g = (re: RegExp) => t.match(re)?.[1] || ''
  vitals.temp = g(/(?:temp(?:erature)?|tapman|bukhar|fever|बुखार|तापमान)\D{0,12}(9[5-9](?:\.\d)?|10[0-6](?:\.\d)?)/)
  vitals.pulse = g(/(?:pulse|nadi|नाड़ी|पल्स)\D{0,8}(\d{2,3})/)
  vitals.spo2 = g(/(?:spo2|sp o2|oxygen|saturation|ऑक्सीजन)\D{0,8}(\d{2,3})/)
  vitals.grbs = g(/(?:grbs|rbs|sugar|शुगर)\D{0,8}(\d{2,3})/)
  vitals.weight = g(/(?:weight|wajan|vajan|वजन|वज़न)\D{0,8}(\d{1,3})/)
  const fu = t.match(new RegExp(`${W}\\s*(din|days?|दिन|hafte|hafta|weeks?|हफ्ते)\\s*(baad|bad|after|बाद)\\s*(dikha|aana|aaiye|aayen|aaye|milna|follow|review|दिखा|आइए|आना)`))
  let follow_up_days: number | null = null
  if (fu) { const k = n(fu[1]); if (k != null) follow_up_days = /haft|week|हफ/.test(fu[2]) ? k * 7 : k }
  else { const f2 = t.match(/follow[- ]?up\D{0,10}(\d+)\s*(din|days?)/); if (f2) follow_up_days = Number(f2[1]) }

  // phrases: split on full stops, commas, new lines and "aur/phir/then" between instructions
  const parts = transcript.split(/[.,;।\n]+|\s(?:aur|phir|then|uske baad|और|फिर)\s/i).map(s => s.trim()).filter(s => s.length > 1)
  const phrases: BasicPhrase[] = [], investigations: string[] = [], advice: string[] = [], other: string[] = []
  for (const raw of parts) {
    const p = ' ' + raw.toLowerCase() + ' '
    if (fu && p.includes(fu[0].trim())) continue
    if (VITAL.test(p) && !/\b(tab|tablet|syrup|cap)\b/.test(p) && !frequency(p)) continue   // already read into vitals
    if (TESTS.test(p) && !/\d+\s*mg/.test(p)) { investigations.push(raw.replace(/\b(karwa|karva|karaiye|karwaiye|lijiye|kijiye)\b.*$/i, '').trim().toUpperCase().replace(/\bTEST\b/, 'test') || raw); continue }
    if (ADVICE.test(p)) { advice.push(raw.charAt(0).toUpperCase() + raw.slice(1)); continue }
    const fr = frequency(p), tm = timing(p), dy = duration(p), fm = form(p)
    const strength = (p.match(/\b(\d+(?:\.\d+)?)\s*(mg|mcg|ml|gm|g|iu)\b/) || p.match(/\b(\d{2,4})\b/) || [])[0] || ''
    const name = roman(raw.replace(HOW, ' ')).replace(HOW, ' ').replace(/\b\d+(?:\.\d+)?\s*(mg|mcg|ml|gm|g|iu)\b/gi, ' ').replace(/\b\d+\b/g, ' ').replace(/[-–]+/g, ' ').replace(/\s+/g, ' ').trim()
    if (fr || dy || fm || strength) phrases.push({ text: raw, name, strength: strength.replace(/\s+/g, ' '), freq: fr, timing: tm, days: dy, form: fm })
    else other.push(raw)
  }
  return { vitals, follow_up_days, phrases, investigations, advice, other }
}
