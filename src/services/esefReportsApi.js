import { supabase } from '@/lib/supabase'
import { repairAudioUrls } from '@/services/secReportsApi'

const CACHE_TTL = 7 * 24 * 60 * 60 * 1000 // 7 days

/**
 * Fetch ESEF reports for a European ticker.
 * 1. Check Supabase cache (fast, no server call)
 * 2. If stale/missing, call server to fetch from filings.xbrl.org
 */
export async function fetchEsefReports(ticker) {
  const tickerUp = ticker.toUpperCase()

  // 1. Try Supabase cache first
  try {
    const { data: cached, error } = await supabase
      .from('financial_reports')
      .select('*')
      .eq('ticker', tickerUp)
      .eq('source', 'esef')
      .order('report_date', { ascending: false })

    if (!error && cached && cached.length > 0) {
      const oldestFetch = new Date(cached[0].fetched_at).getTime()
      const isFresh = (Date.now() - oldestFetch) < CACHE_TTL

      if (isFresh) {
        console.log(`[ESEF] Supabase cache hit: ${tickerUp} (${cached.length} reports)`)
        const reports = cached.map(mapDbToReport)
        repairAudioUrls(reports).catch(() => {})
        return {
          ticker: tickerUp,
          reports,
          hasNarrative: cached.some(r => r.narrative),
          fromCache: true,
        }
      }
    }
  } catch (err) {
    console.warn('[ESEF] Supabase read failed, falling back to server:', err.message)
  }

  // 2. Call server
  const res = await fetch(`/api/esef/reports?ticker=${encodeURIComponent(ticker)}`)
  const data = await res.json()
  if (data.error) throw new Error(data.error)
  return data
}

/** Map Supabase row → frontend report format (same shape as SEC) */
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
