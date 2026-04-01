<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import Highcharts from 'highcharts'
import ChartInfoOverlay from '@/components/ChartInfoOverlay.vue'
import { labelStyle, gridColor, titleStyle, legendBottom, fmtNum, yearFromDate, freshSubtitle } from '@/lib/chartConfig'

const props = defineProps({
  fundamentals: { type: Object, default: null },
  freshLabel: { type: String, default: '' },
})

const chartContainer = ref(null)
let chartInstance = null
const hasData = computed(() => {
  const bal = props.fundamentals?.balance
  return bal && bal.length > 0 && bal.some((d) => d.ordinarySharesNumber)
})

const chartOptions = computed(() => {
  if (!hasData.value) return null
  const bal = props.fundamentals.balance
  const categories = bal.map((d) => yearFromDate(d.date))
  const sharesData = bal.map((d) => d.ordinarySharesNumber ?? 0)

  return {
    chart: { backgroundColor: 'transparent', style: { fontFamily: 'Inter, system-ui, sans-serif' }, spacing: [16, 16, 12, 16] },
    title: { text: 'Acciones en Circulación', align: 'left', style: titleStyle },
    subtitle: freshSubtitle(props.freshLabel),
    xAxis: { categories, labels: { style: labelStyle }, lineColor: 'rgba(255,255,255,0.06)', tickLength: 0 },
    yAxis: { title: { text: null }, labels: { style: labelStyle, formatter() { return fmtNum(this.value) } }, gridLineColor: gridColor, gridLineDashStyle: 'Dot' },
    legend: legendBottom,
    tooltip: {
      useHTML: true, backgroundColor: 'transparent', borderWidth: 0, shadow: false, padding: 0,
      formatter() {
        return `<div style="background:rgba(14,14,22,0.85);backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:10px 14px;box-shadow:0 8px 32px rgba(0,0,0,0.4);">
          <div style="color:#a1a1aa;font-size:10px;margin-bottom:4px;">${this.key ?? this.x}</div>
          <div style="color:#e4e4e7;font-size:12px;font-weight:600;">${fmtNum(this.y)} acciones</div>
        </div>`
      },
    },
    plotOptions: {
      column: {
        borderRadius: 3, borderWidth: 0, pointPadding: 0.1, groupPadding: 0.1,
        dataLabels: {
          enabled: true, formatter() { return fmtNum(this.y) },
          style: { color: '#71717a', fontSize: '9px', fontWeight: '600', textOutline: '1px rgba(14,14,22,0.9)' }, y: -4,
        },
      },
    },
    series: [{ name: 'Acciones', type: 'column', data: sharesData, color: '#34d399', zIndex: 1 }],
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
  <ChartInfoOverlay description="Muestra la evolución del número de acciones en circulación. Si las acciones disminuyen, la empresa está recomprando acciones (buyback), lo cual beneficia al accionista porque cada acción representa más propiedad. Si aumentan, la empresa está diluyendo a los accionistas emitiendo nuevas acciones (para financiación o compensación).">
    <div ref="chartContainer" v-show="hasData" class="w-full" style="min-height: 400px"></div>
    <div v-if="!hasData" class="flex items-center justify-center" style="min-height: 400px;">
      <p class="text-muted-foreground/50 text-xs">Datos de acciones no disponibles</p>
    </div>
  </ChartInfoOverlay>
</template>
