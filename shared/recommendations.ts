import { money, pct, ratio, dec } from './format'
import { emptyMetrics, addInto, groupBy, kpis, pctChange, type EntityStats } from './metrics'
import type { AccountReport, BusinessMode, Metrics, Recommendation, Severity, Targets } from './types'

const ORDER: Record<Severity, number> = { critical: 0, warning: 1, opportunity: 2, info: 3 }

interface Ctx {
  mode: BusinessMode
  cur: string
  targetCpl: number
  targetRoas: number
  avgCtr: number
  avgCpm: number
  aov: number
}

/**
 * Rule-based analyst. Every rule needs a minimum of data before it fires so that
 * low-spend noise doesn't produce "pause this ad" advice.
 */
export function buildRecommendations(report: AccountReport, mode: BusinessMode, targets: Targets): Recommendation[] {
  const t = report.totals
  const k = kpis(t)
  const ctx: Ctx = {
    mode,
    cur: report.account.currency,
    targetCpl: targets.cpl > 0 ? targets.cpl : k.cpl,
    targetRoas: targets.roas > 0 ? targets.roas : k.roas,
    avgCtr: k.ctr,
    avgCpm: k.cpm,
    aov: k.aov
  }
  const recs: Recommendation[] = []
  if (t.spend <= 0) {
    return [
      {
        id: 'no-spend',
        severity: 'info',
        category: 'tendencia',
        title: 'Sin inversión en este periodo',
        detail: 'La cuenta no tiene gasto en el rango seleccionado.',
        action: 'Elige otro rango de fechas o activa campañas.'
      }
    ]
  }

  const ads = groupBy(report.rows, 'ad')
  const adsets = groupBy(report.rows, 'adset')
  const campaigns = groupBy(report.rows, 'campaign')

  accountRules(report, ctx, recs)
  for (const ad of ads.values()) adRules(ad, report, ctx, recs)
  adsetRules(adsets, report, ctx, recs)
  budgetRules(campaigns, ctx, recs)
  winnerRules(ads, ctx, recs)

  return recs.sort((a, b) => ORDER[a.severity] - ORDER[b.severity])
}

function accountRules(report: AccountReport, c: Ctx, recs: Recommendation[]) {
  const now = kpis(report.totals)
  const prev = kpis(report.previousTotals)
  if (c.mode === 'leadgen') {
    const ch = pctChange(now.cpl, prev.cpl)
    if (ch !== null && now.leads >= 10 && ch >= 25) {
      recs.push({
        id: 'acc-cpl-up',
        severity: 'warning',
        category: 'tendencia',
        title: `El CPL ha subido un ${dec(ch, 0)} % frente al periodo anterior`,
        detail: `CPL actual ${money(now.cpl, c.cur)} vs ${money(prev.cpl, c.cur)} antes. CTR ${pct(now.ctr)} (antes ${pct(prev.ctr)}), CPM ${money(now.cpm, c.cur)} (antes ${money(prev.cpm, c.cur)}).`,
        action:
          now.cpm > prev.cpm * 1.2
            ? 'El coste de la subasta ha subido: amplía audiencias (Advantage+), prueba nuevas ubicaciones y refresca creatividades.'
            : 'La subasta no es el problema: revisa creatividades (CTR) y la tasa de conversión del formulario o landing.',
        entity: { level: 'account', id: report.account.id, name: report.account.name }
      })
    } else if (ch !== null && now.leads >= 10 && ch <= -15) {
      recs.push({
        id: 'acc-cpl-down',
        severity: 'opportunity',
        category: 'escala',
        title: `El CPL ha bajado un ${dec(-ch, 0)} %: buen momento para escalar`,
        detail: `CPL ${money(now.cpl, c.cur)} vs ${money(prev.cpl, c.cur)} el periodo anterior.`,
        action: 'Sube presupuesto un 15-20 % cada 3-4 días en los conjuntos con mejor CPL para no reiniciar el aprendizaje.'
      })
    }
    if (now.leads >= 20 && now.leadRate < 5 && now.linkClicks > 300) {
      recs.push({
        id: 'acc-leadrate',
        severity: 'warning',
        category: 'conversion',
        title: `Solo el ${pct(now.leadRate, 1)} de los clics se convierte en lead`,
        detail: 'Los anuncios atraen clics pero la página o el formulario no convierten. En lead gen lo habitual es 8-15 % (landing) o 15-30 % (formulario instantáneo).',
        action: 'Acorta el formulario, pon la promesa del anuncio en el titular de la landing, añade prueba social y revisa la velocidad en móvil.'
      })
    }
  } else {
    const ch = pctChange(now.roas, prev.roas)
    if (ch !== null && now.purchases >= 10 && ch <= -20) {
      recs.push({
        id: 'acc-roas-down',
        severity: 'warning',
        category: 'tendencia',
        title: `El ROAS ha caído un ${dec(-ch, 0)} % frente al periodo anterior`,
        detail: `ROAS ${ratio(now.roas)} vs ${ratio(prev.roas)}. Ticket medio ${money(now.aov, c.cur)} (antes ${money(prev.aov, c.cur)}), CPA ${money(now.cpa, c.cur)} (antes ${money(prev.cpa, c.cur)}).`,
        action:
          now.aov < prev.aov * 0.9
            ? 'El ticket medio ha bajado: impulsa bundles, envío gratis a partir de un importe o upsells en el checkout.'
            : 'El coste por compra ha subido: rota creatividades y revisa la tasa de conversión de la web.'
      })
    }
    if (now.linkClicks > 300 && report.totals.addToCart > 30) {
      const checkoutToPurchase = now.purchases / Math.max(1, report.totals.initiateCheckout)
      const atcToPurchase = now.purchases / Math.max(1, report.totals.addToCart)
      if (atcToPurchase < 0.2) {
        recs.push({
          id: 'acc-cart-abandon',
          severity: 'warning',
          category: 'conversion',
          title: `Solo el ${pct(atcToPurchase * 100, 1)} de los carritos acaba en compra`,
          detail: `Añadidos al carrito ${report.totals.addToCart}, pagos iniciados ${report.totals.initiateCheckout}, compras ${now.purchases} (checkout → compra ${pct(checkoutToPurchase * 100, 1)}).`,
          action: 'Revisa costes de envío sorpresa, métodos de pago (Bizum, Apple Pay, PayPal) y lanza una campaña de retargeting a carritos abandonados de 7 días.'
        })
      }
    }
  }
  if (now.linkClicks > 300 && report.totals.landingPageViews > 0 && now.lpvRate < 65) {
    recs.push({
      id: 'acc-lpv',
      severity: 'warning',
      category: 'conversion',
      title: `Se pierde el ${pct(100 - now.lpvRate, 0)} de los clics antes de cargar la web`,
      detail: `${report.totals.linkClicks} clics en enlace pero solo ${report.totals.landingPageViews} visitas a la página de destino.`,
      action: 'La web carga lento en móvil: comprime imágenes, quita scripts innecesarios y apunta a menos de 2,5 s de LCP.'
    })
  }
}

