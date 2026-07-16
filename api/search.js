import YahooFinance from 'yahoo-finance2'

const yf = new YahooFinance({ suppressNotices: ['ripHistorical', 'yahooSurvey'] })

export default async function handler(req, res) {
  try {
    const { q } = req.query
    if (!q || q.length < 1) return res.json([])

    const results = await yf.search(q, { quotesCount: 8, newsCount: 0 }, { validateResult: false })
    const quotes = (results.quotes || [])
      .filter((r) => r.isYahooFinance && (r.quoteType === 'EQUITY' || r.quoteType === 'ETF'))
      .map((r) => ({
        symbol: r.symbol,
        name: r.longname || r.shortname || r.symbol,
        exchange: r.exchDisp || r.exchange || '',
        type: r.quoteType,
      }))

    res.json(quotes)
  } catch (err) {
    console.error('Error /api/search:', err.message)
    res.json([])
  }
}
