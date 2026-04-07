/**
 * Dividend Safety Radar — Scoring engine
 *
 * Calculates a 1-10 safety score for a dividend-paying stock.
 * Uses 6 weighted factors from FMP + Yahoo Finance data.
 *
 * Score interpretation:
 *   1-3: Riesgo Alto (rojo)     — Dividend cut probable
 *   4-6: Riesgo Moderado (amarillo) — Vigilar de cerca
 *   7-10: Dividendo Seguro (verde)  — Sostenible
 *
 * REIT detection: uses adjusted thresholds for payout ratio
 * since REITs are legally required to distribute >90% of earnings.
 */

// ─── REIT Detection ─────────────────────────────────────────────────────────

const REIT_SECTORS = [
  'reit', 'real estate investment trust', 'real-estate',
  'equity real estate investment trusts', 'mortgage real estate investment trusts',
]

const REIT_SIC_RANGES = [
  [6500, 6553], // Real estate
  [6798, 6798], // REITs
]

/**
 * Detect if a ticker is a REIT based on profile data.
 * @param {Object} profile - { sector, industry, sicCode }
 * @returns {boolean}
 */
export function isReit(profile) {
  if (!profile) return false

  const sector = (profile.sector || '').toLowerCase()
  const industry = (profile.industry || '').toLowerCase()
  if (REIT_SECTORS.some(s => sector.includes(s) || industry.includes(s))) return true

  const sic = Number(profile.sicCode || profile.sic || 0)
  if (sic > 0) {
    for (const [lo, hi] of REIT_SIC_RANGES) {
      if (sic >= lo && sic <= hi) return true
    }
  }

  return false
}

// ─── Factor Calculations ────────────────────────────────────────────────────

/**
 * Payout Ratio Score (weight: 25%)
 * For REITs: AFFO payout with adjusted thresholds
 * For non-REITs: FCF payout preferred, NI payout fallback
 *
 * @param {Array} cashFlow - FMP cash flow data [{ freeCashFlow, dividendsPaid, ... }]
 * @param {boolean} isReitStock
 * @returns {{ score: number, value: number|null, label: string }}
 */
function calcPayoutScore(cashFlow, isReitStock) {
  if (!cashFlow || cashFlow.length === 0) {
    return { score: 5, value: null, label: 'Sin datos de cash flow' }
  }

  // Use most recent year with valid data
  let payout = null
  for (const cf of cashFlow) {
    const divPaid = Math.abs(Number(cf.dividendsPaid || 0))
    const fcf = Number(cf.freeCashFlow || 0)

    if (divPaid > 0 && fcf > 0) {
      payout = (divPaid / fcf) * 100
      break
    }
  }

  if (payout === null) {
    return { score: 5, value: null, label: 'Payout no calculable' }
  }

  let score
  if (isReitStock) {
    // REIT thresholds (AFFO-based, higher is normal)
    if (payout < 70) score = 10
    else if (payout < 80) score = 8
    else if (payout < 85) score = 7
    else if (payout < 90) score = 5
    else if (payout < 100) score = 3
    else score = 1
  } else {
    // Standard thresholds
    if (payout < 40) score = 10
    else if (payout < 55) score = 8
    else if (payout < 70) score = 7
    else if (payout < 85) score = 5
    else if (payout < 100) score = 3
    else score = 1
  }

  const label = payout > 100
    ? `Insostenible (${Math.round(payout)}%)`
    : payout > (isReitStock ? 90 : 85)
      ? `Alto (${Math.round(payout)}%)`
      : `${Math.round(payout)}%`

  return { score, value: Math.round(payout * 10) / 10, label }
}

/**
 * FCF Coverage Score (weight: 25%)
 * FCF / Total Dividends Paid — how many times FCF covers the dividend
 *
 * @param {Array} cashFlow
 * @returns {{ score: number, value: number|null, label: string }}
 */
