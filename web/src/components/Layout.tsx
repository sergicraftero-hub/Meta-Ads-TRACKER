import { useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate, Link } from 'react-router-dom'
import {
  BarChart3,
  Bot,
  Building2,
  CalendarDays,
  ChevronDown,
  CreditCard,
  Crosshair,
  Image,
  LayoutDashboard,
  Lightbulb,
  LogOut,
  Menu,
  Moon,
  Radio,
  RefreshCw,
  Search,
  Settings,
  Sun,
  SunMoon
} from 'lucide-react'
import { useStore, useReport } from '@/lib/store'
import { api } from '@/lib/api'
import { PRESET_LABELS, type RangePreset } from '@shared/dates'
import { buildRecommendations } from '@shared/recommendations'
import { Segmented } from './ui'

export function Logo({ size = 30 }: { size?: number }) {
  return (
    <span className="brand-mark" style={{ width: size, height: size }}>
      <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 18l6-12 4 8 2-4 6 8" />
      </svg>
    </span>
  )
}

function useClickOutside(onOut: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOut()
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [onOut])
  return ref
}

function AccountPicker() {
  const { accounts, accountId, setAccountId, account } = useStore()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const ref = useClickOutside(() => setOpen(false))
  const filtered = useMemo(() => accounts.filter((a) => (a.name + a.accountId + (a.business ?? '')).toLowerCase().includes(q.toLowerCase())), [accounts, q])
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="btn" onClick={() => setOpen(!open)} style={{ maxWidth: 280 }} disabled={!accounts.length}>
        <Building2 size={15} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{account?.name ?? 'Sin cuentas'}</span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="card popover" style={{ left: 0, right: 'auto', width: 340 }}>
          <div className="row" style={{ padding: '2px 4px 8px' }}>
            <Search size={14} className="faint" />
            <input className="input" autoFocus placeholder={`Buscar entre ${accounts.length} cuentas…`} value={q} onChange={(e) => setQ(e.target.value)} style={{ height: 30 }} />
          </div>
          <div style={{ maxHeight: 360, overflowY: 'auto' }}>
            {filtered.map((a) => (
              <button
                key={a.id}
                className={`menu-item ${a.id === accountId ? 'on' : ''}`}
                onClick={() => {
                  setAccountId(a.id)
                  setOpen(false)
                }}
              >
                <i className="dot" style={{ background: a.status === 1 ? 'var(--good)' : 'var(--text-3)' }} />
                <span className="col" style={{ gap: 0, minWidth: 0 }}>
                  <span style={{ fontWeight: 550, overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.name}</span>
                  <span className="faint" style={{ fontSize: 12 }}>
                    {a.accountId} · {a.currency}
                    {a.business ? ` · ${a.business}` : ''}
                  </span>
                </span>
              </button>
            ))}
            {!filtered.length && <p className="faint" style={{ padding: 10 }}>Sin resultados</p>}
          </div>
        </div>
      )}
    </div>
  )
}

