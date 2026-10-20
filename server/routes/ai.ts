import { Hono } from 'hono'
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { env, aiEnabled } from '../env'
import { requireAccess, requireUser, type AppEnv } from '../auth'
import { reportFor, metaError } from './meta'
import { buildRecommendations } from '../../shared/recommendations'
import { groupBy, kpis } from '../../shared/metrics'
import { isValidRange } from '../../shared/dates'
import type { AccountReport, AiAnalysis, BusinessMode, Targets } from '../../shared/types'

const MODEL = 'claude-opus-5-5'
const DAILY_LIMIT = 40

let client: Anthropic | null = null
const anthropic = () => (client ??= new Anthropic({ apiKey: env.anthropicApiKey }))

const usage = new Map<string, { day: string; n: number }>()
function overLimit(userId: string): boolean {
  const day = new Date().toISOString().slice(0, 10)
  const u = usage.get(userId)
  if (!u || u.day !== day) {
    usage.set(userId, { day, n: 1 })
    return false
  }
  return ++u.n > DAILY_LIMIT
}

const AnalysisSchema = z.object({
  summary: z.string(),
  priorities: z.array(
    z.object({ title: z.string(), why: z.string(), how: z.string(), impact: z.enum(['alto', 'medio', 'bajo']) })
  ),
  concepts: z.array(
    z.object({
      angle: z.string(),
      hook: z.string(),
      primaryText: z.string(),
      headline: z.string(),
      cta: z.string(),
      format: z.string(),
      rationale: z.string()
    })
  )
})

const JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'priorities', 'concepts'],
  properties: {
    summary: { type: 'string', description: 'Diagnóstico de 3-5 frases' },
    priorities: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'why', 'how', 'impact'],
        properties: {
          title: { type: 'string' },
          why: { type: 'string' },
          how: { type: 'string' },
          impact: { type: 'string', enum: ['alto', 'medio', 'bajo'] }
        }
      }
    },
    concepts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['angle', 'hook', 'primaryText', 'headline', 'cta', 'format', 'rationale'],
        properties: {
          angle: { type: 'string' },
          hook: { type: 'string' },
          primaryText: { type: 'string' },
          headline: { type: 'string' },
          cta: { type: 'string' },
          format: { type: 'string' },
          rationale: { type: 'string' }
        }
      }
    }
  }
}

const SYSTEM = `Eres un media buyer senior especializado en Meta Ads (Facebook e Instagram) que gestiona cuentas de lead generation y e-commerce en España y Latinoamérica.
Analizas datos reales de una cuenta publicitaria y das recomendaciones concretas, priorizadas y accionables en el Administrador de anuncios.
Reglas:
- Escribe en español de España, directo y sin relleno.
- Basa cada afirmación en los números proporcionados; cita la métrica que la respalda.
- Ten en cuenta la fase de aprendizaje (≈50 conversiones/semana por conjunto) y evita cambios bruscos de presupuesto (>20-30 %).
- Da entre 3 y 6 prioridades ordenadas por impacto.
- Propón exactamente 5 conceptos de anuncio nuevos inspirados en lo que ya funciona en la cuenta (ángulo, gancho para los 3 primeros segundos, texto principal listo para pegar, titular, CTA de Meta, formato recomendado y por qué).`

