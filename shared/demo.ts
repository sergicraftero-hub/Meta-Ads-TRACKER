import { emptyMetrics, addInto, eachDay } from './metrics'
import { previousRange } from './dates'
import type { AccountReport, AdAccount, AdInfo, AdSetInfo, CampaignInfo, DailyRow, DateRange, Metrics, ReachStats } from './types'

/** Deterministic PRNG so demo numbers are stable between reloads. */
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hash(str: string): number {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619)
  return h >>> 0
}

export const DEMO_ACCOUNTS: AdAccount[] = [
  { id: 'act_demo_2', accountId: 'demo_2', name: 'Urban Wear Store', currency: 'EUR', status: 1, timezone: 'Europe/Madrid', business: 'Demo Agency' },
  { id: 'act_demo_1', accountId: 'demo_1', name: 'Clínica Dental Sonrisa', currency: 'EUR', status: 1, timezone: 'Europe/Madrid', business: 'Demo Agency' },
  { id: 'act_demo_3', accountId: 'demo_3', name: 'Academia Inglés Online', currency: 'EUR', status: 1, timezone: 'Europe/Madrid', business: 'Demo Agency' }
]

interface AdSpec {
  name: string
  title: string
  body: string
  quality: number // conversion multiplier
  ctr: number // base CTR %
  fatigue?: boolean
  colors: [string, string]
  paused?: boolean
}
interface AdSetSpec {
  name: string
  ads: AdSpec[]
  budget: number
}
interface CampaignSpec {
  name: string
  objective: string
  adsets: AdSetSpec[]
}

const LEAD_DENTAL: CampaignSpec[] = [
  {
    name: 'LEADS | Implantes | Formulario',
    objective: 'OUTCOME_LEADS',
    adsets: [
      {
        name: 'Amplia 35-65 Madrid',
        budget: 40,
        ads: [
          { name: 'Video testimonio María', title: 'Implantes desde 790 €', body: 'María volvió a sonreír en 1 día. Primera visita y TAC gratis.', quality: 1.4, ctr: 1.6, colors: ['#1f6feb', '#0b3d91'] },
          { name: 'Carrusel antes/después', title: 'Resultados reales', body: 'Mira el cambio de nuestros pacientes. Financiación sin intereses.', quality: 1.0, ctr: 1.2, fatigue: true, colors: ['#0f766e', '#134e4a'] },
          { name: 'Imagen oferta TAC', title: 'TAC 3D gratis', body: 'Solo este mes: estudio completo gratis. Plazas limitadas.', quality: 0.45, ctr: 0.5, colors: ['#9a3412', '#431407'] }
        ]
      },
      {
        name: 'Lookalike pacientes 1%',
        budget: 25,
        ads: [
          { name: 'Video doctor explica', title: '¿Te falta una pieza?', body: 'El Dr. Ruiz te explica las opciones en 60 segundos.', quality: 1.2, ctr: 1.3, colors: ['#4338ca', '#1e1b4b'] },
          { name: 'UGC paciente Pedro', title: 'Sin miedo al dentista', body: 'Pedro tenía pánico. Así fue su experiencia.', quality: 1.6, ctr: 1.9, colors: ['#be185d', '#500724'] }
        ]
      }
    ]
  },
  {
    name: 'LEADS | Ortodoncia invisible',
    objective: 'OUTCOME_LEADS',
    adsets: [
      {
        name: 'Mujeres 25-45',
        budget: 30,
        ads: [
          { name: 'Reel transformación 6 meses', title: 'Ortodoncia invisible', body: 'Nadie notará que la llevas. Estudio gratis.', quality: 0.9, ctr: 1.1, colors: ['#7c3aed', '#2e1065'] },
          { name: 'Imagen precio mensual', title: 'Desde 59 €/mes', body: 'Sonrisa alineada sin brackets. Pide cita.', quality: 0.7, ctr: 0.9, colors: ['#0369a1', '#082f49'] }
        ]
      }
    ]
  }
]

