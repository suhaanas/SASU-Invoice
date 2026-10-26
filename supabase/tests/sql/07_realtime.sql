-- Live updates: changes are broadcast on a private per-organization topic,
-- carry no row data, and only members can receive them.
\set alice '00000000-0000-0000-0000-00000000000a'
\set bob   '00000000-0000-0000-0000-00000000000b'
select org_id as org_a from public.organization_members
  where user_id = :'alice' and role = 'owner' order by created_at limit 1 \gset

delete from realtime.messages;
update public.clients set notes = coalesce(notes, '') || ' ' where org_id = :'org_a';
select tests.check(
  exists (select 1 from realtime.messages where topic = 'org:' || :'org_a' and event = 'change'
          and private and payload ->> 'table' = 'clients' and payload ->> 'op' = 'UPDATE'),
  'a change is broadcast privately on the organization''s topic');
select tests.check(
  not exists (select 1 from realtime.messages
              where payload - 'table' - 'op' - 'id' <> '{}'::jsonb),
  'broadcasts carry only table, op and id (no row data)');

-- A member of Org A may receive Org A's topic.
select tests.login(:'alice');
select set_config('realtime.topic', 'org:' || :'org_a', false);
set role authenticated;
select tests.check((select count(*) from realtime.messages) > 0, 'members receive their organization''s changes');
reset role;

-- Bob (Org B) may not, even when asking for Org A's topic.
select tests.login(:'bob');
set role authenticated;
select tests.check((select count(*) from realtime.messages) = 0, 'other organizations receive nothing');
select tests.throws(
  format($$insert into realtime.messages (topic, extension, payload, event, private)
           values ('org:%s', 'broadcast', '{}', 'change', true)$$, :'org_a'),
  '42501', 'clients cannot publish on organization topics');
reset role;

-- Anonymous visitors receive nothing.
select set_config('request.jwt.claims', '', false);
set role anon;
select tests.check((select count(*) from realtime.messages) = 0, 'anonymous visitors receive nothing');
reset role;
select set_config('realtime.topic', '', false);
