<script setup>
import { computed } from 'vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  status: { type: String, required: true }, // 'idle' | 'running' | 'done'
  items: { type: Object, required: true },
  total: { type: Number, required: true },
  completed: { type: Number, required: true },
  okCount: { type: Number, required: true },
  errorCount: { type: Number, required: true },
  progressPct: { type: Number, required: true },
  elapsedMs: { type: Number, required: true },
})

const emit = defineEmits(['close'])

const isRunning = computed(() => props.status === 'running')
const isDone = computed(() => props.status === 'done')

const elapsedLabel = computed(() => {
  const s = Math.round(props.elapsedMs / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rs = s % 60
  return `${m}m ${rs}s`
})

const orderedItems = computed(() => {
  const order = { syncing: 0, pending: 1, error: 2, ok: 3 }
  return Object.entries(props.items)
    .map(([ticker, v]) => ({ ticker, ...v }))
    .sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9))
})

function statusColor(s) {
  return {
    pending: '#71717a',
    syncing: '#415BFF',
    ok: '#34d399',
    error: '#f87171',
  }[s] || '#71717a'
}

function statusLabel(s) {
  return {
    pending: 'En cola',
    syncing: 'Sincronizando…',
    ok: 'OK',
    error: 'Error',
  }[s] || s
}

function onBackdrop(e) {
  if (e.target !== e.currentTarget) return
  // Solo cerrar cuando ya ha terminado (no cancelable durante run)
  if (isDone.value) emit('close')
}
</script>

<template>
  <Transition name="dialog-fade">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-center justify-center"
      @click="onBackdrop"
    >
      <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      <div class="glass-card relative z-10 w-full max-w-lg mx-3 sm:mx-auto p-4 sm:p-6">
        <!-- Header -->
        <div class="flex items-start justify-between mb-4">
          <div>
            <h3 class="text-lg font-semibold text-foreground">
              {{ isDone ? 'Sincronización completada' : 'Sincronizando análisis' }}
            </h3>
            <p class="text-xs text-muted-foreground mt-0.5">
              <template v-if="isRunning">{{ completed }} de {{ total }} · {{ elapsedLabel }}</template>
              <template v-else-if="isDone">
                <span class="text-emerald-400">{{ okCount }} OK</span>
                <span v-if="errorCount > 0"> · <span class="text-red-400">{{ errorCount }} con error</span></span>
                · {{ elapsedLabel }}
              </template>
            </p>
          </div>
          <button
            v-if="isDone"
            class="gw-btn-icon"
            title="Cerrar"
            @click="emit('close')"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <path d="M18 6 6 18" /><path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        <!-- Progress bar -->
        <div class="mb-4">
          <div class="h-1.5 rounded-full bg-white/5 overflow-hidden">
            <div
              class="h-full rounded-full transition-all duration-300"
              :style="{
                width: progressPct + '%',
                background: isDone && errorCount > 0
                  ? 'linear-gradient(90deg, #fb923c40, #fb923c)'
                  : 'linear-gradient(90deg, #415BFF40, #415BFF)',
              }"
            />
          </div>
        </div>

        <!-- Items list -->
        <div class="max-h-[50vh] overflow-y-auto pr-1 -mr-1 space-y-1">
          <div
            v-for="item in orderedItems"
            :key="item.ticker"
            class="flex items-center gap-3 py-2 px-2.5 rounded-md"
            :style="{
              background: item.status === 'syncing' ? 'rgba(65,91,255,0.06)' : 'transparent',
            }"
          >
            <!-- Status icon -->
            <div class="w-5 h-5 shrink-0 flex items-center justify-center">
              <div
                v-if="item.status === 'syncing'"
                class="spinner"
                style="width: 14px; height: 14px; border-width: 2px;"
              />
              <svg v-else-if="item.status === 'ok'" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2.5" stroke-linecap="round"><path d="M20 6 9 17l-5-5" /></svg>
              <svg v-else-if="item.status === 'error'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2.5" stroke-linecap="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
              <div v-else class="w-1.5 h-1.5 rounded-full" style="background: #52525b;" />
            </div>

            <!-- Ticker -->
            <span class="text-sm font-semibold text-foreground tabular-nums">{{ item.ticker }}</span>

            <!-- Status / error -->
            <span
              class="text-[11px] ml-auto truncate max-w-[55%] text-right"
              :style="{ color: statusColor(item.status) }"
              :title="item.error || ''"
            >
              {{ item.error || statusLabel(item.status) }}
            </span>
          </div>
        </div>

        <!-- Footer -->
        <div v-if="isRunning" class="mt-4 text-[11px] text-muted-foreground text-center">
          No cierres esta ventana hasta que termine la sincronización
        </div>
        <div v-else-if="isDone" class="mt-4 flex justify-end">
          <button class="gw-btn h-9 text-sm px-4" @click="emit('close')">Cerrar</button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.dialog-fade-enter-active,
.dialog-fade-leave-active {
  transition: opacity 0.2s ease;
}
.dialog-fade-enter-from,
.dialog-fade-leave-to {
  opacity: 0;
}
</style>
