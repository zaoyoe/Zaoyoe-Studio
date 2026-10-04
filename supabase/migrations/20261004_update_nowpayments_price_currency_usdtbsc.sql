-- 20261004_update_nowpayments_price_currency_usdtbsc.sql
-- Update NOWPayments price_currency to usdtbsc to avoid fiat-to-crypto minimum amount threshold (~$18.57)

-- 1. Update top-level providers if present
UPDATE public.system_config
SET config_value = jsonb_set(
    config_value,
    '{providers,nowpayments,price_currency}',
    '"usdtbsc"'::jsonb,
    true
)
WHERE config_key = 'payment_channels'
  AND config_value ? 'providers'
  AND (config_value->'providers') ? 'nowpayments';

-- 2. Update site-scoped sites.intl.providers if present
UPDATE public.system_config
SET config_value = jsonb_set(
    config_value,
    '{sites,intl,providers,nowpayments,price_currency}',
    '"usdtbsc"'::jsonb,
    true
)
WHERE config_key = 'payment_channels'
  AND config_value ? 'sites'
  AND (config_value->'sites') ? 'intl'
  AND (config_value->'sites'->'intl') ? 'providers'
  AND (config_value->'sites'->'intl'->'providers') ? 'nowpayments';
