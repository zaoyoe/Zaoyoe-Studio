-- Add adapter-facing ingest token placeholders to existing marketplace channel configs.
-- The secret value itself still lives in admin_secret_store under marketplace__<channel>__<account>__ingest_token.

UPDATE public.system_config
SET
    config_value = jsonb_set(
        config_value,
        '{channels}',
        COALESCE((
            SELECT jsonb_agg(
                CASE
                    WHEN channel_item->>'key' = 'xianyu' THEN
                        jsonb_set(
                            channel_item,
                            '{accounts}',
                            COALESCE((
                                SELECT jsonb_agg(
                                    CASE
                                        WHEN jsonb_typeof(account_item->'secret_names') = 'array'
                                             AND NOT (account_item->'secret_names' ? 'ingest_token')
                                            THEN jsonb_set(
                                                account_item,
                                                '{secret_names}',
                                                (account_item->'secret_names') || '["ingest_token"]'::jsonb
                                            )
                                        WHEN COALESCE(jsonb_typeof(account_item->'secret_names'), '') <> 'array'
                                            THEN jsonb_set(
                                                account_item,
                                                '{secret_names}',
                                                '["ingest_token"]'::jsonb
                                            )
                                        ELSE account_item
                                    END
                                    ORDER BY account_ordinality
                                )
                                FROM jsonb_array_elements(
                                    CASE
                                        WHEN jsonb_typeof(channel_item->'accounts') = 'array' THEN channel_item->'accounts'
                                        ELSE '[]'::jsonb
                                    END
                                )
                                    WITH ORDINALITY AS account_entries(account_item, account_ordinality)
                            ), '[]'::jsonb)
                        )
                    ELSE channel_item
                END
                ORDER BY channel_ordinality
            )
            FROM jsonb_array_elements(
                CASE
                    WHEN jsonb_typeof(config_value->'channels') = 'array' THEN config_value->'channels'
                    ELSE '[]'::jsonb
                END
            )
                WITH ORDINALITY AS channel_entries(channel_item, channel_ordinality)
        ), '[]'::jsonb),
        true
    ),
    updated_at = NOW()
WHERE config_key = 'marketplace_channels'
  AND jsonb_typeof(config_value) = 'object';
