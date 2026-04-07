<script setup>
import { ref, computed, watch } from 'vue'
import { fetchEarningsCallBrief } from '@/services/earningsCallApi'
import { useSettings } from '@/composables/useSettings'
import { useAudioPlayer } from '@/composables/useAudioPlayer'

const props = defineProps({
  ticker: { type: String, required: true },
})

const { geminiApiKey } = useSettings()

const data = ref(null)
const loading = ref(false)
const error = ref(null)
const expanded = ref(false)

const toneConfig = computed(() => {
  const tone = data.value?.tone || 'Neutral'
  const map = {
    'Confiado':     { color: '#22c55e', bg: 'rgba(34,197,94,0.12)', icon: '↑' },
    'Entusiasta':   { color: '#22c55e', bg: 'rgba(34,197,94,0.12)', icon: '↑↑' },
    'Neutral':      { color: '#a1a1aa', bg: 'rgba(161,161,170,0.12)', icon: '→' },
    'Cauteloso':    { color: '#eab308', bg: 'rgba(234,179,8,0.12)', icon: '~' },
    'Evasivo':      { color: '#ef4444', bg: 'rgba(239,68,68,0.12)', icon: '!' },
    'Sin mención':  { color: '#a1a1aa', bg: 'rgba(161,161,170,0.12)', icon: '—' },
  }
  return map[tone] || map['Neutral']
})

async function loadBrief() {
  if (!props.ticker || loading.value) return
  loading.value = true
  error.value = null
  try {
    data.value = await fetchEarningsCallBrief(props.ticker, geminiApiKey.value)
  } catch (err) {
    error.value = err.message
  } finally {
    loading.value = false
  }
}

async function refresh() {
  loading.value = true
  error.value = null
  try {
    data.value = await fetchEarningsCallBrief(props.ticker, geminiApiKey.value, { forceRefresh: true })
  } catch (err) {
    error.value = err.message
  } finally {
    loading.value = false
  }
}

watch(() => props.ticker, () => {
  data.value = null
  expanded.value = false
  loadBrief()
}, { immediate: true })
</script>

<template>
  <div class="glass-card ecb-card">
    <!-- Header -->
    <div class="ecb-header" @click="expanded = !expanded">
      <!-- Icon -->
      <div class="ecb-icon">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="23" />
          <line x1="8" y1="23" x2="16" y2="23" />
        </svg>
      </div>

      <div class="ecb-header-info">
        <div class="ecb-title">Earnings Call</div>
        <div v-if="loading" class="ecb-subtitle" style="opacity: 0.4;">Analizando...</div>
        <div v-else-if="data" class="ecb-subtitle">
          {{ data.fiscalPeriod }}
          <span v-if="data.hasTranscript" class="ecb-transcript-badge">Transcript</span>
          <span v-else class="ecb-search-badge">Búsqueda</span>
        </div>
        <div v-else-if="error" class="ecb-subtitle" style="color: #ef4444;">{{ error }}</div>
        <div v-else class="ecb-subtitle" style="opacity: 0.3;">Sin datos</div>
      </div>

      <!-- Tone badge -->
      <div v-if="data?.tone" class="ecb-tone-badge"
        :style="{ background: toneConfig.bg, color: toneConfig.color }">
        <span class="ecb-tone-icon">{{ toneConfig.icon }}</span>
        {{ data.tone }}
      </div>

      <!-- Loading spinner -->
      <div v-if="loading" class="ecb-loading">
        <svg class="ecb-spinner" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
      </div>

      <div class="ecb-expand-arrow" :class="{ open: expanded }">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M4 6L8 10L12 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        </svg>
      </div>
    </div>

    <!-- Expanded body -->
    <Transition name="ecb-expand">
      <div v-if="expanded && data" class="ecb-body">
        <!-- Brief text -->
        <div class="ecb-brief">{{ data.brief }}</div>

        <!-- Sources -->
        <div v-if="data.sources?.length" class="ecb-sources">
          <a v-for="s in data.sources" :key="s.url" :href="s.url" target="_blank" rel="noopener" class="ecb-source">
            {{ s.title || s.url }}
          </a>
        </div>

        <!-- Meta info -->
        <div class="ecb-meta">
          <span v-if="data.callDate">Call: {{ data.callDate }}</span>
          <span v-if="data.analyzedAt">
            Analizado {{ new Date(data.analyzedAt).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) }}
          </span>
          <span v-if="data.fromCache">(cache)</span>
        </div>

        <!-- Refresh -->
        <button class="ecb-refresh" @click.stop="refresh" :disabled="loading">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M1 4v6h6M23 20v-6h-6" />
            <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" />
          </svg>
          Actualizar
        </button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.ecb-card {
  overflow: hidden;
}

/* ─── Header ─── */
.ecb-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  cursor: pointer;
  user-select: none;
}

.ecb-header:hover {
  background: rgba(255, 255, 255, 0.02);
}

.ecb-icon {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: rgba(65, 91, 255, 0.08);
  color: #415BFF;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.ecb-header-info {
  flex: 1;
  min-width: 0;
}

.ecb-title {
  font-size: 14px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
}

.ecb-subtitle {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
  margin-top: 1px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.ecb-transcript-badge,
.ecb-search-badge {
  font-size: 9px;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 4px;
  letter-spacing: 0.3px;
  text-transform: uppercase;
}

.ecb-transcript-badge {
  background: rgba(34, 197, 94, 0.15);
  color: #22c55e;
}

.ecb-search-badge {
  background: rgba(234, 179, 8, 0.15);
  color: #eab308;
}

/* ─── Tone Badge ─── */
.ecb-tone-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 3px 8px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.ecb-tone-icon {
  font-size: 10px;
}

/* ─── Loading ─── */
.ecb-loading {
  flex-shrink: 0;
}

.ecb-spinner {
  animation: ecb-spin 1s linear infinite;
}

@keyframes ecb-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* ─── Expand Arrow ─── */
.ecb-expand-arrow {
  color: rgba(255, 255, 255, 0.3);
  transition: transform 0.3s ease;
  flex-shrink: 0;
}

.ecb-expand-arrow.open {
  transform: rotate(180deg);
}

/* ─── Body ─── */
.ecb-body {
  padding: 0 16px 16px;
}

.ecb-brief {
  font-size: 13px;
  line-height: 1.65;
  color: rgba(255, 255, 255, 0.7);
  white-space: pre-line;
}

/* ─── Sources ─── */
.ecb-sources {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 12px;
}

.ecb-source {
  font-size: 10px;
  color: rgba(65, 91, 255, 0.6);
  text-decoration: none;
  padding: 2px 6px;
  background: rgba(65, 91, 255, 0.06);
  border-radius: 4px;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ecb-source:hover {
  color: #415BFF;
  background: rgba(65, 91, 255, 0.1);
}

/* ─── Meta ─── */
.ecb-meta {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.2);
  margin-top: 10px;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

/* ─── Refresh ─── */
.ecb-refresh {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
  padding: 5px 10px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.ecb-refresh:hover:not(:disabled) {
  color: rgba(255, 255, 255, 0.7);
  background: rgba(255, 255, 255, 0.08);
}

.ecb-refresh:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

/* ─── Expand Transition ─── */
.ecb-expand-enter-active,
.ecb-expand-leave-active {
  transition: all 0.3s ease;
  overflow: hidden;
}

.ecb-expand-enter-from,
.ecb-expand-leave-to {
  opacity: 0;
  max-height: 0;
}

.ecb-expand-enter-to,
.ecb-expand-leave-from {
  max-height: 800px;
}
</style>
