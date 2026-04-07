<script setup>
import { ref, computed, inject, watch } from 'vue'
import SkeletonLoader from '@/components/SkeletonLoader.vue'
import IndicatorsPanel from '@/components/IndicatorsPanel.vue'
import GeraldineChart from '@/components/charts/GeraldineChart.vue'
import YieldsChart from '@/components/charts/YieldsChart.vue'
import DividendsChart from '@/components/charts/DividendsChart.vue'
import ProjectionChart from '@/components/charts/ProjectionChart.vue'
import DrawdownChart from '@/components/charts/DrawdownChart.vue'
import SustainabilityChart from '@/components/charts/SustainabilityChart.vue'
import DividendHistoryChart from '@/components/charts/DividendHistoryChart.vue'
import RevenueChart from '@/components/charts/RevenueChart.vue'
import MarginsChart from '@/components/charts/MarginsChart.vue'
import EvFcfChart from '@/components/charts/EvFcfChart.vue'
import EvEbitdaChart from '@/components/charts/EvEbitdaChart.vue'
import DebtChart from '@/components/charts/DebtChart.vue'
import SharesChart from '@/components/charts/SharesChart.vue'
import SecReportDetail from '@/components/SecReportDetail.vue'
import { useSettings } from '@/composables/useSettings'
import { useAudioPlayer } from '@/composables/useAudioPlayer'
import { fetchSecReports as fetchSecReportsApi, regenerateNarrative as regenerateNarrativeApi, generateReportAudio } from '@/services/secReportsApi'
import { fetchEsefReports as fetchEsefReportsApi } from '@/services/esefReportsApi'

const app = inject('appState')
const { geminiApiKey } = useSettings()
const audio = useAudioPlayer()

function fmtFreshDate(raw) {
  if (!raw) return ''
  if (/^\d{4}$/.test(raw)) return raw
  const months = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']
  const p = raw.split('-')
  if (p.length >= 3) return `${parseInt(p[2])} ${months[parseInt(p[1]) - 1]} ${p[0]}`
  return raw
}
function freshLabel(date, source) {
  const d = fmtFreshDate(date)
  return d ? `${source} · ${d}` : ''
}

const freshLabels = computed(() => {
  const d = app.data
  const lastPrice = d.priceBands?.length ? d.priceBands[d.priceBands.length - 1]?.date?.substring(0, 10) : ''
  const lastDiv = d.dividends?.length ? d.dividends[d.dividends.length - 1]?.date?.substring(0, 10) : ''
  const lastCf = d.cashFlow?.length ? String(d.cashFlow[d.cashFlow.length - 1]?.year || '') : ''
  const lastFund = d.fundamentals?.income?.length
    ? d.fundamentals.income[d.fundamentals.income.length - 1]?.date?.substring(0, 10) : ''
  return {
    price: freshLabel(lastPrice, 'Cotización'),
    dividend: freshLabel(lastDiv, 'Ex-dividendo'),
    cashFlow: freshLabel(lastCf, 'FMP'),
    fundamentals: freshLabel(lastFund, 'Resultados'),
  }
})

// ── Drilldown view: 'charts' (default) or 'reports' ──
const drilldownView = ref('charts')

// ── Financial Reports (SEC for US, ESEF for EU) ──
const isUsStock = computed(() => app.ticker.value && !app.ticker.value.includes('.'))
const isEuStock = computed(() => app.ticker.value && app.ticker.value.includes('.'))
const hasReportSource = computed(() => isUsStock.value || isEuStock.value)
const reportsSourceLabel = computed(() => isUsStock.value ? 'SEC EDGAR' : 'ESEF / XBRL')

const secAllReports = ref([])
const secReportsLoading = ref(false)
const secReportsError = ref(null)
const secNarrativeError = ref('')
const selectedSecReport = ref(null)
const generatingAudio = ref(false)

