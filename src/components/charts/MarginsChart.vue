<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import Highcharts from 'highcharts'
import ChartInfoOverlay from '@/components/ChartInfoOverlay.vue'
import { labelStyle, gridColor, titleStyle, legendBottom, yearFromDate, freshSubtitle, chartTitle } from '@/lib/chartConfig'

const props = defineProps({
  fundamentals: { type: Object, default: null },
  freshLabel: { type: String, default: '' },
})

const chartContainer = ref(null)
let chartInstance = null
const hasData = computed(() => props.fundamentals?.income?.length > 0)

const chartOptions = computed(() => {
  if (!hasData.value) return null
  const inc = props.fundamentals.income
  const categories = inc.map((d) => yearFromDate(d.date))
  const grossMargin = inc.map((d) => d.totalRevenue > 0 ? parseFloat(((d.grossProfit / d.totalRevenue) * 100).toFixed(2)) : null)
  const operatingMargin = inc.map((d) => d.totalRevenue > 0 ? parseFloat(((d.operatingIncome / d.totalRevenue) * 100).toFixed(2)) : null)
  const netMargin = inc.map((d) => d.totalRevenue > 0 ? parseFloat(((d.netIncome / d.totalRevenue) * 100).toFixed(2)) : null)
  const lastMargin = [...netMargin].reverse().find(v => v != null)
  const health = lastMargin == null ? null : lastMargin > 15 ? 'green' : lastMargin >= 5 ? 'neutral' : 'red'

  return {
    chart: { backgroundColor: 'transparent', style: { fontFamily: 'Inter, system-ui, sans-serif' }, spacing: [16, 16, 12, 16] },
    title: chartTitle('Márgenes', health),
    subtitle: freshSubtitle(props.freshLabel),
    xAxis: { categories, labels: { style: labelStyle }, lineColor: 'rgba(255,255,255,0.06)', tickLength: 0 },
    yAxis: { title: { text: null }, labels: { style: labelStyle, format: '{value}%' }, gridLineColor: gridColor, gridLineDashStyle: 'Dot' },
    legend: legendBottom,
    tooltip: {
      shared: true, useHTML: true, backgroundColor: 'transparent', borderWidth: 0, shadow: false, padding: 0,
      formatter() {
        let html = `<div style="background:rgba(14,14,22,0.85);backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:10px 14px;box-shadow:0 8px 32px rgba(0,0,0,0.4);min-width:160px;">`
        html += `<div style="color:#a1a1aa;font-size:10px;margin-bottom:6px;">${this.points[0]?.key ?? this.x}</div>`
        this.points.forEach((p) => {
          if (p.y == null) return
          html += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:3px;"><span style="width:6px;height:6px;border-radius:50%;background:${p.color};flex-shrink:0;"></span><span style="color:#a1a1aa;font-size:11px;flex:1;">${p.series.name}</span><span style="color:#e4e4e7;font-size:11px;font-weight:600;">${p.y.toFixed(2)}%</span></div>`
        })
        html += '</div>'; return html
      },
    },
    series: [
      { name: 'Margen Bruto', type: 'spline', data: grossMargin, color: '#60a5fa', lineWidth: 2, marker: { enabled: true, radius: 3, fillColor: '#60a5fa', lineWidth: 2, lineColor: '#0e0e16' } },
      { name: 'Margen Operativo', type: 'spline', data: operatingMargin, color: '#fbbf24', lineWidth: 2, marker: { enabled: true, radius: 3, fillColor: '#fbbf24', lineWidth: 2, lineColor: '#0e0e16' } },
      { name: 'Margen Neto', type: 'spline', data: netMargin, color: '#34d399', lineWidth: 2, marker: { enabled: true, radius: 3, fillColor: '#34d399', lineWidth: 2, lineColor: '#0e0e16' } },
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
  <ChartInfoOverlay description="Muestra la evolución de los tres márgenes principales. El margen bruto indica cuánto queda tras el coste del producto. El operativo, tras gastos de gestión. El neto, el beneficio real tras impuestos. Márgenes estables o crecientes indican ventaja competitiva. Caídas sostenidas pueden señalar problemas de eficiencia o competencia.">
    <div ref="chartContainer" v-show="hasData" class="w-full" style="min-height: 400px"></div>
    <div v-if="!hasData" class="flex items-center justify-center" style="min-height: 400px;">
      <p class="text-muted-foreground/50 text-xs">Datos de márgenes no disponibles</p>
    </div>
  </ChartInfoOverlay>
</template>
