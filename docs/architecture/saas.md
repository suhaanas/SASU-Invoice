# SASU Invoice cloud architecture

This describes how SASU Invoice grows from a browser-only invoice editor into a
multi-tenant SaaS (cloud invoices, clients, teams, RecoverFlow AI reminders and
subscriptions), and what exists today.

**Status:** All six phases are implemented and tested locally. Running it for real needs the accounts and setup in [../operations/runbook.md](../operations/runbook.md).

## Principles

1. **The editor keeps working without an account.** `app.html` stays local-first.
   Cloud saving is opt-in per browser and never replaces the browser copy.
2. **The database is the security boundary.** Every table has row-level security.
   The frontend's checks are UX only.
3. **One implementation of money and validation.** `src/core` (zod schemas, integer
   minor-unit totals) runs in the editor, the dashboard *and* the Edge Function.
4. **Browsers never write financial amounts.** Documents are written only through
   the `invoices` Edge Function, which re-validates and recomputes totals.
5. **No silent uploads, no silent deletes.** Importing browser data needs an
   explicit preview and confirmation; local data is never removed.

## System overview

```
Netlify (static, strict CSP)                 Supabase
 index.html      landing (vanilla TS)          Auth: email + password, verification, reset (PKCE)
 app.html        editor (vanilla TS) ─┐        Postgres + RLS  ◄── reads (user JWT, PostgREST)
 dashboard.html  React SPA ───────────┼──────► Edge Function `invoices` ──► save_invoice / import_invoices
                                      │          (service role; validates + recomputes totals)
 src/core  ◄── shared ──► supabase/functions/_shared/core (generated copy)
                                               Storage: private `org-assets` bucket (logos)
```

| Piece | Where | Notes |
| --- | --- | --- |
| Landing | `index.html`, `src/landing/` | Unchanged. |
| Editor | `app.html`, `src/main-app.ts` | Unchanged when signed out. Optional sync in `src/editor/cloud.ts` (lazy-loads supabase-js). |
| Dashboard | `dashboard.html`, `src/dashboard/` | React 19, react-router, TanStack Query, Tailwind 4, Lucide. Served under `/dashboard/*`. |
| Client view | `invoice.html`, `src/main-view.ts` | Vanilla TS, reuses the editor's sheet and PDF code. Opened from share links. |
| Billing | `supabase/functions/{billing,billing-webhook}`, `pay.html`, `pricing.html` | Paddle checkout, plan changes, webhooks; public pricing page. |
| RecoverFlow functions | `supabase/functions/{send-email,reminder-worker,email-webhook,ai-assistant}` | Email sending, the reminder queue worker, delivery webhooks, AI assistant. |
| Shared cloud client | `src/cloud/` | Config (env validation), Supabase client, document API, browser prefs. |
| Database | `supabase/migrations/` | Schema, RLS, RPCs. |
| Edge Function | `supabase/functions/invoices/` | The only write path for documents. |

## Data model

All tables live in `public` with RLS enabled. Helper functions live in the `app`
schema, which PostgREST does not expose.

| Table | Purpose | Key relationships / constraints |
| --- | --- | --- |
| `profiles` | Name and email per user | 1:1 with `auth.users` (created by trigger; email kept in sync). |
| `organizations` | A business (tenant) | `created_by → auth.users`; soft delete via `deleted_at`. |
| `organization_members` | Who belongs to which org, with role | PK `(org_id, user_id)`; `user_id → profiles`; trigger keeps at least one owner. |
| `organization_invitations` | Pending team invitations | Stores only `sha256(token)`; one pending invite per (org, email); expires in 7 days. |
| `organization_settings` | Business details, tax, numbering, payment text, logo path | 1:1 with organization. `business` JSON is re-validated with the editor's zod schema when read. |
| `plans` | Price list and limits (`cloud_invoices`, `users`, …) | Data, not code: change prices/limits without a deploy. |
| `subscriptions` | Org's plan and status | 1:1 with organization; only the billing backend writes. New orgs get a 14-day Pro trial. |
| `clients` | Clients per org | Created/linked automatically when a document is saved; archived, never hard-deleted. |
| `invoices` | All cloud documents (invoice, quote, credit note, receipt, proforma) | `document` = full editor JSON; scalar columns derived on save. `unique(org_id, local_id)`; issued numbers unique per series (case-insensitive). |
| `invoice_payments` | Payments ledger (Phase 2) | Integer minor units in the invoice's currency. Never edited: corrections are voids (with reason) plus a new row. |
| `invoice_shares` | Client share links (Phase 2) | Stores only `sha256(token)`; expiry 1–365 days; revocable; view count. |
| `audit_logs` | Append-only security/business events | Written only by security-definer functions. Members can read entries about invoices (invoice history); owners/admins read everything. |
| `account_deletion_requests` | GDPR-style deletion requests | One open request per user. Processed by an operator (see *Pending*). |

