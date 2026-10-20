import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { sql } from '../db'
import { env } from '../env'
import { decrypt, encrypt, hmacSha256, safeEqual, sha256, token as randomToken } from '../crypto'
import { requireAccess, requireUser, type AppEnv } from '../auth'
import { trackerScript } from '../tracking/script'
import { sendCapi, hashEmail, hashPhone, hashText, type CapiEvent, type CapiUserData } from '../tracking/capi'
import { attribute, paramsFromUrl, touchFromParams, type ConversionEvent, type Touch } from '../tracking/attribution'
import { reportFor, metaError } from './meta'
import { isValidRange } from '../../shared/dates'
import { eachDay } from '../../shared/metrics'
import type { AttributionReport, TrackingSite } from '../../shared/types'

interface SiteRow {
  id: string
  user_id: string
  name: string
  domain: string
  public_key: string
  meta_pixel_id: string | null
  capi_token_enc: string | null
  test_event_code: string | null
  shopify_secret_enc: string | null
  currency: string
  created_at: Date
}

/** Events forwarded to Meta CAPI. PageView stays first-party only (the browser pixel already sends it). */
const CAPI_EVENTS = new Set(['ViewContent', 'AddToCart', 'InitiateCheckout', 'AddPaymentInfo', 'Purchase', 'Lead', 'CompleteRegistration', 'Contact', 'Schedule', 'SubmitApplication', 'Subscribe', 'StartTrial'])
const EVENT_NAME = /^[A-Za-z][A-Za-z0-9_]{1,49}$/

const toSite = (s: SiteRow): TrackingSite => ({
  id: s.id,
  name: s.name,
  domain: s.domain,
  publicKey: s.public_key,
  metaPixelId: s.meta_pixel_id,
  hasCapiToken: Boolean(s.capi_token_enc),
  testEventCode: s.test_event_code,
  hasShopifySecret: Boolean(s.shopify_secret_enc),
  currency: s.currency,
  createdAt: s.created_at.getTime()
})

// ---------- hot-path caches ----------

const siteCache = new Map<string, { at: number; site: SiteRow | null }>()
async function siteByKey(key: string): Promise<SiteRow | null> {
  const hit = siteCache.get(key)
  if (hit && Date.now() - hit.at < 60_000) return hit.site
  const [site] = await sql<SiteRow[]>`select * from sites where public_key = ${key}`
  siteCache.set(key, { at: Date.now(), site: site ?? null })
  return site ?? null
}
const invalidateSite = (key: string) => siteCache.delete(key)

const hits = new Map<string, { n: number; reset: number }>()
function rateLimited(ip: string, max = 300): boolean {
  const now = Date.now()
  const h = hits.get(ip)
  if (!h || h.reset < now) {
    hits.set(ip, { n: 1, reset: now + 60_000 })
    if (hits.size > 50_000) hits.clear()
    return false
  }
  return ++h.n > max
}

const clientIp = (c: Context) => c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for')?.split(',')[0].trim() || ''

function originAllowed(origin: string | undefined, domain: string): boolean {
  if (!origin) return true // sendBeacon from some browsers omits Origin
  try {
    const host = new URL(origin).hostname.toLowerCase()
    const d = domain.toLowerCase().replace(/^www\./, '')
    return host === d || host.endsWith('.' + d) || host === 'localhost'
  } catch {
    return false
  }
}

// ---------- event persistence + CAPI forwarding ----------

interface IncomingEvent {
  site: SiteRow
  visitorId: string | null
  name: string
  eventId: string
  url?: string
  value?: number
  currency?: string
  orderId?: string
  userData: CapiUserData
  touch: Touch | null
  ts?: number
}

