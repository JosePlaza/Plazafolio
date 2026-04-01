<script setup>
import { computed } from 'vue'

const props = defineProps({
  date: { type: String, default: '' },   // ISO date "2025-03-28" or year "2024"
  source: { type: String, default: '' },  // e.g. "Cotización", "Resultados", "FMP"
})

const formatted = computed(() => {
  if (!props.date) return ''
  const d = props.date
  // If it's just a year like "2024"
  if (/^\d{4}$/.test(d)) return d
  // Full date: format as "28 mar 2025"
  const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
  const parts = d.split('-')
  if (parts.length >= 3) {
    const day = parseInt(parts[2])
    const month = months[parseInt(parts[1]) - 1] || parts[1]
    const year = parts[0]
    return `${day} ${month} ${year}`
  }
  return d
})
</script>

<template>
  <div v-if="formatted" class="data-badge">
    <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="flex-shrink-0 opacity-40">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
    <span v-if="source" class="opacity-50">{{ source }}</span>
    <span>{{ formatted }}</span>
  </div>
</template>

<style scoped>
.data-badge {
  display: flex;
  align-items: center;
  gap: 4px;
  color: #52525b;
  font-size: 9px;
  font-weight: 500;
  letter-spacing: 0.01em;
  user-select: none;
  padding-top: 6px;
}
</style>
