-- Every ISO 4217 currency on documents. Minor units follow ISO 4217 and must
-- match MINOR_UNITS in src/core/money.ts (the browser and Edge Functions use
-- that table), so totals agree everywhere.
create or replace function app.currency_digits(p_currency text) returns integer
language sql immutable set search_path = '' as $$
  select case
    when p_currency in ('BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG',
                        'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF') then 0
    when p_currency in ('BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND') then 3
    else 2
  end
$$;
