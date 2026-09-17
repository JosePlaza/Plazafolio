import YahooFinance from 'yahoo-finance2'

const yf = new YahooFinance({ suppressNotices: ['ripHistorical', 'yahooSurvey'] })

/**
 * Snapshot de mercado para el módulo de valoración (SPEC_01 §1.1).
 *
 * Devuelve solo los campos del contrato, ya aplanados. Todo acceso es opcional
 * (§7.4): Yahoo deja campos `undefined` según el ticker y la spec prohíbe
 * imputar valores, así que lo que no venga viaja como null y el consumidor
 * excluye ese múltiplo.
 */
export function mapSnapshot(qs) {
  const price = qs?.price || {}
  const sd = qs?.summaryDetail || {}
  const ks = qs?.defaultKeyStatistics || {}
  const fd = qs?.financialData || {}
  const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

  return {
    precioActual: n(price.regularMarketPrice),
    currency: price.currency ?? null,
    marketCap: n(price.marketCap),
    dividendRate: n(sd.dividendRate),
    trailingAnnualDividendRate: n(sd.trailingAnnualDividendRate),
    dividendYield: n(sd.dividendYield),
    fiveYearAvgDividendYield: n(sd.fiveYearAvgDividendYield),
    payoutRatio: n(sd.payoutRatio),
    trailingPE: n(sd.trailingPE),
    trailingEps: n(ks.trailingEps),
    sharesOutstanding: n(ks.sharesOutstanding),
    enterpriseValue: n(ks.enterpriseValue),
    enterpriseToEbitda: n(ks.enterpriseToEbitda),
    ebitda: n(fd.ebitda),
    totalDebt: n(fd.totalDebt),
    totalCash: n(fd.totalCash),
    freeCashflow: n(fd.freeCashflow),
  }
}

export default async function handler(req, res) {
  try {
    const { symbol } = req.query
    if (!symbol) return res.status(400).json({ error: 'Falta el parámetro symbol' })

    const qs = await yf.quoteSummary(symbol, {
      modules: ['price', 'summaryDetail', 'defaultKeyStatistics', 'financialData'],
    })

    // §7.11 — cachear el snapshot 15 min.
    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=3600')
    res.json(mapSnapshot(qs))
  } catch (err) {
    console.warn(`/api/valuation-snapshot [${req.query?.symbol}]: ${err.message}`)
    // Sin snapshot la valoración degrada a Weiss+Gordon (§5.3), no es un 500.
    res.json({ error: err.message })
  }
}
