import { describe, expect, it } from 'vitest'
import { parseInsightMetrics, kpis, dailySeries, groupBy, pctChange } from '../shared/metrics'
import { presetRange, previousRange, isValidRange } from '../shared/dates'

describe('parseInsightMetrics', () => {
  it('takes the highest-priority action type instead of summing duplicates', () => {
    const m = parseInsightMetrics({
      spend: '100',
      impressions: '10000',
      inline_link_clicks: '200',
      actions: [
        { action_type: 'omni_purchase', value: '5' },
        { action_type: 'purchase', value: '5' },
        { action_type: 'offsite_conversion.fb_pixel_purchase', value: '5' },
        { action_type: 'lead', value: '7' },
        { action_type: 'onsite_conversion.lead_grouped', value: '4' },
        { action_type: 'landing_page_view', value: '150' }
      ],
      action_values: [
        { action_type: 'omni_purchase', value: '250.5' },
        { action_type: 'purchase', value: '250.5' }
      ]
    })
    expect(m.purchases).toBe(5)
    expect(m.purchaseValue).toBe(250.5)
    expect(m.leads).toBe(7)
    expect(m.landingPageViews).toBe(150)
    expect(m.linkClicks).toBe(200)
  })

  it('sums disjoint lead sources when the aggregate "lead" type is missing', () => {
    const m = parseInsightMetrics({
      actions: [
        { action_type: 'onsite_conversion.lead_grouped', value: '4' },
        { action_type: 'offsite_conversion.fb_pixel_lead', value: '3' }
      ]
    })
    expect(m.leads).toBe(7)
  })

  it('derives KPIs without dividing by zero', () => {
    const k = kpis(parseInsightMetrics({ spend: '50', impressions: '0' }))
    expect(k.ctr).toBe(0)
    expect(k.cpl).toBe(0)
    expect(k.roas).toBe(0)
  })
})

describe('aggregation', () => {
  const row = (date: string, adId: string, spend: number) => ({
    ...parseInsightMetrics({ spend: String(spend) }),
    date,
    campaignId: 'c1',
    campaignName: 'C',
    adsetId: 's1',
    adsetName: 'S',
    adId,
    adName: adId
  })
  it('fills missing days with zeros', () => {
    const s = dailySeries([row('2026-01-02', 'a', 10)], '2026-01-01', '2026-01-03')
    expect(s.map((d) => d.m.spend)).toEqual([0, 10, 0])
  })
  it('groups by level with parent ids', () => {
    const g = groupBy([row('2026-01-01', 'a', 10), row('2026-01-02', 'a', 5), row('2026-01-01', 'b', 1)], 'ad')
    expect(g.get('a')!.metrics.spend).toBe(15)
    expect(g.get('a')!.parentId).toBe('s1')
    expect(g.get('a')!.daily.size).toBe(2)
  })
  it('pctChange has no baseline for zero', () => {
    expect(pctChange(10, 0)).toBeNull()
    expect(pctChange(15, 10)).toBe(50)
  })
})

describe('dates', () => {
  it('last 7 days excludes today, like Ads Manager', () => {
    expect(presetRange('last_7d', '2026-10-20')).toEqual({ since: '2026-10-13', until: '2026-10-19' })
  })
  it('last month across a year boundary', () => {
    expect(presetRange('last_month', '2026-01-15')).toEqual({ since: '2025-12-01', until: '2025-12-31' })
  })
  it('previous range has the same length', () => {
    expect(previousRange({ since: '2026-10-13', until: '2026-10-19' })).toEqual({ since: '2026-10-06', until: '2026-10-12' })
  })
  it('validates ranges', () => {
    expect(isValidRange({ since: '2026-10-19', until: '2026-10-13' })).toBe(false)
    expect(isValidRange({ since: '2026-10-13', until: '2026-10-19' })).toBe(true)
    expect(isValidRange({ since: "2026-10-13'; drop", until: '2026-10-19' })).toBe(false)
  })
})
