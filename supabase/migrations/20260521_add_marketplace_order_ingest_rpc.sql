-- Marketplace order ingestion for shared shop inventory.
-- External channel adapters create local shop_orders without touching wallet balances.

CREATE OR REPLACE FUNCTION public.fn_create_marketplace_shop_order(
    p_product_id UUID,
    p_quantity INT DEFAULT 1,
    p_source_channel TEXT DEFAULT 'xianyu',
    p_channel_account_key TEXT DEFAULT 'main',
    p_external_order_id TEXT DEFAULT NULL,
    p_external_order_snapshot JSONB DEFAULT '{}'::jsonb,
    p_site VARCHAR DEFAULT 'cn',
    p_user_id UUID DEFAULT NULL,
    p_price_paid NUMERIC DEFAULT NULL,
    p_total_price NUMERIC DEFAULT NULL,
    p_external_buyer_id TEXT DEFAULT NULL,
    p_external_buyer_name TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_now TIMESTAMPTZ := NOW();
    v_source_channel TEXT := LOWER(BTRIM(COALESCE(p_source_channel, 'xianyu')));
    v_channel_account_key TEXT := LOWER(BTRIM(COALESCE(p_channel_account_key, 'main')));
    v_external_order_id TEXT := LEFT(BTRIM(COALESCE(p_external_order_id, '')), 180);
    v_site VARCHAR := LOWER(BTRIM(COALESCE(p_site, 'cn')));
    v_quantity INT := COALESCE(p_quantity, 1);
    v_product RECORD;
    v_delivery_type TEXT;
    v_inventory_ids UUID[];
    v_contents TEXT[];
    v_inventory_primary_id UUID := NULL;
    v_order_id UUID;
    v_task_id UUID := NULL;
    v_unit_price NUMERIC(12,2) := 0;
    v_price_paid NUMERIC(12,2) := 0;
    v_total_price NUMERIC(12,2) := 0;
    v_snapshot JSONB := '{}'::jsonb;
    v_existing_order public.shop_orders%ROWTYPE;
    v_existing_items JSONB := '[]'::jsonb;
    v_existing_content TEXT := '';
BEGIN
    IF p_product_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'product_id is required');
    END IF;

    IF v_quantity < 1 OR v_quantity > 99 THEN
        RETURN jsonb_build_object('success', false, 'message', 'quantity must be between 1 and 99');
    END IF;

    IF v_site NOT IN ('cn', 'intl') THEN
        v_site := 'cn';
    END IF;

    IF v_source_channel !~ '^[a-z0-9_-]{1,80}$' THEN
        RETURN jsonb_build_object('success', false, 'message', 'source_channel is invalid');
    END IF;

    IF v_channel_account_key !~ '^[a-z0-9_-]{1,80}$' THEN
        RETURN jsonb_build_object('success', false, 'message', 'channel_account_key is invalid');
    END IF;

    IF v_external_order_id = '' THEN
        RETURN jsonb_build_object('success', false, 'message', 'external_order_id is required');
    END IF;

    PERFORM pg_advisory_xact_lock(
        hashtext(v_source_channel || ':' || v_channel_account_key),
        hashtext(v_external_order_id)
    );

    SELECT *
    INTO v_existing_order
    FROM public.shop_orders
    WHERE source_channel = v_source_channel
      AND channel_account_key = v_channel_account_key
      AND external_order_id = v_external_order_id
    ORDER BY created_at DESC
    LIMIT 1;

    IF FOUND THEN
        SELECT
            COALESCE(
                jsonb_agg(
                    jsonb_build_object(
                        'inventory_id', soi.inventory_id,
                        'content', i.content,
                        'snapshot_product_name', soi.snapshot_product_name,
                        'price_paid', soi.price_paid
                    )
                    ORDER BY soi.created_at ASC, soi.id ASC
                ) FILTER (WHERE soi.id IS NOT NULL),
                '[]'::jsonb
            ),
            COALESCE(string_agg(COALESCE(i.content, ''), E'\n----\n' ORDER BY soi.created_at ASC, soi.id ASC), '')
        INTO v_existing_items, v_existing_content
        FROM public.shop_order_items soi
        LEFT JOIN public.shop_inventory i ON i.id = soi.inventory_id
        WHERE soi.order_id = v_existing_order.id;

        RETURN jsonb_build_object(
            'success', true,
            'duplicate', true,
            'message', 'marketplace order already exists',
            'data', jsonb_build_object(
                'order_id', v_existing_order.id,
                'product_id', v_existing_order.product_id,
                'product_name', v_existing_order.snapshot_product_name,
                'source_channel', v_existing_order.source_channel,
                'channel_account_key', v_existing_order.channel_account_key,
                'external_order_id', v_existing_order.external_order_id,
                'delivery_status', v_existing_order.delivery_status,
                'delivery_task_id', v_existing_order.delivery_task_id,
                'quantity', v_existing_order.item_count,
                'price_paid', v_existing_order.price_paid,
                'total_price', v_existing_order.total_price,
                'site', v_existing_order.site,
                'content', v_existing_content,
                'items', COALESCE(v_existing_items, '[]'::jsonb)
            )
        );
    END IF;

    SELECT
        id,
        name,
        price_points,
        price_points_intl,
        delivery_type,
        webhook_target,
        is_active
    INTO v_product
    FROM public.shop_products
    WHERE id = p_product_id
      AND is_active = true;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'product not found or inactive');
    END IF;

    v_delivery_type := UPPER(BTRIM(COALESCE(v_product.delivery_type, 'KEY')));
    v_unit_price := CASE
        WHEN v_site = 'intl' THEN COALESCE(v_product.price_points_intl, v_product.price_points, 0)
        ELSE COALESCE(v_product.price_points, 0)
    END;
    v_price_paid := ROUND(COALESCE(p_price_paid, v_unit_price * v_quantity, 0), 2);
    v_total_price := ROUND(COALESCE(p_total_price, v_price_paid, 0), 2);

    v_snapshot := CASE
        WHEN jsonb_typeof(COALESCE(p_external_order_snapshot, '{}'::jsonb)) = 'object' THEN COALESCE(p_external_order_snapshot, '{}'::jsonb)
        ELSE jsonb_build_object('raw', p_external_order_snapshot)
    END;
    v_snapshot := v_snapshot || jsonb_strip_nulls(jsonb_build_object(
        'source_channel', v_source_channel,
        'channel_account_key', v_channel_account_key,
        'external_order_id', v_external_order_id,
        'external_buyer_id', NULLIF(BTRIM(COALESCE(p_external_buyer_id, '')), ''),
        'external_buyer_name', NULLIF(BTRIM(COALESCE(p_external_buyer_name, '')), ''),
        'ingested_at', v_now
    ));

    IF v_delivery_type = 'KEY' THEN
        WITH locked_inventory AS (
            SELECT id, content, created_at
            FROM public.shop_inventory
            WHERE product_id = p_product_id
              AND status = 'available'
            ORDER BY created_at ASC, id ASC
            LIMIT v_quantity
            FOR UPDATE SKIP LOCKED
        )
        SELECT array_agg(id ORDER BY created_at ASC, id ASC), array_agg(content ORDER BY created_at ASC, id ASC)
        INTO v_inventory_ids, v_contents
        FROM locked_inventory;

        IF v_inventory_ids IS NULL OR array_length(v_inventory_ids, 1) < v_quantity THEN
            RETURN jsonb_build_object('success', false, 'message', 'shared inventory is insufficient');
        END IF;

        IF array_length(v_inventory_ids, 1) = 1 THEN
            v_inventory_primary_id := v_inventory_ids[1];
        END IF;
    ELSIF v_delivery_type = 'API' THEN
        IF COALESCE(BTRIM(v_product.webhook_target), '') = '' THEN
            RETURN jsonb_build_object('success', false, 'message', 'API product webhook target is not configured');
        END IF;
        v_contents := ARRAY['API delivery task queued'];
    ELSE
        RETURN jsonb_build_object('success', false, 'message', 'unsupported delivery_type: ' || v_delivery_type);
    END IF;

    INSERT INTO public.shop_orders (
        user_id,
        product_id,
        inventory_id,
        price_paid,
        total_price,
        item_count,
        snapshot_product_name,
        discount_code,
        discount_amount,
        discount_snapshot,
        discount_version,
        discount_usage_restored,
        discount_refund_amount,
        delivery_status,
        delivery_completed_at,
        delivery_updated_at,
        delivery_attempt_count,
        site,
        source_channel,
        channel_account_key,
        external_order_id,
        external_order_snapshot
    )
    VALUES (
        p_user_id,
        p_product_id,
        CASE WHEN v_delivery_type = 'KEY' THEN v_inventory_primary_id ELSE NULL END,
        v_price_paid,
        v_total_price,
        v_quantity,
        v_product.name,
        NULL,
        0,
        NULL,
        NULL,
        false,
        0,
        CASE WHEN v_delivery_type = 'API' THEN 'pending' ELSE 'delivered' END,
        CASE WHEN v_delivery_type = 'API' THEN NULL ELSE v_now END,
        v_now,
        0,
        v_site,
        v_source_channel,
        v_channel_account_key,
        v_external_order_id,
        v_snapshot
    )
    RETURNING id INTO v_order_id;

    IF v_delivery_type = 'KEY' THEN
        UPDATE public.shop_inventory
        SET status = 'sold',
            buyer_id = p_user_id,
            sold_at = v_now
        WHERE id = ANY(v_inventory_ids);

        INSERT INTO public.shop_order_items (order_id, inventory_id, snapshot_product_name, price_paid)
        SELECT v_order_id, unnest(v_inventory_ids), v_product.name, ROUND(v_price_paid / v_quantity, 2);
    ELSE
        INSERT INTO public.shop_webhook_tasks (
            order_id,
            target_url,
            payload,
            status,
            attempt_count,
            max_attempts,
            next_attempt_at,
            dedupe_key
        )
        VALUES (
            v_order_id,
            v_product.webhook_target,
            jsonb_build_object(
                'order_id', v_order_id,
                'product_id', p_product_id,
                'quantity', v_quantity,
                'site', v_site,
                'source_channel', v_source_channel,
                'channel_account_key', v_channel_account_key,
                'external_order_id', v_external_order_id,
                'external_order_snapshot', v_snapshot,
                'marketplace', jsonb_build_object(
                    'source_channel', v_source_channel,
                    'channel_account_key', v_channel_account_key,
                    'external_order_id', v_external_order_id,
                    'external_buyer_id', NULLIF(BTRIM(COALESCE(p_external_buyer_id, '')), ''),
                    'external_buyer_name', NULLIF(BTRIM(COALESCE(p_external_buyer_name, '')), '')
                )
            ),
            'pending',
            0,
            5,
            v_now,
            'marketplace_delivery:' || v_source_channel || ':' || v_channel_account_key || ':' || v_external_order_id
        )
        RETURNING id INTO v_task_id;

        INSERT INTO public.shop_order_items (order_id, inventory_id, snapshot_product_name, price_paid)
        VALUES (v_order_id, NULL, v_product.name || ' [API]', v_price_paid);

        UPDATE public.shop_orders
        SET delivery_task_id = v_task_id
        WHERE id = v_order_id;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'duplicate', false,
        'message', 'marketplace order created',
        'data', jsonb_build_object(
            'order_id', v_order_id,
            'product_id', p_product_id,
            'product_name', v_product.name,
            'source_channel', v_source_channel,
            'channel_account_key', v_channel_account_key,
            'external_order_id', v_external_order_id,
            'delivery_status', CASE WHEN v_delivery_type = 'API' THEN 'pending' ELSE 'delivered' END,
            'delivery_task_id', v_task_id,
            'quantity', v_quantity,
            'price_paid', v_price_paid,
            'total_price', v_total_price,
            'site', v_site,
            'content', array_to_string(v_contents, E'\n----\n'),
            'items', CASE
                WHEN v_delivery_type = 'KEY' THEN (
                    SELECT COALESCE(
                        jsonb_agg(
                            jsonb_build_object(
                                'inventory_id', inventory_id,
                                'content', content
                            )
                            ORDER BY item_index
                        ),
                        '[]'::jsonb
                    )
                    FROM unnest(v_inventory_ids, v_contents) WITH ORDINALITY AS item(inventory_id, content, item_index)
                )
                ELSE '[]'::jsonb
            END,
            'external_order_snapshot', v_snapshot
        )
    );
