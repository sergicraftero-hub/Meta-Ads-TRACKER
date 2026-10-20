import type { DateRange } from './types'

export type RangePreset = 'today' | 'yesterday' | 'last_7d' | 'last_14d' | 'last_30d' | 'last_90d' | 'this_month' | 'last_month'

export const PRESET_LABELS: Record<RangePreset, string> = {
  today: 'Hoy',
  yesterday: 'Ayer',
  last_7d: 'Últimos 7 días',
  last_14d: 'Últimos 14 días',
  last_30d: 'Últimos 30 días',
  last_90d: 'Últimos 90 días',
  this_month: 'Este mes',
  last_month: 'Mes pasado'
}

const iso = (d: Date) => d.toISOString().slice(0, 10)

function addDays(isoDate: string, n: number): string {
  const d = new Date(isoDate + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return iso(d)
}

export function daysBetween(r: DateRange): number {
  return Math.round((Date.parse(r.until) - Date.parse(r.since)) / 86_400_000) + 1
}

/** Resolve a preset relative to `today` (YYYY-MM-DD). "Last N days" excludes today, like Ads Manager. */
export function presetRange(p: RangePreset, today: string = iso(new Date())): DateRange {
  const yesterday = addDays(today, -1)
  switch (p) {
    case 'today':
      return { since: today, until: today }
    case 'yesterday':
      return { since: yesterday, until: yesterday }
    case 'last_7d':
      return { since: addDays(today, -7), until: yesterday }
    case 'last_14d':
      return { since: addDays(today, -14), until: yesterday }
    case 'last_30d':
      return { since: addDays(today, -30), until: yesterday }
    case 'last_90d':
      return { since: addDays(today, -90), until: yesterday }
    case 'this_month':
      return { since: today.slice(0, 8) + '01', until: today }
    case 'last_month': {
      const firstThis = today.slice(0, 8) + '01'
      const lastPrev = addDays(firstThis, -1)
      return { since: lastPrev.slice(0, 8) + '01', until: lastPrev }
    }
  }
}

/** The same-length period immediately before `r`. */
export function previousRange(r: DateRange): DateRange {
  const n = daysBetween(r)
  return { since: addDays(r.since, -n), until: addDays(r.since, -1) }
}

export function isValidRange(r: unknown): r is DateRange {
  if (!r || typeof r !== 'object') return false
  const { since, until } = r as DateRange
  const re = /^\d{4}-\d{2}-\d{2}$/
  return re.test(since) && re.test(until) && since <= until && daysBetween({ since, until }) <= 400
}
