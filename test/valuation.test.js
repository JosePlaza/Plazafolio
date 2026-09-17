/**
 * Tests de SPEC_01 §9. Datos fijos, sin red.
 * Ejecutar: npm test  (node --test, sin dependencias nuevas)
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_CONFIG,
  AVISOS,
  gordon,
  computeGordon,
  computeMultiples,
  computeEntryPrice,
  gordonCoherencia,
  detectYieldRegime,
  toYieldSeries,
  buildRangeBar,
  buildAnnualSeries,
  cagr5,
  valuate,
  toWeissSnapshot,
} from '../src/lib/valuation.js'

// Tolerancia ±0,5% salvo indicación (§9).
function closeTo(actual, expected, tolPct = 0.5, msg = '') {
  const diff = Math.abs(actual - expected)
  const tol = Math.abs(expected) * (tolPct / 100)
  assert.ok(
    diff <= tol,
    `${msg}\n  esperado ${expected} ±${tolPct}%, obtenido ${actual} (desvío ${diff})`,
  )
}

/** Serie de dividendos trimestrales con crecimiento anual constante. */
function serieDividendos({ anioInicio, anios, anualInicial, crecimiento }) {
  const out = []
  for (let i = 0; i < anios; i++) {
    const anual = anualInicial * Math.pow(1 + crecimiento, i)
    for (let q = 0; q < 4; q++) {
      const mes = String(q * 3 + 2).padStart(2, '0')
      out.push({ date: `${anioInicio + i}-${mes}-15`, amount: anual / 4 })
    }
  }
  return out
}

function seriePrecios({ anioInicio, anios, precio }) {
  const out = []
  for (let i = 0; i < anios; i++) {
    for (const mes of ['01', '06', '12']) {
      out.push({
        date: `${anioInicio + i}-${mes}-10`,
        high: precio * 1.1,
        low: precio * 0.9,
        close: precio,
      })
    }
  }
  return out
}

// ── T1 — Coherencia del contrato Weiss ──────────────────────────────────────

test('T1 — el adaptador de Weiss normaliza yields y reproduce las bandas canónicas', () => {
  // geraldine.js entrega los yields en puntos porcentuales; la spec opera en fracción.
  const indicators = {
    currentPrice: 102,
    currentYield: 3.53,
    avgHighYield: 4.0,
    avgLowYield: 2.5,
    undervaluedPrice: 90,
    overvaluedPrice: 144,
  }
  const w = toWeissSnapshot(indicators, [{ date: '2026-06-01', annualDividend: 3.6 }], 10)

  assert.equal(w.precioInfravalorado, 90)
  assert.equal(w.precioSobrevalorado, 144)
  closeTo(w.yieldAlto, 0.04, 0.001, 'yieldAlto normalizado a fracción')
  closeTo(w.yieldBajo, 0.025, 0.001, 'yieldBajo normalizado a fracción')
  assert.equal(w.d0, 3.6)
  assert.equal(w.zona, 'INTERMEDIA', 'yield 3,53% entre banda baja y alta')

  // Fórmula canónica: P_compra = D0 / bandaAlta, P_venta = D0 / bandaBaja.
  closeTo(3.6 / 0.04, 90, 0.5, 'P_compra canónico')
  closeTo(3.6 / 0.025, 144, 0.5, 'P_venta canónico')
  // Si D0 sube a 3,80 → P_compra = 95,00.
  closeTo(3.8 / 0.04, 95, 0.5, 'P_compra con D0 = 3,80')
})

// ── T2 — Gordon y sensibilidad ──────────────────────────────────────────────

test('T2 — Gordon: D0=2,50 r=9% con g=4% y g=5%', () => {
  const cfg = { ...DEFAULT_CONFIG }
  const g4 = gordon(2.5, 0.09, 0.04, 0.06, cfg)
  closeTo(g4.d1, 2.60, 0.5, 'D1 con g=4%')
  closeTo(g4.precioJusto, 52.00, 0.5, 'P con g=4%')

  const g5 = gordon(2.5, 0.09, 0.05, 0.06, cfg)
  closeTo(g5.d1, 2.625, 0.5, 'D1 con g=5%')
  closeTo(g5.precioJusto, 65.63, 0.5, 'P con g=5%')

  // Un punto de g mueve el precio ~26%: por eso la card se muestra como horquilla.
  const salto = (g5.precioJusto - g4.precioJusto) / g4.precioJusto
  closeTo(salto * 100, 26.2, 2, 'sensibilidad de +1 p.p. en g')
})

