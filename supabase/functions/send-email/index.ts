import { providerFromEnv } from '../_shared/email.ts';
import { allowedOrigins } from '../_shared/http.ts';
import { requireEnv, rpcLogger, userFromToken } from '../_shared/supabase.ts';
import { handle } from './handler.ts';

const deps = {
  allowedOrigins: allowedOrigins(Deno.env.get('ALLOWED_ORIGINS')),
  appUrl: requireEnv('APP_URL'),
  fromAddress: Deno.env.get('EMAIL_FROM_ADDRESS') ?? '',
  provider: providerFromEnv(),
  userFromToken,
  rpc: rpcLogger('send-email'),
};

Deno.serve((req) => handle(req, deps));
