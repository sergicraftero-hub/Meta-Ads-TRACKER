import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useStore } from '@/lib/store'
import { api, type ApiError } from '@/lib/api'
import { Logo } from '@/components/Layout'
import { Spinner } from '@/components/ui'
import type { Me } from '@shared/types'

export default function Auth({ mode }: { mode: 'login' | 'register' }) {
  const { setMe } = useStore()
  const nav = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const register = mode === 'register'

  return (
    <div className="auth">
      <form
        className="card"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          setErr(null)
          try {
            setMe(await api.post<Me>(`/auth/${mode}`, { email, password, name: register ? name : undefined }))
            nav('/app')
          } catch (x) {
            setErr((x as ApiError).message)
          } finally {
            setBusy(false)
          }
        }}
      >
        <Link to="/" className="brand" style={{ padding: 0, textDecoration: 'none' }}>
          <Logo /> AdPilot
        </Link>
        <div>
          <h1>{register ? 'Empieza tu prueba gratis' : 'Inicia sesión'}</h1>
          <p className="muted">{register ? '14 días gratis, sin tarjeta. Funciona con datos de ejemplo desde el primer minuto.' : 'Bienvenido de nuevo.'}</p>
        </div>
        {register && (
          <label className="field">
            Nombre o agencia
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="organization" />
          </label>
        )}
        <label className="field">
          Email
          <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </label>
        <label className="field">
          Contraseña
          <input className="input" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={register ? 'new-password' : 'current-password'} />
        </label>
        {err && <div className="banner bad">{err}</div>}
        <button className="btn primary lg" disabled={busy}>
          {busy && <Spinner />} {register ? 'Crear cuenta' : 'Entrar'}
        </button>
        <p className="muted" style={{ textAlign: 'center' }}>
          {register ? (
            <>
              ¿Ya tienes cuenta? <Link to="/login">Inicia sesión</Link>
            </>
          ) : (
            <>
              ¿No tienes cuenta? <Link to="/register">Prueba gratis</Link>
            </>
          )}
        </p>
      </form>
    </div>
  )
}
