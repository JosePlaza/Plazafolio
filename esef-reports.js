/**
 * ESEF / filings.xbrl.org Integration — Fetch European financial reports
 *
 * Covers: CNMV (Spain), and any country with ESEF filings (EU, UK, etc.)
 * Uses the filings.xbrl.org JSON:API to discover filings, then fetches
 * xBRL-JSON documents to extract IFRS-tagged financial metrics.
 *
 * Architecture mirrors sec-edgar.js: fetch → extract → compare → diagnose
 */

const XBRL_API = 'https://filings.xbrl.org/api/filings'
const XBRL_BASE = 'https://filings.xbrl.org'
const USER_AGENT = 'Plazafolio j.plaza@sesametime.com'

// ── Country code by ticker suffix ──
// Tickers with "." (e.g. ITX.MC, TEF.MC, SAN.MC) → extract exchange suffix
const EXCHANGE_TO_COUNTRY = {
  'MC': 'ES', // Bolsa de Madrid
  'L':  'GB', // London
  'PA': 'FR', // Euronext Paris
  'AS': 'NL', // Euronext Amsterdam
  'BR': 'BE', // Euronext Brussels
  'LS': 'PT', // Euronext Lisbon
  'DE': 'DE', // Deutsche Börse / XETRA
  'MI': 'IT', // Borsa Italiana
  'HE': 'FI', // Helsinki
  'ST': 'SE', // Stockholm
  'OL': 'NO', // Oslo
  'CO': 'DK', // Copenhagen
  'VI': 'AT', // Vienna
  'IR': 'IE', // Irish
  'SW': 'CH', // Swiss Exchange
}

// ── Entity name mappings ──
// filings.xbrl.org uses entity names, not tickers. We map common tickers to search terms.
// This is a seed list; for unknown tickers we derive a search term from the ticker itself.
const TICKER_TO_ENTITY = {
  'ITX':  'Inditex',
  'TEF':  'Telefonica',
  'SAN':  'Santander',
  'BBVA': 'Banco Bilbao',
  'IBE':  'Iberdrola',
  'REP':  'Repsol',
  'AMS':  'Amadeus',
  'FER':  'Ferrovial',
  'ENG':  'Enagas',
  'ELE':  'Endesa',
  'GRF':  'Grifols',
  'MAP':  'Mapfre',
  'CABK': 'CaixaBank',
  'RED':  'Redeia',       // REE
  'LOG':  'Logista',
  'ACS':  'ACS',
  'AENA': 'Aena',
  'CLNX': 'Cellnex',
  'FDR':  'Fluidra',
  'MRL':  'Merlin Properties',
  'VIS':  'Viscofan',
  'CIE':  'CIE Automotive',
  'ALM':  'Almirall',
  'NTGY': 'Naturgy',
  // French
  'OR':   'L\'Oreal',
  'AI':   'Air Liquide',
  'SU':   'Schneider Electric',
  'MC':   'LVMH',
  'SAN.PA': 'Sanofi',  // French Sanofi (full ticker to avoid collision with Santander)
  'TTE':  'TotalEnergies',
  // German
  'SAP':  'SAP',
  'SIE':  'Siemens',
  'ALV':  'Allianz',
  'BAS':  'BASF',
  'DTE':  'Deutsche Telekom',
  // UK
  'ULVR': 'Unilever',
  'AZN':  'AstraZeneca',
  'GSK':  'GSK',
  'SHEL': 'Shell',
  'HSBA': 'HSBC',
  'RIO':  'Rio Tinto',
  'DGE':  'Diageo',
  // Dutch
  'ASML': 'ASML',
  'PHIA': 'Philips',
  'UNA':  'Unilever',
}

