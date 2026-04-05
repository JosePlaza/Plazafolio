import { ref, readonly } from 'vue'
import { supabase } from '@/lib/supabase'

const LS_KEY = 'plazafolio-sec-last-check'

const alerts = ref([])        // [{ ticker, reportType, period, filedDate, fetchedAt }]
const checking = ref(false)
let lastCheckTimestamp = null

function loadLastCheck() {
  if (lastCheckTimestamp) return lastCheckTimestamp
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) lastCheckTimestamp = raw
  } catch { /* ignore */ }
  // Default: 24 hours ago (so first load shows recent filings)
  if (!lastCheckTimestamp) {
    lastCheckTimestamp = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  }
  return lastCheckTimestamp
}

function saveLastCheck() {
  lastCheckTimestamp = new Date().toISOString()
  try { localStorage.setItem(LS_KEY, lastCheckTimestamp) } catch { /* ignore */ }
}

/**
 * Check Supabase for financial reports fetched since last check.
 * Returns new alerts and triggers browser notification if available.
 */
async function checkForNewReports() {
  if (checking.value) return
  checking.value = true
  try {
    const since = loadLastCheck()
    const { data, error } = await supabase
      .from('financial_reports')
      .select('ticker, report_type, period_current, filed_date, fetched_at')
      .gt('fetched_at', since)
      .order('fetched_at', { ascending: false })
      .limit(20)

    if (error) throw error

    if (data && data.length > 0) {
      // Deduplicate by ticker+report_type (keep most recent)
      const seen = new Set()
      const newAlerts = []
      for (const r of data) {
        const key = `${r.ticker}_${r.report_type}`
        if (seen.has(key)) continue
        seen.add(key)
        newAlerts.push({
          ticker: r.ticker,
          reportType: r.report_type,
          period: r.period_current,
          filedDate: r.filed_date,
          fetchedAt: r.fetched_at,
        })
      }
      alerts.value = newAlerts

      // Browser notification (only if permission granted)
      if (newAlerts.length > 0 && Notification.permission === 'granted') {
        const tickers = [...new Set(newAlerts.map(a => a.ticker))].slice(0, 5).join(', ')
        new Notification('Plazafolio — Nuevos informes', {
          body: `Nuevos informes SEC para: ${tickers}`,
          icon: '/pwa-192x192.png',
          tag: 'sec-new-filings', // prevents duplicate notifications
        })
      }
    } else {
      alerts.value = []
    }
  } catch (err) {
    console.warn('[SecAlerts] Check failed:', err.message)
  } finally {
    checking.value = false
  }
}

/** Mark all current alerts as seen */
function dismissAlerts() {
  saveLastCheck()
  alerts.value = []
}

/** Mark a single alert as seen (remove from list) */
function dismissAlert(ticker, reportType) {
  alerts.value = alerts.value.filter(
    a => !(a.ticker === ticker && a.reportType === reportType)
  )
  // If no alerts left, update the checkpoint so they won't reappear
  if (alerts.value.length === 0) saveLastCheck()
}

/** Request browser notification permission */
async function requestNotificationPermission() {
  if (!('Notification' in window)) return 'unsupported'
  if (Notification.permission === 'granted') return 'granted'
  if (Notification.permission === 'denied') return 'denied'
  return await Notification.requestPermission()
}

export function useSecAlerts() {
  return {
    alerts: readonly(alerts),
    checking: readonly(checking),
    checkForNewReports,
    dismissAlerts,
    dismissAlert,
    requestNotificationPermission,
  }
}
