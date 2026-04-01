import YahooFinance from 'yahoo-finance2'

const yf = new YahooFinance({ suppressNotices: ['ripHistorical', 'yahooSurvey'] })
const FMP_API_KEY = process.env.VITE_FMP_API_KEY

export default async function handler(req, res) {
  try {
    const { symbol } = req.query
    if (!symbol) return res.status(400).json({ error: 'Falta el parámetro symbol' })

    if (FMP_API_KEY) {
      try {
        const fmpUrl = `https://financialmodelingprep.com/stable/profile?symbol=${encodeURIComponent(symbol)}&apikey=${FMP_API_KEY}`
        const fmpRes = await fetch(fmpUrl)
        if (fmpRes.ok) {
          const fmpData = await fmpRes.json()
          if (Array.isArray(fmpData) && fmpData.length > 0) {
            const p = fmpData[0]
            return res.json({
              source: 'fmp',
              companyName: p.companyName,
              symbol: p.symbol,
              price: p.price,
              marketCap: p.marketCap,
              beta: p.beta,
              lastDividend: p.lastDividend,
              range: p.range,
              currency: p.currency,
              exchange: p.exchangeFullName || p.exchange,
              industry: p.industry,
              sector: p.sector,
              country: p.country,
              ceo: p.ceo,
              employees: p.fullTimeEmployees,
              description: p.description,
              website: p.website,
              image: p.image,
              ipoDate: p.ipoDate,
            })
          }
        }
      } catch (fmpErr) {
        console.warn('FMP profile falló, fallback a Yahoo:', fmpErr.message)
      }
    }

    let quote
    try {
      quote = await yf.quote(symbol)
    } catch { /* quote stays undefined */ }

    if (!quote) {
      return res.json({
        source: 'yahoo',
        companyName: symbol,
        symbol,
        price: 0,
        marketCap: null, beta: null, lastDividend: null, range: null,
        currency: null, exchange: null, industry: null, sector: null,
        country: null, ceo: null, employees: null, description: null,
        website: null, image: null, ipoDate: null,
      })
    }

    res.json({
      source: 'yahoo',
      companyName: quote.longName || quote.shortName || symbol,
      symbol: quote.symbol,
      price: quote.regularMarketPrice,
      marketCap: quote.marketCap,
      beta: null,
      lastDividend: quote.trailingAnnualDividendRate,
      range: quote.fiftyTwoWeekRange || `${quote.fiftyTwoWeekLow}-${quote.fiftyTwoWeekHigh}`,
      currency: quote.currency,
      exchange: quote.fullExchangeName || quote.exchange,
      industry: null,
      sector: null,
      country: null,
      ceo: null,
      employees: null,
      description: null,
      website: null,
      image: null,
      ipoDate: null,
    })
  } catch (err) {
    console.error('Error /api/profile:', err.message)
    res.status(500).json({ error: err.message })
  }
}
