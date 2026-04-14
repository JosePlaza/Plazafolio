<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import Highcharts from 'highcharts'
import ChartInfoOverlay from '@/components/ChartInfoOverlay.vue'
import { labelStyle, gridColor, titleStyle, legendBottom, fmtNum, yearFromDate, buildTooltip, freshSubtitle, chartTitle } from '@/lib/chartConfig'
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
  const cf = props.fundamentals?.cashFlow
  return cf && cf.length > 0 && cf.some((d) => d.freeCashFlow)
})

const chartOptions = computed(() => {
  if (!hasData.value) return null
  const cf = props.fundamentals.cashFlow
  const ev = props.fundamentals.enterpriseValue
  const categories = cf.map((d) => yearFromDate(d.date))
  const fcfData = cf.map((d) => cv(d.freeCashFlow ?? 0))
  const ratioData = cf.map((d) => (!ev || !d.freeCashFlow || d.freeCashFlow <= 0) ? null : parseFloat((ev / d.freeCashFlow).toFixed(2)))
  const lastRatio = [...ratioData].reverse().find(v => v != null)
  const health = lastRatio == null ? null : lastRatio < 15 ? 'green' : lastRatio <= 30 ? 'neutral' : 'red'

  return {
    chart: { backgroundColor: 'transparent', style: { fontFamily: 'Inter, system-ui, sans-serif' }, spacing: [16, 16, 12, 16] },
    title: chartTitle('EV / FCF', health),
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
      { name: 'Free Cash Flow', type: 'column', yAxis: 0, data: fcfData, color: '#415BFF', zIndex: 1 },
      {
        name: 'EV/FCF', type: 'spline', yAxis: 1, data: ratioData, color: '#f87171', lineWidth: 2, zIndex: 2,
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
  <ChartInfoOverlay description="Compara el Enterprise Value (valor total de la empresa) con el Free Cash Flow (dinero real generado). Un ratio EV/FCF bajo (< 15x) sugiere que la empresa está barata respecto al efectivo que genera. Ratios altos (> 30x) indican que el mercado espera alto crecimiento o que la acción está cara.">
    <div ref="chartContainer" v-show="hasData" class="w-full" style="min-height: 400px"></div>
    <div v-if="!hasData" class="flex items-center justify-center" style="min-height: 400px;">
      <p class="text-muted-foreground/50 text-xs">Datos de EV/FCF no disponibles</p>
    </div>
  </ChartInfoOverlay>
</template>
