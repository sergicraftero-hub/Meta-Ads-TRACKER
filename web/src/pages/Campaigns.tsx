import { Fragment, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Download, Search } from 'lucide-react'
import { useReport, useStore } from '@/lib/store'
import { COLUMNS } from '@/lib/columns'
import { ErrorState, LoadingGrid, Segmented, downloadCsv, statusBadge } from '@/components/ui'
import { groupBy, sumMetrics, type EntityStats } from '@shared/metrics'
import type { AccountReport, Metrics } from '@shared/types'

type Filter = 'all' | 'active' | 'paused'

export default function Campaigns() {
  const { me, account } = useStore()
  const { data: report, error, reload } = useReport()
  const cols = COLUMNS[me!.mode]
  const cur = account?.currency ?? 'EUR'
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: 'spend', dir: -1 })
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

  const tree = useMemo(() => {
    if (!report) return null
    return {
      campaigns: [...groupBy(report.rows, 'campaign').values()],
      adsets: [...groupBy(report.rows, 'adset').values()],
      ads: [...groupBy(report.rows, 'ad').values()]
    }
  }, [report])

  if (error) return <ErrorState error={error} onRetry={reload} />
  if (!tree || !report) return <LoadingGrid />

  const status = (level: 'campaign' | 'adset' | 'ad', id: string) =>
    (level === 'campaign' ? report.campaigns : level === 'adset' ? report.adsets : report.ads).find((x) => x.id === id)?.effectiveStatus
  const pass = (level: 'campaign' | 'adset' | 'ad', id: string) => {
    const s = status(level, id)
    return filter === 'all' || (filter === 'active' ? s === 'ACTIVE' : s !== 'ACTIVE')
  }
  const col = cols.find((c) => c.key === sort.key) ?? cols[0]
  const sorted = (list: EntityStats[]) => [...list].sort((a, b) => (col.value(a.metrics) - col.value(b.metrics)) * sort.dir)
  const needle = q.trim().toLowerCase()
  const matches = (e: EntityStats) => !needle || e.name.toLowerCase().includes(needle)

  // A campaign is shown if it or any child matches the search.
  const visibleCampaigns = sorted(tree.campaigns).filter(
    (c) =>
      pass('campaign', c.id) &&
      (matches(c) || tree.adsets.some((s) => s.parentId === c.id && (matches(s) || tree.ads.some((a) => a.parentId === s.id && matches(a)))))
  )
  const total = sumMetrics(visibleCampaigns.map((c) => c.metrics))
  const toggle = (id: string) => setOpen((s) => (s.has(id) ? (s.delete(id), new Set(s)) : new Set(s).add(id)))

  const Row = ({ e, level, depth }: { e: EntityStats; level: 'campaign' | 'adset' | 'ad'; depth: number }) => (
    <tr className={depth === 1 ? 'child' : depth === 2 ? 'grandchild' : ''}>
      <td>
        <div className="name-cell">
          {level !== 'ad' ? (
            <button className="expander" onClick={() => toggle(e.id)} aria-label="Expandir">
              {open.has(e.id) ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </button>
          ) : (
            <span style={{ width: 16 }} />
          )}
          <span className="name" title={e.name} style={{ fontWeight: level === 'campaign' ? 600 : 500 }}>
            {e.name}
          </span>
          {statusBadge(status(level, e.id))}
        </div>
      </td>
      {cols.map((c) => (
        <td key={c.key}>{c.format(c.value(e.metrics), cur)}</td>
      ))}
    </tr>
  )

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Campañas</h1>
          <p className="sub">Campañas, conjuntos y anuncios con todas sus métricas. Haz clic en una columna para ordenar.</p>
        </div>
        <span className="spacer" />
        <button className="btn" onClick={() => exportCsv(report, tree, cols, cur)}>
          <Download size={15} /> Exportar CSV
        </button>
      </div>
      <div className="card">
        <div className="card-head" style={{ flexWrap: 'wrap' }}>
          <div className="row" style={{ maxWidth: 320, flex: 1 }}>
            <Search size={15} className="faint" />
            <input className="input" placeholder="Buscar campaña, conjunto o anuncio…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Segmented
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: 'Todas' },
              { value: 'active', label: 'Activas' },
              { value: 'paused', label: 'No activas' }
            ]}
          />
          <span className="spacer" />
          <button className="btn ghost sm" onClick={() => setOpen(new Set([...tree.campaigns.map((c) => c.id), ...tree.adsets.map((s) => s.id)]))}>
            Expandir todo
          </button>
          <button className="btn ghost sm" onClick={() => setOpen(new Set())}>
            Contraer
          </button>
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th onClick={() => setSort({ key: 'spend', dir: -1 })}>Nombre</th>
                {cols.map((c) => (
                  <th key={c.key} onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key ? ((-s.dir) as 1 | -1) : -1 }))}>
                    {c.label}
                    {sort.key === c.key ? (sort.dir === -1 ? ' ↓' : ' ↑') : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleCampaigns.map((c) => (
                <Fragment key={c.id}>
                  <Row e={c} level="campaign" depth={0} />
                  {open.has(c.id) &&
                    sorted(tree.adsets.filter((s) => s.parentId === c.id && pass('adset', s.id))).map((s) => (
                      <Fragment key={s.id}>
                        <Row e={s} level="adset" depth={1} />
                        {open.has(s.id) &&
                          sorted(tree.ads.filter((a) => a.parentId === s.id && pass('ad', a.id) && (matches(a) || matches(s) || matches(c)))).map((a) => (
                            <Row key={a.id} e={a} level="ad" depth={2} />
                          ))}
                      </Fragment>
                    ))}
                </Fragment>
              ))}
              {!visibleCampaigns.length && (
                <tr>
                  <td colSpan={cols.length + 1} style={{ textAlign: 'center', padding: 32 }} className="muted">
                    No hay campañas con datos en este periodo.
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td>Total ({visibleCampaigns.length} campañas)</td>
                {cols.map((c) => (
                  <td key={c.key}>{c.format(c.value(total), cur)}</td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </>
  )
}

function exportCsv(report: AccountReport, tree: { campaigns: EntityStats[]; adsets: EntityStats[]; ads: EntityStats[] }, cols: (typeof COLUMNS)['leadgen'], cur: string) {
  const adset = new Map(tree.adsets.map((s) => [s.id, s]))
  const camp = new Map(tree.campaigns.map((c) => [c.id, c]))
  const rows = tree.ads.map((a) => {
    const s = adset.get(a.parentId ?? '')
    const c = camp.get(s?.parentId ?? '')
    const m: Metrics = a.metrics
    return [c?.name ?? '', s?.name ?? '', a.name, a.id, ...cols.map((col) => col.value(m))]
  })
  downloadCsv(`adpilot_${report.account.accountId}_${report.range.since}_${report.range.until}.csv`, ['Campaña', 'Conjunto', 'Anuncio', 'ID anuncio', ...cols.map((c) => `${c.label}${['spend', 'cpc', 'cpm', 'cpl', 'cpa', 'revenue', 'aov'].includes(c.key) ? ` (${cur})` : ''}`)], rows)
}