const secReportsData = computed(() => ({
  reports: secAllReports.value,
  hasNarrative: secAllReports.value.some(r => r.narrative),
  narrativeError: secNarrativeError.value,
}))

// Group reports by year for the redesigned view
const reportsByYear = computed(() => {
  const groups = {}
  for (const r of secAllReports.value) {
    const year = r.filedDate ? r.filedDate.substring(0, 4) : 'Sin fecha'
    if (!groups[year]) groups[year] = []
    groups[year].push(r)
  }
  // Sort years descending
  return Object.entries(groups).sort((a, b) => b[0].localeCompare(a[0]))
})

async function fetchReports() {
  if (!hasReportSource.value || !app.ticker.value) return
  secReportsLoading.value = true
  secReportsError.value = null
  secNarrativeError.value = ''
  try {
    let all = []
    if (isUsStock.value) {
      const [quarterly, annual] = await Promise.all([
        fetchSecReportsApi(app.ticker.value, '10-Q').catch(() => ({ reports: [] })),
        fetchSecReportsApi(app.ticker.value, '10-K').catch(() => ({ reports: [] })),
      ])
      all = [...(quarterly.reports || []), ...(annual.reports || [])]
      secNarrativeError.value = quarterly.narrativeError || annual.narrativeError || ''
    } else {
      const result = await fetchEsefReportsApi(app.ticker.value).catch(() => ({ reports: [] }))
      all = result.reports || []
    }
    const fiveYearsAgo = new Date()
    fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5)
    const cutoff = fiveYearsAgo.toISOString().slice(0, 10)
    secAllReports.value = all
      .filter(r => !r.filedDate || r.filedDate >= cutoff)
      .sort((a, b) => (b.filedDate || '').localeCompare(a.filedDate || ''))
  } catch (err) {
    console.error('Error fetching reports:', err)
    secReportsError.value = err.message
    secAllReports.value = []
  } finally {
    secReportsLoading.value = false
  }
}

function openSecReport(report) {
  selectedSecReport.value = report
  if (!report.narrative && geminiApiKey.value) {
    // Generate narrative, then auto-generate audio if report doesn't already have one
    generateNarrativeForReport(report).then(() => {
      if (selectedSecReport.value?.narrative && !report.audioUrl && geminiApiKey.value) {
        onGenerateAudio()
      }
    })
  } else if (report.narrative && !report.audioUrl && geminiApiKey.value) {
    // Narrative exists but no audio yet — generate it
    onGenerateAudio()
  }
  // If report already has audioUrl → do nothing, reuse existing audio
}

function closeSecReport() {
  selectedSecReport.value = null
}

async function generateNarrativeForReport(report) {
  if (!geminiApiKey.value) return
  try {
    report.narrative = 'Generando resumen con IA...'
    report.narrativeSources = []
    const data = await regenerateNarrativeApi(report.id, geminiApiKey.value, report)
    if (data.ok) {
      report.narrative = data.narrative
      report.narrativeSources = data.narrativeSources || []
      const listReport = secAllReports.value.find(r => r.id === report.id)
      if (listReport) {
        listReport.narrative = data.narrative
        listReport.narrativeSources = data.narrativeSources || []
      }
    } else {
      report.narrative = null
      secNarrativeError.value = data.error || 'Error al generar resumen'
    }
  } catch (err) {
    report.narrative = null
    secNarrativeError.value = err.message
  }
}

function regenerateNarrative() {
  if (!selectedSecReport.value) return
  generateNarrativeForReport(selectedSecReport.value)
}

async function onGenerateAudio() {
  if (!selectedSecReport.value || !geminiApiKey.value || generatingAudio.value) return
  // Never regenerate if audio already exists
  if (selectedSecReport.value.audioUrl) return
  generatingAudio.value = true
  try {
    const data = await generateReportAudio(selectedSecReport.value.id, geminiApiKey.value)
    if (data.ok && data.audioUrl) {
      selectedSecReport.value.audioUrl = data.audioUrl
      const listReport = secAllReports.value.find(r => r.id === selectedSecReport.value.id)
      if (listReport) listReport.audioUrl = data.audioUrl
    }
  } catch (err) {
    console.warn('[SEC] Audio error:', err.message)
  } finally {
    generatingAudio.value = false
  }
}

