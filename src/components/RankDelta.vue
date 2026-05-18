<script setup>
defineProps({
  delta: { type: Object, required: true }, // { kind: 'up'|'down'|'same'|'new', value?: number }
})
</script>

<template>
  <span
    v-if="delta.kind === 'up'"
    class="inline-flex items-center gap-0.5 text-[9px] font-bold tabular-nums leading-none"
    style="color: #34d399;"
    title="Subió respecto a la última actualización"
  >
    <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"><path d="m5 15 7-7 7 7" /></svg>
    {{ delta.value }}
  </span>
  <span
    v-else-if="delta.kind === 'down'"
    class="inline-flex items-center gap-0.5 text-[9px] font-bold tabular-nums leading-none"
    style="color: #f87171;"
    title="Bajó respecto a la última actualización"
  >
    <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"><path d="m5 9 7 7 7-7" /></svg>
    {{ delta.value }}
  </span>
  <span
    v-else-if="delta.kind === 'same'"
    class="text-[9px] font-bold leading-none"
    style="color: #71717a;"
    title="Misma posición desde la última actualización"
  >=</span>
  <span
    v-else
    class="text-[8px] font-bold uppercase tracking-wider leading-none px-1 py-0.5 rounded"
    style="color: #415BFF; background: rgba(65,91,255,0.12);"
    title="Primera aparición en el ranking"
  >NEW</span>
</template>
