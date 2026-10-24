-- Clients and cloud-stored documents (invoices, quotes, credit notes,
-- receipts, proformas).
--
-- invoices.document holds the full editor state (InvoiceState v2) so a cloud
-- document round-trips into the editor losslessly. The scalar columns are
-- derived from it on every save, by the `invoices` Edge Function, which
-- validates the document and recomputes totals with the same code the editor
-- uses (src/core). Browsers never write invoices directly.

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null default '' check (length(name) <= 200),
  company text not null default '' check (length(company) <= 200),
  email text not null default '' check (length(email) <= 254),
  phone text not null default '' check (length(phone) <= 50),
  address text not null default '' check (length(address) <= 1000),
  delivery_address text not null default '' check (length(delivery_address) <= 1000),
  country text check (country ~ '^[A-Z]{2}$'),
  tax_id text not null default '' check (length(tax_id) <= 60),
  reg_number text not null default '' check (length(reg_number) <= 60),
  preferred_currency text check (preferred_currency ~ '^[A-Z]{3}$'),
  payment_terms_days integer check (payment_terms_days between 0 and 365),
  notes text not null default '' check (length(notes) <= 5000),
  archived_at timestamptz,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (btrim(name) <> '' or btrim(company) <> '')
);
create index clients_org_idx on public.clients (org_id, archived_at);
-- Same identity rule as the editor's client book (src/core/storage.ts clientBook).
create index clients_identity_idx on public.clients (org_id, lower(btrim(name)), lower(btrim(company)));
create trigger clients_touch before update on public.clients
  for each row execute function app.touch_updated_at();

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- The editor's document id; lets the editor and imports find their cloud copy.
  local_id uuid not null,
  client_id uuid references public.clients (id) on delete set null,
  doc_type text not null check (doc_type in ('invoice', 'quote', 'credit', 'receipt', 'proforma')),
  number text not null check (length(number) <= 60),
  status text not null check (status in (
    'Draft', 'Unpaid', 'Paid', 'Overdue', 'Cancelled', 'Sent', 'Accepted', 'Declined', 'Expired', 'Issued')),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  issue_date date,
  due_date date,
  client_name text not null default '',
  subtotal_minor bigint not null default 0,
  discount_minor bigint not null default 0,
  tax_minor bigint not null default 0,
  shipping_minor bigint not null default 0,
  total_minor bigint not null default 0,
  paid_minor bigint not null default 0,
  balance_minor bigint not null default 0,
  document jsonb not null check (pg_column_size(document) < 3145728),
  revision integer not null default 1,
  issued_at timestamptz,
  source text not null default 'editor' check (source in ('editor', 'import')),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (org_id, local_id)
);
-- Issued documents need unique numbers within their series.
create unique index invoices_number_uq on public.invoices (org_id, doc_type, lower(number))
  where issued_at is not null and deleted_at is null;
create index invoices_org_updated_idx on public.invoices (org_id, updated_at desc) where deleted_at is null;
create index invoices_org_status_due_idx on public.invoices (org_id, status, due_date) where deleted_at is null;
create index invoices_client_idx on public.invoices (org_id, client_id);
create trigger invoices_touch before update on public.invoices
  for each row execute function app.touch_updated_at();

