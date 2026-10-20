import { readFileSync, existsSync } from 'node:fs'

// Minimal .env loader (no dependency): KEY=value lines, existing env wins.
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

const v = (k: string, d = '') => process.env[k] ?? d

export const env = {
  port: Number(v('PORT', '8787')),
  databaseUrl: v('DATABASE_URL', 'postgres://adpilot:adpilot@localhost:5432/adpilot'),
  appUrl: v('APP_URL', 'http://localhost:5173').replace(/\/$/, ''),
  encryptionKey: v('ENCRYPTION_KEY'),
  metaAppId: v('META_APP_ID'),
  metaAppSecret: v('META_APP_SECRET'),
  graphVersion: v('META_GRAPH_VERSION', 'v24.0'),
  stripeSecretKey: v('STRIPE_SECRET_KEY'),
  stripeWebhookSecret: v('STRIPE_WEBHOOK_SECRET'),
  stripePriceId: v('STRIPE_PRICE_ID'),
  trialDays: Number(v('TRIAL_DAYS', '14')),
  anthropicApiKey: v('ANTHROPIC_API_KEY'),
  isProd: v('NODE_ENV') === 'production'
}

export const billingEnabled = () => Boolean(env.stripeSecretKey && env.stripePriceId)
export const metaOAuthEnabled = () => Boolean(env.metaAppId && env.metaAppSecret)
export const aiEnabled = () => Boolean(env.anthropicApiKey)

if (env.isProd && env.encryptionKey.length < 32) {
  throw new Error('ENCRYPTION_KEY must be set (32+ chars) in production')
}
