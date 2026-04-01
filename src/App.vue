<script setup>
import { ref, computed, onMounted } from 'vue'
import { useGeraldine } from '@/composables/useGeraldine'
import { useAssets } from '@/composables/useAssets'
import { getCompanyProfile } from '@/services/fmpApi'
import AppHeader from '@/components/AppHeader.vue'
import AppSidebar from '@/components/AppSidebar.vue'
import AddAssetModal from '@/components/AddAssetModal.vue'
import SkeletonLoader from '@/components/SkeletonLoader.vue'
import IndicatorsPanel from '@/components/IndicatorsPanel.vue'
// DataBadge replaced by Highcharts subtitles — freshness shown under each chart title
import GeraldineChart from '@/components/charts/GeraldineChart.vue'
import YieldsChart from '@/components/charts/YieldsChart.vue'
import DividendsChart from '@/components/charts/DividendsChart.vue'
import ProjectionChart from '@/components/charts/ProjectionChart.vue'
import DrawdownChart from '@/components/charts/DrawdownChart.vue'
import SustainabilityChart from '@/components/charts/SustainabilityChart.vue'
import DividendHistoryChart from '@/components/charts/DividendHistoryChart.vue'
import RevenueChart from '@/components/charts/RevenueChart.vue'
import MarginsChart from '@/components/charts/MarginsChart.vue'
import EvFcfChart from '@/components/charts/EvFcfChart.vue'
import EvEbitdaChart from '@/components/charts/EvEbitdaChart.vue'
import DebtChart from '@/components/charts/DebtChart.vue'
import SharesChart from '@/components/charts/SharesChart.vue'
import RankingView from '@/components/RankingView.vue'

const { loading, refreshing, error, ticker, data, hasData, currency, generate } = useGeraldine()
const { actives, watchlist, load: loadAssets, addAsset, moveAsset, removeAsset } = useAssets()

const activeTab = ref('analysis')
const sidebarOpen = ref(false)
const showAddModal = ref(false)
const selectedAssetId = ref(null)
const companyName = ref('')
const companyLogo = ref(null)
const years = ref(12)

const periodOptions = [
  { label: '8y', value: 8 },
  { label: '10y', value: 10 },
  { label: '12y (GW)', value: 12 },
  { label: '15y', value: 15 },
]

// ── Data freshness labels (shown as Highcharts subtitles) ────────────────
function fmtFreshDate(raw) {
  if (!raw) return ''
  if (/^\d{4}$/.test(raw)) return raw
  const months = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']
  const p = raw.split('-')
  if (p.length >= 3) return `${parseInt(p[2])} ${months[parseInt(p[1]) - 1]} ${p[0]}`
  return raw
}
function freshLabel(date, source) {
  const d = fmtFreshDate(date)
  return d ? `${source} · ${d}` : ''
}

const freshLabels = computed(() => {
  const lastPrice = data.priceBands?.length ? data.priceBands[data.priceBands.length - 1]?.date?.substring(0, 10) : ''
  const lastDiv = data.dividends?.length ? data.dividends[data.dividends.length - 1]?.date?.substring(0, 10) : ''
  const lastCf = data.cashFlow?.length ? String(data.cashFlow[data.cashFlow.length - 1]?.year || '') : ''
  const lastFund = data.fundamentals?.income?.length
    ? data.fundamentals.income[data.fundamentals.income.length - 1]?.date?.substring(0, 10) : ''
  return {
    price: freshLabel(lastPrice, 'Cotización'),
    dividend: freshLabel(lastDiv, 'Ex-dividendo'),
    cashFlow: freshLabel(lastCf, 'FMP'),
    fundamentals: freshLabel(lastFund, 'Resultados'),
  }
})

onMounted(() => {
  loadAssets()
})

async function onGenerate(t, periodYears) {
  const resolvedYears = periodYears || years.value
  companyName.value = t
  companyLogo.value = null
  await generate(t, resolvedYears)
  if (data.profile?.companyName) companyName.value = data.profile.companyName
  if (data.profile?.image) companyLogo.value = data.profile.image
  // Update price in sidebar
  const currentPrice = data.indicators?.currentPrice
  if (currentPrice) {
    const all = [...actives.value, ...watchlist.value]
    const match = all.find((a) => a.ticker === t.toUpperCase())
    if (match) match.price = currentPrice
  }
}