test('T2b — horquilla exigente/flexible con los defaults v1.4 (8% / 5%)', () => {
  const out = computeGordon(2.5, 0.05, DEFAULT_CONFIG, 60)
  assert.ok(out.exigente && out.flexible, 'ambos escenarios presentes')
  assert.equal(out.exigente.r, 0.08)
  assert.equal(out.flexible.r, 0.05)
  closeTo(out.exigente.g, 0.04, 0.001, 'g exigente topado en G_CAP_CONS')
  // Con r_flexible 5% y SPREAD_MIN 2 p.p., g no puede pasar del 3%: el CAGR del
  // 5% se recorta. Es el caso habitual con los defaults v1.4, no una excepción.
  closeTo(out.flexible.g, 0.03, 0.001)
  assert.equal(out.flexible.gRecortado, true)
  // Exigir más rentabilidad da SIEMPRE un precio más bajo: no es un bug, y es
  // la razón del renombrado en v1.2.
  assert.ok(out.exigente.precioJusto < out.flexible.precioJusto)
})

// ── T3 — Caso JNJ ───────────────────────────────────────────────────────────

test('T3 — JNJ: bandas, Gordon y crecimiento implícito', () => {
  const D0 = 5.20
  closeTo(D0 / 0.033, 157.6, 0.5, 'P_compra con banda alta 3,3%')
  closeTo(D0 / 0.024, 216.7, 0.5, 'P_venta con banda baja 2,4%')

  closeTo(gordon(D0, 0.09, 0.045, 0.06).precioJusto, 120.7, 0.5, 'Gordon r=9% g=4,5%')
  closeTo(gordon(D0, 0.09, 0.055, 0.06).precioJusto, 156.7, 0.5, 'Gordon r=9% g=5,5%')

  // §4.3 invertida con r = 9% y P = 165.
  const gImp = (0.09 * 165 - D0) / (165 + D0)
  closeTo(gImp * 100, 5.6, 2, 'crecimiento implícito')
})

// ── T4 — Síntesis por mínimo ────────────────────────────────────────────────

test('T4 — síntesis por mínimo SIN Gordon (v1.2)', () => {
  const out = computeEntryPrice({
    weiss: { precioInfravalorado: 158, precioActual: 165, d0: 5.2 },
    multiplesCard: { precioImplicitoMedia: 168, precioImplicitoP25: 149 },
    cfg: DEFAULT_CONFIG,
  })

  closeTo(out.conservador.precioEntrada, 149, 0.5)
  assert.equal(out.conservador.metodoLimitante, 'MULTIPLOS_P25')
  closeTo(out.optimista.precioEntrada, 158, 0.5)
  assert.equal(out.optimista.metodoLimitante, 'WEISS')
  assert.deepEqual(out.metodosUsados, ['WEISS', 'MULTIPLOS'])
  // Regresión del bug v1.1: un Gordon exigente de 121 NO debe mover nada.
  assert.ok(out.conservador.precioEntrada > 121, 'Gordon fuera del mínimo')
})