### Money

Amounts are `bigint` minor units (cents, pence, yen…), computed by
`src/core/calc.ts` → `computeTotals`. The Edge Function recomputes them; the
database never trusts client-supplied totals.

### Payments

Once an invoice has a ledger row, the ledger is the source of truth for the
amount paid. `app.apply_payments` recomputes `paid_minor`, `balance_minor` and a
payment-driven status (Unpaid ↔ Paid), and mirrors the amount paid and status
into the editor document, so the editor, PDF and client view all agree. An
editor save cannot override it; the save response tells the editor the
authoritative values, which it adopts. An "amount paid" typed before payments
were tracked becomes an `opening_balance` row on the first recorded payment.
Rules: issued invoices only, not cancelled, positive amounts, not dated in the
future, never more than the outstanding balance. Invoices with live payments
cannot be unlocked. "Partially paid" and "Overdue" are derived for display.

### Dashboard figures

`dashboard_summary(org, currency)` returns every overview number for **one
currency at a time**; the overview offers a currency picker and never adds
different currencies together. "Total invoiced" counts issued, non-cancelled
invoices (credit notes are not netted); "received" means recorded payments.
"Overdue" and "this month" use the organization's timezone. These are
invoicing figures, not accounting revenue.

### Share links and the client view

`create_invoice_share` (issued documents only) returns a random 244-bit
token once. The link is `/invoice.html#t=<token>`: the token sits in the URL
fragment, so it never reaches Netlify logs or a Referer header, and the page
sends `no-referrer`, `noindex` and `no-store`. `get_shared_invoice` (callable
anonymously) returns the document and its payment state only for a live link,
and counts the view. Revoking or expiry takes effect immediately.

## RecoverFlow AI (Phase 3)

```
pg_cron (every 5 min) ──► reminder-worker ──► rf_enqueue_due_reminders  (idempotent: unique (invoice, offset))
                                         ├─► rf_claim_jobs             (FOR UPDATE SKIP LOCKED + lease)
                                         └─► per job: rf_prepare_reminder (re-check eligibility, message row, fresh link)
                                                     → render template → Resend (Idempotency-Key: reminder:<job>)
                                                     → rf_mark_accepted | rf_mark_failed (backoff 2/4/8/16 min, then failed)
Resend webhooks ──► email-webhook (Svix signature, 5-min replay window) ──► rf_apply_email_event
dashboard ──► send-email (manual sends, Idempotency-Key: manual:<request uuid>)
dashboard ──► ai-assistant (drafts, rewrites, reply analysis, receivables summary)
```

**Tables:** `reminder_rules` (schedule, per org), `reminder_jobs` (one per invoice
and timing), `email_messages` (every email with provider state), `email_events`
(raw delivery events, unique per provider event), `email_suppressions` (bounced or
spam-reported addresses), `email_templates` (org overrides of the defaults),
`usage_counters` (monthly email/AI allowance), `ai_usage_logs` (action, model,
token counts and outcome only; never prompt or output text).

**When reminders go out.** Each organization chooses a send hour in its own
timezone and whether to skip weekends. A step whose date was missed by up to 3
days (weekend, outage) still fires; each invoice gets at most one reminder a day
(the latest due step wins; earlier missed steps are recorded as skipped). Steps
dated before the invoice was issued never fire.

