<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import Highcharts from 'highcharts'
import ChartInfoOverlay from '@/components/ChartInfoOverlay.vue'
import { legendBottom, freshSubtitle } from '@/lib/chartConfig'
import { useCurrency } from '@/composables/useCurrency'

const props = defineProps({
  priceBands: { type: Array, default: () => [] },
  ticker: { type: String, default: '' },
  currency: { type: String, default: '$' },
  freshLabel: { type: String, default: '' },
})

const { convertByTicker, symbolFor } = useCurrency()
const cv = (val) => convertByTicker(val, props.ticker)
const sym = computed(() => symbolFor(props.ticker))

const chartContainer = ref(null)
let chartInstance = null

const labelStyle = { color: '#71717a', fontSize: '10px' }
const gridColor = 'rgba(255, 255, 255, 0.04)'
const titleStyle = { color: '#e4e4e7', fontSize: '13px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.05em' }
const hasData = computed(() => props.priceBands && props.priceBands.length > 0)

const chartOptions = computed(() => {
  if (!props.priceBands.length) return null

  const categories = props.priceBands.map((d) => d.date)
  const closePrices = props.priceBands.map((d) => cv(d.close))
  const undervalued = props.priceBands.map((d) => cv(d.undervalued))
  const overvalued = props.priceBands.map((d) => cv(d.overvalued))

  // Find max value for the red threshold (needs to be above all data)
  const maxVal = Math.max(
    ...closePrices.filter(Boolean),
    ...overvalued.filter(Boolean),
    ...undervalued.filter(Boolean),
  )
  const minVal = Math.min(
    ...closePrices.filter(Boolean),
    ...overvalued.filter(Boolean),
    ...undervalued.filter(Boolean),
  )
  const yPadding = (maxVal - minVal) * 0.1
  const yMax = maxVal + yPadding
  const yMin = Math.max(0, minVal - yPadding)
  const redThreshold = yMax * 10 // far above visible area, clipped by yAxis.max

  // Calculate tick positions: one per year at the first data point of each year
  const yearTicks = []
  let lastYear = ''
  categories.forEach((d, i) => {
    const year = String(d).substring(0, 4)
    if (year !== lastYear) {
      yearTicks.push(i)
      lastYear = year
    }
  })

  return {
    chart: {
      backgroundColor: 'transparent',
      style: { fontFamily: 'Inter, system-ui, sans-serif' },
      spacing: [16, 16, 12, 12],
      animation: { duration: 800 },
    },
    title: {
      text: 'Tesis',
      align: 'left',
      style: titleStyle,
    },
    subtitle: freshSubtitle(props.freshLabel),
    xAxis: {
      categories,
      crosshair: {
        color: 'rgba(255, 255, 255, 0.06)',
        width: 1,
        dashStyle: 'ShortDot',
      },
      tickPositioner() {
        return yearTicks
      },
      labels: {
        style: labelStyle,
        formatter() {
          return String(this.value || '').substring(0, 4)
        },
      },
      lineColor: 'rgba(255, 255, 255, 0.06)',
      tickLength: 0,
    },
    yAxis: {
      title: { text: null },
      min: yMin,
      max: yMax,
      endOnTick: false,
      startOnTick: false,
      labels: {
        style: labelStyle,
        formatter() {
          return sym.value + this.value
        },
      },
      gridLineColor: gridColor,
      gridLineDashStyle: 'Dot',
      crosshair: {
        color: 'rgba(255, 255, 255, 0.06)',
        width: 1,
        dashStyle: 'ShortDot',
      },
    },
    legend: legendBottom,
    tooltip: {
      shared: true,
      useHTML: true,
      backgroundColor: 'transparent',
      borderWidth: 0,
      shadow: false,
      padding: 0,
      formatter() {
        // Get the actual category string (date) from the point
        const idx = this.points?.[0]?.point?.index
        const date = (idx != null && categories[idx]) ? String(categories[idx]).substring(0, 10) : ''
        let html = `<div style="
          background: rgba(14, 14, 22, 0.85);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 10px;
          padding: 10px 14px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.4);
          min-width: 160px;
        ">`
        html += `<div style="color: #a1a1aa; font-size: 10px; margin-bottom: 8px; letter-spacing: 0.03em;">${date}</div>`
        this.points.forEach((p) => {
          if (p.series.userOptions.isZone) return
          const val = p.y != null ? sym.value + p.y.toFixed(2) : '-'
          html += `<div style="display: flex; align-items: center; gap: 8px; margin-bottom: 3px;">
            <span style="width: 6px; height: 6px; border-radius: 50%; background: ${p.series.color}; flex-shrink: 0;"></span>
            <span style="color: #a1a1aa; font-size: 11px; flex: 1;">${p.series.name}</span>
            <span style="color: #e4e4e7; font-size: 11px; font-weight: 600; font-variant-numeric: tabular-nums;">${val}</span>
          </div>`
        })
        html += '</div>'
        return html
      },
    },
    plotOptions: {
      series: {
        animation: { duration: 1000, easing: 'easeOutQuart' },
        states: {
          hover: { lineWidthPlus: 0 },
          inactive: { opacity: 0.6 },
        },
      },
    },
    series: [
      // Cotización — line only, no fill
      {
        name: 'Cotización',
        type: 'line',
        data: closePrices,
        color: '#415BFF',
        lineWidth: 2,
        marker: {
          enabled: false,
          states: {
            hover: {
              enabled: true,
              radius: 4,
              lineWidth: 2,
              lineColor: '#415BFF',
              fillColor: '#0e0e16',
            },
          },
        },
        zIndex: 3,
      },
      // Infravalorado — green gradient going DOWN from line to 0
      {
        name: 'Infravalorado',
        type: 'area',
        data: undervalued,
        color: '#34d399',
        lineWidth: 1.5,
        dashStyle: 'ShortDash',
        fillColor: {
          linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 },
          stops: [
            [0, 'rgba(52, 211, 153, 0.10)'],
            [1, 'rgba(52, 211, 153, 0.0)'],
          ],
        },
        threshold: 0,
        marker: {
          enabled: false,
          states: {
            hover: {
              enabled: true,
              radius: 3,
              lineWidth: 2,
              lineColor: '#34d399',
              fillColor: '#0e0e16',
            },
          },
        },
        zIndex: 1,
      },
      // Sobrevalorado — red gradient going UP from line to top
      {
        name: 'Sobrevalorado',
        type: 'area',
        data: overvalued,
        color: '#f87171',
        lineWidth: 1.5,
        dashStyle: 'ShortDash',
        fillColor: {
          linearGradient: { x1: 0, y1: 1, x2: 0, y2: 0 },
          stops: [
            [0, 'rgba(248, 113, 113, 0.10)'],
            [1, 'rgba(248, 113, 113, 0.0)'],
          ],
        },
        threshold: redThreshold,
        marker: {
          enabled: false,
          states: {
            hover: {
              enabled: true,
              radius: 3,
              lineWidth: 2,
              lineColor: '#f87171',
              fillColor: '#0e0e16',
            },
          },
        },
        zIndex: 1,
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
  <ChartInfoOverlay description="Gráfica principal de la tesis Geraldine Weiss. Muestra el precio de cotización junto con las bandas de infravaloración (verde) y sobrevaloración (rojo). Cuando el precio está por debajo de la banda verde, el activo está infravalorado según su yield histórico — buena oportunidad de compra. Cuando está por encima de la roja, está sobrevalorado.">
    <div ref="chartContainer" v-show="hasData" class="w-full" style="min-height: 400px"></div>
    <div v-if="!hasData" class="flex items-center justify-center" style="min-height: 400px;">
      <p class="text-muted-foreground/50 text-xs">Datos no disponibles</p>
    </div>
  </ChartInfoOverlay>
</template>
