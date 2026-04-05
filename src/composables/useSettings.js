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
  if (!userId) {
    console.warn('[Settings] No user ID — cannot load from Supabase')
    return null
  }
  try {
    const { data, error } = await supabase
      .from('user_settings')
      .select('gemini_api_key_enc, updated_at')
      .eq('user_id', userId)
      .maybeSingle()

    if (error) {
      console.warn('[Settings] Supabase load error:', error.message, error.code)
      return null
    }
    if (!data) {
      console.log('[Settings] No settings row found in Supabase for user')
      return null
    }
    if (!data.gemini_api_key_enc) {
      console.log('[Settings] Settings row exists but no encrypted key')
      return null
    }
    console.log('[Settings] Found encrypted key in Supabase (updated:', data.updated_at, ')')
    return await decrypt(data.gemini_api_key_enc, userId)
  } catch (err) {
    console.warn('[Settings] Supabase load failed:', err.message)
    return null
  }
}

async function saveToSupabase(apiKey) {
  const userId = await getUserId()
  if (!userId) {
    console.warn('[Settings] No user ID — cannot save to Supabase')
    return
  }

  const enc = apiKey ? await encrypt(apiKey, userId) : null
  console.log('[Settings] Saving to Supabase for user:', userId.substring(0, 8) + '...')

  // Step 1: Check if row exists
  try {
    const { data: existing, error: readErr } = await supabase
      .from('user_settings')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle()

    if (readErr) {
      console.error('[Settings] Read check failed:', readErr.message, readErr.code, readErr.details)
    }

    if (existing) {
      // Row exists — UPDATE
      console.log('[Settings] Row exists, updating...')
      const { error: updateErr } = await supabase
        .from('user_settings')
        .update({ gemini_api_key_enc: enc })
        .eq('user_id', userId)
      if (updateErr) {
        console.error('[Settings] UPDATE failed:', updateErr.message, updateErr.code, updateErr.details)
        return
      }
      console.log('[Settings] Updated in Supabase ✓')
    } else {
      // No row — INSERT
      console.log('[Settings] No row found, inserting...')
      const { error: insertErr } = await supabase
        .from('user_settings')
        .insert({ user_id: userId, gemini_api_key_enc: enc })
      if (insertErr) {
        console.error('[Settings] INSERT failed:', insertErr.message, insertErr.code, insertErr.details)
        return
      }
      console.log('[Settings] Inserted in Supabase ✓')
    }
  } catch (err) {
    console.error('[Settings] Supabase save exception:', err)
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