-- What must not change once a document is issued: everything except its
-- status, the amount paid and the "how to pay" details (the same fields the
-- editor leaves editable on a locked document).
create function app.locked_content(doc jsonb) returns jsonb language sql immutable as $$
  select (doc #- '{meta,status}' #- '{totals,amountPaid}') - 'payment' - 'updatedAt'
$$;

create function app.guard_invoice_update() returns trigger language plpgsql as $$
begin
  if new.org_id <> old.org_id or new.local_id <> old.local_id then
    raise exception 'A document cannot move between organizations' using errcode = 'SA422';
  end if;
  if old.issued_at is not null and old.deleted_at is null then
    if new.issued_at is null then
      -- Unlocking is an explicit, role-checked action (see save_invoice).
      if coalesce(current_setting('app.allow_unlock', true), '') <> 'on' then
        raise exception 'Issued documents cannot be unlocked here' using errcode = 'SA423';
      end if;
    elsif app.locked_content(new.document) is distinct from app.locked_content(old.document) then
      raise exception 'This document is issued and locked' using errcode = 'SA423';
    end if;
    if new.deleted_at is not null then
      raise exception 'Issued documents cannot be deleted' using errcode = 'SA423';
    end if;
  end if;
  return new;
end $$;
create trigger invoices_guard before update on public.invoices
  for each row execute function app.guard_invoice_update();

-- Find the org's client matching the document's client, creating it if needed.
create function app.resolve_client(p_org uuid, p_user uuid, p_client jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  c_name text := left(btrim(coalesce(p_client ->> 'name', '')), 200);
  c_company text := left(btrim(coalesce(p_client ->> 'company', '')), 200);
  found_id uuid;
begin
  if c_name = '' and c_company = '' then
    return null;
  end if;
  select id into found_id from public.clients
  where org_id = p_org and lower(btrim(name)) = lower(c_name) and lower(btrim(company)) = lower(c_company)
  order by archived_at nulls first, created_at
  limit 1;
  if found_id is not null then
    return found_id;
  end if;
  insert into public.clients (org_id, name, company, email, phone, address, delivery_address, tax_id, reg_number, created_by)
  values (
    p_org, c_name, c_company,
    left(coalesce(p_client ->> 'email', ''), 254),
    left(coalesce(p_client ->> 'phone', ''), 50),
    left(coalesce(p_client ->> 'address', ''), 1000),
    left(coalesce(p_client ->> 'deliveryAddress', ''), 1000),
    left(coalesce(p_client ->> 'taxId', ''), 60),
    left(coalesce(p_client ->> 'regNumber', ''), 60),
    p_user
  )
  returning id into found_id;
  return found_id;
end $$;
revoke all on function app.resolve_client(uuid, uuid, jsonb) from public;

create function app.epoch_ms_to_ts(value jsonb) returns timestamptz language sql immutable as $$
  select case when jsonb_typeof(value) = 'number' then to_timestamp((value #>> '{}')::numeric / 1000) end
$$;

create function app.iso_date(value text) returns date language sql immutable as $$
  select case when value ~ '^\d{4}-\d{2}-\d{2}$' then value::date end
$$;

-- Upsert one document for p_user in p_org. Only the `invoices` Edge Function
-- (service role) may call this: it has already validated p_doc and computed
-- p_totals server-side. Membership and every business rule are checked here.
create function public.save_invoice(
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

  if saved.issued_at is not null and (existing.id is null or existing.issued_at is null) then
    perform app.audit(p_org, p_user, 'invoice.issued', 'invoice', saved.id, jsonb_build_object('number', saved.number));
  elsif existing.id is null then
    perform app.audit(p_org, p_user, 'invoice.created', 'invoice', saved.id, jsonb_build_object('source', p_source));
  elsif existing.status is distinct from saved.status then
    perform app.audit(p_org, p_user, 'invoice.status_changed', 'invoice', saved.id,
                      jsonb_build_object('from', existing.status, 'to', saved.status));
  end if;

  return jsonb_build_object('id', saved.id, 'localId', saved.local_id, 'revision', saved.revision,
                            'status', saved.status, 'issued', saved.issued_at is not null);
end $$;

-- Import a batch of browser documents. Each row succeeds or fails on its own;
-- documents already in the cloud (same local id) are reported, not overwritten.
create function public.import_invoices(p_user uuid, p_org uuid, p_items jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  item jsonb;
  v_local uuid;
  results jsonb := '[]'::jsonb;
  saved jsonb;
begin
  if app.member_role(p_org, p_user) is null then
    raise exception 'Not a member of this organization' using errcode = 'SA403';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 200 then
    raise exception 'Send between 1 and 200 documents' using errcode = 'SA422';
  end if;
  for item in select * from jsonb_array_elements(p_items) loop
    v_local := app.try_uuid(item #>> '{doc,id}');
    if v_local is not null and exists (
      select 1 from public.invoices i where i.org_id = p_org and i.local_id = v_local
    ) then
      results := results || jsonb_build_object('localId', v_local, 'result', 'duplicate');
      continue;
    end if;
    begin
      saved := public.save_invoice(p_user, p_org, item -> 'doc', item -> 'totals', null, 'import');
      results := results || jsonb_build_object('localId', v_local, 'result', 'imported', 'id', saved ->> 'id');
    exception when others then
      results := results || jsonb_build_object('localId', v_local, 'result', 'failed', 'error', sqlerrm,
                                               'code', sqlstate);
    end;
  end loop;
  perform app.audit(p_org, p_user, 'invoice.imported', 'organization', p_org,
                    jsonb_build_object('count', jsonb_array_length(p_items)));
  return results;
end $$;

-- Drafts can be removed from the cloud; issued documents are financial records and stay.
create function public.delete_draft_invoice(p_invoice uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := app.require_user();
  inv public.invoices;
begin
  select * into inv from public.invoices where id = p_invoice and deleted_at is null;
  if not found or app.member_role(inv.org_id, uid) is null then
    raise exception 'Document not found' using errcode = 'SA404';
  end if;
  if inv.issued_at is not null then
    raise exception 'Issued documents cannot be deleted; create a credit note instead' using errcode = 'SA423';
  end if;
  if app.member_role(inv.org_id, uid) = 'member' and inv.created_by is distinct from uid then
    raise exception 'You can only delete your own drafts' using errcode = 'SA403';
  end if;
  update public.invoices set deleted_at = now() where id = p_invoice;
  perform app.audit(inv.org_id, uid, 'invoice.deleted', 'invoice', p_invoice, jsonb_build_object('number', inv.number));
end $$;

revoke execute on function
  public.save_invoice(uuid, uuid, jsonb, jsonb, integer, text),
  public.import_invoices(uuid, uuid, jsonb)
from public, anon, authenticated;
grant execute on function
  public.save_invoice(uuid, uuid, jsonb, jsonb, integer, text),
  public.import_invoices(uuid, uuid, jsonb)
to service_role;

revoke execute on function public.delete_draft_invoice(uuid) from public, anon;
grant execute on function public.delete_draft_invoice(uuid) to authenticated;
