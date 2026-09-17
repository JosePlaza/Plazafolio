<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import Highcharts from 'highcharts'
import { useCurrency } from '@/composables/useCurrency'
import { useTransactions } from '@/composables/useTransactions'
import AnimatedNumber from '@/components/AnimatedNumber.vue'
import ToastNotification from '@/components/ToastNotification.vue'
import DatePicker from '@/components/DatePicker.vue'
import DividendMonthsCard from '@/components/DividendMonthsCard.vue'
import FinancialReportsSection from '@/components/FinancialReportsSection.vue'
const props = defineProps({
  asset: { type: Object, required: true },
  indicators: { type: Object, default: null },
  projection: { type: Object, default: null },
  dividends: { type: Array, default: () => [] },
  scoring: { type: Object, default: null },
})

const emit = defineEmits(['back', 'save'])

const { symbolFor, convert, convertByTicker, nativeCurrencyOf, forcedCurrency, eurUsdRate } = useCurrency()
const { transactionsForAsset, positionForAsset, addTransaction, removeTransaction, editTransaction, load: loadTx } = useTransactions()

// cv() for use inside computeds (charts) — reactive via computed tracking
const cv = (val) => convertByTicker(val, props.asset.ticker)

// ── Transactions for this asset ──
const assetTxs = transactionsForAsset(props.asset.id)
const position = positionForAsset(props.asset.id, props.asset.ticker)

// ── Add transaction form ──
const addFormEl = ref(null)
const showAddForm = ref(false)
const newTxDate = ref(new Date().toISOString().split('T')[0])
const newTxShares = ref('')
const newTxPrice = ref('')
const newTxNote = ref('')
const newTxType = ref('buy') // 'buy' | 'sell'
const newTxCurrency = ref(forcedCurrency.value)
const txExpanded = ref(false)
const TX_COLLAPSED_COUNT = 5

// ── 3-dot menu, edit, delete confirmation, swipe ──
const txMenuOpen = ref(null)        // id of tx with open dropdown
const txMenuStyle = ref({})         // position for dropdown
const confirmDeleteTx = ref(null)   // { id, shares, price, date } for modal
const editingTxId = ref(null)       // id of tx being edited (populates add form)

// Swipe gesture state (mobile)
const txSwipedId = ref(null)
let txTouchStartX = 0
let txTouchStartY = 0
let txSwiping = false

function onTxTouchStart(e, txId) {
  txTouchStartX = e.touches[0].clientX
  txTouchStartY = e.touches[0].clientY
  txSwiping = false
}

function onTxTouchMove(e, txId) {
  const dx = e.touches[0].clientX - txTouchStartX
  const dy = e.touches[0].clientY - txTouchStartY
  if (!txSwiping && Math.abs(dy) > Math.abs(dx)) return
  if (Math.abs(dx) > 10) {
    txSwiping = true
    e.preventDefault()
  }
}

function onTxTouchEnd(e, txId) {
  if (!txSwiping) return
  const dx = e.changedTouches[0].clientX - txTouchStartX
  if (txSwipedId.value === txId) {
    if (dx > 30) txSwipedId.value = null
  } else {
    if (dx < -40) txSwipedId.value = txId
  }
}

// 3-dot menu
function openTxMenu(e, txId) {
  e.stopPropagation()
  if (txMenuOpen.value === txId) {
    txMenuOpen.value = null
    return
  }
  const rect = e.currentTarget.getBoundingClientRect()
  txMenuStyle.value = {
    top: `${rect.bottom + 4}px`,
    left: `${rect.right - 120}px`,
    zIndex: 99999,
  }
  txMenuOpen.value = txId
}

function closeTxMenu() {
  txMenuOpen.value = null
}

// Close menu on outside click
function onTxMenuOutsideClick(e) {
  if (txMenuOpen.value) {
    txMenuOpen.value = null
  }
}
onMounted(() => document.addEventListener('mousedown', onTxMenuOutsideClick))
onBeforeUnmount(() => document.removeEventListener('mousedown', onTxMenuOutsideClick))

// Delete with confirmation
function requestDeleteTx(tx) {
  txMenuOpen.value = null
  txSwipedId.value = null
  confirmDeleteTx.value = tx
}

async function doDeleteTx() {
  if (!confirmDeleteTx.value) return
  await deleteTx(confirmDeleteTx.value.id)
  confirmDeleteTx.value = null
}

// Edit: populate form with existing tx data
function startEditTx(tx) {
  txMenuOpen.value = null
  txSwipedId.value = null
  editingTxId.value = tx.id
  newTxDate.value = tx.date
  newTxShares.value = Math.abs(tx.shares)
  newTxPrice.value = tx.pricePerShare
  newTxNote.value = tx.note || ''
  newTxType.value = tx.shares > 0 ? 'buy' : 'sell'
  newTxCurrency.value = tx.currency || forcedCurrency.value
  showAddForm.value = true
}