const ECOM_STORE: CampaignSpec[] = [
  {
    name: 'ADV+ Shopping | Catálogo',
    objective: 'OUTCOME_SALES',
    adsets: [
      {
        name: 'Advantage+ amplia',
        budget: 120,
        ads: [
          { name: 'DPA catálogo dinámico', title: 'Lo que has visto, ahora -15%', body: 'Envío gratis a partir de 50 €.', quality: 1.3, ctr: 1.4, colors: ['#111827', '#374151'] },
          { name: 'UGC unboxing sudadera', title: 'La sudadera viral', body: '+12.000 vendidas. Algodón orgánico 400 g.', quality: 1.7, ctr: 2.1, colors: ['#b45309', '#451a03'] },
          { name: 'Video lookbook otoño', title: 'Nueva colección', body: 'Básicos premium para todo el año.', quality: 0.9, ctr: 1.0, fatigue: true, colors: ['#065f46', '#022c22'] }
        ]
      }
    ]
  },
  {
    name: 'PROSPECCIÓN | Intereses streetwear',
    objective: 'OUTCOME_SALES',
    adsets: [
      {
        name: 'Intereses moda urbana 18-34',
        budget: 60,
        ads: [
          { name: 'Imagen producto fondo blanco', title: 'Pantalón cargo', body: 'Corte relaxed. Tallas XS-XXL.', quality: 0.4, ctr: 0.6, colors: ['#e5e7eb', '#9ca3af'] },
          { name: 'Reel influencer', title: 'El outfit de @laura', body: 'Consigue el look completo.', quality: 1.1, ctr: 1.5, colors: ['#db2777', '#831843'] }
        ]
      },
      {
        name: 'Lookalike compradores 3%',
        budget: 45,
        ads: [{ name: 'Carrusel best sellers', title: 'Top ventas', body: 'Los 5 favoritos de nuestros clientes.', quality: 1.0, ctr: 1.2, colors: ['#1d4ed8', '#172554'] }]
      }
    ]
  },
  {
    name: 'RETARGETING | Carritos 7d',
    objective: 'OUTCOME_SALES',
    adsets: [
      {
        name: 'ATC + IC 7 días',
        budget: 25,
        ads: [{ name: 'Recordatorio carrito -10%', title: '¿Te lo vas a perder?', body: 'Tu carrito te espera con un 10% extra.', quality: 2.6, ctr: 2.4, colors: ['#dc2626', '#450a0a'] }]
      }
    ]
  }
]

const LEAD_ACADEMY: CampaignSpec[] = [
  {
    name: 'LEADS | Clase gratis | Landing',
    objective: 'OUTCOME_LEADS',
    adsets: [
      {
        name: 'Amplia España 25-50',
        budget: 50,
        ads: [
          { name: 'Video profesor nativo', title: 'Habla inglés en 90 días', body: 'Clase de prueba gratis con profesor nativo.', quality: 1.2, ctr: 1.5, colors: ['#2563eb', '#1e3a8a'] },
          { name: 'Imagen meme trabajo', title: 'Ese momento en la reunión...', body: 'Deja de asentir sin entender. Prueba gratis.', quality: 1.5, ctr: 2.2, colors: ['#ca8a04', '#422006'] },
          { name: 'Carrusel método', title: 'Nuestro método en 4 pasos', body: 'Sin gramática aburrida. Conversación desde el día 1.', quality: 0.6, ctr: 0.8, paused: false, colors: ['#059669', '#022c22'] }
        ]
      }
    ]
  }
]

const SPECS: Record<string, { campaigns: CampaignSpec[]; ecommerce: boolean }> = {
  act_demo_1: { campaigns: LEAD_DENTAL, ecommerce: false },
  act_demo_2: { campaigns: ECOM_STORE, ecommerce: true },
  act_demo_3: { campaigns: LEAD_ACADEMY, ecommerce: false }
}

