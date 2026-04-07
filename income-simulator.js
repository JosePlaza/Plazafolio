/**
 * Portfolio Income Simulator — "Optimal Mix" Engine
 *
 * Given an investment amount + list of candidate assets (with dividend data),
 * projects what happens if the user invests in each one (DRIP always).
 *
 * Produces:
 *   - Per-asset comparison: "if I put €X in this asset, what income/value do I get?"
 *   - A composite score to rank assets (yield + growth + safety)
 *   - Suggested allocation across top assets
 */

const r2 = (n) => Math.round(n * 100) / 100

/**
 * Project DRIP income for a single asset given an investment amount.
 *
 * @param {Object} p
 * @param {number} p.amount          - Amount to invest (€)
 * @param {number} p.currentPrice    - Current share price
 * @param {number} p.annualDividend  - Annual dividend per share (TTM)
 * @param {number} p.dividendCAGR    - Historical dividend growth (decimal)
 * @param {number} p.years           - Projection horizon
 * @returns {{ byYear, totalIncome, finalValue, finalShares, yieldOnCost }}
 */
function projectDRIP({ amount, currentPrice, annualDividend, dividendCAGR, years }) {
  if (!amount || amount <= 0 || !currentPrice || currentPrice <= 0 || !annualDividend || annualDividend <= 0) {
    return { byYear: [], totalIncome: 0, finalValue: 0, finalShares: 0, yieldOnCost: 0 }
  }

  const cagr = Math.max(0, dividendCAGR || 0) // floor at 0 for projection
  let shares = amount / currentPrice
  let dps = annualDividend
  let cumulativeIncome = 0
  const price = currentPrice // constant price assumption v1
  const byYear = []

  for (let y = 1; y <= years; y++) {
    dps = dps * (1 + cagr)
    const income = shares * dps

    // DRIP: reinvest dividends
    if (price > 0) {
      shares += income / price
    }

    cumulativeIncome += income

    byYear.push({
      year: y,
      shares: r2(shares),
      dps: r2(dps * 100) / 100,
      annualIncome: r2(income),
      cumulativeIncome: r2(cumulativeIncome),
      totalValue: r2(shares * price),
    })
  }

  const lastYear = byYear[byYear.length - 1]

  return {
    byYear,
    totalIncome: r2(cumulativeIncome),
    finalValue: lastYear ? lastYear.totalValue : amount,
    finalShares: lastYear ? lastYear.shares : r2(amount / currentPrice),
    yieldOnCost: amount > 0 && lastYear ? r2((lastYear.annualIncome / amount) * 100) : 0,
  }
}

/**
 * Compute a composite ranking score for an asset.
 * Hybrid B+C model: yield adjusted by Weiss position + valuation upside as own factor.
 *
 * Four factors at 25% each:
 *   1. Adjusted yield (yield × Weiss position multiplier)  — 25%
 *   2. Dividend CAGR growth                                — 25%
 *   3. Safety score                                        — 25%
 *   4. Valuation potential (Weiss upside to fair/sell band) — 25%
 *
 * @param {Object} asset - enriched asset with yieldPct, dividendCAGR, safetyScore, weiss
 *   weiss: { yieldRatio, upsidePct } — from Geraldine band data
 * @returns {number} 0-100 composite score
 */
function computeCompositeScore(asset) {
  const yieldPct = asset.yieldPct || 0
  const cagr = (asset.dividendCAGR || 0) * 100
  const safety = asset.safetyScore || 5
  const weiss = asset.weiss || {}

  // == 1. Adjusted Yield Score (0-10) ==========================================
  // Base yield score: sweet spot 2.5-6%, penalize yield traps > 8%
  let baseYield = 0
  if (yieldPct >= 2 && yieldPct <= 6) baseYield = Math.min(10, yieldPct * 1.8)
  else if (yieldPct > 6 && yieldPct <= 8) baseYield = 10 - (yieldPct - 6)
  else if (yieldPct > 8) baseYield = Math.max(2, 8 - (yieldPct - 8) * 2)
  else if (yieldPct > 0) baseYield = yieldPct * 2.5

  // Weiss position multiplier: amplifies yield if in buy zone, dampens if expensive
  // yieldRatio: 0 = at low yield (expensive), 1+ = at/above high yield (buy zone)
  let weissMultiplier = 1.0
  if (weiss.yieldRatio != null) {
    if (weiss.yieldRatio >= 1.0) {
      // Buy zone: multiplier 1.2-1.5 (buying cheap locks in high yield-on-cost)
      weissMultiplier = 1.2 + Math.min(weiss.yieldRatio - 1.0, 0.6) * 0.5
    } else if (weiss.yieldRatio >= 0.7) {
      // Approaching buy: slight boost 1.0-1.2
      weissMultiplier = 1.0 + (weiss.yieldRatio - 0.7) / 0.3 * 0.2
    } else if (weiss.yieldRatio >= 0.4) {
      // Middle zone: neutral 0.85-1.0
      weissMultiplier = 0.85 + (weiss.yieldRatio - 0.4) / 0.3 * 0.15
    } else {
      // Expensive: dampen 0.6-0.85
      weissMultiplier = 0.6 + (weiss.yieldRatio / 0.4) * 0.25
    }
  }
  const adjustedYieldScore = Math.min(10, baseYield * weissMultiplier)

  // == 2. Growth Score (0-10) ==================================================
  const growthScore = Math.min(10, Math.max(0, cagr / 1.5))

  // == 3. Safety Score (0-10) ==================================================
  const safetyNorm = Math.min(10, Math.max(0, safety))

  // == 4. Valuation Potential Score (0-10) =====================================
  // How much upside does the price have based on Weiss bands?
  // upsidePct: % distance from current price to overvalued (sell) price
  let valuationScore = 5 // neutral default when no Weiss data
  if (weiss.upsidePct != null) {
    if (weiss.upsidePct >= 50) {
      valuationScore = 10 // massive upside, deeply undervalued
    } else if (weiss.upsidePct >= 0) {
      // 0-50% upside maps to 5-10
      valuationScore = 5 + (weiss.upsidePct / 50) * 5
    } else {
      // Negative upside (overvalued, above sell band): 0-5
      // -50% or worse = 0, 0% = 5
      valuationScore = Math.max(0, 5 + (weiss.upsidePct / 50) * 5)
    }
  }

  // == Weighted: 4 × 25% =====================================================
  return r2(adjustedYieldScore * 0.25 + growthScore * 0.25 + safetyNorm * 0.25 + valuationScore * 0.25)
}

