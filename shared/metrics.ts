import type { BusinessMode, DailyRow, Metrics } from './types'

export const METRIC_KEYS: (keyof Metrics)[] = [
  'spend',
  'impressions',
  'clicks',
  'linkClicks',
  'landingPageViews',
  'leads',
  'registrations',
  'messages',
  'addToCart',
  'initiateCheckout',
  'purchases',
  'purchaseValue',
  'videoViews3s',
  'thruPlays'
]

export function emptyMetrics(): Metrics {
  return {
    spend: 0,
    impressions: 0,
    clicks: 0,
    linkClicks: 0,
    landingPageViews: 0,
    leads: 0,
    registrations: 0,
    messages: 0,
    addToCart: 0,
    initiateCheckout: 0,
    purchases: 0,
    purchaseValue: 0,
    videoViews3s: 0,
    thruPlays: 0
  }
}

export function addInto(target: Metrics, src: Metrics): Metrics {
  for (const k of METRIC_KEYS) target[k] += src[k]
  return target
}

export function sumMetrics(items: Metrics[]): Metrics {
  const out = emptyMetrics()
  for (const m of items) addInto(out, m)
  return out
}

// ---------- Parsing Meta "actions" arrays ----------

export interface MetaAction {
  action_type: string
  value: string | number
}

/**
 * Meta reports the same conversion under several action types (omni, pixel, onsite).
 * For each metric we take the FIRST type present in priority order — summing them
 * would double count.
 */
const ACTION_PRIORITY: Record<
  'leads' | 'registrations' | 'messages' | 'addToCart' | 'initiateCheckout' | 'purchases' | 'landingPageViews' | 'linkClicks' | 'videoViews3s',
  string[][]
> = {
  // Each inner array is summed (disjoint sources); outer arrays are alternatives in priority order.
  leads: [['lead'], ['onsite_conversion.lead_grouped', 'offsite_conversion.fb_pixel_lead'], ['leadgen_grouped']],
  registrations: [['omni_complete_registration'], ['complete_registration'], ['offsite_conversion.fb_pixel_complete_registration']],
  messages: [['onsite_conversion.messaging_conversation_started_7d']],
  addToCart: [['omni_add_to_cart'], ['add_to_cart'], ['offsite_conversion.fb_pixel_add_to_cart']],
  initiateCheckout: [['omni_initiated_checkout'], ['initiate_checkout'], ['offsite_conversion.fb_pixel_initiate_checkout']],
  purchases: [['omni_purchase'], ['purchase'], ['offsite_conversion.fb_pixel_purchase', 'onsite_web_purchase']],
  landingPageViews: [['landing_page_view'], ['omni_landing_page_view']],
  linkClicks: [['link_click']],
  videoViews3s: [['video_view']]
}

function pick(map: Map<string, number>, alternatives: string[][]): number {
  for (const group of alternatives) {
    if (group.some((t) => map.has(t))) return group.reduce((s, t) => s + (map.get(t) ?? 0), 0)
  }
  return 0
}

function toMap(actions: MetaAction[] | undefined): Map<string, number> {
  const m = new Map<string, number>()
  for (const a of actions ?? []) m.set(a.action_type, Number(a.value) || 0)
  return m
}

/** Shape of one row from the /insights endpoint (subset we request). */
export interface RawInsight {
  date_start?: string
  date_stop?: string
  campaign_id?: string
  campaign_name?: string
  adset_id?: string
  adset_name?: string
  ad_id?: string
  ad_name?: string
  spend?: string
  impressions?: string
  clicks?: string
  inline_link_clicks?: string
  reach?: string
  frequency?: string
  actions?: MetaAction[]
  action_values?: MetaAction[]
  video_thruplay_watched_actions?: MetaAction[]
}

export function parseInsightMetrics(r: RawInsight): Metrics {
  const actions = toMap(r.actions)
  const values = toMap(r.action_values)
  const linkFromActions = pick(actions, ACTION_PRIORITY.linkClicks)
  return {
    spend: Number(r.spend) || 0,
    impressions: Number(r.impressions) || 0,
    clicks: Number(r.clicks) || 0,
    linkClicks: Number(r.inline_link_clicks) || linkFromActions,
    landingPageViews: pick(actions, ACTION_PRIORITY.landingPageViews),
    leads: pick(actions, ACTION_PRIORITY.leads),
    registrations: pick(actions, ACTION_PRIORITY.registrations),
    messages: pick(actions, ACTION_PRIORITY.messages),
    addToCart: pick(actions, ACTION_PRIORITY.addToCart),
    initiateCheckout: pick(actions, ACTION_PRIORITY.initiateCheckout),
    purchases: pick(actions, ACTION_PRIORITY.purchases),
    purchaseValue: pick(values, ACTION_PRIORITY.purchases),
    videoViews3s: pick(actions, ACTION_PRIORITY.videoViews3s),
    thruPlays: (r.video_thruplay_watched_actions ?? []).reduce((s, a) => s + (Number(a.value) || 0), 0)
  }
}

