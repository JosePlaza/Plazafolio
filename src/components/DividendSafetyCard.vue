<script setup>
import { ref, computed, watch } from 'vue'
import { fetchSafetyScore } from '@/services/dividendSafetyApi'
import { useSettings } from '@/composables/useSettings'

const props = defineProps({
  ticker: { type: String, required: true },
  compact: { type: Boolean, default: false },
})

const { geminiApiKey } = useSettings()

const safety = ref(null)
const loading = ref(false)
const error = ref(null)
const expanded = ref(false)

// Score circle SVG: radius=28, circumference=2*PI*28≈175.93
const CIRC = 175.93
const scoreOffset = computed(() => {
  if (!safety.value?.score) return CIRC
  return CIRC - (CIRC * safety.value.score / 10)
})

const scoreColor = computed(() => {
  if (!safety.value) return '#555'
  const s = safety.value.score
  if (s >= 7) return '#22c55e' // green
  if (s >= 4) return '#eab308' // yellow
  return '#ef4444'             // red
})

const signalIcon = (signal) => {
  if (signal === 'positive') return '+'
  if (signal === 'negative') return '!'
  return '~'
}

const signalColor = (signal) => {
  if (signal === 'positive') return '#22c55e'
  if (signal === 'negative') return '#ef4444'
  return '#eab308'
}

async function loadSafety() {
  if (!props.ticker || loading.value) return
  loading.value = true
  error.value = null
  try {
    safety.value = await fetchSafetyScore(props.ticker, geminiApiKey.value)
  } catch (err) {
    error.value = err.message
    console.warn(`[SafetyCard] Error for ${props.ticker}:`, err.message)
  } finally {
    loading.value = false
  }
}

async function refresh() {
  loading.value = true
  error.value = null
  try {
    safety.value = await fetchSafetyScore(props.ticker, geminiApiKey.value, true)
  } catch (err) {
    error.value = err.message
  } finally {
    loading.value = false
  }
}

watch(() => props.ticker, () => {
  safety.value = null
  expanded.value = false
  loadSafety()
}, { immediate: true })
</script>

