import { Hono, type Context, type MiddlewareHandler } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { z } from 'zod'
import { sql } from './db'
import { env, billingEnabled, aiEnabled, metaOAuthEnabled } from './env'
import { hashPassword, verifyPassword, sha256, token } from './crypto'
import type { BusinessMode, Me, SubscriptionState } from '../shared/types'

export interface UserRow {
  id: string
  email: string
  name: string
  mode: BusinessMode
  target_cpl: string
  target_roas: string
  demo: boolean
  created_at: Date
}

export type AppEnv = { Variables: { user: UserRow } }

const COOKIE = 'adpilot_sid'
const SESSION_DAYS = 30

async function createSession(c: Context, userId: string) {
  const t = token()
  await sql`insert into sessions (token_hash, user_id, expires_at) values (${sha256(t)}, ${userId}, now() + ${SESSION_DAYS + ' days'}::interval)`
  setCookie(c, COOKIE, t, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: env.appUrl.startsWith('https'),
    path: '/',
    maxAge: SESSION_DAYS * 86400
  })
}

export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const t = getCookie(c, COOKIE)
  if (!t) return c.json({ error: 'No has iniciado sesión' }, 401)
  const [user] = await sql<UserRow[]>`
    select u.* from sessions s join users u on u.id = s.user_id
    where s.token_hash = ${sha256(t)} and s.expires_at > now()`
  if (!user) return c.json({ error: 'Sesión caducada' }, 401)
  c.set('user', user)
  await next()
}

export async function subscriptionOf(user: UserRow) {
  const [sub] = await sql<{ status: SubscriptionState; current_period_end: Date | null }[]>`
    select status, current_period_end from subscriptions where user_id = ${user.id}`
  const trialEndsAt = user.created_at.getTime() + env.trialDays * 86400_000
  const state: SubscriptionState = sub?.status ?? 'none'
  const paid = state === 'active' || state === 'trialing' || state === 'past_due'
  const inTrial = Date.now() < trialEndsAt
  return {
    state: paid ? state : inTrial ? ('trialing' as const) : state,
    trialEndsAt: paid ? null : trialEndsAt,
    currentPeriodEnd: sub?.current_period_end?.getTime() ?? null,
    billingEnabled: billingEnabled(),
    hasAccess: !billingEnabled() || paid || inTrial
  }
}

/** Blocks real-data features once the free trial ended without a subscription. Demo mode stays open. */
export const requireAccess: MiddlewareHandler<AppEnv> = async (c, next) => {
  const sub = await subscriptionOf(c.get('user'))
  if (!sub.hasAccess) return c.json({ error: 'Tu prueba ha terminado. Activa tu suscripción para seguir.', code: 'payment_required' }, 402)
  await next()
}

export async function buildMe(user: UserRow): Promise<Me> {
  const [conn] = await sql<{ meta_user_name: string | null; expires_at: Date | null }[]>`
    select meta_user_name, expires_at from meta_connections where user_id = ${user.id}`
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    mode: user.mode,
    targets: { cpl: Number(user.target_cpl), roas: Number(user.target_roas) },
    demo: user.demo,
    meta: { connected: Boolean(conn), userName: conn?.meta_user_name ?? undefined, expiresAt: conn?.expires_at?.getTime() ?? null },
    subscription: await subscriptionOf(user),
    aiEnabled: aiEnabled(),
    metaOAuthEnabled: metaOAuthEnabled()
  }
}

const Credentials = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres').max(200),
  name: z.string().trim().max(100).optional()
})

// Naive per-IP throttle for login/register brute force.
const attempts = new Map<string, { n: number; reset: number }>()
function throttled(c: Context): boolean {
  const ip = c.req.header('x-forwarded-for')?.split(',')[0].trim() || 'local'
  const now = Date.now()
  const a = attempts.get(ip)
  if (!a || a.reset < now) {
    attempts.set(ip, { n: 1, reset: now + 15 * 60_000 })
    return false
  }
  a.n++
  return a.n > 30
}

export const authRoutes = new Hono<AppEnv>()
  .post('/register', async (c) => {
    if (throttled(c)) return c.json({ error: 'Demasiados intentos, espera unos minutos' }, 429)
    const parsed = Credentials.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)
    const { email, password, name } = parsed.data
    const [exists] = await sql`select 1 from users where email = ${email}`
    if (exists) return c.json({ error: 'Ya existe una cuenta con ese email' }, 409)
    const [user] = await sql<UserRow[]>`
      insert into users (email, name, password_hash) values (${email}, ${name ?? ''}, ${await hashPassword(password)}) returning *`
    await createSession(c, user.id)
    return c.json(await buildMe(user))
  })
  .post('/login', async (c) => {
    if (throttled(c)) return c.json({ error: 'Demasiados intentos, espera unos minutos' }, 429)
    const parsed = Credentials.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return c.json({ error: 'Email o contraseña incorrectos' }, 400)
    const [row] = await sql<(UserRow & { password_hash: string })[]>`select * from users where email = ${parsed.data.email}`
    if (!row || !(await verifyPassword(parsed.data.password, row.password_hash))) {
      return c.json({ error: 'Email o contraseña incorrectos' }, 401)
    }
    await createSession(c, row.id)
    return c.json(await buildMe(row))
  })
  .post('/logout', async (c) => {
    const t = getCookie(c, COOKIE)
    if (t) await sql`delete from sessions where token_hash = ${sha256(t)}`
    deleteCookie(c, COOKIE, { path: '/' })
    return c.json({ ok: true })
  })
  .get('/me', requireUser, async (c) => c.json(await buildMe(c.get('user'))))
  .patch('/me', requireUser, async (c) => {
    const body = z
      .object({
        name: z.string().trim().max(100).optional(),
        mode: z.enum(['leadgen', 'ecommerce']).optional(),
        demo: z.boolean().optional(),
        targets: z.object({ cpl: z.number().min(0).max(1e6), roas: z.number().min(0).max(1000) }).optional()
      })
      .safeParse(await c.req.json().catch(() => ({})))
    if (!body.success) return c.json({ error: 'Datos no válidos' }, 400)
    const u = c.get('user')
    const d = body.data
    const [user] = await sql<UserRow[]>`
      update users set
        name = ${d.name ?? u.name},
        mode = ${d.mode ?? u.mode},
        demo = ${d.demo ?? u.demo},
        target_cpl = ${d.targets?.cpl ?? Number(u.target_cpl)},
        target_roas = ${d.targets?.roas ?? Number(u.target_roas)}
      where id = ${u.id} returning *`
    return c.json(await buildMe(user))
  })
