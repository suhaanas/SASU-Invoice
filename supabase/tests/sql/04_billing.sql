-- Phase 4 tests: subscription billing. Runs after 01–03 in the same database.

\set alice '00000000-0000-0000-0000-00000000000a'
\set bob   '00000000-0000-0000-0000-00000000000b'
\set carol '00000000-0000-0000-0000-00000000000c'

select id as org_a from public.organizations where name = 'Org A Ltd' \gset
select id as org_b from public.organizations where name = 'Org B' \gset

update public.plans set provider = 'paddle', provider_price_id = 'pri_pro' where code = 'pro';
update public.plans set provider = 'paddle', provider_price_id = 'pri_business' where code = 'business';

-- What the browser may see -----------------------------------------------------------------

set role anon;
select tests.check((select count(*) from public.plans) = 3, 'anyone can read the price list');
select tests.throws('select provider_price_id from public.plans', '42501', 'provider price ids are not exposed');
reset role;

select tests.login(:'bob');
set role authenticated;
select tests.check((select plan_code from public.subscriptions where org_id = :'org_b') = 'pro',
  'members can read their plan');
select tests.throws('select provider_subscription_id from public.subscriptions', '42501',
  'provider subscription ids are not exposed');
select tests.throws(format('select public.billing_prepare(%L, %L, %L)', :'bob', :'org_b', 'pro'), '42501',
  'billing preparation is server-only');
reset role;

-- Preparing a checkout / plan change ------------------------------------------------------------

set role service_role;
select tests.throws(format('select public.billing_prepare(%L, %L, %L)', :'carol', :'org_a', 'business'), 'SA403',
  'only the owner manages billing');
select tests.throws(format('select public.billing_prepare(%L, %L, %L)', :'bob', :'org_a', 'business'), 'SA403',
  'another organization''s owner cannot manage this billing');
select tests.throws(format('select public.billing_prepare(%L, %L, %L)', :'alice', :'org_a', 'free'), 'SA422',
  'the free plan is not checked out');
select tests.throws(format('select public.billing_prepare(%L, %L, %L)', :'alice', :'org_a', 'pro'), 'SA409',
  'downgrading below current usage (2 members on a 1-user plan) is refused');
select tests.check((public.billing_prepare(:'alice', :'org_a', 'business') ->> 'priceId') = 'pri_business',
  'the owner gets the provider price for a valid plan');
reset role;
update public.plans set provider_price_id = null where code = 'business';
set role service_role;
select tests.throws(format('select public.billing_prepare(%L, %L, %L)', :'alice', :'org_a', 'business'), 'SA422',
  'plans without a configured price cannot be bought');
reset role;
update public.plans set provider_price_id = 'pri_business' where code = 'business';

select tests.login(:'alice');
set role authenticated;
select tests.check(jsonb_array_length(public.plan_change_check(:'org_a', 'pro')) = 1,
  'the billing page can explain why a downgrade is blocked');
reset role;
select tests.login(:'bob');
set role authenticated;
select tests.throws(format('select public.plan_change_check(%L, %L)', :'org_a', 'pro'), 'SA404',
  'plan checks are limited to your organizations');
reset role;

-- Webhook events ---------------------------------------------------------------------------------

set role service_role;
select tests.check(
  public.billing_apply_subscription_event('paddle', 'evt_b1', 'subscription.created', '2026-10-24 10:00Z', :'org_b',
    'sub_b', 'ctm_b', 'pri_pro', 'active', '2026-11-24 10:00Z', false) = 'applied',
  'a verified subscription event is applied');
select tests.check(
  public.billing_apply_subscription_event('paddle', 'evt_b1', 'subscription.created', '2026-10-24 10:00Z', :'org_b',
    'sub_b', 'ctm_b', 'pri_pro', 'active', '2026-11-24 10:00Z', false) = 'duplicate',
  'the same event is applied once');
reset role;
select tests.check(
  (select plan_code = 'pro' and status = 'active' and trial_ends_at is null and provider_subscription_id = 'sub_b'
   from public.subscriptions where org_id = :'org_b'),
  'the organization is on the paid plan and the trial is replaced');

