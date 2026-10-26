import { providerFromEnv } from '../_shared/email.ts';
import { requireEnv, rpcLogger } from '../_shared/supabase.ts';
import { handle } from './handler.ts';

const deps = {
  secret: requireEnv('WORKER_SECRET'),
  appUrl: requireEnv('APP_URL'),
  fromAddress: Deno.env.get('EMAIL_FROM_ADDRESS') ?? '',
  provider: providerFromEnv(),
  rpc: rpcLogger('reminder-worker'),
};

Deno.serve((req) => handle(req, deps));