function sentimentOf(report) {
  const signals = report.diagnosis?.signals || []
  const pos = signals.filter(s => s.type === 'positive').length
  const neg = signals.filter(s => s.type === 'negative').length
  if (pos > neg * 2) return 'positive'
  if (neg > pos * 2) return 'negative'
  if (pos > neg) return 'mixed-positive'
  if (neg > pos) return 'mixed-negative'
  return 'neutral'
}

function sentimentColor(s) {
  return {
    positive: '#34d399',
    'mixed-positive': '#34d39980',
    negative: '#f87171',
    'mixed-negative': '#f8717180',
    neutral: '#71717a',
  }[s] || '#71717a'
}

function sentimentLabel(s) {
  return {
    positive: 'Positivo',
    'mixed-positive': 'Mixto positivo',
    negative: 'Negativo',
    'mixed-negative': 'Mixto negativo',
    neutral: 'Neutro',
  }[s] || 'Neutro'
}

function fmtDate(dateStr) {
  if (!dateStr) return '-'
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
}

// ── Inline audio player (delegates to global composable) ──
function toggleReportAudio(report, e) {
  e.stopPropagation()
  audio.play(report)
}

function seekReportAudio(report, e) {
  e.stopPropagation()
  if (!audio.currentDuration.value) return
  const rect = e.currentTarget.getBoundingClientRect()
  const pct = (e.clientX - rect.left) / rect.width
  audio.seekTo(Math.max(0, Math.min(1, pct)))
}

function audioProgressPct(report) {
  if (audio.playingReportId.value !== report.id || !audio.currentDuration.value) return 0
  return audio.progressPct.value
}

// No onBeforeUnmount cleanup — audio persists globally via composable

// Extract key metrics from diagnosis signals for display
function keyMetrics(report) {
  const signals = report.diagnosis?.signals || []
  return signals.slice(0, 3)
}

// Fetch reports when ticker changes
watch(() => app.ticker.value, (newTicker) => {
  if (newTicker) {
    selectedSecReport.value = null
    drilldownView.value = 'charts'
    secAllReports.value = []
    fetchReports()
  }
}, { immediate: true })
</script>

