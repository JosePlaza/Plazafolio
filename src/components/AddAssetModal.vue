<script setup>
import { ref } from 'vue'
import axios from 'axios'

const emit = defineEmits(['close', 'add'])

const query = ref('')
const category = ref('watchlist')
const results = ref([])
const searching = ref(false)
const highlightIndex = ref(-1)
const pickedTicker = ref('')
const pickedName = ref('')
const showCategoryDropdown = ref(false)

const categories = [
  { value: 'actives', label: 'Actives' },
  { value: 'watchlist', label: 'Watchlist' },
]

let debounceTimer = null

function doSearch(val) {
  if (debounceTimer) clearTimeout(debounceTimer)
  if (!val || val.length < 1) { results.value = []; return }
  debounceTimer = setTimeout(async () => {
    searching.value = true
    try {
      const { data } = await axios.get('/api/search', { params: { q: val } })
      results.value = data || []
    } catch { results.value = [] }
    finally { searching.value = false }
  }, 250)
}

function onInput() {
  pickedTicker.value = ''
  pickedName.value = ''
  highlightIndex.value = -1
  doSearch(query.value)
}

function selectResult(r) {
  pickedTicker.value = r.symbol
  pickedName.value = r.name
  query.value = `${r.symbol} — ${r.name}`
  results.value = []
  highlightIndex.value = -1
}

function selectCategory(val) {
  category.value = val
  showCategoryDropdown.value = false
}

function onKeydown(e) {
  if (!results.value.length) return
  if (e.key === 'ArrowDown') { e.preventDefault(); highlightIndex.value = Math.min(highlightIndex.value + 1, results.value.length - 1) }
  else if (e.key === 'ArrowUp') { e.preventDefault(); highlightIndex.value = Math.max(highlightIndex.value - 1, 0) }
  else if (e.key === 'Enter' && highlightIndex.value >= 0) { e.preventDefault(); selectResult(results.value[highlightIndex.value]) }
}

function onSubmit() {
  const ticker = pickedTicker.value || query.value.trim().toUpperCase()
  if (ticker) {
    emit('add', { ticker, category: category.value })
    query.value = ''; pickedTicker.value = ''; pickedName.value = ''
  }
}

function onOverlayClick(e) {
  if (e.target === e.currentTarget) emit('close')
}

const categoryLabel = () => categories.find(c => c.value === category.value)?.label || 'Watchlist'
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center" @click="onOverlayClick">
    <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" />

    <div class="glass-card relative z-10 w-full max-w-lg mx-3 sm:mx-auto p-4 sm:p-6">
      <h3 class="text-lg font-semibold text-foreground mb-5">Añadir Activo</h3>

      <form @submit.prevent="onSubmit" class="space-y-5">
        <!-- Search + Category inline (stacked on mobile) -->
        <div class="flex flex-col sm:flex-row gap-3 sm:gap-2 sm:items-end">
          <!-- Search input -->
          <div class="relative flex-1">
            <label class="block text-[11px] text-muted-foreground mb-1.5 uppercase tracking-wider">Ticker</label>
            <input
              v-model="query"
              type="text"
              placeholder="Buscar empresa o ticker..."
              class="gw-input w-full h-10 text-sm"
              autofocus
              @input="onInput"
              @keydown="onKeydown"
            />

            <!-- Selected indicator -->
            <div v-if="pickedTicker" class="absolute right-3 top-[34px] flex items-center gap-1.5">
              <span class="text-[11px] text-primary font-medium">{{ pickedTicker }}</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2.5" stroke-linecap="round"><path d="M20 6 9 17l-5-5" /></svg>
            </div>

            <!-- Autocomplete dropdown -->
            <div
              v-if="results.length > 0 && !pickedTicker"
              class="absolute left-0 right-0 top-full mt-1 rounded-xl overflow-hidden z-20 max-h-[280px] overflow-y-auto"
              style="background: rgba(14, 14, 20, 0.95); backdrop-filter: blur(20px); border: 1px solid rgba(65, 91, 255, 0.15);"
            >
              <div
                v-for="(r, i) in results" :key="r.symbol"
                class="flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors"
                :class="i === highlightIndex ? 'bg-primary/15' : 'hover:bg-white/[0.04]'"
                @click="selectResult(r)" @mouseenter="highlightIndex = i"
              >
                <div class="flex-1 min-w-0">
                  <div class="text-sm font-medium text-foreground truncate">{{ r.name }}</div>
                  <div class="text-[11px] text-muted-foreground">{{ r.symbol }} &middot; {{ r.exchange }}</div>
                </div>
                <span class="text-[10px] text-muted-foreground/60 uppercase">{{ r.type }}</span>
              </div>
            </div>

            <!-- Searching indicator -->
            <div v-if="searching && !pickedTicker" class="absolute right-3 top-[36px]">
              <div class="spinner" style="width: 16px; height: 16px; border-width: 1.5px;" />
            </div>
          </div>

          <!-- Custom category select -->
          <div class="relative" style="min-width: 130px;">
            <label class="block text-[11px] text-muted-foreground mb-1.5 uppercase tracking-wider">Categoría</label>
            <button
              type="button"
              class="gw-input w-full h-10 text-sm text-left flex items-center justify-between gap-2"
              @click="showCategoryDropdown = !showCategoryDropdown"
              @blur="setTimeout(() => showCategoryDropdown = false, 150)"
            >
              <span>{{ categoryLabel() }}</span>
              <svg
                width="14" height="14" viewBox="0 0 24 24" fill="none"
                stroke="#71717a" stroke-width="2" stroke-linecap="round"
                class="transition-transform" :class="showCategoryDropdown ? 'rotate-180' : ''"
              ><path d="m6 9 6 6 6-6" /></svg>
            </button>

            <!-- Dropdown -->
            <div
              v-if="showCategoryDropdown"
              class="absolute left-0 right-0 top-full mt-1 rounded-xl overflow-hidden z-20"
              style="background: rgba(14, 14, 20, 0.95); backdrop-filter: blur(20px); border: 1px solid rgba(65, 91, 255, 0.15);"
            >
              <div
                v-for="c in categories" :key="c.value"
                class="px-4 py-2.5 text-sm cursor-pointer transition-colors"
                :class="category === c.value ? 'text-primary bg-primary/10' : 'text-foreground hover:bg-white/[0.04]'"
                @mousedown.prevent="selectCategory(c.value)"
              >
                {{ c.label }}
              </div>
            </div>
          </div>
        </div>

        <!-- Actions -->
        <div class="flex gap-2 pt-1">
          <button type="button" class="flex-1 gw-input text-center text-sm cursor-pointer hover:bg-white/5 h-10" @click="$emit('close')">
            Cancelar
          </button>
          <button type="submit" class="flex-1 gw-btn h-10 text-sm" :disabled="!query.trim()">
            Añadir
          </button>
        </div>
      </form>
    </div>
  </div>
</template>