test('T4b — regresión JNJ: la entrada de v1.1 (92,91) queda prohibida', () => {
  const weiss = { precioInfravalorado: 161.20, precioActual: 268.04, d0: 5.2 }
  const out = computeEntryPrice({
    weiss,
    multiplesCard: { precioImplicitoMedia: 170.03, precioImplicitoP25: 158.9 },
    cfg: DEFAULT_CONFIG,
  })

  closeTo(out.optimista.precioEntrada, 161.20, 0.5)
  assert.equal(out.optimista.metodoLimitante, 'WEISS')
  closeTo(out.conservador.precioEntrada, 158.9, 0.5)
  assert.equal(out.semaforo, 'LEJOS')
  // El resultado erróneo de v1.1 era 92,91 (−66%): nunca debe volver.
  assert.ok(out.conservador.precioEntrada > 150,
    `entrada ${out.conservador.precioEntrada} recae en el bug de v1.1`)

  // Con los defaults v1.4 (8% / 5%) y D0 = 5,36 con CAGR 5,2%:
  //   exigente 5,36×1,04/0,04 = 139,36 ; flexible con g recortado al 3%:
  //   5,36×1,03/0,02 = 276,04.
  const g = computeGordon(5.36, 0.052, DEFAULT_CONFIG, 268.04)
  closeTo(g.exigente.precioJusto, 139.36, 0.5, 'Gordon exigente v1.4')
  closeTo(g.flexible.precioJusto, 276.04, 0.5, 'Gordon flexible v1.4')
  assert.equal(g.flexible.gRecortado, true, 'r 5% recorta g al 3%')

  const coh = gordonCoherencia(g, 5.36, out.optimista.precioEntrada, DEFAULT_CONFIG)
  assert.equal(coh.veredicto, 'COHERENTE', '161,20 ≤ 276,04')
})

test('T4c — semáforo EN_ZONA cuando el precio ya está por debajo', () => {
  const out = computeEntryPrice({
    weiss: { precioInfravalorado: 158, precioActual: 100, d0: 5.2 },
    multiplesCard: { precioImplicitoMedia: 168, precioImplicitoP25: 149 },
    cfg: DEFAULT_CONFIG,
  })
  assert.equal(out.semaforo, 'EN_ZONA')
})

test('§4.4 — los tres veredictos de coherencia de Gordon', () => {
  const g = { exigente: { precioJusto: 92.91 }, flexible: { precioJusto: 200 } }
  assert.equal(gordonCoherencia(g, 5.2, 180, DEFAULT_CONFIG).veredicto, 'COHERENTE')
  assert.equal(gordonCoherencia(g, 5.2, 220, DEFAULT_CONFIG).veredicto, 'AJUSTADO')
  assert.equal(gordonCoherencia(g, 5.2, 260, DEFAULT_CONFIG).veredicto, 'EXIGE_FANTASIA')
  // Frontera del ×1.15 (200 × 1.15 = 229,999... en IEEE754, así que se prueba
  // a uno y otro lado en vez de sobre el valor exacto: el límite justo no está
  // especificado a nivel de bit y asertarlo sería testear coma flotante).
  assert.equal(gordonCoherencia(g, 5.2, 229, DEFAULT_CONFIG).veredicto, 'AJUSTADO')
  assert.equal(gordonCoherencia(g, 5.2, 231, DEFAULT_CONFIG).veredicto, 'EXIGE_FANTASIA')
})

// ── T5 — Tope por yield mínimo exigido ──────────────────────────────────────

test('T5 — el tope por yield mínimo entra como un candidato más al mínimo', () => {
  const cfg = { ...DEFAULT_CONFIG, yield_min_exigido: 0.04 }
  const out = computeEntryPrice({
    weiss: { precioInfravalorado: 95.24, precioActual: 110, d0: 4.0 },
    multiplesCard: { precioImplicitoMedia: 102, precioImplicitoP25: 98 },
    cfg,
  })
  // tope = 4,00 / 0,04 = 100 ; optimista = min(95,24 ; 102 ; 100) = 95,24
  closeTo(out.optimista.precioEntrada, 95.24, 0.5)
  assert.equal(out.optimista.metodoLimitante, 'WEISS')
})

// ── T6 — Degradaciones ──────────────────────────────────────────────────────

