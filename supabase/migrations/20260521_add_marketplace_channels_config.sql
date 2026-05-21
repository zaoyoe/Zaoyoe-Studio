INSERT INTO public.system_config (config_key, config_value, description) VALUES
('marketplace_channels', '{
    "enabled": true,
    "default_channel_key": "website",
    "inventory_mode": "shared",
    "channels": [
        {
            "key": "website",
            "type": "website",
            "label": "网站",
            "enabled": true,
            "inventory_mode": "shared",
            "delivery_mode": "manual",
            "source_channel": "website",
            "default_account_key": "",
            "multi_account": false,
            "notes": "",
            "accounts": []
        },
        {
            "key": "xianyu",
            "type": "xianyu",
            "label": "闲鱼",
            "enabled": false,
            "inventory_mode": "shared",
            "delivery_mode": "auto",
            "source_channel": "xianyu",
            "default_account_key": "main",
            "multi_account": true,
            "notes": "闲鱼多账号与网站共享同一库存。",
            "accounts": [
                {
                    "key": "main",
                    "label": "主号",
                    "enabled": true,
                    "role": "primary",
                    "notes": "",
                    "secret_names": [
                        "session_cookie",
                        "refresh_token",
                        "ingest_token"
                    ]
                }
            ]
        }
    ]
}'::jsonb, '商城渠道注册表')
ON CONFLICT (config_key) DO NOTHING;