function adRules(ad: EntityStats, report: AccountReport, c: Ctx, recs: Recommendation[]) {
  const m = ad.metrics
  const k = kpis(m)
  const ent = { level: 'ad' as const, id: ad.id, name: ad.name }
  const info = report.ads.find((a) => a.id === ad.id)
  const active = !info || info.effectiveStatus === 'ACTIVE'
  if (!active) return

  if (c.mode === 'leadgen' && c.targetCpl > 0) {
    if (m.leads === 0 && m.spend >= c.targetCpl * 2) {
      recs.push({
        id: `ad-nolead-${ad.id}`,
        severity: 'critical',
        category: 'presupuesto',
        title: `"${ad.name}" ha gastado ${money(m.spend, c.cur)} sin ningún lead`,
        detail: `Es más de 2 veces tu CPL objetivo (${money(c.targetCpl, c.cur)}). CTR ${pct(k.ctr)}.`,
        action: 'Pausa el anuncio y mueve el presupuesto a los anuncios que ya convierten.',
        entity: ent
      })
    } else if (k.cpl > c.targetCpl * 3 && m.spend >= c.targetCpl * 3) {
      recs.push({
        id: `ad-highcpl-${ad.id}`,
        severity: 'critical',
        category: 'presupuesto',
        title: `"${ad.name}" consigue leads a ${money(k.cpl, c.cur)}, ${dec(k.cpl / c.targetCpl, 1)}x tu objetivo`,
        detail: `Solo ${m.leads} leads con ${money(m.spend, c.cur)} invertidos. CTR ${pct(k.ctr)}.`,
        action: 'Pausa el anuncio y mueve el presupuesto a los anuncios con mejor CPL del mismo conjunto.',
        entity: ent
      })
    } else if (m.leads >= 3 && k.cpl > c.targetCpl * 1.6 && m.spend >= c.targetCpl * 3) {
      recs.push({
        id: `ad-highcpl-${ad.id}`,
        severity: 'warning',
        category: 'presupuesto',
        title: `"${ad.name}" tiene un CPL ${dec(k.cpl / c.targetCpl, 1)}x por encima del objetivo`,
        detail: `CPL ${money(k.cpl, c.cur)} con ${m.leads} leads y ${money(m.spend, c.cur)} invertidos.`,
        action: 'Pausa o baja su presupuesto; si tiene buen CTR, el problema está después del clic (oferta o formulario).',
        entity: ent
      })
    }
  }

  if (c.mode === 'ecommerce' && c.targetRoas > 0) {
    const minSpend = Math.max(c.aov * 2, 30)
    if (m.purchases === 0 && m.spend >= minSpend) {
      recs.push({
        id: `ad-nopurchase-${ad.id}`,
        severity: 'critical',
        category: 'presupuesto',
        title: `"${ad.name}" ha gastado ${money(m.spend, c.cur)} sin ventas`,
        detail: `Equivale a más de 2 pedidos medios (${money(c.aov, c.cur)}). Añadidos al carrito: ${m.addToCart}.`,
        action: m.addToCart > 3 ? 'Genera carritos pero no ventas: revisa precio y checkout antes de pausar.' : 'Pausa el anuncio y prueba otro ángulo creativo.',
        entity: ent
      })
    } else if (m.purchases >= 2 && k.roas < c.targetRoas * 0.6 && m.spend >= minSpend) {
      recs.push({
        id: `ad-lowroas-${ad.id}`,
        severity: 'warning',
        category: 'presupuesto',
        title: `"${ad.name}" tiene un ROAS de ${ratio(k.roas)} (objetivo ${ratio(c.targetRoas)})`,
        detail: `${m.purchases} compras, ${money(m.purchaseValue, c.cur)} de ingresos con ${money(m.spend, c.cur)} de gasto.`,
        action: 'Baja presupuesto o pausa. Si es un anuncio de prospección nuevo, dale 3-4 días más antes de decidir.',
        entity: ent
      })
    }
  }

  if (m.impressions >= 3000 && k.ctr < Math.min(0.7, c.avgCtr * 0.5)) {
    recs.push({
      id: `ad-lowctr-${ad.id}`,
      severity: 'warning',
      category: 'creatividad',
      title: `"${ad.name}" no engancha: CTR ${pct(k.ctr)}`,
      detail: `La media de la cuenta es ${pct(c.avgCtr)}. Un CTR bajo encarece todo lo demás.`,
      action: 'Cambia los 3 primeros segundos (gancho), usa texto grande en el vídeo y una promesa concreta en el titular.',
      entity: ent
    })
  }

  // Creative fatigue: CTR in the most recent days well below the first days, with high frequency.
  const days = [...ad.daily.entries()].sort(([a], [b]) => a.localeCompare(b))
  const freq = report.adReach[ad.id]?.frequency ?? 0
  if (days.length >= 7 && m.impressions >= 5000) {
    const third = Math.max(2, Math.floor(days.length / 3))
    const early = sumRange(days.slice(0, third))
    const late = sumRange(days.slice(-third))
    const ctrEarly = kpis(early).ctr
    const ctrLate = kpis(late).ctr
    if (early.impressions > 1000 && late.impressions > 1000 && ctrLate < ctrEarly * 0.7 && freq >= 2.5) {
      recs.push({
        id: `ad-fatigue-${ad.id}`,
        severity: 'warning',
        category: 'creatividad',
        title: `Fatiga creativa en "${ad.name}"`,
        detail: `El CTR ha caído de ${pct(ctrEarly)} a ${pct(ctrLate)} y la frecuencia es ${dec(freq, 1)}. La audiencia ya lo ha visto demasiadas veces.`,
        action: 'Lanza 2-3 variaciones del mismo ángulo (nuevo gancho, nuevo formato) en el mismo conjunto y deja que Meta reparta.',
        entity: ent
      })
    }
  }

  if (m.impressions >= 5000 && k.cpm > c.avgCpm * 2 && c.avgCpm > 0) {
    recs.push({
      id: `ad-cpm-${ad.id}`,
      severity: 'info',
      category: 'audiencia',
      title: `CPM muy alto en "${ad.name}" (${money(k.cpm, c.cur)})`,
      detail: `El doble de la media de la cuenta (${money(c.avgCpm, c.cur)}). Suele indicar una audiencia demasiado pequeña o muy competida.`,
      action: 'Amplía la segmentación o pásalo a una campaña Advantage+ con audiencia amplia.',
      entity: ent
    })
  }
}