function DatePicker() {
  const { preset, range, setPreset, setCustomRange } = useStore()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(range)
  const ref = useClickOutside(() => setOpen(false))
  useEffect(() => setDraft(range), [range])
  const label = preset === 'custom' ? `${range.since} → ${range.until}` : PRESET_LABELS[preset]
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="btn" onClick={() => setOpen(!open)}>
        <CalendarDays size={15} />
        {label}
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="card popover">
          {(Object.keys(PRESET_LABELS) as RangePreset[]).map((p) => (
            <button
              key={p}
              className={`menu-item ${preset === p ? 'on' : ''}`}
              onClick={() => {
                setPreset(p)
                setOpen(false)
              }}
            >
              {PRESET_LABELS[p]}
            </button>
          ))}
          <div style={{ borderTop: '1px solid var(--border)', margin: '6px 0', paddingTop: 8 }} className="col">
            <span className="faint" style={{ fontSize: 12, padding: '0 4px' }}>
              Personalizado
            </span>
            <div className="row">
              <input type="date" className="input" value={draft.since} max={draft.until} onChange={(e) => setDraft({ ...draft, since: e.target.value })} />
              <input type="date" className="input" value={draft.until} min={draft.since} onChange={(e) => setDraft({ ...draft, until: e.target.value })} />
            </div>
            <button
              className="btn primary sm"
              disabled={!draft.since || !draft.until || draft.since > draft.until}
              onClick={() => {
                setCustomRange(draft)
                setOpen(false)
              }}
            >
              Aplicar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function ThemeButton() {
  const { theme, setTheme } = useStore()
  const next = theme === 'system' ? 'dark' : theme === 'dark' ? 'light' : 'system'
  const Icon = theme === 'dark' ? Moon : theme === 'light' ? Sun : SunMoon
  return (
    <button className="btn icon ghost" onClick={() => setTheme(next)} title={`Tema: ${theme === 'system' ? 'automático' : theme === 'dark' ? 'oscuro' : 'claro'}`}>
      <Icon size={16} />
    </button>
  )
}

export function AppLayout() {
  const { me, setMe, updateMe, hardRefresh, accountsError } = useStore()
  const report = useReport()
  const [menu, setMenu] = useState(false)
  const loc = useLocation()
  const nav = useNavigate()
  useEffect(() => setMenu(false), [loc.pathname])

  const urgent = useMemo(() => {
    if (!report.data || !me) return 0
    return buildRecommendations(report.data, me.mode, me.targets).filter((r) => r.severity === 'critical').length
  }, [report.data, me])

  if (!me) return null
  const trialDays = me.subscription.trialEndsAt ? Math.max(0, Math.ceil((me.subscription.trialEndsAt - Date.now()) / 86400_000)) : null
  const items = [
    { section: 'Análisis' },
    { to: '/app', label: 'Resumen', icon: LayoutDashboard, end: true },
    { to: '/app/campaigns', label: 'Campañas', icon: BarChart3 },
    { to: '/app/creatives', label: 'Creatividades', icon: Image },
    { to: '/app/recommendations', label: 'Recomendaciones', icon: Lightbulb, count: urgent },
    { to: '/app/ai', label: 'Analista IA', icon: Bot },
    { section: 'Tracking' },
    { to: '/app/attribution', label: 'Atribución', icon: Crosshair },
    { to: '/app/tracking', label: 'Píxel y CAPI', icon: Radio },
    { section: 'Agencia' },
    { to: '/app/accounts', label: 'Todas las cuentas', icon: Building2 },
    { section: 'Cuenta' },
    { to: '/app/settings', label: 'Ajustes', icon: Settings },
    ...(me.subscription.billingEnabled ? [{ to: '/app/billing', label: 'Suscripción', icon: CreditCard }] : [])
  ] as const

  return (
    <div className="shell">
      <aside className={`sidebar ${menu ? 'open' : ''}`}>
        <Link to="/app" className="brand" style={{ textDecoration: 'none' }}>
          <Logo /> AdPilot
        </Link>
        <nav className="nav col" style={{ gap: 2 }}>
          {items.map((it, i) =>
            'section' in it ? (
              <div key={i} className="nav-section">
                {it.section}
              </div>
            ) : (
              <NavLink key={it.to} to={it.to} end={'end' in it} className={({ isActive }) => (isActive ? 'active' : '')}>
                <it.icon size={17} />
                {it.label}
                {'count' in it && it.count > 0 && <span className="count">{it.count}</span>}
              </NavLink>
            )
          )}
        </nav>
        <span className="spacer" />
        <div className="col" style={{ gap: 4, padding: '12px 8px 0', borderTop: '1px solid var(--border)' }}>
          <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>{me.name || me.email}</span>
          <span className="faint" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {me.email}
          </span>
          <button
            className="btn ghost sm"
            style={{ justifyContent: 'flex-start', padding: 0, marginTop: 4 }}
            onClick={async () => {
              await api.post('/auth/logout')
              setMe(null)
              nav('/')
            }}
          >
            <LogOut size={14} /> Cerrar sesión
          </button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button className="btn icon ghost mobile-only" onClick={() => setMenu(!menu)} aria-label="Menú">
            <Menu size={18} />
          </button>
          <AccountPicker />
          <DatePicker />
          <span className="spacer" />
          <Segmented
            value={me.mode}
            onChange={(mode) => updateMe({ mode })}
            options={[
              { value: 'leadgen', label: 'Lead gen' },
              { value: 'ecommerce', label: 'E-commerce' }
            ]}
          />
          <button className="btn icon ghost" title="Actualizar datos desde Meta" onClick={hardRefresh} disabled={report.loading}>
            <RefreshCw size={16} className={report.loading ? 'spin' : ''} />
          </button>
          <ThemeButton />
        </header>
        <div className="content">
          {me.demo && (
            <div className="banner info">
              <span>
                <b>Modo demo:</b> estás viendo datos de ejemplo.
              </span>
              <span className="spacer" />
              <Link className="btn primary sm" to="/app/settings">
                Conectar Meta Ads
              </Link>
            </div>
          )}
          {!me.demo && accountsError?.code === 'meta_reconnect' && (
            <div className="banner bad">
              <span>La conexión con Meta ha caducado o no tiene permisos.</span>
              <span className="spacer" />
              <Link className="btn sm" to="/app/settings">
                Reconectar
              </Link>
            </div>
          )}
          {me.subscription.billingEnabled && !me.subscription.hasAccess && (
            <div className="banner warn">
              <span>Tu prueba gratuita ha terminado. Activa la suscripción para seguir usando tus datos reales.</span>
              <span className="spacer" />
              <Link className="btn primary sm" to="/app/billing">
                Activar suscripción
              </Link>
            </div>
          )}
          {me.subscription.billingEnabled && me.subscription.hasAccess && trialDays !== null && me.subscription.state === 'trialing' && trialDays <= 5 && (
            <div className="banner warn">
              <span>
                Te quedan <b>{trialDays} días</b> de prueba gratuita.
              </span>
              <span className="spacer" />
              <Link className="btn sm" to="/app/billing">
                Suscribirme
              </Link>
            </div>
          )}
          <Outlet />
        </div>
      </div>
      {menu && <div onClick={() => setMenu(false)} style={{ position: 'fixed', inset: 0, background: '#0006', zIndex: 40 }} />}
    </div>
  )
}
