-- Security audit of the schema itself (runs last). These checks read the
-- catalog, so a future migration that forgets RLS, a revoke or a search_path
-- fails CI instead of shipping.

-- Every table in public has row-level security.
select tests.check(
  not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  'RLS is enabled on every public table: missing on ' || coalesce((
    select string_agg(c.relname, ', ') from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity), 'none'));

-- Anonymous visitors can call exactly these functions.
create temp table allowed_anon (name text);
insert into allowed_anon values ('get_shared_invoice'), ('opt_out_reminders');
select tests.check(
  not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
                and p.proname not in (select name from allowed_anon)),
  'anon can only call the allow-listed functions; also callable: ' || coalesce((
    select string_agg(p.proname, ', ') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
      and p.proname not in (select name from allowed_anon)), 'none'));

-- Signed-in users can call exactly these functions (never rf_*, save_invoice, billing_*…).
create temp table allowed_auth (name text);
insert into allowed_auth values
  ('create_organization'), ('create_invitation'), ('accept_invitation'), ('revoke_invitation'), ('remove_member'),
  ('update_member_role'), ('update_member_permissions'), ('delete_draft_invoice'), ('record_payment'), ('void_payment'),
  ('create_invoice_share'), ('revoke_invoice_share'), ('get_shared_invoice'), ('opt_out_reminders'),
  ('dashboard_summary'), ('org_currencies'), ('client_balances'), ('report_summary'),
  ('invoice_reminder_status'), ('set_reminders_enabled'), ('set_invoice_reminders_paused'), ('set_invoice_dispute'),
  ('remove_email_suppression'), ('plan_change_check'),
  ('create_recurring_rule'), ('update_recurring_rule'), ('set_recurring_status'),
  ('is_platform_admin'), ('admin_overview'), ('admin_organizations'), ('admin_set_flag');
select tests.check(
  not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute')
                and p.proname not in (select name from allowed_auth)),
  'signed-in users can only call the allow-listed functions; also callable: ' || coalesce((
    select string_agg(p.proname, ', ') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute')
      and p.proname not in (select name from allowed_auth)), 'none'));

-- Every function in our schemas pins its search_path (no schema hijacking);
-- this mirrors Supabase's function_search_path_mutable advisor.
select tests.check(
  not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname in ('public', 'app')
                and not coalesce(array_to_string(p.proconfig, ',') like '%search_path=%', false)),
  'every function sets search_path; missing on ' || coalesce((
    select string_agg(n.nspname || '.' || p.proname, ', ') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'app')
      and not coalesce(array_to_string(p.proconfig, ',') like '%search_path=%', false)), 'none'));

-- RLS policies call auth.uid() through a sub-select (evaluated once per query).
select tests.check(
  not exists (select 1 from pg_policies where schemaname = 'public'
              and (coalesce(qual, '') ~* '(?<!select )auth\.uid\(\)' or coalesce(with_check, '') ~* '(?<!select )auth\.uid\(\)')),
  'policies wrap auth.uid() in a sub-select; not on ' || coalesce((
    select string_agg(tablename || '.' || policyname, ', ') from pg_policies where schemaname = 'public'
      and (coalesce(qual, '') ~* '(?<!select )auth\.uid\(\)' or coalesce(with_check, '') ~* '(?<!select )auth\.uid\(\)')), 'none'));

-- Anonymous visitors can read only the price list.
select tests.check(
  not exists (select 1 from information_schema.role_table_grants
              where grantee = 'anon' and table_schema = 'public')
  and not exists (select 1 from information_schema.column_privileges
                  where grantee = 'anon' and table_schema = 'public' and (table_name <> 'plans' or privilege_type <> 'SELECT')),
  'anon has no table privileges beyond reading plans');

-- Browsers can never write financial or system records directly.
select tests.check(
  not exists (
    select 1 from information_schema.role_table_grants
    where grantee = 'authenticated' and table_schema = 'public' and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
      and table_name in ('invoices', 'invoice_payments', 'invoice_shares', 'subscriptions', 'subscription_events',
                         'email_messages', 'email_events', 'reminder_jobs', 'usage_counters', 'audit_logs',
                         'organization_members', 'organization_invitations', 'recurring_runs', 'recurring_rules',
                         'platform_admins', 'feature_flags', 'rate_limits', 'scheduler_heartbeats', 'ai_usage_logs', 'plans'))
  and not exists (
    select 1 from information_schema.column_privileges
    where grantee = 'authenticated' and table_schema = 'public' and privilege_type in ('INSERT', 'UPDATE')
      and table_name in ('invoices', 'invoice_payments', 'invoice_shares', 'subscriptions', 'subscription_events',
                         'email_messages', 'email_events', 'reminder_jobs', 'usage_counters', 'audit_logs',
                         'organization_members', 'organization_invitations', 'recurring_runs', 'recurring_rules',
                         'platform_admins', 'feature_flags', 'rate_limits', 'scheduler_heartbeats', 'ai_usage_logs', 'plans')),
  'signed-in users have no write privileges on financial or system tables');

-- Rate limiter and heartbeat behave.
set role service_role;
select tests.check(public.rf_rate_limit('t:1', 2, 60) and public.rf_rate_limit('t:1', 2, 60)
                   and not public.rf_rate_limit('t:1', 2, 60), 'the rate limiter allows N hits per window');
select public.rf_heartbeat('scheduler', '{"ok": true}');
reset role;
select tests.login('00000000-0000-0000-0000-00000000000a');
set role authenticated;
select tests.check((public.admin_overview() -> 'scheduler' -> 'scheduler' ->> 'stale')::boolean = false,
  'admins see when the scheduler last ran');
select tests.throws('select public.rf_rate_limit(''x'', 1, 60)', '42501', 'users cannot touch the rate limiter');
reset role;
