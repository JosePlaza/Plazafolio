<script setup>
import { ref, computed, onMounted, watch, onBeforeUnmount } from 'vue'
import { getAllCachedAnalyses } from '@/services/assetsApi'
import { useTransactions } from '@/composables/useTransactions'
import { useCurrency } from '@/composables/useCurrency'
import { derivePosition } from '@/services/transactionsApi'
import Highcharts from 'highcharts'
import AnimatedNumber from '@/components/AnimatedNumber.vue'

const props = defineProps({
  actives: { type: Array, default: () => [] },
  visible: { type: Boolean, default: false },
})

const { displaySymbol, convert, nativeCurrencyOf, eurUsdRate } = useCurrency()
const { transactions, load: loadTransactions } = useTransactions()

const analyses = ref({})
const loading = ref(false)

// Calendar state
const calendarYear = ref(new Date().getFullYear())
const calendarMonth = ref(new Date().getMonth()) // 0-11

// Chart
const chartContainer = ref(null)
let chartInstance = null

const MONTH_NAMES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
const MONTH_NAMES_FULL = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

// ── Compute positions from transactions ──────────────────────────────
const positions = computed(() => {
  const result = {}
  for (const asset of props.actives) {
    const txs = transactions.value.filter(tx => tx.assetId === asset.id)
    if (txs.length) {
      const nativeCur = nativeCurrencyOf(asset.ticker)
      const pos = derivePosition(txs, nativeCur, eurUsdRate.value)
      if (pos.shares > 0) {
        result[asset.ticker] = { ...pos, asset }
      }
    }
  }
  return result
})

// ── Detect dividend payment pattern (which months does each ticker pay) ──
function detectPaymentMonths(dividends) {
  if (!dividends || dividends.length < 2) return []
  // Count payments per month over last 3 years
  const monthCounts = new Array(12).fill(0)
  const cutoff = new Date()
  cutoff.setFullYear(cutoff.getFullYear() - 3)

  for (const d of dividends) {
    const date = new Date(d.date)
    if (date >= cutoff) {
      monthCounts[date.getMonth()]++
    }
  }

  // Months with at least 1 payment in last 3 years
  const payMonths = []
  for (let m = 0; m < 12; m++) {
    if (monthCounts[m] >= 1) payMonths.push(m)
  }
  return payMonths
}

// ── Get latest annual dividend per share ──────────────────────────────
function getAnnualDividend(dividends) {
  if (!dividends || dividends.length === 0) return 0
  // Sum last 12 months of dividends
  const cutoff = new Date()
  cutoff.setFullYear(cutoff.getFullYear() - 1)
  let sum = 0
  for (const d of dividends) {
    if (new Date(d.date) >= cutoff) {
      sum += Number(d.amount || d.dividend || 0)
    }
  }
  return sum
}

// ── Dividend calendar data ───────────────────────────────────────────
const calendarData = computed(() => {
  const data = [] // { ticker, logo, name, shares, divPerShare, totalDiv, paymentMonths, nativeCur }

  for (const asset of props.actives) {
    const pos = positions.value[asset.ticker]
    if (!pos || pos.shares <= 0) continue

    const cached = analyses.value[asset.ticker]
    if (!cached?.data?.dividends) continue

    const dividends = cached.data.dividends
    const payMonths = detectPaymentMonths(dividends)
    const annualDiv = getAnnualDividend(dividends)
    const paymentsPerYear = payMonths.length || 4
    const divPerPayment = annualDiv / paymentsPerYear
    const nativeCur = nativeCurrencyOf(asset.ticker)

    data.push({
      ticker: asset.ticker,
      logo: asset.image,
      name: asset.name,
      shares: pos.shares,
      annualDiv,
      divPerPayment,
      totalPerPayment: divPerPayment * pos.shares,
      paymentMonths: payMonths,
      nativeCurrency: nativeCur,
    })
  }

  return data
})