**When they don't.** `app.reminder_block_reason` is checked when queueing *and*
right before sending: not issued, paid or cancelled, paused, disputed, reminders
off, plan without reminders, no client or no valid email, client opted out (from
their invoice link), or address suppressed after a bounce or spam report.
Paying in full, pausing, disputing, opting out and turning reminders off also
cancel waiting jobs immediately.

**Delivery states.** `queued → accepted` (the provider took it) `→ sent →
delivered`, or `bounced`, `complained`, `failed`. "Accepted" is never shown as
"delivered"; only the provider's webhook can say that. Events only move a
message forward, and are applied once per provider event id.

**Sender identity.** Mail is sent from the platform's verified address
(`EMAIL_FROM_ADDRESS`, a domain with SPF, DKIM and DMARC) as
`"<Business> via SASU Invoice"`, with the business email as Reply-To. Customers
cannot send as their own unverified domains.

**Templates.** Six defaults (new invoice, due soon, due today, overdue,
follow-up, payment received) live in `src/core/emails.ts`, shared by the
dashboard preview and the functions. Organizations can override any of them.
Placeholders are filled on the server; HTML email is escaped text with only the
invoice link turned into a link.

**AI assistant.** Server-side only (OpenAI chat completions with strict JSON
schemas, validated again with zod). Drafts receive no personal data: only the
email type, tone and facts like "12 days overdue"; they use placeholders the
server fills at send time. Pasted client replies have emails, phone numbers and
account or card numbers masked first. Drafts that mention legal action, courts,
debt collectors, credit scores and similar are discarded. The assistant never
changes data: "client says they paid" tells the user to check the bank; "possible
dispute" offers a button the user must press. Requests count against the plan's
monthly AI allowance.

## Subscription billing (Phase 4)

Paddle is the merchant of record: it sells to the customer, charges the right
VAT or sales tax and pays out to the business, which suits a Sri Lanka-based
company selling worldwide. Paddle sits behind a `BillingProvider` interface
(`supabase/functions/_shared/billing.ts`), so another provider can be added
without touching the app.

```
Billing page ──► billing (owner only) ──► billing_prepare (role, limits, price id)
                     ├─ no subscription: create a Paddle transaction → pay.html?_ptxn=… (Paddle.js checkout)
                     └─ has one: change plan in place (prorated), cancel at period end, resume,
                        customer portal (payment method), invoice list and PDFs
Paddle ──► billing-webhook (Paddle-Signature, 5-min window) ──► billing_apply_subscription_event
```

- **Only signed webhooks change a plan.** Returning from checkout just starts a
  "waiting for Paddle" state that polls until the webhook lands.
- **Idempotent and ordered.** Each Paddle event id is applied once
  (`subscription_events`), and an event older than the last applied one is
  recorded as stale instead of overwriting newer state.
- **Bound to one organization.** The org id goes into the checkout's custom
  data; once a subscription id belongs to an organization, events can't move it.
- **Prices are data.** `plans` holds names, prices and limits (shown on the
  pricing page and enforced in SQL); `plans.provider_price_id` maps each plan
  to the Paddle price for that environment (`supabase/setup/billing-prices.sql`).
- **Downgrades are checked first.** A plan that would leave the organization
  above its document or seat limits is refused, with the reason shown.
- **States.** Paddle `active`, `trialing`, `past_due` (access kept while Paddle
  retries), `canceled` (access until the paid period ends), `paused` (no paid
  access). After that the organization is on Free: cloud documents stay
  readable; new cloud documents, reminders and AI stop.
- **Exposure.** Provider ids (customer, subscription, price) are never readable
  from the browser; the event log is visible to the organization's owner only.
- **Card data** never touches SASU Invoice: checkout runs in Paddle's iframe.
  The CSP allows `cdn.paddle.com` scripts and `*.paddle.com` frames, and the
  Permissions-Policy allows the Payment Request API for Paddle's checkout
  origins only.

