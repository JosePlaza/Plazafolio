import { ref, reactive, computed } from 'vue'
import { getCachedAnalysis, saveCachedAnalysis } from '@/services/assetsApi'
import { runAnalysisForTicker } from '@/lib/analysisRunner'
import { useCurrency } from '@/composables/useCurrency'

/**
 * Composable principal que orquesta la obtención de datos y el cálculo
 * del método Geraldine Weiss para un ticker dado.
 */
export function useGeraldine() {
  const loading = ref(false)
  const refreshing = ref(false)
  const error = ref(null)
  const ticker = ref('')
  const years = ref(12)

  const data = reactive({
    indicators: null,
    priceBands: [],
    dailyYields: [],
    yearlyData: [],
    dividends: [],
    trailingDividends: [],
    drawdown: [],
    projection: null,
    profile: null,
    cashFlow: [],
    fundamentals: null, // { income, balance, cashFlow, enterpriseValue }
  })

  const hasData = computed(() => data.priceBands.length > 0)
  const { symbolFor } = useCurrency()
  const currency = computed(() => symbolFor(ticker.value))

  /**
   * Aplica datos (desde cache o desde cálculo fresco) al estado reactivo
   */
  function applyData(result, profile, cashFlow, fundamentals) {
    data.indicators = result.indicators
    data.priceBands = result.priceBands
    data.dailyYields = result.dailyYields
    data.yearlyData = result.yearlyData
    data.dividends = result.dividends
    data.trailingDividends = result.trailingDividends
    data.drawdown = result.drawdown
    data.projection = result.projection
    data.profile = profile || null
    data.cashFlow = cashFlow || []
    data.fundamentals = fundamentals || null
  }

  /**
   * Obtiene datos frescos de las APIs y calcula todo (wrapper sobre el runner
   * compartido para mantener la firma usada por este composable).
   */
  async function fetchAndCompute(tickerSymbol, periodYears, cachedProfile = null) {
    return runAnalysisForTicker(tickerSymbol, periodYears, cachedProfile)
  }

  /**
   * Guarda el resultado del análisis en el servidor
   */
  async function saveToCache(tickerSymbol, periodYears, result, profile, cashFlow, fundamentals, score = null) {
    try {
      // Only save lightweight data needed for ranking + cache check.
      // Heavy chart data (priceBands, dailyYields, drawdown) is NOT cached
      // to avoid blowing localStorage limits.
      await saveCachedAnalysis(tickerSymbol, periodYears, {
        indicators: result.indicators,
        projection: result.projection,
        dividends: result.dividends,
        cashFlow: cashFlow || null,
        fundamentals: fundamentals || null,
      }, profile, score)
    } catch (err) {
      console.warn('Error guardando análisis en cache:', err.message)
    }
  }

  /**
   * Genera el análisis completo para un ticker.
   */
  async function generate(tickerSymbol, periodYears) {
    if (!tickerSymbol) {
      error.value = 'Introduce un ticker válido'
      return
    }

    ticker.value = tickerSymbol.toUpperCase()
    years.value = periodYears
    error.value = null

    const today = new Date().toISOString().split('T')[0]

    // Try to load from cache first
    try {
      const cached = await getCachedAnalysis(ticker.value)

      if (cached && cached.data && cached.years === periodYears) {
        if (cached.lastUpdated === today) {
          // Cache is from today — still need full chart data from APIs
          // but use cached profile to save an API call
          loading.value = true
          try {
            const { result, profile, cashFlow, fundamentals } = await fetchAndCompute(ticker.value, periodYears, cached.profile)
            applyData(result, profile, cashFlow, fundamentals)
          } catch (err) {
            console.error('Error generando análisis:', err)
            error.value = err.message || 'Error al obtener datos'
            resetData()
          } finally {
            loading.value = false
          }
          return
        }

        // Cache is stale — full refresh, save new cache
        loading.value = true
        try {
          const { result, profile, cashFlow, fundamentals, score } = await fetchAndCompute(ticker.value, periodYears)
          applyData(result, profile, cashFlow, fundamentals)
          await saveToCache(ticker.value, periodYears, result, profile, cashFlow, fundamentals, score)
        } catch (err) {
          console.error('Error generando análisis:', err)
          error.value = err.message || 'Error al obtener datos'
          resetData()
        } finally {
          loading.value = false
        }
        return
      }
    } catch (err) {
      console.warn('Error cargando cache:', err.message)
    }

    // No usable cache — full load with loading state
    loading.value = true

    try {
      const { result, profile, cashFlow, fundamentals, score } = await fetchAndCompute(ticker.value, periodYears)
      applyData(result, profile, cashFlow, fundamentals)
      await saveToCache(ticker.value, periodYears, result, profile, cashFlow, fundamentals, score)
    } catch (err) {
      console.error('Error generando análisis:', err)
      error.value = err.response?.data?.['Error Message'] || err.message || 'Error al obtener datos'
      resetData()
    } finally {
      loading.value = false
    }
  }

  function resetData() {
    data.indicators = null
    data.priceBands = []
    data.dailyYields = []
    data.yearlyData = []
    data.dividends = []
    data.trailingDividends = []
    data.drawdown = []
    data.projection = null
    data.profile = null
    data.cashFlow = []
    data.fundamentals = null
  }

  return {
    loading,
    refreshing,
    error,
    ticker,
    years,
    data,
    hasData,
    currency,
    generate,
    resetData,
  }
}
