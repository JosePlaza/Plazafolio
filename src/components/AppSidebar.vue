<script setup>
import { ref, watch } from 'vue'
import { useCurrency } from '@/composables/useCurrency'

const { symbolFor, convertByTicker } = useCurrency()

const props = defineProps({
  actives: { type: Array, default: () => [] },
  watchlist: { type: Array, default: () => [] },
  selectedId: { type: String, default: null },
  open: { type: Boolean, default: false },
})

const emit = defineEmits(['select', 'add', 'move', 'remove', 'reorder', 'close'])

// ── Collapse state ──
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

// ── Drag & Drop ──
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
  e.stopPropagation()
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

  const item = dragItem.value
  const source = dragSource.value
  const idx = dropIndex.value

  let newActives = [...props.actives]
  let newWatchlist = [...props.watchlist]

  // Remove from source list
  if (source === 'actives') {
    newActives = newActives.filter(a => a.id !== item.id)
  } else {
    newWatchlist = newWatchlist.filter(a => a.id !== item.id)
  }

  // Update category on the item if moving between groups
  const movedItem = source !== targetCategory
    ? { ...item, category: targetCategory }
    : item

  // Insert at drop position in target list
  const targetList = targetCategory === 'actives' ? newActives : newWatchlist
  // Clamp index to valid range
  const insertIdx = Math.max(0, Math.min(idx, targetList.length))
  targetList.splice(insertIdx, 0, movedItem)

  if (targetCategory === 'actives') {
    newActives = targetList
  } else {
    newWatchlist = targetList
  }

  emit('reorder', newActives, newWatchlist)

  dragOverCategory.value = null
  dropIndex.value = -1
  dragItem.value = null
  dragSource.value = null
}

function selectAsset(asset) {
  if (swipedId.value === asset.id) {
    swipedId.value = null
    return
  }
  emit('select', asset)
  emit('close')
}

// ── Delete confirmation ──
const confirmDelete = ref(null)

function requestDelete(e, asset) {
  e.stopPropagation()
  swipedId.value = null
  confirmDelete.value = { id: asset.id, name: asset.name, ticker: asset.ticker }
}

function doDelete() {
  if (confirmDelete.value) {
    emit('remove', confirmDelete.value.id)
    confirmDelete.value = null
  }
}

// ── Swipe to reveal delete (mobile) ──
const swipedId = ref(null)
let touchStartX = 0
let touchStartY = 0
let swiping = false

function onTouchStart(e, assetId) {
  touchStartX = e.touches[0].clientX
  touchStartY = e.touches[0].clientY
  swiping = false
}

function onTouchMove(e, assetId) {
  const dx = e.touches[0].clientX - touchStartX
  const dy = e.touches[0].clientY - touchStartY

  if (!swiping && Math.abs(dy) > Math.abs(dx)) return
  if (Math.abs(dx) > 10) {
    swiping = true
    e.preventDefault()
  }
}

function onTouchEnd(e, assetId) {
  if (!swiping) return
  const dx = e.changedTouches[0].clientX - touchStartX

  if (swipedId.value === assetId) {
    if (dx > 30) swipedId.value = null
  } else {
    if (dx < -40) swipedId.value = assetId
  }
}

function fmt(value, ticker) {
  if (value == null || isNaN(value) || value === 0) return '-'
  return symbolFor(ticker) + convertByTicker(Number(value), ticker).toFixed(2)
}

function getIndicatorTop(list, idx) { return idx * 44 + 'px' }
</script>