async function submitEdit() {
  const sharesNum = Number(newTxShares.value)
  const priceNum = Number(newTxPrice.value)
  if (!sharesNum || sharesNum <= 0 || !priceNum || priceNum <= 0) return

  const finalShares = newTxType.value === 'sell' ? -sharesNum : sharesNum

  try {
    await editTransaction(editingTxId.value, {
      date: newTxDate.value,
      shares: finalShares,
      pricePerShare: priceNum,
      currency: newTxCurrency.value,
      note: newTxNote.value,
    })

    const pos = position.value
    emit('save', {
      id: props.asset.id,
      shares: pos.shares,
      entryPrice: pos.entryPrice,
    })

    const txSym = newTxCurrency.value === 'EUR' ? '€' : '$'
    showToast(`Transacción actualizada: ${sharesNum} acc a ${txSym}${priceNum.toFixed(2)}`, 'success')

    editingTxId.value = null
    resetForm()
    showAddForm.value = false
  } catch (err) {
    showToast('Error al actualizar la transacción', 'error')
    console.error(err)
  }
}

function cancelEdit() {
  editingTxId.value = null
  resetForm()
  showAddForm.value = false
}

const visibleTxs = computed(() => {
  if (txExpanded.value || assetTxs.value.length <= TX_COLLAPSED_COUNT) return assetTxs.value
  return assetTxs.value.slice(0, TX_COLLAPSED_COUNT)
})
const hasMoreTxs = computed(() => assetTxs.value.length > TX_COLLAPSED_COUNT)

function resetForm() {
  newTxDate.value = new Date().toISOString().split('T')[0]
  newTxShares.value = ''
  newTxPrice.value = ''
  newTxNote.value = ''
  newTxType.value = 'buy'
  newTxCurrency.value = forcedCurrency.value
}

// ── Toast ──
const toastVisible = ref(false)
const toastMessage = ref('')
const toastType = ref('success')

function showToast(message, type = 'success') {
  toastMessage.value = message
  toastType.value = type
  toastVisible.value = true
}

async function submitTransaction() {
  // Route to edit handler if we're editing
  if (editingTxId.value) {
    return submitEdit()
  }

  const sharesNum = Number(newTxShares.value)
  const priceNum = Number(newTxPrice.value)
  if (!sharesNum || sharesNum <= 0 || !priceNum || priceNum <= 0) return

  const finalShares = newTxType.value === 'sell' ? -sharesNum : sharesNum

  try {
    await addTransaction({
      assetId: props.asset.id,
      ticker: props.asset.ticker,
      date: newTxDate.value,
      shares: finalShares,
      pricePerShare: priceNum,
      currency: newTxCurrency.value,
      note: newTxNote.value,
    })

    // Also sync the derived position back to the asset for backwards compat
    const pos = position.value
    emit('save', {
      id: props.asset.id,
      shares: pos.shares,
      entryPrice: pos.entryPrice,
    })

    const txSym = newTxCurrency.value === 'EUR' ? '€' : '$'
    showToast(
      newTxType.value === 'buy'
        ? `Compra registrada: ${sharesNum} acciones a ${txSym}${priceNum.toFixed(2)}`
        : `Venta registrada: ${sharesNum} acciones a ${txSym}${priceNum.toFixed(2)}`,
      'success'
    )

    resetForm()
    showAddForm.value = false
  } catch (err) {
    showToast('Error al registrar la transacción', 'error')
    console.error(err)
  }
}

async function deleteTx(id) {
  try {
    await removeTransaction(id)
    // Sync position back
    const pos = position.value
    emit('save', {
      id: props.asset.id,
      shares: pos.shares,
      entryPrice: pos.entryPrice,
    })
    showToast('Transacción eliminada', 'info')
  } catch (err) {
    showToast('Error al eliminar', 'error')
  }
}

// ── Computed metrics (derived from transactions) ──
const sym = computed(() => symbolFor(props.asset.ticker))
const nativeCur = computed(() => nativeCurrencyOf(props.asset.ticker))
const currentPrice = computed(() => props.indicators?.currentPrice || props.asset.price || 0)
const shares = computed(() => position.value.shares)
const entryPrice = computed(() => position.value.entryPrice)
const hasPosition = computed(() => shares.value > 0 && entryPrice.value > 0)

const annualDivPerShare = computed(() => {
  if (!props.projection?.historical?.length) return 0
  return props.projection.historical[props.projection.historical.length - 1]?.dividend || 0
})

// Reactive converted values for template/AnimatedNumber
const convertedCurrentPrice = computed(() => convertByTicker(currentPrice.value, props.asset.ticker))
const convertedAnnualDivPerShare = computed(() => convertByTicker(annualDivPerShare.value, props.asset.ticker))
const convertedEntryPrice = computed(() => convertByTicker(entryPrice.value, props.asset.ticker))

const positionValue = computed(() => convertedCurrentPrice.value * shares.value)
const annualIncome = computed(() => convertedAnnualDivPerShare.value * shares.value)
const yieldOnCost = computed(() => entryPrice.value > 0 ? (annualDivPerShare.value / entryPrice.value) * 100 : 0)
const currentYield = computed(() => props.indicators?.currentYield || 0)
const pnlPct = computed(() => entryPrice.value > 0 ? ((currentPrice.value - entryPrice.value) / entryPrice.value) * 100 : 0)
const pnlAbs = computed(() => hasPosition.value ? (currentPrice.value - entryPrice.value) * shares.value : 0)
const displayPnlAbs = computed(() => convert(pnlAbs.value, nativeCur.value))
const cagr = computed(() => props.projection?.cagr || 0)

