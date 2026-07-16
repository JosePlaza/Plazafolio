import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import YahooFinance from 'yahoo-finance2'
import { readFileSync, writeFileSync, existsSync, statSync } from 'fs'
import { fetchReportList, getLatestFilingDate, isUsTicker } from './sec-edgar.js'
import { fetchReportList as fetchEsefReportList, isEuropeanTicker } from './esef-reports.js'
import { generateNarrative, generateAudio, generateSafetyAnalysis, generateEarningsCallBrief, generateIncomeRecommendation, testApiKey, checkModelsStatus } from './llm-provider.js'
import { computeSafetyScore, isReit } from './dividend-safety.js'
import { fetchTranscript, extractDividendContext } from './earnings-calls.js'
import { simulateOptimalMix } from './income-simulator.js'
import { computeBuyScore } from './src/lib/scoring.js'
import { createClient } from '@supabase/supabase-js'

// ─── Supabase server client (service role for writes, anon for reads) ───────
const SUPABASE_URL = process.env.VITE_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY
const supabaseServer = (SUPABASE_URL && SUPABASE_SERVICE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  : null
if (supabaseServer) console.log('[Supabase] Server client initialized (service role)')
else console.warn('[Supabase] No SUPABASE_SERVICE_ROLE_KEY — SEC reports will use JSON file cache only')

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

    // Map financials (income statement) — skip entries where key fields are all null
    const income = (financials || [])
      .filter((d) => d.date && (d.totalRevenue != null || d.netIncome != null))
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

    // Map balance sheet — skip entries where key fields are all null
    const balance = (balanceSheet || [])
      .filter((d) => d.date && (d.totalDebt != null || d.netDebt != null || d.stockholdersEquity != null || d.ordinarySharesNumber != null))
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

    // Map cash flow — skip entries where key fields are all null
    const cf = (cashFlow || [])
      .filter((d) => d.date && (d.operatingCashFlow != null || d.freeCashFlow != null))
      .map((d) => ({
        date: d.date instanceof Date ? d.date.toISOString().split('T')[0] : String(d.date),
        operatingCashFlow: d.operatingCashFlow ?? null,
        capitalExpenditure: d.capitalExpenditure ?? null,
        freeCashFlow: d.freeCashFlow ?? null,
        depreciationAndAmortization: d.depreciationAndAmortization ?? null,
        commonDividendsPaid: Math.abs(d.cashDividendsPaid ?? d.commonStockDividendPaid ?? d.paymentOfDividends ?? 0) || null,
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

// ─── SEC EDGAR: Financial Reports ───────────────────────────────────────────
const SEC_CACHE_PATH = new URL('./data/sec-reports.json', import.meta.url).pathname
const SEC_CACHE_TTL = 7 * 24 * 60 * 60 * 1000 // 7 days

// ── Supabase-based cache helpers ──
async function readSecCacheDb(ticker, formType) {
  if (!supabaseServer) return []
  try {
    const { data, error } = await supabaseServer
      .from('financial_reports')
      .select('*')
      .eq('ticker', ticker.toUpperCase())
      .eq('report_type', formType)
      .order('report_date', { ascending: false })
    if (error) throw error
    return (data || []).map(r => ({
      id: r.id, ticker: r.ticker, source: r.source, reportType: r.report_type,
      periodCurrent: r.period_current, periodPrevious: r.period_previous,
      reportDate: r.report_date, filedDate: r.filed_date,
      metrics: r.metrics, diagnosis: r.diagnosis, narrative: r.narrative,
      narrativeSources: r.narrative_sources || [],
      audioUrl: r.audio_url || null,
      fetchedAt: r.fetched_at,
    }))
  } catch (err) {
    console.warn('[SEC DB] Read failed:', err.message)
    return []
  }
}

async function writeSecCacheDb(reports) {
  if (!supabaseServer || !reports.length) return
  try {
    const rows = reports.map(r => ({
      id: r.id, ticker: r.ticker, source: r.source || 'sec',
      report_type: r.reportType, period_current: r.periodCurrent,
      period_previous: r.periodPrevious, report_date: r.reportDate,
      filed_date: r.filedDate, metrics: r.metrics, diagnosis: r.diagnosis,
      narrative: r.narrative || null,
      narrative_sources: r.narrativeSources || null,
      audio_url: r.audioUrl || null,
      fetched_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + SEC_CACHE_TTL).toISOString(),
    }))
    const { error } = await supabaseServer
      .from('financial_reports')
      .upsert(rows, { onConflict: 'id' })
    if (error) throw error
    console.log(`[SEC DB] Upserted ${rows.length} reports for ${reports[0].ticker}`)
  } catch (err) {
    console.warn('[SEC DB] Write failed:', err.message)
  }
}

/**
 * Repair audio_url for reports that have audio in Storage but missing DB audio_url.
 * This can happen if the DB update failed after uploading to Storage.
 * Mutates the reports array in-place and updates DB in background.
 */
async function repairAudioUrls(reports) {
  if (!supabaseServer || !reports.length) return
  const toRepair = reports.filter(r => !r.audioUrl && r.ticker && r.reportType && r.periodCurrent)
  if (!toRepair.length) return

  for (const r of toRepair) {
    try {
      const safeTicker = r.ticker.replace(/[^a-zA-Z0-9]/g, '_')
      const safePeriod = r.periodCurrent.replace(/[^a-zA-Z0-9]/g, '_')
      const expectedFile = `${r.reportType}_${safePeriod}.wav`

      const { data: files } = await supabaseServer.storage
        .from('reports')
        .list(safeTicker, { search: expectedFile })

      if (files && files.some(f => f.name === expectedFile)) {
        const filePath = `${safeTicker}/${expectedFile}`
        const { data: urlData } = supabaseServer.storage.from('reports').getPublicUrl(filePath)
        const audioUrl = urlData?.publicUrl || ''
        if (audioUrl) {
          r.audioUrl = audioUrl
          console.log(`[TTS] Repaired audio_url for ${r.id}: ${audioUrl}`)
          // Update DB in background
          supabaseServer.from('financial_reports')
            .update({ audio_url: audioUrl })
            .eq('id', r.id)
            .then(({ error }) => { if (error) console.warn(`[TTS] Repair DB update failed for ${r.id}:`, error.message) })
        }
      }
    } catch (e) { /* ignore individual failures */ }
  }
}

async function updateNarrativeDb(reportId, narrative, narrativeSources) {
  if (!supabaseServer || !narrative) return
  try {
    const update = { narrative }
    if (narrativeSources) update.narrative_sources = narrativeSources
    await supabaseServer
      .from('financial_reports')
      .update(update)
      .eq('id', reportId)
  } catch (err) {
    console.warn('[SEC DB] Narrative update failed:', err.message)
  }
}

// ── JSON file fallback ──
function readSecCache() {
  if (!existsSync(SEC_CACHE_PATH)) return {}
  try { return JSON.parse(readFileSync(SEC_CACHE_PATH, 'utf-8')) } catch { return {} }
}
function writeSecCache(data) {
  writeFileSync(SEC_CACHE_PATH, JSON.stringify(data, null, 2))
}

// GET Supabase diagnostic
app.get('/api/debug/supabase', async (req, res) => {
  const info = {
    hasClient: !!supabaseServer,
    url: SUPABASE_URL ? 'set' : 'missing',
    serviceKey: SUPABASE_SERVICE_KEY ? `set (${SUPABASE_SERVICE_KEY.length} chars)` : 'missing',
  }
  if (supabaseServer) {
    try {
      // Try a simple read
      const { data, error, count } = await supabaseServer
        .from('financial_reports')
        .select('id', { count: 'exact', head: true })
      info.readTest = error ? { error: error.message, code: error.code } : { ok: true, count }
    } catch (err) { info.readTest = { error: err.message } }
    try {
      // Try a write + delete
      const testId = '__test__'
      const { error: writeErr } = await supabaseServer
        .from('financial_reports')
        .upsert({
          id: testId, ticker: 'TEST', source: 'test', report_type: 'test',
          period_current: 'test', period_previous: 'test',
          metrics: {}, diagnosis: {},
        }, { onConflict: 'id' })
      if (writeErr) {
        info.writeTest = { error: writeErr.message, code: writeErr.code, details: writeErr.details, hint: writeErr.hint }
      } else {
        info.writeTest = { ok: true }
        await supabaseServer.from('financial_reports').delete().eq('id', testId)
      }
    } catch (err) { info.writeTest = { error: err.message } }
  }
  res.json(info)
})

// GET check status of all Gemini models
app.get('/api/llm/status', async (req, res) => {
  const geminiKey = req.headers['x-gemini-key'] || ''
  if (!geminiKey) return res.json({ models: [], error: 'No API key' })
  try {
    const models = await checkModelsStatus(geminiKey)
    res.json({ models })
  } catch (err) {
    res.json({ models: [], error: err.message })
  }
})

// POST test Gemini API key
app.post('/api/llm/test-key', async (req, res) => {
  const geminiKey = req.headers['x-gemini-key'] || ''
  if (!geminiKey) return res.json({ ok: false, error: 'No API key provided' })
  const result = await testApiKey(geminiKey)
  res.json(result)
})

// ─── Dividend Safety Radar ──────────────────────────────────────────────────

/**
 * GET /api/dividend-safety/:ticker
 * Calculates dividend safety score (mechanical) + optional Gemini analysis.
 * Headers: x-gemini-key (optional — for AI analysis with grounding)
 *
 * Returns: { score, level, color, summary, isReit, factors, analysis?, sources?, cachedAt }
 */
app.get('/api/dividend-safety/:ticker', async (req, res) => {
  const ticker = req.params.ticker?.toUpperCase()
  if (!ticker) return res.status(400).json({ error: 'Ticker required' })

  const geminiKey = req.headers['x-gemini-key'] || ''
  const forceRefresh = req.query.refresh === 'true'

  try {
    // 1. Check Supabase cache first (24h TTL)
    if (supabaseServer && !forceRefresh) {
      try {
        const { data: cached } = await supabaseServer
          .from('dividend_safety')
          .select('*')
          .eq('ticker', ticker)
          .single()

        if (cached && cached.expires_at && new Date(cached.expires_at) > new Date()) {
          console.log(`[Safety] Cache hit: ${ticker} (score: ${cached.score})`)
          return res.json({
            score: cached.score,
            level: cached.level,
            color: cached.color,
            summary: cached.summary,
            isReit: cached.is_reit,
            factors: cached.factors,
            analysis: cached.analysis,
            sources: cached.sources,
            cachedAt: cached.computed_at,
          })
        }
      } catch { /* cache miss, continue */ }
    }

    // 2. Fetch data needed for scoring
    console.log(`[Safety] Computing safety score for ${ticker}...`)

    // Fetch cash flow — try FMP first, then Yahoo Finance fallback
    let cashFlow = []

    // A) FMP (may fail with 402 on free plan)
    if (FMP_API_KEY) {
      try {
        const cfUrl = `https://financialmodelingprep.com/stable/cash-flow-statement?symbol=${encodeURIComponent(ticker)}&apikey=${FMP_API_KEY}`
        let cfRes = await fetch(cfUrl)
        if (cfRes.status === 402) {
          const v3Url = `https://financialmodelingprep.com/api/v3/cash-flow-statement/${encodeURIComponent(ticker)}?period=annual&limit=10&apikey=${FMP_API_KEY}`
          cfRes = await fetch(v3Url)
        }
        if (cfRes.ok) {
          const cfData = await cfRes.json()
          if (Array.isArray(cfData) && cfData.length > 0) {
            cashFlow = cfData.map(d => ({
              year: d.fiscalYear || d.calendarYear || d.date?.substring(0, 4),
              freeCashFlow: d.freeCashFlow ?? d.free_cash_flow ?? 0,
              dividendsPaid: Math.abs(d.commonDividendsPaid ?? d.netDividendsPaid ?? d.dividendsPaid ?? d.paymentOfDividends ?? 0),
              operatingCashFlow: d.operatingCashFlow ?? d.operating_cash_flow ?? 0,
            }))
          }
        }
      } catch (err) {
        console.warn(`[Safety] FMP cash flow fetch failed for ${ticker}:`, err.message)
      }
    }

    // B) Yahoo Finance fallback — if FMP returned nothing
    if (cashFlow.length === 0) {
      try {
        const cfPeriod = new Date()
        cfPeriod.setFullYear(cfPeriod.getFullYear() - 6)
        const [yahooCf, yahooQuote] = await Promise.all([
          yf.fundamentalsTimeSeries(ticker, {
            period1: cfPeriod.toISOString().split('T')[0],
            type: 'annual',
            module: 'cash-flow',
          }, { validateResult: false }).catch(() => []),
          yf.quote(ticker, {}, { validateResult: false }).catch(() => null),
        ])

        const sharesOutstanding = yahooQuote?.sharesOutstanding || 0

        if (yahooCf && yahooCf.length > 0) {
          cashFlow = yahooCf
            .filter(d => d.date)
            .map(d => {
              const dateStr = d.date instanceof Date ? d.date.toISOString().split('T')[0] : String(d.date)
              const fcf = d.freeCashFlow ?? null
              const ocf = d.operatingCashFlow ?? null

              // Yahoo doesn't always provide dividendsPaid directly in cash-flow module
              // Use cashDividendsPaid if available, otherwise estimate from commonStockDividendPaid
              let divPaid = Math.abs(d.cashDividendsPaid ?? d.commonStockDividendPaid ?? d.paymentOfDividends ?? 0)

              return {
                year: dateStr.substring(0, 4),
                freeCashFlow: fcf ?? (ocf != null && d.capitalExpenditure != null ? ocf + d.capitalExpenditure : 0),
                dividendsPaid: divPaid,
                operatingCashFlow: ocf ?? 0,
              }
            })
            .sort((a, b) => b.year.localeCompare(a.year)) // newest first

          console.log(`[Safety] Yahoo cash flow for ${ticker}: ${cashFlow.length} years, FCF[0]=${cashFlow[0]?.freeCashFlow}, DivPaid[0]=${cashFlow[0]?.dividendsPaid}`)
        }
      } catch (err) {
        console.warn(`[Safety] Yahoo cash flow fallback failed for ${ticker}:`, err.message)
      }
    }

    // C) Last resort: check Geraldine cached analysis in Supabase
    if (cashFlow.length === 0 && supabaseServer) {
      try {
        const { data: cached } = await supabaseServer
          .from('analyses')
          .select('cash_flow, fundamentals')
          .eq('ticker', ticker)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (cached?.cash_flow && Array.isArray(cached.cash_flow) && cached.cash_flow.length > 0) {
          cashFlow = cached.cash_flow
          console.log(`[Safety] Using Geraldine cached FMP cash flow for ${ticker}: ${cashFlow.length} years`)
        } else if (cached?.fundamentals?.cashFlow && Array.isArray(cached.fundamentals.cashFlow) && cached.fundamentals.cashFlow.length > 0) {
          // Map Yahoo fundamentals cashFlow format to safety format
          cashFlow = cached.fundamentals.cashFlow.map(d => ({
            year: d.date?.substring(0, 4),
            freeCashFlow: d.freeCashFlow ?? 0,
            dividendsPaid: 0, // not available in this format
            operatingCashFlow: d.operatingCashFlow ?? 0,
          }))
          console.log(`[Safety] Using Geraldine cached Yahoo cash flow for ${ticker}: ${cashFlow.length} years`)
        }
      } catch { /* ignore */ }
    }

    if (cashFlow.length > 0) {
      console.log(`[Safety] ${ticker}: cash flow data available (${cashFlow.length} years)`)
    } else {
      console.warn(`[Safety] ${ticker}: NO cash flow data from any source`)
    }

    // Fetch fundamentals from Yahoo Finance
    const period1 = new Date()
    period1.setFullYear(period1.getFullYear() - 8)
    let fundamentals = { income: [], balance: [] }
    try {
      const [financials, balanceSheet] = await Promise.all([
        yf.fundamentalsTimeSeries(ticker, { period1: period1.toISOString().split('T')[0], type: 'annual', module: 'financials' }, { validateResult: false }).catch(() => []),
        yf.fundamentalsTimeSeries(ticker, { period1: period1.toISOString().split('T')[0], type: 'annual', module: 'balance-sheet' }, { validateResult: false }).catch(() => []),
      ])

      fundamentals.income = (financials || []).filter(d => d.date).map(d => ({
        date: d.date instanceof Date ? d.date.toISOString().split('T')[0] : String(d.date),
        totalRevenue: d.totalRevenue ?? null,
        netIncome: d.netIncome ?? null,
        ebitda: d.EBITDA ?? d.normalizedEBITDA ?? null,
      })).sort((a, b) => a.date.localeCompare(b.date))

      fundamentals.balance = (balanceSheet || []).filter(d => d.date).map(d => ({
        date: d.date instanceof Date ? d.date.toISOString().split('T')[0] : String(d.date),
        totalDebt: d.totalDebt ?? null,
        netDebt: d.netDebt ?? null,
      })).sort((a, b) => a.date.localeCompare(b.date))
    } catch (err) {
      console.warn(`[Safety] Fundamentals fetch failed for ${ticker}:`, err.message)
    }

    // Fetch dividend history — FMP first, Yahoo fallback
    let dividends = []
    if (FMP_API_KEY) {
      try {
        const divUrl = `https://financialmodelingprep.com/stable/historical-price-eod/dividend?symbol=${encodeURIComponent(ticker)}&apikey=${FMP_API_KEY}`
        let divRes = await fetch(divUrl)
        if (divRes.status === 402) {
          const v3Url = `https://financialmodelingprep.com/api/v3/historical-price-full/stock_dividend/${encodeURIComponent(ticker)}?apikey=${FMP_API_KEY}`
          divRes = await fetch(v3Url)
        }
        if (divRes.ok) {
          const divData = await divRes.json()
          const hist = Array.isArray(divData) ? divData : (divData.historical || [])
          dividends = hist.map(d => ({
            date: d.date,
            amount: d.dividend ?? d.adjDividend ?? d.amount ?? 0,
          })).filter(d => d.amount > 0)
        }
      } catch (err) {
        console.warn(`[Safety] FMP dividends fetch failed for ${ticker}:`, err.message)
      }
    }
    // Yahoo fallback for dividends
    if (dividends.length === 0) {
      try {
        const divResult = await yf.chart(ticker, {
          period1: new Date(Date.now() - 10 * 365.25 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          period2: new Date().toISOString().split('T')[0],
          interval: '1d',
          events: 'div',
        }, { validateResult: false })
        dividends = (divResult?.events?.dividends || [])
          .map(d => ({ date: d.date.toISOString().split('T')[0], amount: d.amount || 0 }))
          .filter(d => d.amount > 0)
        if (dividends.length > 0) console.log(`[Safety] Yahoo dividend fallback for ${ticker}: ${dividends.length} payments`)
      } catch (err) {
        console.warn(`[Safety] Yahoo dividends fallback failed for ${ticker}:`, err.message)
      }
    }

    // Fetch profile for REIT detection
    let profile = null
    if (FMP_API_KEY) {
      try {
        const profUrl = `https://financialmodelingprep.com/stable/profile?symbol=${encodeURIComponent(ticker)}&apikey=${FMP_API_KEY}`
        let profRes = await fetch(profUrl)
        if (profRes.status === 402) {
          const v3Url = `https://financialmodelingprep.com/api/v3/profile/${encodeURIComponent(ticker)}?apikey=${FMP_API_KEY}`
          profRes = await fetch(v3Url)
        }
        if (profRes.ok) {
          const profData = await profRes.json()
          profile = Array.isArray(profData) ? profData[0] : profData
        }
      } catch (err) {
        console.warn(`[Safety] Profile fetch failed for ${ticker}:`, err.message)
      }
    }

    // 3. Compute mechanical score
    const safetyResult = computeSafetyScore({ cashFlow, fundamentals, dividends, profile })
    console.log(`[Safety] ${ticker}: score=${safetyResult.score} level=${safetyResult.level} isReit=${safetyResult.isReit}`)

    // 4. Generate Gemini analysis (if API key provided)
    let analysis = null
    let sources = []
    if (geminiKey) {
      try {
        const aiResult = await generateSafetyAnalysis(ticker, safetyResult, geminiKey)
        if (aiResult) {
          analysis = aiResult.text
          sources = aiResult.sources || []
          console.log(`[Safety] ${ticker}: AI analysis generated (${analysis.length} chars, ${sources.length} sources)`)
        }
      } catch (err) {
        console.warn(`[Safety] Gemini analysis failed for ${ticker}:`, err.message)
        // Continue without analysis — graceful degradation
      }
    }

    // 5. Cache in Supabase
    const response = {
      score: safetyResult.score,
      level: safetyResult.level,
      color: safetyResult.color,
      summary: safetyResult.summary,
      isReit: safetyResult.isReit,
      factors: safetyResult.factors,
      analysis,
      sources,
      cachedAt: new Date().toISOString(),
    }

    if (supabaseServer) {
      const now = new Date()
      const expires = new Date(now.getTime() + 24 * 60 * 60 * 1000) // 24h TTL
      try {
        const { error: upsertError } = await supabaseServer
          .from('dividend_safety')
          .upsert({
            ticker,
            score: safetyResult.score,
            level: safetyResult.level,
            color: safetyResult.color,
            summary: safetyResult.summary,
            is_reit: safetyResult.isReit,
            factors: safetyResult.factors,
            analysis,
            sources,
            computed_at: now.toISOString(),
            expires_at: expires.toISOString(),
          }, { onConflict: 'ticker' })

        if (upsertError) {
          console.warn(`[Safety] Supabase cache write failed:`, upsertError.message)
        } else {
          console.log(`[Safety] ${ticker}: cached in Supabase (expires ${expires.toISOString()})`)
        }
      } catch (err) {
        console.warn(`[Safety] Supabase cache write error:`, err.message)
      }
    }

    res.json(response)
  } catch (err) {
    console.error(`[Safety] Error for ${ticker}:`, err.message)
    res.status(500).json({ error: err.message })
  }
})

// ─── Earnings Call Dividend Decoder ─────────────────────────────────────────

/**
 * GET /api/earnings-call/:ticker
 * Fetches and analyzes the latest earnings call for dividend-relevant info.
 * Strategy: FMP transcript (if available) → Gemini analysis
 *           No transcript → Gemini Search grounding fallback
 *
 * Headers: x-gemini-key (required for analysis)
 * Query: ?year=2025&quarter=4 (optional, defaults to most recent)
 *
 * Returns: { ticker, callDate, fiscalPeriod, brief, tone, sources, hasTranscript, analyzedAt }
 */
app.get('/api/earnings-call/:ticker', async (req, res) => {
  const ticker = req.params.ticker?.toUpperCase()
  if (!ticker) return res.status(400).json({ error: 'Ticker required' })

  const geminiKey = req.headers['x-gemini-key'] || ''
  const forceRefresh = req.query.refresh === 'true'
  const requestedYear = req.query.year ? Number(req.query.year) : null
  const requestedQuarter = req.query.quarter ? Number(req.query.quarter) : null

  try {
    // 1. Check Supabase cache first (~90 day TTL)
    if (supabaseServer && !forceRefresh) {
      try {
        let query = supabaseServer
          .from('earnings_call_briefs')
          .select('*')
          .eq('ticker', ticker)

        // If specific period requested, filter by it
        if (requestedYear && requestedQuarter) {
          query = query.eq('fiscal_period', `Q${requestedQuarter} ${requestedYear}`)
        } else {
          query = query.order('call_date', { ascending: false }).limit(1)
        }

        const { data: cached } = await query

        if (cached && cached.length > 0) {
          const record = cached[0]
          if (record.expires_at && new Date(record.expires_at) > new Date()) {
            console.log(`[EarningsCall] Cache hit: ${ticker} ${record.fiscal_period}`)
            return res.json({
              ticker: record.ticker,
              callDate: record.call_date,
              fiscalPeriod: record.fiscal_period,
              brief: record.brief,
              tone: record.tone,
              sources: record.sources,
              hasTranscript: record.has_transcript,
              analyzedAt: record.analyzed_at,
            })
          }
        }
      } catch { /* cache miss */ }
    }

    // 2. Try to fetch transcript from FMP
    console.log(`[EarningsCall] Processing ${ticker}...`)
    let transcript = null
    if (FMP_API_KEY) {
      transcript = await fetchTranscript(ticker, FMP_API_KEY, requestedYear, requestedQuarter)
      if (transcript) {
        console.log(`[EarningsCall] Got transcript: ${ticker} ${transcript.fiscalPeriod} (${transcript.contentLength} chars, ${transcript.segments.length} segments)`)
      } else {
        console.log(`[EarningsCall] No FMP transcript available for ${ticker} — will use Gemini search fallback`)
      }
    }

    // 3. Generate Gemini analysis
    if (!geminiKey) {
      return res.status(400).json({ error: 'Se requiere Gemini API key para el análisis' })
    }

    // Determine fiscal period for the prompt
    const fiscalPeriod = transcript?.fiscalPeriod || (() => {
      if (requestedYear && requestedQuarter) return `Q${requestedQuarter} ${requestedYear}`
      const now = new Date()
      const prevQ = Math.max(1, Math.ceil(now.getMonth() / 3) - 1) || 4
      const yr = prevQ === 4 ? now.getFullYear() - 1 : now.getFullYear()
      return `Q${prevQ} ${yr}`
    })()

    // Extract dividend-focused context from transcript (or null for search mode)
    const transcriptContext = transcript ? extractDividendContext(transcript.content) : null

    const aiResult = await generateEarningsCallBrief(ticker, fiscalPeriod, transcriptContext, geminiKey)
    if (!aiResult) {
      return res.status(500).json({ error: 'Gemini no pudo generar el análisis' })
    }

    console.log(`[EarningsCall] ${ticker} ${fiscalPeriod}: brief=${aiResult.text.length} chars, tone=${aiResult.tone}, sources=${aiResult.sources.length}`)

    // 4. Build response
    const response = {
      ticker,
      callDate: transcript?.callDate || null,
      fiscalPeriod,
      brief: aiResult.text,
      tone: aiResult.tone,
      sources: aiResult.sources,
      hasTranscript: !!transcript,
      analyzedAt: new Date().toISOString(),
    }

    // 5. Cache in Supabase (~90 day TTL)
    if (supabaseServer) {
      const now = new Date()
      const expires = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000)
      try {
        const { error: upsertError } = await supabaseServer
          .from('earnings_call_briefs')
          .upsert({
            id: `${ticker}_${fiscalPeriod.replace(/\s/g, '_')}`,
            ticker,
            call_date: transcript?.callDate || null,
            fiscal_period: fiscalPeriod,
            brief: aiResult.text,
            tone: aiResult.tone,
            sources: aiResult.sources,
            has_transcript: !!transcript,
            analyzed_at: now.toISOString(),
            expires_at: expires.toISOString(),
          }, { onConflict: 'id' })

        if (upsertError) {
          console.warn(`[EarningsCall] Supabase cache write failed:`, upsertError.message)
        }
      } catch (err) {
        console.warn(`[EarningsCall] Supabase error:`, err.message)
      }
    }

    res.json(response)
  } catch (err) {
    console.error(`[EarningsCall] Error for ${ticker}:`, err.message)
    res.status(500).json({ error: err.message })
  }
})

// ─── Portfolio Income Simulator ─────────────────────────────────────────────

/**
 * POST /api/income-simulator
 * "Optimal Mix" simulator — user provides an amount + candidates, server enriches
 * each candidate with dividend data + safety score, runs projection, and optionally
 * asks Gemini for allocation advice.
 *
 * Body: {
 *   amount: 5000,                          // investment amount
 *   years: 5,                              // projection horizon
 *   candidates: [{ticker, name, currentPrice}]  // from portfolio + watchlist
 * }
 * Headers: x-gemini-key (optional)
 */
app.post('/api/income-simulator', async (req, res) => {
  try {
    const { amount, years = 5, candidates } = req.body
    const geminiKey = req.headers['x-gemini-key'] || ''

    if (!candidates || !Array.isArray(candidates) || candidates.length === 0) {
      return res.status(400).json({ error: 'candidates array required' })
    }
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'amount must be > 0' })
    }

    console.log(`[Simulator] Processing ${candidates.length} candidates, €${amount}, ${years}y`)

    // Enrich each candidate with dividend data (Yahoo) + safety score (Supabase cache)
    const enriched = await Promise.all(candidates.map(async (c) => {
      const ticker = c.ticker?.toUpperCase()
      if (!ticker) return null

      let annualDividend = 0
      let dividendCAGR = 0
      let yieldPct = 0
      let safetyScore = null
      let safetyLevel = null
      let safetyColor = null
      let payoutRatio = null
      let weiss = {} // Geraldine Weiss valuation data
      const price = Number(c.currentPrice) || 0

      // 1) Yahoo Finance: dividend history
      try {
        const result = await yf.chart(ticker, {
          period1: new Date(Date.now() - 6 * 365.25 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          period2: new Date().toISOString().split('T')[0],
          interval: '1d',
          events: 'div',
        })

        const rawDivs = result?.events?.dividends || []
        const payments = rawDivs
          .map(d => ({ date: d.date.toISOString().split('T')[0], amount: d.amount || 0 }))
          .filter(d => d.amount > 0)
          .sort((a, b) => b.date.localeCompare(a.date))

        if (payments.length > 0) {
          const now = new Date()
          const oneYearAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()).toISOString().split('T')[0]
          const ttm = payments.filter(p => p.date >= oneYearAgo)
          annualDividend = ttm.length > 0
            ? ttm.reduce((s, p) => s + p.amount, 0)
            : payments.slice(0, 4).reduce((s, p) => s + p.amount, 0)

          if (price > 0) yieldPct = (annualDividend / price) * 100

          // CAGR — exclude current year (incomplete, would distort the calculation)
          const currentYr = String(new Date().getFullYear())
          const byYear = {}
          for (const p of payments) {
            const yr = p.date.substring(0, 4)
            if (yr === currentYr) continue // skip incomplete year
            byYear[yr] = (byYear[yr] || 0) + p.amount
          }
          const sortedYears = Object.keys(byYear).sort()
          if (sortedYears.length >= 3) {
            const recentYr = sortedYears[sortedYears.length - 1]
            const oldIdx = Math.max(0, sortedYears.length - 6)
            const oldYr = sortedYears[oldIdx]
            const n = Number(recentYr) - Number(oldYr)
            if (n > 0 && byYear[oldYr] > 0 && byYear[recentYr] > 0) {
              dividendCAGR = Math.pow(byYear[recentYr] / byYear[oldYr], 1 / n) - 1
            }
          }
        }
      } catch (err) {
        console.warn(`[Simulator] Yahoo fetch failed for ${ticker}:`, err.message)
      }

      // 2) Supabase cache: safety score (if available)
      if (supabaseServer) {
        try {
          const { data: safetyRow } = await supabaseServer
            .from('dividend_safety')
            .select('score, level, color, factors')
            .eq('ticker', ticker)
            .maybeSingle()

          if (safetyRow) {
            safetyScore = safetyRow.score
            safetyLevel = safetyRow.level
            safetyColor = safetyRow.color
            // Extract payout ratio from factors if available
            const factors = safetyRow.factors
            if (factors) {
              const prFactor = Array.isArray(factors) ? factors.find(f => f.key === 'payoutRatio') : factors.payoutRatio
              if (prFactor?.value != null) payoutRatio = prFactor.value
            }
          }
        } catch { /* cache miss is fine */ }
      }

      // 3) Supabase cache: Geraldine Weiss valuation data + full buy score
      if (supabaseServer) {
        try {
          const { data: analysisRow } = await supabaseServer
            .from('analyses')
            .select('indicators, projection, dividends, cash_flow, fundamentals')
            .eq('ticker', ticker)
            .order('updated_at', { ascending: false })
            .limit(1)
            .maybeSingle()

          if (analysisRow?.indicators) {
            const ind = analysisRow.indicators
            const avgHigh = Number(ind.avgHighYield || 0)
            const avgLow = Number(ind.avgLowYield || 0)
            const curYield = Number(ind.currentYield || 0)
            const overvaluedPrice = Number(ind.overvaluedPrice || 0)

            const range = avgHigh - avgLow
            if (range > 0) {
              weiss.yieldRatio = Math.max(0, (curYield - avgLow) / range)
            }
            if (overvaluedPrice > 0 && price > 0) {
              weiss.upsidePct = ((overvaluedPrice - price) / price) * 100
            }

            // Compute full Geraldine Weiss buy score (same as ranking page)
            try {
              const scoring = computeBuyScore(
                ind,
                analysisRow.projection || null,
                analysisRow.dividends || [],
                analysisRow.cash_flow || [],
                analysisRow.fundamentals || null
              )
              if (scoring && scoring.score > 0) {
                weiss.score = scoring.score
                weiss.signal = scoring.signal
              }
            } catch { /* scoring computation failed, use fallback */ }
          }
        } catch { /* cache miss is fine */ }
      }

      if (annualDividend > 0) {
        const wr = weiss.yieldRatio != null ? ` weissR=${weiss.yieldRatio.toFixed(2)}` : ''
        const up = weiss.upsidePct != null ? ` upside=${weiss.upsidePct.toFixed(0)}%` : ''
        console.log(`[Simulator] ${ticker}: yield=${yieldPct.toFixed(1)}%, CAGR=${(dividendCAGR * 100).toFixed(1)}%, safety=${safetyScore || '?'}${wr}${up}`)
      }

      return {
        ticker,
        name: c.name || ticker,
        currentPrice: price,
        annualDividend,
        dividendCAGR,
        yieldPct,
        safetyScore,
        safetyLevel,
        safetyColor,
        payoutRatio,
        weiss,
      }
    }))

    const validCandidates = enriched.filter(a => a && a.annualDividend > 0 && a.currentPrice > 0)

    if (validCandidates.length === 0) {
      return res.json({
        assets: [],
        allocation: [],
        allocationTotals: null,
        amount,
        years,
        error: 'Ningún activo con dividendos encontrado',
      })
    }

    // Run optimal mix simulation
    const result = simulateOptimalMix({ amount, years, candidates: validCandidates })

    // Gemini recommendation (optional)
    let recommendation = null
    if (geminiKey && result.assets.length > 0) {
      try {
        const aiResult = await generateIncomeRecommendation(result, geminiKey)
        if (aiResult) {
          recommendation = { text: aiResult.text, sources: aiResult.sources || [] }
        }
      } catch (err) {
        console.warn(`[Simulator] Gemini recommendation failed:`, err.message)
      }
    }

    res.json({ ...result, recommendation })
  } catch (err) {
    console.error(`[Simulator] Error:`, err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST regenerate narrative for a specific report (with grounding)
app.post('/api/sec/regenerate-narrative', async (req, res) => {
  try {
    const { reportId, reportData } = req.body
    const geminiKey = req.headers['x-gemini-key'] || ''
    if (!reportId) return res.status(400).json({ error: 'Falta reportId' })
    if (!geminiKey) return res.status(400).json({ error: 'Falta API key' })

    // Read the report from Supabase
    let report = null
    if (supabaseServer) {
      const { data } = await supabaseServer
        .from('financial_reports')
        .select('*')
        .eq('id', reportId)
        .single()
      if (data) {
        report = {
          id: data.id, ticker: data.ticker, reportType: data.report_type,
          periodCurrent: data.period_current, periodPrevious: data.period_previous,
          reportDate: data.report_date, filedDate: data.filed_date,
          metrics: data.metrics, diagnosis: data.diagnosis,
        }
      }
    }

    // Fallback: use report data sent by the client (report may not be in Supabase yet)
    let reportMissingFromDb = false
    if (!report && reportData) {
      report = {
        id: reportId,
        ticker: reportData.ticker,
        reportType: reportData.reportType,
        periodCurrent: reportData.periodCurrent,
        periodPrevious: reportData.periodPrevious,
        reportDate: reportData.reportDate,
        filedDate: reportData.filedDate,
        metrics: reportData.metrics,
        diagnosis: reportData.diagnosis,
      }
      reportMissingFromDb = true
      console.log(`[SEC] Report ${reportId} not in DB — using client-provided data`)
    }
    if (!report) return res.status(404).json({ error: 'Report not found' })

    const result = await generateNarrative(report.ticker, report, geminiKey)
    if (result?.text) {
      // If report was missing from DB, upsert the full record so audio generation can find it
      if (reportMissingFromDb && supabaseServer) {
        const row = {
          id: reportId, ticker: report.ticker, source: report.source || (reportId.includes('ESEF') ? 'esef' : 'sec'),
          report_type: report.reportType, period_current: report.periodCurrent,
          period_previous: report.periodPrevious, report_date: report.reportDate,
          filed_date: report.filedDate, metrics: report.metrics, diagnosis: report.diagnosis,
          narrative: result.text, narrative_sources: result.sources || null,
          fetched_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 7 * 24 * 3600_000).toISOString(),
        }
        const { error: uErr } = await supabaseServer.from('financial_reports').upsert([row], { onConflict: 'id' })
        if (uErr) console.warn('[SEC] Upsert missing report failed:', uErr.message)
        else console.log(`[SEC] Upserted missing report ${reportId} with narrative`)
      } else {
        await updateNarrativeDb(reportId, result.text, result.sources)
      }
      // Also update JSON file cache
      const fileCache = readSecCache()
      for (const key of Object.keys(fileCache)) {
        const cached = fileCache[key]
        if (cached?.reports) {
          const r = cached.reports.find(r => r.id === reportId)
          if (r) { r.narrative = result.text; r.narrativeSources = result.sources || []; break }
        }
      }
      writeSecCache(fileCache)
      res.json({ ok: true, narrative: result.text, narrativeSources: result.sources || [] })
    } else {
      res.json({ ok: false, error: 'Gemini returned empty response' })
    }
  } catch (err) {
    console.error('Error /api/sec/regenerate-narrative:', err.message)
    res.json({ ok: false, error: err.message })
  }
})

// POST generate audio narration for a report and upload to Supabase Storage
app.post('/api/sec/generate-audio', async (req, res) => {
  try {
    const { reportId } = req.body
    const geminiKey = req.headers['x-gemini-key'] || ''
    if (!reportId) return res.status(400).json({ error: 'Falta reportId' })
    if (!geminiKey) return res.status(400).json({ error: 'Falta API key' })
    if (!supabaseServer) return res.status(500).json({ error: 'Supabase no configurado' })

    // Read the report from Supabase to get the narrative
    // Use select('*') to avoid errors if audio_url column doesn't exist yet
    const { data: report, error: readErr } = await supabaseServer
      .from('financial_reports')
      .select('*')
      .eq('id', reportId)
      .single()

    if (readErr) {
      console.warn('[TTS] Supabase read error:', readErr.message)
      return res.status(500).json({ error: `Error leyendo informe: ${readErr.message}` })
    }
    if (!report) return res.status(404).json({ error: 'Informe no encontrado' })
    if (!report.narrative) return res.status(400).json({ error: 'El informe no tiene resumen — genera primero el resumen ejecutivo' })

    // If audio already exists in DB, return the existing URL
    if (report.audio_url) {
      console.log(`[TTS] Audio already exists in DB for ${reportId}: ${report.audio_url}`)
      return res.json({ ok: true, audioUrl: report.audio_url, cached: true })
    }

    // DB has no audio_url — but file might already exist in Storage (e.g. DB update failed before)
    const safeTicker = report.ticker.replace(/[^a-zA-Z0-9]/g, '_')
    const safePeriod = report.period_current.replace(/[^a-zA-Z0-9]/g, '_')
    const fileName = `${safeTicker}/${report.report_type}_${safePeriod}.wav`

    try {
      const { data: existingFile } = await supabaseServer
        .storage
        .from('reports')
        .list(safeTicker, { search: `${report.report_type}_${safePeriod}.wav` })

      if (existingFile && existingFile.length > 0) {
        // File exists in Storage — recover the URL and save to DB
        const { data: urlData } = supabaseServer.storage.from('reports').getPublicUrl(fileName)
        const recoveredUrl = urlData?.publicUrl || ''
        if (recoveredUrl) {
          console.log(`[TTS] Recovered audio from Storage for ${reportId}: ${recoveredUrl}`)
          await supabaseServer.from('financial_reports').update({ audio_url: recoveredUrl }).eq('id', reportId)
          return res.json({ ok: true, audioUrl: recoveredUrl, cached: true })
        }
      }
    } catch (e) { console.warn('[TTS] Storage check failed:', e.message) }

    // Generate audio via Gemini TTS
    const wavBuffer = await generateAudio(report.narrative, geminiKey)
    if (!wavBuffer) return res.json({ ok: false, error: 'Gemini TTS no devolvió audio' })

    // Upload to Supabase Storage bucket 'reports' (safeTicker/safePeriod/fileName defined above)
    console.log(`[TTS] Uploading ${fileName} to Supabase Storage (${(wavBuffer.length / 1024).toFixed(0)} KB)...`)

    const { data: uploadData, error: uploadErr } = await supabaseServer
      .storage
      .from('reports')
      .upload(fileName, wavBuffer, {
        contentType: 'audio/wav',
        upsert: true,
      })

    if (uploadErr) {
      console.error('[TTS] Upload failed:', uploadErr.message)
      return res.json({ ok: false, error: `Error al subir audio: ${uploadErr.message}` })
    }

    // Get public URL
    const { data: urlData } = supabaseServer
      .storage
      .from('reports')
      .getPublicUrl(fileName)

    const audioUrl = urlData?.publicUrl || ''
    console.log(`[TTS] ✓ Uploaded: ${audioUrl}`)

    // Save audio URL in the report record
    const { error: updateErr } = await supabaseServer
      .from('financial_reports')
      .update({ audio_url: audioUrl })
      .eq('id', reportId)
    if (updateErr) console.warn('[TTS] Failed to save audio_url to DB:', updateErr.message)

    res.json({ ok: true, audioUrl })
  } catch (err) {
    console.error('Error /api/sec/generate-audio:', err.message)
    res.json({ ok: false, error: err.message })
  }
})

// GET list of reports for a ticker
app.get('/api/sec/reports', async (req, res) => {
  try {
    const { ticker, type } = req.query
    const geminiKey = req.headers['x-gemini-key'] || ''
    if (!ticker) return res.status(400).json({ error: 'Falta el parámetro ticker' })
    if (!isUsTicker(ticker)) return res.json({ reports: [], notUs: true })

    const formType = (type || '10-Q').toUpperCase()
    const tickerUp = ticker.toUpperCase()

    // 1. Try Supabase cache first, then JSON file
    let cachedReports = await readSecCacheDb(tickerUp, formType)
    let cacheSource = 'supabase'
    if (!cachedReports.length) {
      // Fallback to JSON file
      const fileCache = readSecCache()
      const cacheKey = `${tickerUp}_${formType}`
      const fileCached = fileCache[cacheKey]
      if (fileCached && Array.isArray(fileCached.reports)) {
        cachedReports = fileCached.reports
        cacheSource = 'file'
      }
    }

    // Check if cache is fresh
    const isFresh = cachedReports.length > 0 &&
      cachedReports[0].fetchedAt &&
      (Date.now() - new Date(cachedReports[0].fetchedAt).getTime()) < SEC_CACHE_TTL

    if (isFresh) {
      console.log(`[SEC] Cache hit (${cacheSource}): ${tickerUp} ${formType} (${cachedReports.length} reports)`)
      // If from file cache, sync to Supabase in background
      if (cacheSource === 'file') writeSecCacheDb(cachedReports).catch(() => {})
      // Repair audio_url for reports that have audio in Storage but missing DB entry
      await repairAudioUrls(cachedReports)
      return res.json({
        ticker: tickerUp, formType, reports: cachedReports,
        hasNarrative: cachedReports.some(r => r.narrative),
      })
    }

    // 2. Fetch fresh reports from SEC EDGAR
    console.log(`[SEC] Fetching ${tickerUp} ${formType}...`)
    const reports = await fetchReportList(ticker, formType)

    // Preserve existing narratives and audio from cache
    for (const r of reports) {
      const prev = cachedReports.find(cr => cr.id === r.id)
      if (prev?.narrative) {
        r.narrative = prev.narrative
        if (prev.narrativeSources) r.narrativeSources = prev.narrativeSources
      }
      if (prev?.audioUrl) r.audioUrl = prev.audioUrl
    }

    // Narratives are generated on-demand via /api/sec/regenerate-narrative
    // (no batch generation here — avoids rate limiting)

    // 3. Save to Supabase + JSON file
    await writeSecCacheDb(reports)
    const fileCache = readSecCache()
    fileCache[`${tickerUp}_${formType}`] = {
      ticker: tickerUp, formType, reports,
      fetchedAt: new Date().toISOString(),
      hasNarrative: reports.some(r => r.narrative),
    }
    writeSecCache(fileCache)

    res.json({
      ticker: tickerUp, formType, reports,
      fetchedAt: new Date().toISOString(),
      hasNarrative: reports.some(r => r.narrative),
    })
  } catch (err) {
    console.error('Error /api/sec/reports:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET check for new filings across all portfolio US tickers
app.get('/api/sec/check-new', async (req, res) => {
  try {
    const db = readDB()
    const allAssets = [...(db.actives || []), ...(db.watchlist || [])]
    const usTickers = allAssets.filter(a => isUsTicker(a.ticker)).map(a => a.ticker.toUpperCase())
    const newFilings = []

    for (const ticker of usTickers) {
      try {
        for (const formType of ['10-Q', '10-K']) {
          const latestDate = await getLatestFilingDate(ticker, formType)
          if (!latestDate) continue

          // Check against Supabase first, then file cache
          let cachedLatest = null
          const dbReports = await readSecCacheDb(ticker, formType)
          if (dbReports.length) {
            cachedLatest = dbReports[0].filedDate
          } else {
            const fileCache = readSecCache()
            cachedLatest = fileCache[`${ticker}_${formType}`]?.reports?.[0]?.filedDate
          }

          if (latestDate !== cachedLatest) {
            newFilings.push({ ticker, formType, filedDate: latestDate, isNew: true })
          }
        }
        await new Promise(r => setTimeout(r, 200))
      } catch (err) {
        console.warn(`[SEC] Check failed for ${ticker}:`, err.message)
      }
    }

    res.json({ checked: usTickers.length, newFilings })
  } catch (err) {
    console.error('Error /api/sec/check-new:', err.message)
    res.json({ checked: 0, newFilings: [] })
  }
})

// ── ESEF reports (European tickers: CNMV, Euronext, LSE, etc.) ──────────────
app.get('/api/esef/reports', async (req, res) => {
  try {
    const { ticker } = req.query
    if (!ticker) return res.status(400).json({ error: 'Falta el parámetro ticker' })
    if (!isEuropeanTicker(ticker)) return res.json({ reports: [], notEuropean: true })

    const tickerUp = ticker.toUpperCase()

    // 1. Check Supabase cache
    let cachedReports = []
    if (supabaseServer) {
      try {
        const { data } = await supabaseServer
          .from('financial_reports')
          .select('*')
          .eq('ticker', tickerUp)
          .eq('source', 'esef')
          .order('report_date', { ascending: false })
        if (data?.length) cachedReports = data.map(row => ({
          id: row.id, ticker: row.ticker, source: row.source,
          reportType: row.report_type, periodCurrent: row.period_current,
          periodPrevious: row.period_previous, reportDate: row.report_date,
          filedDate: row.filed_date, metrics: row.metrics, diagnosis: row.diagnosis,
          narrative: row.narrative, narrativeSources: row.narrative_sources || [],
          audioUrl: row.audio_url || null, fetchedAt: row.fetched_at,
        }))
      } catch (e) { console.warn('[ESEF] Supabase read error:', e.message) }
    }

    const isFresh = cachedReports.length > 0 &&
      cachedReports[0].fetchedAt &&
      (Date.now() - new Date(cachedReports[0].fetchedAt).getTime()) < 7 * 24 * 3600_000

    if (isFresh) {
      console.log(`[ESEF] Cache hit: ${tickerUp} (${cachedReports.length} reports)`)
      await repairAudioUrls(cachedReports)
      return res.json({
        ticker: tickerUp, reports: cachedReports,
        hasNarrative: cachedReports.some(r => r.narrative),
      })
    }

    // 2. Fetch fresh from filings.xbrl.org
    console.log(`[ESEF] Fetching ${tickerUp}...`)
    const reports = await fetchEsefReportList(ticker)

    // Preserve existing narratives and audio
    for (const r of reports) {
      const prev = cachedReports.find(cr => cr.id === r.id)
      if (prev?.narrative) {
        r.narrative = prev.narrative
        if (prev.narrativeSources) r.narrativeSources = prev.narrativeSources
      }
      if (prev?.audioUrl) r.audioUrl = prev.audioUrl
    }

    // 3. Save to Supabase
    if (supabaseServer && reports.length) {
      const rows = reports.map(r => ({
        id: r.id, ticker: r.ticker, source: 'esef',
        report_type: r.reportType, period_current: r.periodCurrent,
        period_previous: r.periodPrevious, report_date: r.reportDate,
        filed_date: r.filedDate, metrics: r.metrics, diagnosis: r.diagnosis,
        narrative: r.narrative || null, narrative_sources: r.narrativeSources || null,
        audio_url: r.audioUrl || null,
        fetched_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 30 * 24 * 3600_000).toISOString(),
      }))
      try {
        const { error: upsertErr } = await supabaseServer.from('financial_reports').upsert(rows, { onConflict: 'id' })
        if (upsertErr) console.warn('[ESEF] Supabase write error:', upsertErr.message)
      } catch (e) { console.warn('[ESEF] Supabase write error:', e.message) }
    }

    res.json({
      ticker: tickerUp, reports,
      hasNarrative: reports.some(r => r.narrative),
    })
  } catch (err) {
    console.error('Error /api/esef/reports:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ── Background scheduler: check for new SEC filings every 6 hours ──
let secCheckInterval = null
function startSecScheduler() {
  const SIX_HOURS = 6 * 60 * 60 * 1000

  async function fetchAndCache(ticker, formType) {
    const reports = await fetchReportList(ticker, formType)
    // Preserve existing narratives
    const existing = await readSecCacheDb(ticker, formType)
    for (const r of reports) {
      const prev = existing.find(cr => cr.id === r.id)
      if (prev?.narrative) {
        r.narrative = prev.narrative
        if (prev.narrativeSources) r.narrativeSources = prev.narrativeSources
      }
    }
    // Write to both Supabase and JSON file
    await writeSecCacheDb(reports)
    const fileCache = readSecCache()
    fileCache[`${ticker}_${formType}`] = {
      ticker, formType, reports,
      fetchedAt: new Date().toISOString(),
      hasNarrative: reports.some(r => r.narrative),
    }
    writeSecCache(fileCache)
    return reports
  }

  // Initial check 30 seconds after startup
  setTimeout(async () => {
    console.log('[SEC Scheduler] Running initial check...')
    try {
      const db = readDB()
      const allAssets = [...(db.actives || []), ...(db.watchlist || [])]
      const usTickers = allAssets.filter(a => isUsTicker(a.ticker)).map(a => a.ticker.toUpperCase())
      if (usTickers.length === 0) return

      for (const ticker of usTickers) {
        for (const formType of ['10-Q', '10-K']) {
          // Check if we have fresh data already
          const cached = await readSecCacheDb(ticker, formType)
          if (cached.length && cached[0].fetchedAt && (Date.now() - new Date(cached[0].fetchedAt).getTime()) < SEC_CACHE_TTL) continue
          try {
            console.log(`[SEC Scheduler] Fetching ${ticker} ${formType}...`)
            await fetchAndCache(ticker, formType)
          } catch (err) { console.warn(`[SEC Scheduler] ${ticker} ${formType}: ${err.message}`) }
          await new Promise(r => setTimeout(r, 500))
        }
      }
      console.log('[SEC Scheduler] Initial check done.')
    } catch (err) { console.error('[SEC Scheduler] Error:', err.message) }
  }, 30_000)

  // Repeat every 6 hours
  secCheckInterval = setInterval(async () => {
    console.log('[SEC Scheduler] Periodic check...')
    try {
      const db = readDB()
      const allAssets = [...(db.actives || []), ...(db.watchlist || [])]
      const usTickers = allAssets.filter(a => isUsTicker(a.ticker)).map(a => a.ticker.toUpperCase())
      for (const ticker of usTickers) {
        for (const formType of ['10-Q', '10-K']) {
          try {
            const latestDate = await getLatestFilingDate(ticker, formType)
            const cached = await readSecCacheDb(ticker, formType)
            const cachedLatest = cached[0]?.filedDate
            if (latestDate && latestDate !== cachedLatest) {
              console.log(`[SEC Scheduler] New ${formType} for ${ticker} (${latestDate})`)
              await fetchAndCache(ticker, formType)
            }
          } catch { /* skip ticker */ }
          await new Promise(r => setTimeout(r, 300))
        }
      }
    } catch (err) { console.error('[SEC Scheduler] Error:', err.message) }
  }, SIX_HOURS)
}

// Start scheduler when server boots
startSecScheduler()

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
