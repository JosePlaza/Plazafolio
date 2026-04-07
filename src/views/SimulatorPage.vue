<script setup>
import { ref, computed, inject, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useSettings } from '@/composables/useSettings'
import { useCurrency } from '@/composables/useCurrency'
import { usePortfolio } from '@/composables/usePortfolio'
import { useTransactions } from '@/composables/useTransactions'
import { getAllCachedAnalyses } from '@/services/assetsApi'
import { runSimulation } from '@/services/incomeSimulatorApi'
import IncomeProjectionChart from '@/components/IncomeProjectionChart.vue'

const app = inject('appState')
const router = useRouter()
const { geminiApiKey } = useSettings()
const { displaySymbol } = useCurrency()

// ── Portfolio data (for impact card) ──
const portfolioAnalyses = ref({})
const { transactions, load: loadTransactions } = useTransactions()
const {
  positionedItems,
  totalValue: portfolioTotalValue,
  totalAnnualIncome: portfolioTotalIncome,
  weightedYieldOnCost: portfolioYieldOnCost,
} = usePortfolio(computed(() => app.actives?.value || []), portfolioAnalyses, transactions)

// ── Inputs ──
const amount = ref(5000)
const years = ref(5)
const yearOptions = [3, 5, 10]

// ── State ──
const result = ref(null)
const loading = ref(false)
const error = ref(null)
const analysisExpanded = ref(true)

// ── All candidate assets (portfolio + watchlist) ──
const allCandidates = computed(() => {
  const actives = app.actives?.value || []
  const watchlist = app.watchlist?.value || []
  return [...actives, ...watchlist]
})

const sym = computed(() => displaySymbol.value || '€')

// ── Portfolio impact: current state vs. after proposed allocation ──
const portfolioImpact = computed(() => {
  if (!result.value?.allocation?.length || !result.value?.allocationTotals) return null

  // Current portfolio: use real data from usePortfolio composable
  const currentValue = portfolioTotalValue.value || 0
  const currentIncome = portfolioTotalIncome.value || 0
  const currentYield = currentValue > 0 ? (currentIncome / currentValue) * 100 : 0

  // After allocation
  const addedValue = result.value.amount || 0
  const addedIncomeYr1 = result.value.allocationTotals.incomeYear1 || 0

  const newValue = currentValue + addedValue
  const newIncome = currentIncome + addedIncomeYr1
  const newYield = newValue > 0 ? (newIncome / newValue) * 100 : 0

  // How many assets in allocation are new (not in actives)
  const activeTickers = new Set(positionedItems.value.map(a => a.ticker?.toUpperCase()))
  const newAssets = result.value.allocation.filter(a => !activeTickers.has(a.ticker?.toUpperCase())).length
  const existingAssets = result.value.allocation.length - newAssets

  return {
    currentValue, currentIncome, currentYield,
    addedValue, addedIncomeYr1,
    newValue, newIncome, newYield,
    yieldDelta: newYield - currentYield,
    incomeDelta: addedIncomeYr1,
    newAssets, existingAssets,
    totalAssets: positionedItems.value.length + newAssets,
  }
})

const chartByAsset = ref(false)

// ── Chart data: build totals + per-asset breakdown ──
const chartTotals = computed(() => {
  if (!result.value?.allocation?.length) return null

  const topAsset = result.value.assets?.[0]
  if (!topAsset?.projection?.byYear?.length) return null

  const numYears = topAsset.projection.byYear.length
  const base = []

  // Per-asset series for stacked area view
  const perAsset = result.value.allocation.map((alloc, i) => ({
    ticker: alloc.ticker,
    color: `hsl(${(i * 60 + 220) % 360}, 60%, 50%)`,
    data: [],
  }))

  for (let y = 0; y < numYears; y++) {
    let totalIncome = 0
    for (let i = 0; i < result.value.allocation.length; i++) {
      const alloc = result.value.allocation[i]
      const asset = result.value.assets.find(a => a.ticker === alloc.ticker)
      const income = asset?.projection?.byYear?.[y]
        ? asset.projection.byYear[y].annualIncome * (alloc.weight / 100)
        : 0
      perAsset[i].data.push(Math.round(income * 100) / 100)
      totalIncome += income
    }
    base.push({ year: y + 1, annualIncome: Math.round(totalIncome * 100) / 100 })
  }

  return { base, perAsset }
})

