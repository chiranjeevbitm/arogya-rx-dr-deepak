import { lazy, Suspense, useEffect, useState } from 'react'
import { Routes, Route, Navigate, NavLink, Link, useLocation, useParams } from 'react-router-dom'
import { useSession, useMe } from './lib/session'
import Icon from './components/Icon'
import { Spinner } from './components/ui'
import { api } from './lib/api'
import Login from './pages/Login'
import Setup from './pages/Setup'
import Book from './pages/Book'

const Opd = lazy(() => import('./pages/Opd'))
const Patients = lazy(() => import('./pages/Patients'))
const RxView = lazy(() => import('./pages/RxView'))
const Appointments = lazy(() => import('./pages/Appointments'))
const Billing = lazy(() => import('./pages/Billing'))
const Settings = lazy(() => import('./pages/Settings'))

export default function App() {
  const { me, loading } = useSession()
  const loc = useLocation()
  if (loc.pathname.startsWith('/book/')) return <Routes><Route path="/book/:slug" element={<Book />} /></Routes>
  if (loc.pathname === '/setup') return <Setup />
  if (loading) return <div className="center-page"><Spinner /></div>
  if (!me) return <Login />
  return <Shell>
    <Suspense fallback={<Spinner />}>
      <Routes>
        <Route path="/" element={<Navigate to="/opd" replace />} />
        <Route path="/opd" element={<Opd />} />
        <Route path="/opd/:rxId" element={<Opd />} />
        <Route path="/consult/:rxId" element={<RedirectConsult />} />
        <Route path="/intake" element={<Navigate to="/schedule" replace />} />
        <Route path="/patients" element={<Patients />} />
        <Route path="/patients/:id" element={<Patients />} />
        <Route path="/rx/:id" element={<RxView />} />
        <Route path="/schedule" element={<Appointments />} />
        <Route path="/appointments" element={<Navigate to="/schedule" replace />} />
        <Route path="/billing" element={<Billing />} />
        <Route path="/settings/*" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  </Shell>
}

function Shell({ children }: { children: React.ReactNode }) {
  const me = useMe()
  const L = me.clinic.settings.letterhead
  // four everyday screens plus Settings; Home, Intake and the old "Ask" box now live inside them
  const nav = [
    { to: '/opd', n: 'rx', label: 'OPD & Rx', tab: true },
    { to: '/patients', n: 'users', label: 'Patients', tab: true },
    { to: '/schedule', n: 'cal', label: 'Schedule', tab: true },
    { to: '/billing', n: 'rupee', label: 'Billing', tab: true },
    { to: '/settings', n: 'gear', label: 'Settings', tab: false },
  ]
  const [slim, setSlim] = useState(() => { try { return localStorage.getItem('arx.rail') === '1' } catch { return false } })
  const toggle = () => setSlim(s => { const v = !s; try { localStorage.setItem('arx.rail', v ? '1' : '0') } catch { /* private mode */ } return v })
  // warm up the other screens and the medicine list while the doctor is busy, so every click after is instant
  useEffect(() => {
    const warm = () => { import('./pages/Opd'); import('./pages/Patients'); import('./pages/Appointments'); import('./pages/Billing'); import('./pages/RxView'); import('./lib/medcat').then(m => m.loadCatalogue()).catch(() => {}) }
    const ric = (window as any).requestIdleCallback as undefined | ((f: () => void, o?: any) => number)
    if (ric) ric(warm, { timeout: 3000 }); else setTimeout(warm, 1500)
  }, [])
  const logout = async () => { await api('/auth/logout', { method: 'POST' }); location.href = '/' }
  return <div className={'shell' + (slim ? ' slim' : '')}>
    <aside className="rail no-print">
      <Link to="/" className="brand" title="Home"><span className="brand-mark">℞</span><span className="lbl"><b>{L.clinic_name_hi}</b><small>Arogya Rx</small></span></Link>
      {nav.map(x => <NavLink key={x.to} to={x.to} className={({ isActive }) => 'nav-a' + (isActive ? ' active' : '')} title={slim ? x.label : undefined} aria-label={x.label}><Icon n={x.n} /><span className="lbl">{x.label}</span></NavLink>)}
      <button type="button" className="nav-a rail-toggle" onClick={toggle} title={slim ? 'Expand menu' : 'Collapse menu'} aria-label={slim ? 'Expand menu' : 'Collapse menu'} aria-pressed={slim}><Icon n="sidebar" /><span className="lbl">Collapse menu</span></button>
      <div className="rail-foot">
        <span className="avatar">{me.user.name.replace(/^Dr\.?\s*/i, '').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}</span>
        <span className="grow lbl"><b className="ellipsis" style={{ display: 'block' }}>{me.user.name}</b><span className="tiny muted">{me.user.role === 'doctor' ? 'Doctor' : me.user.role === 'reception' ? 'Reception' : 'Admin'}</span></span>
        <button className="icon-btn" onClick={logout} title="Log out" aria-label="Log out"><Icon n="out" /></button>
      </div>
    </aside>
    <main className="main">{children}</main>
    <nav className="tabbar no-print">{nav.filter(x => x.tab).map(x => <NavLink key={x.to} to={x.to} className={({ isActive }) => (isActive ? 'active' : '')}><Icon n={x.n} />{x.label}</NavLink>)}</nav>
  </div>
}

function RedirectConsult() { const { rxId } = useParams(); return <Navigate to={`/opd/${rxId}`} replace /> }
