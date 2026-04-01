import YahooFinance from 'yahoo-finance2'

const yf = new YahooFinance({ suppressNotices: ['ripHistorical', 'yahooSurvey'] })

export default async function handler(req, res) {
  try {
    const { symbol, from } = req.query
    if (!symbol) return res.status(400).json({ error: 'Falta el parámetro symbol' })

    let result
    try {
      result = await yf.chart(symbol, {
        period1: from || '2000-01-01',
        period2: new Date().toISOString().split('T')[0],
        interval: '1d',
        events: 'div',
      })
    } catch (chartErr) {
      console.warn(`/api/dividends [${symbol}]: ${chartErr.message}`)
      return res.json([])
    }

    const dividends = (result?.events?.dividends || []).map((d) => ({
      date: d.date.toISOString().split('T')[0],
      dividend: d.amount,
      adjDividend: d.amount,
    }))

    res.json(dividends)
  } catch (err) {
    console.error('Error /api/dividends:', err.message)
    res.status(500).json({ error: err.message })
  }
}
