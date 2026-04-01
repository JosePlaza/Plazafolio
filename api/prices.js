import YahooFinance from 'yahoo-finance2'

const yf = new YahooFinance({ suppressNotices: ['ripHistorical', 'yahooSurvey'] })

export default async function handler(req, res) {
  try {
    const { symbol, from, to } = req.query
    if (!symbol) return res.status(400).json({ error: 'Falta el parámetro symbol' })

    let result
    try {
      result = await yf.chart(symbol, {
        period1: from || '2010-01-01',
        period2: to || new Date().toISOString().split('T')[0],
        interval: '1d',
      })
    } catch (chartErr) {
      console.warn(`/api/prices [${symbol}]: ${chartErr.message}`)
      return res.json([])
    }

    const quotes = (result?.quotes || [])
      .filter((q) => q.close != null)
      .map((q) => ({
        date: q.date.toISOString().split('T')[0],
        open: q.open,
        high: q.high,
        low: q.low,
        close: q.close,
        volume: q.volume,
      }))

    res.json(quotes)
  } catch (err) {
    console.error('Error /api/prices:', err.message)
    res.status(500).json({ error: err.message })
  }
}
