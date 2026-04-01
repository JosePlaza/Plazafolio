<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import Highcharts from 'highcharts'
import ChartInfoOverlay from '@/components/ChartInfoOverlay.vue'
import { labelStyle, gridColor, titleStyle, earthyBrown, legendBottom, fmtNum, cagr, yearFromDate, buildTooltip, freshSubtitle } from '@/lib/chartConfig'

const props = defineProps({
  fundamentals: { type: Object, default: null },
  currency: { type: String, default: '$' },
  freshLabel: { type: String, default: '' },
})

const chartContainer = ref(null)
let chartInstance = null

const hasData = computed(() => props.fundamentals?.income?.length > 0)

const chartOptions = computed(() => {
  if (!hasData.value) return null
  const inc = props.fundamentals.income
  const categories = inc.map((d) => yearFromDate(d.date))
  const revenueData = inc.map((d) => d.totalRevenue ?? 0)
  const netIncomeData = inc.map((d) => d.netIncome ?? 0)
  const marginData = inc.map((d) =>
    d.totalRevenue > 0 ? parseFloat(((d.netIncome / d.totalRevenue) * 100).toFixed(2)) : 0
  )
  const revCagr = cagr(revenueData)
  const niCagr = cagr(netIncomeData.filter((v) => v > 0).length >= 2 ? netIncomeData : [])

  return {
    chart: { backgroundColor: 'transparent', style: { fontFamily: 'Inter, system-ui, sans-serif' }, spacing: [16, 16, 12, 16] },
    title: { text: 'Ingresos', align: 'left', style: titleStyle },
    subtitle: freshSubtitle(props.freshLabel),
    xAxis: { categories, labels: { style: labelStyle }, lineColor: 'rgba(255,255,255,0.06)', tickLength: 0 },
    yAxis: [
      { title: { text: null }, labels: { style: labelStyle, formatter() { return fmtNum(this.value) } }, gridLineColor: gridColor, gridLineDashStyle: 'Dot' },
      { title: { text: null }, labels: { style: labelStyle, format: '{value}%' }, opposite: true, gridLineWidth: 0 },
    ],
    legend: legendBottom,
    tooltip: {
      shared: true, useHTML: true, backgroundColor: 'transparent', borderWidth: 0, shadow: false, padding: 0,
      formatter() { return buildTooltip(this.points[0]?.key ?? this.x, this.points) },
    },
    plotOptions: { column: { borderRadius: 3, borderWidth: 0, groupPadding: 0.15, pointPadding: 0.05 } },
    series: [
      { name: `Ingresos (CAGR: ${revCagr.toFixed(1)}%)`, type: 'column', yAxis: 0, data: revenueData, color: '#415BFF', zIndex: 1 },
      { name: `Ing. Netos (CAGR: ${niCagr.toFixed(1)}%)`, type: 'column', yAxis: 0, data: netIncomeData, color: earthyBrown, zIndex: 1 },
      {
        name: 'Margen Neto', type: 'spline', yAxis: 1, data: marginData, color: '#f87171', lineWidth: 2, zIndex: 2,
        marker: { enabled: true, radius: 3, fillColor: '#f87171', lineWidth: 2, lineColor: '#0e0e16' },
        dataLabels: { enabled: true, formatter() { return this.y !== 0 ? this.y.toFixed(1) + '%' : '' }, style: { color: '#f87171', fontSize: '9px', fontWeight: '600', textOutline: '1px rgba(14,14,22,0.9)' }, y: -8 },
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
  <ChartInfoOverlay description="Muestra los ingresos totales vs ingresos netos (beneficio) y el margen neto. Ingresos crecientes de forma sostenida son señal de un negocio saludable. Si el margen neto se mantiene o sube, la empresa es eficiente controlando costes. Márgenes decrecientes pueden indicar presión competitiva o costes crecientes.">
    <div ref="chartContainer" v-show="hasData" class="w-full" style="min-height: 400px"></div>
    <div v-if="!hasData" class="flex items-center justify-center" style="min-height: 400px;">
      <p class="text-muted-foreground/50 text-xs">Datos de ingresos no disponibles</p>
    </div>
  </ChartInfoOverlay>
</template>