/**
 * Main simulation: analyze candidates and produce ranked comparison + suggested allocation.
 *
 * @param {Object} params
 * @param {number} params.amount     - Investment amount
 * @param {number} params.years      - Projection horizon
 * @param {Array}  params.candidates - Enriched assets [{ticker, name, currentPrice, annualDividend, dividendCAGR, yieldPct, safetyScore, safetyLevel, payoutRatio}]
 * @returns {Object}
 */
export function simulateOptimalMix({ amount, years = 5, candidates }) {
  if (!candidates || candidates.length === 0 || !amount || amount <= 0) {
    return { assets: [], allocation: [], amount, years }
  }

  // Run projection for each candidate
  const assets = candidates
    .filter(a => a.currentPrice > 0 && a.annualDividend > 0)
    .map(a => {
      const projection = projectDRIP({
        amount,
        currentPrice: a.currentPrice,
        annualDividend: a.annualDividend,
        dividendCAGR: a.dividendCAGR,
        years,
      })

      const compositeScore = computeCompositeScore(a)

      return {
        ticker: a.ticker,
        name: a.name || a.ticker,
        currentPrice: a.currentPrice,
        annualDividend: a.annualDividend,
        dividendCAGR: r2((a.dividendCAGR || 0) * 100), // as percentage
        yieldPct: r2(a.yieldPct || 0),
        safetyScore: a.safetyScore || null,
        safetyLevel: a.safetyLevel || null,
        safetyColor: a.safetyColor || null,
        payoutRatio: a.payoutRatio != null ? r2(a.payoutRatio) : null,
        weissSignal: a.weiss?.signal || null,
        weissScore: a.weiss?.score || null,
        weissUpside: a.weiss?.upsidePct != null ? r2(a.weiss.upsidePct) : null,
        compositeScore,
        projection,
      }
    })
    .sort((a, b) => b.compositeScore - a.compositeScore)

  // Generate suggested allocation:
  //   - Dynamic N: only include assets scoring >= 60% of the best score (min 2, max 7)
  //   - Sharper weights: use (score - floor)^2 to amplify score differences
  if (assets.length === 0) {
    return { assets, allocation: [], allocationTotals: null, amount, years }
  }

  const bestScore = assets[0].compositeScore
  const threshold = bestScore * 0.60
  const qualifying = assets.filter(a => a.compositeScore >= threshold)
  const topAssets = qualifying.slice(0, Math.max(2, Math.min(qualifying.length, 7)))

  // Floor = lowest qualifying score × 0.8 (ensures even the worst qualifier has some weight)
  const floor = topAssets[topAssets.length - 1].compositeScore * 0.8

  // Squared deltas amplify the gap between best and worst
  const deltas = topAssets.map(a => Math.pow(Math.max(0, a.compositeScore - floor), 2))
  const deltaSum = deltas.reduce((s, d) => s + d, 0)

  const allocation = topAssets.map((a, i) => {
    const weight = deltaSum > 0 ? deltas[i] / deltaSum : 1 / topAssets.length
    const allocAmount = r2(amount * weight)
    const allocProjection = projectDRIP({
      amount: allocAmount,
      currentPrice: a.currentPrice,
      annualDividend: a.annualDividend,
      dividendCAGR: a.dividendCAGR / 100, // convert back to decimal
      years,
    })

    return {
      ticker: a.ticker,
      name: a.name,
      weight: r2(weight * 100), // percentage
      amount: allocAmount,
      incomeYear1: allocProjection.byYear[0]?.annualIncome || 0,
      incomeYearN: allocProjection.byYear[allocProjection.byYear.length - 1]?.annualIncome || 0,
      totalIncome: allocProjection.totalIncome,
      finalValue: allocProjection.finalValue,
    }
  })

  // Allocation totals
  const allocationTotals = {
    incomeYear1: r2(allocation.reduce((s, a) => s + a.incomeYear1, 0)),
    incomeYearN: r2(allocation.reduce((s, a) => s + a.incomeYearN, 0)),
    totalIncome: r2(allocation.reduce((s, a) => s + a.totalIncome, 0)),
    finalValue: r2(allocation.reduce((s, a) => s + a.finalValue, 0)),
  }

  return {
    assets,
    allocation,
    allocationTotals,
    amount,
    years,
  }
}
