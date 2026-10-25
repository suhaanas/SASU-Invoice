import { requireEnv, rpcLogger } from '../_shared/supabase.ts';
import { handle } from './handler.ts';

const deps = { secret: requireEnv('PADDLE_WEBHOOK_SECRET'), rpc: rpcLogger('billing-webhook') };

Deno.serve((req) => handle(req, deps));
