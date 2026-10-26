-- Security tests: tenant isolation, write paths, locked documents, plan limits,
-- invitations and storage. Each check raises on failure, so psql's
-- ON_ERROR_STOP turns any regression into a failing run.
--
-- Users: alice owns Org A, bob owns Org B, carol is invited into Org A.

create schema tests;
grant usage on schema tests to anon, authenticated, service_role;

create function tests.check(ok boolean, label text) returns void language plpgsql as $$
begin
  if ok is not true then
    raise exception 'FAILED: %', label;
  end if;
  raise notice 'ok - %', label;
end $$;

-- Runs `stmt` as the current role and requires it to fail with SQLSTATE `state`.
create function tests.throws(stmt text, state text, label text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if sqlstate <> state then
      raise exception 'FAILED: % (expected %, got %: %)', label, state, sqlstate, sqlerrm;
    end if;
    raise notice 'ok - %', label;
    return;
  end;
  raise exception 'FAILED: % (no error)', label;
end $$;

create function tests.doc(p_id uuid, p_number text, p_issued boolean default false) returns jsonb
language sql as $$
  select jsonb_build_object(
    'version', 2, 'id', p_id, 'docType', 'invoice', 'ref', null,
    'client', jsonb_build_object('name', 'Jane', 'company', 'Acme Ltd', 'email', 'jane@acme.test'),
    'meta', jsonb_build_object('number', p_number, 'currency', 'GBP', 'issueDate', '2026-10-01',
                               'dueDate', '2026-10-31', 'status', case when p_issued then 'Unpaid' else 'Draft' end,
                               'issuedAt', case when p_issued then 1790000000000 end),
    'items', jsonb_build_array(jsonb_build_object('id', 'line-1', 'desc', 'Design', 'qty', 1, 'rate', 100)),
    'totals', jsonb_build_object('amountPaid', 0),
    'payment', jsonb_build_object('method', 'none'),
    'updatedAt', 1)
$$;

create function tests.totals() returns jsonb language sql as $$
  select '{"subtotal":10000,"discount":0,"tax":0,"shipping":0,"total":10000,"paid":0,"balance":10000}'::jsonb
$$;

-- Act as a signed-in user (role + JWT subject), like PostgREST does.
create function tests.login(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user)::text, false)
$$;
grant execute on all functions in schema tests to anon, authenticated, service_role;

\set alice '00000000-0000-0000-0000-00000000000a'
\set bob   '00000000-0000-0000-0000-00000000000b'
\set carol '00000000-0000-0000-0000-00000000000c'
\set doc1  '11111111-1111-1111-1111-111111111111'
\set doc2  '22222222-2222-2222-2222-222222222222'
\set doc3  '33333333-3333-3333-3333-333333333333'

insert into auth.users (id, email) values
  (:'alice', 'alice@a.test'), (:'bob', 'bob@b.test'), (:'carol', 'Carol@C.test');

select tests.check((select count(*) from public.profiles) = 3, 'signup trigger creates a profile per user');

-- Organizations -------------------------------------------------------------------

select tests.login(:'alice');
set role authenticated;
select public.create_organization('Org A', 'GB', 'GBP', 'Europe/London') as org_a \gset
reset role;

select tests.login(:'bob');
set role authenticated;
select public.create_organization('Org B', 'US', 'USD', 'America/New_York') as org_b \gset
reset role;

select tests.check(
  (select role from public.organization_members where org_id = :'org_a' and user_id = :'alice') = 'owner',
  'creator becomes owner');
select tests.check(
  (select plan_code = 'pro' and status = 'trialing' from public.subscriptions where org_id = :'org_a'),
  'new organization starts a Pro trial');

-- Documents are written only through the service role ---------------------------------

set role service_role;
select tests.check(
  (public.save_invoice(:'alice', :'org_a', tests.doc(:'doc1', 'INV-001'), tests.totals()) ->> 'revision') = '1',
  'service role saves a draft for a member');
select tests.throws(
  format('select public.save_invoice(%L, %L, tests.doc(gen_random_uuid(), %L), tests.totals())', :'bob', :'org_a', 'X'),
  'SA403', 'non-member cannot save into another organization');
reset role;

select tests.check((select count(*) from public.clients where org_id = :'org_a') = 1,
  'saving links the document to an org client');

