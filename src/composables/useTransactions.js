import { ref, computed } from 'vue'
import {
  getTransactions,
  addTransaction as apiAddTransaction,
  deleteTransaction as apiDeleteTransaction,
  updateTransaction as apiUpdateTransaction,
  derivePosition,
} from '@/services/transactionsApi'
import { useCurrency } from './useCurrency'

// Module-level shared state
const transactions = ref([])
const loaded = ref(false)

export function useTransactions() {
  const { eurUsdRate, nativeCurrencyOf } = useCurrency()

  async function load() {
    if (loaded.value) return
    try {
      transactions.value = await getTransactions()
      loaded.value = true
    } catch (err) {
      console.error('Error loading transactions:', err)
    }
  }

  async function reload() {
    try {
      transactions.value = await getTransactions()
    } catch (err) {
      console.error('Error reloading transactions:', err)
    }
  }

  /** Get transactions for a specific asset */
  function transactionsForAsset(assetId) {
    return computed(() =>
      transactions.value
        .filter(tx => tx.assetId === assetId)
        .sort((a, b) => b.date.localeCompare(a.date)) // newest first for display
    )
  }

  /** Get derived position (shares + weighted avg entry price) for an asset */
  function positionForAsset(assetId, ticker) {
    return computed(() => {
      const txs = transactions.value.filter(tx => tx.assetId === assetId)
      if (!txs.length) return { shares: 0, entryPrice: 0, totalCost: 0 }
      const nativeCur = ticker ? nativeCurrencyOf(ticker) : null
      return derivePosition(txs, nativeCur, eurUsdRate.value)
    })
  }

  /** Add a new transaction and return it */
  async function addTransaction(tx) {
    const newTx = await apiAddTransaction(tx)
    if (newTx) {
      transactions.value = [...transactions.value, newTx]
    }
    return newTx
  }

  /** Delete a transaction */
  async function removeTransaction(id) {
    await apiDeleteTransaction(id)
    transactions.value = transactions.value.filter(tx => tx.id !== id)
  }

  /** Update a transaction */
  async function editTransaction(id, updates) {
    const updated = await apiUpdateTransaction(id, updates)
    if (updated) {
      const idx = transactions.value.findIndex(tx => tx.id === id)
      if (idx !== -1) {
        transactions.value = [
          ...transactions.value.slice(0, idx),
          { ...transactions.value[idx], ...updates },
          ...transactions.value.slice(idx + 1),
        ]
      }
    }
    return updated
  }

  return {
    transactions,
    loaded,
    load,
    reload,
    transactionsForAsset,
    positionForAsset,
    addTransaction,
    removeTransaction,
    editTransaction,
  }
}