EXCEPTION
    WHEN unique_violation THEN
        SELECT *
        INTO v_existing_order
        FROM public.shop_orders
        WHERE source_channel = v_source_channel
          AND channel_account_key = v_channel_account_key
          AND external_order_id = v_external_order_id
        ORDER BY created_at DESC
        LIMIT 1;

        IF FOUND THEN
            RETURN jsonb_build_object(
                'success', true,
                'duplicate', true,
                'message', 'marketplace order already exists',
                'data', jsonb_build_object(
                    'order_id', v_existing_order.id,
                    'product_id', v_existing_order.product_id,
                    'product_name', v_existing_order.snapshot_product_name,
                    'source_channel', v_existing_order.source_channel,
                    'channel_account_key', v_existing_order.channel_account_key,
                    'external_order_id', v_existing_order.external_order_id,
                    'delivery_status', v_existing_order.delivery_status,
                    'delivery_task_id', v_existing_order.delivery_task_id,
                    'quantity', v_existing_order.item_count,
                    'price_paid', v_existing_order.price_paid,
                    'total_price', v_existing_order.total_price,
                    'site', v_existing_order.site,
                    'content', '',
                    'items', '[]'::jsonb
                )
            );
        END IF;

        RETURN jsonb_build_object('success', false, 'message', 'marketplace order duplicate conflict');
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'message', 'marketplace order create failed: ' || SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_create_marketplace_shop_order(
    UUID, INT, TEXT, TEXT, TEXT, JSONB, VARCHAR, UUID, NUMERIC, NUMERIC, TEXT, TEXT
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_create_marketplace_shop_order(
    UUID, INT, TEXT, TEXT, TEXT, JSONB, VARCHAR, UUID, NUMERIC, NUMERIC, TEXT, TEXT
) FROM anon;
REVOKE ALL ON FUNCTION public.fn_create_marketplace_shop_order(
    UUID, INT, TEXT, TEXT, TEXT, JSONB, VARCHAR, UUID, NUMERIC, NUMERIC, TEXT, TEXT
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_create_marketplace_shop_order(
    UUID, INT, TEXT, TEXT, TEXT, JSONB, VARCHAR, UUID, NUMERIC, NUMERIC, TEXT, TEXT
) TO service_role;
