import { ref, readonly } from 'vue'
import { supabase } from '@/lib/supabase'

const user = ref(null)
const loading = ref(true)
let initialized = false

export function useAuth() {
  async function init() {
    if (initialized) return
    initialized = true

    // Get initial session
    const { data: { session } } = await supabase.auth.getSession()
    user.value = session?.user ?? null
    loading.value = false

    // Listen for auth state changes
    supabase.auth.onAuthStateChange((_event, session) => {
      user.value = session?.user ?? null
    })
  }

  async function signOut() {
    await supabase.auth.signOut()
    user.value = null
  }

  return {
    user: readonly(user),
    loading: readonly(loading),
    init,
    signOut,
  }
}
