/**
 * The Supabase client, created once per page. Kept in its own module so the
 * editor only downloads supabase-js when cloud sync is actually in use.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { cloudConfig } from './config.ts';

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!cloudConfig) return null;
  client ??= createClient(cloudConfig.url, cloudConfig.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
    },
  });
  return client;
}
