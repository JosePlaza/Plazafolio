<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { getAllCachedAnalyses } from '@/services/assetsApi'
import { fetchDividendPaymentDates } from '@/services/dividendCalendarApi'
import { useTransactions } from '@/composables/useTransactions'
import { useCurrency } from '@/composables/useCurrency'
import { derivePosition } from '@/services/transactionsApi'
import AnimatedNumber from '@/components/AnimatedNumber.vue'

const props = defineProps({
  actives: { type: Array, default: () => [] },
  visible: { type: Boolean, default: false },
})

const { displaySymbol, convert, nativeCurrencyOf, eurUsdRate } = useCurrency()
const { transactions, load: loadTransactions } = useTransactions()

const analyses = ref({})
const paymentDates = ref({})
const loading = ref(false)

const MONTH_NAMES_FULL = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

// ── Posiciones abiertas a partir de las transacciones ────────────────
const positions = computed(() => {
  const result = {}
  for (const asset of props.actives) {
    const txs = transactions.value.filter((tx) => tx.assetId === asset.id)
    if (!txs.length) continue
    const nativeCur = nativeCurrencyOf(asset.ticker)
    const pos = derivePosition(txs, nativeCur, eurUsdRate.value)
    if (pos.shares > 0) result[asset.ticker] = { ...pos, asset }
  }
  return result
})

/**
 * Importe del próximo pago por acción.
 *
 * Yahoo publica la FECHA del próximo pago pero no su importe, así que usamos el
 * último dividendo efectivamente pagado. Es una estimación y se etiqueta como
 * tal en la UI: la fecha es real, el importe es el del pago anterior.
 */
function lastDividendPerShare(dividends) {
  if (!dividends?.length) return null
  const sorted = [...dividends].sort((a, b) => String(b.date).localeCompare(String(a.date)))
  const amount = Number(sorted[0].amount ?? sorted[0].dividend ?? 0)
  return amount > 0 ? amount : null
}

/**
 * Una fila por posición, con la fecha de pago REAL cuando Yahoo la da.
 *
 * `isUpcoming` distingue el pago futuro del dato obsoleto: Yahoo mantiene el
 * último pago ya realizado en `dividendDate` hasta que se declara el siguiente.
 * Nunca extrapolamos una fecha a partir del historial de ex-dividendos, que es
 * lo que hacía la versión anterior de esta vista.
 */
const rows = computed(() => {
  const out = []
  for (const asset of props.actives) {
    const pos = positions.value[asset.ticker]
    if (!pos) continue

    const nativeCur = nativeCurrencyOf(asset.ticker)
    const perShare = lastDividendPerShare(analyses.value[asset.ticker]?.data?.dividends)
    const info = paymentDates.value[asset.ticker.toUpperCase()]

    out.push({
      ticker: asset.ticker,
      name: asset.name,
      logo: asset.image,
      shares: pos.shares,
      perShare,
      total: perShare != null ? convert(perShare * pos.shares, nativeCur) : null,
      nativeCurrency: nativeCur,
      paymentDate: info?.isUpcoming ? info.paymentDate : null,
      lastKnownPayment: info?.paymentDate ?? null,
    })
  }
  return out
})

// Agrupado por mes de la fecha de pago, solo pagos confirmados a futuro.
const monthGroups = computed(() => {
  const groups = new Map()
  for (const row of rows.value) {
    if (!row.paymentDate) continue
    const key = row.paymentDate.slice(0, 7) // YYYY-MM
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  }

  return [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, items]) => {
      const [year, month] = key.split('-')
      return {
        key,
        label: `${MONTH_NAMES_FULL[Number(month) - 1]} ${year}`,
        items: items.sort((a, b) => a.paymentDate.localeCompare(b.paymentDate)),
        total: items.reduce((sum, i) => sum + (i.total || 0), 0),
      }
    })
})

// Posiciones sin fecha de pago confirmada. No se estiman: se listan aparte.
const unconfirmed = computed(() => rows.value.filter((r) => !r.paymentDate))

const totalUpcoming = computed(() =>
  monthGroups.value.reduce((sum, g) => sum + g.total, 0),
)

function dayOf(iso) {
  return String(Number(iso.slice(8, 10)))
}

function weekdayOf(iso) {
  const names = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
  return names[new Date(`${iso}T12:00:00`).getDay()]
}

function fmt(val, dec = 2) {
  if (val == null || isNaN(val)) return '-'
  return Number(val).toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec })
}

// Las participaciones son fraccionadas (45,8233 de APLE): redondear a entero
// falsearía la posición, pero arrastrar decimales inútiles en las enteras
// ensucia la fila. Hasta 4 decimales, sin ceros de relleno.
function fmtShares(val) {
  if (val == null || isNaN(val)) return '-'
  return Number(val).toLocaleString(undefined, { maximumFractionDigits: 4 })
}

async function loadData() {
  loading.value = true
  try {
    await loadTransactions()
    analyses.value = (await getAllCachedAnalyses()) || {}
    const tickers = props.actives.map((a) => a.ticker)
    paymentDates.value = await fetchDividendPaymentDates(tickers)
  } catch (err) {
    console.error('[Dividends] Error loading:', err)
  } finally {
    loading.value = false
  }
}

