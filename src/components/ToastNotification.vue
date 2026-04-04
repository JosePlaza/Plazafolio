<script setup>
import { ref, watch } from 'vue'

const props = defineProps({
  message: { type: String, default: '' },
  type: { type: String, default: 'success' }, // success | error | info
  duration: { type: Number, default: 3000 },
  visible: { type: Boolean, default: false },
})

const emit = defineEmits(['close'])

let timer = null

watch(() => props.visible, (val) => {
  if (val) {
    clearTimeout(timer)
    timer = setTimeout(() => emit('close'), props.duration)
  }
})

const iconMap = {
  success: { path: 'M20 6L9 17l-5-5', color: '#34d399' },
  error: { path: 'M18 6L6 18M6 6l12 12', color: '#f87171' },
  info: { path: 'M12 16v-4M12 8h.01', color: '#60a5fa' },
}
</script>

<template>
  <Transition name="toast">
    <div
      v-if="visible"
      class="fixed bottom-6 right-6 z-[9999] flex items-center gap-3 px-4 py-3 rounded-xl shadow-2xl max-w-sm"
      style="
        background: rgba(14, 14, 22, 0.92);
        backdrop-filter: blur(20px);
        border: 1px solid rgba(255,255,255,0.08);
      "
      role="alert"
    >
      <span
        class="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
        :style="{ background: iconMap[type].color + '18' }"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" :stroke="iconMap[type].color" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path :d="iconMap[type].path" />
        </svg>
      </span>
      <span class="text-sm text-zinc-200 leading-snug">{{ message }}</span>
      <button
        class="ml-auto text-zinc-500 hover:text-zinc-300 transition-colors shrink-0"
        @click="emit('close')"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  </Transition>
</template>

<style scoped>
.toast-enter-active {
  transition: all 0.35s cubic-bezier(0.16, 1, 0.3, 1);
}
.toast-leave-active {
  transition: all 0.2s ease-in;
}
.toast-enter-from {
  opacity: 0;
  transform: translateY(16px) scale(0.96);
}
.toast-leave-to {
  opacity: 0;
  transform: translateY(8px) scale(0.98);
}
</style>
