const FMP_API_KEY = process.env.VITE_FMP_API_KEY

export default async function handler(req, res) {
  try {
    const { symbol } = req.query
    if (!symbol) return res.status(400).json({ error: 'Falta el parámetro symbol' })
    if (!FMP_API_KEY) return res.json([])

    const stableUrl = `https://financialmodelingprep.com/stable/cash-flow-statement?symbol=${encodeURIComponent(symbol)}&apikey=${FMP_API_KEY}`
    let response = await fetch(stableUrl)

    if (response.status === 402) {
      const v3Url = `https://financialmodelingprep.com/api/v3/cash-flow-statement/${encodeURIComponent(symbol)}?period=annual&limit=10&apikey=${FMP_API_KEY}`
      response = await fetch(v3Url)
    }

    if (!response.ok) {
      console.warn(`[CashFlow] ${symbol}: HTTP ${response.status}`)
      return res.json([])
    }
    const data = await response.json()
    if (!Array.isArray(data) || !data.length) return res.json([])

    const results = data
      .map((d) => {
        const year = d.fiscalYear || d.calendarYear || d.calendar_year || d.date?.substring(0, 4)
        const fcf = d.freeCashFlow ?? d.free_cash_flow ?? 0
        const divPaid = d.commonDividendsPaid ?? d.netDividendsPaid
          ?? d.dividendsPaid ?? d.dividends_paid
          ?? d.paymentOfDividends ?? d.payment_of_dividends
          ?? 0
        const ocf = d.operatingCashFlow ?? d.operating_cash_flow
          ?? d.netCashProvidedByOperatingActivities ?? d.net_cash_provided_by_operating_activities
          ?? 0
        return {
          year,
          date: d.date,
          freeCashFlow: fcf,
          dividendsPaid: Math.abs(divPaid),
          operatingCashFlow: ocf,
        }
      })
      .filter((d) => d.year)
      .sort((a, b) => String(a.year).localeCompare(String(b.year)))

    res.json(results)
  } catch (err) {
    console.error('Error /api/cashflow:', err.message)
    res.json([])
  }
}
