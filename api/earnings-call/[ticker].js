import { createClient } from '@supabase/supabase-js'
import { fetchTranscript, extractDividendContext } from '../../earnings-calls.js'
import { generateEarningsCallBrief } from '../../llm-provider.js'

const FMP_API_KEY = process.env.VITE_FMP_API_KEY

const SUPABASE_URL = process.env.VITE_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY
const supabaseServer = (SUPABASE_URL && SUPABASE_SERVICE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  : null

/**
 * GET /api/earnings-call/:ticker
 * Serverless port of the Express route in server.js. Fetches an earnings-call
 * transcript (FMP) and generates a dividend-focused brief via Gemini, falling
 * back to Gemini Search grounding when no transcript exists. 90-day cache.
 * Header: x-gemini-key (required). Query: ?year=&quarter=&refresh=true
 */
export default async function handler(req, res) {
  const ticker = String(req.query.ticker || '').toUpperCase()
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
}
