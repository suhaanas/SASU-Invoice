# SASU Invoice operations runbook

How to run SASU Invoice in staging and production: first deploy, routine
releases, monitoring, incidents, backups, rollback and data requests. The
architecture behind it is in [../architecture/saas.md](../architecture/saas.md).

## Environments

| | Staging | Production |
| --- | --- | --- |
| Website | Netlify deploy previews and branch deploys | Netlify production (`main`) |
| Supabase | Project `sasu-staging` | Project `sasu-production` |
| Paddle | Sandbox account (`PADDLE_ENVIRONMENT=sandbox`, `VITE_PADDLE_ENV=sandbox`) | Live account (`live`) |
| Resend | Same account, staging sending subdomain | Production sending domain |
| OpenAI | Separate key with a low monthly budget | Production key with a budget alert |

Keep the two Supabase projects fully separate: different keys, different Vault
secrets, different Paddle price ids (`supabase/setup/billing-prices.sql`). In
Netlify, set the `VITE_*` variables per deploy context so previews point at
staging and production points at production. Production builds run
`npm run check:env` first: it always fails if a server secret is about to be
bundled, and, once you set `REQUIRE_CLOUD=1` in Netlify, also if the cloud
configuration is missing.

## First deploy (per environment)

**Automated path:** create a Supabase personal access token (Account → Access
Tokens), put `SUPABASE_ACCESS_TOKEN=…` in `.env.local`, and run
`scripts/setup-supabase.sh` (set `PROJECT_NAME=sasu-production` for
production). It does steps 1–6 below: creates the project (London, smallest
size), writes the keys to `.env.local`, applies migrations, sets function
secrets (including any Resend/Paddle/OpenAI keys already in `.env.local`),
deploys all functions without Docker, pushes auth settings and schedules the
worker. It is safe to re-run after adding more keys. If you're already signed
in with `supabase login`, no token is needed. Then run `npm run smoke:live`:
it exercises sign-in, organizations, saving/issuing, payments, share links and
tenant isolation against the real project with throwaway users, and cleans up.
Also run `supabase db advisors --linked`; the only expected warnings are the
intentional user/anon RPCs. The manual steps are below for reference.

Resend and Paddle have their own scripts. Put the keys in `.env.local` and run:

- `npm run setup:resend` needs `RESEND_API_KEY`, and optionally `RESEND_DOMAIN`. It adds the
  domain and prints its DNS records until it verifies. Until then it sends from
  `onboarding@resend.dev`, which only reaches your own Resend address. It also
  creates the delivery webhook and saves `RESEND_WEBHOOK_SECRET` and `EMAIL_FROM_ADDRESS`.
- `npm run setup:paddle` needs `PADDLE_API_KEY` and `VITE_PADDLE_CLIENT_TOKEN`. It reads
  live or sandbox from the key, then creates the Pro and Business products and prices
  and the notification destination. It also links `plans.provider_price_id` and saves
  `PADDLE_WEBHOOK_SECRET`. One step is manual: approve the domain under Paddle → Settings →
  Website approval, then set the default payment link to `https://<site>/pay.html`.

- `npm run setup:google` needs `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` from a Google Cloud
  OAuth client of type "Web application". Give that client the origin `https://<site>` and the
  redirect URI `https://<ref>.supabase.co/auth/v1/callback`. The script adds the provider to
  `supabase/config.toml`, where both values are read through `env()`, pushes the auth settings,
  and checks that Google is on. The sign-in pages show "Continue with Google" automatically once
  Supabase reports Google as enabled.

Both scripts can be re-run safely, and both finish by re-running `setup:supabase` to push
the secrets and redeploy the functions. The AI assistant stays "coming soon" until
`OPENAI_API_KEY` is set and an admin turns on the `ai_assistant` switch.

Work through these in order. Everything marked **secret** goes into
`supabase secrets set`, never into Netlify or a `VITE_` variable.

1. **Supabase project.** Create it (region close to your customers). Enable
   point-in-time recovery on a paid plan (see *Backups*).