// ── Signal ──
function yieldZone() {
  if (!props.indicators) return { label: '-', color: '#71717a' }
  const { currentYield: cy, avgHighYield, avgLowYield, avgYield } = props.indicators
  if (cy >= avgHighYield) return { label: 'Infravalorado', color: '#34d399' }
  if (cy <= avgLowYield) return { label: 'Sobrevalorado', color: '#f87171' }
  if (cy > avgYield) return { label: 'Valor Medio-Bajo', color: '#6ee7b7' }
  return { label: 'Valor Medio-Alto', color: '#fbbf24' }
}
const zone = computed(() => yieldZone())


// ── Price chart with buy/sell markers ──
const priceChartContainer = ref(null)
let priceChartInstance = null
const priceData = ref([])
const priceLoading = ref(false)

const timeframes = [
  { key: '1y', label: '1A', years: 1 },
  { key: '3y', label: '3A', years: 3 },
  { key: '5y', label: '5A', years: 5 },
  { key: '10y', label: '10A', years: 10 },
]
const selectedTimeframe = ref('1y')

function getFromDate(yearsBack) {
  const d = new Date()
  d.setFullYear(d.getFullYear() - yearsBack)
  return d.toISOString().split('T')[0]
}

async function fetchPriceData() {
  const tf = timeframes.find(t => t.key === selectedTimeframe.value)
  if (!tf) return
  priceLoading.value = true
  try {
    const from = getFromDate(tf.years)
    const to = new Date().toISOString().split('T')[0]
    const res = await fetch(`/api/prices?symbol=${encodeURIComponent(props.asset.ticker)}&from=${from}&to=${to}`)
    priceData.value = await res.json()
  } catch (err) {
    console.error('Error fetching price data:', err)
    priceData.value = []
  } finally {
    priceLoading.value = false
  }
}

