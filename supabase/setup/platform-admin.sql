-- Grant (or revoke) platform admin access. Run in the SQL editor; there is
-- deliberately no way to do this from the app.
--
-- Platform admins see platform health, organization metadata and counts, and
-- can flip feature switches. They do NOT get access to any organization's
-- invoices, clients or amounts.

insert into public.platform_admins (user_id)
select id from auth.users where lower(email) = lower('<admin email>')
on conflict do nothing;

-- Revoke:
-- delete from public.platform_admins where user_id = (select id from auth.users where lower(email) = lower('<admin email>'));
