<script setup>
import { computed } from 'vue'
import { useCurrency } from '@/composables/useCurrency'

const props = defineProps({
  bar: { type: Object, default: null },
  ticker: { type: String, default: '' },
})

const { convertByTicker, symbolFor } = useCurrency()
const sym = computed(() => symbolFor(props.ticker))
const money = (v) =>
  v == null || isNaN(v) ? '—' : sym.value + Number(convertByTicker(v, props.ticker)).toFixed(2)

const ZONAS = {
  compra: 'rgba(52, 211, 153, 0.22)',
  flexible: 'rgba(52, 211, 153, 0.10)',
  intermedia: 'rgba(255, 255, 255, 0.04)',
  sobrevaloracion: 'rgba(248, 113, 113, 0.14)',
}

const SEGMENTOS = {
  gordon: { color: 'rgba(161,161,170,0.45)', top: 0 },
  multiplos: { color: 'rgba(65,91,255,0.5)', top: 7 },
}

const ticks = computed(() =>
  (props.bar?.marcadores || []).filter((m) => !m.principal),
)
const hoy = computed(() =>
  (props.bar?.marcadores || []).find((m) => m.principal) || null,
)

// Las etiquetas de los ticks se alternan arriba/abajo cuando quedan a menos de
// 18 puntos porcentuales: con la barra a ~600px eso son ~110px, suficiente para
// que dos precios de 8 caracteres se pisen.
const ticksConNivel = computed(() => {
  const out = []
  let ultimoPos = -Infinity
  let nivel = 0
  for (const t of [...ticks.value].sort((a, b) => a.pos - b.pos)) {
    nivel = t.pos - ultimoPos < 18 ? 1 - nivel : 0
    ultimoPos = t.pos
    out.push({ ...t, nivel })
  }
  return out
})
</script>

<template>
  <div v-if="bar" class="pt-1 pb-1">
    <!-- Etiqueta del marcador principal, encima de la barra -->
    <div class="relative h-5 mb-1">
      <div
        v-if="hoy"
        class="absolute -translate-x-1/2 whitespace-nowrap text-[10px] font-bold"
        :style="{ left: hoy.pos + '%', color: '#e4e4e7' }"
      >
        Hoy {{ money(hoy.valor) }}
      </div>
    </div>

    <!-- Barra: zona buena a la IZQUIERDA (en un precio de entrada, menos es mejor) -->
    <div class="relative h-6 rounded-md overflow-hidden" style="background: rgba(255,255,255,0.03);">
      <div
        v-for="z in bar.zonas"
        :key="z.tipo"
        class="absolute inset-y-0"
        :style="{ left: z.from + '%', width: Math.max(0, z.to - z.from) + '%', background: ZONAS[z.tipo] }"
      />

      <!-- Ticks de los dos precios de entrada -->
      <div
        v-for="t in ticks"
        :key="t.id"
        class="absolute inset-y-0 w-px"
        :style="{ left: t.pos + '%', background: '#34d399' }"
      />

      <!-- Marcador principal: aguja de la cotización actual -->
      <div
        v-if="hoy"
        class="absolute inset-y-0"
        :style="{ left: hoy.pos + '%', width: '2px', marginLeft: '-1px', background: '#e4e4e7' }"
        :title="`Hoy ${money(hoy.valor)}`"
      />
    </div>

    <!-- Segmentos de contexto bajo la barra: Gordon y múltiplos -->
    <div class="relative h-4 mt-1">
      <div
        v-for="sg in bar.segmentos"
        :key="sg.id"
        class="absolute h-1 rounded-full"
        :style="{
          left: sg.from + '%',
          width: Math.max(0.6, sg.to - sg.from) + '%',
          top: SEGMENTOS[sg.id].top + 'px',
          background: SEGMENTOS[sg.id].color,
        }"
        :title="`${sg.label}: ${money(sg.desde)} — ${money(sg.hasta)}${sg.recortado ? ' (fuera de escala →)' : ''}`"
      />
    </div>

    <!-- Etiquetas de los precios de entrada -->
    <div class="relative h-8">
      <div
        v-for="t in ticksConNivel"
        :key="t.id"
        class="absolute -translate-x-1/2 whitespace-nowrap text-[9px] leading-tight text-center"
        :style="{ left: t.pos + '%', top: (t.nivel * 15) + 'px' }"
      >
        <div class="font-semibold tabular-nums" style="color: #34d399;">{{ money(t.valor) }}</div>
        <div class="text-muted-foreground/60">{{ t.label }}</div>
      </div>
    </div>

    <div class="flex justify-between text-[9px] text-muted-foreground/40 tabular-nums">
      <span>{{ money(bar.minEscala) }}</span>
      <span>{{ money(bar.maxEscala) }}</span>
    </div>
  </div>
</template>