## Recurring invoices, reports, permissions and admin (Phase 5)

**Recurring invoices.** Any invoice can be set to repeat weekly, monthly,
quarterly, annually or every *n* weeks/months/years, from a start date until an
optional end date, as drafts or issued automatically (optionally emailed).

- Dates are `start + k × period`, computed identically in TypeScript
  (`src/core/recurrence.ts`) and SQL (`app.recurring_date`), so 31 January
  becomes 28 February then 31 March, not the 28th forever.
- The scheduler (the same pg_cron worker) claims due schedules with a lease,
  builds each invoice from the template with the shared core (fresh ids, new
  dates, same payment terms, nothing paid), and `rf_complete_recurring` assigns
  the next number in the series and saves it, at most once per schedule and
  date (`recurring_runs` unique key). A failed run (for example a plan limit)
  is shown on the schedule and retried an hour later.
- Pausing and resuming skips missed periods rather than back-filling them.
- Numbers are assigned on the server from the organization's prefix
  (`app.next_document_number`). A browser draft using the same number would be
  refused when issued and need renumbering.

**Reports.** `report_summary(org, currency, from, to, client?, member?)`
returns invoiced, credited, received, still-owed and overdue totals, a monthly
series, top clients, status counts, email activity and recurring activity for
one currency. The Reports page exports each table plus full invoice and payment
lists to CSV (formula injection neutralised) and prints cleanly to PDF.

**Member permissions.** Owners and admins can do everything. Each member has
switches (all on by default): record payments, send emails, add/edit clients,
view reports. They are enforced in the database (RLS on clients; triggers on
payments and emails; checks in reports and recurring email schedules), not just
hidden in the UI.

**Platform admin.** `platform_admins` (granted only via SQL,
`supabase/setup/platform-admin.sql`) unlocks `/dashboard/admin`: platform
totals, subscriptions and estimated monthly recurring revenue per currency,
health counters (failed or stuck reminder jobs, email problems, recurring and
billing errors, AI errors), an organization directory with metadata and counts
only, and feature switches (`ai_assistant`, `automatic_reminders`,
`recurring_invoices`) that the functions obey. Admins are not organization
members, so RLS still keeps them out of customer data; every admin call is
written to the audit log.

### Locked documents

Once a document is issued (`issued_at` set), a trigger blocks any change except
its status, the amount paid and the "how to pay" details, matching the editor's
lock. Owners and admins can unlock (audited); members cannot. Issued documents
cannot be deleted; drafts can (soft delete).

## Authorization model

| Action | Owner | Admin | Member | Other orgs |
| --- | --- | --- | --- | --- |
| Read org documents, clients, settings, members | ✓ | ✓ | ✓ | ✗ |
| Save documents (via Edge Function) | ✓ | ✓ | ✓ | ✗ |
| Unlock issued documents | ✓ | ✓ | ✗ | ✗ |
| Edit business settings, logo | ✓ | ✓ | ✗ | ✗ |
| Invite members / admins | ✓ / ✓ | ✓ / ✗ | ✗ | ✗ |
| Change roles | ✓ | ✗ | ✗ | ✗ |
| Read audit log | ✓ | ✓ | invoice history only | ✗ |
| Record payments | ✓ | ✓ | ✓ | ✗ |
| Void payments | ✓ | ✓ | ✗ | ✗ |
| Create / revoke share links | ✓ | ✓ | ✓ | ✗ |
| Manage clients (create, edit, archive) | ✓ | ✓ | ✓ | ✗ |
| Send emails, pause reminders, mark disputes | ✓ | ✓ | ✓ | ✗ |
| Turn reminders on/off, edit schedule and wording, unblock addresses | ✓ | ✓ | ✗ | ✗ |
| Read AI usage logs | ✓ | ✓ | ✗ | ✗ |
| Recurring schedules (create, edit, pause, cancel) | ✓ | ✓ | ✓ | ✗ |
| Change member permission switches | ✓ | ✓ | ✗ | ✗ |
| Choose, change or cancel the plan; payment method; billing invoices | ✓ | ✗ | ✗ | ✗ |
| See the plan and usage | ✓ | ✓ | ✓ | ✗ |
| Change subscription | billing backend only | | | |

