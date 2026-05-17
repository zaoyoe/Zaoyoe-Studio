UPDATE public.system_config
SET config_value = jsonb_set(config_value, '{title}', '"邀请函"'::jsonb, true)
WHERE config_key = 'affiliate_poster'
  AND COALESCE(config_value->>'title', '') = '专属邀请函';
