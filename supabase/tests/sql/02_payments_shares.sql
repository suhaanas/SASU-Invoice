-- Phase 2 tests: payments ledger, share links, dashboard aggregates.
-- Runs after 01_security.sql in the same database (reuses its users, orgs and helpers).

\set alice '00000000-0000-0000-0000-00000000000a'
\set bob   '00000000-0000-0000-0000-00000000000b'
\set carol '00000000-0000-0000-0000-00000000000c'
\set docp  '44444444-4444-4444-4444-444444444444'
\set doco  '55555555-5555-5555-5555-555555555555'

select id as org_a from public.organizations where name = 'Org A Ltd' \gset
select id as org_b from public.organizations where name = 'Org B' \gset

-- An issued £100.00 invoice due 2026-10-31.
set role service_role;
select public.save_invoice(:'alice', :'org_a', tests.doc(:'docp', 'INV-100', true), tests.totals());
reset role;
select id as inv_p from public.invoices where local_id = :'docp' \gset
select id as draft from public.invoices where org_id = :'org_a' and issued_at is null limit 1 \gset

-- Recording payments ---------------------------------------------------------------------

select tests.login(:'alice');
set role authenticated;
select public.record_payment(:'inv_p', 4000, date '2026-10-05', 'bank_transfer', 'REF-1');
reset role;
select tests.check(
  (select paid_minor = 4000 and balance_minor = 6000 and status = 'Unpaid' from public.invoices where id = :'inv_p'),
  'a partial payment updates paid and balance, status stays Unpaid');
