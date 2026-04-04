import { ref, computed, watch } from 'vue'

// Load persisted currency from localStorage
function loadCurrency() {
  try {
    const saved = localStorage.getItem('gw-currency')
    if (saved === 'EUR' || saved === 'USD') return saved
  } catch { /* ignore */ }
  return 'USD'
}

function loadCachedRate() {
  try {
    const saved = localStorage.getItem('gw-eurUsdRate')
    if (saved) {
      const num = Number(saved)
      if (num > 0) return num
    }
  } catch { /* ignore */ }
  return 1.14 // fallback
}

// Shared state across all components — always forced, no auto mode
const forcedCurrency = ref(loadCurrency())
const eurUsdRate = ref(loadCachedRate())
const rateLoaded = ref(false)

// Persist on change
watch(forcedCurrency, (val) => {
  try { localStorage.setItem('gw-currency', val) } catch { /* ignore */ }
})

// Fetch real-time EUR/USD rate from Yahoo Finance via our server
let rateFetchPromise = null
async function fetchExchangeRate() {
  if (rateFetchPromise) return rateFetchPromise
  rateFetchPromise = (async () => {
    try {
      const base = import.meta.env.VITE_API_URL || ''
      const res = await fetch(`${base}/api/forex?pair=EURUSD=X`)
      const data = await res.json()
      if (data.rate && data.rate > 0) {
        eurUsdRate.value = data.rate
        rateLoaded.value = true
        try { localStorage.setItem('gw-eurUsdRate', String(data.rate)) } catch { /* ignore */ }
        console.log(`[Forex] EUR/USD rate: ${data.rate}`)
      }
    } catch (err) {
      console.warn('[Forex] Failed to fetch rate, using cached/fallback:', err.message)
    } finally {
      rateFetchPromise = null
    }
  })()
  return rateFetchPromise
}

// Auto-fetch on module load
fetchExchangeRate()

export function useCurrency() {
  function setForcedCurrency(val) {
    forcedCurrency.value = val // 'USD' or 'EUR'
  }

  function toggleCurrency() {
    forcedCurrency.value = forcedCurrency.value === 'EUR' ? 'USD' : 'EUR'
  }

  // Get display symbol — always reflects forcedCurrency
  const displaySymbol = computed(() => forcedCurrency.value === 'EUR' ? '€' : '$')

  /**
   * Convert a value from its native currency to the forced display currency.
   * @param {number} value - Amount to convert
   * @param {string} nativeCurrency - 'USD' or 'EUR' (from ticker detection or profile)
   * @returns {number} Converted value (or original if no conversion needed)
   */
  function convert(value, nativeCurrency = 'USD') {
    if (!value) return value
    const from = (nativeCurrency || 'USD').toUpperCase()
    const to = forcedCurrency.value
    if (from === to) return value
    if (from === 'USD' && to === 'EUR') return value / eurUsdRate.value
    if (from === 'EUR' && to === 'USD') return value * eurUsdRate.value
    return value
  }

  /**
   * Shorthand: convert a monetary value using a ticker to detect native currency.
   * @param {number} value
   * @param {string} ticker
   * @returns {number}
   */
  function convertByTicker(value, ticker) {
    return convert(value, nativeCurrencyOf(ticker))
  }

  /**
   * Get the display symbol for a given ticker, respecting forced currency.
   * @param {string} ticker
   * @returns {string} '$' or '€'
   */
  function symbolFor(_ticker) {
    return forcedCurrency.value === 'EUR' ? '€' : '$'
  }

  /**
   * Get native currency code for a ticker.
   */
  function nativeCurrencyOf(ticker) {
    return ticker && ticker.includes('.') ? 'EUR' : 'USD'
  }

  return {
    forcedCurrency,
    eurUsdRate,
    rateLoaded,
    displaySymbol,
    setForcedCurrency,
    toggleCurrency,
    convert,
    convertByTicker,
    symbolFor,
    nativeCurrencyOf,
    fetchExchangeRate,
  }
}
