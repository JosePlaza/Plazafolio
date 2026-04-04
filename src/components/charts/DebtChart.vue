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
  const bal = props.fundamentals?.balance
  return bal && bal.length > 0 && bal.some((d) => d.netDebt || d.totalDebt)
})

const chartOptions = computed(() => {
  if (!hasData.value) return null
  const bal = props.fundamentals.balance
  const cf = props.fundamentals.cashFlow || []
  const cfMap = Object.fromEntries(cf.map((d) => [yearFromDate(d.date), d]))

  const categories = bal.map((d) => yearFromDate(d.date))
  const fcfData = bal.map((d) => cv(cfMap[yearFromDate(d.date)]?.freeCashFlow ?? 0))
  const netDebtData = bal.map((d) => cv(d.netDebt ?? 0))
  const ratioData = bal.map((d, i) => {
    const nd = netDebtData[i]; const fcf = fcfData[i]
    if (!fcf || fcf <= 0 || !nd) return null
    return parseFloat((nd / fcf).toFixed(2))
  })

  return {
    chart: { backgroundColor: 'transparent', style: { fontFamily: 'Inter, system-ui, sans-serif' }, spacing: [16, 16, 12, 16] },
    title: { text: 'Deuda', align: 'left', style: titleStyle },
    subtitle: freshSubtitle(props.freshLabel),
    xAxis: { categories, labels: { style: labelStyle }, lineColor: 'rgba(255,255,255,0.06)', tickLength: 0 },
    yAxis: [
      { title: { text: null }, labels: { style: labelStyle, formatter() { return fmtNum(this.value) } }, gridLineColor: gridColor, gridLineDashStyle: 'Dot' },
      { title: { text: null }, labels: { style: labelStyle, format: '{value}x' }, opposite: true, gridLineWidth: 0 },
    ],
    legend: legendBottom,
    tooltip: {
      shared: true, useHTML: true, backgroundColor: 'transparent', borderWidth: 0, shadow: false, padding: 0,
      formatter() { return buildTooltip(this.points[0]?.key ?? this.x, this.points, { secondaryFormat: 'x' }) },
    },
    plotOptions: { column: { borderRadius: 3, borderWidth: 0, groupPadding: 0.15, pointPadding: 0.05 } },
    series: [
      { name: 'Flujo Caja Libre', type: 'column', yAxis: 0, data: fcfData, color: '#415BFF', zIndex: 1 },
      { name: 'Deuda Neta', type: 'column', yAxis: 0, data: netDebtData, color: earthyBrown, zIndex: 1 },
      {
        name: 'Deuda n./FCF', type: 'spline', yAxis: 1, data: ratioData, color: '#f87171', lineWidth: 2, zIndex: 2,
        marker: { enabled: true, radius: 3, fillColor: '#f87171', lineWidth: 2, lineColor: '#0e0e16' },
        dataLabels: { enabled: true, formatter() { return this.y ? this.y.toFixed(1) : '' }, style: { color: '#f87171', fontSize: '9px', fontWeight: '600', textOutline: '1px rgba(14,14,22,0.9)' }, y: -8 },
      },
    ],
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
  <ChartInfoOverlay description="Compara el flujo de caja libre con la deuda neta de la empresa. El ratio Deuda/FCF indica cuántos años tardaría la empresa en pagar toda su deuda con su generación de efectivo. Valores bajos (< 3x) son saludables. Valores altos (> 5x) pueden indicar riesgo financiero. Deuda neta negativa significa que tiene más caja que deuda.">
    <div ref="chartContainer" v-show="hasData" class="w-full" style="min-height: 400px"></div>
    <div v-if="!hasData" class="flex items-center justify-center" style="min-height: 400px;">
      <p class="text-muted-foreground/50 text-xs">Datos de deuda no disponibles</p>
    </div>
  </ChartInfoOverlay>
</template>
