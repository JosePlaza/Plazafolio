/**
 * Sistema de puntuacion para prioridad de compra basado en el metodo Geraldine Weiss.
 *
 * El score combina multiples factores:
 * 1. Posicion del yield actual respecto a las bandas historicas (factor principal, 0-45 pts)
 * 2. Crecimiento del dividendo (CAGR) — premia empresas con crecimiento sostenido (0-12 pts)
 * 3. Consistencia/estabilidad — cuantos anos consecutivos pagando dividendos (0-8 pts)
 * 4. Margen de seguridad — distancia del precio actual al precio de infravaloracion (0-5 pts)
 * 5. Dividend streak — anos consecutivos de incremento del dividendo (0-12 pts)
 * 6. Payout ratio — penalizacion si el payout es insostenible (0 a -8 pts, bonus hasta +5 pts)
 * 7. Fundamentales — deuda/EBITDA y dilucion de acciones (0 a -7 pts, bonus hasta +5 pts)
 *
 * Score total: 0-100, donde 100 = maxima prioridad de compra
 *
 * Distribucion de pesos (max teorico ~92 pts sin penalizaciones):
 *   Yield position: 45  (dominante, fiel a Geraldine Weiss)
 *   CAGR:           12
 *   Consistencia:    8
 *   Margen:          5
 *   Streak:         12
 *   Payout:       -8/+5
 *   Fundamentales: -7/+5
 */

/**
 * Calcula anos consecutivos de incremento del dividendo anual.
 * @param {Array} dividends - Array de pagos individuales [{date, amount}]
 * @returns {number} Anos consecutivos de incremento (streak)
 */
function calcDividendStreak(dividends) {
  if (!dividends || dividends.length === 0) return 0

  // Agrupar dividendos por ano fiscal: total y count por ano
  // Usar media por pago en vez de total anual para evitar falsos cortes
  // en pagadores mensuales (REITs) donde el numero de ex-dates por ano varia
  const byYear = {}
  for (const d of dividends) {
    const year = String(d.date).substring(0, 4)
    const amt = Number(d.amount || d.dividend || 0)
    if (amt > 0) {
      if (!byYear[year]) byYear[year] = { total: 0, count: 0 }
      byYear[year].total += amt
      byYear[year].count++
    }
  }

  // Excluir ano actual (incompleto — rompe el streak falsamente)
  const currentYear = String(new Date().getFullYear())
  delete byYear[currentYear]

  const years = Object.keys(byYear).sort()
  if (years.length < 2) return 0

  // Contar anos consecutivos de crecimiento desde el mas reciente hacia atras
  // Comparar media por pago, no total anual
  let streak = 0
  for (let i = years.length - 1; i > 0; i--) {
    const currAvg = byYear[years[i]].total / byYear[years[i]].count
    const prevAvg = byYear[years[i - 1]].total / byYear[years[i - 1]].count
    if (currAvg > prevAvg * 1.005) {
      streak++
    } else {
      break
    }
  }

  return streak
}

/**
 * Calcula el payout ratio basado en datos de cash flow.
 * @param {Array} cashFlow - Array de [{date, dividendsPaid, freeCashFlow, netIncome}]
 * @returns {{ payoutRatio: number|null, fcfPayout: number|null }}
 */
function calcPayoutMetrics(cashFlow) {
  if (!cashFlow || cashFlow.length === 0) return { payoutRatio: null, fcfPayout: null }

  // Usar el ano mas reciente con datos validos
  // cashFlow suele venir ordenado del mas reciente al mas antiguo
  for (const cf of cashFlow) {
    const divPaid = Math.abs(Number(cf.dividendsPaid || cf.dividendPaid || 0))
    const fcf = Number(cf.freeCashFlow || 0)
    const netIncome = Number(cf.netIncome || 0)

    if (divPaid > 0) {
      const fcfPayout = fcf > 0 ? (divPaid / fcf) * 100 : null
      const payoutRatio = netIncome > 0 ? (divPaid / netIncome) * 100 : null
      return { payoutRatio, fcfPayout }
    }
  }

  return { payoutRatio: null, fcfPayout: null }
}

/**
 * Extrae metricas fundamentales relevantes.
 * @param {Object} fundamentals - { income: [], balance: [], cashFlow: [], enterpriseValue: [] }
 * @returns {{ debtToEbitda: number|null, sharesDilution: number|null }}
 */
