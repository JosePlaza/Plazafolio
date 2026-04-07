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
        const reports = cached.map(mapDbToReport)
        // Repair audio URLs for reports with audio in Storage but missing DB entry
        repairAudioUrls(reports).catch(() => {})
        return {
          ticker: tickerUp,
          formType,
          reports,
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
export async function regenerateNarrative(reportId, geminiApiKey, reportData = null) {
  const headers = { 'Content-Type': 'application/json' }
  if (geminiApiKey) headers['x-gemini-key'] = geminiApiKey
  const body = { reportId }
  // Send report data as fallback in case the report is not yet in Supabase
  if (reportData) {
    body.reportData = {
      ticker: reportData.ticker, reportType: reportData.reportType,
      periodCurrent: reportData.periodCurrent, periodPrevious: reportData.periodPrevious,
      reportDate: reportData.reportDate, filedDate: reportData.filedDate,
      metrics: reportData.metrics, diagnosis: reportData.diagnosis,
    }
  }
  const res = await fetch('/api/sec/regenerate-narrative', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
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

/**
 * Repair audio URLs for reports that have audio in Storage but missing audio_url in DB.
 * Constructs the deterministic Storage URL and checks existence via HEAD request.
 * Mutates reports in-place and updates DB in background.
 */
export async function repairAudioUrls(reports) {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  if (!supabaseUrl) return

  const toCheck = reports.filter(r => !r.audioUrl && r.narrative && r.ticker && r.reportType && r.periodCurrent)
  if (!toCheck.length) return

  await Promise.all(toCheck.map(async (r) => {
    try {
      const safeTicker = r.ticker.replace(/[^a-zA-Z0-9]/g, '_')
      const safePeriod = r.periodCurrent.replace(/[^a-zA-Z0-9]/g, '_')
      const expectedUrl = `${supabaseUrl}/storage/v1/object/public/reports/${safeTicker}/${r.reportType}_${safePeriod}.wav`

      const head = await fetch(expectedUrl, { method: 'HEAD' })
      if (head.ok) {
        r.audioUrl = expectedUrl
        console.log(`[Audio] Recovered URL for ${r.id}: ${expectedUrl}`)
        // Update DB in background (fire-and-forget)
        supabase.from('financial_reports').update({ audio_url: expectedUrl }).eq('id', r.id)
          .then(({ error }) => { if (error) console.warn(`[Audio] DB repair failed for ${r.id}`) })
      }
    } catch { /* ignore individual failures */ }
  }))
}
