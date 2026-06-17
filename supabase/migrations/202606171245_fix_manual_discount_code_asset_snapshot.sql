-- Avoid reading an unassigned asset record when a manual discount code is used
-- through SKU-aware purchase wrappers.

DO $$
DECLARE
    v_signature_text TEXT;
    v_signature REGPROCEDURE;
    v_definition TEXT;
BEGIN
    FOREACH v_signature_text IN ARRAY ARRAY[
        'public.fn_purchase_shop_item(uuid,uuid,character varying,integer,character varying,uuid,uuid)',
        'public.fn_purchase_shop_item(uuid,uuid,character varying,integer,character varying,uuid,uuid,uuid)'
    ]
    LOOP
        v_signature := to_regprocedure(v_signature_text);

        IF v_signature IS NULL THEN
            RAISE EXCEPTION '% is missing', v_signature_text;
        END IF;

        SELECT pg_get_functiondef(v_signature)
        INTO v_definition;

        IF v_definition IS NULL THEN
            RAISE EXCEPTION 'failed to load %', v_signature_text;
        END IF;

        IF POSITION('v_asset_source_type' IN v_definition) = 0 THEN
            v_definition := REPLACE(
                v_definition,
                '    v_asset RECORD;' || E'\n'
                    || '    v_result JSONB;',
                '    v_asset RECORD;' || E'\n'
                    || '    v_asset_source_type VARCHAR(32) := NULL;' || E'\n'
                    || '    v_asset_source_channel VARCHAR(80) := NULL;' || E'\n'
                    || '    v_result JSONB;'
            );
        END IF;

        IF POSITION('v_asset_source_type := v_asset.source_type;' IN v_definition) = 0 THEN
            v_definition := REPLACE(
                v_definition,
                '        v_pricing_apply_stage := COALESCE(NULLIF(BTRIM(COALESCE(v_asset.pricing_apply_stage, '''')), ''''), ''order_discount'');',
                '        v_pricing_apply_stage := COALESCE(NULLIF(BTRIM(COALESCE(v_asset.pricing_apply_stage, '''')), ''''), ''order_discount'');' || E'\n'
                    || '        v_asset_source_type := v_asset.source_type;' || E'\n'
                    || '        v_asset_source_channel := v_asset.source_channel;'
            );
        END IF;

        v_definition := REPLACE(
            v_definition,
            '''source_type'', COALESCE(v_asset.source_type, NULL),',
            '''source_type'', v_asset_source_type,'
        );

        v_definition := REPLACE(
            v_definition,
            '''source_channel'', COALESCE(v_asset.source_channel, NULL),',
            '''source_channel'', v_asset_source_channel,'
        );

        v_definition := REPLACE(
            v_definition,
            '''source_type'', COALESCE(v_asset.source_type, ''asset_wallet''),',
            '''source_type'', COALESCE(v_asset_source_type, ''asset_wallet''),'
        );

        v_definition := REPLACE(
            v_definition,
            '''source_channel'', COALESCE(v_asset.source_channel, ''shop_wallet''),',
            '''source_channel'', COALESCE(v_asset_source_channel, ''shop_wallet''),'
        );

        IF POSITION('v_asset_source_type VARCHAR(32) := NULL;' IN v_definition) = 0
            OR POSITION('v_asset_source_channel VARCHAR(80) := NULL;' IN v_definition) = 0
            OR POSITION('v_asset_source_type := v_asset.source_type;' IN v_definition) = 0
            OR POSITION('v_asset_source_channel := v_asset.source_channel;' IN v_definition) = 0
            OR POSITION('''source_type'', v_asset_source_type' IN v_definition) = 0
            OR POSITION('''source_channel'', v_asset_source_channel' IN v_definition) = 0
            OR POSITION('''source_type'', COALESCE(v_asset.source_type, NULL),' IN v_definition) > 0
            OR POSITION('''source_channel'', COALESCE(v_asset.source_channel, NULL),' IN v_definition) > 0
            OR POSITION('''source_type'', COALESCE(v_asset.source_type, ''asset_wallet''),' IN v_definition) > 0
            OR POSITION('''source_channel'', COALESCE(v_asset.source_channel, ''shop_wallet''),' IN v_definition) > 0 THEN
            RAISE EXCEPTION '% manual discount asset snapshot patch verification failed', v_signature_text;
        END IF;

        EXECUTE v_definition;
    END LOOP;
END;
$$;
