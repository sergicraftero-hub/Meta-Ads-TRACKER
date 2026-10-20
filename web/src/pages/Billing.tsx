import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Check } from 'lucide-react'
import { useStore } from '@/lib/store'
import { api, type ApiError } from '@/lib/api'
import { Spinner } from '@/components/ui'
import { FEATURES } from './Landing'

export default function Billing() {
  const { me } = useStore()
  const [params] = useSearchParams()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const s = me!.subscription
  const paid = s.state === 'active' || s.state === 'past_due' || (s.state === 'trialing' && !s.trialEndsAt)

  async function go(path: string) {
    setBusy(true)
    setErr(null)
    try {
      const { url } = await api.post<{ url: string }>(path)
      window.location.href = url
    } catch (e) {
      setErr((e as ApiError).message)
      setBusy(false)
    }
  }

  return (
    <>
      <div className="page-head">
        <h1>Suscripción</h1>
      </div>
      {params.get('status') === 'success' && <div className="banner info">¡Gracias! Tu suscripción se está activando; puede tardar unos segundos.</div>}
      {s.state === 'past_due' && <div className="banner bad">No hemos podido cobrar tu último pago. Actualiza tu tarjeta para no perder el acceso.</div>}
      <div className="card price-card">
        <div className="row">
          <h2>AdPilot Pro</h2>
          <span className="spacer" />
          {paid ? <span className="badge good">Activa</span> : s.trialEndsAt ? <span className="badge warn">Prueba gratuita</span> : <span className="badge bad">Inactiva</span>}
        </div>
        <div>
          <span className="price">100 €</span>
          <span className="muted"> /mes · IVA no incluido</span>
        </div>
        {s.trialEndsAt && !paid && (
          <p className="muted">
            {s.trialEndsAt > Date.now()
              ? `Tu prueba termina el ${new Date(s.trialEndsAt).toLocaleDateString('es-ES')}.`
              : 'Tu prueba ha terminado.'}
          </p>
        )}
        {paid && s.currentPeriodEnd && <p className="muted">Próxima renovación: {new Date(s.currentPeriodEnd).toLocaleDateString('es-ES')}</p>}
        <div className="col" style={{ gap: 8 }}>
          {FEATURES.slice(0, 7).map((f) => (
            <div key={f.title} className="check">
              <Check size={16} />
              {f.title}
            </div>
          ))}
        </div>
        {err && <div className="banner bad">{err}</div>}
        {paid ? (
          <button className="btn lg" disabled={busy} onClick={() => go('/billing/portal')}>
            {busy && <Spinner />} Gestionar suscripción y facturas
          </button>
        ) : (
          <button className="btn primary lg" disabled={busy} onClick={() => go('/billing/checkout')}>
            {busy && <Spinner />} Suscribirme por 100 €/mes
          </button>
        )}
        <p className="faint" style={{ fontSize: 12, textAlign: 'center' }}>
          Pago seguro con Stripe. Cancela cuando quieras desde el portal de cliente.
        </p>
      </div>
    </>
  )
}