// ── Chart explanation: plain-language summary + scenarios ──
const chartExplanation = computed(() => {
  if (!chartTotals.value?.base?.length || !result.value?.allocationTotals) return null

  const totals = result.value.allocationTotals
  const yr1 = chartTotals.value.base[0]?.annualIncome || 0
  const yrN = chartTotals.value.base[chartTotals.value.base.length - 1]?.annualIncome || 0
  const growth = yr1 > 0 ? ((yrN / yr1 - 1) * 100) : 0
  const monthlyStart = yr1 / 12
  const monthlyEnd = yrN / 12

  // Scenarios: pessimistic (CAGR halved), base (as projected), optimistic (CAGR × 1.5)
  const base = chartTotals.value.base
  const numYears = base.length

  // Build pessimistic and optimistic by scaling the growth curve
  const pessimistic = []
  const optimistic = []
  for (let y = 0; y < numYears; y++) {
    const ratio = yr1 > 0 ? base[y].annualIncome / yr1 : 1
    // Pessimistic: sqrt of growth ratio (halved compound effect)
    const pessRatio = Math.pow(ratio, 0.5)
    // Optimistic: ratio^1.4 (amplified compound effect)
    const optRatio = Math.pow(ratio, 1.4)
    pessimistic.push(Math.round(yr1 * pessRatio))
    optimistic.push(Math.round(yr1 * optRatio))
  }

  return {
    yr1, yrN, growth, monthlyStart, monthlyEnd, numYears,
    pessimisticYrN: pessimistic[pessimistic.length - 1] || yr1,
    optimisticYrN: optimistic[optimistic.length - 1] || yrN,
    totalIncome: totals.totalIncome,
    finalValue: totals.finalValue,
  }
})

// ── Per-asset contribution enrichment for the allocation breakdown ──
const allocationDetails = computed(() => {
  if (!result.value?.allocation?.length || !result.value?.assets?.length) return []

  return result.value.allocation.map((alloc, i) => {
    const asset = result.value.assets.find(a => a.ticker === alloc.ticker)
    if (!asset) return { ...alloc, role: '', color: '' }

    // Determine role based on dominant quality
    const y = asset.yieldPct || 0
    const g = asset.dividendCAGR || 0
    const s = asset.safetyScore || 0
    const u = asset.weissUpside || 0

    let role = ''
    if (y >= 6) role = 'Alto yield'
    else if (g >= 15) role = 'Alto crecimiento'
    else if (u >= 50) role = 'Infravalorado'
    else if (s >= 8) role = 'Defensivo'
    else if (y >= 4 && g >= 8) role = 'Equilibrado'
    else if (g >= 10) role = 'Crecimiento'
    else if (y >= 4) role = 'Generador yield'
    else role = 'Diversificación'

    // Fixed color per role type
    const roleColors = {
      'Alto yield': '#f59e0b',        // amber
      'Generador yield': '#f59e0b',   // amber
      'Alto crecimiento': '#34d399',  // emerald
      'Crecimiento': '#34d399',       // emerald
      'Infravalorado': '#415BFF',     // primary blue
      'Defensivo': '#8b5cf6',         // violet
      'Equilibrado': '#06b6d4',       // cyan
      'Diversificación': '#71717a',   // zinc
    }
    const roleColor = roleColors[role] || '#71717a'

    const incomeYrN = asset.projection?.byYear?.[asset.projection.byYear.length - 1]?.annualIncome || 0
    const incomeContrib = incomeYrN * (alloc.weight / 100)

    return {
      ...alloc,
      role,
      roleColor,
      yieldPct: asset.yieldPct,
      dividendCAGR: asset.dividendCAGR,
      weissSignal: asset.weissSignal,
      weissUpside: asset.weissUpside,
      safetyLevel: asset.safetyLevel,
      safetyColor: asset.safetyColor,
      compositeScore: asset.compositeScore,
      incomeContrib: Math.round(incomeContrib),
      color: `hsl(${(i * 60 + 220) % 360}, 60%, 50%)`,
    }
  })
})

// ── Run simulation ──
// Load portfolio analyses eagerly for impact card
async function loadPortfolioData() {
  try {
    const [all] = await Promise.all([
      getAllCachedAnalyses(),
      loadTransactions(),
    ])
    portfolioAnalyses.value = all || {}
  } catch { /* silent */ }
}
loadPortfolioData()

