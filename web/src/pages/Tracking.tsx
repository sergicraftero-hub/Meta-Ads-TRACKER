import { useEffect, useState } from 'react'
import { CheckCircle2, Plus, Radio, Send, Trash2, XCircle } from 'lucide-react'
import { useApi, useStore } from '@/lib/store'
import { api, type ApiError } from '@/lib/api'
import { CopyButton, ErrorState, KpiCard, Skeleton, Spinner, Empty } from '@/components/ui'
import { int, money } from '@shared/format'
import type { TrackingSite } from '@shared/types'

export const UTM_PARAMS = 'utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.id}}&utm_term={{adset.id}}&utm_content={{ad.id}}'

interface LiveEvent {
  name: string
  eventId: string
  ts: number
  url: string | null
  value: number | null
  currency: string | null
  capiStatus: 'sent' | 'failed' | 'skipped' | 'pending'
  capiError: string | null
  touch: { cmp?: string; ad?: string; src?: string } | null
}

export function useSites() {
  const { me } = useStore()
  return useApi<TrackingSite[]>(`sites|${me!.id}|${me!.demo}`, () => api.get('/tracking/sites'))
}

export default function Tracking() {
  const { me } = useStore()
  const sites = useSites()
  const [selected, setSelected] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const site = sites.data?.find((s) => s.id === selected) ?? sites.data?.[0]

  if (sites.error) return <ErrorState error={sites.error} onRetry={sites.reload} />
  if (!sites.data) return <Skeleton h={400} />

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Píxel y Conversions API</h1>
          <p className="sub">Tracking server-side de primera parte: recupera las conversiones que el píxel pierde por iOS, bloqueadores y cookies.</p>
        </div>
        <span className="spacer" />
        {sites.data.length > 0 && (
          <select className="input" style={{ width: 220 }} value={site?.id} onChange={(e) => setSelected(e.target.value)}>
            {sites.data.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.domain})
              </option>
            ))}
          </select>
        )}
        <button className="btn" onClick={() => setCreating(true)}>
          <Plus size={15} /> Añadir web
        </button>
      </div>

      {(creating || !sites.data.length) && (
        <NewSite
          onCancel={sites.data.length ? () => setCreating(false) : undefined}
          onCreated={(s) => {
            setCreating(false)
            setSelected(s.id)
            sites.reload()
          }}
        />
      )}
      {site && !creating && <SiteSetup key={site.id} site={site} demo={me!.demo} onChange={sites.reload} />}
    </>
  )
}

function NewSite({ onCreated, onCancel }: { onCreated: (s: TrackingSite) => void; onCancel?: () => void }) {
  const [name, setName] = useState('')
  const [domain, setDomain] = useState('')
  const [currency, setCurrency] = useState('EUR')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  return (
    <form
      className="card card-pad col"
      style={{ gap: 14, maxWidth: 560 }}
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        setErr(null)
        try {
          onCreated(await api.post<TrackingSite>('/tracking/sites', { name, domain, currency }))
        } catch (x) {
          setErr((x as ApiError).message)
        } finally {
          setBusy(false)
        }
      }}
    >
      <h2>Añade tu web o tienda</h2>
      <label className="field">
        Nombre
        <input className="input" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Mi tienda" />
      </label>
      <label className="field">
        Dominio
        <span className="hint">Solo aceptaremos eventos enviados desde este dominio y sus subdominios.</span>
        <input className="input" required value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="mitienda.com" />
      </label>
      <label className="field">
        Moneda
        <select className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
          {['EUR', 'USD', 'GBP', 'MXN', 'COP', 'ARS', 'CLP', 'PEN'].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      {err && <div className="banner bad">{err}</div>}
      <div className="row">
        <button className="btn primary" disabled={busy}>
          {busy && <Spinner />} Crear
        </button>
        {onCancel && (
          <button type="button" className="btn ghost" onClick={onCancel}>
            Cancelar
          </button>
        )}
      </div>
    </form>
  )
}

