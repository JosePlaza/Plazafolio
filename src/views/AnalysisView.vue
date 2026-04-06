<script setup>
import { computed, inject } from 'vue'
import SkeletonLoader from '@/components/SkeletonLoader.vue'
import IndicatorsPanel from '@/components/IndicatorsPanel.vue'
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

const app = inject('appState')

const periodOptions = [
  { label: '8y', value: 8 },
  { label: '10y', value: 10 },
  { label: '12y (GW)', value: 12 },
  { label: '15y', value: 15 },
]

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
  const d = app.data
  const lastPrice = d.priceBands?.length ? d.priceBands[d.priceBands.length - 1]?.date?.substring(0, 10) : ''
  const lastDiv = d.dividends?.length ? d.dividends[d.dividends.length - 1]?.date?.substring(0, 10) : ''
  const lastCf = d.cashFlow?.length ? String(d.cashFlow[d.cashFlow.length - 1]?.year || '') : ''
  const lastFund = d.fundamentals?.income?.length
    ? d.fundamentals.income[d.fundamentals.income.length - 1]?.date?.substring(0, 10) : ''
  return {
    price: freshLabel(lastPrice, 'Cotización'),
    dividend: freshLabel(lastDiv, 'Ex-dividendo'),
    cashFlow: freshLabel(lastCf, 'FMP'),
    fundamentals: freshLabel(lastFund, 'Resultados'),
  }
})
</script>

<template>
  <main class="dot-pattern flex-1 lg:mr-72 overflow-y-auto p-3 sm:p-5 space-y-4 pb-navbar" style="max-height: calc(100dvh - 3.5rem - env(safe-area-inset-top, 0px))">
    <SkeletonLoader v-if="app.loading.value" />

    <div v-if="app.error.value && !app.loading.value" class="glass-card p-4" style="border-color: rgba(239, 68, 68, 0.2);">
      <p class="text-destructive text-sm">{{ app.error.value }}</p>
    </div>

    <div v-if="!app.hasData.value && !app.loading.value && !app.error.value" class="flex flex-col items-center justify-center py-32">
      <div class="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#415BFF" stroke-width="1.5" stroke-linecap="round">
          <path d="M3 3v18h18" />
          <path d="m7 14 4-4 4 4 5-5" />
        </svg>
      </div>
      <p class="text-muted-foreground text-sm mb-1">Selecciona un activo del sidebar para analizar</p>
      <p class="text-muted-foreground/50 text-xs">O añade uno nuevo con el botón +</p>
    </div>

    <template v-if="app.hasData.value && !app.loading.value">
      <!-- Title row -->
      <div class="flex flex-wrap items-center gap-3 sm:gap-4">
        <div v-if="app.companyLogo.value" class="w-9 h-9 sm:w-11 sm:h-11 rounded-xl overflow-hidden flex-shrink-0 bg-white/5 p-1">
          <img :src="app.companyLogo.value" :alt="app.ticker.value" class="w-full h-full object-contain rounded-lg" />
        </div>
        <div v-else class="w-9 h-9 sm:w-11 sm:h-11 rounded-xl flex-shrink-0 bg-primary/10 flex items-center justify-center">
          <span class="text-primary text-sm font-bold">{{ app.ticker.value?.slice(0, 2) }}</span>
        </div>
        <div class="flex-1 min-w-0">
          <h1 class="text-lg sm:text-xl font-bold text-foreground tracking-tight truncate leading-tight">{{ app.companyName.value || app.ticker.value }}</h1>
          <span class="text-muted-foreground text-xs">{{ app.ticker.value }}</span>
        </div>
        <div class="flex items-center gap-2">
          <span v-if="app.refreshing.value" class="text-[10px] text-primary/60 flex items-center gap-1.5">
            <span class="w-1.5 h-1.5 rounded-full bg-primary/60 animate-pulse"></span>
            Actualizando...
          </span>
          <div class="hidden sm:flex items-center gap-1">
            <button
              v-for="opt in periodOptions" :key="opt.value"
              type="button"
              class="period-tag"
              :class="app.years.value === opt.value ? 'period-tag-active' : ''"
              @click="app.years.value = opt.value; app.onPeriodChange()"
            >
              {{ opt.label }}
            </button>
          </div>
        </div>
      </div>

      <!-- Charts grid -->
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div class="lg:col-span-4 glass-card p-4">
          <IndicatorsPanel :indicators="app.data.indicators" :projection="app.data.projection" :dividends="app.data.dividends" :currency="app.currency.value" :ticker="app.ticker.value" :fresh-label="freshLabels.price" />
        </div>
        <div class="lg:col-span-8 glass-card p-4">
          <GeraldineChart :price-bands="app.data.priceBands" :ticker="app.ticker.value" :currency="app.currency.value" :fresh-label="freshLabels.price" />
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div class="glass-card p-4"><YieldsChart :daily-yields="app.data.dailyYields" :avg-high-yield="app.data.indicators?.avgHighYield || 0" :avg-low-yield="app.data.indicators?.avgLowYield || 0" :avg-yield="app.data.indicators?.avgYield || 0" :ticker="app.ticker.value" :fresh-label="freshLabels.price" /></div>
        <div class="glass-card p-4"><DividendsChart :dividends="app.data.dividends" :ticker="app.ticker.value" :currency="app.currency.value" :fresh-label="freshLabels.dividend" /></div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div class="glass-card p-4"><DividendHistoryChart :dividends="app.data.dividends" :projection="app.data.projection" :ticker="app.ticker.value" :currency="app.currency.value" :fresh-label="freshLabels.dividend" /></div>
        <div class="glass-card p-4"><ProjectionChart :projection="app.data.projection" :indicators="app.data.indicators" :ticker="app.ticker.value" :currency="app.currency.value" :fresh-label="freshLabels.dividend" /></div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div class="glass-card p-4"><SustainabilityChart :cash-flow="app.data.cashFlow" :ticker="app.ticker.value" :currency="app.currency.value" :fresh-label="freshLabels.cashFlow" /></div>
        <div class="glass-card p-4"><DrawdownChart :drawdown="app.data.drawdown" :ticker="app.ticker.value" :currency="app.currency.value" :fresh-label="freshLabels.price" /></div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div class="glass-card p-4"><RevenueChart :fundamentals="app.data.fundamentals" :ticker="app.ticker.value" :currency="app.currency.value" :fresh-label="freshLabels.fundamentals" /></div>
        <div class="glass-card p-4"><MarginsChart :fundamentals="app.data.fundamentals" :fresh-label="freshLabels.fundamentals" /></div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div class="glass-card p-4"><EvFcfChart :fundamentals="app.data.fundamentals" :ticker="app.ticker.value" :currency="app.currency.value" :fresh-label="freshLabels.fundamentals" /></div>
        <div class="glass-card p-4"><EvEbitdaChart :fundamentals="app.data.fundamentals" :ticker="app.ticker.value" :currency="app.currency.value" :fresh-label="freshLabels.fundamentals" /></div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div class="glass-card p-4"><DebtChart :fundamentals="app.data.fundamentals" :ticker="app.ticker.value" :currency="app.currency.value" :fresh-label="freshLabels.fundamentals" /></div>
        <div class="glass-card p-4"><SharesChart :fundamentals="app.data.fundamentals" :fresh-label="freshLabels.fundamentals" /></div>
      </div>
    </template>
  </main>
</template>
