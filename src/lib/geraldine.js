/**
 * Lógica del Método Geraldine Weiss
 *
 * El método usa el dividend yield histórico para determinar si una acción
 * está infravalorada o sobrevalorada:
 * - Yield alto histórico → precio bajo → INFRAVALORADA (comprar)
 * - Yield bajo histórico → precio alto → SOBREVALORADA (vender)
 *
 * La "banda de infravaloración" se calcula como: dividendo anual / yield alto
 * La "banda de sobrevaloración" se calcula como: dividendo anual / yield bajo
 *
 * El yield alto y bajo se determinan usando percentiles de toda la distribución
 * de yields históricos, que se aproxima al concepto de Geraldine Weiss de
 * "yields repetidamente altos/bajos" (niveles donde la acción toca techo/suelo).
 */

/**
 * Detecta la frecuencia de pago de dividendos (anual, semestral, trimestral, mensual).
 * Analiza los intervalos entre pagos recientes para determinar la frecuencia.
 * @param {Array} dividends - Historial de dividendos [{date, dividend}, ...]
 * @returns {number} - Pagos por año (1, 2, 4, 12)
 */
function detectFrequency(dividends) {
  if (dividends.length < 3) return 1

  // Usar los últimos 8 pagos para determinar la frecuencia
  const recent = dividends.slice(-8)
  if (recent.length < 2) return 1

  // Calcular intervalo medio en días entre pagos
  let totalDays = 0
  let count = 0
  for (let i = 1; i < recent.length; i++) {
    const d1 = new Date(recent[i - 1].date)
    const d2 = new Date(recent[i].date)
    const days = (d2 - d1) / (1000 * 60 * 60 * 24)
    if (days > 0 && days < 400) { // ignorar gaps > 13 meses
      totalDays += days
      count++
    }
  }

  if (count === 0) return 1
  const avgDays = totalDays / count

  // Clasificar por intervalo medio
  if (avgDays < 50) return 12       // mensual (~30 días)
  if (avgDays < 120) return 4       // trimestral (~91 días)
  if (avgDays < 250) return 2       // semestral (~182 días)
  return 1                          // anual (~365 días)
}

/**
 * Calcula el dividendo anual indicado (indicated annual dividend) para cada fecha
 * de dividendo, usando: último dividendo × frecuencia de pago.
 *
 * Este método es más preciso que sumar trailing 12m porque evita contar
 * 5 pagos trimestrales dentro de una ventana de 12 meses por alineación
 * de fechas, lo que inflaba el yield artificialmente.
 *
 * Coincide con la métrica "Forward Annual Dividend Rate" de Yahoo Finance.
 *
 * @param {Array} dividends - Historial de dividendos [{date, dividend}, ...]
 * @returns {Array} - [{date, annualDividend}, ...]
 */
export function computeTrailingAnnualDividends(dividends) {
  if (!dividends.length) return []

  const results = []
  const freq = detectFrequency(dividends)

  for (let i = 0; i < dividends.length; i++) {
    const amount = dividends[i].adjDividend || dividends[i].dividend || 0
    const annualDividend = amount * freq

    results.push({
      date: dividends[i].date,
      annualDividend,
    })
  }

  return results
}

/**
 * Calcula el dividend yield histórico para cada día de cotización.
 * El dividendo anual trailing se mantiene constante entre pagos de dividendos
 * (lo que produce el efecto "escalonado" en las bandas).
 * @param {Array} prices - [{date, close}, ...]
 * @param {Array} trailingDividends - [{date, annualDividend}, ...]
 * @returns {Array} - [{date, close, annualDividend, dividendYield}, ...]
 */