select tests.check(
  (select (document #>> '{totals,amountPaid}')::numeric = 40 from public.invoices where id = :'inv_p'),
  'the editor document mirrors the ledger amount in major units');

select tests.login(:'alice');
set role authenticated;
select tests.throws(format('select public.record_payment(%L, 7000, current_date, %L)', :'inv_p', 'cash'),
  'SA422', 'payments cannot exceed the outstanding balance');
select tests.throws(format('select public.record_payment(%L, 100, current_date + 5, %L)', :'inv_p', 'cash'),
  'SA422', 'payments cannot be dated in the future');
select tests.throws(format('select public.record_payment(%L, 0, current_date, %L)', :'inv_p', 'cash'),
  'SA422', 'payments must be positive');
select tests.throws(format('select public.record_payment(%L, 100, current_date, %L)', :'draft', 'cash'),
  'SA422', 'payments need an issued invoice');
select tests.throws(format('select public.record_payment(%L, 100, current_date, %L)', :'inv_p', 'bitcoin'),
  '23514', 'unknown payment methods are rejected');
select tests.throws(
  format('insert into public.invoice_payments (org_id, invoice_id, amount_minor, currency, paid_on, method) values (%L, %L, 1, %L, current_date, %L)',
         :'org_a', :'inv_p', 'GBP', 'cash'),
  '42501', 'payments cannot be inserted directly');
reset role;

select tests.login(:'bob');
set role authenticated;
select tests.throws(format('select public.record_payment(%L, 100, current_date, %L)', :'inv_p', 'cash'),
  'SA404', 'another organization cannot record payments');
select tests.check((select count(*) from public.invoice_payments) = 0, 'another organization cannot read payments');
reset role;

-- Dashboard aggregates (partially paid state) -----------------------------------------------

select tests.login(:'alice');
set role authenticated;
select public.dashboard_summary(:'org_a', 'GBP') as summary \gset
select tests.check((:'summary'::jsonb ->> 'partialCount')::int = 1, 'dashboard counts the partially paid invoice');
select tests.check((:'summary'::jsonb ->> 'outstandingMinor')::bigint = 6000, 'dashboard outstanding is the open balance');
select tests.check(
  (select sum((m ->> 'receivedMinor')::bigint) from jsonb_array_elements(:'summary'::jsonb -> 'monthly') m) >= 0,
  'dashboard returns a monthly series');
select tests.check((select count(*) from public.client_balances(:'org_a')) >= 1, 'client balances are computed');
reset role;

select tests.login(:'bob');
set role authenticated;
select tests.check(
  (public.dashboard_summary(:'org_a', 'GBP') ->> 'invoicedMinor')::bigint = 0,
  'another organization''s dashboard totals are invisible');
select tests.check((select count(*) from public.client_balances(:'org_a')) = 0,
  'another organization''s client balances are invisible');
reset role;

-- Full payment, editor saves, voiding --------------------------------------------------------

select tests.login(:'alice');
set role authenticated;
select public.record_payment(:'inv_p', 6000, date '2026-10-06', 'card') as pay2 \gset
reset role;
select tests.check(
  (select status = 'Paid' and balance_minor = 0 from public.invoices where id = :'inv_p'),
  'paying in full marks the invoice Paid');

set role service_role;
select tests.check(
  (public.save_invoice(:'alice', :'org_a', tests.doc(:'docp', 'INV-100', true), tests.totals()) ->> 'amountPaid')::numeric = 100,
  'an editor save cannot override the ledger amount paid');
reset role;
select tests.check((select paid_minor = 10000 and status = 'Paid' from public.invoices where id = :'inv_p'),
  'ledger-derived amounts and status survive editor saves');

insert into public.organization_members (org_id, user_id, role) values (:'org_a', :'carol', 'member');
select tests.login(:'carol');
set role authenticated;
select tests.throws(format('select public.void_payment(%L, %L)', :'pay2', 'mistake'), 'SA403',
  'members cannot void payments');
select tests.check((select count(*) from public.audit_logs where entity_id = :'inv_p') > 0,
  'members can read an invoice''s history');
reset role;

select tests.login(:'alice');
set role authenticated;
select tests.throws(format('select public.void_payment(%L, %L)', :'pay2', '  '), 'SA422', 'voiding needs a reason');
select public.void_payment(:'pay2', 'Card payment was reversed');
select tests.throws(format('select public.void_payment(%L, %L)', :'pay2', 'again'), 'SA409', 'payments are voided once');
reset role;
select tests.check(
  (select status = 'Unpaid' and balance_minor = 6000 from public.invoices where id = :'inv_p'),
  'voiding a payment reopens the balance and status');
select tests.check(exists (select 1 from public.audit_logs where action = 'payment.voided'), 'voids are audited');

set role service_role;
select tests.throws(
  format('select public.save_invoice(%L, %L, jsonb_set(tests.doc(%L, %L, true), %L, %L), tests.totals())',
         :'alice', :'org_a', :'docp', 'INV-100', '{meta,issuedAt}', 'null'),
  'SA423', 'invoices with recorded payments cannot be unlocked');
reset role;

-- Opening balance carried over from the editor's "amount paid" ----------------------------------

set role service_role;
select public.save_invoice(:'alice', :'org_a',
  jsonb_set(tests.doc(:'doco', 'INV-101', true), '{totals,amountPaid}', '25'),
  '{"subtotal":10000,"discount":0,"tax":0,"shipping":0,"total":10000,"paid":2500,"balance":7500}');
reset role;
select id as inv_o from public.invoices where local_id = :'doco' \gset
select tests.login(:'alice');
set role authenticated;
select public.record_payment(:'inv_o', 1000, current_date, 'cash');
reset role;
select tests.check(
  (select count(*) = 2 and sum(amount_minor) = 3500 and bool_or(source = 'opening_balance')
   from public.invoice_payments where invoice_id = :'inv_o'),
  'an earlier "amount paid" becomes an opening-balance payment');

-- Share links -----------------------------------------------------------------------------------

select tests.login(:'alice');
set role authenticated;
select tests.throws(format('select public.create_invoice_share(%L)', :'draft'), 'SA422', 'drafts cannot be shared');
select tests.throws(format('select public.create_invoice_share(%L, 0)', :'inv_p'), 'SA422', 'link lifetime is bounded');
select public.create_invoice_share(:'inv_p', 30) as token \gset
select tests.throws('select token_hash from public.invoice_shares', '42501', 'share token hashes are not readable');
reset role;
select tests.check((select token_hash <> convert_to(:'token', 'UTF8') from public.invoice_shares limit 1),
  'only a hash of the share token is stored');

set role anon;
select tests.check((public.get_shared_invoice(:'token') #>> '{document,meta,number}') = 'INV-100',
  'anyone with the link sees the invoice');
select tests.check((public.get_shared_invoice(:'token') ->> 'balanceMinor')::bigint = 6000,
  'the client view shows the outstanding balance');
select tests.check(public.get_shared_invoice(repeat('0', 64)) is null, 'unknown tokens show nothing');
select tests.check(public.get_shared_invoice('x'' or 1=1 --') is null, 'malformed tokens show nothing');
select tests.throws('select * from public.invoice_shares', '42501', 'anon cannot list share links');
select tests.throws('select * from public.invoice_payments', '42501', 'anon cannot read payments');
select tests.throws(format('select public.create_invoice_share(%L)', :'inv_p'), '42501', 'anon cannot create links');
reset role;
select tests.check((select view_count = 2 from public.invoice_shares limit 1), 'views are counted');

select id as share_id from public.invoice_shares limit 1 \gset
select tests.login(:'bob');
set role authenticated;
select tests.throws(format('select public.revoke_invoice_share(%L)', :'share_id'), 'SA404',
  'another organization cannot revoke links');
reset role;

update public.invoice_shares set expires_at = now() - interval '1 second';
set role anon;
select tests.check(public.get_shared_invoice(:'token') is null, 'expired links show nothing');
reset role;
update public.invoice_shares set expires_at = now() + interval '1 day';

select tests.login(:'alice');
set role authenticated;
select public.revoke_invoice_share(id) from public.invoice_shares;
reset role;
set role anon;
select tests.check(public.get_shared_invoice(:'token') is null, 'revoked links show nothing');
reset role;
