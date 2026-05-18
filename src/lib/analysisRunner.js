import {
  getHistoricalPrices,
  getDividendHistory,
  getCompanyProfile,
  getCashFlowData,
  getFundamentalsData,
} from '@/services/fmpApi'
import { computeAll } from '@/lib/geraldine'
import { computeBuyScore } from '@/lib/scoring'

/**
 * Fetch + compute Geraldine Weiss para un ticker. Función pura reutilizable
 * tanto por `useGeraldine` (un ticker, con estado reactivo) como por
 * `useBulkSync` (N tickers en paralelo).
 *
 * @param {string} ticker
 * @param {number} years
 * @param {Object} [cachedProfile] - si se pasa, evita una llamada FMP
 * @returns {Promise<{ result, profile, cashFlow, fundamentals, score }>}
 */
export async function runAnalysisForTicker(ticker, years, cachedProfile = null) {
  const to = new Date()
  const from = new Date()
  from.setFullYear(from.getFullYear() - years - 1)

  const fromStr = from.toISOString().split('T')[0]
  const toStr = to.toISOString().split('T')[0]

  const [prices, dividends, profile, cashFlow, fundamentals] = await Promise.all([
    getHistoricalPrices(ticker, fromStr, toStr),
    getDividendHistory(ticker),
    cachedProfile ? Promise.resolve(cachedProfile) : getCompanyProfile(ticker),
    getCashFlowData(ticker).catch(() => []),
    getFundamentalsData(ticker).catch(() => null),
  ])

  if (!prices.length) throw new Error(`No se encontraron precios para ${ticker}`)
  if (!dividends.length) throw new Error(`${ticker} no paga dividendos`)

  const filteredDividends = dividends.filter((d) => d.date >= fromStr)
  const result = computeAll({ prices, dividends: filteredDividends, years, profile })

  const scoring = computeBuyScore(
    result.indicators,
    result.projection,
    result.dividends,
    cashFlow,
    fundamentals,
  )

  return { result, profile, cashFlow, fundamentals, score: scoring.score }
}
