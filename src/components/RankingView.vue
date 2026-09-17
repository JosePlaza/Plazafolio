<script setup>
import { ref, computed, onMounted, watch, onBeforeUnmount } from 'vue'
import { getAllCachedAnalyses, persistScores, snapshotUserRanking } from '@/services/assetsApi'
import { computeBuyScore } from '@/lib/scoring'
import { useCurrency } from '@/composables/useCurrency'
import { useBulkSync } from '@/composables/useBulkSync'
import BulkSyncDialog from '@/components/BulkSyncDialog.vue'
import RankDelta from '@/components/RankDelta.vue'

const props = defineProps({
  actives: { type: Array, default: () => [] },
  watchlist: { type: Array, default: () => [] },
  visible: { type: Boolean, default: false },
})

const emit = defineEmits(['select-asset'])

const { symbolFor, convertByTicker } = useCurrency()
const analyses = ref({})
const loadingRanking = ref(false)
const showScoringInfo = ref(false)

const bulkSync = useBulkSync()
const showBulkDialog = ref(false)

const allAssets = computed(() => [...props.actives, ...props.watchlist])

// Build ranked list combining asset info with analysis scores
const rankedAssets = computed(() => {
  return allAssets.value
    .map((asset) => {
      const cached = analyses.value[asset.ticker]
      if (!cached || !cached.data) {
        return {
          ...asset,
          score: null,
          scoring: null,
          indicators: null,
          projection: null,
          previousRank: null,
          currentRank: null,
          category: asset.category || (props.actives.find(a => a.id === asset.id) ? 'actives' : 'watchlist'),
        }
      }
      const { indicators } = cached.data
      const projection = cached.data.projection
      const dividends = cached.data.dividends
      const cashFlow = cached.data.cashFlow || null
      const fundamentals = cached.data.fundamentals || null
      const scoring = computeBuyScore(indicators, projection, dividends, cashFlow, fundamentals)
      return {
        ...asset,
        score: scoring.score,
        scoring,
        indicators,
        projection,
        previousRank: cached.previousRank ?? null,
        currentRank: cached.currentRank ?? null,
        currency: symbolFor(asset.ticker),
        category: asset.category || (props.actives.find(a => a.id === asset.id) ? 'actives' : 'watchlist'),
      }
    })
    .sort((a, b) => {
      if (a.score == null && b.score == null) return 0
      if (a.score == null) return 1
      if (b.score == null) return -1
      return b.score - a.score
    })
})

/**
 * Posición anterior de cada item, expresada en el MISMO espacio de posiciones
 * que el número que se pinta al lado (`idx + 1` sobre `rankedAssets`).
 *
 * El snapshot de Supabase (`previous_rank`) se calcula sobre otra población
 * —solo filas de `analyses` que sigan en `assets`, con desempate por ticker y
 * con el `score` persistido, no el recalculado en vivo—, así que restarlo tal
 * cual contra la posición visible daba flechas que no cuadraban con el número.
 *
 * Solución: cogemos los items que SÍ tienen foto anterior, nos quedamos con los
 * huecos que ocupan hoy en la lista visible, y repartimos esos mismos huecos
 * según el orden del snapshot. Así ambas posiciones viven en la misma escala,
 * los que no se movieron dan "=" exacto y las subidas compensan a las bajadas.
 */
const previousPositions = computed(() => {
  const eligible = rankedAssets.value
    .map((item, idx) => ({ item, pos: idx + 1 }))
    .filter(({ item }) => item.previousRank != null && item.score != null)

  const slots = eligible.map((e) => e.pos)
  const previous = new Map()
  eligible
    .slice()
    .sort((a, b) => a.item.previousRank - b.item.previousRank)
    .forEach((e, i) => previous.set(e.item.id, slots[i]))
  return previous
})

/**
 * Delta de posición vs último snapshot.
 * - sin posición anterior → aún no ha entrado en ningún snapshot → "NEW"
 * - delta > 0 → subió N posiciones (verde, ▲)
 * - delta < 0 → bajó N posiciones (rojo, ▼)
 * - delta = 0 → misma posición (gris, =)
 */
function rankDelta(item, idx) {
  const prev = previousPositions.value.get(item.id)
  if (prev == null) return { kind: 'new' }
  const diff = prev - (idx + 1)
  if (diff > 0) return { kind: 'up', value: diff }
  if (diff < 0) return { kind: 'down', value: -diff }
  return { kind: 'same' }
}

