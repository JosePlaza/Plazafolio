/**
 * Módulo de valoración — precio de entrada (SPEC_01).
 *
 * Puro: no toca red ni DOM. Recibe el snapshot de Weiss del módulo existente
 * (`src/lib/geraldine.js`, vía `toWeissSnapshot`) más los datos de mercado, y
 * devuelve las tres cards: Gordon, múltiplos vs. historia y precio óptimo de
 * entrada.
 *
 * Decisión de diseño clave (§3 de la spec): las bandas de Weiss NUNCA se
 * recalculan aquí. Se consumen tal cual para que la card de síntesis no pueda
 * contradecir a la Geraldine Band que el usuario ya tiene delante.
 */

export const DEFAULT_CONFIG = {
  // v1.4 — bajados de 10%/8%: con 10% la horquilla de Gordon quedaba tan por
  // debajo del mercado que el check de coherencia no discriminaba nada.
  r_exigente: 0.08,
  r_flexible: 0.05,
  G_CAP_OPT: 0.06,
  G_CAP_CONS: 0.04,
  G_FLOOR: 0.00,
  SPREAD_MIN: 0.02,
  HISTORY_YEARS: 10,
  MULT_PCTL_CONS: 25,
  REGIME_LOOKBACK_YEARS: 5,
  YIELD_PCTL_ALTO: 90,
  yield_min_exigido: null,
}

