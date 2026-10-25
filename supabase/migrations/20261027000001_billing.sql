-- Phase 4: subscription billing (Paddle as merchant of record, behind a
-- provider-neutral model).
--
-- Rules
--   * Only verified provider webhooks change a subscription (never a checkout
--     redirect). Each provider event is applied once; older events never
--     overwrite newer state (provider_updated_at).
--   * A subscription belongs to exactly one organization, fixed by the
--     org_id we put in the checkout's custom data.
--   * Plan changes that would leave usage above the new plan's limits are
--     refused before they reach the provider.
--   * Price ids differ between sandbox and live, so they're data
--     (plans.provider_price_id), set per Supabase project.

alter table public.plans
  add column provider text,
  add column provider_price_id text unique;

alter table public.subscriptions
  add column provider_updated_at timestamptz,
  add column provider_status text check (length(provider_status) <= 40);

create table public.subscription_events (
  id bigint generated always as identity primary key,
  provider text not null,
  provider_event_id text not null unique,
  event_type text not null check (length(event_type) <= 80),
  org_id uuid references public.organizations (id) on delete set null,
  occurred_at timestamptz not null,
  outcome text not null check (outcome in ('applied', 'stale', 'ignored', 'error')),
  detail text check (length(detail) <= 500),
  received_at timestamptz not null default now()
);
create index subscription_events_org_idx on public.subscription_events (org_id, received_at desc);

