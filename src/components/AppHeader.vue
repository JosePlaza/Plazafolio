<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useCurrency } from '@/composables/useCurrency'
import { useSecAlerts } from '@/composables/useSecAlerts'
import { useGeraldineAlerts } from '@/composables/useGeraldineAlerts'

const props = defineProps({
  activeTab: { type: String, default: 'analysis' },
  sidebarOpen: { type: Boolean, default: false },
  actives: { type: Array, default: () => [] },
})

const emit = defineEmits(['update:activeTab', 'toggle-sidebar', 'sign-out', 'open-settings'])

const { forcedCurrency, setForcedCurrency } = useCurrency()
const { alerts, checkForNewReports, dismissAlerts, dismissAlert, requestNotificationPermission } = useSecAlerts()
const {
  alerts: geraldineAlerts,
  checkGeraldineZones,
  dismissAlert: dismissGeraldineAlert,
  dismissAllAlerts: dismissAllGeraldineAlerts,
  startPeriodicCheck,
} = useGeraldineAlerts()

const showGeraldinePanel = ref(false)

const totalAlertCount = computed(() => alerts.value.length + geraldineAlerts.value.length)

onMounted(async () => {
  checkForNewReports()
  requestNotificationPermission()
  // Start Geraldine zone checking (deferred to not block mount)
  try {
    if (props.actives.length) {
      startPeriodicCheck(props.actives)
    }
  } catch (e) {
    console.warn('[GeraldineAlerts] Init error:', e)
  }
})

// Re-check when actives change
watch(() => props.actives, (val) => {
  if (val.length) checkGeraldineZones(val)
}, { deep: true })

const tabs = [
  { id: 'analysis', label: 'Análisis' },
  { id: 'ranking', label: 'Ranking' },
  { id: 'portfolio', label: 'Portfolio' },
  { id: 'dividends', label: 'Dividendos' },
]

function onCurrencyToggle() {
  if (forcedCurrency.value === 'EUR') setForcedCurrency('USD')
  else setForcedCurrency('EUR')
}

// ── User dropdown ──
const showUserMenu = ref(false)
const showAlertsPanel = ref(false)

function onDocClick(e) {
  if (!e.target.closest('.user-menu-wrapper')) {
    showUserMenu.value = false
    showAlertsPanel.value = false
    showGeraldinePanel.value = false
  }
}

onMounted(() => document.addEventListener('click', onDocClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))

function toggleUserMenu() {
  showUserMenu.value = !showUserMenu.value
  showAlertsPanel.value = false
  showGeraldinePanel.value = false
}

function handleSignOut() {
  showUserMenu.value = false
  emit('sign-out')
}

function handleSettings() {
  showUserMenu.value = false
  emit('open-settings')
}

function toggleAlertsPanel() {
  showAlertsPanel.value = !showAlertsPanel.value
}

function onDismissAlerts() {
  dismissAlerts()
  showAlertsPanel.value = false
}

function onAlertClick(alert) {
  dismissAlert(alert.ticker, alert.reportType)
  showUserMenu.value = false
  showAlertsPanel.value = false
  emit('update:activeTab', 'portfolio')
}
</script>

