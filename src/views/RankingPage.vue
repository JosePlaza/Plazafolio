<script setup>
import { inject } from 'vue'
import { useRouter } from 'vue-router'
import RankingView from '@/components/RankingView.vue'

const app = inject('appState')
const router = useRouter()

function onSelect(asset) {
  app.selectedAssetId.value = asset.id
  app.companyLogo.value = asset.image
  app.onGenerate(asset.ticker, app.years.value)
  router.push('/analysis')
}
</script>

<template>
  <main class="dot-pattern flex-1 overflow-y-auto p-3 sm:p-6" style="max-height: calc(100dvh - 3.5rem - env(safe-area-inset-top, 0px))">
    <RankingView
      :actives="app.actives.value"
      :watchlist="app.watchlist.value"
      :visible="true"
      @select-asset="onSelect"
    />
  </main>
</template>
