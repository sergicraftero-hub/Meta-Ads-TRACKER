import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { attribute, touchFromParams, paramsFromUrl } from '../server/tracking/attribution'
import { hashEmail, hashPhone } from '../server/tracking/capi'
import { demoReport } from '../shared/demo'

const sha = (s: string) => createHash('sha256').update(s).digest('hex')

describe('CAPI hashing', () => {
  it('normalises email before hashing', () => {
    expect(hashEmail('  Ana@Mail.COM ')).toBe(sha('ana@mail.com'))
    expect(hashEmail('not-an-email')).toBeUndefined()
  })
  it('normalises phone numbers with country code', () => {
    expect(hashPhone('600 123 123')).toBe(sha('34600123123'))
    expect(hashPhone('+34 600-123-123')).toBe(sha('34600123123'))
    expect(hashPhone('0034600123123')).toBe(sha('34600123123'))
    expect(hashPhone('12')).toBeUndefined()
  })
})

describe('touches', () => {
  it('only Meta traffic creates a touch', () => {
    expect(touchFromParams({ utm_source: 'google', utm_campaign: 'x' })).toBeNull()
    expect(touchFromParams({ fbclid: 'abc' })).not.toBeNull()
    expect(touchFromParams({ utm_source: 'ig', utm_campaign: '123' })?.cmp).toBe('123')
  })
  it('reads UTMs from a Shopify landing_site', () => {
    expect(paramsFromUrl('/products/x?utm_source=facebook&utm_content=999').utm_content).toBe('999')
    expect(paramsFromUrl(null)).toEqual({})
  })
})

describe('attribute', () => {
  const range = { since: '2026-09-20', until: '2026-10-19' }
  const report = demoReport('act_demo_2', range)
  const campaign = report.campaigns[0]
  const ts = Date.parse('2026-10-01T12:00:00Z')

  it('matches by id, then by name, and buckets the rest', () => {
    const { rows, unattributedConversions } = attribute(
      [
        { value: 100, ts, first_touch: null, last_touch: { cmp: campaign.id, ts: ts - 3600_000 } },
        { value: 50, ts, first_touch: null, last_touch: { cmp: campaign.name.toUpperCase(), ts: ts - 3600_000 } },
        { value: 20, ts, first_touch: null, last_touch: { cmp: 'unknown-utm', ts: ts - 3600_000 } },
        { value: 10, ts, first_touch: null, last_touch: null },
        { value: 10, ts, first_touch: null, last_touch: { cmp: campaign.id, ts: ts - 40 * 86400_000 } }
      ],
      report,
      'campaign',
      'last_click',
      'ecommerce'
    )
    const c = rows.find((r) => r.key === campaign.id)!
    expect(c.trackedConversions).toBe(2)
    expect(c.trackedValue).toBe(150)
    expect(rows.find((r) => r.key === '__unmatched')?.trackedValue).toBe(20)
    expect(unattributedConversions).toBe(2) // no touch + outside the 28-day window
  })
})