2. **Database.** `supabase link --project-ref <ref>` then `supabase db push`.
3. **Auth.** Check redirect URLs in `supabase/config.toml`, then
   `supabase config push`. Set up custom SMTP for auth emails (Resend works).
4. **Edge Functions.** Set the secrets `ALLOWED_ORIGINS`, `APP_URL`, `WORKER_SECRET`
   (**secret**), then `npm run functions:sync && supabase functions deploy`.
5. **Email (Resend).** Verify the sending domain with SPF and DKIM and add a
   DMARC record (start with `p=none`, move to `quarantine` once reports are
   clean). Set `RESEND_API_KEY` (**secret**), `EMAIL_FROM_ADDRESS`, and add a
   webhook to `…/functions/v1/email-webhook` for `email.*` events; set
   `RESEND_WEBHOOK_SECRET` (**secret**).
6. **Scheduler.** Run `supabase/setup/schedule-reminders.sql` with the worker URL
   and `WORKER_SECRET`. It drives reminders and recurring invoices.
7. **Billing (Paddle).** Create Pro and Business prices, set the default payment
   link to `https://<site>/pay.html`, approve the domain, add a notification
   destination for `…/functions/v1/billing-webhook` (`subscription.*`,
   `transaction.*`). Set `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET` (**secrets**)
   and `PADDLE_ENVIRONMENT`; run `supabase/setup/billing-prices.sql`.
8. **AI (optional).** Set `OPENAI_API_KEY` (**secret**) and `OPENAI_MODEL` (a current
   model with structured outputs). Set a monthly budget in the OpenAI dashboard.
9. **Website.** In Netlify set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
   `VITE_PADDLE_CLIENT_TOKEN`, `VITE_PADDLE_ENV`, and `REQUIRE_CLOUD=1` for the
   production context, then deploy.
10. **Admins.** Run `supabase/setup/platform-admin.sql` for each platform admin.
11. **Smoke test** (staging first): register, confirm email, onboard, create an
    invoice with cloud saving on, record a payment, share the link, send an
    email to yourself, enable reminders, buy Pro with a Paddle sandbox card,
    check `/dashboard/admin` health is all zero and the scheduler is fresh.

## Releasing

1. Open a pull request. CI runs lint, unit tests, the 250+ database security
   checks, the Edge Function tests, the end-to-end tests and the build.
2. Merge to a staging branch (or let the preview deploy), then apply
   migrations to staging: `supabase db push --linked` (staging project linked).
3. Deploy changed functions to staging and run the smoke test above.
4. Merge to `main`. Apply migrations to production **before** the website
   deploy finishes (new code expects the new schema; migrations are written
   to be compatible with the previous release while it is still live).
5. Deploy functions to production, then watch `/dashboard/admin` and the
   health endpoint for 15 minutes.

**Migration rules:** additive first (new columns nullable or defaulted, new
functions alongside old ones); remove things only in a later release; never edit
a migration that has run anywhere; test every migration on staging with a copy
of realistic data volume.

## Monitoring

| Signal | Where | Alert when |
| --- | --- | --- |
| Uptime | `GET /functions/v1/health` (public: `{status}`; with `x-worker-secret`: details) | non-200 for 5 minutes |
| Scheduler | Health endpoint, admin console "scheduler" | last run older than 15 minutes |
| Reminder jobs | Admin console health | any stuck job, or failures rising |
| Email | Admin console; Resend dashboard | bounces or spam reports rising (protect domain reputation) |
| Billing | Admin console "billing webhook errors" | any error (usually an unknown price id) |
| AI | Admin console; OpenAI usage page | errors rising, or spend near budget |
| Database | Supabase reports | CPU or connections high, slow queries |
| Function logs | Supabase → Edge Functions → Logs (JSON lines with `fn`) | `error` entries |

Point an uptime service (Better Stack, UptimeRobot…) at the health endpoint.
Front-end error tracking (for example Sentry) is not installed yet; if you
add one, allow its host in `connect-src` in `netlify.toml`.

## Incidents

