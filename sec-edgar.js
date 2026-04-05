/**
 * SEC EDGAR Integration — Fetch XBRL financial data and generate comparison reports
 *
 * Architecture: Generic "source" field so other providers (CNMV, LSE…) can plug in later.
 * Phase 1: structured metrics + rule-based diagnosis
 * Phase 2: Gemini Flash narrative summaries (this file is source-agnostic; LLM lives in llm-provider.js)
 */

const SEC_USER_AGENT = 'Plazafolio j.plaza@sesametime.com'
const SEC_BASE = 'https://data.sec.gov'
const SEC_FILES = 'https://www.sec.gov/files'

// ── In-memory cache for the ticker→CIK mapping ──
let cikMap = null
let cikMapTimestamp = 0
const CIK_MAP_TTL = 24 * 60 * 60 * 1000 // 24 hours

async function secFetch(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': SEC_USER_AGENT, 'Accept': 'application/json' },
  })
  if (!res.ok) throw new Error(`SEC EDGAR ${res.status}: ${url}`)
  return res.json()
}

async function loadCikMap() {
  if (cikMap && Date.now() - cikMapTimestamp < CIK_MAP_TTL) return cikMap
  console.log('[SEC] Downloading ticker→CIK mapping...')
  const raw = await secFetch(`${SEC_FILES}/company_tickers.json`)
  cikMap = {}
  for (const key of Object.keys(raw)) {
    const entry = raw[key]
    const ticker = entry.ticker?.toUpperCase()
    const cik = String(entry.cik_str).padStart(10, '0')
    if (ticker) cikMap[ticker] = cik
  }
  cikMapTimestamp = Date.now()
  console.log(`[SEC] Loaded ${Object.keys(cikMap).length} tickers`)
  return cikMap
}

async function tickerToCik(ticker) {
  const map = await loadCikMap()
  return map[ticker.toUpperCase()] || null
}

/**
 * Get up to `count` most recent filings of a given type.
 */
async function getRecentFilings(cik, formType = '10-Q', count = 8) {
  const data = await secFetch(`${SEC_BASE}/submissions/CIK${cik}.json`)
  const filings = data.filings?.recent
  if (!filings) return []

  const results = []
  for (let i = 0; i < filings.form.length && results.length < count; i++) {
    if (filings.form[i] === formType) {
      results.push({
        accessionNumber: filings.accessionNumber[i],
        filingDate: filings.filingDate[i],
        reportDate: filings.reportDate[i],
        form: filings.form[i],
        primaryDocument: filings.primaryDocument[i],
      })
    }
  }
  return results
}

