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
          score: data.score ?? null,
          currentRank: data.current_rank ?? null,
          previousRank: data.previous_rank ?? null,
          rankUpdatedAt: data.rank_updated_at ?? null,
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
  const local = readAnalysisLocal()

  if (userId) {
    try {
      const { data, error } = await supabase
        .from('analyses')
        .select('*')
        .eq('user_id', userId)

      if (!error && data) {
        // Merge: start with local analyses, then overlay Supabase data (source of truth)
        const result = { ...local }
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
            score: row.score ?? null,
            currentRank: row.current_rank ?? null,
            previousRank: row.previous_rank ?? null,
            rankUpdatedAt: row.rank_updated_at ?? null,
          }
        })
        writeAnalysisLocal(result)
        return result
      }
    } catch { /* offline */ }
  }

  return local
}

export async function saveCachedAnalysis(ticker, years, analysisData, profile, score = null) {
  const key = ticker.toUpperCase()
  const today = new Date().toISOString().split('T')[0]

  // Save to localStorage
  const local = readAnalysisLocal()
  const prev = local[key]
  local[key] = {
    ticker: key,
    years,
    lastUpdated: today,
    data: analysisData,
    profile,
    score,
    // Conservar la foto del ranking: vive en Supabase, pero si la borramos del
    // cache local un arranque sin red (o el primer paint) pinta todo como "NEW".
    currentRank: prev?.currentRank ?? null,
    previousRank: prev?.previousRank ?? null,
    rankUpdatedAt: prev?.rankUpdatedAt ?? null,
  }
  writeAnalysisLocal(local)

  // Save to Supabase
  const userId = await getUserId()
  if (userId) {
    try {
      const row = {
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
      }
      if (score !== null) row.score = score
      const { error: upsertError } = await supabase.from('analyses').upsert(row, { onConflict: 'user_id,ticker' })
      if (upsertError) {
        console.warn('Supabase saveCachedAnalysis upsert error:', upsertError.message)
      }
    } catch (err) {
      console.warn('Supabase saveCachedAnalysis failed:', err.message)
    }
  }

  return { ok: true }
}

/**
 * Persiste el `score` calculado en vivo para un conjunto de tickers.
 * El ranking (RPC `snapshot_user_ranking`) ordena por la columna `score`; si
 * está a null el ranking sale alfabético por ticker y el delta nunca varía.
 * El frontend recalcula el score en cada carga, así que lo usamos como fuente
 * de verdad para mantener la columna poblada y coherente con lo que se muestra.
 *
 * @param {Array<{ticker: string, score: number}>} entries
 * @returns {Promise<{ ok: boolean, updated: number }>}
 */
export async function persistScores(entries) {
  if (!entries?.length) return { ok: false, updated: 0 }
  const userId = await getUserId()
  if (!userId) return { ok: false, updated: 0 }

  let updated = 0
  await Promise.all(entries.map(async ({ ticker, score }) => {
    if (score == null || Number.isNaN(score)) return
    const { error } = await supabase
      .from('analyses')
      .update({ score })
      .eq('user_id', userId)
      .eq('ticker', ticker)
    if (error) console.warn(`persistScores(${ticker}) failed:`, error.message)
    else updated++
  }))

  return { ok: true, updated }
}

/**
 * Recalcula el ranking del usuario en Supabase.
 *
 * La RPC es idempotente dentro del mismo día: refresca `current_rank` en cada
 * llamada, pero solo promueve `current_rank -> previous_rank` al cruzar día.
 * Por eso aquí ya NO hay guard en JS: el de antes era un read-then-write con
 * carrera (dos pestañas, bulk sync + recarga) y encima no cubría al cron de la
 * Edge Function, así que la foto del día anterior acababa machacada con la de
 * hoy y todos los deltas se quedaban en "=".
 *
 * @returns {Promise<{ ok: boolean, promoted?: boolean, ranked?: number, reason?: string }>}
 *   `promoted` indica si `previous_rank` ha cambiado (hay que releer analyses).
 */
export async function snapshotUserRanking() {
  const userId = await getUserId()
  if (!userId) return { ok: false, reason: 'no user' }
  try {
    const { data, error } = await supabase.rpc('snapshot_user_ranking', { uid: userId })
    if (error) {
      console.warn('snapshot_user_ranking failed:', error.message)
      return { ok: false, reason: error.message }
    }
    return { ok: true, promoted: !!data?.promoted, ranked: data?.ranked ?? 0 }
  } catch (err) {
    console.warn('snapshot_user_ranking exception:', err.message)
    return { ok: false, reason: err.message }
  }
}