<template>
  <main class="dot-pattern flex-1 lg:mr-72 overflow-y-auto p-3 sm:p-5 space-y-4 pb-navbar" style="max-height: calc(100dvh - 3.5rem - env(safe-area-inset-top, 0px))">
    <SkeletonLoader v-if="app.loading.value" />

    <div v-if="app.error.value && !app.loading.value" class="glass-card p-4" style="border-color: rgba(239, 68, 68, 0.2);">
      <p class="text-destructive text-sm">{{ app.error.value }}</p>
    </div>

    <div v-if="!app.hasData.value && !app.loading.value && !app.error.value" class="flex flex-col items-center justify-center py-32">
      <div class="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#415BFF" stroke-width="1.5" stroke-linecap="round">
          <path d="M3 3v18h18" />
          <path d="m7 14 4-4 4 4 5-5" />
        </svg>
      </div>
      <p class="text-muted-foreground text-sm mb-1">Selecciona un activo del sidebar para analizar</p>
      <p class="text-muted-foreground/50 text-xs">O añade uno nuevo con el botón +</p>
    </div>

    <template v-if="app.hasData.value && !app.loading.value">

      <!-- ═══ SEC Report Detail Drilldown ═══ -->
      <SecReportDetail
        v-if="selectedSecReport"
        :report="selectedSecReport"
        :ticker="app.ticker.value"
        :narrative-error="secReportsData?.narrativeError || ''"
        :generating-audio="generatingAudio"
        @back="closeSecReport"
        @regenerate="regenerateNarrative"
        @generate-audio="onGenerateAudio"
      />

      <!-- ═══ Reports List View (redesigned) ═══ -->
      <template v-else-if="drilldownView === 'reports'">
        <!-- Header -->
        <div class="flex items-center gap-3 mb-4">
          <button
            class="gw-btn-icon w-9 h-9 shrink-0"
            @click="drilldownView = 'charts'"
            title="Volver a gráficos"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <div v-if="app.companyLogo.value" class="w-8 h-8 rounded-lg overflow-hidden shrink-0 bg-white/5 p-0.5">
            <img :src="app.companyLogo.value" :alt="app.ticker.value" class="w-full h-full object-contain rounded-md" />
          </div>
          <div class="flex-1 min-w-0">
            <h2 class="text-base font-semibold text-foreground tracking-tight">Informes de resultados</h2>
            <span class="text-[10px] text-zinc-500">{{ app.companyName.value || app.ticker.value }} · {{ reportsSourceLabel }}</span>
          </div>
          <span v-if="secAllReports.length" class="text-[10px] text-zinc-500 tabular-nums">{{ secAllReports.length }} informes</span>
        </div>

        <!-- Loading -->
        <div v-if="secReportsLoading" class="flex flex-col items-center justify-center py-16">
          <div class="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin mb-3"></div>
          <span class="text-xs text-zinc-400">{{ isUsStock ? 'Consultando SEC EDGAR...' : 'Consultando ESEF...' }}</span>
        </div>

        <!-- Error -->
        <div v-else-if="secReportsError" class="glass-card p-6 text-center">
          <div class="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center mx-auto mb-3">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
          </div>
          <div class="text-zinc-400 text-sm">{{ secReportsError }}</div>
        </div>

        <!-- Reports grouped by year -->
        <template v-else-if="secAllReports.length">
          <div v-for="[year, reports] in reportsByYear" :key="year" class="mb-5">
            <!-- Year header -->
            <div class="flex items-center gap-2 mb-2 px-1">
              <span class="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">{{ year }}</span>
              <div class="flex-1 h-px bg-white/[0.04]"></div>
            </div>

            <!-- Report cards -->
            <div class="space-y-3">
              <div
                v-for="report in reports"
                :key="report.id"
                class="glass-card w-full text-left p-4 group cursor-pointer"
                @click="openSecReport(report)"
              >
                <!-- Top row: type badge + period + date -->
                <div class="flex items-center gap-2 mb-2">
                  <span class="report-type-badge" :class="
                    report.reportType === '10-K' || report.reportType === 'Anual'
                      ? 'report-type-annual'
                      : 'report-type-quarterly'
                  ">{{ report.reportType }}</span>
                  <span class="text-sm font-medium text-foreground">{{ report.periodCurrent }}</span>
                  <span class="flex-1"></span>
                  <span class="text-[10px] text-zinc-500 tabular-nums">{{ fmtDate(report.filedDate) }}</span>
                </div>

                <!-- Summary -->
                <p class="text-xs text-zinc-400 leading-relaxed line-clamp-2 mb-3">
                  {{ report.diagnosis?.summary || 'Sin diagnóstico disponible' }}
                </p>

                <!-- Bottom row: sentiment + signal chips + arrow -->
                <div class="flex items-center gap-2 flex-wrap">
                  <span
                    class="report-sentiment-chip"
                    :style="{ color: sentimentColor(sentimentOf(report)), borderColor: sentimentColor(sentimentOf(report)) + '30' }"
                  >
                    <span class="w-1.5 h-1.5 rounded-full" :style="{ backgroundColor: sentimentColor(sentimentOf(report)) }"></span>
                    {{ sentimentLabel(sentimentOf(report)) }}
                  </span>
                  <span
                    v-for="(signal, idx) in keyMetrics(report)"
                    :key="idx"
                    class="report-signal-chip"
                    :class="signal.type === 'positive' ? 'text-emerald-400/70' : signal.type === 'negative' ? 'text-red-400/70' : 'text-zinc-500'"
                  >{{ signal.label }}</span>
                  <span class="flex-1"></span>
                  <span v-if="report.narrative" class="text-[9px] text-amber-400/60 flex items-center gap-1" title="Resumen IA disponible">
                    <span>✦</span><span class="hidden lg:inline">IA</span>
                  </span>
                  <svg class="w-4 h-4 text-zinc-600 group-hover:text-zinc-300 transition-colors shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </div>

                <!-- Inline audio player (if report has audio) -->
                <div v-if="report.audioUrl" class="audio-row" @click.stop>
                  <button
                    class="audio-play-btn"
                    :class="audio.playingReportId.value === report.id && audio.isPlaying.value ? 'audio-playing' : ''"
                    @click="toggleReportAudio(report, $event)"
                  >
                    <!-- Play icon -->
                    <svg v-if="audio.playingReportId.value !== report.id || !audio.isPlaying.value" width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                      <polygon points="6,4 20,12 6,20" />
                    </svg>
                    <!-- Pause icon -->
                    <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                      <rect x="5" y="4" width="4" height="16" rx="1" />
                      <rect x="15" y="4" width="4" height="16" rx="1" />
                    </svg>
                  </button>

                  <!-- Progress bar -->
                  <div
                    class="audio-track"
                    @click="seekReportAudio(report, $event)"
                  >
                    <div
                      class="audio-track-fill"
                      :style="{ width: audioProgressPct(report) + '%' }"
                    ></div>
                  </div>

                  <!-- Time -->
                  <span class="audio-time">
                    <template v-if="audio.playingReportId.value === report.id">{{ audio.fmtTime(audio.currentProgress.value) }}</template>
                    <template v-else>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
                    </template>
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div v-if="secReportsData?.hasNarrative" class="text-center py-2">
            <span class="text-[10px] text-zinc-500">✦ Resumen ejecutivo por IA disponible en los informes marcados</span>
          </div>
        </template>

        <!-- Empty -->
        <div v-else-if="!secReportsLoading" class="flex flex-col items-center justify-center py-16">
          <div class="w-12 h-12 rounded-xl bg-white/[0.03] flex items-center justify-center mb-3">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#52525b" stroke-width="1.5" stroke-linecap="round">
              <path d="M14 2v4a2 2 0 0 0 2 2h4" />
              <path d="M16 22h2a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v3.5" />
              <path d="M4.017 11.512a6 6 0 1 0 8.466 8.475" />
              <path d="M9 16a6 6 0 0 1 6-6v6z" />
            </svg>
          </div>
          <p class="text-zinc-500 text-sm">No hay informes disponibles</p>
          <p class="text-zinc-600 text-[10px] mt-1">Los informes se cargan automáticamente de {{ reportsSourceLabel }}</p>
        </div>
      </template>

      <!-- ═══ Normal Charts View ═══ -->
      <template v-else>
        <!-- Title row -->
        <div class="flex flex-wrap items-center gap-3 sm:gap-4">
          <div v-if="app.companyLogo.value" class="w-9 h-9 sm:w-11 sm:h-11 rounded-xl overflow-hidden flex-shrink-0 bg-white/5 p-1">
            <img :src="app.companyLogo.value" :alt="app.ticker.value" class="w-full h-full object-contain rounded-lg" />
          </div>
          <div v-else class="w-9 h-9 sm:w-11 sm:h-11 rounded-xl flex-shrink-0 bg-primary/10 flex items-center justify-center">
            <span class="text-primary text-sm font-bold">{{ app.ticker.value?.slice(0, 2) }}</span>
          </div>
          <div class="flex-1 min-w-0">
            <h1 class="text-lg sm:text-xl font-bold text-foreground tracking-tight truncate leading-tight">{{ app.companyName.value || app.ticker.value }}</h1>
            <span class="text-muted-foreground text-xs">{{ app.ticker.value }}</span>
          </div>
          <div class="flex items-center gap-2">
            <span v-if="app.refreshing.value" class="text-[10px] text-primary/60 flex items-center gap-1.5">
              <span class="w-1.5 h-1.5 rounded-full bg-primary/60 animate-pulse"></span>
              Actualizando...
            </span>

            <!-- Reports button (desktop: text) -->
            <button
              v-if="hasReportSource"
              class="reports-btn-text"
              @click="drilldownView = 'reports'"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 2v4a2 2 0 0 0 2 2h4" />
                <path d="M16 22h2a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v3.5" />
                <path d="M4.017 11.512a6 6 0 1 0 8.466 8.475" />
                <path d="M9 16a6 6 0 0 1 6-6v6z" />
              </svg>
              <span>Informes de resultados</span>
              <svg class="w-3.5 h-3.5 opacity-50" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>

            <!-- Reports button (mobile: icon only) -->
            <button
              v-if="hasReportSource"
              class="reports-btn-mobile"
              @click="drilldownView = 'reports'"
              title="Informes de resultados"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 2v4a2 2 0 0 0 2 2h4" />
                <path d="M16 22h2a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v3.5" />
                <path d="M4.017 11.512a6 6 0 1 0 8.466 8.475" />
                <path d="M9 16a6 6 0 0 1 6-6v6z" />
              </svg>
            </button>
          </div>
        </div>

        <!-- Charts grid -->
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <div class="lg:col-span-4 glass-card p-4">
            <IndicatorsPanel :indicators="app.data.indicators" :projection="app.data.projection" :dividends="app.data.dividends" :currency="app.currency.value" :ticker="app.ticker.value" :fresh-label="freshLabels.price" />
          </div>
          <div class="lg:col-span-8 glass-card p-4">
            <GeraldineChart :price-bands="app.data.priceBands" :ticker="app.ticker.value" :currency="app.currency.value" :fresh-label="freshLabels.price" />
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="glass-card p-4"><YieldsChart :daily-yields="app.data.dailyYields" :avg-high-yield="app.data.indicators?.avgHighYield || 0" :avg-low-yield="app.data.indicators?.avgLowYield || 0" :avg-yield="app.data.indicators?.avgYield || 0" :ticker="app.ticker.value" :fresh-label="freshLabels.price" /></div>
          <div class="glass-card p-4"><DividendsChart :dividends="app.data.dividends" :ticker="app.ticker.value" :currency="app.currency.value" :fresh-label="freshLabels.dividend" /></div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="glass-card p-4"><DividendHistoryChart :dividends="app.data.dividends" :projection="app.data.projection" :ticker="app.ticker.value" :currency="app.currency.value" :fresh-label="freshLabels.dividend" /></div>
          <div class="glass-card p-4"><ProjectionChart :projection="app.data.projection" :indicators="app.data.indicators" :ticker="app.ticker.value" :currency="app.currency.value" :fresh-label="freshLabels.dividend" /></div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="glass-card p-4"><SustainabilityChart :cash-flow="app.data.cashFlow" :ticker="app.ticker.value" :currency="app.currency.value" :fresh-label="freshLabels.cashFlow" /></div>
          <div class="glass-card p-4"><DrawdownChart :drawdown="app.data.drawdown" :ticker="app.ticker.value" :currency="app.currency.value" :fresh-label="freshLabels.price" /></div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="glass-card p-4"><RevenueChart :fundamentals="app.data.fundamentals" :ticker="app.ticker.value" :currency="app.currency.value" :fresh-label="freshLabels.fundamentals" /></div>
          <div class="glass-card p-4"><MarginsChart :fundamentals="app.data.fundamentals" :fresh-label="freshLabels.fundamentals" /></div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="glass-card p-4"><EvFcfChart :fundamentals="app.data.fundamentals" :ticker="app.ticker.value" :currency="app.currency.value" :fresh-label="freshLabels.fundamentals" /></div>
          <div class="glass-card p-4"><EvEbitdaChart :fundamentals="app.data.fundamentals" :ticker="app.ticker.value" :currency="app.currency.value" :fresh-label="freshLabels.fundamentals" /></div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="glass-card p-4"><DebtChart :fundamentals="app.data.fundamentals" :ticker="app.ticker.value" :currency="app.currency.value" :fresh-label="freshLabels.fundamentals" /></div>
          <div class="glass-card p-4"><SharesChart :fundamentals="app.data.fundamentals" :fresh-label="freshLabels.fundamentals" /></div>
        </div>
      </template>
    </template>
  </main>