function SiteSetup({ site, demo, onChange }: { site: TrackingSite; demo: boolean; onChange: () => void }) {
  const origin = window.location.origin
  const snippet = `<script async src="${origin}/t.js?k=${site.publicKey}"></script>`
  const webhook = `${origin}/api/webhooks/shopify/${site.publicKey}`
  const [pixel, setPixel] = useState(site.metaPixelId ?? '')
  const [capi, setCapi] = useState('')
  const [testCode, setTestCode] = useState(site.testEventCode ?? '')
  const [shopify, setShopify] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  async function act(label: string, fn: () => Promise<unknown>, okText: string) {
    setBusy(label)
    setMsg(null)
    try {
      await fn()
      setMsg({ ok: true, text: okText })
      onChange()
    } catch (e) {
      setMsg({ ok: false, text: (e as ApiError).message })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="split">
      <div className="card card-pad">
        <div className="steps">
          <div className="step">
            <div className="col" style={{ gap: 8 }}>
              <h3>Instala el script en tu web</h3>
              <p className="muted">
                Pégalo dentro de <code>&lt;head&gt;</code> en todas las páginas. En Shopify: <i>Tienda online → Temas → Editar código → theme.liquid</i>. En WordPress: en la cabecera del tema o con un plugin de
                scripts.
              </p>
              <div className="codebox">
                {snippet}
                <span className="copy">
                  <CopyButton text={snippet} />
                </span>
              </div>
            </div>
          </div>
          <div className="step">
            <form
              className="col"
              style={{ gap: 10 }}
              onSubmit={(e) => {
                e.preventDefault()
                act(
                  'capi',
                  () =>
                    api.patch(`/tracking/sites/${site.id}`, {
                      metaPixelId: pixel || null,
                      ...(capi ? { capiToken: capi } : {}),
                      testEventCode: testCode || null
                    }),
                  'Conversions API guardada'
                )
              }}
            >
              <h3>Conecta la Conversions API de Meta</h3>
              <p className="muted">
                En el Administrador de eventos → tu píxel → Configuración → <i>Generar token de acceso</i>. Enviamos Lead, AddToCart, InitiateCheckout, Purchase… desde nuestro servidor con el mismo
                event_id que el píxel, así Meta deduplica.
              </p>
              <div className="grid g2">
                <label className="field">
                  ID del píxel
                  <input className="input" value={pixel} onChange={(e) => setPixel(e.target.value.trim())} placeholder="123456789012345" inputMode="numeric" />
                </label>
                <label className="field">
                  Código de prueba <span className="hint">Opcional, para «Probar eventos»</span>
                  <input className="input" value={testCode} onChange={(e) => setTestCode(e.target.value.trim())} placeholder="TEST12345" />
                </label>
              </div>
              <label className="field">
                Token de acceso de la Conversions API
                <input className="input" type="password" value={capi} onChange={(e) => setCapi(e.target.value)} placeholder={site.hasCapiToken ? '•••••••• guardado (déjalo vacío para mantenerlo)' : 'EAAB…'} />
              </label>
              <div className="row wrap">
                <button className="btn primary" disabled={busy !== null}>
                  {busy === 'capi' && <Spinner />} Guardar
                </button>
                <button type="button" className="btn" disabled={busy !== null || !site.hasCapiToken || !site.metaPixelId} onClick={() => act('test', () => api.post(`/tracking/sites/${site.id}/test`), 'Evento de prueba aceptado por Meta ✔')}>
                  {busy === 'test' ? <Spinner /> : <Send size={14} />} Enviar evento de prueba
                </button>
                {site.hasCapiToken && site.metaPixelId && (
                  <span className="badge good">
                    <CheckCircle2 size={12} /> CAPI activa
                  </span>
                )}
              </div>
            </form>
          </div>
          <div className="step">
            <div className="col" style={{ gap: 8 }}>
              <h3>Añade los parámetros de URL a tus anuncios</h3>
              <p className="muted">
                En cada anuncio → <i>Seguimiento → Parámetros de URL</i>. Así sabremos qué campaña, conjunto y anuncio generó cada venta, aunque el píxel falle.
              </p>
              <div className="codebox">
                {UTM_PARAMS}
                <span className="copy">
                  <CopyButton text={UTM_PARAMS} />
                </span>
              </div>
            </div>
          </div>
          <div className="step">
            <form
              className="col"
              style={{ gap: 8 }}
              onSubmit={(e) => {
                e.preventDefault()
                act('shop', () => api.patch(`/tracking/sites/${site.id}`, { shopifySecret: shopify || null }), 'Webhook de Shopify guardado')
              }}
            >
              <h3>
                Shopify: compras server-side <span className="badge">Opcional</span>
              </h3>
              <p className="muted">
                En Shopify → <i>Configuración → Notificaciones → Webhooks → Crear webhook</i>: evento «Creación de pedido», formato JSON y esta URL. Copia la clave de firma que muestra Shopify debajo de la
                lista de webhooks.
              </p>
              <div className="codebox">
                {webhook}
                <span className="copy">
                  <CopyButton text={webhook} />
                </span>
              </div>
              <div className="row">
                <input className="input" type="password" value={shopify} onChange={(e) => setShopify(e.target.value)} placeholder={site.hasShopifySecret ? '•••••••• guardada' : 'Clave de firma del webhook'} />
                <button className="btn" disabled={busy !== null}>
                  Guardar
                </button>
              </div>
              <p className="faint" style={{ fontSize: 12 }}>
                Si ya envías compras por la CAPI del canal de Facebook de Shopify, desactívala para no duplicar eventos.
              </p>
            </form>
          </div>
          <div className="step">
            <div className="col" style={{ gap: 8 }}>
              <h3>Eventos de conversión</h3>
              <p className="muted">
                Los formularios con el atributo <code>data-adpilot-lead</code> envían un Lead automáticamente (con email y teléfono cifrados). Para otros eventos:
              </p>
              <div className="codebox">{`adpilot.track('Lead', { email: 'ana@mail.com', phone: '600123123' })
adpilot.track('AddToCart', { value: 49.9, currency: '${site.currency}' })
adpilot.track('Purchase', { value: 129, currency: '${site.currency}', order_id: '1001' })`}</div>
            </div>
          </div>
        </div>
        {msg && (
          <div className={`banner ${msg.ok ? 'info' : 'bad'}`} style={{ marginTop: 16 }}>
            {msg.text}
          </div>
        )}
        <div className="row" style={{ marginTop: 20, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
          {demo && (
            <button className="btn" disabled={busy !== null} onClick={() => act('seed', () => api.post(`/tracking/sites/${site.id}/seed-demo`), 'Datos de ejemplo generados: mira la pestaña Atribución con la cuenta «Urban Wear Store».')}>
              {busy === 'seed' && <Spinner />} Generar eventos de ejemplo
            </button>
          )}
          <span className="spacer" />
          <button
            className="btn ghost danger"
            onClick={() => {
              if (confirm(`¿Eliminar ${site.name} y todos sus eventos?`)) act('del', () => api.del(`/tracking/sites/${site.id}`), 'Web eliminada')
            }}
          >
            <Trash2 size={14} /> Eliminar web
          </button>
        </div>
      </div>
      <LiveFeed site={site} />
    </div>
  )
}

function LiveFeed({ site }: { site: TrackingSite }) {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 5000)
    return () => clearInterval(t)
  }, [])
  const { data } = useApi<{ events: LiveEvent[]; stats: { events24h: number; visitors24h: number; capiSent24h: number; capiFailed24h: number } }>(`${site.id}|${tick}`, () =>
    api.get(`/tracking/sites/${site.id}/events`)
  )
  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="grid g2">
        <KpiCard label="Eventos (24 h)" value={data ? int(data.stats.events24h) : '…'} />
        <KpiCard label="Visitantes (24 h)" value={data ? int(data.stats.visitors24h) : '…'} />
        <KpiCard label="Enviados a Meta" value={data ? int(data.stats.capiSent24h) : '…'} />
        <KpiCard label="Errores CAPI" value={data ? int(data.stats.capiFailed24h) : '…'} />
      </div>
      <div className="card">
        <div className="card-head">
          <Radio size={16} color="var(--good)" />
          <h2>Eventos en directo</h2>
        </div>
        <div style={{ maxHeight: 560, overflowY: 'auto' }}>
          {!data?.events.length && (
            <Empty title="Esperando eventos…">
              <p className="muted" style={{ fontSize: 13 }}>
                Instala el script y visita tu web: verás aquí cada evento en segundos.
              </p>
            </Empty>
          )}
          {data?.events.map((e) => (
            <div key={e.eventId} className="row" style={{ padding: '10px 18px', borderBottom: '1px solid var(--border)', alignItems: 'flex-start' }}>
              <span
                title={e.capiError ?? undefined}
                style={{ marginTop: 2, color: e.capiStatus === 'sent' ? 'var(--good)' : e.capiStatus === 'failed' ? 'var(--bad)' : 'var(--text-3)' }}
              >
                {e.capiStatus === 'failed' ? <XCircle size={15} /> : <CheckCircle2 size={15} />}
              </span>
              <div className="col" style={{ gap: 0, minWidth: 0, flex: 1 }}>
                <div className="row">
                  <b>{e.name}</b>
                  {e.value != null && <span className="badge good">{money(e.value, e.currency ?? site.currency)}</span>}
                  {e.touch?.src && <span className="badge accent">{e.touch.src}</span>}
                  <span className="spacer" />
                  <span className="faint num" style={{ fontSize: 12 }}>
                    {new Date(e.ts).toLocaleTimeString('es-ES')}
                  </span>
                </div>
                <span className="faint" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {e.url ?? '—'}
                </span>
                {e.capiStatus === 'failed' && e.capiError && <span style={{ fontSize: 12, color: 'var(--bad)' }}>{e.capiError}</span>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
