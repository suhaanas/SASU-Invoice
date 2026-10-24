-- Phase 3 tests: RecoverFlow reminders, email pipeline, suppression, usage, AI gating.
-- Runs after 01 and 02 in the same database.

\set alice '00000000-0000-0000-0000-00000000000a'
\set bob   '00000000-0000-0000-0000-00000000000b'
\set carol '00000000-0000-0000-0000-00000000000c'
\set docr  '66666666-6666-6666-6666-666666666666'

select id as org_a from public.organizations where name = 'Org A Ltd' \gset
select id as org_b from public.organizations where name = 'Org B' \gset
select id as inv_p from public.invoices where number = 'INV-100' \gset
select id as inv_o from public.invoices where number = 'INV-101' \gset

-- An issued £100 invoice for Acme (jane@acme.test), due Wednesday 2026-11-04.
set role service_role;
select public.save_invoice(:'alice', :'org_a',
  jsonb_set(tests.doc(:'docr', 'INV-200', true), '{meta,dueDate}', '"2026-11-04"'), tests.totals());
reset role;
select id as inv_r from public.invoices where local_id = :'docr' \gset

-- Turning reminders on -------------------------------------------------------------------------

select tests.login(:'carol');
set role authenticated;
select tests.throws(format('select public.set_reminders_enabled(%L, true)', :'org_a'), 'SA403',
  'members cannot turn reminders on');
reset role;

select tests.login(:'alice');
set role authenticated;
select public.set_reminders_enabled(:'org_a', true);
select tests.check((select count(*) from public.reminder_rules where org_id = :'org_a') = 5,
  'enabling reminders creates the default 5-step schedule');
select tests.check((public.invoice_reminder_status(:'inv_r') ->> 'blockReason') is null,
  'an unpaid issued invoice with a client email is eligible');
reset role;

select tests.login(:'bob');
set role authenticated;
select tests.throws(format('select public.invoice_reminder_status(%L)', :'inv_r'), 'SA404',
  'another organization cannot inspect reminder status');
select tests.check((select count(*) from public.reminder_rules where org_id = :'org_a') = 0,
  'another organization cannot read reminder rules');
select tests.throws(format('insert into public.reminder_rules (org_id, offset_days, kind, tone) values (%L, 30, %L, %L)',
  :'org_a', 'follow_up', 'firm'), '42501', 'another organization cannot add reminder rules');
reset role;

-- Enqueue: windows, send hour, weekends, idempotency ----------------------------------------------------

set role service_role;
select public.rf_enqueue_due_reminders('2026-11-04 08:00 Europe/London');
reset role;
select tests.check((select count(*) from public.reminder_jobs where invoice_id = :'inv_r') = 0,
  'nothing is queued before the organization''s send hour');

set role service_role;
select public.rf_enqueue_due_reminders('2026-11-07 10:00 Europe/London');
reset role;
select tests.check((select count(*) from public.reminder_jobs where invoice_id = :'inv_r') = 0,
  'nothing is queued at weekends when weekdays-only is on');

set role service_role;
select public.rf_enqueue_due_reminders('2026-11-04 10:00 Europe/London');
select public.rf_enqueue_due_reminders('2026-11-04 10:30 Europe/London');
reset role;
select tests.check(
  (select count(*) = 1 from public.reminder_jobs where invoice_id = :'inv_r' and status = 'scheduled' and offset_days = 0),
  'the due-today reminder is queued once, even when the scheduler runs twice');
select tests.check(
  (select status = 'skipped' from public.reminder_jobs where invoice_id = :'inv_r' and offset_days = -3),
  'a missed earlier reminder is skipped, not sent on the same day');

-- Claiming, retry with backoff, crash recovery ----------------------------------------------------------------

-- The scheduler ran with a simulated clock; make those jobs due on the real one.
update public.reminder_jobs set next_attempt_at = now() where status = 'scheduled';

set role service_role;
select count(*) > 0 as claimed from public.rf_claim_jobs(50) \gset
reset role;
select tests.check(:'claimed'::boolean, 'the worker can claim due jobs');
select id as job_r from public.reminder_jobs where invoice_id = :'inv_r' and offset_days = 0 \gset
select tests.check((select status = 'processing' and attempts = 1 and locked_until > now()
                    from public.reminder_jobs where id = :'job_r'), 'a claimed job is leased');