function adsetRules(adsets: Map<string, EntityStats>, report: AccountReport, c: Ctx, recs: Recommendation[]) {
  const days = Math.max(1, report.rows.length ? new Set(report.rows.map((r) => r.date)).size : 1)
  const learning = [...adsets.values()].filter((s) => {
    const info = report.adsets.find((a) => a.id === s.id)
    if (info && info.effectiveStatus !== 'ACTIVE') return false
    const conv = c.mode === 'leadgen' ? s.metrics.leads : s.metrics.purchases
    const weekly = (conv / days) * 7
    return s.metrics.spend > 0 && weekly < 50
  })
  const activeCount = [...adsets.values()].filter((s) => s.metrics.spend > 0).length
  if (activeCount >= 4 && learning.length / activeCount >= 0.6) {
    recs.push({
      id: 'adset-learning',
      severity: 'warning',
      category: 'estructura',
      title: `${learning.length} de ${activeCount} conjuntos no llegan a 50 conversiones/semana`,
      detail: 'Meta necesita ~50 conversiones semanales por conjunto para salir de la fase de aprendizaje. Con el presupuesto tan repartido, ninguno optimiza bien.',
      action: 'Consolida: menos conjuntos, audiencias más amplias y más anuncios por conjunto (o usa presupuesto a nivel de campaña).'
    })
  }
}

