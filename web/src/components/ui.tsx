import { useState, type ReactNode } from 'react'
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Check, Copy, Loader2, Minus } from 'lucide-react'
import { dec } from '@shared/format'
import type { ApiError } from '@/lib/api'

/** Delta badge. `goodWhenUp=false` for cost metrics, where a rise is bad. */
export function Delta({ value, goodWhenUp = true }: { value: number | null; goodWhenUp?: boolean }) {
  if (value === null || !Number.isFinite(value)) return <span className="delta flat">—</span>
  if (Math.abs(value) < 0.5)
    return (
      <span className="delta flat">
        <Minus size={12} /> 0 %
      </span>
    )
  const up = value > 0
  const good = up === goodWhenUp
  return (
    <span className={`delta ${good ? 'good' : 'bad'}`} title="Frente al periodo anterior">
      {up ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
      {dec(Math.abs(value), Math.abs(value) >= 100 ? 0 : 1)} %
    </span>
  )
}

export function KpiCard({ label, value, delta, goodWhenUp, icon, hint }: { label: string; value: string; delta?: number | null; goodWhenUp?: boolean; icon?: ReactNode; hint?: string }) {
  return (
    <div className="card kpi" title={hint}>
      <div className="label">
        {icon}
        {label}
      </div>
      <div className="value">{value}</div>
      {delta !== undefined && (
        <div className="row">
          <Delta value={delta} goodWhenUp={goodWhenUp} />
          <span className="faint" style={{ fontSize: 12 }}>
            vs periodo anterior
          </span>
        </div>
      )}
    </div>
  )
}

export function Spinner({ size = 16 }: { size?: number }) {
  return <Loader2 size={size} className="spin" />
}

export function Skeleton({ h = 120, w = '100%' }: { h?: number; w?: number | string }) {
  return <div className="skeleton" style={{ height: h, width: w }} />
}

export function LoadingGrid() {
  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="grid g4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} h={108} />
        ))}
      </div>
      <div className="grid g2">
        <Skeleton h={280} />
        <Skeleton h={280} />
      </div>
      <Skeleton h={320} />
    </div>
  )
}

export function ErrorState({ error, onRetry, action }: { error: ApiError | Error; onRetry?: () => void; action?: ReactNode }) {
  return (
    <div className="card empty">
      <AlertTriangle size={28} color="var(--warn)" />
      <h3>No se han podido cargar los datos</h3>
      <p className="muted" style={{ maxWidth: 520 }}>
        {error.message}
      </p>
      <div className="row">
        {onRetry && (
          <button className="btn" onClick={onRetry}>
            Reintentar
          </button>
        )}
        {action}
      </div>
    </div>
  )
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="card empty">
      {icon}
      <h3>{title}</h3>
      {children}
    </div>
  )
}

export function CopyButton({ text, label = 'Copiar', className = 'btn sm' }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      className={className}
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setDone(true)
          setTimeout(() => setDone(false), 1500)
        })
      }}
    >
      {done ? <Check size={14} /> : <Copy size={14} />}
      {done ? 'Copiado' : label}
    </button>
  )
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="tablist">
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={value === o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function statusBadge(effectiveStatus?: string) {
  if (!effectiveStatus) return null
  const map: Record<string, [string, string]> = {
    ACTIVE: ['Activo', 'good'],
    PAUSED: ['Pausado', ''],
    CAMPAIGN_PAUSED: ['Campaña pausada', ''],
    ADSET_PAUSED: ['Conjunto pausado', ''],
    DISAPPROVED: ['Rechazado', 'bad'],
    WITH_ISSUES: ['Con problemas', 'warn'],
    PENDING_REVIEW: ['En revisión', 'info'],
    IN_PROCESS: ['Procesando', 'info']
  }
  const [label, cls] = map[effectiveStatus] ?? [effectiveStatus.toLowerCase(), '']
  return <span className={`badge ${cls}`}>{label}</span>
}

/** Download rows as a CSV file (Excel-friendly: semicolon + BOM). */
export function downloadCsv(filename: string, header: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = typeof v === 'number' ? String(Math.round(v * 100) / 100).replace('.', ',') : v
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const csv = '﻿' + [header, ...rows].map((r) => r.map(esc).join(';')).join('\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
