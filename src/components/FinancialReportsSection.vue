<script setup>
import { ref, computed, watch } from 'vue'
import SecReportDetail from '@/components/SecReportDetail.vue'
import DividendSafetyCard from '@/components/DividendSafetyCard.vue'
import EarningsCallBrief from '@/components/EarningsCallBrief.vue'
import { useSettings } from '@/composables/useSettings'
import { useAudioPlayer } from '@/composables/useAudioPlayer'
import {
  fetchSecReports as fetchSecReportsApi,
  regenerateNarrative as regenerateNarrativeApi,
  generateReportAudio,
} from '@/services/secReportsApi'
import { fetchEsefReports as fetchEsefReportsApi } from '@/services/esefReportsApi'

/**
 * Informes de resultados (SEC EDGAR para US, ESEF para EU) junto con las cards
 * de seguridad del dividendo y earnings call.
 *
 * Extraído de AnalysisView para poder montarlo también en el detalle de un
 * activo del portfolio, que es donde vive ahora: el botón "Informes de
 * resultados" del análisis navega hasta aquí en vez de cambiar de sub-vista.
 */
const props = defineProps({
  ticker: { type: String, default: '' },
})

const { geminiApiKey } = useSettings()
const audio = useAudioPlayer()

const isUsStock = computed(() => props.ticker && !props.ticker.includes('.'))
const isEuStock = computed(() => props.ticker && props.ticker.includes('.'))
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
  if (!hasReportSource.value || !props.ticker) return
  secReportsLoading.value = true
  secReportsError.value = null
  secNarrativeError.value = ''
  try {
    let all = []
    if (isUsStock.value) {
      const [quarterly, annual] = await Promise.all([
        fetchSecReportsApi(props.ticker, '10-Q').catch(() => ({ reports: [] })),
        fetchSecReportsApi(props.ticker, '10-K').catch(() => ({ reports: [] })),
      ])
      all = [...(quarterly.reports || []), ...(annual.reports || [])]
      secNarrativeError.value = quarterly.narrativeError || annual.narrativeError || ''
    } else {
      const result = await fetchEsefReportsApi(props.ticker).catch(() => ({ reports: [] }))
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


watch(() => props.ticker, (t) => {
  selectedSecReport.value = null
  secAllReports.value = []
  if (t) fetchReports()
}, { immediate: true })
</script>

<template>
  <div>
      <!-- ═══ SEC Report Detail Drilldown ═══ -->
      <SecReportDetail
        v-if="selectedSecReport"
        :report="selectedSecReport"
        :ticker="ticker"
        :narrative-error="secReportsData?.narrativeError || ''"
        :generating-audio="generatingAudio"
        @back="closeSecReport"
        @regenerate="regenerateNarrative"
        @generate-audio="onGenerateAudio"
      />

      <!-- ═══ Listado de informes ═══ -->
      <template v-else>
        <!-- Cabecera -->
        <div class="flex items-center gap-3 mb-4">
          <div class="flex-1 min-w-0">
            <h3 class="text-xs font-semibold text-foreground uppercase tracking-wider">Informes de resultados</h3>
            <span class="text-[10px] text-zinc-500">{{ reportsSourceLabel }}</span>
          </div>
          <span v-if="secAllReports.length" class="text-[10px] text-zinc-500 tabular-nums">{{ secAllReports.length }} informes</span>
        </div>

        <!-- ═══ Seguridad del dividendo + Earnings call ═══ -->
        <DividendSafetyCard :ticker="ticker" class="mb-4" />
        <EarningsCallBrief :ticker="ticker" class="mb-4" />

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
  </div>
</template>
