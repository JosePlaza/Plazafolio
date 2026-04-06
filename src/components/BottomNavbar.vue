<script setup>
const props = defineProps({
  activeTab: { type: String, default: 'analysis' },
})

const emit = defineEmits(['update:activeTab'])

const tabs = [
  {
    id: 'analysis',
    label: 'Análisis',
    // Lucide: chart-no-axes-column
    icon: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" x2="18" y1="20" y2="10"/><line x1="12" x2="12" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="14"/></svg>`,
  },
  {
    id: 'ranking',
    label: 'Ranking',
    // Lucide: arrow-up-down
    icon: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21 16-4 4-4-4"/><path d="M17 20V4"/><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/></svg>`,
  },
  {
    id: 'portfolio',
    label: 'Portfolio',
    // Lucide: chart-pie
    icon: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12c.552 0 1.005-.449.95-.998a10 10 0 0 0-8.953-8.951c-.55-.055-.998.398-.998.949v8a1 1 0 0 0 1 1z"/><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/></svg>`,
  },
  {
    id: 'dividends',
    label: 'Dividendos',
    // Lucide: piggy-bank
    icon: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 5c-1.5 0-2.8 1.4-3 2-3.5-1.5-11-.3-11 5 0 1.8 0 3 2 4.5V20h4v-2h3v2h4v-4c1-.5 1.7-1 2-2h2v-4h-2c0-1-.5-1.5-1-2"/><path d="M2 9.1C1.7 8.4 1 7.5 1 7c0-1.1.9-2 2-2s2 .9 2 2c0 .5-.3 1-1 2"/><path d="M16 11h.01"/></svg>`,
  },
]
</script>

<template>
  <nav class="bottom-navbar">
    <button
      v-for="tab in tabs"
      :key="tab.id"
      class="bottom-nav-item"
      :class="{ active: activeTab === tab.id }"
      @click="emit('update:activeTab', tab.id)"
    >
      <span class="bottom-nav-icon" v-html="tab.icon"></span>
      <Transition name="label-slide">
        <span v-if="activeTab === tab.id" class="bottom-nav-label">{{ tab.label }}</span>
      </Transition>
    </button>
  </nav>
</template>

<style scoped>
.bottom-navbar {
  position: fixed;
  bottom: calc(10px + env(safe-area-inset-bottom, 0px));
  left: 16px;
  right: 16px;
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: space-around;
  height: 64px;
  border-radius: 22px;
  background: rgba(14, 14, 22, 0.65);
  backdrop-filter: blur(24px) saturate(1.5);
  -webkit-backdrop-filter: blur(24px) saturate(1.5);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4), 0 0 0 0.5px rgba(255, 255, 255, 0.04) inset;
}

@media (min-width: 1024px) {
  .bottom-navbar {
    display: none;
  }
}

.bottom-nav-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  flex: 1;
  height: 100%;
  padding: 8px 0;
  color: #52525b;
  background: transparent;
  border: none;
  cursor: pointer;
  transition: color 0.25s ease;
  -webkit-tap-highlight-color: transparent;
  position: relative;
}

.bottom-nav-item.active {
  color: #415BFF;
}

.bottom-nav-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 10px;
  transition: background 0.25s ease, transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.bottom-nav-item.active .bottom-nav-icon {
  background: rgba(65, 91, 255, 0.12);
  transform: translateY(-1px);
}

.bottom-nav-label {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.02em;
  line-height: 1;
}

/* ── Label transition ── */
.label-slide-enter-active {
  transition: opacity 0.25s ease, transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1), max-height 0.25s ease;
}
.label-slide-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease, max-height 0.15s ease;
}
.label-slide-enter-from {
  opacity: 0;
  transform: translateY(4px) scale(0.8);
  max-height: 0;
}
.label-slide-enter-to {
  opacity: 1;
  transform: translateY(0) scale(1);
  max-height: 14px;
}
.label-slide-leave-from {
  opacity: 1;
  transform: translateY(0) scale(1);
  max-height: 14px;
}
.label-slide-leave-to {
  opacity: 0;
  transform: translateY(2px) scale(0.8);
  max-height: 0;
}
</style>
