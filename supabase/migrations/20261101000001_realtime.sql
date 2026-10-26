-- Live dashboard updates. Database changes are announced on a private
-- Realtime Broadcast topic per organization ("org:<uuid>"). Messages carry only
-- {table, op, id}, never row data: dashboards refetch through the normal
-- RLS-protected API. Only members can listen; nobody can send from a client.

create function app.notify_org_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_row jsonb := to_jsonb(coalesce(new, old));
  v_org text := v_row ->> 'org_id';
begin
  if v_org is not null then
    perform realtime.send(
      jsonb_build_object('table', tg_table_name, 'op', tg_op, 'id', v_row ->> 'id'),
      'change',
      'org:' || v_org,
      true
    );
  end if;
  return null;
exception when others then
  -- A notification must never block the write it describes.
  return null;
end
$$;

revoke all on function app.notify_org_change() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    'invoices', 'invoice_payments', 'clients', 'email_messages', 'reminder_jobs',
    'subscriptions', 'organization_members', 'recurring_rules'
  ] loop
    execute format(
      'create trigger notify_org_change after insert or update or delete on public.%I
         for each row execute function app.notify_org_change()', t);
  end loop;
end $$;

-- Members may receive their organization's broadcasts; there is no insert
-- policy, so clients cannot publish on these topics.
create policy org_members_receive on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and realtime.topic() like 'org:%'
    and app.is_member(nullif(substr(realtime.topic(), 5), '')::uuid)
  );
