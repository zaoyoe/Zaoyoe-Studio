-- Harden shop discount settlement after multi-coupon and point-source accounting.
-- This migration fixes three coupon edge cases:
-- 1. multi-coupon purchases settle against the final payable amount instead of
--    leaving gross point-source attribution behind;
-- 2. per-user coupon limits count coupons stored inside discount_snapshot.applied_discounts;
-- 3. admin refunds restore coupon usage counters and coupon assets while keeping
--    paid/bonus point refund attribution.

CREATE OR REPLACE FUNCTION public.fn_shop_discount_user_net_use_count(
    p_user_id UUID,
    p_discount_code TEXT
)
RETURNS INT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT COUNT(*)::INT
    FROM public.shop_orders o
    WHERE o.user_id = p_user_id
      AND NULLIF(UPPER(BTRIM(COALESCE(p_discount_code, ''))), '') IS NOT NULL
      AND COALESCE(o.refund_status, 'none') NOT IN ('refunded', 'full_refund')
      AND (
          UPPER(BTRIM(COALESCE(o.discount_code, ''))) = UPPER(BTRIM(COALESCE(p_discount_code, '')))
          OR EXISTS (
              SELECT 1
              FROM jsonb_array_elements(
                  CASE
                      WHEN jsonb_typeof(o.discount_snapshot -> 'applied_discounts') = 'array'
                          THEN o.discount_snapshot -> 'applied_discounts'
                      ELSE '[]'::JSONB
                  END
              ) AS applied_discount
              WHERE UPPER(BTRIM(COALESCE(
                  applied_discount ->> 'code',
                  applied_discount ->> 'discount_code',
                  ''
              ))) = UPPER(BTRIM(COALESCE(p_discount_code, '')))
          )
      );
$$;