<template>
  <!-- ═══ Compact mode: score circle + one-liner ═══ -->
  <div v-if="compact" class="dsc-compact" @click="expanded = !expanded">
    <!-- Loading skeleton -->
    <template v-if="loading">
      <div class="dsc-skeleton-circle" />
      <div class="dsc-skeleton-text" />
    </template>

    <!-- Error state -->
    <template v-else-if="error">
      <div class="dsc-mini-badge" style="background: rgba(239,68,68,0.15); color: #ef4444;">?</div>
      <span class="dsc-mini-label" style="color: #ef4444;">Error</span>
    </template>

    <!-- Score loaded -->
    <template v-else-if="safety">
      <div class="dsc-mini-badge" :style="{ background: `${scoreColor}20`, color: scoreColor }">
        {{ safety.score.toFixed(1) }}
      </div>
      <span class="dsc-mini-label">{{ safety.summary }}</span>
    </template>
  </div>

  <!-- ═══ Full card mode ═══ -->
  <div v-else class="glass-card dsc-card" :class="{ expanded }">
    <!-- Header -->
    <div class="dsc-header" @click="expanded = !expanded">
      <div class="dsc-score-ring">
        <!-- Loading spinner -->
        <template v-if="loading">
          <svg class="dsc-ring" width="64" height="64" viewBox="0 0 64 64">
            <circle cx="32" cy="32" r="28" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="3" />
            <circle cx="32" cy="32" r="28" fill="none" stroke="#415BFF" stroke-width="3"
              stroke-dasharray="40 135" stroke-linecap="round"
              class="dsc-spinner" />
          </svg>
          <span class="dsc-ring-label">...</span>
        </template>

        <!-- Score ring -->
        <template v-else-if="safety">
          <svg class="dsc-ring" width="64" height="64" viewBox="0 0 64 64">
            <circle cx="32" cy="32" r="28" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="3" />
            <circle cx="32" cy="32" r="28" fill="none"
              :stroke="scoreColor" stroke-width="3"
              stroke-linecap="round"
              :stroke-dasharray="CIRC"
              :stroke-dashoffset="scoreOffset"
              transform="rotate(-90 32 32)"
              style="transition: stroke-dashoffset 0.6s ease" />
          </svg>
          <span class="dsc-ring-label" :style="{ color: scoreColor }">
            {{ safety.score.toFixed(1) }}
          </span>
        </template>

        <!-- Error -->
        <template v-else>
          <svg class="dsc-ring" width="64" height="64" viewBox="0 0 64 64">
            <circle cx="32" cy="32" r="28" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="3" />
          </svg>
          <span class="dsc-ring-label" style="color: #ef4444;">?</span>
        </template>
      </div>

      <div class="dsc-header-info">
        <div class="dsc-title">
          Seguridad del Dividendo
          <span v-if="safety?.isReit" class="dsc-reit-badge">REIT</span>
        </div>
        <div v-if="loading" class="dsc-subtitle" style="opacity: 0.4;">Calculando...</div>
        <div v-else-if="safety" class="dsc-subtitle">{{ safety.summary }}</div>
        <div v-else-if="error" class="dsc-subtitle" style="color: #ef4444;">{{ error }}</div>
      </div>

      <!-- Refresh icon (always visible, outside expand) -->
      <button
        v-if="safety && !loading"
        class="dsc-header-refresh"
        title="Recalcular seguridad"
        @click.stop="refresh"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M1 4v6h6M23 20v-6h-6" />
          <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" />
        </svg>
      </button>

      <div class="dsc-expand-arrow" :class="{ open: expanded }">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M4 6L8 10L12 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        </svg>
      </div>
    </div>

    <!-- Expanded content -->
    <Transition name="dsc-expand">
      <div v-if="expanded && safety" class="dsc-body">
        <!-- Factors grid -->
        <div class="dsc-factors">
          <div v-for="f in safety.factors" :key="f.name" class="dsc-factor">
            <div class="dsc-factor-header">
              <span class="dsc-factor-signal" :style="{ color: signalColor(f.signal) }">
                {{ signalIcon(f.signal) }}
              </span>
              <span class="dsc-factor-name">{{ f.name }}</span>
              <span class="dsc-factor-weight">{{ f.weight }}</span>
            </div>
            <div class="dsc-factor-bar">
              <div class="dsc-factor-fill" :style="{ width: (f.score / 10 * 100) + '%', background: signalColor(f.signal) }" />
            </div>
            <div class="dsc-factor-label">{{ f.label }}</div>
          </div>
        </div>

        <!-- Gemini Analysis -->
        <div v-if="safety.analysis" class="dsc-analysis">
          <div class="dsc-analysis-header">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
            Análisis Gemini
          </div>
          <div class="dsc-analysis-text">{{ safety.analysis }}</div>
          <div v-if="safety.sources?.length" class="dsc-sources">
            <a v-for="s in safety.sources" :key="s.url" :href="s.url" target="_blank" rel="noopener" class="dsc-source">
              {{ s.title || s.url }}
            </a>
          </div>
        </div>

        <!-- Refresh button -->
        <button class="dsc-refresh" @click.stop="refresh" :disabled="loading">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M1 4v6h6M23 20v-6h-6" />
            <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" />
          </svg>
          Actualizar
        </button>

        <!-- Cache info -->
        <div v-if="safety.cachedAt" class="dsc-cache-info">
          Actualizado {{ new Date(safety.cachedAt).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) }}
          <span v-if="safety.fromCache"> (cache)</span>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
/* ─── Card Container (inherits glass-card from global) ─── */
.dsc-card {
  overflow: hidden;
}

/* ─── Header ─── */
.dsc-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  cursor: pointer;
  user-select: none;
}

.dsc-header:hover {
  background: rgba(255, 255, 255, 0.02);
}

/* ─── Score Ring ─── */
.dsc-score-ring {
  position: relative;
  width: 64px;
  height: 64px;
  flex-shrink: 0;
}

.dsc-ring {
  position: absolute;
  top: 0;
  left: 0;
}

