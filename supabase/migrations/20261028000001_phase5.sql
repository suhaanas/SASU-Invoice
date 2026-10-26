-- Phase 5: recurring invoices, reports, granular member permissions and the
-- platform (super) admin console.

-- Member permissions ----------------------------------------------------------------------------
-- Owners and admins can do everything; members get these switches (all on by default).

alter table public.organization_members
  add column permissions jsonb not null default
    '{"record_payments": true, "send_emails": true, "manage_clients": true, "view_reports": true}'::jsonb;

create function app.can(p_org uuid, p_user uuid, p_permission text) returns boolean
language sql stable security definer set search_path = '' as $$
  select case m.role
    when 'owner' then true
    when 'admin' then true
    else coalesce((m.permissions ->> p_permission)::boolean, false)
  end
  from public.organization_members m
  join public.organizations o on o.id = m.org_id and o.deleted_at is null
  where m.org_id = p_org and m.user_id = p_user
$$;
revoke all on function app.can(uuid, uuid, text) from public;
grant execute on function app.can(uuid, uuid, text) to authenticated, service_role;

create function public.update_member_permissions(p_org uuid, p_user uuid, p_permissions jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := app.require_user();
  clean jsonb;
begin
  if not coalesce(app.member_role(p_org, uid) in ('owner', 'admin'), false) then
    raise exception 'Only owners and admins can change permissions' using errcode = 'SA403';
  end if;
  if app.member_role(p_org, p_user) is distinct from 'member' then
    raise exception 'Permissions apply to members only' using errcode = 'SA422';
  end if;
  -- Only known switches, only booleans.
  select jsonb_object_agg(k, coalesce((p_permissions ->> k)::boolean, false)) into clean
  from unnest(array['record_payments', 'send_emails', 'manage_clients', 'view_reports']) k;
  update public.organization_members set permissions = clean where org_id = p_org and user_id = p_user;
  perform app.audit(p_org, uid, 'member.permissions_changed', 'user', p_user, clean);
end $$;
revoke execute on function public.update_member_permissions(uuid, uuid, jsonb) from public, anon;
grant execute on function public.update_member_permissions(uuid, uuid, jsonb) to authenticated;

-- Clients: creating and editing follows the manage_clients switch.
drop policy clients_insert on public.clients;
drop policy clients_update on public.clients;
create policy clients_insert on public.clients for insert to authenticated
  with check (app.can(org_id, auth.uid(), 'manage_clients'));
create policy clients_update on public.clients for update to authenticated
  using (app.can(org_id, auth.uid(), 'manage_clients')) with check (app.can(org_id, auth.uid(), 'manage_clients'));

-- Payments and emails follow their switches.
create or replace function app.require_permission(p_org uuid, p_user uuid, p_permission text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not coalesce(app.can(p_org, p_user, p_permission), false) then
    raise exception 'Your role doesn''t allow this. Ask an owner or admin.' using errcode = 'SA403';
  end if;
end $$;
revoke all on function app.require_permission(uuid, uuid, text) from public;

create or replace function app.payment_permission_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.created_by is not null and new.source = 'manual' then
    perform app.require_permission(new.org_id, new.created_by, 'record_payments');
  end if;
  return new;
end $$;
create trigger invoice_payments_permission before insert on public.invoice_payments
  for each row execute function app.payment_permission_guard();

create or replace function app.email_permission_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Automatic reminders have no creator; people sending by hand need the switch.
  if new.created_by is not null and new.reminder_job_id is null then
    perform app.require_permission(new.org_id, new.created_by, 'send_emails');
  end if;
  return new;
end $$;
create trigger email_messages_permission before insert on public.email_messages
  for each row execute function app.email_permission_guard();

-- Document numbering on the server (recurring invoices) ------------------------------------------

-- Next number in a series: the org's prefix plus one more than the highest
-- trailing number used with that prefix ("INV-041" → "INV-042").
create function app.next_document_number(p_org uuid, p_doc_type text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_prefix text;
  v_max integer;
  v_width integer;
begin
  v_prefix := case p_doc_type
    when 'invoice' then coalesce(nullif((select invoice_prefix from public.organization_settings where org_id = p_org), ''), 'INV-')
    when 'quote' then 'QUO-' when 'credit' then 'CN-' when 'receipt' then 'RCT-' else 'PRO-' end;
  select max((substring(number from length(v_prefix) + 1))::integer),
         max(length(substring(number from length(v_prefix) + 1)))
    into v_max, v_width
  from public.invoices
  where org_id = p_org and doc_type = p_doc_type and deleted_at is null
    and starts_with(number, v_prefix) and substring(number from length(v_prefix) + 1) ~ '^\d{1,9}$';
  return v_prefix || lpad((coalesce(v_max, 0) + 1)::text, greatest(coalesce(v_width, 3), 3), '0');
end $$;
revoke all on function app.next_document_number(uuid, text) from public;

-- Recurring invoices ----------------------------------------------------------------------------------

alter table public.invoices drop constraint invoices_source_check;
alter table public.invoices add constraint invoices_source_check check (source in ('editor', 'import', 'recurring'));

create table public.recurring_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  template_invoice_id uuid not null references public.invoices (id) on delete cascade,
  client_id uuid references public.clients (id) on delete set null,
  name text not null default '' check (length(name) <= 120),
  unit text not null check (unit in ('week', 'month', 'year')),
  every integer not null default 1 check (every between 1 and 52),
  start_date date not null,
  end_date date,
  -- Dates are start_date + occurrence × period (no month-end drift).
  occurrence integer not null default 0,
  next_run_date date,
  mode text not null default 'draft' check (mode in ('draft', 'issue')),
  send_email boolean not null default false,
  status text not null default 'active' check (status in ('active', 'paused', 'cancelled', 'ended')),
  runs_count integer not null default 0,
  last_run_at timestamptz,
  last_error text check (length(last_error) <= 500),
  retry_after timestamptz,
  locked_until timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date is null or end_date >= start_date),
  check (not send_email or mode = 'issue')
);
create index recurring_rules_org_idx on public.recurring_rules (org_id, status);
create index recurring_rules_due_idx on public.recurring_rules (next_run_date) where status = 'active';
create trigger recurring_rules_touch before update on public.recurring_rules
  for each row execute function app.touch_updated_at();

create table public.recurring_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  rule_id uuid not null references public.recurring_rules (id) on delete cascade,
  run_date date not null,
  invoice_id uuid references public.invoices (id) on delete set null,
  email_message_id uuid references public.email_messages (id) on delete set null,
  created_at timestamptz not null default now(),
  -- Exactly one invoice per rule per scheduled date, however often the scheduler runs.
  unique (rule_id, run_date)
);
create index recurring_runs_rule_idx on public.recurring_runs (rule_id, run_date desc);