async function recordEvent(e: IncomingEvent) {
  let first: Touch | null = null
  let last: Touch | null = null
  if (e.visitorId) {
    const [v] = await sql<{ first_touch: Touch | null; last_touch: Touch | null; fbp: string | null; fbc: string | null }[]>`
      insert into visitors (site_id, visitor_id, first_touch, last_touch, fbp, fbc)
      values (${e.site.id}, ${e.visitorId}, ${e.touch ? sql.json(e.touch as never) : null}, ${e.touch ? sql.json(e.touch as never) : null},
              ${e.userData.fbp ?? null}, ${e.userData.fbc ?? null})
      on conflict (site_id, visitor_id) do update set
        first_touch = coalesce(visitors.first_touch, excluded.first_touch),
        last_touch = coalesce(excluded.last_touch, visitors.last_touch),
        fbp = coalesce(excluded.fbp, visitors.fbp),
        fbc = coalesce(excluded.fbc, visitors.fbc),
        last_seen = now()
      returning first_touch, last_touch, fbp, fbc`
    first = v.first_touch
    last = v.last_touch
    e.userData.fbp ??= v.fbp ?? undefined
    e.userData.fbc ??= v.fbc ?? undefined
    e.userData.external_id = [sha256(e.visitorId)]
  } else if (e.touch) {
    first = last = e.touch
  }

  const forward = Boolean(CAPI_EVENTS.has(e.name) && e.site.meta_pixel_id && e.site.capi_token_enc)
  const ts = new Date(e.ts ?? Date.now())
  const [row] = await sql<{ id: string }[]>`
    insert into events (site_id, visitor_id, event_name, event_id, ts, url, value, currency, order_id, first_touch, last_touch, user_data, capi_status)
    values (${e.site.id}, ${e.visitorId}, ${e.name}, ${e.eventId}, ${ts}, ${e.url?.slice(0, 2000) ?? null}, ${e.value ?? null},
            ${e.currency ?? null}, ${e.orderId ?? null}, ${first ? sql.json(first as never) : null}, ${last ? sql.json(last as never) : null},
            ${sql.json(e.userData as never)}, ${forward ? 'pending' : 'skipped'})
    on conflict (site_id, event_id) do nothing
    returning id`
  if (!row || !forward) return

  const event: CapiEvent = {
    event_name: e.name,
    event_time: Math.floor(ts.getTime() / 1000),
    event_id: e.eventId,
    event_source_url: e.url,
    action_source: 'website',
    user_data: Object.fromEntries(Object.entries(e.userData).filter(([, v]) => v !== undefined && v !== '')) as CapiUserData,
    custom_data:
      e.value !== undefined || e.orderId
        ? { value: e.value, currency: e.currency ?? e.site.currency, order_id: e.orderId }
        : undefined
  }
  const err = await sendCapi(e.site.meta_pixel_id!, decrypt(e.site.capi_token_enc!), event, e.site.test_event_code)
  await sql`update events set capi_status = ${err ? 'failed' : 'sent'}, capi_error = ${err} where id = ${row.id}`
}

const Collect = z.object({
  k: z.string().max(64),
  vid: z.string().min(8).max(64),
  name: z.string().regex(EVENT_NAME),
  eid: z.string().min(1).max(100),
  url: z.string().max(4000).optional(),
  p: z.record(z.string(), z.string().max(500)).optional(),
  fbp: z.string().max(200).nullable().optional(),
  fbc: z.string().max(300).nullable().optional(),
  data: z
    .object({
      value: z.coerce.number().finite().optional(),
      currency: z.string().length(3).optional(),
      order_id: z.coerce.string().max(100).optional(),
      email: z.string().max(200).nullable().optional(),
      phone: z.string().max(50).nullable().optional()
    })
    .passthrough()
    .optional()
})

// ---------- public endpoints (called from customers' websites / Shopify) ----------