-- Cross-tenant reads ------------------------------------------------------------------

select id as inv1 from public.invoices where local_id = :'doc1' \gset

select tests.login(:'bob');
set role authenticated;
select tests.check((select count(*) from public.invoices where org_id = :'org_a') = 0, 'bob cannot read org A invoices');
select tests.check((select count(*) from public.clients where org_id = :'org_a') = 0, 'bob cannot read org A clients');
select tests.check((select count(*) from public.organizations where id = :'org_a') = 0, 'bob cannot read org A');
select tests.check((select count(*) from public.organization_settings where org_id = :'org_a') = 0,
  'bob cannot read org A settings');
select tests.check((select count(*) from public.organization_members where org_id = :'org_a') = 0,
  'bob cannot read org A members');
select tests.check((select count(*) from public.subscriptions where org_id = :'org_a') = 0,
  'bob cannot read org A subscription');
select tests.check((select count(*) from public.audit_logs where org_id = :'org_a') = 0, 'bob cannot read org A audit log');
select tests.check((select count(*) from public.profiles where id = :'alice') = 0, 'bob cannot read alice''s profile');

-- Cross-tenant writes
update public.organizations set name = 'pwned' where id = :'org_a';
update public.organization_settings set invoice_prefix = 'X' where org_id = :'org_a';
update public.clients set name = 'pwned' where org_id = :'org_a';
select tests.throws(format('insert into public.clients (org_id, name) values (%L, %L)', :'org_a', 'x'),
  '42501', 'bob cannot add clients to org A');
select tests.throws(format('select public.delete_draft_invoice(%L)', :'inv1'), 'SA404',
  'bob cannot delete org A drafts');
select tests.throws(format('select public.remove_member(%L, %L)', :'org_a', :'alice'), 'SA404',
  'bob cannot remove members of org A');
select tests.throws(format('select public.create_invitation(%L, %L)', :'org_a', 'bob2@b.test'), 'SA403',
  'bob cannot invite into org A');
reset role;
select tests.check((select name from public.organizations where id = :'org_a') = 'Org A', 'org A name unchanged');
select tests.check((select invoice_prefix from public.organization_settings where org_id = :'org_a') = 'INV-',
  'org A settings unchanged');
select tests.check((select name from public.clients where org_id = :'org_a') = 'Jane', 'org A client unchanged');

-- Browsers never write documents directly ------------------------------------------------

select tests.login(:'alice');
set role authenticated;
select tests.check((select count(*) from public.invoices) = 1, 'alice reads her org''s invoice');
select tests.throws(
  format('insert into public.invoices (org_id, local_id, doc_type, number, status, currency, document) values (%L, gen_random_uuid(), %L, %L, %L, %L, %L)',
         :'org_a', 'invoice', 'INV-9', 'Draft', 'GBP', '{}'),
  '42501', 'members cannot insert invoices directly');
select tests.throws('update public.invoices set total_minor = 1', '42501', 'members cannot update invoice totals directly');
select tests.throws(format('select public.save_invoice(%L, %L, %L::jsonb, %L::jsonb)', :'alice', :'org_a', '{}', '{}'),
  '42501', 'members cannot call save_invoice');
select tests.throws(format('update public.organizations set created_by = %L where id = %L', :'bob', :'org_a'),
  '42501', 'mass assignment of protected organization columns is blocked');
select tests.throws('update public.subscriptions set plan_code = ''business''', '42501',
  'members cannot change their own subscription');
select tests.throws(format('insert into public.audit_logs (org_id, action) values (%L, %L)', :'org_a', 'fake'),
  '42501', 'members cannot forge audit entries');
update public.organizations set name = 'Org A Ltd' where id = :'org_a';
reset role;
select tests.check((select name from public.organizations where id = :'org_a') = 'Org A Ltd', 'owner renames org');

set role anon;
select tests.check((select count(*) from public.plans) = 3, 'anon can read the price list');
select tests.throws('select * from public.invoices', '42501', 'anon cannot read invoices');
select tests.throws('select public.create_organization(''x'')', '42501', 'anon cannot create organizations');
reset role;


-- Issued documents are locked ---------------------------------------------------------

