<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import Highcharts from 'highcharts'
import ChartInfoOverlay from '@/components/ChartInfoOverlay.vue'
import { legendBottom, freshSubtitle } from '@/lib/chartConfig'
import { useCurrency } from '@/composables/useCurrency'

const props = defineProps({
  dividends: { type: Array, default: () => [] },
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

// Detect dividend frequency from recent data
const frequency = computed(() => {
  if (!props.dividends.length) return null
  // Count payments in the most recent full calendar year
  const years = {}
  props.dividends.forEach((d) => {
    const y = String(d.date).substring(0, 4)
    years[y] = (years[y] || 0) + 1
  })
  const sortedYears = Object.keys(years).sort()
  // Use second-to-last year (last full year) if available, else last year
  const targetYear = sortedYears.length >= 2 ? sortedYears[sortedYears.length - 2] : sortedYears[sortedYears.length - 1]
  const count = years[targetYear] || 0

  if (count >= 12) return { label: 'Mensual', color: '#60a5fa' }
  if (count >= 4) return { label: 'Trimestral', color: '#8b5cf6' }
  if (count >= 2) return { label: 'Semestral', color: '#fbbf24' }
  if (count >= 1) return { label: 'Anual', color: '#34d399' }
  return null
})

const chartOptions = computed(() => {
  if (!props.dividends.length) return null

  // Limit to last 10 years
  const cutoffYear = new Date().getFullYear() - 10
  const cutoffDate = cutoffYear + '-01-01'
  const filtered = props.dividends.filter((d) => d.date >= cutoffDate)
  if (!filtered.length) return null

  const categories = filtered.map((d) => d.date)
  const amounts = filtered.map((d) => cv(d.adjDividend || d.dividend || 0))
  const c = sym.value

  // Year tick positions
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
      type: 'column',
      backgroundColor: 'transparent',
      style: { fontFamily: 'Inter, system-ui, sans-serif' },
      spacing: [16, 16, 12, 12],
    },
    title: {
      text: frequency.value
        ? `Pago de Dividendos <span style="
            display: inline-block;
            font-size: 9px;
            font-weight: 500;
            padding: 2px 8px;
            border-radius: 9999px;
            margin-left: 8px;
            vertical-align: middle;
            background: ${frequency.value.color}18;
            color: ${frequency.value.color};
            border: 1px solid ${frequency.value.color}30;
          ">${frequency.value.label}</span>`
        : 'Pago de Dividendos',
      useHTML: true,
      align: 'left',
      style: titleStyle,
    },
    subtitle: freshSubtitle(props.freshLabel),
    xAxis: {
      categories,
      crosshair: {
        color: 'rgba(255, 255, 255, 0.06)',
        width: 1,
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
      labels: {
        style: labelStyle,
        formatter() {
          return c + this.value
        },
      },
      gridLineColor: gridColor,
      gridLineDashStyle: 'Dot',
    },
    legend: legendBottom,
    tooltip: {
      useHTML: true,
      backgroundColor: 'transparent',
      borderWidth: 0,
      shadow: false,
      padding: 0,
      formatter() {
        const idx = this.point?.index
        const rawDate = (idx != null && categories[idx]) ? String(categories[idx]).substring(0, 10) : ''
        const val = this.y != null ? c + this.y.toFixed(4) : '-'
        // Format ex-dividend date nicely
        let exDateStr = ''
        if (rawDate) {
          const parts = rawDate.split('-')
          exDateStr = parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : rawDate
        }
        return `<div style="
          background: rgba(14, 14, 22, 0.85);
          backdrop-filter: blur(20px);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 10px;
          padding: 10px 14px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.4);
          min-width: 150px;
        ">
          <div style="color: #a1a1aa; font-size: 10px; margin-bottom: 6px;">Ex-Dividendo: ${exDateStr}</div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="width: 6px; height: 6px; border-radius: 50%; background: #8b5cf6;"></span>
            <span style="color: #a1a1aa; font-size: 11px; flex: 1;">Dividendo</span>
            <span style="color: #e4e4e7; font-size: 11px; font-weight: 600;">${val}</span>
          </div>
        </div>`
      },
    },
    plotOptions: {
      column: {
        borderRadius: 3,
        borderWidth: 0,
      },
    },
    series: [
      {
        name: 'Dividendo',
        data: amounts,
        color: '#8b5cf6',
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
  <ChartInfoOverlay description="Muestra cada pago individual de dividendo (ex-dividendo) en los últimos 10 años. La etiqueta indica la frecuencia de pago detectada (trimestral, semestral, etc.). Pagos consistentes y crecientes indican una política de dividendos estable. Recortes o pagos irregulares son señales de alerta.">
    <div ref="chartContainer" v-show="dividends.length" class="w-full" style="min-height: 400px"></div>
    <div v-if="!dividends.length" class="flex items-center justify-center" style="min-height: 400px;">
      <p class="text-muted-foreground/50 text-xs">Datos de dividendos no disponibles</p>
    </div>
  </ChartInfoOverlay>
</template>
