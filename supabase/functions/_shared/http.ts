/**
 * HTTP helpers shared by Edge Functions: CORS restricted to known origins,
 * JSON responses, and mapping of our SQL error codes to HTTP statuses.
 */

/** Comma-separated list, e.g. "https://sasuinvoice.netlify.app,http://localhost:5173". */
export function allowedOrigins(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function corsHeaders(origin: string | null, allowed: string[]): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
  if (origin && allowed.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

export function json(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

/** SQLSTATEs raised by our SQL functions (see migrations) → HTTP status. */
const SQL_STATUS: Record<string, number> = {
  SA401: 401,
  SA402: 402,
  SA403: 403,
  SA404: 404,
  SA409: 409,
  SA422: 422,
  SA423: 423,
  '42501': 403,
};

export interface SqlError {
  code?: string;
  message?: string;
}

/** Our own errors carry user-safe messages; anything else is reported generically. */
export function sqlErrorResponse(err: SqlError, headers: Record<string, string>): Response {
  const status = (err.code && SQL_STATUS[err.code]) || 500;
  const message =
    status === 500 ? 'Something went wrong. Please try again.' : (err.message ?? 'Request failed');
  return json(status, { error: message, code: err.code ?? 'internal' }, headers);
}
