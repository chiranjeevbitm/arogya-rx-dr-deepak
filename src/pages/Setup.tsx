import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { Field } from '../components/ui'

type Status = { clinics: number; medicines: number; seed_parts: number; env: Record<string, any> }
export default function Setup() {
  const [st, setSt] = useState<Status | null>(null), [err, setErr] = useState('')
  const [f, setF] = useState({ token: '', clinic_name: 'Arogya Clinic', slug: 'arogya-clinic', doctor_name: 'Dr. Deepak Kumar', phone: '', password: '' })
  const [step, setStep] = useState<'form' | 'seeding' | 'done'>('form'), [prog, setProg] = useState(0), [busy, setBusy] = useState(false)
  const load = () => api<Status>('/setup/status').then(setSt).catch(e => setErr(e.message))
  useEffect(() => { load() }, [])
  const seed = async (token?: string) => {
    setStep('seeding')
    for (let p = 0; p < (st?.seed_parts || 2); p++) { await api('/setup/seed-medicines', { body: { part: p, token } }); setProg(p + 1) }
    setStep('done'); load()
  }
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(''); setBusy(true)
    try { await api('/setup/init', { body: f }); await seed(f.token) } catch (e: any) { setErr(e.message); setStep('form') } finally { setBusy(false) }
  }
  const E = st?.env || {}
  const row = (ok: boolean, t: string, hint: string) => <div className="row small"><span className={'tag ' + (ok ? 'green' : 'amber')}>{ok ? 'Ready' : 'Missing'}</span><span className="grow">{t}</span>{!ok && <span className="faint tiny">{hint}</span>}</div>
  return <div className="center-page">
    <div className="auth-card" style={{ width: 'min(560px,100%)' }}>
      <div><div className="letter">Arogya Rx setup</div><p className="muted">One-time setup for Arogya Clinic. You need the setup code from the Vercel settings (SETUP_TOKEN).</p></div>
      {st && <div className="card stack tight">
        {row(true, 'Database connected', '')}
        {row(E.session_secret, 'Login security key', 'SESSION_SECRET')}
        {row(E.storage === 'supabase', 'File storage (Supabase)', 'optional: files are kept in the database')}
        {row(E.ai, 'AI for voice and photo intake', 'OPENAI_API_KEY')}
        {row(E.whatsapp_api, 'WhatsApp auto-send', 'AISENSY_API_KEY; links work without it')}
        {row(E.old_database, 'Old app database for import', 'OLD_DATABASE_URL')}
        {row(st.medicines > 0, `Medicine list (${st.medicines.toLocaleString('en-IN')} loaded)`, 'loaded during setup')}
      </div>}
      {err && <div className="alert crit">{err}</div>}
      {st && st.clinics > 0 && step === 'form' && <div className="stack">
        <div className="alert ok">Setup is done. {st.medicines === 0 && 'The medicine list is empty; load it below.'}</div>
        {st.medicines === 0 && <Field label="Setup code"><input className="inp" value={f.token} onChange={e => setF({ ...f, token: e.target.value })} /></Field>}
        {st.medicines === 0 && <button className="btn" onClick={() => seed(f.token).catch(e => { setErr(e.message); setStep('form') })}>Load medicine list</button>}
        <a className="btn primary" href="/">Go to login</a>
      </div>}
      {st && st.clinics === 0 && step === 'form' && <form className="stack" onSubmit={submit}>
        <Field label="Setup code"><input className="inp" value={f.token} onChange={e => setF({ ...f, token: e.target.value })} required /></Field>
        <div className="grid2">
          <Field label="Clinic name"><input className="inp" value={f.clinic_name} onChange={e => setF({ ...f, clinic_name: e.target.value })} required /></Field>
          <Field label="Booking link name" hint={`/book/${f.slug}`}><input className="inp" value={f.slug} onChange={e => setF({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })} required /></Field>
        </div>
        <Field label="Doctor's name"><input className="inp" value={f.doctor_name} onChange={e => setF({ ...f, doctor_name: e.target.value })} required /></Field>
        <div className="grid2">
          <Field label="Doctor's mobile (login)"><input className="inp" inputMode="tel" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} required /></Field>
          <Field label="Password" hint="At least 8 characters"><input className="inp" type="password" autoComplete="new-password" value={f.password} onChange={e => setF({ ...f, password: e.target.value })} required minLength={8} /></Field>
        </div>
        <button className="btn primary lg" disabled={busy}>{busy ? 'Setting up…' : 'Create clinic'}</button>
      </form>}
      {step === 'seeding' && <div className="alert info">Loading the medicine list… {prog}/{st?.seed_parts}</div>}
      {step === 'done' && <div className="stack"><div className="alert ok">Arogya Clinic is ready. Next: add the receptionist and check the letterhead in Settings.</div><a className="btn primary lg" href="/">Open Arogya Rx</a></div>}
    </div>
  </div>
}