export const publicTracking = new Hono()
  .get('/t.js', (c) => {
    const key = c.req.query('k') ?? ''
    c.header('Content-Type', 'application/javascript; charset=utf-8')
    c.header('Cache-Control', 'public, max-age=3600')
    return c.body(trackerScript(`${env.appUrl}/api/collect`, key))
  })
  .options('/api/collect', (c) => {
    c.header('Access-Control-Allow-Origin', c.req.header('origin') ?? '*')
    c.header('Access-Control-Allow-Methods', 'POST')
    c.header('Access-Control-Allow-Headers', 'Content-Type')
    return c.body(null, 204)
  })
  .post('/api/collect', async (c) => {
    c.header('Access-Control-Allow-Origin', c.req.header('origin') ?? '*')
    const ip = clientIp(c)
    if (rateLimited(ip)) return c.body(null, 429)
    let parsed
    try {
      parsed = Collect.safeParse(JSON.parse(await c.req.text()))
    } catch {
      return c.body(null, 400)
    }
    if (!parsed.success) return c.body(null, 400)
    const b = parsed.data
    const site = await siteByKey(b.k)
    if (!site) return c.body(null, 404)
    if (!originAllowed(c.req.header('origin'), site.domain)) return c.body(null, 403)
    const em = hashEmail(b.data?.email)
    const ph = hashPhone(b.data?.phone)
    // Fire and forget: the browser shouldn't wait on Meta.
    recordEvent({
      site,
      visitorId: b.vid,
      name: b.name,
      eventId: b.eid,
      url: b.url,
      value: b.data?.value,
      currency: b.data?.currency,
      orderId: b.data?.order_id,
      touch: touchFromParams(b.p ?? {}),
      userData: {
        client_ip_address: ip || undefined,
        client_user_agent: c.req.header('user-agent'),
        fbp: b.fbp ?? undefined,
        fbc: b.fbc ?? undefined,
        em: em ? [em] : undefined,
        ph: ph ? [ph] : undefined
      }
    }).catch((e) => console.error('collect', e))
    return c.body(null, 204)
  })
  .post('/api/webhooks/shopify/:key', async (c) => {
    const site = await siteByKey(c.req.param('key'))
    if (!site?.shopify_secret_enc) return c.body(null, 404)
    const raw = Buffer.from(await c.req.arrayBuffer())
    const expected = hmacSha256(decrypt(site.shopify_secret_enc), raw, 'base64')
    if (!safeEqual(expected, c.req.header('x-shopify-hmac-sha256') ?? '')) return c.body(null, 401)
    const order = JSON.parse(raw.toString('utf8'))
    const attrs: { name: string; value: string }[] = order.note_attributes ?? []
    const vid = attrs.find((a) => a.name === '_apv')?.value ?? null
    const addr = order.billing_address ?? order.shipping_address ?? {}
    const customer = order.customer ?? {}
    const list = (h?: string) => (h ? [h] : undefined)
    const created = order.created_at ? Date.parse(order.created_at) : Date.now()
    await recordEvent({
      site,
      visitorId: vid,
      name: 'Purchase',
      eventId: `shopify_${order.id}`,
      url: order.order_status_url,
      value: Number(order.current_total_price ?? order.total_price) || 0,
      currency: order.currency,
      orderId: String(order.id),
      ts: Number.isFinite(created) ? created : Date.now(),
      // Fallback when the cart attribute is missing: Shopify keeps the landing URL with its UTMs.
      touch: vid ? null : touchFromParams(paramsFromUrl(order.landing_site), created),
      userData: {
        client_ip_address: order.browser_ip ?? order.client_details?.browser_ip,
        client_user_agent: order.client_details?.user_agent,
        em: list(hashEmail(order.email ?? customer.email)),
        ph: list(hashPhone(order.phone ?? customer.phone ?? addr.phone)),
        fn: list(hashText(addr.first_name ?? customer.first_name)),
        ln: list(hashText(addr.last_name ?? customer.last_name)),
        ct: list(hashText(addr.city)),
        zp: list(hashText(addr.zip)),
        country: list(hashText(addr.country_code))
      }
    })
    return c.json({ ok: true })
  })

// ---------- private endpoints (dashboard) ----------

const SitePatch = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  domain: z.string().trim().toLowerCase().max(200).optional(),
  currency: z.string().length(3).toUpperCase().optional(),
  metaPixelId: z.string().trim().regex(/^\d{5,25}$/, 'El ID de píxel debe ser numérico').nullable().optional(),
  capiToken: z.string().trim().min(20).max(1000).nullable().optional(),
  testEventCode: z.string().trim().max(50).nullable().optional(),
  shopifySecret: z.string().trim().min(10).max(200).nullable().optional()
})

const cleanDomain = (d: string) => d.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '')

async function ownedSite(c: Context<AppEnv>): Promise<SiteRow | null> {
  const [site] = await sql<SiteRow[]>`select * from sites where id = ${c.req.param('id') ?? ''}::uuid and user_id = ${c.get('user').id}`.catch(() => [])
  return site ?? null
}

