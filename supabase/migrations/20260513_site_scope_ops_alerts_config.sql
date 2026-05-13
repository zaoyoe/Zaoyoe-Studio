BEGIN;

UPDATE public.system_config
SET
    config_value = jsonb_build_object(
        '__site_scoped', true,
        'default', config_value,
        'sites', '{}'::jsonb
    ),
    updated_at = NOW()
WHERE config_key = 'ops_alerts'
AND NOT (COALESCE(config_value, '{}'::jsonb) ? '__site_scoped');

COMMIT;