watch(() => props.visible, (val) => {
  if (val) loadData()
})

onMounted(() => {
  if (props.visible) loadData()
})
</script>

<template>
  <div class="max-w-3xl mx-auto">
    <!-- Cabecera -->
    <div class="flex items-center justify-between mb-6">
      <div>
        <h2 class="text-xl font-bold text-foreground tracking-tight">Dividendos</h2>
        <p class="text-muted-foreground text-xs mt-0.5">Próximos cobros por fecha de pago</p>
      </div>
      <button v-if="!loading" class="gw-btn-icon" title="Actualizar datos" @click="loadData">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21.5 2v6h-6" />
          <path d="M2.5 22v-6h6" />
          <path d="M2 11.5a10 10 0 0 1 18.8-4.3L21.5 8" />
          <path d="M22 12.5a10 10 0 0 1-18.8 4.3L2.5 16" />
        </svg>
      </button>
    </div>

    <!-- Skeleton -->
    <div v-if="loading && !monthGroups.length" class="animate-pulse space-y-3">
      <div v-for="i in 4" :key="i" class="glass-card p-4 h-20"></div>
    </div>

    <!-- Sin posiciones -->
    <div v-else-if="!rows.length" class="flex flex-col items-center justify-center py-32">
      <p class="text-muted-foreground text-sm mb-1">No hay posiciones abiertas</p>
      <p class="text-muted-foreground/50 text-xs">Registra compras desde la vista de Portfolio</p>
    </div>

    <template v-else>
      <!-- Total previsto -->
      <div v-if="monthGroups.length" class="glass-card p-4 mb-4 flex items-baseline justify-between">
        <span class="text-muted-foreground text-xs">Total previsto en los próximos cobros</span>
        <span class="text-lg font-bold tabular-nums" style="color: #34d399;">
          <AnimatedNumber :value="totalUpcoming" :prefix="displaySymbol" :decimals="2" />
        </span>
      </div>

      <!-- Listado agrupado por mes -->
      <div v-for="group in monthGroups" :key="group.key" class="mb-5">
        <div class="flex items-baseline justify-between px-1 mb-2">
          <h3 class="text-sm font-semibold text-foreground">{{ group.label }}</h3>
          <span class="text-xs font-semibold tabular-nums text-muted-foreground">
            {{ displaySymbol }}{{ fmt(group.total) }}
          </span>
        </div>

        <div class="space-y-2">
          <div v-for="item in group.items" :key="item.ticker" class="glass-card p-3 flex items-center gap-3">
            <!-- Día de pago -->
            <div class="w-11 shrink-0 text-center">
              <div class="text-lg font-bold leading-none tabular-nums text-foreground">{{ dayOf(item.paymentDate) }}</div>
              <div class="text-[9px] uppercase tracking-wide text-muted-foreground mt-0.5">{{ weekdayOf(item.paymentDate) }}</div>
            </div>

            <div v-if="item.logo" class="w-8 h-8 rounded-lg overflow-hidden shrink-0 bg-white/5 p-0.5">
              <img :src="item.logo" :alt="item.ticker" class="w-full h-full object-contain rounded-md" />
            </div>

            <div class="min-w-0 flex-1">
              <div class="text-sm font-semibold text-foreground truncate">{{ item.ticker }}</div>
              <div class="text-[11px] text-muted-foreground truncate">
                {{ fmtShares(item.shares) }} acc. ×
                <template v-if="item.perShare != null">{{ fmt(item.perShare, 4) }}</template>
                <template v-else>—</template>
              </div>
            </div>

            <div class="text-right shrink-0">
              <div v-if="item.total != null" class="text-sm font-bold tabular-nums" style="color: #34d399;">
                {{ displaySymbol }}{{ fmt(item.total) }}
              </div>
              <div v-else class="text-sm text-muted-foreground">—</div>
              <div class="text-[9px] text-muted-foreground/70">estimado</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Sin fecha de pago confirmada -->
      <div v-if="unconfirmed.length" class="mt-6">
        <div class="px-1 mb-2">
          <h3 class="text-sm font-semibold text-muted-foreground">Sin fecha de pago confirmada</h3>
          <p class="text-[11px] text-muted-foreground/60 mt-0.5">
            El proveedor no publica la fecha del próximo pago para estos valores. No se estima ninguna fecha.
          </p>
        </div>
        <div class="space-y-2">
          <div v-for="item in unconfirmed" :key="item.ticker" class="glass-card p-3 flex items-center gap-3 opacity-60">
            <div v-if="item.logo" class="w-8 h-8 rounded-lg overflow-hidden shrink-0 bg-white/5 p-0.5">
              <img :src="item.logo" :alt="item.ticker" class="w-full h-full object-contain rounded-md" />
            </div>
            <div class="min-w-0 flex-1">
              <div class="text-sm font-semibold text-foreground truncate">{{ item.ticker }}</div>
              <div class="text-[11px] text-muted-foreground truncate">{{ fmtShares(item.shares) }} acc.</div>
            </div>
            <div v-if="item.lastKnownPayment" class="text-[10px] text-muted-foreground/70 text-right shrink-0">
              último pago<br />{{ item.lastKnownPayment }}
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