export const AVISOS = {
  G_RECORTADO_CONS: 'gRecortado en escenario conservador',
  G_RECORTADO_OPT: 'gRecortado en escenario optimista',
  DIVIDENDO_RECORTADO: 'DIVIDENDO_RECORTADO_EN_HISTORIA',
  TRAMPA_DE_VALOR: 'POSIBLE_TRAMPA_DE_VALOR',
  DIVIDENDO_ESPECIAL: 'DIVIDENDO_ESPECIAL_EXCLUIDO',
  SIN_MULTIPLOS: 'SIN_HISTORIA_DE_FUNDAMENTALES',
  EXIGE_FANTASIA: 'GORDON_EXIGE_FANTASIA',
  REGIMEN_OBSOLETO: 'REGIMEN_YIELD_OBSOLETO',
  HISTORIA_DEGENERADA: 'HISTORIA_DEGENERADA',
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const positive = (v) => isNum(v) && v > 0

function clamp(v, lo, hi) {
  return Math.min(Math.max(v, lo), hi)
}

function median(values) {
  const xs = values.filter(positive).sort((a, b) => a - b)
  if (!xs.length) return null
  const mid = Math.floor(xs.length / 2)
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2
}

/**
 * Percentil interpolado (método lineal). Con 4-5 años de historia el p25 cae
 * cerca del segundo valor más bajo: exigente sin ser el mínimo absoluto (§5.3).
 */
function percentile(values, p) {
  const xs = values.filter(positive).sort((a, b) => a - b)
  if (!xs.length) return null
  if (xs.length === 1) return xs[0]
  const idx = (p / 100) * (xs.length - 1)
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return xs[lo]
  return xs[lo] + (xs[hi] - xs[lo]) * (idx - lo)
}

function mean(values) {
  const xs = values.filter(isNum)
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null
}

// ── §3. Adaptador del módulo Weiss existente ────────────────────────────────

/**
 * Traduce la salida de `computeAll()` (geraldine.js) al `WeissSnapshot` de la
 * spec. Los yields de geraldine.js vienen en PUNTOS PORCENTUALES (3.63), no en
 * tanto por uno: aquí se normalizan a fracción, que es como opera esta spec.
 *
 * @param {Object} indicators - `data.indicators` de computeAll
 * @param {Array}  trailingDividends - `data.trailingDividends` (para D0)
 * @param {number} aniosUsados
 * @returns {Object|null} WeissSnapshot, o null si no hay bandas utilizables
 */
export function toWeissSnapshot(indicators, trailingDividends = [], aniosUsados = 0) {
  if (!indicators) return null

  const last = trailingDividends.length
    ? trailingDividends[trailingDividends.length - 1]
    : null
  const d0 = positive(last?.annualDividend) ? last.annualDividend : null

  const yieldAlto = isNum(indicators.avgHighYield) ? indicators.avgHighYield / 100 : null
  const yieldBajo = isNum(indicators.avgLowYield) ? indicators.avgLowYield / 100 : null
  const yieldActual = isNum(indicators.currentYield) ? indicators.currentYield / 100 : null

  return {
    precioInfravalorado: positive(indicators.undervaluedPrice) ? indicators.undervaluedPrice : null,
    precioSobrevalorado: positive(indicators.overvaluedPrice) ? indicators.overvaluedPrice : null,
    yieldAlto,
    yieldBajo,
    yieldActual,
    d0,
    precioActual: positive(indicators.currentPrice) ? indicators.currentPrice : null,
    aniosUsados,
    zona: clasificarZona(yieldActual, yieldAlto, yieldBajo),
  }
}

function clasificarZona(yActual, yAlto, yBajo) {
  if (!isNum(yActual) || !isNum(yAlto) || !isNum(yBajo)) return 'INTERMEDIA'
  if (yActual >= yAlto) return 'COMPRA'
  if (yActual <= yBajo) return 'VENTA'
  return 'INTERMEDIA'
}

// ── §3.1. Detector de régimen de yield obsoleto (v1.3) ──────────────────────

/**
 * Convierte la serie diaria de yields de geraldine.js (puntos porcentuales) a
 * fracciones, que es la unidad en la que opera este módulo.
 */
export function toYieldSeries(dailyYields = []) {
  return dailyYields
    .filter((d) => d?.date && isNum(d.dividendYield))
    .map((d) => ({ date: String(d.date).slice(0, 10), yield: d.dividendYield / 100 }))
}

/**
 * §3.1 — ¿La banda alta de Weiss sigue viva, o está anclada a un régimen que ya
 * no existe?
 *
 * La banda alta promedia 10 años. Si los años lejanos tuvieron yields
 * estructuralmente más altos (rerating), la media queda anclada a un régimen
 * muerto y la zona de compra se vuelve inalcanzable salvo crash: la señal deja
 * de discriminar y TODO parece "lejos". Caso MCD: −20% de drawdown, de los
 * mayores de su década fuera de 2020, y aun así +26,5% sobre la entrada.
 *
 * El fallback es el percentil 90 del yield diario de la década: por
 * construcción es un nivel que la acción SÍ visita (~10% de las sesiones), así
 * que la zona de compra vuelve a ser alcanzable sin dejar de ser exigente.
 *
 * @param {Array}  serieYield - [{ date, yield }] en FRACCIÓN (ver toYieldSeries)
 * @param {Object} weiss - WeissSnapshot
 * @param {Object} cfg
 * @param {string} hoy - ISO opcional, para tests deterministas
 */
export function detectYieldRegime(serieYield = [], weiss = {}, cfg = DEFAULT_CONFIG, hoy = null) {
  const base = {
    obsoleto: false,
    ultimoToqueBandaAlta: null,
    yieldAltoEfectivo: weiss?.yieldAlto ?? null,
    precioCompraEfectivo: weiss?.precioInfravalorado ?? null,
    degenerada: false,
  }

  if (!serieYield.length || !positive(weiss?.yieldAlto) || !positive(weiss?.precioInfravalorado)) {
    return base
  }

  const hoyDate = hoy ? new Date(hoy) : new Date()
  const lookback = cfg.REGIME_LOOKBACK_YEARS ?? DEFAULT_CONFIG.REGIME_LOOKBACK_YEARS

  const toques = serieYield.filter((d) => d.yield >= weiss.yieldAlto)
  const ultimoToque = toques.length
    ? toques.reduce((max, d) => (d.date > max.date ? d : max)).date
    : null

  const limite = new Date(hoyDate)
  limite.setFullYear(limite.getFullYear() - lookback)
  const limiteISO = limite.toISOString().slice(0, 10)

  const obsoleto = ultimoToque == null || ultimoToque <= limiteISO
  if (!obsoleto) return { ...base, ultimoToqueBandaAlta: ultimoToque }

  const yieldAltoEfectivo = percentile(
    serieYield.map((d) => d.yield),
    cfg.YIELD_PCTL_ALTO ?? DEFAULT_CONFIG.YIELD_PCTL_ALTO,
  )
  if (!positive(yieldAltoEfectivo)) {
    return { ...base, ultimoToqueBandaAlta: ultimoToque }
  }

  const precioCompraEfectivo = weiss.d0 / yieldAltoEfectivo

  // Sanidad (§3.1): con historia degenerada el fallback podría dar una "zona de
  // compra" por encima del precio de sobrevaloración, que no significa nada.
  const sano =
    yieldAltoEfectivo > (weiss.yieldBajo ?? 0) &&
    (!positive(weiss.precioSobrevalorado) || precioCompraEfectivo < weiss.precioSobrevalorado)

  if (!sano) {
    return { ...base, ultimoToqueBandaAlta: ultimoToque, degenerada: true }
  }

  return {
    obsoleto: true,
    ultimoToqueBandaAlta: ultimoToque,
    yieldAltoEfectivo,
    precioCompraEfectivo,
    degenerada: false,
  }
}

// ── §1.3 / §7.6 / §7.9. Series anuales derivadas del histórico ──────────────

/**
 * Agrega el histórico diario en series anuales.
 *
 * Excluye el año en curso si lleva menos de 9 meses de datos (§7.9): un año a
 * medias sesga tanto el máx/mín como la suma de dividendos, y ese sesgo se
 * propagaría al CAGR y a las medias de múltiplos.
 *
 * Filtra dividendos extraordinarios (§7.6): un pago > 3× la mediana de los 8
 * últimos entra en `divPaid` como si fuera recurrente y dispara el CAGR.
 *
 * @param {Array} prices - [{ date, high?, low?, close }]
 * @param {Array} dividends - [{ date, amount|dividend|adjDividend }]
 * @param {Object} opts - { historyYears, hoy }
 */
export function buildAnnualSeries(prices = [], dividends = [], opts = {}) {
  const historyYears = opts.historyYears ?? DEFAULT_CONFIG.HISTORY_YEARS
  const hoy = opts.hoy ? new Date(opts.hoy) : new Date()
  const avisos = []

  const yearOf = (d) => Number(String(d).slice(0, 4))
  const amountOf = (d) => Number(d.amount ?? d.dividend ?? d.adjDividend ?? 0)

  // §7.6 — mediana de los últimos 8 pagos como referencia de "pago normal".
  const ordenados = [...dividends]
    .filter((d) => d?.date && positive(amountOf(d)))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
  const ultimos8 = ordenados.slice(-8).map(amountOf)
  const refPago = median(ultimos8)
  const esEspecial = (d) => refPago != null && amountOf(d) > 3 * refPago

  const anioActual = hoy.getFullYear()
  // getMonth() es 0-11: +1 da los meses transcurridos, umbral 9 de la spec.
  const mesesTranscurridos = hoy.getMonth() + 1
  const anioActualIncompleto = mesesTranscurridos < 9

  const desde = anioActual - historyYears
  const incluir = (y) =>
    y > desde && y <= anioActual && !(y === anioActual && anioActualIncompleto)

  const divPaid = {}
  for (const d of ordenados) {
    const y = yearOf(d.date)
    if (!incluir(y)) continue
    if (esEspecial(d)) {
      if (!avisos.includes(AVISOS.DIVIDENDO_ESPECIAL)) avisos.push(AVISOS.DIVIDENDO_ESPECIAL)
      continue
    }
    divPaid[y] = (divPaid[y] || 0) + amountOf(d)
  }

  const priceMax = {}
  const priceMin = {}
  for (const p of prices) {
    if (!p?.date) continue
    const y = yearOf(p.date)
    if (!incluir(y)) continue
    // Fallback a `close` cuando el proveedor no da high/low (§1.3).
    const hi = positive(p.high) ? p.high : p.close
    const lo = positive(p.low) ? p.low : p.close
    if (!positive(hi) || !positive(lo)) continue
    priceMax[y] = priceMax[y] == null ? hi : Math.max(priceMax[y], hi)
    priceMin[y] = priceMin[y] == null ? lo : Math.min(priceMin[y], lo)
  }

  const anios = Object.keys(divPaid).map(Number).sort((a, b) => a - b)

  // §7.3 — recorte del dividendo en algún año de la historia.
  for (let i = 1; i < anios.length; i++) {
    if (divPaid[anios[i]] < divPaid[anios[i - 1]] * 0.95) {
      if (!avisos.includes(AVISOS.DIVIDENDO_RECORTADO)) avisos.push(AVISOS.DIVIDENDO_RECORTADO)
      break
    }
  }

  return { divPaid, priceMax, priceMin, anios, avisos }
}

/** §4.1 — CAGR a 5 años completos del dividendo. null si no hay 6 años. */
export function cagr5(divPaid, anios) {
  if (!anios || anios.length < 6) return null
  const fin = anios[anios.length - 1]
  const ini = anios[anios.length - 6]
  const dFin = divPaid[fin]
  const dIni = divPaid[ini]
  if (!positive(dFin) || !positive(dIni)) return null
  return Math.pow(dFin / dIni, 1 / 5) - 1
}

// ── §4. Card 1 — Modelo de Gordon ───────────────────────────────────────────

/**
 * Un escenario de Gordon.
 *
 * El orden importa: primero el clamp por techo/suelo del escenario, y solo
 * después la restricción dura `g <= r - SPREAD_MIN`. Sin ese segundo paso la
 * fórmula explota (denominador → 0) o devuelve precios negativos.
 */
export function gordon(D0, r, gBase, capG, cfg = DEFAULT_CONFIG) {
  let g = clamp(isNum(gBase) ? gBase : 0, cfg.G_FLOOR, capG)
  let gRecortado = false
  if (g > r - cfg.SPREAD_MIN) {
    g = r - cfg.SPREAD_MIN
    gRecortado = true
  }
  const d1 = D0 * (1 + g)
  return { r, g, d1, precioJusto: d1 / (r - g), gRecortado }
}

/**
 * Card de Gordon (§4).
 *
 * Etiquetas v1.2: "exigente" (r 10%) y "flexible" (r 8%). Exigir más
 * rentabilidad da SIEMPRE un precio más bajo, así que el par
 * conservador/optimista de v1.1 se leía como un bug. El nombre lo arregla.
 */
export function computeGordon(D0, cagr, cfg = DEFAULT_CONFIG, precioActual = null) {
  const base = isNum(cagr) ? cagr : 0
  const exigente = gordon(D0, cfg.r_exigente, base - 0.01, cfg.G_CAP_CONS, cfg)
  const flexible = gordon(D0, cfg.r_flexible, base, cfg.G_CAP_OPT, cfg)

  // §4.3 — crecimiento perpetuo que el mercado descuenta al precio de hoy.
  let gImplicitoPct = null
  if (positive(precioActual) && positive(D0)) {
    gImplicitoPct = ((cfg.r_exigente * precioActual - D0) / (precioActual + D0)) * 100
  }

  return {
    exigente,
    flexible,
    gImplicitoPct,
    cagr5Pct: isNum(cagr) ? cagr * 100 : null,
  }
}

/**
 * §4.4 — veredicto de coherencia sobre el precio de entrada ya calculado.
 *
 * Gordon NO fija el precio (ver §6.1): juzga si la entrada que proponen Weiss y
 * los múltiplos exige creerse un crecimiento perpetuo desmedido.
 */
export function gordonCoherencia(gordonCard, D0, precioEntradaOptimista, cfg = DEFAULT_CONFIG) {
  const pFlex = gordonCard?.flexible?.precioJusto
  if (!positive(precioEntradaOptimista) || !positive(pFlex)) return null

  const gEntrada = positive(D0)
    ? (cfg.r_exigente * precioEntradaOptimista - D0) / (precioEntradaOptimista + D0)
    : null

  let veredicto
  if (precioEntradaOptimista <= pFlex) veredicto = 'COHERENTE'
  else if (precioEntradaOptimista <= pFlex * 1.15) veredicto = 'AJUSTADO'
  else veredicto = 'EXIGE_FANTASIA'

  return {
    veredicto,
    gEntradaPct: isNum(gEntrada) ? gEntrada * 100 : null,
    horquilla: [gordonCard?.exigente?.precioJusto ?? null, pFlex],
  }
}

// ── §5. Card 2 — Múltiplos contra la propia historia ────────────────────────

/**
 * Múltiplos actuales y su media histórica, más el precio implícito al que la
 * acción cotizaría con las métricas de hoy a su múltiplo medio.
 *
 * Nunca se imputan valores (§7.4): un múltiplo sin dato queda fuera, y con EPS
 * o FCF negativos se excluye en vez de mostrar un múltiplo negativo (§7.5).
 * Se exigen ≥ 4 años de historia por múltiplo, según §5.2.
 *
 * @param {Object} snap - snapshot de mercado (§1.1)
 * @param {Object} hist - { per: number[], evEbitda: number[], pFcf: number[] }
 */
export function computeMultiples(snap = {}, hist = {}, precioActual = null, cfg = DEFAULT_CONFIG) {
  const P = positive(precioActual) ? precioActual : snap.precioActual
  const {
    trailingPE, trailingEps, sharesOutstanding, enterpriseValue,
    enterpriseToEbitda, ebitda, totalDebt, totalCash, freeCashflow,
  } = snap

  const MIN_ANIOS = 4
  const pctl = cfg.MULT_PCTL_CONS ?? DEFAULT_CONFIG.MULT_PCTL_CONS
  // §5.3 v1.2 — dos agregados por múltiplo: media (escenario optimista) y
  // percentil bajo (escenario conservador).
  const agregados = (serie) => {
    const xs = (serie || []).filter(positive)
    if (xs.length < MIN_ANIOS) return { media: null, p25: null, n: xs.length }
    return { media: mean(xs), p25: percentile(xs, pctl), n: xs.length }
  }

  const perActual = positive(trailingPE)
    ? trailingPE
    : (positive(P) && positive(trailingEps) ? P / trailingEps : null)

  const evEbitdaActual = positive(enterpriseToEbitda)
    ? enterpriseToEbitda
    : (positive(enterpriseValue) && positive(ebitda) ? enterpriseValue / ebitda : null)

  const fcfPorAccion = positive(freeCashflow) && positive(sharesOutstanding)
    ? freeCashflow / sharesOutstanding
    : null
  const pFcfActual = positive(P) && positive(fcfPorAccion) ? P / fcfPorAccion : null

  const deudaNeta = isNum(totalDebt) && isNum(totalCash) ? totalDebt - totalCash : null

  const aPer = agregados(hist.per)
  const aEv = agregados(hist.evEbitda)
  const aFcf = agregados(hist.pFcf)

  const filas = []
  const push = (nombre, actual, agg, aPrecio) => {
    if (!positive(actual) || !positive(agg.media)) return
    const precioImplicito = aPrecio(agg.media)
    const precioImplicitoP25 = positive(agg.p25) ? aPrecio(agg.p25) : null
    if (!positive(precioImplicito)) return
    filas.push({
      nombre,
      actual,
      mediaHist: agg.media,
      p25Hist: agg.p25,
      primaPct: ((actual - agg.media) / agg.media) * 100,
      precioImplicito,
      precioImplicitoP25: positive(precioImplicitoP25) ? precioImplicitoP25 : null,
    })
  }

  if (positive(trailingEps)) {
    push('PER', perActual, aPer, (m) => m * trailingEps)
  }
  if (positive(fcfPorAccion)) {
    push('P/FCF', pFcfActual, aFcf, (m) => m * fcfPorAccion)
  }
  if (positive(ebitda) && positive(sharesOutstanding) && deudaNeta != null) {
    push('EV/EBITDA', evEbitdaActual, aEv, (m) => (m * ebitda - deudaNeta) / sharesOutstanding)
  }

  const precioImplicitoMedia = median(filas.map((f) => f.precioImplicito))
  const precioImplicitoP25 = median(filas.map((f) => f.precioImplicitoP25))

  // §5.4 — lectura vs. media: descuento < −5%, prima > +5%, resto en línea.
  let lectura = null
  const primaMedia = mean(filas.map((f) => f.primaPct))
  if (isNum(primaMedia)) {
    lectura = primaMedia < -5 ? 'DESCUENTO' : primaMedia > 5 ? 'PRIMA' : 'EN_LINEA'
  }

  return {
    multiplos: filas,
    precioImplicitoMedia,
    precioImplicitoP25,
    aniosUsados: Math.max(aPer.n, aEv.n, aFcf.n),
    lectura,
  }
}

/**
 * §5.2 vía fundamental — series históricas de PER, EV/EBITDA y P/FCF.
 *
 * Yahoo no expone múltiplos históricos, así que se reconstruyen combinando los
 * fundamentales anuales (que la app ya descarga en `data.fundamentals`) con el
 * máx/mín de precio de cada año: `precioMedio[y] = (max + min) / 2`.
 *
 * Se descarta cualquier año cuyo denominador sea ≤ 0 (§7.5): un PER con BPA
 * negativo no es "barato", es que no aplica.
 *
 * @param {Object} fundamentals - { income[], balance[], cashFlow[] } de /api/fundamentals
 * @param {Object} priceMax, priceMin - mapas año → precio (buildAnnualSeries)
 * @returns {{ per: number[], evEbitda: number[], pFcf: number[] }}
 */
export function buildHistoricalMultiples(fundamentals = {}, priceMax = {}, priceMin = {}) {
  const per = []
  const evEbitda = []
  const pFcf = []

  const byYear = (rows = []) => {
    const m = {}
    for (const r of rows) {
      if (!r?.date) continue
      m[Number(String(r.date).slice(0, 4))] = r
    }
    return m
  }
  const income = byYear(fundamentals.income)
  const balance = byYear(fundamentals.balance)
  const cash = byYear(fundamentals.cashFlow)

  for (const key of Object.keys(priceMax)) {
    const y = Number(key)
    const hi = priceMax[y]
    const lo = priceMin[y]
    if (!positive(hi) || !positive(lo)) continue
    const precioMedio = (hi + lo) / 2

    const inc = income[y]
    const bal = balance[y]
    const cf = cash[y]
    const shares = bal?.ordinarySharesNumber

    if (inc && positive(shares) && positive(inc.netIncome)) {
      const eps = inc.netIncome / shares
      if (positive(eps)) per.push(precioMedio / eps)
    }

    if (inc && bal && positive(shares) && positive(inc.ebitda)) {
      const deudaNeta = isNum(bal.netDebt)
        ? bal.netDebt
        : (isNum(bal.totalDebt) && isNum(bal.cashAndEquivalents)
            ? bal.totalDebt - bal.cashAndEquivalents
            : null)
      if (deudaNeta != null) {
        const ev = precioMedio * shares + deudaNeta
        if (positive(ev)) evEbitda.push(ev / inc.ebitda)
      }
    }

    if (cf && positive(shares) && positive(cf.freeCashFlow)) {
      const fcfPorAccion = cf.freeCashFlow / shares
      if (positive(fcfPorAccion)) pFcf.push(precioMedio / fcfPorAccion)
    }
  }

  return { per, evEbitda, pFcf }
}

// ── §6. Card 3 — Precio óptimo de entrada (síntesis) ────────────────────────

/**
 * El precio de entrada es el MÍNIMO de los métodos disponibles: el que cumple
 * las tres condiciones a la vez es el más exigente. `metodoLimitante` expone
 * cuál fijó ese mínimo, que es la información realmente accionable.
 */
export function computeEntryPrice({ weiss, multiplesCard, regimen = null, cfg = DEFAULT_CONFIG }) {
  // §3.1 — banda clásica, o fallback por percentil si el régimen es obsoleto.
  const usaFallback = !!regimen?.obsoleto && positive(regimen.precioCompraEfectivo)
  const pWeiss = usaFallback ? regimen.precioCompraEfectivo : weiss?.precioInfravalorado
  const etiquetaWeiss = usaFallback ? 'WEISS_P90' : 'WEISS'
  const pMedia = multiplesCard?.precioImplicitoMedia
  const pP25 = multiplesCard?.precioImplicitoP25
  const P = weiss?.precioActual

  const hayMultiplos = positive(pMedia)
  const metodosUsados = hayMultiplos ? [etiquetaWeiss, 'MULTIPLOS'] : [etiquetaWeiss]

  const resolver = (precioMultiplo, etiquetaMultiplo) => {
    const candidatos = [{ metodo: etiquetaWeiss, precio: pWeiss }]
    if (positive(precioMultiplo)) {
      candidatos.push({ metodo: etiquetaMultiplo, precio: precioMultiplo })
    }
    // §6.2 — tope opcional por yield mínimo exigido por el usuario.
    if (positive(cfg.yield_min_exigido) && positive(weiss?.d0)) {
      candidatos.push({ metodo: 'YIELD_MIN', precio: weiss.d0 / cfg.yield_min_exigido })
    }

    const validos = candidatos.filter((c) => positive(c.precio))
    if (!validos.length) return null
    const ganador = validos.reduce((min, c) => (c.precio < min.precio ? c : min))
    return {
      precioEntrada: ganador.precio,
      metodoLimitante: ganador.metodo,
      distanciaPct: positive(P) ? ((P - ganador.precio) / ganador.precio) * 100 : null,
    }
  }

  // v1.2: los escenarios difieren solo en la pata de múltiplos (p25 vs media).
  // Gordon NO entra en el mínimo: con r=10% y g≤4% era siempre el limitante en
  // empresas de calidad con yield bajo y producía entradas a −50/−70% de la
  // cotización (caso JNJ). Su papel es el veredicto de coherencia (§4.4).
  const conservador = resolver(pP25, 'MULTIPLOS_P25')
  const optimista = resolver(pMedia, 'MULTIPLOS_MEDIA')

  // §6.3 — semáforo global. Puede discrepar de la señal de Indicadores.
  let semaforo = 'LEJOS'
  if (positive(P) && conservador) {
    if (P <= conservador.precioEntrada) semaforo = 'EN_ZONA'
    else if (
      (optimista && P <= optimista.precioEntrada) ||
      (isNum(conservador.distanciaPct) && conservador.distanciaPct <= 10)
    ) semaforo = 'CERCA'
  }

  return { conservador, optimista, precioActual: P, semaforo, metodosUsados, regimenYield: regimen }
}

/**
 * §6.5 — modelo de la barra de rango tipo bullet que sustituye al gráfico de
 * cotización histórica.
 *
 * Es un bullet "a la inversa" en sentido semántico: la zona buena queda a la
 * IZQUIERDA, porque en un precio de entrada menos es mejor.
 *
 * Devuelve posiciones en % de la escala (0-100) para que el componente se
 * limite a pintar. Los segmentos que se salgan de escala se recortan y se
 * marcan con `recortado`, en vez de deformar la escala o usar logaritmos.
 */
export function buildRangeBar({ entrada, gordon, multiplos, weiss } = {}) {
  const pCons = entrada?.conservador?.precioEntrada
  const pOpt = entrada?.optimista?.precioEntrada
  const pActual = entrada?.precioActual
  const pVenta = weiss?.precioSobrevalorado
  const gExig = gordon?.exigente?.precioJusto
  const gFlex = gordon?.flexible?.precioJusto

  if (!positive(pCons) || !positive(pActual)) return null

  const minEscala = Math.min(...[pCons, gExig].filter(positive)) * 0.95
  const maxEscala = Math.max(...[pActual, pVenta].filter(positive)) * 1.05
  if (!(maxEscala > minEscala)) return null

  const span = maxEscala - minEscala
  const pos = (v) => ((v - minEscala) / span) * 100
  const clampPos = (v) => Math.min(100, Math.max(0, pos(v)))

  const zonas = []
  const addZona = (desde, hasta, tipo) => {
    if (!positive(desde) || !positive(hasta) || hasta <= desde) return
    zonas.push({ tipo, from: clampPos(desde), to: clampPos(hasta) })
  }
  addZona(minEscala, pCons, 'compra')
  addZona(pCons, pOpt, 'flexible')
  addZona(positive(pOpt) ? pOpt : pCons, positive(pVenta) ? pVenta : maxEscala, 'intermedia')
  if (positive(pVenta)) addZona(pVenta, maxEscala, 'sobrevaloracion')

  const marcadores = []
  const addMarca = (valor, id, label, principal = false) => {
    if (!positive(valor)) return
    marcadores.push({ id, label, valor, pos: clampPos(valor), principal, fuera: valor > maxEscala || valor < minEscala })
  }
  addMarca(pCons, 'entradaExigente', 'Entrada exigente')
  if (positive(pOpt) && Math.abs(pOpt - pCons) > 1e-9) addMarca(pOpt, 'entradaFlexible', 'Entrada flexible')
  addMarca(pActual, 'actual', 'Hoy', true)

  const segmentos = []
  const addSegmento = (a, b, id, label) => {
    if (!positive(a) || !positive(b)) return
    const lo = Math.min(a, b)
    const hi = Math.max(a, b)
    segmentos.push({
      id, label, desde: lo, hasta: hi,
      from: clampPos(lo), to: clampPos(hi),
      recortado: lo < minEscala || hi > maxEscala,
    })
  }
  addSegmento(gExig, gFlex, 'gordon', 'Horquilla de Gordon')
  addSegmento(multiplos?.precioImplicitoP25, multiplos?.precioImplicitoMedia, 'multiplos', 'Múltiplos p25 — media')

  return { minEscala, maxEscala, zonas, marcadores, segmentos }
}

// ── Orquestador ─────────────────────────────────────────────────────────────

/**
 * Ejecuta la valoración completa a partir de datos ya descargados.
 *
 * @param {Object} args
 * @param {Object} args.weiss - WeissSnapshot (§3)
 * @param {Array}  args.prices, args.dividends - histórico (§1.2)
 * @param {Array}  args.dailyYields - serie diaria de yields en FRACCIÓN (§3.1)
 * @param {Object} args.snapshot - datos de mercado (§1.1)
 * @param {Object} args.histMultiples - series históricas de múltiplos (§5.2)
 * @param {Object} args.config
 * @returns {Object} { estado: 'OK'|'NO_VALORABLE', motivo?, gordon, multiplos, entrada, avisos }
 */
export function valuate({
  weiss,
  prices = [],
  dividends = [],
  dailyYields = [],
  snapshot = {},
  histMultiples = {},
  config = {},
  hoy = null,
} = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config }
  const avisos = []

  // §7.1 — Weiss es obligatorio: sin sus bandas no hay síntesis posible.
  if (!weiss || !positive(weiss.precioInfravalorado) || !positive(weiss.d0)) {
    return {
      estado: 'NO_VALORABLE',
      motivo: 'Sin bandas de Weiss o sin dividendo actual: la metodología solo aplica a pagadores consolidados.',
      avisos,
    }
  }

  const series = buildAnnualSeries(prices, dividends, {
    historyYears: cfg.HISTORY_YEARS,
    hoy,
  })
  avisos.push(...series.avisos)

  const aniosConDividendo = series.anios.filter((y) => positive(series.divPaid[y])).length
  if (aniosConDividendo < 5) {
    return {
      estado: 'NO_VALORABLE',
      motivo: `Solo ${aniosConDividendo} años completos con dividendo (se exigen 5).`,
      avisos,
    }
  }

  const cagr = cagr5(series.divPaid, series.anios)
  const gordonCard = computeGordon(weiss.d0, cagr, cfg, weiss.precioActual)
  if (gordonCard.exigente.gRecortado) avisos.push(AVISOS.G_RECORTADO_CONS)
  if (gordonCard.flexible.gRecortado) avisos.push(AVISOS.G_RECORTADO_OPT)

  const multiplesCard = computeMultiples(snapshot, histMultiples, weiss.precioActual, cfg)
  if (!positive(multiplesCard.precioImplicitoMedia)) avisos.push(AVISOS.SIN_MULTIPLOS)

  // §3.1 — ¿sigue viva la banda alta, o está anclada a un régimen muerto?
  const regimen = detectYieldRegime(dailyYields, weiss, cfg, hoy)
  if (regimen.obsoleto) avisos.push(AVISOS.REGIMEN_OBSOLETO)
  if (regimen.degenerada) avisos.push(AVISOS.HISTORIA_DEGENERADA)

  // v1.2 — Gordon queda fuera del min(): entra después, como veredicto.
  const entrada = computeEntryPrice({ weiss, multiplesCard, regimen, cfg })
  const coherencia = gordonCoherencia(
    gordonCard, weiss.d0, entrada?.optimista?.precioEntrada, cfg,
  )
  if (coherencia) {
    gordonCard.coherencia = coherencia.veredicto
    gordonCard.gEntradaPct = coherencia.gEntradaPct
    if (coherencia.veredicto === 'EXIGE_FANTASIA') avisos.push(AVISOS.EXIGE_FANTASIA)
  }

  // §7.10 — yield disparado o payout insostenible: el descuento puede ser
  // deterioro del negocio, no oportunidad.
  const payoutAlto = positive(snapshot.payoutRatio) && snapshot.payoutRatio > 0.9
  const yieldDisparado = positive(weiss.yieldActual) && positive(weiss.yieldAlto) &&
    weiss.yieldActual > weiss.yieldAlto * 1.3
  if (payoutAlto || yieldDisparado) avisos.push(AVISOS.TRAMPA_DE_VALOR)

  return {
    estado: 'OK',
    gordon: gordonCard,
    multiplos: multiplesCard,
    entrada: { ...entrada, gordonCoherencia: coherencia, avisos },
    rangeBar: buildRangeBar({ entrada, gordon: gordonCard, multiplos: multiplesCard, weiss }),
    series: { anios: series.anios, divPaid: series.divPaid, priceMax: series.priceMax, priceMin: series.priceMin },
    avisos,
    config: cfg,
  }
}
