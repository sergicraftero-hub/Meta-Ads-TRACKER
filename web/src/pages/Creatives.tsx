import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { useReport, useStore } from '@/lib/store'
import { ErrorState, LoadingGrid, Segmented, statusBadge, Empty } from '@/components/ui'
import { ChartCard, TimeChart } from '@/components/charts'
import { eachDay, emptyMetrics, groupBy, kpis, type EntityStats } from '@shared/metrics'
import { buildRecommendations } from '@shared/recommendations'
import { dec, int, money, pct, ratio } from '@shared/format'
import type { AdInfo } from '@shared/types'

type SortKey = 'spend' | 'results' | 'efficiency' | 'ctr'

export default function Creatives() {
  const { me, account } = useStore()
  const { data: report, error, reload } = useReport()
  const [sort, setSort] = useState<SortKey>('spend')
  const [selected, setSelected] = useState<string | null>(null)
  const mode = me!.mode
  const cur = account?.currency ?? 'EUR'
  const m = (v: number) => money(v, cur)

  const data = useMemo(() => {
    if (!report) return null
    const recs = buildRecommendations(report, mode, me!.targets)
    const tags = new Map<string, { label: string; cls: string }[]>()
    for (const r of recs) {
      if (r.entity?.level !== 'ad') continue
      const t = r.id.startsWith('win-')
        ? { label: 'Ganador', cls: 'good' }
        : r.id.startsWith('ad-fatigue')
          ? { label: 'Fatiga', cls: 'warn' }
          : r.id.startsWith('ad-no')
            ? { label: 'Sin resultados', cls: 'bad' }
            : r.id.startsWith('ad-lowctr')
              ? { label: 'CTR bajo', cls: 'warn' }
              : r.id.startsWith('ad-high') || r.id.startsWith('ad-lowroas')
                ? { label: 'Caro', cls: 'bad' }
                : null
      if (t) tags.set(r.entity.id, [...(tags.get(r.entity.id) ?? []), t])
    }
    return { ads: [...groupBy(report.rows, 'ad').values()], tags }
  }, [report, mode, me])

  if (error) return <ErrorState error={error} onRetry={reload} />
  if (!data || !report) return <LoadingGrid />

  const res = (e: EntityStats) => (mode === 'leadgen' ? e.metrics.leads : e.metrics.purchases)
  const eff = (e: EntityStats) => {
    const k = kpis(e.metrics)
    return mode === 'leadgen' ? (k.cpl ? -k.cpl : -Infinity) : k.roas
  }
  const value: Record<SortKey, (e: EntityStats) => number> = { spend: (e) => e.metrics.spend, results: res, efficiency: eff, ctr: (e) => kpis(e.metrics).ctr }
  const ads = [...data.ads].sort((a, b) => value[sort](b) - value[sort](a))
  const info = (id: string): AdInfo | undefined => report.ads.find((a) => a.id === id)
  const sel = selected ? data.ads.find((a) => a.id === selected) : null

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Creatividades</h1>
          <p className="sub">Rendimiento de cada anuncio con etiquetas automáticas de ganador, fatiga y bajo rendimiento.</p>
        </div>
        <span className="spacer" />
        <Segmented
          value={sort}
          onChange={setSort}
          options={[
            { value: 'spend', label: 'Gasto' },
            { value: 'results', label: mode === 'leadgen' ? 'Leads' : 'Compras' },
            { value: 'efficiency', label: mode === 'leadgen' ? 'Mejor CPL' : 'Mejor ROAS' },
            { value: 'ctr', label: 'CTR' }
          ]}
        />
      </div>
      {!ads.length && <Empty title="No hay anuncios con datos en este periodo" />}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))' }}>
        {ads.map((a) => {
          const k = kpis(a.metrics)
          const ad = info(a.id)
          const freq = report.adReach[a.id]?.frequency
          return (
            <button key={a.id} className="card creative" onClick={() => setSelected(a.id)} style={{ padding: 0, textAlign: 'left', cursor: 'pointer', color: 'inherit', font: 'inherit' }}>
              <div className="thumb">
                {ad?.creative.thumbnailUrl || ad?.creative.imageUrl ? <img src={ad.creative.imageUrl || ad.creative.thumbnailUrl} alt="" loading="lazy" /> : null}
                <div className="tags">
                  {(data.tags.get(a.id) ?? []).map((t) => (
                    <span key={t.label} className={`badge ${t.cls}`} style={{ boxShadow: 'var(--shadow)' }}>
                      {t.label}
                    </span>
                  ))}
                </div>
              </div>
              <div className="meta">
                <div className="row">
                  <b style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={a.name}>
                    {a.name}
                  </b>
                  <span className="spacer" />
                  {statusBadge(ad?.effectiveStatus)}
                </div>
                <div className="mini-stats">
                  <div>
                    <span>Gasto</span>
                    <b>{m(a.metrics.spend)}</b>
                  </div>
                  <div>
                    <span>{mode === 'leadgen' ? 'Leads' : 'Compras'}</span>
                    <b>{int(res(a))}</b>
                  </div>
                  <div>
                    <span>{mode === 'leadgen' ? 'CPL' : 'ROAS'}</span>
                    <b>{mode === 'leadgen' ? (k.cpl ? m(k.cpl) : '—') : k.roas ? ratio(k.roas) : '—'}</b>
                  </div>
                  <div>
                    <span>CTR</span>
                    <b>{pct(k.ctr)}</b>
                  </div>
                  <div>
                    <span>CPM</span>
                    <b>{m(k.cpm)}</b>
                  </div>
                  <div>
                    <span>Frecuencia</span>
                    <b>{freq ? dec(freq, 1) : '—'}</b>
                  </div>
                </div>
              </div>
            </button>
          )
        })}
      </div>

      {sel && (
        <div onClick={() => setSelected(null)} style={{ position: 'fixed', inset: 0, background: '#000a', zIndex: 60, display: 'grid', placeItems: 'center', padding: 16 }}>
          <div className="card" onClick={(e) => e.stopPropagation()} style={{ width: 'min(900px, 100%)', maxHeight: '90vh', overflowY: 'auto' }}>
            <div className="card-head">
              <h2 style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{sel.name}</h2>
              <span className="spacer" />
              <button className="btn icon ghost" onClick={() => setSelected(null)} aria-label="Cerrar">
                <X size={18} />
              </button>
            </div>
            <div className="card-body split" style={{ gridTemplateColumns: 'minmax(0, 260px) minmax(0, 1fr)' }}>
              <div className="col">
                {(info(sel.id)?.creative.imageUrl || info(sel.id)?.creative.thumbnailUrl) && (
                  <img src={info(sel.id)?.creative.imageUrl || info(sel.id)?.creative.thumbnailUrl} alt="" style={{ width: '100%', borderRadius: 8 }} />
                )}
                {info(sel.id)?.creative.title && <b>{info(sel.id)?.creative.title}</b>}
                {info(sel.id)?.creative.body && (
                  <p className="muted" style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>
                    {info(sel.id)?.creative.body}
                  </p>
                )}
              </div>
              <AdDaily ad={sel} since={report.range.since} until={report.range.until} cur={cur} mode={mode} />
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function AdDaily({ ad, since, until, cur, mode }: { ad: EntityStats; since: string; until: string; cur: string; mode: 'leadgen' | 'ecommerce' }) {
  const series = eachDay(since, until).map((date) => {
    const d = ad.daily.get(date) ?? emptyMetrics()
    const k = kpis(d)
    return { date, ctr: k.ctr, results: mode === 'leadgen' ? d.leads : d.purchases, spend: d.spend }
  })
  return (
    <div className="col" style={{ gap: 14 }}>
      <ChartCard title="CTR diario">
        <TimeChart data={series} kind="line" height={170} yFormat={(v) => pct(v, 1)} series={[{ key: 'ctr', label: 'CTR', color: 'series-2', format: (v) => pct(v) }]} />
      </ChartCard>
      <ChartCard title={mode === 'leadgen' ? 'Leads diarios' : 'Compras diarias'}>
        <TimeChart data={series} kind="bar" height={170} yFormat={(v) => int(v)} series={[{ key: 'results', label: mode === 'leadgen' ? 'Leads' : 'Compras', color: 'series-3', format: (v) => int(v) }]} />
      </ChartCard>
      <p className="faint" style={{ fontSize: 12 }}>
        Gasto total {money(ad.metrics.spend, cur)}
      </p>
    </div>
  )
}
