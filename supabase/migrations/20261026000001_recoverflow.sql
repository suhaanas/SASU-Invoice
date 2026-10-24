-- Phase 3: RecoverFlow AI. Email sending, automatic payment reminders on a
-- durable job queue, delivery tracking, suppression, usage limits and AI logs.
--
-- Reliability model
--   * rf_enqueue_due_reminders() turns "rule + invoice + today" into at most
--     one reminder_jobs row per (invoice, rule) — the unique key makes it
--     idempotent, so it can run as often as we like.
--   * rf_claim_jobs() hands jobs to a worker with FOR UPDATE SKIP LOCKED and a
--     lease; a crashed worker's jobs become claimable again when the lease ends.
--   * Every send has an idempotency key ("reminder:<job id>") stored on
--     email_messages and passed to the provider, so a retry after a crash
--     cannot email the client twice.
--   * Eligibility is checked again right before sending; paid, paused,
--     disputed, opted-out or suppressed invoices are cancelled, not sent.
--   * Failures retry with exponential backoff (2, 4, 8, 16 min), then fail visibly.
--
-- Service-only functions are prefixed rf_ and executable by service_role only.

-- Settings ---------------------------------------------------------------------------------

alter table public.organization_settings
  add column email_from_name text not null default '' check (length(email_from_name) <= 80),
  add column email_reply_to text not null default ''
    check (email_reply_to = '' or email_reply_to ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  add column email_signature text not null default '' check (length(email_signature) <= 1000),
  add column reminders_enabled boolean not null default false,
  add column reminder_send_hour integer not null default 9 check (reminder_send_hour between 0 and 23),
  add column reminders_weekdays_only boolean not null default true;

grant update (email_from_name, email_reply_to, email_signature, reminder_send_hour, reminders_weekdays_only)
  on public.organization_settings to authenticated;

alter table public.clients add column reminders_opted_out_at timestamptz;

alter table public.invoices
  add column reminders_paused_at timestamptz,
  add column dispute_opened_at timestamptz,
  add column dispute_note text not null default '' check (length(dispute_note) <= 1000);

create function app.has_feature(p_org uuid, p_feature text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(p_feature = any (p.features), false)
  from public.plans p where p.code = app.effective_plan(p_org)
$$;
revoke all on function app.has_feature(uuid, text) from public;
grant execute on function app.has_feature(uuid, text) to authenticated, service_role;

-- Usage counters -------------------------------------------------------------------------

create table public.usage_counters (
  org_id uuid not null references public.organizations (id) on delete cascade,
  period text not null check (period ~ '^\d{4}-\d{2}$'),
  metric text not null check (metric in ('email_sends', 'ai_requests')),
  used integer not null default 0 check (used >= 0),
  primary key (org_id, period, metric)
);

create function app.usage_limit_key(p_metric text) returns text language sql immutable as $$
  select case p_metric when 'email_sends' then 'email_sends_per_month' when 'ai_requests' then 'ai_requests_per_month' end
$$;

create function app.usage_remaining(p_org uuid, p_metric text) returns integer
language sql stable security definer set search_path = '' as $$
  select app.limit_for(p_org, app.usage_limit_key(p_metric)) - coalesce((
    select used from public.usage_counters
    where org_id = p_org and metric = p_metric and period = to_char(now() at time zone 'UTC', 'YYYY-MM')
  ), 0)
$$;

-- Atomically use one unit; false (and nothing recorded) when the limit is reached.
create function app.consume_usage(p_org uuid, p_metric text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_limit integer := app.limit_for(p_org, app.usage_limit_key(p_metric));
  v_period text := to_char(now() at time zone 'UTC', 'YYYY-MM');
  v_used integer;
begin
  if v_limit <= 0 then
    return false;
  end if;
  insert into public.usage_counters as u (org_id, period, metric, used) values (p_org, v_period, p_metric, 1)
  on conflict (org_id, period, metric) do update set used = u.used + 1 where u.used + 1 <= v_limit
  returning used into v_used;
  return v_used is not null;
end $$;
revoke all on function app.usage_remaining(uuid, text), app.consume_usage(uuid, text) from public;
grant execute on function app.usage_remaining(uuid, text) to authenticated, service_role;

-- Templates & rules ------------------------------------------------------------------------

create table public.email_templates (
  org_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null check (kind in ('new_invoice', 'due_soon', 'due_today', 'overdue', 'follow_up', 'payment_received')),
  subject text not null check (length(subject) between 1 and 200),
  body text not null check (length(body) between 1 and 5000),
  updated_by uuid references auth.users (id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (org_id, kind)
);
create trigger email_templates_touch before update on public.email_templates
  for each row execute function app.touch_updated_at();

create table public.reminder_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- Days relative to the due date: -3 = three days before, 7 = a week after.
  offset_days integer not null check (offset_days between -60 and 180),
  kind text not null check (kind in ('due_soon', 'due_today', 'overdue', 'follow_up')),
  tone text not null check (tone in ('friendly', 'professional', 'neutral', 'firm')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, offset_days)
);
create trigger reminder_rules_touch before update on public.reminder_rules
  for each row execute function app.touch_updated_at();

-- Email messages, events, suppressions ------------------------------------------------------

create table public.email_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  invoice_id uuid references public.invoices (id) on delete set null,
  client_id uuid references public.clients (id) on delete set null,
  reminder_job_id uuid,
  kind text not null,
  to_email text not null check (length(to_email) <= 254),
  subject text not null default '' check (length(subject) <= 200),
  body_text text not null default '' check (length(body_text) <= 5000),
  -- queued → accepted (provider took it) → sent → delivered; or bounced / complained / failed.
  status text not null default 'queued'
    check (status in ('queued', 'accepted', 'sent', 'delivery_delayed', 'delivered', 'bounced', 'complained', 'failed')),
  provider text,
  provider_message_id text unique,
  idempotency_key text not null unique check (length(idempotency_key) <= 120),
  error text check (length(error) <= 500),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  delivered_at timestamptz,
  updated_at timestamptz not null default now()
);
create index email_messages_org_idx on public.email_messages (org_id, created_at desc);
create index email_messages_invoice_idx on public.email_messages (invoice_id, created_at desc);
create index email_messages_client_idx on public.email_messages (client_id, created_at desc);
create trigger email_messages_touch before update on public.email_messages
  for each row execute function app.touch_updated_at();

create table public.email_events (
  id bigint generated always as identity primary key,
  message_id uuid not null references public.email_messages (id) on delete cascade,
  provider_event_id text not null unique,
  type text not null check (length(type) <= 60),
  occurred_at timestamptz not null,
  detail text check (length(detail) <= 500),
  received_at timestamptz not null default now()
);
create index email_events_message_idx on public.email_events (message_id);

create table public.email_suppressions (
  org_id uuid not null references public.organizations (id) on delete cascade,
  email text not null check (email = lower(email)),
  reason text not null check (reason in ('bounced', 'complained', 'manual')),
  created_at timestamptz not null default now(),
  primary key (org_id, email)
);

-- Reminder jobs --------------------------------------------------------------------------------

create table public.reminder_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  rule_id uuid references public.reminder_rules (id) on delete set null,
  offset_days integer not null,
  kind text not null,
  tone text not null,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'processing', 'sent', 'failed', 'cancelled', 'skipped')),
  scheduled_for timestamptz not null,
  next_attempt_at timestamptz not null,
  locked_until timestamptz,
  attempts integer not null default 0,
  last_error text check (length(last_error) <= 500),
  cancel_reason text check (length(cancel_reason) <= 120),
  email_message_id uuid references public.email_messages (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (invoice_id, offset_days)
);
create index reminder_jobs_due_idx on public.reminder_jobs (next_attempt_at) where status in ('scheduled', 'processing');
create index reminder_jobs_org_idx on public.reminder_jobs (org_id, created_at desc);
create trigger reminder_jobs_touch before update on public.reminder_jobs
  for each row execute function app.touch_updated_at();
