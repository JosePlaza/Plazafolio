<script setup>
import { computed, inject } from 'vue'
import { useRouter } from 'vue-router'
import AssetSelector from '@/components/AssetSelector.vue'
import ValuationSection from '@/components/valuation/ValuationSection.vue'
import SkeletonLoader from '@/components/SkeletonLoader.vue'
import IndicatorsPanel from '@/components/IndicatorsPanel.vue'
import GeraldineChart from '@/components/charts/GeraldineChart.vue'
import YieldsChart from '@/components/charts/YieldsChart.vue'
import DividendsChart from '@/components/charts/DividendsChart.vue'
import ProjectionChart from '@/components/charts/ProjectionChart.vue'
import DrawdownChart from '@/components/charts/DrawdownChart.vue'
import DividendHistoryChart from '@/components/charts/DividendHistoryChart.vue'
import FinancialOverviewChart from '@/components/charts/FinancialOverviewChart.vue'
import RevenueChart from '@/components/charts/RevenueChart.vue'
import MarginsChart from '@/components/charts/MarginsChart.vue'
import ValuationChart from '@/components/charts/ValuationChart.vue'
import EvFcfChart from '@/components/charts/EvFcfChart.vue'
import EvEbitdaChart from '@/components/charts/EvEbitdaChart.vue'
import DebtChart from '@/components/charts/DebtChart.vue'
import SharesChart from '@/components/charts/SharesChart.vue'
import { useSettings } from '@/composables/useSettings'

const app = inject('appState')
const router = useRouter()
const { geminiApiKey } = useSettings()

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

// Todo ticker tiene fuente: sin punto → SEC EDGAR (US), con punto → ESEF (EU).
const hasReportSource = computed(() => !!app.ticker.value)

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

// Cambiar de activo desde la propia vista: antes había que volver al listado.
function onSelectAsset(asset) {
  app.onSelectAsset(asset)
}

/**
 * Los informes de resultados viven ahora en el detalle del activo dentro de
 * Portfolio, así que el botón navega allí en vez de cambiar de sub-vista.
 */
function abrirInformes() {
  const t = app.ticker.value
  if (t) router.push({ name: 'portfolio-detail', params: { ticker: t } })
}


// ── Financial Reports (SEC for US, ESEF for EU) ──

// Fetch reports when ticker changes
</script>

<template>
  <main class="dot-pattern flex-1 overflow-y-auto p-3 sm:p-5 space-y-4 pb-navbar" style="max-height: calc(100dvh - 3.5rem - env(safe-area-inset-top, 0px))">
    <!-- Selector de activo: permite saltar de análisis sin volver al inicio -->
    <div class="max-w-sm">
      <AssetSelector
        :actives="app.actives.value"
        :watchlist="app.watchlist.value"
        :selected-id="app.selectedAssetId.value"
        @select="onSelectAsset"
      />
    </div>

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
      <p class="text-muted-foreground text-sm mb-1">Elige un activo en el selector de arriba</p>
      <p class="text-muted-foreground/50 text-xs">O añade uno nuevo desde Inicio</p>
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

          <!-- Reports button (desktop: text) -->
          <button
            v-if="hasReportSource"
            class="reports-btn-text"
            @click="abrirInformes"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 2v4a2 2 0 0 0 2 2h4" />
              <path d="M16 22h2a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v3.5" />
              <path d="M4.017 11.512a6 6 0 1 0 8.466 8.475" />
              <path d="M9 16a6 6 0 0 1 6-6v6z" />
            </svg>
            <span>Informes de resultados</span>
            <svg class="w-3.5 h-3.5 opacity-50" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>

          <!-- Reports button (mobile: icon only) -->
          <button
            v-if="hasReportSource"
            class="reports-btn-mobile"
            @click="abrirInformes"
            title="Informes de resultados"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 2v4a2 2 0 0 0 2 2h4" />
              <path d="M16 22h2a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v3.5" />
              <path d="M4.017 11.512a6 6 0 1 0 8.466 8.475" />
              <path d="M9 16a6 6 0 0 1 6-6v6z" />
            </svg>
          </button>
        </div>
      </div>

      <!-- ═══ Valoración: precio de entrada (SPEC_01) ═══ -->
      <ValuationSection
        :ticker="app.ticker.value"
        :data="app.data"
        :fundamentals="app.data.fundamentals"
        :years="app.years.value"
        class="mb-4"
      />

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

      <div class="glass-card p-4"><FinancialOverviewChart :fundamentals="app.data.fundamentals" :ticker="app.ticker.value" :currency="app.currency.value" :fresh-label="freshLabels.fundamentals" /></div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div class="glass-card p-4"><RevenueChart :fundamentals="app.data.fundamentals" :ticker="app.ticker.value" :currency="app.currency.value" :fresh-label="freshLabels.fundamentals" /></div>
        <div class="glass-card p-4"><MarginsChart :fundamentals="app.data.fundamentals" :fresh-label="freshLabels.fundamentals" /></div>
      </div>

      <div class="glass-card p-4"><ValuationChart :fundamentals="app.data.fundamentals" :prices="app.data.priceBands" :ticker="app.ticker.value" :fresh-label="freshLabels.fundamentals" /></div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div class="glass-card p-4"><EvFcfChart :fundamentals="app.data.fundamentals" :ticker="app.ticker.value" :currency="app.currency.value" :fresh-label="freshLabels.fundamentals" /></div>
        <div class="glass-card p-4"><EvEbitdaChart :fundamentals="app.data.fundamentals" :ticker="app.ticker.value" :currency="app.currency.value" :fresh-label="freshLabels.fundamentals" /></div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div class="glass-card p-4"><DebtChart :fundamentals="app.data.fundamentals" :ticker="app.ticker.value" :currency="app.currency.value" :fresh-label="freshLabels.fundamentals" /></div>
        <div class="glass-card p-4"><SharesChart :fundamentals="app.data.fundamentals" :fresh-label="freshLabels.fundamentals" /></div>
      </div>

      <div class="glass-card p-4"><DrawdownChart :drawdown="app.data.drawdown" :ticker="app.ticker.value" :currency="app.currency.value" :fresh-label="freshLabels.price" /></div>
    </template>
  </main>
