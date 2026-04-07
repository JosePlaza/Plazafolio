<script setup>
import { ref, computed, watch } from 'vue'
import ChartInfoOverlay from '@/components/ChartInfoOverlay.vue'
import { useSettings } from '@/composables/useSettings'
import { useAudioPlayer } from '@/composables/useAudioPlayer'

const { geminiApiKey } = useSettings()
const audio = useAudioPlayer()

const props = defineProps({
  report: { type: Object, required: true },
  ticker: { type: String, required: true },
  narrativeError: { type: String, default: '' },
  generatingAudio: { type: Boolean, default: false },
})

const emit = defineEmits(['back', 'regenerate', 'generate-audio'])

// ── Audio: delegate to global composable ──
const isPlaying = computed(() => audio.playingReportId.value === props.report.id && audio.isPlaying.value)
const audioProgress = computed(() => audio.playingReportId.value === props.report.id ? audio.currentProgress.value : 0)
const audioDuration = computed(() => audio.playingReportId.value === props.report.id ? audio.currentDuration.value : 0)

function toggleAudio() {
  audio.play(props.report)
}

function seekAudio(e) {
  const rect = e.currentTarget.getBoundingClientRect()
  const pct = (e.clientX - rect.left) / rect.width
  audio.seekTo(Math.max(0, Math.min(1, pct)))
}

function fmtTime(s) { return audio.fmtTime(s) }

// No cleanup needed — audio persists globally

function fmtVal(val, format) {
  if (val == null || isNaN(val)) return '-'
  if (format === 'currency') {
    const abs = Math.abs(val)
    if (abs >= 1e12) return '$' + (val / 1e12).toFixed(1) + 'T'
    if (abs >= 1e9) return '$' + (val / 1e9).toFixed(2) + 'B'
    if (abs >= 1e6) return '$' + (val / 1e6).toFixed(1) + 'M'
    if (abs >= 1e3) return '$' + (val / 1e3).toFixed(0) + 'K'
    return '$' + val.toFixed(0)
  }
  if (format === 'percent') return val.toFixed(1) + '%'
  if (format === 'decimal') return '$' + val.toFixed(2)
  return String(val)
}

function fmtDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
}

const signalCounts = computed(() => {
  const s = props.report.diagnosis?.signals || []
  return {
    positive: s.filter(x => x.type === 'positive').length,
    negative: s.filter(x => x.type === 'negative').length,
    neutral: s.filter(x => x.type === 'neutral').length,
  }
})
</script>

