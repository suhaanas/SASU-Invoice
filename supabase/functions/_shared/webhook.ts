/**
 * Webhook signature checks. Resend signs webhooks with Svix:
 *   signature = base64(HMAC-SHA256(secret, `${id}.${timestamp}.${body}`))
 * sent as "v1,<sig> v1,<sig2>" in `svix-signature`. The secret is "whsec_<base64>".
 */

const encoder = new TextEncoder();

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function bytesToBase64(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

/** Constant-time comparison of two strings. */
export function safeEqual(a: string, b: string): boolean {
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export async function svixSignature(
  secret: string,
  id: string,
  timestamp: string,
  body: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    base64ToBytes(secret.replace(/^whsec_/, '')),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return bytesToBase64(
    await crypto.subtle.sign('HMAC', key, encoder.encode(`${id}.${timestamp}.${body}`)),
  );
}

export async function verifySvix(
  secret: string,
  headers: Headers,
  body: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  const id = headers.get('svix-id');
  const timestamp = headers.get('svix-timestamp');
  const signatures = headers.get('svix-signature');
  if (!id || !timestamp || !signatures || !/^\d+$/.test(timestamp)) return false;
  // Reject replays outside a 5-minute window.
  if (Math.abs(nowSeconds - Number(timestamp)) > 300) return false;
  const expected = await svixSignature(secret, id, timestamp, body);
  return signatures
    .split(' ')
    .map((s) => s.split(',', 2))
    .some(([version, sig]) => version === 'v1' && !!sig && safeEqual(sig, expected));
}
