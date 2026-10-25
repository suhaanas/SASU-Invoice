-- Phase 5 tests: member permissions, server numbering, recurring invoices,
-- reports and the platform admin console. Runs after 01–04.

\set alice '00000000-0000-0000-0000-00000000000a'
\set bob   '00000000-0000-0000-0000-00000000000b'
\set carol '00000000-0000-0000-0000-00000000000c'
\set docn  '77777777-7777-7777-7777-777777777777'

select id as org_a from public.organizations where name = 'Org A Ltd' \gset
select id as org_b from public.organizations where name = 'Org B' \gset
select id as inv_r from public.invoices where number = 'INV-200' \gset
select id as inv_o from public.invoices where number = 'INV-101' \gset

-- Member permissions ------------------------------------------------------------------------------

-- Earlier tests used up the monthly allowances; start this month afresh.
delete from public.usage_counters;

select tests.login(:'carol');
set role authenticated;
select tests.throws(format('select public.update_member_permissions(%L, %L, %L)', :'org_a', :'carol', '{}'), 'SA403',
  'members cannot change permissions');
reset role;

select tests.login(:'alice');
set role authenticated;
select tests.throws(format('select public.update_member_permissions(%L, %L, %L)', :'org_a', :'alice', '{}'), 'SA422',
  'owners and admins have no permission switches');
select public.update_member_permissions(:'org_a', :'carol',
  '{"record_payments": false, "send_emails": false, "manage_clients": false, "view_reports": false, "superuser": true}');
reset role;
select tests.check(
  (select permissions = '{"record_payments": false, "send_emails": false, "manage_clients": false, "view_reports": false}'::jsonb
   from public.organization_members where org_id = :'org_a' and user_id = :'carol'),
  'only known permission switches are stored');

select tests.login(:'carol');
set role authenticated;
select tests.throws(format('select public.record_payment(%L, 100, current_date, %L)', :'inv_o', 'cash'), 'SA403',
  'a member without the payments switch cannot record payments');
select tests.throws(format('insert into public.clients (org_id, name) values (%L, %L)', :'org_a', 'New Co'), '42501',
  'a member without the clients switch cannot add clients');
select tests.throws(format('select public.report_summary(%L, %L, %L, %L)', :'org_a', 'GBP', '2026-01-01', '2026-12-31'),
  'SA403', 'a member without the reports switch cannot run reports');
reset role;
set role service_role;
select tests.throws(format('select public.rf_prepare_manual_email(%L, %L, %L, %L, %L)', :'carol', :'inv_r', 'new_invoice',
  'ap@acme.test', 'manual:' || gen_random_uuid()), 'SA403', 'a member without the email switch cannot send emails');
reset role;

select tests.login(:'alice');
set role authenticated;
select public.update_member_permissions(:'org_a', :'carol', '{"record_payments": true, "manage_clients": true}');
reset role;
select tests.login(:'carol');
set role authenticated;
insert into public.clients (org_id, name) values (:'org_a', 'Permitted Co');
reset role;
select tests.check(exists (select 1 from public.clients where name = 'Permitted Co'), 'switching a permission back on works');

-- Server-side numbering -----------------------------------------------------------------------------

select tests.check(app.next_document_number(:'org_a', 'invoice') = 'INV-201',
  'the next number follows the highest in the series');
select tests.check(app.recurring_date('2026-01-31', 'month', 1, 1) = '2026-02-28'
                   and app.recurring_date('2026-01-31', 'month', 1, 2) = '2026-03-31'
                   and app.recurring_date('2024-02-29', 'year', 1, 1) = '2025-02-28'
                   and app.recurring_date('2026-01-01', 'week', 2, 3) = '2026-02-12',
  'recurring dates count from the start, so month-ends never drift');

-- Recurring invoices -----------------------------------------------------------------------------------

select app.org_today(:'org_a') as today \gset

select tests.login(:'bob');
set role authenticated;
select tests.throws(format('select public.create_recurring_rule(%L, %L, 1, %L)', :'inv_r', 'month', :'today'), 'SA404',
  'another organization cannot make our invoices recur');
reset role;

select tests.login(:'alice');
set role authenticated;
select tests.throws(format('select public.create_recurring_rule(%L, %L, 1, %L)', :'inv_r', 'month', '2020-01-01'), 'SA422',
  'schedules cannot start in the past');
select public.create_recurring_rule(:'inv_r', 'month', 1, :'today', null, 'issue', true, 'Monthly retainer') as rule \gset
reset role;

set role service_role;
select public.rf_claim_recurring(10) as claimed \gset
select tests.check(jsonb_array_length(:'claimed'::jsonb) = 1 and (:'claimed'::jsonb -> 0 ->> 'ruleId') = :'rule',
  'a due schedule is handed to the scheduler with its template');
select tests.check(jsonb_array_length(public.rf_claim_recurring(10)) = 0, 'a claimed schedule is not handed out twice');
select public.rf_complete_recurring(:'rule', :'today', tests.doc(:'docn', 'PENDING', true), tests.totals()) as done \gset
select tests.check((:'done'::jsonb ->> 'sendEmail')::boolean and (:'done'::jsonb ->> 'to') = 'jane@acme.test',
  'the run says whether to email the client');
select tests.check(
  (public.rf_complete_recurring(:'rule', :'today', tests.doc(gen_random_uuid(), 'PENDING', true), tests.totals()) ->> 'duplicate')::boolean,
  'the same run date never creates a second invoice');
reset role;
select tests.check(
  (select number = 'INV-201' and source = 'recurring' and issued_at is not null from public.invoices where local_id = :'docn'),
  'the generated invoice gets the next number and is issued');