test('T6a — EPS negativo excluye el PER, la mediana usa el resto', () => {
  const snap = {
    precioActual: 100, trailingEps: -2, trailingPE: null,
    freeCashflow: 1000, sharesOutstanding: 100,
    ebitda: 500, totalDebt: 200, totalCash: 50, enterpriseToEbitda: 12,
  }
  const hist = { per: [15, 16, 17, 18], evEbitda: [11, 12, 13, 14], pFcf: [9, 10, 11, 12] }
  const out = computeMultiples(snap, hist, 100)
  assert.ok(!out.multiplos.find((m) => m.nombre === 'PER'), 'PER excluido con EPS negativo')
  assert.ok(out.multiplos.length >= 1, 'quedan otros múltiplos')
  assert.ok(out.multiplos.every((m) => m.actual > 0), 'ningún múltiplo negativo')
  assert.ok(out.precioImplicitoP25 <= out.precioImplicitoMedia, 'p25 nunca por encima de la media')
})

test('T6b — sin múltiplos los dos escenarios colapsan en Weiss (v1.2)', () => {
  const out = computeMultiples({ precioActual: 100 }, {}, 100)
  assert.equal(out.precioImplicitoMedia, null)
  assert.equal(out.precioImplicitoP25, null)

  const sintesis = computeEntryPrice({
    weiss: { precioInfravalorado: 158, precioActual: 165, d0: 5.2 },
    multiplesCard: out,
    cfg: DEFAULT_CONFIG,
  })
  assert.deepEqual(sintesis.metodosUsados, ['WEISS'])
  closeTo(sintesis.conservador.precioEntrada, 158, 0.5)
  closeTo(sintesis.optimista.precioEntrada, 158, 0.5)
})

test('T6c — los topes G_CAP recortan el CAGR del 8% a 6% y 4%', () => {
  // Los defaults v1.4 (r_flexible 5%) hacen que la restricción r − SPREAD_MIN
  // muerda ANTES que G_CAP_OPT, así que el tope del 6% solo es observable con
  // una r que no ate. Se prueban las dos cosas por separado.
  const holgada = { ...DEFAULT_CONFIG, r_flexible: 0.10 }
  const out = computeGordon(3, 0.08, holgada, 100)
  closeTo(out.flexible.g, 0.06, 0.001, 'g flexible topado en G_CAP_OPT')
  closeTo(out.exigente.g, 0.04, 0.001, 'g exigente topado en G_CAP_CONS')
  assert.equal(out.flexible.gRecortado, false, 'aquí manda G_CAP, no el spread')

  const conDefaults = computeGordon(3, 0.08, DEFAULT_CONFIG, 100)
  closeTo(conDefaults.flexible.g, 0.03, 0.001, 'con r 5% manda r − SPREAD_MIN')
  assert.equal(conDefaults.flexible.gRecortado, true)
})

test('T6d — con el default r_flexible 5% y CAGR 6%, g cae a 3% y se marca', () => {
  // v1.4: esto es el caso HABITUAL, no una excepción — el default r_flexible ya
  // es 5%, así que basta con un CAGR por encima del 3%.
  assert.equal(DEFAULT_CONFIG.r_flexible, 0.05, 'default v1.4')
  const out = computeGordon(3, 0.06, DEFAULT_CONFIG, 100)
  closeTo(out.flexible.g, 0.03, 0.001, 'g = r - SPREAD_MIN')
  assert.equal(out.flexible.gRecortado, true)
  assert.ok(out.flexible.precioJusto > 0, 'nunca precio negativo ni infinito')
  assert.ok(Number.isFinite(out.flexible.precioJusto))

  // Con una r holgada, el mismo CAGR NO se recorta: confirma que el recorte lo
  // provoca la r baja y no otra cosa.
  const holgada = computeGordon(3, 0.06, { ...DEFAULT_CONFIG, r_flexible: 0.12 }, 100)
  closeTo(holgada.flexible.g, 0.06, 0.001)
  assert.equal(holgada.flexible.gRecortado, false)
})

test('T6e — 4 años de dividendos devuelve NO_VALORABLE', () => {
  const dividends = serieDividendos({ anioInicio: 2022, anios: 4, anualInicial: 2, crecimiento: 0.05 })
  const prices = seriePrecios({ anioInicio: 2022, anios: 4, precio: 50 })
  const out = valuate({
    weiss: { precioInfravalorado: 45, precioActual: 50, d0: 2.2, yieldActual: 0.044, yieldAlto: 0.05 },
    prices,
    dividends,
    hoy: '2026-12-31',
  })
  assert.equal(out.estado, 'NO_VALORABLE')
  assert.match(out.motivo, /años completos con dividendo/)
})

