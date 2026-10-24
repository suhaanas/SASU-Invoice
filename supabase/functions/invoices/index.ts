import { createClient } from '@supabase/supabase-js';
import { allowedOrigins } from '../_shared/http.ts';
import { handle } from './handler.ts';

const url = Deno.env.get('SUPABASE_URL');
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
if (!url || !serviceKey) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');

// Service-role client: bypasses RLS, so it is only used for the two
// service-only RPCs, which re-check the caller's membership themselves.
const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const origins = allowedOrigins(Deno.env.get('ALLOWED_ORIGINS'));

Deno.serve((req) =>
  handle(req, {
    allowedOrigins: origins,
    async userFromToken(token) {
      const { data, error } = await admin.auth.getUser(token);
      return error || !data.user ? null : data.user.id;
    },
    async rpc(name, args) {
      const { data, error } = await admin.rpc(name, args);
      if (error && !error.code?.startsWith('SA'))
        console.error(JSON.stringify({ fn: 'invoices', rpc: name, error }));
      return { data, error };
    },
  }),
);
