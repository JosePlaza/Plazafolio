import { ref, computed } from 'vue'
import {
  getAssets,
  addAsset as apiAddAsset,
  updateAsset as apiUpdateAsset,
  reorderAssets as apiReorderAssets,
  deleteAsset as apiDeleteAsset,
} from '@/services/assetsApi'

const actives = ref([])
const watchlist = ref([])
const loaded = ref(false)

export function useAssets() {
  async function load() {
    if (loaded.value) return
    try {
      const data = await getAssets()
      actives.value = data.actives || []
      watchlist.value = data.watchlist || []
      loaded.value = true
    } catch (err) {
      console.error('Error loading assets:', err)
    }
  }

  async function addAsset(ticker, name, category, price, image) {
    try {
      const asset = await apiAddAsset({ ticker, name, category, price, image })
      if (category === 'actives') actives.value.push(asset)
      else watchlist.value.push(asset)
      return asset
    } catch (err) {
      console.error('Error adding asset:', err)
    }
  }

  async function moveAsset(assetId, toCategory) {
    try {
      const asset = await apiUpdateAsset(assetId, { category: toCategory })
      // Remove from both lists
      actives.value = actives.value.filter((a) => a.id !== assetId)
      watchlist.value = watchlist.value.filter((a) => a.id !== assetId)
      // Add to target
      if (toCategory === 'actives') actives.value.push(asset)
      else watchlist.value.push(asset)
    } catch (err) {
      console.error('Error moving asset:', err)
    }
  }

  async function removeAsset(assetId) {
    try {
      await apiDeleteAsset(assetId)
      actives.value = actives.value.filter((a) => a.id !== assetId)
      watchlist.value = watchlist.value.filter((a) => a.id !== assetId)
    } catch (err) {
      console.error('Error removing asset:', err)
    }
  }

  async function reorder(newActives, newWatchlist) {
    actives.value = newActives
    watchlist.value = newWatchlist
    try {
      await apiReorderAssets(newActives, newWatchlist)
    } catch (err) {
      console.error('Error reordering assets:', err)
    }
  }

  async function updatePrice(assetId, price) {
    const asset =
      actives.value.find((a) => a.id === assetId) ||
      watchlist.value.find((a) => a.id === assetId)
    if (asset) asset.price = price
    try {
      await apiUpdateAsset(assetId, { price, category: asset?.category })
    } catch { /* silent */ }
  }

  const allAssets = computed(() => [...actives.value, ...watchlist.value])

  return {
    actives,
    watchlist,
    allAssets,
    loaded,
    load,
    addAsset,
    moveAsset,
    removeAsset,
    reorder,
    updatePrice,
  }
}
