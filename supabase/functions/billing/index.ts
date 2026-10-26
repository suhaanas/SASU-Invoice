import { billingFromEnv } from '../_shared/billing.ts';
import { allowedOrigins } from '../_shared/http.ts';
import { rpcLogger, userFromToken } from '../_shared/supabase.ts';
import { handle } from './handler.ts';

const deps = {
  allowedOrigins: allowedOrigins(Deno.env.get('ALLOWED_ORIGINS')),
  billing: billingFromEnv(),
  userFromToken,
  rpc: rpcLogger('billing'),
};

Deno.serve((req) => handle(req, deps));