async function startBulkSync() {
  if (!allAssets.value.length) return
  showBulkDialog.value = true
  try {
    await bulkSync.start(allAssets.value)
  } finally {
    // Tras el snapshot, recargar para refrescar previous/current rank
    await loadAnalyses()
  }
}

function closeBulkDialog() {
  showBulkDialog.value = false
  bulkSync.reset()
}

async function loadAnalyses() {
  loadingRanking.value = true
  try {
    const data = await getAllCachedAnalyses()
    analyses.value = data || {}
    await syncScoresAndRanks()
  } catch (err) {
    console.error('Error loading analyses for ranking:', err)
  } finally {
    loadingRanking.value = false
  }
}

/**
 * Mantiene la columna `score` de Supabase coherente con el score que se muestra
 * (recalculado en vivo), porque `snapshot_user_ranking` ordena por esa columna:
 * si está a null el snapshot sale alfabético por ticker y el ranking anterior
 * contra el que comparamos es basura.
 *
 * Después llama a la RPC en cada carga. Es seguro: la función solo promueve
 * `current_rank -> previous_rank` al cruzar día; el resto de llamadas solo
 * refrescan la posición actual. Solo releemos cuando ha promovido de verdad,
 * que es lo único que cambia el delta.
 */
async function syncScoresAndRanks() {
  const entries = []
  for (const [ticker, cached] of Object.entries(analyses.value)) {
    if (!cached?.data?.indicators) continue
    const s = computeBuyScore(
      cached.data.indicators,
      cached.data.projection,
      cached.data.dividends,
      cached.data.cashFlow || null,
      cached.data.fundamentals || null,
    )
    const live = s.score
    const stored = cached.score
    // Persistir si falta o difiere de forma apreciable del recalculado en vivo.
    if (live != null && (stored == null || Math.abs(stored - live) > 0.05)) {
      entries.push({ ticker, score: live })
    }
  }

  if (entries.length) await persistScores(entries)

  const snap = await snapshotUserRanking()
  if (snap?.promoted) {
    // Releer para reflejar el nuevo previous_rank en el delta.
    const fresh = await getAllCachedAnalyses()
    if (fresh) analyses.value = fresh
  }
}

// Load when becomes visible
watch(() => props.visible, (val) => {
  if (val) loadAnalyses()
})

onMounted(() => {
  if (props.visible) loadAnalyses()
})

// Close popover on outside click
function onDocClick(e) {
  if (showScoringInfo.value && !e.target.closest('.scoring-popover-wrapper')) {
    showScoringInfo.value = false
  }
}
onMounted(() => document.addEventListener('click', onDocClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))

function heatColor(heat) {
  const colors = {
    5: '#34d399',
    4: '#6ee7b7',
    3: '#fbbf24',
    2: '#fb923c',
    1: '#f87171',
    0: '#ef4444',
  }
  return colors[heat] ?? '#71717a'
}

function heatBg(heat) { return heatColor(heat) + '15' }
function heatBorder(heat) { return heatColor(heat) + '30' }
function scoreBarWidth(score) { return Math.max(0, Math.min(100, score || 0)) + '%' }
function scoreBarGradient(heat) { const c = heatColor(heat); return `linear-gradient(90deg, ${c}40, ${c})` }
function fmt(val, dec = 2) { if (val == null || isNaN(val)) return '-'; return Number(val).toFixed(dec) }
</script>

