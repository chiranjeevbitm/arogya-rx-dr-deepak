/* Local server: API + built frontend (for development and end-to-end tests). */
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { readFileSync, existsSync } from 'node:fs'
import api from './app.js'

for (const f of ['.env.local', '.env']) if (existsSync(f)) for (const line of readFileSync(f, 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const app = new Hono()
app.route('/', api)
app.use('/*', serveStatic({ root: './dist' }))
app.use('/seed/*', serveStatic({ root: './public' }))
app.get('*', c => existsSync('dist/index.html') ? c.html(readFileSync('dist/index.html', 'utf8')) : c.text('Run npm run build first', 404))
const port = Number(process.env.PORT || 8787)
serve({ fetch: app.fetch, port }, () => console.log(`Arogya Rx on http://localhost:${port}`))