</template>

<style scoped>
/* ── Desktop reports button (same style as gw-btn-icon but wider with text) ── */
.reports-btn-text {
  align-items: center;
  gap: 6px;
  padding: 0 14px;
  height: 36px;
  border-radius: 10px;
  font-size: 12px;
  font-weight: 500;
  color: #415BFF;
  background: rgba(65, 91, 255, 0.12);
  border: 1px solid rgba(65, 91, 255, 0.2);
  transition: all 0.2s ease;
  cursor: pointer;
  white-space: nowrap;
  display: none;
}
@media (min-width: 1024px) {
  .reports-btn-text { display: inline-flex; }
}
.reports-btn-text:hover {
  background: rgba(65, 91, 255, 0.2);
  border-color: rgba(65, 91, 255, 0.4);
}

/* ── Mobile reports icon button (mirrors gw-btn-icon, hidden on desktop) ── */
.reports-btn-mobile {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  color: #415BFF;
  background: rgba(65, 91, 255, 0.12);
  border: 1px solid rgba(65, 91, 255, 0.2);
  cursor: pointer;
  transition: all 0.2s ease;
}
.reports-btn-mobile:hover {
  background: rgba(65, 91, 255, 0.2);
  border-color: rgba(65, 91, 255, 0.4);
}
@media (min-width: 1024px) {
  .reports-btn-mobile { display: none; }
}

