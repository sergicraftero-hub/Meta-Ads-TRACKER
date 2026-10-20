const cache = new Map<string, Intl.NumberFormat>()

function nf(key: string, opts: Intl.NumberFormatOptions): Intl.NumberFormat {
  let f = cache.get(key)
  if (!f) cache.set(key, (f = new Intl.NumberFormat('es-ES', { useGrouping: 'always', ...opts } as Intl.NumberFormatOptions)))
  return f
}

export function money(v: number, currency = 'EUR', compact = false): string {
  const digits = Math.abs(v) >= 100 || compact ? 0 : 2
  return nf(`m${currency}${compact}${digits}`, {
    style: 'currency',
    currency,
    notation: compact && Math.abs(v) >= 10_000 ? 'compact' : 'standard',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }).format(v)
}

export function int(v: number, compact = false): string {
  return nf(`i${compact}`, { notation: compact && Math.abs(v) >= 10_000 ? 'compact' : 'standard', maximumFractionDigits: compact ? 1 : 0 }).format(v)
}

export function pct(v: number, digits = 2): string {
  return nf(`p${digits}`, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v) + ' %'
}

export function ratio(v: number): string {
  return nf('r', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v) + 'x'
}

export function dec(v: number, digits = 2): string {
  return nf(`d${digits}`, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v)
}

export function shortDate(isoDate: string): string {
  const [, m, d] = isoDate.split('-')
  return `${Number(d)}/${Number(m)}`
}