export function parseDailyRow(r: RawInsight): DailyRow {
  return {
    ...parseInsightMetrics(r),
    date: r.date_start ?? '',
    campaignId: r.campaign_id ?? '',
    campaignName: r.campaign_name ?? '',
    adsetId: r.adset_id ?? '',
    adsetName: r.adset_name ?? '',
    adId: r.ad_id ?? '',
    adName: r.ad_name ?? ''
  }
}

// ---------- Derived KPIs ----------

const div = (a: number, b: number) => (b > 0 ? a / b : 0)

export interface Kpis {
  spend: number
  impressions: number
  linkClicks: number
  ctr: number // %
  cpc: number
  cpm: number
  // lead gen
  leads: number
  cpl: number
  leadRate: number // % of link clicks
  // e-commerce
  purchases: number
  revenue: number
  roas: number
  cpa: number
  aov: number
  atcRate: number // % of link clicks
  purchaseRate: number // % of link clicks
  lpvRate: number // % of link clicks that loaded the page
  hookRate: number // % 3s video views / impressions
}

export function kpis(m: Metrics): Kpis {
  return {
    spend: m.spend,
    impressions: m.impressions,
    linkClicks: m.linkClicks,
    ctr: div(m.linkClicks, m.impressions) * 100,
    cpc: div(m.spend, m.linkClicks),
    cpm: div(m.spend, m.impressions) * 1000,
    leads: m.leads,
    cpl: div(m.spend, m.leads),
    leadRate: div(m.leads, m.linkClicks) * 100,
    purchases: m.purchases,
    revenue: m.purchaseValue,
    roas: div(m.purchaseValue, m.spend),
    cpa: div(m.spend, m.purchases),
    aov: div(m.purchaseValue, m.purchases),
    atcRate: div(m.addToCart, m.linkClicks) * 100,
    purchaseRate: div(m.purchases, m.linkClicks) * 100,
    lpvRate: div(m.landingPageViews, m.linkClicks) * 100,
    hookRate: div(m.videoViews3s, m.impressions) * 100
  }
}

/** Primary result count for the business mode. */
export const results = (m: Metrics, mode: BusinessMode) => (mode === 'leadgen' ? m.leads : m.purchases)

/** Relative change in %, or null if there's no baseline. */
export function pctChange(curr: number, prev: number): number | null {
  if (!prev) return null
  return ((curr - prev) / prev) * 100
}

// ---------- Aggregation ----------

export interface EntityStats {
  id: string
  name: string
  parentId?: string
  metrics: Metrics
  daily: Map<string, Metrics>
}

/** Group daily rows by campaign / adset / ad, keeping a per-day series for each entity. */
export function groupBy(rows: DailyRow[], level: 'campaign' | 'adset' | 'ad'): Map<string, EntityStats> {
  const out = new Map<string, EntityStats>()
  for (const r of rows) {
    const id = level === 'campaign' ? r.campaignId : level === 'adset' ? r.adsetId : r.adId
    const name = level === 'campaign' ? r.campaignName : level === 'adset' ? r.adsetName : r.adName
    const parentId = level === 'adset' ? r.campaignId : level === 'ad' ? r.adsetId : undefined
    let e = out.get(id)
    if (!e) {
      e = { id, name, parentId, metrics: emptyMetrics(), daily: new Map() }
      out.set(id, e)
    }
    addInto(e.metrics, r)
    let d = e.daily.get(r.date)
    if (!d) e.daily.set(r.date, (d = emptyMetrics()))
    addInto(d, r)
  }
  return out
}

/** Account-wide per-day totals, sorted by date, with gaps filled with zeros. */
export function dailySeries(rows: DailyRow[], since: string, until: string): { date: string; m: Metrics }[] {
  const byDate = new Map<string, Metrics>()
  for (const r of rows) {
    let d = byDate.get(r.date)
    if (!d) byDate.set(r.date, (d = emptyMetrics()))
    addInto(d, r)
  }
  const out: { date: string; m: Metrics }[] = []
  for (const date of eachDay(since, until)) out.push({ date, m: byDate.get(date) ?? emptyMetrics() })
  return out
}

export function eachDay(since: string, until: string): string[] {
  const days: string[] = []
  const d = new Date(since + 'T00:00:00Z')
  const end = new Date(until + 'T00:00:00Z')
  while (d <= end && days.length < 800) {
    days.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return days
}
