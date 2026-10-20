import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CheckCircle2, Link2, Unplug } from 'lucide-react'
import { useStore, type ThemePref } from '@/lib/store'
import { api, type ApiError } from '@/lib/api'
import { Segmented, Spinner } from '@/components/ui'

export default function Settings() {
  const { me, updateMe, refreshMe, theme, setTheme } = useStore()
  const [params, setParams] = useSearchParams()
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [cpl, setCpl] = useState(String(me!.targets.cpl || ''))
  const [roas, setRoas] = useState(String(me!.targets.roas || ''))
  const [name, setName] = useState(me!.name)

  useEffect(() => {
    if (params.get('meta') === 'connected') {
      setMsg({ ok: true, text: 'Meta conectado correctamente. Ya ves tus cuentas reales.' })
      refreshMe()
    } else if (params.get('meta_error')) setMsg({ ok: false, text: `Meta: ${params.get('meta_error')}` })
    if (params.size) setParams({}, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function act(label: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(label)
    setMsg(null)
    try {
      await fn()
      setMsg({ ok: true, text: ok })
    } catch (e) {
      setMsg({ ok: false, text: (e as ApiError).message })
    } finally {
      setBusy(null)
    }
  }

  const expires = me!.meta.expiresAt ? Math.ceil((me!.meta.expiresAt - Date.now()) / 86400_000) : null

  return (
    <>
      <div className="page-head">
        <h1>Ajustes</h1>
      </div>
      {msg && <div className={`banner ${msg.ok ? 'info' : 'bad'}`}>{msg.text}</div>}

      <div className="card card-pad col" style={{ gap: 14 }}>
        <h2>Conexión con Meta Ads</h2>
        {me!.meta.connected ? (
          <div className="row wrap">
            <CheckCircle2 color="var(--good)" size={18} />
            <span>
              Conectado como <b>{me!.meta.userName}</b>
              {expires !== null && <span className="faint"> · el acceso caduca en {expires} días</span>}
            </span>
            <span className="spacer" />
            {me!.metaOAuthEnabled && (
              <a className="btn sm" href="/api/meta/oauth/start">
                Reconectar
              </a>
            )}
            <button className="btn sm danger" disabled={busy !== null} onClick={() => act('disc', async () => (await api.del('/meta/connection'), refreshMe()), 'Meta desconectado')}>
              <Unplug size={14} /> Desconectar
            </button>
          </div>
        ) : (
          <>
            <p className="muted">Conecta tu perfil de Facebook con acceso a tus cuentas publicitarias (o las de tus clientes vía Business Manager). Solo pedimos permisos de lectura.</p>
            {me!.metaOAuthEnabled && (
              <div>
                <a className="btn primary lg" href="/api/meta/oauth/start">
                  <Link2 size={16} /> Conectar con Facebook
                </a>
              </div>
            )}
          </>
        )}
        <details>
          <summary className="muted" style={{ cursor: 'pointer' }}>
            Usar un token de acceso (usuario del sistema de Business Manager)
          </summary>
          <form
            className="col"
            style={{ gap: 8, marginTop: 10 }}
            onSubmit={(e) => {
              e.preventDefault()
              act('token', async () => (await api.post('/meta/token', { token }), setToken(''), refreshMe()), 'Token guardado. Ya ves tus cuentas reales.')
            }}
          >
            <p className="faint" style={{ fontSize: 13 }}>
              Business Manager → Configuración → Usuarios del sistema → Generar token con permisos <code>ads_read</code> y <code>business_management</code>. Los tokens de usuario del sistema no caducan; el
              token se guarda cifrado.
            </p>
            <div className="row">
              <input className="input" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="EAAB…" />
              <button className="btn" disabled={busy !== null || token.length < 20}>
                {busy === 'token' && <Spinner />} Guardar
              </button>
            </div>
          </form>
        </details>
        <div className="row wrap" style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
          <span>
            <b>Fuente de datos</b>
            <span className="faint" style={{ display: 'block', fontSize: 13 }}>
              Cambia a datos de ejemplo para enseñar la herramienta sin mostrar cuentas reales.
            </span>
          </span>
          <span className="spacer" />
          <Segmented
            value={me!.demo ? 'demo' : 'live'}
            onChange={(v) => {
              if (v === 'live' && !me!.meta.connected) return setMsg({ ok: false, text: 'Conecta Meta primero para usar datos reales.' })
              updateMe({ demo: v === 'demo' })
            }}
            options={[
              { value: 'live', label: 'Meta Ads' },
              { value: 'demo', label: 'Demo' }
            ]}
          />
        </div>
      </div>

      <form
        className="card card-pad col"
        style={{ gap: 14 }}
        onSubmit={(e) => {
          e.preventDefault()
          act('targets', () => updateMe({ targets: { cpl: Number(cpl.replace(',', '.')) || 0, roas: Number(roas.replace(',', '.')) || 0 } }), 'Objetivos guardados')
        }}
      >
        <h2>Objetivos</h2>
        <p className="muted">Las recomendaciones comparan cada anuncio con estos objetivos. Si los dejas vacíos usamos la media de la cuenta.</p>
        <div className="grid g2" style={{ maxWidth: 560 }}>
          <label className="field">
            CPL objetivo (lead gen)
            <input className="input" inputMode="decimal" value={cpl} onChange={(e) => setCpl(e.target.value)} placeholder="Ej. 12" />
          </label>
          <label className="field">
            ROAS objetivo (e-commerce)
            <input className="input" inputMode="decimal" value={roas} onChange={(e) => setRoas(e.target.value)} placeholder="Ej. 3" />
          </label>
        </div>
        <div>
          <button className="btn primary" disabled={busy !== null}>
            Guardar objetivos
          </button>
        </div>
      </form>

      <div className="card card-pad col" style={{ gap: 14 }}>
        <h2>Perfil y apariencia</h2>
        <div className="row wrap" style={{ maxWidth: 560 }}>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Tu nombre o agencia" style={{ flex: 1 }} />
          <button className="btn" onClick={() => act('name', () => updateMe({ name }), 'Perfil guardado')}>
            Guardar
          </button>
        </div>
        <div className="row">
          <span>Tema</span>
          <Segmented<ThemePref>
            value={theme}
            onChange={setTheme}
            options={[
              { value: 'system', label: 'Automático' },
              { value: 'light', label: 'Claro' },
              { value: 'dark', label: 'Oscuro' }
            ]}
          />
        </div>
      </div>
    </>
  )
}