function budgetRules(campaigns: Map<string, EntityStats>, c: Ctx, recs: Recommendation[]) {
  const list = [...campaigns.values()].filter((x) => x.metrics.spend > 0)
  const total = list.reduce((s, x) => s + x.metrics.spend, 0)
  if (list.length < 2 || total <= 0) return
  const eff = (x: EntityStats) => (c.mode === 'leadgen' ? kpis(x.metrics).cpl : -kpis(x.metrics).roas)
  const withResults = list.filter((x) => (c.mode === 'leadgen' ? x.metrics.leads : x.metrics.purchases) >= 3)
  if (withResults.length < 2) return
  withResults.sort((a, b) => eff(a) - eff(b))
  const best = withResults[0]
  const worst = withResults[withResults.length - 1]
  const bestShare = best.metrics.spend / total
  const worstShare = worst.metrics.spend / total
  if (worstShare > bestShare && worst.id !== best.id) {
    const metric = (x: EntityStats) => (c.mode === 'leadgen' ? `CPL ${money(kpis(x.metrics).cpl, c.cur)}` : `ROAS ${ratio(kpis(x.metrics).roas)}`)
    recs.push({
      id: 'budget-realloc',
      severity: 'opportunity',
      category: 'presupuesto',
      title: 'El presupuesto está en la campaña menos eficiente',
      detail: `"${worst.name}" se lleva el ${pct(worstShare * 100, 0)} del gasto con ${metric(worst)}, mientras "${best.name}" solo el ${pct(bestShare * 100, 0)} con ${metric(best)}.`,
      action: `Mueve un 20-30 % del presupuesto de "${worst.name}" a "${best.name}".`,
      entity: { level: 'campaign', id: best.id, name: best.name }
    })
  }
}

function winnerRules(ads: Map<string, EntityStats>, c: Ctx, recs: Recommendation[]) {
  const list = [...ads.values()]
  if (c.mode === 'leadgen' && c.targetCpl > 0) {
    const winners = list
      .filter((a) => a.metrics.leads >= 5 && kpis(a.metrics).cpl <= c.targetCpl * 0.75)
      .sort((a, b) => b.metrics.leads - a.metrics.leads)
      .slice(0, 3)
    for (const w of winners) {
      recs.push({
        id: `win-${w.id}`,
        severity: 'opportunity',
        category: 'escala',
        title: `Anuncio ganador: "${w.name}"`,
        detail: `${w.metrics.leads} leads a ${money(kpis(w.metrics).cpl, c.cur)} (un ${dec((1 - kpis(w.metrics).cpl / c.targetCpl) * 100, 0)} % por debajo del objetivo).`,
        action: 'Escálalo: duplícalo en una campaña con presupuesto mayor y crea 3 variaciones del mismo ángulo con distintos ganchos.',
        entity: { level: 'ad', id: w.id, name: w.name }
      })
    }
  } else if (c.mode === 'ecommerce' && c.targetRoas > 0) {
    const winners = list
      .filter((a) => a.metrics.purchases >= 3 && kpis(a.metrics).roas >= c.targetRoas * 1.3)
      .sort((a, b) => b.metrics.purchaseValue - a.metrics.purchaseValue)
      .slice(0, 3)
    for (const w of winners) {
      recs.push({
        id: `win-${w.id}`,
        severity: 'opportunity',
        category: 'escala',
        title: `Anuncio ganador: "${w.name}"`,
        detail: `ROAS ${ratio(kpis(w.metrics).roas)} con ${w.metrics.purchases} compras y ${money(w.metrics.purchaseValue, c.cur)} de ingresos.`,
        action: 'Escálalo con +20 % de presupuesto cada 3 días o llévalo a una campaña Advantage+ Shopping; crea variaciones UGC del mismo producto.',
        entity: { level: 'ad', id: w.id, name: w.name }
      })
    }
  }
}

function sumRange(days: [string, Metrics][]): Metrics {
  const m = emptyMetrics()
  for (const [, d] of days) addInto(m, d)
  return m
}
