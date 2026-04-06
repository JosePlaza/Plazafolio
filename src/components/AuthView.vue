<script setup>
import { ref } from 'vue'
import { supabase } from '@/lib/supabase'

const emit = defineEmits(['authenticated'])

const mode = ref('login') // 'login' | 'register'
const email = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)
const success = ref('')

async function handleSubmit() {
  error.value = ''
  success.value = ''
  loading.value = true

  try {
    if (mode.value === 'register') {
      const { error: err } = await supabase.auth.signUp({
        email: email.value,
        password: password.value,
      })
      if (err) throw err
      success.value = 'Cuenta creada. Revisa tu email para confirmar.'
    } else {
      const { error: err } = await supabase.auth.signInWithPassword({
        email: email.value,
        password: password.value,
      })
      if (err) throw err
      emit('authenticated')
    }
  } catch (err) {
    const msg = err.message || 'Error desconocido'
    if (msg.includes('Invalid login')) error.value = 'Email o contraseña incorrectos'
    else if (msg.includes('already registered')) error.value = 'Este email ya está registrado'
    else if (msg.includes('Password should be')) error.value = 'La contraseña debe tener al menos 6 caracteres'
    else error.value = msg
  } finally {
    loading.value = false
  }
}

function toggleMode() {
  mode.value = mode.value === 'login' ? 'register' : 'login'
  error.value = ''
  success.value = ''
}
</script>

<template>
  <div class="min-h-screen min-h-[100dvh] flex items-center justify-center p-4 relative">
    <!-- Background blobs -->
    <div class="bg-blobs">
      <div class="bg-blob-3" />
    </div>

    <div class="w-full max-w-sm relative z-10">
      <!-- Logo + Title -->
      <div class="flex flex-col items-center mb-8">
        <img src="/plazafolio.svg" alt="Plazafolio" class="w-14 h-14 mb-3" />
        <h1 class="text-xl font-bold text-foreground tracking-tight">Plazafolio</h1>
        <p class="text-muted-foreground text-xs mt-1">Análisis con el método Geraldine Weiss</p>
      </div>

      <!-- Card -->
      <div class="glass-card p-6">
        <h2 class="text-sm font-semibold text-foreground mb-5">
          {{ mode === 'login' ? 'Iniciar sesión' : 'Crear cuenta' }}
        </h2>

        <form @submit.prevent="handleSubmit" class="space-y-4">
          <div>
            <label class="block text-[11px] text-muted-foreground mb-1.5 uppercase tracking-wider">Email</label>
            <input
              v-model="email"
              type="email"
              required
              autocomplete="email"
              class="gw-input w-full h-10 text-sm"
              placeholder="tu@email.com"
            />
          </div>

          <div>
            <label class="block text-[11px] text-muted-foreground mb-1.5 uppercase tracking-wider">Contraseña</label>
            <input
              v-model="password"
              type="password"
              required
              minlength="6"
              autocomplete="current-password"
              class="gw-input w-full h-10 text-sm"
              placeholder="Min. 6 caracteres"
            />
          </div>

          <!-- Error -->
          <div v-if="error" class="rounded-lg p-2.5" style="background: rgba(248,113,113,0.08); border: 1px solid rgba(248,113,113,0.2);">
            <p class="text-destructive text-xs">{{ error }}</p>
          </div>

          <!-- Success -->
          <div v-if="success" class="rounded-lg p-2.5" style="background: rgba(52,211,153,0.08); border: 1px solid rgba(52,211,153,0.2);">
            <p class="text-success text-xs">{{ success }}</p>
          </div>

          <button
            type="submit"
            class="gw-btn w-full h-10 text-sm"
            :disabled="loading"
          >
            <span v-if="loading" class="flex items-center justify-center gap-2">
              <span class="spinner" style="width: 16px; height: 16px; border-width: 2px;"></span>
              {{ mode === 'login' ? 'Entrando...' : 'Creando cuenta...' }}
            </span>
            <span v-else>{{ mode === 'login' ? 'Entrar' : 'Crear cuenta' }}</span>
          </button>
        </form>

        <div class="mt-5 text-center">
          <button
            type="button"
            class="text-xs text-muted-foreground hover:text-primary transition-colors"
            @click="toggleMode"
          >
            {{ mode === 'login' ? '¿No tienes cuenta? Regístrate' : '¿Ya tienes cuenta? Inicia sesión' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
