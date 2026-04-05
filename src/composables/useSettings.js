import { ref, watch } from 'vue'
import { supabase } from '@/lib/supabase'

// ── Singleton state (shared across all components) ──
const geminiApiKey = ref('')
const loaded = ref(false)
const syncing = ref(false)

const LS_KEY = 'plazafolio-settings'

// ── Encryption helpers (Web Crypto, AES-GCM with user UID as key material) ──
async function deriveKey(userId) {
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(userId), 'PBKDF2', false, ['deriveKey']
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode('plazafolio-v1'), iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

async function encrypt(text, userId) {
  const key = await deriveKey(userId)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const enc = new TextEncoder()
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(text)
  )
  // Store as base64: iv + ciphertext
  const buf = new Uint8Array(iv.length + new Uint8Array(ciphertext).length)
  buf.set(iv)
  buf.set(new Uint8Array(ciphertext), iv.length)
  return btoa(String.fromCharCode(...buf))
}

async function decrypt(encoded, userId) {
  const key = await deriveKey(userId)
  const raw = Uint8Array.from(atob(encoded), c => c.charCodeAt(0))
  const iv = raw.slice(0, 12)
  const ciphertext = raw.slice(12)
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  )
  return new TextDecoder().decode(decrypted)
}

// ── localStorage (fast local cache) ──
function loadLocal() {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) {
      const data = JSON.parse(raw)
      return data.geminiApiKey || ''
    }
  } catch { /* ignore */ }
  return ''
}

function saveLocal() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({
      geminiApiKey: geminiApiKey.value,
    }))
  } catch { /* ignore */ }
}

// ── Supabase sync ──
async function getUserId() {
  const { data: { user } } = await supabase.auth.getUser()
  return user?.id || null
}

async function loadFromSupabase() {
  const userId = await getUserId()
  if (!userId) return null
  try {
    const { data, error } = await supabase
      .from('user_settings')
      .select('gemini_api_key_enc')
      .eq('user_id', userId)
      .maybeSingle()
    if (error || !data?.gemini_api_key_enc) return null
    return await decrypt(data.gemini_api_key_enc, userId)
  } catch (err) {
    console.warn('[Settings] Supabase load failed:', err.message)
    return null
  }
}

async function saveToSupabase(apiKey) {
  const userId = await getUserId()
  if (!userId) return
  try {
    const enc = apiKey ? await encrypt(apiKey, userId) : null
    const { error } = await supabase
      .from('user_settings')
      .upsert({
        user_id: userId,
        gemini_api_key_enc: enc,
      }, { onConflict: 'user_id' })
    if (error) throw error
    console.log('[Settings] Saved to Supabase')
  } catch (err) {
    console.warn('[Settings] Supabase save failed:', err.message)
  }
}

// Auto-save locally when key changes
watch(geminiApiKey, saveLocal)

export function useSettings() {
  // Load: localStorage first (instant), then Supabase (may override)
  if (!loaded.value) {
    geminiApiKey.value = loadLocal()
    loaded.value = true

    // Async: try Supabase (won't block UI)
    loadFromSupabase().then(remote => {
      if (remote && !geminiApiKey.value) {
        // Remote has key but local doesn't → sync down
        geminiApiKey.value = remote
        saveLocal()
        console.log('[Settings] Synced API key from Supabase')
      }
    })
  }

  async function setGeminiApiKey(key) {
    const trimmed = (key || '').trim()
    geminiApiKey.value = trimmed
    // Save to Supabase in background
    syncing.value = true
    try {
      await saveToSupabase(trimmed)
    } finally {
      syncing.value = false
    }
  }

  return {
    geminiApiKey,
    syncing,
    setGeminiApiKey,
  }
}
