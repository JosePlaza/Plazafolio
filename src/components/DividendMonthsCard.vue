<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useCurrency } from '@/composables/useCurrency'
import { fetchDividendPaymentDates } from '@/services/dividendCalendarApi'

const props = defineProps({
  ticker: { type: String, default: '' },
  dividends: { type: Array, default: () => [] },
  shares: { type: Number, default: 0 },
})

const { convertByTicker, symbolFor } = useCurrency()
const sym = computed(() => symbolFor(props.ticker))
const money = (v, dec = 2) =>
  v == null || isNaN(v) ? '—' : sym.value + Number(convertByTicker(v, props.ticker)).toFixed(dec)

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

const proximoPago = ref(null)

async function load() {
  if (!props.ticker) return
  const info = await fetchDividendPaymentDates([props.ticker])
  const row = info[props.ticker.toUpperCase()]
  proximoPago.value = row?.isUpcoming ? row.paymentDate : null
}
watch(() => props.ticker, load)
onMounted(load)

const amountOf = (d) => Number(d.amount ?? d.dividend ?? d.adjDividend ?? 0)

/**
 * Meses en los que la empresa ha pagado en los últimos 3 años, con el importe
 * por acción de cada mes.
 *
 * Ojo con la fecha: el histórico de Yahoo son fechas EX-DIVIDENDO, no de pago,
 * y el pago suele caer 3-6 semanas después — a veces en el mes siguiente. Se
 * usa el mes de la ex-date porque es el único dato con historia (Yahoo solo
 * publica la fecha de pago del próximo dividendo), y se advierte en la card.
 */
const mesesPago = computed(() => {
  const corte = new Date()
  corte.setFullYear(corte.getFullYear() - 3)
  const corteISO = corte.toISOString().slice(0, 10)

  const porMes = Array.from({ length: 12 }, () => ({ pagos: [], anios: new Set() }))
  for (const d of props.dividends || []) {
    const fecha = String(d?.date || '').slice(0, 10)
    if (!fecha || fecha < corteISO) continue
    const importe = amountOf(d)
    if (!(importe > 0)) continue
    const m = Number(fecha.slice(5, 7)) - 1
    if (m < 0 || m > 11) continue
    porMes[m].pagos.push(importe)
    porMes[m].anios.add(fecha.slice(0, 4))
  }

  return porMes.map((entry, m) => {
    if (!entry.pagos.length) return { mes: m, paga: false }
    // Mediana: un recorte o un pago extraordinario no debe desplazar la cifra.
    const xs = [...entry.pagos].sort((a, b) => a - b)
    const mid = Math.floor(xs.length / 2)
    const porAccion = xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2
    return {
      mes: m,
      paga: true,
      porAccion,
      total: props.shares > 0 ? porAccion * props.shares : null,
      anios: entry.anios.size,
    }
  })
})

const conPago = computed(() => mesesPago.value.filter((m) => m.paga))
const totalAnual = computed(() =>
  conPago.value.reduce((s, m) => s + (m.porAccion || 0), 0),
)
const totalAnualPosicion = computed(() =>
  props.shares > 0 ? totalAnual.value * props.shares : null,
)
const maxImporte = computed(() =>
  Math.max(...conPago.value.map((m) => m.porAccion), 0),
)
const mesProximo = computed(() =>
  proximoPago.value ? Number(proximoPago.value.slice(5, 7)) - 1 : null,
)
</script>

<template>
  <div class="glass-card p-4 mb-4">
    <div class="flex items-baseline justify-between mb-0.5">
      <h3 class="text-xs font-semibold text-foreground uppercase tracking-wider">Meses de pago</h3>
      <span v-if="conPago.length" class="text-[10px] text-zinc-500">
        {{ conPago.length }}{{ conPago.length === 1 ? ' pago' : ' pagos' }}/año
      </span>
    </div>

    <div v-if="conPago.length" class="text-[10px] text-zinc-500 mb-3 tabular-nums">
      {{ money(totalAnual, 4) }}/acción al año
      <template v-if="totalAnualPosicion != null">
        · {{ money(totalAnualPosicion) }} con tu posición
      </template>
    </div>

    <template v-if="conPago.length">
      <!-- Rejilla de 12 meses: los que pagan, con importe y barra proporcional -->
      <div class="grid grid-cols-6 gap-1.5 sm:gap-2">
        <div
          v-for="m in mesesPago"
          :key="m.mes"
          class="rounded-lg p-1.5 text-center"
          :style="m.paga
            ? { background: 'rgba(52,211,153,0.08)', border: '1px solid ' + (mesProximo === m.mes ? 'rgba(52,211,153,0.5)' : 'rgba(52,211,153,0.18)') }
            : { background: 'rgba(255,255,255,0.02)', border: '1px solid transparent' }"
        >
          <div
            class="text-[10px] font-semibold uppercase"
            :style="{ color: m.paga ? '#34d399' : '#52525b' }"
          >{{ MESES[m.mes] }}</div>

          <template v-if="m.paga">
            <div class="text-[10px] font-bold tabular-nums text-foreground leading-tight mt-0.5">
              {{ money(m.total != null ? m.total : m.porAccion, m.total != null ? 2 : 3) }}
            </div>
            <div
              class="h-0.5 rounded-full mt-1 mx-auto"
              :style="{
                width: Math.max(12, (m.porAccion / maxImporte) * 100) + '%',
                background: '#34d399',
              }"
            />
          </template>
          <div v-else class="text-[10px] text-zinc-600 mt-0.5">—</div>
        </div>
      </div>

      <p class="mt-3 text-[10px] text-zinc-500 leading-snug">
        <span v-if="proximoPago" class="text-emerald-400/80">
          Próximo pago confirmado: {{ proximoPago }}.
        </span>
        Importe por acción = mediana de los pagos de ese mes en los últimos 3 años.
        Los meses provienen de la fecha <strong>ex-dividendo</strong>, que es la única
        con histórico: el cobro suele llegar 3-6 semanas después y puede caer en el
        mes siguiente.
      </p>
    </template>

    <p v-else class="text-[11px] text-zinc-500 py-3">
      Sin pagos de dividendo en los últimos 3 años.
    </p>
  </div>
</template>