test('T6f — sin bandas de Weiss también es NO_VALORABLE', () => {
  const out = valuate({ weiss: { precioInfravalorado: null, d0: null } })
  assert.equal(out.estado, 'NO_VALORABLE')
})

// ── §7 — Validaciones y casos límite ────────────────────────────────────────

test('§7.6 — un dividendo especial se excluye de la serie anual', () => {
  const dividends = [
    ...serieDividendos({ anioInicio: 2018, anios: 8, anualInicial: 4, crecimiento: 0.05 }),
    { date: '2023-11-20', amount: 20 }, // extraordinario: >3× la mediana de pago
  ]
  const s = buildAnnualSeries(dividends.map((d) => d), dividends, { hoy: '2026-12-31' })
  assert.ok(s.avisos.includes(AVISOS.DIVIDENDO_ESPECIAL))
  // 2023 no debe llevar el pago de 20 sumado.
  assert.ok(s.divPaid[2023] < 10, `2023 = ${s.divPaid[2023]} debería excluir el especial`)
})

test('§7.3 — un recorte del dividendo genera aviso', () => {
  const dividends = [
    ...serieDividendos({ anioInicio: 2018, anios: 4, anualInicial: 4, crecimiento: 0.05 }),
    ...serieDividendos({ anioInicio: 2022, anios: 4, anualInicial: 2, crecimiento: 0.02 }),
  ]
  const s = buildAnnualSeries([], dividends, { hoy: '2026-12-31' })
  assert.ok(s.avisos.includes(AVISOS.DIVIDENDO_RECORTADO))
})

test('§7.9 — el año en curso incompleto se excluye de las series', () => {
  const dividends = serieDividendos({ anioInicio: 2019, anios: 8, anualInicial: 4, crecimiento: 0.05 })
  const enMarzo = buildAnnualSeries([], dividends, { hoy: '2026-03-15' })
  assert.ok(!enMarzo.anios.includes(2026), 'marzo: 2026 fuera')
  const enNoviembre = buildAnnualSeries([], dividends, { hoy: '2026-11-15' })
  assert.ok(enNoviembre.anios.includes(2026), 'noviembre: 2026 dentro')
})

test('§7.2 — r − g nunca baja de SPREAD_MIN', () => {
  const out = gordon(5, 0.06, 0.99, 0.99, DEFAULT_CONFIG)
  closeTo(out.r - out.g, DEFAULT_CONFIG.SPREAD_MIN, 0.001)
  assert.equal(out.gRecortado, true)
  assert.ok(Number.isFinite(out.precioJusto) && out.precioJusto > 0)
})

test('§7.10 — payout > 90% dispara el aviso de trampa de valor', () => {
  const dividends = serieDividendos({ anioInicio: 2018, anios: 8, anualInicial: 4, crecimiento: 0.04 })
  const prices = seriePrecios({ anioInicio: 2018, anios: 8, precio: 100 })
  const out = valuate({
    weiss: {
      precioInfravalorado: 90, precioActual: 100, d0: 4.5,
      yieldActual: 0.045, yieldAlto: 0.05,
    },
    prices,
    dividends,
    snapshot: { payoutRatio: 0.95 },
    hoy: '2026-12-31',
  })
  assert.equal(out.estado, 'OK')
  assert.ok(out.avisos.includes(AVISOS.TRAMPA_DE_VALOR))
})

test('§4.1 — CAGR5 sobre 6 años completos', () => {
  const dividends = serieDividendos({ anioInicio: 2019, anios: 8, anualInicial: 2, crecimiento: 0.05 })
  const s = buildAnnualSeries([], dividends, { hoy: '2026-12-31' })
  const c = cagr5(s.divPaid, s.anios)
  closeTo(c * 100, 5.0, 1, 'CAGR5 recupera el 5% construido')
})

