import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import YahooFinance from 'yahoo-finance2'
import { readFileSync, writeFileSync, existsSync, statSync } from 'fs'

const yf = new YahooFinance({ suppressNotices: ['ripHistorical', 'yahooSurvey'] })

const app = express()
const PORT = process.env.PORT || 3001
const FMP_API_KEY = process.env.VITE_FMP_API_KEY

app.use(cors())
app.use(express.json({ limit: '50mb' }))

// ─── JSON file persistence for assets ────────────────────────────────────────
const DB_PATH = new URL('./data/assets.json', import.meta.url).pathname
const ANALYSIS_PATH = new URL('./data/analysis.json', import.meta.url).pathname
const TX_PATH = new URL('./data/transactions.json', import.meta.url).pathname

function readDB() {
  if (!existsSync(DB_PATH)) return { actives: [], watchlist: [] }
  try {
    return JSON.parse(readFileSync(DB_PATH, 'utf-8'))
  } catch {
    return { actives: [], watchlist: [] }
  }
}

function writeDB(data) {
  const dir = new URL('./data/', import.meta.url).pathname
  if (!existsSync(dir)) {
    import('fs').then((fs) => fs.mkdirSync(dir, { recursive: true }))
  }
  writeFileSync(DB_PATH, JSON.stringify(data, null, 2))
}

// Ensure data dir exists on startup
import { mkdirSync } from 'fs'
try {
  const dir = new URL('./data/', import.meta.url).pathname
  mkdirSync(dir, { recursive: true })
} catch { /* already exists */ }

// GET database storage stats
app.get('/api/db-stats', (req, res) => {
  const MAX_BYTES = 100 * 1024 * 1024 // 100 MB practical limit
  let totalBytes = 0
  const files = {}
  ;[DB_PATH, ANALYSIS_PATH, TX_PATH].forEach((p) => {
    try {
      const s = statSync(p)
      const name = p.split('/').pop()
      files[name] = s.size
      totalBytes += s.size
    } catch { /* file doesn't exist yet */ }
  })
  res.json({
    usedBytes: totalBytes,
    maxBytes: MAX_BYTES,
    percent: Math.round((totalBytes / MAX_BYTES) * 1000) / 10,
    files,
  })
})

// GET all saved assets
app.get('/api/assets', (req, res) => {
  res.json(readDB())
})

// POST add a new asset
app.post('/api/assets', (req, res) => {
  const { ticker, name, category, price, image } = req.body
  if (!ticker || !category) return res.status(400).json({ error: 'ticker and category required' })

  const db = readDB()
  const id = Date.now().toString(36) + Math.random().toString(36).substr(2, 5)
  const asset = { id, ticker: ticker.toUpperCase(), name: name || ticker.toUpperCase(), category, price: price || 0, image: image || null, shares: 0, entryPrice: 0 }

  if (category === 'actives') db.actives.push(asset)
  else db.watchlist.push(asset)

  writeDB(db)
  res.json(asset)
})

// PUT update asset (move between categories)
app.put('/api/assets/:id', (req, res) => {
  const { id } = req.params
  const { category, price, name, image } = req.body
  const db = readDB()

  // Find and remove from current location
  let asset = null
  for (const cat of ['actives', 'watchlist']) {
    const idx = db[cat].findIndex((a) => a.id === id)
    if (idx !== -1) {
      asset = db[cat].splice(idx, 1)[0]
      break
    }
  }

  if (!asset) return res.status(404).json({ error: 'Asset not found' })

  if (price !== undefined) asset.price = price
  if (name !== undefined) asset.name = name
  if (image !== undefined) asset.image = image
  if (category) asset.category = category
  if (req.body.shares !== undefined) asset.shares = req.body.shares
  if (req.body.entryPrice !== undefined) asset.entryPrice = req.body.entryPrice

  const targetCat = category || asset.category
  if (targetCat === 'actives') db.actives.push(asset)
  else db.watchlist.push(asset)

  writeDB(db)
  res.json(asset)
})

// PUT reorder assets within/between categories
app.put('/api/assets-reorder', (req, res) => {
  const { actives, watchlist } = req.body
  const db = readDB()
  if (actives) db.actives = actives
  if (watchlist) db.watchlist = watchlist
  writeDB(db)
  res.json(db)
})

// DELETE an asset
app.delete('/api/assets/:id', (req, res) => {
  const { id } = req.params
  const db = readDB()
  db.actives = db.actives.filter((a) => a.id !== id)
  db.watchlist = db.watchlist.filter((a) => a.id !== id)
  writeDB(db)
  res.json({ ok: true })
})