// ── Calendar grid for current month ─────────────────────────────────
const calendarMonthPayments = computed(() => {
  const m = calendarMonth.value
  const payments = []

  for (const item of calendarData.value) {
    if (item.paymentMonths.includes(m)) {
      payments.push({
        ticker: item.ticker,
        logo: item.logo,
        name: item.name,
        shares: item.shares,
        divPerShare: item.divPerPayment,
        total: convert(item.totalPerPayment, item.nativeCurrency),
        nativeCurrency: item.nativeCurrency,
      })
    }
  }

  return payments.sort((a, b) => b.total - a.total)
})

const monthlyTotalExpected = computed(() =>
  calendarMonthPayments.value.reduce((sum, p) => sum + p.total, 0)
)

// ── Full year monthly summary ────────────────────────────────────────
const yearlyMonthlyTotals = computed(() => {
  const totals = new Array(12).fill(0)

  for (const item of calendarData.value) {
    for (const m of item.paymentMonths) {
      totals[m] += convert(item.totalPerPayment, item.nativeCurrency)
    }
  }

  return totals
})

const totalAnnualIncome = computed(() =>
  yearlyMonthlyTotals.value.reduce((sum, v) => sum + v, 0)
)

const monthlyAvgIncome = computed(() =>
  totalAnnualIncome.value / 12
)

// ── Historical income data for chart ─────────────────────────────────
const incomeChartData = computed(() => {
  // Build yearly income from actual dividend data + current positions
  const yearlyIncome = {}

  for (const asset of props.actives) {
    const pos = positions.value[asset.ticker]
    if (!pos || pos.shares <= 0) continue

    const cached = analyses.value[asset.ticker]
    if (!cached?.data?.dividends) continue

    const nativeCur = nativeCurrencyOf(asset.ticker)

    for (const d of cached.data.dividends) {
      const year = String(d.date).substring(0, 4)
      const yearNum = Number(year)
      if (yearNum < 2015) continue

      const amt = Number(d.amount || d.dividend || 0) * pos.shares
      const converted = convert(amt, nativeCur)

      if (!yearlyIncome[year]) yearlyIncome[year] = 0
      yearlyIncome[year] += converted
    }
  }

  // Sort by year
  const years = Object.keys(yearlyIncome).sort()
  return years.map(y => ({
    year: y,
    income: Math.round(yearlyIncome[y] * 100) / 100,
  }))
})

// ── Projected future income (simple CAGR based) ─────────────────────
const projectedIncome = computed(() => {
  const current = totalAnnualIncome.value
  if (current <= 0) return []

  // Calculate weighted average CAGR from all positioned assets
  let totalWeight = 0
  let weightedCagr = 0

  for (const item of calendarData.value) {
    const cached = analyses.value[item.ticker]
    const cagr = cached?.data?.projection?.cagr || 0
    const weight = convert(item.annualDiv * item.shares, item.nativeCurrency)
    weightedCagr += cagr * weight
    totalWeight += weight
  }

  const avgCagr = totalWeight > 0 ? weightedCagr / totalWeight : 3
  const growthRate = 1 + avgCagr / 100

  const currentYear = new Date().getFullYear()
  const projected = []
  for (let i = 1; i <= 5; i++) {
    projected.push({
      year: String(currentYear + i),
      income: Math.round(current * Math.pow(growthRate, i) * 100) / 100,
    })
  }
  return projected
})

// ── Load data ────────────────────────────────────────────────────────
async function loadData() {
  loading.value = true
  try {
    await loadTransactions()
    const data = await getAllCachedAnalyses()
    analyses.value = data || {}
  } catch (err) {
    console.error('[Dividends] Error loading:', err)
  } finally {
    loading.value = false
  }
}

// ── Calendar navigation ──────────────────────────────────────────────
function prevMonth() {
  if (calendarMonth.value === 0) {
    calendarMonth.value = 11
    calendarYear.value--
  } else {
    calendarMonth.value--
  }
}

function nextMonth() {
  if (calendarMonth.value === 11) {
    calendarMonth.value = 0
    calendarYear.value++
  } else {
    calendarMonth.value++
  }
}

