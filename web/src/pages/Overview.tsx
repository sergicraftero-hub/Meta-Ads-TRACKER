import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Eye, MousePointerClick, ShoppingCart, Target, TrendingUp, Users, Wallet } from 'lucide-react'
import { useReport, useStore } from '@/lib/store'
import { ChartCard, Funnel, RankBars, TimeChart } from '@/components/charts'
import { ErrorState, KpiCard, LoadingGrid } from '@/components/ui'
import { dailySeries, groupBy, kpis, pctChange } from '@shared/metrics'
import { int, money, pct, ratio, dec } from '@shared/format'
import { buildRecommendations } from '@shared/recommendations'

export default function Overview() {
  const { me, account } = useStore()
  const { data: report, error, loading, reload } = useReport()
  const mode = me!.mode
  const cur = account?.currency ?? 'EUR'

  const view = useMemo(() => {
    if (!report) return null
    const k = kpis(report.totals)
    const p = kpis(report.previousTotals)
    const series = dailySeries(report.rows, report.range.since, report.range.until).map(({ date, m }) => {
      const d = kpis(m)
      return { date, spend: m.spend, leads: m.leads, purchases: m.purchases, revenue: m.purchaseValue, cpl: d.cpl, roas: d.roas, ctr: d.ctr, cpm: d.cpm }
    })
    const campaigns = [...groupBy(report.rows, 'campaign').values()].sort((a, b) => b.metrics.spend - a.metrics.spend)
    const ads = [...groupBy(report.rows, 'ad').values()]
    const topAds = ads
      .filter((a) => (mode === 'leadgen' ? a.metrics.leads : a.metrics.purchases) > 0)
      .sort((a, b) => (mode === 'leadgen' ? kpis(a.metrics).cpl - kpis(b.metrics).cpl : kpis(b.metrics).roas - kpis(a.metrics).roas))
      .slice(0, 5)
    const recs = buildRecommendations(report, mode, me!.targets).slice(0, 4)
    return { k, p, series, campaigns, topAds, recs }
  }, [report, mode, me])

  if (error) return <ErrorState error={error} onRetry={reload} action={<Link className="btn" to="/app/settings">Ajustes de conexión</Link>} />
  if (!view || !report) return <LoadingGrid />
  const { k, p, series, campaigns, topAds, recs } = view
  const t = report.totals
  const m = (v: number) => money(v, cur)

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{report.account.name}</h1>
          <p className="sub">
            {mode === 'leadgen' ? 'Captación de leads' : 'E-commerce'} · {report.range.since} → {report.range.until}
            {loading && ' · actualizando…'}
          </p>
        </div>
      </div>

      <div className="grid g4">
        <KpiCard label="Inversión" icon={<Wallet size={14} />} value={m(k.spend)} delta={pctChange(k.spend, p.spend)} goodWhenUp />
        {mode === 'leadgen' ? (
          <>
            <KpiCard label="Leads" icon={<Users size={14} />} value={int(k.leads)} delta={pctChange(k.leads, p.leads)} />
            <KpiCard label="Coste por lead" icon={<Target size={14} />} value={k.cpl ? m(k.cpl) : '—'} delta={pctChange(k.cpl, p.cpl)} goodWhenUp={false} hint={me!.targets.cpl ? `Objetivo: ${m(me!.targets.cpl)}` : undefined} />
            <KpiCard label="Tasa de conversión" icon={<TrendingUp size={14} />} value={pct(k.leadRate, 1)} delta={pctChange(k.leadRate, p.leadRate)} hint="Leads / clics en el enlace" />
          </>
        ) : (
          <>
            <KpiCard label="Ingresos" icon={<ShoppingCart size={14} />} value={m(k.revenue)} delta={pctChange(k.revenue, p.revenue)} />
            <KpiCard label="ROAS" icon={<TrendingUp size={14} />} value={k.roas ? ratio(k.roas) : '—'} delta={pctChange(k.roas, p.roas)} hint={me!.targets.roas ? `Objetivo: ${ratio(me!.targets.roas)}` : undefined} />
            <KpiCard label="Coste por compra" icon={<Target size={14} />} value={k.cpa ? m(k.cpa) : '—'} delta={pctChange(k.cpa, p.cpa)} goodWhenUp={false} />
          </>
        )}
      </div>
      <div className="grid g4">
        {mode === 'ecommerce' ? (
          <>
            <KpiCard label="Compras" value={int(k.purchases)} delta={pctChange(k.purchases, p.purchases)} />
            <KpiCard label="Ticket medio" value={k.aov ? m(k.aov) : '—'} delta={pctChange(k.aov, p.aov)} />
          </>
        ) : (
          <>
            <KpiCard label="Alcance" icon={<Eye size={14} />} value={int(t.reach, true)} delta={pctChange(t.reach, report.previousTotals.reach)} />
            <KpiCard label="Frecuencia" value={dec(t.frequency)} delta={pctChange(t.frequency, report.previousTotals.frequency)} goodWhenUp={false} />
          </>
        )}
        <KpiCard label="CTR (enlace)" icon={<MousePointerClick size={14} />} value={pct(k.ctr)} delta={pctChange(k.ctr, p.ctr)} />
        <KpiCard label="CPM" value={m(k.cpm)} delta={pctChange(k.cpm, p.cpm)} goodWhenUp={false} />
      </div>

      <div className="grid g2">
        <ChartCard title="Inversión diaria">
          <TimeChart data={series} kind="area" yFormat={(v) => money(v, cur, true)} series={[{ key: 'spend', label: 'Gasto', format: m }]} />
        </ChartCard>
        {mode === 'leadgen' ? (
          <ChartCard title="Leads por día">
            <TimeChart data={series} kind="bar" yFormat={(v) => int(v)} series={[{ key: 'leads', label: 'Leads', color: 'series-3', format: (v) => int(v) }]} />
          </ChartCard>
        ) : (
          <ChartCard title="Ingresos por día">
            <TimeChart data={series} kind="bar" yFormat={(v) => money(v, cur, true)} series={[{ key: 'revenue', label: 'Ingresos', color: 'series-3', format: m }]} />
          </ChartCard>
        )}
        {mode === 'leadgen' ? (
          <ChartCard title="Coste por lead">
            <TimeChart data={series} kind="line" yFormat={(v) => money(v, cur, true)} series={[{ key: 'cpl', label: 'CPL', color: 'series-2', format: m }]} />
          </ChartCard>
        ) : (
          <ChartCard title="ROAS diario">
            <TimeChart data={series} kind="line" yFormat={(v) => ratio(v)} series={[{ key: 'roas', label: 'ROAS', color: 'series-2', format: ratio }]} />
          </ChartCard>
        )}
        <ChartCard title="Embudo">
          <Funnel
            format={(v) => int(v, true)}
            steps={
              mode === 'leadgen'
                ? [
                    { label: 'Clics en enlace', value: t.linkClicks },
                    { label: 'Visitas a la web', value: t.landingPageViews },
                    { label: 'Leads', value: t.leads }
                  ]
                : [
                    { label: 'Clics en enlace', value: t.linkClicks },
                    { label: 'Visitas a la web', value: t.landingPageViews },
                    { label: 'Añadir al carrito', value: t.addToCart },
                    { label: 'Pago iniciado', value: t.initiateCheckout },
                    { label: 'Compras', value: t.purchases }
                  ]
            }
          />
        </ChartCard>
      </div>

      <div className="grid g2">
        <div className="card">
          <div className="card-head">
            <h2>Gasto por campaña</h2>
            <span className="spacer" />
            <Link to="/app/campaigns" className="btn ghost sm">
              Ver todas <ArrowRight size={14} />
            </Link>
          </div>
          <div className="card-body">
            <RankBars
              format={m}
              items={campaigns.slice(0, 6).map((c) => ({
                label: c.name,
                value: c.metrics.spend,
                sub: mode === 'leadgen' ? `${int(c.metrics.leads)} leads · CPL ${kpis(c.metrics).cpl ? m(kpis(c.metrics).cpl) : '—'}` : `ROAS ${ratio(kpis(c.metrics).roas)}`
              }))}
            />
          </div>
        </div>
        <div className="card">
          <div className="card-head">
            <h2>Qué hacer ahora</h2>
            <span className="spacer" />
            <Link to="/app/recommendations" className="btn ghost sm">
              Todas <ArrowRight size={14} />
            </Link>
          </div>
          <div className="card-body col" style={{ gap: 12 }}>
            {recs.map((r) => (
              <div key={r.id} className="row" style={{ alignItems: 'flex-start', gap: 10 }}>
                <i className="dot" style={{ marginTop: 7, background: r.severity === 'critical' ? 'var(--bad)' : r.severity === 'warning' ? 'var(--warn)' : r.severity === 'opportunity' ? 'var(--good)' : 'var(--info)' }} />
                <div className="col" style={{ gap: 2 }}>
                  <b>{r.title}</b>
                  <span className="muted" style={{ fontSize: 13 }}>
                    {r.action}
                  </span>
                </div>
              </div>
            ))}
            {!recs.length && <p className="muted">Todo en orden: no hay alertas para este periodo.</p>}
          </div>
        </div>
      </div>

      {topAds.length > 0 && (
        <div className="card">
          <div className="card-head">
            <h2>Mejores anuncios {mode === 'leadgen' ? 'por CPL' : 'por ROAS'}</h2>
            <span className="spacer" />
            <Link to="/app/creatives" className="btn ghost sm">
              Ver creatividades <ArrowRight size={14} />
            </Link>
          </div>
          <div className="card-body grid g4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))' }}>
            {topAds.map((a) => {
              const info = report.ads.find((x) => x.id === a.id)
              const ak = kpis(a.metrics)
              return (
                <div key={a.id} className="col" style={{ gap: 6 }}>
                  <div style={{ aspectRatio: '1', borderRadius: 8, overflow: 'hidden', background: 'var(--surface-2)' }}>
                    {info?.creative.thumbnailUrl && <img src={info.creative.thumbnailUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} loading="lazy" />}
                  </div>
                  <b style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</b>
                  <span className="muted num" style={{ fontSize: 12.5 }}>
                    {mode === 'leadgen' ? `${int(a.metrics.leads)} leads · ${m(ak.cpl)}` : `${ratio(ak.roas)} · ${m(a.metrics.purchaseValue)}`}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </>
  )
}
