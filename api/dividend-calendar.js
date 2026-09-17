import YahooFinance from 'yahoo-finance2'

const yf = new YahooFinance({ suppressNotices: ['ripHistorical', 'yahooSurvey'] })

const CONCURRENCY = 6
const MAX_SYMBOLS = 100

function toISODate(value) {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().split('T')[0]
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++
      out[i] = await fn(items[i])
    }
  })
  await Promise.all(workers)
  return out
}

/**
 * Fecha de PAGO del próximo dividendo por símbolo.
 *
 * `calendarEvents.dividendDate` es la fecha de pago real que publica Yahoo, no
 * la ex-dividendo. Es el único campo de pago que expone: da el próximo pago,
 * nunca el histórico. Además va con retraso en algunos valores (devuelve el
 * último pago ya realizado hasta que se declara el siguiente) y no cubre el
 * mercado continuo español. Por eso devolvemos la fecha en crudo junto a
 * `isUpcoming`, y que el cliente decida: aquí no se estima ninguna fecha.
 */
export default async function handler(req, res) {
  try {
    const { symbols } = req.query
    if (!symbols) return res.status(400).json({ error: 'Falta el parámetro symbols' })

    const list = [...new Set(
      String(symbols).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean),
    )].slice(0, MAX_SYMBOLS)

    if (!list.length) return res.json([])

    const todayISO = new Date().toISOString().split('T')[0]

    const results = await mapLimit(list, CONCURRENCY, async (symbol) => {
      try {
        const r = await yf.quoteSummary(symbol, {
          modules: ['calendarEvents', 'summaryDetail'],
        })
        const paymentDate = toISODate(r?.calendarEvents?.dividendDate)
        return {
          symbol,
          paymentDate,
          isUpcoming: paymentDate ? paymentDate >= todayISO : false,
          exDividendDate: toISODate(
            r?.calendarEvents?.exDividendDate ?? r?.summaryDetail?.exDividendDate,
          ),
          annualRate: r?.summaryDetail?.dividendRate ?? null,
        }
      } catch (err) {
        return {
          symbol,
          paymentDate: null,
          isUpcoming: false,
          exDividendDate: null,
          annualRate: null,
          error: err.message,
        }
      }
    })

    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400')
    res.json(results)
  } catch (err) {
    console.error('Error /api/dividend-calendar:', err.message)
    res.status(500).json({ error: err.message })
  }
}