-- Plan-change guard: what would break on the target plan.
create function app.plan_change_problems(p_org uuid, p_plan text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  target public.plans;
  problems jsonb := '[]'::jsonb;
  v_docs integer;
  v_seats integer;
begin
  select * into target from public.plans where code = p_plan and is_active;
  if not found then
    return jsonb_build_array('That plan is not available.');
  end if;
  select count(*) into v_docs from public.invoices where org_id = p_org and deleted_at is null;
  select (select count(*) from public.organization_members where org_id = p_org)
       + (select count(*) from public.organization_invitations
          where org_id = p_org and accepted_at is null and revoked_at is null and expires_at > now())
    into v_seats;
  if v_docs > (target.limits ->> 'cloud_invoices')::integer and (target.limits ->> 'cloud_invoices')::integer > 0 then
    problems := problems || to_jsonb(format('You have %s cloud documents; %s allows %s. Delete drafts first.',
                                            v_docs, target.name, target.limits ->> 'cloud_invoices'));
  end if;
  if v_seats > (target.limits ->> 'users')::integer then
    problems := problems || to_jsonb(format('You have %s team members and invitations; %s allows %s. Remove some first.',
                                            v_seats, target.name, target.limits ->> 'users'));
  end if;
  return problems;
end $$;
revoke all on function app.plan_change_problems(uuid, text) from public;

-- Shown on the billing page before choosing a plan.
create function public.plan_change_check(p_org uuid, p_plan text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if app.member_role(p_org, auth.uid()) is null then
    raise exception 'Organization not found' using errcode = 'SA404';
  end if;
  return app.plan_change_problems(p_org, p_plan);
end $$;

-- Everything the billing function needs to start a checkout or change a plan.
-- Owners only; refuses plans that would leave the org over its limits.
create function public.billing_prepare(p_user uuid, p_org uuid, p_plan text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  target public.plans;
  sub public.subscriptions;
  problems jsonb;
  v_email text;
begin
  if app.member_role(p_org, p_user) is distinct from 'owner' then
    raise exception 'Only the organization owner can manage billing' using errcode = 'SA403';
  end if;
  select * into target from public.plans where code = p_plan and is_active;
  if not found or target.price_minor = 0 then
    raise exception 'Choose a paid plan' using errcode = 'SA422';
  end if;
  if target.provider_price_id is null then
    raise exception 'This plan is not available for purchase yet' using errcode = 'SA422';
  end if;
  problems := app.plan_change_problems(p_org, p_plan);
  if jsonb_array_length(problems) > 0 then
    raise exception '%', problems ->> 0 using errcode = 'SA409';
  end if;
  select * into sub from public.subscriptions where org_id = p_org;
  select email into v_email from auth.users where id = p_user;
  return jsonb_build_object(
    'priceId', target.provider_price_id,
    'planCode', target.code,
    'email', v_email,
    'customerId', sub.provider_customer_id,
    'subscriptionId', case when sub.provider_subscription_id is not null and sub.status in ('active', 'past_due', 'trialing')
                           and sub.provider is not null then sub.provider_subscription_id end,
    'currentPlan', app.effective_plan(p_org)
  );
end $$;

-- Owner-only access to the provider ids, for cancel / resume / portal / history.
create function public.billing_subscription(p_user uuid, p_org uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  sub public.subscriptions;
begin
  if app.member_role(p_org, p_user) is distinct from 'owner' then
    raise exception 'Only the organization owner can manage billing' using errcode = 'SA403';
  end if;
  select * into sub from public.subscriptions where org_id = p_org;
  return jsonb_build_object(
    'provider', sub.provider,
    'customerId', sub.provider_customer_id,
    'subscriptionId', sub.provider_subscription_id,
    'status', sub.status,
    'cancelAtPeriodEnd', sub.cancel_at_period_end
  );
end $$;

-- Apply one verified provider subscription event. Idempotent and order-safe.
create function public.billing_apply_subscription_event(
  p_provider text,
  p_event_id text,
  p_event_type text,
  p_occurred_at timestamptz,
  p_org uuid,
  p_subscription_id text,
  p_customer_id text,
  p_price_id text,
  p_provider_status text,
  p_period_end timestamptz,
  p_cancel_at_period_end boolean
) returns text
language plpgsql security definer set search_path = '' as $$
declare
  sub public.subscriptions;
  owner_org uuid;
  v_plan text;
  v_status public.subscription_status;
  v_outcome text := 'applied';
  v_detail text;
begin
  if exists (select 1 from public.subscription_events where provider_event_id = p_event_id) then
    return 'duplicate';
  end if;

  -- Which organization? A known subscription id wins over custom data.
  select org_id into owner_org from public.subscriptions where provider_subscription_id = p_subscription_id;
  if owner_org is not null and p_org is not null and owner_org <> p_org then
    v_outcome := 'error';
    v_detail := 'subscription belongs to another organization';
  end if;
  owner_org := coalesce(owner_org, p_org);
  if v_outcome = 'applied' and (owner_org is null or not exists (select 1 from public.organizations where id = owner_org)) then
    v_outcome := 'error';
    v_detail := 'unknown organization';
    owner_org := null;
  end if;

  if v_outcome = 'applied' then
    select code into v_plan from public.plans where provider_price_id = p_price_id;
    if v_plan is null then
      v_outcome := 'error';
      v_detail := 'unknown price ' || coalesce(p_price_id, 'null');
    end if;
  end if;

  if v_outcome = 'applied' then
    select * into sub from public.subscriptions where org_id = owner_org for update;
    if sub.provider_updated_at is not null and sub.provider_updated_at > p_occurred_at then
      v_outcome := 'stale';
    end if;
  end if;

  if v_outcome = 'applied' then
    v_status := case p_provider_status
      when 'active' then 'active'
      when 'trialing' then 'trialing'
      when 'past_due' then 'past_due'
      when 'canceled' then 'canceled'
      when 'paused' then 'expired'
      else 'expired'
    end;
    update public.subscriptions set
      plan_code = v_plan,
      status = v_status,
      provider = p_provider,
      provider_customer_id = coalesce(p_customer_id, provider_customer_id),
      provider_subscription_id = p_subscription_id,
      provider_status = p_provider_status,
      current_period_end = p_period_end,
      cancel_at_period_end = coalesce(p_cancel_at_period_end, false),
      -- A paid subscription replaces the free trial; a provider trial keeps its own end date.
      trial_ends_at = case when v_status = 'trialing' then p_period_end else null end,
      provider_updated_at = p_occurred_at
    where org_id = owner_org;
    perform app.audit(owner_org, null, 'billing.' || p_event_type, 'organization', owner_org,
                      jsonb_build_object('plan', v_plan, 'status', p_provider_status));
  end if;

  insert into public.subscription_events (provider, provider_event_id, event_type, org_id, occurred_at, outcome, detail)
  values (p_provider, p_event_id, left(p_event_type, 80), owner_org, p_occurred_at, v_outcome, v_detail);
  return v_outcome;
end $$;

-- Record events we don't act on (so they're visible and never reprocessed).
create function public.billing_record_event(
  p_provider text, p_event_id text, p_event_type text, p_occurred_at timestamptz, p_org uuid, p_detail text
) returns text
language sql security definer set search_path = '' as $$
  insert into public.subscription_events (provider, provider_event_id, event_type, org_id, occurred_at, outcome, detail)
  select p_provider, p_event_id, left(p_event_type, 80),
         (select id from public.organizations where id = p_org), p_occurred_at, 'ignored', left(p_detail, 500)
  on conflict (provider_event_id) do nothing
  returning outcome
$$;

revoke execute on function
  public.plan_change_check(uuid, text),
  public.billing_prepare(uuid, uuid, text),
  public.billing_subscription(uuid, uuid),
  public.billing_apply_subscription_event(text, text, text, timestamptz, uuid, text, text, text, text, timestamptz, boolean),
  public.billing_record_event(text, text, text, timestamptz, uuid, text)
from public, anon, authenticated;
grant execute on function
  public.billing_prepare(uuid, uuid, text),
  public.billing_subscription(uuid, uuid),
  public.billing_apply_subscription_event(text, text, text, timestamptz, uuid, text, text, text, text, timestamptz, boolean),
  public.billing_record_event(text, text, text, timestamptz, uuid, text)
to service_role;
grant execute on function public.plan_change_check(uuid, text) to authenticated;

alter table public.subscription_events enable row level security;
revoke all on public.subscription_events from anon, authenticated;
grant select (id, provider, event_type, org_id, occurred_at, outcome, received_at) on public.subscription_events to authenticated;
create policy subscription_events_select on public.subscription_events for select to authenticated
  using (app.has_role(org_id, '{owner}'));

-- Provider ids on subscriptions stay server-side.
revoke select on public.subscriptions from authenticated;
grant select (org_id, plan_code, status, trial_ends_at, current_period_end, cancel_at_period_end, updated_at)
  on public.subscriptions to authenticated;

-- Price list: price ids are not secret, but the browser doesn't need them.
revoke select on public.plans from anon, authenticated;
grant select (code, name, price_minor, currency, billing_interval, limits, features, is_active, sort_order)
  on public.plans to anon, authenticated;