<template>
  <header class="glass-header fixed top-0 left-0 right-0 z-40 flex items-end px-3 sm:px-5 pb-2">
    <!-- Logo -->
    <div class="flex items-center gap-2 sm:gap-3">
      <img src="/plazafolio.svg" alt="Plazafolio" class="w-7 h-7 sm:w-8 sm:h-8" />
      <span class="text-foreground font-semibold text-sm tracking-wide hidden sm:inline">Plazafolio</span>
    </div>

    <!-- Nav tabs — scrollable on mobile -->
    <nav class="header-tabs-nav flex items-center gap-0.5 sm:gap-1 ml-2 sm:ml-8 overflow-x-auto scrollbar-hide">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        type="button"
        class="header-tab whitespace-nowrap"
        :class="activeTab === tab.id ? 'header-tab-active' : ''"
        @click="emit('update:activeTab', tab.id)"
      >
        {{ tab.label }}
      </button>
    </nav>

    <!-- Spacer -->
    <div class="flex-1 min-w-0"></div>

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

    <!-- User menu (with alert badge) -->
    <div class="relative user-menu-wrapper ml-2">
      <button
        class="flex items-center justify-center w-9 h-9 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-white/5 transition-colors"
        @click.stop="toggleUserMenu"
        title="Cuenta"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10" />
          <circle cx="12" cy="10" r="3" />
          <path d="M7 20.662V19a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.662" />
        </svg>
        <!-- Alert badge on user icon -->
        <span
          v-if="totalAlertCount"
          class="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-amber-500 text-[9px] font-bold text-black flex items-center justify-center ring-2 ring-[#08080d]"
        >{{ totalAlertCount > 9 ? '9+' : totalAlertCount }}</span>
      </button>

      <!-- Dropdown -->
      <Transition name="dropdown-fade">
        <div
          v-if="showUserMenu"
          class="absolute right-0 top-full mt-2 z-50 w-[calc(100vw-1.5rem)] sm:w-72 max-w-[288px] rounded-xl overflow-hidden"
          style="background: rgba(14, 14, 22, 0.95); backdrop-filter: blur(20px); border: 1px solid rgba(255,255,255,0.08); box-shadow: 0 12px 40px rgba(0,0,0,0.5);"
        >
          <!-- Alerts item (expandable) — always visible -->
          <button
            class="flex items-center gap-2.5 w-full px-4 py-2.5 text-sm transition-colors"
            :class="alerts.length
              ? (showAlertsPanel ? 'text-amber-400 bg-amber-500/5' : 'text-amber-400/80 hover:bg-white/5')
              : 'text-zinc-500 hover:bg-white/5 cursor-default'"
            @click.stop="alerts.length ? toggleAlertsPanel() : null"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
              <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
            </svg>
            <span class="flex-1 text-left">{{ alerts.length ? 'Informes nuevos' : 'Informes SEC' }}</span>
            <span v-if="alerts.length" class="w-5 h-5 rounded-full bg-amber-500/20 text-amber-400 text-[10px] font-bold flex items-center justify-center">{{ alerts.length }}</span>
            <span v-else class="text-[10px] text-zinc-500">Sin novedades</span>
            <svg v-if="alerts.length" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
              class="transition-transform" :class="showAlertsPanel ? 'rotate-90' : ''">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>

          <!-- Alerts expanded panel -->
          <Transition name="alerts-expand">
            <div v-if="showAlertsPanel && alerts.length">
              <div style="border-top: 1px solid rgba(255,255,255,0.06);"></div>
              <div class="max-h-52 overflow-y-auto">
                <div
                  v-for="a in alerts"
                  :key="`${a.ticker}_${a.reportType}_${a.period}`"
                  class="flex items-center gap-2.5 px-4 py-2 hover:bg-white/5 cursor-pointer transition-colors"
                  @click="onAlertClick(a)"
                >
                  <div class="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0"></div>
                  <div class="flex-1 min-w-0">
                    <div class="text-[12px] font-medium text-foreground">{{ a.ticker }} · {{ a.reportType }}</div>
                    <div class="text-[10px] text-zinc-500">{{ a.period }} · {{ a.filedDate }}</div>
                  </div>
                </div>
              </div>
              <div style="border-top: 1px solid rgba(255,255,255,0.06);"></div>
              <button
                class="w-full px-4 py-2 text-[11px] text-zinc-500 hover:text-zinc-300 hover:bg-white/5 transition-colors text-center"
                @click.stop="onDismissAlerts"
              >Marcar todos como leídos</button>
            </div>
          </Transition>

          <div style="border-top: 1px solid rgba(255,255,255,0.06);"></div>

          <!-- Geraldine Zone Alerts — always visible -->
          <button
            class="flex items-center gap-2.5 w-full px-4 py-2.5 text-sm transition-colors"
            :class="geraldineAlerts.length
              ? (showGeraldinePanel ? 'text-emerald-400 bg-emerald-500/5' : 'text-emerald-400/80 hover:bg-white/5')
              : 'text-zinc-500 hover:bg-white/5 cursor-default'"
            @click.stop="geraldineAlerts.length ? (showGeraldinePanel = !showGeraldinePanel) : null"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
            <span class="flex-1 text-left">Zona Geraldine</span>
            <span v-if="geraldineAlerts.length" class="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 text-[10px] font-bold flex items-center justify-center">{{ geraldineAlerts.length }}</span>
            <span v-else class="text-[10px] text-zinc-500">Sin alertas</span>
            <svg v-if="geraldineAlerts.length" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
              class="transition-transform" :class="showGeraldinePanel ? 'rotate-90' : ''">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>

          <!-- Geraldine expanded panel -->
          <Transition name="alerts-expand">
            <div v-if="showGeraldinePanel && geraldineAlerts.length">
              <div style="border-top: 1px solid rgba(255,255,255,0.06);"></div>
              <div class="max-h-52 overflow-y-auto">
                <div
                  v-for="a in geraldineAlerts"
                  :key="`${a.ticker}_geraldine`"
                  class="flex items-center gap-2.5 px-4 py-2 hover:bg-white/5 cursor-pointer transition-colors"
                  @click="dismissGeraldineAlert(a.ticker, a.signal); emit('update:activeTab', 'analysis')"
                >
                  <div
                    class="w-1.5 h-1.5 rounded-full shrink-0"
                    :style="{ background: a.inBuyZone ? '#34d399' : '#fbbf24' }"
                  ></div>
                  <div class="flex-1 min-w-0">
                    <div class="text-[12px] font-medium text-foreground">{{ a.ticker }}</div>
                    <div class="text-[10px]" :style="{ color: a.inBuyZone ? '#34d399' : '#fbbf24' }">
                      {{ a.signal }} · Yield {{ a.currentYield }}%
                    </div>
                  </div>
                </div>
              </div>
              <div style="border-top: 1px solid rgba(255,255,255,0.06);"></div>
              <button
                class="w-full px-4 py-2 text-[11px] text-zinc-500 hover:text-zinc-300 hover:bg-white/5 transition-colors text-center"
                @click.stop="dismissAllGeraldineAlerts(); showGeraldinePanel = false"
              >Descartar todas</button>
            </div>
          </Transition>

          <div style="border-top: 1px solid rgba(255,255,255,0.06);"></div>

          <!-- Currency toggle -->
          <div class="flex items-center justify-between px-4 py-2.5">
            <div class="flex items-center gap-2.5">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-zinc-300">
                <circle cx="12" cy="12" r="10" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
              <span class="text-sm text-zinc-300">Divisa</span>
            </div>
            <button
              class="relative flex items-center w-[72px] h-8 rounded-full transition-colors"
              style="background: rgba(255,255,255,0.06);"
              @click.stop="onCurrencyToggle"
            >
              <span
                class="relative z-10 flex-1 text-center text-[11px] font-bold transition-colors"
                :style="{ color: forcedCurrency !== 'EUR' ? '#e4e4e7' : '#52525b' }"
              >USD</span>
              <span
                class="relative z-10 flex-1 text-center text-[11px] font-bold transition-colors"
                :style="{ color: forcedCurrency === 'EUR' ? '#e4e4e7' : '#52525b' }"
              >EUR</span>
              <span
                class="absolute top-1 h-6 w-[34px] rounded-full transition-all duration-200"
                style="background: rgba(65,91,255,0.4);"
                :style="{ left: forcedCurrency === 'EUR' ? '35px' : '3px' }"
              ></span>
            </button>
          </div>

          <div style="border-top: 1px solid rgba(255,255,255,0.06);"></div>

          <!-- Settings -->
          <button
            class="flex items-center gap-2.5 w-full px-4 py-2.5 text-sm text-zinc-300 hover:bg-white/5 transition-colors"
            @click="handleSettings"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            Ajustes
          </button>

          <div style="border-top: 1px solid rgba(255,255,255,0.06);"></div>

          <!-- Sign out -->
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
.alerts-expand-enter-active,
.alerts-expand-leave-active {
  transition: all 0.2s ease;
  overflow: hidden;
}
.alerts-expand-enter-from,
.alerts-expand-leave-to {
  max-height: 0;
  opacity: 0;
}
.alerts-expand-enter-to,
.alerts-expand-leave-from {
  max-height: 300px;
  opacity: 1;
}
</style>