How it is enforced:

- **RLS** on every table, using `app.is_member(org)` / `app.has_role(org, roles)`.
- **Column-level grants** stop mass assignment (for example, `organizations.created_by`
  and `subscriptions.*` cannot be written from the browser).
- **Security-definer RPCs** for multi-step changes (`create_organization`,
  `create_invitation`, `accept_invitation`, `remove_member`, …), each re-checking
  the caller's role. All set `search_path = ''`.
- **Service-only RPCs** (`save_invoice`, `import_invoices`) cannot be executed by
  `anon` or `authenticated`; the Edge Function passes the user id from the
  verified JWT, never from the request body.
- **Storage**: objects live under `<org_id>/…` and policies check membership of that org.

Custom SQLSTATEs map to HTTP statuses: `SA401` 401, `SA402` plan limit (402),
`SA403` 403, `SA404` 404, `SA409` conflict (409), `SA422` 422, `SA423` locked (423).

## Editor ↔ cloud

- **Opt-in:** *Dashboard → This browser → Cloud saving* stores the target org in
  `localStorage` (`sasu:v3:cloudSync`). Opening a cloud document from the dashboard
  also turns it on for that org.
- **Flow:** the editor saves to `localStorage` exactly as before, then queues an
  upload (debounced, skipped when nothing changed). Offline uploads retry when the
  browser comes back online.
- **Conflicts:** optimistic concurrency on `invoices.revision`. On conflict the
  cloud copy is not overwritten and the local copy is kept.
- **Opening:** `app.html?doc=<cloud id>` loads the cloud version into the editor.
- **Legacy ids:** pre-UUID document ids map to a stable derived UUID
  (`cloudDocId`), so importing twice is always detected.

## Import from the browser

*Dashboard → This browser → Import* lists every valid local document, marks those
already in the organization, and uploads the selected ones only after a
confirmation that states what will be stored. Records that failed validation
earlier stay quarantined and are never uploaded. Results are reported per document
(imported / already in the cloud / failed with reason). Nothing local is deleted.

## Environment variables

| Name | Where | Secret? |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Netlify build env, `.env.local` | No (public) |
| `VITE_SUPABASE_ANON_KEY` | Netlify build env, `.env.local` | No (public; RLS protects data) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Edge Function runtime (automatic); never in the frontend | **Yes** |
| `ALLOWED_ORIGINS` | `supabase secrets set` | No; comma-separated origins allowed by CORS |
| `APP_URL` | `supabase secrets set` | No; base URL for client links in emails |
| `RESEND_API_KEY` | `supabase secrets set` | **Yes** |
| `EMAIL_FROM_ADDRESS` | `supabase secrets set` | No; an address on the Resend-verified domain |
| `RESEND_WEBHOOK_SECRET` | `supabase secrets set` | **Yes** (`whsec_…`) |
| `WORKER_SECRET` | `supabase secrets set` and Vault (`supabase/setup/schedule-reminders.sql`) | **Yes** |
| `OPENAI_API_KEY` | `supabase secrets set` | **Yes**; optional, the assistant is off without it |
| `VITE_PADDLE_CLIENT_TOKEN`, `VITE_PADDLE_ENV` | Netlify build env | No (client-side token; `sandbox` or `live`) |
| `PADDLE_API_KEY` | `supabase secrets set` | **Yes** |
| `PADDLE_ENVIRONMENT` | `supabase secrets set` | No (`sandbox` or `live`) |
| `PADDLE_WEBHOOK_SECRET` | `supabase secrets set` | **Yes** |
| `OPENAI_MODEL` | `supabase secrets set` | No; a current model with structured outputs (default `gpt-4.1-mini`) |
| `SUPABASE_DB_URL`, `SUPABASE_PROJECT_REF` | Local `.env.local` for deploys | **Yes** (DB password) |

