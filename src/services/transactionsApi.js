import { supabase } from '@/lib/supabase'

// ── localStorage helpers (offline fallback) ─────────────────────────────────
const TX_KEY = 'plazafolio-transactions'

function readLocal() {
  try {
    const raw = localStorage.getItem(TX_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return []
}

function writeLocal(data) {
  try { localStorage.setItem(TX_KEY, JSON.stringify(data)) } catch { /* full */ }
}

async function getUserId() {
  const { data: { user } } = await supabase.auth.getUser()
  return user?.id
}

// ── Sync from Supabase ─────────────────────────────────────────────────────

/** Pull all transactions from Supabase into localStorage */
export async function syncTransactions() {
  const userId = await getUserId()
  if (!userId) return readLocal()

  try {
    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('user_id', userId)
      .order('transaction_date', { ascending: true })

    if (error) throw error

    const txs = (data || []).map(mapTransaction)
    writeLocal(txs)
    return txs
  } catch (err) {
    console.warn('Supabase transactions sync failed, using localStorage:', err.message)
    return readLocal()
  }
}

function mapTransaction(row) {
  return {
    id: row.id,
    assetId: row.asset_id,
    ticker: row.ticker,
    date: row.transaction_date,
    shares: Number(row.shares) || 0,
    pricePerShare: Number(row.price_per_share) || 0,
    currency: row.currency || 'USD',
    note: row.note || '',
    createdAt: row.created_at,
  }
}

// ── CRUD ────────────────────────────────────────────────────────────────────

/** Get all transactions (Supabase-first, localStorage fallback) */
export async function getTransactions() {
  return syncTransactions()
}

/** Get transactions for a specific asset */
export async function getTransactionsByAsset(assetId) {
  const all = await getTransactions()
  return all.filter(tx => tx.assetId === assetId)
}

/** Add a new transaction */
export async function addTransaction(tx) {
  const userId = await getUserId()
  const local = readLocal()
  const id = tx.id || (Date.now().toString(36) + Math.random().toString(36).substr(2, 5))

  const newTx = {
    id,
    assetId: tx.assetId,
    ticker: tx.ticker?.toUpperCase() || '',
    date: tx.date || new Date().toISOString().split('T')[0],
    shares: Number(tx.shares) || 0,
    pricePerShare: Number(tx.pricePerShare) || 0,
    currency: tx.currency || 'USD',
    note: tx.note || '',
    createdAt: new Date().toISOString(),
  }

  if (userId) {
    try {
      const { data, error } = await supabase
        .from('transactions')
        .insert({
          user_id: userId,
          asset_id: newTx.assetId,
          ticker: newTx.ticker,
          transaction_date: newTx.date,
          shares: newTx.shares,
          price_per_share: newTx.pricePerShare,
          currency: newTx.currency,
          note: newTx.note,
        })
        .select()
        .single()

      if (error) throw error
      const mapped = mapTransaction(data)
      local.push(mapped)
      writeLocal(local)
      return mapped
    } catch (err) {
      console.warn('Supabase addTransaction failed, saving locally:', err.message)
    }
  }

  // Fallback to local-only
  local.push(newTx)
  writeLocal(local)
  return newTx
}

/** Delete a transaction */
export async function deleteTransaction(id) {
  const local = readLocal()
  const filtered = local.filter(tx => tx.id !== id)
  writeLocal(filtered)

  try {
    await supabase.from('transactions').delete().eq('id', id)
  } catch { /* offline */ }

  return { ok: true }
}

/** Update a transaction */
export async function updateTransaction(id, updates) {
  const local = readLocal()
  const idx = local.findIndex(tx => tx.id === id)
  if (idx === -1) return null

  if (updates.date !== undefined) local[idx].date = updates.date
  if (updates.shares !== undefined) local[idx].shares = Number(updates.shares)
  if (updates.pricePerShare !== undefined) local[idx].pricePerShare = Number(updates.pricePerShare)
  if (updates.currency !== undefined) local[idx].currency = updates.currency
  if (updates.note !== undefined) local[idx].note = updates.note

  writeLocal(local)

  try {
    const updateData = {}
    if (updates.date !== undefined) updateData.transaction_date = updates.date
    if (updates.shares !== undefined) updateData.shares = updates.shares
    if (updates.pricePerShare !== undefined) updateData.price_per_share = updates.pricePerShare
    if (updates.currency !== undefined) updateData.currency = updates.currency
    if (updates.note !== undefined) updateData.note = updates.note

    await supabase.from('transactions').update(updateData).eq('id', id)
  } catch { /* offline */ }

  return local[idx]
}

// ── Derive position from transactions ──────────────────────────────────────

/**
 * Calculate total shares and weighted average entry price from a list of transactions.
 * Buy txs (shares > 0) contribute to weighted average.
 * Sell txs (shares < 0) reduce shares but don't change avg entry price (FIFO-ish simplification).
 *
 * @param {Array} transactions - List of transaction objects
 * @param {string} nativeCurrency - Native currency of the ticker ('USD' or 'EUR')
 * @param {number} eurUsdRate - Current EUR/USD exchange rate (for normalizing cross-currency txs)
 */
export function derivePosition(transactions, nativeCurrency = null, eurUsdRate = 1.14) {
  let totalShares = 0
  let totalCost = 0

  // Detect native currency from ticker if not provided
  const native = nativeCurrency || (transactions[0]?.ticker?.includes('.') ? 'EUR' : 'USD')

  // Sort by date ascending
  const sorted = [...transactions].sort((a, b) => a.date.localeCompare(b.date))

  for (const tx of sorted) {
    // Normalize price to the ticker's native currency
    let price = tx.pricePerShare
    const txCur = (tx.currency || native).toUpperCase()
    if (txCur !== native) {
      if (txCur === 'EUR' && native === 'USD') price = price * eurUsdRate
      else if (txCur === 'USD' && native === 'EUR') price = price / eurUsdRate
    }

    if (tx.shares > 0) {
      // Buy: add to position
      totalCost += tx.shares * price
      totalShares += tx.shares
    } else {
      // Sell: reduce shares proportionally
      const sellShares = Math.abs(tx.shares)
      if (totalShares > 0) {
        const avgPrice = totalCost / totalShares
        const reducedShares = Math.min(sellShares, totalShares)
        totalCost -= reducedShares * avgPrice
        totalShares -= reducedShares
      }
    }
  }

  const avgEntryPrice = totalShares > 0 ? totalCost / totalShares : 0

  return {
    shares: Math.max(0, totalShares),
    entryPrice: avgEntryPrice,
    totalCost: Math.max(0, totalCost),
  }
}