**First move: switch the feature off.** The admin console has switches for
`automatic_reminders`, `recurring_invoices` and `ai_assistant`; the functions
obey them within one run. Then investigate.

| Symptom | Check | Fix |
| --- | --- | --- |
| Reminders not going out | Health → scheduler stale? `select * from cron.job_run_details order by start_time desc limit 10;` | Re-run the schedule script; check `WORKER_SECRET` matches Vault |
| Reminders failing | Admin health, RecoverFlow page alerts, function logs | Provider key/domain; jobs retry with backoff, failed ones show on invoices |
| Emails bounce | Blocked addresses list | Fix the client address with the customer, then unblock |
| Plan didn't change after payment | `select * from subscription_events order by received_at desc` | Unknown price → run `billing-prices.sql`; signature errors → `PADDLE_WEBHOOK_SECRET`; Paddle retries failed deliveries |
| Recurring invoice missing | Recurring page shows the last error (often a plan limit) | Fix the cause; it retries hourly |
| Users see 429 | Rate limits (per user per minute: save 120, email 20, AI 10, billing 10) | Raise in the function if legitimate |
| Suspected data exposure | Audit log, function logs | Revoke keys (below), preserve logs, notify affected customers and the ICO within 72 hours if personal data is involved (UK GDPR) |

## Rotating secrets

Rotate on staff changes and at least yearly. Order: create the new secret at
the provider, `supabase secrets set …`, redeploy the functions, then revoke the
old one. For `WORKER_SECRET`, update Vault (`vault.update_secret`) at the same
time. The service-role key is rotated from Supabase settings (JWT secret
rotation invalidates all sessions, so plan it).

## Backups and restore

- Enable Supabase **point-in-time recovery** in production; daily backups
  alone can lose up to a day.
- Practise a restore every quarter: restore to a new project, run
  `npm run test:db`-style checks against it, and time it.
- Storage (logos) is not covered by database backups; it is low-risk but can be
  copied with the S3-compatible API if needed.
- Users can also download their data: CSV exports in Reports, and the editor's
  JSON backup for browser data.

## Rollback

- **Website:** Netlify → Deploys → publish the previous deploy (instant).
- **Functions:** redeploy the previous git tag: `git checkout <tag> && npm run functions:sync && supabase functions deploy`.
- **Database:** migrations are forward-only. Write a new migration that reverses
  the change and ship it through staging. For data damage, use point-in-time
  recovery to a new project and copy the affected rows back.

## Data requests (UK GDPR and similar)

- **Access/export:** organization owners export invoices and payments as CSV
  (Reports); provide the profile and audit entries on request.
- **Account deletion requests** arrive in `account_deletion_requests`. Process
  within one month:
  1. Confirm the request by email from the account's address.
  2. If they own organizations, ask them to transfer ownership or confirm the
     organization should be closed.
  3. Invoices are business records that the *organization* may have to keep
     (UK: 6 years for tax). Remove the person, not the organization's records:
     delete the auth user (cascades to profile and memberships); audit entries
     keep only the user id.
  4. Mark the request `completed` and reply.
- **Sub-processors** to list in the privacy notice: Supabase (database, auth,
  storage, functions), Netlify (hosting), Resend (email), Paddle (payments,
  merchant of record), OpenAI (AI assistant, no prompt retention by our
  logging; check the API data-use terms), plus your email/SMTP provider.

## Security checklist before launch

- [ ] Terms of service and privacy notice written and linked from sign-up
- [ ] Staging and production fully separate; no production data in staging
- [ ] All secrets set only in Supabase; `npm run check:env` passes in Netlify
- [ ] DMARC record published; SPF/DKIM verified
- [ ] Paddle live account approved for the domain; webhook verified with a test event
- [ ] Point-in-time recovery enabled; one restore rehearsed
- [ ] Uptime monitor on the health endpoint; alerts reach a person
- [ ] Platform admins limited to the people who need it
- [ ] Supabase Auth: leaked-password protection and rate limits reviewed
- [ ] OpenAI budget alert set
