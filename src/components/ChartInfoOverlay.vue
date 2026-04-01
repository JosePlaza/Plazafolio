<script setup>
import { ref } from 'vue'

defineProps({
  description: { type: String, required: true },
})

const showInfo = ref(false)
</script>

<template>
  <div class="relative w-full h-full">
    <!-- Info toggle button -->
    <button
      class="absolute top-0 right-0 z-20 w-6 h-6 flex items-center justify-center rounded-full text-zinc-500 hover:text-zinc-300 hover:bg-white/5 transition-colors"
      @click.stop="showInfo = !showInfo"
    >
      <svg v-if="!showInfo" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 16v-4" />
        <path d="M12 8h.01" />
      </svg>
      <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M18 6 6 18" />
        <path d="m6 6 12 12" />
      </svg>
    </button>

    <!-- Info overlay — breaks out of parent p-4 to cover the full card -->
    <Transition name="info-fade">
      <div
        v-if="showInfo"
        class="absolute z-10 flex items-center justify-center"
        style="top: -16px; left: -16px; right: -16px; bottom: -16px; border-radius: 12px; background: rgba(14, 14, 22, 0.85); backdrop-filter: blur(14px);"
        @click.stop="showInfo = false"
      >
        <p class="text-zinc-300 text-sm leading-relaxed px-8 py-6 max-w-lg text-center">
          {{ description }}
        </p>
      </div>
    </Transition>

    <!-- Chart slot -->
    <slot />
  </div>
</template>

<style scoped>
.info-fade-enter-active,
.info-fade-leave-active {
  transition: opacity 0.2s ease;
}
.info-fade-enter-from,
.info-fade-leave-to {
  opacity: 0;
}
</style>