REVOKE ALL ON FUNCTION public.fn_shop_discount_user_net_use_count(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_shop_discount_user_net_use_count(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_shop_discount_user_net_use_count(UUID, TEXT) TO authenticated, service_role;

DO $$
DECLARE
    v_definition TEXT;
BEGIN
    SELECT pg_get_functiondef(
        'public.fn_validate_discount_code_core(uuid,uuid,character varying,integer,character varying,uuid,uuid)'::regprocedure
    )
    INTO v_definition;

    IF v_definition IS NULL THEN
        RAISE EXCEPTION 'fn_validate_discount_code_core is missing';
    END IF;

    IF POSITION('fn_shop_discount_user_net_use_count' IN v_definition) = 0 THEN
        v_definition := REPLACE(
            v_definition,
            '        SELECT COUNT(*)::INT' || E'\n        INTO v_user_discount_use_count' || E'\n        FROM public.shop_orders' || E'\n        WHERE user_id = v_effective_user_id' || E'\n          AND discount_code = v_discount_code' || E'\n          AND COALESCE(refund_status, ''none'') NOT IN (''refunded'', ''full_refund'');',
            '        SELECT public.fn_shop_discount_user_net_use_count(v_effective_user_id, v_discount_code)' || E'\n        INTO v_user_discount_use_count;'
        );
    END IF;

    IF POSITION('fn_shop_discount_user_net_use_count' IN v_definition) = 0 THEN
        RAISE EXCEPTION 'failed to patch fn_validate_discount_code_core with snapshot-aware per-user coupon counts';
    END IF;

    EXECUTE v_definition;
END;
$$;

DO $$
DECLARE
    v_definition TEXT;
BEGIN
    SELECT pg_get_functiondef(
        'public.fn_purchase_shop_item_core(uuid,uuid,character varying,integer,character varying,uuid,uuid)'::regprocedure
    )
    INTO v_definition;

    IF v_definition IS NULL THEN
        RAISE EXCEPTION 'fn_purchase_shop_item_core is missing';
    END IF;

    IF POSITION('fn_shop_discount_user_net_use_count' IN v_definition) = 0 THEN
        v_definition := REPLACE(
            v_definition,
            '            SELECT COUNT(*)::INT' || E'\n            INTO v_user_discount_use_count' || E'\n            FROM public.shop_orders' || E'\n            WHERE user_id = v_effective_user_id' || E'\n              AND discount_code = v_discount_code' || E'\n              AND COALESCE(refund_status, ''none'') NOT IN (''refunded'', ''full_refund'');',
            '            SELECT public.fn_shop_discount_user_net_use_count(v_effective_user_id, v_discount_code)' || E'\n            INTO v_user_discount_use_count;'
        );
    END IF;

    IF POSITION('fn_shop_discount_user_net_use_count' IN v_definition) = 0 THEN
        RAISE EXCEPTION 'failed to patch fn_purchase_shop_item_core with snapshot-aware per-user coupon counts';
    END IF;

    EXECUTE v_definition;
END;
$$;

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
    v_site VARCHAR := LOWER(COALESCE(NULLIF(BTRIM(COALESCE(p_site, '')), ''), 'cn'));
    v_discount_inputs JSONB := CASE
        WHEN jsonb_typeof(COALESCE(p_discount_inputs, '[]'::JSONB)) = 'array'
            THEN COALESCE(p_discount_inputs, '[]'::JSONB)
        ELSE '[]'::JSONB
    END;
    v_discount_input JSONB;
    v_preview_result JSONB := '{}'::JSONB;
    v_preview_data JSONB := '{}'::JSONB;
    v_discount_row RECORD;
    v_preview_discount_id UUID;
    v_asset_discount_id UUID;
    v_asset_user_id UUID;
    v_asset_status VARCHAR(32);
    v_asset_expires_at TIMESTAMPTZ;
    v_asset_source_type VARCHAR(32);
    v_asset_source_channel VARCHAR(80);
    v_asset_audience_segment VARCHAR(80);
    v_discount_entries JSONB := '[]'::JSONB;
    v_applied_discounts JSONB := '[]'::JSONB;
    v_discount_entry JSONB;
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
    v_purchase_result JSONB := '{}'::JSONB;
    v_purchase_data JSONB := '{}'::JSONB;
    v_order_id UUID;
    v_product_name VARCHAR;
    v_discount_codes TEXT[];
    v_discount_code_display VARCHAR;
    v_reserved_discount_ids UUID[] := ARRAY[]::UUID[];
    v_reserved_discount_id UUID;
    v_original_paid_balance NUMERIC(12,2) := 0;
    v_original_bonus_balance NUMERIC(12,2) := 0;
    v_original_total_balance NUMERIC(12,2) := 0;
    v_desired_paid_points NUMERIC(12,2) := 0;
    v_desired_bonus_points NUMERIC(12,2) := 0;
    v_purchase_ledger_id UUID := NULL;
    v_lot_consumption RECORD;
    v_event_discount_id UUID;
    v_event_discount_asset_id UUID;
    v_event_audience_segment VARCHAR(80);
    v_event_source_channel VARCHAR(80);
    v_user_discount_use_count INT := 0;
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

    IF v_site NOT IN ('cn', 'intl') THEN
        RETURN jsonb_build_object('success', false, 'message', '站点参数无效');
    END IF;

    IF jsonb_array_length(v_discount_inputs) = 0 THEN
        RETURN jsonb_build_object('success', false, 'message', '请至少选择一张卡券');
    END IF;

    FOR v_discount_input IN
        SELECT value
        FROM jsonb_array_elements(v_discount_inputs)
        ORDER BY
            COALESCE(UPPER(BTRIM(value ->> 'discount_code')), UPPER(BTRIM(value ->> 'code')), ''),
            COALESCE(BTRIM(value ->> 'discount_asset_id'), BTRIM(value ->> 'asset_id'), '')
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
            v_site,
            p_quantity,
            v_effective_discount_code,
            v_effective_discount_asset_id,
            p_agent_id
        );

        IF COALESCE((v_preview_result ->> 'success')::BOOLEAN, false) IS NOT TRUE THEN
            RETURN v_preview_result;
        END IF;

        v_preview_data := COALESCE(v_preview_result -> 'data', '{}'::JSONB);
        v_preview_discount_id := NULLIF(v_preview_data ->> 'discount_id', '')::UUID;

        v_asset_discount_id := NULL;
        v_asset_user_id := NULL;
        v_asset_status := NULL;
        v_asset_expires_at := NULL;
        v_asset_source_type := NULL;
        v_asset_source_channel := NULL;
        v_asset_audience_segment := NULL;

        IF v_effective_discount_asset_id IS NOT NULL THEN
            SELECT
                a.discount_id,
                a.user_id,
                a.asset_status,
                a.expires_at,
                a.source_type,
                a.source_channel,
                NULLIF(BTRIM(a.audience_segment), '') AS audience_segment
            INTO
                v_asset_discount_id,
                v_asset_user_id,
                v_asset_status,
                v_asset_expires_at,
                v_asset_source_type,
                v_asset_source_channel,
                v_asset_audience_segment
            FROM public.discount_user_assets a
            WHERE a.id = v_effective_discount_asset_id
            FOR UPDATE;

            IF NOT FOUND THEN
                RETURN jsonb_build_object('success', false, 'message', '指定卡券不存在');
            END IF;

            IF v_preview_discount_id IS NOT NULL
                AND v_asset_discount_id IS DISTINCT FROM v_preview_discount_id THEN
                RETURN jsonb_build_object('success', false, 'message', '卡券与优惠码不匹配');
            END IF;

            IF v_asset_user_id IS DISTINCT FROM v_effective_user_id THEN
                RETURN jsonb_build_object('success', false, 'message', '该卡券不属于当前账号');
            END IF;

            CASE LOWER(BTRIM(COALESCE(v_asset_status, 'available')))
                WHEN 'used' THEN
                    RETURN jsonb_build_object('success', false, 'message', '该卡券已使用');
                WHEN 'expired' THEN
                    RETURN jsonb_build_object('success', false, 'message', '该卡券已过期');
                WHEN 'revoked' THEN
                    RETURN jsonb_build_object('success', false, 'message', '该卡券当前不可用');
                WHEN 'available' THEN
                    NULL;
                ELSE
                    RETURN jsonb_build_object('success', false, 'message', '该卡券当前不可用');
            END CASE;

            IF v_asset_expires_at IS NOT NULL AND v_asset_expires_at < NOW() THEN
                RETURN jsonb_build_object('success', false, 'message', '该卡券已过期');
            END IF;
        END IF;

        SELECT
            d.id,
            d.code,
            d.max_uses,
            d.used_count,
            d.max_uses_per_user,
            d.allow_zero_total,
            COALESCE(d.version_no, 1) AS version_no,
            COALESCE(d.max_discount_quantity, 0) AS max_discount_quantity,
            COALESCE(d.is_exclusive, true) AS is_exclusive,
            GREATEST(1, COALESCE(d.stack_priority, 100)) AS stack_priority,
            COALESCE(NULLIF(BTRIM(COALESCE(d.pricing_apply_stage, '')), ''), 'order_discount') AS pricing_apply_stage,
            COALESCE(NULLIF(BTRIM(COALESCE(d.distribution_mode, '')), ''), 'general_code') AS distribution_mode,
            d.campaign_tag,
            d.audience_segment
        INTO v_discount_row
        FROM public.discount_codes d
        WHERE d.id = COALESCE(v_asset_discount_id, v_preview_discount_id)
        FOR UPDATE;

        IF NOT FOUND THEN
            RETURN jsonb_build_object('success', false, 'message', '优惠券规则不存在或已失效');
        END IF;

        IF v_effective_discount_asset_id IS NOT NULL
            AND v_asset_discount_id IS DISTINCT FROM v_discount_row.id THEN
            RETURN jsonb_build_object('success', false, 'message', '卡券与优惠码不匹配');
        END IF;

        IF v_effective_discount_asset_id IS NOT NULL THEN
            v_asset_audience_segment := COALESCE(
                v_asset_audience_segment,
                NULLIF(BTRIM(v_discount_row.audience_segment), ''),
                'all_users'
            );
        END IF;

        IF v_discount_row.code = ANY(v_existing_discount_codes) THEN
            RETURN jsonb_build_object('success', false, 'message', '同一张优惠券不能重复叠加');
        END IF;

        IF COALESCE(v_discount_row.max_uses, 0) > 0
            AND COALESCE(v_discount_row.used_count, 0) >= v_discount_row.max_uses THEN
            RETURN jsonb_build_object('success', false, 'message', '该优惠码的使用次数已达上限');
        END IF;

        IF COALESCE(v_discount_row.max_uses_per_user, 0) > 0 THEN
            SELECT public.fn_shop_discount_user_net_use_count(v_effective_user_id, v_discount_row.code)
            INTO v_user_discount_use_count;

            IF v_user_discount_use_count >= v_discount_row.max_uses_per_user THEN
                RETURN jsonb_build_object('success', false, 'message', '当前账号已达到该优惠码的使用上限');
            END IF;
        END IF;

        v_existing_discount_codes := array_append(v_existing_discount_codes, v_discount_row.code);
        IF v_effective_discount_asset_id IS NOT NULL THEN
            v_existing_discount_asset_ids := array_append(v_existing_discount_asset_ids, v_effective_discount_asset_id);
        END IF;

        IF COALESCE(v_discount_row.is_exclusive, true) THEN
            v_has_exclusive_discount := TRUE;
        END IF;

        v_discount_entries := v_discount_entries || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
            'discount_id', v_discount_row.id,
            'code', v_discount_row.code,
            'discount_code', v_discount_row.code,
            'discount_asset_id', v_effective_discount_asset_id,
            'asset_id', v_effective_discount_asset_id,
            'discount_type', v_preview_data ->> 'discount_type',
            'discount_value', ROUND(COALESCE((v_preview_data ->> 'discount_value')::NUMERIC, 0), 2),
            'max_discount_quantity', COALESCE(v_discount_row.max_discount_quantity, 0),
            'quantity', p_quantity,
            'unit_price', (v_preview_data ->> 'unit_price')::NUMERIC(12,2),
            'subtotal', (v_preview_data ->> 'subtotal')::NUMERIC(12,2),
            'allow_zero_total', COALESCE(v_discount_row.allow_zero_total, false),
            'discount_version', COALESCE(v_discount_row.version_no, 1),
            'distribution_mode', COALESCE(v_preview_data ->> 'distribution_mode', v_discount_row.distribution_mode),
            'campaign_tag', COALESCE(v_preview_data ->> 'campaign_tag', v_discount_row.campaign_tag),
            'audience_segment', COALESCE(v_asset_audience_segment, v_preview_data ->> 'audience_segment', v_discount_row.audience_segment),
            'is_exclusive', COALESCE((v_preview_data ->> 'is_exclusive')::BOOLEAN, v_discount_row.is_exclusive, true),
            'stack_priority', GREATEST(1, COALESCE((v_preview_data ->> 'stack_priority')::INT, v_discount_row.stack_priority, 100)),
            'pricing_apply_stage', COALESCE(NULLIF(BTRIM(COALESCE(v_preview_data ->> 'pricing_apply_stage', v_discount_row.pricing_apply_stage)), ''), 'order_discount'),
            'source_type', v_asset_source_type,
            'source_channel', v_asset_source_channel
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
        SELECT
            resolved.discount_amount,
            resolved.final_total,
            resolved.has_effective_discount
        INTO
            v_discount_amount,
            v_discounted_total,
            v_has_effective_discount
        FROM public.fn_resolve_shop_discount_amount(
            v_running_total,
            COALESCE(v_discount_entry ->> 'discount_type', ''),
            COALESCE((v_discount_entry ->> 'discount_value')::NUMERIC(12,2), 0),
            COALESCE((v_discount_entry ->> 'allow_zero_total')::BOOLEAN, false),
            COALESCE((v_discount_entry ->> 'unit_price')::NUMERIC(12,2), CASE WHEN p_quantity > 0 THEN v_subtotal / p_quantity ELSE v_subtotal END),
            p_quantity,
            COALESCE((v_discount_entry ->> 'max_discount_quantity')::INT, 0)
        ) AS resolved;

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

    SELECT paid_balance, bonus_balance, total_balance
    INTO v_original_paid_balance, v_original_bonus_balance, v_original_total_balance
    FROM public.points_balance
    WHERE user_id = v_effective_user_id
      AND site = v_site
    FOR UPDATE;

    v_original_paid_balance := ROUND(GREATEST(COALESCE(v_original_paid_balance, 0), 0), 2);
    v_original_bonus_balance := ROUND(GREATEST(COALESCE(v_original_bonus_balance, 0), 0), 2);
    v_original_total_balance := ROUND(GREATEST(COALESCE(v_original_total_balance, v_original_paid_balance + v_original_bonus_balance), 0), 2);

    IF v_original_total_balance < v_running_total THEN
        RETURN jsonb_build_object('success', false, 'message', '积分余额不足');
    END IF;

    v_desired_bonus_points := LEAST(v_original_bonus_balance, v_running_total);
    v_desired_paid_points := ROUND(GREATEST(v_running_total - v_desired_bonus_points, 0), 2);

    IF v_original_paid_balance < v_desired_paid_points THEN
        RETURN jsonb_build_object('success', false, 'message', '余额扣款异常');
    END IF;

    FOR v_discount_entry IN
        SELECT value
        FROM jsonb_array_elements(v_applied_discounts)
    LOOP
        UPDATE public.discount_codes
        SET used_count = COALESCE(used_count, 0) + 1
        WHERE id = NULLIF(v_discount_entry ->> 'discount_id', '')::UUID
          AND (
              COALESCE(max_uses, 0) <= 0
              OR COALESCE(used_count, 0) < COALESCE(max_uses, 0)
          );

        IF NOT FOUND THEN
            FOREACH v_reserved_discount_id IN ARRAY v_reserved_discount_ids LOOP
                UPDATE public.discount_codes
                SET used_count = GREATEST(0, COALESCE(used_count, 0) - 1)
                WHERE id = v_reserved_discount_id;
            END LOOP;

            RETURN jsonb_build_object('success', false, 'message', '所选卡券额度已被使用完，请重新选择');
        END IF;

        v_reserved_discount_ids := array_append(v_reserved_discount_ids, NULLIF(v_discount_entry ->> 'discount_id', '')::UUID);
    END LOOP;

    IF v_total_discount_amount > 0 THEN
        INSERT INTO public.points_balance (user_id, site, paid_balance, bonus_balance)
        VALUES (v_effective_user_id, v_site, v_total_discount_amount, 0)
        ON CONFLICT (user_id, site) DO UPDATE
        SET paid_balance = ROUND(COALESCE(points_balance.paid_balance, 0) + EXCLUDED.paid_balance, 2),
            updated_at = NOW();
    END IF;

    v_purchase_result := public.fn_purchase_shop_item(
        p_product_id,
        v_effective_user_id,
        v_site,
        p_quantity,
        NULL,
        p_agent_id
    );

    IF COALESCE((v_purchase_result ->> 'success')::BOOLEAN, false) IS NOT TRUE THEN
        IF v_total_discount_amount > 0 THEN
            UPDATE public.points_balance
            SET paid_balance = ROUND(GREATEST(0, COALESCE(paid_balance, 0) - v_total_discount_amount), 2),
                updated_at = NOW()
            WHERE user_id = v_effective_user_id
              AND site = v_site;
        END IF;

        FOREACH v_reserved_discount_id IN ARRAY v_reserved_discount_ids LOOP
            UPDATE public.discount_codes
            SET used_count = GREATEST(0, COALESCE(used_count, 0) - 1)
            WHERE id = v_reserved_discount_id;
        END LOOP;

        RETURN v_purchase_result;
    END IF;

    v_purchase_data := COALESCE(v_purchase_result -> 'data', '{}'::JSONB);
    v_order_id := NULLIF(v_purchase_data ->> 'order_id', '')::UUID;
    v_product_name := COALESCE(NULLIF(BTRIM(COALESCE(v_purchase_data ->> 'product_name', '')), ''), '未知商品');

    IF v_order_id IS NULL THEN
        IF v_total_discount_amount > 0 THEN
            UPDATE public.points_balance
            SET paid_balance = ROUND(GREATEST(0, COALESCE(paid_balance, 0) - v_total_discount_amount), 2),
                updated_at = NOW()
            WHERE user_id = v_effective_user_id
              AND site = v_site;
        END IF;

        FOREACH v_reserved_discount_id IN ARRAY v_reserved_discount_ids LOOP
            UPDATE public.discount_codes
            SET used_count = GREATEST(0, COALESCE(used_count, 0) - 1)
            WHERE id = v_reserved_discount_id;
        END LOOP;

        RETURN jsonb_build_object('success', false, 'message', '多券购买未返回有效订单号');
    END IF;

    BEGIN
        FOR v_lot_consumption IN
            SELECT point_lot_id, points_amount
            FROM public.wallet_point_lot_consumptions
            WHERE order_id = v_order_id
              AND consumption_reference_id = 'SHOP_ORDER_' || v_order_id::TEXT
            FOR UPDATE
        LOOP
            UPDATE public.wallet_point_lots
            SET points_remaining = ROUND(COALESCE(points_remaining, 0) + COALESCE(v_lot_consumption.points_amount, 0), 2),
                updated_at = NOW()
            WHERE id = v_lot_consumption.point_lot_id;
        END LOOP;

        DELETE FROM public.wallet_point_lot_consumptions
        WHERE order_id = v_order_id
          AND consumption_reference_id = 'SHOP_ORDER_' || v_order_id::TEXT;
    EXCEPTION WHEN undefined_table OR undefined_column THEN
        NULL;
    END;

    SELECT id
    INTO v_purchase_ledger_id
    FROM public.points_ledger
    WHERE user_id = v_effective_user_id
      AND site = v_site
      AND reference_id = 'SHOP_ORDER_' || v_order_id::TEXT
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF v_purchase_ledger_id IS NOT NULL THEN
        IF v_running_total > 0 THEN
            UPDATE public.points_ledger
            SET amount = -v_running_total,
                reason = '商城购买: ' || v_product_name || ' (多券优惠后)'
            WHERE id = v_purchase_ledger_id;
        ELSE
            DELETE FROM public.points_ledger
            WHERE id = v_purchase_ledger_id;
            v_purchase_ledger_id := NULL;
        END IF;
    END IF;

    UPDATE public.points_balance
    SET paid_balance = ROUND(GREATEST(v_original_paid_balance - v_desired_paid_points, 0), 2),
        bonus_balance = ROUND(GREATEST(v_original_bonus_balance - v_desired_bonus_points, 0), 2),
        updated_at = NOW()
    WHERE user_id = v_effective_user_id
      AND site = v_site;

    IF v_running_total > 0
        AND v_purchase_ledger_id IS NOT NULL
        AND to_regprocedure('public.fn_consume_wallet_point_lots_for_shop_order(uuid,character varying,uuid,uuid,numeric,numeric,text,text)') IS NOT NULL THEN
        PERFORM public.fn_consume_wallet_point_lots_for_shop_order(
            v_effective_user_id,
            v_site,
            v_order_id,
            v_purchase_ledger_id,
            v_desired_paid_points,
            v_desired_bonus_points,
            'SHOP_ORDER_' || v_order_id::TEXT,
            '商城购买: ' || v_product_name || ' (多券优惠后)'
        );
    END IF;

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

    UPDATE public.shop_orders
    SET price_paid = v_running_total,
        discount_code = NULLIF(v_discount_code_display, ''),
        discount_amount = v_total_discount_amount,
        discount_snapshot = jsonb_strip_nulls(jsonb_build_object(
            'stacking_mode', 'multi_discount',
            'settlement_basis', 'net_payable',
            'discount_codes', v_discount_codes,
            'selected_count', jsonb_array_length(v_applied_discounts),
            'applied_discounts', v_applied_discounts,
            'unit_price', v_unit_price,
            'subtotal', v_subtotal,
            'discount_amount', v_total_discount_amount,
            'final_total', v_running_total,
            'site', v_site,
            'quantity', p_quantity
        )),
        discount_version = v_discount_version,
        discount_usage_restored = false,
        discount_refund_amount = 0,
        discount_asset_id = NULL,
        discount_asset_restored = false,
        paid_points_spent = v_desired_paid_points,
        bonus_points_spent = v_desired_bonus_points,
        points_spend_breakdown = jsonb_build_object(
            'status', 'exact',
            'basis', 'multi_discount_net_settlement',
            'paid_points', v_desired_paid_points,
            'bonus_points', v_desired_bonus_points,
            'untracked_points', 0,
            'gross_points', v_subtotal,
            'discount_points', v_total_discount_amount,
            'final_points', v_running_total
        )
    WHERE id = v_order_id;

    IF v_running_total > 0 THEN
        UPDATE public.shop_purchase_reward_jobs
        SET total_price = v_running_total,
            updated_at = NOW()
        WHERE order_id = v_order_id;
    ELSE
        DELETE FROM public.shop_purchase_reward_jobs
        WHERE order_id = v_order_id;
    END IF;

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
                v_site,
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
        'paid_points_spent', v_desired_paid_points,
        'bonus_points_spent', v_desired_bonus_points,
        'points_spend_breakdown', jsonb_build_object(
            'status', 'exact',
            'basis', 'multi_discount_net_settlement',
            'paid_points', v_desired_paid_points,
            'bonus_points', v_desired_bonus_points,
            'untracked_points', 0
        ),
        'discount_version', v_discount_version,
        'applied_discounts', v_applied_discounts,
        'remaining_points', ROUND(GREATEST(0, v_original_total_balance - v_running_total), 2)
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

CREATE OR REPLACE FUNCTION public.fn_purchase_shop_item_with_discounts(
    p_product_id UUID,
    p_user_id UUID,
    p_site VARCHAR,
    p_quantity INT,
    p_discount_inputs JSONB,
    p_agent_id UUID,
    p_sku_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_result JSONB := '{}'::JSONB;
BEGIN
    PERFORM set_config('app.shop_product_sku_id', COALESCE(p_sku_id::TEXT, ''), true);

    v_result := public.fn_purchase_shop_item_with_discounts(
        p_product_id,
        p_user_id,
        p_site,
        p_quantity,
        p_discount_inputs,
        p_agent_id
    );

    PERFORM set_config('app.shop_product_sku_id', '', true);
    RETURN v_result;
EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('app.shop_product_sku_id', '', true);
    RETURN jsonb_build_object('success', false, 'message', '多券交易失败: ' || SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_purchase_shop_item_with_discounts(UUID, UUID, VARCHAR, INT, JSONB, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_purchase_shop_item_with_discounts(UUID, UUID, VARCHAR, INT, JSONB, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_purchase_shop_item_with_discounts(UUID, UUID, VARCHAR, INT, JSONB, UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.fn_purchase_shop_item_with_discounts(UUID, UUID, VARCHAR, INT, JSONB, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_purchase_shop_item_with_discounts(UUID, UUID, VARCHAR, INT, JSONB, UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_purchase_shop_item_with_discounts(UUID, UUID, VARCHAR, INT, JSONB, UUID, UUID) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.fn_admin_refund_order(UUID, UUID);
DROP FUNCTION IF EXISTS public.fn_admin_refund_order(UUID, UUID, VARCHAR);
DROP FUNCTION IF EXISTS public.fn_admin_refund_order(UUID, UUID, VARCHAR, TEXT);

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
    v_refund_paid_points NUMERIC(12,2) := 0;
    v_refund_bonus_points NUMERIC(12,2) := 0;
    v_refund_untracked_points NUMERIC(12,2) := 0;
    v_refund_total_points NUMERIC(12,2) := 0;
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
        o.sku_id,
        o.price_paid,
        o.total_price,
        o.snapshot_product_name,
        o.refund_status,
        o.delivery_status,
        o.delivery_completed_at,
        o.site,
        o.discount_code,
        o.discount_amount,
        o.discount_asset_id,
        o.discount_usage_restored,
        o.discount_asset_restored,
        o.discount_snapshot,
        o.paid_points_spent,
        o.bonus_points_spent,
        o.points_spend_breakdown
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

    v_refund_paid_points := ROUND(GREATEST(COALESCE(v_order.paid_points_spent, v_refund_amount), 0), 2);
    v_refund_bonus_points := ROUND(GREATEST(COALESCE(v_order.bonus_points_spent, 0), 0), 2);
    v_refund_total_points := ROUND(v_refund_paid_points + v_refund_bonus_points, 2);

    IF ABS(v_refund_total_points - v_refund_amount) > 0.01 THEN
        IF v_order.paid_points_spent IS NULL AND v_order.bonus_points_spent IS NULL THEN
            v_refund_paid_points := v_refund_amount;
            v_refund_bonus_points := 0;
        ELSIF v_refund_total_points < v_refund_amount THEN
            v_refund_untracked_points := ROUND(v_refund_amount - v_refund_total_points, 2);
            v_refund_paid_points := ROUND(v_refund_paid_points + v_refund_untracked_points, 2);
        ELSIF v_refund_total_points > 0 THEN
            v_refund_paid_points := ROUND(v_refund_amount * (v_refund_paid_points / v_refund_total_points), 2);
            v_refund_bonus_points := ROUND(GREATEST(v_refund_amount - v_refund_paid_points, 0), 2);
        END IF;
    END IF;

    IF v_refund_amount > 0 THEN
        v_refund_reason := '订单退款: ' || COALESCE(NULLIF(BTRIM(v_order.snapshot_product_name), ''), '未知商品');

        SELECT public.fn_recharge_points(
            v_order.user_id,
            v_refund_paid_points,
            v_refund_bonus_points,
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

        IF v_order.discount_asset_id IS NOT NULL
            AND COALESCE(v_order.discount_asset_restored, false) = false THEN
            SELECT
                a.id,
                a.discount_id,
                COALESCE(NULLIF(BTRIM(a.source_channel), ''), 'shop_wallet') AS source_channel,
                COALESCE(NULLIF(BTRIM(a.audience_segment), ''), NULLIF(BTRIM(d.audience_segment), ''), 'all_users') AS audience_segment
            INTO v_asset
            FROM public.discount_user_assets a
            JOIN public.discount_codes d
                ON d.id = a.discount_id
            WHERE a.id = v_order.discount_asset_id;

            IF FOUND THEN
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
            END IF;
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
        discount_refund_amount = GREATEST(COALESCE(discount_amount, 0), 0),
        points_spend_breakdown = COALESCE(points_spend_breakdown, '{}'::JSONB) || jsonb_build_object(
            'refund_status', 'refunded',
            'refund_paid_points', v_refund_paid_points,
            'refund_bonus_points', v_refund_bonus_points,
            'refund_reference', v_refund_reference
        )
    WHERE id = p_order_id;

    SELECT COUNT(*)
    INTO v_stock_count
    FROM public.shop_inventory
    WHERE product_id = v_order.product_id
      AND status = 'available';

    UPDATE public.shop_products
    SET stock_count = v_stock_count
    WHERE id = v_order.product_id;

    IF v_order.sku_id IS NOT NULL
        AND to_regprocedure('public.fn_sync_shop_product_sku_stock_counts(uuid[])') IS NOT NULL THEN
        EXECUTE 'SELECT public.fn_sync_shop_product_sku_stock_counts($1::uuid[])'
        USING ARRAY[v_order.sku_id];
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'site', v_site,
        'duplicate', false,
        'refund_paid_points', v_refund_paid_points,
        'refund_bonus_points', v_refund_bonus_points,
        'discount_usage_restored', v_discount_usage_restored,
        'discount_asset_restored', v_discount_assets_restored,
        'message', '退款成功，库存已标记为: ' || (v_status_map ->> p_target_status)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_admin_refund_order(UUID, UUID, VARCHAR, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_admin_refund_order(UUID, UUID, VARCHAR, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.fn_admin_refund_order(UUID, UUID, VARCHAR, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_admin_refund_order(UUID, UUID, VARCHAR, TEXT) TO service_role;