function calcFcfCoverageScore(cashFlow) {
  if (!cashFlow || cashFlow.length === 0) {
    return { score: 5, value: null, label: 'Sin datos' }
  }

  // Average last 2 years for stability
  let totalFcf = 0, totalDiv = 0, count = 0
  for (const cf of cashFlow.slice(0, 2)) {
    const fcf = Number(cf.freeCashFlow || 0)
    const divPaid = Math.abs(Number(cf.dividendsPaid || 0))
    if (divPaid > 0) {
      totalFcf += fcf
      totalDiv += divPaid
      count++
    }
  }

  if (count === 0 || totalDiv === 0) {
    return { score: 5, value: null, label: 'No dividend data' }
  }

  const coverage = totalFcf / totalDiv

  let score
  if (coverage >= 3.0) score = 10
  else if (coverage >= 2.0) score = 9
  else if (coverage >= 1.5) score = 8
  else if (coverage >= 1.2) score = 7
  else if (coverage >= 1.0) score = 5
  else if (coverage >= 0.8) score = 3
  else score = 1

  const label = coverage < 1.0
    ? `Deficit (${coverage.toFixed(2)}x)`
    : `${coverage.toFixed(2)}x`

  return { score, value: Math.round(coverage * 100) / 100, label }
}

/**
 * Debt/EBITDA Trend Score (weight: 15%)
 * Evaluates leverage level AND trend (increasing debt = dangerous for dividends)
 *
 * @param {Object} fundamentals - { income: [], balance: [] }
 * @returns {{ score: number, value: number|null, trend: string, label: string }}
 */
function calcDebtScore(fundamentals) {
  if (!fundamentals || !fundamentals.income?.length || !fundamentals.balance?.length) {
    return { score: 5, value: null, trend: 'unknown', label: 'Sin datos' }
  }

  const income = fundamentals.income
  const balance = fundamentals.balance

  // Calculate Debt/EBITDA for most recent
  const latestIncome = income[income.length - 1] // sorted ascending
  const latestBalance = balance[balance.length - 1]
  const ebitda = Number(latestIncome.ebitda || 0)
  const totalDebt = Number(latestBalance.totalDebt || latestBalance.netDebt || 0)

  if (ebitda <= 0) {
    return { score: 3, value: null, trend: 'unknown', label: 'EBITDA negativo' }
  }

  const ratio = totalDebt / ebitda

  // Check trend (compare to 2 years ago if available)
  let trend = 'stable'
  if (income.length >= 3 && balance.length >= 3) {
    const oldIncome = income[income.length - 3]
    const oldBalance = balance[balance.length - 3]
    const oldEbitda = Number(oldIncome.ebitda || 0)
    const oldDebt = Number(oldBalance.totalDebt || oldBalance.netDebt || 0)
    if (oldEbitda > 0) {
      const oldRatio = oldDebt / oldEbitda
      const change = ratio - oldRatio
      if (change > 0.5) trend = 'increasing'
      else if (change < -0.5) trend = 'decreasing'
    }
  }

  let score
  if (ratio < 1) score = 10
  else if (ratio < 2) score = 8
  else if (ratio < 3) score = 6
  else if (ratio < 4) score = 4
  else if (ratio < 5) score = 2
  else score = 1

  // Adjust for trend
  if (trend === 'increasing') score = Math.max(1, score - 1)
  if (trend === 'decreasing') score = Math.min(10, score + 1)

  const trendEmoji = trend === 'increasing' ? '↑' : trend === 'decreasing' ? '↓' : '→'
  return {
    score,
    value: Math.round(ratio * 10) / 10,
    trend,
    label: `${ratio.toFixed(1)}x ${trendEmoji}`,
  }
}

/**
 * Dividend Growth Consistency Score (weight: 15%)
 * Evaluates regularity of dividend growth (cuts, freezes, growth)
 *
 * @param {Array} dividends - [{ date, amount }] individual payments
 * @returns {{ score: number, streak: number, label: string }}
 */