function onPeriodChange() {
  if (ticker.value) {
    onGenerate(ticker.value, years.value)
  }
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

function onRemoveAsset(assetId) {
  removeAsset(assetId)
  if (selectedAssetId.value === assetId) selectedAssetId.value = null
}

function onRankingSelect(asset) {
  activeTab.value = 'analysis'
  selectedAssetId.value = asset.id
  companyLogo.value = asset.image
  onGenerate(asset.ticker, years.value)
}
</script>

<template>
  <div class="h-screen flex flex-col relative">
    <!-- Background blobs -->
    <div class="bg-blobs">
      <div class="bg-blob-3" />
    </div>

    <!-- Header -->
    <AppHeader :active-tab="activeTab" :sidebar-open="sidebarOpen" @update:active-tab="activeTab = $event" @toggle-sidebar="sidebarOpen = !sidebarOpen" />

    <!-- ═══ Views with fade transition ═══ -->
    <Transition name="view-fade" mode="out-in">
    <!-- ═══ Analysis view ═══ -->
    <div v-if="activeTab === 'analysis'" key="analysis" class="flex flex-1 pt-14 relative z-10">
      <!-- Content -->
      <main class="dot-pattern flex-1 lg:mr-72 overflow-y-auto p-3 sm:p-5 space-y-4" style="max-height: calc(100vh - 56px)">
        <!-- Skeleton loading -->
        <SkeletonLoader v-if="loading" />

        <!-- Error -->
        <div v-if="error && !loading" class="glass-card p-4" style="border-color: rgba(239, 68, 68, 0.2);">
          <p class="text-destructive text-sm">{{ error }}</p>
        </div>

        <!-- Empty state -->
        <div v-if="!hasData && !loading && !error" class="flex flex-col items-center justify-center py-32">
          <div class="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#415BFF" stroke-width="1.5" stroke-linecap="round">
              <path d="M3 3v18h18" />
              <path d="m7 14 4-4 4 4 5-5" />
            </svg>
          </div>
          <p class="text-muted-foreground text-sm mb-1">Selecciona un activo del sidebar para analizar</p>
          <p class="text-muted-foreground/50 text-xs">O añade uno nuevo con el botón +</p>
        </div>

        <!-- Results -->
        <template v-if="hasData && !loading">
          <!-- Title row: Logo + Name + Period selector -->
          <div class="flex flex-wrap items-center gap-3 sm:gap-4">
            <div
              v-if="companyLogo"
              class="w-9 h-9 sm:w-11 sm:h-11 rounded-xl overflow-hidden flex-shrink-0 bg-white/5 p-1"
            >
              <img :src="companyLogo" :alt="ticker" class="w-full h-full object-contain rounded-lg" />
            </div>
            <div
              v-else
              class="w-9 h-9 sm:w-11 sm:h-11 rounded-xl flex-shrink-0 bg-primary/10 flex items-center justify-center"
            >
              <span class="text-primary text-sm font-bold">{{ ticker?.slice(0, 2) }}</span>
            </div>

            <div class="flex-1 min-w-0">
              <h1 class="text-lg sm:text-xl font-bold text-foreground tracking-tight truncate leading-tight">
                {{ companyName || ticker }}
              </h1>
              <span class="text-muted-foreground text-xs">{{ ticker }}</span>
            </div>

            <div class="flex items-center gap-2">
              <span
                v-if="refreshing"
                class="text-[10px] text-primary/60 flex items-center gap-1.5"
              >
                <span class="w-1.5 h-1.5 rounded-full bg-primary/60 animate-pulse"></span>
                Actualizando...
              </span>
              <div class="hidden sm:flex items-center gap-1">
                <button
                  v-for="opt in periodOptions" :key="opt.value"
                  type="button"
                  class="period-tag"
                  :class="years === opt.value ? 'period-tag-active' : ''"
                  @click="years = opt.value; onPeriodChange()"
                >
                  {{ opt.label }}
                </button>
              </div>
            </div>
          </div>

          <!-- Row 1: KPIs (glass card) + Tesis chart -->
          <div class="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <div class="lg:col-span-4 glass-card p-4">
              <IndicatorsPanel :indicators="data.indicators" :projection="data.projection" :dividends="data.dividends" :currency="currency" />
              <div v-if="freshLabels.price" class="fresh-inline">{{ freshLabels.price }}</div>
            </div>
            <div class="lg:col-span-8 glass-card p-4">
              <GeraldineChart :price-bands="data.priceBands" :ticker="ticker" :currency="currency" :fresh-label="freshLabels.price" />
            </div>
          </div>

          <!-- Row 2: Yield + Pago de Dividendos -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="glass-card p-4">
              <YieldsChart
                :daily-yields="data.dailyYields"
                :avg-high-yield="data.indicators?.avgHighYield || 0"
                :avg-low-yield="data.indicators?.avgLowYield || 0"
                :avg-yield="data.indicators?.avgYield || 0"
                :ticker="ticker"
                :fresh-label="freshLabels.price"
              />
            </div>
            <div class="glass-card p-4">
              <DividendsChart :dividends="data.dividends" :ticker="ticker" :currency="currency" :fresh-label="freshLabels.dividend" />
            </div>
          </div>

          <!-- Row 3: Histórico Dividendos + Proyección -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="glass-card p-4">
              <DividendHistoryChart :dividends="data.dividends" :projection="data.projection" :ticker="ticker" :currency="currency" :fresh-label="freshLabels.dividend" />
            </div>
            <div class="glass-card p-4">
              <ProjectionChart :projection="data.projection" :indicators="data.indicators" :ticker="ticker" :currency="currency" :fresh-label="freshLabels.dividend" />
            </div>
          </div>

          <!-- Row 4: Sostenibilidad + Drawdown -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="glass-card p-4">
              <SustainabilityChart :cash-flow="data.cashFlow" :ticker="ticker" :currency="currency" :fresh-label="freshLabels.cashFlow" />
            </div>
            <div class="glass-card p-4">
              <DrawdownChart :drawdown="data.drawdown" :ticker="ticker" :currency="currency" :fresh-label="freshLabels.price" />
            </div>
          </div>

          <!-- Row 5: Ingresos + Márgenes -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="glass-card p-4">
              <RevenueChart :fundamentals="data.fundamentals" :currency="currency" :fresh-label="freshLabels.fundamentals" />
            </div>
            <div class="glass-card p-4">
              <MarginsChart :fundamentals="data.fundamentals" :fresh-label="freshLabels.fundamentals" />
            </div>
          </div>

          <!-- Row 6: EV/FCF + EV/EBITDA -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="glass-card p-4">
              <EvFcfChart :fundamentals="data.fundamentals" :currency="currency" :fresh-label="freshLabels.fundamentals" />
            </div>
            <div class="glass-card p-4">
              <EvEbitdaChart :fundamentals="data.fundamentals" :currency="currency" :fresh-label="freshLabels.fundamentals" />
            </div>
          </div>

          <!-- Row 7: Deuda + Acciones -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="glass-card p-4">
              <DebtChart :fundamentals="data.fundamentals" :currency="currency" :fresh-label="freshLabels.fundamentals" />
            </div>
            <div class="glass-card p-4">
              <SharesChart :fundamentals="data.fundamentals" :fresh-label="freshLabels.fundamentals" />
            </div>
          </div>
        </template>
      </main>

      <!-- Sidebar -->
      <AppSidebar
        :actives="actives"
        :watchlist="watchlist"
        :selected-id="selectedAssetId"
        :open="sidebarOpen"
        @select="onSelectAsset"
        @add="showAddModal = true"
        @move="onMoveAsset"
        @remove="onRemoveAsset"
        @close="sidebarOpen = false"
      />
    </div>

    <!-- ═══ Ranking view ═══ -->
    <div v-else-if="activeTab === 'ranking'" key="ranking" class="flex flex-1 pt-14 relative z-10">
      <main class="dot-pattern flex-1 overflow-y-auto p-3 sm:p-6" style="max-height: calc(100vh - 56px)">
        <RankingView
          :actives="actives"
          :watchlist="watchlist"
          :visible="activeTab === 'ranking'"
          @select-asset="onRankingSelect"
        />
      </main>
    </div>
    </Transition>

    <!-- Add Asset Modal -->
    <AddAssetModal
      v-if="showAddModal"
      @close="showAddModal = false"
      @add="onAddAsset"
    />
  </div>
</template>

<style scoped>
.fresh-inline {
  color: #71717a;
  font-size: 10px;
  font-weight: 400;
  padding-top: 8px;
}
</style>
