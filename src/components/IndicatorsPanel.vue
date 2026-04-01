<script setup>
import { computed } from 'vue'
import { computeBuyScore } from '@/lib/scoring'

const props = defineProps({
  indicators: { type: Object, default: null },
  projection: { type: Object, default: null },
  dividends: { type: Array, default: () => [] },
  currency: { type: String, default: '$' },
})

function fmt(value, decimals = 2) {
  if (value == null || isNaN(value)) return '-'
  return Number(value).toFixed(decimals)
}

// Unified scoring — same system used in Ranking view
const scoring = computed(() => {
  if (!props.indicators) return null
  return computeBuyScore(props.indicators, props.projection, props.dividends)
})

// Yield zone label (purely descriptive, no action implied)
function yieldZone(indicators) {
  if (!indicators) return { label: '-', color: 'text-muted-foreground' }
  const { currentYield, avgHighYield, avgLowYield, avgYield } = indicators
  if (currentYield >= avgHighYield) return { label: 'Infravalorado', color: 'text-success' }
  if (currentYield <= avgLowYield) return { label: 'Sobrevalorado', color: 'text-destructive' }
  if (currentYield > avgYield) return { label: 'Valor Medio-Bajo', color: 'text-success/70' }
  return { label: 'Valor Medio-Alto', color: 'text-warning' }
}

// Build recommendation from unified scoring
const recommendation = computed(() => {
  const s = scoring.value
  if (!s || !props.indicators) return null

  const { currentYield, avgHighYield, avgLowYield, avgYield, currentPrice, undervaluedPrice, overvaluedPrice } = props.indicators

  const signalMap = {
    'Compra fuerte': {
      icon: '↑↑',
      color: '#34d399',
      bg: 'rgba(52, 211, 153, 0.08)',
      border: 'rgba(52, 211, 153, 0.2)',
    },
    'Compra': {
      icon: '↑',
      color: '#6ee7b7',
      bg: 'rgba(110, 231, 183, 0.08)',
      border: 'rgba(110, 231, 183, 0.2)',
    },
    'Vigilar': {
      icon: '⊙',
      color: '#fbbf24',
      bg: 'rgba(251, 191, 36, 0.08)',
      border: 'rgba(251, 191, 36, 0.2)',
    },
    'Mantener': {
      icon: '→',
      color: '#fb923c',
      bg: 'rgba(251, 146, 60, 0.08)',
      border: 'rgba(251, 146, 60, 0.2)',
    },
    'Caro': {
      icon: '↓',
      color: '#f87171',
      bg: 'rgba(248, 113, 113, 0.08)',
      border: 'rgba(248, 113, 113, 0.2)',
    },
    'Vender': {
      icon: '↓↓',
      color: '#ef4444',
      bg: 'rgba(239, 68, 68, 0.08)',
      border: 'rgba(239, 68, 68, 0.2)',
    },
  }

  const style = signalMap[s.signal] || signalMap['Mantener']

  // Generate contextual text
  let text = ''
  let detail = null

  if (s.heat >= 4) {
    // Compra / Compra fuerte
    text = `El yield actual (${fmt(currentYield)}%) está en zona de infravaloración.`
    if (currentYield >= avgHighYield) {
      text += ` Supera el yield alto histórico (${fmt(avgHighYield)}%).`
    } else {
      text += ` Se acerca al yield alto histórico (${fmt(avgHighYield)}%) y el perfil del activo es sólido (CAGR, consistencia).`
    }
    const upside = undervaluedPrice > 0 && currentPrice > 0
      ? ((undervaluedPrice - currentPrice) / currentPrice * 100).toFixed(1)
      : null
    if (upside && parseFloat(upside) > 0) detail = `Potencial alcista: +${upside}%`
  } else if (s.heat === 3) {
    // Vigilar
    text = `El yield actual (${fmt(currentYield)}%) está acercándose a la zona de compra. La media histórica es ${fmt(avgYield)}%. Buen punto de vigilancia.`
  } else if (s.heat === 2) {
    // Mantener
    text = `El yield actual (${fmt(currentYield)}%) está en zona neutral. No es el mejor momento para comprar, pero tampoco para vender.`
  } else {
    // Caro / Vender
    text = `El yield actual (${fmt(currentYield)}%) está en zona de sobrevaloración.`
    if (currentYield <= avgLowYield) {
      text += ` Por debajo del yield bajo histórico (${fmt(avgLowYield)}%).`
    }
    const downside = overvaluedPrice > 0 && currentPrice > 0
      ? ((currentPrice - overvaluedPrice) / currentPrice * 100).toFixed(1)
      : null
    if (downside && parseFloat(downside) > 0) detail = `Sobrevaluación estimada: ${downside}%`
  }

  return {
    action: s.signal,
    score: s.score,
    icon: style.icon,
    color: style.color,
    bg: style.bg,
    border: style.border,
    text,
    detail,
  }
})
</script>

