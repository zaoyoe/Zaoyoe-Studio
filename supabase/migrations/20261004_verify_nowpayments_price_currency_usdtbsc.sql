-- 20261004_verify_nowpayments_price_currency_usdtbsc.sql
-- Verify NOWPayments price_currency is set to usdtbsc

SELECT
    config_key,
    config_value->'providers'->'nowpayments'->>'pay_currency' AS global_pay_currency,
    config_value->'providers'->'nowpayments'->>'price_currency' AS global_price_currency,
    config_value->'sites'->'intl'->'providers'->'nowpayments'->>'pay_currency' AS intl_pay_currency,
    config_value->'sites'->'intl'->'providers'->'nowpayments'->>'price_currency' AS intl_price_currency
FROM public.system_config
WHERE config_key = 'payment_channels';