// ── Integración del orquestador ─────────────────────────────────────────────

test('valuate() devuelve las tres cards coherentes entre sí', () => {
  const dividends = serieDividendos({ anioInicio: 2017, anios: 10, anualInicial: 3, crecimiento: 0.05 })
  const prices = seriePrecios({ anioInicio: 2017, anios: 10, precio: 90 })
  const d0 = 3 * Math.pow(1.05, 9)

  const out = valuate({
    weiss: {
      precioInfravalorado: 100, precioSobrevalorado: 160, precioActual: 120,
      d0, yieldActual: 0.038, yieldAlto: 0.045, yieldBajo: 0.025, aniosUsados: 10,
    },
    prices,
    dividends,
    snapshot: {
      trailingPE: 15.5, trailingEps: 8, sharesOutstanding: 1000,
      ebitda: 5000, totalDebt: 2000, totalCash: 500,
      freeCashflow: 4000, enterpriseToEbitda: 12, payoutRatio: 0.5,
    },
    histMultiples: { per: [16, 17, 18, 17], evEbitda: [12, 13, 14, 13], pFcf: [17, 18, 19, 18] },
    hoy: '2026-12-31',
  })

  assert.equal(out.estado, 'OK')
  assert.ok(out.gordon.exigente.precioJusto > 0)
  assert.ok(out.gordon.flexible.precioJusto > out.gordon.exigente.precioJusto,
    'el escenario flexible siempre da un precio justo mayor')
  assert.equal(out.multiplos.multiplos.length, 3, 'los tres múltiplos computables')
  assert.ok(out.entrada.conservador.precioEntrada <= 100,
    'la entrada nunca supera el precio Weiss de compra')
  assert.ok(out.entrada.conservador.precioEntrada <= out.entrada.optimista.precioEntrada,
    'por construcción conservador <= optimista')
  assert.ok(['WEISS', 'MULTIPLOS_P25', 'MULTIPLOS_MEDIA', 'YIELD_MIN']
    .includes(out.entrada.conservador.metodoLimitante), 'Gordon nunca es limitante en v1.2')
  assert.ok(out.entrada.gordonCoherencia?.veredicto, 'Gordon aporta veredicto de coherencia')
})

// ── T8 — Régimen de yield obsoleto (§3.1, caso MCD) ─────────────────────────

/**
 * Serie semanal de yield al estilo MCD: un régimen antiguo de yields altos que
 * ocupa una MINORÍA de la década, y después un declive gradual por rerating.
 *
 * Que el régimen viejo sea minoritario importa: el fallback del §3.1 es el p90
 * de la serie, así que solo queda por debajo de la banda clásica —y por tanto
 * solo sube el precio de entrada— cuando esos años altos son menos del ~10% de
 * las sesiones. Si el régimen viejo domina la década, el p90 cae dentro de él y
 * el fallback no cambia nada: es un límite real de la regla, no del fixture.
 */
function serieYieldMCD({ hoy, anios, bandaAlta, toqueHastaAnios, yTop, yFin }) {
  const out = []
  const fin = new Date(hoy)
  const DIAS_ANIO = 365 // calendario: setDate resta días naturales, no sesiones
  for (let i = anios * DIAS_ANIO; i >= 0; i -= 7) {
    const d = new Date(fin)
    d.setDate(d.getDate() - i)
    const hace = i / DIAS_ANIO
    const y = hace >= toqueHastaAnios
      ? bandaAlta * 1.02
      : yTop + (yFin - yTop) * (1 - hace / toqueHastaAnios)
    out.push({ date: d.toISOString().slice(0, 10), yield: y })
  }
  return out
}

const WEISS_MCD = {
  yieldAlto: 0.0392, yieldBajo: 0.018, d0: 7.08,
  precioInfravalorado: 180.73, precioSobrevalorado: 400, precioActual: 300,
}