// ─── Analysis data persistence ──────────────────────────────────────────────
function readAnalysisDB() {
  if (!existsSync(ANALYSIS_PATH)) return {}
  try {
    return JSON.parse(readFileSync(ANALYSIS_PATH, 'utf-8'))
  } catch {
    return {}
  }
}

function writeAnalysisDB(data) {
  writeFileSync(ANALYSIS_PATH, JSON.stringify(data, null, 2))
}

// GET all cached analyses
app.get('/api/analysis', (req, res) => {
  const db = readAnalysisDB()
  res.json(db)
})

// GET cached analysis for a ticker
app.get('/api/analysis/:ticker', (req, res) => {
  const { ticker } = req.params
  const db = readAnalysisDB()
  const key = ticker.toUpperCase()
  if (db[key]) {
    res.json(db[key])
  } else {
    res.json(null)
  }
})

// POST save analysis for a ticker
app.post('/api/analysis/:ticker', (req, res) => {
  const { ticker } = req.params
  const { years, data: analysisData, profile } = req.body
  const db = readAnalysisDB()
  const key = ticker.toUpperCase()
  const cfLen = analysisData?.cashFlow?.length || 0
  db[key] = {
    ticker: key,
    years,
    lastUpdated: new Date().toISOString().split('T')[0],
    data: analysisData,
    profile,
  }
  writeAnalysisDB(db)
  console.log(`[Save] ${key}: cashFlow=${cfLen} entries`)
  res.json({ ok: true })
})

// ─── Transactions persistence ───────────────────────────────────────────────
function readTxDB() {
  if (!existsSync(TX_PATH)) return []
  try {
    return JSON.parse(readFileSync(TX_PATH, 'utf-8'))
  } catch {
    return []
  }
}

function writeTxDB(data) {
  writeFileSync(TX_PATH, JSON.stringify(data, null, 2))
}

// GET all transactions (optionally filter by asset_id)
app.get('/api/transactions', (req, res) => {
  const txs = readTxDB()
  const { asset_id } = req.query
  if (asset_id) {
    return res.json(txs.filter(t => t.asset_id === asset_id))
  }
  res.json(txs)
})

// POST add a new transaction
app.post('/api/transactions', (req, res) => {
  const { asset_id, ticker, transaction_date, shares, price_per_share, currency, note } = req.body
  if (!asset_id || !ticker || shares == null || price_per_share == null) {
    return res.status(400).json({ error: 'asset_id, ticker, shares, and price_per_share required' })
  }

  const txs = readTxDB()
  const id = Date.now().toString(36) + Math.random().toString(36).substr(2, 5)
  const tx = {
    id,
    asset_id,
    ticker: ticker.toUpperCase(),
    transaction_date: transaction_date || new Date().toISOString().split('T')[0],
    shares: Number(shares),
    price_per_share: Number(price_per_share),
    currency: currency || 'USD',
    note: note || '',
    created_at: new Date().toISOString(),
  }

  txs.push(tx)
  writeTxDB(txs)
  res.json(tx)
})

// PUT update a transaction
app.put('/api/transactions/:id', (req, res) => {
  const { id } = req.params
  const txs = readTxDB()
  const idx = txs.findIndex(t => t.id === id)
  if (idx === -1) return res.status(404).json({ error: 'Transaction not found' })

  const { transaction_date, shares, price_per_share, currency, note } = req.body
  if (transaction_date !== undefined) txs[idx].transaction_date = transaction_date
  if (shares !== undefined) txs[idx].shares = Number(shares)
  if (price_per_share !== undefined) txs[idx].price_per_share = Number(price_per_share)
  if (currency !== undefined) txs[idx].currency = currency
  if (note !== undefined) txs[idx].note = note

  writeTxDB(txs)
  res.json(txs[idx])
})

// DELETE a transaction
app.delete('/api/transactions/:id', (req, res) => {
  const { id } = req.params
  const txs = readTxDB().filter(t => t.id !== id)
  writeTxDB(txs)
  res.json({ ok: true })
})

// ─── Yahoo Finance: Tipo de cambio EUR/USD ──────────────────────────────────
app.get('/api/forex', async (req, res) => {
  try {
    const { pair } = req.query
    const symbol = pair || 'EURUSD=X'
    const quote = await yf.quote(symbol)
    const rate = quote?.regularMarketPrice || null
    res.json({ symbol, rate, timestamp: new Date().toISOString() })
  } catch (err) {
    console.error('Error /api/forex:', err.message)
    res.json({ symbol: 'EURUSD=X', rate: null, error: err.message })
  }
})

