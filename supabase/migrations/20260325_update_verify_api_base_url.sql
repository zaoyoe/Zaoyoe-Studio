UPDATE public.system_config
SET config_value = jsonb_set(
    COALESCE(config_value, '{}'::jsonb),
    '{verify_api_base_url}',
    to_jsonb('https://a8yx0rez5w.localto.net'::text),
    true
)
WHERE config_key = 'verify_settings'
  AND COALESCE(config_value->>'verify_api_base_url', '') IN (
      '',
      'https://iqless.icu',
      'https://iqless.icu/'
  );
