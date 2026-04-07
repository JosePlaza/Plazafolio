/**
 * Earnings Call Transcript Fetcher
 *
 * Dual strategy:
 *   1. FMP API (primary) — full transcript if available in plan
 *   2. Fallback — return null, let Gemini use Google Search grounding
 *      to find earnings call info from public sources
 *
 * FMP endpoints:
 *   - /stable/earning-call-transcript?symbol=AAPL&year=2025&quarter=4
 *   - /api/v3/earning_call_transcript/AAPL?quarter=4&year=2025
 */

/**
 * Fetch latest earnings call transcript for a ticker from FMP.
 * Returns { transcript, callDate, quarter, year, speaker segments }
 * or null if not available.
 *
 * @param {string} ticker
 * @param {string} fmpApiKey
 * @param {number} [year] - Specific year (defaults to current/recent)
 * @param {number} [quarter] - Specific quarter (defaults to most recent)
 * @returns {Promise<Object|null>}
 */
export async function fetchTranscript(ticker, fmpApiKey, year, quarter) {
  if (!fmpApiKey || !ticker) return null

  const tickerUp = ticker.toUpperCase()

  // If no year/quarter specified, try to find the most recent transcript
  if (!year || !quarter) {
    const available = await fetchAvailableTranscripts(tickerUp, fmpApiKey)
    if (available && available.length > 0) {
      // Most recent first
      const latest = available[0]
      year = latest.year
      quarter = latest.quarter
    } else {
      // Guess: current year, descend quarters
      const now = new Date()
      year = year || now.getFullYear()
      quarter = quarter || Math.max(1, Math.ceil(now.getMonth() / 3) - 1) // Previous quarter
    }
  }

  console.log(`[EarningsCall] Fetching transcript for ${tickerUp} Q${quarter} ${year}...`)

  // Try stable API first
  try {
    const stableUrl = `https://financialmodelingprep.com/stable/earning-call-transcript?symbol=${encodeURIComponent(tickerUp)}&year=${year}&quarter=${quarter}&apikey=${fmpApiKey}`
    const res = await fetch(stableUrl)

    if (res.ok) {
      const data = await res.json()
      if (Array.isArray(data) && data.length > 0) {
        return parseTranscript(data[0], tickerUp, year, quarter)
      }
    }

    if (res.status === 402) {
      console.log(`[EarningsCall] Stable API requires paid plan, trying v3...`)
    }
  } catch (err) {
    console.warn(`[EarningsCall] Stable API failed:`, err.message)
  }

  // Try v3 API as fallback
  try {
    const v3Url = `https://financialmodelingprep.com/api/v3/earning_call_transcript/${encodeURIComponent(tickerUp)}?quarter=${quarter}&year=${year}&apikey=${fmpApiKey}`
    const res = await fetch(v3Url)

    if (res.ok) {
      const data = await res.json()
      if (Array.isArray(data) && data.length > 0) {
        return parseTranscript(data[0], tickerUp, year, quarter)
      }
    }

    if (res.status === 402) {
      console.log(`[EarningsCall] v3 API also requires paid plan — will use Gemini search fallback`)
      return null
    }
  } catch (err) {
    console.warn(`[EarningsCall] v3 API failed:`, err.message)
  }

  console.log(`[EarningsCall] No transcript found for ${tickerUp} Q${quarter} ${year}`)
  return null
}

/**
 * Fetch list of available transcripts for a ticker.
 * Returns sorted array (most recent first) of { year, quarter }.
 */
