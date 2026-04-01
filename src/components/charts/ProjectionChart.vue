<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import Highcharts from 'highcharts'
import ChartInfoOverlay from '@/components/ChartInfoOverlay.vue'
import { legendBottom, freshSubtitle } from '@/lib/chartConfig'

const props = defineProps({
  projection: { type: Object, default: null },
  indicators: { type: Object, default: null },
  ticker: { type: String, default: '' },
  currency: { type: String, default: '$' },
  freshLabel: { type: String, default: '' },
})

const chartContainer = ref(null)
let chartInstance = null

const labelStyle = { color: '#71717a', fontSize: '10px' }
const gridColor = 'rgba(255, 255, 255, 0.04)'
const titleStyle = { color: '#e4e4e7', fontSize: '13px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.05em' }

const chartOptions = computed(() => {
  if (!props.projection || !props.projection.historical.length || !props.indicators) return null

  const { historical, projected, cagr } = props.projection
  const currentPrice = props.indicators.currentPrice || 0
  if (currentPrice <= 0) return null

  const currentYear = new Date().getFullYear()
  const startYear = currentYear - 2

  // Filter historical: only last 2 years (currentYear - 2, currentYear - 1, currentYear)
  const histFiltered = historical.filter((h) => h.year >= startYear)

  // Filter projected: up to currentYear + 10
  const endYear = currentYear + 10
  const projFiltered = projected.filter((p) => p.year <= endYear)

  // Build combined data
  const allYears = [
    ...histFiltered.map((h) => h.year.toString()),
    ...projFiltered.map((p) => p.year.toString()),
  ]

  // Convert dividend amounts to yield %
  const toYield = (div) => div > 0 ? (div / currentPrice) * 100 : 0

  const historicalYields = [
    ...histFiltered.map((h) => parseFloat(toYield(h.dividend).toFixed(2))),
    ...projFiltered.map(() => null),
  ]

  const projectedYields = [
    ...histFiltered.slice(0, -1).map(() => null),
    // Bridge: last historical point connects to projected
    parseFloat(toYield(histFiltered[histFiltered.length - 1]?.dividend || 0).toFixed(2)),
    ...projFiltered.map((p) => parseFloat(toYield(p.dividend).toFixed(2))),
  ]

  return {
    chart: {
      type: 'column',
      backgroundColor: 'transparent',
      style: { fontFamily: 'Inter, system-ui, sans-serif' },
      spacing: [24, 16, 12, 12],
    },
    title: {
      text: `Proyección Dividendo (CAGR: ${cagr.toFixed(2)}%)`,
      align: 'left',
      style: titleStyle,
    },
    subtitle: freshSubtitle(props.freshLabel),
    xAxis: {
      categories: allYears,
      crosshair: {
        color: 'rgba(255, 255, 255, 0.06)',
        width: 1,
      },
      labels: { style: labelStyle },
      lineColor: 'rgba(255, 255, 255, 0.06)',
      tickLength: 0,
    },
    yAxis: {
      title: { text: null },
      labels: {
        style: labelStyle,
        formatter() {
          return this.value.toFixed(2) + '%'
        },
      },
      gridLineColor: gridColor,
      gridLineDashStyle: 'Dot',
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
        const year = String(this.points?.[0]?.key ?? this.x ?? '')
        let html = `<div style="
          background: rgba(14, 14, 22, 0.85);
          backdrop-filter: blur(20px);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 10px;
          padding: 10px 14px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.4);
          min-width: 140px;
        ">`
        html += `<div style="color: #a1a1aa; font-size: 10px; margin-bottom: 6px;">${year}</div>`
        this.points.forEach((p) => {
          if (p.y == null) return
          const val = p.y.toFixed(2) + '%'
          html += `<div style="display: flex; align-items: center; gap: 8px; margin-bottom: 3px;">
            <span style="width: 6px; height: 6px; border-radius: 50%; background: ${p.color}; flex-shrink: 0;"></span>
            <span style="color: #a1a1aa; font-size: 11px; flex: 1;">${p.series.name}</span>
            <span style="color: #e4e4e7; font-size: 11px; font-weight: 600;">${val}</span>
          </div>`
        })
        html += '</div>'
        return html
      },
    },
    plotOptions: {
      column: {
        borderRadius: 3,
        borderWidth: 0,
        pointPadding: 0.05,
        groupPadding: 0.08,
        dataLabels: {
          enabled: true,
          formatter() {
            return this.y != null ? this.y.toFixed(2) + '%' : ''
          },
          style: {
            color: '#a1a1aa',
            fontSize: '9px',
            fontWeight: '600',
            textOutline: 'none',
          },
        },
      },
    },
    series: [
      {
        name: 'Histórico',
        data: historicalYields,
        color: '#415BFF',
      },
      {
        name: 'Proyección',
        data: projectedYields,
        color: '#7b8fff',
        opacity: 0.7,
      },
    ],
    credits: { enabled: false },
  }
})

const hasData = computed(() => props.projection && props.projection.historical?.length > 0 && props.indicators)

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
  <ChartInfoOverlay description="Proyecta el yield futuro del dividendo basándose en el CAGR histórico. Las barras azules son datos reales y las claras son proyecciones. Si el yield proyectado crece de forma sostenida, indica que al precio actual, tu rentabilidad por dividendo irá aumentando año a año (yield on cost creciente).">
    <div ref="chartContainer" v-show="hasData" class="w-full" style="min-height: 400px"></div>
    <div v-if="!hasData" class="flex items-center justify-center" style="min-height: 400px;">
      <p class="text-muted-foreground/50 text-xs">Datos de proyección no disponibles</p>
    </div>
  </ChartInfoOverlay>
</template>
