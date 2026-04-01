<script setup>
import { ref } from 'vue'

const emit = defineEmits(['generate'])

const ticker = ref('')
const years = ref(12)

const periodOptions = [
  { label: '8y', value: 8 },
  { label: '10y', value: 10 },
  { label: '12y (GW)', value: 12 },
  { label: '15y', value: 15 },
]

function onSubmit() {
  if (ticker.value.trim()) {
    emit('generate', {
      ticker: ticker.value.trim().toUpperCase(),
      years: years.value,
    })
  }
}
</script>

<template>
  <form @submit.prevent="onSubmit">
    <div>
      <input
        v-model="ticker"
        type="text"
        placeholder="Ticker (ej: MSFT, NKE, VID.MC)"
      />
      <select v-model="years">
        <option v-for="opt in periodOptions" :key="opt.value" :value="opt.value">
          {{ opt.label }}
        </option>
      </select>
      <button type="submit">¡Generar!</button>
    </div>
  </form>
</template>