const priceChartOptions = computed(() => {
  if (!priceData.value.length) return null
  const c = sym.value

  const seriesData = priceData.value.map(p => [new Date(p.date + 'T00:00:00').getTime(), cv(p.close)])

  // Build buy/sell markers from transactions
  const buys = []
  const sells = []
  const txs = assetTxs.value || []

  // Get the date range of our price data for filtering
  const firstDate = priceData.value[0]?.date
  const lastDate = priceData.value[priceData.value.length - 1]?.date

  txs.forEach(tx => {
    if (!tx.date) return
    if (firstDate && tx.date < firstDate) return

    // Find closest price point to snap y value
    const txTime = new Date(tx.date + 'T00:00:00').getTime()
    const closest = priceData.value.reduce((prev, curr) => {
      const prevDiff = Math.abs(new Date(prev.date + 'T00:00:00').getTime() - txTime)
      const currDiff = Math.abs(new Date(curr.date + 'T00:00:00').getTime() - txTime)
      return currDiff < prevDiff ? curr : prev
    })
    // Use the closest price point's timestamp for x if tx is beyond chart range
    const snapTime = lastDate && tx.date > lastDate
      ? new Date(closest.date + 'T00:00:00').getTime()
      : txTime
    const yVal = cv(closest.close)

    const point = {
      x: snapTime,
      y: yVal,
      shares: Math.abs(tx.shares),
      price: tx.pricePerShare,
      cur: tx.currency === 'EUR' ? '€' : '$',
    }

    if (tx.shares > 0) buys.push(point)
    else sells.push(point)
  })

  // Build running average entry price line
  const avgPriceLine = []
  if (txs.length) {
    const nativeCur = nativeCurrencyOf(props.asset.ticker)
    const rate = eurUsdRate.value || 1.14

    // Sort oldest first
    const sortedTxs = [...txs].sort((a, b) => a.date.localeCompare(b.date))

    let totalShares = 0
    let totalCost = 0 // in native currency

    sortedTxs.forEach(tx => {
      // Normalize tx price to native currency
      let priceNative = tx.pricePerShare
      if (tx.currency === 'EUR' && nativeCur === 'USD') priceNative = priceNative * rate
      else if (tx.currency === 'USD' && nativeCur === 'EUR') priceNative = priceNative / rate

      if (tx.shares > 0) {
        // Buy: add to weighted average
        totalCost += tx.shares * priceNative
        totalShares += tx.shares
      } else {
        // Sell: reduce shares proportionally (cost basis doesn't change per share)
        const sellShares = Math.abs(tx.shares)
        if (totalShares > 0) {
          const avgCost = totalCost / totalShares
          totalShares -= sellShares
          totalCost = totalShares * avgCost
        }
      }

      if (totalShares > 0) {
        const avgEntry = totalCost / totalShares
        const txTime = new Date(tx.date + 'T00:00:00').getTime()
        avgPriceLine.push([txTime, cv(avgEntry)])
      }
    })

    // Extend to end of chart
    if (avgPriceLine.length && lastDate) {
      const lastTime = new Date(lastDate + 'T00:00:00').getTime()
      const lastAvg = avgPriceLine[avgPriceLine.length - 1][1]
      if (totalShares > 0) {
        avgPriceLine.push([lastTime, lastAvg])
      }
    }
  }

  return {
    chart: {
      type: 'area',
      backgroundColor: 'transparent',
      style: { fontFamily: 'Inter, system-ui, sans-serif' },
      spacing: [8, 8, 8, 8],
      height: 280,
    },
    title: { text: null },
    xAxis: {
      type: 'datetime',
      labels: {
        style: { color: '#71717a', fontSize: '9px' },
        format: '{value:%b %y}',
      },
      lineColor: 'rgba(255,255,255,0.06)',
      tickLength: 0,
      crosshair: { color: 'rgba(255,255,255,0.08)', dashStyle: 'Dot' },
    },
    yAxis: {
      title: { text: null },
      labels: {
        style: { color: '#71717a', fontSize: '9px' },
        formatter() { return c + this.value.toFixed(0) },
      },
      gridLineColor: 'rgba(255,255,255,0.04)',
      gridLineDashStyle: 'Dot',
    },
    legend: { enabled: false },
    tooltip: {
      useHTML: true,
      backgroundColor: 'transparent',
      borderWidth: 0,
      shadow: false,
      padding: 0,
      formatter() {
        const dateStr = Highcharts.dateFormat('%e %b %Y', this.x)
        if (this.series.name === 'Compras' || this.series.name === 'Ventas') {
          const p = this.point
          return `<div style="background:rgba(14,14,22,0.92);backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:8px 12px;box-shadow:0 8px 32px rgba(0,0,0,0.4);">
            <div style="color:#a1a1aa;font-size:10px;margin-bottom:3px;">${dateStr}</div>
            <div style="color:${this.series.name === 'Compras' ? '#34d399' : '#f87171'};font-size:11px;font-weight:600;">${this.series.name}: ${p.shares} acc × ${p.cur}${p.price.toFixed(2)}</div>
          </div>`
        }
        if (this.series.name === 'Precio medio') {
          return `<div style="background:rgba(14,14,22,0.92);backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:8px 12px;box-shadow:0 8px 32px rgba(0,0,0,0.4);">
            <div style="color:#a1a1aa;font-size:10px;margin-bottom:3px;">${dateStr}</div>
            <div style="color:#fbbf24;font-size:11px;font-weight:600;">Precio medio: ${c}${this.y?.toFixed(2)}</div>
          </div>`
        }
        return `<div style="background:rgba(14,14,22,0.92);backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:8px 12px;box-shadow:0 8px 32px rgba(0,0,0,0.4);">
          <div style="color:#a1a1aa;font-size:10px;margin-bottom:3px;">${dateStr}</div>
          <div style="color:#e4e4e7;font-size:11px;font-weight:600;">${c}${this.y?.toFixed(2)}</div>
        </div>`
      },
    },
    plotOptions: {
      area: {
        fillColor: {
          linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 },
          stops: [
            [0, 'rgba(65, 91, 255, 0.15)'],
            [1, 'rgba(65, 91, 255, 0.0)'],
          ],
        },
        lineWidth: 1.5,
        threshold: null,
        marker: { enabled: false },
      },
    },
    series: [
      {
        name: 'Precio',
        data: seriesData,
        color: '#415BFF',
        zIndex: 1,
      },
      ...(buys.length ? [{
        name: 'Compras',
        type: 'scatter',
        data: buys,
        color: '#34d399',
        zIndex: 2,
        marker: {
          symbol: 'triangle',
          radius: 6,
          lineWidth: 1,
          lineColor: '#34d399',
          fillColor: 'rgba(52,211,153,0.3)',
        },
      }] : []),
      ...(sells.length ? [{
        name: 'Ventas',
        type: 'scatter',
        data: sells,
        color: '#f87171',
        zIndex: 2,
        marker: {
          symbol: 'triangle-down',
          radius: 6,
          lineWidth: 1,
          lineColor: '#f87171',
          fillColor: 'rgba(248,113,113,0.3)',
        },
      }] : []),
      ...(avgPriceLine.length > 1 ? [{
        name: 'Precio medio',
        type: 'line',
        data: avgPriceLine,
        color: '#fbbf24',
        dashStyle: 'Dash',
        lineWidth: 1.5,
        zIndex: 1,
        step: 'left',
        marker: { enabled: false },
        enableMouseTracking: true,
      }] : []),
    ],
    credits: { enabled: false },
  }
})

function renderPriceChart() {
  if (priceChartOptions.value && priceChartContainer.value) {
    if (priceChartInstance) priceChartInstance.destroy()
    priceChartInstance = Highcharts.chart(priceChartContainer.value, priceChartOptions.value)
  }
}

watch(priceChartOptions, renderPriceChart, { deep: true })
watch(selectedTimeframe, fetchPriceData)


onMounted(() => {
  loadTx()
  fetchPriceData()
})
onBeforeUnmount(() => {
  if (priceChartInstance) { priceChartInstance.destroy(); priceChartInstance = null }
})

function fmt(val, dec = 2) { if (val == null || isNaN(val)) return '-'; return Number(val).toFixed(dec) }
function fmtK(val) {
  if (val == null) return '-'
  if (Math.abs(val) >= 1e6) return (val / 1e6).toFixed(1) + 'M'
  if (Math.abs(val) >= 1e3) return (val / 1e3).toFixed(1) + 'K'
  return val.toFixed(0)
}

function fmtDate(dateStr) {
  if (!dateStr) return '-'
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
}
</script>

