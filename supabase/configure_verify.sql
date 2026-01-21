-- Run this in Supabase SQL Editor to configure verify service
-- Go to: https://supabase.com/dashboard/project/mmkugdibsaeoevliebzk/sql/new

INSERT INTO system_config (config_key, config_value)
VALUES (
    'verify',
    '{"batch_api_key": "cdk_=_vgb6#kJqYeu-mzD5%@6dQ8vVc4OB@-", "price_per_verify": 2}'::jsonb
)
ON CONFLICT (config_key) 
DO UPDATE SET config_value = EXCLUDED.config_value;

-- Verify it was inserted
SELECT * FROM system_config WHERE config_key = 'verify';