create function app.recurring_date(p_start date, p_unit text, p_every integer, p_k integer) returns date
language sql immutable as $$
  select case p_unit
    when 'week' then p_start + p_every * p_k * 7
    when 'month' then (p_start + make_interval(months => p_every * p_k))::date
    else (p_start + make_interval(years => p_every * p_k))::date
  end
$$;

create function app.org_today(p_org uuid) returns date language sql stable security definer set search_path = '' as $$
  select (now() at time zone o.timezone)::date from public.organizations o where o.id = p_org
$$;
revoke all on function app.org_today(uuid) from public;
grant execute on function app.org_today(uuid) to authenticated, service_role;

create function public.create_recurring_rule(
  p_invoice uuid, p_unit text, p_every integer, p_start date, p_end date default null,
  p_mode text default 'draft', p_send_email boolean default false, p_name text default ''
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := app.require_user();
  inv public.invoices;
  new_id uuid;
begin
  select * into inv from public.invoices where id = p_invoice and deleted_at is null;
  if not found or app.member_role(inv.org_id, uid) is null then
    raise exception 'Invoice not found' using errcode = 'SA404';
  end if;
  if inv.doc_type <> 'invoice' then
    raise exception 'Only invoices can repeat' using errcode = 'SA422';
  end if;
  if not app.has_feature(inv.org_id, 'recurring') then
    raise exception 'Recurring invoices need a Pro or Business plan' using errcode = 'SA402';
  end if;
  if p_start is null or p_start < app.org_today(inv.org_id) then
    raise exception 'Start today or later' using errcode = 'SA422';
  end if;
  if p_send_email then
    perform app.require_permission(inv.org_id, uid, 'send_emails');
  end if;
  insert into public.recurring_rules
    (org_id, template_invoice_id, client_id, name, unit, every, start_date, end_date, next_run_date, mode, send_email, created_by)
  values
    (inv.org_id, inv.id, inv.client_id, left(btrim(coalesce(p_name, '')), 120), p_unit, p_every, p_start, p_end, p_start,
     p_mode, coalesce(p_send_email, false) and p_mode = 'issue', uid)
  returning id into new_id;
  perform app.audit(inv.org_id, uid, 'recurring.created', 'invoice', inv.id, jsonb_build_object('rule', new_id));
  return new_id;
end $$;

create function public.update_recurring_rule(
  p_rule uuid, p_unit text, p_every integer, p_end date, p_mode text, p_send_email boolean, p_name text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := app.require_user();
  r public.recurring_rules;
begin
  select * into r from public.recurring_rules where id = p_rule for update;
  if not found or app.member_role(r.org_id, uid) is null then
    raise exception 'Schedule not found' using errcode = 'SA404';
  end if;
  if r.status in ('cancelled', 'ended') then
    raise exception 'This schedule has finished' using errcode = 'SA409';
  end if;
  if p_send_email and p_mode = 'issue' then
    perform app.require_permission(r.org_id, uid, 'send_emails');
  end if;
  if p_end is not null and p_end < coalesce(r.next_run_date, r.start_date) then
    raise exception 'The end date is before the next invoice' using errcode = 'SA422';
  end if;
  -- A new period counts from the next scheduled date.
  update public.recurring_rules set
    unit = p_unit, every = p_every, end_date = p_end, mode = p_mode,
    send_email = coalesce(p_send_email, false) and p_mode = 'issue', name = left(btrim(coalesce(p_name, '')), 120),
    start_date = case when unit <> p_unit or every <> p_every then coalesce(next_run_date, start_date) else start_date end,
    occurrence = case when unit <> p_unit or every <> p_every then 0 else occurrence end
  where id = p_rule;
  perform app.audit(r.org_id, uid, 'recurring.updated', 'invoice', r.template_invoice_id, jsonb_build_object('rule', p_rule));
end $$;

create function public.set_recurring_status(p_rule uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := app.require_user();
  r public.recurring_rules;
  v_today date;
  v_k integer;
begin
  select * into r from public.recurring_rules where id = p_rule for update;
  if not found or app.member_role(r.org_id, uid) is null then
    raise exception 'Schedule not found' using errcode = 'SA404';
  end if;
  if p_status not in ('active', 'paused', 'cancelled') or r.status in ('cancelled', 'ended') then
    raise exception 'That change isn''t possible' using errcode = 'SA409';
  end if;
  if p_status = 'active' and r.status = 'paused' then
    -- Resuming doesn't back-fill missed periods: jump to the next date from today.
    v_today := app.org_today(r.org_id);
    v_k := r.occurrence;
    while app.recurring_date(r.start_date, r.unit, r.every, v_k) < v_today and v_k < r.occurrence + 10000 loop
      v_k := v_k + 1;
    end loop;
    update public.recurring_rules
    set status = 'active', occurrence = v_k, next_run_date = app.recurring_date(start_date, unit, every, v_k),
        last_error = null, retry_after = null
    where id = p_rule;
    update public.recurring_rules set status = 'ended' where id = p_rule and end_date is not null and next_run_date > end_date;
  else
    update public.recurring_rules set status = p_status where id = p_rule;
  end if;
  perform app.audit(r.org_id, uid, 'recurring.' || p_status, 'invoice', r.template_invoice_id, jsonb_build_object('rule', p_rule));
end $$;

-- Scheduler: hand out due rules with their template, leased like reminder jobs.
create function public.rf_claim_recurring(p_limit integer default 10) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  result jsonb;
begin
  with due as (
    select r.id from public.recurring_rules r
    join public.organizations o on o.id = r.org_id and o.deleted_at is null
    where r.status = 'active'
      and r.next_run_date <= (now() at time zone o.timezone)::date
      and (r.retry_after is null or r.retry_after <= now())
      and (r.locked_until is null or r.locked_until < now())
      and app.has_feature(r.org_id, 'recurring')
    order by r.next_run_date
    limit least(greatest(p_limit, 1), 50)
    for update of r skip locked
  ),
  claimed as (
    update public.recurring_rules r set locked_until = now() + interval '5 minutes'
    from due where r.id = due.id
    returning r.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'ruleId', c.id, 'runDate', c.next_run_date, 'mode', c.mode, 'template', i.document
  )), '[]'::jsonb) into result
  from claimed c join public.invoices i on i.id = c.template_invoice_id;
  return result;
end $$;

-- Record one run: assign the number, save the invoice, advance the schedule.
-- Idempotent per (rule, run date). On failure the rule retries in an hour.
create function public.rf_complete_recurring(p_rule uuid, p_run_date date, p_doc jsonb, p_totals jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r public.recurring_rules;
  run public.recurring_runs;
  v_user uuid;
  v_doc jsonb;
  saved jsonb;
  v_client public.clients;
  v_tpl public.email_templates;
begin
  select * into r from public.recurring_rules where id = p_rule for update;
  if not found then
    return jsonb_build_object('error', 'unknown rule');
  end if;
  select * into run from public.recurring_runs where rule_id = p_rule and run_date = p_run_date;
  if found then
    return jsonb_build_object('runId', run.id, 'invoiceId', run.invoice_id, 'duplicate', true);
  end if;
  if r.status <> 'active' or r.next_run_date is distinct from p_run_date then
    update public.recurring_rules set locked_until = null where id = p_rule;
    return jsonb_build_object('error', 'schedule changed');
  end if;

  -- Created on behalf of the person who set it up (or an owner if they left).
  v_user := case when app.member_role(r.org_id, r.created_by) is not null then r.created_by
                 else (select user_id from public.organization_members where org_id = r.org_id and role = 'owner' limit 1) end;

  begin
    v_doc := jsonb_set(p_doc, '{meta,number}', to_jsonb(app.next_document_number(r.org_id, 'invoice')));
    saved := public.save_invoice(v_user, r.org_id, v_doc, p_totals, null, 'recurring');
  exception when others then
    update public.recurring_rules
    set last_error = left(sqlerrm, 500), retry_after = now() + interval '1 hour', locked_until = null
    where id = p_rule;
    return jsonb_build_object('error', left(sqlerrm, 500));
  end;

  insert into public.recurring_runs (org_id, rule_id, run_date, invoice_id)
  values (r.org_id, r.id, p_run_date, (saved ->> 'id')::uuid)
  returning * into run;
  update public.recurring_rules set
    occurrence = occurrence + 1,
    next_run_date = app.recurring_date(start_date, unit, every, occurrence + 1),
    runs_count = runs_count + 1, last_run_at = now(), last_error = null, retry_after = null, locked_until = null
  where id = p_rule;
  update public.recurring_rules set status = 'ended', next_run_date = null
  where id = p_rule and end_date is not null and next_run_date > end_date;
  perform app.audit(r.org_id, v_user, 'recurring.generated', 'invoice', (saved ->> 'id')::uuid,
                    jsonb_build_object('rule', r.id, 'run_date', p_run_date));

  select * into v_client from public.clients where id = r.client_id;
  select * into v_tpl from public.email_templates where org_id = r.org_id and kind = 'new_invoice';
  return jsonb_build_object(
    'runId', run.id,
    'invoiceId', saved ->> 'id',
    'orgId', r.org_id,
    'userId', v_user,
    'sendEmail', coalesce(r.send_email and r.mode = 'issue' and v_client.email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$', false),
    'to', lower(btrim(coalesce(v_client.email, ''))),
    'template', case when v_tpl.org_id is null then null else jsonb_build_object('subject', v_tpl.subject, 'body', v_tpl.body) end
  );
end $$;

create function public.rf_link_recurring_email(p_run uuid, p_message uuid) returns void
language sql security definer set search_path = '' as $$
  update public.recurring_runs set email_message_id = p_message where id = p_run
$$;

revoke execute on function
  public.create_recurring_rule(uuid, text, integer, date, date, text, boolean, text),
  public.update_recurring_rule(uuid, text, integer, date, text, boolean, text),
  public.set_recurring_status(uuid, text),
  public.rf_claim_recurring(integer),
  public.rf_complete_recurring(uuid, date, jsonb, jsonb),
  public.rf_link_recurring_email(uuid, uuid)
from public, anon, authenticated;
grant execute on function
  public.create_recurring_rule(uuid, text, integer, date, date, text, boolean, text),
  public.update_recurring_rule(uuid, text, integer, date, text, boolean, text),
  public.set_recurring_status(uuid, text)
to authenticated;
grant execute on function
  public.rf_claim_recurring(integer),
  public.rf_complete_recurring(uuid, date, jsonb, jsonb),
  public.rf_link_recurring_email(uuid, uuid)
to service_role;

alter table public.recurring_rules enable row level security;
alter table public.recurring_runs enable row level security;
revoke all on public.recurring_rules, public.recurring_runs from anon, authenticated;
grant select on public.recurring_rules, public.recurring_runs to authenticated;
create policy recurring_rules_select on public.recurring_rules for select to authenticated using (app.is_member(org_id));
create policy recurring_runs_select on public.recurring_runs for select to authenticated using (app.is_member(org_id));

-- Reports -----------------------------------------------------------------------------------------------

-- Figures for one currency and date range. Invoiced = issued invoices dated in
-- the range; received = payments recorded with a date in the range. These are
-- invoicing and cash figures, not accounting revenue.
create function public.report_summary(
  p_org uuid, p_currency text, p_from date, p_to date, p_client uuid default null, p_member uuid default null
) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  result jsonb;
begin
  if not coalesce(app.can(p_org, auth.uid(), 'view_reports'), false) then
    raise exception 'Your role doesn''t include reports' using errcode = 'SA403';
  end if;
  if p_to < p_from or p_to - p_from > 3700 then
    raise exception 'Choose a range of up to 10 years' using errcode = 'SA422';
  end if;
  with inv as (
    select i.* from public.invoices i
    where i.org_id = p_org and i.currency = p_currency and i.issued_at is not null and i.deleted_at is null
      and i.status <> 'Cancelled' and i.issue_date between p_from and p_to
      and (p_client is null or i.client_id = p_client) and (p_member is null or i.created_by = p_member)
  ),
  pays as (
    select p.*, i.client_id from public.invoice_payments p join public.invoices i on i.id = p.invoice_id
    where p.org_id = p_org and p.currency = p_currency and p.voided_at is null and p.paid_on between p_from and p_to
      and (p_client is null or i.client_id = p_client) and (p_member is null or i.created_by = p_member)
  ),
  months as (
    select generate_series(date_trunc('month', p_from), date_trunc('month', p_to), interval '1 month')::date as m
  ),
  today as (select app.org_today(p_org) as d)
  select jsonb_build_object(
    'currency', p_currency, 'from', p_from, 'to', p_to,
    'invoicedMinor', coalesce((select sum(total_minor) from inv where doc_type = 'invoice'), 0),
    'invoiceCount', (select count(*) from inv where doc_type = 'invoice'),
    'creditedMinor', coalesce((select sum(total_minor) from inv where doc_type = 'credit'), 0),
    'receivedMinor', coalesce((select sum(amount_minor) from pays), 0),
    'paymentCount', (select count(*) from pays),
    'outstandingMinor', coalesce((select sum(balance_minor) from inv where doc_type = 'invoice' and balance_minor > 0), 0),
    'overdueMinor', coalesce((select sum(balance_minor) from inv
                              where doc_type = 'invoice' and balance_minor > 0 and due_date < (select d from today)), 0),
    'monthly', (select coalesce(jsonb_agg(jsonb_build_object(
        'month', to_char(m, 'YYYY-MM'),
        'invoicedMinor', coalesce((select sum(total_minor) from inv where doc_type = 'invoice' and date_trunc('month', issue_date) = m), 0),
        'creditedMinor', coalesce((select sum(total_minor) from inv where doc_type = 'credit' and date_trunc('month', issue_date) = m), 0),
        'receivedMinor', coalesce((select sum(amount_minor) from pays where date_trunc('month', paid_on) = m), 0)
      ) order by m), '[]'::jsonb) from months),
    'topClients', (select coalesce(jsonb_agg(t order by (t ->> 'invoicedMinor')::bigint desc), '[]'::jsonb) from (
        select jsonb_build_object(
          'clientId', i.client_id, 'name', max(i.client_name),
          'invoicedMinor', sum(i.total_minor), 'outstandingMinor', sum(greatest(i.balance_minor, 0)), 'count', count(*)
        ) as t
        from inv i where i.doc_type = 'invoice' and i.client_id is not null
        group by i.client_id order by sum(i.total_minor) desc limit 10) x),
    'statusCounts', jsonb_build_object(
      'paid', (select count(*) from inv where doc_type = 'invoice' and balance_minor <= 0),
      'partial', (select count(*) from inv where doc_type = 'invoice' and balance_minor > 0 and paid_minor > 0),
      'unpaid', (select count(*) from inv where doc_type = 'invoice' and balance_minor > 0 and paid_minor = 0)),
    'emails', (select jsonb_build_object(
        'manual', count(*) filter (where m.reminder_job_id is null),
        'automatic', count(*) filter (where m.reminder_job_id is not null),
        'delivered', count(*) filter (where m.status = 'delivered'),
        'problems', count(*) filter (where m.status in ('bounced', 'complained', 'failed')))
      from public.email_messages m
      where m.org_id = p_org and (m.created_at at time zone 'UTC')::date between p_from and p_to
        and (p_client is null or m.client_id = p_client)),
    'recurring', jsonb_build_object(
      'active', (select count(*) from public.recurring_rules where org_id = p_org and status = 'active'),
      'generated', (select count(*) from public.recurring_runs where org_id = p_org and run_date between p_from and p_to),
      'upcoming30', (select count(*) from public.recurring_rules where org_id = p_org and status = 'active'
                     and next_run_date between (select d from today) and (select d from today) + 30))
  ) into result;
  return result;
end $$;
revoke execute on function public.report_summary(uuid, text, date, date, uuid, uuid) from public, anon;
grant execute on function public.report_summary(uuid, text, date, date, uuid, uuid) to authenticated;

-- Platform admin -------------------------------------------------------------------------------------------
-- Platform admins see platform health and organization metadata, never
-- customers' invoices, clients or amounts (they are not members, so RLS still
-- applies). Every admin call is audited.

create table public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;
revoke all on public.platform_admins from anon, authenticated;

create table public.feature_flags (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{1,60}$'),
  enabled boolean not null default false,
  description text not null default '' check (length(description) <= 300),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.feature_flags enable row level security;
revoke all on public.feature_flags from anon, authenticated;
grant select on public.feature_flags to authenticated;
create policy feature_flags_select on public.feature_flags for select to authenticated using (true);
insert into public.feature_flags (key, enabled, description) values
  ('ai_assistant', true, 'RecoverFlow AI drafting and analysis'),
  ('automatic_reminders', true, 'Automatic reminder emails (scheduler)'),
  ('recurring_invoices', true, 'Recurring invoice generation (scheduler)');

create function app.is_platform_admin(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.platform_admins where user_id = p_user)
$$;
revoke all on function app.is_platform_admin(uuid) from public;

create function app.flag(p_key text) returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select enabled from public.feature_flags where key = p_key), true)
$$;
revoke all on function app.flag(text) from public;
grant execute on function app.flag(text) to service_role;

create function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_platform_admin(auth.uid())
$$;

create function app.require_platform_admin() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := app.require_user();
begin
  if not app.is_platform_admin(uid) then
    raise exception 'Not found' using errcode = 'SA404';
  end if;
  return uid;
end $$;
revoke all on function app.require_platform_admin() from public;

create function public.admin_overview() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := app.require_platform_admin();
begin
  perform app.audit(null, uid, 'admin.overview_viewed', null, null);
  return jsonb_build_object(
    'organizations', (select count(*) from public.organizations where deleted_at is null),
    'organizations30d', (select count(*) from public.organizations where deleted_at is null and created_at > now() - interval '30 days'),
    'users', (select count(*) from public.profiles),
    'plans', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (
        select app.effective_plan(o.id) as k, count(*) as n from public.organizations o where o.deleted_at is null group by 1) x),
    'subscriptionStatus', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (
        select status::text, count(*) as n from public.subscriptions group by 1) x),
    'mrr', (select coalesce(jsonb_object_agg(currency, total), '{}'::jsonb) from (
        select p.currency, sum(p.price_minor) as total
        from public.subscriptions s join public.plans p on p.code = s.plan_code
        where s.status in ('active', 'past_due') and s.provider is not null and p.price_minor > 0
        group by p.currency) x),
    'health', jsonb_build_object(
      'reminderJobsFailed7d', (select count(*) from public.reminder_jobs where status = 'failed' and updated_at > now() - interval '7 days'),
      'reminderJobsStuck', (select count(*) from public.reminder_jobs
                            where (status = 'scheduled' and next_attempt_at < now() - interval '1 hour')
                               or (status = 'processing' and locked_until < now() - interval '1 hour')),
      'emailProblems7d', (select count(*) from public.email_messages
                          where status in ('failed', 'bounced', 'complained') and updated_at > now() - interval '7 days'),
      'recurringErrors', (select count(*) from public.recurring_rules where status = 'active' and last_error is not null),
      'billingErrors7d', (select count(*) from public.subscription_events where outcome = 'error' and received_at > now() - interval '7 days'),
      'aiErrors7d', (select count(*) from public.ai_usage_logs where outcome in ('error', 'rejected') and created_at > now() - interval '7 days')
    ),
    'recentBillingErrors', (select coalesce(jsonb_agg(jsonb_build_object(
        'type', event_type, 'detail', detail, 'receivedAt', received_at, 'orgId', org_id) order by received_at desc), '[]'::jsonb)
      from (select * from public.subscription_events where outcome = 'error' order by received_at desc limit 10) e)
  );
