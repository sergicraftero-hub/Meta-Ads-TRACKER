import { describe, expect, it } from 'vitest'
import { buildRecommendations } from '../shared/recommendations'
import { demoReport } from '../shared/demo'

const range = { since: '2026-09-20', until: '2026-10-19' }

describe('buildRecommendations (demo data)', () => {
  it('flags the lead-gen ad that burns budget and the fatigued carousel', () => {
    const recs = buildRecommendations(demoReport('act_demo_1', range), 'leadgen', { cpl: 0, roas: 0 })
    const tac = recs.find((r) => r.entity?.name === 'Imagen oferta TAC' && r.severity === 'critical')
    expect(tac).toBeDefined()
    expect(recs.some((r) => r.id.startsWith('ad-fatigue') && r.entity?.name === 'Carrusel antes/después')).toBe(true)
    expect(recs.some((r) => r.id.startsWith('win-'))).toBe(true)
  })

  it('finds e-commerce winners against a ROAS target', () => {
    const recs = buildRecommendations(demoReport('act_demo_2', range), 'ecommerce', { cpl: 0, roas: 2 })
    expect(recs.some((r) => r.id.startsWith('win-'))).toBe(true)
    // critical first
    const order = recs.map((r) => ['critical', 'warning', 'opportunity', 'info'].indexOf(r.severity))
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  it('does not produce ad-level advice for an account without spend', () => {
    const r = demoReport('act_demo_1', range)
    r.rows = []
    r.totals = { ...r.totals, spend: 0 }
    expect(buildRecommendations(r, 'leadgen', { cpl: 10, roas: 0 }).map((x) => x.id)).toEqual(['no-spend'])
  })

  it('demo data is deterministic', () => {
    expect(demoReport('act_demo_3', range).totals.spend).toBe(demoReport('act_demo_3', range).totals.spend)
  })
})
