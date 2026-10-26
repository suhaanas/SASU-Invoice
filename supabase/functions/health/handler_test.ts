import { handle, type Deps } from './handler.ts';

function assertEquals(actual: unknown, expected: unknown, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

const NOW = Date.parse('2026-10-25T10:00:00Z');
const deps = (lastRun: string | null, dbError = false): Deps => ({
  secret: 's3cret',
  now: () => NOW,
  configured: { email: true, ai: false, billing: true },
  rpc: () =>
    Promise.resolve(
      dbError
        ? { data: null, error: { code: 'XX000', message: 'down' } }
        : { data: lastRun, error: null },
    ),
});
const get = (secret?: string) =>
  new Request('https://fn.test', { headers: secret ? { 'x-worker-secret': secret } : {} });

Deno.test('healthy when the database answers and the scheduler ran recently', async () => {
  const res = await handle(get(), deps('2026-10-25T09:55:00Z'));
  assertEquals([res.status, await res.json()], [200, { status: 'ok' }], 'ok');
});

Deno.test('degraded when the scheduler has stopped or the database is down', async () => {
  assertEquals((await handle(get(), deps('2026-10-25T09:00:00Z'))).status, 503, 'stale scheduler');
  assertEquals((await handle(get(), deps(null, true))).status, 503, 'db down');
});

Deno.test('details only with the secret, and never secrets themselves', async () => {
  const pub = await (await handle(get('wrong'), deps('2026-10-25T09:55:00Z'))).json();
  assertEquals(Object.keys(pub), ['status'], 'public');
  const priv = await (await handle(get('s3cret'), deps('2026-10-25T09:55:00Z'))).json();
  assertEquals(priv.configured, { email: true, ai: false, billing: true }, 'configured flags');
});
