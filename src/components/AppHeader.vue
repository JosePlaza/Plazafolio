<script setup>
import { ref, onMounted, computed } from 'vue'

defineProps({
  activeTab: { type: String, default: 'analysis' },
  sidebarOpen: { type: Boolean, default: false },
})

const emit = defineEmits(['update:activeTab', 'toggle-sidebar'])

const tabs = [
  { id: 'analysis', label: 'Análisis' },
  { id: 'ranking', label: 'Ranking' },
]

const dbStats = ref(null)

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

const usedLabel = computed(() => dbStats.value ? formatBytes(dbStats.value.usedBytes) : '–')
const maxLabel = computed(() => dbStats.value ? formatBytes(dbStats.value.maxBytes) : '–')
const percent = computed(() => dbStats.value ? dbStats.value.percent : 0)

const barColor = computed(() => {
  if (percent.value > 85) return '#f87171'   // red
  if (percent.value > 60) return '#fbbf24'   // amber
  return '#34d399'                            // green
})

async function fetchStats() {
  try {
    const r = await fetch('http://localhost:3001/api/db-stats')
    if (r.ok) dbStats.value = await r.json()
  } catch { /* server offline */ }
}

onMounted(fetchStats)
</script>

<template>
  <header class="glass-header fixed top-0 left-0 right-0 z-40 h-14 flex items-center px-3 sm:px-5">
    <!-- Logo -->
    <div class="flex items-center gap-2 sm:gap-3">
      <img src="/plaza.svg" alt="Plazafolio" class="w-7 h-7 sm:w-8 sm:h-8" />
      <span class="text-foreground font-semibold text-sm tracking-wide hidden sm:inline">Plazafolio</span>
    </div>

    <!-- Nav tabs -->
    <nav class="flex items-center gap-1 ml-3 sm:ml-8">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        type="button"
        class="header-tab"
        :class="activeTab === tab.id ? 'header-tab-active' : ''"
        @click="emit('update:activeTab', tab.id)"
      >
        {{ tab.label }}
      </button>
    </nav>

    <!-- Spacer -->
    <div class="flex-1"></div>

    <!-- DB storage indicator (hidden on mobile) -->
    <div v-if="dbStats" class="hidden md:flex items-center gap-2.5" :title="`${usedLabel} / ${maxLabel}`">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="text-zinc-500 flex-shrink-0">
        <ellipse cx="12" cy="5" rx="9" ry="3" />
        <path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5" />
        <path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3" />
      </svg>
      <div class="relative" style="width: 56px; height: 5px; border-radius: 3px; background: rgba(255,255,255,0.06);">
        <div
          class="absolute inset-y-0 left-0 rounded-full transition-all duration-700"
          :style="{ width: Math.max(percent, 2) + '%', background: barColor }"
        ></div>
      </div>
      <span class="text-zinc-500 text-[10px] font-medium tabular-nums" style="min-width: 32px;">{{ percent }}%</span>
    </div>

    <!-- Sidebar toggle (mobile only, analysis tab only) -->
    <button
      v-if="activeTab === 'analysis'"
      class="lg:hidden gw-btn-icon w-9 h-9 ml-2"
      @click="emit('toggle-sidebar')"
      title="Portfolio"
    >
      <svg v-if="!sidebarOpen" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2" /><polyline points="7.5 3 7.5 16.5 12 13.5 16.5 16.5 16.5 3" /></svg>
      <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
    </button>
  </header>
</template>
