-- Run this in Supabase SQL Editor to configure the Google One verify service
-- Go to: https://supabase.com/dashboard/project/mmkugdibsaeoevliebzk/sql/new

INSERT INTO system_config (config_key, config_value)
VALUES (
    'verify_settings',
    '{
        "price_per_verify": 10,
        "enabled": true,
        "verify_api_key": "ak_REPLACE_WITH_YOUR_API_KEY",
        "verify_api_base_url": "https://iqless.icu"
    }'::jsonb
)
ON CONFLICT (config_key) 
DO UPDATE SET config_value = EXCLUDED.config_value;

-- Verify it was inserted
SELECT * FROM system_config WHERE config_key = 'verify_settings';