function calcFundamentalMetrics(fundamentals) {
  if (!fundamentals) return { debtToEbitda: null, sharesDilution: null }

  // Debt/EBITDA del dato mas reciente
  let debtToEbitda = null
  const income = fundamentals.income || []
  const balance = fundamentals.balance || []

  if (income.length > 0 && balance.length > 0) {
    const latestIncome = income[0]
    const latestBalance = balance[0]
    const ebitda = Number(latestIncome.ebitda || latestIncome.ebitdaratio && latestIncome.revenue
      ? latestIncome.ebitdaratio * latestIncome.revenue : 0)
    const totalDebt = Number(latestBalance.totalDebt || latestBalance.longTermDebt || 0)

    if (ebitda > 0) {
      debtToEbitda = totalDebt / ebitda
    }
  }

  // Dilucion de acciones: comparar shares outstanding mas reciente vs hace 3-5 anos
  let sharesDilution = null
  if (income.length >= 2) {
    const recentShares = Number(income[0].weightedAverageShsOut || income[0].weightedAverageShsOutDil || 0)
    // Intentar 3-4 anos atras, si no hay, usar el ultimo disponible
    const oldIdx = Math.min(income.length - 1, 4)
    const oldShares = Number(income[oldIdx].weightedAverageShsOut || income[oldIdx].weightedAverageShsOutDil || 0)

    if (recentShares > 0 && oldShares > 0) {
      // Porcentaje de cambio: positivo = dilucion, negativo = recompra (bueno)
      sharesDilution = ((recentShares - oldShares) / oldShares) * 100
    }
  }

  return { debtToEbitda, sharesDilution }
}

/**
 * Calcula el score de prioridad de compra para un activo
 * @param {Object} indicators - { currentYield, avgHighYield, avgLowYield, avgYield, currentPrice, undervaluedPrice, overvaluedPrice }
 * @param {Object} projection - { cagr, historical }
 * @param {Array} dividends - Array de pagos de dividendos individuales
 * @param {Array} [cashFlow] - Array de datos de cash flow (opcional)
 * @param {Object} [fundamentals] - Datos fundamentales (opcional)
 * @returns {Object} { score, breakdown, signal, heat }
 */
