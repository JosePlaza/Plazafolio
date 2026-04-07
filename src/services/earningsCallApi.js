import { supabase } from '@/lib/supabase'

/**
 * Fetch earnings call brief for a ticker.
 * 1. Check Supabase cache
 * 2. If stale/missing, call server to generate
 *
 * @param {string} ticker
 * @param {string} geminiApiKey
 * @param {Object} [opts] - { year, quarter, forceRefresh }
 * @returns {Promise<Object>} { ticker, callDate, fiscalPeriod, brief, tone, sources, hasTranscript }
 */
export async function fetchEarningsCallBrief(ticker, geminiApiKey = '', opts = {}) {
  const tickerUp = ticker.toUpperCase()
  const { year, quarter, forceRefresh } = opts

  // 1. Try Supabase cache
  if (!forceRefresh) {
    try {
      let query = supabase
        .from('earnings_call_briefs')
        .select('*')
        .eq('ticker', tickerUp)

      if (year && quarter) {
        query = query.eq('fiscal_period', `Q${quarter} ${year}`)
      } else {
        query = query.order('analyzed_at', { ascending: false }).limit(1)
      }

      const { data: cached, error } = await query

      if (!error && cached && cached.length > 0) {
        const record = cached[0]
        if (record.expires_at && new Date(record.expires_at) > new Date()) {
          console.log(`[EarningsCall] Cache hit: ${tickerUp} ${record.fiscal_period}`)
          return {
            ticker: record.ticker,
            callDate: record.call_date,
            fiscalPeriod: record.fiscal_period,
            brief: record.brief,
            tone: record.tone,
            sources: record.sources || [],
            hasTranscript: record.has_transcript,
            analyzedAt: record.analyzed_at,
            fromCache: true,
          }
        }
      }
    } catch {
      // Cache miss
    }
  }

  // 2. Call server
  const headers = {}
  if (geminiApiKey) headers['x-gemini-key'] = geminiApiKey

  const params = new URLSearchParams()
  if (year) params.set('year', year)
  if (quarter) params.set('quarter', quarter)
  if (forceRefresh) params.set('refresh', 'true')
  const qs = params.toString()

  const url = `/api/earnings-call/${encodeURIComponent(tickerUp)}${qs ? '?' + qs : ''}`
  const res = await fetch(url, { headers })
  const data = await res.json()

  if (data.error) throw new Error(data.error)
  return data
}
