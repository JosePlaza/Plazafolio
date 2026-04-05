<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import Highcharts from 'highcharts'
import { getAllCachedAnalyses } from '@/services/assetsApi'
import { usePortfolio } from '@/composables/usePortfolio'
import { useCurrency } from '@/composables/useCurrency'
import { useTransactions } from '@/composables/useTransactions'
import { computeBuyScore } from '@/lib/scoring'
import AnimatedNumber from '@/components/AnimatedNumber.vue'

const props = defineProps({
  actives: { type: Array, default: () => [] },
  watchlist: { type: Array, default: () => [] },
  visible: { type: Boolean, default: false },
})

const emit = defineEmits(['select-asset'])

const analyses = ref({})
const loading = ref(false)
const pieMode = ref('asset') // 'asset' | 'sector'
const pieContainer = ref(null)
let pieInstance = null

const { symbolFor } = useCurrency()
const { transactions, load: loadTransactions } = useTransactions()

const {
  portfolioItems,
  positionedItems,
  totalValue,
  totalAnnualIncome,
  weightedYieldOnCost,
  totalPnlPct,
  distributionByAsset,
  distributionBySector,
} = usePortfolio(computed(() => props.actives), analyses, transactions)

// Include watchlist items without position for display (sorted: positioned first)
const allItems = computed(() => {
  const watchItems = props.watchlist.map((asset) => {
    const cached = analyses.value?.[asset.ticker]
    const indicators = cached?.data?.indicators || null
    const projection = cached?.data?.projection || null
    const dividends = cached?.data?.dividends || []
    const cashFlow = cached?.data?.cashFlow || null
    const fundamentals = cached?.data?.fundamentals || null
    const scoring = indicators ? computeBuyScore(indicators, projection, dividends, cashFlow, fundamentals) : null
    return {
      ...asset,
      indicators,
      projection,
      scoring,
      score: scoring?.score ?? null,
      currency: symbolFor(asset.ticker),
      sector: indicators?.sector || '-',
      currentPrice: indicators?.currentPrice || asset.price || 0,
      positionValue: 0,
      annualIncome: 0,
      yieldOnCost: 0,
      pnlPct: 0,
      hasPosition: false,
      isWatchlist: true,
    }
  })
  // Actives with position first, then actives without, then watchlist
  const sorted = [...portfolioItems.value].sort((a, b) => {
    if (a.hasPosition && !b.hasPosition) return -1
    if (!a.hasPosition && b.hasPosition) return 1
    return (b.positionValue || 0) - (a.positionValue || 0)
  })
  return sorted
})

const displaySym = computed(() => {
  const { forcedCurrency } = useCurrency()
  if (forcedCurrency.value === 'EUR') return '€'
  if (forcedCurrency.value === 'USD') return '$'
  return '$'
})

// ── Pie chart ──────────────────────────────────────────────────────────
const pieColors = [
  '#415BFF', '#34d399', '#f87171', '#fbbf24', '#a78bfa',
  '#38bdf8', '#fb923c', '#e879f9', '#78b0a8', '#6ee7b7',
  '#f472b6', '#818cf8', '#facc15', '#4ade80', '#f97316',
]

const pieData = computed(() =>
  pieMode.value === 'asset' ? distributionByAsset.value : distributionBySector.value
)

const pieOptions = computed(() => {
  if (!pieData.value.length) return null
  return {
    chart: {
      type: 'pie',
      backgroundColor: 'transparent',
      style: { fontFamily: 'Inter, system-ui, sans-serif' },
      spacing: [0, 0, 0, 0],
      height: 260,
    },
    title: { text: null },
    tooltip: {
      useHTML: true,
      backgroundColor: 'transparent',
      borderWidth: 0,
      shadow: false,
      padding: 0,
      formatter() {
        const sym = displaySym.value
        return `<div style="background:rgba(14,14,22,0.9);backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:10px 14px;box-shadow:0 8px 32px rgba(0,0,0,0.4);">
          <div style="color:#e4e4e7;font-size:12px;font-weight:600;margin-bottom:4px;">${this.point.name}</div>
          <div style="color:#a1a1aa;font-size:11px;">${sym}${this.point.y.toLocaleString(undefined, { maximumFractionDigits: 0 })} · ${this.point.pct.toFixed(1)}%</div>
        </div>`
      },
    },
    plotOptions: {
      pie: {
        innerSize: '60%',
        borderWidth: 0,
        borderRadius: 4,
        colors: pieColors,
        dataLabels: {
          enabled: true,
          format: '<b>{point.name}</b>: {point.pct:.1f}%',
          style: { color: '#a1a1aa', fontSize: '10px', fontWeight: '400', textOutline: 'none' },
          distance: 15,
          connectorWidth: 1,
          connectorColor: 'rgba(255,255,255,0.1)',
        },
      },
    },
    series: [{
      data: pieData.value.map((d, i) => ({
        name: d.name,
        y: d.y,
        pct: d.pct,
        color: pieColors[i % pieColors.length],
      })),
    }],
    credits: { enabled: false },
  }
})