set role service_role;
select tests.check(not exists (select 1 from public.rf_claim_jobs(50) where id = :'job_r'),
  'a leased job cannot be claimed twice');
select public.rf_prepare_reminder(:'job_r') as prep \gset
reset role;
select tests.check((:'prep'::jsonb ->> 'skip')::boolean = false and (:'prep'::jsonb ->> 'to') = 'jane@acme.test'
                   and (:'prep'::jsonb ->> 'kind') = 'due_today' and length(:'prep'::jsonb ->> 'shareToken') = 64,
  'preparing a reminder returns the recipient, template kind and a fresh client link');
select tests.check(not (:'prep'::jsonb ? 'clientAddress') and not (:'prep'::jsonb ? 'taxId'),
  'reminder context does not include addresses or tax numbers');
select (:'prep'::jsonb ->> 'messageId') as msg_r \gset

set role service_role;
select tests.check(public.rf_mark_failed(:'msg_r', 'provider timeout', false) = 'scheduled',
  'a transient failure schedules a retry');
reset role;
select tests.check((select status = 'scheduled' and next_attempt_at > now() + interval '1 minute'
                    from public.reminder_jobs where id = :'job_r'), 'retries back off');
set role service_role;
select tests.check(not exists (select 1 from public.rf_claim_jobs(50) where id = :'job_r'),
  'a job is not retried before its backoff ends');
reset role;

update public.reminder_jobs set next_attempt_at = now() where id = :'job_r';
set role service_role;
select tests.check(exists (select 1 from public.rf_claim_jobs(50) where id = :'job_r'), 'the job is retried after backoff');
select tests.check((public.rf_prepare_reminder(:'job_r') ->> 'messageId') = :'msg_r',
  'a retry reuses the same message and idempotency key');
select public.rf_mark_accepted(:'msg_r', 'resend', 're_test_1', 'Invoice INV-200 is due today', 'Hello Jane');
reset role;
select tests.check((select status = 'sent' from public.reminder_jobs where id = :'job_r'), 'an accepted reminder completes its job');
select tests.check((select status = 'accepted' from public.email_messages where id = :'msg_r'),
  'accepted is not reported as delivered');
select tests.check((select used = 1 from public.usage_counters where org_id = :'org_a' and metric = 'email_sends'),
  'sent emails count toward the monthly allowance');

-- Crash after the provider accepted: re-processing must not send again.
update public.reminder_jobs set status = 'processing' where id = :'job_r';
set role service_role;
select tests.check((public.rf_prepare_reminder(:'job_r') ->> 'reason') = 'already_sent',
  're-processing an already-sent job does not send it again');
reset role;

-- Expired leases are reclaimed.
select id as job_other from public.reminder_jobs where status = 'processing' and id <> :'job_r' limit 1 \gset
update public.reminder_jobs set locked_until = now() - interval '1 second' where id = :'job_other';
set role service_role;
select tests.check(exists (select 1 from public.rf_claim_jobs(50) where id = :'job_other'),
  'a job whose worker died is claimed again after its lease');
reset role;
update public.reminder_jobs set status = 'scheduled', locked_until = null where status = 'processing';

-- Reminders stop: paid, paused, disputed, opted out ------------------------------------------------------------

select tests.check(exists (select 1 from public.reminder_jobs where invoice_id = :'inv_p' and status = 'scheduled'),
  'the partially paid invoice also has a reminder waiting');
select tests.login(:'alice');
set role authenticated;
select public.record_payment(:'inv_p', 6000, current_date, 'bank_transfer');
reset role;
select tests.check(
  not exists (select 1 from public.reminder_jobs where invoice_id = :'inv_p' and status = 'scheduled')
  and exists (select 1 from public.reminder_jobs where invoice_id = :'inv_p' and cancel_reason = 'paid'),
  'paying in full cancels waiting reminders');

select tests.login(:'carol');
set role authenticated;
select public.set_invoice_reminders_paused(:'inv_o', true);
reset role;
select tests.check(
  not exists (select 1 from public.reminder_jobs where invoice_id = :'inv_o' and status = 'scheduled'),
  'pausing an invoice cancels its waiting reminders');