alter table public.email_messages
  add constraint email_messages_job_fk foreign key (reminder_job_id) references public.reminder_jobs (id) on delete set null;

-- AI usage log (no prompt or output content is stored) ------------------------------------------

create table public.ai_usage_logs (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  action text not null check (action in ('draft_reminder', 'rewrite', 'analyze_reply', 'explain_outstanding')),
  model text not null default '' check (length(model) <= 80),
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  outcome text not null check (outcome in ('ok', 'rejected', 'error', 'limited')),
  created_at timestamptz not null default now()
);
create index ai_usage_logs_org_idx on public.ai_usage_logs (org_id, created_at desc);

-- Eligibility ---------------------------------------------------------------------------------------

-- Why an invoice must not get a reminder right now (null = it may).
create function app.reminder_block_reason(p_invoice uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  inv public.invoices;
  cli public.clients;
  st public.organization_settings;
begin
  select * into inv from public.invoices where id = p_invoice;
  if not found or inv.deleted_at is not null then return 'deleted'; end if;
  if inv.doc_type <> 'invoice' or inv.issued_at is null then return 'not_issued'; end if;
  if inv.status in ('Paid', 'Cancelled') or inv.balance_minor <= 0 then return 'paid'; end if;
  if inv.reminders_paused_at is not null then return 'paused'; end if;
  if inv.dispute_opened_at is not null then return 'disputed'; end if;
  select * into st from public.organization_settings where org_id = inv.org_id;
  if not coalesce(st.reminders_enabled, false) then return 'reminders_off'; end if;
  if not app.has_feature(inv.org_id, 'reminders') then return 'plan'; end if;
  select * into cli from public.clients where id = inv.client_id;
  if not found then return 'no_client'; end if;
  if cli.reminders_opted_out_at is not null then return 'opted_out'; end if;
  if cli.email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return 'no_email'; end if;
  if exists (select 1 from public.email_suppressions s where s.org_id = inv.org_id and s.email = lower(btrim(cli.email))) then
    return 'suppressed';
  end if;
  return null;
end $$;
revoke all on function app.reminder_block_reason(uuid) from public;

-- Shown in the dashboard: is this invoice getting reminders, and if not, why.
create function public.invoice_reminder_status(p_invoice uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  inv public.invoices;
begin
  select * into inv from public.invoices where id = p_invoice;
  if not found or app.member_role(inv.org_id, auth.uid()) is null then
    raise exception 'Invoice not found' using errcode = 'SA404';
  end if;
  return jsonb_build_object(
    'blockReason', app.reminder_block_reason(p_invoice),
    'paused', inv.reminders_paused_at is not null,
    'disputed', inv.dispute_opened_at is not null,
    'disputeNote', inv.dispute_note
  );
end $$;

-- Enqueue ---------------------------------------------------------------------------------------------

-- Creates the reminder jobs due now. Safe to run repeatedly (unique (invoice, offset)).
-- A rule whose date was missed by up to 3 days (weekend, outage) still fires,
-- but each invoice gets at most one reminder per local day: the latest due rule
-- wins and earlier missed ones are recorded as skipped.
create function public.rf_enqueue_due_reminders(p_now timestamptz default now()) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  o record;
  inv record;
  v_local timestamp;
  v_today date;
  v_created integer := 0;
  r record;
  v_first boolean;
begin
  for o in
    select s.org_id, s.reminder_send_hour, s.reminders_weekdays_only, org.timezone
    from public.organization_settings s
    join public.organizations org on org.id = s.org_id and org.deleted_at is null
    where s.reminders_enabled
  loop
    if not app.has_feature(o.org_id, 'reminders') then continue; end if;
    v_local := p_now at time zone o.timezone;
    v_today := v_local::date;
    if extract(hour from v_local) < o.reminder_send_hour then continue; end if;
    if o.reminders_weekdays_only and extract(isodow from v_local) >= 6 then continue; end if;

    for inv in
      select i.id, i.due_date, i.issued_at
      from public.invoices i
      where i.org_id = o.org_id and i.doc_type = 'invoice' and i.issued_at is not null and i.deleted_at is null
        and i.balance_minor > 0 and i.status not in ('Paid', 'Cancelled') and i.due_date is not null
        and i.due_date between v_today - 183 and v_today + 61
        and app.reminder_block_reason(i.id) is null
        -- one reminder per invoice per local day
        and not exists (
          select 1 from public.reminder_jobs j
          where j.invoice_id = i.id and j.status in ('scheduled', 'processing', 'sent')
            and (j.scheduled_for at time zone o.timezone)::date = v_today
        )
    loop
      v_first := true;
      for r in
        select rr.* from public.reminder_rules rr
        where rr.org_id = o.org_id and rr.is_active
          and inv.due_date + rr.offset_days between v_today - 3 and v_today
          -- never remind about a date before the invoice was issued
          and inv.due_date + rr.offset_days >= (inv.issued_at at time zone o.timezone)::date
          and not exists (select 1 from public.reminder_jobs j where j.invoice_id = inv.id and j.offset_days = rr.offset_days)
        order by rr.offset_days desc
      loop
        insert into public.reminder_jobs
          (org_id, invoice_id, rule_id, offset_days, kind, tone, status, scheduled_for, next_attempt_at, cancel_reason)
        values
          (o.org_id, inv.id, r.id, r.offset_days, r.kind, r.tone,
           case when v_first then 'scheduled' else 'skipped' end, p_now, p_now,
           case when v_first then null else 'superseded by a later reminder' end)
        on conflict (invoice_id, offset_days) do nothing;
        if v_first then v_created := v_created + 1; end if;
        v_first := false;
      end loop;
    end loop;
  end loop;
  return v_created;
end $$;

-- Claim / complete ---------------------------------------------------------------------------------------

create function public.rf_claim_jobs(p_limit integer default 20, p_lease_seconds integer default 300)
returns setof public.reminder_jobs
language sql security definer set search_path = '' as $$
  update public.reminder_jobs j
  set status = 'processing', locked_until = now() + make_interval(secs => p_lease_seconds), attempts = j.attempts + 1
  where j.id in (
    select id from public.reminder_jobs
    where (status = 'scheduled' and next_attempt_at <= now())
       or (status = 'processing' and locked_until < now())
    order by next_attempt_at
    limit least(greatest(p_limit, 1), 100)
    for update skip locked
  )
  returning j.*
$$;

-- Everything needed to render a send, or why it must not be sent.
-- Creates (once per job) the email_messages row and a fresh client link.
create function public.rf_prepare_reminder(p_job uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  j public.reminder_jobs;
  inv public.invoices;
  cli public.clients;
  st public.organization_settings;
  org public.organizations;
  v_reason text;
  msg public.email_messages;
  v_token text;
  v_tpl public.email_templates;
begin
  select * into j from public.reminder_jobs where id = p_job for update;
  if not found or j.status <> 'processing' then
    return jsonb_build_object('skip', true, 'reason', 'not_claimed');
  end if;

  -- Crash recovery: the provider already accepted this email.
  select * into msg from public.email_messages where idempotency_key = 'reminder:' || j.id::text;
  if found and msg.status <> 'queued' and msg.status <> 'failed' then
    update public.reminder_jobs set status = 'sent', locked_until = null, email_message_id = msg.id where id = j.id;
    return jsonb_build_object('skip', true, 'reason', 'already_sent');
  end if;

  v_reason := app.reminder_block_reason(j.invoice_id);
  if v_reason is not null then
    update public.reminder_jobs set status = 'cancelled', cancel_reason = v_reason, locked_until = null where id = j.id;
    return jsonb_build_object('skip', true, 'reason', v_reason);
  end if;
  if app.usage_remaining(j.org_id, 'email_sends') <= 0 then
    update public.reminder_jobs set status = 'skipped', cancel_reason = 'monthly email limit reached', locked_until = null
    where id = j.id;
    return jsonb_build_object('skip', true, 'reason', 'email_limit');
  end if;

  select * into inv from public.invoices where id = j.invoice_id;
  select * into cli from public.clients where id = inv.client_id;
  select * into st from public.organization_settings where org_id = j.org_id;
  select * into org from public.organizations where id = j.org_id;
  select * into v_tpl from public.email_templates where org_id = j.org_id and kind = j.kind;

  if msg.id is null then
    insert into public.email_messages (org_id, invoice_id, client_id, reminder_job_id, kind, to_email, idempotency_key)
    values (j.org_id, inv.id, cli.id, j.id, j.kind, lower(btrim(cli.email)), 'reminder:' || j.id::text)
    returning * into msg;
    update public.reminder_jobs set email_message_id = msg.id where id = j.id;
  end if;

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.invoice_shares (org_id, invoice_id, token_hash, expires_at)
  values (j.org_id, inv.id, sha256(convert_to(v_token, 'UTF8')), now() + interval '60 days');

  return jsonb_build_object(
    'skip', false,
    'messageId', msg.id,
    'idempotencyKey', msg.idempotency_key,
    'to', msg.to_email,
    'kind', j.kind,
    'tone', j.tone,
    'template', case when v_tpl.org_id is null then null
                     else jsonb_build_object('subject', v_tpl.subject, 'body', v_tpl.body) end,
    'shareToken', v_token,
    'fromName', coalesce(nullif(st.email_from_name, ''), org.name),
    'replyTo', coalesce(nullif(st.email_reply_to, ''), nullif(st.business ->> 'email', '')),
    'signature', coalesce(nullif(st.email_signature, ''), org.name),
    'businessName', org.name,
    'clientName', coalesce(nullif(btrim(cli.name), ''), cli.company),
    'invoiceNumber', inv.number,
    'currency', inv.currency,
    'locale', coalesce(inv.document #>> '{meta,locale}', 'en-GB'),
    'amountDueMinor', inv.balance_minor,
    'totalMinor', inv.total_minor,
    'dueDate', inv.due_date,
    'daysOverdue', greatest(0, (now() at time zone org.timezone)::date - inv.due_date)
  );
end $$;

-- The provider accepted the email (not yet "delivered": that needs its webhook).
create function public.rf_mark_accepted(
  p_message uuid, p_provider text, p_provider_message_id text, p_subject text, p_body text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  msg public.email_messages;
begin
  update public.email_messages
  set status = case when status = 'queued' or status = 'failed' then 'accepted' else status end,
      provider = p_provider, provider_message_id = p_provider_message_id,
      subject = left(p_subject, 200), body_text = left(p_body, 5000), error = null, accepted_at = coalesce(accepted_at, now())
  where id = p_message
  returning * into msg;
  if msg.reminder_job_id is not null then
    update public.reminder_jobs set status = 'sent', locked_until = null, last_error = null where id = msg.reminder_job_id;
  end if;
  perform app.consume_usage(msg.org_id, 'email_sends');
  if msg.invoice_id is not null then
    perform app.audit(msg.org_id, msg.created_by, 'email.sent', 'invoice', msg.invoice_id,
                      jsonb_build_object('kind', msg.kind, 'message', msg.id, 'automatic', msg.reminder_job_id is not null));
  end if;
end $$;

-- A send attempt failed. Transient failures retry with backoff; permanent ones stop.
create function public.rf_mark_failed(p_message uuid, p_error text, p_permanent boolean) returns text
language plpgsql security definer set search_path = '' as $$
declare
  msg public.email_messages;
  j public.reminder_jobs;
  v_next text := 'failed';
begin
  update public.email_messages set status = 'failed', error = left(p_error, 500)
  where id = p_message and status in ('queued', 'failed')
  returning * into msg;
  if msg.reminder_job_id is not null then
    select * into j from public.reminder_jobs where id = msg.reminder_job_id for update;
    if not p_permanent and j.attempts < 5 then
      v_next := 'scheduled';
      update public.reminder_jobs
      set status = 'scheduled', locked_until = null, last_error = left(p_error, 500),
          next_attempt_at = now() + make_interval(mins => power(2, j.attempts)::integer)
      where id = j.id;
    else
      update public.reminder_jobs set status = 'failed', locked_until = null, last_error = left(p_error, 500) where id = j.id;
    end if;
  end if;
  return v_next;
end $$;

-- Manual sends (from the invoice page) -------------------------------------------------------------------

create function public.rf_prepare_manual_email(
  p_user uuid, p_invoice uuid, p_kind text, p_to text, p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  inv public.invoices;
  cli public.clients;
  st public.organization_settings;
  org public.organizations;
  msg public.email_messages;
  v_to text := lower(btrim(coalesce(p_to, '')));
  v_token text;
begin
  select * into inv from public.invoices where id = p_invoice and deleted_at is null;
  if not found or app.member_role(inv.org_id, p_user) is null then
    raise exception 'Invoice not found' using errcode = 'SA404';
  end if;
  if inv.issued_at is null then
    raise exception 'Issue the document before emailing it' using errcode = 'SA422';
  end if;
  if p_kind not in ('new_invoice', 'due_soon', 'due_today', 'overdue', 'follow_up', 'payment_received') then
    raise exception 'Unknown email type' using errcode = 'SA422';
  end if;
  if v_to !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_to) > 254 then
    raise exception 'Enter a valid recipient email address' using errcode = 'SA422';
  end if;
  if exists (select 1 from public.email_suppressions where org_id = inv.org_id and email = v_to) then
    raise exception 'Emails to % bounced or were reported as spam, so sending is blocked. Check the address with your client.', v_to
      using errcode = 'SA422';
  end if;
  if p_idempotency_key !~ '^manual:[0-9a-f-]{36}$' then
    raise exception 'Invalid request' using errcode = 'SA422';
  end if;

  select * into msg from public.email_messages where idempotency_key = p_idempotency_key;
  if found then
    if msg.org_id <> inv.org_id then raise exception 'Invalid request' using errcode = 'SA422'; end if;
    return jsonb_build_object('duplicate', true, 'messageId', msg.id, 'status', msg.status);
  end if;
  if app.usage_remaining(inv.org_id, 'email_sends') <= 0 then
    raise exception 'Your plan''s monthly email limit is reached' using errcode = 'SA402';
  end if;

  select * into cli from public.clients where id = inv.client_id;
  select * into st from public.organization_settings where org_id = inv.org_id;
  select * into org from public.organizations where id = inv.org_id;

  insert into public.email_messages (org_id, invoice_id, client_id, kind, to_email, idempotency_key, created_by)
  values (inv.org_id, inv.id, inv.client_id, p_kind, v_to, p_idempotency_key, p_user)
  returning * into msg;

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.invoice_shares (org_id, invoice_id, token_hash, created_by, expires_at)
  values (inv.org_id, inv.id, sha256(convert_to(v_token, 'UTF8')), p_user, now() + interval '60 days');

  return jsonb_build_object(
    'duplicate', false,
    'messageId', msg.id,
    'shareToken', v_token,
    'fromName', coalesce(nullif(st.email_from_name, ''), org.name),
    'replyTo', coalesce(nullif(st.email_reply_to, ''), nullif(st.business ->> 'email', '')),
    'signature', coalesce(nullif(st.email_signature, ''), org.name),
    'businessName', org.name,
    'clientName', coalesce(nullif(btrim(cli.name), ''), cli.company, ''),
    'invoiceNumber', inv.number,
    'currency', inv.currency,
    'locale', coalesce(inv.document #>> '{meta,locale}', 'en-GB'),
    'amountDueMinor', inv.balance_minor,
    'totalMinor', inv.total_minor,
    'dueDate', inv.due_date,
    'daysOverdue', greatest(0, (now() at time zone org.timezone)::date - inv.due_date)
  );
end $$;

-- Provider webhooks -------------------------------------------------------------------------------------------

create function app.email_status_rank(p_status text) returns integer language sql immutable as $$
  select case p_status
    when 'queued' then 0 when 'accepted' then 1 when 'sent' then 2 when 'delivery_delayed' then 2
    when 'delivered' then 3 else 4 end
$$;

-- Apply one provider event (idempotent on the provider's event id). Statuses
-- only move forward; bounces and spam complaints suppress the address.
create function public.rf_apply_email_event(
  p_event_id text, p_provider_message_id text, p_type text, p_occurred_at timestamptz, p_detail text default null
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  msg public.email_messages;
  v_status text;
begin
  select * into msg from public.email_messages where provider_message_id = p_provider_message_id for update;
  if not found then
    return false;
  end if;
  insert into public.email_events (message_id, provider_event_id, type, occurred_at, detail)
  values (msg.id, p_event_id, left(p_type, 60), p_occurred_at, left(p_detail, 500))
  on conflict (provider_event_id) do nothing;
  if not found then
    return false;
  end if;
  v_status := case p_type
    when 'email.sent' then 'sent'
    when 'email.delivered' then 'delivered'
    when 'email.delivery_delayed' then 'delivery_delayed'
    when 'email.bounced' then 'bounced'
    when 'email.complained' then 'complained'
    when 'email.failed' then 'failed'
  end;
  if v_status is not null and app.email_status_rank(v_status) > app.email_status_rank(msg.status) then
    update public.email_messages
    set status = v_status,
        delivered_at = case when v_status = 'delivered' then p_occurred_at else delivered_at end,
        error = case when v_status in ('bounced', 'complained', 'failed') then left(p_detail, 500) else error end
    where id = msg.id;
  end if;
  if v_status in ('bounced', 'complained') then
    insert into public.email_suppressions (org_id, email, reason)
    values (msg.org_id, msg.to_email, v_status) on conflict do nothing;
  end if;
  return true;
end $$;

-- AI ------------------------------------------------------------------------------------------------------

-- Checks membership and plan allowance, records the request; false when over the limit.
create function public.rf_begin_ai(p_user uuid, p_org uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if app.member_role(p_org, p_user) is null then
    raise exception 'Not a member of this organization' using errcode = 'SA403';
  end if;
  return app.consume_usage(p_org, 'ai_requests');
end $$;

create function public.rf_log_ai(
  p_user uuid, p_org uuid, p_action text, p_model text, p_input integer, p_output integer, p_outcome text
) returns void language sql security definer set search_path = '' as $$
  insert into public.ai_usage_logs (org_id, user_id, action, model, input_tokens, output_tokens, outcome)
  values (p_org, p_user, p_action, left(p_model, 80), greatest(p_input, 0), greatest(p_output, 0), p_outcome)
$$;

-- The only invoice facts the AI sees: no names, emails, addresses or amounts.
create function public.rf_ai_invoice_context(p_user uuid, p_invoice uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  inv public.invoices;
  v_today date;
begin
  select * into inv from public.invoices where id = p_invoice and deleted_at is null;
  if not found or app.member_role(inv.org_id, p_user) is null then
    raise exception 'Invoice not found' using errcode = 'SA404';
  end if;
  select (now() at time zone o.timezone)::date into v_today from public.organizations o where o.id = inv.org_id;
  return jsonb_build_object(
    'orgId', inv.org_id,
    'daysFromDue', case when inv.due_date is null then null else v_today - inv.due_date end,
    'partiallyPaid', inv.paid_minor > 0 and inv.balance_minor > 0,
    'paid', inv.balance_minor <= 0,
    'remindersSent', (select count(*) from public.email_messages m
                      where m.invoice_id = inv.id and m.status not in ('queued', 'failed'))
  );
end $$;

-- User-facing RPCs ------------------------------------------------------------------------------------------

create function public.set_reminders_enabled(p_org uuid, p_enabled boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := app.require_user();
begin
  if not coalesce(app.member_role(p_org, uid) in ('owner', 'admin'), false) then
    raise exception 'Only owners and admins can change reminders' using errcode = 'SA403';
  end if;
  if p_enabled and not app.has_feature(p_org, 'reminders') then
    raise exception 'Automatic reminders need a Pro or Business plan' using errcode = 'SA402';
  end if;
  update public.organization_settings set reminders_enabled = p_enabled, updated_by = uid where org_id = p_org;
  if p_enabled and not exists (select 1 from public.reminder_rules where org_id = p_org) then
    insert into public.reminder_rules (org_id, offset_days, kind, tone) values
      (p_org, -3, 'due_soon', 'friendly'),
      (p_org, 0, 'due_today', 'friendly'),
      (p_org, 3, 'overdue', 'professional'),
      (p_org, 7, 'follow_up', 'professional'),
      (p_org, 14, 'follow_up', 'firm');
  end if;
  if not p_enabled then
    update public.reminder_jobs set status = 'cancelled', cancel_reason = 'reminders_off'
    where org_id = p_org and status = 'scheduled';
  end if;
  perform app.audit(p_org, uid, case when p_enabled then 'reminders.enabled' else 'reminders.disabled' end,
                    'organization', p_org);
end $$;

create function public.set_invoice_reminders_paused(p_invoice uuid, p_paused boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := app.require_user();
  inv public.invoices;
begin
  select * into inv from public.invoices where id = p_invoice and deleted_at is null for update;
  if not found or app.member_role(inv.org_id, uid) is null then
    raise exception 'Invoice not found' using errcode = 'SA404';
  end if;
  update public.invoices set reminders_paused_at = case when p_paused then now() end where id = p_invoice;
  if p_paused then
    update public.reminder_jobs set status = 'cancelled', cancel_reason = 'paused'
    where invoice_id = p_invoice and status = 'scheduled';
  end if;
  perform app.audit(inv.org_id, uid, case when p_paused then 'reminders.paused' else 'reminders.resumed' end,
                    'invoice', p_invoice);
end $$;

create function public.set_invoice_dispute(p_invoice uuid, p_open boolean, p_note text default '') returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := app.require_user();
  inv public.invoices;
begin
  select * into inv from public.invoices where id = p_invoice and deleted_at is null for update;
  if not found or app.member_role(inv.org_id, uid) is null then
    raise exception 'Invoice not found' using errcode = 'SA404';
  end if;
  update public.invoices
  set dispute_opened_at = case when p_open then coalesce(dispute_opened_at, now()) end,
      dispute_note = case when p_open then left(btrim(coalesce(p_note, '')), 1000) else '' end
  where id = p_invoice;
  if p_open then
    update public.reminder_jobs set status = 'cancelled', cancel_reason = 'disputed'
    where invoice_id = p_invoice and status = 'scheduled';
  end if;
  perform app.audit(inv.org_id, uid, case when p_open then 'dispute.opened' else 'dispute.resolved' end,
                    'invoice', p_invoice, jsonb_build_object('note', left(btrim(coalesce(p_note, '')), 200)));
end $$;

create function public.remove_email_suppression(p_org uuid, p_email text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := app.require_user();
begin
  if not coalesce(app.member_role(p_org, uid) in ('owner', 'admin'), false) then
    raise exception 'Only owners and admins can do this' using errcode = 'SA403';
  end if;
  delete from public.email_suppressions where org_id = p_org and email = lower(btrim(p_email));
  perform app.audit(p_org, uid, 'suppression.removed', 'organization', p_org, jsonb_build_object('email', lower(btrim(p_email))));
end $$;

-- From the client view: stop reminder emails for this client (the link token is the credential).
create function public.opt_out_reminders(p_token text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  s public.invoice_shares;
  v_client uuid;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then return false; end if;
  select * into s from public.invoice_shares
  where token_hash = sha256(convert_to(p_token, 'UTF8')) and revoked_at is null and expires_at > now();
  if not found then return false; end if;
  select client_id into v_client from public.invoices where id = s.invoice_id;
  if v_client is null then return false; end if;
  update public.clients set reminders_opted_out_at = coalesce(reminders_opted_out_at, now()) where id = v_client;
  update public.reminder_jobs j set status = 'cancelled', cancel_reason = 'opted_out'
  from public.invoices i where i.id = j.invoice_id and i.client_id = v_client and j.status = 'scheduled';
  perform app.audit(s.org_id, null, 'reminders.client_opted_out', 'invoice', s.invoice_id);
  return true;
end $$;

-- Paying in full cancels reminders that are waiting to go out.
create or replace function app.apply_payments(p_invoice uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  inv public.invoices;
  v_sum bigint;
  v_paid bigint;
  v_status text;
begin
  select * into inv from public.invoices where id = p_invoice for update;
  if not found or not exists (select 1 from public.invoice_payments where invoice_id = p_invoice) then
    return;
  end if;
  select coalesce(sum(amount_minor), 0) into v_sum
  from public.invoice_payments where invoice_id = p_invoice and voided_at is null;
  v_paid := least(inv.total_minor, v_sum);
  v_status := inv.status;
  if inv.doc_type = 'invoice' then
    if inv.total_minor > 0 and v_paid >= inv.total_minor and inv.status in ('Unpaid', 'Overdue') then
      v_status := 'Paid';
    elsif v_paid < inv.total_minor and inv.status = 'Paid' then
      v_status := 'Unpaid';
    end if;
  end if;
  update public.invoices set
    paid_minor = v_paid,
    balance_minor = total_minor - v_paid,
    status = v_status,
    document = jsonb_set(
      jsonb_set(document, '{totals,amountPaid}',
                to_jsonb(round(v_sum::numeric / power(10::numeric, app.currency_digits(currency)), app.currency_digits(currency)))),
      '{meta,status}', to_jsonb(v_status))
  where id = p_invoice;
  if inv.total_minor - v_paid <= 0 then
    update public.reminder_jobs set status = 'cancelled', cancel_reason = 'paid'
    where invoice_id = p_invoice and status = 'scheduled';
  end if;
end $$;

-- Grants ------------------------------------------------------------------------------------------------------

revoke execute on function
  public.rf_enqueue_due_reminders(timestamptz),
  public.rf_claim_jobs(integer, integer),
  public.rf_prepare_reminder(uuid),
  public.rf_mark_accepted(uuid, text, text, text, text),
  public.rf_mark_failed(uuid, text, boolean),
  public.rf_prepare_manual_email(uuid, uuid, text, text, text),
  public.rf_apply_email_event(text, text, text, timestamptz, text),
  public.rf_begin_ai(uuid, uuid),
  public.rf_log_ai(uuid, uuid, text, text, integer, integer, text),
  public.rf_ai_invoice_context(uuid, uuid),
  public.invoice_reminder_status(uuid),
  public.set_reminders_enabled(uuid, boolean),
  public.set_invoice_reminders_paused(uuid, boolean),
  public.set_invoice_dispute(uuid, boolean, text),
  public.remove_email_suppression(uuid, text),
  public.opt_out_reminders(text)
from public, anon, authenticated;

grant execute on function
  public.rf_enqueue_due_reminders(timestamptz),
  public.rf_claim_jobs(integer, integer),
  public.rf_prepare_reminder(uuid),
  public.rf_mark_accepted(uuid, text, text, text, text),
  public.rf_mark_failed(uuid, text, boolean),
  public.rf_prepare_manual_email(uuid, uuid, text, text, text),
  public.rf_apply_email_event(text, text, text, timestamptz, text),
  public.rf_begin_ai(uuid, uuid),
  public.rf_log_ai(uuid, uuid, text, text, integer, integer, text),
  public.rf_ai_invoice_context(uuid, uuid)
to service_role;

grant execute on function
  public.invoice_reminder_status(uuid),
  public.set_reminders_enabled(uuid, boolean),
  public.set_invoice_reminders_paused(uuid, boolean),
  public.set_invoice_dispute(uuid, boolean, text),
  public.remove_email_suppression(uuid, text)
to authenticated;
grant execute on function public.opt_out_reminders(text) to anon, authenticated;

-- RLS ----------------------------------------------------------------------------------------------------------

alter table public.usage_counters enable row level security;
alter table public.email_templates enable row level security;
alter table public.reminder_rules enable row level security;
alter table public.email_messages enable row level security;
alter table public.email_events enable row level security;
alter table public.email_suppressions enable row level security;
alter table public.reminder_jobs enable row level security;
alter table public.ai_usage_logs enable row level security;
revoke all on public.usage_counters, public.email_templates, public.reminder_rules, public.email_messages,
  public.email_events, public.email_suppressions, public.reminder_jobs, public.ai_usage_logs
from anon, authenticated;

grant select on public.usage_counters to authenticated;
create policy usage_select on public.usage_counters for select to authenticated using (app.is_member(org_id));

grant select on public.email_templates to authenticated;
grant insert (org_id, kind, subject, body), update (subject, body), delete on public.email_templates to authenticated;
create policy templates_select on public.email_templates for select to authenticated using (app.is_member(org_id));
create policy templates_insert on public.email_templates for insert to authenticated
  with check (app.has_role(org_id, '{owner,admin}'));
create policy templates_update on public.email_templates for update to authenticated
  using (app.has_role(org_id, '{owner,admin}')) with check (app.has_role(org_id, '{owner,admin}'));
create policy templates_delete on public.email_templates for delete to authenticated
  using (app.has_role(org_id, '{owner,admin}'));

grant select on public.reminder_rules to authenticated;
grant insert (org_id, offset_days, kind, tone, is_active), update (offset_days, kind, tone, is_active), delete
  on public.reminder_rules to authenticated;
create policy rules_select on public.reminder_rules for select to authenticated using (app.is_member(org_id));
create policy rules_insert on public.reminder_rules for insert to authenticated
  with check (app.has_role(org_id, '{owner,admin}'));
create policy rules_update on public.reminder_rules for update to authenticated
  using (app.has_role(org_id, '{owner,admin}')) with check (app.has_role(org_id, '{owner,admin}'));
create policy rules_delete on public.reminder_rules for delete to authenticated
  using (app.has_role(org_id, '{owner,admin}'));

grant select on public.email_messages to authenticated;
create policy messages_select on public.email_messages for select to authenticated using (app.is_member(org_id));

grant select on public.email_events to authenticated;
create policy events_select on public.email_events for select to authenticated using (
  exists (select 1 from public.email_messages m where m.id = message_id and app.is_member(m.org_id))
);

grant select on public.email_suppressions to authenticated;
create policy suppressions_select on public.email_suppressions for select to authenticated using (app.is_member(org_id));

grant select on public.reminder_jobs to authenticated;
create policy jobs_select on public.reminder_jobs for select to authenticated using (app.is_member(org_id));

grant select on public.ai_usage_logs to authenticated;
create policy ai_logs_select on public.ai_usage_logs for select to authenticated
  using (app.has_role(org_id, '{owner,admin}'));
