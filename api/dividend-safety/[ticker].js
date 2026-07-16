import YahooFinance from 'yahoo-finance2'
import { createClient } from '@supabase/supabase-js'
import { computeSafetyScore } from '../../dividend-safety.js'
import { generateSafetyAnalysis } from '../../llm-provider.js'

// ─── Shared clients (module scope, reused across warm invocations) ───────────
const yf = new YahooFinance({ suppressNotices: ['ripHistorical', 'yahooSurvey'] })
const FMP_API_KEY = process.env.VITE_FMP_API_KEY

const SUPABASE_URL = process.env.VITE_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY
const supabaseServer = (SUPABASE_URL && SUPABASE_SERVICE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  : null

/**
 * GET /api/dividend-safety/:ticker
 * Serverless port of the Express route in server.js. Calculates the mechanical
 * dividend safety score + optional Gemini analysis, with a 24h Supabase cache.
 * Header: x-gemini-key (optional). Query: ?refresh=true to bypass cache.
 */
export default async function handler(req, res) {
  const ticker = String(req.query.ticker || '').toUpperCase()
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

        if (yahooCf && yahooCf.length > 0) {
          cashFlow = yahooCf
            .filter(d => d.date)
            .map(d => {
              const dateStr = d.date instanceof Date ? d.date.toISOString().split('T')[0] : String(d.date)
              const fcf = d.freeCashFlow ?? null
              const ocf = d.operatingCashFlow ?? null
              const divPaid = Math.abs(d.cashDividendsPaid ?? d.commonStockDividendPaid ?? d.paymentOfDividends ?? 0)

              return {
                year: dateStr.substring(0, 4),
                freeCashFlow: fcf ?? (ocf != null && d.capitalExpenditure != null ? ocf + d.capitalExpenditure : 0),
                dividendsPaid: divPaid,
                operatingCashFlow: ocf ?? 0,
              }
            })
            .sort((a, b) => b.year.localeCompare(a.year)) // newest first

          console.log(`[Safety] Yahoo cash flow for ${ticker}: ${cashFlow.length} years`)
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

    // 5. Build + cache response
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
}
