// One real call to Sarvam speech-to-text. Run: node --env-file=.env scripts/sarvam-check.mjs [audio-file]
// With no file it sends 1 second of silence, which only proves the key and endpoint work (empty transcript).
import { SarvamAIClient } from 'sarvamai'
import fs from 'node:fs'

const key = process.env.SARVAM_API_KEY
if (!key) { console.error('SARVAM_API_KEY is not set (put it in .env)'); process.exit(1) }

let file = process.argv[2]
if (!file) {
  const n = 16000, buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(16000, 24); buf.writeUInt32LE(32000, 28)
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40)
  file = '/tmp/sarvam-silence.wav'; fs.writeFileSync(file, buf)
}

const client = new SarvamAIClient({ apiSubscriptionKey: key })
const result = await client.speechToText.transcribe({ file: fs.createReadStream(file), model: 'saaras:v3', mode: 'codemix' })
console.log(result)
