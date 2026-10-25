-- Phase 6: production hardening.
--   * Rate limits for Edge Functions (fixed windows, per user and action).
--   * Scheduler heartbeat, so a stopped pg_cron job is visible.

create table public.rate_limits (
  key text not null check (length(key) <= 200),
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (key, window_start)
);
alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from anon, authenticated;

-- True when this hit is within the limit. One row per key and window; old
-- windows are cleared opportunistically.
create function public.rf_rate_limit(p_key text, p_limit integer, p_window_seconds integer) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits integer;
begin
  insert into public.rate_limits as r (key, window_start, hits) values (left(p_key, 200), v_window, 1)
  on conflict (key, window_start) do update set hits = r.hits + 1
  returning hits into v_hits;
  if random() < 0.01 then
    delete from public.rate_limits where window_start < now() - interval '1 day';
  end if;
  return v_hits <= p_limit;
end $$;

create table public.scheduler_heartbeats (
  name text primary key check (length(name) <= 60),
  last_run_at timestamptz not null,
  last_summary jsonb not null default '{}'::jsonb
);
alter table public.scheduler_heartbeats enable row level security;
revoke all on public.scheduler_heartbeats from anon, authenticated;

create function public.rf_heartbeat(p_name text, p_summary jsonb) returns void
language sql security definer set search_path = '' as $$
  insert into public.scheduler_heartbeats (name, last_run_at, last_summary)
  values (left(p_name, 60), now(), coalesce(p_summary, '{}'::jsonb))
  on conflict (name) do update set last_run_at = excluded.last_run_at, last_summary = excluded.last_summary
$$;

create function public.rf_scheduler_status() returns timestamptz
language sql stable security definer set search_path = '' as $$
  select last_run_at from public.scheduler_heartbeats where name = 'scheduler'
$$;

revoke execute on function public.rf_rate_limit(text, integer, integer), public.rf_heartbeat(text, jsonb),
  public.rf_scheduler_status()
from public, anon, authenticated;
grant execute on function public.rf_rate_limit(text, integer, integer), public.rf_heartbeat(text, jsonb),
  public.rf_scheduler_status()
to service_role;

-- Admin overview, now with scheduler freshness.
create or replace function public.admin_overview() returns jsonb
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
    'scheduler', (select coalesce(jsonb_object_agg(name, jsonb_build_object(
        'lastRunAt', last_run_at, 'stale', last_run_at < now() - interval '15 minutes', 'summary', last_summary)), '{}'::jsonb)
      from public.scheduler_heartbeats),
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
