<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import Highcharts from 'highcharts'
import ChartInfoOverlay from '@/components/ChartInfoOverlay.vue'
import { legendBottom, freshSubtitle } from '@/lib/chartConfig'

const props = defineProps({
  dailyYields: { type: Array, default: () => [] },
  avgHighYield: { type: Number, default: 0 },
  avgLowYield: { type: Number, default: 0 },
  avgYield: { type: Number, default: 0 },
  ticker: { type: String, default: '' },
  freshLabel: { type: String, default: '' },
})

const chartContainer = ref(null)
let chartInstance = null

const labelStyle = { color: '#71717a', fontSize: '10px' }
const gridColor = 'rgba(255, 255, 255, 0.04)'
const titleStyle = { color: '#e4e4e7', fontSize: '13px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.05em' }
const hasData = computed(() => props.dailyYields && props.dailyYields.length > 0)

const chartOptions = computed(() => {
  if (!props.dailyYields.length) return null

  const categories = props.dailyYields.map((d) => d.date)
  const yields = props.dailyYields.map((d) => d.dividendYield)

  return {
    chart: {
      type: 'area',
      backgroundColor: 'transparent',
      style: { fontFamily: 'Inter, system-ui, sans-serif' },
      spacing: [16, 16, 12, 12],
    },
    title: { text: 'Yields', align: 'left', style: titleStyle },
    subtitle: freshSubtitle(props.freshLabel),
    xAxis: {
      categories,
      type: 'category',
      crosshair: {
        color: 'rgba(255, 255, 255, 0.06)',
        width: 1,
        dashStyle: 'ShortDot',
      },
      labels: {
        step: Math.floor(categories.length / 7),
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
      labels: {
        style: labelStyle,
        format: '{value}%',
      },
      gridLineColor: gridColor,
      gridLineDashStyle: 'Dot',
      plotLines: [
        {
          value: props.avgHighYield,
          color: '#34d399',
          dashStyle: 'Dash',
          width: 1.5,
          label: {
            text: `Alto: ${props.avgHighYield.toFixed(2)}%`,
            style: { color: '#34d399', fontSize: '10px' },
          },
        },
        {
          value: props.avgLowYield,
          color: '#f87171',
          dashStyle: 'Dash',
          width: 1.5,
          label: {
            text: `Bajo: ${props.avgLowYield.toFixed(2)}%`,
            style: { color: '#f87171', fontSize: '10px' },
          },
        },
        {
          value: props.avgYield,
          color: '#fbbf24',
          dashStyle: 'Dot',
          width: 1,
          label: {
            text: `Medio: ${props.avgYield.toFixed(2)}%`,
            style: { color: '#fbbf24', fontSize: '10px' },
          },
        },
      ],
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
        const date = String(this.points?.[0]?.key || this.x || '').substring(0, 10)
        const val = this.y != null ? this.y.toFixed(2) + '%' : '-'
        return `<div style="
          background: rgba(14, 14, 22, 0.85);
          backdrop-filter: blur(20px);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 10px;
          padding: 10px 14px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.4);
        ">
          <div style="color: #a1a1aa; font-size: 10px; margin-bottom: 6px;">${date}</div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="width: 6px; height: 6px; border-radius: 50%; background: #415BFF;"></span>
            <span style="color: #a1a1aa; font-size: 11px; flex: 1;">Yield</span>
            <span style="color: #e4e4e7; font-size: 11px; font-weight: 600;">${val}</span>
          </div>
        </div>`
      },
    },
    series: [
      {
        name: 'Dividend Yield',
        data: yields,
        color: '#415BFF',
        fillColor: {
          linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 },
          stops: [
            [0, 'rgba(65, 91, 255, 0.20)'],
            [1, 'rgba(65, 91, 255, 0.02)'],
          ],
        },
        lineWidth: 1.5,
        marker: {
          enabled: false,
          states: {
            hover: {
              enabled: true,
              radius: 3,
              lineWidth: 2,
              lineColor: '#415BFF',
              fillColor: '#0e0e16',
            },
          },
        },
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
  <ChartInfoOverlay description="Muestra la evolución del dividend yield (rentabilidad por dividendo) a lo largo del tiempo. Las líneas horizontales marcan los yields promedio alto (verde), bajo (rojo) y medio (amarillo). Cuando el yield actual está cerca o por encima del promedio alto, el activo tiende a estar infravalorado. Cerca del bajo, sobrevalorado.">
    <div ref="chartContainer" v-show="hasData" class="w-full" style="min-height: 400px"></div>
    <div v-if="!hasData" class="flex items-center justify-center" style="min-height: 400px;">
      <p class="text-muted-foreground/50 text-xs">Datos de yields no disponibles</p>
    </div>
  </ChartInfoOverlay>
</template>