<template>
  <div class="max-w-4xl mx-auto overflow-x-hidden">
    <!-- ═══ Portfolio detail view ═══ -->
    <template v-if="true">
    <!-- Back + Header -->
    <div class="flex items-center gap-4 mb-6">
      <button
        class="gw-btn-icon w-9 h-9 shrink-0"
        @click="emit('back')"
        title="Volver al portfolio"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>

      <div v-if="asset.image" class="w-11 h-11 rounded-xl overflow-hidden shrink-0 bg-white/5 p-1">
        <img :src="asset.image" :alt="asset.ticker" class="w-full h-full object-contain rounded-lg" />
      </div>
      <div v-else class="w-11 h-11 rounded-xl shrink-0 bg-primary/10 flex items-center justify-center">
        <span class="text-primary text-sm font-bold">{{ asset.ticker?.slice(0, 2) }}</span>
      </div>

      <div class="flex-1 min-w-0">
        <h1 class="text-xl font-bold text-foreground tracking-tight truncate leading-tight">
          {{ asset.name || asset.ticker }}
        </h1>
        <div class="flex items-center gap-3 mt-0.5">
          <span class="text-muted-foreground text-xs">{{ asset.ticker }}</span>
          <span class="text-[9px] text-zinc-400">{{ indicators?.sector || '-' }}</span>
        </div>
      </div>

    </div>

    <!-- ═══ Add Transaction Form ═══ -->
    <Transition name="slide-fade">
      <div v-if="showAddForm" ref="addFormEl" class="glass-card p-5 mb-4" style="border-color: rgba(65, 91, 255, 0.2);">
        <div class="flex items-center gap-2 mb-4">
          <svg v-if="!editingTxId" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#415BFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#415BFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
          <span class="text-sm font-semibold text-foreground">{{ editingTxId ? 'Editar transacción' : 'Registrar transacción' }}</span>
        </div>

        <!-- Buy/Sell toggle -->
        <div class="flex gap-2 mb-4">
          <button
            class="flex-1 py-2 rounded-lg text-xs font-semibold uppercase tracking-wider transition-all"
            :class="newTxType === 'buy'
              ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
              : 'bg-white/5 text-zinc-500 border border-white/5 hover:text-zinc-300'"
            @click="newTxType = 'buy'"
          >
            Compra
          </button>
          <button
            class="flex-1 py-2 rounded-lg text-xs font-semibold uppercase tracking-wider transition-all"
            :class="newTxType === 'sell'
              ? 'bg-red-500/15 text-red-400 border border-red-500/30'
              : 'bg-white/5 text-zinc-500 border border-white/5 hover:text-zinc-300'"
            @click="newTxType = 'sell'"
          >
            Venta
          </button>
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <div>
            <label class="text-[10px] uppercase text-zinc-400 tracking-wider block mb-1.5">Fecha</label>
            <DatePicker v-model="newTxDate" />
          </div>
          <div>
            <label class="text-[10px] uppercase text-zinc-400 tracking-wider block mb-1.5">Acciones</label>
            <input
              v-model.number="newTxShares"
              type="number"
              min="0"
              step="1"
              class="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-primary/40 transition-colors tabular-nums"
              placeholder="0"
            />
          </div>
          <div>
            <label class="text-[10px] uppercase text-zinc-400 tracking-wider block mb-1.5">Precio</label>
            <div class="flex">
              <button
                type="button"
                class="shrink-0 px-2.5 rounded-l-lg text-xs font-bold border border-r-0 transition-colors"
                :class="newTxCurrency === 'EUR'
                  ? 'bg-primary/15 text-primary border-primary/30'
                  : 'bg-white/5 text-zinc-400 border-white/10 hover:text-zinc-200'"
                @click="newTxCurrency = newTxCurrency === 'EUR' ? 'USD' : 'EUR'"
                :title="'Divisa: ' + newTxCurrency"
              >
                {{ newTxCurrency === 'EUR' ? '€' : '$' }}
              </button>
              <input
                v-model.number="newTxPrice"
                type="number"
                min="0"
                step="0.01"
                class="w-full bg-white/5 border border-white/10 rounded-r-lg px-3 py-2 text-sm text-foreground outline-none focus:border-primary/40 transition-colors tabular-nums"
                placeholder="0.00"
              />
            </div>
          </div>
          <div>
            <label class="text-[10px] uppercase text-zinc-400 tracking-wider block mb-1.5">Nota</label>
            <input
              v-model="newTxNote"
              type="text"
              class="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-primary/40 transition-colors"
              placeholder="Opcional..."
            />
          </div>
        </div>

        <div class="flex justify-end gap-2">
          <button
            class="px-4 py-1.5 rounded-lg text-[11px] font-medium text-zinc-400 hover:text-zinc-200 hover:bg-white/5 transition-colors"
            @click="editingTxId ? cancelEdit() : (showAddForm = false, resetForm())"
          >
            Cancelar
          </button>
          <button
            class="px-4 py-1.5 rounded-lg text-[11px] font-medium text-white transition-colors"
            :class="editingTxId ? 'bg-primary hover:bg-primary/80' : newTxType === 'buy' ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-red-600 hover:bg-red-500'"
            @click="submitTransaction"
          >
            {{ editingTxId ? 'Guardar cambios' : newTxType === 'buy' ? 'Registrar compra' : 'Registrar venta' }}
          </button>
        </div>
      </div>
    </Transition>

    <!-- ═══ Consolidated KPIs Card ═══ -->
    <div class="glass-card p-4 mb-4">
      <!-- Row 1: Market metrics -->
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-x-3 sm:gap-x-4 gap-y-2 sm:gap-y-0.5">
        <div>
          <div class="text-[10px] uppercase text-zinc-400 tracking-wider mb-0.5">Precio</div>
          <div class="text-base font-bold text-foreground tabular-nums"><AnimatedNumber :value="convertedCurrentPrice" :prefix="sym" /></div>
        </div>
        <div>
          <div class="text-[10px] uppercase text-zinc-400 tracking-wider mb-0.5">Yield</div>
          <div class="text-base font-bold text-primary tabular-nums"><AnimatedNumber :value="currentYield" suffix="%" /></div>
        </div>
        <div>
          <div class="text-[10px] uppercase text-zinc-400 tracking-wider mb-0.5">Zona</div>
          <div class="text-sm font-bold truncate" :style="{ color: zone.color }">{{ zone.label }}</div>
        </div>
        <div>
          <div class="text-[10px] uppercase text-zinc-400 tracking-wider mb-0.5">CAGR Div.</div>
          <div class="text-base font-bold tabular-nums" :style="{ color: cagr >= 0 ? '#34d399' : '#f87171' }">
            <AnimatedNumber :value="cagr" :prefix="cagr >= 0 ? '+' : ''" suffix="%" />
          </div>
        </div>
      </div>

      <!-- Row 2: Position metrics (if has position) -->
      <div v-if="hasPosition" class="grid grid-cols-2 sm:grid-cols-4 gap-x-3 sm:gap-x-4 gap-y-2 mt-3 pt-3 border-t border-white/5">
        <div>
          <div class="text-[10px] uppercase text-zinc-400 tracking-wider mb-0.5">Valor</div>
          <div class="text-base font-bold text-foreground tabular-nums"><AnimatedNumber :value="positionValue" :prefix="sym" :decimals="0" /></div>
          <div class="text-[9px] text-zinc-500 tabular-nums">{{ fmt(shares, 2) }} acc × {{ sym }}{{ fmt(convertedCurrentPrice) }}</div>
        </div>
        <div>
          <div class="text-[10px] uppercase text-zinc-400 tracking-wider mb-0.5">YoC</div>
          <div class="text-base font-bold text-primary tabular-nums"><AnimatedNumber :value="yieldOnCost" suffix="%" /></div>
          <div class="text-[9px] text-zinc-500 tabular-nums">vs {{ fmt(currentYield) }}% actual</div>
        </div>
        <div>
          <div class="text-[10px] uppercase text-zinc-400 tracking-wider mb-0.5">Ingreso/año</div>
          <div class="text-base font-bold text-emerald-400 tabular-nums"><AnimatedNumber :value="annualIncome" :prefix="sym" /></div>
          <div class="text-[9px] text-zinc-500 tabular-nums">{{ sym }}{{ fmt(convertedAnnualDivPerShare) }}/acc</div>
        </div>
        <div>
          <div class="text-[10px] uppercase text-zinc-400 tracking-wider mb-0.5">P&amp;L</div>
          <div class="text-base font-bold tabular-nums" :style="{ color: pnlPct >= 0 ? '#34d399' : '#f87171' }">
            <AnimatedNumber :value="pnlPct" :prefix="pnlPct >= 0 ? '+' : ''" suffix="%" />
          </div>
          <div class="text-[9px] tabular-nums" :style="{ color: pnlPct >= 0 ? '#34d399' : '#f87171' }">
            {{ displayPnlAbs >= 0 ? '+' : '' }}{{ sym }}{{ fmtK(displayPnlAbs) }}
          </div>
        </div>
      </div>

      <!-- No position hint (inline) — only if zero transactions -->
      <div v-if="!hasPosition && !assetTxs.length" class="mt-3 pt-3 border-t border-white/5 text-center">
        <p class="text-zinc-400 text-xs mb-2">Sin transacciones registradas</p>
        <button
          class="px-3 py-1 rounded-lg text-[10px] font-medium text-white bg-primary/80 hover:bg-primary transition-colors"
          @click="showAddForm = true; nextTick(() => addFormEl?.scrollIntoView({ behavior: 'smooth', block: 'start' }))"
        >
          Registrar primera compra
        </button>
      </div>
    </div>

    <!-- ═══ Price Chart Card ═══ -->
    <div class="glass-card p-4 mb-4">
      <div class="flex items-center justify-between mb-2">
        <h3 class="text-xs font-semibold text-foreground uppercase tracking-wider">Cotización</h3>
        <div class="flex gap-1">
          <button
            v-for="tf in timeframes" :key="tf.key"
            class="px-2 py-0.5 rounded-md text-[10px] font-semibold transition-colors"
            :class="selectedTimeframe === tf.key
              ? 'bg-primary/15 text-primary'
              : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/5'"
            @click="selectedTimeframe = tf.key"
          >
            {{ tf.label }}
          </button>
        </div>
      </div>
      <div ref="priceChartContainer" class="w-full" style="height: 280px;"></div>
    </div>

    <!-- ═══ Transactions Card ═══ -->
    <div v-if="assetTxs.length" class="glass-card p-4 mb-4">
      <!-- Header: title + badge + add button -->
      <div class="flex items-center justify-between mb-1">
        <div class="flex items-center gap-2">
          <h3 class="text-xs font-semibold text-foreground uppercase tracking-wider">
            Transacciones
          </h3>
          <span class="text-[10px] font-semibold text-zinc-400 bg-white/5 px-1.5 py-0.5 rounded-md tabular-nums">
            {{ assetTxs.length }}
          </span>
        </div>
        <button
          class="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-medium transition-colors"
          :class="showAddForm ? 'text-zinc-200 bg-white/10' : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/5'"
          @click="editingTxId = null; resetForm(); showAddForm = !showAddForm"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Añadir
        </button>
      </div>

      <!-- Subtitle: position summary -->
      <div class="text-[10px] text-zinc-400 mb-3 tabular-nums">
        Posición: {{ fmt(shares, 2) }} acciones | {{ sym }}{{ fmt(convertedEntryPrice) }} precio medio
      </div>

      <!-- Transaction rows -->
      <div class="space-y-0.5">
        <div
          v-for="tx in visibleTxs"
          :key="tx.id"
          class="tx-swipe-row"
        >
          <div
            class="tx-row-inner group tx-swipe-item"
            :class="txSwipedId === tx.id ? 'swiped' : ''"
            @touchstart.passive="onTxTouchStart($event, tx.id)"
            @touchmove="onTxTouchMove($event, tx.id)"
            @touchend="onTxTouchEnd($event, tx.id)"
          >
            <!-- Left: badge + two lines -->
            <span
              class="w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-bold shrink-0 self-start mt-0.5"
              :class="tx.shares > 0
                ? 'bg-emerald-500/10 text-emerald-400'
                : 'bg-red-500/10 text-red-400'"
            >
              {{ tx.shares > 0 ? 'C' : 'V' }}
            </span>

            <div class="flex-1 min-w-0">
              <!-- Line 1: date -->
              <div class="text-[11px] text-zinc-400 tabular-nums">{{ fmtDate(tx.date) }}</div>
              <!-- Line 2: shares × price = total -->
              <div class="flex items-center gap-1 mt-0.5">
                <span class="text-[11px] text-zinc-300 tabular-nums">
                  {{ Math.abs(tx.shares) }} acc × {{ tx.currency === 'EUR' ? '€' : '$' }}{{ fmt(tx.pricePerShare) }}
                </span>
                <span class="text-[10px] text-zinc-500 mx-0.5">=</span>
                <span class="text-[11px] text-foreground font-medium tabular-nums">
                  {{ tx.currency === 'EUR' ? '€' : '$' }}{{ fmt(Math.abs(tx.shares) * tx.pricePerShare) }}
                </span>
              </div>
            </div>

            <!-- Desktop: 3-dot menu (hover) -->
            <button
              class="hidden lg:block opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-zinc-200 transition-all shrink-0 ml-0.5 p-1 rounded-md hover:bg-white/5"
              @click.stop="openTxMenu($event, tx.id)"
              title="Opciones"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="5" r="1.5" />
                <circle cx="12" cy="12" r="1.5" />
                <circle cx="12" cy="19" r="1.5" />
              </svg>
            </button>
          </div>

          <!-- Mobile: swipe action buttons -->
          <div
            class="lg:hidden tx-swipe-actions"
            :class="txSwipedId === tx.id ? 'visible' : ''"
          >
            <button
              class="tx-swipe-btn tx-swipe-edit"
              @click="startEditTx(tx)"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </button>
            <button
              class="tx-swipe-btn tx-swipe-delete"
              @click="requestDeleteTx(tx)"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <!-- Show more / less toggle -->
      <div v-if="hasMoreTxs" class="mt-2 pt-2 border-t border-white/5">
        <button
          class="w-full flex items-center justify-center gap-1.5 py-1.5 text-[10px] font-medium text-zinc-400 hover:text-zinc-200 transition-colors rounded-lg hover:bg-white/[0.03]"
          @click="txExpanded = !txExpanded"
        >
          <span>{{ txExpanded ? 'Mostrar menos' : `Mostrar todas (${assetTxs.length})` }}</span>
          <svg
            width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
            class="transition-transform duration-300"
            :class="txExpanded ? 'rotate-180' : ''"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </div>
    </div>

    <!-- ═══ Meses de pago del dividendo ═══ -->
    <DividendMonthsCard
      :ticker="asset.ticker"
      :dividends="dividends"
      :shares="shares"
    />

    <!-- ═══ Informes de resultados + seguridad del dividendo + earnings call ═══ -->
    <FinancialReportsSection :ticker="asset.ticker" class="mb-4" />

    <!-- Toast notification -->
    <ToastNotification
      :visible="toastVisible"
      :message="toastMessage"
      :type="toastType"
      @close="toastVisible = false"
    />
    </template><!-- end portfolio detail -->

    <!-- 3-dot dropdown menu (Teleport) -->
    <Teleport to="body">
      <Transition name="tx-menu-fade">
        <div
          v-if="txMenuOpen"
          class="fixed w-[140px] rounded-xl py-1 tx-dropdown"
          :style="txMenuStyle"
          @mousedown.stop
        >
          <button
            class="w-full flex items-center gap-2.5 px-3.5 py-2 text-[11px] text-zinc-300 hover:text-foreground hover:bg-white/5 transition-colors text-left"
            @click="startEditTx(assetTxs.find(t => t.id === txMenuOpen))"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
            Editar
          </button>
          <div class="mx-2 my-0.5 border-t border-white/5" />
          <button
            class="w-full flex items-center gap-2.5 px-3.5 py-2 text-[11px] text-red-400 hover:text-red-300 hover:bg-red-500/5 transition-colors text-left"
            @click="requestDeleteTx(assetTxs.find(t => t.id === txMenuOpen))"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
            </svg>
            Eliminar
          </button>
        </div>
      </Transition>
    </Teleport>

    <!-- Delete confirmation modal -->
    <Teleport to="body">
      <Transition name="confirm-fade">
        <div
          v-if="confirmDeleteTx"
          class="fixed inset-0 z-[60] flex items-center justify-center"
          @click.self="confirmDeleteTx = null"
        >
          <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div class="relative z-10 w-72 rounded-2xl p-5" style="background: rgba(14, 14, 22, 0.95); border: 1px solid rgba(255,255,255,0.08);">
            <div class="flex flex-col items-center text-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-destructive/10 flex items-center justify-center">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                </svg>
              </div>
              <div>
                <p class="text-sm font-semibold text-foreground">Eliminar transacción</p>
                <p class="text-xs text-muted-foreground mt-1">
                  {{ confirmDeleteTx.shares > 0 ? 'Compra' : 'Venta' }} de {{ Math.abs(confirmDeleteTx.shares) }} acc a {{ confirmDeleteTx.currency === 'EUR' ? '€' : '$' }}{{ fmt(confirmDeleteTx.pricePerShare) }} el {{ fmtDate(confirmDeleteTx.date) }}
                </p>
              </div>
              <div class="flex gap-2 w-full mt-1">
                <button
                  class="flex-1 h-9 rounded-xl text-sm font-medium text-muted-foreground border border-white/8 hover:bg-white/5 transition-colors"
                  @click="confirmDeleteTx = null"
                >
                  Cancelar
                </button>
                <button
                  class="flex-1 h-9 rounded-xl text-sm font-medium text-white bg-destructive/80 hover:bg-destructive transition-colors"
                  @click="doDeleteTx"
                >
                  Eliminar
                </button>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.slide-fade-enter-active,
