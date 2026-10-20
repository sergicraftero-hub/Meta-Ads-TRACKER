import { groupBy } from '../../shared/metrics'
import type { AccountReport, AttributionModel, AttributionRow, BusinessMode, Level } from '../../shared/types'

export interface Touch {
  src?: string
  med?: string
  cmp?: string // campaign id or utm_campaign
  set?: string // adset id or utm_term
  ad?: string // ad id or utm_content
  fbclid?: string
  ts: number
}

const META_SOURCE = /^(fb|facebook|ig|instagram|meta|an|audience_network|messenger)$/i

/** Build a touch from landing-page params, or null when the visit isn't from a Meta ad. */
export function touchFromParams(p: Record<string, string | undefined>, ts = Date.now()): Touch | null {
  const t: Touch = {
    src: p.utm_source,
    med: p.utm_medium,
    cmp: p.campaign_id || p.utm_campaign,
    set: p.adset_id || p.utm_term,
    ad: p.ad_id || p.utm_content,
    fbclid: p.fbclid,
    ts
  }
  const fromMeta = Boolean(t.fbclid) || (t.src ? META_SOURCE.test(t.src) : false) || Boolean(p.campaign_id || p.ad_id)
  return fromMeta ? t : null
}

export function paramsFromUrl(url?: string | null): Record<string, string> {
  if (!url) return {}
  try {
    const u = new URL(url, 'https://x.invalid')
    return Object.fromEntries(u.searchParams.entries())
  } catch {
    return {}
  }
}

export interface ConversionEvent {
  value: number
  ts: number
  first_touch: Touch | null
  last_touch: Touch | null
}

const WINDOW_MS = 28 * 86400_000

/**
 * Join tracked conversions (first-party data) with Meta's spend and self-reported
 * conversions at the requested level. Touches carry either Meta ids (recommended
 * URL params) or free-text UTMs, so we match by id first and then by name.
 */
export function attribute(
  events: ConversionEvent[],
  report: AccountReport,
  level: Level,
  model: AttributionModel,
  mode: BusinessMode
): { rows: AttributionRow[]; unattributedConversions: number; unattributedValue: number } {
  const entities = groupBy(report.rows, level)
  const rows = new Map<string, AttributionRow>()
  const byName = new Map<string, string>()
  for (const e of entities.values()) {
    rows.set(e.id, {
      key: e.id,
      name: e.name,
      spend: e.metrics.spend,
      metaConversions: mode === 'leadgen' ? e.metrics.leads : e.metrics.purchases,
      metaValue: mode === 'leadgen' ? 0 : e.metrics.purchaseValue,
      trackedConversions: 0,
      trackedValue: 0
    })
    byName.set(e.name.trim().toLowerCase(), e.id)
  }

  let unattributedConversions = 0
  let unattributedValue = 0
  for (const ev of events) {
    const touch = model === 'first_click' ? ev.first_touch : ev.last_touch
    const key = touch ? (level === 'campaign' ? touch.cmp : level === 'adset' ? touch.set : touch.ad) : undefined
    if (!touch || ev.ts - touch.ts > WINDOW_MS || ev.ts < touch.ts - 60_000) {
      unattributedConversions++
      unattributedValue += ev.value
      continue
    }
    const id = key ? (rows.has(key) ? key : byName.get(key.trim().toLowerCase())) : undefined
    const rowKey = id ?? '__unmatched'
    let row = rows.get(rowKey)
    if (!row) {
      row = { key: rowKey, name: 'Meta (sin parámetros UTM reconocibles)', spend: 0, metaConversions: 0, metaValue: 0, trackedConversions: 0, trackedValue: 0 }
      rows.set(rowKey, row)
    }
    row.trackedConversions++
    row.trackedValue += ev.value
  }

  return {
    rows: [...rows.values()].filter((r) => r.spend > 0 || r.trackedConversions > 0).sort((a, b) => b.spend - a.spend),
    unattributedConversions,
    unattributedValue
  }
}
