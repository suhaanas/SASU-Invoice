/**
 * Service-role Supabase client and session lookup for Edge Functions. The
 * service role bypasses RLS, so it only ever calls the service-only rf_ / save
 * RPCs, which re-check the caller's membership themselves.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { SqlError } from './http.ts';

export function requireEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`${name} must be set`);
  return v;
}

let admin: SupabaseClient | null = null;

export function adminClient(): SupabaseClient {
  admin ??= createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}

export async function userFromToken(token: string): Promise<string | null> {
  const { data, error } = await adminClient().auth.getUser(token);
  return error || !data.user ? null : data.user.id;
}

export type Rpc = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: SqlError | null }>;

/** RPC call that logs unexpected (non-SA) database errors with the function name. */
export function rpcLogger(fn: string): Rpc {
  return async (name, args) => {
    const { data, error } = await adminClient().rpc(name, args);
    if (error && !error.code?.startsWith('SA')) {
      console.error(JSON.stringify({ fn, rpc: name, error }));
    }
    return { data, error };
  };
}
