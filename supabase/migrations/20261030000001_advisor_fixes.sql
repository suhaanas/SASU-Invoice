-- Fixes from Supabase's database advisors (run against staging):
--   * pin search_path on the remaining helper functions;
--   * evaluate auth.uid() once per query in RLS policies, not once per row;
--   * one SELECT policy on audit_logs instead of two (same rule);
--   * pg_net belongs in the extensions schema, not public.
-- The SECURITY DEFINER functions callable by users/anon that the advisors
-- also list are the intended RPC allow-list (see tests/sql/06_audit.sql).

alter function app.usage_limit_key(text) set search_path = '';
alter function app.try_uuid(text) set search_path = '';
alter function app.touch_updated_at() set search_path = '';
alter function app.require_user() set search_path = '';
alter function app.recurring_date(date, text, integer, integer) set search_path = '';
alter function app.locked_content(jsonb) set search_path = '';
alter function app.iso_date(text) set search_path = '';
alter function app.guard_invoice_update() set search_path = '';
alter function app.epoch_ms_to_ts(jsonb) set search_path = '';
alter function app.email_status_rank(text) set search_path = '';
alter function app.currency_digits(text) set search_path = '';

drop policy profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (
  id = (select auth.uid()) or exists (
    select 1 from public.organization_members mine
    join public.organization_members theirs on theirs.org_id = mine.org_id
    where mine.user_id = (select auth.uid()) and theirs.user_id = profiles.id
  )
);
drop policy profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

drop policy settings_update on public.organization_settings;
create policy settings_update on public.organization_settings for update to authenticated
  using (app.has_role(org_id, '{owner,admin}'))
  with check (app.has_role(org_id, '{owner,admin}') and (updated_by is null or updated_by = (select auth.uid())));

drop policy deletion_select on public.account_deletion_requests;
create policy deletion_select on public.account_deletion_requests for select to authenticated
  using (user_id = (select auth.uid()));
drop policy deletion_insert on public.account_deletion_requests;
create policy deletion_insert on public.account_deletion_requests for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy clients_insert on public.clients;
create policy clients_insert on public.clients for insert to authenticated
  with check (app.can(org_id, (select auth.uid()), 'manage_clients'));
drop policy clients_update on public.clients;
create policy clients_update on public.clients for update to authenticated
  using (app.can(org_id, (select auth.uid()), 'manage_clients'))
  with check (app.can(org_id, (select auth.uid()), 'manage_clients'));

drop policy audit_select on public.audit_logs;
drop policy audit_select_invoice on public.audit_logs;
create policy audit_select on public.audit_logs for select to authenticated using (
  app.has_role(org_id, '{owner,admin}') or (entity_type = 'invoice' and app.is_member(org_id))
);

-- pg_net can't be moved with ALTER EXTENSION … SET SCHEMA; recreate it. Its
-- functions live in schema "net" either way, so the cron job is unaffected.
do $$
begin
  if exists (select 1 from pg_extension e join pg_namespace n on n.oid = e.extnamespace
             where e.extname = 'pg_net' and n.nspname = 'public') then
    drop extension pg_net;
    create extension pg_net with schema extensions;
  end if;
end $$;
