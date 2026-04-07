/**
 * Frontend service for Portfolio Income Simulator (Optimal Mix).
 */

/**
 * Run optimal-mix simulation on the server.
 *
 * @param {Object} params
 * @param {number} params.amount       - Investment amount
 * @param {number} params.years        - Projection horizon (1-10)
 * @param {Array}  params.candidates   - [{ticker, name, currentPrice}]
 * @param {string} [geminiApiKey]
 * @returns {Promise<Object>} { assets, allocation, allocationTotals, amount, years, recommendation? }
 */
export async function runSimulation({ amount, years, candidates }, geminiApiKey = '') {
  const headers = { 'Content-Type': 'application/json' }
  if (geminiApiKey) headers['x-gemini-key'] = geminiApiKey

  let res
  try {
    res = await fetch('/api/income-simulator', {
      method: 'POST',
      headers,
      body: JSON.stringify({ amount, years, candidates }),
    })
  } catch (networkErr) {
    throw new Error('No se pudo conectar al servidor. ¿Está ejecutándose server.js en el puerto 3001?')
  }

  if (!res.ok && res.status !== 200) {
    let msg = `Error del servidor (${res.status})`
    try {
      const errData = await res.json()
      if (errData.error) msg = errData.error
    } catch { /* ignore */ }
    throw new Error(msg)
  }

  const data = await res.json()
  if (data.error && (!data.assets || data.assets.length === 0)) {
    throw new Error(data.error)
  }
  return data
}
