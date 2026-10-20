import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Info } from 'lucide-react'
import { useApi, useStore } from '@/lib/store'
import { api, qs } from '@/lib/api'
import { useSites } from './Tracking'
import { ChartCard, TimeChart } from '@/components/charts'
import { Empty, ErrorState, KpiCard, LoadingGrid, Segmented } from '@/components/ui'
import { int, money, pct, ratio } from '@shared/format'
import type { AttributionModel, AttributionReport, Level } from '@shared/types'

export default function Attribution() {
  const { me, accountId, account, range } = useStore()
  const sites = useSites()
  const [siteId, setSiteId] = useState<string | null>(null)
  const [level, setLevel] = useState<Level>('campaign')
  const [model, setModel] = useState<AttributionModel>('last_click')
  const site = sites.data?.find((s) => s.id === siteId) ?? sites.data?.[0]
  const mode = me!.mode
  const cur = account?.currency ?? 'EUR'
  const m = (v: number) => money(v, cur)

  const key = site && accountId ? `${site.id}|${accountId}|${range.since}|${range.until}|${level}|${model}|${mode}|${me!.demo}` : null
  const rep = useApi<AttributionReport>(key, () =>
    api.get('/tracking/attribution' + qs({ siteId: site!.id, accountId, since: range.since, until: range.until, level, model }))
  )

  if (sites.data && !sites.data.length) {
    return (
      <Empty title="Configura el tracking para ver la atribución real">
        <p className="muted" style={{ maxWidth: 520 }}>
          Compara lo que dice Meta con las conversiones que registramos en tu web con tracking de primera parte. Necesitas instalar el script en tu web.
        </p>
        <Link className="btn primary" to="/app/tracking">
          Configurar tracking
        </Link>
      </Empty>
    )
  }
  if (rep.error) return <ErrorState error={rep.error} onRetry={rep.reload} />
  if (!rep.data) return <LoadingGrid />
  const r = rep.data
  const spend = r.rows.reduce((s, x) => s + x.spend, 0)
  const metaConv = r.rows.reduce((s, x) => s + x.metaConversions, 0)
  const metaValue = r.rows.reduce((s, x) => s + x.metaValue, 0)
  const attributed = r.totals.trackedConversions - r.totals.unattributedConversions
  const attributedValue = r.totals.trackedValue - r.totals.unattributedValue
  const convLabel = mode === 'leadgen' ? 'Leads' : 'Compras'

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Atribución real</h1>
          <p className="sub">Lo que reporta Meta frente a lo que registra tu web. Ventana de 28 días desde el clic.</p>
        </div>
        <span className="spacer" />
        {sites.data && sites.data.length > 1 && (
          <select className="input" style={{ width: 200 }} value={site?.id} onChange={(e) => setSiteId(e.target.value)}>
            {sites.data.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
        <Segmented
          value={model}
          onChange={setModel}
          options={[
            { value: 'last_click', label: 'Último clic' },
            { value: 'first_click', label: 'Primer clic' }
          ]}
        />
      </div>

      <div className="grid g4">
        <KpiCard label={`${convLabel} según Meta`} value={int(metaConv)} hint="Atribución del píxel y la API de Meta (incluye vistas y modelado)" />
        <KpiCard label={`${convLabel} registradas (Meta Ads)`} value={int(attributed)} hint="Conversiones en tu web con un clic previo en un anuncio de Meta" />
        {mode === 'ecommerce' ? (
          <>
            <KpiCard label="ROAS según Meta" value={spend ? ratio(metaValue / spend) : '—'} />
            <KpiCard label="ROAS real (tracking)" value={spend ? ratio(attributedValue / spend) : '—'} />
          </>
        ) : (
          <>
            <KpiCard label="CPL según Meta" value={metaConv ? m(spend / metaConv) : '—'} />
            <KpiCard label="CPL real (tracking)" value={attributed ? m(spend / attributed) : '—'} />
          </>
        )}
      </div>

      <div className="grid g2">
        <ChartCard title={mode === 'ecommerce' ? 'Ingresos registrados por día' : 'Leads registrados por día'}>
          <TimeChart
            data={r.daily}
            kind="bar"
            yFormat={(v) => (mode === 'ecommerce' ? money(v, cur, true) : int(v))}
            series={[mode === 'ecommerce' ? { key: 'trackedValue', label: 'Ingresos', color: 'series-3', format: m } : { key: 'trackedConversions', label: 'Leads', color: 'series-3', format: (v) => int(v) }]}
          />
        </ChartCard>
        <div className="card card-pad col" style={{ gap: 12 }}>
          <h2>Salud del tracking</h2>
          <div className="grid g2">
            <KpiCard label="Eventos registrados" value={int(r.totals.events)} />
            <KpiCard label="Visitantes únicos" value={int(r.totals.visitors)} />
            <KpiCard label="Enviados a la CAPI" value={int(r.totals.capiSent)} />
            <KpiCard label={`${convLabel} sin clic en Meta`} value={int(r.totals.unattributedConversions)} hint="Tráfico orgánico, directo u otras fuentes" />
          </div>
          {r.totals.capiFailed > 0 && <div className="banner bad">{r.totals.capiFailed} eventos fueron rechazados por Meta. Revisa el token en «Píxel y CAPI».</div>}
          <p className="faint row" style={{ fontSize: 12, alignItems: 'flex-start' }}>
            <Info size={14} style={{ flex: 'none', marginTop: 2 }} /> Meta cuenta conversiones por visualización y modeladas; tu web solo ve clics reales. Las diferencias grandes indican sobreatribución o eventos perdidos.
          </p>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Comparativa por {level === 'campaign' ? 'campaña' : level === 'adset' ? 'conjunto' : 'anuncio'}</h2>
          <span className="spacer" />
          <Segmented
            value={level}
            onChange={setLevel}
            options={[
              { value: 'campaign', label: 'Campañas' },
              { value: 'adset', label: 'Conjuntos' },
              { value: 'ad', label: 'Anuncios' }
            ]}
          />
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Gasto</th>
                <th>{convLabel} Meta</th>
                <th>{convLabel} reales</th>
                <th>Diferencia</th>
                {mode === 'ecommerce' ? (
                  <>
                    <th>ROAS Meta</th>
                    <th>ROAS real</th>
                  </>
                ) : (
                  <>
                    <th>CPL Meta</th>
                    <th>CPL real</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {r.rows.map((x) => {
                const diff = x.metaConversions ? ((x.trackedConversions - x.metaConversions) / x.metaConversions) * 100 : null
                return (
                  <tr key={x.key}>
                    <td>
                      <span className="name-cell">
                        <span className="name" title={x.name}>
                          {x.name}
                        </span>
                      </span>
                    </td>
                    <td>{m(x.spend)}</td>
                    <td>{int(x.metaConversions)}</td>
                    <td>
                      <b>{int(x.trackedConversions)}</b>
                    </td>
                    <td>{diff === null ? '—' : <span style={{ color: diff < -20 ? 'var(--bad)' : diff > 20 ? 'var(--good)' : 'var(--text-2)' }}>{(diff > 0 ? '+' : '') + pct(diff, 0)}</span>}</td>
                    {mode === 'ecommerce' ? (
                      <>
                        <td>{x.spend ? ratio(x.metaValue / x.spend) : '—'}</td>
                        <td>
                          <b>{x.spend ? ratio(x.trackedValue / x.spend) : '—'}</b>
                        </td>
                      </>
                    ) : (
                      <>
                        <td>{x.metaConversions ? m(x.spend / x.metaConversions) : '—'}</td>
                        <td>
                          <b>{x.trackedConversions ? m(x.spend / x.trackedConversions) : '—'}</b>
                        </td>
                      </>
                    )}
                  </tr>
                )
              })}
              {!r.rows.length && (
                <tr>
                  <td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 32 }}>
                    Sin datos para este periodo.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
