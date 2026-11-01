import { useState } from 'react'
import { api } from '../lib/api'
import { useSession } from '../lib/session'
import { Field } from '../components/ui'

export default function Login() {
  const { refresh } = useSession()
  const [phone, setPhone] = useState(''), [pw, setPw] = useState(''), [err, setErr] = useState(''), [busy, setBusy] = useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(''); setBusy(true)
    try { await api('/auth/login', { body: { phone, password: pw } }); await refresh() } catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }
  return <div className="center-page">
    <form className="auth-card" onSubmit={submit}>
      <div><div className="letter">आरोग्य क्लिनिक</div><p className="muted">Arogya Rx · Dr. Deepak Kumar</p></div>
      <Field label="Mobile number"><input className="inp" inputMode="tel" autoComplete="username" value={phone} onChange={e => setPhone(e.target.value)} required /></Field>
      <Field label="Password"><input className="inp" type="password" autoComplete="current-password" value={pw} onChange={e => setPw(e.target.value)} required /></Field>
      {err && <div className="alert crit" role="alert">{err}</div>}
      <button className="btn primary lg" disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>
      <p className="tiny muted">Forgot your password? Ask Dr. Deepak to reset it from Settings → Staff.</p>
    </form>
  </div>
}
