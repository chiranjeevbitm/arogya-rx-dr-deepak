// Keeps the app shell available when the clinic's internet drops. API calls always go to the network.
const C = 'arx-shell-v1'
self.addEventListener('install', e => { e.waitUntil(caches.open(C).then(c => c.addAll(['/', '/favicon.svg', '/lh/logo.png', '/lh/caduceus-left.png', '/lh/caduceus-right.png', '/lh/diet.jpg']))); self.skipWaiting() })
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k))))); self.clients.claim() })
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url)
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/') || u.pathname.startsWith('/seed/')) return
  if (e.request.mode === 'navigate') { e.respondWith(fetch(e.request).catch(() => caches.match('/'))); return }
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => { if (r.ok && (u.pathname.startsWith('/assets/') || u.pathname.startsWith('/lh/'))) { const cl = r.clone(); caches.open(C).then(c => c.put(e.request, cl)) } return r })))
})