export function computeBuyScore(indicators, projection, dividends, cashFlow, fundamentals) {
  if (!indicators || !indicators.avgHighYield || !indicators.avgLowYield) {
    return { score: 0, breakdown: {}, signal: 'sin datos', heat: 0 }
  }

  const {
    currentYield,
    avgHighYield,
    avgLowYield,
    currentPrice,
    undervaluedPrice,
  } = indicators

  const range = avgHighYield - avgLowYield
  if (range <= 0) return { score: 0, breakdown: {}, signal: 'sin datos', heat: 0 }

  // == 1. Yield Position Score (0-45) ==========================================
  // Mide donde esta el yield actual dentro del rango historico
  let yieldRatio = (currentYield - avgLowYield) / range
  yieldRatio = Math.max(0, yieldRatio)

  let yieldScore
  if (yieldRatio >= 1.0) {
    // En zona de compra: 32-45 pts
    const excess = Math.min(yieldRatio - 1.0, 0.5)
    yieldScore = 32 + (excess / 0.5) * 13
  } else if (yieldRatio >= 0.7) {
    // Acercandose a compra: 22-32 pts
    yieldScore = 22 + ((yieldRatio - 0.7) / 0.3) * 10
  } else if (yieldRatio >= 0.4) {
    // Zona media: 10-22 pts
    yieldScore = 10 + ((yieldRatio - 0.4) / 0.3) * 12
  } else {
    // Zona cara / sobrevalorada: 0-10 pts
    yieldScore = (yieldRatio / 0.4) * 10
  }

  // == 2. CAGR Score (0-12) ====================================================
  const cagr = projection?.cagr || 0
  let cagrScore = 0
  if (cagr > 0) {
    // CAGR de 5% ~ 4 pts, 10% ~ 8 pts, 15%+ = 12 pts
    cagrScore = Math.min(cagr * 0.8, 12)
  } else if (cagr < 0) {
    cagrScore = Math.max(cagr * 0.5, -4)
  }

  // == 3. Consistencia Score (0-8) =============================================
  // Anos con dividendos pagados
  let consistencyScore = 0
  if (dividends && dividends.length > 0) {
    const years = new Set(dividends.map((d) => String(d.date).substring(0, 4)))
    const yearCount = years.size
    // 4 anos = 4 pts, 8+ anos = 8 pts
    consistencyScore = Math.min(yearCount, 8)
  }

  // == 4. Margen de seguridad (0-5) ============================================
  let marginScore = 0
  if (undervaluedPrice > 0 && currentPrice > 0) {
    const upside = (undervaluedPrice - currentPrice) / currentPrice
    if (upside > 0) {
      marginScore = Math.min(upside / 0.3, 1) * 5
    }
  }

  // == 5. Dividend Streak Score (0-12) =========================================
  // Anos consecutivos de incremento del dividendo anual
  const streak = calcDividendStreak(dividends)
  let streakScore = 0
  if (streak >= 25) {
    streakScore = 12 // Dividend Aristocrat+
  } else if (streak >= 10) {
    // 10-24 anos: 8-11 pts
    streakScore = 8 + ((streak - 10) / 15) * 4
  } else if (streak >= 5) {
    // 5-9 anos: 4-8 pts
    streakScore = 4 + ((streak - 5) / 5) * 4
  } else if (streak > 0) {
    // 1-4 anos: 1-4 pts
    streakScore = streak
  }

  // == 6. Payout Ratio Score (-8 a +5) =========================================
  // Penaliza payout insostenible, premia payout saludable
  let payoutScore = 0
  const { fcfPayout, payoutRatio } = calcPayoutMetrics(cashFlow)
  const payout = fcfPayout ?? payoutRatio // Preferir FCF payout

  if (payout !== null) {
    if (payout < 30) {
      payoutScore = 5 // Payout muy bajo, mucho margen de crecimiento
    } else if (payout < 50) {
      payoutScore = 3 // Saludable
    } else if (payout < 70) {
      payoutScore = 1 // Aceptable
    } else if (payout < 85) {
      payoutScore = 0 // Limite
    } else if (payout < 100) {
      payoutScore = -4 // Peligro
    } else {
      payoutScore = -8 // Insostenible (paga mas de lo que genera)
    }
  }

  // == 7. Fundamentales Score (-7 a +5) ========================================
  let fundamentalsScore = 0
  const { debtToEbitda, sharesDilution } = calcFundamentalMetrics(fundamentals)

  // Deuda/EBITDA
  let debtScore = 0
  if (debtToEbitda !== null) {
    if (debtToEbitda < 1) {
      debtScore = 3 // Baja deuda, excelente
    } else if (debtToEbitda < 2) {
      debtScore = 2 // Manejable
    } else if (debtToEbitda < 3) {
      debtScore = 0 // Normal
    } else if (debtToEbitda < 5) {
      debtScore = -2 // Alta
    } else {
      debtScore = -4 // Muy alta
    }
  }

  // Dilucion de acciones
  let dilutionScore = 0
  if (sharesDilution !== null) {
    if (sharesDilution < -5) {
      dilutionScore = 2 // Recompra significativa, bueno para dividendos
    } else if (sharesDilution < -1) {
      dilutionScore = 1 // Ligera recompra
    } else if (sharesDilution < 3) {
      dilutionScore = 0 // Estable
    } else if (sharesDilution < 10) {
      dilutionScore = -1 // Ligera dilucion
    } else {
      dilutionScore = -3 // Dilucion significativa
    }
  }

  fundamentalsScore = debtScore + dilutionScore

  // == Total ==================================================================
  const rawScore = yieldScore + cagrScore + consistencyScore + marginScore +
                   streakScore + payoutScore + fundamentalsScore
  const score = Math.max(0, Math.min(100, rawScore))

  // == Signal =================================================================
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
      streak: Math.round(streakScore * 10) / 10,
      payout: Math.round(payoutScore * 10) / 10,
      fundamentals: Math.round(fundamentalsScore * 10) / 10,
    },
    details: {
      dividendStreak: streak,
      payoutRatio: payout !== null ? Math.round(payout) : null,
      debtToEbitda: debtToEbitda !== null ? Math.round(debtToEbitda * 10) / 10 : null,
      sharesDilution: sharesDilution !== null ? Math.round(sharesDilution * 10) / 10 : null,
    },
    signal,
    heat,
  }
}
