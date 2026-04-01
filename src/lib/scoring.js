/**
 * Sistema de puntuación para prioridad de compra basado en el método Geraldine Weiss.
 *
 * El score combina múltiples factores:
 * 1. Posición del yield actual respecto a las bandas históricas (factor principal, 0-70 pts)
 * 2. Crecimiento del dividendo (CAGR) — premia empresas con crecimiento sostenido (0-15 pts)
 * 3. Consistencia/estabilidad — cuántos años consecutivos pagando dividendos (0-10 pts)
 * 4. Margen de seguridad — distancia del precio actual al precio de infravaloración (0-5 pts)
 *
 * Score total: 0-100, donde 100 = máxima prioridad de compra
 */

/**
 * Calcula el score de prioridad de compra para un activo
 * @param {Object} indicators - { currentYield, avgHighYield, avgLowYield, avgYield, currentPrice, undervaluedPrice, overvaluedPrice }
 * @param {Object} projection - { cagr, historical }
 * @param {Array} dividends - Array de pagos de dividendos individuales
 * @returns {Object} { score, breakdown, signal, heat }
 */
export function computeBuyScore(indicators, projection, dividends) {
  if (!indicators || !indicators.avgHighYield || !indicators.avgLowYield) {
    return { score: 0, breakdown: {}, signal: 'sin datos', heat: 0 }
  }

  const {
    currentYield,
    avgHighYield,
    avgLowYield,
    avgYield,
    currentPrice,
    undervaluedPrice,
  } = indicators

  const range = avgHighYield - avgLowYield
  if (range <= 0) return { score: 0, breakdown: {}, signal: 'sin datos', heat: 0 }

  // ── 1. Yield Position Score (0-70) ──────────────────────────────────────
  // Mide dónde está el yield actual dentro del rango histórico
  // Si currentYield >= avgHighYield → zona de compra fuerte
  // Si currentYield <= avgLowYield → zona de venta
  let yieldRatio = (currentYield - avgLowYield) / range // 0 = en low, 1 = en high
  // Permitir que supere 1.0 si está por encima del high yield (extra caliente)
  yieldRatio = Math.max(0, yieldRatio)

  let yieldScore
  if (yieldRatio >= 1.0) {
    // En zona de compra: 50-70 pts, más puntos cuanto más profundo
    const excess = Math.min(yieldRatio - 1.0, 0.5) // Cap extra at 0.5
    yieldScore = 50 + (excess / 0.5) * 20
  } else if (yieldRatio >= 0.7) {
    // Acercándose a compra: 35-50 pts
    yieldScore = 35 + ((yieldRatio - 0.7) / 0.3) * 15
  } else if (yieldRatio >= 0.4) {
    // Zona media: 15-35 pts
    yieldScore = 15 + ((yieldRatio - 0.4) / 0.3) * 20
  } else {
    // Zona cara / sobrevalorada: 0-15 pts
    yieldScore = (yieldRatio / 0.4) * 15
  }

  // ── 2. CAGR Score (0-15) ────────────────────────────────────────────────
  // Premia crecimiento del dividendo sostenido
  const cagr = projection?.cagr || 0
  let cagrScore = 0
  if (cagr > 0) {
    // CAGR de 5% ≈ 7.5 pts, 10% ≈ 12.5 pts, 15%+ = 15 pts
    cagrScore = Math.min(cagr * 1.0, 15)
  } else if (cagr < 0) {
    // Penalizar si el dividendo decrece
    cagrScore = Math.max(cagr * 0.5, -5)
  }

  // ── 3. Consistencia Score (0-10) ────────────────────────────────────────
  // Años con dividendos pagados
  let consistencyScore = 0
  if (dividends && dividends.length > 0) {
    const years = new Set(dividends.map((d) => String(d.date).substring(0, 4)))
    const yearCount = years.size
    // 5 años = 5 pts, 10+ años = 10 pts
    consistencyScore = Math.min(yearCount, 10)
  }

  // ── 4. Margen de seguridad (0-5) ───────────────────────────────────────
  // Distancia del precio actual al precio de infravaloración (potencial alcista)
  let marginScore = 0
  if (undervaluedPrice > 0 && currentPrice > 0) {
    const upside = (undervaluedPrice - currentPrice) / currentPrice
    if (upside > 0) {
      // Hay potencial alcista: max 5 pts para 30%+ upside
      marginScore = Math.min(upside / 0.3, 1) * 5
    }
  }

  // ── Total ──────────────────────────────────────────────────────────────
  const score = Math.max(0, Math.min(100, yieldScore + cagrScore + consistencyScore + marginScore))

  // ── Signal ─────────────────────────────────────────────────────────────
  let signal, heat
  if (score >= 75) {
    signal = 'Compra fuerte'
    heat = 5
  } else if (score >= 60) {
    signal = 'Compra'
    heat = 4
  } else if (score >= 45) {
    signal = 'Vigilar'
    heat = 3
  } else if (score >= 30) {
    signal = 'Mantener'
    heat = 2
  } else if (score >= 15) {
    signal = 'Caro'
    heat = 1
  } else {
    signal = 'Vender'
    heat = 0
  }

  return {
    score: Math.round(score * 10) / 10,
    breakdown: {
      yield: Math.round(yieldScore * 10) / 10,
      cagr: Math.round(cagrScore * 10) / 10,
      consistency: Math.round(consistencyScore * 10) / 10,
      margin: Math.round(marginScore * 10) / 10,
    },
    signal,
    heat,
  }
}