select tests.login(:'alice');
set role authenticated;
select tests.check((public.invoice_reminder_status(:'inv_o') ->> 'blockReason') = 'paused', 'a paused invoice is blocked');
select public.set_invoice_reminders_paused(:'inv_o', false);
select public.set_invoice_dispute(:'inv_o', true, 'Client says the hours are wrong');
select tests.check((public.invoice_reminder_status(:'inv_o') ->> 'blockReason') = 'disputed', 'a disputed invoice is blocked');
select public.set_invoice_dispute(:'inv_o', false);
select tests.check((public.invoice_reminder_status(:'inv_o') ->> 'blockReason') is null, 'resolving the dispute unblocks it');
select public.create_invoice_share(:'inv_o', 30) as optout_token \gset
reset role;

set role service_role;
select public.rf_enqueue_due_reminders('2026-11-05 10:00 Europe/London');
reset role;
-- A job prepared after the client opts out is cancelled at send time.
set role anon;
select tests.check(public.opt_out_reminders(:'optout_token'), 'a client can opt out from their invoice link');
select tests.check(not public.opt_out_reminders(repeat('0', 64)), 'unknown links cannot opt anyone out');
reset role;
select tests.check(
  not exists (select 1 from public.reminder_jobs j join public.invoices i on i.id = j.invoice_id
              join public.clients c on c.id = i.client_id
              where c.reminders_opted_out_at is not null and j.status = 'scheduled'),
  'opting out cancels the client''s waiting reminders');
select tests.login(:'alice');
set role authenticated;
select tests.check((public.invoice_reminder_status(:'inv_r') ->> 'blockReason') = 'opted_out',
  'opted-out clients get no further reminders');
reset role;

-- Delivery events: idempotent, forward-only, bounces suppress ------------------------------------------------------

set role service_role;
select tests.check(public.rf_apply_email_event('evt_1', 're_test_1', 'email.delivered', now()), 'a delivery event is applied');
select tests.check(not public.rf_apply_email_event('evt_1', 're_test_1', 'email.delivered', now()),
  'the same webhook event is applied once');
select public.rf_apply_email_event('evt_2', 're_test_1', 'email.sent', now() - interval '1 minute');
reset role;
select tests.check((select status = 'delivered' and delivered_at is not null from public.email_messages where id = :'msg_r'),
  'an out-of-order "sent" event does not move a delivered message backwards');
set role service_role;
select public.rf_apply_email_event('evt_3', 're_test_1', 'email.bounced', now(), 'Mailbox does not exist');
select tests.check(not public.rf_apply_email_event('evt_4', 'unknown-id', 'email.delivered', now()),
  'events for unknown messages are ignored');
reset role;
select tests.check((select status = 'bounced' from public.email_messages where id = :'msg_r'), 'a bounce is recorded');
select tests.check(exists (select 1 from public.email_suppressions where org_id = :'org_a' and email = 'jane@acme.test'),
  'a bounced address is suppressed');

-- Manual sends --------------------------------------------------------------------------------------------------

set role service_role;
select tests.throws(format('select public.rf_prepare_manual_email(%L, %L, %L, %L, %L)', :'alice', :'inv_r', 'new_invoice',
  'jane@acme.test', 'manual:' || gen_random_uuid()), 'SA422', 'suppressed addresses cannot be emailed');
select tests.throws(format('select public.rf_prepare_manual_email(%L, %L, %L, %L, %L)', :'bob', :'inv_r', 'new_invoice',
  'x@y.test', 'manual:' || gen_random_uuid()), 'SA404', 'another organization cannot email this invoice');
select tests.throws(format('select public.rf_prepare_manual_email(%L, %L, %L, %L, %L)', :'alice', :'inv_r', 'new_invoice',
  'x@y.test', 'reminder:' || gen_random_uuid()), 'SA422', 'manual sends cannot reuse reminder idempotency keys');
select tests.throws(format('select public.rf_prepare_manual_email(%L, %L, %L, %L, %L)', :'alice', :'inv_r', 'new_invoice',
  'not-an-email', 'manual:' || gen_random_uuid()), 'SA422', 'recipients must be valid addresses');
select public.rf_prepare_manual_email(:'alice', :'inv_r', 'new_invoice', 'ap@acme.test',
  'manual:11111111-2222-3333-4444-555555555555') as manual \gset
