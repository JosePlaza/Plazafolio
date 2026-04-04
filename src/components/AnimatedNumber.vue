<script setup>
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'

const props = defineProps({
  value: { type: Number, default: 0 },
  prefix: { type: String, default: '' },
  suffix: { type: String, default: '' },
  decimals: { type: Number, default: 2 },
  duration: { type: Number, default: 400 },
})

const displayValue = ref(props.value || 0)
let animFrame = null

function isValidNumber(val) {
  return val != null && !isNaN(val) && isFinite(val)
}

function animateTo(target, dur) {
  if (animFrame) cancelAnimationFrame(animFrame)

  // Ensure target is a valid number
  if (!isValidNumber(target)) {
    displayValue.value = 0
    return
  }

  const start = displayValue.value
  const diff = target - start

  // If difference is negligible, just set the target
  if (Math.abs(diff) < 0.001) {
    displayValue.value = target
    return
  }

  const startTime = performance.now()

  function step(now) {
    const elapsed = now - startTime
    const progress = Math.min(elapsed / dur, 1)
    // ease-out cubic easing
    const eased = 1 - Math.pow(1 - progress, 3)
    displayValue.value = start + diff * eased

    if (progress < 1) {
      animFrame = requestAnimationFrame(step)
    } else {
      displayValue.value = target
      animFrame = null
    }
  }

  animFrame = requestAnimationFrame(step)
}

// Watch for value changes and trigger animation
watch(
  () => props.value,
  (newVal) => {
    const target = isValidNumber(newVal) ? newVal : 0
    animateTo(target, props.duration)
  }
)

// Watch for prefix/suffix changes (e.g., currency symbol switch)
// to ensure component is marked as needing update
watch(
  () => props.prefix,
  () => {
    // Trigger a re-render by accessing the current display value
    // This ensures prefix changes are visually reflected
  }
)

watch(
  () => props.suffix,
  () => {
    // Same as prefix watch - ensures visual update on suffix change
  }
)

onMounted(() => {
  const initial = isValidNumber(props.value) ? props.value : 0
  displayValue.value = initial
})

onBeforeUnmount(() => {
  if (animFrame) {
    cancelAnimationFrame(animFrame)
    animFrame = null
  }
})

function fmt(val) {
  if (!isValidNumber(val)) {
    return '0.' + '0'.repeat(props.decimals)
  }
  return Number(val).toLocaleString('en-US', {
    minimumFractionDigits: props.decimals,
    maximumFractionDigits: props.decimals,
  })
}
</script>

<template>
  <span class="animated-number">{{ prefix }}{{ fmt(displayValue) }}{{ suffix }}</span>
</template>

<style scoped>
.animated-number {
  font-variant-numeric: tabular-nums;
  display: inline;
}
</style>
