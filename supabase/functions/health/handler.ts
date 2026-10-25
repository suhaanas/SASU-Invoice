/**
 * GET /functions/v1/health — for uptime monitors.
 *
 * Public: { status: "ok" | "degraded" } only (200 or 503).
 * With the WORKER_SECRET header: which integrations are configured and when
 * the scheduler last ran. Never returns secrets.
 */
import { json } from '../_shared/http.ts';
import type { Rpc } from '../_shared/supabase.ts';
import { safeEqual } from '../_shared/webhook.ts';

export interface Deps {
  secret: string;
  rpc: Rpc;
  configured: { email: boolean; ai: boolean; billing: boolean };
  now?: () => number;
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method !== 'GET') return json(405, { error: 'Method not allowed' });
  const db = await deps.rpc('rf_scheduler_status', {});
  const dbOk = !db.error;
  const lastRun = typeof db.data === 'string' ? db.data : null;
  const now = deps.now?.() ?? Date.now();
  const schedulerOk = lastRun !== null && now - Date.parse(lastRun) < 15 * 60_000;
  const status = dbOk && schedulerOk ? 'ok' : 'degraded';
  const detailed =
    !!deps.secret && safeEqual(req.headers.get('x-worker-secret') ?? '', deps.secret);
  return json(
    dbOk ? (schedulerOk ? 200 : 503) : 503,
    detailed
      ? {
          status,
          database: dbOk,
          scheduler: { lastRun, ok: schedulerOk },
          configured: deps.configured,
        }
      : { status },
  );
}