function calcConsistencyScore(dividends) {
  if (!dividends || dividends.length < 4) {
    return { score: 5, streak: 0, label: 'Historial insuficiente' }
  }

  // Group by year
  const byYear = {}
  for (const d of dividends) {
    const year = String(d.date).substring(0, 4)
    const amt = Number(d.amount || d.dividend || 0)
    if (amt > 0) {
      byYear[year] = (byYear[year] || 0) + amt
    }
  }

  const years = Object.keys(byYear).sort()
  if (years.length < 2) return { score: 5, streak: 0, label: 'Solo 1 año' }

  // Count consecutive growth years from most recent
  let streak = 0
  let cuts = 0
  let freezes = 0
  for (let i = years.length - 1; i > 0; i--) {
    const curr = byYear[years[i]]
    const prev = byYear[years[i - 1]]
    const change = (curr - prev) / prev

    if (change > 0.005) {
      if (cuts === 0 && freezes === 0) streak++
    } else if (change < -0.005) {
      cuts++
    } else {
      freezes++
    }
  }

  let score
  if (streak >= 20) score = 10
  else if (streak >= 10) score = 9
  else if (streak >= 5) score = 7
  else if (streak >= 3) score = 6
  else if (cuts === 0) score = 5
  else if (cuts === 1) score = 3
  else score = 1

  const label = streak > 0
    ? `${streak} años crecimiento consecutivo`
    : cuts > 0
      ? `${cuts} recorte(s) reciente(s)`
      : 'Dividendo estable'

  return { score, streak, label }
}

/**
 * EPS Trend Score (weight: 10%)
 * Falling earnings are a leading indicator of dividend cuts
 *
 * @param {Object} fundamentals - { income: [] }
 * @returns {{ score: number, trend: string, label: string }}
 */
function calcEpsScore(fundamentals) {
  if (!fundamentals?.income?.length || fundamentals.income.length < 2) {
    return { score: 5, trend: 'unknown', label: 'Sin datos EPS' }
  }

  const income = fundamentals.income // sorted ascending
  const recent = income.slice(-3) // last 3 years

  // Check if net income is declining
  let declining = 0
  for (let i = recent.length - 1; i > 0; i--) {
    const curr = Number(recent[i].netIncome || 0)
    const prev = Number(recent[i - 1].netIncome || 0)
    if (prev > 0 && curr < prev * 0.95) declining++
  }

  // Also check if latest is negative
  const latestNI = Number(recent[recent.length - 1].netIncome || 0)
  const isNegative = latestNI < 0

  let score, trend
  if (isNegative) {
    score = 1
    trend = 'negative'
  } else if (declining >= 2) {
    score = 2
    trend = 'declining'
  } else if (declining === 1) {
    score = 5
    trend = 'mixed'
  } else {
    // Growing or stable
    const first = Number(recent[0].netIncome || 0)
    const last = Number(recent[recent.length - 1].netIncome || 0)
    if (first > 0 && last > first * 1.1) {
      score = 9
      trend = 'growing'
    } else {
      score = 7
      trend = 'stable'
    }
  }

  const labels = {
    negative: 'Beneficio negativo',
    declining: 'Beneficio en declive',
    mixed: 'Beneficio irregular',
    stable: 'Beneficio estable',
    growing: 'Beneficio creciente',
    unknown: 'Sin datos',
  }

  return { score, trend, label: labels[trend] }
}

/**
 * Revenue Trend Score (weight: 10%)
 * Revenue decline is the earliest indicator of trouble
 *
 * @param {Object} fundamentals - { income: [] }
 * @returns {{ score: number, trend: string, label: string }}
 */
function calcRevenueScore(fundamentals) {
  if (!fundamentals?.income?.length || fundamentals.income.length < 2) {
    return { score: 5, trend: 'unknown', label: 'Sin datos de ingresos' }
  }

  const income = fundamentals.income
  const recent = income.slice(-3)

  let declining = 0
  for (let i = recent.length - 1; i > 0; i--) {
    const curr = Number(recent[i].totalRevenue || 0)
    const prev = Number(recent[i - 1].totalRevenue || 0)
    if (prev > 0 && curr < prev * 0.97) declining++
  }

  let score, trend
  if (declining >= 2) {
    score = 2
    trend = 'declining'
  } else if (declining === 1) {
    score = 5
    trend = 'mixed'
  } else {
    const first = Number(recent[0].totalRevenue || 0)
    const last = Number(recent[recent.length - 1].totalRevenue || 0)
    if (first > 0 && last > first * 1.1) {
      score = 9
      trend = 'growing'
    } else {
      score = 7
      trend = 'stable'
    }
  }

  const labels = {
    declining: 'Ingresos en declive',
    mixed: 'Ingresos irregulares',
    stable: 'Ingresos estables',
    growing: 'Ingresos crecientes',
    unknown: 'Sin datos',
  }

  return { score, trend, label: labels[trend] }
}

