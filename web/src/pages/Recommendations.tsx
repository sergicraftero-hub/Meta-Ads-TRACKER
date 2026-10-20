import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bot, CheckCircle2 } from 'lucide-react'
import { useReport, useStore } from '@/lib/store'
import { ErrorState, LoadingGrid, Segmented, Empty } from '@/components/ui'
import { buildRecommendations } from '@shared/recommendations'
import type { Severity } from '@shared/types'

const SEV: Record<Severity, { label: string; cls: string }> = {
  critical: { label: 'Urgente', cls: 'bad' },
  warning: { label: 'Atención', cls: 'warn' },
  opportunity: { label: 'Oportunidad', cls: 'good' },
  info: { label: 'Info', cls: 'info' }
}

export default function Recommendations() {
  const { me } = useStore()
  const { data: report, error, reload } = useReport()
  const [filter, setFilter] = useState<'all' | Severity>('all')
  const recs = useMemo(() => (report ? buildRecommendations(report, me!.mode, me!.targets) : []), [report, me])

  if (error) return <ErrorState error={error} onRetry={reload} />
  if (!report) return <LoadingGrid />
  const count = (s: Severity) => recs.filter((r) => r.severity === s).length
  const list = filter === 'all' ? recs : recs.filter((r) => r.severity === filter)
  const noTarget = me!.mode === 'leadgen' ? !me!.targets.cpl : !me!.targets.roas

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Recomendaciones</h1>
          <p className="sub">Análisis automático de {report.account.name} con las reglas que usan los media buyers: presupuesto, fatiga, embudo y estructura.</p>
        </div>
        <span className="spacer" />
        <Link className="btn primary" to="/app/ai">
          <Bot size={16} /> Análisis profundo con IA
        </Link>
      </div>
      {noTarget && (
        <div className="banner info">
          Estamos usando la media de la cuenta como referencia. Define tu {me!.mode === 'leadgen' ? 'CPL' : 'ROAS'} objetivo para recomendaciones más precisas.
          <span className="spacer" />
          <Link className="btn sm" to="/app/settings">
            Definir objetivo
          </Link>
        </div>
      )}
      <Segmented
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: `Todas (${recs.length})` },
          { value: 'critical', label: `Urgentes (${count('critical')})` },
          { value: 'warning', label: `Atención (${count('warning')})` },
          { value: 'opportunity', label: `Oportunidades (${count('opportunity')})` },
          { value: 'info', label: `Info (${count('info')})` }
        ]}
      />
      {!list.length && (
        <Empty icon={<CheckCircle2 size={28} color="var(--good)" />} title="Nada por aquí">
          <p className="muted">No hay recomendaciones de este tipo para el periodo seleccionado.</p>
        </Empty>
      )}
      <div className="col" style={{ gap: 12 }}>
        {list.map((r) => (
          <div key={r.id} className={`card rec ${r.severity}`}>
            <div className="bar" />
            <div className="body">
              <div className="row wrap">
                <span className={`badge ${SEV[r.severity].cls}`}>{SEV[r.severity].label}</span>
                <span className="badge">{r.category}</span>
                {r.entity && r.entity.level !== 'account' && (
                  <span className="faint" style={{ fontSize: 12 }}>
                    {r.entity.level === 'ad' ? 'Anuncio' : r.entity.level === 'adset' ? 'Conjunto' : 'Campaña'} · {r.entity.id}
                  </span>
                )}
              </div>
              <h3 style={{ fontSize: 15 }}>{r.title}</h3>
              <p className="muted">{r.detail}</p>
              <div className="action">→ {r.action}</div>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