// ── IFRS XBRL metric definitions (mirrors METRIC_DEFS in sec-edgar.js) ──
// ESEF uses IFRS taxonomy. Concept names from ifrs-full namespace.
const METRIC_DEFS = [
  {
    key: 'revenue',
    ifrsTags: ['ifrs-full:Revenue', 'ifrs-full:RevenueFromContractsWithCustomers'],
    label: 'Ingresos',
    format: 'currency',
  },
  {
    key: 'netIncome',
    ifrsTags: ['ifrs-full:ProfitLoss', 'ifrs-full:ProfitLossAttributableToOwnersOfParent'],
    label: 'Beneficio neto',
    format: 'currency',
  },
  {
    key: 'eps',
    ifrsTags: ['ifrs-full:DilutedEarningsLossPerShare', 'ifrs-full:BasicEarningsLossPerShare'],
    label: 'BPA (diluido)',
    format: 'decimal',
  },
  {
    key: 'operatingIncome',
    ifrsTags: ['ifrs-full:ProfitLossFromOperatingActivities', 'ifrs-full:OperatingProfit'],
    label: 'Beneficio operativo',
    format: 'currency',
  },
  {
    key: 'grossProfit',
    ifrsTags: ['ifrs-full:GrossProfit'],
    label: 'Beneficio bruto',
    format: 'currency',
  },
  {
    key: 'cash',
    ifrsTags: ['ifrs-full:CashAndCashEquivalents'],
    label: 'Caja',
    format: 'currency',
    isInstant: true,
  },
  {
    key: 'longTermDebt',
    ifrsTags: ['ifrs-full:NoncurrentFinancialLiabilities', 'ifrs-full:NoncurrentBorrowings', 'ifrs-full:NoncurrentLiabilities'],
    label: 'Deuda LP',
    format: 'currency',
    isInstant: true,
    invertBetter: true,
  },
  {
    key: 'operatingCashFlow',
    ifrsTags: ['ifrs-full:CashFlowsFromUsedInOperatingActivities'],
    label: 'Cash flow operativo',
    format: 'currency',
  },
  {
    key: 'dividendPerShare',
    ifrsTags: ['ifrs-full:DividendsPerShare', 'ifrs-full:DividendsPaidPerShare'],
    label: 'Dividendo/acc',
    format: 'decimal',
  },
  {
    key: 'totalAssets',
    ifrsTags: ['ifrs-full:Assets'],
    label: 'Activos totales',
    format: 'currency',
    isInstant: true,
  },
  {
    key: 'stockholdersEquity',
    ifrsTags: ['ifrs-full:Equity', 'ifrs-full:EquityAttributableToOwnersOfParent'],
    label: 'Patrimonio neto',
    format: 'currency',
    isInstant: true,
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function parseTickerInfo(ticker) {
  const upper = ticker.toUpperCase()
  const dotIdx = upper.lastIndexOf('.')
  if (dotIdx === -1) return { baseTicker: upper, exchange: null, country: null }
  const baseTicker = upper.slice(0, dotIdx)
  const exchange = upper.slice(dotIdx + 1)
  const country = EXCHANGE_TO_COUNTRY[exchange] || null
  return { baseTicker, exchange, country }
}

function getEntitySearchTerm(ticker, baseTicker) {
  // Check full ticker first (e.g. 'SAN.PA' → Sanofi), then base ticker
  return TICKER_TO_ENTITY[ticker.toUpperCase()] || TICKER_TO_ENTITY[baseTicker] || baseTicker
}

async function apiFetch(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/vnd.api+json' },
  })
  if (!res.ok) throw new Error(`filings.xbrl.org ${res.status}: ${url}`)
  return res.json()
}

async function jsonFetch(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
  })
  if (!res.ok) throw new Error(`xBRL-JSON ${res.status}: ${url}`)
  return res.json()
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Discover filings via filings.xbrl.org API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Search for filings for a given entity in a country.
 * Returns filing metadata sorted by period end date (newest first).
 */
