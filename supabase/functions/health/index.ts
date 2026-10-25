import { rpcLogger } from '../_shared/supabase.ts';
import { handle } from './handler.ts';

const deps = {
  secret: Deno.env.get('WORKER_SECRET') ?? '',
  rpc: rpcLogger('health'),
  configured: {
    email: !!(Deno.env.get('RESEND_API_KEY') && Deno.env.get('EMAIL_FROM_ADDRESS')),
    ai: !!Deno.env.get('OPENAI_API_KEY'),
    billing: !!(Deno.env.get('PADDLE_API_KEY') && Deno.env.get('PADDLE_WEBHOOK_SECRET')),
  },
};

Deno.serve((req) => handle(req, deps));
