<script setup>
import { ref, watch, inject, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useSettings } from '@/composables/useSettings'
import { useCurrency } from '@/composables/useCurrency'
import GordonSettingsCard from '@/components/valuation/GordonSettingsCard.vue'

const router = useRouter()

// §2.1 — el preview de Gordon usa el ticker activo si lo hay.
const app = inject('appState', null)
const { symbolFor } = useCurrency()
const gordonTicker = computed(() => app?.ticker?.value || '')
const gordonD0 = computed(() => {
  const td = app?.data?.trailingDividends
  return td?.length ? td[td.length - 1].annualDividend : null
})
const gordonCurrency = computed(() => symbolFor(gordonTicker.value))

const { geminiApiKey, syncing, setGeminiApiKey } = useSettings()

const keyInput = ref(geminiApiKey.value)
const showKey = ref(false)
const saved = ref(false)
const testing = ref(false)
const testResult = ref(null)
const checkingStatus = ref(false)
const modelsStatus = ref(null)

async function onSave() {
  await setGeminiApiKey(keyInput.value)
  saved.value = true
  testResult.value = null
  setTimeout(() => { saved.value = false }, 2000)
}

async function onTest() {
  if (!geminiApiKey.value) return
  testing.value = true
  testResult.value = null
  try {
    const res = await fetch('/api/llm/test-key', {
      method: 'POST',
      headers: { 'x-gemini-key': geminiApiKey.value },
    })
    testResult.value = await res.json()
  } catch (err) {
    testResult.value = { ok: false, error: err.message }
  } finally {
    testing.value = false
  }
}

async function onClear() {
  keyInput.value = ''
  await setGeminiApiKey('')
  modelsStatus.value = null
  testResult.value = null
  saved.value = true
  setTimeout(() => { saved.value = false }, 2000)
}

async function onCheckStatus() {
  if (!geminiApiKey.value) return
  checkingStatus.value = true
  modelsStatus.value = null
  try {
    const res = await fetch('/api/llm/status', {
      headers: { 'x-gemini-key': geminiApiKey.value },
    })
    const data = await res.json()
    modelsStatus.value = data.models || []
  } catch (err) {
    modelsStatus.value = []
  } finally {
    checkingStatus.value = false
  }
}

function masked(key) {
  if (!key || key.length < 8) return key
  return key.slice(0, 4) + '•'.repeat(Math.min(key.length - 8, 20)) + key.slice(-4)
}
</script>

