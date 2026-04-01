<script setup>
import { ref, watch } from 'vue'
import { getCurrencySymbol } from '@/lib/currency'

const props = defineProps({
  actives: { type: Array, default: () => [] },
  watchlist: { type: Array, default: () => [] },
  selectedId: { type: String, default: null },
  open: { type: Boolean, default: false },
})

const emit = defineEmits(['select', 'add', 'move', 'remove', 'reorder', 'close'])

// ── Collapse state (persisted in localStorage) ──
function loadCollapseState() {
  try {
    const saved = localStorage.getItem('gw-sidebar-collapse')
    if (saved) return JSON.parse(saved)
  } catch { /* ignore */ }
  return { actives: true, watchlist: true }
}

const savedState = loadCollapseState()
const activesOpen = ref(savedState.actives)
const watchlistOpen = ref(savedState.watchlist)

function saveCollapseState() {
  try {
    localStorage.setItem('gw-sidebar-collapse', JSON.stringify({
      actives: activesOpen.value,
      watchlist: watchlistOpen.value,
    }))
  } catch { /* ignore */ }
}

watch(activesOpen, saveCollapseState)
watch(watchlistOpen, saveCollapseState)

// ── Drag & Drop state ──
const dragItem = ref(null)
const dragSource = ref(null)
const dragOverCategory = ref(null)
const dropIndex = ref(-1)

function onDragStart(e, item, source) {
  dragItem.value = item
  dragSource.value = source
  e.dataTransfer.effectAllowed = 'move'
  e.dataTransfer.setData('text/plain', item.id)
  requestAnimationFrame(() => e.target.classList.add('dragging'))
}

function onDragEnd(e) {
  e.target.classList.remove('dragging')
  dragItem.value = null
  dragSource.value = null
  dragOverCategory.value = null
  dropIndex.value = -1
}

function onDragOverItem(e, category, index) {
  e.preventDefault()
  e.dataTransfer.dropEffect = 'move'
  dragOverCategory.value = category
  const rect = e.currentTarget.getBoundingClientRect()
  dropIndex.value = e.clientY < rect.top + rect.height / 2 ? index : index + 1
}

function onDragOverZone(e, category) {
  e.preventDefault()
  e.dataTransfer.dropEffect = 'move'
  dragOverCategory.value = category
  const list = category === 'actives' ? props.actives : props.watchlist
  dropIndex.value = list.length
  // Auto-expand collapsed group when dragging over it
  if (category === 'actives' && !activesOpen.value) activesOpen.value = true
  if (category === 'watchlist' && !watchlistOpen.value) watchlistOpen.value = true
}

function onDragLeave(e, category) {
  const relatedTarget = e.relatedTarget
  if (relatedTarget && e.currentTarget.contains(relatedTarget)) return
  if (dragOverCategory.value === category) {
    dragOverCategory.value = null
    dropIndex.value = -1
  }
}

function onDrop(e, targetCategory) {
  e.preventDefault()
  if (!dragItem.value) return
  if (dragSource.value !== targetCategory) emit('move', dragItem.value.id, targetCategory)
  dragOverCategory.value = null
  dropIndex.value = -1
  dragItem.value = null
  dragSource.value = null
}

function selectAsset(asset) { emit('select', asset); emit('close') }
function removeAsset(e, assetId) { e.stopPropagation(); emit('remove', assetId) }

function fmt(value, ticker) {
  if (value == null || isNaN(value) || value === 0) return '-'
  return getCurrencySymbol(ticker) + Number(value).toFixed(2)
}

function getIndicatorTop(list, idx) { return idx * 44 + 'px' }
</script>

