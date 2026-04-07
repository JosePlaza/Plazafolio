import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import YahooFinance from 'yahoo-finance2'
import { readFileSync, writeFileSync, existsSync, statSync } from 'fs'
import { fetchReportList, getLatestFilingDate, isUsTicker } from './sec-edgar.js'
import { fetchReportList as fetchEsefReportList, isEuropeanTicker } from './esef-reports.js'
import { generateNarrative, generateAudio, testApiKey, checkModelsStatus } from './llm-provider.js'
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
