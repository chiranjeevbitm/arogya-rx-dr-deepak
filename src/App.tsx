import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate, NavLink, Link, useLocation, useParams } from 'react-router-dom'
import { useSession, useMe } from './lib/session'
import Icon from './components/Icon'
import { Spinner } from './components/ui'
import { api } from './lib/api'
import Login from './pages/Login'
import Setup from './pages/Setup'
import Book from './pages/Book'

const Home = lazy(() => import('./pages/Home'))
const Opd = lazy(() => import('./pages/Opd'))
const Intake = lazy(() => import('./pages/Intake'))
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
        <Route path="/" element={<Home />} />
        <Route path="/opd" element={<Opd />} />
        <Route path="/opd/:rxId" element={<Opd />} />
        <Route path="/consult/:rxId" element={<RedirectConsult />} />
        <Route path="/intake" element={<Intake />} />
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
  const nav = [
    { to: '/', n: 'home', label: 'Home', tab: true },
    { to: '/schedule', n: 'cal', label: 'Schedule', tab: true },
    { to: '/intake', n: 'inbox', label: 'Intake', tab: false },
    { to: '/opd', n: 'rx', label: 'OPD & Rx', tab: true },
    { to: '/patients', n: 'users', label: 'Patients', tab: true },
    { to: '/billing', n: 'rupee', label: 'Billing', tab: true },
    { to: '/settings', n: 'gear', label: 'Settings', tab: false },
  ]
  const logout = async () => { await api('/auth/logout', { method: 'POST' }); location.href = '/' }
  return <div className="shell">
    <aside className="rail no-print">
      <Link to="/" className="brand"><span className="brand-mark">℞</span><span><b>{L.clinic_name_hi}</b><small>Arogya Rx</small></span></Link>
      {nav.map(x => <NavLink key={x.to} to={x.to} end={x.to === '/'} className={({ isActive }) => 'nav-a' + (isActive ? ' active' : '')}><Icon n={x.n} />{x.label}</NavLink>)}
      <div className="rail-foot">
        <span className="avatar">{me.user.name.replace(/^Dr\.?\s*/i, '').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}</span>
        <span className="grow"><b className="ellipsis" style={{ display: 'block' }}>{me.user.name}</b><span className="tiny muted">{me.user.role === 'doctor' ? 'Doctor' : me.user.role === 'reception' ? 'Reception' : 'Admin'}</span></span>
        <button className="icon-btn" onClick={logout} title="Log out" aria-label="Log out"><Icon n="out" /></button>
      </div>
    </aside>
    <main className="main">{children}</main>
    <nav className="tabbar no-print">{nav.filter(x => x.tab).map(x => <NavLink key={x.to} to={x.to} end={x.to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}><Icon n={x.n} />{x.label}</NavLink>)}</nav>
  </div>
}

function RedirectConsult() { const { rxId } = useParams(); return <Navigate to={`/opd/${rxId}`} replace /> }
