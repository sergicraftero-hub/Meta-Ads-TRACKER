export type BusinessMode = 'leadgen' | 'ecommerce'
export type Level = 'campaign' | 'adset' | 'ad'

/** Inclusive date range, YYYY-MM-DD in the ad account's timezone. */
export interface DateRange {
  since: string
  until: string
}

export interface AdAccount {
  id: string // act_123
  accountId: string // 123
  name: string
  currency: string
  status: number // 1 active, 2 disabled, 3 unsettled, 7 pending review, 9 grace period, 101 closed
  timezone: string
  business?: string
}

/** Additive metrics: safe to sum across days and entities. */
export interface Metrics {
  spend: number
  impressions: number
  clicks: number
  linkClicks: number
  landingPageViews: number
  leads: number
  registrations: number
  messages: number
  addToCart: number
  initiateCheckout: number
  purchases: number
  purchaseValue: number
  videoViews3s: number
  thruPlays: number
}

export interface ReachStats {
  reach: number
  frequency: number
}

export interface DailyRow extends Metrics {
  date: string
  campaignId: string
  campaignName: string
  adsetId: string
  adsetName: string
  adId: string
  adName: string
}

export interface CampaignInfo {
  id: string
  name: string
  objective: string
  status: string
  effectiveStatus: string
  dailyBudget?: number
  lifetimeBudget?: number
}

export interface AdSetInfo {
  id: string
  name: string
  campaignId: string
  status: string
  effectiveStatus: string
  optimizationGoal?: string
  dailyBudget?: number
  lifetimeBudget?: number
}

export interface Creative {
  thumbnailUrl?: string
  imageUrl?: string
  title?: string
  body?: string
  cta?: string
  objectType?: string
}

export interface AdInfo {
  id: string
  name: string
  campaignId: string
  adsetId: string
  status: string
  effectiveStatus: string
  creative: Creative
}

export interface AccountReport {
  account: AdAccount
  range: DateRange
  previousRange: DateRange
  rows: DailyRow[]
  totals: Metrics & ReachStats
  previousTotals: Metrics & ReachStats
  /** Reach and frequency per ad over the whole range (not additive). */
  adReach: Record<string, ReachStats>
  campaigns: CampaignInfo[]
  adsets: AdSetInfo[]
  ads: AdInfo[]
  fetchedAt: number
  isDemo: boolean
}

export interface AccountOverviewRow {
  account: AdAccount
  totals: Metrics
  previousTotals: Metrics
  error?: string
}

export interface Targets {
  /** Target cost per lead in account currency. 0 = derive from account average. */
  cpl: number
  /** Target ROAS (purchase value / spend). 0 = derive from account average. */
  roas: number
}

export type SubscriptionState = 'active' | 'trialing' | 'past_due' | 'canceled' | 'none'

export interface Me {
  id: string
  email: string
  name: string
  mode: BusinessMode
  targets: Targets
  demo: boolean
  meta: { connected: boolean; userName?: string; expiresAt?: number | null }
  subscription: {
    state: SubscriptionState
    trialEndsAt?: number | null
    currentPeriodEnd?: number | null
    /** False when Stripe isn't configured on this server: everything is unlocked. */
    billingEnabled: boolean
    hasAccess: boolean
  }
  aiEnabled: boolean
  metaOAuthEnabled: boolean
}

export type Severity = 'critical' | 'warning' | 'opportunity' | 'info'

export interface Recommendation {
  id: string
  severity: Severity
  category: 'presupuesto' | 'creatividad' | 'audiencia' | 'conversion' | 'estructura' | 'escala' | 'tendencia' | 'tracking'
  title: string
  detail: string
  action: string
  entity?: { level: Level | 'account'; id: string; name: string }
}

export interface AiAdConcept {
  angle: string
  hook: string
  primaryText: string
  headline: string
  cta: string
  format: string
  rationale: string
}

export interface AiAnalysis {
  summary: string
  priorities: { title: string; why: string; how: string; impact: 'alto' | 'medio' | 'bajo' }[]
  concepts: AiAdConcept[]
  model: string
  createdAt: number
}

// ---------- Tracking / attribution ----------

export interface TrackingSite {
  id: string
  name: string
  domain: string
  publicKey: string
  metaPixelId: string | null
  hasCapiToken: boolean
  testEventCode: string | null
  hasShopifySecret: boolean
  currency: string
  createdAt: number
}

export type AttributionModel = 'last_click' | 'first_click'

export interface AttributionRow {
  key: string // campaign / adset / ad id or utm value
  name: string
  spend: number
  metaConversions: number
  metaValue: number
  trackedConversions: number
  trackedValue: number
}

export interface AttributionReport {
  model: AttributionModel
  level: Level
  range: DateRange
  rows: AttributionRow[]
  totals: {
    events: number
    visitors: number
    trackedConversions: number
    trackedValue: number
    unattributedConversions: number
    unattributedValue: number
    capiSent: number
    capiFailed: number
  }
  daily: { date: string; trackedValue: number; trackedConversions: number; capiSent: number }[]
}