Without the two `VITE_` variables the build still succeeds: the dashboard shows
"Cloud workspace unavailable" and the editor stays local-only.

## Deploying

1. Create Supabase projects for **staging** and **production**.
2. `supabase link --project-ref <ref>` then `supabase db push` (applies `supabase/migrations`).
3. `supabase config push` (auth settings from `supabase/config.toml`; check redirect URLs first).
4. `supabase secrets set ALLOWED_ORIGINS=https://sasuinvoice.netlify.app`
5. `npm run functions:sync && supabase functions deploy` (deploys `invoices`, `send-email`,
   `reminder-worker`, `email-webhook`, `ai-assistant`; JWT checks per `config.toml`)
5a. Email: verify a sending domain in Resend (SPF, DKIM; add a DMARC record), set the
   email secrets above, and add a webhook to
   `https://<ref>.supabase.co/functions/v1/email-webhook` for the `email.*` events.
5b. Scheduler: run `supabase/setup/schedule-reminders.sql` once (pg_cron + pg_net,
   secrets in Vault).
5c. Billing: in Paddle, create the Pro and Business prices, set the **default
   payment link** to `https://<site>/pay.html`, approve the domain, and add a
   notification destination `https://<ref>.supabase.co/functions/v1/billing-webhook`
   for `subscription.*` and `transaction.*` events. Then run
   `supabase/setup/billing-prices.sql` and set the Paddle secrets. Use the
   sandbox for staging and the live account for production.