async function simulate() {
  if (allCandidates.value.length === 0) {
    error.value = 'Añade activos al portfolio o watchlist primero'
    return
  }
  if (!amount.value || amount.value <= 0) {
    error.value = 'Indica una cantidad a invertir'
    return
  }

  loading.value = true
  error.value = null
  result.value = null

  try {
    // Ensure portfolio data is loaded for impact card
    if (!Object.keys(portfolioAnalyses.value).length) {
      await loadPortfolioData()
    }

    const candidates = allCandidates.value.map(a => ({
      ticker: a.ticker,
      name: a.name || a.ticker,
      currentPrice: a.price || 0,
    }))

    result.value = await runSimulation({
      amount: amount.value,
      years: years.value,
      candidates,
    }, geminiApiKey.value)

  } catch (err) {
    error.value = err.message || 'Error al simular'
  } finally {
    loading.value = false
  }
}

function goBack() {
  router.push('/dividends')
}

function fmt(n, decimals = 0) {
  if (n == null || isNaN(n)) return '-'
  return Number(n).toLocaleString('es-ES', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function weissSignalClass(signal) {
  if (!signal) return ''
  const s = signal.toLowerCase()
  if (s.includes('compra')) return 'bg-emerald-500/15 text-emerald-400'
  if (s === 'vigilar') return 'bg-amber-500/15 text-amber-400'
  if (s === 'mantener') return 'bg-zinc-500/15 text-zinc-400'
  if (s === 'caro' || s === 'vender') return 'bg-red-500/15 text-red-400'
  return 'bg-zinc-500/15 text-zinc-400'
}

function safetyBg(color) {
  if (!color) return 'rgba(255,255,255,0.06)'
  // Convert hex to rgba
  return color + '20'
}
</script>

<template>
  <main class="dot-pattern flex-1 overflow-y-auto p-3 sm:p-6 pb-navbar" style="max-height: calc(100dvh - 3.5rem - env(safe-area-inset-top, 0px))">
    <div class="max-w-5xl mx-auto">

      <!-- Header -->
      <div class="flex items-center gap-4 mb-6">
        <button
          class="gw-btn-icon w-9 h-9 shrink-0"
          @click="goBack"
          title="Volver a dividendos"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div>
          <h2 class="text-xl font-bold text-foreground tracking-tight">Simulador de Inversión</h2>
          <p class="text-muted-foreground text-xs mt-0.5">¿Dónde pongo mi dinero para maximizar income?</p>
        </div>
      </div>

      <!-- Input: Amount + Horizon + Button -->
      <div class="flex justify-center mb-4">
        <div class="glass-card p-3 flex flex-col sm:flex-row sm:inline-flex items-stretch sm:items-center gap-2 sm:gap-3 w-full sm:w-auto">
          <!-- Row 1 (mobile) / inline (desktop): Amount + Horizon -->
          <div class="flex items-center gap-2 sm:gap-3">
            <div class="relative flex-1 sm:w-36 sm:flex-none">
              <span class="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-zinc-500">{{ sym }}</span>
              <input
                v-model.number="amount"
                type="number"
                min="100"
                step="500"
                placeholder="5000"
                class="w-full bg-white/4 border border-white/8 rounded-lg pl-7 pr-2 py-2.5 text-sm text-foreground placeholder-zinc-600 outline-none focus:border-primary/40 tabular-nums"
              />
            </div>
            <div class="flex rounded-lg overflow-hidden border border-white/8 h-[42px] shrink-0">
              <button
                v-for="y in yearOptions" :key="y"
                class="px-3 text-xs font-semibold transition-colors"
                :class="years === y ? 'bg-primary/20 text-primary' : 'text-zinc-400 hover:text-zinc-300'"
                @click="years = y"
              >{{ y }}a</button>
            </div>
          </div>
          <!-- Row 2 (mobile) / inline (desktop): Button -->
          <button
            class="h-[42px] px-5 rounded-lg text-sm font-semibold transition-all shrink-0 w-full sm:w-auto"
            :class="loading ? 'bg-primary/10 text-primary/50 cursor-not-allowed' : 'bg-primary/15 text-primary hover:bg-primary/25'"
            :disabled="loading"
            @click="simulate"
          >
            <span v-if="loading" class="flex items-center justify-center gap-2">
              <svg class="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
              Analizando...
            </span>
            <span v-else>Simular</span>
          </button>
        </div>
      </div>

      <!-- Error -->
      <div v-if="error" class="glass-card p-4 mb-4 border-red-500/20">
        <p class="text-sm text-red-400">{{ error }}</p>
      </div>

      <!-- Loading skeleton -->
      <div v-if="loading" class="animate-pulse">
        <!-- Allocation skeleton -->
        <div class="glass-card p-4 mb-4">
          <div class="h-3 w-40 rounded bg-white/[0.04] mb-3"></div>
          <div class="h-8 rounded-lg bg-white/[0.03] mb-3"></div>
          <div class="flex flex-wrap gap-1.5 mb-3">
            <div v-for="i in 4" :key="i" class="h-6 rounded-md bg-white/[0.04]" :style="{ width: (60 + i * 10) + 'px' }"></div>
          </div>
          <div class="grid grid-cols-3 gap-3 pt-3 border-t border-white/4">
            <div v-for="i in 3" :key="i" class="text-center space-y-2">
              <div class="h-2.5 w-16 mx-auto rounded bg-white/[0.04]"></div>
              <div class="h-4 w-20 mx-auto rounded bg-white/[0.05]"></div>
            </div>
          </div>
        </div>
        <!-- Chart skeleton -->
        <div class="glass-card p-4 mb-4">
          <div class="h-3 w-48 rounded bg-white/[0.04] mb-2"></div>
          <div class="h-[180px] rounded bg-white/[0.03]"></div>
        </div>
        <!-- Asset contribution skeleton -->
        <div class="glass-card p-4 mb-4">
          <div class="h-3 w-56 rounded bg-white/[0.04] mb-3"></div>
          <div class="space-y-2">
            <div v-for="i in 3" :key="i" class="flex items-center gap-2">
              <div class="w-5 h-4 rounded bg-white/[0.04]"></div>
              <div class="h-4 w-16 rounded bg-white/[0.05]"></div>
              <div class="h-3 flex-1 rounded bg-white/[0.03]"></div>
              <div class="h-5 w-12 rounded bg-white/[0.04]"></div>
            </div>
          </div>
        </div>
        <!-- Impact card skeleton -->
        <div class="glass-card p-5 mb-4">
          <div class="flex items-center justify-between mb-4">
            <div class="h-3 w-36 rounded bg-white/[0.04]"></div>
            <div class="flex gap-3">
              <div class="h-3 w-14 rounded bg-white/[0.03]"></div>
              <div class="h-3 w-16 rounded bg-white/[0.03]"></div>
            </div>
          </div>
          <div class="grid grid-cols-3 gap-3">
            <div v-for="i in 3" :key="i" class="flex flex-col items-center">
              <div class="h-2.5 w-16 mx-auto rounded bg-white/[0.03] mb-2"></div>
              <div class="flex gap-1.5 items-end" style="height:56px">
                <div class="w-8 rounded bg-white/[0.04]" :style="{ height: (28 + i * 4) + 'px' }"></div>
                <div class="w-8 rounded bg-white/[0.06]" style="height:48px"></div>
              </div>
              <div class="flex gap-2 mt-2">
                <div class="h-2.5 w-8 rounded bg-white/[0.03]"></div>
                <div class="h-3 w-10 rounded bg-white/[0.05]"></div>
              </div>
              <div class="h-2.5 w-14 rounded bg-white/[0.03] mt-1"></div>
            </div>
          </div>
          <div class="flex gap-2 mt-4 pt-3 border-t border-white/5">
            <div class="h-5 w-20 rounded-md bg-white/[0.04]"></div>
            <div class="h-5 w-24 rounded-md bg-white/[0.04]"></div>
            <div class="h-5 w-28 rounded-md bg-white/[0.04]"></div>
          </div>
        </div>
      </div>

      <!-- Results -->
      <template v-if="result && result.assets?.length > 0">

        <!-- Allocation Summary -->
        <div v-if="result.allocation?.length" class="glass-card p-4 mb-4">
          <h3 class="text-xs font-semibold text-foreground uppercase tracking-wider mb-3">Asignación recomendada</h3>

          <!-- Stacked bar -->
          <div class="flex rounded-lg overflow-hidden h-8 mb-3">
            <div
              v-for="a in result.allocation" :key="a.ticker"
              class="flex items-center justify-center text-[9px] font-bold text-white/90 min-w-[28px] transition-all"
              :style="{ width: a.weight + '%', background: `hsl(${(result.allocation.indexOf(a) * 60 + 220) % 360}, 60%, 50%)` }"
              :title="`${a.ticker}: ${a.weight}%`"
            >
              <span v-if="a.weight >= 12">{{ a.ticker }}</span>
            </div>
          </div>

          <!-- Allocation pills -->
          <div class="flex flex-wrap gap-1.5 mb-3">
            <div
              v-for="(a, i) in result.allocation" :key="a.ticker"
              class="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px]"
              :style="{ background: `hsla(${(i * 60 + 220) % 360}, 60%, 50%, 0.12)`, color: `hsl(${(i * 60 + 220) % 360}, 60%, 65%)` }"
            >
              <span class="font-semibold">{{ a.ticker }}</span>
              <span class="opacity-70">{{ a.weight }}%</span>
              <span class="opacity-50">{{ sym }}{{ fmt(a.amount) }}</span>
            </div>
          </div>

          <!-- Allocation KPIs -->
          <div v-if="result.allocationTotals" class="grid grid-cols-3 gap-3 text-center pt-3 border-t border-white/4">
            <div>
              <div class="text-[10px] uppercase text-zinc-400 tracking-wider mb-0.5">Income Año 1</div>
              <div class="text-sm font-bold text-foreground tabular-nums">{{ sym }}{{ fmt(result.allocationTotals.incomeYear1) }}</div>
            </div>
            <div>
              <div class="text-[10px] uppercase text-zinc-400 tracking-wider mb-0.5">Income Año {{ years }}</div>
              <div class="text-sm font-bold text-primary tabular-nums">{{ sym }}{{ fmt(result.allocationTotals.incomeYearN) }}</div>
            </div>
            <div>
              <div class="text-[10px] uppercase text-zinc-400 tracking-wider mb-0.5">Valor final</div>
              <div class="text-sm font-bold text-emerald-400 tabular-nums">{{ sym }}{{ fmt(result.allocationTotals.finalValue) }}</div>
            </div>
          </div>

          <!-- Gemini Analysis (collapsible, inside allocation card) -->
          <div v-if="result.recommendation" class="pt-3 mt-3 border-t border-white/4">
            <button
              class="flex items-center gap-2 w-full text-left group"
              @click="analysisExpanded = !analysisExpanded"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#415BFF" stroke-width="2">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
              </svg>
              <span class="text-xs font-semibold uppercase tracking-wider flex-1" style="color: rgba(65, 91, 255, 0.7);">Análisis Gemini</span>
              <svg
                width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                class="text-zinc-500 transition-transform duration-200"
                :class="analysisExpanded ? 'rotate-180' : ''"
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
            <div v-if="analysisExpanded" class="mt-3">
              <div class="text-[13px] leading-relaxed text-zinc-300 whitespace-pre-line">{{ result.recommendation.text }}</div>
              <div v-if="result.recommendation.sources?.length" class="flex flex-wrap gap-1.5 mt-3">
                <a v-for="s in result.recommendation.sources" :key="s.url" :href="s.url" target="_blank" rel="noopener"
                  class="text-[10px] text-primary/50 bg-primary/5 px-1.5 py-0.5 rounded hover:text-primary hover:bg-primary/10">
                  {{ s.title || s.url }}
                </a>
              </div>
            </div>
          </div>
        </div>

        <!-- Projection Chart + Explanation -->
        <div v-if="chartTotals" class="glass-card p-4 mb-4">
          <div class="flex items-center justify-between mb-2">
            <h3 class="text-xs font-semibold text-foreground uppercase tracking-wider">Proyección income (mix recomendado)</h3>
            <button
              class="flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-lg transition-colors"
              :class="chartByAsset ? 'bg-primary/15 text-primary font-semibold' : 'text-zinc-500 hover:text-zinc-300 bg-white/[0.03]'"
              @click="chartByAsset = !chartByAsset"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 3v18h18" /><path d="M7 16l4-8 4 4 6-6" />
              </svg>
              Por activo
            </button>
          </div>
          <IncomeProjectionChart
            :totals="chartTotals"
            :current-income="0"
            :currency="sym"
            :stacked="chartByAsset"
          />

          <!-- Plain-language explanation -->
          <div v-if="chartExplanation" class="mt-4 pt-3 border-t border-white/4">
            <p class="text-[13px] leading-relaxed text-zinc-300">
              Con {{ sym }}{{ fmt(amount) }} repartidos en el mix recomendado, cobrarías
              <span class="font-semibold text-foreground">~{{ sym }}{{ fmt(chartExplanation.monthlyStart) }}/mes</span> el primer año,
              subiendo a
              <span class="font-semibold text-primary">~{{ sym }}{{ fmt(chartExplanation.monthlyEnd) }}/mes</span> en el año {{ chartExplanation.numYears }}<span v-if="chartExplanation.growth > 0"> — un crecimiento del {{ fmt(chartExplanation.growth) }}% gracias a la reinversión de dividendos (DRIP)</span>.
              En total habrías cobrado {{ sym }}{{ fmt(chartExplanation.totalIncome) }} en dividendos y tu inversión valdría {{ sym }}{{ fmt(chartExplanation.finalValue) }}.
            </p>

            <!-- Scenarios -->
            <div class="grid grid-cols-3 gap-3 mt-3">
              <div class="rounded-lg bg-red-500/5 border border-red-500/10 p-2.5 text-center">
                <div class="text-[9px] uppercase text-red-400/70 tracking-wider mb-1">Pesimista</div>
                <div class="text-xs font-bold text-red-400 tabular-nums">{{ sym }}{{ fmt(chartExplanation.pessimisticYrN) }}/año</div>
                <div class="text-[10px] text-zinc-500 mt-0.5">Crecimiento menor</div>
              </div>
              <div class="rounded-lg bg-primary/5 border border-primary/10 p-2.5 text-center">
                <div class="text-[9px] uppercase text-primary/70 tracking-wider mb-1">Base</div>
                <div class="text-xs font-bold text-primary tabular-nums">{{ sym }}{{ fmt(chartExplanation.yrN) }}/año</div>
                <div class="text-[10px] text-zinc-500 mt-0.5">Proyección actual</div>
              </div>
              <div class="rounded-lg bg-emerald-500/5 border border-emerald-500/10 p-2.5 text-center">
                <div class="text-[9px] uppercase text-emerald-400/70 tracking-wider mb-1">Optimista</div>
                <div class="text-xs font-bold text-emerald-400 tabular-nums">{{ sym }}{{ fmt(chartExplanation.optimisticYrN) }}/año</div>
                <div class="text-[10px] text-zinc-500 mt-0.5">Mayor crecimiento</div>
              </div>
            </div>
          </div>
        </div>

        <!-- Contribution Breakdown — why each asset is in the mix -->
        <div v-if="allocationDetails.length" class="glass-card p-4 mb-4">
          <h3 class="text-xs font-semibold text-foreground uppercase tracking-wider mb-3">¿Por qué estos activos?</h3>

          <div class="space-y-2">
            <div
              v-for="a in allocationDetails" :key="a.ticker"
              class="flex items-center gap-3 p-2.5 rounded-lg bg-white/[0.02] hover:bg-white/[0.04] transition-colors"
            >
              <!-- Color bar + weight -->
              <div class="flex flex-col items-center gap-0.5 w-10 shrink-0">
                <div class="w-2 h-2 rounded-full" :style="{ background: a.color }"></div>
                <span class="text-[11px] font-bold text-foreground tabular-nums">{{ a.weight }}%</span>
              </div>

              <!-- Ticker + role -->
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-1.5">
                  <span class="text-sm font-bold text-foreground">{{ a.ticker }}</span>
                  <span
                    class="text-[9px] font-semibold px-1.5 py-0.5 rounded-full"
                    :style="{ background: a.roleColor + '20', color: a.roleColor }"
                  >{{ a.role }}</span>
                  <span
                    v-if="a.weissSignal"
                    class="text-[9px] font-bold px-1.5 py-0.5 rounded"
                    :class="weissSignalClass(a.weissSignal)"
                  >{{ a.weissSignal }}</span>
                </div>
                <div class="flex items-center gap-3 mt-0.5 text-[10px] text-zinc-500">
                  <span>Yield <span class="text-foreground font-medium">{{ a.yieldPct }}%</span></span>
                  <span>CAGR <span class="font-medium" :class="a.dividendCAGR > 0 ? 'text-emerald-400' : 'text-zinc-400'">{{ a.dividendCAGR > 0 ? '+' : '' }}{{ a.dividendCAGR }}%</span></span>
                  <span v-if="a.weissUpside != null">Upside <span class="font-medium" :class="a.weissUpside > 0 ? 'text-emerald-400' : 'text-red-400'">{{ a.weissUpside > 0 ? '+' : '' }}{{ a.weissUpside }}%</span></span>
                </div>
              </div>

              <!-- Income contribution -->
              <div class="text-right shrink-0">
                <div class="text-[10px] text-zinc-500">Aporta año {{ years }}</div>
                <div class="text-sm font-bold text-primary tabular-nums">{{ sym }}{{ fmt(a.incomeContrib) }}</div>
              </div>
            </div>
          </div>
        </div>

        <!-- Portfolio Impact Card -->
        <div v-if="portfolioImpact && portfolioImpact.currentValue > 0" class="glass-card p-5 mb-4 impact-card">
          <div class="flex items-center justify-between mb-5">
            <h3 class="text-xs font-semibold text-foreground uppercase tracking-wider">Impacto en tu cartera</h3>
            <div class="flex items-center gap-2">
              <div class="flex items-center gap-1.5 text-[10px] text-zinc-500">
                <span class="w-2 h-2 rounded-sm bg-white/10 border border-white/15 inline-block"></span> Actual
              </div>
              <div class="flex items-center gap-1.5 text-[10px] text-primary/80">
                <span class="w-2 h-2 rounded-sm bg-primary/40 border border-primary/50 inline-block"></span> +{{ sym }}{{ fmt(portfolioImpact.addedValue) }}
              </div>
            </div>
          </div>

          <!-- Visual comparison chart -->
          <div class="grid grid-cols-3 gap-3 mb-4">
            <!-- Valor -->
            <div class="impact-metric">
              <div class="text-[10px] text-zinc-500 mb-2 text-center">Valor total</div>
              <div class="impact-bars">
                <div class="impact-col">
                  <div class="impact-bar-bg">
                    <div class="impact-bar-fill-ghost" :style="{ height: Math.round(portfolioImpact.currentValue / portfolioImpact.newValue * 100) + '%' }"></div>
                  </div>
                  <span class="impact-val-sm">{{ sym }}{{ fmt(portfolioImpact.currentValue) }}</span>
                </div>
                <div class="impact-col">
                  <div class="impact-bar-bg">
                    <div class="impact-bar-fill-new" style="height:100%"></div>
                  </div>
                  <span class="impact-val-lg">{{ sym }}{{ fmt(portfolioImpact.newValue) }}</span>
                </div>
              </div>
              <div class="text-center mt-1">
                <span class="text-[10px] text-emerald-400/80 font-medium">+{{ sym }}{{ fmt(portfolioImpact.addedValue) }}</span>
              </div>
            </div>

            <!-- Income -->
            <div class="impact-metric">
              <div class="text-[10px] text-zinc-500 mb-2 text-center">Income anual</div>
              <div class="impact-bars">
                <div class="impact-col">
                  <div class="impact-bar-bg">
                    <div class="impact-bar-fill-ghost" :style="{ height: (portfolioImpact.newIncome > 0 ? Math.max(3, Math.round(portfolioImpact.currentIncome / portfolioImpact.newIncome * 100)) : 3) + '%' }"></div>
                  </div>
                  <span class="impact-val-sm">{{ sym }}{{ fmt(portfolioImpact.currentIncome) }}</span>
                </div>
                <div class="impact-col">
                  <div class="impact-bar-bg">
                    <div class="impact-bar-fill-new" style="height:100%"></div>
                  </div>
                  <span class="impact-val-lg">{{ sym }}{{ fmt(portfolioImpact.newIncome) }}</span>
                </div>
              </div>
              <div class="text-center mt-1">
                <span class="text-[10px] text-emerald-400/80 font-medium">+{{ sym }}{{ fmt(portfolioImpact.incomeDelta) }}/año</span>
              </div>
            </div>

            <!-- Yield bars (same style as Valor / Income) -->
            <div class="impact-metric">
              <div class="text-[10px] text-zinc-500 mb-2 text-center">Yield medio</div>
              <div class="impact-bars">
                <div class="impact-col">
                  <div class="impact-bar-bg">
                    <div class="impact-bar-fill-ghost"
                         :style="{ height: (portfolioImpact.newYield > 0 ? Math.max(8, Math.round(portfolioImpact.currentYield / Math.max(portfolioImpact.newYield, 0.01) * 100)) : 8) + '%' }"></div>
                  </div>
                  <span class="impact-val-sm">{{ fmt(portfolioImpact.currentYield, 1) }}%</span>
                </div>
                <div class="impact-col">
                  <div class="impact-bar-bg">
                    <div class="impact-bar-fill-new" style="height:100%"></div>
                  </div>
                  <span class="impact-val-lg">{{ fmt(portfolioImpact.newYield, 1) }}%</span>
                </div>
              </div>
              <div class="text-center mt-1">
                <span class="text-[10px] font-medium" :class="portfolioImpact.yieldDelta >= 0 ? 'text-emerald-400/80' : 'text-red-400/80'">
                  {{ portfolioImpact.yieldDelta >= 0 ? '+' : '' }}{{ fmt(portfolioImpact.yieldDelta, 2) }}pp
                </span>
              </div>
            </div>
          </div>

          <!-- Footer tags -->
          <div class="flex flex-wrap items-center gap-2 pt-3 border-t border-white/5">
            <span v-if="portfolioImpact.newAssets > 0"
                  class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 text-[11px] font-medium">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>
              {{ portfolioImpact.newAssets }} nuevo{{ portfolioImpact.newAssets > 1 ? 's' : '' }}
            </span>
            <span v-if="portfolioImpact.existingAssets > 0"
                  class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-primary/10 text-primary text-[11px] font-medium">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 20V10M6 20V4M18 20v-4"/></svg>
              Refuerza {{ portfolioImpact.existingAssets }}
            </span>
            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/5 text-zinc-400 text-[11px] font-medium">
              {{ portfolioImpact.totalAssets }} activos en cartera
            </span>
          </div>
        </div>

      </template>

      <!-- Empty state -->
      <div v-else-if="!loading && !error" class="flex flex-col items-center justify-center py-32">
        <div class="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#415BFF" stroke-width="1.5" stroke-linecap="round">
            <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
          </svg>
        </div>
        <p class="text-muted-foreground text-sm mb-1">Indica cuánto quieres invertir</p>
        <p class="text-muted-foreground/50 text-xs">Analizaremos tus {{ allCandidates.length }} activos para encontrar el mejor mix</p>
      </div>
    </div>
  </main>
</template>

<style scoped>
.impact-card {
  background: linear-gradient(135deg, rgba(65,91,255,0.04) 0%, rgba(16,16,20,0.6) 50%, rgba(52,211,153,0.03) 100%);
}
.impact-metric {
  display: flex;
  flex-direction: column;
}
.impact-bars {
  display: flex;
  gap: 6px;
  justify-content: center;
  align-items: flex-end;
  height: 72px;
}
.impact-col {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  flex: 1;
  max-width: 36px;
}
.impact-bar-bg {
  width: 100%;
  height: 56px;
  border-radius: 5px;
  background: rgba(255,255,255,0.03);
  position: relative;
  overflow: hidden;
  display: flex;
  align-items: flex-end;
}
.impact-bar-fill-ghost {
  width: 100%;
  border-radius: 4px 4px 0 0;
  background: rgba(255,255,255,0.07);
  border: 1px solid rgba(255,255,255,0.08);
  border-bottom: none;
  transition: height 0.7s cubic-bezier(0.22, 1, 0.36, 1);
  min-height: 2px;
}
.impact-bar-fill-new {
  width: 100%;
  border-radius: 4px 4px 0 0;
  background: linear-gradient(to top, rgba(65,91,255,0.5), rgba(65,91,255,0.18));
  border: 1px solid rgba(65,91,255,0.3);
  border-bottom: none;
  transition: height 0.7s cubic-bezier(0.22, 1, 0.36, 1) 0.12s;
}
.impact-bar-fill-green {
  width: 100%;
  border-radius: 4px 4px 0 0;
  background: linear-gradient(to top, rgba(52,211,153,0.45), rgba(52,211,153,0.15));
  border: 1px solid rgba(52,211,153,0.3);
  border-bottom: none;
  transition: height 0.7s cubic-bezier(0.22, 1, 0.36, 1) 0.12s;
}
.impact-val-sm {
  font-size: 9px;
  color: rgba(161,161,170,0.5);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.impact-val-lg {
  font-size: 11px;
  color: rgba(255,255,255,0.9);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
</style>