function thumb(title: string, [a, b]: [string, string]): string {
  const safe = title.replace(/[<>&"]/g, '')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="400" height="400" fill="url(#g)"/><text x="28" y="330" font-family="Inter,Arial" font-weight="700" font-size="30" fill="#fff">${safe}</text><circle cx="330" cy="80" r="40" fill="#ffffff22"/></svg>`
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg)
}

function simulateDay(spec: AdSpec, budget: number, dayIdx: number, totalDays: number, ecommerce: boolean, r: () => number): Metrics {
  const m = emptyMetrics()
  const weekday = 1 + 0.12 * Math.sin(dayIdx / 1.1)
  const spend = budget * (0.85 + r() * 0.3) * weekday
  const cpm = (ecommerce ? 9 : 7) * (0.85 + r() * 0.35)
  const impressions = Math.round((spend / cpm) * 1000)
  const fatigueFactor = spec.fatigue ? Math.max(0.35, 1 - (dayIdx / Math.max(1, totalDays)) * 0.75) : 1
  const ctr = (spec.ctr / 100) * fatigueFactor * (0.85 + r() * 0.3)
  const linkClicks = Math.round(impressions * ctr)
  m.spend = Math.round(spend * 100) / 100
  m.impressions = impressions
  m.linkClicks = linkClicks
  m.clicks = Math.round(linkClicks * 1.35)
  m.landingPageViews = Math.round(linkClicks * (0.72 + r() * 0.15))
  m.videoViews3s = Math.round(impressions * (0.18 + r() * 0.15))
  m.thruPlays = Math.round(m.videoViews3s * 0.22)
  const q = spec.quality * fatigueFactor
  if (ecommerce) {
    m.addToCart = Math.round(m.landingPageViews * 0.09 * q * (0.8 + r() * 0.4))
    m.initiateCheckout = Math.round(m.addToCart * (0.45 + r() * 0.1))
    m.purchases = Math.round(m.initiateCheckout * (0.55 + r() * 0.15))
    m.purchaseValue = Math.round(m.purchases * (48 + r() * 30) * 100) / 100
  } else {
    m.leads = Math.round(m.landingPageViews * 0.11 * q * (0.75 + r() * 0.5))
    m.messages = Math.round(linkClicks * 0.01 * r())
  }
  return m
}

/** Build a full report for a demo account. Day-level randomness is seeded by account+ad+date. */
export function demoReport(accountId: string, range: DateRange): AccountReport {
  const account = DEMO_ACCOUNTS.find((a) => a.id === accountId) ?? DEMO_ACCOUNTS[0]
  const spec = SPECS[account.id]
  const prev = previousRange(range)
  const allDays = eachDay(prev.since, range.until)
  const campaigns: CampaignInfo[] = []
  const adsets: AdSetInfo[] = []
  const ads: AdInfo[] = []
  const rows: DailyRow[] = []
  const prevTotals = emptyMetrics()
  const adImpr: Record<string, number> = {}

  spec.campaigns.forEach((c, ci) => {
    const cid = `${account.accountId}_c${ci}`
    campaigns.push({ id: cid, name: c.name, objective: c.objective, status: 'ACTIVE', effectiveStatus: 'ACTIVE', dailyBudget: c.adsets.reduce((s, a) => s + a.budget, 0) })
    c.adsets.forEach((as, si) => {
      const sid = `${cid}_s${si}`
      adsets.push({ id: sid, name: as.name, campaignId: cid, status: 'ACTIVE', effectiveStatus: 'ACTIVE', optimizationGoal: spec.ecommerce ? 'OFFSITE_CONVERSIONS' : 'LEAD_GENERATION', dailyBudget: as.budget })
      as.ads.forEach((ad, ai) => {
        const aid = `${sid}_a${ai}`
        ads.push({
          id: aid,
          name: ad.name,
          campaignId: cid,
          adsetId: sid,
          status: ad.paused ? 'PAUSED' : 'ACTIVE',
          effectiveStatus: ad.paused ? 'PAUSED' : 'ACTIVE',
          creative: { title: ad.title, body: ad.body, thumbnailUrl: thumb(ad.title, ad.colors), cta: spec.ecommerce ? 'SHOP_NOW' : 'SIGN_UP', objectType: 'VIDEO' }
        })
        const perAdBudget = as.budget / as.ads.length
        allDays.forEach((date, di) => {
          const r = rng(hash(aid + date))
          const inCurrent = date >= range.since
          const idxInRange = inCurrent ? di - (allDays.length - eachDay(range.since, range.until).length) : di
          const total = inCurrent ? eachDay(range.since, range.until).length : allDays.length - eachDay(range.since, range.until).length
          const m = simulateDay(ad, perAdBudget, idxInRange, total, spec.ecommerce, r)
          if (inCurrent) {
            rows.push({ ...m, date, campaignId: cid, campaignName: c.name, adsetId: sid, adsetName: as.name, adId: aid, adName: ad.name })
            adImpr[aid] = (adImpr[aid] ?? 0) + m.impressions
          } else {
            addInto(prevTotals, m)
          }
        })
      })
    })
  })

  const totals = emptyMetrics()
  for (const r of rows) addInto(totals, r)
  const adReach: Record<string, ReachStats> = {}
  for (const ad of ads) {
    const spec = findAdSpec(account.id, ad.name)
    const freq = (spec?.fatigue ? 3.4 : 1.6) + (hash(ad.id) % 50) / 100
    adReach[ad.id] = { frequency: freq, reach: Math.round((adImpr[ad.id] ?? 0) / freq) }
  }
  const reachOf = (m: Metrics) => ({ frequency: 2.1, reach: Math.round(m.impressions / 2.1) })
  return {
    account,
    range,
    previousRange: prev,
    rows,
    totals: { ...totals, ...reachOf(totals) },
    previousTotals: { ...prevTotals, ...reachOf(prevTotals) },
    adReach,
    campaigns,
    adsets,
    ads,
    fetchedAt: Date.now(),
    isDemo: true
  }
}

function findAdSpec(accountId: string, name: string): AdSpec | undefined {
  for (const c of SPECS[accountId].campaigns) for (const s of c.adsets) for (const a of s.ads) if (a.name === name) return a
}