.dsc-ring-label {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-size: 16px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.dsc-spinner {
  animation: dsc-spin 1.2s linear infinite;
  transform-origin: center;
}

@keyframes dsc-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* ─── Header Info ─── */
.dsc-header-info {
  flex: 1;
  min-width: 0;
}

.dsc-title {
  font-size: 14px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
  display: flex;
  align-items: center;
  gap: 6px;
}

.dsc-reit-badge {
  font-size: 10px;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(139, 92, 246, 0.2);
  color: #a78bfa;
  letter-spacing: 0.5px;
}

.dsc-subtitle {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ─── Header Refresh ─── */
.dsc-header-refresh {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.2);
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.2s;
}

.dsc-header-refresh:hover {
  color: rgba(255, 255, 255, 0.6);
  background: rgba(255, 255, 255, 0.06);
}

/* ─── Expand Arrow ─── */
.dsc-expand-arrow {
  color: rgba(255, 255, 255, 0.3);
  transition: transform 0.3s ease;
  flex-shrink: 0;
}

.dsc-expand-arrow.open {
  transform: rotate(180deg);
}

/* ─── Body (Expanded) ─── */
.dsc-body {
  padding: 0 16px 16px;
}

/* ─── Factors Grid ─── */
.dsc-factors {
  display: grid;
  gap: 10px;
}

.dsc-factor {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.dsc-factor-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}

.dsc-factor-signal {
  font-weight: 700;
  font-size: 11px;
  width: 14px;
  text-align: center;
}

.dsc-factor-name {
  color: rgba(255, 255, 255, 0.7);
  flex: 1;
}

.dsc-factor-weight {
  color: rgba(255, 255, 255, 0.25);
  font-size: 10px;
}

.dsc-factor-bar {
  height: 3px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 2px;
  overflow: hidden;
}

.dsc-factor-fill {
  height: 100%;
  border-radius: 2px;
  transition: width 0.6s ease;
  opacity: 0.7;
}

.dsc-factor-label {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
}

/* ─── Gemini Analysis ─── */
.dsc-analysis {
  margin-top: 14px;
  padding: 12px;
  background: rgba(65, 91, 255, 0.05);
  border: 1px solid rgba(65, 91, 255, 0.1);
  border-radius: 10px;
}

.dsc-analysis-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 600;
  color: rgba(65, 91, 255, 0.7);
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.dsc-analysis-text {
  font-size: 13px;
  line-height: 1.6;
  color: rgba(255, 255, 255, 0.7);
  white-space: pre-line;
}

.dsc-sources {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}

.dsc-source {
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

.dsc-source:hover {
  color: #415BFF;
  background: rgba(65, 91, 255, 0.1);
}

/* ─── Refresh Button ─── */
.dsc-refresh {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 12px;
  padding: 6px 12px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.4);
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.dsc-refresh:hover:not(:disabled) {
  color: rgba(255, 255, 255, 0.7);
  background: rgba(255, 255, 255, 0.08);
}

.dsc-refresh:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

/* ─── Cache Info ─── */
.dsc-cache-info {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.2);
  margin-top: 8px;
}

/* ─── Expand Transition ─── */
.dsc-expand-enter-active,
.dsc-expand-leave-active {
  transition: all 0.3s ease;
  overflow: hidden;
}

.dsc-expand-enter-from,
.dsc-expand-leave-to {
  opacity: 0;
  max-height: 0;
  padding-top: 0;
  padding-bottom: 0;
}

.dsc-expand-enter-to,
.dsc-expand-leave-from {
  max-height: 800px;
}

/* ─── Compact Mode ─── */
.dsc-compact {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  padding: 4px 0;
}

.dsc-mini-badge {
  font-size: 11px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 6px;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.dsc-mini-label {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.45);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ─── Skeleton Loading ─── */
.dsc-skeleton-circle {
  width: 28px;
  height: 18px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.06);
  animation: dsc-pulse 1.5s ease infinite;
}

.dsc-skeleton-text {
  flex: 1;
  height: 12px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.04);
  animation: dsc-pulse 1.5s ease infinite;
  animation-delay: 0.3s;
}

@keyframes dsc-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
</style>