/** Compact, token-cheap summary of the account for the prompt. */
function digest(report: AccountReport, mode: BusinessMode, targets: Targets) {
  const cur = report.account.currency
  const k = kpis(report.totals)
  const pk = kpis(report.previousTotals)
  const pick = (x: ReturnType<typeof kpis>) =>
    mode === 'leadgen'
      ? { gasto: round(x.spend), leads: x.leads, cpl: round(x.cpl), ctr: round(x.ctr), cpm: round(x.cpm), tasa_lead: round(x.leadRate) }
      : { gasto: round(x.spend), compras: x.purchases, ingresos: round(x.revenue), roas: round(x.roas), cpa: round(x.cpa), ticket_medio: round(x.aov), ctr: round(x.ctr), cpm: round(x.cpm) }
  const creativeOf = (id: string) => report.ads.find((a) => a.id === id)?.creative
  const ads = [...groupBy(report.rows, 'ad').values()]
    .sort((a, b) => b.metrics.spend - a.metrics.spend)
    .slice(0, 25)
    .map((a) => ({
      anuncio: a.name,
      ...pick(kpis(a.metrics)),
      frecuencia: round(report.adReach[a.id]?.frequency ?? 0),
      titular: creativeOf(a.id)?.title,
      texto: creativeOf(a.id)?.body?.slice(0, 280)
    }))
  const campaigns = [...groupBy(report.rows, 'campaign').values()].map((c) => ({
    campaña: c.name,
    objetivo: report.campaigns.find((x) => x.id === c.id)?.objective,
    ...pick(kpis(c.metrics))
  }))
  return {
    cuenta: report.account.name,
    moneda: cur,
    modelo_negocio: mode === 'leadgen' ? 'captación de leads' : 'e-commerce',
    rango: report.range,
    objetivo: mode === 'leadgen' ? { cpl_objetivo: targets.cpl || 'no definido' } : { roas_objetivo: targets.roas || 'no definido' },
    total: pick(k),
    periodo_anterior: pick(pk),
    campañas: campaigns,
    anuncios_top_por_gasto: ads,
    alertas_detectadas: buildRecommendations(report, mode, targets)
      .slice(0, 12)
      .map((r) => `${r.title}: ${r.detail}`)
  }
}

const round = (n: number) => Math.round(n * 100) / 100

export const aiRoutes = new Hono<AppEnv>()
  .use(requireUser)
  .use(async (c, next) => (c.get('user').demo ? next() : requireAccess(c, next)))
  .post('/analyze', async (c) => {
    if (!aiEnabled()) return c.json({ error: 'El analista IA no está configurado (falta ANTHROPIC_API_KEY)' }, 400)
    const body = z
      .object({ accountId: z.string().regex(/^act_\w+$/), since: z.string(), until: z.string(), notes: z.string().max(1000).optional() })
      .safeParse(await c.req.json().catch(() => ({})))
    if (!body.success || !isValidRange(body.data)) return c.json({ error: 'Parámetros no válidos' }, 400)
    const user = c.get('user')
    if (overLimit(user.id)) return c.json({ error: `Has alcanzado el límite de ${DAILY_LIMIT} análisis diarios` }, 429)

    let report: AccountReport
    try {
      report = await reportFor(user, body.data.accountId, { since: body.data.since, until: body.data.until })
    } catch (e) {
      return metaError(c, e)
    }
    const targets = { cpl: Number(user.target_cpl), roas: Number(user.target_roas) }
    const data = digest(report, user.mode, targets)
    const userNotes = body.data.notes ? `\n\nContexto del anunciante (tenlo en cuenta): ${body.data.notes}` : ''

    try {
      const response = await anthropic().beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: JSON_SCHEMA } },
        system: SYSTEM,
        messages: [
          {
            role: 'user',
            content: `Datos de la cuenta (JSON):\n${JSON.stringify(data)}${userNotes}\n\nDevuelve el diagnóstico, las prioridades y los 5 conceptos de anuncio.`
          }
        ]
      })
      if (response.stop_reason === 'refusal') return c.json({ error: 'La IA no ha podido completar este análisis. Inténtalo de nuevo.' }, 502)
      if (response.stop_reason === 'max_tokens') return c.json({ error: 'La respuesta de la IA se ha cortado. Inténtalo con un rango más corto.' }, 502)
      const text = response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('')
      const parsed = AnalysisSchema.safeParse(JSON.parse(text))
      if (!parsed.success) return c.json({ error: 'Respuesta de la IA no válida, inténtalo de nuevo' }, 502)
      const result: AiAnalysis = { ...parsed.data, model: response.model, createdAt: Date.now() }
      return c.json(result)
    } catch (e) {
      if (e instanceof Anthropic.RateLimitError) return c.json({ error: 'El servicio de IA está saturado, prueba en un minuto' }, 429)
      if (e instanceof Anthropic.APIError) return c.json({ error: `Error del servicio de IA (${e.status})` }, 502)
      throw e
    }
  })