function renderPie() {
  if (pieOptions.value && pieContainer.value) {
    if (pieInstance) pieInstance.destroy()
    pieInstance = Highcharts.chart(pieContainer.value, pieOptions.value)
  }
}

watch(pieOptions, renderPie, { deep: true })
watch(pieMode, renderPie)

async function loadAnalyses() {
  loading.value = true
  try {
    analyses.value = (await getAllCachedAnalyses()) || {}
  } catch (err) {
    console.error('Error loading analyses for portfolio:', err)
  } finally {
    loading.value = false
  }
}

watch(() => props.visible, (val) => { if (val) { loadAnalyses(); loadTransactions() } })
onMounted(() => {
  if (props.visible) { loadAnalyses(); loadTransactions() }
  // Render pie after mount
  setTimeout(renderPie, 100)
})
onBeforeUnmount(() => { if (pieInstance) { pieInstance.destroy(); pieInstance = null } })

// ── Helpers ──
function heatColor(heat) {
  const c = { 5: '#34d399', 4: '#6ee7b7', 3: '#fbbf24', 2: '#fb923c', 1: '#f87171', 0: '#ef4444' }
  return c[heat] ?? '#71717a'
}
function heatBg(heat) { return heatColor(heat) + '15' }
function heatBorder(heat) { return heatColor(heat) + '30' }
function fmt(val, dec = 2) { if (val == null || isNaN(val)) return '-'; return Number(val).toFixed(dec) }
function fmtShares(val) {
  if (val == null || isNaN(val)) return '-'
  const n = Number(val)
  if (n === Math.floor(n)) return n.toFixed(0)
  // Up to 4 decimals, strip trailing zeros
  return parseFloat(n.toFixed(4)).toString()
}
function fmtK(val) {
  if (val == null) return '-'
  if (Math.abs(val) >= 1e6) return (val / 1e6).toFixed(1) + 'M'
  if (Math.abs(val) >= 1e3) return (val / 1e3).toFixed(1) + 'K'
  return val.toFixed(0)
}
</script>