test('T8 — MCD: banda anclada a un régimen muerto activa el fallback p90', () => {
  const serie = serieYieldMCD({
    hoy: '2026-08-30', anios: 10, bandaAlta: WEISS_MCD.yieldAlto,
    toqueHastaAnios: 9.3, yTop: 0.0335, yFin: 0.020,
  })

  const reg = detectYieldRegime(serie, WEISS_MCD, DEFAULT_CONFIG, '2026-08-30')
  assert.equal(reg.obsoleto, true, 'sin tocar la banda alta en más de 5 años')
  assert.ok(reg.ultimoToqueBandaAlta, 'se reporta la fecha del último toque')
  closeTo(reg.yieldAltoEfectivo * 100, 3.30, 5, 'p90 ≈ 3,3% como en la spec')
  closeTo(reg.precioCompraEfectivo, 214.5, 5, 'entrada efectiva ≈ 214,5')
  assert.ok(reg.precioCompraEfectivo > WEISS_MCD.precioInfravalorado,
    'el fallback sube la entrada: la zona vuelve a ser alcanzable')
  assert.ok(reg.precioCompraEfectivo < WEISS_MCD.precioSobrevalorado, 'sanidad §3.1')

  const out = computeEntryPrice({
    weiss: WEISS_MCD,
    multiplesCard: { precioImplicitoMedia: 256.95, precioImplicitoP25: 240 },
    regimen: reg,
    cfg: DEFAULT_CONFIG,
  })
  assert.equal(out.optimista.metodoLimitante, 'WEISS_P90', 'la UI debe poder decirlo')
  closeTo(out.optimista.precioEntrada, reg.precioCompraEfectivo, 0.5)
  assert.ok(out.metodosUsados.includes('WEISS_P90'))
})

test('T8a — último toque hace 2 años: sin fallback, banda clásica', () => {
  const weiss = WEISS_MCD
  const serie = serieYieldMCD({
    hoy: '2026-08-30', anios: 10, bandaAlta: weiss.yieldAlto,
    toqueHastaAnios: 2, yTop: 0.0335, yFin: 0.020,
  })
  const reg = detectYieldRegime(serie, weiss, DEFAULT_CONFIG, '2026-08-30')
  assert.equal(reg.obsoleto, false)
  closeTo(reg.precioCompraEfectivo, 180.73, 0.5)

  const out = computeEntryPrice({
    weiss, multiplesCard: { precioImplicitoMedia: 256.95, precioImplicitoP25: 240 },
    regimen: reg, cfg: DEFAULT_CONFIG,
  })
  assert.equal(out.optimista.metodoLimitante, 'WEISS')
})

test('T8b — historia degenerada: no se aplica fallback y se avisa', () => {
  // yieldBajo por encima de cualquier percentil de la serie → el fallback daría
  // una banda sin sentido.
  const weiss = {
    yieldAlto: 0.05, yieldBajo: 0.09, d0: 7.08,
    precioInfravalorado: 141.6, precioSobrevalorado: 200, precioActual: 300,
  }
  const serie = serieYieldMCD({
    hoy: '2026-08-30', anios: 10, bandaAlta: weiss.yieldAlto,
    toqueHastaAnios: 20, yTop: 0.02, yFin: 0.015,
  })
  const reg = detectYieldRegime(serie, weiss, DEFAULT_CONFIG, '2026-08-30')
  assert.equal(reg.degenerada, true)
  assert.equal(reg.obsoleto, false, 'no se declara obsoleto si el fallback no es sano')
  closeTo(reg.precioCompraEfectivo, weiss.precioInfravalorado, 0.5, 'se mantiene la clásica')
})

test('T8c — el fallback nunca cruza el precio de sobrevaloración', () => {
  const weiss = {
    yieldAlto: 0.05, yieldBajo: 0.001, d0: 7.08,
    precioInfravalorado: 141.6, precioSobrevalorado: 150, precioActual: 300,
  }
  const serie = serieYieldMCD({
    hoy: '2026-08-30', anios: 10, bandaAlta: weiss.yieldAlto,
    toqueHastaAnios: 20, yTop: 0.002, yFin: 0.001,
  })
  const reg = detectYieldRegime(serie, weiss, DEFAULT_CONFIG, '2026-08-30')
  assert.ok(reg.precioCompraEfectivo < weiss.precioSobrevalorado || reg.degenerada,
    'o es sano, o se marca degenerado: nunca una entrada por encima de la venta')
})

