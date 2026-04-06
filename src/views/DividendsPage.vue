<script setup>
import { inject } from 'vue'
import DividendsView from '@/components/DividendsView.vue'

const app = inject('appState')
</script>

<template>
  <main class="dot-pattern flex-1 overflow-y-auto p-3 sm:p-6 pb-navbar" style="max-height: calc(100dvh - 3.5rem - env(safe-area-inset-top, 0px))">
    <DividendsView
      :actives="app.actives.value"
      :visible="true"
    />
  </main>
</template>