.slide-fade-leave-active {
  transition: all 0.2s ease;
}
.slide-fade-enter-from,
.slide-fade-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

/* ── Transaction list wrapper ── */
.tx-list-wrapper {
  transition: max-height 0.3s ease-in-out;
  overflow: hidden;
}

/* ── Swipe row structure ── */
.tx-swipe-row {
  display: flex;
  align-items: center;
  gap: 4px;
  overflow: visible;
}

.tx-row-inner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 10px;
  transition: background 0.15s ease, flex 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  min-width: 0;
}
.tx-row-inner:hover {
  background: rgba(255, 255, 255, 0.02);
}

.tx-swipe-item {
  flex: 1;
  min-width: 0;
  transition: flex 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}
.tx-swipe-item.swiped {
  flex: 1 1 0;
}

/* Mobile swipe action buttons */
.tx-swipe-actions {
  display: flex;
  gap: 3px;
  width: 0;
  min-width: 0;
  opacity: 0;
  overflow: visible;
  flex-shrink: 0;
  position: relative;
  z-index: 5;
  transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1),
              opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1),
              min-width 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}
.tx-swipe-actions.visible {
  width: 72px;
  min-width: 72px;
  opacity: 1;
}

.tx-swipe-btn {
  width: 32px;
  height: 32px;
  min-width: 32px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.15s ease;
}
.tx-swipe-edit {
  color: #60a5fa;
  background: rgba(96, 165, 250, 0.1);
  border: 1px solid rgba(96, 165, 250, 0.2);
}
.tx-swipe-edit:active {
  background: rgba(96, 165, 250, 0.2);
}
.tx-swipe-delete {
  color: #f87171;
  background: rgba(248, 113, 113, 0.1);
  border: 1px solid rgba(248, 113, 113, 0.2);
}
.tx-swipe-delete:active {
  background: rgba(248, 113, 113, 0.2);
}

/* ── 3-dot dropdown ── */
.tx-dropdown {
  background: rgba(12, 12, 20, 0.55);
  backdrop-filter: blur(48px) saturate(1.6);
  -webkit-backdrop-filter: blur(48px) saturate(1.6);
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow:
    0 16px 48px rgba(0, 0, 0, 0.5),
    0 0 0 1px rgba(255, 255, 255, 0.06) inset;
}

.tx-menu-fade-enter-active {
  transition: all 0.12s cubic-bezier(0.16, 1, 0.3, 1);
}
.tx-menu-fade-leave-active {
  transition: all 0.08s ease-in;
}
.tx-menu-fade-enter-from {
  opacity: 0;
  transform: translateY(-4px) scale(0.96);
}
.tx-menu-fade-leave-to {
  opacity: 0;
  transform: translateY(-2px) scale(0.98);
}

/* ── Delete confirmation modal ── */
.confirm-fade-enter-active,
.confirm-fade-leave-active {
  transition: opacity 0.2s ease;
}
.confirm-fade-enter-from,
.confirm-fade-leave-to {
  opacity: 0;
}

</style>
