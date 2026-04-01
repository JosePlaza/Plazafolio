// Assets & analysis persistence via localStorage (Vercel-compatible, no backend needed)

const ASSETS_KEY = 'plazafolio-assets'
const ANALYSIS_KEY = 'plazafolio-analysis'

function readAssets() {
  try {
    const raw = localStorage.getItem(ASSETS_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return { actives: [], watchlist: [] }
}

function writeAssets(data) {
  localStorage.setItem(ASSETS_KEY, JSON.stringify(data))
}

function readAnalysis() {
  try {
    const raw = localStorage.getItem(ANALYSIS_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return {}
}

function writeAnalysis(data) {
  localStorage.setItem(ANALYSIS_KEY, JSON.stringify(data))
}

// ─── Assets CRUD ────────────────────────────────────────────────────────────

export async function getAssets() {
  return readAssets()
}

export async function addAsset(asset) {
  const db = readAssets()
  const id = Date.now().toString(36) + Math.random().toString(36).substr(2, 5)
  const newAsset = {
    id,
    ticker: asset.ticker.toUpperCase(),
    name: asset.name || asset.ticker.toUpperCase(),
    category: asset.category,
    price: asset.price || 0,
    image: asset.image || null,
  }

  if (asset.category === 'actives') db.actives.push(newAsset)
  else db.watchlist.push(newAsset)

  writeAssets(db)
  return newAsset
}

export async function updateAsset(id, updates) {
  const db = readAssets()
  let asset = null

  for (const cat of ['actives', 'watchlist']) {
    const idx = db[cat].findIndex((a) => a.id === id)
    if (idx !== -1) {
      asset = db[cat].splice(idx, 1)[0]
      break
    }
  }

  if (!asset) return null

  if (updates.price !== undefined) asset.price = updates.price
  if (updates.name !== undefined) asset.name = updates.name
  if (updates.image !== undefined) asset.image = updates.image
  if (updates.category) asset.category = updates.category

  const targetCat = updates.category || asset.category
  if (targetCat === 'actives') db.actives.push(asset)
  else db.watchlist.push(asset)

  writeAssets(db)
  return asset
}

export async function reorderAssets(actives, watchlist) {
  const db = readAssets()
  if (actives) db.actives = actives
  if (watchlist) db.watchlist = watchlist
  writeAssets(db)
  return db
}

export async function deleteAsset(id) {
  const db = readAssets()
  db.actives = db.actives.filter((a) => a.id !== id)
  db.watchlist = db.watchlist.filter((a) => a.id !== id)
  writeAssets(db)
  return { ok: true }
}

// ─── Analysis cache ─────────────────────────────────────────────────────────

export async function getCachedAnalysis(ticker) {
  const db = readAnalysis()
  return db[ticker.toUpperCase()] || null
}

export async function getAllCachedAnalyses() {
  return readAnalysis()
}

export async function saveCachedAnalysis(ticker, years, analysisData, profile) {
  const db = readAnalysis()
  const key = ticker.toUpperCase()
  db[key] = {
    ticker: key,
    years,
    lastUpdated: new Date().toISOString().split('T')[0],
    data: analysisData,
    profile,
  }
  writeAnalysis(db)
  return { ok: true }
}
