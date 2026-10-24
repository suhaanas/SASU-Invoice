-- Row-level security for every table, column-level grants against mass
-- assignment, and the private storage bucket for organization assets.
--
-- Rule of thumb: members can READ their organizations' rows; direct WRITES are
-- limited to non-financial data via column grants; anything sensitive goes
-- through a security-definer function that checks the role itself.

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.organization_invitations enable row level security;
alter table public.organization_settings enable row level security;
alter table public.plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.audit_logs enable row level security;
alter table public.account_deletion_requests enable row level security;
alter table public.clients enable row level security;
alter table public.invoices enable row level security;

-- Start from nothing and grant back only what each role needs.
revoke all on all tables in schema public from anon, authenticated;

-- profiles: your own, plus people you share an organization with.
grant select on public.profiles to authenticated;
grant update (full_name) on public.profiles to authenticated;
create policy profiles_select on public.profiles for select to authenticated using (
  id = auth.uid() or exists (
    select 1 from public.organization_members mine
    join public.organization_members theirs on theirs.org_id = mine.org_id
    where mine.user_id = auth.uid() and theirs.user_id = profiles.id
  )
);
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- organizations: created via create_organization(); owners/admins edit basics.
grant select on public.organizations to authenticated;
grant update (name, country, default_currency, timezone, onboarding_completed_at) on public.organizations to authenticated;
create policy organizations_select on public.organizations for select to authenticated
  using (deleted_at is null and app.is_member(id));
create policy organizations_update on public.organizations for update to authenticated
  using (app.has_role(id, '{owner,admin}')) with check (app.has_role(id, '{owner,admin}'));

-- members & invitations: read-only here; changed through RPCs.
grant select on public.organization_members to authenticated;
create policy members_select on public.organization_members for select to authenticated
  using (app.is_member(org_id));

grant select (id, org_id, email, role, invited_by, expires_at, accepted_at, revoked_at, created_at)
  on public.organization_invitations to authenticated;
create policy invitations_select on public.organization_invitations for select to authenticated
  using (app.has_role(org_id, '{owner,admin}'));

-- settings: everyone in the org reads (invoices need them); owners/admins edit.
grant select on public.organization_settings to authenticated;
grant update (business, invoice_prefix, tax_label, tax_rate, payment_terms, payment_instructions, logo_path, updated_by)
  on public.organization_settings to authenticated;
create policy settings_select on public.organization_settings for select to authenticated
  using (app.is_member(org_id));
create policy settings_update on public.organization_settings for update to authenticated
  using (app.has_role(org_id, '{owner,admin}'))
  with check (app.has_role(org_id, '{owner,admin}') and (updated_by is null or updated_by = auth.uid()));

-- plans: public price list.
grant select on public.plans to anon, authenticated;
create policy plans_select on public.plans for select to anon, authenticated using (is_active);

-- subscriptions: members see their org's plan; only the billing backend writes.
grant select on public.subscriptions to authenticated;
create policy subscriptions_select on public.subscriptions for select to authenticated
  using (app.is_member(org_id));

-- audit log: owners/admins read; written only by security-definer functions.
grant select on public.audit_logs to authenticated;
create policy audit_select on public.audit_logs for select to authenticated
  using (app.has_role(org_id, '{owner,admin}'));

-- account deletion requests: your own only.
grant select, insert (reason) on public.account_deletion_requests to authenticated;
create policy deletion_select on public.account_deletion_requests for select to authenticated
  using (user_id = auth.uid());
create policy deletion_insert on public.account_deletion_requests for insert to authenticated
  with check (user_id = auth.uid());

-- clients: any member creates and edits; no hard deletes (archive instead).
grant select on public.clients to authenticated;
grant insert (org_id, name, company, email, phone, address, delivery_address, country, tax_id, reg_number,
              preferred_currency, payment_terms_days, notes)
  on public.clients to authenticated;
grant update (name, company, email, phone, address, delivery_address, country, tax_id, reg_number,
              preferred_currency, payment_terms_days, notes, archived_at)
  on public.clients to authenticated;
create policy clients_select on public.clients for select to authenticated using (app.is_member(org_id));
create policy clients_insert on public.clients for insert to authenticated with check (app.is_member(org_id));
create policy clients_update on public.clients for update to authenticated
  using (app.is_member(org_id)) with check (app.is_member(org_id));

-- invoices: read-only for browsers; all writes go through the invoices Edge Function.
grant select on public.invoices to authenticated;
create policy invoices_select on public.invoices for select to authenticated
  using (deleted_at is null and app.is_member(org_id));

-- Storage: private bucket, objects live under "<org_id>/…".
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('org-assets', 'org-assets', false, 2097152, '{image/png,image/jpeg,image/webp}')
on conflict (id) do nothing;

create policy org_assets_select on storage.objects for select to authenticated using (
  bucket_id = 'org-assets' and app.is_member(app.try_uuid((storage.foldername(name))[1]))
);
create policy org_assets_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'org-assets' and app.has_role(app.try_uuid((storage.foldername(name))[1]), '{owner,admin}')
);
create policy org_assets_update on storage.objects for update to authenticated using (
  bucket_id = 'org-assets' and app.has_role(app.try_uuid((storage.foldername(name))[1]), '{owner,admin}')
);
create policy org_assets_delete on storage.objects for delete to authenticated using (
  bucket_id = 'org-assets' and app.has_role(app.try_uuid((storage.foldername(name))[1]), '{owner,admin}')
);

grant execute on function app.try_uuid(text) to authenticated;
