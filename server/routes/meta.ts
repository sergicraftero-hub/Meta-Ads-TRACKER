import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { sql } from '../db'
import { env, metaOAuthEnabled } from '../env'
import { decrypt, encrypt, token as randomToken } from '../crypto'
import { requireAccess, requireUser, type AppEnv, type UserRow } from '../auth'
import { graph, oauthDialogUrl, exchangeCode, extendToken, MetaApiError } from '../meta/graph'
import { accountReport, accountsOverview, clearUserCache, listAccounts } from '../meta/report'
import { DEMO_ACCOUNTS, demoReport } from '../../shared/demo'
import { isValidRange } from '../../shared/dates'
import { sumMetrics } from '../../shared/metrics'
import type { AccountReport, DateRange } from '../../shared/types'

export async function metaToken(userId: string): Promise<string | null> {
  const [row] = await sql<{ access_token_enc: string }[]>`select access_token_enc from meta_connections where user_id = ${userId}`
  return row ? decrypt(row.access_token_enc) : null
}

/** Report for the user's selected data source (demo or live Meta). */
export async function reportFor(user: UserRow, accountId: string, range: DateRange, force = false): Promise<AccountReport> {
  if (user.demo) return demoReport(accountId, range)
  const t = await metaToken(user.id)
  if (!t) throw new MetaApiError('Conecta tu cuenta de Meta primero', 190)
  return accountReport(user.id, t, accountId, range, force)
}

function rangeFrom(c: Context): DateRange | null {
  const r = { since: c.req.query('since') ?? '', until: c.req.query('until') ?? '' }
  return isValidRange(r) ? r : null
}

export function metaError(c: Context, e: unknown) {
  if (e instanceof MetaApiError) {
    if (e.needsReconnect) return c.json({ error: `Meta: ${e.message}`, code: 'meta_reconnect' }, 409)
    return c.json({ error: `Meta: ${e.message}` }, 502)
  }
  console.error(e)
  return c.json({ error: (e as Error).message || 'Error inesperado' }, 500)
}

async function saveConnection(userId: string, accessToken: string, expiresAt: Date | null) {
  const me = await graph<{ id: string; name: string }>('me', accessToken, { fields: 'id,name' })
  await sql`
    insert into meta_connections (user_id, access_token_enc, meta_user_id, meta_user_name, expires_at, updated_at)
    values (${userId}, ${encrypt(accessToken)}, ${me.id}, ${me.name}, ${expiresAt}, now())
    on conflict (user_id) do update set access_token_enc = excluded.access_token_enc, meta_user_id = excluded.meta_user_id,
      meta_user_name = excluded.meta_user_name, expires_at = excluded.expires_at, updated_at = now()`
  // Switching to real data is what the user wants after connecting.
  await sql`update users set demo = false where id = ${userId}`
  clearUserCache(userId)
}

const redirectUri = () => `${env.appUrl}/api/meta/oauth/callback`

export const metaRoutes = new Hono<AppEnv>()
  .use(requireUser)
  .get('/oauth/start', async (c) => {
    if (!metaOAuthEnabled()) return c.text('META_APP_ID / META_APP_SECRET no configurados en el servidor', 500)
    const state = randomToken(24)
    await sql`delete from oauth_states where created_at < now() - interval '1 hour'`
    await sql`insert into oauth_states (state, user_id) values (${state}, ${c.get('user').id})`
    return c.redirect(oauthDialogUrl(state, redirectUri()))
  })
  .get('/oauth/callback', async (c) => {
    const { state, code, error_description } = c.req.query()
    const back = (q: string) => c.redirect(`${env.appUrl}/app/settings?${q}`)
    if (error_description) return back(`meta_error=${encodeURIComponent(error_description)}`)
    const [row] = await sql`delete from oauth_states where state = ${state ?? ''} and user_id = ${c.get('user').id} returning 1`
    if (!row || !code) return back('meta_error=Estado%20OAuth%20no%20v%C3%A1lido')
    try {
      const { token, expiresAt } = await exchangeCode(code, redirectUri())
      await saveConnection(c.get('user').id, token, expiresAt)
      return back('meta=connected')
    } catch (e) {
      return back(`meta_error=${encodeURIComponent((e as Error).message)}`)
    }
  })
  .post('/token', async (c) => {
    const body = z.object({ token: z.string().trim().min(20).max(1000) }).safeParse(await c.req.json().catch(() => ({})))
    if (!body.success) return c.json({ error: 'Pega un token de acceso válido' }, 400)
    try {
      // System-user tokens don't expire; user tokens get extended to ~60 days when the app secret is configured.
      const extended = await extendToken(body.data.token).catch(() => ({ token: body.data.token, expiresAt: null }))
      await saveConnection(c.get('user').id, extended.token, extended.expiresAt)
      return c.json({ ok: true })
    } catch (e) {
      return metaError(c, e)
    }
  })
  .delete('/connection', async (c) => {
    await sql`delete from meta_connections where user_id = ${c.get('user').id}`
    await sql`update users set demo = true where id = ${c.get('user').id}`
    clearUserCache(c.get('user').id)
    return c.json({ ok: true })
  })
  .get('/accounts', requireAccessUnlessDemo, async (c) => {
    const user = c.get('user')
    if (user.demo) return c.json(DEMO_ACCOUNTS)
    try {
      const t = await metaToken(user.id)
      if (!t) return c.json({ error: 'Conecta tu cuenta de Meta primero', code: 'meta_reconnect' }, 409)
      return c.json(await listAccounts(user.id, t, c.req.query('force') === '1'))
    } catch (e) {
      return metaError(c, e)
    }
  })
  .get('/overview', requireAccessUnlessDemo, async (c) => {
    const user = c.get('user')
    const range = rangeFrom(c)
    if (!range) return c.json({ error: 'Rango de fechas no válido' }, 400)
    if (user.demo) {
      return c.json(
        DEMO_ACCOUNTS.map((account) => {
          const r = demoReport(account.id, range)
          return { account, totals: sumMetrics([r.totals]), previousTotals: sumMetrics([r.previousTotals]) }
        })
      )
    }
    try {
      const t = await metaToken(user.id)
      if (!t) return c.json({ error: 'Conecta tu cuenta de Meta primero', code: 'meta_reconnect' }, 409)
      return c.json(await accountsOverview(user.id, t, range, c.req.query('force') === '1'))
    } catch (e) {
      return metaError(c, e)
    }
  })
  .get('/report', requireAccessUnlessDemo, async (c) => {
    const range = rangeFrom(c)
    const accountId = c.req.query('accountId') ?? ''
    if (!range || !/^act_[\w]+$/.test(accountId)) return c.json({ error: 'Parámetros no válidos' }, 400)
    try {
      return c.json(await reportFor(c.get('user'), accountId, range, c.req.query('force') === '1'))
    } catch (e) {
      return metaError(c, e)
    }
  })

async function requireAccessUnlessDemo(c: Context<AppEnv>, next: () => Promise<void>) {
  if (c.get('user').demo) return next()
  return requireAccess(c, next)
}