export function computeDailyYields(prices, trailingDividends) {
  if (!trailingDividends.length || !prices.length) return []

  const divMap = new Map()
  trailingDividends.forEach((d) => divMap.set(d.date, d.annualDividend))

  const results = []
  let currentAnnualDiv = 0

  // Encontrar el primer dividendo anual válido antes o en el inicio de precios
  for (const td of trailingDividends) {
    if (td.date <= prices[0].date) {
      currentAnnualDiv = td.annualDividend
    } else {
      break
    }
  }

  for (const price of prices) {
    if (divMap.has(price.date)) {
      currentAnnualDiv = divMap.get(price.date)
    }

    const dividendYield =
      price.close > 0 && currentAnnualDiv > 0
        ? (currentAnnualDiv / price.close) * 100
        : 0

    results.push({
      date: price.date,
      close: price.close,
      annualDividend: currentAnnualDiv,
      dividendYield,
    })
  }

  return results
}

/**
 * Calcula un percentil de un array ordenado.
 * @param {Array<number>} sortedArr - Array ordenado de menor a mayor
 * @param {number} p - Percentil (0-100)
 * @returns {number}
 */
function percentile(sortedArr, p) {
  if (!sortedArr.length) return 0
  const idx = (p / 100) * (sortedArr.length - 1)
  const lower = Math.floor(idx)
  const upper = Math.ceil(idx)
  if (lower === upper) return sortedArr[lower]
  return sortedArr[lower] + (sortedArr[upper] - sortedArr[lower]) * (idx - lower)
}

/**
 * Calcula los yields alto y bajo históricos usando percentiles.
 *
 * El método Geraldine Weiss busca los niveles de yield donde la acción
 * "repetidamente" toca máximos y mínimos. Esto se aproxima mejor con
 * percentiles de toda la distribución de yields, no con promedios de
 * extremos anuales (que estrecha demasiado las bandas).
 *
 * Se usan percentiles ~95-97 para yield alto y ~3-5 para yield bajo.
 *
 * @param {Array} dailyYields - [{date, dividendYield}, ...]
 * @param {number} years - Ventana en años (8, 10, 12, 15)
 * @returns {{ avgHighYield: number, avgLowYield: number, avgYield: number, yearlyData: Array }}
 */
export function computeHistoricalYieldBands(dailyYields, years) {
  if (!dailyYields.length) {
    return { avgHighYield: 0, avgLowYield: 0, avgYield: 0, yearlyData: [] }
  }

  // Filtrar solo yields válidos (> 0) dentro de la ventana de años
  const cutoffDate = new Date()
  cutoffDate.setFullYear(cutoffDate.getFullYear() - years)
  const cutoffStr = cutoffDate.toISOString().split('T')[0]

  const validYields = dailyYields
    .filter((d) => d.date >= cutoffStr && d.dividendYield > 0)
    .map((d) => d.dividendYield)

  if (!validYields.length) {
    return { avgHighYield: 0, avgLowYield: 0, avgYield: 0, yearlyData: [] }
  }

  // Ordenar yields para calcular percentiles
  const sorted = [...validYields].sort((a, b) => a - b)

  // Percentiles para las bandas de Geraldine Weiss
  // P3 = yield bajo (precio alto → sobrevalorado)
  // P97 = yield alto (precio bajo → infravalorado)
  const avgLowYield = percentile(sorted, 3)
  const avgHighYield = percentile(sorted, 97)
  const avgYield = sorted.reduce((a, b) => a + b, 0) / sorted.length

  // Datos por año para el gráfico de yields
  const byYear = {}
  for (const d of dailyYields) {
    if (d.date < cutoffStr || d.dividendYield <= 0) continue
    const year = d.date.substring(0, 4)
    if (!byYear[year]) byYear[year] = []
    byYear[year].push(d.dividendYield)
  }

  const yearlyData = Object.keys(byYear)
    .sort()
    .map((year) => {
      const yields = byYear[year]
      return {
        year,
        high: Math.max(...yields),
        low: Math.min(...yields),
        avg: yields.reduce((a, b) => a + b, 0) / yields.length,
      }
    })

  // Debug: log en consola para comparar con el original
  console.log(`[Geraldine] Yield Alto (P97): ${avgHighYield.toFixed(4)}%`)
  console.log(`[Geraldine] Yield Bajo (P3):  ${avgLowYield.toFixed(4)}%`)
  console.log(`[Geraldine] Yield Medio:      ${avgYield.toFixed(4)}%`)
  console.log(`[Geraldine] Total data points: ${sorted.length}`)

  return { avgHighYield, avgLowYield, avgYield, yearlyData }
}

