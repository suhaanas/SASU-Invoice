-- Phase 2: payments ledger, secure share links for clients, and the
-- aggregates behind the dashboard and client balances.
--
-- Payments: once an invoice has ledger rows, the ledger is the source of truth
-- for "amount paid". Rows are never edited; a mistake is corrected by voiding
-- the row (owners/admins, with a reason) and recording a new one. Every change
-- is audited. Amounts use the invoice's currency; there is no FX here.

create function app.currency_digits(p_currency text) returns integer language sql immutable as $$
  -- Matches Intl's minor units for the currencies the editor supports.
  select case when p_currency in ('JPY') then 0 else 2 end
$$;

create table public.invoice_payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  paid_on date not null,
  method text not null check (method in ('bank_transfer', 'card', 'cash', 'cheque', 'paypal', 'online', 'other')),
  reference text not null default '' check (length(reference) <= 120),
  notes text not null default '' check (length(notes) <= 1000),
  -- 'opening_balance' carries over an "amount paid" entered before payments were tracked.
  source text not null default 'manual' check (source in ('manual', 'opening_balance')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references auth.users (id) on delete set null,
  void_reason text check (void_reason is null or length(void_reason) between 1 and 500)
);
create index invoice_payments_invoice_idx on public.invoice_payments (invoice_id);
create index invoice_payments_org_paid_idx on public.invoice_payments (org_id, paid_on desc) where voided_at is null;

-- Recompute an invoice's paid amount, balance and payment-driven status from
-- its ledger, and mirror them into the editor document. No-op without ledger rows.
create function app.apply_payments(p_invoice uuid) returns void
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
end $$;
revoke all on function app.apply_payments(uuid) from public;