select tests.check((:'manual'::jsonb ->> 'duplicate')::boolean = false, 'a manual send is prepared');
select tests.check(
  (public.rf_prepare_manual_email(:'alice', :'inv_r', 'new_invoice', 'ap@acme.test',
     'manual:11111111-2222-3333-4444-555555555555') ->> 'duplicate')::boolean,
  'a double-clicked send is recognised as the same request');
reset role;

select tests.login(:'alice');
set role authenticated;
select public.remove_email_suppression(:'org_a', 'Jane@Acme.test');
reset role;
select tests.check(not exists (select 1 from public.email_suppressions where email = 'jane@acme.test'),
  'owners can lift a suppression after fixing the address');

-- Usage limits ------------------------------------------------------------------------------------------------------

update public.usage_counters set used = 600 where org_id = :'org_a' and metric = 'email_sends';
set role service_role;
select tests.throws(format('select public.rf_prepare_manual_email(%L, %L, %L, %L, %L)', :'alice', :'inv_r', 'new_invoice',
  'ap@acme.test', 'manual:' || gen_random_uuid()), 'SA402', 'the monthly email allowance is enforced');
select tests.check(public.rf_begin_ai(:'alice', :'org_a'), 'AI requests are allowed within the allowance');
select tests.throws(format('select public.rf_begin_ai(%L, %L)', :'bob', :'org_a'), 'SA403',
  'AI requests are tied to membership');
reset role;
update public.usage_counters set used = 600 where org_id = :'org_a' and metric = 'ai_requests';
set role service_role;
select tests.check(not public.rf_begin_ai(:'alice', :'org_a'), 'the monthly AI allowance is enforced');
select tests.check(
  (select array_agg(k order by k) from jsonb_object_keys(public.rf_ai_invoice_context(:'alice', :'inv_r')) k)
    = array['daysFromDue', 'orgId', 'paid', 'partiallyPaid', 'remindersSent'],
  'the AI context contains no names, emails or amounts');
select public.rf_log_ai(:'alice', :'org_a', 'draft_reminder', 'test-model', 120, 80, 'ok');
reset role;

-- Visibility --------------------------------------------------------------------------------------------------------

select tests.login(:'carol');
set role authenticated;
select tests.check((select count(*) from public.email_messages where org_id = :'org_a') > 0,
  'members see their organization''s email activity');
select tests.check((select count(*) from public.ai_usage_logs) = 0, 'members cannot read AI usage logs');
select tests.throws(format('insert into public.email_templates (org_id, kind, subject, body) values (%L, %L, %L, %L)',
  :'org_a', 'overdue', 's', 'b'), '42501', 'members cannot edit email templates');
reset role;

select tests.login(:'bob');
set role authenticated;
select tests.check((select count(*) from public.email_messages) = 0, 'other organizations see no email activity');
select tests.check((select count(*) from public.reminder_jobs) = 0, 'other organizations see no reminder jobs');
select tests.check((select count(*) from public.email_suppressions) = 0, 'other organizations see no suppressions');
select tests.check((select count(*) from public.usage_counters) = 0, 'other organizations see no usage');
select tests.throws('select public.rf_enqueue_due_reminders()', '42501', 'users cannot run the scheduler');
select tests.throws(format('select public.rf_prepare_reminder(%L)', :'job_r'), '42501', 'users cannot prepare reminder jobs');
select tests.throws(format('select public.rf_apply_email_event(%L, %L, %L, now())', 'e', 're_test_1', 'email.delivered'),
  '42501', 'users cannot forge delivery events');
reset role;

set role anon;
select tests.throws('select * from public.email_messages', '42501', 'anon cannot read email activity');
select tests.throws('select public.rf_claim_jobs()', '42501', 'anon cannot claim jobs');
reset role;

select tests.login(:'alice');
set role authenticated;
insert into public.email_templates (org_id, kind, subject, body) values (:'org_a', 'overdue', 'Custom', 'Custom body {{link}}');
update public.reminder_rules set tone = 'neutral' where org_id = :'org_a' and offset_days = 7;
select public.set_reminders_enabled(:'org_a', false);
reset role;
select tests.check(not exists (select 1 from public.reminder_jobs where org_id = :'org_a' and status = 'scheduled'),
  'turning reminders off cancels everything waiting');
