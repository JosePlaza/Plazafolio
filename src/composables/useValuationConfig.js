import { ref, computed, watch } from 'vue'
import { DEFAULT_CONFIG } from '@/lib/valuation'

/**
 * §2.1 — rentabilidades exigidas de Gordon, ajuste global del usuario.
 *
 * Solo afectan a la horquilla de Gordon y al check de coherencia: el precio de
 * entrada lo fijan Weiss y los múltiplos (§6.1), así que cambiarlas nunca mueve
 * la cifra principal de la card.
 */
const STORAGE_KEY = 'gw-valuation-config'

export const LIMITES = {
  r_exigente: { min: 0.05, max: 0.15 },
  r_flexible: { min: 0.03, max: 0.12 },
  SEPARACION_MIN: 0.01, // 1 p.p. entre ambas
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      return {
        r_exigente: Number(parsed.r_exigente) || DEFAULT_CONFIG.r_exigente,
        r_flexible: Number(parsed.r_flexible) || DEFAULT_CONFIG.r_flexible,
      }
    }
  } catch { /* almacenamiento no disponible o valor corrupto */ }
  return { r_exigente: DEFAULT_CONFIG.r_exigente, r_flexible: DEFAULT_CONFIG.r_flexible }
}

const stored = load()
const rExigente = ref(stored.r_exigente)
const rFlexible = ref(stored.r_flexible)

// Cambia el `key` de la valoración para que las cards se recalculen (§2.1).
const version = ref(0)

watch([rExigente, rFlexible], () => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      r_exigente: rExigente.value,
      r_flexible: rFlexible.value,
    }))
  } catch { /* ignore */ }
  version.value++
})

export function useValuationConfig() {
  const config = computed(() => ({
    ...DEFAULT_CONFIG,
    r_exigente: rExigente.value,
    r_flexible: rFlexible.value,
  }))

  /** Devuelve el motivo del rechazo, o null si es válido. */
  function validar(exigente, flexible) {
    const le = LIMITES.r_exigente
    const lf = LIMITES.r_flexible
    if (!(exigente >= le.min && exigente <= le.max)) {
      return `La exigente debe estar entre ${le.min * 100}% y ${le.max * 100}%.`
    }
    if (!(flexible >= lf.min && flexible <= lf.max)) {
      return `La flexible debe estar entre ${lf.min * 100}% y ${lf.max * 100}%.`
    }
    if (exigente < flexible + LIMITES.SEPARACION_MIN) {
      return 'La exigente debe superar a la flexible en al menos 1 punto.'
    }
    return null
  }

  function set(exigente, flexible) {
    const error = validar(exigente, flexible)
    if (error) return { ok: false, error }
    rExigente.value = exigente
    rFlexible.value = flexible
    return { ok: true }
  }

  function restaurar() {
    rExigente.value = DEFAULT_CONFIG.r_exigente
    rFlexible.value = DEFAULT_CONFIG.r_flexible
  }

  return { rExigente, rFlexible, config, version, validar, set, restaurar, LIMITES }
}
