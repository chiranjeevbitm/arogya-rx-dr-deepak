/* WhatsApp delivery. With AISENSY_API_KEY set, messages go out automatically through an
   approved AiSensy campaign. Without it the app builds a wa.me link that staff tap to send. */
import { HttpError } from '../db.js'

export const waApiConfigured = () => !!process.env.AISENSY_API_KEY

export function waLink(phone10: string, text: string) {
  return `https://wa.me/91${phone10}?text=${encodeURIComponent(text)}`
}

export async function sendCampaign(o: { campaign: string; phone10: string; name: string; params: string[]; media?: { url: string; filename: string } }) {
  const key = process.env.AISENSY_API_KEY
  if (!key) throw new HttpError(503, 'WhatsApp API is not set up.')
  const r = await fetch(process.env.AISENSY_ENDPOINT || 'https://backend.aisensy.com/campaign/t1/api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey: key, campaignName: o.campaign, destination: `+91${o.phone10}`, userName: o.name || 'Patient', source: 'Arogya Rx', templateParams: o.params, ...(o.media ? { media: o.media } : {}) }),
    signal: AbortSignal.timeout(20000),
  })
  const text = await r.text()
  if (!r.ok) throw new HttpError(502, `WhatsApp send failed (${r.status}): ${text.slice(0, 200)}`)
  let ref = ''
  try { const j = JSON.parse(text); ref = j.submitted_message_id || j.messageId || j.id || '' } catch {}
  return { ref }
}
