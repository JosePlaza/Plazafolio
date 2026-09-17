<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import {
  toWeissSnapshot,
  toYieldSeries,
  buildAnnualSeries,
  buildHistoricalMultiples,
  valuate,
  DEFAULT_CONFIG,
} from '@/lib/valuation'
import { fetchValuationSnapshot } from '@/services/valuationApi'
import { useValuationConfig } from '@/composables/useValuationConfig'
import EntryPriceCard from './EntryPriceCard.vue'

const props = defineProps({
  ticker: { type: String, default: '' },
  // `data` es la salida de computeAll() (geraldine.js) que ya vive en app.data
  data: { type: Object, default: null },
  fundamentals: { type: Object, default: null },
  years: { type: Number, default: 10 },
})

const snapshot = ref(null)
const loading = ref(false)
const { config } = useValuationConfig()

/**
 * El snapshot de mercado (§1.1) es lo único que hay que descargar: las bandas
 * de Weiss, el histórico y los fundamentales anuales ya están en las props.
 */
async function load() {
  if (!props.ticker) return
  loading.value = true
  try {
    snapshot.value = await fetchValuationSnapshot(props.ticker)
  } finally {
    loading.value = false
  }
}

watch(() => props.ticker, load)
onMounted(load)

const resultado = computed(() => {
  const d = props.data
  if (!d?.indicators) return null

  const weiss = toWeissSnapshot(d.indicators, d.trailingDividends || [], props.years)
  if (!weiss) return null

  // `priceBands` solo conserva el cierre: computeAll descarta high/low al
  // construir los yields diarios. Usamos el fallback que la propia spec admite
  // (§1.3): máx/mín del cierre del año. Evita tocar el módulo Weiss, intocable
  // por §3.
  const prices = (d.priceBands || []).map((p) => ({ date: p.date, close: p.close }))
  const dividends = d.dividends || []

  const series = buildAnnualSeries(prices, dividends, { historyYears: DEFAULT_CONFIG.HISTORY_YEARS })
  const histMultiples = buildHistoricalMultiples(
    props.fundamentals || {},
    series.priceMax,
    series.priceMin,
  )

  const out = valuate({
    weiss,
    prices,
    dividends,
    // §3.1 — serie diaria de yields para el detector de régimen obsoleto.
    dailyYields: toYieldSeries(d.dailyYields || []),
    snapshot: snapshot.value || {},
    histMultiples,
    config: config.value,
  })
  return out ? { ...out, weiss } : out
})
</script>

<template>
  <div v-if="resultado">
    <!-- §7.1 — la metodología solo aplica a pagadores consolidados -->
    <div v-if="resultado.estado === 'NO_VALORABLE'" class="glass-card p-4">
      <h3 class="text-sm font-semibold text-foreground mb-1">Precio óptimo de entrada</h3>
      <p class="text-[11px] text-muted-foreground">{{ resultado.motivo }}</p>
    </div>

    <!-- v1.4 — card única: Gordon y múltiplos son filas dentro de ella -->
    <EntryPriceCard
      v-else
      :entrada="resultado.entrada"
      :gordon="resultado.gordon"
      :multiplos="resultado.multiplos"
      :bar="resultado.rangeBar"
      :ticker="ticker"
      :avisos="resultado.avisos"
    />
  </div>
</template>
