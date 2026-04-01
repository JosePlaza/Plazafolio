<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import Highcharts from 'highcharts'
import ChartInfoOverlay from '@/components/ChartInfoOverlay.vue'
import { labelStyle, gridColor, titleStyle, legendBottom, freshSubtitle } from '@/lib/chartConfig'

const props = defineProps({
  drawdown: { type: Array, default: () => [] },
  ticker: { type: String, default: '' },
  currency: { type: String, default: '$' },
  freshLabel: { type: String, default: '' },
})

const chartContainer = ref(null)
let chartInstance = null

const chartOptions = computed(() => {
  if (!props.drawdown.length) return null

  const categories = props.drawdown.map((d) => d.date)
  const values = props.drawdown.map((d) => d.drawdown)

  // Calculate good year tick positions
  const yearSet = new Set()
  const tickPositions = []
  categories.forEach((date, i) => {
    const yr = String(date).substring(0, 4)
    if (!yearSet.has(yr)) {
      yearSet.add(yr)
      tickPositions.push(i)
    }
  })

  return {
    chart: {
      type: 'area', backgroundColor: 'transparent',
      style: { fontFamily: 'Inter, system-ui, sans-serif' }, spacing: [16, 16, 12, 16],
    },
    title: { text: 'Drawdown', align: 'left', style: titleStyle },
    subtitle: freshSubtitle(props.freshLabel),
    xAxis: {
      categories,
      tickPositions,
      labels: {
        style: labelStyle,
        formatter() { return String(this.value || '').substring(0, 4) },
      },
      lineColor: 'rgba(255, 255, 255, 0.06)',
      tickLength: 0,
      crosshair: { color: 'rgba(255, 255, 255, 0.06)', width: 1, dashStyle: 'ShortDot' },
    },
    yAxis: {
      title: { text: null },
      labels: { style: labelStyle, format: '{value}%' },
      gridLineColor: gridColor, gridLineDashStyle: 'Dot',
      max: 5, endOnTick: false,
      plotLines: [{ value: 0, color: 'rgba(255, 255, 255, 0.1)', width: 1, zIndex: 3 }],
    },
    legend: legendBottom,
    tooltip: {
      useHTML: true, backgroundColor: 'transparent', borderWidth: 0, shadow: false, padding: 0,
      formatter() {
        const date = String(this.key || this.x || '').substring(0, 10)
        const val = this.y != null ? this.y.toFixed(2) + '%' : '-'
        return `<div style="background:rgba(14,14,22,0.85);backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:10px 14px;box-shadow:0 8px 32px rgba(0,0,0,0.4);">
          <div style="color:#a1a1aa;font-size:10px;margin-bottom:6px;">${date}</div>
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="width:6px;height:6px;border-radius:50%;background:#f87171;"></span>
            <span style="color:#a1a1aa;font-size:11px;flex:1;">Drawdown</span>
            <span style="color:#e4e4e7;font-size:11px;font-weight:600;">${val}</span>
          </div>
        </div>`
      },
    },
    series: [{
      name: 'Drawdown', data: values, color: '#f87171', threshold: 0,
      negativeColor: '#f87171',
      negativeFillColor: { linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 }, stops: [[0, 'rgba(248,113,113,0.03)'], [1, 'rgba(248,113,113,0.25)']] },
      fillColor: { linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 }, stops: [[0, 'rgba(248,113,113,0.03)'], [1, 'rgba(248,113,113,0.25)']] },
      lineWidth: 1.5,
      marker: { enabled: false, states: { hover: { enabled: true, radius: 3, lineWidth: 2, lineColor: '#f87171', fillColor: '#0e0e16' } } },
    }],
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
  <ChartInfoOverlay description="Muestra la caída máxima del precio desde su pico más reciente. Un drawdown del -20% significa que el precio cayó un 20% desde su máximo. Drawdowns frecuentes y profundos indican alta volatilidad. Para inversores por dividendo, los drawdowns pueden ser oportunidades de compra si los fundamentales son sólidos.">
    <div ref="chartContainer" v-show="drawdown.length" class="w-full" style="min-height: 400px"></div>
    <div v-if="!drawdown.length" class="flex items-center justify-center" style="min-height: 400px;">
      <p class="text-muted-foreground/50 text-xs">Datos de drawdown no disponibles</p>
    </div>
  </ChartInfoOverlay>
</template>