export const trackingRoutes = new Hono<AppEnv>()
  .use(requireUser)
  .use(async (c, next) => (c.get('user').demo ? next() : requireAccess(c, next)))
  .get('/sites', async (c) => {
    const sites = await sql<SiteRow[]>`select * from sites where user_id = ${c.get('user').id} order by created_at`
    return c.json(sites.map(toSite))
  })
  .post('/sites', async (c) => {
    const body = SitePatch.required({ name: true, domain: true }).safeParse(await c.req.json().catch(() => ({})))
    if (!body.success) return c.json({ error: body.error.issues[0].message }, 400)
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from sites where user_id = ${c.get('user').id}`
    if (n >= 10) return c.json({ error: 'Máximo 10 webs por cuenta' }, 400)
    const [site] = await sql<SiteRow[]>`
      insert into sites (user_id, name, domain, public_key, currency)
      values (${c.get('user').id}, ${body.data.name}, ${cleanDomain(body.data.domain)}, ${'ap_' + randomToken(12)}, ${body.data.currency ?? 'EUR'})
      returning *`
    return c.json(toSite(site))
  })
  .patch('/sites/:id', async (c) => {
    const site = await ownedSite(c)
    if (!site) return c.json({ error: 'No encontrado' }, 404)
    const body = SitePatch.safeParse(await c.req.json().catch(() => ({})))
    if (!body.success) return c.json({ error: body.error.issues[0].message }, 400)
    const d = body.data
    const keep = <T,>(v: T | undefined, old: T) => (v === undefined ? old : v)
    const [updated] = await sql<SiteRow[]>`
      update sites set
        name = ${keep(d.name, site.name)},
        domain = ${d.domain ? cleanDomain(d.domain) : site.domain},
        currency = ${keep(d.currency, site.currency)},
        meta_pixel_id = ${keep(d.metaPixelId, site.meta_pixel_id)},
        test_event_code = ${keep(d.testEventCode || null, site.test_event_code)},
        capi_token_enc = ${d.capiToken === undefined ? site.capi_token_enc : d.capiToken ? encrypt(d.capiToken) : null},
        shopify_secret_enc = ${d.shopifySecret === undefined ? site.shopify_secret_enc : d.shopifySecret ? encrypt(d.shopifySecret) : null}
      where id = ${site.id} returning *`
    invalidateSite(site.public_key)
    return c.json(toSite(updated))
  })
  .delete('/sites/:id', async (c) => {
    const site = await ownedSite(c)
    if (!site) return c.json({ error: 'No encontrado' }, 404)
    await sql`delete from sites where id = ${site.id}`
    invalidateSite(site.public_key)
    return c.json({ ok: true })
  })
  .get('/sites/:id/events', async (c) => {
    const site = await ownedSite(c)
    if (!site) return c.json({ error: 'No encontrado' }, 404)
    const events = await sql`
      select event_name as name, event_id as "eventId", extract(epoch from ts)*1000 as ts, url, value::float, currency,
             capi_status as "capiStatus", capi_error as "capiError", last_touch as touch
      from events where site_id = ${site.id} order by ts desc limit 100`
    const [stats] = await sql`
      select count(*)::int as events24h,
             count(distinct visitor_id)::int as visitors24h,
             count(*) filter (where capi_status = 'sent')::int as "capiSent24h",
             count(*) filter (where capi_status = 'failed')::int as "capiFailed24h"
      from events where site_id = ${site.id} and ts > now() - interval '24 hours'`
    return c.json({ events: events.map((e) => ({ ...e, ts: Number(e.ts) })), stats })
  })
  .post('/sites/:id/test', async (c) => {
    const site = await ownedSite(c)
    if (!site) return c.json({ error: 'No encontrado' }, 404)
    if (!site.meta_pixel_id || !site.capi_token_enc) return c.json({ error: 'Añade el ID del píxel y el token de la Conversions API' }, 400)
    const err = await sendCapi(
      site.meta_pixel_id,
      decrypt(site.capi_token_enc),
      {
        event_name: 'PageView',
        event_time: Math.floor(Date.now() / 1000),
        event_id: 'test_' + randomToken(8),
        event_source_url: `https://${site.domain}/`,
        action_source: 'website',
        user_data: { client_ip_address: clientIp(c) || '127.0.0.1', client_user_agent: c.req.header('user-agent') ?? 'AdPilot' }
      },
      site.test_event_code
    )
    return err ? c.json({ error: `Meta rechazó el evento: ${err}` }, 400) : c.json({ ok: true })
  })
  .post('/sites/:id/seed-demo', async (c) => {
    const site = await ownedSite(c)
    if (!site) return c.json({ error: 'No encontrado' }, 404)
    if (!c.get('user').demo) return c.json({ error: 'Solo disponible en modo demo' }, 400)
    await seedDemoEvents(site)
    return c.json({ ok: true })
  })
  .get('/attribution', async (c) => {
    const q = c.req.query()
    const range = { since: q.since ?? '', until: q.until ?? '' }
    const level = (['campaign', 'adset', 'ad'] as const).find((l) => l === q.level) ?? 'campaign'
    const model = q.model === 'first_click' ? 'first_click' : 'last_click'
    if (!isValidRange(range) || !/^act_\w+$/.test(q.accountId ?? '')) return c.json({ error: 'Parámetros no válidos' }, 400)
    const [site] = await sql<SiteRow[]>`select * from sites where id = ${q.siteId ?? ''}::uuid and user_id = ${c.get('user').id}`.catch(() => [])
    if (!site) return c.json({ error: 'Selecciona una web con tracking' }, 404)
    const user = c.get('user')
    const eventName = user.mode === 'leadgen' ? 'Lead' : 'Purchase'
    try {
      const report = await reportFor(user, q.accountId, range)
      const tz = report.account.timezone || 'UTC'
      const conversions = await sql<{ value: number; ts: number; first_touch: Touch | null; last_touch: Touch | null }[]>`
        select coalesce(value, 0)::float as value, extract(epoch from ts)*1000 as ts, first_touch, last_touch
        from events
        where site_id = ${site.id} and event_name = ${eventName}
          and (ts at time zone ${tz})::date between ${range.since}::date and ${range.until}::date`
      const evs: ConversionEvent[] = conversions.map((e) => ({ ...e, ts: Number(e.ts) }))
      const { rows, unattributedConversions, unattributedValue } = attribute(evs, report, level, model, user.mode)
      const [totals] = await sql<{ events: number; visitors: number; capiSent: number; capiFailed: number }[]>`
        select count(*)::int as events, count(distinct visitor_id)::int as visitors,
               count(*) filter (where capi_status = 'sent')::int as "capiSent",
               count(*) filter (where capi_status = 'failed')::int as "capiFailed"
        from events where site_id = ${site.id} and (ts at time zone ${tz})::date between ${range.since}::date and ${range.until}::date`
      const daily = await sql<{ date: string; trackedValue: number; trackedConversions: number; capiSent: number }[]>`
        select to_char((ts at time zone ${tz})::date, 'YYYY-MM-DD') as date,
               coalesce(sum(value) filter (where event_name = ${eventName}), 0)::float as "trackedValue",
               count(*) filter (where event_name = ${eventName})::int as "trackedConversions",
               count(*) filter (where capi_status = 'sent')::int as "capiSent"
        from events where site_id = ${site.id} and (ts at time zone ${tz})::date between ${range.since}::date and ${range.until}::date
        group by 1`
      const byDate = new Map(daily.map((d) => [d.date, d]))
      const result: AttributionReport = {
        model,
        level,
        range,
        rows,
        totals: {
          ...totals,
          trackedConversions: evs.length,
          trackedValue: evs.reduce((s, e) => s + e.value, 0),
          unattributedConversions,
          unattributedValue
        },
        daily: eachDay(range.since, range.until).map((date) => byDate.get(date) ?? { date, trackedValue: 0, trackedConversions: 0, capiSent: 0 })
      }
      return c.json(result)
    } catch (e) {
      return metaError(c, e)
    }
  })

