import { graph, graphAll, asyncInsights, mapLimit } from './graph'
import { parseDailyRow, parseInsightMetrics, emptyMetrics, type RawInsight } from '../../shared/metrics'
import { previousRange } from '../../shared/dates'
import type { AccountOverviewRow, AccountReport, AdAccount, AdInfo, AdSetInfo, CampaignInfo, DateRange, Metrics, ReachStats } from '../../shared/types'

const INSIGHT_FIELDS = [
  'spend',
  'impressions',
  'clicks',
  'inline_link_clicks',
  'actions',
  'action_values',
  'video_thruplay_watched_actions'
]

const LIVE_STATUSES = ['ACTIVE', 'PAUSED', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED', 'IN_PROCESS', 'WITH_ISSUES', 'PENDING_REVIEW', 'DISAPPROVED', 'PREAPPROVED', 'PENDING_BILLING_INFO']

// ---------- small TTL cache with in-flight de-duplication ----------

const TTL = 15 * 60_000
const cache = new Map<string, { at: number; p: Promise<unknown> }>()

function cached<T>(key: string, force: boolean, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key)
  if (hit && !force && Date.now() - hit.at < TTL) return hit.p as Promise<T>
  const p = fn()
  cache.set(key, { at: Date.now(), p })
  p.catch(() => cache.delete(key))
  if (cache.size > 500) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, 100)
    for (const [k] of oldest) cache.delete(k)
  }
  return p
}

export function clearUserCache(userId: string) {
  for (const k of cache.keys()) if (k.startsWith(userId + '|')) cache.delete(k)
}

// ---------- accounts ----------

export function listAccounts(userId: string, token: string, force = false): Promise<AdAccount[]> {
  return cached(`${userId}|accounts`, force, async () => {
    const raw = await graphAll<any>('me/adaccounts', token, {
      fields: 'id,account_id,name,currency,account_status,timezone_name,business{name}'
    })
    return raw
      .map(
        (a): AdAccount => ({
          id: a.id,
          accountId: a.account_id,
          name: a.name,
          currency: a.currency,
          status: a.account_status,
          timezone: a.timezone_name,
          business: a.business?.name
        })
      )
      .sort((a, b) => Number(a.status !== 1) - Number(b.status !== 1) || a.name.localeCompare(b.name))
  })
}

async function accountTotals(accountId: string, token: string, ranges: DateRange[], withReach: boolean): Promise<(Metrics & ReachStats)[]> {
  const rows = await graph<{ data: (RawInsight & { date_start: string })[] }>(`${accountId}/insights`, token, {
    level: 'account',
    fields: [...INSIGHT_FIELDS, ...(withReach ? ['reach', 'frequency'] : [])].join(','),
    time_ranges: ranges,
    use_unified_attribution_setting: true
  })
  return ranges.map((r) => {
    const row = rows.data.find((x) => x.date_start === r.since)
    if (!row) return { ...emptyMetrics(), reach: 0, frequency: 0 }
    return { ...parseInsightMetrics(row), reach: Number(row.reach) || 0, frequency: Number(row.frequency) || 0 }
  })
}

export function accountsOverview(userId: string, token: string, range: DateRange, force = false): Promise<AccountOverviewRow[]> {
  return cached(`${userId}|overview|${range.since}|${range.until}`, force, async () => {
    const accounts = (await listAccounts(userId, token, force)).filter((a) => a.status !== 101)
    const prev = previousRange(range)
    return mapLimit(accounts, 4, async (account): Promise<AccountOverviewRow> => {
      try {
        const [totals, previousTotals] = await accountTotals(account.id, token, [range, prev], false)
        return { account, totals, previousTotals }
      } catch (e) {
        return { account, totals: emptyMetrics(), previousTotals: emptyMetrics(), error: (e as Error).message }
      }
    })
  })
}

// ---------- full account report ----------

export function accountReport(userId: string, token: string, accountId: string, range: DateRange, force = false): Promise<AccountReport> {
  return cached(`${userId}|report|${accountId}|${range.since}|${range.until}`, force, async () => {
    const accounts = await listAccounts(userId, token)
    const account = accounts.find((a) => a.id === accountId)
    if (!account) throw new Error('No tienes acceso a esa cuenta publicitaria')
    const prev = previousRange(range)

    const [daily, reachRows, [totals, previousTotals], campaigns, adsets, ads] = await Promise.all([
      asyncInsights<RawInsight>(accountId, token, {
        level: 'ad',
        fields: ['campaign_id', 'campaign_name', 'adset_id', 'adset_name', 'ad_id', 'ad_name', ...INSIGHT_FIELDS].join(','),
        time_range: range,
        time_increment: 1,
        use_unified_attribution_setting: true
      }),
      graphAll<{ ad_id: string; reach: string; frequency: string }>(`${accountId}/insights`, token, {
        level: 'ad',
        fields: 'ad_id,reach,frequency',
        time_range: range
      }),
      accountTotals(accountId, token, [range, prev], true),
      graphAll<any>(`${accountId}/campaigns`, token, {
        fields: 'id,name,objective,status,effective_status,daily_budget,lifetime_budget',
        effective_status: LIVE_STATUSES
      }),
      graphAll<any>(`${accountId}/adsets`, token, {
        fields: 'id,name,campaign_id,status,effective_status,optimization_goal,daily_budget,lifetime_budget',
        effective_status: LIVE_STATUSES
      }),
      graphAll<any>(`${accountId}/ads`, token, {
        fields: 'id,name,campaign_id,adset_id,status,effective_status,creative{thumbnail_url,image_url,title,body,call_to_action_type,object_type}',
        effective_status: LIVE_STATUSES,
        thumbnail_width: 400,
        thumbnail_height: 400
      })
    ])

    // Budgets come in the currency's minor unit (cents for EUR/USD).
    const money = (v?: string) => (v ? Number(v) / 100 : undefined)
    const adReach: Record<string, ReachStats> = {}
    for (const r of reachRows) adReach[r.ad_id] = { reach: Number(r.reach) || 0, frequency: Number(r.frequency) || 0 }

    return {
      account,
      range,
      previousRange: prev,
      rows: daily.map(parseDailyRow),
      totals,
      previousTotals,
      adReach,
      campaigns: campaigns.map(
        (c): CampaignInfo => ({
          id: c.id,
          name: c.name,
          objective: c.objective,
          status: c.status,
          effectiveStatus: c.effective_status,
          dailyBudget: money(c.daily_budget),
          lifetimeBudget: money(c.lifetime_budget)
        })
      ),
      adsets: adsets.map(
        (s): AdSetInfo => ({
          id: s.id,
          name: s.name,
          campaignId: s.campaign_id,
          status: s.status,
          effectiveStatus: s.effective_status,
          optimizationGoal: s.optimization_goal,
          dailyBudget: money(s.daily_budget),
          lifetimeBudget: money(s.lifetime_budget)
        })
      ),
      ads: ads.map(
        (a): AdInfo => ({
          id: a.id,
          name: a.name,
          campaignId: a.campaign_id,
          adsetId: a.adset_id,
          status: a.status,
          effectiveStatus: a.effective_status,
          creative: {
            thumbnailUrl: a.creative?.thumbnail_url,
            imageUrl: a.creative?.image_url,
            title: a.creative?.title,
            body: a.creative?.body,
            cta: a.creative?.call_to_action_type,
            objectType: a.creative?.object_type
          }
        })
      ),
      fetchedAt: Date.now(),
      isDemo: false
    }
  })
}