<template>
  <div v-if="indicators" class="h-full flex flex-col">
    <!-- Title -->
    <div
      class="font-semibold tracking-[0.05em] uppercase mb-4"
      style="color: #e4e4e7; font-size: 13px; font-family: Inter, system-ui, sans-serif;"
    >
      Indicadores
    </div>

    <!-- Indicators grid -->
    <div class="grid grid-cols-2 gap-x-6 gap-y-3">
      <div>
        <div class="text-[10px] uppercase tracking-wider mb-0.5" style="color: #71717a;">Yield Actual</div>
        <div class="text-lg font-bold text-primary leading-tight">{{ fmt(indicators.currentYield) }}%</div>
        <div class="text-[10px] mt-0.5" :class="yieldZone(indicators).color">
          {{ yieldZone(indicators).label }}
        </div>
      </div>

      <div>
        <div class="text-[10px] uppercase tracking-wider mb-0.5" style="color: #71717a;">Yield Medio</div>
        <div class="text-lg font-bold text-foreground leading-tight">{{ fmt(indicators.avgYield) }}%</div>
        <div class="text-[10px] mt-0.5" style="color: #71717a;">Histórico</div>
      </div>

      <div>
        <div class="text-[10px] uppercase tracking-wider mb-0.5" style="color: #71717a;">Cotización</div>
        <div class="text-lg font-bold text-foreground leading-tight">{{ currency }}{{ fmt(indicators.currentPrice) }}</div>
      </div>

      <div>
        <div class="text-[10px] uppercase tracking-wider mb-0.5" style="color: #71717a;">Infravalorado</div>
        <div class="text-lg font-bold text-success leading-tight">{{ currency }}{{ fmt(indicators.undervaluedPrice) }}</div>
      </div>

      <div class="col-span-2">
        <div class="text-[10px] uppercase tracking-wider mb-0.5" style="color: #71717a;">Sobrevalorado</div>
        <div class="text-lg font-bold text-destructive leading-tight">{{ currency }}{{ fmt(indicators.overvaluedPrice) }}</div>
      </div>
    </div>

    <!-- Spacer -->
    <div class="flex-1 min-h-3"></div>

    <!-- Recommendation inner card (unified scoring) -->
    <div
      v-if="recommendation"
      class="rounded-xl p-3 mt-2"
      :style="{
        background: recommendation.bg,
        border: '1px solid ' + recommendation.border,
      }"
    >
      <div class="flex items-center justify-between mb-1.5">
        <div class="flex items-center gap-2">
          <span
            class="w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-bold"
            :style="{ background: recommendation.color + '20', color: recommendation.color }"
          >
            {{ recommendation.icon }}
          </span>
          <span
            class="text-xs font-semibold uppercase tracking-wider"
            :style="{ color: recommendation.color }"
          >
            {{ recommendation.action }}
          </span>
        </div>
        <span class="text-xs font-bold text-foreground">{{ recommendation.score }}</span>
      </div>
      <!-- Score bar -->
      <div class="h-1 rounded-full bg-white/5 overflow-hidden mb-2">
        <div
          class="h-full rounded-full"
          :style="{
            width: Math.min(100, recommendation.score) + '%',
            background: `linear-gradient(90deg, ${recommendation.color}40, ${recommendation.color})`,
          }"
        ></div>
      </div>
      <p class="text-[10px] leading-relaxed" style="color: #a1a1aa;">
        {{ recommendation.text }}
      </p>
      <p
        v-if="recommendation.detail"
        class="text-[10px] font-semibold mt-1"
        :style="{ color: recommendation.color }"
      >
        {{ recommendation.detail }}
      </p>
    </div>
  </div>
</template>
