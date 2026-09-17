<script setup>
import { ref, computed, watch } from 'vue'
import { useValuationConfig } from '@/composables/useValuationConfig'
import { computeGordon, DEFAULT_CONFIG } from '@/lib/valuation'

/**
 * §2.1 — edición de las rentabilidades exigidas de Gordon.
 *
 * Preview en vivo con el ticker activo si lo hay; si no, con el ejemplo de la
 * spec (D0 = 2,00 y CAGR 5%), para que se vea la sensibilidad antes de guardar.
 */
const props = defineProps({
  ticker: { type: String, default: '' },
  d0: { type: Number, default: null },
  cagr: { type: Number, default: null },
  currency: { type: String, default: '€' },
})

const { rExigente, rFlexible, validar, set, restaurar } = useValuationConfig()

// Se edita en % con 1 decimal; el módulo trabaja en fracción.
const exigentePct = ref(rExigente.value * 100)
const flexiblePct = ref(rFlexible.value * 100)
const error = ref(null)

watch([rExigente, rFlexible], ([e, f]) => {
  exigentePct.value = e * 100
  flexiblePct.value = f * 100
})

const usaEjemplo = computed(() => !(props.d0 > 0))
const d0Preview = computed(() => (usaEjemplo.value ? 2.0 : props.d0))
const cagrPreview = computed(() => (props.cagr != null ? props.cagr : 0.05))

// Preview con los valores EN EDICIÓN, no con los guardados.
const preview = computed(() =>
  computeGordon(d0Preview.value, cagrPreview.value, {
    ...DEFAULT_CONFIG,
    r_exigente: exigentePct.value / 100,
    r_flexible: flexiblePct.value / 100,
  }),
)

const money = (v) => (v == null || isNaN(v) ? '—' : props.currency + Number(v).toFixed(2))
const pct = (v) => (v == null || isNaN(v) ? '—' : `${Number(v).toFixed(1)}%`)

const recorteFlexible = computed(() => preview.value?.flexible?.gRecortado)

function aplicar() {
  const res = set(exigentePct.value / 100, flexiblePct.value / 100)
  error.value = res.ok ? null : res.error
}

watch([exigentePct, flexiblePct], () => {
  error.value = validar(exigentePct.value / 100, flexiblePct.value / 100)
})

function onRestaurar() {
  restaurar()
  error.value = null
}
</script>

<template>
  <div class="glass-card p-4">
    <div class="flex items-baseline justify-between mb-1">
      <h3 class="text-sm font-semibold text-foreground">Modelo de Gordon</h3>
      <button class="text-[10px] text-muted-foreground hover:text-foreground" @click="onRestaurar">
        Restaurar por defecto
      </button>
    </div>
    <p class="text-[11px] text-muted-foreground mb-4">
      Rentabilidad que exiges a una acción de dividendo. Afecta a la horquilla de
      Gordon y al check de coherencia, <strong>no al precio de entrada</strong>.
    </p>

    <div class="space-y-3">
      <div>
        <div class="flex justify-between text-[11px] mb-1">
          <span class="text-foreground">Exigente</span>
          <span class="tabular-nums font-semibold text-foreground">{{ pct(exigentePct) }}</span>
        </div>
        <input
          v-model.number="exigentePct"
          type="range" min="5" max="15" step="0.5"
          class="w-full accent-primary"
        />
      </div>

      <div>
        <div class="flex justify-between text-[11px] mb-1">
          <span class="text-foreground">Flexible</span>
          <span class="tabular-nums font-semibold text-foreground">{{ pct(flexiblePct) }}</span>
        </div>
        <input
          v-model.number="flexiblePct"
          type="range" min="3" max="12" step="0.5"
          class="w-full accent-primary"
        />
      </div>
    </div>

    <p v-if="error" class="mt-2 text-[10px]" style="color: #f87171;">{{ error }}</p>

    <!-- Preview en vivo -->
    <div class="mt-4 pt-3 border-t border-white/[0.06]">
      <div class="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">
        Horquilla resultante
        <span v-if="usaEjemplo" class="normal-case tracking-normal">(ejemplo: D0 {{ money(2) }}, CAGR 5%)</span>
        <span v-else class="normal-case tracking-normal">({{ ticker }})</span>
      </div>
      <div class="grid grid-cols-2 gap-2 text-[11px]">
        <div class="rounded-lg p-2.5" style="background: rgba(255,255,255,0.02);">
          <div class="text-muted-foreground mb-0.5">Exigente r {{ pct(exigentePct) }}</div>
          <div class="font-semibold tabular-nums text-foreground">{{ money(preview.exigente?.precioJusto) }}</div>
          <div class="text-[10px] text-muted-foreground">g {{ pct(preview.exigente?.g * 100) }}</div>
        </div>
        <div class="rounded-lg p-2.5" style="background: rgba(255,255,255,0.02);">
          <div class="text-muted-foreground mb-0.5">Flexible r {{ pct(flexiblePct) }}</div>
          <div class="font-semibold tabular-nums text-foreground">{{ money(preview.flexible?.precioJusto) }}</div>
          <div class="text-[10px] text-muted-foreground">g {{ pct(preview.flexible?.g * 100) }}</div>
        </div>
      </div>

      <p v-if="recorteFlexible" class="mt-2 text-[10px] leading-snug" style="color: #fbbf24;">
        Con r {{ pct(flexiblePct) }}, el crecimiento usado se limita al
        {{ pct(preview.flexible.g * 100) }}: la fórmula exige un margen mínimo de
        2 puntos entre r y g.
      </p>
    </div>

    <button
      class="mt-3 w-full h-9 rounded-xl text-sm font-medium transition-colors"
      :disabled="!!error"
      :style="error
        ? { background: 'rgba(255,255,255,0.04)', color: '#71717a', cursor: 'not-allowed' }
        : { background: 'rgba(65,91,255,0.18)', color: '#8fa2ff' }"
      @click="aplicar"
    >
      Guardar
    </button>
  </div>
</template>