test('§3.1 — toYieldSeries normaliza los puntos porcentuales de geraldine', () => {
  const out = toYieldSeries([
    { date: '2026-01-02T00:00:00', dividendYield: 3.63, close: 100 },
    { date: '2026-01-03', dividendYield: null },
  ])
  assert.equal(out.length, 1, 'las entradas sin yield se descartan')
  closeTo(out[0].yield, 0.0363, 0.001)
  assert.equal(out[0].date, '2026-01-02')
})

// ── T10 — Barra de rango (§6.5) ─────────────────────────────────────────────

test('T10 — la barra ordena las zonas y sitúa el marcador de hoy', () => {
  const bar = buildRangeBar({
    entrada: { conservador: { precioEntrada: 158.9 }, optimista: { precioEntrada: 161.2 }, precioActual: 268.04 },
    gordon: { exigente: { precioJusto: 139.36 }, flexible: { precioJusto: 276.04 } },
    multiplos: { precioImplicitoP25: 152.19, precioImplicitoMedia: 170.03 },
    weiss: { precioSobrevalorado: 240 },
  })

  assert.ok(bar, 'la barra se construye')
  // Zona buena a la izquierda: escala ascendente en precio.
  assert.ok(bar.minEscala < bar.maxEscala)
  closeTo(bar.minEscala, 139.36 * 0.95, 0.5, 'min = mín(entrada, Gordon exigente) × 0,95')
  closeTo(bar.maxEscala, 268.04 * 1.05, 0.5, 'max = máx(hoy, Weiss venta) × 1,05')

  const tipos = bar.zonas.map((z) => z.tipo)
  assert.deepEqual(tipos, ['compra', 'flexible', 'intermedia', 'sobrevaloracion'])
  // Las zonas van en orden y no se solapan.
  for (let i = 1; i < bar.zonas.length; i++) {
    assert.ok(bar.zonas[i].from >= bar.zonas[i - 1].to - 1e-9, 'zonas ordenadas')
  }

  const hoy = bar.marcadores.find((m) => m.id === 'actual')
  assert.ok(hoy.principal, 'el marcador de hoy es el elemento grande')
  const sobrevaloracion = bar.zonas.find((z) => z.tipo === 'sobrevaloracion')
  assert.ok(hoy.pos >= sobrevaloracion.from, 'hoy (268) cae en sobrevaloración (>240)')

  assert.ok(bar.segmentos.find((sg) => sg.id === 'gordon'))
  assert.ok(bar.segmentos.find((sg) => sg.id === 'multiplos'))
})

test('T10b — un segmento fuera de escala se recorta y se marca', () => {
  const bar = buildRangeBar({
    entrada: { conservador: { precioEntrada: 100 }, optimista: { precioEntrada: 105 }, precioActual: 120 },
    gordon: { exigente: { precioJusto: 98 }, flexible: { precioJusto: 900 } },
    multiplos: {},
    weiss: { precioSobrevalorado: 130 },
  })
  const g = bar.segmentos.find((sg) => sg.id === 'gordon')
  assert.equal(g.recortado, true, 'la horquilla de 900 sale de escala')
  assert.ok(g.to <= 100, 'se recorta al borde en vez de deformar la escala')
})

test('T10c — sin múltiplos se omite su segmento; sin datos no hay barra', () => {
  const bar = buildRangeBar({
    entrada: { conservador: { precioEntrada: 100 }, optimista: { precioEntrada: 100 }, precioActual: 120 },
    gordon: { exigente: { precioJusto: 90 }, flexible: { precioJusto: 150 } },
    multiplos: {},
    weiss: { precioSobrevalorado: 130 },
  })
  assert.ok(!bar.segmentos.find((sg) => sg.id === 'multiplos'))
  assert.equal(buildRangeBar({}), null, 'en NO_VALORABLE no se renderiza')
})