</template>

<style scoped>
/* ── Desktop reports button (same style as gw-btn-icon but wider with text) ── */
.reports-btn-text {
  align-items: center;
  gap: 6px;
  padding: 0 14px;
  height: 36px;
  border-radius: 10px;
  font-size: 12px;
  font-weight: 500;
  color: #415BFF;
  background: rgba(65, 91, 255, 0.12);
  border: 1px solid rgba(65, 91, 255, 0.2);
  transition: all 0.2s ease;
  cursor: pointer;
  white-space: nowrap;
  display: none;
}
@media (min-width: 1024px) {
  .reports-btn-text { display: inline-flex; }
}
.reports-btn-text:hover {
  background: rgba(65, 91, 255, 0.2);
  border-color: rgba(65, 91, 255, 0.4);
}

/* ── Mobile reports icon button (mirrors gw-btn-icon, hidden on desktop) ── */
.reports-btn-mobile {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  color: #415BFF;
  background: rgba(65, 91, 255, 0.12);
  border: 1px solid rgba(65, 91, 255, 0.2);
  cursor: pointer;
  transition: all 0.2s ease;
}
.reports-btn-mobile:hover {
  background: rgba(65, 91, 255, 0.2);
  border-color: rgba(65, 91, 255, 0.4);
}
@media (min-width: 1024px) {
  .reports-btn-mobile { display: none; }
}

/* ── Report type badges ── */
.report-type-badge {
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.02em;
}
.report-type-annual {
  background: rgba(251, 191, 36, 0.08);
  color: rgba(251, 191, 36, 0.8);
}
.report-type-quarterly {
  background: rgba(96, 165, 250, 0.08);
  color: rgba(96, 165, 250, 0.7);
}

/* ── Sentiment + signal chips ── */
.report-sentiment-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 99px;
  font-size: 9px;
  font-weight: 600;
  border: 1px solid;
  letter-spacing: 0.01em;
}
.report-signal-chip {
  font-size: 9px;
  font-weight: 500;
}

/* ── Inline audio player row ── */
.audio-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.04);
}

.audio-play-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: rgba(65, 91, 255, 0.12);
  color: #415BFF;
  border: none;
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.2s ease;
}
.audio-play-btn:hover {
  background: rgba(65, 91, 255, 0.22);
  transform: scale(1.05);
}
.audio-play-btn.audio-playing {
  background: rgba(65, 91, 255, 0.2);
  color: #818cf8;
}

.audio-track {
  flex: 1;
  height: 4px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.06);
  cursor: pointer;
  position: relative;
  overflow: hidden;
}
.audio-track:hover {
  height: 6px;
}

.audio-track-fill {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  border-radius: 2px;
  background: linear-gradient(90deg, #415BFF, #818cf8);
  transition: width 0.25s linear;
}

.audio-time {
  font-size: 10px;
  color: #71717a;
  font-variant-numeric: tabular-nums;
  min-width: 28px;
  text-align: right;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
}

/* Line clamp */
.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