set role service_role;
select public.save_invoice(:'alice', :'org_a', tests.doc(:'doc2', 'INV-002', true), tests.totals());
select tests.throws(
  format('select public.save_invoice(%L, %L, jsonb_set(tests.doc(%L, %L, true), %L, %L), tests.totals())',
         :'alice', :'org_a', :'doc2', 'INV-002', '{items,0,rate}', '999'),
  'SA423', 'issued document content cannot change');
select tests.check(
  (public.save_invoice(:'alice', :'org_a', jsonb_set(tests.doc(:'doc2', 'INV-002', true), '{meta,status}', '"Paid"'),
                       tests.totals()) ->> 'status') = 'Paid',
  'issued document status can change');
select tests.throws(
  format('select public.save_invoice(%L, %L, tests.doc(%L, %L, true), tests.totals())', :'alice', :'org_a', :'doc3', 'inv-002'),
  'SA409', 'issued numbers are unique per series (case-insensitive)');
select public.save_invoice(:'alice', :'org_a', tests.doc(:'doc1', 'INV-001'), tests.totals(), 1);
select tests.throws(
  format('select public.save_invoice(%L, %L, tests.doc(%L, %L), tests.totals(), 1)', :'alice', :'org_a', :'doc1', 'INV-001'),
  'SA409', 'stale revision is rejected');
reset role;

select tests.throws(
  format('update public.invoices set document = document || %L where local_id = %L', '{"x":1}', :'doc2'),
  'SA423', 'trigger blocks any edit of issued content, even by the table owner');
select tests.throws(
  format('update public.invoices set deleted_at = now() where local_id = %L', :'doc2'),
  'SA423', 'issued documents cannot be deleted');

select tests.login(:'alice');
set role authenticated;
select tests.throws(format('select public.delete_draft_invoice(id) from public.invoices where local_id = %L', :'doc2'),
  'SA423', 'delete_draft_invoice refuses issued documents');
reset role;

-- Import is idempotent ------------------------------------------------------------------

set role service_role;
select tests.check(
  (public.import_invoices(:'alice', :'org_a',
     jsonb_build_array(jsonb_build_object('doc', tests.doc(:'doc1', 'INV-001'), 'totals', tests.totals()),
                       jsonb_build_object('doc', tests.doc(:'doc3', 'INV-003'), 'totals', tests.totals())))
   -> 0 ->> 'result') = 'duplicate',
  'importing an existing document reports a duplicate');
select tests.check(
  (select count(*) from public.invoices where org_id = :'org_a') = 3, 'import adds only new documents');
select tests.check(
  (select source from public.invoices where local_id = :'doc3') = 'import', 'imported rows are marked as imports');
reset role;

-- Plan limits --------------------------------------------------------------------------

update public.subscriptions set trial_ends_at = now() - interval '1 day' where org_id = :'org_a';
set role service_role;
select tests.throws(
  format('select public.save_invoice(%L, %L, tests.doc(gen_random_uuid(), %L), tests.totals())', :'alice', :'org_a', 'INV-010'),
  'SA402', 'expired trial falls back to Free: no new cloud documents');
select tests.check(
  (public.save_invoice(:'alice', :'org_a', tests.doc(:'doc3', 'INV-003b'), tests.totals()) ->> 'revision') = '2',
  'existing cloud documents stay editable after the trial');
reset role;

-- Invitations & roles ------------------------------------------------------------------

select tests.login(:'alice');
set role authenticated;
select tests.throws(format('select public.create_invitation(%L, %L)', :'org_a', 'carol@c.test'), 'SA402',
  'Free plan has no extra seats');
reset role;
update public.subscriptions set plan_code = 'business', status = 'active' where org_id = :'org_a';
set role authenticated;
select public.create_invitation(:'org_a', ' Carol@C.test ', 'member') as invite_token \gset
select tests.throws(format('select public.create_invitation(%L, %L, %L::public.org_role)', :'org_a', 'x@c.test', 'owner'),
  'SA403', 'nobody can invite an owner');
reset role;
select tests.check(
  (select token_hash <> convert_to(:'invite_token', 'UTF8') from public.organization_invitations limit 1),
  'only a hash of the invitation token is stored');

select tests.login(:'alice');
set role authenticated;
select tests.throws('select token_hash from public.organization_invitations', '42501',
  'token hashes are not readable through the API');