// ── Render income chart ──────────────────────────────────────────────
function renderChart() {
  if (!chartContainer.value) return

  const historical = incomeChartData.value
  const projected = projectedIncome.value

  if (historical.length === 0 && projected.length === 0) return

  const allData = [...historical, ...projected]
  const categories = allData.map(d => d.year)

  const historicalSeries = allData.map((d, i) =>
    i < historical.length ? d.income : null
  )
  const projectedSeries = allData.map((d, i) =>
    i >= historical.length - 1
      ? (i === historical.length - 1 ? historical[historical.length - 1]?.income : d.income)
      : null
  )

  if (chartInstance) chartInstance.destroy()

  chartInstance = Highcharts.chart(chartContainer.value, {
    chart: {
      type: 'column',
      backgroundColor: 'transparent',
      height: 280,
      style: { fontFamily: 'inherit' },
    },
    title: { text: null },
    xAxis: {
      categories,
      labels: { style: { color: '#71717a', fontSize: '10px' } },
      lineColor: 'rgba(255,255,255,0.06)',
      tickColor: 'transparent',
    },
    yAxis: {
      title: { text: null },
      labels: {
        style: { color: '#71717a', fontSize: '10px' },
        formatter() { return displaySymbol.value + this.value.toLocaleString() },
      },
      gridLineColor: 'rgba(255,255,255,0.04)',
    },
    legend: {
      itemStyle: { color: '#a1a1aa', fontSize: '10px' },
      itemHoverStyle: { color: '#e4e4e7' },
    },
    tooltip: {
      backgroundColor: 'rgba(14, 14, 22, 0.95)',
      borderColor: 'rgba(255,255,255,0.08)',
      style: { color: '#e4e4e7', fontSize: '11px' },
      formatter() {
        return `<b>${this.x}</b><br/>${this.series.name}: ${displaySymbol.value}${this.y?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      },
    },
    plotOptions: {
      column: {
        borderRadius: 3,
        borderWidth: 0,
      },
    },
    series: [
      {
        name: 'Ingresos reales',
        data: historicalSeries,
        color: '#34d399',
      },
      {
        name: 'Proyectado',
        data: projectedSeries,
        color: 'rgba(52, 211, 153, 0.3)',
        borderColor: '#34d399',
        borderWidth: 1,
        dashStyle: 'Dash',
      },
    ],
    credits: { enabled: false },
  })
}

watch([incomeChartData, projectedIncome], () => {
  if (props.visible) renderChart()
}, { deep: true })

watch(() => props.visible, (val) => {
  if (val) {
    loadData()
    setTimeout(renderChart, 100)
  }
})

onMounted(() => {
  if (props.visible) {
    loadData()
    setTimeout(renderChart, 200)
  }
})

onBeforeUnmount(() => {
  if (chartInstance) {
    chartInstance.destroy()
    chartInstance = null
  }
})

function fmt(val, dec = 2) {
  if (val == null || isNaN(val)) return '-'
  return Number(val).toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec })
}
</script>

<template>
  <div class="max-w-5xl mx-auto">
    <!-- Title -->
    <div class="flex items-center justify-between mb-6">
      <div>
        <h2 class="text-xl font-bold text-foreground tracking-tight">Dividendos</h2>
        <p class="text-muted-foreground text-xs mt-0.5">Calendario de cobros e ingresos por dividendos</p>
      </div>
      <button
        v-if="!loading"
        class="gw-btn-icon"
        title="Actualizar datos"
        @click="loadData"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21.5 2v6h-6" />
          <path d="M2.5 22v-6h6" />
          <path d="M2 11.5a10 10 0 0 1 18.8-4.3L21.5 8" />
          <path d="M22 12.5a10 10 0 0 1-18.8 4.3L2.5 16" />
        </svg>
      </button>
      <div v-else class="spinner" style="width: 20px; height: 20px; border-width: 2px;"></div>
    </div>

    <!-- Empty state -->
    <div v-if="!loading && calendarData.length === 0" class="flex flex-col items-center justify-center py-24">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" class="text-muted-foreground/30 mb-4">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
      <p class="text-muted-foreground text-sm">No hay posiciones con dividendos</p>
      <p class="text-muted-foreground/50 text-xs mt-1">Registra transacciones en tus activos para ver el calendario</p>
    </div>

    <template v-else>
      <!-- KPI Row -->
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <div class="glass-card p-3 text-center">
          <div class="text-[10px] uppercase text-muted-foreground tracking-wider mb-1">Ingreso anual</div>
          <div class="text-lg font-bold text-primary">
            {{ displaySymbol }}<AnimatedNumber :value="totalAnnualIncome" :decimals="0" />
          </div>
        </div>
        <div class="glass-card p-3 text-center">
          <div class="text-[10px] uppercase text-muted-foreground tracking-wider mb-1">Media mensual</div>
          <div class="text-lg font-bold text-foreground">
            {{ displaySymbol }}<AnimatedNumber :value="monthlyAvgIncome" :decimals="0" />
          </div>
        </div>
        <div class="glass-card p-3 text-center">
          <div class="text-[10px] uppercase text-muted-foreground tracking-wider mb-1">Activos pagando</div>
          <div class="text-lg font-bold text-foreground">{{ calendarData.length }}</div>
        </div>
        <div class="glass-card p-3 text-center">
          <div class="text-[10px] uppercase text-muted-foreground tracking-wider mb-1">Este mes</div>
          <div class="text-lg font-bold" :class="monthlyTotalExpected > 0 ? 'text-primary' : 'text-muted-foreground'">
            {{ displaySymbol }}<AnimatedNumber :value="monthlyTotalExpected" :decimals="0" />
          </div>
        </div>
      </div>

      <!-- Calendar month strip -->
      <div class="glass-card p-4 mb-6">
        <div class="flex items-center justify-between mb-4">
          <button class="gw-btn-icon" @click="prevMonth" title="Mes anterior">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m15 18-6-6 6-6"/></svg>
          </button>
          <h3 class="text-sm font-semibold text-foreground">
            {{ MONTH_NAMES_FULL[calendarMonth] }} {{ calendarYear }}
          </h3>
          <button class="gw-btn-icon" @click="nextMonth" title="Mes siguiente">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg>
          </button>
        </div>

        <!-- Month mini bar chart showing all months -->
        <div class="flex gap-1 mb-4" style="height: 40px;">
          <div
            v-for="(total, m) in yearlyMonthlyTotals"
            :key="m"
            class="flex-1 flex flex-col justify-end items-center cursor-pointer group"
            @click="calendarMonth = m"
          >
            <div
              class="w-full rounded-t transition-all duration-200"
              :style="{
                height: (totalAnnualIncome > 0 ? Math.max(2, (total / Math.max(...yearlyMonthlyTotals)) * 32) : 2) + 'px',
                background: m === calendarMonth
                  ? '#34d399'
                  : total > 0 ? 'rgba(52, 211, 153, 0.25)' : 'rgba(255,255,255,0.04)',
              }"
            ></div>
            <span
              class="text-[8px] mt-0.5 tabular-nums"
              :style="{ color: m === calendarMonth ? '#34d399' : '#71717a' }"
            >
              {{ MONTH_NAMES[m] }}
            </span>
          </div>
        </div>

        <!-- Payments this month -->
        <div v-if="calendarMonthPayments.length > 0" class="space-y-2">
          <div
            v-for="payment in calendarMonthPayments"
            :key="payment.ticker"
            class="flex items-center gap-3 p-2 rounded-lg"
            style="background: rgba(255,255,255,0.02);"
          >
            <div v-if="payment.logo" class="w-8 h-8 rounded-lg overflow-hidden shrink-0 bg-white/5 p-0.5">
              <img :src="payment.logo" :alt="payment.ticker" class="w-full h-full object-contain rounded-md" />
            </div>
            <div v-else class="w-8 h-8 rounded-lg shrink-0 bg-primary/10 flex items-center justify-center">
              <span class="text-primary text-[9px] font-bold">{{ payment.ticker?.slice(0, 2) }}</span>
            </div>

            <div class="flex-1 min-w-0">
              <div class="text-xs font-semibold text-foreground truncate">{{ payment.ticker }}</div>
              <div class="text-[10px] text-muted-foreground">
                {{ payment.shares }} acc. × {{ displaySymbol }}{{ fmt(payment.divPerShare, 3) }}
              </div>
            </div>

            <div class="text-right shrink-0">
              <div class="text-sm font-bold text-primary">{{ displaySymbol }}{{ fmt(payment.total) }}</div>
            </div>
          </div>

          <div class="flex justify-between items-center pt-2" style="border-top: 1px solid rgba(255,255,255,0.06);">
            <span class="text-[10px] uppercase text-muted-foreground tracking-wider">Total del mes</span>
            <span class="text-sm font-bold text-primary">{{ displaySymbol }}{{ fmt(monthlyTotalExpected) }}</span>
          </div>
        </div>

        <div v-else class="text-center py-6">
          <p class="text-muted-foreground text-xs">No se esperan cobros este mes</p>
        </div>
      </div>

      <!-- Income Stream Chart -->
      <div class="glass-card p-4 mb-6">
        <h3 class="text-sm font-semibold text-foreground mb-3">Flujo de ingresos por dividendos</h3>
        <p class="text-[10px] text-muted-foreground mb-3">Ingresos históricos y proyección a 5 años basada en el CAGR ponderado de tus posiciones</p>
        <div ref="chartContainer" style="width: 100%; min-height: 280px;"></div>
      </div>

      <!-- Yearly breakdown table -->
      <div class="glass-card p-3 sm:p-4">
        <h3 class="text-sm font-semibold text-foreground mb-3">Desglose mensual {{ calendarYear }}</h3>
        <div class="overflow-x-auto -mx-1" style="-webkit-overflow-scrolling: touch;">
          <table class="w-full text-[9px] sm:text-[10px]" style="min-width: 480px;">
            <thead>
              <tr class="text-muted-foreground uppercase tracking-wider">
                <th class="text-left py-1 pr-1 sticky left-0 z-10" style="background: inherit;">Activo</th>
                <th v-for="m in 12" :key="m" class="text-center py-1 px-0.5 sm:px-1" style="min-width: 32px;">{{ MONTH_NAMES[m - 1] }}</th>
                <th class="text-right py-1 pl-1">Total</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="item in calendarData"
                :key="item.ticker"
                class="border-t"
                style="border-color: rgba(255,255,255,0.04);"
              >
                <td class="py-1.5 pr-2">
                  <span class="font-semibold text-foreground text-[11px]">{{ item.ticker }}</span>
                </td>
                <td v-for="m in 12" :key="m" class="text-center py-1.5 px-1">
                  <span
                    v-if="item.paymentMonths.includes(m - 1)"
                    class="inline-block w-2 h-2 rounded-full"
                    style="background: #34d399;"
                    :title="displaySymbol + fmt(convert(item.totalPerPayment, item.nativeCurrency))"
                  ></span>
                  <span v-else class="text-muted-foreground/20">·</span>
                </td>
                <td class="text-right py-1.5 pl-2 font-semibold text-foreground tabular-nums">
                  {{ displaySymbol }}{{ fmt(convert(item.annualDiv * item.shares, item.nativeCurrency), 0) }}
                </td>
              </tr>
            </tbody>
            <tfoot>
              <tr class="border-t font-semibold" style="border-color: rgba(255,255,255,0.08);">
                <td class="py-2 pr-2 text-foreground text-[11px]">Total</td>
                <td v-for="m in 12" :key="m" class="text-center py-2 px-1 text-primary tabular-nums text-[9px]">
                  {{ yearlyMonthlyTotals[m - 1] > 0 ? displaySymbol + fmt(yearlyMonthlyTotals[m - 1], 0) : '' }}
                </td>
                <td class="text-right py-2 pl-2 text-primary tabular-nums">
                  {{ displaySymbol }}{{ fmt(totalAnnualIncome, 0) }}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </template>
  </div>
</template>