<template>
  <div class="max-w-5xl mx-auto">
    <!-- Title -->
    <div class="flex items-center justify-between mb-6">
      <div>
        <h2 class="text-xl font-bold text-foreground tracking-tight">Portfolio</h2>
        <p class="text-muted-foreground text-xs mt-0.5">Distribución y rendimiento de tus posiciones</p>
      </div>
      <div class="flex items-center gap-2">
        <button
          v-if="!loading"
          class="gw-btn-icon"
          title="Actualizar datos"
          @click="loadAnalyses"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21.5 2v6h-6" /><path d="M2.5 22v-6h6" />
            <path d="M2 11.5a10 10 0 0 1 18.8-4.3L21.5 8" /><path d="M22 12.5a10 10 0 0 1-18.8 4.3L2.5 16" />
          </svg>
        </button>
        <div v-else class="spinner" style="width: 20px; height: 20px; border-width: 2px;"></div>
      </div>
    </div>

    <!-- Empty state -->
    <div v-if="!props.actives.length && !loading" class="flex flex-col items-center justify-center py-24">
      <p class="text-muted-foreground text-sm">No hay activos en tu portfolio</p>
      <p class="text-muted-foreground/50 text-xs mt-1">Añade activos desde la vista de Análisis</p>
    </div>

    <template v-else>
      <!-- ═══ Pie Chart ═══ -->
      <div v-if="positionedItems.length" class="glass-card p-5 mb-4">
        <!-- Toggle -->
        <div class="flex items-center gap-2 mb-3">
          <button
            class="text-[11px] px-3 py-1 rounded-lg transition-colors"
            :class="pieMode === 'asset' ? 'bg-primary/15 text-primary font-semibold' : 'text-zinc-500 hover:text-zinc-300'"
            @click="pieMode = 'asset'"
          >
            Por activo
          </button>
          <button
            class="text-[11px] px-3 py-1 rounded-lg transition-colors"
            :class="pieMode === 'sector' ? 'bg-primary/15 text-primary font-semibold' : 'text-zinc-500 hover:text-zinc-300'"
            @click="pieMode = 'sector'"
          >
            Por sector
          </button>
        </div>
        <div ref="pieContainer" class="w-full"></div>
      </div>

      <!-- ═══ KPIs ═══ -->
      <div v-if="positionedItems.length" class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <div class="glass-card p-4 text-center">
          <div class="text-[10px] uppercase text-zinc-400 tracking-wider mb-1">Valor Total</div>
          <div class="text-lg font-bold text-foreground tabular-nums"><AnimatedNumber :value="totalValue" :prefix="displaySym" :decimals="0" /></div>
        </div>
        <div class="glass-card p-4 text-center">
          <div class="text-[10px] uppercase text-zinc-400 tracking-wider mb-1">Ingreso Anual</div>
          <div class="text-lg font-bold text-emerald-400 tabular-nums"><AnimatedNumber :value="totalAnnualIncome" :prefix="displaySym" :decimals="0" /></div>
        </div>
        <div class="glass-card p-4 text-center">
          <div class="text-[10px] uppercase text-zinc-400 tracking-wider mb-1">Yield on Cost</div>
          <div class="text-lg font-bold text-primary tabular-nums"><AnimatedNumber :value="weightedYieldOnCost" suffix="%" /></div>
        </div>
        <div class="glass-card p-4 text-center">
          <div class="text-[10px] uppercase text-zinc-400 tracking-wider mb-1">Rentabilidad</div>
          <div
            class="text-lg font-bold tabular-nums"
            :style="{ color: totalPnlPct >= 0 ? '#34d399' : '#f87171' }"
          >
            <AnimatedNumber :value="totalPnlPct" :prefix="totalPnlPct >= 0 ? '+' : ''" suffix="%" />
          </div>
        </div>
      </div>

      <!-- ═══ Skeleton ═══ -->
      <div v-if="loading && !allItems.length" class="space-y-2 animate-pulse">
        <div v-for="i in 5" :key="i" class="glass-card p-4">
          <div class="flex items-center gap-4">
            <div class="w-9 h-9 rounded-lg bg-white/[0.04]"></div>
            <div class="flex-1 space-y-2">
              <div class="h-4 w-32 rounded bg-white/[0.05]"></div>
              <div class="h-3 w-20 rounded bg-white/[0.03]"></div>
            </div>
            <div class="w-20 h-4 rounded bg-white/[0.04]"></div>
          </div>
        </div>
      </div>

      <!-- ═══ Asset List ═══ -->
      <div v-else class="space-y-2">
        <div
          v-for="item in allItems"
          :key="item.id"
          class="glass-card p-4 cursor-pointer group"
          @click="emit('select-asset', item)"
        >
          <!-- ── Row 1: Logo + Name + desktop columns + arrow ── -->
          <div class="flex items-center gap-4">
            <!-- Logo -->
            <div v-if="item.image" class="w-9 h-9 rounded-lg overflow-hidden shrink-0 bg-white/5 p-0.5">
              <img :src="item.image" :alt="item.ticker" class="w-full h-full object-contain rounded-md" />
            </div>
            <div v-else class="w-9 h-9 rounded-lg shrink-0 bg-primary/10 flex items-center justify-center">
              <span class="text-primary text-[10px] font-bold">{{ item.ticker?.slice(0, 2) }}</span>
            </div>

            <!-- Name + Sector -->
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <span class="text-sm font-semibold text-foreground truncate">{{ item.name }}</span>
                <span class="text-[10px] text-muted-foreground">{{ item.ticker }}</span>
              </div>
              <div class="flex items-center gap-2 mt-0.5">
                <span class="text-[9px] text-zinc-400">{{ item.sector }}</span>
                <span
                  v-if="!item.hasPosition"
                  class="text-[9px] px-1.5 rounded text-zinc-400 bg-white/5"
                >
                  Sin posición
                </span>
              </div>
            </div>

            <!-- Desktop-only columns -->
            <div v-if="item.hasPosition" class="text-right shrink-0 w-20 hidden sm:block">
              <div class="text-[10px] uppercase text-zinc-400">Acciones</div>
              <div class="text-sm font-medium text-foreground tabular-nums">{{ fmtShares(item.shares) }}</div>
            </div>

            <div v-if="item.hasPosition" class="text-right shrink-0 w-24 hidden sm:block">
              <div class="text-[10px] uppercase text-zinc-400">Valor</div>
              <div class="text-sm font-medium text-foreground tabular-nums">{{ item.currency }}{{ fmtK(item.positionValue) }}</div>
            </div>

            <div v-if="item.hasPosition" class="text-right shrink-0 w-20 hidden sm:block">
              <div class="text-[10px] uppercase text-zinc-400">YoC</div>
              <div class="text-sm font-bold text-primary tabular-nums">{{ fmt(item.yieldOnCost) }}%</div>
            </div>

            <div v-if="item.hasPosition" class="text-right shrink-0 w-24 hidden sm:block">
              <div class="text-[10px] uppercase text-zinc-400">Ingreso/año</div>
              <div class="text-sm font-semibold text-emerald-400 tabular-nums">{{ item.currency }}{{ fmt(item.annualIncome) }}</div>
            </div>

            <!-- P&L / Signal (desktop) -->
            <div class="text-right shrink-0 w-20 hidden sm:block">
              <template v-if="item.hasPosition">
                <div class="text-[10px] uppercase text-zinc-400">P&amp;L</div>
                <div
                  class="text-sm font-semibold tabular-nums"
                  :style="{ color: item.pnlPct >= 0 ? '#34d399' : '#f87171' }"
                >
                  {{ item.pnlPct >= 0 ? '+' : '' }}{{ fmt(item.pnlPct) }}%
                </div>
              </template>
              <template v-else-if="item.scoring">
                <div class="text-[10px] font-semibold uppercase tracking-wider" :style="{ color: heatColor(item.scoring.heat) }">{{ item.scoring.signal }}</div>
                <div class="text-xs font-bold text-foreground">{{ item.score }}</div>
              </template>
              <template v-else>
                <span class="text-[10px] text-zinc-400">Sin datos</span>
              </template>
            </div>

            <!-- Arrow -->
            <svg class="w-4 h-4 text-zinc-400 group-hover:text-zinc-400 transition-colors shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </div>

          <!-- ── Row 2: Mobile-only metrics grid ── -->
          <div v-if="item.hasPosition" class="grid grid-cols-5 gap-2 mt-3 pt-3 border-t border-white/5 sm:hidden">
            <div class="text-center">
              <div class="text-[9px] uppercase text-zinc-400 tracking-wider">Acciones</div>
              <div class="text-[11px] font-semibold text-foreground tabular-nums mt-0.5">{{ fmtShares(item.shares) }}</div>
            </div>
            <div class="text-center">
              <div class="text-[9px] uppercase text-zinc-400 tracking-wider">Valor</div>
              <div class="text-[11px] font-semibold text-foreground tabular-nums mt-0.5">{{ item.currency }}{{ fmtK(item.positionValue) }}</div>
            </div>
            <div class="text-center">
              <div class="text-[9px] uppercase text-zinc-400 tracking-wider">YoC</div>
              <div class="text-[11px] font-bold text-primary tabular-nums mt-0.5">{{ fmt(item.yieldOnCost) }}%</div>
            </div>
            <div class="text-center">
              <div class="text-[9px] uppercase text-zinc-400 tracking-wider">Ing/año</div>
              <div class="text-[11px] font-semibold text-emerald-400 tabular-nums mt-0.5">{{ item.currency }}{{ fmt(item.annualIncome, 0) }}</div>
            </div>
            <div class="text-center">
              <div class="text-[9px] uppercase text-zinc-400 tracking-wider">P&amp;L</div>
              <div
                class="text-[11px] font-semibold tabular-nums mt-0.5"
                :style="{ color: item.pnlPct >= 0 ? '#34d399' : '#f87171' }"
              >
                {{ item.pnlPct >= 0 ? '+' : '' }}{{ fmt(item.pnlPct) }}%
              </div>
            </div>
          </div>

          <!-- Mobile: signal for items without position -->
          <div v-else-if="item.scoring" class="mt-2 pt-2 border-t border-white/5 sm:hidden">
            <div class="flex items-center justify-between">
              <span class="text-[10px] font-semibold uppercase tracking-wider" :style="{ color: heatColor(item.scoring.heat) }">{{ item.scoring.signal }}</span>
              <span class="text-xs font-bold text-foreground">{{ item.score }}</span>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
