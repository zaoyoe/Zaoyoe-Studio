-- 20261004_verify_nowpayments_fee_paid_by_user_false.sql
-- 验证 NOWPayments 的 is_fee_paid_by_user、is_fixed_rate 与 price_currency

SELECT
    config_key,
    config_value->'sites'->'cn'->'providers'->'nowpayments'->>'price_currency' AS cn_price_currency,
    config_value->'sites'->'cn'->'providers'->'nowpayments'->>'is_fixed_rate' AS cn_is_fixed_rate,
    config_value->'sites'->'cn'->'providers'->'nowpayments'->>'is_fee_paid_by_user' AS cn_fee_by_user,
    config_value->'sites'->'intl'->'providers'->'nowpayments'->>'price_currency' AS intl_price_currency,
    config_value->'sites'->'intl'->'providers'->'nowpayments'->>'is_fixed_rate' AS intl_is_fixed_rate,
    config_value->'sites'->'intl'->'providers'->'nowpayments'->>'is_fee_paid_by_user' AS intl_fee_by_user
FROM public.system_config
WHERE config_key = 'payment_channels';
