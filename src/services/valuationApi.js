/**
 * Snapshot de mercado para el módulo de valoración (SPEC_01 §1.1).
 * Los múltiplos históricos NO vienen de aquí: se reconstruyen en el cliente a
 * partir de `data.fundamentals`, que la app ya descarga (§5.2).
 */

const CACHE_MS = 15 * 60 * 1000 // §7.11
const cache = new Map()

export async function fetchValuationSnapshot(ticker) {
  const key = String(ticker || '').toUpperCase()
  if (!key) return null

  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data

  try {
    const res = await fetch(`/api/valuation-snapshot?symbol=${encodeURIComponent(key)}`)
    if (!res.ok) {
      console.warn('[valuation-snapshot] HTTP', res.status)
      return null
    }
    const data = await res.json()
    if (data?.error) {
      console.warn('[valuation-snapshot]', data.error)
      return null
    }
    cache.set(key, { at: Date.now(), data })
    return data
  } catch (err) {
    console.warn('[valuation-snapshot] failed:', err.message)
    return null
  }
}
