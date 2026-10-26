# Security controls

What protects SASU Invoice in production, and what was hardened for launch
(2026-10-26). Operational steps (secrets, rotation, incidents) are in
[runbook.md](runbook.md).

## Accounts and sign-in
- Supabase Auth with email confirmation, Google sign-in (OAuth + PKCE), refresh-token rotation and 1-hour JWTs.
- **Passwords:**
  - At least 12 characters, with upper- and lowercase letters, a digit and a symbol. Supabase enforces this
    server-side (`supabase/config.toml`).
  - The browser also rejects guessable passwords: common words, runs like `1234`, repeats, or the email name
    (`src/core/password.ts`).
  - Changing or resetting a password signs out every other device.
- **Bot protection:** Cloudflare Turnstile on sign-up, sign-in and password reset. Off until
  `npm run setup:turnstile` runs with the keys; Supabase then verifies every token server-side.
- **Rate limits:** Supabase Auth (`[auth.rate_limit]`) plus per-user limits on every Edge Function
  (`rf_rate_limit`).
- **Not available on the free plan:** leaked-password (HaveIBeenPwned) checks need Supabase Pro.

## Data access
- Row Level Security on every table. Organization isolation is tested in `supabase/tests/sql/01–07`.
- Column grants hide provider ids and secrets. Security-definer functions use `set search_path = ''`, which a
  catalog audit test enforces.
- Writes that need business rules go through server-only RPCs (`save_invoice`, `billing_*`, `rf_*`) called
  by Edge Functions.
- **Live updates:**
  - Private Realtime Broadcast topics, one per organization.
  - Messages carry only `{table, op, id}`.
  - Only members can receive (RLS on `realtime.messages`), and no client can publish.

## Payments (Paddle, Merchant of Record)
- Card details never touch our pages or servers. Checkout runs in Paddle's frame.
- **Webhooks:**
  - The HMAC signature is checked on the raw body with a constant-time compare and a 5-minute replay window.
  - Events are idempotent by event id, and older events never overwrite newer state.
- **Checkout binding (fixed for launch):**
  - Paddle.js lets a browser set `custom_data`, so a checkout could carry another organization's id.
  - Checkouts now carry an HMAC tag of the organization id (server secret). The webhook ignores untagged ids.
  - The database refuses a second active subscription, or a different Paddle customer, for an organization.
- Plans change only through verified webhooks, never because someone returned from checkout.
- `/pay.html`: no-store, no referrer, noindex. Prefilled email and country travel in sessionStorage and are
  validated.

## Edge Functions
- Bearer JWT checks. CORS allows only `ALLOWED_ORIGINS`.
- **Input:**
  - zod schemas on every body; unknown fields are dropped.
  - Bodies are size-capped before parsing (413).
- SQL errors are mapped to safe messages. Provider errors are logged by code only.

## Browser
- **Headers:**
  - Strict CSP (no inline scripts except JSON-LD data). Allowed third parties: Paddle, Supabase and
    Cloudflare Turnstile.
  - HSTS preload, `X-Frame-Options: DENY`, COOP/CORP, Permissions-Policy.
- **Rendering:** user data is rendered as text. ESLint bans `innerHTML`, `dangerouslySetInnerHTML`,
  `document.write`, and the jsPDF APIs with advisories.
- **Links:** payment links must be `https:`; everything else is `mailto:` or same-site.
- **Calendar dates:** never go through UTC, so invoice dates can't shift a day (ESLint rule).

## Dependencies
- `npm audit --omit=dev` is clean as of 2026-10-26. zod was upgraded to 4.6.7 and DOMPurify to 3.4.17.
  Edge Functions pin the same zod.

## Test data
- Unpaid Paddle test checkouts from launch testing (`txn_01m5v9r3…`, `txn_01m5v9s5…`, `txn_01m5vajr…`,
  `txn_01m5vamr…`, `txn_01m5vb34…`) can't be deleted and never charge. The launch-test discount is archived.
