<script setup>
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import Highcharts from 'highcharts'

const props = defineProps({
  totals: { type: Object, default: null },   // { base: [{year, annualIncome}], perAsset: [{ticker, color, data}] }
  currentIncome: { type: Number, default: 0 },
  currency: { type: String, default: '€' },
  stacked: { type: Boolean, default: false },
})

const chartEl = ref(null)
let chart = null

function renderChart() {
  if (!chartEl.value || !props.totals?.base?.length) return

  const categories = props.totals.base.map(y => `Año ${y.year}`)

  let seriesData

  if (props.stacked && props.totals.perAsset?.length) {
    // Stacked area by asset
    seriesData = props.totals.perAsset.map(a => {
      // Parse hsl color to create a translucent fill
      const fillColor = a.color.replace('hsl(', 'hsla(').replace(')', ', 0.35)')
      return {
        name: a.ticker,
        data: a.data,
        color: a.color,
        type: 'areaspline',
        fillColor,
        lineWidth: 1.5,
        marker: { enabled: false },
      }
    })
  } else {
    // Single aggregated line
    seriesData = [
      {
        name: 'Income anual (mix)',
        data: props.totals.base.map(y => y.annualIncome),
        color: '#415BFF',
        type: 'areaspline',
        fillColor: {
          linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 },
          stops: [
            [0, 'rgba(65, 91, 255, 0.25)'],
            [1, 'rgba(65, 91, 255, 0.02)'],
          ],
        },
        lineWidth: 2.5,
        marker: { enabled: true, radius: 3, fillColor: '#415BFF', lineWidth: 0 },
      },
    ]
  }

  if (chart) chart.destroy()

  chart = Highcharts.chart(chartEl.value, {
    chart: {
      backgroundColor: 'transparent',
      style: { fontFamily: 'Inter, system-ui, sans-serif' },
      spacing: [10, 0, 10, 0],
      height: 220,
    },
    title: { text: null },
    credits: { enabled: false },
    legend: {
      enabled: props.stacked,
      itemStyle: { color: 'rgba(255,255,255,0.5)', fontSize: '10px', fontWeight: '400' },
      itemHoverStyle: { color: 'rgba(255,255,255,0.8)' },
    },
    xAxis: {
      categories,
      labels: { style: { color: 'rgba(255,255,255,0.3)', fontSize: '10px' } },
      lineColor: 'rgba(255,255,255,0.06)',
      tickLength: 0,
    },
    yAxis: {
      title: { text: null },
      labels: {
        style: { color: 'rgba(255,255,255,0.3)', fontSize: '10px' },
        formatter() { return `${props.currency}${this.value >= 1000 ? (this.value / 1000).toFixed(1) + 'k' : Math.round(this.value)}` },
      },
      gridLineColor: 'rgba(255,255,255,0.04)',
    },
    tooltip: {
      shared: true,
      backgroundColor: 'rgba(14, 14, 22, 0.9)',
      borderColor: 'rgba(255,255,255,0.1)',
      style: { color: 'rgba(255,255,255,0.8)', fontSize: '11px' },
      valuePrefix: props.currency,
      valueDecimals: 0,
      headerFormat: '<span style="font-size:11px;font-weight:600">{point.key}</span><br/>',
    },
    plotOptions: {
      areaspline: {
        threshold: null,
        ...(props.stacked ? { stacking: 'normal' } : {}),
      },
    },
    series: seriesData,
  })
}

watch(() => props.totals, renderChart, { deep: true })
watch(() => props.stacked, () => {
  // Full destroy + recreate needed when switching stacking mode
  if (chart) { chart.destroy(); chart = null }
  renderChart()
})
onMounted(renderChart)
onBeforeUnmount(() => { if (chart) chart.destroy() })
</script>

<template>
  <div ref="chartEl" class="w-full" style="min-height: 220px" />
</template>
