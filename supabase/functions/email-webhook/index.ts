import { requireEnv, rpcLogger } from '../_shared/supabase.ts';
import { handle } from './handler.ts';

const deps = { secret: requireEnv('RESEND_WEBHOOK_SECRET'), rpc: rpcLogger('email-webhook') };

Deno.serve((req) => handle(req, deps));
