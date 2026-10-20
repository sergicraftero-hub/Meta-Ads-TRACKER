import './env'
import { existsSync, readFileSync } from 'node:fs'
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { secureHeaders } from 'hono/secure-headers'
import { compress } from 'hono/compress'
import { env } from './env'
import { migrate } from './db'
import { authRoutes } from './auth'
import { metaRoutes } from './routes/meta'
import { billingRoutes } from './routes/billing'
import { trackingRoutes, publicTracking } from './routes/tracking'
import { aiRoutes } from './routes/ai'

export const app = new Hono()

app.use('/api/*', secureHeaders({ crossOriginResourcePolicy: false }))
app.use('*', compress())

app.get('/api/health', (c) => c.json({ ok: true }))
app.route('/', publicTracking)
app.route('/api/auth', authRoutes)
app.route('/api/meta', metaRoutes)
app.route('/api/billing', billingRoutes)
app.route('/api/tracking', trackingRoutes)
app.route('/api/ai', aiRoutes)
app.all('/api/*', (c) => c.json({ error: 'No encontrado' }, 404))

app.onError((err, c) => {
  console.error(err)
  return c.json({ error: 'Error interno del servidor' }, 500)
})

// Production: serve the built SPA from dist/web with history-API fallback.
const webDir = 'dist/web'
if (existsSync(webDir)) {
  const indexHtml = readFileSync(`${webDir}/index.html`, 'utf8')
  app.use('/assets/*', serveStatic({ root: webDir, onFound: (_p, c) => c.header('Cache-Control', 'public, max-age=31536000, immutable') }))
  app.use('*', serveStatic({ root: webDir }))
  app.get('*', (c) => c.html(indexHtml))
}

if (process.env.VITEST === undefined) {
  await migrate()
  serve({ fetch: app.fetch, port: env.port }, (info) => console.log(`AdPilot API escuchando en http://localhost:${info.port}`))
}