async function fetchAvailableTranscripts(ticker, fmpApiKey) {
  try {
    const url = `https://financialmodelingprep.com/stable/earning-call-transcript-list?symbol=${encodeURIComponent(ticker)}&apikey=${fmpApiKey}`
    const res = await fetch(url)
    if (!res.ok) {
      if (res.status === 402) {
        // Try v4
        const v4Url = `https://financialmodelingprep.com/api/v4/earning_call_transcript?symbol=${encodeURIComponent(ticker)}&apikey=${fmpApiKey}`
        const v4Res = await fetch(v4Url)
        if (v4Res.ok) {
          const data = await v4Res.json()
          if (Array.isArray(data)) {
            return data
              .map(d => ({ year: d.year, quarter: d.quarter }))
              .sort((a, b) => b.year - a.year || b.quarter - a.quarter)
          }
        }
      }
      return null
    }
    const data = await res.json()
    if (Array.isArray(data)) {
      return data
        .map(d => ({ year: d.year, quarter: d.quarter }))
        .sort((a, b) => b.year - a.year || b.quarter - a.quarter)
    }
  } catch {
    return null
  }
  return null
}

/**
 * Parse FMP transcript response into structured format.
 */
function parseTranscript(raw, ticker, year, quarter) {
  const content = raw.content || raw.transcript || ''
  if (!content || content.length < 100) return null

  const callDate = raw.date || `${year}-Q${quarter}`

  // Try to extract speaker segments
  const segments = extractSpeakers(content)

  return {
    ticker,
    year,
    quarter,
    callDate,
    fiscalPeriod: `Q${quarter} ${year}`,
    content,         // Full transcript text
    contentLength: content.length,
    segments,        // Array of { speaker, role, text }
    source: 'fmp',
  }
}

/**
 * Extract speaker segments from a transcript.
 * FMP transcripts typically have "Speaker Name - Role: text" format.
 */
function extractSpeakers(content) {
  const segments = []
  // Common patterns in earnings call transcripts
  const speakerPattern = /^([A-Z][a-zA-Z\s.'-]+)\s*[-–—]\s*(CEO|CFO|COO|CTO|President|Chief|VP|Director|Analyst|Operator|Chairman)[^:]*:\s*/gm

  let match
  let lastIndex = 0
  let lastSpeaker = null
  let lastRole = null

  while ((match = speakerPattern.exec(content)) !== null) {
    // Save previous segment
    if (lastSpeaker !== null) {
      const text = content.slice(lastIndex, match.index).trim()
      if (text.length > 20) {
        segments.push({ speaker: lastSpeaker, role: lastRole, text })
      }
    }
    lastSpeaker = match[1].trim()
    lastRole = match[2].trim()
    lastIndex = match.index + match[0].length
  }

  // Last segment
  if (lastSpeaker !== null) {
    const text = content.slice(lastIndex).trim()
    if (text.length > 20) {
      segments.push({ speaker: lastSpeaker, role: lastRole, text })
    }
  }

  return segments
}

/**
 * Extract only the dividend-relevant portions of a transcript.
 * Returns a shorter text focused on capital allocation / dividend discussions.
 * Falls back to full transcript if no dividend mentions found.
 *
 * @param {string} content - Full transcript text
 * @param {number} maxChars - Max characters to return (default 8000)
 * @returns {string}
 */
export function extractDividendContext(content, maxChars = 8000) {
  if (!content) return ''

  const keywords = [
    'dividend', 'dividendo', 'payout', 'distribution',
    'capital allocation', 'capital return', 'shareholder return',
    'buyback', 'share repurchase', 'repurchas',
    'free cash flow', 'cash return', 'cash distribution',
    'yield', 'per share',
  ]

  const sentences = content.split(/(?<=[.!?])\s+/)
  const relevantChunks = []
  const contextWindow = 3 // sentences before/after a keyword match

  for (let i = 0; i < sentences.length; i++) {
    const lower = sentences[i].toLowerCase()
    if (keywords.some(kw => lower.includes(kw))) {
      // Grab surrounding context
      const start = Math.max(0, i - contextWindow)
      const end = Math.min(sentences.length, i + contextWindow + 1)
      const chunk = sentences.slice(start, end).join(' ')
      relevantChunks.push(chunk)
      i = end // skip ahead to avoid overlapping
    }
  }

  if (relevantChunks.length === 0) {
    // No dividend mentions — return first N chars as general context
    return content.slice(0, maxChars)
  }

  const result = relevantChunks.join('\n\n---\n\n')
  return result.slice(0, maxChars)
}
