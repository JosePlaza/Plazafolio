<script setup>
import { inject, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PortfolioView from '@/components/PortfolioView.vue'
import PortfolioDetail from '@/components/PortfolioDetail.vue'

const app = inject('appState')
const route = useRoute()
const router = useRouter()

// If route has :ticker param, find and select the asset
watch(() => route.params.ticker, (ticker) => {
  if (ticker) {
    const all = [...app.actives.value, ...app.watchlist.value]
    const asset = all.find(a => a.ticker.toUpperCase() === ticker.toUpperCase())
    if (asset && (!app.portfolioDetailAsset.value || app.portfolioDetailAsset.value.ticker !== asset.ticker)) {
      app.onPortfolioSelect(asset)
    }
  } else {
    app.portfolioDetailAsset.value = null
  }
}, { immediate: true })

function onSelect(item) {
  app.onPortfolioSelect(item)
  router.push({ name: 'portfolio-detail', params: { ticker: item.ticker } })
}

function onBack() {
  app.onPortfolioBack()
  router.push({ name: 'portfolio' })
}
</script>

<template>
  <main class="dot-pattern flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-6 pb-navbar" style="max-height: calc(100dvh - 3.5rem - env(safe-area-inset-top, 0px))">
    <PortfolioDetail
      v-if="app.portfolioDetailAsset.value"
      :asset="app.portfolioDetailAsset.value"
      :indicators="app.portfolioAnalyses.value[app.portfolioDetailAsset.value.ticker]?.data?.indicators"
      :projection="app.portfolioAnalyses.value[app.portfolioDetailAsset.value.ticker]?.data?.projection"
      :dividends="app.portfolioAnalyses.value[app.portfolioDetailAsset.value.ticker]?.data?.dividends || []"
      :scoring="app.portfolioDetailAsset.value.scoring"
      @back="onBack"
      @save="app.onPortfolioSave"
    />
    <PortfolioView
      v-else
      :actives="app.actives.value"
      :watchlist="app.watchlist.value"
      :visible="true"
      @select-asset="onSelect"
    />
  </main>
</template>
