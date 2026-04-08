-- Canonicalize the frontend traffic runtime system_config key while preserving
-- the legacy experiment_runtime row for old clients that may still read it.

WITH latest_runtime_source AS (
    SELECT
        sc.config_value,
        sc.updated_by,
        sc.updated_at
    FROM public.system_config sc
    WHERE sc.config_key IN ('traffic_runtime', 'experiment_runtime')
    ORDER BY sc.updated_at DESC NULLS LAST, sc.config_key = 'traffic_runtime' DESC
    LIMIT 1
)
INSERT INTO public.system_config (
    config_key,
    config_value,
    description,
    updated_by,
    updated_at
)
SELECT
    'traffic_runtime',
    latest_runtime_source.config_value,
    '前台分流 runtime 开关',
    latest_runtime_source.updated_by,
    latest_runtime_source.updated_at
FROM latest_runtime_source
ON CONFLICT (config_key) DO UPDATE
SET
    config_value = EXCLUDED.config_value,
    description = EXCLUDED.description,
    updated_by = COALESCE(EXCLUDED.updated_by, public.system_config.updated_by),
    updated_at = COALESCE(EXCLUDED.updated_at, public.system_config.updated_at);

WITH latest_runtime_source AS (
    SELECT
        sc.config_value,
        sc.updated_by,
        sc.updated_at
    FROM public.system_config sc
    WHERE sc.config_key IN ('traffic_runtime', 'experiment_runtime')
    ORDER BY sc.updated_at DESC NULLS LAST, sc.config_key = 'traffic_runtime' DESC
    LIMIT 1
)
INSERT INTO public.system_config (
    config_key,
    config_value,
    description,
    updated_by,
    updated_at
)
SELECT
    'experiment_runtime',
    latest_runtime_source.config_value,
    '前台实验 runtime 开关（兼容旧键）',
    latest_runtime_source.updated_by,
    latest_runtime_source.updated_at
FROM latest_runtime_source
ON CONFLICT (config_key) DO UPDATE
SET
    config_value = EXCLUDED.config_value,
    description = EXCLUDED.description,
    updated_by = COALESCE(EXCLUDED.updated_by, public.system_config.updated_by),
    updated_at = COALESCE(EXCLUDED.updated_at, public.system_config.updated_at);