<template>
  <div class="max-w-5xl mx-auto">
    <!-- Title -->
    <div class="flex items-center justify-between mb-6">
      <div>
        <h2 class="text-xl font-bold text-foreground tracking-tight">Ranking de Activos</h2>
        <p class="text-muted-foreground text-xs mt-0.5">Prioridad de compra según método Geraldine Weiss</p>
      </div>

      <div class="flex items-center gap-2">
        <!-- Scoring info button + popover -->
        <div class="relative scoring-popover-wrapper">
          <button
            class="gw-btn-icon"
            title="Cómo se calcula el scoring"
            @click.stop="showScoringInfo = !showScoringInfo"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4" />
              <path d="M12 8h.01" />
            </svg>
          </button>

          <!-- Popover -->
          <Transition name="pop-fade">
            <div
              v-if="showScoringInfo"
              class="absolute right-0 top-full mt-2 z-50 w-[calc(100vw-2rem)] sm:w-80 max-w-[320px]"
              style="background: rgba(14, 14, 22, 0.95); backdrop-filter: blur(20px); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; box-shadow: 0 12px 40px rgba(0,0,0,0.5);"
            >
              <div class="p-4">
                <h3 class="text-xs font-semibold text-foreground uppercase tracking-wider mb-3">Cómo se calcula el Score</h3>
                <p class="text-[11px] text-zinc-400 leading-relaxed mb-3">
                  El score (0-100) combina 7 factores según el método Geraldine Weiss para determinar la prioridad de compra.
                </p>

                <!-- Factor 1 -->
                <div class="mb-2">
                  <div class="flex items-center justify-between mb-0.5">
                    <span class="text-[10px] font-semibold text-zinc-300">Y · Posición del Yield</span>
                    <span class="text-[9px] text-primary font-bold">0 – 45 pts</span>
                  </div>
                  <p class="text-[10px] text-zinc-400 leading-relaxed">
                    Yield cerca del promedio alto = zona de compra. Factor dominante del método Geraldine Weiss.
                  </p>
                </div>

                <!-- Factor 2 -->
                <div class="mb-2">
                  <div class="flex items-center justify-between mb-0.5">
                    <span class="text-[10px] font-semibold text-zinc-300">C · Crecimiento CAGR</span>
                    <span class="text-[9px] text-primary font-bold">0 – 12 pts</span>
                  </div>
                  <p class="text-[10px] text-zinc-400 leading-relaxed">
                    Crecimiento sostenido del dividendo. CAGR negativo penaliza.
                  </p>
                </div>

                <!-- Factor 3 -->
                <div class="mb-2">
                  <div class="flex items-center justify-between mb-0.5">
                    <span class="text-[10px] font-semibold text-zinc-300">S · Consistencia</span>
                    <span class="text-[9px] text-primary font-bold">0 – 8 pts</span>
                  </div>
                  <p class="text-[10px] text-zinc-400 leading-relaxed">
                    Años consecutivos pagando dividendo. Más años = empresa más fiable.
                  </p>
                </div>

                <!-- Factor 4 -->
                <div class="mb-2">
                  <div class="flex items-center justify-between mb-0.5">
                    <span class="text-[10px] font-semibold text-zinc-300">M · Margen de seguridad</span>
                    <span class="text-[9px] text-primary font-bold">0 – 5 pts</span>
                  </div>
                  <p class="text-[10px] text-zinc-400 leading-relaxed">
                    Potencial alcista hasta el precio de infravaloración.
                  </p>
                </div>

                <!-- Factor 5 -->
                <div class="mb-2">
                  <div class="flex items-center justify-between mb-0.5">
                    <span class="text-[10px] font-semibold text-zinc-300">K · Racha de dividendo</span>
                    <span class="text-[9px] text-primary font-bold">0 – 12 pts</span>
                  </div>
                  <p class="text-[10px] text-zinc-400 leading-relaxed">
                    Años consecutivos incrementando el dividendo. 25+ años = Aristocrat (12 pts).
                  </p>
                </div>

                <!-- Factor 6 -->
                <div class="mb-2">
                  <div class="flex items-center justify-between mb-0.5">
                    <span class="text-[10px] font-semibold text-zinc-300">P · Payout ratio</span>
                    <span class="text-[9px] text-primary font-bold">-8 / +5 pts</span>
                  </div>
                  <p class="text-[10px] text-zinc-400 leading-relaxed">
                    Payout &lt;30% = bonus. &gt;85% = penalización. Basado en FCF.
                  </p>
                </div>

                <!-- Factor 7 -->
                <div class="mb-2">
                  <div class="flex items-center justify-between mb-0.5">
                    <span class="text-[10px] font-semibold text-zinc-300">F · Fundamentales</span>
                    <span class="text-[9px] text-primary font-bold">-7 / +5 pts</span>
                  </div>
                  <p class="text-[10px] text-zinc-400 leading-relaxed">
                    Deuda/EBITDA y dilución de acciones. Baja deuda y recompras = bonus.
                  </p>
                </div>

                <!-- Signals table -->
                <div style="border-top: 1px solid rgba(255,255,255,0.06);" class="pt-3 mt-1">
                  <h4 class="text-[10px] font-semibold text-zinc-300 uppercase tracking-wider mb-2">Señales</h4>
                  <div class="grid grid-cols-2 gap-x-4 gap-y-1">
                    <div class="flex items-center gap-1.5">
                      <span class="w-2 h-2 rounded-full" style="background: #34d399;"></span>
                      <span class="text-[10px] text-zinc-400">Compra fuerte</span>
                      <span class="text-[9px] text-zinc-400 ml-auto">≥ 75</span>
                    </div>
                    <div class="flex items-center gap-1.5">
                      <span class="w-2 h-2 rounded-full" style="background: #6ee7b7;"></span>
                      <span class="text-[10px] text-zinc-400">Compra</span>
                      <span class="text-[9px] text-zinc-400 ml-auto">60-74</span>
                    </div>
                    <div class="flex items-center gap-1.5">
                      <span class="w-2 h-2 rounded-full" style="background: #fbbf24;"></span>
                      <span class="text-[10px] text-zinc-400">Vigilar</span>
                      <span class="text-[9px] text-zinc-400 ml-auto">45-59</span>
                    </div>
                    <div class="flex items-center gap-1.5">
                      <span class="w-2 h-2 rounded-full" style="background: #fb923c;"></span>
                      <span class="text-[10px] text-zinc-400">Mantener</span>
                      <span class="text-[9px] text-zinc-400 ml-auto">30-44</span>
                    </div>
                    <div class="flex items-center gap-1.5">
                      <span class="w-2 h-2 rounded-full" style="background: #f87171;"></span>
                      <span class="text-[10px] text-zinc-400">Caro</span>
                      <span class="text-[9px] text-zinc-400 ml-auto">15-29</span>
                    </div>
                    <div class="flex items-center gap-1.5">
                      <span class="w-2 h-2 rounded-full" style="background: #ef4444;"></span>
                      <span class="text-[10px] text-zinc-400">Vender</span>
                      <span class="text-[9px] text-zinc-400 ml-auto">&lt; 15</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Transition>
        </div>

        <!-- Reload ranking (rápido, lee de Supabase) .-->
        <!-- <button
          v-if="!loadingRanking"
          class="gw-btn-icon"
          title="Recargar ranking"
          @click="loadAnalyses"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21.5 2v6h-6" />
            <path d="M2.5 22v-6h6" />
            <path d="M2 11.5a10 10 0 0 1 18.8-4.3L21.5 8" />
            <path d="M22 12.5a10 10 0 0 1-18.8 4.3L2.5 16" />
          </svg>
        </button>
        <div v-else class="spinner" style="width: 20px; height: 20px; border-width: 2px;"></div> -->

        <!-- Sync All: recalcula TODOS los análisis y refresca snapshot -->
        <button
          class="gw-btn-icon"
          :title="bulkSync.status.value === 'running' ? 'Sincronizando…' : 'Recalcular todos los análisis'"
          :disabled="bulkSync.status.value === 'running' || !allAssets.length"
          @click="startBulkSync"
        >
          <svg v-if="bulkSync.status.value !== 'running'" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
            <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
            <path d="M16 16h5v5" />
          </svg>
          <div v-else class="spinner" style="width: 14px; height: 14px; border-width: 2px;"></div>
        </button>
      </div>
    </div>

    <!-- Empty state -->
    <div v-if="!allAssets.length && !loadingRanking" class="flex flex-col items-center justify-center py-32">
      <div class="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#415BFF" stroke-width="1.5" stroke-linecap="round">
          <path d="M8 21h8" />
          <path d="M12 17v4" />
          <path d="M7 4h10" />
          <path d="M5 8h14l-1 9H6Z" />
        </svg>
      </div>
      <p class="text-muted-foreground text-sm mb-1">No hay activos guardados</p>
      <p class="text-muted-foreground/50 text-xs">Añade activos desde la vista de Análisis</p>
    </div>

    <!-- Skeleton loader -->
    <div v-else-if="loadingRanking && !rankedAssets.some(a => a.scoring)" class="space-y-2 animate-pulse">
      <div v-for="i in 6" :key="i" class="glass-card p-4">
        <div class="flex items-center gap-4">
          <div class="w-8 h-8 rounded-lg bg-white/[0.04]"></div>
          <div class="w-9 h-9 rounded-lg bg-white/[0.04]"></div>
          <div class="flex-1 space-y-2">
            <div class="h-4 w-32 rounded bg-white/[0.05]"></div>
            <div class="h-3 w-20 rounded bg-white/[0.03]"></div>
          </div>
          <div class="w-20 space-y-1.5 text-right">
            <div class="h-2.5 w-10 rounded bg-white/[0.04] ml-auto"></div>
            <div class="h-4 w-14 rounded bg-white/[0.05] ml-auto"></div>
          </div>
          <div class="w-20 space-y-1.5 text-right">
            <div class="h-2.5 w-10 rounded bg-white/[0.04] ml-auto"></div>
            <div class="h-4 w-14 rounded bg-white/[0.05] ml-auto"></div>
          </div>
          <div class="w-44 space-y-1.5">
            <div class="flex justify-between">
              <div class="h-3 w-16 rounded bg-white/[0.04]"></div>
              <div class="h-3 w-6 rounded bg-white/[0.05]"></div>
            </div>
            <div class="h-1.5 rounded-full bg-white/[0.04]"></div>
            <div class="flex gap-2">
              <div class="h-2 w-6 rounded bg-white/[0.03]"></div>
              <div class="h-2 w-6 rounded bg-white/[0.03]"></div>
              <div class="h-2 w-6 rounded bg-white/[0.03]"></div>
              <div class="h-2 w-6 rounded bg-white/[0.03]"></div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Ranking list -->
    <div v-else class="space-y-2">
      <div
        v-for="(item, idx) in rankedAssets"
        :key="item.id"
        class="glass-card p-4 cursor-pointer group"
        @click="emit('select-asset', item)"
      >
        <!-- Mobile layout: position left column, content right -->
        <div class="flex gap-3 sm:hidden">
          <!-- Position badge + delta pinned top-left -->
          <div class="flex flex-col items-center gap-1 shrink-0">
            <div
              class="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold"
              :style="{
                background: item.scoring ? heatBg(item.scoring.heat) : 'rgba(255,255,255,0.04)',
                color: item.scoring ? heatColor(item.scoring.heat) : '#71717a',
                border: '1px solid ' + (item.scoring ? heatBorder(item.scoring.heat) : 'rgba(255,255,255,0.06)'),
              }"
            >
              {{ idx + 1 }}
            </div>
            <RankDelta :delta="rankDelta(item, idx)" />
          </div>

          <!-- Right content column -->
          <div class="flex-1 min-w-0 flex flex-col gap-2.5">
            <!-- Row 1: Logo + Name + Price -->
            <div class="flex items-center gap-2.5">
              <div v-if="item.image" class="w-9 h-9 rounded-lg overflow-hidden shrink-0 bg-white/5 p-0.5">
                <img :src="item.image" :alt="item.ticker" class="w-full h-full object-contain rounded-md" />
              </div>
              <div v-else class="w-9 h-9 rounded-lg shrink-0 bg-primary/10 flex items-center justify-center">
                <span class="text-primary text-[10px] font-bold">{{ item.ticker?.slice(0, 2) }}</span>
              </div>

              <div class="flex-1 min-w-0">
                <div class="text-sm font-semibold text-foreground truncate">{{ item.name }}</div>
                <div class="flex items-center gap-2 mt-0.5">
                  <span class="text-[10px] text-muted-foreground">{{ item.ticker }}</span>
                  <span
                    class="text-[9px] uppercase tracking-wider px-1.5 rounded"
                    :class="item.category === 'actives' ? 'text-primary bg-primary/10' : 'text-muted-foreground bg-white/5'"
                  >
                    {{ item.category === 'actives' ? 'Activo' : 'Watchlist' }}
                  </span>
                </div>
              </div>

              <div v-if="item.indicators" class="text-right shrink-0">
                <div class="text-sm font-medium text-foreground tabular-nums">{{ item.currency || '$' }}{{ fmt(convertByTicker(item.indicators.currentPrice, item.ticker)) }}</div>
              </div>
            </div>

            <!-- Row 2: Score bar -->
            <div v-if="item.scoring">
              <div class="flex items-center justify-between mb-1">
                <span
                  class="text-[10px] font-semibold uppercase tracking-wider"
                  :style="{ color: heatColor(item.scoring.heat) }"
                >
                  {{ item.scoring.signal }}
                </span>
                <span class="text-xs font-bold text-foreground">{{ item.score }}</span>
              </div>
              <div class="h-1.5 rounded-full bg-white/5 overflow-hidden">
                <div
                  class="h-full rounded-full transition-all duration-500"
                  :style="{
                    width: scoreBarWidth(item.score),
                    background: scoreBarGradient(item.scoring.heat),
                  }"
                ></div>
              </div>
            </div>
            <div v-else>
              <span class="text-[10px] text-muted-foreground/50">Sin análisis — analiza este activo primero</span>
            </div>

            <!-- Row 3: Metrics -->
            <div v-if="item.scoring" class="flex flex-wrap items-center gap-x-3 gap-y-1">
              <div v-if="item.indicators" class="flex items-center gap-1">
                <span class="text-[10px] uppercase" style="color: #71717a;">Yield</span>
                <span class="text-[12px] font-bold text-primary tabular-nums">{{ fmt(item.indicators.currentYield) }}%</span>
              </div>
              <div v-if="item.projection" class="flex items-center gap-1">
                <span class="text-[10px] uppercase" style="color: #71717a;">CAGR</span>
                <span
                  class="text-[12px] font-semibold tabular-nums"
                  :style="{ color: item.projection.cagr >= 0 ? '#34d399' : '#f87171' }"
                >
                  {{ item.projection.cagr >= 0 ? '+' : '' }}{{ fmt(item.projection.cagr) }}%
                </span>
              </div>
              <div class="flex gap-1.5 ml-auto flex-wrap justify-end">
                <span class="text-[9px] tabular-nums" style="color: #a1a1aa;">Y:{{ item.scoring.breakdown.yield }}</span>
                <span class="text-[9px] tabular-nums" style="color: #a1a1aa;">C:{{ item.scoring.breakdown.cagr }}</span>
                <span class="text-[9px] tabular-nums" style="color: #a1a1aa;">S:{{ item.scoring.breakdown.consistency }}</span>
                <span class="text-[9px] tabular-nums" style="color: #a1a1aa;">K:{{ item.scoring.breakdown.streak }}</span>
                <span class="text-[9px] tabular-nums" :style="{ color: item.scoring.breakdown.payout < 0 ? '#f87171' : '#a1a1aa' }">P:{{ item.scoring.breakdown.payout }}</span>
                <span class="text-[9px] tabular-nums" :style="{ color: item.scoring.breakdown.fundamentals < 0 ? '#f87171' : '#a1a1aa' }">F:{{ item.scoring.breakdown.fundamentals }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Desktop layout: single row -->
        <div class="hidden sm:flex items-center gap-3 lg:gap-4">
          <!-- Position + delta stacked -->
          <div class="flex flex-col items-center gap-1 shrink-0">
            <div
              class="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold"
              :style="{
                background: item.scoring ? heatBg(item.scoring.heat) : 'rgba(255,255,255,0.04)',
                color: item.scoring ? heatColor(item.scoring.heat) : '#71717a',
                border: '1px solid ' + (item.scoring ? heatBorder(item.scoring.heat) : 'rgba(255,255,255,0.06)'),
              }"
            >
              {{ idx + 1 }}
            </div>
            <RankDelta :delta="rankDelta(item, idx)" />
          </div>

          <!-- Logo + Info -->
          <div class="flex items-center gap-3 min-w-0 flex-1">
            <div
              v-if="item.image"
              class="w-9 h-9 rounded-lg overflow-hidden shrink-0 bg-white/5 p-0.5"
            >
              <img :src="item.image" :alt="item.ticker" class="w-full h-full object-contain rounded-md" />
            </div>
            <div v-else class="w-9 h-9 rounded-lg shrink-0 bg-primary/10 flex items-center justify-center">
              <span class="text-primary text-[10px] font-bold">{{ item.ticker?.slice(0, 2) }}</span>
            </div>

            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <span class="text-sm font-semibold text-foreground truncate">{{ item.name }}</span>
                <span class="text-[10px] text-muted-foreground">{{ item.ticker }}</span>
              </div>
              <div class="flex items-center gap-3 mt-0.5">
                <span
                  class="text-[9px] uppercase tracking-wider px-1.5 py-0 rounded"
                  :class="item.category === 'actives' ? 'text-primary bg-primary/10' : 'text-muted-foreground bg-white/5'"
                >
                  {{ item.category === 'actives' ? 'Activo' : 'Watchlist' }}
                </span>
                <span v-if="item.indicators" class="text-[10px]" style="color: #71717a;">
                  {{ item.currency || '$' }}{{ fmt(convertByTicker(item.indicators.currentPrice, item.ticker)) }}
                </span>
              </div>
            </div>
          </div>

          <!-- Yield info -->
          <div v-if="item.indicators" class="text-right shrink-0 w-16 lg:w-20">
            <div class="text-[10px] uppercase" style="color: #71717a;">Yield</div>
            <div class="text-sm font-bold text-primary">{{ fmt(item.indicators.currentYield) }}%</div>
          </div>

          <!-- CAGR -->
          <div v-if="item.projection" class="text-right shrink-0 w-16 lg:w-20">
            <div class="text-[10px] uppercase" style="color: #71717a;">CAGR</div>
            <div
              class="text-sm font-semibold"
              :style="{ color: item.projection.cagr >= 0 ? '#34d399' : '#f87171' }"
            >
              {{ item.projection.cagr >= 0 ? '+' : '' }}{{ fmt(item.projection.cagr) }}%
            </div>
          </div>

          <!-- Score bar + signal -->
          <div v-if="item.scoring" class="shrink-0 w-36 lg:w-44">
            <div class="flex items-center justify-between mb-1">
              <span
                class="text-[10px] font-semibold uppercase tracking-wider"
                :style="{ color: heatColor(item.scoring.heat) }"
              >
                {{ item.scoring.signal }}
              </span>
              <span class="text-xs font-bold text-foreground">{{ item.score }}</span>
            </div>
            <div class="h-1.5 rounded-full bg-white/5 overflow-hidden">
              <div
                class="h-full rounded-full transition-all duration-500"
                :style="{
                  width: scoreBarWidth(item.score),
                  background: scoreBarGradient(item.scoring.heat),
                }"
              ></div>
            </div>
            <div class="flex gap-1.5 mt-1 flex-wrap">
              <span class="text-[8px]" style="color: #a1a1aa;" title="Posición del yield">Y:{{ item.scoring.breakdown.yield }}</span>
              <span class="text-[8px]" style="color: #a1a1aa;" title="Crecimiento CAGR">C:{{ item.scoring.breakdown.cagr }}</span>
              <span class="text-[8px]" style="color: #a1a1aa;" title="Consistencia">S:{{ item.scoring.breakdown.consistency }}</span>
              <span class="text-[8px]" style="color: #a1a1aa;" title="Racha de incremento">K:{{ item.scoring.breakdown.streak }}</span>
              <span class="text-[8px]" :style="{ color: item.scoring.breakdown.payout < 0 ? '#f87171' : '#a1a1aa' }" title="Payout ratio">P:{{ item.scoring.breakdown.payout }}</span>
              <span class="text-[8px]" :style="{ color: item.scoring.breakdown.fundamentals < 0 ? '#f87171' : '#a1a1aa' }" title="Fundamentales">F:{{ item.scoring.breakdown.fundamentals }}</span>
            </div>
          </div>

          <!-- No data state -->
          <div v-else class="shrink-0 w-36 lg:w-44 text-right">
            <span class="text-[10px] text-muted-foreground/50">Sin análisis</span>
            <p class="text-[9px] text-muted-foreground/30 mt-0.5">Analiza este activo primero</p>
          </div>
        </div>
      </div>
    </div>

    <!-- Bulk sync dialog -->
    <BulkSyncDialog
      :open="showBulkDialog"
      :status="bulkSync.status.value"
      :items="bulkSync.items"
      :total="bulkSync.total.value"
      :completed="bulkSync.completed.value"
      :ok-count="bulkSync.okCount.value"
      :error-count="bulkSync.errorCount.value"
      :progress-pct="bulkSync.progressPct.value"
      :elapsed-ms="bulkSync.elapsedMs.value"
      @close="closeBulkDialog"
    />
  </div>
</template>

<style scoped>
.pop-fade-enter-active,
.pop-fade-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.pop-fade-enter-from,
.pop-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
