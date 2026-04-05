import { supabase } from '@/lib/supabase'

const CACHE_TTL = 7 * 24 * 60 * 60 * 1000 // 7 days

/**
 * Fetch SEC reports for a ticker.
 * 1. Check Supabase for cached reports (fast, no server call)
 * 2. If stale/missing, call the server to fetch from SEC
 * Narratives are generated on-demand via regenerateNarrative()
 */
export async function fetchSecReports(ticker, formType = '10-Q') {
  const tickerUp = ticker.toUpperCase()

  // 1. Try Supabase cache first
  try {
    const { data: cached, error } = await supabase
      .from('financial_reports')
      .select('*')
      .eq('ticker', tickerUp)
      .eq('report_type', formType)
      .order('report_date', { ascending: false })

    if (!error && cached && cached.length > 0) {
      const oldestFetch = new Date(cached[0].fetched_at).getTime()
      const isFresh = (Date.now() - oldestFetch) < CACHE_TTL

      if (isFresh) {
        console.log(`[SEC] Supabase cache hit: ${tickerUp} ${formType} (${cached.length} reports)`)
        return {
          ticker: tickerUp,
          formType,
          reports: cached.map(mapDbToReport),
          hasNarrative: cached.some(r => r.narrative),
          fromCache: true,
        }
      }
    }
  } catch (err) {
    console.warn('[SEC] Supabase read failed, falling back to server:', err.message)
  }

  // 2. Call server to fetch fresh data (no narrative generation)
  const res = await fetch(`/api/sec/reports?ticker=${encodeURIComponent(ticker)}&type=${formType}`)
  const data = await res.json()
  if (data.error) throw new Error(data.error)
  return data
}

/**
 * Regenerate narrative for a single report (with Google Search grounding).
 * Called on-demand when the user opens a report detail.
 */
export async function regenerateNarrative(reportId, geminiApiKey) {
  const headers = { 'Content-Type': 'application/json' }
  if (geminiApiKey) headers['x-gemini-key'] = geminiApiKey
  const res = await fetch('/api/sec/regenerate-narrative', {
    method: 'POST',
    headers,
    body: JSON.stringify({ reportId }),
  })
  return res.json()
}

/**
 * Generate audio narration for a report.
 * Returns { ok, audioUrl } or { ok: false, error }.
 */
export async function generateReportAudio(reportId, geminiApiKey) {
  const headers = { 'Content-Type': 'application/json' }
  if (geminiApiKey) headers['x-gemini-key'] = geminiApiKey
  const res = await fetch('/api/sec/generate-audio', {
    method: 'POST',
    headers,
    body: JSON.stringify({ reportId }),
  })
  return res.json()
}

/** Map Supabase row → frontend report format */
function mapDbToReport(row) {
  return {
    id: row.id,
    ticker: row.ticker,
    source: row.source,
    reportType: row.report_type,
    periodCurrent: row.period_current,
    periodPrevious: row.period_previous,
    reportDate: row.report_date,
    filedDate: row.filed_date,
    metrics: row.metrics,
    diagnosis: row.diagnosis,
    narrative: row.narrative,
    narrativeSources: row.narrative_sources || [],
    audioUrl: row.audio_url || null,
  }
}