/**
 * Calcula las bandas de precio para cada punto en el tiempo.
 * - Precio infravalorado = dividendo anual / yield alto * 100
 * - Precio sobrevalorado = dividendo anual / yield bajo * 100
 */
export function computePriceBands(dailyYields, avgHighYield, avgLowYield) {
  if (avgHighYield <= 0 || avgLowYield <= 0) return []

  return dailyYields.map((d) => ({
    date: d.date,
    close: d.close,
    undervalued: d.annualDividend > 0 ? (d.annualDividend / avgHighYield) * 100 : null,
    overvalued: d.annualDividend > 0 ? (d.annualDividend / avgLowYield) * 100 : null,
    dividendYield: d.dividendYield,
    annualDividend: d.annualDividend,
  }))
}

/**
 * Calcula el drawdown (caída desde máximo) para una serie de precios.
 */
export function computeDrawdown(prices) {
  if (!prices.length) return []

  let peak = prices[0].close
  const results = []

  for (const p of prices) {
    if (p.close > peak) peak = p.close
    const drawdown = ((p.close - peak) / peak) * 100
    results.push({ date: p.date, drawdown })
  }

  return results
}

/**
 * Proyecta dividendos futuros basándose en el CAGR histórico.
 */
export function computeDividendProjection(trailingDividends, yearsToProject = 5) {
  if (trailingDividends.length < 2) {
    return { cagr: 0, historical: [], projected: [] }
  }

  const byYear = {}
  for (const d of trailingDividends) {
    const year = d.date.substring(0, 4)
    byYear[year] = d.annualDividend
  }

  const years = Object.keys(byYear).sort()
  const historical = years.map((y) => ({ year: parseInt(y), dividend: byYear[y] }))

  const validHistorical = historical.filter((h) => h.dividend > 0)
  if (validHistorical.length < 2) {
    return { cagr: 0, historical, projected: [] }
  }

  const first = validHistorical[0]
  const last = validHistorical[validHistorical.length - 1]
  const numYears = last.year - first.year

  const cagr =
    numYears > 0
      ? (Math.pow(last.dividend / first.dividend, 1 / numYears) - 1) * 100
      : 0

  const lastYear = last.year
  const lastDiv = last.dividend
  const projected = []

  for (let i = 1; i <= yearsToProject; i++) {
    projected.push({
      year: lastYear + i,
      dividend: lastDiv * Math.pow(1 + cagr / 100, i),
    })
  }

  return { cagr, historical, projected }
}

/**
 * Calcula todos los datos necesarios para la app.
 */
export function computeAll({ prices, dividends, years, profile }) {
  const trailingDividends = computeTrailingAnnualDividends(dividends)
  const dailyYields = computeDailyYields(prices, trailingDividends)
  const { avgHighYield, avgLowYield, avgYield, yearlyData } =
    computeHistoricalYieldBands(dailyYields, years)
  const priceBands = computePriceBands(dailyYields, avgHighYield, avgLowYield)
  const drawdown = computeDrawdown(prices)
  const projection = computeDividendProjection(trailingDividends, 10)

  const lastPrice = prices.length ? prices[prices.length - 1] : null
  const lastYield = dailyYields.length ? dailyYields[dailyYields.length - 1] : null
  const lastBand = priceBands.length ? priceBands[priceBands.length - 1] : null

  const indicators = {
    currentPrice: lastPrice?.close || 0,
    currentYield: lastYield?.dividendYield || 0,
    avgYield,
    avgHighYield,
    avgLowYield,
    undervaluedPrice: lastBand?.undervalued || 0,
    overvaluedPrice: lastBand?.overvalued || 0,
    companyName: profile?.companyName || '',
    sector: profile?.sector || '',
    currency: profile?.currency || 'USD',
  }

  return {
    indicators,
    priceBands,
    dailyYields,
    yearlyData,
    dividends,
    trailingDividends,
    drawdown,
    projection,
  }
}
