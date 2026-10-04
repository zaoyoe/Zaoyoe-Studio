-- 20261004_update_nowpayments_floating_rate_usdtbsc.sql
-- 1. 将 NOWPayments 的 is_fixed_rate 改为 false（浮动汇率，起付门槛从 9.03 USDT 降至 0.096 USDT，支持小额支付）
-- 2. 将 price_currency 统一为 'usdtbsc'（直接用加密货币报价，彻底绕过法币通道的 $18.57 门槛）

-- 1. 更新 sites.cn
UPDATE public.system_config
SET config_value = jsonb_set(
    jsonb_set(
        config_value,
        '{sites,cn,providers,nowpayments,is_fixed_rate}',
        'false'::jsonb,
        true
    ),
    '{sites,cn,providers,nowpayments,price_currency}',
    '"usdtbsc"'::jsonb,
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
    jsonb_set(
        config_value,
        '{sites,intl,providers,nowpayments,is_fixed_rate}',
        'false'::jsonb,
        true
    ),
    '{sites,intl,providers,nowpayments,price_currency}',
    '"usdtbsc"'::jsonb,
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
    jsonb_set(
        config_value,
        '{providers,nowpayments,is_fixed_rate}',
        'false'::jsonb,
        true
    ),
    '{providers,nowpayments,price_currency}',
    '"usdtbsc"'::jsonb,
    true
)
WHERE config_key = 'payment_channels'
  AND config_value ? 'providers'
  AND (config_value->'providers') ? 'nowpayments';
