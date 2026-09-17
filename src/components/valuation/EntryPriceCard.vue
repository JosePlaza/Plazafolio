<script setup>
import { computed, ref } from 'vue'
import { useCurrency } from '@/composables/useCurrency'
import PriceRangeBar from './PriceRangeBar.vue'

const props = defineProps({
  entrada: { type: Object, default: null },
  gordon: { type: Object, default: null },
  multiplos: { type: Object, default: null },
  bar: { type: Object, default: null },
  ticker: { type: String, default: '' },
  avisos: { type: Array, default: () => [] },
})

// Precios siempre en la divisa seleccionada por el usuario (EUR por defecto).
const { convertByTicker, symbolFor } = useCurrency()
const sym = computed(() => symbolFor(props.ticker))
const money = (v) =>
  v == null || isNaN(v) ? '—' : sym.value + Number(convertByTicker(v, props.ticker)).toFixed(2)
const num = (v, dec = 1) => (v == null || isNaN(v) ? '—' : Number(v).toFixed(dec))
const pct = (v) => (v == null || isNaN(v) ? '—' : `${Number(v).toFixed(1)}%`)
const signed = (v) => (v == null || isNaN(v) ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`)

const SEMAFORO = {
  EN_ZONA: { label: 'En zona de entrada', color: '#34d399' },
  CERCA: { label: 'Cerca', color: '#fbbf24' },
  LEJOS: { label: 'Lejos', color: '#f87171' },
}

const METODO = {
  WEISS: 'banda de Weiss',
  WEISS_P90: 'Weiss p90 (régimen actual)',
  MULTIPLOS_P25: 'múltiplos p25',
  MULTIPLOS_MEDIA: 'múltiplos media',
  YIELD_MIN: 'yield mínimo',
}

const LECTURA = { DESCUENTO: 'con descuento', EN_LINEA: 'en línea', PRIMA: 'con prima' }

const sem = computed(() => SEMAFORO[props.entrada?.semaforo] || SEMAFORO.LEJOS)
const coherencia = computed(() => props.entrada?.gordonCoherencia || null)
const regimen = computed(() => props.entrada?.regimenYield || null)

const fantasia = computed(() => coherencia.value?.veredicto === 'EXIGE_FANTASIA')
const trampa = computed(() => props.avisos?.includes('POSIBLE_TRAMPA_DE_VALOR'))
const recorte = computed(() => props.avisos?.includes('DIVIDENDO_RECORTADO_EN_HISTORIA'))
const degenerada = computed(() => props.avisos?.includes('HISTORIA_DEGENERADA'))

const detalleMultiplos = ref(false)

const resumenMultiplos = computed(() => {
  const filas = props.multiplos?.multiplos || []
  if (!filas.length) return null
  return filas.map((m) => `${m.nombre} ${num(m.actual)} vs ${num(m.mediaHist)}`).join(' · ')
})

const mesAnio = (iso) => {
  if (!iso) return 'nunca en 10 años'
  const [y, m] = String(iso).split('-')
  return `${m}/${y}`
}
</script>

<template>
  <div v-if="entrada" class="glass-card p-4" :style="{ borderColor: sem.color + '35' }">
    <!-- 1. Cabecera -->
    <div class="flex items-baseline justify-between mb-3">
      <h3 class="text-sm font-semibold text-foreground">Precio óptimo de entrada</h3>
      <span
        class="text-[10px] font-semibold px-1.5 py-0.5 rounded"
        :style="{ color: sem.color, background: sem.color + '18' }"
      >{{ sem.label }}</span>
    </div>

    <!-- 2. Cifras principales -->
    <div class="flex items-start justify-between gap-4 mb-1">
      <div>
        <div class="flex items-end gap-2">
          <span class="text-3xl font-bold tabular-nums" :style="{ color: sem.color }">
            {{ money(entrada.conservador?.precioEntrada) }}
          </span>
          <span class="text-xs text-muted-foreground pb-1.5">exigente</span>
        </div>
        <div class="text-[10px] text-muted-foreground/70 mt-0.5">
          Limita: {{ METODO[entrada.conservador?.metodoLimitante] || '—' }}
        </div>
      </div>
      <div class="text-right shrink-0">
        <div class="text-lg font-semibold tabular-nums text-foreground">
          {{ money(entrada.optimista?.precioEntrada) }}
        </div>
        <div class="text-[10px] text-muted-foreground">flexible</div>
        <div class="text-[10px] text-muted-foreground/70">
          Limita: {{ METODO[entrada.optimista?.metodoLimitante] || '—' }}
        </div>
      </div>
    </div>
    <p class="text-[11px] text-muted-foreground mb-2">
      Cotiza hoy a {{ money(entrada.precioActual) }}
      <span v-if="entrada.conservador?.distanciaPct != null">
        · {{ signed(entrada.conservador.distanciaPct) }} sobre la entrada
      </span>
    </p>

    <!-- 3. Barra de rango (§6.5) -->
    <PriceRangeBar v-if="bar" :bar="bar" :ticker="ticker" />

    <!-- 4. Fila múltiplos -->
    <div v-if="resumenMultiplos" class="mt-3 pt-2 border-t border-white/[0.06]">
      <button
        class="w-full flex items-start gap-2 text-left text-[11px]"
        @click="detalleMultiplos = !detalleMultiplos"
      >
        <span class="text-muted-foreground shrink-0">Múltiplos:</span>
        <span class="text-foreground flex-1">
          {{ resumenMultiplos }}
          <span class="text-muted-foreground">
            → {{ money(multiplos.precioImplicitoP25) }}–{{ money(multiplos.precioImplicitoMedia) }}
            <template v-if="multiplos.lectura">({{ LECTURA[multiplos.lectura] }})</template>
          </span>
        </span>
        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linecap="round"
          class="shrink-0 mt-0.5 text-muted-foreground/50 transition-transform"
          :class="detalleMultiplos ? 'rotate-180' : ''"
        ><path d="m6 9 6 6 6-6" /></svg>
      </button>

      <div v-if="detalleMultiplos" class="mt-2 space-y-1.5">
        <div
          v-for="m in multiplos.multiplos"
          :key="m.nombre"
          class="flex items-center gap-2 text-[11px]"
        >
          <span class="w-[68px] shrink-0 font-medium text-foreground">{{ m.nombre }}</span>
          <span class="tabular-nums text-muted-foreground">{{ num(m.actual) }}</span>
          <span class="text-muted-foreground/40">vs</span>
          <span class="tabular-nums text-muted-foreground">{{ num(m.mediaHist) }}</span>
          <span
            class="ml-auto tabular-nums font-semibold"
            :style="{ color: m.primaPct < 0 ? '#34d399' : '#f87171' }"
          >{{ signed(m.primaPct) }}</span>
          <span class="w-[72px] text-right tabular-nums text-foreground">{{ money(m.precioImplicito) }}</span>
        </div>
        <p class="text-[10px] text-muted-foreground/60 leading-snug">
          Cada múltiplo contra su propia media histórica ({{ multiplos.aniosUsados }} años),
          nunca en absoluto ni contra el sector.
        </p>
      </div>
    </div>
    <p v-else class="mt-3 pt-2 border-t border-white/[0.06] text-[11px] text-muted-foreground">
      Múltiplos: sin historia suficiente de fundamentales. La entrada se basa solo
      en la banda de Weiss.
    </p>

    <!-- 5. Fila Gordon -->
    <div
      v-if="gordon"
      class="mt-2 pt-2 border-t border-white/[0.06] text-[11px] leading-snug"
      :class="fantasia ? 'rounded-lg p-2 -mx-0.5' : ''"
      :style="fantasia ? { background: 'rgba(248,113,113,0.08)' } : {}"
    >
      <span class="text-muted-foreground">Gordon (coherencia):</span>
      <span class="text-foreground">
        horquilla {{ money(gordon.exigente?.precioJusto) }}–{{ money(gordon.flexible?.precioJusto) }}
      </span>
      <span class="text-muted-foreground">
        · el mercado descuenta g {{ pct(gordon.gImplicitoPct) }}
        <template v-if="gordon.gEntradaPct != null">
          · a la entrada propuesta g {{ pct(gordon.gEntradaPct) }}
        </template>
      </span>
      <span
        v-if="coherencia"
        class="font-semibold"
        :style="{ color: fantasia ? '#f87171' : coherencia.veredicto === 'AJUSTADO' ? '#fbbf24' : '#34d399' }"
      > → {{ coherencia.veredicto.replace('_', ' ').toLowerCase() }}</span>
      <div class="text-[10px] text-muted-foreground/60 mt-0.5">
        r {{ pct(gordon.exigente?.r * 100) }} / {{ pct(gordon.flexible?.r * 100) }} ·
        no fija el precio de entrada, solo juzga si es sostenible
      </div>
    </div>

    <!-- 6. Avisos -->
    <div class="mt-2 space-y-1">
      <p v-if="regimen?.obsoleto" class="text-[10px] leading-snug" style="color: #fbbf24;">
        Banda de Weiss anclada a un régimen antiguo (último toque de la banda alta:
        {{ mesAnio(regimen.ultimoToqueBandaAlta) }}); entrada calculada con el
        percentil 90 del yield de la década.
      </p>
      <p v-if="degenerada" class="text-[10px] leading-snug" style="color: #fbbf24;">
        Historia de yield degenerada: se mantiene la banda clásica sin fallback.
      </p>
      <p v-if="trampa" class="text-[10px] leading-snug" style="color: #fbbf24;">
        Yield en máximos o payout por encima del 90%: el descuento puede ser
        deterioro del negocio, no oportunidad. Exige revisión cualitativa.
      </p>
      <p v-if="recorte" class="text-[10px] leading-snug" style="color: #fbbf24;">
        Hay un recorte del dividendo en la historia usada para el crecimiento.
      </p>
    </div>

    <p class="mt-2 pt-2 border-t border-white/[0.06] text-[10px] text-muted-foreground/60 leading-snug">
      El precio óptimo es una condición necesaria, no una recomendación de compra:
      presupone que la empresa pasa el análisis cualitativo. Material educativo,
      no asesoramiento financiero.
    </p>
  </div>
</template>