6. In Netlify, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` per deploy context
   (production vs. deploy previews pointing at staging), then deploy.
7. In Supabase Auth, configure a custom SMTP sender before launch; the built-in
   sender is rate-limited and meant for development.

Rollback: Netlify keeps previous deploys (one click). Database migrations are
forward-only; write a new migration to revert a change and test it on staging first.

## Testing

| Command | What it covers |
| --- | --- |
| `npm test` | Editor and dashboard unit tests (Vitest + jsdom), including XSS rendering tests. |
| `npm run test:functions` | All Edge Functions (Deno): auth, validation, server-side totals, CORS, error mapping, Svix signatures, Resend requests and retry classification, the worker loop, manual sends, AI guardrails, redaction and allowance. |
| `PG_ADMIN_URL=… npm run test:db` | Migrations + 261 SQL checks on plain PostgreSQL with Supabase's auth/storage emulated: cross-tenant isolation, write paths, locked documents, plan limits, invitations, storage, payments ledger rules, share links, dashboard aggregates, and the reminder queue (send hours, weekends, idempotency, leases, backoff, crash recovery, cancellation, opt-out, webhook ordering, suppression, usage limits) and billing (ownership, downgrade guards, webhook idempotency and ordering, subscription hijack, provider-id exposure), recurring runs, reports, member permissions and admin isolation, plus a catalog audit (RLS on every table, function allow-lists for anon and signed-in users, pinned search_path on every security-definer function, no browser write access to financial tables). |
| `npm run functions:check` | The Edge Function's copy of `src/core` is up to date. |
| `npm run test:e2e` | Playwright in Google Chrome against the production build with production headers: the original editor end to end (build, autosave, issue, PDF), pricing, the client invoice view (mocked backend), signed-out dashboard flows, security headers. |

All of these run in CI (`.github/workflows/ci.yml`); the database job uses a Postgres
service container, so no secrets are needed.

## Roadmap

| Phase | Scope | Status |
| --- | --- | --- |
| 1. Foundation | Auth, organizations, roles, invitations, schema + RLS, onboarding, cloud documents, editor sync, browser import | **Done** |
| 2. Core business | Clients (list, profile, create/edit/archive, balances, "new invoice for client"), payments ledger with void, partially paid / overdue statuses, invoice detail with history, overview KPIs and charts per currency, invoice filters and sorting, header search, share links and client invoice view | **Done** |
| 3. RecoverFlow AI | Email sending (Resend) with delivery webhooks and suppression, editable templates, reminder schedule on a durable queue (pg_cron, skip-locked leases, idempotency keys, backoff), pause / dispute / client opt-out, AI drafting, rewriting, reply analysis and receivables summary with usage limits | **Done** |
| 4. Monetization | Paddle behind a `BillingProvider` interface, checkout, signed idempotent webhooks, upgrade/downgrade with limit checks, cancel/resume, customer portal, billing history, usage display, public pricing page | **Done** |
| 5. Advanced | Recurring invoices, reports and CSV/PDF exports, member permission switches, platform admin console with feature switches | **Done** |
| 6. Production readiness | Schema security audit in CI, rate limits, health endpoint and scheduler heartbeat, route-level code splitting, Playwright E2E, production env check, operations runbook | **Done** |

## Pending / known gaps

- **Supabase project and deploy:** migrations and the function have been verified
  on plain PostgreSQL and Deno locally, not yet on a hosted Supabase project.
- **Terms of service and privacy notice:** sign-up asks for agreement, but the
  documents themselves still need to be written and linked.
- **Account deletion:** requests are recorded; an operator procedure (export,
  ownership transfer, deletion, confirmation email) still needs defining.
- **Invitation emails** are not sent yet (owners copy a link) until Phase 3 email.
  Share links are likewise copied by hand until invoice emails exist.
- **Void vs. cancelled:** the editor's "Cancelled" status is used for void
  invoices; a separate "Void" status would need an editor data-model change.
- **Client view verification:** the brief asks for extra verification before
  showing sensitive details. Links currently rely on token secrecy, expiry and
  revocation; an optional email one-time code is a candidate for Phase 3.
- **Notifications** (header bell) are not built; email problems show on the
  RecoverFlow page and invoice pages instead.
- **Custom sending domains** per organization (send as `billing@client-domain`
  after DNS verification) are not built; all mail uses the platform domain.
- **Inbound replies** aren't received by the platform; users paste a client's
  reply into the assistant. Replies go to the business's own inbox.
- **PDF attachments:** emails link to the private invoice page (with PDF
  download) rather than attaching a PDF.
- **Paddle.js** can't be version-pinned or self-hosted (Paddle requires its CDN
  build); it is loaded only on `pay.html`.
- **Annual billing** isn't offered yet; add yearly prices to `plans` and Paddle.
- **Assigned clients:** members see all of the organization's clients; limiting
  a member to assigned clients is not built.
- **AI model choice:** `OPENAI_MODEL` defaults to `gpt-4.1-mini`; confirm a current
  model with structured-output support before launch.
- **Dark mode:** the dashboard, like the editor, is light-only.
- **React fast refresh in dev:** `@vitejs/plugin-react` conflicts with
  `vite-plugin-pwa`'s Babel dependency tree today, so dev uses full reloads. JSX
  is compiled by Vite's built-in oxc transform.

## Production hardening (Phase 6)

- **Schema audit in CI** (`supabase/tests/sql/06_audit.sql`) reads the
  Postgres catalog: a table without RLS, a function callable by `anon` or
  signed-in users outside the allow-list, a security-definer function without
  a pinned `search_path`, or browser write access to a financial table fails
  the build.
- **Rate limits** per user and action in the user-facing functions (fixed
  one-minute windows in Postgres): saving 120, emails 20, AI 10, billing 10.
  They fail open if the counter is unreachable, since every other check still
  applies.
- **Health and heartbeat.** The scheduler records a heartbeat each run;
  `GET /functions/v1/health` returns 503 when the database is unreachable or the
  scheduler hasn't run for 15 minutes, and the admin console shows the same.
- **Performance.** Dashboard pages load on demand; the first download fell from
  136 KB to 79 KB (gzipped). supabase-js is never loaded by the editor unless
  cloud saving is on.
- **Deploy safety.** Production builds run `npm run check:env`, which fails on
  missing cloud configuration or a server secret named `VITE_*`.

Operations (environments, first deploy, releases, monitoring, incidents,
secret rotation, backups, rollback, data requests, launch checklist):
[../operations/runbook.md](../operations/runbook.md).
