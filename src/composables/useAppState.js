/**
 * Shared app state — singleton composable for cross-view state.
 * Used via provide/inject from App.vue to child views.
 */
import { ref, computed } from 'vue'
import { useGeraldine } from '@/composables/useGeraldine'
import { useAssets } from '@/composables/useAssets'
import { getCompanyProfile } from '@/services/fmpApi'
import { getAllCachedAnalyses } from '@/services/assetsApi'

// Singleton refs — shared across all consumers
const sidebarOpen = ref(false)
const showAddModal = ref(false)
const selectedAssetId = ref(null)
const companyName = ref('')
const companyLogo = ref(null)
const years = ref(12)
const portfolioDetailAsset = ref(null)
const portfolioAnalyses = ref({})

let _initialized = false

export function useAppState() {
  const { loading, refreshing, error, ticker, data, hasData, currency, generate } = useGeraldine()
  const { actives, watchlist, load: loadAssets, addAsset, moveAsset, removeAsset, reorder, updateAssetPosition } = useAssets()

  async function onGenerate(t, periodYears) {
    const resolvedYears = periodYears || years.value
    companyName.value = t
    // Keep existing logo during loading — only clear if a new one arrives
    const prevLogo = companyLogo.value
    await generate(t, resolvedYears)
    if (data.profile?.companyName) companyName.value = data.profile.companyName
    if (data.profile?.image) companyLogo.value = data.profile.image
    else if (!prevLogo) companyLogo.value = null // only clear if there was no previous logo
    const currentPrice = data.indicators?.currentPrice
    if (currentPrice) {
      const all = [...actives.value, ...watchlist.value]
      const match = all.find((a) => a.ticker === t.toUpperCase())
      if (match) match.price = currentPrice
    }
  }

  function onPeriodChange() {
    if (ticker.value) onGenerate(ticker.value, years.value)
  }

  function onSelectAsset(asset) {
    selectedAssetId.value = asset.id
    companyLogo.value = asset.image
    onGenerate(asset.ticker, years.value)
  }

  async function onAddAsset({ ticker: t, category }) {
    showAddModal.value = false
    try {
      const profile = await getCompanyProfile(t)
      const name = profile?.companyName || t
      const price = profile?.price || 0
      const image = profile?.image || null
      await addAsset(t, name, category, price, image)
    } catch {
      await addAsset(t, t, category, 0, null)
    }
  }

  function onMoveAsset(assetId, toCategory) {
    moveAsset(assetId, toCategory)
  }

  function onReorderAssets(newActives, newWatchlist) {
    reorder(newActives, newWatchlist)
  }

  function onRemoveAsset(assetId) {
    removeAsset(assetId)
    if (selectedAssetId.value === assetId) selectedAssetId.value = null
  }

  async function onPortfolioSelect(item) {
    if (!portfolioAnalyses.value[item.ticker]) {
      const all = await getAllCachedAnalyses()
      portfolioAnalyses.value = all || {}
    }
    portfolioDetailAsset.value = item
  }

  function onPortfolioBack() {
    portfolioDetailAsset.value = null
  }

  async function onPortfolioSave({ id, shares, entryPrice }) {
    await updateAssetPosition(id, shares, entryPrice)
    if (portfolioDetailAsset.value?.id === id) {
      portfolioDetailAsset.value = { ...portfolioDetailAsset.value, shares, entryPrice }
    }
  }

  return {
    // Geraldine
    loading, refreshing, error, ticker, data, hasData, currency, generate,
    // Assets
    actives, watchlist, loadAssets,
    // UI state
    sidebarOpen, showAddModal, selectedAssetId, companyName, companyLogo, years,
    portfolioDetailAsset, portfolioAnalyses,
    // Actions
    onGenerate, onPeriodChange, onSelectAsset, onAddAsset,
    onMoveAsset, onReorderAssets, onRemoveAsset,
    onPortfolioSelect, onPortfolioBack, onPortfolioSave,
  }
}