<template>
  <div class="max-w-lg mx-auto py-6 px-4 pb-navbar">
    <!-- Header -->
    <div class="flex items-center gap-3 mb-8">
      <button
        class="gw-btn-icon w-9 h-9 shrink-0"
        @click="router.back()"
        title="Volver"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>
      <h1 class="text-lg font-semibold text-foreground">Ajustes</h1>
    </div>

    <!-- Unified AI card -->
    <div class="glass-card p-5 space-y-5">

      <!-- ── Section: API Key ── -->
      <div>
        <h2 class="text-sm font-semibold text-foreground mb-1">Resúmenes con IA</h2>
        <p class="text-xs text-zinc-400 leading-relaxed">
          Para generar resúmenes ejecutivos de los informes SEC con inteligencia artificial,
          necesitas una API key de Google AI Studio (Gemini). Es gratuita y puedes obtenerla en
          <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener" class="text-blue-400 hover:text-blue-300 underline">aistudio.google.com/apikey</a>.
        </p>
      </div>

      <!-- Input -->
      <div class="space-y-2">
        <label class="text-xs text-zinc-500 uppercase tracking-wider">Gemini API Key</label>
        <div class="relative">
          <input
            v-model="keyInput"
            :type="showKey ? 'text' : 'password'"
            placeholder="AIza..."
            class="w-full h-10 px-3 pr-10 rounded-lg text-sm text-foreground placeholder-zinc-600 outline-none transition-colors"
            style="background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);"
            @focus="$event.target.style.borderColor = 'rgba(255,255,255,0.15)'"
            @blur="$event.target.style.borderColor = 'rgba(255,255,255,0.08)'"
          />
          <button
            @click="showKey = !showKey"
            class="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
            type="button"
          >
            <svg v-if="!showKey" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" />
            </svg>
            <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" /><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" /><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" /><line x1="2" x2="22" y1="2" y2="22" />
            </svg>
          </button>
        </div>

        <!-- Action buttons -->
        <div class="flex items-center gap-2">
          <button
            @click="onSave"
            :disabled="keyInput === geminiApiKey"
            class="h-8 px-4 rounded-lg text-xs font-medium transition-all"
            :class="keyInput !== geminiApiKey
              ? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30'
              : 'bg-white/5 text-zinc-600 cursor-not-allowed'"
          >
            Guardar
          </button>
          <button
            v-if="geminiApiKey"
            @click="onClear"
            class="h-8 px-4 rounded-lg text-xs font-medium text-red-400/70 hover:text-red-400 bg-red-500/5 hover:bg-red-500/10 transition-all"
          >
            Eliminar
          </button>
          <Transition name="fade">
            <span v-if="saved" class="text-xs text-emerald-400 ml-2">Guardado</span>
          </Transition>
        </div>
      </div>

      <!-- ── Section: Connection status ── -->
      <div class="pt-3 border-t border-white/5 space-y-2">
        <div class="flex items-center gap-2">
          <div class="w-2 h-2 rounded-full" :class="geminiApiKey ? 'bg-emerald-400' : 'bg-zinc-600'"></div>
          <span class="text-xs flex-1" :class="geminiApiKey ? 'text-emerald-400/70' : 'text-zinc-500'">
            {{ geminiApiKey ? 'API key configurada' : 'Sin API key — los informes mostrarán solo métricas sin resumen IA' }}
          </span>
          <button
            v-if="geminiApiKey"
            @click="onTest"
            :disabled="testing"
            class="h-7 px-3 rounded-lg text-[11px] font-medium bg-blue-500/10 text-blue-400/80 hover:bg-blue-500/20 hover:text-blue-300 transition-all disabled:opacity-50"
          >
            {{ testing ? 'Probando...' : 'Probar conexión' }}
          </button>
        </div>
        <Transition name="fade">
          <div v-if="testResult" class="flex items-center gap-2 text-xs" :class="testResult.ok ? 'text-emerald-400' : 'text-red-400'">
            <div class="w-2 h-2 rounded-full" :class="testResult.ok ? 'bg-emerald-400' : 'bg-red-400'"></div>
            <span v-if="testResult.ok">Conexión exitosa — modelo: {{ testResult.model }}</span>
            <span v-else>Error: {{ testResult.error }}</span>
          </div>
        </Transition>
      </div>

      <!-- ── Section: Models & quota ── -->
      <div v-if="geminiApiKey" class="pt-3 border-t border-white/5 space-y-3">
        <div class="flex items-center justify-between">
          <h3 class="text-xs font-semibold text-foreground uppercase tracking-wider">Cuota de modelos</h3>
          <button
            @click="onCheckStatus"
            :disabled="checkingStatus"
            class="h-7 px-3 rounded-lg text-[11px] font-medium bg-blue-500/10 text-blue-400/80 hover:bg-blue-500/20 hover:text-blue-300 transition-all disabled:opacity-50"
          >
            {{ checkingStatus ? 'Comprobando...' : 'Comprobar' }}
          </button>
        </div>

        <!-- Loading -->
        <div v-if="checkingStatus" class="flex items-center gap-2 text-xs text-zinc-500">
          <svg class="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10" stroke-opacity="0.2" /><path d="M12 2a10 10 0 0 1 10 10" />
          </svg>
          Comprobando cada modelo...
        </div>

        <!-- Placeholder when no check done yet -->
        <p v-if="!modelsStatus && !checkingStatus" class="text-[11px] text-zinc-500 leading-relaxed">
          Comprueba qué modelos tienen cuota disponible y si pueden incluir noticias referenciadas en los resúmenes.
        </p>

        <!-- Results -->
        <div v-if="modelsStatus && !checkingStatus" class="space-y-0">
          <div class="flex items-center text-[9px] text-zinc-500 uppercase tracking-wider pb-1.5 border-b border-white/5">
            <span class="flex-1">Modelo</span>
            <span class="w-16 text-center">Límite</span>
            <span class="w-16 text-center">Texto</span>
            <span class="w-16 text-center">Fuentes</span>
          </div>
          <div
            v-for="m in modelsStatus"
            :key="m.model"
            class="flex items-center py-2 border-b border-white/[0.03] last:border-0"
          >
            <div class="flex-1 min-w-0">
              <div class="text-[11px] text-zinc-300">{{ m.name }}</div>
              <div v-if="m.error" class="text-[9px] text-red-400/60 mt-0.5 truncate">{{ m.error }}</div>
            </div>
            <span class="w-16 text-center text-[10px] tabular-nums" :class="m.available ? 'text-zinc-400' : 'text-zinc-500'">
              {{ m.rpdLimit }}/día
            </span>
            <span class="w-16 flex justify-center">
              <span v-if="m.available" class="w-2 h-2 rounded-full bg-emerald-400" title="Disponible"></span>
              <span v-else class="w-2 h-2 rounded-full bg-red-400" title="Sin cuota"></span>
            </span>
            <span class="w-16 flex justify-center">
              <span v-if="m.grounding" class="w-2 h-2 rounded-full bg-emerald-400" title="Grounding activo"></span>
              <span v-else-if="m.available" class="w-2 h-2 rounded-full bg-amber-400" title="Sin grounding"></span>
              <span v-else class="w-2 h-2 rounded-full bg-zinc-600" title="No disponible"></span>
            </span>
          </div>

          <!-- Summary line -->
          <div class="pt-2 text-[10px] text-zinc-500 leading-relaxed">
            <template v-if="modelsStatus.some(m => m.available && m.grounding)">
              <span class="text-emerald-400/70">✓</span> Resúmenes con noticias y fuentes disponibles
            </template>
            <template v-else-if="modelsStatus.some(m => m.available)">
              <span class="text-amber-400/70">●</span> Resúmenes disponibles sin fuentes — cuota de grounding agotada
            </template>
            <template v-else>
              <span class="text-red-400/70">✗</span> Cuota diaria agotada — se restablece a medianoche (hora del Pacífico)
            </template>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Modelo de Gordon (SPEC §2.1) ── -->
    <div class="mt-4">
      <GordonSettingsCard
        :ticker="gordonTicker"
        :d0="gordonD0"
        :currency="gordonCurrency"
      />
    </div>

    <!-- Info note -->
    <div class="mt-4 text-[10px] text-zinc-500 text-center leading-relaxed">
      La API key se guarda cifrada en tu cuenta y en el navegador, sincronizada entre dispositivos.
      <br>Se envía directamente a Google — nunca en texto plano en nuestros servidores.
      <span v-if="syncing" class="text-blue-400/50 ml-1">Sincronizando...</span>
    </div>
  </div>
</template>

<style scoped>
.fade-enter-active, .fade-leave-active { transition: opacity 0.3s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