reset role;

select tests.login(:'bob');
set role authenticated;
select tests.throws(format('select public.accept_invitation(%L)', :'invite_token'), 'SA403',
  'an invitation only works for the invited email');
reset role;

select tests.login(:'carol');
set role authenticated;
select tests.throws(format('select public.accept_invitation(%L)', 'not-a-token'), 'SA404', 'unknown tokens are rejected');
select tests.check(public.accept_invitation(:'invite_token') = :'org_a', 'carol accepts (email matched case-insensitively)');
select tests.throws(format('select public.accept_invitation(%L)', :'invite_token'), 'SA404', 'tokens are single-use');
select tests.check((select count(*) from public.invoices where org_id = :'org_a') = 3, 'carol now reads org A invoices');
select tests.check((select count(*) from public.invoices where org_id = :'org_b') = 0, 'carol still cannot read org B');
select tests.check((select count(*) from public.audit_logs where entity_type is distinct from 'invoice') = 0,
  'members cannot read organization-level audit entries');
select tests.throws(format('select public.create_invitation(%L, %L)', :'org_a', 'dan@d.test'), 'SA403',
  'members cannot invite');
select tests.throws(format('select public.remove_member(%L, %L)', :'org_a', :'alice'), 'SA403',
  'members cannot remove the owner');
update public.organization_settings set invoice_prefix = 'HACK-' where org_id = :'org_a';
reset role;
select tests.check((select invoice_prefix from public.organization_settings where org_id = :'org_a') = 'INV-',
  'members cannot edit organization settings');

set role service_role;
select tests.throws(
  format('select public.save_invoice(%L, %L, jsonb_set(tests.doc(%L, %L, true), %L, %L), tests.totals())',
         :'carol', :'org_a', :'doc2', 'INV-002', '{meta,issuedAt}', 'null'),
  'SA403', 'members cannot unlock issued documents');
select tests.check(
  (public.save_invoice(:'alice', :'org_a', jsonb_set(tests.doc(:'doc2', 'INV-002', true), '{meta,issuedAt}', 'null'),
                       tests.totals()) ->> 'issued') = 'false',
  'owners can unlock issued documents');
reset role;
select tests.check(
  exists (select 1 from public.audit_logs where org_id = :'org_a' and action = 'invoice.unlocked'),
  'unlocking is audited');

select tests.login(:'alice');
set role authenticated;
select tests.throws(format('select public.remove_member(%L, %L)', :'org_a', :'alice'), 'SA409',
  'the last owner cannot leave');
select public.remove_member(:'org_a', :'carol');
reset role;
select tests.check(
  not exists (select 1 from public.organization_members where org_id = :'org_a' and user_id = :'carol'),
  'owners can remove members');

-- Storage --------------------------------------------------------------------------------

select tests.login(:'alice');
set role authenticated;
insert into storage.objects (bucket_id, name) values ('org-assets', :'org_a' || '/logo.png');
reset role;

select tests.login(:'bob');
set role authenticated;
select tests.check((select count(*) from storage.objects) = 0, 'bob cannot list org A files');
select tests.throws(format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'org-assets', :'org_a' || '/x.png'),
  '42501', 'bob cannot upload into org A''s folder');
select tests.throws(format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'org-assets', 'not-a-uuid/x.png'),
  '42501', 'malformed folder names are rejected');
delete from storage.objects;
reset role;
select tests.check((select count(*) from storage.objects) = 1, 'bob cannot delete org A files');

-- Account deletion requests ------------------------------------------------------------------

select tests.login(:'bob');
set role authenticated;
insert into public.account_deletion_requests (reason) values ('leaving');
select tests.throws(format('insert into public.account_deletion_requests (user_id, reason) values (%L, %L)', :'alice', 'x'),
  '42501', 'cannot request deletion of someone else''s account');
reset role;
select tests.login(:'alice');
set role authenticated;
select tests.check((select count(*) from public.account_deletion_requests) = 0, 'deletion requests are private');
reset role;

-- Profiles follow auth email changes ------------------------------------------------------

update auth.users set email = 'alice@new.test' where id = :'alice';
select tests.check((select email from public.profiles where id = :'alice') = 'alice@new.test',
  'profile email follows auth email changes');
