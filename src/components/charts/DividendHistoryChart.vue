<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import Highcharts from 'highcharts'
import ChartInfoOverlay from '@/components/ChartInfoOverlay.vue'
import { legendBottom, freshSubtitle } from '@/lib/chartConfig'

const props = defineProps({
  dividends: { type: Array, default: () => [] },
  projection: { type: Object, default: null },
  ticker: { type: String, default: '' },
  currency: { type: String, default: '$' },
  freshLabel: { type: String, default: '' },
})

const chartContainer = ref(null)
let chartInstance = null

const labelStyle = { color: '#71717a', fontSize: '10px' }
const gridColor = 'rgba(255, 255, 255, 0.04)'
const titleStyle = { color: '#e4e4e7', fontSize: '13px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.05em' }

// Aggregate dividends by year
const yearlyDividends = computed(() => {
  if (!props.dividends.length) return []

  const byYear = {}
  props.dividends.forEach((d) => {
    const year = String(d.date).substring(0, 4)
    const amount = d.adjDividend || d.dividend || 0
    byYear[year] = (byYear[year] || 0) + amount
  })

  const years = Object.keys(byYear).sort()
  const result = years.map((year, i) => {
    const amount = byYear[year]
    const prevAmount = i > 0 ? byYear[years[i - 1]] : null
    const pctChange = prevAmount && prevAmount > 0
      ? ((amount - prevAmount) / prevAmount) * 100
      : null
    return { year, amount, pctChange }
  })

  return result
})

// CAGR from projection data or compute from yearly dividends
const cagr = computed(() => {
  if (props.projection?.cagr) return props.projection.cagr
  const yd = yearlyDividends.value
  if (yd.length < 2) return 0
  const first = yd[0]
  const last = yd[yd.length - 1]
  const numYears = yd.length - 1
  if (first.amount <= 0 || numYears <= 0) return 0
  return (Math.pow(last.amount / first.amount, 1 / numYears) - 1) * 100
})

const chartOptions = computed(() => {
  const yd = yearlyDividends.value
  if (!yd.length) return null

  const categories = yd.map((d) => d.year)
  const amounts = yd.map((d) => d.amount)
  const c = props.currency
  const cagrVal = cagr.value

  // Generate CAGR trend line data
  const trendData = []
  if (yd.length >= 2 && yd[0].amount > 0 && cagrVal !== 0) {
    const firstAmount = yd[0].amount
    for (let i = 0; i < yd.length; i++) {
      trendData.push(parseFloat((firstAmount * Math.pow(1 + cagrVal / 100, i)).toFixed(4)))
    }
  }

  return {
    chart: {
      type: 'column',
      backgroundColor: 'transparent',
      style: { fontFamily: 'Inter, system-ui, sans-serif' },
      spacing: [16, 16, 12, 12],
    },
    title: {
      useHTML: true,
      text: `<div style="display:flex;align-items:baseline;justify-content:space-between;"><span style="color:#e4e4e7;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Histórico de Dividendos</span>${cagrVal ? `<span style="color:#f87171;font-size:11px;font-weight:600;">CAGR: ${cagrVal.toFixed(2)}%</span>` : ''}</div>`,
      align: 'left',
      widthAdjust: 0,
      style: { width: '100%' },
    },
    subtitle: freshSubtitle(props.freshLabel),
    xAxis: {
      categories,
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
          return c + this.value.toFixed(2)
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
        const idx = categories.indexOf(year)
        const item = idx >= 0 ? yd[idx] : null
        const val = item ? c + item.amount.toFixed(4) : '-'
        const pct = item && item.pctChange != null ? (item.pctChange >= 0 ? '+' : '') + item.pctChange.toFixed(2) + '%' : ''
        const pctColor = item && item.pctChange != null ? (item.pctChange >= 0 ? '#34d399' : '#f87171') : '#a1a1aa'

        let html = `<div style="
          background: rgba(14, 14, 22, 0.85);
          backdrop-filter: blur(20px);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 10px;
          padding: 10px 14px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.4);
          min-width: 160px;
        ">`
        html += `<div style="color: #a1a1aa; font-size: 10px; margin-bottom: 6px;">${year}</div>`
        html += `<div style="display: flex; align-items: center; gap: 8px; margin-bottom: 3px;">
          <span style="width: 6px; height: 6px; border-radius: 50%; background: #34d399; flex-shrink: 0;"></span>
          <span style="color: #a1a1aa; font-size: 11px; flex: 1;">Dividendo Anual</span>
          <span style="color: #e4e4e7; font-size: 11px; font-weight: 600;">${val}</span>
        </div>`
        if (pct) {
          html += `<div style="display: flex; align-items: center; gap: 8px;">
            <span style="width: 6px; height: 6px; flex-shrink: 0;"></span>
            <span style="color: #a1a1aa; font-size: 11px; flex: 1;">Incremento</span>
            <span style="color: ${pctColor}; font-size: 11px; font-weight: 600;">${pct}</span>
          </div>`
        }
        html += '</div>'
        return html
      },
    },
    plotOptions: {
      column: {
        borderRadius: 3,
        borderWidth: 0,
        dataLabels: {
          enabled: true,
          useHTML: true,
          formatter() {
            const idx = this.point.index
            const item = yd[idx]
            const amount = c + item.amount.toFixed(2)
            const pct = item.pctChange != null ? (item.pctChange >= 0 ? '+' : '') + item.pctChange.toFixed(2) + '%' : ''
            const pctColor = item.pctChange != null ? (item.pctChange >= 0 ? '#34d399' : '#f87171') : ''

            let label = `<div style="text-align: center; line-height: 1.3;">`
            if (pct) {
              label += `<div style="color: ${pctColor}; font-size: 9px; font-weight: 600;">${pct}</div>`
            }
            label += `<div style="color: #a1a1aa; font-size: 9px;">${amount}</div>`
            label += `</div>`
            return label
          },
          style: { textOutline: 'none' },
          overflow: 'allow',
          crop: false,
        },
      },
    },
    series: [
      {
        name: 'Dividendo Anual',
        data: amounts,
        color: '#34d399',
        zIndex: 1,
      },
      ...(trendData.length ? [{
        name: `CAGR ${cagrVal.toFixed(2)}%`,
        type: 'line',
        data: trendData,
        color: '#f87171',
        dashStyle: 'Dash',
        lineWidth: 2,
        marker: { enabled: false },
        enableMouseTracking: false,
        zIndex: 2,
      }] : []),
    ],
    credits: { enabled: false },
  }
})

function renderChart() {
  if (chartOptions.value && chartContainer.value) {
    if (chartInstance) chartInstance.destroy()
    chartInstance = Highcharts.chart(chartContainer.value, chartOptions.value)
  }
}

watch(chartOptions, renderChart, { deep: true })
onMounted(renderChart)
onBeforeUnmount(() => {
  if (chartInstance) { chartInstance.destroy(); chartInstance = null }
})
</script>

<template>
  <ChartInfoOverlay description="Muestra el dividendo total pagado cada año y su tendencia de crecimiento (CAGR). Barras crecientes de forma constante indican una empresa comprometida con la remuneración al accionista. La línea CAGR muestra la tasa de crecimiento compuesto anual. Un CAGR > 5% es buen indicador de crecimiento del dividendo.">
    <div ref="chartContainer" class="w-full" style="min-height: 400px"></div>
  </ChartInfoOverlay>
</template>
