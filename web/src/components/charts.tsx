import { useEffect, useState, type ReactNode } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { shortDate } from '@shared/format'

/** Resolve CSS custom properties so Recharts (SVG attributes) gets real colors, re-read on theme change. */
export function useCssVars<T extends string>(names: readonly T[]): Record<T, string> {
  const read = () => {
    const cs = getComputedStyle(document.documentElement)
    return Object.fromEntries(names.map((n) => [n, cs.getPropertyValue(`--${n}`).trim()])) as Record<T, string>
  }
  const [vals, setVals] = useState(read)
  useEffect(() => {
    const update = () => setVals(read())
    const mo = new MutationObserver(update)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    const mq = matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', update)
    return () => {
      mo.disconnect()
      mq.removeEventListener('change', update)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return vals
}

const VARS = ['series-1', 'series-2', 'series-3', 'series-4', 'grid', 'text-3', 'border-strong', 'surface'] as const

export interface Series {
  key: string
  label: string
  color?: 'series-1' | 'series-2' | 'series-3' | 'series-4'
  format: (v: number) => string
}

function ChartTooltip({ active, payload, label, series }: { active?: boolean; payload?: { dataKey: string; value: number; color: string }[]; label?: string; series: Series[] }) {
  if (!active || !payload?.length) return null
  return (
    <div className="tooltip">
      <div className="t">{label}</div>
      {payload.map((p) => {
        const s = series.find((x) => x.key === p.dataKey)
        return (
          <div className="r" key={p.dataKey}>
            <span className="row" style={{ gap: 6 }}>
              <i className="dot" style={{ background: p.color }} />
              {s?.label}
            </span>
            <b className="num">{s ? s.format(p.value) : p.value}</b>
          </div>
        )
      })}
    </div>
  )
}

export function ChartCard({ title, right, children, legend }: { title: ReactNode; right?: ReactNode; children: ReactNode; legend?: Series[] }) {
  const c = useCssVars(VARS)
  return (
    <div className="card chart-card">
      <div className="card-head">
        <h2>{title}</h2>
        <span className="spacer" />
        {legend && legend.length > 1 && (
          <div className="legend">
            {legend.map((s) => (
              <span key={s.key}>
                <i style={{ background: c[s.color ?? 'series-1'] }} />
                {s.label}
              </span>
            ))}
          </div>
        )}
        {right}
      </div>
      <div className="card-body">{children}</div>
    </div>
  )
}

type Datum = Record<string, number | string>

/** Single-axis time series. One measure family per chart (never dual axis). */
export function TimeChart({ data, series, kind = 'area', height = 240, yFormat }: { data: Datum[]; series: Series[]; kind?: 'area' | 'bar' | 'line'; height?: number; yFormat: (v: number) => string }) {
  const c = useCssVars(VARS)
  const axis = { stroke: c['text-3'], fontSize: 11.5, tickLine: false, axisLine: false }
  const x = <XAxis dataKey="date" tickFormatter={shortDate} {...axis} minTickGap={24} />
  const y = <YAxis tickFormatter={yFormat} {...axis} width={64} />
  const grid = <CartesianGrid stroke={c.grid} vertical={false} />
  const tip = <Tooltip content={<ChartTooltip series={series} />} cursor={{ stroke: c['border-strong'], fill: c.grid, fillOpacity: 0.5 }} labelFormatter={(l) => String(l)} />
  return (
    <ResponsiveContainer width="100%" height={height}>
      {kind === 'bar' ? (
        <BarChart data={data} barCategoryGap="18%">
          {grid}
          {x}
          {y}
          {tip}
          {series.map((s) => (
            <Bar key={s.key} dataKey={s.key} fill={c[s.color ?? 'series-1']} radius={[4, 4, 0, 0]} stackId={series.length > 1 ? 'a' : undefined} />
          ))}
        </BarChart>
      ) : kind === 'line' ? (
        <LineChart data={data}>
          {grid}
          {x}
          {y}
          {tip}
          {series.map((s) => (
            <Line key={s.key} dataKey={s.key} stroke={c[s.color ?? 'series-1']} strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: c.surface, strokeWidth: 2 }} />
          ))}
        </LineChart>
      ) : (
        <AreaChart data={data}>
          <defs>
            {series.map((s) => (
              <linearGradient key={s.key} id={`g-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={c[s.color ?? 'series-1']} stopOpacity={0.28} />
                <stop offset="1" stopColor={c[s.color ?? 'series-1']} stopOpacity={0.02} />
              </linearGradient>
            ))}
          </defs>
          {grid}
          {x}
          {y}
          {tip}
          {series.map((s) => (
            <Area key={s.key} dataKey={s.key} stroke={c[s.color ?? 'series-1']} strokeWidth={2} fill={`url(#g-${s.key})`} activeDot={{ r: 4, stroke: c.surface, strokeWidth: 2 }} />
          ))}
        </AreaChart>
      )}
    </ResponsiveContainer>
  )
}

/** Horizontal funnel with step-to-step conversion rates. */
export function Funnel({ steps, format }: { steps: { label: string; value: number }[]; format: (v: number) => string }) {
  const max = Math.max(1, ...steps.map((s) => s.value))
  return (
    <div className="col" style={{ gap: 2 }}>
      {steps.map((s, i) => {
        const prev = i > 0 ? steps[i - 1].value : 0
        const rate = i > 0 && prev > 0 ? (s.value / prev) * 100 : null
        return (
          <div className="funnel-step" key={s.label} title={`${s.label}: ${format(s.value)}`}>
            <span className="muted" style={{ fontWeight: 550 }}>
              {s.label}
            </span>
            <div style={{ background: 'var(--surface-2)', borderRadius: 4 }}>
              <div className="funnel-bar" style={{ width: `${Math.max(0.5, (s.value / max) * 100)}%`, opacity: 1 - i * 0.12 }} />
            </div>
            <div style={{ textAlign: 'right' }}>
              <b className="num">{format(s.value)}</b>
              <div className="funnel-rate num">{rate === null ? ' ' : `${rate.toFixed(rate < 10 ? 1 : 0)} % del paso anterior`}</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** Horizontal bar ranking (share of spend etc.). */
export function RankBars({ items, format, color = 'series-1' }: { items: { label: string; value: number; sub?: string }[]; format: (v: number) => string; color?: 'series-1' | 'series-2' | 'series-3' | 'series-4' }) {
  const max = Math.max(1, ...items.map((i) => i.value))
  return (
    <div className="col" style={{ gap: 10 }}>
      {items.map((it) => (
        <div key={it.label} className="col" style={{ gap: 4 }}>
          <div className="row">
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 550 }}>{it.label}</span>
            <span className="spacer" />
            {it.sub && <span className="faint num" style={{ fontSize: 12 }}>{it.sub}</span>}
            <b className="num">{format(it.value)}</b>
          </div>
          <div style={{ background: 'var(--surface-2)', borderRadius: 4, height: 8 }}>
            <div style={{ width: `${(it.value / max) * 100}%`, height: 8, borderRadius: 4, background: `var(--${color})` }} />
          </div>
        </div>
      ))}
    </div>
  )
}
