-- Phase 1 foundation: profiles, organizations, membership, invitations,
-- settings, plans, subscriptions, audit log and account deletion requests.
--
-- Tenancy model: every business record carries org_id. Row-level security
-- (see 20261024000003_rls.sql) only lets a user see rows of organizations they
-- are a member of. Writes that need more than a row check go through
-- security-definer functions that re-verify membership and role themselves.

-- Helpers live in a schema PostgREST does not expose.
create schema if not exists app;
grant usage on schema app to authenticated, service_role;

create type public.org_role as enum ('owner', 'admin', 'member');
create type public.subscription_status as enum ('trialing', 'active', 'past_due', 'canceled', 'expired');

-- Raised by our own checks; mapped to HTTP codes by the API layer.
--   SA401 not signed in · SA402 plan limit · SA403 forbidden · SA404 not found
--   SA409 conflict · SA422 invalid input · SA423 document locked

create function app.touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create function app.try_uuid(value text) returns uuid language plpgsql immutable as $$
begin
  return value::uuid;
exception when others then
  return null;
end $$;

create function app.require_user() returns uuid language plpgsql stable as $$
declare uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not signed in' using errcode = 'SA401';
  end if;
  return uid;
end $$;

-- profiles ------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '' check (length(full_name) <= 120),
  email text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_touch before update on public.profiles
  for each row execute function app.touch_updated_at();

create function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 120),
    coalesce(new.email, '')
  )
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function app.handle_new_user();

create function app.handle_user_email_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set email = coalesce(new.email, '') where id = new.id;
  return new;
end $$;
create trigger on_auth_user_email_changed after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function app.handle_user_email_change();

-- organizations ---------------------------------------------------------------

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  country text check (country ~ '^[A-Z]{2}$'),
  default_currency text not null default 'USD' check (default_currency ~ '^[A-Z]{3}$'),
  timezone text not null default 'UTC' check (length(timezone) between 1 and 64),
  onboarding_completed_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create trigger organizations_touch before update on public.organizations
  for each row execute function app.touch_updated_at();

