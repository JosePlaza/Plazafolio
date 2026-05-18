import { ref, reactive, computed } from 'vue'
import { runAnalysisForTicker } from '@/lib/analysisRunner'
import { saveCachedAnalysis, snapshotUserRanking } from '@/services/assetsApi'

const DEFAULT_YEARS = 12
const CONCURRENCY = 3

/**
 * Orquesta el recálculo masivo de análisis para una lista de tickers.
 * No cancelable: una vez arrancado, termina (los errores por ticker no
 * abortan el resto). Al final dispara `snapshot_user_ranking` para que los
 * deltas de posición en RankingView reflejen el cambio.
 */
export function useBulkSync() {
  const status = ref('idle') // 'idle' | 'running' | 'done'
  const startedAt = ref(null)
  const finishedAt = ref(null)
  const items = reactive({}) // { [ticker]: { status: 'pending'|'syncing'|'ok'|'error', error?: string } }

  const total = computed(() => Object.keys(items).length)
  const completed = computed(() =>
    Object.values(items).filter((it) => it.status === 'ok' || it.status === 'error').length,
  )
  const okCount = computed(() => Object.values(items).filter((it) => it.status === 'ok').length)
  const errorCount = computed(() => Object.values(items).filter((it) => it.status === 'error').length)
  const progressPct = computed(() =>
    total.value === 0 ? 0 : Math.round((completed.value / total.value) * 100),
  )
  const elapsedMs = computed(() => {
    if (!startedAt.value) return 0
    const end = finishedAt.value ?? Date.now()
    return end - startedAt.value
  })

  function reset() {
    status.value = 'idle'
    startedAt.value = null
    finishedAt.value = null
    for (const k of Object.keys(items)) delete items[k]
  }

  async function syncOne(ticker, years) {
    items[ticker].status = 'syncing'
    try {
      const { result, profile, cashFlow, fundamentals, score } =
        await runAnalysisForTicker(ticker, years)
      await saveCachedAnalysis(
        ticker,
        years,
        {
          indicators: result.indicators,
          projection: result.projection,
          dividends: result.dividends,
          cashFlow: cashFlow || null,
          fundamentals: fundamentals || null,
        },
        profile,
        score,
      )
      items[ticker].status = 'ok'
    } catch (err) {
      items[ticker].status = 'error'
      items[ticker].error = err?.message || 'error'
    }
  }

  async function pool(tickers, years, concurrency) {
    let cursor = 0
    const runners = new Array(Math.min(concurrency, tickers.length))
      .fill(null)
      .map(async () => {
        while (true) {
          const i = cursor++
          if (i >= tickers.length) return
          await syncOne(tickers[i], years)
        }
      })
    await Promise.all(runners)
  }

  /**
   * @param {Array<{ticker: string, years?: number}>} assets
   */
  async function start(assets) {
    if (status.value === 'running') return
    reset()

    // Deduplicate by ticker
    const seen = new Map()
    for (const a of assets || []) {
      const t = String(a.ticker || '').toUpperCase()
      if (!t) continue
      if (!seen.has(t)) seen.set(t, a.years || DEFAULT_YEARS)
    }
    for (const t of seen.keys()) items[t] = { status: 'pending' }

    status.value = 'running'
    startedAt.value = Date.now()

    try {
      const tickers = [...seen.keys()]
      // Use max year window per ticker (typically all 12)
      const years = seen.get(tickers[0]) || DEFAULT_YEARS
      await pool(tickers, years, CONCURRENCY)
      await snapshotUserRanking()
    } finally {
      finishedAt.value = Date.now()
      status.value = 'done'
    }
  }

  return {
    status,
    items,
    total,
    completed,
    okCount,
    errorCount,
    progressPct,
    elapsedMs,
    start,
    reset,
  }
}
