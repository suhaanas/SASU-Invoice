-- One-time setup (per Supabase project) for RecoverFlow's scheduler.
-- Not a migration: it needs the project's function URL and worker secret.
--
-- 1. Generate a secret:            openssl rand -hex 32
-- 2. Give it to the function:      supabase secrets set WORKER_SECRET=<secret>
-- 3. In the SQL editor, replace the two values below and run this file.
--
-- pg_cron then calls the reminder-worker every 5 minutes. The worker is
-- idempotent: overlapping or repeated runs can't send a reminder twice.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Secrets live in Supabase Vault, not in the cron job's text.
select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/reminder-worker', 'recoverflow_worker_url');
select vault.create_secret('<the WORKER_SECRET value>', 'recoverflow_worker_secret');

select cron.schedule(
  'recoverflow-worker',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'recoverflow_worker_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-worker-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'recoverflow_worker_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);

-- To check:   select * from cron.job_run_details order by start_time desc limit 10;
-- To stop:    select cron.unschedule('recoverflow-worker');
