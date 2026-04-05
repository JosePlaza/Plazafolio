import { supabase } from '@/lib/supabase'

// ── localStorage helpers (offline fallback) ─────────────────────────────────
const ASSETS_KEY = 'plazafolio-assets'

function readLocal() {
  try {
    const raw = localStorage.getItem(ASSETS_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return { actives: [], watchlist: [] }
}

function writeLocal(data) {
  try { localStorage.setItem(ASSETS_KEY, JSON.stringify(data)) } catch { /* full */ }
}

// ── Supabase → localStorage sync ────────────────────────────────────────────

async function getUserId() {
  const { data: { user } } = await supabase.auth.getUser()
  return user?.id
}

/** Pull all assets from Supabase into localStorage */
export async function syncFromSupabase() {
  const userId = await getUserId()
  if (!userId) return readLocal()

  try {
    const { data, error } = await supabase
      .from('assets')
      .select('*')
      .eq('user_id', userId)
      .order('sort_order', { ascending: true })

    if (error) throw error

    const actives = (data || []).filter(a => a.category === 'actives').map(mapAsset)
    const watchlist = (data || []).filter(a => a.category === 'watchlist').map(mapAsset)
    const result = { actives, watchlist }
    writeLocal(result)
    return result
  } catch (err) {
    console.warn('Supabase sync failed, using localStorage:', err.message)
    return readLocal()
  }
}

function mapAsset(row) {
  return {
    id: row.id,
    ticker: row.ticker,
    name: row.name,
    category: row.category,
    price: Number(row.price) || 0,
    image: row.image,
    shares: Number(row.shares) || 0,
    entryPrice: Number(row.entry_price ?? row.entryPrice) || 0,
  }
}

// ── CRUD (Supabase-first, localStorage fallback) ────────────────────────────

export async function getAssets() {
  return syncFromSupabase()
}

export async function addAsset(asset) {
  const db = readLocal()
  const tickerUp = asset.ticker.toUpperCase()

  // Prevent duplicates
  const exists = [...db.actives, ...db.watchlist].some(a => a.ticker === tickerUp)
  if (exists) return null

  const userId = await getUserId()

  try {
    const { data, error } = await supabase
      .from('assets')
      .insert({
        user_id: userId,
        ticker: tickerUp,
        name: asset.name || tickerUp,
        category: asset.category,
        price: asset.price || 0,
        image: asset.image || null,
        sort_order: asset.category === 'actives' ? db.actives.length : db.watchlist.length,
        shares: 0,
        entry_price: 0,
      })
      .select()
      .single()

    if (error) throw error

    const newAsset = mapAsset(data)
    if (newAsset.category === 'actives') db.actives.push(newAsset)
    else db.watchlist.push(newAsset)
    writeLocal(db)
    return newAsset
  } catch (err) {
    console.warn('Supabase addAsset failed, saving locally:', err.message)
    // Fallback to local
    const id = Date.now().toString(36) + Math.random().toString(36).substr(2, 5)
    const newAsset = {
      id, ticker: tickerUp, name: asset.name || tickerUp,
      category: asset.category, price: asset.price || 0, image: asset.image || null,
      shares: 0, entryPrice: 0,
    }
    if (asset.category === 'actives') db.actives.push(newAsset)
    else db.watchlist.push(newAsset)
    writeLocal(db)
    return newAsset
  }
}

export async function updateAsset(id, updates) {
  const db = readLocal()
  let asset = null
  let sourceCat = null

  for (const cat of ['actives', 'watchlist']) {
    const idx = db[cat].findIndex(a => a.id === id)
    if (idx !== -1) {
      asset = db[cat].splice(idx, 1)[0]
      sourceCat = cat
      break
    }
  }
  if (!asset) return null

  if (updates.price !== undefined) asset.price = updates.price
  if (updates.name !== undefined) asset.name = updates.name
  if (updates.image !== undefined) asset.image = updates.image
  if (updates.category) asset.category = updates.category
  if (updates.shares !== undefined) asset.shares = updates.shares
  if (updates.entryPrice !== undefined) asset.entryPrice = updates.entryPrice

  const targetCat = updates.category || asset.category
  if (targetCat === 'actives') db.actives.push(asset)
  else db.watchlist.push(asset)
  writeLocal(db)

  // Sync to Supabase
  try {
    const updateData = {}
    if (updates.price !== undefined) updateData.price = updates.price
    if (updates.name !== undefined) updateData.name = updates.name
    if (updates.image !== undefined) updateData.image = updates.image
    if (updates.category) updateData.category = updates.category
    if (updates.shares !== undefined) updateData.shares = updates.shares
    if (updates.entryPrice !== undefined) updateData.entry_price = updates.entryPrice

    await supabase.from('assets').update(updateData).eq('id', id)
  } catch { /* offline */ }

  return asset
}

export async function reorderAssets(actives, watchlist) {
  const db = { actives, watchlist }
  writeLocal(db)

  // Sync sort_order to Supabase
  try {
    const updates = [
      ...actives.map((a, i) => supabase.from('assets').update({ sort_order: i, category: 'actives' }).eq('id', a.id)),
      ...watchlist.map((a, i) => supabase.from('assets').update({ sort_order: i, category: 'watchlist' }).eq('id', a.id)),
    ]
    await Promise.all(updates)
  } catch { /* offline */ }

  return db
}

export async function deleteAsset(id) {
  const db = readLocal()
  db.actives = db.actives.filter(a => a.id !== id)
  db.watchlist = db.watchlist.filter(a => a.id !== id)
  writeLocal(db)

  try {
    await supabase.from('assets').delete().eq('id', id)
  } catch { /* offline */ }

  return { ok: true }
}

// ── Analysis cache (Supabase + localStorage) ────────────────────────────────
const ANALYSIS_KEY = 'plazafolio-analysis'

function readAnalysisLocal() {
  try {
    const raw = localStorage.getItem(ANALYSIS_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return {}
}

function writeAnalysisLocal(data) {
  try { localStorage.setItem(ANALYSIS_KEY, JSON.stringify(data)) } catch { /* full */ }
}

export async function getCachedAnalysis(ticker) {
  const key = ticker.toUpperCase()

  // Try Supabase first
  const userId = await getUserId()
  if (userId) {
    try {
      const { data, error } = await supabase
        .from('analyses')
        .select('*')
        .eq('user_id', userId)
        .eq('ticker', key)
        .single()

      if (!error && data) {
        const result = {
          ticker: data.ticker,
          years: data.years,
          lastUpdated: data.last_updated,
          data: {
            indicators: data.indicators,
            projection: data.projection,
            dividends: data.dividends,
            cashFlow: data.cash_flow || null,
            fundamentals: data.fundamentals || null,
          },
          profile: data.profile,
        }
        // Update local cache
        const local = readAnalysisLocal()
        local[key] = result
        writeAnalysisLocal(local)
        return result
      }
    } catch { /* offline, fall through to localStorage */ }
  }

  // Fallback to localStorage
  const local = readAnalysisLocal()
  return local[key] || null
}

export async function getAllCachedAnalyses() {
  const userId = await getUserId()

  if (userId) {
    try {
      const { data, error } = await supabase
        .from('analyses')
        .select('*')
        .eq('user_id', userId)

      if (!error && data) {
        const result = {}
        data.forEach(row => {
          result[row.ticker] = {
            ticker: row.ticker,
            years: row.years,
            lastUpdated: row.last_updated,
            data: {
              indicators: row.indicators,
              projection: row.projection,
              dividends: row.dividends,
              cashFlow: row.cash_flow || null,
              fundamentals: row.fundamentals || null,
            },
            profile: row.profile,
          }
        })
        writeAnalysisLocal(result)
        return result
      }
    } catch { /* offline */ }
  }

  return readAnalysisLocal()
}

export async function saveCachedAnalysis(ticker, years, analysisData, profile) {
  const key = ticker.toUpperCase()
  const today = new Date().toISOString().split('T')[0]

  // Save to localStorage
  const local = readAnalysisLocal()
  local[key] = {
    ticker: key,
    years,
    lastUpdated: today,
    data: analysisData,
    profile,
  }
  writeAnalysisLocal(local)

  // Save to Supabase
  const userId = await getUserId()
  if (userId) {
    try {
      await supabase.from('analyses').upsert({
        user_id: userId,
        ticker: key,
        years,
        last_updated: today,
        indicators: analysisData.indicators || null,
        projection: analysisData.projection || null,
        dividends: analysisData.dividends || null,
        cash_flow: analysisData.cashFlow || null,
        fundamentals: analysisData.fundamentals || null,
        profile: profile || null,
      }, { onConflict: 'user_id,ticker' })
    } catch (err) {
      console.warn('Supabase saveCachedAnalysis failed:', err.message)
    }
  }

  return { ok: true }
}