<template>
  <!-- Mobile backdrop -->
  <Transition name="sidebar-backdrop">
    <div
      v-if="open"
      class="fixed inset-0 z-30 bg-black/50 backdrop-blur-sm lg:hidden"
      @click="emit('close')"
    />
  </Transition>

  <aside
    class="glass-sidebar w-72 fixed right-0 bottom-0 z-30 flex flex-col transition-transform duration-300 lg:translate-x-0"
    style="top: calc(3.5rem + env(safe-area-inset-top, 0px));"
    :class="open ? 'translate-x-0' : 'translate-x-full lg:translate-x-0'"
  >
    <!-- Sidebar header -->
    <div class="flex items-center justify-between px-4 py-3 border-b border-white/[0.04]">
      <span class="text-[10px] font-bold text-muted-foreground tracking-[0.2em] uppercase">Portfolio</span>
      <button class="gw-btn-icon w-7 h-7" @click="$emit('add')" title="Añadir activo">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg>
      </button>
    </div>

    <!-- Scrollable list -->
    <div class="flex-1 overflow-y-auto px-3 py-3 space-y-3">

      <!-- ── ACTIVES group ── -->
      <div>
        <button
          class="flex items-center w-full px-1 py-1 group cursor-pointer"
          @click="activesOpen = !activesOpen"
        >
          <span class="text-[10px] font-bold text-primary tracking-[0.2em] uppercase">Actives</span>
          <span class="ml-1.5 text-[10px] text-primary/50 font-medium">{{ actives.length }}</span>
          <span class="flex-1" />
          <svg
            width="14" height="14" viewBox="0 0 24 24" fill="none"
            stroke="#415BFF" stroke-width="2" stroke-linecap="round"
            class="transition-transform duration-200 opacity-0 group-hover:opacity-100"
            :class="activesOpen ? '' : '-rotate-90'"
          ><path d="m6 9 6 6 6-6" /></svg>
        </button>

        <div
          class="drop-zone min-h-[8px] relative overflow-hidden transition-all duration-200"
          :class="[
            dragOverCategory === 'actives' && dragSource !== 'actives' ? 'drag-over' : '',
            activesOpen ? 'max-h-[2000px] mt-1' : 'max-h-0'
          ]"
          @dragover="onDragOverZone($event, 'actives')"
          @dragleave="onDragLeave($event, 'actives')"
          @drop="onDrop($event, 'actives')"
        >
          <div
            v-if="dragOverCategory === 'actives' && dropIndex >= 0 && dragItem && dragSource !== 'actives'"
            class="drop-indicator" :style="{ top: getIndicatorTop(actives, dropIndex) }"
          />

          <div
            v-for="(asset, index) in actives" :key="asset.id"
            class="sidebar-item group flex items-center gap-2.5 px-2.5 py-2 rounded-xl cursor-pointer"
            :class="selectedId === asset.id ? 'sidebar-item-selected' : 'hover:bg-white/[0.03] border border-transparent'"
            draggable="true"
            @dragstart="onDragStart($event, asset, 'actives')"
            @dragend="onDragEnd"
            @dragover="onDragOverItem($event, 'actives', index)"
            @click="selectAsset(asset)"
          >
            <div v-if="asset.image" class="w-7 h-7 rounded-lg overflow-hidden flex-shrink-0 bg-white/5 p-0.5">
              <img :src="asset.image" :alt="asset.ticker" class="w-full h-full object-contain rounded" />
            </div>
            <div v-else class="w-7 h-7 rounded-lg flex-shrink-0 bg-primary/10 flex items-center justify-center">
              <span class="text-primary text-[9px] font-bold">{{ asset.ticker?.slice(0, 2) }}</span>
            </div>
            <div class="flex-1 min-w-0">
              <div class="text-[13px] font-medium text-foreground truncate leading-tight">{{ asset.name }}</div>
              <div class="text-[10px] text-muted-foreground leading-tight">{{ asset.ticker }}</div>
            </div>
            <div class="text-right flex-shrink-0">
              <div class="text-[13px] font-medium text-foreground tabular-nums">{{ fmt(asset.price, asset.ticker) }}</div>
            </div>
            <button
              class="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity ml-0.5"
              @click="removeAsset($event, asset.id)" title="Eliminar"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>

          <div v-if="!actives.length" class="text-[11px] text-muted-foreground/40 text-center py-4">
            Arrastra activos aquí
          </div>
        </div>
      </div>

      <!-- ── WATCHLIST group ── -->
      <div>
        <button
          class="flex items-center w-full px-1 py-1 group cursor-pointer"
          @click="watchlistOpen = !watchlistOpen"
        >
          <span class="text-[10px] font-bold text-primary tracking-[0.2em] uppercase">Watchlist</span>
          <span class="ml-1.5 text-[10px] text-primary/50 font-medium">{{ watchlist.length }}</span>
          <span class="flex-1" />
          <svg
            width="14" height="14" viewBox="0 0 24 24" fill="none"
            stroke="#415BFF" stroke-width="2" stroke-linecap="round"
            class="transition-transform duration-200 opacity-0 group-hover:opacity-100"
            :class="watchlistOpen ? '' : '-rotate-90'"
          ><path d="m6 9 6 6 6-6" /></svg>
        </button>

        <div
          class="drop-zone min-h-[8px] relative overflow-hidden transition-all duration-200"
          :class="[
            dragOverCategory === 'watchlist' && dragSource !== 'watchlist' ? 'drag-over' : '',
            watchlistOpen ? 'max-h-[2000px] mt-1' : 'max-h-0'
          ]"
          @dragover="onDragOverZone($event, 'watchlist')"
          @dragleave="onDragLeave($event, 'watchlist')"
          @drop="onDrop($event, 'watchlist')"
        >
          <div
            v-if="dragOverCategory === 'watchlist' && dropIndex >= 0 && dragItem && dragSource !== 'watchlist'"
            class="drop-indicator" :style="{ top: getIndicatorTop(watchlist, dropIndex) }"
          />

          <div
            v-for="(asset, index) in watchlist" :key="asset.id"
            class="sidebar-item group flex items-center gap-2.5 px-2.5 py-2 rounded-xl cursor-pointer"
            :class="selectedId === asset.id ? 'sidebar-item-selected' : 'hover:bg-white/[0.03] border border-transparent'"
            draggable="true"
            @dragstart="onDragStart($event, asset, 'watchlist')"
            @dragend="onDragEnd"
            @dragover="onDragOverItem($event, 'watchlist', index)"
            @click="selectAsset(asset)"
          >
            <div v-if="asset.image" class="w-7 h-7 rounded-lg overflow-hidden flex-shrink-0 bg-white/5 p-0.5">
              <img :src="asset.image" :alt="asset.ticker" class="w-full h-full object-contain rounded" />
            </div>
            <div v-else class="w-7 h-7 rounded-lg flex-shrink-0 bg-primary/10 flex items-center justify-center">
              <span class="text-primary text-[9px] font-bold">{{ asset.ticker?.slice(0, 2) }}</span>
            </div>
            <div class="flex-1 min-w-0">
              <div class="text-[13px] font-medium text-foreground truncate leading-tight">{{ asset.name }}</div>
              <div class="text-[10px] text-muted-foreground leading-tight">{{ asset.ticker }}</div>
            </div>
            <div class="text-right flex-shrink-0">
              <div class="text-[13px] font-medium text-foreground tabular-nums">{{ fmt(asset.price, asset.ticker) }}</div>
            </div>
            <button
              class="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity ml-0.5"
              @click="removeAsset($event, asset.id)" title="Eliminar"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>

          <div v-if="!watchlist.length" class="text-[11px] text-muted-foreground/40 text-center py-4">
            Arrastra activos aquí
          </div>
        </div>
      </div>

    </div>
  </aside>
</template>
