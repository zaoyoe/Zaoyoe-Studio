-- 20261004_update_nowpayments_fee_paid_by_user_false.sql
-- 将 NOWPayments 的 is_fee_paid_by_user 改为 false（由商户承担平台手续费）
-- 原因：NOWPayments 在 is_fee_paid_by_user 为 true 时强制要求最低限额约 9~10 USDT（约 65~70 元人民币），低于该金额会拒绝下单；
-- 改为 false 后，小额订单（0.1 USDT / 1 元、5 元、10 元）均可秒级生成支付单。
-- 本站已通过 1% 的通道手续费（surcharge_rate）向买家收取了通道费，因此无需在链上额外启用客户承担。

-- 1. 更新 sites.cn
UPDATE public.system_config
SET config_value = jsonb_set(
    config_value,
    '{sites,cn,providers,nowpayments,is_fee_paid_by_user}',
    'false'::jsonb,
    true
)
WHERE config_key = 'payment_channels'
  AND config_value ? 'sites'
  AND (config_value->'sites') ? 'cn'
  AND (config_value->'sites'->'cn') ? 'providers'
  AND (config_value->'sites'->'cn'->'providers') ? 'nowpayments';

-- 2. 更新 sites.intl
UPDATE public.system_config
SET config_value = jsonb_set(
    config_value,
    '{sites,intl,providers,nowpayments,is_fee_paid_by_user}',
    'false'::jsonb,
    true
)
WHERE config_key = 'payment_channels'
  AND config_value ? 'sites'
  AND (config_value->'sites') ? 'intl'
  AND (config_value->'sites'->'intl') ? 'providers'
  AND (config_value->'sites'->'intl'->'providers') ? 'nowpayments';

-- 3. 更新顶层 providers（若存在）
UPDATE public.system_config
SET config_value = jsonb_set(
    config_value,
    '{providers,nowpayments,is_fee_paid_by_user}',
    'false'::jsonb,
    true
)
WHERE config_key = 'payment_channels'
  AND config_value ? 'providers'
  AND (config_value->'providers') ? 'nowpayments';
