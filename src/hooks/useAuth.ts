'use client'

import { useEffect, useState } from 'react'
import { type User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'

export function useAuth() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = createClient()

    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ?? null)
    })

    return () => subscription.unsubscribe()
  }, [])

  /**
   * Sign out everywhere this app holds identity, then land on /login.
   *
   * Hard-navigates (window.location) instead of router.push so the proxy
   * re-reads the cleared session cookie in a fresh request — the same reason
   * login uses a hard nav. A client-side push can race the cookie write and
   * leave a protected page looking signed-in.
   */
  async function signOut(options?: { redirectTo?: string }): Promise<{ error: string | null }> {
    const supabase = createClient()
    try {
      const { error } = await supabase.auth.signOut()
      if (error) return { error: error.message }
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Sign out failed' }
    }
    setUser(null)
    if (typeof window !== 'undefined') {
      window.location.href = options?.redirectTo ?? '/login'
    }
    return { error: null }
  }

  return { user, loading, signOut }
}
