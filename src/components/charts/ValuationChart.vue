<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import Highcharts from 'highcharts'
import ChartInfoOverlay from '@/components/ChartInfoOverlay.vue'
import { labelStyle, gridColor, titleStyle, legendBottom, yearFromDate, freshSubtitle, chartTitle } from '@/lib/chartConfig'

const props = defineProps({
  fundamentals: { type: Object, default: null },
  prices: { type: Array, default: () => [] },
  ticker: { type: String, default: '' },
  freshLabel: { type: String, default: '' },
})

const chartContainer = ref(null)
let chartInstance = null

// Find the closing price nearest to a given date
function priceAtDate(dateStr) {
  if (!props.prices.length) return null
  const target = dateStr.substring(0, 10)
  // Binary-ish: prices are sorted ascending by date, find closest
  let best = null, bestDiff = Infinity
  for (let i = props.prices.length - 1; i >= 0; i--) {
    const pDate = props.prices[i].date?.substring(0, 10)
    if (!pDate) continue
    const diff = Math.abs(new Date(pDate) - new Date(target))
    if (diff < bestDiff) { bestDiff = diff; best = props.prices[i].close }
    if (diff > bestDiff) break // passed optimal, stop
  }
  return best
}

const hasData = computed(() => {
  const inc = props.fundamentals?.income
  const bal = props.fundamentals?.balance
  return inc?.length > 1 && bal?.length > 1 && props.prices.length > 0
})