set role service_role;
select tests.check(
  public.billing_apply_subscription_event('paddle', 'evt_b0', 'subscription.updated', '2026-10-24 09:00Z', :'org_b',
    'sub_b', 'ctm_b', 'pri_pro', 'canceled', '2026-10-24 09:00Z', false) = 'stale',
  'an older event never overwrites newer state');
select public.billing_apply_subscription_event('paddle', 'evt_b2', 'subscription.updated', '2026-10-25 10:00Z', :'org_b',
  'sub_b', 'ctm_b', 'pri_business', 'active', '2026-11-24 10:00Z', true);
reset role;
select tests.check(
  (select plan_code = 'business' and cancel_at_period_end from public.subscriptions where org_id = :'org_b'),
  'upgrades and scheduled cancellations are recorded');

set role service_role;
select public.billing_apply_subscription_event('paddle', 'evt_b3', 'subscription.past_due', '2026-10-26 10:00Z', :'org_b',
  'sub_b', 'ctm_b', 'pri_business', 'past_due', '2026-11-24 10:00Z', true);
reset role;
select tests.check(app.effective_plan(:'org_b') = 'business', 'a failed renewal keeps access during the retry period');

set role service_role;
select public.billing_apply_subscription_event('paddle', 'evt_b4', 'subscription.canceled', '2026-10-27 10:00Z', :'org_b',
  'sub_b', 'ctm_b', 'pri_business', 'canceled', now() + interval '3 days', false);
reset role;
select tests.check(app.effective_plan(:'org_b') = 'business', 'a cancelled plan lasts until the paid period ends');
update public.subscriptions set current_period_end = now() - interval '1 minute' where org_id = :'org_b';
select tests.check(app.effective_plan(:'org_b') = 'free', 'after the paid period the organization is on Free');

-- Hostile or broken events
set role service_role;
select tests.check(
  public.billing_apply_subscription_event('paddle', 'evt_x1', 'subscription.updated', '2026-10-28 10:00Z', :'org_a',
    'sub_b', 'ctm_b', 'pri_business', 'active', '2026-12-01 10:00Z', false) = 'error',
  'a subscription cannot be moved to another organization via custom data');
select tests.check(
  public.billing_apply_subscription_event('paddle', 'evt_x2', 'subscription.created', '2026-10-28 10:00Z', :'org_a',
    'sub_new', 'ctm_a', 'pri_unknown', 'active', '2026-12-01 10:00Z', false) = 'error',
  'unknown prices are recorded as errors, not applied');
select tests.check(
  public.billing_apply_subscription_event('paddle', 'evt_x3', 'subscription.created', '2026-10-28 10:00Z',
    gen_random_uuid(), 'sub_new2', 'ctm_x', 'pri_pro', 'active', '2026-12-01 10:00Z', false) = 'error',
  'events for unknown organizations are rejected');
select public.billing_record_event('paddle', 'evt_t1', 'transaction.completed', now(), :'org_b', 'sub_b');
reset role;
select tests.check((select status = 'active' and plan_code = 'business' from public.subscriptions where org_id = :'org_a'),
  'org A''s subscription is unaffected by rejected events');

-- Event log visibility --------------------------------------------------------------------------------

select tests.login(:'bob');
set role authenticated;
select tests.check((select count(*) from public.subscription_events where org_id = :'org_b') >= 5,
  'owners can see their billing events');
select tests.check((select count(*) from public.subscription_events where org_id = :'org_a') = 0,
  'owners cannot see other organizations'' billing events');
select tests.throws(format('select public.billing_apply_subscription_event(%L, %L, %L, now(), %L, %L, %L, %L, %L, now(), false)',
  'paddle', 'evt_forge', 'subscription.updated', :'org_b', 'sub_b', 'ctm_b', 'pri_business', 'active'),
  '42501', 'users cannot forge billing events');
reset role;

select tests.login(:'carol');
set role authenticated;
select tests.check((select count(*) from public.subscription_events) = 0, 'members (non-owners) cannot see billing events');
reset role;
