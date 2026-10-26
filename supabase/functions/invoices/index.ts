import { allowedOrigins } from '../_shared/http.ts';
import { rpcLogger, userFromToken } from '../_shared/supabase.ts';
import { handle } from './handler.ts';

const deps = {
  allowedOrigins: allowedOrigins(Deno.env.get('ALLOWED_ORIGINS')),
  userFromToken,
  rpc: rpcLogger('invoices'),
};

Deno.serve((req) => handle(req, deps));
