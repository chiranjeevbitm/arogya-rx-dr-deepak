import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import '@fontsource/hind/400.css'
import '@fontsource/hind/500.css'
import '@fontsource/hind/600.css'
import '@fontsource/hind/700.css'
import '@fontsource/martel/400.css'
import '@fontsource/martel/700.css'
import '@fontsource/martel/800.css'
import '@fontsource/martel/900.css'
import '@fontsource/kalam/700.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/600.css'
import './styles.css'
import App from './App'
import { SessionProvider } from './lib/session'
import { ToastHost } from './components/ui'

createRoot(document.getElementById('root')!).render(
  <StrictMode><BrowserRouter><ToastHost><SessionProvider><App /></SessionProvider></ToastHost></BrowserRouter></StrictMode>
)
if ('serviceWorker' in navigator && location.hostname !== 'localhost') navigator.serviceWorker.register('/sw.js').catch(() => {})
