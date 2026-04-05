import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
})

/**
 * Obtener cotización histórica diaria de una acción (via Yahoo Finance)
 * @param {string} ticker
 * @param {string} from - 'YYYY-MM-DD'
 * @param {string} to - 'YYYY-MM-DD'
 * @returns {Promise<Array>} - [{date, open, high, low, close, volume}, ...]
 */
export async function getHistoricalPrices(ticker, from, to) {
  const { data } = await api.get('/prices', {
    params: { symbol: ticker, from, to },
  })
  return data || []
}

/**
 * Obtener historial de dividendos de una acción (via Yahoo Finance)
 * @param {string} ticker
 * @returns {Promise<Array>} - [{date, dividend, adjDividend}, ...]
 */
export async function getDividendHistory(ticker) {
  const { data } = await api.get('/dividends', {
    params: { symbol: ticker, from: '2000-01-01' },
  })
  return data || []
}

/**
 * Obtener perfil de la empresa (FMP con fallback a Yahoo)
 * FMP aporta: CEO, logo, beta, descripción, sector, industria, IPO date, empleados
 * @param {string} ticker
 * @returns {Promise<Object>}
 */
export async function getCompanyProfile(ticker) {
  const { data } = await api.get('/profile', {
    params: { symbol: ticker },
  })
  return data || null
}

/**
 * Obtener cash flow statements (FMP)
 * Para la card de sostenibilidad del dividendo
 * @param {string} ticker
 * @returns {Promise<Array>} - [{year, freeCashFlow, dividendsPaid, operatingCashFlow}, ...]
 */
export async function getCashFlowData(ticker) {
  const { data } = await api.get('/cashflow', {
    params: { symbol: ticker },
  })
  return data || []
}

/**
 * Obtener datos fundamentales históricos (Yahoo Finance)
 * Income statement, balance sheet, cash flow + Enterprise Value
 * @param {string} ticker
 * @returns {Promise<Object>} - { income, balance, cashFlow, enterpriseValue }
 */
export async function getFundamentalsData(ticker) {
  const { data } = await api.get('/fundamentals', {
    params: { symbol: ticker },
  })
  return data || { income: [], balance: [], cashFlow: [], enterpriseValue: null }
}

/**
 * Obtener informe SEC (comparativa de los 2 últimos 10-Q o 10-K)
 * Solo para acciones americanas
 * @param {string} ticker
 * @param {string} type - '10-Q' o '10-K'
 * @returns {Promise<Object|null>}
 */
export async function getSecReport(ticker, type = '10-Q') {
  const { data } = await api.get('/sec/report', {
    params: { ticker, type },
  })
  return data || null
}
