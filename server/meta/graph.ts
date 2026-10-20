import { env } from '../env'
import { hmacSha256 } from '../crypto'

export class MetaApiError extends Error {
  constructor(
    message: string,
    public code?: number,
    public subcode?: number,
    public status?: number
  ) {
    super(message)
  }
  /** Token expired / revoked / missing permission: the user must reconnect. */
  get needsReconnect() {
    return this.code === 190 || this.code === 102 || this.code === 10 || (this.code === 200 && this.subcode !== undefined)
  }
}

// Throttling / transient codes documented by Meta for the Marketing API.
const RETRYABLE = new Set([1, 2, 4, 17, 32, 341, 613, 80000, 80003, 80004, 80014])

const base = () => `https://graph.facebook.com/${env.graphVersion}`
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

type Params = Record<string, string | number | boolean | object | undefined>

function buildUrl(pathOrUrl: string, token: string, params: Params = {}): string {
  const url = new URL(pathOrUrl.startsWith('http') ? pathOrUrl : `${base()}/${pathOrUrl.replace(/^\//, '')}`)
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue
    url.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v))
  }
  url.searchParams.set('access_token', token)
  if (env.metaAppSecret) url.searchParams.set('appsecret_proof', hmacSha256(env.metaAppSecret, token))
  return url.toString()
}

export async function graph<T = any>(pathOrUrl: string, token: string, params: Params = {}, method: 'GET' | 'POST' = 'GET'): Promise<T> {
  let lastErr: MetaApiError | undefined
  for (let attempt = 0; attempt < 5; attempt++) {
    let res: Response
    try {
      res = await fetch(buildUrl(pathOrUrl, token, params), { method, signal: AbortSignal.timeout(60_000) })
    } catch (e) {
      lastErr = new MetaApiError(`No se pudo conectar con Meta: ${(e as Error).message}`)
      await sleep(1000 * 2 ** attempt)
      continue
    }
    const body = (await res.json().catch(() => ({}))) as any
    if (res.ok && !body.error) return body as T
    const e = body.error ?? {}
    lastErr = new MetaApiError(e.error_user_msg || e.message || `Error ${res.status} de Meta`, e.code, e.error_subcode, res.status)
    const retry = RETRYABLE.has(e.code) || res.status >= 500 || e.is_transient
    if (!retry) throw lastErr
    // Respect Business Use Case throttling hints when present.
    let wait = 1500 * 2 ** attempt
    const buc = res.headers.get('x-business-use-case-usage')
    if (buc) {
      try {
        const usage = Object.values(JSON.parse(buc) as Record<string, { estimated_time_to_regain_access?: number }[]>).flat()
        const mins = Math.max(0, ...usage.map((u) => u.estimated_time_to_regain_access ?? 0))
        if (mins > 0) wait = Math.min(mins * 60_000, 120_000)
      } catch {
        /* ignore malformed header */
      }
    }
    await sleep(wait)
  }
  throw lastErr ?? new MetaApiError('Error desconocido de Meta')
}

/** Follow `paging.next` until exhausted (capped to avoid runaway loops). */
export async function graphAll<T = any>(path: string, token: string, params: Params = {}, maxPages = 100): Promise<T[]> {
  const out: T[] = []
  let page = await graph<{ data: T[]; paging?: { next?: string } }>(path, token, { limit: 500, ...params })
  out.push(...page.data)
  for (let i = 1; i < maxPages && page.paging?.next; i++) {
    page = await graph(page.paging.next, token)
    out.push(...page.data)
  }
  return out
}

/**
 * Async insights job: preferred for ad-level daily breakdowns, which time out
 * synchronously on large accounts.
 */
export async function asyncInsights<T = any>(accountId: string, token: string, params: Params): Promise<T[]> {
  const { report_run_id } = await graph<{ report_run_id: string }>(`${accountId}/insights`, token, params, 'POST')
  const started = Date.now()
  let delay = 800
  while (true) {
    const job = await graph<{ async_status: string; async_percent_completion: number }>(report_run_id, token, {
      fields: 'async_status,async_percent_completion'
    })
    if (job.async_status === 'Job Completed') break
    if (job.async_status === 'Job Failed' || job.async_status === 'Job Skipped') {
      throw new MetaApiError(`Meta no pudo generar el informe (${job.async_status}). Prueba con un rango más corto.`)
    }
    if (Date.now() - started > 5 * 60_000) throw new MetaApiError('El informe de Meta tarda demasiado. Prueba con un rango más corto.')
    await sleep(delay)
    delay = Math.min(delay * 1.5, 4000)
  }
  return graphAll<T>(`${report_run_id}/insights`, token)
}

/** Run async fns with bounded concurrency, preserving order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++
      out[idx] = await fn(items[idx])
    }
  })
  await Promise.all(workers)
  return out
}

// ---------- OAuth ----------

export function oauthDialogUrl(state: string, redirectUri: string): string {
  const u = new URL(`https://www.facebook.com/${env.graphVersion}/dialog/oauth`)
  u.searchParams.set('client_id', env.metaAppId)
  u.searchParams.set('redirect_uri', redirectUri)
  u.searchParams.set('state', state)
  u.searchParams.set('scope', 'ads_read,business_management,read_insights')
  u.searchParams.set('response_type', 'code')
  return u.toString()
}

export async function exchangeCode(code: string, redirectUri: string): Promise<{ token: string; expiresAt: Date | null }> {
  const short = await fetchJson(
    `${base()}/oauth/access_token?` +
      new URLSearchParams({ client_id: env.metaAppId, client_secret: env.metaAppSecret, redirect_uri: redirectUri, code })
  )
  return extendToken(short.access_token)
}

/** Exchange a short-lived user token for a ~60 day token. */
export async function extendToken(shortToken: string): Promise<{ token: string; expiresAt: Date | null }> {
  if (!env.metaAppId || !env.metaAppSecret) return { token: shortToken, expiresAt: null }
  const long = await fetchJson(
    `${base()}/oauth/access_token?` +
      new URLSearchParams({ grant_type: 'fb_exchange_token', client_id: env.metaAppId, client_secret: env.metaAppSecret, fb_exchange_token: shortToken })
  )
  return { token: long.access_token, expiresAt: long.expires_in ? new Date(Date.now() + long.expires_in * 1000) : null }
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  const body = (await res.json().catch(() => ({}))) as any
  if (!res.ok || body.error) throw new MetaApiError(body.error?.message ?? `Error ${res.status}`, body.error?.code)
  return body
}