// ─── FMP: Cash Flow Statement (para sostenibilidad del dividendo) ────────────
app.get('/api/cashflow', async (req, res) => {
  try {
    const { symbol } = req.query
    if (!symbol) return res.status(400).json({ error: 'Falta el parámetro symbol' })
    if (!FMP_API_KEY) return res.json([])

    // Try stable first (works for most tickers), fallback to v3 only if 402
    const stableUrl = `https://financialmodelingprep.com/stable/cash-flow-statement?symbol=${encodeURIComponent(symbol)}&apikey=${FMP_API_KEY}`
    let response = await fetch(stableUrl)

    if (response.status === 402) {
      // Stable requires paid plan for this ticker — try v3 as fallback (1 extra call)
      const v3Url = `https://financialmodelingprep.com/api/v3/cash-flow-statement/${encodeURIComponent(symbol)}?period=annual&limit=10&apikey=${FMP_API_KEY}`
      response = await fetch(v3Url)
    }

    if (!response.ok) {
      console.warn(`[CashFlow] ${symbol}: HTTP ${response.status}`)
      return res.json([])
    }
    const data = await response.json()
    if (!Array.isArray(data) || !data.length) {
      console.log(`[CashFlow] ${symbol}: no data from FMP`)
      return res.json([])
    }

    // Handle multiple possible field names from FMP
    const results = data
      .map((d) => {
        const year = d.fiscalYear || d.calendarYear || d.calendar_year || d.date?.substring(0, 4)
        const fcf = d.freeCashFlow ?? d.free_cash_flow ?? 0
        // FMP stable API uses commonDividendsPaid / netDividendsPaid
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
          dividendsPaid: Math.abs(divPaid), // FMP returns negative, we want positive
          operatingCashFlow: ocf,
        }
      })
      .filter((d) => d.year)
      .sort((a, b) => String(a.year).localeCompare(String(b.year)))

    console.log(`[CashFlow] ${symbol}: ${results.length} years, divPaid=${results[0]?.dividendsPaid}`)
    res.json(results)
  } catch (err) {
    console.error('Error /api/cashflow:', err.message)
    res.json([])
  }
})

// ─── Yahoo Finance: Fundamentals Time Series (Income, Balance, CashFlow) ─────
app.get('/api/fundamentals', async (req, res) => {
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

    // Also get current EV from quoteSummary
    let enterpriseValue = null
    try {
      const summary = await yf.quoteSummary(symbol, { modules: ['defaultKeyStatistics'] })
      enterpriseValue = summary?.defaultKeyStatistics?.enterpriseValue ?? null
    } catch { /* ignore */ }

    // Map financials (income statement)
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

    // Map balance sheet
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

    // Map cash flow
    const cf = (cashFlow || [])
      .filter((d) => d.date)
      .map((d) => ({
        date: d.date instanceof Date ? d.date.toISOString().split('T')[0] : String(d.date),
        operatingCashFlow: d.operatingCashFlow ?? null,
        capitalExpenditure: d.capitalExpenditure ?? null,
        freeCashFlow: d.freeCashFlow ?? null,
      }))
      .sort((a, b) => a.date.localeCompare(b.date))

    console.log(`[Fundamentals] ${symbol}: income=${income.length} balance=${balance.length} cf=${cf.length}`)
    res.json({ income, balance, cashFlow: cf, enterpriseValue })
  } catch (err) {
    console.error('Error /api/fundamentals:', err.message)
    res.json({ income: [], balance: [], cashFlow: [], enterpriseValue: null })
  }
})

// ─── Yahoo Finance: Búsqueda de tickers ──────────────────────────────────────
app.get('/api/search', async (req, res) => {
  try {
    const { q } = req.query
    if (!q || q.length < 1) return res.json([])

    const results = await yf.search(q, { quotesCount: 8, newsCount: 0 })
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
})

// ─── Yahoo Finance: Precios históricos ───────────────────────────────────────
app.get('/api/prices', async (req, res) => {
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
      // Symbol not found or delisted → return empty array (not 500)
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
})

// ─── Yahoo Finance: Historial de dividendos ──────────────────────────────────
app.get('/api/dividends', async (req, res) => {
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
      // Symbol not found or delisted → return empty array (not 500)
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
})

// ─── FMP: Perfil de empresa ──────────────────────────────────────────────────
app.get('/api/profile', async (req, res) => {
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
})

// ─── En producción, servir el frontend compilado ─────────────────────────────
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

app.use(express.static(join(__dirname, 'dist')))
app.get('{*path}', (req, res) => {
  res.sendFile(join(__dirname, 'dist', 'index.html'))
})

app.listen(PORT, () => {
  console.log(`🚀 Plazafolio server corriendo en http://localhost:${PORT}`)
})
