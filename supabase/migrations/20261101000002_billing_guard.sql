-- Payment hardening: a subscription event may only attach to an organization
-- that has no other active subscription and no different Paddle customer.
-- (The webhook also ignores organization ids that lack our signed tag.)
create or replace function public.billing_apply_subscription_event(
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

  -- A different live subscription, or a different Paddle customer, can never
  -- take over an organization (e.g. a checkout opened with someone else's id).
  if v_outcome = 'applied' then
    select * into sub from public.subscriptions where org_id = owner_org;
    if sub.provider_subscription_id is not null
       and sub.provider_subscription_id <> p_subscription_id
       and sub.status in ('active', 'past_due') then
      v_outcome := 'error';
      v_detail := 'organization already has another active subscription';
    elsif sub.provider_customer_id is not null and p_customer_id is not null
       and sub.provider_customer_id <> p_customer_id then
      v_outcome := 'error';
      v_detail := 'customer does not match the organization';
    end if;
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
