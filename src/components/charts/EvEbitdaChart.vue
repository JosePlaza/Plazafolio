<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import Highcharts from 'highcharts'
import ChartInfoOverlay from '@/components/ChartInfoOverlay.vue'
import { labelStyle, gridColor, titleStyle, earthyBrown, legendBottom, fmtNum, yearFromDate, buildTooltip, freshSubtitle, chartTitle } from '@/lib/chartConfig'
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
  return inc && inc.length > 0 && inc.some((d) => d.ebitda)
})

const chartOptions = computed(() => {
  if (!hasData.value) return null
  const inc = props.fundamentals.income
  const ev = props.fundamentals.enterpriseValue
  const categories = inc.map((d) => yearFromDate(d.date))
  const ebitdaData = inc.map((d) => cv(d.ebitda ?? 0))
  const ratioData = inc.map((d) => (!ev || !d.ebitda || d.ebitda <= 0) ? null : parseFloat((ev / d.ebitda).toFixed(2)))
  const lastRatio = [...ratioData].reverse().find(v => v != null)
  const health = lastRatio == null ? null : lastRatio < 10 ? 'green' : lastRatio <= 20 ? 'neutral' : 'red'

  return {
    chart: { backgroundColor: 'transparent', style: { fontFamily: 'Inter, system-ui, sans-serif' }, spacing: [16, 16, 12, 16] },
    title: chartTitle('EV / EBITDA', health),
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
      { name: 'EBITDA', type: 'column', yAxis: 0, data: ebitdaData, color: earthyBrown, zIndex: 1 },
      {
        name: 'EV/EBITDA', type: 'spline', yAxis: 1, data: ratioData, color: '#f87171', lineWidth: 2, zIndex: 2,
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
  <ChartInfoOverlay description="Compara el Enterprise Value con el EBITDA (beneficio antes de intereses, impuestos, depreciación y amortización). Es uno de los ratios de valoración más usados. Un EV/EBITDA bajo (< 10x) suele indicar empresa infravalorada. Valores altos (> 20x) sugieren que el mercado paga una prima por crecimiento esperado.">
    <div ref="chartContainer" v-show="hasData" class="w-full" style="min-height: 400px"></div>
    <div v-if="!hasData" class="flex items-center justify-center" style="min-height: 400px;">
      <p class="text-muted-foreground/50 text-xs">Datos de EV/EBITDA no disponibles</p>
    </div>
  </ChartInfoOverlay>
</template>
