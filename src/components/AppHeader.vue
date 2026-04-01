<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'

defineProps({
  activeTab: { type: String, default: 'analysis' },
  sidebarOpen: { type: Boolean, default: false },
})

const emit = defineEmits(['update:activeTab', 'toggle-sidebar', 'sign-out'])

const tabs = [
  { id: 'analysis', label: 'Análisis' },
  { id: 'ranking', label: 'Ranking' },
]

// ── User dropdown ──
const showUserMenu = ref(false)

function onDocClick(e) {
  if (showUserMenu.value && !e.target.closest('.user-menu-wrapper')) {
    showUserMenu.value = false
  }
}

onMounted(() => document.addEventListener('click', onDocClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))

function handleSignOut() {
  showUserMenu.value = false
  emit('sign-out')
}
</script>

<template>
  <header class="glass-header fixed top-0 left-0 right-0 z-40 flex items-end px-3 sm:px-5 pb-2">
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

    <!-- Sidebar toggle (mobile only, analysis tab only) -->
    <button
      v-if="activeTab === 'analysis'"
      class="gw-btn-icon w-9 h-9 lg:hidden!"
      @click="emit('toggle-sidebar')"
      title="Portfolio"
    >
      <svg v-if="!sidebarOpen" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2" /><polyline points="7.5 3 7.5 16.5 12 13.5 16.5 16.5 16.5 3" /></svg>
      <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
    </button>

    <!-- User menu -->
    <div class="relative user-menu-wrapper ml-2">
      <button
        class="flex items-center justify-center w-9 h-9 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-white/5 transition-colors"
        @click.stop="showUserMenu = !showUserMenu"
        title="Cuenta"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10" />
          <circle cx="12" cy="10" r="3" />
          <path d="M7 20.662V19a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.662" />
        </svg>
      </button>

      <!-- Dropdown -->
      <Transition name="dropdown-fade">
        <div
          v-if="showUserMenu"
          class="absolute right-0 top-full mt-2 z-50 w-44 rounded-xl overflow-hidden"
          style="background: rgba(14, 14, 22, 0.95); backdrop-filter: blur(20px); border: 1px solid rgba(255,255,255,0.08); box-shadow: 0 12px 40px rgba(0,0,0,0.5);"
        >
          <button
            class="flex items-center gap-2.5 w-full px-4 py-2.5 text-sm text-zinc-300 hover:bg-white/5 transition-colors"
            @click="handleSignOut"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            Cerrar sesión
          </button>
        </div>
      </Transition>
    </div>
  </header>
</template>

<style scoped>
.dropdown-fade-enter-active,
.dropdown-fade-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.dropdown-fade-enter-from,
.dropdown-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