/** Fake first-party events matching the demo e-commerce account, so attribution can be explored without a store. */
async function seedDemoEvents(site: SiteRow) {
  const { demoReport } = await import('../../shared/demo')
  const today = new Date().toISOString().slice(0, 10)
  const since = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10)
  const report = demoReport('act_demo_2', { since, until: today })
  await sql`delete from events where site_id = ${site.id}`
  await sql`delete from visitors where site_id = ${site.id}`
  const rows: Record<string, unknown>[] = []
  let n = 0
  for (const r of report.rows) {
    // Tracked purchases ≈ Meta-reported ×(0.75–1.25): pixel over/under-reporting is the point of this view.
    const factor = 0.75 + ((n++ * 7919) % 50) / 100
    const count = Math.round(r.purchases * factor)
    for (let i = 0; i < count; i++) {
      const ts = Date.parse(r.date + 'T10:00:00Z') + ((i * 3_600_000 * 5) % 43_200_000)
      const touch: Touch = { src: 'facebook', med: 'paid', cmp: r.campaignId, set: r.adsetId, ad: r.adId, ts: ts - 3_600_000 }
      const vid = `demo_${r.adId}_${r.date}_${i}`
      rows.push({
        site_id: site.id,
        visitor_id: vid,
        event_name: 'Purchase',
        event_id: `demo_${vid}`,
        ts: new Date(ts),
        value: Math.round((r.purchaseValue / Math.max(1, r.purchases)) * 100) / 100,
        currency: 'EUR',
        first_touch: touch,
        last_touch: touch,
        capi_status: 'sent'
      })
    }
  }
  for (let i = 0; i < rows.length; i += 500) await sql`insert into events ${sql(rows.slice(i, i + 500) as never)}`
}
