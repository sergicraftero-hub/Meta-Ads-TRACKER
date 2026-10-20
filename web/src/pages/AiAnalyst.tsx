import { useState } from 'react'
import { Bot, Sparkles } from 'lucide-react'
import { useStore } from '@/lib/store'
import { api, type ApiError } from '@/lib/api'
import { CopyButton, Spinner, Empty } from '@/components/ui'
import type { AiAnalysis } from '@shared/types'

const results = new Map<string, AiAnalysis>()

export default function AiAnalyst() {
  const { me, accountId, account, range } = useStore()
  const key = `${me!.demo}|${accountId}|${range.since}|${range.until}|${me!.mode}`
  const [analysis, setAnalysis] = useState<AiAnalysis | null>(results.get(key) ?? null)
  const [shownKey, setShownKey] = useState(key)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notes, setNotes] = useState('')
  if (shownKey !== key) {
    setShownKey(key)
    setAnalysis(results.get(key) ?? null)
  }

  async function run() {
    setLoading(true)
    setError(null)
    try {
      const a = await api.post<AiAnalysis>('/ai/analyze', { accountId, since: range.since, until: range.until, notes: notes || undefined })
      results.set(key, a)
      setAnalysis(a)
    } catch (e) {
      setError((e as ApiError).message)
    } finally {
      setLoading(false)
    }
  }

  if (!me!.aiEnabled) {
    return (
      <Empty icon={<Bot size={28} />} title="El analista IA no está activado en este servidor">
        <p className="muted">Añade ANTHROPIC_API_KEY en la configuración del servidor para activarlo.</p>
      </Empty>
    )
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Analista IA</h1>
          <p className="sub">Un media buyer senior revisa {account?.name ?? 'la cuenta'} y te da un plan de acción y 5 anuncios nuevos listos para lanzar.</p>
        </div>
      </div>
      <div className="card card-pad col" style={{ gap: 12 }}>
        <label className="field">
          Contexto opcional
          <span className="hint">Ej.: «Vendemos implantes dentales en Madrid, ticket 1.200 €. El formulario lo atiende un call center en 24 h.»</span>
          <textarea className="input" rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <div className="row">
          <button className="btn primary lg" onClick={run} disabled={loading || !accountId}>
            {loading ? <Spinner /> : <Sparkles size={16} />}
            {loading ? 'Analizando la cuenta… (puede tardar un minuto)' : analysis ? 'Volver a analizar' : 'Analizar con IA'}
          </button>
        </div>
        {error && <div className="banner bad">{error}</div>}
      </div>

      {analysis && (
        <>
          <div className="card card-pad col" style={{ gap: 8 }}>
            <h2>Diagnóstico</h2>
            <p style={{ fontSize: 15, lineHeight: 1.6 }}>{analysis.summary}</p>
          </div>
          <div className="col" style={{ gap: 12 }}>
            <h2>Plan de acción</h2>
            {analysis.priorities.map((p, i) => (
              <div key={i} className={`card rec ${p.impact === 'alto' ? 'critical' : p.impact === 'medio' ? 'warning' : 'info'}`}>
                <div className="bar" />
                <div className="body">
                  <div className="row">
                    <b style={{ fontSize: 15 }}>
                      {i + 1}. {p.title}
                    </b>
                    <span className="spacer" />
                    <span className={`badge ${p.impact === 'alto' ? 'bad' : p.impact === 'medio' ? 'warn' : 'info'}`}>Impacto {p.impact}</span>
                  </div>
                  <p className="muted">{p.why}</p>
                  <div className="action">→ {p.how}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="col" style={{ gap: 12 }}>
            <h2>Nuevos anuncios para probar</h2>
            <div className="grid g2">
              {analysis.concepts.map((c, i) => {
                const text = `${c.hook}\n\n${c.primaryText}\n\nTitular: ${c.headline}\nCTA: ${c.cta}`
                return (
                  <div key={i} className="card card-pad col" style={{ gap: 10 }}>
                    <div className="row">
                      <span className="badge accent">{c.format}</span>
                      <b>{c.angle}</b>
                      <span className="spacer" />
                      <CopyButton text={text} />
                    </div>
                    <div>
                      <span className="faint" style={{ fontSize: 12 }}>
                        Gancho (primeros 3 s)
                      </span>
                      <p style={{ fontWeight: 600 }}>{c.hook}</p>
                    </div>
                    <div>
                      <span className="faint" style={{ fontSize: 12 }}>
                        Texto principal
                      </span>
                      <p style={{ whiteSpace: 'pre-wrap' }}>{c.primaryText}</p>
                    </div>
                    <div className="row wrap">
                      <span className="badge">Titular: {c.headline}</span>
                      <span className="badge">CTA: {c.cta}</span>
                    </div>
                    <p className="muted" style={{ fontSize: 13 }}>
                      💡 {c.rationale}
                    </p>
                  </div>
                )
              })}
            </div>
          </div>
          <p className="faint" style={{ fontSize: 12 }}>
            Generado por {analysis.model} · {new Date(analysis.createdAt).toLocaleString('es-ES')}. Revisa siempre las sugerencias antes de aplicarlas.
          </p>
        </>
      )}
    </>
  )
}
