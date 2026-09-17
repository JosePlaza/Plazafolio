<script setup>
import { inject } from 'vue'
import { useRouter } from 'vue-router'
import AssetLibrary from '@/components/AssetLibrary.vue'

const app = inject('appState')
const router = useRouter()

// Seleccionar un activo lanza su análisis y salta a esa vista.
function onSelect(asset) {
  app.onSelectAsset(asset)
  router.push('/analysis')
}
</script>

<template>
  <main class="dot-pattern flex-1 overflow-y-auto p-3 sm:p-6 pb-navbar" style="max-height: calc(100dvh - 3.5rem - env(safe-area-inset-top, 0px))">
    <AssetLibrary
      :actives="app.actives.value"
      :watchlist="app.watchlist.value"
      :selected-id="app.selectedAssetId.value"
      @select="onSelect"
      @add="app.showAddModal.value = true"
      @move="app.onMoveAsset"
      @reorder="app.onReorderAssets"
      @remove="app.onRemoveAsset"
    />
  </main>
</template>
