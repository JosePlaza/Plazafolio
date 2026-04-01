import YahooFinance from 'yahoo-finance2'

const yf = new YahooFinance({ suppressNotices: ['ripHistorical', 'yahooSurvey'] })

export default async function handler(req, res) {
  try {
    const { symbol } = req.query
    if (!symbol) return res.status(400).json({ error: 'Falta el parámetro symbol' })

    const period1 = new Date()
    period1.setFullYear(period1.getFullYear() - 8)

    const [financials, balanceSheet, cashFlow] = await Promise.all([
      yf.fundamentalsTimeSeries(symbol, {
        period1: period1.toISOString().split('T')[0],
        type: 'annual',
        module: 'financials',
      }).catch(() => []),
      yf.fundamentalsTimeSeries(symbol, {
        period1: period1.toISOString().split('T')[0],
        type: 'annual',
        module: 'balance-sheet',
      }).catch(() => []),
      yf.fundamentalsTimeSeries(symbol, {
        period1: period1.toISOString().split('T')[0],
        type: 'annual',
        module: 'cash-flow',
      }).catch(() => []),
    ])

    let enterpriseValue = null
    try {
      const summary = await yf.quoteSummary(symbol, { modules: ['defaultKeyStatistics'] })
      enterpriseValue = summary?.defaultKeyStatistics?.enterpriseValue ?? null
    } catch { /* ignore */ }

    const income = (financials || [])
      .filter((d) => d.date)
      .map((d) => ({
        date: d.date instanceof Date ? d.date.toISOString().split('T')[0] : String(d.date),
        totalRevenue: d.totalRevenue ?? null,
        costOfRevenue: d.costOfRevenue ?? null,
        grossProfit: d.grossProfit ?? null,
        operatingIncome: d.operatingIncome ?? null,
        operatingExpense: d.operatingExpense ?? null,
        netIncome: d.netIncome ?? null,
        ebitda: d.EBITDA ?? d.normalizedEBITDA ?? null,
        ebit: d.EBIT ?? null,
      }))
      .sort((a, b) => a.date.localeCompare(b.date))

    const balance = (balanceSheet || [])
      .filter((d) => d.date)
      .map((d) => ({
        date: d.date instanceof Date ? d.date.toISOString().split('T')[0] : String(d.date),
        totalDebt: d.totalDebt ?? null,
        netDebt: d.netDebt ?? null,
        totalAssets: d.totalAssets ?? null,
        totalLiabilities: d.totalLiabilitiesNetMinorityInterest ?? null,
        stockholdersEquity: d.stockholdersEquity ?? null,
        ordinarySharesNumber: d.ordinarySharesNumber ?? null,
        cashAndEquivalents: d.cashAndCashEquivalents ?? d.cashCashEquivalentsAndShortTermInvestments ?? null,
      }))
      .sort((a, b) => a.date.localeCompare(b.date))

    const cf = (cashFlow || [])
      .filter((d) => d.date)
      .map((d) => ({
        date: d.date instanceof Date ? d.date.toISOString().split('T')[0] : String(d.date),
        operatingCashFlow: d.operatingCashFlow ?? null,
        capitalExpenditure: d.capitalExpenditure ?? null,
        freeCashFlow: d.freeCashFlow ?? null,
      }))
      .sort((a, b) => a.date.localeCompare(b.date))

    res.json({ income, balance, cashFlow: cf, enterpriseValue })
  } catch (err) {
    console.error('Error /api/fundamentals:', err.message)
    res.json({ income: [], balance: [], cashFlow: [], enterpriseValue: null })
  }
}