// ─── Main Scoring Function ──────────────────────────────────────────────────

/**
 * Calculate the Dividend Safety Score (1-10).
 *
 * @param {Object} params
 * @param {Array}  params.cashFlow     - FMP cash flow data (sorted recent → old)
 * @param {Object} params.fundamentals - { income: [], balance: [] } (sorted ascending)
 * @param {Array}  params.dividends    - [{ date, amount }] individual payments
 * @param {Object} params.profile      - { sector, industry, sicCode } for REIT detection
 * @returns {Object} { score, level, factors, isReit }
 */
export function computeSafetyScore({ cashFlow, fundamentals, dividends, profile }) {
  const reit = isReit(profile)

  // Calculate each factor
  const payout = calcPayoutScore(cashFlow, reit)
  const fcfCoverage = calcFcfCoverageScore(cashFlow)
  const debt = calcDebtScore(fundamentals)
  const consistency = calcConsistencyScore(dividends)
  const eps = calcEpsScore(fundamentals)
  const revenue = calcRevenueScore(fundamentals)

  // Weighted average (weights sum to 1.0)
  const weights = {
    payout: 0.25,
    fcfCoverage: 0.25,
    debt: 0.15,
    consistency: 0.15,
    eps: 0.10,
    revenue: 0.10,
  }

  const weightedScore =
    payout.score * weights.payout +
    fcfCoverage.score * weights.fcfCoverage +
    debt.score * weights.debt +
    consistency.score * weights.consistency +
    eps.score * weights.eps +
    revenue.score * weights.revenue

  // Round to 1 decimal, clamp 1-10
  const score = Math.max(1, Math.min(10, Math.round(weightedScore * 10) / 10))

  // Determine risk level
  let level, color
  if (score >= 7) {
    level = 'Seguro'
    color = 'green'
  } else if (score >= 4) {
    level = 'Moderado'
    color = 'yellow'
  } else {
    level = 'Alto Riesgo'
    color = 'red'
  }

  // Build one-liner summary with factor context
  const allFactors = [
    { key: 'Payout', ...payout },
    { key: 'FCF', ...fcfCoverage },
    { key: 'Deuda', ...debt },
    { key: 'Consistencia', ...consistency },
    { key: 'EPS', ...eps },
    { key: 'Ingresos', ...revenue },
  ]
  const topRisk = allFactors.sort((a, b) => a.score - b.score)[0]
  const summary = score >= 7
    ? `Dividendo seguro — FCF cubre ${fcfCoverage.value || '?'}x`
    : score >= 4
      ? `Vigilar — ${topRisk.key}: ${topRisk.label}`
      : `Riesgo alto — ${topRisk.key}: ${topRisk.label}`

  return {
    score,
    level,
    color,
    summary,
    isReit: reit,
    factors: [
      { name: 'Payout Ratio', weight: '25%', score: payout.score, value: payout.value, label: payout.label, signal: payout.score >= 7 ? 'positive' : payout.score >= 4 ? 'neutral' : 'negative' },
      { name: 'FCF Coverage', weight: '25%', score: fcfCoverage.score, value: fcfCoverage.value, label: fcfCoverage.label, signal: fcfCoverage.score >= 7 ? 'positive' : fcfCoverage.score >= 4 ? 'neutral' : 'negative' },
      { name: 'Deuda/EBITDA', weight: '15%', score: debt.score, value: debt.value, label: debt.label, trend: debt.trend, signal: debt.score >= 7 ? 'positive' : debt.score >= 4 ? 'neutral' : 'negative' },
      { name: 'Consistencia', weight: '15%', score: consistency.score, value: consistency.streak, label: consistency.label, signal: consistency.score >= 7 ? 'positive' : consistency.score >= 4 ? 'neutral' : 'negative' },
      { name: 'Beneficio (EPS)', weight: '10%', score: eps.score, value: null, label: eps.label, trend: eps.trend, signal: eps.score >= 7 ? 'positive' : eps.score >= 4 ? 'neutral' : 'negative' },
      { name: 'Ingresos', weight: '10%', score: revenue.score, value: null, label: revenue.label, trend: revenue.trend, signal: revenue.score >= 7 ? 'positive' : revenue.score >= 4 ? 'neutral' : 'negative' },
    ],
  }
}
