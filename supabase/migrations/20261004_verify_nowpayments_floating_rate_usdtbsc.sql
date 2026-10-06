-- 20261004_verify_nowpayments_floating_rate_usdtbsc.sql
-- 验证 NOWPayments 的 price_currency 与 is_fixed_rate 设置

SELECT
    config_key,
    config_value->'sites'->'cn'->'providers'->'nowpayments'->>'price_currency' AS cn_price_currency,
    config_value->'sites'->'cn'->'providers'->'nowpayments'->>'pay_currency' AS cn_pay_currency,
    config_value->'sites'->'cn'->'providers'->'nowpayments'->>'is_fixed_rate' AS cn_is_fixed_rate,
    config_value->'sites'->'intl'->'providers'->'nowpayments'->>'price_currency' AS intl_price_currency,
    config_value->'sites'->'intl'->'providers'->'nowpayments'->>'pay_currency' AS intl_pay_currency,
    config_value->'sites'->'intl'->'providers'->'nowpayments'->>'is_fixed_rate' AS intl_is_fixed_rate
FROM public.system_config
WHERE config_key = 'payment_channels';
