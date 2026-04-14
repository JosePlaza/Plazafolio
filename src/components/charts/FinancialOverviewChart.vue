<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import Highcharts from 'highcharts'
import ChartInfoOverlay from '@/components/ChartInfoOverlay.vue'
import { labelStyle, gridColor, titleStyle, earthyBrown, legendBottom, fmtNum, yearFromDate, buildTooltip, freshSubtitle } from '@/lib/chartConfig'
import { useCurrency } from '@/composables/useCurrency'

const props = defineProps({
  fundamentals: { type: Object, default: null },
  ticker: { type: String, default: '' },
  currency: { type: String, default: '$' },
  freshLabel: { type: String, default: '' },
})

const { convertByTicker } = useCurrency()
const cv = (val) => convertByTicker(val, props.ticker)

const chartContainer = ref(null)
let chartInstance = null

const hasData = computed(() => {
  const inc = props.fundamentals?.income
  return inc && inc.length > 0 && inc.some(d => d.totalRevenue)
})

const chartOptions = computed(() => {
  if (!hasData.value) return null
  const inc = props.fundamentals.income || []
  const bal = props.fundamentals.balance || []
  const cf = props.fundamentals.cashFlow || []

  // Align all data by year
  const allYears = [...new Set([
    ...inc.map(d => yearFromDate(d.date)),
    ...bal.map(d => yearFromDate(d.date)),
    ...cf.map(d => yearFromDate(d.date)),
  ])].sort()

  const incMap = Object.fromEntries(inc.map(d => [yearFromDate(d.date), d]))
  const balMap = Object.fromEntries(bal.map(d => [yearFromDate(d.date), d]))
  const cfMap = Object.fromEntries(cf.map(d => [yearFromDate(d.date), d]))

  const revenueData = allYears.map(y => cv(incMap[y]?.totalRevenue ?? null))
  const netDebtData = allYears.map(y => cv(balMap[y]?.netDebt ?? null))
  const ocfData = allYears.map(y => cv(cfMap[y]?.operatingCashFlow ?? null))
  const capexData = allYears.map(y => {
    const v = cfMap[y]?.capitalExpenditure
    return v != null ? cv(Math.abs(v)) : null
  })
  const dividendsData = allYears.map(y => cv(cfMap[y]?.commonDividendsPaid ?? null))
  const daData = allYears.map(y => cv(cfMap[y]?.depreciationAndAmortization ?? null))

  // Check which series have data
  const hasDividends = dividendsData.some(v => v != null && v > 0)
  const hasDA = daData.some(v => v != null && v > 0)

  const series = [
    { name: 'Ventas', type: 'column', data: revenueData, color: '#415BFF', zIndex: 1, opacity: 0.7 },
    { name: 'Flujo Operativo', type: 'spline', data: ocfData, color: '#34d399', lineWidth: 2.5, zIndex: 3, marker: { enabled: true, radius: 3, fillColor: '#34d399', lineWidth: 2, lineColor: '#0e0e16' } },
    { name: 'Deuda Neta', type: 'spline', data: netDebtData, color: '#f87171', lineWidth: 2, zIndex: 2, dashStyle: 'ShortDash', marker: { enabled: true, radius: 3, fillColor: '#f87171', lineWidth: 2, lineColor: '#0e0e16' } },
    { name: 'Capex', type: 'spline', data: capexData, color: '#fbbf24', lineWidth: 2, zIndex: 2, marker: { enabled: true, radius: 3, fillColor: '#fbbf24', lineWidth: 2, lineColor: '#0e0e16' } },
  ]
  if (hasDividends) {
    series.push({ name: 'Dividendos', type: 'spline', data: dividendsData, color: earthyBrown, lineWidth: 2, zIndex: 2, marker: { enabled: true, radius: 3, fillColor: earthyBrown, lineWidth: 2, lineColor: '#0e0e16' } })
  }
  if (hasDA) {
    series.push({ name: 'D&A', type: 'spline', data: daData, color: '#a78bfa', lineWidth: 1.5, zIndex: 2, dashStyle: 'Dot', marker: { enabled: false } })
  }

  return {
    chart: { backgroundColor: 'transparent', style: { fontFamily: 'Inter, system-ui, sans-serif' }, spacing: [16, 16, 12, 16] },
    title: { text: 'Panorama Financiero', align: 'left', style: titleStyle },
    subtitle: freshSubtitle(props.freshLabel),
    xAxis: { categories: allYears, labels: { style: labelStyle }, lineColor: 'rgba(255,255,255,0.06)', tickLength: 0 },
    yAxis: {
      title: { text: null },
      labels: { style: labelStyle, formatter() { return fmtNum(this.value) } },
      gridLineColor: gridColor,
      gridLineDashStyle: 'Dot',
    },
    legend: legendBottom,
    tooltip: {
      shared: true, useHTML: true, backgroundColor: 'transparent', borderWidth: 0, shadow: false, padding: 0,
      formatter() { return buildTooltip(this.points[0]?.key ?? this.x, this.points) },
    },
    plotOptions: {
      column: { borderRadius: 3, borderWidth: 0, groupPadding: 0.15, pointPadding: 0.05, opacity: 0.6 },
    },
    series,
    credits: { enabled: false },
  }
})

function renderChart() {
  if (!chartContainer.value) return
  if (chartOptions.value) { if (chartInstance) chartInstance.destroy(); chartInstance = Highcharts.chart(chartContainer.value, chartOptions.value) }
  else if (chartInstance) { chartInstance.destroy(); chartInstance = null }
}
watch(chartOptions, renderChart, { deep: true, flush: 'post' })
onMounted(renderChart)
onBeforeUnmount(() => { if (chartInstance) { chartInstance.destroy(); chartInstance = null } })
</script>

<template>
  <ChartInfoOverlay description="Vista general de las principales magnitudes financieras: ventas (barras), flujo de caja operativo, deuda neta, capex, dividendos y depreciacion/amortizacion. Permite ver de un vistazo la escala relativa de cada metrica y su evolucion en el tiempo.">
    <div ref="chartContainer" v-show="hasData" class="w-full" style="min-height: 440px"></div>
    <div v-if="!hasData" class="flex items-center justify-center" style="min-height: 440px;">
      <p class="text-muted-foreground/50 text-xs">Datos financieros no disponibles</p>
    </div>
  </ChartInfoOverlay>
</template>