<template>
  <!-- Mobile backdrop -->
  <Transition name="sidebar-backdrop">
    <div
      v-if="open"
      class="fixed inset-0 z-[45] bg-black/50 backdrop-blur-sm lg:hidden"
      @click="emit('close')"
    />
  </Transition>

  <aside
    class="glass-sidebar w-72 fixed right-0 bottom-0 z-[45] flex flex-col transition-transform duration-300 lg:translate-x-0"
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
            dragOverCategory === 'actives' && dragItem ? 'drag-over' : '',
            activesOpen ? 'max-h-[2000px] mt-1' : 'max-h-0'
          ]"
          @dragover="onDragOverZone($event, 'actives')"
          @dragleave="onDragLeave($event, 'actives')"
          @drop="onDrop($event, 'actives')"
        >
          <div
            v-if="dragOverCategory === 'actives' && dropIndex >= 0 && dragItem"
            class="drop-indicator" :style="{ top: getIndicatorTop(actives, dropIndex) }"
          />

          <div
            v-for="(asset, index) in actives" :key="asset.id"
            class="swipe-row"
          >
            <div
              class="sidebar-item group flex items-center gap-2.5 px-2.5 py-2 rounded-xl cursor-pointer swipe-item"
              :class="[
                selectedId === asset.id ? 'sidebar-item-selected' : 'hover:bg-white/[0.03] border border-transparent',
                swipedId === asset.id ? 'swiped' : ''
              ]"
              draggable="true"
              @dragstart="onDragStart($event, asset, 'actives')"
              @dragend="onDragEnd"
              @dragover="onDragOverItem($event, 'actives', index)"
              @click="selectAsset(asset)"
              @touchstart.passive="onTouchStart($event, asset.id)"
              @touchmove="onTouchMove($event, asset.id)"
              @touchend="onTouchEnd($event, asset.id)"
            >
              <div v-if="asset.image" class="w-7 h-7 rounded-lg overflow-hidden shrink-0 bg-white/5 p-0.5">
                <img :src="asset.image" :alt="asset.ticker" class="w-full h-full object-contain rounded" />
              </div>
              <div v-else class="w-7 h-7 rounded-lg shrink-0 bg-primary/10 flex items-center justify-center">
                <span class="text-primary text-[9px] font-bold">{{ asset.ticker?.slice(0, 2) }}</span>
              </div>
              <div class="flex-1 min-w-0">
                <div class="text-[13px] font-medium text-foreground truncate leading-tight">{{ asset.name }}</div>
                <div class="text-[10px] text-muted-foreground leading-tight">{{ asset.ticker }}</div>
              </div>
              <div class="text-right shrink-0">
                <div class="text-[13px] font-medium text-foreground tabular-nums">{{ fmt(asset.price, asset.ticker) }}</div>
              </div>
              <!-- Desktop delete (hover) -->
              <button
                class="hidden lg:block opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity ml-0.5"
                @click="requestDelete($event, asset)" title="Eliminar"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>
            <!-- Mobile delete button outside item -->
            <button
              class="lg:hidden swipe-delete-btn gw-btn-icon"
              :class="swipedId === asset.id ? 'visible' : ''"
              @click="requestDelete($event, asset)"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
              </svg>
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
            dragOverCategory === 'watchlist' && dragItem ? 'drag-over' : '',
            watchlistOpen ? 'max-h-[2000px] mt-1' : 'max-h-0'
          ]"
          @dragover="onDragOverZone($event, 'watchlist')"
          @dragleave="onDragLeave($event, 'watchlist')"
          @drop="onDrop($event, 'watchlist')"
        >
          <div
            v-if="dragOverCategory === 'watchlist' && dropIndex >= 0 && dragItem"
            class="drop-indicator" :style="{ top: getIndicatorTop(watchlist, dropIndex) }"
          />

          <div
            v-for="(asset, index) in watchlist" :key="asset.id"
            class="swipe-row"
          >
            <div
              class="sidebar-item group flex items-center gap-2.5 px-2.5 py-2 rounded-xl cursor-pointer swipe-item"
              :class="[
                selectedId === asset.id ? 'sidebar-item-selected' : 'hover:bg-white/[0.03] border border-transparent',
                swipedId === asset.id ? 'swiped' : ''
              ]"
              draggable="true"
              @dragstart="onDragStart($event, asset, 'watchlist')"
              @dragend="onDragEnd"
              @dragover="onDragOverItem($event, 'watchlist', index)"
              @click="selectAsset(asset)"
              @touchstart.passive="onTouchStart($event, asset.id)"
              @touchmove="onTouchMove($event, asset.id)"
              @touchend="onTouchEnd($event, asset.id)"
            >
              <div v-if="asset.image" class="w-7 h-7 rounded-lg overflow-hidden shrink-0 bg-white/5 p-0.5">
                <img :src="asset.image" :alt="asset.ticker" class="w-full h-full object-contain rounded" />
              </div>
              <div v-else class="w-7 h-7 rounded-lg shrink-0 bg-primary/10 flex items-center justify-center">
                <span class="text-primary text-[9px] font-bold">{{ asset.ticker?.slice(0, 2) }}</span>
              </div>
              <div class="flex-1 min-w-0">
                <div class="text-[13px] font-medium text-foreground truncate leading-tight">{{ asset.name }}</div>
                <div class="text-[10px] text-muted-foreground leading-tight">{{ asset.ticker }}</div>
              </div>
              <div class="text-right shrink-0">
                <div class="text-[13px] font-medium text-foreground tabular-nums">{{ fmt(asset.price, asset.ticker) }}</div>
              </div>
              <!-- Desktop delete (hover) -->
              <button
                class="hidden lg:block opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity ml-0.5"
                @click="requestDelete($event, asset)" title="Eliminar"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>
            <!-- Mobile delete button outside item -->
            <button
              class="lg:hidden swipe-delete-btn gw-btn-icon"
              :class="swipedId === asset.id ? 'visible' : ''"
              @click="requestDelete($event, asset)"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
              </svg>
            </button>
          </div>

          <div v-if="!watchlist.length" class="text-[11px] text-muted-foreground/40 text-center py-4">
            Arrastra activos aquí
          </div>
        </div>
      </div>

    </div>
  </aside>

  <!-- Delete confirmation modal -->
  <Teleport to="body">
    <Transition name="confirm-fade">
      <div
        v-if="confirmDelete"
        class="fixed inset-0 z-[60] flex items-center justify-center"
        @click.self="confirmDelete = null"
      >
        <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" />
        <div class="relative z-10 w-72 rounded-2xl p-5" style="background: rgba(14, 14, 22, 0.95); border: 1px solid rgba(255,255,255,0.08);">
          <div class="flex flex-col items-center text-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-destructive/10 flex items-center justify-center">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
              </svg>
            </div>
            <div>
              <p class="text-sm font-semibold text-foreground">Eliminar activo</p>
              <p class="text-xs text-muted-foreground mt-1">
                {{ confirmDelete.name }} ({{ confirmDelete.ticker }}) se eliminará del portfolio.
              </p>
            </div>
            <div class="flex gap-2 w-full mt-1">
              <button
                class="flex-1 h-9 rounded-xl text-sm font-medium text-muted-foreground border border-white/8 hover:bg-white/5 transition-colors"
                @click="confirmDelete = null"
              >
                Cancelar
              </button>
              <button
                class="flex-1 h-9 rounded-xl text-sm font-medium text-white bg-destructive/80 hover:bg-destructive transition-colors"
                @click="doDelete"
              >
                Eliminar
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* Row: item + delete button side by side */
.swipe-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

/* Item shrinks when swiped to make room for button */
.swipe-item {
  flex: 1;
  min-width: 0;
  transition: flex 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}
.swipe-item.swiped {
  flex: 1 1 0;
}

/* Delete button: collapsed by default, expands when visible */
.swipe-delete-btn {
  width: 0;
  min-width: 0;
  padding: 0;
  opacity: 0;
  overflow: hidden;
  border: none;
  flex-shrink: 0;
  transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1),
              opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1),
              min-width 0.3s cubic-bezier(0.4, 0, 0.2, 1),
              padding 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  color: #f87171;
  background: rgba(248, 113, 113, 0.12);
  border-radius: 10px;
}
.swipe-delete-btn.visible {
  width: 36px;
  min-width: 36px;
  height: 36px;
  opacity: 1;
  border: 1px solid rgba(248, 113, 113, 0.2);
}
.swipe-delete-btn.visible:active {
  background: rgba(248, 113, 113, 0.25);
}

.confirm-fade-enter-active,
.confirm-fade-leave-active {
  transition: opacity 0.2s ease;
}
.confirm-fade-enter-from,
.confirm-fade-leave-to {
  opacity: 0;
}
</style>