select tests.check(
  (select occurrence = 1 and runs_count = 1 and next_run_date = (:'today'::date + interval '1 month')::date
   from public.recurring_rules where id = :'rule'),
  'the schedule advances by one period');

-- A failing run (plan limit) retries later instead of looping.
update public.recurring_rules set next_run_date = :'today'::date + 1 where id = :'rule';
update public.plans set limits = jsonb_set(limits, '{cloud_invoices}', '1') where code = 'business';
set role service_role;
select tests.check(public.rf_complete_recurring(:'rule', (:'today'::date + 1), tests.doc(gen_random_uuid(), 'PENDING', true), tests.totals()) ? 'error',
  'a run that cannot be saved reports an error');
reset role;
select tests.check(
  (select last_error is not null and retry_after > now() from public.recurring_rules where id = :'rule'),
  'the error is shown and the schedule backs off');
update public.plans set limits = jsonb_set(limits, '{cloud_invoices}', '500') where code = 'business';

select tests.login(:'alice');
set role authenticated;
select tests.throws(format('select public.update_recurring_rule(%L, %L, 1, %L, %L, false, %L)', :'rule', 'month', '2020-01-01', 'draft', ''),
  'SA422', 'the end date cannot be before the next invoice');
select public.set_recurring_status(:'rule', 'paused');
reset role;
update public.recurring_rules set next_run_date = '2026-01-01', start_date = '2026-01-01', occurrence = 0 where id = :'rule';
select tests.login(:'alice');
set role authenticated;
select public.set_recurring_status(:'rule', 'active');
select tests.check((select next_run_date >= :'today'::date from public.recurring_rules where id = :'rule'),
  'resuming skips missed periods instead of back-filling them');
select public.set_recurring_status(:'rule', 'cancelled');
select tests.throws(format('select public.set_recurring_status(%L, %L)', :'rule', 'active'), 'SA409',
  'a cancelled schedule cannot be restarted');
reset role;

select tests.login(:'bob');
set role authenticated;
select tests.check((select count(*) from public.recurring_rules) = 0, 'other organizations cannot see schedules');
select tests.throws(format('select public.set_recurring_status(%L, %L)', :'rule', 'paused'), 'SA404',
  'other organizations cannot change schedules');
reset role;

set role authenticated;
select tests.throws('select public.rf_claim_recurring(1)', '42501', 'users cannot run the recurring scheduler');
reset role;

-- Reports ---------------------------------------------------------------------------------------------------

select tests.login(:'alice');
set role authenticated;
select public.report_summary(:'org_a', 'GBP', '2026-01-01', '2026-12-31') as report \gset
select tests.check((:'report'::jsonb ->> 'invoicedMinor')::bigint > 0 and (:'report'::jsonb ->> 'receivedMinor')::bigint > 0,
  'the report separates invoiced amounts from money received');
select tests.check(jsonb_array_length(:'report'::jsonb -> 'monthly') = 12, 'the report has one row per month in range');
select tests.check((:'report'::jsonb -> 'recurring' ->> 'generated')::int = 1, 'the report counts recurring runs');
select tests.throws(format('select public.report_summary(%L, %L, %L, %L)', :'org_a', 'GBP', '2026-12-31', '2026-01-01'),
  'SA422', 'reversed ranges are rejected');
reset role;
select tests.login(:'bob');
set role authenticated;
select tests.throws(format('select public.report_summary(%L, %L, %L, %L)', :'org_a', 'GBP', '2026-01-01', '2026-12-31'),
  'SA403', 'another organization cannot run our reports');
reset role;

-- Platform admin ------------------------------------------------------------------------------------------------

insert into public.platform_admins (user_id) values (:'alice');

select tests.login(:'bob');
set role authenticated;
select tests.check(not public.is_platform_admin(), 'ordinary users are not platform admins');
select tests.throws('select public.admin_overview()', 'SA404', 'the admin console is invisible to non-admins');
select tests.throws('select public.admin_organizations()', 'SA404', 'the organization directory is admin-only');
select tests.throws('select * from public.platform_admins', '42501', 'the admin list is not readable');
reset role;

set role anon;
select tests.throws('select public.admin_overview()', '42501', 'anon cannot reach the admin console');
reset role;

select tests.login(:'alice');
set role authenticated;
select tests.check(public.is_platform_admin(), 'platform admins are recognised');
select tests.check((public.admin_overview() ->> 'organizations')::int >= 2, 'admins see platform totals');
select public.admin_organizations('Org B') as dir \gset
select tests.check(jsonb_array_length(:'dir'::jsonb) = 1, 'admins can search organizations');
select tests.check(not (:'dir'::jsonb -> 0 ? 'invoiced') and not (:'dir'::jsonb -> 0 ? 'clients'),
  'the directory has metadata and counts, not financial data');
select tests.check((select count(*) from public.invoices where org_id = :'org_b') = 0,
  'being a platform admin does not grant access to customer invoices');
select tests.throws(format('select public.admin_set_flag(%L, true)', 'nope'), 'SA404', 'unknown flags are rejected');
select public.admin_set_flag('automatic_reminders', false);
reset role;
set role service_role;
select tests.check(not (public.rf_scheduler_flags() ->> 'reminders')::boolean, 'flags reach the scheduler');
reset role;
select tests.check(exists (select 1 from public.audit_logs where action = 'admin.overview_viewed' and actor_id = :'alice'),
  'admin access is audited');
select tests.check(exists (select 1 from public.audit_logs where action = 'admin.flag_changed'), 'flag changes are audited');