async function discoverFilings(ticker, maxFilings = 10) {
  const { baseTicker, country } = parseTickerInfo(ticker)
  if (!country) {
    console.log(`[ESEF] Cannot determine country for ${ticker}`)
    return []
  }

  const entitySearch = getEntitySearchTerm(ticker, baseTicker)
  console.log(`[ESEF] Searching filings for "${entitySearch}" in country=${country}...`)

  // The API only supports filtering by country (not by entity name),
  // so we request a large page and filter client-side by entity name.
  // max_page_size on filings.xbrl.org is 200.
  const PAGE_SIZE = 200

  const params = new URLSearchParams({
    'filter[country]': country,
    'sort': '-period_end',
    'include': 'entity',
    'page[size]': String(PAGE_SIZE),
  })

  const url = `${XBRL_API}?${params.toString()}`
  const response = await apiFetch(url)

  if (!response.data || !response.data.length) {
    console.log(`[ESEF] No filings found for country=${country}`)
    return []
  }

  // Build entity map from included data
  const entityMap = {}
  if (response.included) {
    for (const inc of response.included) {
      if (inc.type === 'entity') {
        entityMap[inc.id] = inc.attributes?.name || ''
      }
    }
  }

  // Filter filings whose entity name matches our search term
  const searchLower = entitySearch.toLowerCase()
  const matched = []

  for (const filing of response.data) {
    const attrs = filing.attributes || {}
    const entityId = filing.relationships?.entity?.data?.id
    const entityName = entityMap[entityId] || ''

    if (!entityName.toLowerCase().includes(searchLower)) continue

    // json_url can be relative (e.g. /LEI/2024-12-31/...) — make absolute
    const rawJson = attrs.json_url || ''
    const rawPackage = attrs.package_url || ''
    const rawXhtml = attrs.xhtml_url || ''

    matched.push({
      id: filing.id,
      entityName,
      country: attrs.country,
      periodEnd: attrs.period_end,
      dateAdded: attrs.date_added,
      processed: attrs.processed,
      jsonUrl: rawJson.startsWith('http') ? rawJson : rawJson ? `${XBRL_BASE}${rawJson.startsWith('/') ? '' : '/'}${rawJson}` : '',
      packageUrl: rawPackage.startsWith('http') ? rawPackage : rawPackage ? `${XBRL_BASE}${rawPackage.startsWith('/') ? '' : '/'}${rawPackage}` : '',
      xhtmlUrl: rawXhtml.startsWith('http') ? rawXhtml : rawXhtml ? `${XBRL_BASE}${rawXhtml.startsWith('/') ? '' : '/'}${rawXhtml}` : '',
      errorCount: attrs.error_count || 0,
    })
  }

  console.log(`[ESEF] Found ${matched.length}/${response.data.length} filings for "${entitySearch}" (country=${country})`)

  // Cap to maxFilings
  return matched.slice(0, maxFilings)
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Parse xBRL-JSON to extract metrics
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract financial metrics from an xBRL-JSON document.
 * xBRL-JSON structure:
 * {
 *   "facts": {
 *     "ifrs-full:Revenue": { "f123": { "value": "1234000", "dimensions": { "period": "2024-02-01/2025-01-31", ... } } },
 *     ...
 *   }
 * }
 */
function extractMetricsFromJson(jsonData, reportPeriodEnd, isAnnual) {
  const facts = jsonData.facts || {}
  const durationTarget = isAnnual ? 365 : 182
  const durationTolerance = 60
  const extracted = {}

  // xBRL-JSON has a flat structure: facts = { "f-1": { value, dimensions: { concept, entity, period, unit, ... } }, ... }
  // The concept name is INSIDE dimensions.concept, NOT the key of the facts object.
  // Build a lookup: concept → [{ factId, value, dimensions }]
  const STANDARD_DIMS = new Set(['concept', 'entity', 'period', 'unit', 'language'])
  const conceptMap = {} // concept → facts[]

  const factEntries = Object.entries(facts)

  // Index all facts by concept
  for (const [factId, fact] of factEntries) {
    const dims = fact.dimensions || {}
    const concept = dims.concept || ''
    if (!concept) continue
    if (!conceptMap[concept]) conceptMap[concept] = []
    conceptMap[concept].push({ factId, ...fact })
  }

  for (const def of METRIC_DEFS) {
    for (const tag of def.ifrsTags) {
      const factList = conceptMap[tag]
      if (!factList) continue

      let bestVal = null
      let bestScore = Infinity

      for (const fact of factList) {
        if (!fact.value || fact.value === '' || fact.value === 'nil') continue

        const dims = fact.dimensions || {}
        const period = dims.period || ''
        const val = parseFloat(fact.value)
        if (isNaN(val)) continue

        // Filter: skip segment/member dimensions (we want consolidated totals)
        const dimKeys = Object.keys(dims).filter(k => !STANDARD_DIMS.has(k))
        if (dimKeys.length > 0) continue

        if (def.isInstant) {
          // Instant: period is just "YYYY-MM-DD"
          const endMs = new Date(period).getTime()
          const targetMs = new Date(reportPeriodEnd).getTime()
          const diff = Math.abs(endMs - targetMs) / 864e5
          if (diff <= 15 && diff < bestScore) {
            bestScore = diff
            bestVal = val
          }
        } else {
          // Duration: period is "YYYY-MM-DD/YYYY-MM-DD"
          const parts = period.split('/')
          if (parts.length !== 2) continue
          const [startStr, endStr] = parts
          const startMs = new Date(startStr).getTime()
          const endMs = new Date(endStr).getTime()
          const targetMs = new Date(reportPeriodEnd).getTime()

          const endDiff = Math.abs(endMs - targetMs) / 864e5
          if (endDiff > 15) continue

          const duration = (endMs - startMs) / 864e5
          const durationDiff = Math.abs(duration - durationTarget)
          if (durationDiff > durationTolerance) continue

          const score = endDiff + durationDiff * 0.1
          if (score < bestScore) {
            bestScore = score
            bestVal = val
          }
        }
      }

      if (bestVal !== null) {
        extracted[def.key] = { val: bestVal, tag, def }
        break
      }
    }
  }

  console.log(`[ESEF] Extracted ${Object.keys(extracted).length} metrics for ${reportPeriodEnd}`)
  return extracted
}

/**
 * Compare two period extractions (mirrors sec-edgar.js compareMetrics)
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

/**
 * Generate rule-based diagnosis (mirrors sec-edgar.js generateDiagnosis)
 */
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
  const p = isAnnual ? 'Ejercicio' : 'Semestre'
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
 * Fetch reports for a European ticker.
 * Discovers filings via filings.xbrl.org, downloads xBRL-JSON, extracts & compares metrics.
 *
 * @param {string} ticker  e.g. 'ITX.MC', 'TEF.MC'
 * @param {number} maxReports  How many comparison reports (default 4)
 * @returns {Array} Report objects, newest first (same shape as sec-edgar.js)
 */
export async function fetchReportList(ticker, maxReports = 4) {
  const { baseTicker, country } = parseTickerInfo(ticker)
  if (!country) throw new Error(`No se puede determinar el país para ${ticker}`)

  // 1. Discover filings
  const filings = await discoverFilings(ticker, maxReports + 1)
  if (filings.length < 2) {
    throw new Error(`Menos de 2 informes ESEF para ${ticker} (encontrados: ${filings.length})`)
  }

  // 2. Download xBRL-JSON for each filing and extract metrics
  const reports = []
  const jsonCache = {}

  for (let i = 0; i < filings.length - 1 && reports.length < maxReports; i++) {
    const current = filings[i]
    const previous = filings[i + 1]

    if (!current.jsonUrl || !previous.jsonUrl) {
      console.log(`[ESEF] Skipping filing without json_url: ${current.id}`)
      continue
    }

    try {
      // Fetch xBRL-JSON (cached within this call)
      if (!jsonCache[current.id]) jsonCache[current.id] = await jsonFetch(current.jsonUrl)
      if (!jsonCache[previous.id]) jsonCache[previous.id] = await jsonFetch(previous.jsonUrl)

      const isAnnual = true // ESEF filings are annual (CNMV also has semestral, but ESEF repo is mostly annual)

      // Detect if semestral by checking period duration
      const curJson = jsonCache[current.id]
      const prevJson = jsonCache[previous.id]

      const curMetrics = extractMetricsFromJson(curJson, current.periodEnd, isAnnual)
      const prevMetrics = extractMetricsFromJson(prevJson, previous.periodEnd, isAnnual)

      const metrics = compareMetrics(curMetrics, prevMetrics)
      if (Object.keys(metrics).length === 0) {
        console.log(`[ESEF] No comparable metrics for ${current.periodEnd} vs ${previous.periodEnd}`)
        continue
      }

      const curYear = new Date(current.periodEnd).getFullYear()
      const prevYear = new Date(previous.periodEnd).getFullYear()
      const curMonth = new Date(current.periodEnd).getMonth() + 1

      // Determine period label
      const periodCurrent = curMonth <= 6 ? `S1 ${curYear}` : `FY${curYear}`
      const periodPrevious = new Date(previous.periodEnd).getMonth() + 1 <= 6
        ? `S1 ${prevYear}` : `FY${prevYear}`

      const diagnosis = generateDiagnosis(metrics, isAnnual)

      // Determine report type label
      const reportType = curMonth <= 6 ? 'Semestral' : 'Anual'

      reports.push({
        id: `${baseTicker}_ESEF_${current.periodEnd}`,
        ticker: ticker.toUpperCase(),
        source: 'esef',
        reportType,
        periodCurrent,
        periodPrevious,
        reportDate: current.periodEnd,
        filedDate: current.dateAdded,
        metrics,
        diagnosis,
        narrative: null,
        entityName: current.entityName,
      })
    } catch (err) {
      console.warn(`[ESEF] Error processing filing ${current.id}:`, err.message)
      continue
    }
  }

  console.log(`[ESEF] ${ticker}: ${reports.length} reports generated`)
  return reports
}

/**
 * Check if a ticker is a European stock (has exchange suffix).
 */
export function isEuropeanTicker(ticker) {
  if (!ticker || !ticker.includes('.')) return false
  const { country } = parseTickerInfo(ticker)
  return !!country
}

/**
 * Get the country code for a ticker.
 */
export function getTickerCountry(ticker) {
  return parseTickerInfo(ticker).country
}