create function public.record_payment(
  p_invoice uuid,
  p_amount_minor bigint,
  p_paid_on date,
  p_method text,
  p_reference text default '',
  p_notes text default ''
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := app.require_user();
  inv public.invoices;
  v_sum bigint;
  new_id uuid;
begin
  select * into inv from public.invoices where id = p_invoice and deleted_at is null for update;
  if not found or app.member_role(inv.org_id, uid) is null then
    raise exception 'Invoice not found' using errcode = 'SA404';
  end if;
  if inv.doc_type <> 'invoice' or inv.issued_at is null then
    raise exception 'Payments can only be recorded on issued invoices' using errcode = 'SA422';
  end if;
  if inv.status = 'Cancelled' then
    raise exception 'This invoice is cancelled' using errcode = 'SA422';
  end if;
  if p_amount_minor is null or p_amount_minor <= 0 then
    raise exception 'Enter an amount greater than zero' using errcode = 'SA422';
  end if;
  if p_paid_on is null or p_paid_on > current_date + 1 or p_paid_on < date '2000-01-01' then
    raise exception 'Enter the date the payment was received (not in the future)' using errcode = 'SA422';
  end if;

  -- First ledger entry: keep any amount already marked as paid on the invoice.
  if not exists (select 1 from public.invoice_payments where invoice_id = p_invoice) and inv.paid_minor > 0 then
    insert into public.invoice_payments (org_id, invoice_id, amount_minor, currency, paid_on, method, reference, source, created_by)
    values (inv.org_id, inv.id, inv.paid_minor, inv.currency, coalesce(inv.issue_date, current_date), 'other',
            'Recorded before payment tracking', 'opening_balance', uid);
  end if;

  select coalesce(sum(amount_minor), 0) into v_sum
  from public.invoice_payments where invoice_id = p_invoice and voided_at is null;
  if v_sum + p_amount_minor > inv.total_minor then
    raise exception 'This payment is more than the outstanding balance' using errcode = 'SA422';
  end if;

  insert into public.invoice_payments (org_id, invoice_id, amount_minor, currency, paid_on, method, reference, notes, created_by)
  values (inv.org_id, inv.id, p_amount_minor, inv.currency, p_paid_on, p_method,
          left(btrim(coalesce(p_reference, '')), 120), left(btrim(coalesce(p_notes, '')), 1000), uid)
  returning id into new_id;
  perform app.apply_payments(inv.id);
  perform app.audit(inv.org_id, uid, 'payment.recorded', 'invoice', inv.id,
                    jsonb_build_object('payment', new_id, 'amount_minor', p_amount_minor, 'currency', inv.currency));
  return new_id;
end $$;

create function public.void_payment(p_payment uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := app.require_user();
  pay public.invoice_payments;
begin
  select * into pay from public.invoice_payments where id = p_payment for update;
  if not found or app.member_role(pay.org_id, uid) is null then
    raise exception 'Payment not found' using errcode = 'SA404';
  end if;
  if app.member_role(pay.org_id, uid) = 'member' then
    raise exception 'Only owners and admins can void payments' using errcode = 'SA403';
  end if;
  if pay.voided_at is not null then
    raise exception 'This payment is already voided' using errcode = 'SA409';
  end if;
  if length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'Give a reason for voiding this payment' using errcode = 'SA422';
  end if;
  update public.invoice_payments
  set voided_at = now(), voided_by = uid, void_reason = left(btrim(p_reason), 500)
  where id = p_payment;
  perform app.apply_payments(pay.invoice_id);
  perform app.audit(pay.org_id, uid, 'payment.voided', 'invoice', pay.invoice_id,
                    jsonb_build_object('payment', p_payment, 'amount_minor', pay.amount_minor, 'reason', left(btrim(p_reason), 500)));
end $$;

-- save_invoice: unchanged, except that the payments ledger (when present)
-- overrides whatever "amount paid" the editor sent, and the response tells the
-- editor the authoritative amount paid and status.
create or replace function public.save_invoice(
  p_user uuid,
  p_org uuid,
  p_doc jsonb,
  p_totals jsonb,
  p_expected_revision integer default null,
  p_source text default 'editor'
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  caller_role public.org_role := app.member_role(p_org, p_user);
  v_local_id uuid := app.try_uuid(p_doc ->> 'id');
  existing public.invoices;
  v_issued_at timestamptz := app.epoch_ms_to_ts(p_doc #> '{meta,issuedAt}');
  v_client uuid;
  saved public.invoices;
begin
  if caller_role is null then
    raise exception 'Not a member of this organization' using errcode = 'SA403';
  end if;
  if v_local_id is null then
    raise exception 'Document id is missing' using errcode = 'SA422';
  end if;

  select * into existing from public.invoices where org_id = p_org and local_id = v_local_id for update;

  if found then
    if existing.deleted_at is not null then
      raise exception 'This document was deleted from the cloud' using errcode = 'SA409';
    end if;
    if p_expected_revision is not null and p_expected_revision <> existing.revision then
      raise exception 'This document was changed elsewhere (revision %)', existing.revision using errcode = 'SA409';
    end if;
    if existing.issued_at is not null and v_issued_at is null then
      if caller_role = 'member' then
        raise exception 'Only owners and admins can unlock an issued document' using errcode = 'SA403';
      end if;
      if exists (select 1 from public.invoice_payments where invoice_id = existing.id and voided_at is null) then
        raise exception 'This invoice has recorded payments; void them before unlocking it' using errcode = 'SA423';
      end if;
      perform set_config('app.allow_unlock', 'on', true);
      perform app.audit(p_org, p_user, 'invoice.unlocked', 'invoice', existing.id,
                        jsonb_build_object('number', existing.number));
    end if;
  elsif (select count(*) from public.invoices where org_id = p_org and deleted_at is null)
        >= app.limit_for(p_org, 'cloud_invoices') then
    raise exception 'Your plan''s cloud invoice limit is reached' using errcode = 'SA402';
  end if;

  v_client := app.resolve_client(p_org, p_user, p_doc -> 'client');

  begin
    insert into public.invoices as i (
      org_id, local_id, client_id, doc_type, number, status, currency, issue_date, due_date, client_name,
      subtotal_minor, discount_minor, tax_minor, shipping_minor, total_minor, paid_minor, balance_minor,
      document, issued_at, source, created_by, updated_by
    ) values (
      p_org, v_local_id, v_client, p_doc ->> 'docType', btrim(p_doc #>> '{meta,number}'),
      p_doc #>> '{meta,status}', p_doc #>> '{meta,currency}',
      app.iso_date(p_doc #>> '{meta,issueDate}'), app.iso_date(p_doc #>> '{meta,dueDate}'),
      left(coalesce(nullif(btrim(p_doc #>> '{client,company}'), ''), btrim(p_doc #>> '{client,name}'), ''), 200),
      (p_totals ->> 'subtotal')::bigint, (p_totals ->> 'discount')::bigint, (p_totals ->> 'tax')::bigint,
      (p_totals ->> 'shipping')::bigint, (p_totals ->> 'total')::bigint, (p_totals ->> 'paid')::bigint,
      (p_totals ->> 'balance')::bigint,
      p_doc, v_issued_at, p_source, p_user, p_user
    )
    on conflict (org_id, local_id) do update set
      client_id = excluded.client_id,
      doc_type = excluded.doc_type,
      number = excluded.number,
      status = excluded.status,
      currency = excluded.currency,
      issue_date = excluded.issue_date,
      due_date = excluded.due_date,
      client_name = excluded.client_name,
      subtotal_minor = excluded.subtotal_minor,
      discount_minor = excluded.discount_minor,
      tax_minor = excluded.tax_minor,
      shipping_minor = excluded.shipping_minor,
      total_minor = excluded.total_minor,
      paid_minor = excluded.paid_minor,
      balance_minor = excluded.balance_minor,
      document = excluded.document,
      issued_at = excluded.issued_at,
      updated_by = excluded.updated_by,
      revision = i.revision + 1
    returning * into saved;
  exception when unique_violation then
    raise exception 'Number % is already used by another issued document', btrim(p_doc #>> '{meta,number}')
      using errcode = 'SA409';
  end;

  perform app.apply_payments(saved.id);
  select * into saved from public.invoices where id = saved.id;

  if saved.issued_at is not null and (existing.id is null or existing.issued_at is null) then
    perform app.audit(p_org, p_user, 'invoice.issued', 'invoice', saved.id, jsonb_build_object('number', saved.number));
  elsif existing.id is null then
    perform app.audit(p_org, p_user, 'invoice.created', 'invoice', saved.id, jsonb_build_object('source', p_source));
  elsif existing.status is distinct from saved.status then
    perform app.audit(p_org, p_user, 'invoice.status_changed', 'invoice', saved.id,
                      jsonb_build_object('from', existing.status, 'to', saved.status));
  end if;

  return jsonb_build_object('id', saved.id, 'localId', saved.local_id, 'revision', saved.revision,
                            'status', saved.status, 'issued', saved.issued_at is not null,
                            'amountPaid', saved.document #> '{totals,amountPaid}');
end $$;
revoke execute on function public.save_invoice(uuid, uuid, jsonb, jsonb, integer, text) from public, anon, authenticated;
grant execute on function public.save_invoice(uuid, uuid, jsonb, jsonb, integer, text) to service_role;

-- Share links ---------------------------------------------------------------------------

create table public.invoice_shares (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  -- sha256 of the token; the token itself is shown once and never stored.
  token_hash bytea not null unique,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_viewed_at timestamptz,
  view_count integer not null default 0
);
create index invoice_shares_invoice_idx on public.invoice_shares (invoice_id);

create function public.create_invoice_share(p_invoice uuid, p_days integer default 30) returns text
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := app.require_user();
  inv public.invoices;
  token text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  share_id uuid;
begin
  select * into inv from public.invoices where id = p_invoice and deleted_at is null;
  if not found or app.member_role(inv.org_id, uid) is null then
    raise exception 'Invoice not found' using errcode = 'SA404';
  end if;
  if inv.issued_at is null then
    raise exception 'Issue the document before sharing it' using errcode = 'SA422';
  end if;
  if p_days is null or p_days not between 1 and 365 then
    raise exception 'Links can last between 1 and 365 days' using errcode = 'SA422';
  end if;
  insert into public.invoice_shares (org_id, invoice_id, token_hash, created_by, expires_at)
  values (inv.org_id, inv.id, sha256(convert_to(token, 'UTF8')), uid, now() + make_interval(days => p_days))
  returning id into share_id;
  perform app.audit(inv.org_id, uid, 'share.created', 'invoice', inv.id,
                    jsonb_build_object('share', share_id, 'days', p_days));
  return token;
end $$;

create function public.revoke_invoice_share(p_share uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := app.require_user();
  s public.invoice_shares;
begin
  select * into s from public.invoice_shares where id = p_share;
  if not found or app.member_role(s.org_id, uid) is null then
    raise exception 'Link not found' using errcode = 'SA404';
  end if;
  update public.invoice_shares set revoked_at = now() where id = p_share and revoked_at is null;
  perform app.audit(s.org_id, uid, 'share.revoked', 'invoice', s.invoice_id, jsonb_build_object('share', p_share));
end $$;

-- The client-facing view. Callable without an account: the 244-bit token is
-- the credential. Returns only what is printed on the document plus its
-- payment state, and nothing at all for unknown, expired or revoked links.
create function public.get_shared_invoice(p_token text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  s public.invoice_shares;
  inv public.invoices;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return null;
  end if;
  select * into s from public.invoice_shares
  where token_hash = sha256(convert_to(p_token, 'UTF8')) and revoked_at is null and expires_at > now();
  if not found then
    return null;
  end if;
  select * into inv from public.invoices where id = s.invoice_id and deleted_at is null and issued_at is not null;
  if not found then
    return null;
  end if;
  update public.invoice_shares set last_viewed_at = now(), view_count = view_count + 1 where id = s.id;
  return jsonb_build_object(
    'document', inv.document,
    'status', inv.status,
    'currency', inv.currency,
    'totalMinor', inv.total_minor,
    'paidMinor', inv.paid_minor,
    'balanceMinor', inv.balance_minor,
    'dueDate', inv.due_date,
    'expiresAt', s.expires_at,
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object('paidOn', p.paid_on, 'amountMinor', p.amount_minor) order by p.paid_on)
      from public.invoice_payments p where p.invoice_id = inv.id and p.voided_at is null
    ), '[]'::jsonb)
  );
end $$;

revoke execute on function
  public.record_payment(uuid, bigint, date, text, text, text),
  public.void_payment(uuid, text),
  public.create_invoice_share(uuid, integer),
  public.revoke_invoice_share(uuid),
  public.get_shared_invoice(text)
from public, anon, authenticated;
grant execute on function
  public.record_payment(uuid, bigint, date, text, text, text),
  public.void_payment(uuid, text),
  public.create_invoice_share(uuid, integer),
  public.revoke_invoice_share(uuid)
to authenticated;
grant execute on function public.get_shared_invoice(text) to anon, authenticated;

-- Aggregates (security invoker: RLS decides what is counted) ------------------------------

-- Money totals per currency. Never mixes currencies: callers pick one.
create function public.dashboard_summary(p_org uuid, p_currency text) returns jsonb
language sql stable security invoker set search_path = '' as $$
  with org as (
    select (now() at time zone o.timezone)::date as today
    from public.organizations o where o.id = p_org
  ),
  inv as (
    select i.*, (select today from org) as today
    from public.invoices i
    where i.org_id = p_org and i.currency = p_currency and i.doc_type = 'invoice'
      and i.issued_at is not null and i.deleted_at is null and i.status <> 'Cancelled'
  ),
  open_inv as (select * from inv where balance_minor > 0),
  pays as (
    select p.* from public.invoice_payments p
    where p.org_id = p_org and p.currency = p_currency and p.voided_at is null
  ),
  months as (
    select generate_series(date_trunc('month', (select today from org)) - interval '5 months',
                           date_trunc('month', (select today from org)), interval '1 month')::date as m
  )
  select jsonb_build_object(
    'currency', p_currency,
    'today', (select today from org),
    'invoicedMinor', coalesce((select sum(total_minor) from inv), 0),
    'paidMinor', coalesce((select sum(paid_minor) from inv), 0),
    'outstandingMinor', coalesce((select sum(balance_minor) from open_inv), 0),
    'outstandingCount', (select count(*) from open_inv),
    'overdueMinor', coalesce((select sum(balance_minor) from open_inv where due_date < today), 0),
    'overdueCount', (select count(*) from open_inv where due_date < today),
    'partialMinor', coalesce((select sum(balance_minor) from open_inv where paid_minor > 0), 0),
    'partialCount', (select count(*) from open_inv where paid_minor > 0),
    'dueWeekMinor', coalesce((select sum(balance_minor) from open_inv where due_date between today and today + 7), 0),
    'dueWeekCount', (select count(*) from open_inv where due_date between today and today + 7),
    'paymentsMonthMinor', coalesce((select sum(amount_minor) from pays
                                    where paid_on >= date_trunc('month', (select today from org))::date), 0),
    'monthly', (
      select jsonb_agg(jsonb_build_object(
        'month', to_char(m, 'YYYY-MM'),
        'invoicedMinor', coalesce((select sum(total_minor) from inv where date_trunc('month', issue_date) = m), 0),
        'receivedMinor', coalesce((select sum(amount_minor) from pays where date_trunc('month', paid_on) = m), 0)
      ) order by m)
      from months
    ),
    'aging', jsonb_build_object(
      'current', coalesce((select sum(balance_minor) from open_inv where due_date is null or due_date >= today), 0),
      'd1_30', coalesce((select sum(balance_minor) from open_inv where today - due_date between 1 and 30), 0),
      'd31_60', coalesce((select sum(balance_minor) from open_inv where today - due_date between 31 and 60), 0),
      'd61_90', coalesce((select sum(balance_minor) from open_inv where today - due_date between 61 and 90), 0),
      'd90_plus', coalesce((select sum(balance_minor) from open_inv where today - due_date > 90), 0)
    ),
    'statusCounts', jsonb_build_object(
      'paid', (select count(*) from inv where balance_minor <= 0),
      'partial', (select count(*) from open_inv where paid_minor > 0 and (due_date is null or due_date >= today)),
      'unpaid', (select count(*) from open_inv where paid_minor = 0 and (due_date is null or due_date >= today)),
      'overdue', (select count(*) from open_inv where due_date < today)
    )
  )
$$;

-- Currencies the organization has issued invoices in, most used first.
create function public.org_currencies(p_org uuid) returns table (currency text, invoices bigint)
language sql stable security invoker set search_path = '' as $$
  select currency, count(*) from public.invoices
  where org_id = p_org and deleted_at is null and issued_at is not null and doc_type = 'invoice'
  group by currency order by count(*) desc, currency
$$;

-- Per client and currency: invoiced, paid and outstanding on issued invoices.
create function public.client_balances(p_org uuid, p_client uuid default null)
returns table (client_id uuid, currency text, invoiced_minor bigint, paid_minor bigint, outstanding_minor bigint,
               overdue_minor bigint, invoice_count bigint, last_issue_date date)
language sql stable security invoker set search_path = '' as $$
  select i.client_id, i.currency,
         sum(i.total_minor)::bigint, sum(i.paid_minor)::bigint, sum(greatest(i.balance_minor, 0))::bigint,
         sum(case when i.balance_minor > 0
                       and i.due_date < (select (now() at time zone o.timezone)::date from public.organizations o where o.id = p_org)
                  then i.balance_minor else 0 end)::bigint,
         count(*), max(i.issue_date)
  from public.invoices i
  where i.org_id = p_org and i.client_id is not null and i.deleted_at is null and i.issued_at is not null
    and i.doc_type = 'invoice' and i.status <> 'Cancelled' and (p_client is null or i.client_id = p_client)
  group by i.client_id, i.currency
$$;

revoke execute on function
  public.dashboard_summary(uuid, text), public.org_currencies(uuid), public.client_balances(uuid, uuid)
from public, anon;
grant execute on function
  public.dashboard_summary(uuid, text), public.org_currencies(uuid), public.client_balances(uuid, uuid)
to authenticated;

-- RLS ------------------------------------------------------------------------------------

alter table public.invoice_payments enable row level security;
alter table public.invoice_shares enable row level security;
revoke all on public.invoice_payments, public.invoice_shares from anon, authenticated;

grant select on public.invoice_payments to authenticated;
create policy payments_select on public.invoice_payments for select to authenticated
  using (app.is_member(org_id));

grant select (id, org_id, invoice_id, created_by, created_at, expires_at, revoked_at, last_viewed_at, view_count)
  on public.invoice_shares to authenticated;
create policy shares_select on public.invoice_shares for select to authenticated
  using (app.is_member(org_id));

-- Members may read audit entries about a specific invoice (its history), not the whole log.
create policy audit_select_invoice on public.audit_logs for select to authenticated
  using (entity_type = 'invoice' and app.is_member(org_id));