const chartOptions = computed(() => {
  if (!hasData.value) return null

  const inc = props.fundamentals.income
  const bal = props.fundamentals.balance
  const cf = props.fundamentals.cashFlow || []

  const balMap = Object.fromEntries(bal.map(d => [yearFromDate(d.date), d]))
  const cfMap = Object.fromEntries(cf.map(d => [yearFromDate(d.date), d]))

  // Calculate historical EV/EBITDA for each year
  const points = []
  for (const row of inc) {
    const year = yearFromDate(row.date)
    const ebitda = row.ebitda
    if (!ebitda || ebitda <= 0) continue

    const balRow = balMap[year]
    if (!balRow) continue

    const shares = balRow.ordinarySharesNumber
    if (!shares || shares <= 0) continue

    const price = priceAtDate(row.date)
    if (!price) continue

    const marketCap = price * shares
    const totalDebt = balRow.totalDebt ?? 0
    const cash = balRow.cashAndEquivalents ?? 0
    const ev = marketCap + totalDebt - cash
    const evEbitda = ev / ebitda

    if (evEbitda > 0 && evEbitda < 100) {
      points.push({ year, evEbitda: parseFloat(evEbitda.toFixed(2)) })
    }
  }

  if (points.length < 2) return null

  const categories = points.map(p => p.year)
  const evEbitdaData = points.map(p => p.evEbitda)

  // Calculate average (excluding outliers)
  const avg = evEbitdaData.reduce((s, v) => s + v, 0) / evEbitdaData.length
  const avgRounded = parseFloat(avg.toFixed(2))

  // Current value (last point)
  const current = evEbitdaData[evEbitdaData.length - 1]
  const health = current < avg * 0.9 ? 'green' : current > avg * 1.1 ? 'red' : 'neutral'

  // Zone bands: +/- 1 std dev
  const stdDev = Math.sqrt(evEbitdaData.reduce((s, v) => s + (v - avg) ** 2, 0) / evEbitdaData.length)
  const highBand = parseFloat((avg + stdDev).toFixed(2))
  const lowBand = parseFloat(Math.max(0, avg - stdDev).toFixed(2))

  return {
    chart: { backgroundColor: 'transparent', style: { fontFamily: 'Inter, system-ui, sans-serif' }, spacing: [16, 16, 12, 16] },
    title: chartTitle('Valoracion EV/EBITDA', health),
    subtitle: freshSubtitle(props.freshLabel),
    xAxis: { categories, labels: { style: labelStyle }, lineColor: 'rgba(255,255,255,0.06)', tickLength: 0 },
    yAxis: {
      title: { text: null },
      labels: { style: labelStyle, format: '{value}x' },
      gridLineColor: gridColor,
      gridLineDashStyle: 'Dot',
      plotBands: [{
        from: lowBand,
        to: highBand,
        color: 'rgba(65, 91, 255, 0.06)',
        label: { text: 'Rango normal', align: 'right', style: { color: 'rgba(255,255,255,0.15)', fontSize: '9px' }, x: -8 },
      }],
      plotLines: [{
        value: avgRounded,
        color: 'rgba(255,255,255,0.25)',
        dashStyle: 'Dash',
        width: 1,
        zIndex: 3,
        label: { text: 'Media ' + avgRounded + 'x', align: 'right', style: { color: 'rgba(255,255,255,0.4)', fontSize: '9px' }, x: -4, y: -4 },
      }],
    },
    legend: legendBottom,
    tooltip: {
      shared: true, useHTML: true, backgroundColor: 'transparent', borderWidth: 0, shadow: false, padding: 0,
      formatter() {
        const p = this.points?.[0]
        if (!p) return ''
        const val = p.y.toFixed(2) + 'x'
        const diff = ((p.y - avgRounded) / avgRounded * 100).toFixed(1)
        const tag = p.y < avgRounded ? 'infravalorado' : p.y > avgRounded ? 'sobrevalorado' : 'neutral'
        const tagColor = p.y < avg * 0.9 ? '#34d399' : p.y > avg * 1.1 ? '#f87171' : '#fbbf24'
        let html = `<div style="background:rgba(14,14,22,0.85);backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:10px 14px;box-shadow:0 8px 32px rgba(0,0,0,0.4);min-width:140px;">`
        html += `<div style="color:#a1a1aa;font-size:10px;margin-bottom:6px;">${p.key}</div>`
        html += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:3px;"><span style="width:6px;height:6px;border-radius:50%;background:${p.color};flex-shrink:0;"></span><span style="color:#a1a1aa;font-size:11px;flex:1;">EV/EBITDA</span><span style="color:#e4e4e7;font-size:11px;font-weight:600;">${val}</span></div>`
        html += `<div style="color:${tagColor};font-size:10px;margin-top:4px;">${diff > 0 ? '+' : ''}${diff}% vs media → ${tag}</div>`
        html += '</div>'
        return html
      },
    },
    plotOptions: {
      areaspline: { fillOpacity: 0.08 },
    },
    series: [{
      name: 'EV/EBITDA historico',
      type: 'areaspline',
      data: evEbitdaData,
      color: '#415BFF',
      lineWidth: 2.5,
      zIndex: 2,
      marker: {
        enabled: true, radius: 4, fillColor: '#415BFF', lineWidth: 2, lineColor: '#0e0e16',
        states: { hover: { radius: 6 } },
      },
      dataLabels: {
        enabled: true,
        formatter() { return this.y.toFixed(1) + 'x' },
        style: { color: '#818cf8', fontSize: '9px', fontWeight: '600', textOutline: '1px rgba(14,14,22,0.9)' },
        y: -10,
      },
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
  <ChartInfoOverlay description="Muestra el multiplo EV/EBITDA REAL que el mercado pagaba cada ano (calculado con el precio y balance de ese momento). La linea punteada es la media historica. Por debajo = empresa barata respecto a su historia. Por encima = cara. La banda sombreada muestra el rango normal (+/- 1 desviacion estandar).">
    <div ref="chartContainer" v-show="hasData" class="w-full" style="min-height: 440px"></div>
    <div v-if="!hasData" class="flex items-center justify-center" style="min-height: 440px;">
      <p class="text-muted-foreground/50 text-xs">Datos insuficientes para valoracion historica</p>
    </div>
  </ChartInfoOverlay>
</template>
