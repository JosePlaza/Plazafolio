<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import Highcharts from 'highcharts'
import ChartInfoOverlay from '@/components/ChartInfoOverlay.vue'
import { labelStyle, gridColor, titleStyle, earthyBrown, legendBottom, fmtNum, cagr, freshSubtitle } from '@/lib/chartConfig'

const props = defineProps({
  cashFlow: { type: Array, default: () => [] },
  ticker: { type: String, default: '' },
  currency: { type: String, default: '$' },
  freshLabel: { type: String, default: '' },
})

const chartContainer = ref(null)
let chartInstance = null

const hasData = computed(() => props.cashFlow && props.cashFlow.length > 0)

const chartOptions = computed(() => {
  if (!hasData.value) return null
  const cf = props.cashFlow
  const categories = cf.map((d) => d.year)
  const fcfData = cf.map((d) => d.freeCashFlow)
  const divData = cf.map((d) => d.dividendsPaid)
  const payoutData = cf.map((d) => d.freeCashFlow > 0 ? parseFloat(((d.dividendsPaid / d.freeCashFlow) * 100).toFixed(2)) : 0)
  const fcfCagr = cagr(fcfData)
  const divCagr = cagr(divData)

  return {
    chart: { backgroundColor: 'transparent', style: { fontFamily: 'Inter, system-ui, sans-serif' }, spacing: [16, 16, 12, 16] },
    title: { text: 'Sostenibilidad del Dividendo', align: 'left', style: titleStyle },
    subtitle: freshSubtitle(props.freshLabel),
    xAxis: { categories, labels: { style: labelStyle }, lineColor: 'rgba(255,255,255,0.06)', tickLength: 0, crosshair: { color: 'rgba(255,255,255,0.06)', width: 1 } },
    yAxis: [
      { title: { text: null }, labels: { style: labelStyle, formatter() { return fmtNum(this.value) } }, gridLineColor: gridColor, gridLineDashStyle: 'Dot' },
      { title: { text: null }, labels: { style: labelStyle, format: '{value}%' }, opposite: true, gridLineWidth: 0, min: 0, max: 120 },
    ],
    legend: legendBottom,
    tooltip: {
      shared: true, useHTML: true, backgroundColor: 'transparent', borderWidth: 0, shadow: false, padding: 0,
      formatter() {
        let html = `<div style="background:rgba(14,14,22,0.85);backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:10px 14px;box-shadow:0 8px 32px rgba(0,0,0,0.4);min-width:180px;">`
        html += `<div style="color:#a1a1aa;font-size:10px;margin-bottom:6px;">${this.points[0]?.key ?? this.x}</div>`
        this.points.forEach((p) => {
          if (p.y == null) return
          const isP = p.series.yAxis.options.opposite
          const val = isP ? p.y.toFixed(2) + '%' : fmtNum(p.y)
          html += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:3px;"><span style="width:6px;height:6px;border-radius:50%;background:${p.color};flex-shrink:0;"></span><span style="color:#a1a1aa;font-size:11px;flex:1;">${p.series.name}</span><span style="color:#e4e4e7;font-size:11px;font-weight:600;">${val}</span></div>`
        })
        html += '</div>'; return html
      },
    },
    plotOptions: { column: { borderRadius: 3, borderWidth: 0, groupPadding: 0.15, pointPadding: 0.05 } },
    series: [
      { name: `FCF (CAGR: ${fcfCagr.toFixed(1)}%)`, type: 'column', yAxis: 0, data: fcfData, color: '#415BFF', zIndex: 1 },
      { name: `Dividendos (CAGR: ${divCagr.toFixed(1)}%)`, type: 'column', yAxis: 0, data: divData, color: earthyBrown, zIndex: 1 },
      {
        name: 'FCF Payout', type: 'spline', yAxis: 1, data: payoutData, color: '#f87171', lineWidth: 2, zIndex: 2,
        marker: { enabled: true, radius: 3, fillColor: '#f87171', lineWidth: 2, lineColor: '#0e0e16' },
        dataLabels: { enabled: true, formatter() { return this.y > 0 ? this.y.toFixed(1) + '%' : '' }, style: { color: '#f87171', fontSize: '9px', fontWeight: '600', textOutline: '1px rgba(14,14,22,0.9)' }, y: -8 },
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
  <ChartInfoOverlay description="Compara el Free Cash Flow (dinero real generado) con los dividendos pagados. El payout ratio indica qué porcentaje del FCF se destina a dividendos. Un payout por debajo del 60-70% es sostenible. Si el payout supera el 100%, la empresa paga más dividendos de los que genera, lo cual no es sostenible a largo plazo.">
    <div ref="chartContainer" v-show="hasData" class="w-full" style="min-height: 400px"></div>
    <div v-if="!hasData" class="flex items-center justify-center" style="min-height: 400px;">
      <p class="text-muted-foreground/50 text-xs">Datos de cash flow no disponibles</p>
    </div>
  </ChartInfoOverlay>
</template>
