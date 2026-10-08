import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let authClient: SupabaseClient | undefined

export function getAuthClient(): SupabaseClient {
  if (authClient) return authClient

  const url = import.meta.env.VITE_SUPABASE_URL
  const publishableKey = import.meta.env.VITE_SUPABASE_ANON_KEY
  if (!url || !publishableKey) {
    throw new Error('Configura VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en .env.local.')
  }

  authClient = createClient(url, publishableKey)
  return authClient
}
