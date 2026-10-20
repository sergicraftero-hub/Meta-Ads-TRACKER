import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Download, Search } from 'lucide-react'
import { useApi, useStore } from '@/lib/store'
import { api, qs } from '@/lib/api'
import { COLUMNS } from '@/lib/columns'
import { Delta, ErrorState, LoadingGrid, KpiCard, downloadCsv } from '@/components/ui'
import { kpis, pctChange, sumMetrics } from '@shared/metrics'
import { money, int, ratio } from '@shared/format'
import type { AccountOverviewRow } from '@shared/types'

export default function Accounts() {
  const { me, range, setAccountId, refreshNonce } = useStore()
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: 'spend', dir: -1 })
  const mode = me!.mode
  const cols = COLUMNS[mode]
  const { data, error, reload } = useApi<AccountOverviewRow[]>(`${me!.demo}|${range.since}|${range.until}|${refreshNonce}`, () =>
    api.get('/meta/overview' + qs({ since: range.since, until: range.until, force: refreshNonce > 0 ? 1 : undefined }))
  )

  const rows = useMemo(() => {
    if (!data) return []
    const col = cols.find((c) => c.key === sort.key) ?? cols[0]
    return data
      .filter((r) => r.account.name.toLowerCase().includes(q.toLowerCase()) || r.account.accountId.includes(q))
      .sort((a, b) => (col.value(a.totals) - col.value(b.totals)) * sort.dir)
  }, [data, q, sort, cols])

  if (error) return <ErrorState error={error} onRetry={reload} />
  if (!data) return <LoadingGrid />

  // Currency-mixed portfolios can't be summed meaningfully; only total when all accounts share one.
  const currencies = new Set(data.filter((r) => r.totals.spend > 0).map((r) => r.account.currency))
  const singleCur = currencies.size <= 1 ? ([...currencies][0] ?? 'EUR') : null
  const total = sumMetrics(data.map((r) => r.totals))
  const prevTotal = sumMetrics(data.map((r) => r.previousTotals))
  const tk = kpis(total)
  const pk = kpis(prevTotal)
  const active = data.filter((r) => r.totals.spend > 0).length

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Todas las cuentas</h1>
          <p className="sub">
            {data.length} cuentas publicitarias · {active} con inversión en el periodo
          </p>
        </div>
        <span className="spacer" />
        <button
          className="btn"
          onClick={() =>
            downloadCsv(
              `adpilot_cuentas_${range.since}_${range.until}.csv`,
              ['Cuenta', 'ID', 'Moneda', ...cols.map((c) => c.label)],
              rows.map((r) => [r.account.name, r.account.accountId, r.account.currency, ...cols.map((c) => c.value(r.totals))])
            )
          }
        >
          <Download size={15} /> Exportar CSV
        </button>
      </div>
      {singleCur && (
        <div className="grid g4">
          <KpiCard label="Inversión total" value={money(tk.spend, singleCur)} delta={pctChange(tk.spend, pk.spend)} />
          {mode === 'leadgen' ? (
            <>
              <KpiCard label="Leads totales" value={int(tk.leads)} delta={pctChange(tk.leads, pk.leads)} />
              <KpiCard label="CPL medio" value={tk.cpl ? money(tk.cpl, singleCur) : '—'} delta={pctChange(tk.cpl, pk.cpl)} goodWhenUp={false} />
            </>
          ) : (
            <>
              <KpiCard label="Ingresos totales" value={money(tk.revenue, singleCur)} delta={pctChange(tk.revenue, pk.revenue)} />
              <KpiCard label="ROAS medio" value={tk.roas ? ratio(tk.roas) : '—'} delta={pctChange(tk.roas, pk.roas)} />
            </>
          )}
          <KpiCard label="Cuentas activas" value={`${active} / ${data.length}`} />
        </div>
      )}
      <div className="card">
        <div className="card-head">
          <div className="row" style={{ maxWidth: 320, flex: 1 }}>
            <Search size={15} className="faint" />
            <input className="input" placeholder="Buscar cuenta…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Cuenta</th>
                {cols.map((c) => (
                  <th key={c.key} onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key ? ((-s.dir) as 1 | -1) : -1 }))}>
                    {c.label}
                    {sort.key === c.key ? (sort.dir === -1 ? ' ↓' : ' ↑') : ''}
                  </th>
                ))}
                <th>{mode === 'leadgen' ? 'Δ CPL' : 'Δ ROAS'}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const k = kpis(r.totals)
                const p = kpis(r.previousTotals)
                return (
                  <tr
                    key={r.account.id}
                    style={{ cursor: 'pointer' }}
                    onClick={() => {
                      setAccountId(r.account.id)
                      nav('/app')
                    }}
                  >
                    <td>
                      <div className="name-cell">
                        <i className="dot" style={{ background: r.account.status === 1 ? 'var(--good)' : 'var(--text-3)' }} />
                        <span className="col" style={{ gap: 0, minWidth: 0 }}>
                          <span className="name" style={{ fontWeight: 600 }}>
                            {r.account.name}
                          </span>
                          <span className="faint" style={{ fontSize: 12 }}>
                            {r.error ? <span style={{ color: 'var(--bad)' }}>{r.error}</span> : `${r.account.accountId} · ${r.account.currency}`}
                          </span>
                        </span>
                      </div>
                    </td>
                    {cols.map((c) => (
                      <td key={c.key}>{c.format(c.value(r.totals), r.account.currency)}</td>
                    ))}
                    <td>{mode === 'leadgen' ? <Delta value={pctChange(k.cpl, p.cpl)} goodWhenUp={false} /> : <Delta value={pctChange(k.roas, p.roas)} />}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
