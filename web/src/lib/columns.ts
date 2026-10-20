import { kpis } from '@shared/metrics'
import { int, money, pct, ratio } from '@shared/format'
import type { BusinessMode, Metrics } from '@shared/types'

export interface Column {
  key: string
  label: string
  value: (m: Metrics) => number
  format: (v: number, currency: string) => string
  /** For deltas and colouring: is a higher value better? */
  higherIsBetter: boolean
}

const c = (key: string, label: string, value: (m: Metrics) => number, format: Column['format'], higherIsBetter = true): Column => ({ key, label, value, format, higherIsBetter })

const spend = c('spend', 'Gasto', (m) => m.spend, (v, cur) => money(v, cur), true)
const impressions = c('impressions', 'Impresiones', (m) => m.impressions, (v) => int(v, true))
const ctr = c('ctr', 'CTR', (m) => kpis(m).ctr, (v) => pct(v))
const cpc = c('cpc', 'CPC', (m) => kpis(m).cpc, (v, cur) => money(v, cur), false)
const cpm = c('cpm', 'CPM', (m) => kpis(m).cpm, (v, cur) => money(v, cur), false)

export const COLUMNS: Record<BusinessMode, Column[]> = {
  leadgen: [
    spend,
    impressions,
    ctr,
    cpc,
    cpm,
    c('leads', 'Leads', (m) => m.leads, (v) => int(v)),
    c('cpl', 'CPL', (m) => kpis(m).cpl, (v, cur) => (v ? money(v, cur) : '—'), false),
    c('leadRate', 'Tasa de lead', (m) => kpis(m).leadRate, (v) => pct(v, 1))
  ],
  ecommerce: [
    spend,
    ctr,
    cpm,
    c('atc', 'Carritos', (m) => m.addToCart, (v) => int(v)),
    c('purchases', 'Compras', (m) => m.purchases, (v) => int(v)),
    c('revenue', 'Ingresos', (m) => m.purchaseValue, (v, cur) => money(v, cur)),
    c('roas', 'ROAS', (m) => kpis(m).roas, (v) => (v ? ratio(v) : '—')),
    c('cpa', 'CPA', (m) => kpis(m).cpa, (v, cur) => (v ? money(v, cur) : '—'), false),
    c('aov', 'Ticket medio', (m) => kpis(m).aov, (v, cur) => (v ? money(v, cur) : '—'))
  ]
}

export const resultLabel = (mode: BusinessMode) => (mode === 'leadgen' ? 'Leads' : 'Compras')
