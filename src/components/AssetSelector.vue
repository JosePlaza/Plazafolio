<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'

const props = defineProps({
  actives: { type: Array, default: () => [] },
  watchlist: { type: Array, default: () => [] },
  selectedId: { type: String, default: null },
})

const emit = defineEmits(['select'])

const open = ref(false)
const query = ref('')
const searchInput = ref(null)
const rootEl = ref(null)
const highlighted = ref(0)

const selected = computed(() =>
  [...props.actives, ...props.watchlist].find((a) => a.id === props.selectedId) || null,
)

function matches(asset, q) {
  if (!q) return true
  const needle = q.toLowerCase()
  return (
    String(asset.ticker || '').toLowerCase().includes(needle) ||
    String(asset.name || '').toLowerCase().includes(needle)
  )
}

const groups = computed(() => {
  const q = query.value.trim()
  return [
    { key: 'actives', label: 'Activos', items: props.actives.filter((a) => matches(a, q)) },
    { key: 'watchlist', label: 'Watchlist', items: props.watchlist.filter((a) => matches(a, q)) },
  ].filter((g) => g.items.length)
})

// Lista plana en el orden en que se pinta, para que las flechas del teclado
// recorran las opciones igual que se ven, atravesando los dos grupos.
const flat = computed(() => groups.value.flatMap((g) => g.items))

watch(query, () => { highlighted.value = 0 })

async function toggle() {
  open.value = !open.value
  if (open.value) {
    query.value = ''
    highlighted.value = Math.max(0, flat.value.findIndex((a) => a.id === props.selectedId))
    await nextTick()
    searchInput.value?.focus()
  }
}

function choose(asset) {
  open.value = false
  query.value = ''
  if (asset.id !== props.selectedId) emit('select', asset)
}

function onKeydown(e) {
  if (!open.value) return
  if (e.key === 'Escape') { open.value = false; return }
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    highlighted.value = Math.min(highlighted.value + 1, flat.value.length - 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    highlighted.value = Math.max(highlighted.value - 1, 0)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const asset = flat.value[highlighted.value]
    if (asset) choose(asset)
  }
}

function onDocClick(e) {
  if (open.value && rootEl.value && !rootEl.value.contains(e.target)) open.value = false
}

onMounted(() => document.addEventListener('click', onDocClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))
</script>

<template>
  <div ref="rootEl" class="relative" @keydown="onKeydown">
    <!-- Botón: activo actual -->
    <button
      class="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] transition-colors"
      @click="toggle"
    >
      <template v-if="selected">
        <div v-if="selected.image" class="w-7 h-7 rounded-lg overflow-hidden shrink-0 bg-white/5 p-0.5">
          <img :src="selected.image" :alt="selected.ticker" class="w-full h-full object-contain rounded" />
        </div>
        <div v-else class="w-7 h-7 rounded-lg shrink-0 bg-primary/10 flex items-center justify-center">
          <span class="text-primary text-[9px] font-bold">{{ selected.ticker?.slice(0, 2) }}</span>
        </div>
        <div class="min-w-0 flex-1 text-left">
          <div class="text-sm font-semibold text-foreground leading-tight">{{ selected.ticker }}</div>
          <div class="text-[11px] text-muted-foreground truncate leading-tight">{{ selected.name }}</div>
        </div>
      </template>
      <span v-else class="flex-1 text-left text-sm text-muted-foreground">Selecciona un activo</span>

      <svg
        width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="2" stroke-linecap="round"
        class="shrink-0 text-muted-foreground transition-transform duration-200"
        :class="open ? 'rotate-180' : ''"
      ><path d="m6 9 6 6 6-6" /></svg>
    </button>

    <!-- Desplegable -->
    <Transition name="selector-fade">
      <div
        v-if="open"
        class="absolute left-0 right-0 top-full mt-1.5 z-50 rounded-xl overflow-hidden shadow-2xl"
        style="background: rgba(14, 14, 22, 0.98); border: 1px solid rgba(255,255,255,0.08);"
      >
        <!-- Buscador -->
        <div class="p-2 border-b border-white/[0.06]">
          <input
            ref="searchInput"
            v-model="query"
            type="text"
            placeholder="Buscar por ticker o nombre..."
            class="w-full px-2.5 py-2 rounded-lg text-sm bg-white/[0.03] border border-white/[0.06] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/40"
          />
        </div>

        <div class="max-h-[min(60vh,380px)] overflow-y-auto py-1">
          <template v-for="group in groups" :key="group.key">
            <div class="px-3 pt-2 pb-1 text-[10px] font-bold tracking-[0.15em] uppercase text-muted-foreground/60">
              {{ group.label }}
            </div>
            <button
              v-for="asset in group.items"
              :key="asset.id"
              class="w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors"
              :class="[
                asset.id === selectedId ? 'bg-primary/10' : '',
                flat[highlighted]?.id === asset.id ? 'bg-white/[0.06]' : 'hover:bg-white/[0.04]',
              ]"
              @click="choose(asset)"
              @mousemove="highlighted = flat.findIndex((a) => a.id === asset.id)"
            >
              <div v-if="asset.image" class="w-6 h-6 rounded-md overflow-hidden shrink-0 bg-white/5 p-0.5">
                <img :src="asset.image" :alt="asset.ticker" class="w-full h-full object-contain rounded" />
              </div>
              <div v-else class="w-6 h-6 rounded-md shrink-0 bg-primary/10 flex items-center justify-center">
                <span class="text-primary text-[8px] font-bold">{{ asset.ticker?.slice(0, 2) }}</span>
              </div>
              <div class="min-w-0 flex-1">
                <div class="text-[13px] font-medium text-foreground truncate leading-tight">{{ asset.ticker }}</div>
                <div class="text-[10px] text-muted-foreground truncate leading-tight">{{ asset.name }}</div>
              </div>
              <svg
                v-if="asset.id === selectedId"
                width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#415BFF"
                stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="shrink-0"
              ><path d="M20 6 9 17l-5-5" /></svg>
            </button>
          </template>

          <div v-if="!groups.length" class="px-3 py-6 text-center text-xs text-muted-foreground/60">
            Sin resultados para «{{ query }}»
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.selector-fade-enter-active,
.selector-fade-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.selector-fade-enter-from,
.selector-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