end $$;

-- Organization directory: metadata and counts only.
create function public.admin_organizations(p_search text default '', p_limit integer default 50) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := app.require_platform_admin();
  term text := btrim(coalesce(p_search, ''));
begin
  perform app.audit(null, uid, 'admin.organizations_listed', null, null, jsonb_build_object('search', left(term, 80)));
  return (select coalesce(jsonb_agg(row_to_json(x) order by x.created_at desc), '[]'::jsonb) from (
    select o.id, o.name, o.country, o.created_at, app.effective_plan(o.id) as plan, s.status,
           (select count(*) from public.organization_members m where m.org_id = o.id) as members,
           (select count(*) from public.invoices i where i.org_id = o.id and i.deleted_at is null) as documents,
           st.reminders_enabled
    from public.organizations o
    left join public.subscriptions s on s.org_id = o.id
    left join public.organization_settings st on st.org_id = o.id
    where o.deleted_at is null and (term = '' or o.name ilike '%' || replace(replace(term, '%', ''), '_', '') || '%')
    order by o.created_at desc
    limit least(greatest(p_limit, 1), 200)) x);
end $$;

create function public.admin_set_flag(p_key text, p_enabled boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := app.require_platform_admin();
begin
  update public.feature_flags set enabled = p_enabled, updated_by = uid, updated_at = now() where key = p_key;
  if not found then
    raise exception 'Unknown flag' using errcode = 'SA404';
  end if;
  perform app.audit(null, uid, 'admin.flag_changed', null, null, jsonb_build_object('key', p_key, 'enabled', p_enabled));
end $$;

revoke execute on function public.is_platform_admin(), public.admin_overview(), public.admin_organizations(text, integer),
  public.admin_set_flag(text, boolean) from public, anon;
grant execute on function public.is_platform_admin(), public.admin_overview(), public.admin_organizations(text, integer),
  public.admin_set_flag(text, boolean) to authenticated;

-- The scheduler respects the kill switches.
create or replace function public.rf_scheduler_flags() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('reminders', app.flag('automatic_reminders'), 'recurring', app.flag('recurring_invoices'),
                            'ai', app.flag('ai_assistant'))
$$;
revoke execute on function public.rf_scheduler_flags() from public, anon, authenticated;
grant execute on function public.rf_scheduler_flags() to service_role;