create table public.organization_members (
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- References profiles (which cascade from auth.users) so the API can embed names.
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.org_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index organization_members_user_idx on public.organization_members (user_id);

-- Membership checks used by RLS policies. SECURITY DEFINER so policies on
-- organization_members itself don't recurse.
create function app.member_role(p_org uuid, p_user uuid) returns public.org_role
language sql stable security definer set search_path = '' as $$
  select m.role
  from public.organization_members m
  join public.organizations o on o.id = m.org_id and o.deleted_at is null
  where m.org_id = p_org and m.user_id = p_user
$$;

create function app.is_member(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.member_role(p_org, auth.uid()) is not null
$$;

create function app.has_role(p_org uuid, p_roles public.org_role[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(app.member_role(p_org, auth.uid()) = any (p_roles), false)
$$;

revoke all on function app.member_role(uuid, uuid) from public;
grant execute on function app.is_member(uuid), app.has_role(uuid, public.org_role[]) to authenticated;
grant execute on function app.member_role(uuid, uuid) to service_role;

-- An organization must always keep at least one owner.
create function app.keep_an_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.role = 'owner' and (tg_op = 'DELETE' or new.role <> 'owner') then
    if not exists (
      select 1 from public.organization_members
      where org_id = old.org_id and role = 'owner' and user_id <> old.user_id
    ) and exists (select 1 from public.organizations where id = old.org_id) then
      raise exception 'An organization needs at least one owner' using errcode = 'SA409';
    end if;
  end if;
  return coalesce(new, old);
end $$;
create trigger organization_members_keep_owner
  before update or delete on public.organization_members
  for each row execute function app.keep_an_owner();

-- invitations -------------------------------------------------------------------

create table public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  email text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role public.org_role not null check (role <> 'owner'),
  -- sha256 of the token; the token itself is shown once and never stored.
  token_hash bytea not null unique,
  invited_by uuid references auth.users (id) on delete set null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index organization_invitations_org_idx on public.organization_invitations (org_id);
create unique index organization_invitations_pending_uq on public.organization_invitations (org_id, email)
  where accepted_at is null and revoked_at is null;

-- settings ------------------------------------------------------------------------

create table public.organization_settings (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  -- Business email, address, tax IDs… shaped like the editor's Profile; read
  -- back through the same zod schema in the app.
  business jsonb not null default '{}'::jsonb check (pg_column_size(business) < 32768),
  invoice_prefix text not null default 'INV-' check (length(invoice_prefix) <= 20),
  tax_label text not null default 'Tax' check (length(tax_label) <= 30),
  tax_rate numeric(6, 3) not null default 0 check (tax_rate between 0 and 100),
  payment_terms text not null default '' check (length(payment_terms) <= 500),
  payment_instructions text not null default '' check (length(payment_instructions) <= 2000),
  logo_path text check (logo_path is null or length(logo_path) <= 300),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
create trigger organization_settings_touch before update on public.organization_settings
  for each row execute function app.touch_updated_at();

-- plans & subscriptions -------------------------------------------------------------

-- Prices and limits are data, editable without a deploy. The frontend only
-- displays them; enforcement happens in SQL (app.limit_for).
create table public.plans (
  code text primary key check (code ~ '^[a-z][a-z0-9_]{1,30}$'),
  name text not null,
  price_minor integer not null check (price_minor >= 0),
  currency text not null default 'USD',
  billing_interval text not null default 'month' check (billing_interval in ('month', 'year')),
  limits jsonb not null,
  features text[] not null default '{}',
  is_active boolean not null default true,
  sort_order integer not null default 0
);

insert into public.plans (code, name, price_minor, limits, features, sort_order) values
  ('free', 'Free', 0,
   '{"cloud_invoices": 0, "users": 1, "email_sends_per_month": 0, "ai_requests_per_month": 0}',
   '{local_editor}', 0),
  ('pro', 'Pro', 1200,
   '{"cloud_invoices": 100, "users": 1, "email_sends_per_month": 100, "ai_requests_per_month": 100}',
   '{local_editor,cloud_storage,reminders,ai_basic,recurring,reports_standard}', 1),
  ('business', 'Business', 2900,
   '{"cloud_invoices": 500, "users": 5, "email_sends_per_month": 600, "ai_requests_per_month": 600}',
   '{local_editor,cloud_storage,reminders,reminders_advanced,ai_basic,recurring,reports_standard,reports_advanced,team,priority_support}', 2);

create table public.subscriptions (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  plan_code text not null references public.plans (code),
  status public.subscription_status not null,
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  -- Filled in by the billing provider integration (Phase 4).
  provider text,
  provider_customer_id text,
  provider_subscription_id text unique,
  updated_at timestamptz not null default now()
);
create trigger subscriptions_touch before update on public.subscriptions
  for each row execute function app.touch_updated_at();

-- The plan whose limits apply right now: an expired trial or a cancelled
-- subscription falls back to Free (existing data stays readable).
create function app.effective_plan(p_org uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select s.plan_code from public.subscriptions s
    where s.org_id = p_org
      and (
        s.status in ('active', 'past_due')
        or (s.status = 'trialing' and s.trial_ends_at > now())
        or (s.status = 'canceled' and s.current_period_end > now())
      )
  ), 'free')
$$;

create function app.limit_for(p_org uuid, p_key text) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce((p.limits ->> p_key)::integer, 0)
  from public.plans p where p.code = app.effective_plan(p_org)
$$;
revoke all on function app.effective_plan(uuid), app.limit_for(uuid, text) from public;
grant execute on function app.effective_plan(uuid), app.limit_for(uuid, text) to authenticated, service_role;

-- audit log -------------------------------------------------------------------------

create table public.audit_logs (
  id bigint generated always as identity primary key,
  org_id uuid references public.organizations (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  action text not null check (length(action) <= 80),
  entity_type text check (length(entity_type) <= 40),
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_org_idx on public.audit_logs (org_id, created_at desc);

create function app.audit(
  p_org uuid, p_actor uuid, p_action text, p_entity_type text, p_entity_id uuid, p_metadata jsonb default '{}'
) returns void language sql security definer set search_path = '' as $$
  insert into public.audit_logs (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_org, p_actor, p_action, p_entity_type, p_entity_id, coalesce(p_metadata, '{}'::jsonb))
$$;
revoke all on function app.audit(uuid, uuid, text, text, uuid, jsonb) from public;

-- account deletion requests ---------------------------------------------------------

create table public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  reason text not null default '' check (length(reason) <= 1000),
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'rejected')),
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
create unique index account_deletion_requests_pending_uq on public.account_deletion_requests (user_id)
  where status in ('pending', 'processing');

-- RPCs callable by signed-in users ---------------------------------------------------

-- Creates an organization with the caller as owner, default settings and a
-- 14-day Pro trial, atomically.
create function public.create_organization(
  p_name text,
  p_country text default null,
  p_currency text default 'USD',
  p_timezone text default 'UTC'
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := app.require_user();
  new_id uuid;
begin
  if (select count(*) from public.organization_members m where m.user_id = uid and m.role = 'owner') >= 10 then
    raise exception 'You can own at most 10 organizations' using errcode = 'SA402';
  end if;
  insert into public.organizations (name, country, default_currency, timezone, created_by)
  values (btrim(p_name), nullif(upper(p_country), ''), upper(coalesce(p_currency, 'USD')),
          coalesce(nullif(p_timezone, ''), 'UTC'), uid)
  returning id into new_id;
  insert into public.organization_members (org_id, user_id, role) values (new_id, uid, 'owner');
  insert into public.organization_settings (org_id, updated_by) values (new_id, uid);
  insert into public.subscriptions (org_id, plan_code, status, trial_ends_at)
  values (new_id, 'pro', 'trialing', now() + interval '14 days');
  perform app.audit(new_id, uid, 'organization.created', 'organization', new_id);
  return new_id;
end $$;

-- Returns the one-time invitation token. Owners invite admins or members;
-- admins invite members. Seats are limited by the plan's "users" limit.
create function public.create_invitation(p_org uuid, p_email text, p_role public.org_role default 'member')
returns text
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := app.require_user();
  caller_role public.org_role := app.member_role(p_org, uid);
  token text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  seats integer;
  inv_id uuid;
begin
  if caller_role is null or caller_role = 'member' then
    raise exception 'Only owners and admins can invite' using errcode = 'SA403';
  end if;
  if p_role = 'owner' or (p_role = 'admin' and caller_role <> 'owner') then
    raise exception 'You cannot invite with that role' using errcode = 'SA403';
  end if;
  select (select count(*) from public.organization_members where org_id = p_org)
       + (select count(*) from public.organization_invitations
          where org_id = p_org and accepted_at is null and revoked_at is null and expires_at > now())
    into seats;
  if seats >= app.limit_for(p_org, 'users') then
    raise exception 'Your plan has no free seats' using errcode = 'SA402';
  end if;
  if exists (
    select 1 from public.organization_members m join auth.users u on u.id = m.user_id
    where m.org_id = p_org and lower(u.email) = lower(btrim(p_email))
  ) then
    raise exception 'That person is already a member' using errcode = 'SA409';
  end if;
  -- Re-inviting replaces any earlier pending invitation for the same address.
  update public.organization_invitations set revoked_at = now()
  where org_id = p_org and email = lower(btrim(p_email)) and accepted_at is null and revoked_at is null;
  insert into public.organization_invitations (org_id, email, role, token_hash, invited_by, expires_at)
  values (p_org, lower(btrim(p_email)), p_role, sha256(convert_to(token, 'UTF8')), uid, now() + interval '7 days')
  returning id into inv_id;
  perform app.audit(p_org, uid, 'invitation.created', 'invitation', inv_id, jsonb_build_object('role', p_role));
  return token;
end $$;

create function public.accept_invitation(p_token text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := app.require_user();
  inv public.organization_invitations;
  user_email text;
begin
  select * into inv from public.organization_invitations
  where token_hash = sha256(convert_to(coalesce(p_token, ''), 'UTF8'))
  for update;
  if not found or inv.revoked_at is not null or inv.accepted_at is not null or inv.expires_at <= now() then
    raise exception 'This invitation is invalid or has expired' using errcode = 'SA404';
  end if;
  select lower(email) into user_email from auth.users where id = uid;
  if user_email is distinct from inv.email then
    raise exception 'This invitation was sent to a different email address' using errcode = 'SA403';
  end if;
  insert into public.organization_members (org_id, user_id, role) values (inv.org_id, uid, inv.role)
  on conflict (org_id, user_id) do nothing;
  update public.organization_invitations set accepted_at = now(), accepted_by = uid where id = inv.id;
  perform app.audit(inv.org_id, uid, 'invitation.accepted', 'invitation', inv.id);
  return inv.org_id;
end $$;

create function public.revoke_invitation(p_invitation uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := app.require_user();
  inv_org uuid;
begin
  select org_id into inv_org from public.organization_invitations where id = p_invitation;
  if inv_org is null or not coalesce(app.member_role(inv_org, uid) in ('owner', 'admin'), false) then
    raise exception 'Invitation not found' using errcode = 'SA404';
  end if;
  update public.organization_invitations set revoked_at = now()
  where id = p_invitation and accepted_at is null and revoked_at is null;
  perform app.audit(inv_org, uid, 'invitation.revoked', 'invitation', p_invitation);
end $$;

-- Owners remove anyone (but the last owner); admins remove members; anyone may leave.
create function public.remove_member(p_org uuid, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := app.require_user();
  caller_role public.org_role := app.member_role(p_org, uid);
  target_role public.org_role := app.member_role(p_org, p_user);
begin
  if caller_role is null or target_role is null then
    raise exception 'Member not found' using errcode = 'SA404';
  end if;
  if uid <> p_user and not (caller_role = 'owner' or (caller_role = 'admin' and target_role = 'member')) then
    raise exception 'You cannot remove this member' using errcode = 'SA403';
  end if;
  delete from public.organization_members where org_id = p_org and user_id = p_user;
  perform app.audit(p_org, uid, 'member.removed', 'user', p_user);
end $$;

create function public.update_member_role(p_org uuid, p_user uuid, p_role public.org_role) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := app.require_user();
begin
  if app.member_role(p_org, uid) is distinct from 'owner' then
    raise exception 'Only owners can change roles' using errcode = 'SA403';
  end if;
  update public.organization_members set role = p_role where org_id = p_org and user_id = p_user;
  if not found then
    raise exception 'Member not found' using errcode = 'SA404';
  end if;
  perform app.audit(p_org, uid, 'member.role_changed', 'user', p_user, jsonb_build_object('role', p_role));
end $$;

revoke execute on function
  public.create_organization(text, text, text, text),
  public.create_invitation(uuid, text, public.org_role),
  public.accept_invitation(text),
  public.revoke_invitation(uuid),
  public.remove_member(uuid, uuid),
  public.update_member_role(uuid, uuid, public.org_role)
from public, anon;
grant execute on function
  public.create_organization(text, text, text, text),
  public.create_invitation(uuid, text, public.org_role),
  public.accept_invitation(text),
  public.revoke_invitation(uuid),
  public.remove_member(uuid, uuid),
  public.update_member_role(uuid, uuid, public.org_role)
to authenticated;