// ── XBRL metric definitions ──
const METRIC_DEFS = [
  { key: 'revenue', xbrlTags: ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet', 'RevenueFromContractWithCustomerIncludingAssessedTax'], label: 'Ingresos', format: 'currency' },
  { key: 'netIncome', xbrlTags: ['NetIncomeLoss'], label: 'Beneficio neto', format: 'currency' },
  { key: 'eps', xbrlTags: ['EarningsPerShareDiluted', 'EarningsPerShareBasic'], label: 'BPA (diluido)', format: 'decimal' },
  { key: 'operatingIncome', xbrlTags: ['OperatingIncomeLoss'], label: 'Beneficio operativo', format: 'currency' },
  { key: 'grossProfit', xbrlTags: ['GrossProfit'], label: 'Beneficio bruto', format: 'currency' },
  { key: 'cash', xbrlTags: ['CashAndCashEquivalentsAtCarryingValue', 'CashCashEquivalentsAndShortTermInvestments'], label: 'Caja', format: 'currency', isInstant: true },
  { key: 'longTermDebt', xbrlTags: ['LongTermDebt', 'LongTermDebtNoncurrent'], label: 'Deuda LP', format: 'currency', isInstant: true, invertBetter: true },
  { key: 'operatingCashFlow', xbrlTags: ['NetCashProvidedByOperatingActivities'], label: 'Cash flow operativo', format: 'currency' },
  { key: 'dividendPerShare', xbrlTags: ['CommonStockDividendsPerShareDeclared', 'CommonStockDividendsPerShareCashPaid'], label: 'Dividendo/acc', format: 'decimal' },
  { key: 'totalAssets', xbrlTags: ['Assets'], label: 'Activos totales', format: 'currency', isInstant: true },
  { key: 'stockholdersEquity', xbrlTags: ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'], label: 'Patrimonio neto', format: 'currency', isInstant: true },
]

function findBestMatch(facts, endDate, isInstant, durationTarget, durationTolerance) {
  const targetEndMs = new Date(endDate + 'T00:00:00').getTime()
  let bestVal = null, bestScore = Infinity

  for (const fact of facts) {
    const factEnd = new Date(fact.end + 'T00:00:00')
    const endDiff = Math.abs(factEnd.getTime() - targetEndMs) / 864e5
    if (endDiff > 10) continue

    if (isInstant) {
      if (endDiff < bestScore) { bestScore = endDiff; bestVal = fact.val }
    } else if (fact.start) {
      const duration = (factEnd - new Date(fact.start + 'T00:00:00')) / 864e5
      const durationDiff = Math.abs(duration - durationTarget)
      if (durationDiff <= durationTolerance) {
        const score = endDiff + durationDiff * 0.1
        if (score < bestScore) { bestScore = score; bestVal = fact.val }
      }
    }
  }
  return bestVal
}

/**
 * Extract metrics for a single period from pre-fetched XBRL facts.
 */
function extractMetricsForPeriod(usGaap, reportDate, isAnnual) {
  const durationTarget = isAnnual ? 365 : 91
  const durationTolerance = 45
  const extracted = {}

  for (const def of METRIC_DEFS) {
    for (const tag of def.xbrlTags) {
      if (!usGaap[tag]?.units) continue
      const unitKey = Object.keys(usGaap[tag].units).find(u => u === 'USD' || u === 'USD/shares' || u === 'pure')
      if (!unitKey) continue
      const val = findBestMatch(usGaap[tag].units[unitKey], reportDate, def.isInstant, durationTarget, durationTolerance)
      if (val !== null) { extracted[def.key] = { val, tag, def }; break }
    }
  }
  return extracted
}

/**
 * Compare two period extractions and produce a metrics object + derived metrics.
 */
function compareMetrics(current, previous) {
  const metrics = {}
  for (const def of METRIC_DEFS) {
    const cur = current[def.key], prev = previous[def.key]
    if (!cur || !prev) continue
    const change = prev.val !== 0 ? ((cur.val - prev.val) / Math.abs(prev.val)) * 100 : 0
    const direction = Math.abs(change) < 0.5 ? 'stable'
      : (def.invertBetter ? (change > 0 ? 'negative' : 'positive') : (change > 0 ? 'positive' : 'negative'))
    metrics[def.key] = {
      label: def.label, current: cur.val, previous: prev.val,
      change: Math.round(change * 10) / 10, direction, format: def.format, tag: cur.tag,
    }
  }
  // Derived: net margin
  if (metrics.revenue && metrics.netIncome) {
    const mc = metrics.revenue.current !== 0 ? (metrics.netIncome.current / metrics.revenue.current) * 100 : 0
    const mp = metrics.revenue.previous !== 0 ? (metrics.netIncome.previous / metrics.revenue.previous) * 100 : 0
    const ch = mc - mp
    metrics.netMargin = {
      label: 'Margen neto', current: Math.round(mc * 10) / 10, previous: Math.round(mp * 10) / 10,
      change: Math.round(ch * 10) / 10,
      direction: Math.abs(ch) < 0.3 ? 'stable' : (ch > 0 ? 'positive' : 'negative'),
      format: 'percent', derived: true,
    }
  }
  return metrics
}

function generateDiagnosis(metrics, isAnnual) {
  const signals = []
  const m = metrics

  if (m.revenue) {
    const c = m.revenue.change
    if (c > 10) signals.push({ type: 'positive', text: `Ingresos crecen un ${c}%` })
    else if (c > 0) signals.push({ type: 'neutral', text: `Ingresos suben ligeramente (${c}%)` })
    else if (c > -5) signals.push({ type: 'neutral', text: `Ingresos prácticamente planos (${c}%)` })
    else signals.push({ type: 'negative', text: `Ingresos caen un ${Math.abs(c)}%` })
  }
  if (m.netIncome) {
    const c = m.netIncome.change
    if (c > 15) signals.push({ type: 'positive', text: `Beneficio neto crece fuertemente (+${c}%)` })
    else if (c > 0) signals.push({ type: 'positive', text: `Beneficio neto al alza (+${c}%)` })
    else if (c > -5) signals.push({ type: 'neutral', text: `Beneficio neto estable (${c}%)` })
    else signals.push({ type: 'negative', text: `Beneficio neto cae un ${Math.abs(c)}%` })
  }
  if (m.netMargin) {
    const c = m.netMargin.change
    if (m.netMargin.direction === 'stable') signals.push({ type: 'neutral', text: `Márgenes estables (${m.netMargin.current}%)` })
    else if (c > 0) signals.push({ type: 'positive', text: `Márgenes mejoran (${m.netMargin.previous}% → ${m.netMargin.current}%)` })
    else signals.push({ type: 'negative', text: `Márgenes se comprimen (${m.netMargin.previous}% → ${m.netMargin.current}%)` })
  }
  if (m.operatingCashFlow) {
    const c = m.operatingCashFlow.change
    if (c > 10) signals.push({ type: 'positive', text: `Cash flow operativo crece (+${c}%)` })
    else if (c < -10) signals.push({ type: 'negative', text: `Cash flow operativo cae (${c}%)` })
  }
  if (m.longTermDebt) {
    const c = m.longTermDebt.change
    if (c > 10) signals.push({ type: 'negative', text: `Deuda a largo plazo aumenta (+${c}%)` })
    else if (c < -10) signals.push({ type: 'positive', text: `Deuda a largo plazo se reduce (${c}%)` })
  }
  if (m.dividendPerShare) {
    const c = m.dividendPerShare.change
    if (c > 0) signals.push({ type: 'positive', text: `Dividendo por acción sube (+${c}%)` })
    else if (c < 0) signals.push({ type: 'negative', text: `Dividendo por acción baja (${c}%)` })
  }
  if (m.eps) {
    const c = m.eps.change
    if (c > 10) signals.push({ type: 'positive', text: `BPA crece fuertemente (+${c}%)` })
    else if (c < -10) signals.push({ type: 'negative', text: `BPA cae un ${Math.abs(c)}%` })
  }

  const positives = signals.filter(s => s.type === 'positive').length
  const negatives = signals.filter(s => s.type === 'negative').length
  const p = isAnnual ? 'Ejercicio' : 'Trimestre'
  let summary
  if (positives > negatives * 2) summary = `${p} sólido con métricas mayoritariamente positivas.`
  else if (negatives > positives * 2) summary = `${p} débil con deterioro en varias métricas clave.`
  else if (positives > negatives) summary = `${p} con tendencia ligeramente positiva, aunque con puntos de atención.`
  else if (negatives > positives) summary = `${p} mixto con más sombras que luces.`
  else summary = `${p} mixto sin cambios significativos respecto al anterior.`

  return { summary, signals }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch the full list of available reports for a ticker (last N filings).
 * Each report compares one filing against the previous one.
 *
 * @param {string} ticker
 * @param {string} formType '10-Q' | '10-K'
 * @param {number} maxReports How many comparison reports to generate (default 6)
 * @returns {Array} Array of report objects, newest first
 */
export async function fetchReportList(ticker, formType = '10-Q', maxReports = 6) {
  const cik = await tickerToCik(ticker)
  if (!cik) throw new Error(`Ticker ${ticker} no encontrado en SEC EDGAR`)

  console.log(`[SEC] ${ticker} → CIK ${cik}, fetching ${formType} history...`)

  // Fetch enough filings so we can make maxReports comparisons (need maxReports+1 filings)
  const filings = await getRecentFilings(cik, formType, maxReports + 1)
  if (filings.length < 2) throw new Error(`Menos de 2 informes ${formType} para ${ticker}`)

  // Fetch XBRL facts once (single API call)
  const factsData = await secFetch(`${SEC_BASE}/api/xbrl/companyfacts/CIK${cik}.json`)
  const usGaap = factsData.facts?.['us-gaap'] || {}
  const isAnnual = formType === '10-K'

  const reports = []

  for (let i = 0; i < filings.length - 1 && reports.length < maxReports; i++) {
    const current = filings[i]
    const previous = filings[i + 1]

    const curMetrics = extractMetricsForPeriod(usGaap, current.reportDate, isAnnual)
    const prevMetrics = extractMetricsForPeriod(usGaap, previous.reportDate, isAnnual)

    const metrics = compareMetrics(curMetrics, prevMetrics)
    if (Object.keys(metrics).length === 0) continue

    const curYear = new Date(current.reportDate).getFullYear()
    const prevYear = new Date(previous.reportDate).getFullYear()
    const curQ = Math.ceil((new Date(current.reportDate).getMonth() + 1) / 3)
    const prevQ = Math.ceil((new Date(previous.reportDate).getMonth() + 1) / 3)

    const periodCurrent = isAnnual ? `FY${curYear}` : `Q${curQ} ${curYear}`
    const periodPrevious = isAnnual ? `FY${prevYear}` : `Q${prevQ} ${prevYear}`

    const diagnosis = generateDiagnosis(metrics, isAnnual)

    reports.push({
      id: `${ticker}_${formType}_${current.reportDate}`,
      ticker: ticker.toUpperCase(),
      source: 'sec',
      reportType: formType,
      periodCurrent,
      periodPrevious,
      reportDate: current.reportDate,
      filedDate: current.filingDate,
      metrics,
      diagnosis,
      narrative: null, // to be filled by LLM
    })
  }

  console.log(`[SEC] ${ticker}: ${reports.length} ${formType} reports generated`)
  return reports
}

/**
 * Check for the most recent filing date of a given type for a ticker.
 * Used by the scheduler to detect new filings without fetching all XBRL data.
 */
export async function getLatestFilingDate(ticker, formType = '10-Q') {
  const cik = await tickerToCik(ticker)
  if (!cik) return null
  const filings = await getRecentFilings(cik, formType, 1)
  return filings[0]?.filingDate || null
}

export function isUsTicker(ticker) {
  return ticker && !ticker.includes('.')
}
