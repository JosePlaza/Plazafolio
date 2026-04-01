import axios from 'axios'

const api = axios.create({ baseURL: '/api' })

export async function getAssets() {
  const { data } = await api.get('/assets')
  return data
}

export async function addAsset(asset) {
  const { data } = await api.post('/assets', asset)
  return data
}

export async function updateAsset(id, updates) {
  const { data } = await api.put(`/assets/${id}`, updates)
  return data
}

export async function reorderAssets(actives, watchlist) {
  const { data } = await api.put('/assets-reorder', { actives, watchlist })
  return data
}

export async function deleteAsset(id) {
  const { data } = await api.delete(`/assets/${id}`)
  return data
}

// ─── Analysis cache ─────────────────────────────────────────────────────────

export async function getCachedAnalysis(ticker) {
  const { data } = await api.get(`/analysis/${encodeURIComponent(ticker)}`)
  return data
}

export async function getAllCachedAnalyses() {
  const { data } = await api.get('/analysis')
  return data
}

export async function saveCachedAnalysis(ticker, years, analysisData, profile) {
  const { data } = await api.post(`/analysis/${encodeURIComponent(ticker)}`, {
    years,
    data: analysisData,
    profile,
  })
  return data
}
