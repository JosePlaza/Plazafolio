import { ref, readonly } from 'vue'
import { getAllCachedAnalyses } from '@/services/assetsApi'

const LS_KEY = 'plazafolio-geraldine-alerts'
const LS_DISMISSED = 'plazafolio-geraldine-dismissed'

const alerts = ref([])        // [{ ticker, name, signal, currentYield, avgHighYield, ratio, image }]
const checking = ref(false)
let checkInterval = null

/**
 * Get previously dismissed tickers (so we don't re-alert for the same state)
 */
function getDismissed() {
  try {
    const raw = localStorage.getItem(LS_DISMISSED)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return {}
}

function saveDismissed(map) {
  try { localStorage.setItem(LS_DISMISSED, JSON.stringify(map)) } catch { /* ignore */ }
}

/**
 * Check all cached analyses for assets entering the Geraldine buy zone.
 * An asset is in the buy zone when currentYield >= avgHighYield (P97 band).
 * Also flags "approaching" when yield is within 10% of avgHighYield.
 */
async function checkGeraldineZones(actives) {
  if (checking.value) return
  checking.value = true

  try {
    const analyses = await getAllCachedAnalyses()
    if (!analyses) return

    const dismissed = getDismissed()
    const newAlerts = []

    for (const asset of (actives || [])) {
      const cached = analyses[asset.ticker]
      if (!cached?.data?.indicators) continue

      const { currentYield, avgHighYield, avgLowYield } = cached.data.indicators
      if (!avgHighYield || !currentYield) continue

      const range = avgHighYield - avgLowYield
      if (range <= 0) continue

      const ratio = (currentYield - avgLowYield) / range

      // Alert conditions
      let signal = null
      if (currentYield >= avgHighYield) {
        signal = 'EN ZONA DE COMPRA'
      } else if (ratio >= 0.85) {
        signal = 'Acercandose a zona de compra'
      }

      if (!signal) continue

      // Skip if already dismissed for this signal state
      const dismissKey = `${asset.ticker}_${signal}`
      if (dismissed[dismissKey]) continue

      newAlerts.push({
        ticker: asset.ticker,
        name: asset.name,
        image: asset.image,
        signal,
        currentYield: Math.round(currentYield * 100) / 100,
        avgHighYield: Math.round(avgHighYield * 100) / 100,
        ratio: Math.round(ratio * 100) / 100,
        inBuyZone: currentYield >= avgHighYield,
      })
    }

    alerts.value = newAlerts

    // Browser notification for assets in buy zone
    if (newAlerts.some(a => a.inBuyZone) && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      const buyZone = newAlerts.filter(a => a.inBuyZone)
      const tickers = buyZone.map(a => a.ticker).slice(0, 5).join(', ')
      new Notification('Plazafolio — Zona Geraldine', {
        body: `${tickers} ${buyZone.length === 1 ? 'ha entrado' : 'han entrado'} en zona de compra`,
        icon: '/pwa-192x192.png',
        tag: 'geraldine-buy-zone',
      })
    }
  } catch (err) {
    console.warn('[GeraldineAlerts] Check failed:', err.message)
  } finally {
    checking.value = false
  }
}

/** Dismiss a specific alert */
function dismissAlert(ticker, signal) {
  const dismissed = getDismissed()
  dismissed[`${ticker}_${signal}`] = new Date().toISOString()
  saveDismissed(dismissed)
  alerts.value = alerts.value.filter(a => !(a.ticker === ticker && a.signal === signal))
}

/** Dismiss all current alerts */
function dismissAllAlerts() {
  const dismissed = getDismissed()
  for (const a of alerts.value) {
    dismissed[`${a.ticker}_${a.signal}`] = new Date().toISOString()
  }
  saveDismissed(dismissed)
  alerts.value = []
}

/** Clear all dismissals (for settings/debug) */
function resetDismissals() {
  try { localStorage.removeItem(LS_DISMISSED) } catch { /* ignore */ }
}

/** Start periodic checking (every 30 min) */
function startPeriodicCheck(actives) {
  if (checkInterval) return
  checkGeraldineZones(actives)
  checkInterval = setInterval(() => checkGeraldineZones(actives), 30 * 60 * 1000)
}

function stopPeriodicCheck() {
  if (checkInterval) {
    clearInterval(checkInterval)
    checkInterval = null
  }
}

export function useGeraldineAlerts() {
  return {
    alerts: readonly(alerts),
    checking: readonly(checking),
    checkGeraldineZones,
    dismissAlert,
    dismissAllAlerts,
    resetDismissals,
    startPeriodicCheck,
    stopPeriodicCheck,
  }
}
