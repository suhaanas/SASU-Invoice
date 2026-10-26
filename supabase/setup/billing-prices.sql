-- One-time setup (per Supabase project): connect plans to Paddle prices.
-- Sandbox and live Paddle accounts have different price ids, so staging and
-- production each run this with their own values.
--
-- 1. In Paddle (Catalog → Products), create "SASU Invoice Pro" ($12/month) and
--    "SASU Invoice Business" ($29/month) and copy each price id (pri_…).
-- 2. Replace the placeholders below and run this in the SQL editor.
--
-- Prices and limits shown in the app come from public.plans; keep price_minor
-- in line with the Paddle price (Paddle is what actually charges).

update public.plans set provider = 'paddle', provider_price_id = '<pri_… for Pro>' where code = 'pro';
update public.plans set provider = 'paddle', provider_price_id = '<pri_… for Business>' where code = 'business';

-- Check:
select code, name, price_minor, provider_price_id from public.plans order by sort_order;