<template>
  <div class="space-y-4">
    <!-- Back header -->
    <div class="flex items-center gap-3 mb-2">
      <button
        class="gw-btn-icon w-9 h-9 shrink-0"
        @click="emit('back')"
        title="Volver"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>
      <div class="flex-1 min-w-0">
        <h2 class="text-sm font-bold text-foreground">{{ ticker }} · {{ report.reportType }}</h2>
        <div class="text-[10px] text-zinc-500">{{ report.periodCurrent }} vs {{ report.periodPrevious }} · presentado {{ fmtDate(report.filedDate) }}</div>
      </div>
      <!-- Overall sentiment badge -->
      <div class="flex gap-1 text-[10px]">
        <span v-if="signalCounts.positive" class="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400" :title="`${signalCounts.positive} señal${signalCounts.positive > 1 ? 'es' : ''} positiva${signalCounts.positive > 1 ? 's' : ''}`">↑{{ signalCounts.positive }}</span>
        <span v-if="signalCounts.negative" class="px-1.5 py-0.5 rounded bg-red-500/10 text-red-400" :title="`${signalCounts.negative} señal${signalCounts.negative > 1 ? 'es' : ''} negativa${signalCounts.negative > 1 ? 's' : ''}`">↓{{ signalCounts.negative }}</span>
        <span v-if="signalCounts.neutral" class="px-1.5 py-0.5 rounded bg-zinc-500/10 text-zinc-400" :title="`${signalCounts.neutral} señal${signalCounts.neutral > 1 ? 'es' : ''} neutral${signalCounts.neutral > 1 ? 'es' : ''}`">→{{ signalCounts.neutral }}</span>
      </div>
    </div>

    <!-- LLM Narrative -->
    <div v-if="report.narrative" class="glass-card p-4">
      <ChartInfoOverlay description="Resumen generado por IA (Gemini Flash) a partir de los datos XBRL oficiales de la SEC, enriquecido con noticias relevantes del periodo mediante Google Search. No es asesoramiento financiero. Contrasta siempre con el informe original.">
        <h3 class="text-xs font-semibold text-foreground uppercase tracking-wider mb-2">Resumen ejecutivo</h3>

        <!-- ── Audio player box (inside card, above text) ── -->
        <div v-if="report.audioUrl" class="mb-3 rounded-lg p-2.5" style="background: rgba(255,255,255,0.025); border: 1px solid rgba(255,255,255,0.05);">
          <div class="flex items-center gap-2.5">
            <button
              @click="toggleAudio"
              class="w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-all"
              :class="isPlaying
                ? 'bg-primary/20 text-primary ring-1 ring-primary/30'
                : 'bg-white/[0.06] text-zinc-400 hover:text-zinc-200 hover:bg-white/10'"
            >
              <svg v-if="!isPlaying" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
              <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
            </button>
            <div class="flex-1 flex items-center gap-2 min-w-0">
              <span class="text-[9px] text-zinc-500 tabular-nums w-8 text-right shrink-0">{{ fmtTime(audioProgress) }}</span>
              <div
                class="flex-1 h-1 rounded-full bg-white/[0.06] cursor-pointer relative group"
                @click="seekAudio"
              >
                <div
                  class="absolute inset-y-0 left-0 rounded-full transition-colors"
                  :class="isPlaying ? 'bg-primary/60 group-hover:bg-primary/80' : 'bg-zinc-500/40 group-hover:bg-zinc-500/60'"
                  :style="{ width: audioDuration ? (audioProgress / audioDuration * 100) + '%' : '0%' }"
                />
              </div>
              <span class="text-[9px] text-zinc-500 tabular-nums w-8 shrink-0">{{ fmtTime(audioDuration) }}</span>
            </div>
          </div>
        </div>
        <!-- Generating audio indicator (inside card, above text) -->
        <div v-else-if="generatingAudio" class="mb-3 rounded-lg p-2.5 flex items-center gap-2" style="background: rgba(255,255,255,0.025); border: 1px solid rgba(255,255,255,0.05);">
          <svg class="w-4 h-4 animate-spin text-zinc-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10" stroke-opacity="0.2" /><path d="M12 2a10 10 0 0 1 10 10" />
          </svg>
          <span class="text-[10px] text-zinc-500">Generando audio del resumen...</span>
        </div>
        <div class="text-[12px] leading-relaxed text-zinc-300 space-y-2">
          <p v-for="(para, i) in report.narrative.split('\n\n').filter(p => p.trim())" :key="i">{{ para.trim() }}</p>
        </div>
        <!-- Grounding sources -->
        <div v-if="report.narrativeSources && report.narrativeSources.length" class="mt-3 pt-3 border-t border-white/5">
          <h4 class="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-1.5">Fuentes</h4>
          <div class="flex flex-wrap gap-1.5">
            <a
              v-for="(src, i) in report.narrativeSources"
              :key="i"
              :href="src.url"
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/[0.04] border border-white/[0.06] text-[10px] text-zinc-400 hover:text-blue-400 hover:border-blue-500/30 transition-colors max-w-[280px] truncate"
              :title="src.title || src.url"
            >
              <svg class="w-3 h-3 shrink-0 opacity-50" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
              <span class="truncate">{{ src.title || new URL(src.url).hostname }}</span>
            </a>
          </div>
        </div>
        <div class="mt-2 flex items-center justify-between">
          <span class="text-[9px] text-zinc-500 italic">Generado por Gemini Flash con Google Search · no es asesoramiento financiero</span>
          <button
            v-if="!report.narrativeSources || report.narrativeSources.length === 0"
            @click="emit('regenerate')"
            class="text-[10px] text-blue-400/60 hover:text-blue-300 transition-colors"
            title="Regenerar resumen con noticias y fuentes"
          >
            ↻ Regenerar con fuentes
          </button>
        </div>
      </ChartInfoOverlay>
    </div>
    <!-- No narrative: explain why -->
    <div v-else class="glass-card p-4">
      <h3 class="text-xs font-semibold text-foreground uppercase tracking-wider mb-2">Resumen ejecutivo</h3>
      <div v-if="!geminiApiKey" class="text-[12px] text-zinc-500 leading-relaxed">
        <p>Para ver un resumen generado por IA, configura tu API key de Gemini en <strong class="text-zinc-400">Ajustes</strong> (icono ⚙ en la cabecera).</p>
        <p class="mt-1.5 text-[10px] text-zinc-500">Es gratuita — obtenla en <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener" class="text-blue-400/70 hover:text-blue-300 underline">aistudio.google.com/apikey</a></p>
      </div>
      <div v-else class="text-[12px] text-zinc-500 leading-relaxed">
        <p>No se pudo generar el resumen. Verifica que tu API key sea válida en <strong class="text-zinc-400">Ajustes</strong>.</p>
        <p v-if="narrativeError" class="mt-1.5 text-[10px] text-red-400/70 font-mono">Error: {{ narrativeError }}</p>
        <button @click="emit('back')" class="mt-2 text-[11px] text-blue-400/70 hover:text-blue-300 underline">← Volver y reintentar</button>
      </div>
    </div>

    <!-- Diagnosis signals -->
    <div v-if="report.diagnosis" class="glass-card p-4">
      <h3 class="text-xs font-semibold text-foreground uppercase tracking-wider mb-2">Diagnóstico</h3>
      <div class="text-[11px] text-zinc-300 mb-3">{{ report.diagnosis.summary }}</div>
      <div class="space-y-1.5">
        <div
          v-for="(signal, i) in report.diagnosis.signals"
          :key="i"
          class="flex items-start gap-2 text-[11px]"
        >
          <span class="mt-0.5 w-1.5 h-1.5 rounded-full shrink-0" :class="{
            'bg-emerald-400': signal.type === 'positive',
            'bg-red-400': signal.type === 'negative',
            'bg-zinc-500': signal.type === 'neutral',
          }"></span>
          <span class="text-zinc-400">{{ signal.text }}</span>
        </div>
      </div>
    </div>

    <!-- Metrics table -->
    <div class="glass-card p-4">
      <ChartInfoOverlay description="Métricas financieras extraídas del sistema XBRL de la SEC. Cada fila muestra el valor del periodo anterior, el actual, y la variación porcentual. Verde = mejora, rojo = deterioro, gris = estable.">
        <h3 class="text-xs font-semibold text-foreground uppercase tracking-wider mb-3">Métricas detalladas</h3>
        <!-- Column headers -->
        <div class="flex items-center justify-between text-[9px] text-zinc-500 uppercase tracking-wider pb-1.5 border-b border-white/5 mb-1">
          <span class="flex-1">Métrica</span>
          <span class="w-20 text-right">{{ report.periodPrevious }}</span>
          <span class="w-20 text-right">{{ report.periodCurrent }}</span>
          <span class="w-16 text-right">Var.</span>
        </div>
        <div class="space-y-0.5">
          <div
            v-for="(m, key) in report.metrics"
            :key="key"
            class="flex items-center justify-between py-1.5 border-b border-white/[0.03] last:border-0"
          >
            <span class="flex-1 text-[11px] text-zinc-400">{{ m.label }}</span>
            <span class="w-20 text-right text-[11px] text-zinc-500 tabular-nums">{{ fmtVal(m.previous, m.format) }}</span>
            <span class="w-20 text-right text-[11px] font-medium tabular-nums" :class="{
              'text-emerald-400': m.direction === 'positive',
              'text-red-400': m.direction === 'negative',
              'text-zinc-400': m.direction === 'stable',
            }">{{ fmtVal(m.current, m.format) }}</span>
            <span class="w-16 text-right text-[10px] tabular-nums" :class="{
              'text-emerald-400/70': m.direction === 'positive',
              'text-red-400/70': m.direction === 'negative',
              'text-zinc-500': m.direction === 'stable',
            }">
              <template v-if="m.direction === 'stable'">→ 0%</template>
              <template v-else>{{ m.change > 0 ? '↑' : '↓' }} {{ Math.abs(m.change) }}%</template>
            </span>
          </div>
        </div>
      </ChartInfoOverlay>
    </div>

    <!-- Source info -->
    <div class="text-center text-[9px] text-zinc-500 pb-4">
      Datos XBRL de SEC EDGAR · cache 7 días · {{ report.source?.toUpperCase() || 'SEC' }}
    </div>
  </div>
</template>
