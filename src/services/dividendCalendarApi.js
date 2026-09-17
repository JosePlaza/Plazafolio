/**
 * Fechas de PAGO de dividendo (no ex-dividendo).
 *
 * Fuente: Yahoo `calendarEvents.dividendDate` vía /api/dividend-calendar. Es el
 * único campo de pago real disponible y solo cubre el PRÓXIMO pago de cada
 * valor. No hay histórico de fechas de pago, y el mercado continuo español no
 * está cubierto. Nunca estimamos una fecha: si no viene, el ticker se queda sin
 * confirmar y la vista lo muestra aparte.
 */

/**
 * @param {string[]} symbols
 * @returns {Promise<Record<string, { paymentDate: string|null, isUpcoming: boolean, exDividendDate: string|null, annualRate: number|null }>>}
 *   Indexado por símbolo en mayúsculas. Devuelve {} si la petición falla.
 */
export async function fetchDividendPaymentDates(symbols) {
  const list = [...new Set((symbols || []).map((s) => String(s).toUpperCase()))].filter(Boolean)
  if (!list.length) return {}

  try {
    const res = await fetch(`/api/dividend-calendar?symbols=${encodeURIComponent(list.join(','))}`)
    if (!res.ok) {
      console.warn('[dividend-calendar] HTTP', res.status)
      return {}
    }
    const rows = await res.json()
    if (!Array.isArray(rows)) return {}

    const bySymbol = {}
    for (const row of rows) {
      if (row?.symbol) bySymbol[row.symbol.toUpperCase()] = row
    }
    return bySymbol
  } catch (err) {
    console.warn('[dividend-calendar] failed:', err.message)
    return {}
  }
}
