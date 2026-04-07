import { supabase } from '@/lib/supabase'

/**
 * Fetch dividend safety score for a ticker.
 * 1. Check Supabase cache (fast, no server call)
 * 2. If stale/missing, call the server to compute fresh score
 *
 * @param {string} ticker
 * @param {string} geminiApiKey - Optional, for AI analysis
 * @param {boolean} forceRefresh - Skip cache
 * @returns {Promise<Object>} { score, level, color, summary, isReit, factors, analysis?, sources? }
 */
export async function fetchSafetyScore(ticker, geminiApiKey = '', forceRefresh = false) {
  const tickerUp = ticker.toUpperCase()

  // 1. Try Supabase cache first (unless forced refresh)
  if (!forceRefresh) {
    try {
      const { data: cached, error } = await supabase
        .from('dividend_safety')
        .select('*')
        .eq('ticker', tickerUp)
        .single()

      if (!error && cached && cached.expires_at && new Date(cached.expires_at) > new Date()) {
        console.log(`[Safety] Cache hit: ${tickerUp} (score: ${cached.score})`)
        return {
          score: cached.score,
          level: cached.level,
          color: cached.color,
          summary: cached.summary,
          isReit: cached.is_reit,
          factors: cached.factors,
          analysis: cached.analysis,
          sources: cached.sources,
          cachedAt: cached.computed_at,
          fromCache: true,
        }
      }
    } catch {
      // Cache miss, fall through to server
    }
  }

  // 2. Call server to compute fresh score
  const headers = {}
  if (geminiApiKey) headers['x-gemini-key'] = geminiApiKey

  const url = `/api/dividend-safety/${encodeURIComponent(tickerUp)}${forceRefresh ? '?refresh=true' : ''}`
  const res = await fetch(url, { headers })
  const data = await res.json()

  if (data.error) throw new Error(data.error)
  return data
}

/**
 * Fetch safety scores for multiple tickers in parallel (with concurrency limit).
 * Returns a Map<ticker, safetyData>.
 *
 * @param {string[]} tickers
 * @param {string} geminiApiKey
 * @param {number} concurrency - Max concurrent requests (default 3)
 * @param {Function} onProgress - Called with (completed, total) for progress tracking
 * @returns {Promise<Map<string, Object>>}
 */
export async function fetchBatchSafetyScores(tickers, geminiApiKey = '', concurrency = 3, onProgress = null) {
  const results = new Map()
  const queue = [...tickers]
  let completed = 0

  async function worker() {
    while (queue.length > 0) {
      const ticker = queue.shift()
      try {
        const data = await fetchSafetyScore(ticker, geminiApiKey)
        results.set(ticker.toUpperCase(), data)
      } catch (err) {
        console.warn(`[Safety] Failed for ${ticker}:`, err.message)
        results.set(ticker.toUpperCase(), { score: null, error: err.message })
      }
      completed++
      if (onProgress) onProgress(completed, tickers.length)
    }
  }

  // Launch workers
  const workers = Array.from({ length: Math.min(concurrency, tickers.length) }, () => worker())
  await Promise.all(workers)

  return results
}