/* ── Report type badges ── */
.report-type-badge {
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.02em;
}
.report-type-annual {
  background: rgba(251, 191, 36, 0.08);
  color: rgba(251, 191, 36, 0.8);
}
.report-type-quarterly {
  background: rgba(96, 165, 250, 0.08);
  color: rgba(96, 165, 250, 0.7);
}

/* ── Sentiment + signal chips ── */
.report-sentiment-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 99px;
  font-size: 9px;
  font-weight: 600;
  border: 1px solid;
  letter-spacing: 0.01em;
}
.report-signal-chip {
  font-size: 9px;
  font-weight: 500;
}

/* ── Inline audio player row ── */
.audio-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.04);
}

.audio-play-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: rgba(65, 91, 255, 0.12);
  color: #415BFF;
  border: none;
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.2s ease;
}
.audio-play-btn:hover {
  background: rgba(65, 91, 255, 0.22);
  transform: scale(1.05);
}
.audio-play-btn.audio-playing {
  background: rgba(65, 91, 255, 0.2);
  color: #818cf8;
}

.audio-track {
  flex: 1;
  height: 4px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.06);
  cursor: pointer;
  position: relative;
  overflow: hidden;
}
.audio-track:hover {
  height: 6px;
}

.audio-track-fill {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  border-radius: 2px;
  background: linear-gradient(90deg, #415BFF, #818cf8);
  transition: width 0.25s linear;
}

.audio-time {
  font-size: 10px;
  color: #71717a;
  font-variant-numeric: tabular-nums;
  min-width: 28px;
  text-align: right;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
}

/* Line clamp */
.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
