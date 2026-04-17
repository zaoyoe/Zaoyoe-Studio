-- ============================================
-- Multi-discount stacking support for shop purchases
-- - adds a dedicated purchase RPC for stacked discount selections
-- - restores every applied discount / asset during admin refunds
-- ============================================

DROP FUNCTION IF EXISTS public.fn_purchase_shop_item_with_discounts(UUID, UUID, VARCHAR, INT, JSONB, UUID);

CREATE OR REPLACE FUNCTION public.fn_purchase_shop_item_with_discounts(
    p_product_id UUID,
    p_user_id UUID,
    p_site VARCHAR,
    p_quantity INT,
    p_discount_inputs JSONB DEFAULT '[]'::JSONB,
    p_agent_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_request_user_id UUID := auth.uid();
    v_request_role TEXT := COALESCE(auth.role(), '');
    v_effective_user_id UUID;
    v_discount_inputs JSONB := CASE
        WHEN jsonb_typeof(COALESCE(p_discount_inputs, '[]'::JSONB)) = 'array'
            THEN COALESCE(p_discount_inputs, '[]'::JSONB)
        ELSE '[]'::JSONB
    END;
    v_discount_input JSONB;
    v_preview_result JSONB := '{}'::JSONB;
    v_preview_data JSONB := '{}'::JSONB;
    v_discount_row RECORD;
    v_asset_row RECORD;
    v_discount_entries JSONB := '[]'::JSONB;
    v_applied_discounts JSONB := '[]'::JSONB;
    v_effective_discount_code VARCHAR;
    v_effective_discount_asset_id UUID;
    v_discount_count INT := 0;
    v_existing_discount_codes TEXT[] := ARRAY[]::TEXT[];
    v_existing_discount_asset_ids UUID[] := ARRAY[]::UUID[];
    v_has_exclusive_discount BOOLEAN := FALSE;
    v_subtotal NUMERIC(12,2) := 0;
    v_unit_price NUMERIC(12,2) := 0;
    v_running_total NUMERIC(12,2) := 0;
    v_discount_amount NUMERIC(12,2) := 0;
    v_discounted_total NUMERIC(12,2) := 0;
    v_has_effective_discount BOOLEAN := FALSE;
    v_total_discount_amount NUMERIC(12,2) := 0;
    v_discount_version INT := 1;
    v_topup_amount NUMERIC(12,2) := 0;
    v_purchase_result JSONB := '{}'::JSONB;
    v_purchase_data JSONB := '{}'::JSONB;
    v_order_id UUID;
    v_product_name VARCHAR;
    v_discount_codes TEXT[];
    v_discount_code_display VARCHAR;
    v_discount_entry JSONB;
    v_event_discount_id UUID;
    v_event_discount_asset_id UUID;
    v_event_audience_segment VARCHAR(80);
    v_event_source_channel VARCHAR(80);
    v_response_data JSONB := '{}'::JSONB;
BEGIN
    IF v_request_role = 'service_role' THEN
        v_effective_user_id := COALESCE(p_user_id, v_request_user_id);
    ELSE
        IF v_request_user_id IS NULL THEN
            RETURN jsonb_build_object('success', false, 'message', '请先登录');
        END IF;

        IF p_user_id IS DISTINCT FROM v_request_user_id THEN
            RETURN jsonb_build_object('success', false, 'message', '非法的用户上下文');
        END IF;

        v_effective_user_id := v_request_user_id;
    END IF;

    IF v_effective_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '缺少有效的用户身份');
    END IF;

    IF jsonb_array_length(v_discount_inputs) = 0 THEN
        RETURN jsonb_build_object('success', false, 'message', '请至少选择一张卡券');
    END IF;

    FOR v_discount_input IN
        SELECT value
        FROM jsonb_array_elements(v_discount_inputs)
    LOOP
        v_discount_count := v_discount_count + 1;
        IF v_discount_count > 8 THEN
            RETURN jsonb_build_object('success', false, 'message', '单次最多叠加 8 张卡券');
        END IF;

        v_effective_discount_code := NULLIF(UPPER(BTRIM(COALESCE(
            v_discount_input ->> 'discount_code',
            v_discount_input ->> 'code',
            ''
        ))), '');

        v_effective_discount_asset_id := CASE
            WHEN NULLIF(BTRIM(COALESCE(
                v_discount_input ->> 'discount_asset_id',
                v_discount_input ->> 'asset_id',
                ''
            )), '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
                THEN NULLIF(BTRIM(COALESCE(
                    v_discount_input ->> 'discount_asset_id',
                    v_discount_input ->> 'asset_id',
                    ''
                )), '')::UUID
            ELSE NULL
        END;

        IF v_effective_discount_code IS NULL AND v_effective_discount_asset_id IS NULL THEN
            RETURN jsonb_build_object('success', false, 'message', '卡券选择格式不正确');
        END IF;

        IF v_effective_discount_code IS NOT NULL AND v_effective_discount_code = ANY(v_existing_discount_codes) THEN
            RETURN jsonb_build_object('success', false, 'message', '同一张优惠券不能重复叠加');
        END IF;

        IF v_effective_discount_asset_id IS NOT NULL AND v_effective_discount_asset_id = ANY(v_existing_discount_asset_ids) THEN
            RETURN jsonb_build_object('success', false, 'message', '同一张到账卡券不能重复选择');
        END IF;

        v_preview_result := public.fn_validate_discount_code(
            p_product_id,
            v_effective_user_id,
            p_site,
            p_quantity,
            v_effective_discount_code,
            v_effective_discount_asset_id,
            p_agent_id
        );

        IF COALESCE((v_preview_result ->> 'success')::BOOLEAN, false) IS NOT TRUE THEN
            RETURN v_preview_result;
        END IF;

        v_preview_data := COALESCE(v_preview_result -> 'data', '{}'::JSONB);

        SELECT
            d.id,
            d.code,
            d.allow_zero_total,
            COALESCE(d.version_no, 1) AS version_no,
            COALESCE(d.is_exclusive, true) AS is_exclusive,
            GREATEST(1, COALESCE(d.stack_priority, 100)) AS stack_priority,
            COALESCE(NULLIF(BTRIM(COALESCE(d.pricing_apply_stage, '')), ''), 'order_discount') AS pricing_apply_stage,
            COALESCE(NULLIF(BTRIM(COALESCE(d.distribution_mode, '')), ''), 'general_code') AS distribution_mode,
            d.campaign_tag,
            d.audience_segment
        INTO v_discount_row
        FROM public.discount_codes d
        WHERE d.id = NULLIF(v_preview_data ->> 'discount_id', '')::UUID
        LIMIT 1;

        IF NOT FOUND THEN
            RETURN jsonb_build_object('success', false, 'message', '优惠券规则不存在或已失效');
        END IF;

        v_existing_discount_codes := array_append(v_existing_discount_codes, v_discount_row.code);
        IF v_effective_discount_asset_id IS NOT NULL THEN
            v_existing_discount_asset_ids := array_append(v_existing_discount_asset_ids, v_effective_discount_asset_id);
        END IF;

        IF COALESCE(v_discount_row.is_exclusive, true) THEN
            v_has_exclusive_discount := TRUE;
        END IF;

        IF v_effective_discount_asset_id IS NOT NULL THEN
            SELECT
                a.discount_id,
                a.source_type,
                a.source_channel,
                COALESCE(NULLIF(BTRIM(a.audience_segment), ''), NULLIF(BTRIM(v_discount_row.audience_segment), ''), 'all_users') AS audience_segment
            INTO v_asset_row
            FROM public.discount_user_assets a
            WHERE a.id = v_effective_discount_asset_id;
        ELSE
            v_asset_row := NULL;
        END IF;

        v_discount_entries := v_discount_entries || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
            'discount_id', v_discount_row.id,
            'code', v_discount_row.code,
            'discount_code', v_discount_row.code,
            'discount_asset_id', v_effective_discount_asset_id,
            'asset_id', v_effective_discount_asset_id,
            'discount_type', v_preview_data ->> 'discount_type',
            'discount_value', (v_preview_data ->> 'discount_value')::NUMERIC(12,2),
            'unit_price', (v_preview_data ->> 'unit_price')::NUMERIC(12,2),
            'subtotal', (v_preview_data ->> 'subtotal')::NUMERIC(12,2),
            'allow_zero_total', COALESCE(v_discount_row.allow_zero_total, false),
            'discount_version', COALESCE(v_discount_row.version_no, 1),
            'distribution_mode', COALESCE(v_preview_data ->> 'distribution_mode', v_discount_row.distribution_mode),
            'campaign_tag', COALESCE(v_preview_data ->> 'campaign_tag', v_discount_row.campaign_tag),
            'audience_segment', COALESCE(v_asset_row.audience_segment, v_preview_data ->> 'audience_segment', v_discount_row.audience_segment),
            'is_exclusive', COALESCE((v_preview_data ->> 'is_exclusive')::BOOLEAN, v_discount_row.is_exclusive, true),
            'stack_priority', GREATEST(1, COALESCE((v_preview_data ->> 'stack_priority')::INT, v_discount_row.stack_priority, 100)),
            'pricing_apply_stage', COALESCE(NULLIF(BTRIM(COALESCE(v_preview_data ->> 'pricing_apply_stage', v_discount_row.pricing_apply_stage)), ''), 'order_discount'),
            'source_type', v_asset_row.source_type,
            'source_channel', v_asset_row.source_channel
        )));

        IF v_subtotal = 0 THEN
            v_subtotal := ROUND(COALESCE((v_preview_data ->> 'subtotal')::NUMERIC, 0), 2);
            v_unit_price := ROUND(COALESCE((v_preview_data ->> 'unit_price')::NUMERIC, 0), 2);
        END IF;
    END LOOP;

    IF v_has_exclusive_discount AND jsonb_array_length(v_discount_entries) > 1 THEN
        RETURN jsonb_build_object('success', false, 'message', '排他券不能与其他卡券叠加');
    END IF;

    v_running_total := v_subtotal;

    FOR v_discount_entry IN
        SELECT value
        FROM jsonb_array_elements(v_discount_entries)
        ORDER BY
            CASE COALESCE(value ->> 'pricing_apply_stage', 'order_discount')
                WHEN 'catalog_price' THEN 0
                WHEN 'order_discount' THEN 1
                WHEN 'balance_offset' THEN 2
                ELSE 99
            END,
            GREATEST(1, COALESCE((value ->> 'stack_priority')::INT, 100)),
            COALESCE(value ->> 'code', value ->> 'discount_code', '')
    LOOP
        IF COALESCE(v_discount_entry ->> 'discount_type', '') = 'percent' THEN
            SELECT
                resolved.discount_amount,
                resolved.final_total,
                resolved.has_effective_discount
            INTO
                v_discount_amount,
                v_discounted_total,
                v_has_effective_discount
            FROM public.fn_resolve_shop_percent_discount(
                v_running_total,
                COALESCE((v_discount_entry ->> 'discount_value')::INT, 0),
                COALESCE((v_discount_entry ->> 'allow_zero_total')::BOOLEAN, false)
            ) AS resolved;
        ELSIF COALESCE(v_discount_entry ->> 'discount_type', '') = 'fixed' THEN
            v_discount_amount := LEAST(v_running_total, COALESCE((v_discount_entry ->> 'discount_value')::NUMERIC(12,2), 0));
            v_discounted_total := ROUND(GREATEST(0, v_running_total - v_discount_amount), 2);
            v_has_effective_discount := v_discount_amount > 0;

            IF v_discounted_total = 0
                AND v_discount_amount > 0
                AND NOT COALESCE((v_discount_entry ->> 'allow_zero_total')::BOOLEAN, false) THEN
                v_has_effective_discount := FALSE;
            END IF;
        ELSE
            v_discount_amount := 0;
            v_discounted_total := v_running_total;
            v_has_effective_discount := FALSE;
        END IF;

        IF NOT v_has_effective_discount THEN
            IF v_discounted_total = 0
                AND v_discount_amount > 0
                AND NOT COALESCE((v_discount_entry ->> 'allow_zero_total')::BOOLEAN, false) THEN
                RETURN jsonb_build_object('success', false, 'message', '所选卡券中存在不允许全额抵扣的优惠券');
            END IF;

            RETURN jsonb_build_object(
                'success', false,
                'message', '优惠券 ' || COALESCE(v_discount_entry ->> 'code', v_discount_entry ->> 'discount_code', '当前券') || ' 在当前组合下暂无可优惠金额'
            );
        END IF;

        v_total_discount_amount := ROUND(v_total_discount_amount + COALESCE(v_discount_amount, 0), 2);
        v_running_total := ROUND(GREATEST(0, COALESCE(v_discounted_total, v_running_total)), 2);

        v_applied_discounts := v_applied_discounts || jsonb_build_array(
            v_discount_entry || jsonb_build_object(
                'discount_amount', v_discount_amount,
                'final_total_after_apply', v_running_total
            )
        );
    END LOOP;

    v_discount_codes := ARRAY(
        SELECT COALESCE(value ->> 'code', value ->> 'discount_code')
        FROM jsonb_array_elements(v_applied_discounts)
        WHERE NULLIF(BTRIM(COALESCE(value ->> 'code', value ->> 'discount_code', '')), '') IS NOT NULL
    );
    v_discount_code_display := LEFT(COALESCE(array_to_string(v_discount_codes, ' + '), ''), 255);
    v_discount_version := COALESCE(
        (SELECT COALESCE((value ->> 'discount_version')::INT, 1)
         FROM jsonb_array_elements(v_applied_discounts)
         ORDER BY COALESCE((value ->> 'discount_version')::INT, 1) DESC
         LIMIT 1),
        1
    );

    v_topup_amount := ROUND(GREATEST(COALESCE(v_total_discount_amount, 0), 0), 2);
    IF v_topup_amount > 0 THEN
        INSERT INTO public.points_balance (user_id, site, paid_balance, bonus_balance)
        VALUES (v_effective_user_id, COALESCE(NULLIF(BTRIM(COALESCE(p_site, '')), ''), 'cn'), v_topup_amount, 0)
        ON CONFLICT (user_id, site) DO UPDATE
        SET paid_balance = ROUND(COALESCE(points_balance.paid_balance, 0) + EXCLUDED.paid_balance, 2),
            updated_at = NOW();
    END IF;

    v_purchase_result := public.fn_purchase_shop_item(
        p_product_id,
        v_effective_user_id,
        p_site,
        p_quantity,
        NULL,
        p_agent_id
    );

    IF COALESCE((v_purchase_result ->> 'success')::BOOLEAN, false) IS NOT TRUE THEN
        IF v_topup_amount > 0 THEN
            UPDATE public.points_balance
            SET paid_balance = ROUND(GREATEST(0, COALESCE(paid_balance, 0) - v_topup_amount), 2),
                updated_at = NOW()
            WHERE user_id = v_effective_user_id
              AND site = COALESCE(NULLIF(BTRIM(COALESCE(p_site, '')), ''), 'cn');
        END IF;

        RETURN v_purchase_result;
    END IF;

    v_purchase_data := COALESCE(v_purchase_result -> 'data', '{}'::JSONB);
    v_order_id := NULLIF(v_purchase_data ->> 'order_id', '')::UUID;
    v_product_name := COALESCE(NULLIF(BTRIM(COALESCE(v_purchase_data ->> 'product_name', '')), ''), '未知商品');

    IF v_order_id IS NULL THEN
        IF v_topup_amount > 0 THEN
            UPDATE public.points_balance
            SET paid_balance = ROUND(GREATEST(0, COALESCE(paid_balance, 0) - v_topup_amount), 2),
                updated_at = NOW()
            WHERE user_id = v_effective_user_id
              AND site = COALESCE(NULLIF(BTRIM(COALESCE(p_site, '')), ''), 'cn');
        END IF;

        RETURN jsonb_build_object('success', false, 'message', '多券购买未返回有效订单号');
    END IF;

    IF v_topup_amount > 0 THEN
        INSERT INTO public.points_ledger (user_id, amount, reason, reference_id, site)
        VALUES (
            v_effective_user_id,
            v_topup_amount,
            '商城多券叠加抵扣: ' || v_product_name,
            'SHOP_STACK_DISCOUNT_' || v_order_id::TEXT,
            COALESCE(NULLIF(BTRIM(COALESCE(p_site, '')), ''), 'cn')
        );
    END IF;

    UPDATE public.discount_codes
    SET used_count = used_count + 1
    WHERE code = ANY(v_discount_codes);

    UPDATE public.shop_orders
    SET price_paid = v_running_total,
        discount_code = NULLIF(v_discount_code_display, ''),
        discount_amount = v_total_discount_amount,
        discount_snapshot = jsonb_strip_nulls(jsonb_build_object(
            'stacking_mode', 'multi_discount',
            'discount_codes', v_discount_codes,
            'selected_count', jsonb_array_length(v_applied_discounts),
            'applied_discounts', v_applied_discounts,
            'unit_price', v_unit_price,
            'subtotal', v_subtotal,
            'discount_amount', v_total_discount_amount,
            'final_total', v_running_total,
            'site', COALESCE(NULLIF(BTRIM(COALESCE(p_site, '')), ''), 'cn'),
            'quantity', p_quantity
        )),
        discount_version = v_discount_version,
        discount_usage_restored = false,
        discount_refund_amount = 0,
        discount_asset_id = NULL,
        discount_asset_restored = false
    WHERE id = v_order_id;

    FOR v_discount_entry IN
        SELECT value
        FROM jsonb_array_elements(v_applied_discounts)
        WHERE NULLIF(BTRIM(COALESCE(value ->> 'asset_id', value ->> 'discount_asset_id', '')), '') IS NOT NULL
    LOOP
        v_event_discount_asset_id := NULLIF(BTRIM(COALESCE(
            v_discount_entry ->> 'asset_id',
            v_discount_entry ->> 'discount_asset_id',
            ''
        )), '')::UUID;
        v_event_discount_id := NULLIF(BTRIM(COALESCE(v_discount_entry ->> 'discount_id', '')), '')::UUID;
        v_event_source_channel := COALESCE(NULLIF(BTRIM(COALESCE(v_discount_entry ->> 'source_channel', '')), ''), 'shop_wallet');
        v_event_audience_segment := COALESCE(NULLIF(BTRIM(COALESCE(v_discount_entry ->> 'audience_segment', '')), ''), 'all_users');

        UPDATE public.discount_user_assets
        SET asset_status = 'used',
            consumed_at = COALESCE(consumed_at, NOW()),
            restored_at = NULL,
            last_order_id = v_order_id,
            updated_at = NOW()
        WHERE id = v_event_discount_asset_id;

        BEGIN
            INSERT INTO public.discount_event_logs (
                discount_id,
                user_id,
                discount_asset_id,
                order_id,
                event_type,
                site,
                source_channel,
                event_source,
                audience_segment,
                created_at
            )
            VALUES (
                v_event_discount_id,
                v_effective_user_id,
                v_event_discount_asset_id,
                v_order_id,
                'redeem',
                COALESCE(NULLIF(BTRIM(COALESCE(p_site, '')), ''), 'cn'),
                v_event_source_channel,
                'shop_purchase',
                v_event_audience_segment,
                NOW()
            );
        EXCEPTION WHEN undefined_table OR undefined_column THEN
            NULL;
        END;
    END LOOP;

    v_response_data := v_purchase_data || jsonb_build_object(
        'discount_code', NULLIF(v_discount_code_display, ''),
        'discount_codes', v_discount_codes,
        'discount_amount', v_total_discount_amount,
        'final_total', v_running_total,
        'price_paid', v_running_total,
        'subtotal', v_subtotal,
        'unit_price', v_unit_price,
        'discount_version', v_discount_version,
        'applied_discounts', v_applied_discounts
    );

    RETURN jsonb_build_object(
        'success', true,
        'message', COALESCE(v_purchase_result ->> 'message', '购买成功'),
        'data', v_response_data
    );
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'message', '多券交易失败: ' || SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_purchase_shop_item_with_discounts(UUID, UUID, VARCHAR, INT, JSONB, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_purchase_shop_item_with_discounts(UUID, UUID, VARCHAR, INT, JSONB, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_purchase_shop_item_with_discounts(UUID, UUID, VARCHAR, INT, JSONB, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_purchase_shop_item_with_discounts(UUID, UUID, VARCHAR, INT, JSONB, UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_admin_refund_order(
    p_order_id UUID,
    p_admin_id UUID,
    p_target_status VARCHAR DEFAULT 'frozen',
    p_remark TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order RECORD;
    v_status_map JSONB := '{"available":"在售","frozen":"冻结","fault":"故障","reserve":"保留"}'::JSONB;
    v_site VARCHAR(10);
    v_refund_reference TEXT;
    v_refund_reason TEXT;
    v_refund_amount NUMERIC(12,2);
    v_recharge_result JSONB := '{}'::JSONB;
    v_inventory_ids UUID[];
    v_stock_count INT := 0;
    v_discount_usage_restored BOOLEAN := FALSE;
    v_discount_assets_restored BOOLEAN := FALSE;
    v_applied_discounts JSONB := '[]'::JSONB;
    v_discount_entry JSONB;
    v_discount_code VARCHAR;
    v_discount_asset_id UUID;
    v_asset RECORD;
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    IF p_order_id IS NULL THEN
        RAISE EXCEPTION 'p_order_id is required';
    END IF;

    IF p_admin_id IS NULL THEN
        RAISE EXCEPTION 'p_admin_id is required';
    END IF;

    IF NOT (v_status_map ? COALESCE(p_target_status, '')) THEN
        RETURN jsonb_build_object('success', false, 'message', '无效的目标状态');
    END IF;

    SELECT
        o.id,
        o.user_id,
        o.product_id,
        o.inventory_id,
        o.price_paid,
        o.total_price,
        o.snapshot_product_name,
        o.refund_status,
        o.delivery_status,
        o.delivery_completed_at,
        o.site,
        o.discount_code,
        o.discount_amount,
        o.discount_usage_restored,
        o.discount_asset_restored,
        o.discount_snapshot
    INTO v_order
    FROM public.shop_orders o
    WHERE o.id = p_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', '订单不存在');
    END IF;

    v_site := COALESCE(NULLIF(BTRIM(v_order.site), ''), 'cn');
    v_refund_reference := 'REFUND_' || p_order_id::TEXT;
    v_refund_amount := ROUND(GREATEST(COALESCE(v_order.price_paid, 0), 0), 2);

    IF COALESCE(v_order.refund_status, 'none') IN ('refunded', 'full_refund') THEN
        RETURN jsonb_build_object(
            'success', true,
            'duplicate', true,
            'site', v_site,
            'message', '该订单已退款'
        );
    END IF;

    IF COALESCE(jsonb_typeof(v_order.discount_snapshot -> 'applied_discounts'), '') = 'array' THEN
        v_applied_discounts := COALESCE(v_order.discount_snapshot -> 'applied_discounts', '[]'::JSONB);
    END IF;

    IF v_refund_amount > 0 THEN
        v_refund_reason := '订单退款: ' || COALESCE(NULLIF(BTRIM(v_order.snapshot_product_name), ''), '未知商品');

        SELECT public.fn_recharge_points(
            v_order.user_id,
            v_refund_amount,
            0,
            v_refund_reason,
            v_refund_reference,
            v_site
        )
        INTO v_recharge_result;

        IF COALESCE((v_recharge_result ->> 'success')::BOOLEAN, false) IS NOT TRUE THEN
            RETURN jsonb_build_object(
                'success', false,
                'message', COALESCE(v_recharge_result ->> 'message', '退款积分返还失败'),
                'site', v_site
            );
        END IF;
    END IF;

    IF jsonb_array_length(v_applied_discounts) > 0 THEN
        IF COALESCE(v_order.discount_usage_restored, false) = false THEN
            FOR v_discount_entry IN
                SELECT value
                FROM jsonb_array_elements(v_applied_discounts)
            LOOP
                v_discount_code := NULLIF(UPPER(BTRIM(COALESCE(
                    v_discount_entry ->> 'code',
                    v_discount_entry ->> 'discount_code',
                    ''
                ))), '');

                IF v_discount_code IS NULL OR GREATEST(COALESCE((v_discount_entry ->> 'discount_amount')::NUMERIC, 0), 0) <= 0 THEN
                    CONTINUE;
                END IF;

                UPDATE public.discount_codes
                SET used_count = GREATEST(0, COALESCE(used_count, 0) - 1)
                WHERE code = v_discount_code;

                IF FOUND THEN
                    v_discount_usage_restored := TRUE;
                END IF;
            END LOOP;
        END IF;

        IF COALESCE(v_order.discount_asset_restored, false) = false THEN
            FOR v_discount_entry IN
                SELECT value
                FROM jsonb_array_elements(v_applied_discounts)
                WHERE NULLIF(BTRIM(COALESCE(value ->> 'asset_id', value ->> 'discount_asset_id', '')), '') IS NOT NULL
            LOOP
                v_discount_asset_id := NULLIF(BTRIM(COALESCE(
                    v_discount_entry ->> 'asset_id',
                    v_discount_entry ->> 'discount_asset_id',
                    ''
                )), '')::UUID;

                SELECT
                    a.id,
                    a.discount_id,
                    COALESCE(NULLIF(BTRIM(a.source_channel), ''), 'shop_wallet') AS source_channel,
                    COALESCE(NULLIF(BTRIM(a.audience_segment), ''), NULLIF(BTRIM(d.audience_segment), ''), 'all_users') AS audience_segment
                INTO v_asset
                FROM public.discount_user_assets a
                JOIN public.discount_codes d
                    ON d.id = a.discount_id
                WHERE a.id = v_discount_asset_id;

                IF NOT FOUND THEN
                    CONTINUE;
                END IF;

                UPDATE public.discount_user_assets
                SET asset_status = 'available',
                    restored_at = NOW(),
                    consumed_at = NULL,
                    last_order_id = NULL,
                    updated_at = NOW()
                WHERE id = v_asset.id;

                IF FOUND THEN
                    v_discount_assets_restored := TRUE;
                END IF;

                BEGIN
                    INSERT INTO public.discount_event_logs (
                        discount_id,
                        user_id,
                        discount_asset_id,
                        order_id,
                        event_type,
                        site,
                        source_channel,
                        event_source,
                        audience_segment,
                        created_at
                    )
                    VALUES (
                        v_asset.discount_id,
                        v_order.user_id,
                        v_asset.id,
                        v_order.id,
                        'refund_restore',
                        v_site,
                        v_asset.source_channel,
                        'shop_refund_restore',
                        v_asset.audience_segment,
                        NOW()
                    );
                EXCEPTION WHEN undefined_table OR undefined_column THEN
                    NULL;
                END;
            END LOOP;
        END IF;
    ELSIF NULLIF(BTRIM(COALESCE(v_order.discount_code, '')), '') IS NOT NULL
        AND COALESCE(v_order.discount_amount, 0) > 0
        AND COALESCE(v_order.discount_usage_restored, false) = false THEN
        UPDATE public.discount_codes
        SET used_count = GREATEST(0, COALESCE(used_count, 0) - 1)
        WHERE code = UPPER(BTRIM(v_order.discount_code));

        IF FOUND THEN
            v_discount_usage_restored := TRUE;
        END IF;
    END IF;

    SELECT ARRAY(
        SELECT DISTINCT inventory_id
        FROM (
            SELECT v_order.inventory_id AS inventory_id
            UNION ALL
            SELECT soi.inventory_id
            FROM public.shop_order_items soi
            WHERE soi.order_id = p_order_id
        ) inventory_rows
        WHERE inventory_id IS NOT NULL
    )
    INTO v_inventory_ids;

    IF COALESCE(array_length(v_inventory_ids, 1), 0) > 0 THEN
        UPDATE public.shop_inventory
        SET status = p_target_status,
            remark = COALESCE(NULLIF(BTRIM(p_remark), ''), remark),
            buyer_id = NULL,
            sold_at = NULL
        WHERE id = ANY(v_inventory_ids);
    END IF;

    UPDATE public.shop_orders
    SET refund_status = 'refunded',
        delivery_status = 'refunded',
        delivery_completed_at = COALESCE(delivery_completed_at, NOW()),
        delivery_updated_at = NOW(),
        discount_usage_restored = CASE
            WHEN v_discount_usage_restored THEN true
            ELSE discount_usage_restored
        END,
        discount_asset_restored = CASE
            WHEN v_discount_assets_restored THEN true
            ELSE discount_asset_restored
        END,
        discount_refund_amount = GREATEST(COALESCE(discount_amount, 0), 0)
    WHERE id = p_order_id;

    SELECT COUNT(*)
    INTO v_stock_count
    FROM public.shop_inventory
    WHERE product_id = v_order.product_id
      AND status = 'available';

    UPDATE public.shop_products
    SET stock_count = v_stock_count
    WHERE id = v_order.product_id;

    RETURN jsonb_build_object(
        'success', true,
        'site', v_site,
        'duplicate', false,
        'discount_usage_restored', v_discount_usage_restored,
        'discount_asset_restored', v_discount_assets_restored,
        'message', '退款成功，库存已标记为: ' || (v_status_map ->> p_target_status)
    );
END;
$$;
