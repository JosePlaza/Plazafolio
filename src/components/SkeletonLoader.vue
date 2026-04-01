<script setup>
</script>

<template>
  <div class="space-y-4 animate-pulse">
    <!-- Title skeleton -->
    <div class="flex items-center gap-4">
      <div class="w-12 h-12 rounded-xl bg-white/[0.04]" />
      <div class="space-y-2">
        <div class="h-6 w-48 rounded-lg bg-white/[0.04]" />
        <div class="h-4 w-24 rounded-lg bg-white/[0.03]" />
      </div>
      <div class="flex-1" />
      <div class="flex gap-1">
        <div class="h-6 w-10 rounded-full bg-white/[0.04]" />
        <div class="h-6 w-12 rounded-full bg-white/[0.04]" />
        <div class="h-6 w-16 rounded-full bg-white/[0.05]" />
        <div class="h-6 w-10 rounded-full bg-white/[0.04]" />
      </div>
    </div>

    <!-- Row 1: KPIs + Tesis -->
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-4">
      <div class="lg:col-span-4 glass-card p-5">
        <div class="grid grid-cols-2 gap-x-6 gap-y-4">
          <div v-for="i in 5" :key="i" class="space-y-2">
            <div class="h-3 w-16 rounded bg-white/[0.04]" />
            <div class="h-6 w-20 rounded bg-white/[0.05]" />
            <div class="h-3 w-14 rounded bg-white/[0.03]" />
          </div>
        </div>
      </div>
      <div class="lg:col-span-8 glass-card p-4">
        <div class="h-4 w-16 rounded bg-white/[0.04] mb-4" />
        <div class="h-[250px] sm:h-[400px] rounded-xl bg-white/[0.03]" />
      </div>
    </div>

    <!-- Row 2 -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div class="glass-card p-4">
        <div class="h-4 w-14 rounded bg-white/[0.04] mb-4" />
        <div class="h-[250px] sm:h-[400px] rounded-xl bg-white/[0.03]" />
      </div>
      <div class="glass-card p-4">
        <div class="h-4 w-20 rounded bg-white/[0.04] mb-4" />
        <div class="h-[250px] sm:h-[400px] rounded-xl bg-white/[0.03]" />
      </div>
    </div>

    <!-- Row 3: Histórico + Proyección -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div class="glass-card p-4">
        <div class="h-4 w-32 rounded bg-white/[0.04] mb-4" />
        <div class="h-[250px] sm:h-[400px] rounded-xl bg-white/[0.03]" />
      </div>
      <div class="glass-card p-4">
        <div class="h-4 w-24 rounded bg-white/[0.04] mb-4" />
        <div class="h-[250px] sm:h-[400px] rounded-xl bg-white/[0.03]" />
      </div>
    </div>

    <!-- Row 4: Drawdown -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div class="glass-card p-4">
        <div class="h-4 w-20 rounded bg-white/[0.04] mb-4" />
        <div class="h-[250px] sm:h-[400px] rounded-xl bg-white/[0.03]" />
      </div>
    </div>
  </div>
</template>
