-- ============================================
-- Fix ambiguous shop discount wrapper overloads
-- Problem:
-- - public.fn_validate_discount_code(..., uuid, uuid default null)
-- - public.fn_purchase_shop_item(..., uuid, uuid default null)
--   both delegated to 6-arg overloads using positional calls.
-- - Because the trailing wrapper parameters had defaults, PostgreSQL could
--   treat the inner 6-arg call as matching both the exact 6-arg overload
--   and the 7-arg overload with one omitted default, leading to:
--   "function ... is not unique".
--
-- Fix:
-- - Recreate the 7-arg wrappers without defaults on any parameter.
-- - PostgreSQL requires that once a parameter has a default, every following
--   input parameter must also have one, so removing only the trailing defaults
--   is invalid.
-- - PostgreSQL also does not allow CREATE OR REPLACE to remove defaults from
--   an existing function signature, so we must DROP the 7-arg overloads first.
-- - External API callers already pass all 7 arguments explicitly, so requiring
--   explicit NULLs for optional values avoids overload ambiguity without
--   changing runtime behavior.
-- ============================================

DROP FUNCTION IF EXISTS public.fn_validate_discount_code(UUID, UUID, VARCHAR, INT, VARCHAR, UUID, UUID);

CREATE OR REPLACE FUNCTION public.fn_validate_discount_code(
    p_product_id UUID,
    p_user_id UUID,
    p_site VARCHAR,
    p_quantity INT,
    p_discount_code VARCHAR,
    p_discount_asset_id UUID,
    p_agent_id UUID
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
    v_effective_discount_code VARCHAR := NULLIF(UPPER(BTRIM(COALESCE(p_discount_code, ''))), '');
    v_discount_record RECORD;
    v_asset RECORD;
    v_result JSONB;
    v_distribution_mode VARCHAR(32) := 'general_code';
    v_discount_id UUID := NULL;
    v_audience_segment VARCHAR(80) := NULL;
    v_campaign_tag VARCHAR(120) := NULL;
    v_is_exclusive BOOLEAN := true;
    v_stack_priority INT := 100;
    v_pricing_apply_stage VARCHAR(32) := 'order_discount';
BEGIN
    IF v_request_role = 'service_role' THEN
        v_effective_user_id := COALESCE(p_user_id, v_request_user_id);
    ELSE
        IF v_request_user_id IS NULL THEN
            RETURN jsonb_build_object('success', false, 'message', '请先登录');
        END IF;

        IF p_user_id IS NOT NULL AND p_user_id <> v_request_user_id THEN
            RETURN jsonb_build_object('success', false, 'message', '非法的用户上下文');
        END IF;

        v_effective_user_id := v_request_user_id;
    END IF;

    IF v_effective_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '缺少有效的用户身份');
    END IF;

    IF p_discount_asset_id IS NOT NULL THEN
        SELECT
            a.id,
            a.user_id,
            a.discount_id,
            a.asset_status,
            a.expires_at,
            a.source_type,
            a.source_channel,
            COALESCE(NULLIF(BTRIM(a.audience_segment), ''), NULLIF(BTRIM(d.audience_segment), '')) AS audience_segment,
            d.code,
            d.distribution_mode,
            d.campaign_tag,
            d.is_exclusive,
            d.stack_priority,
            d.pricing_apply_stage
        INTO v_asset
        FROM public.discount_user_assets a
        JOIN public.discount_codes d
            ON d.id = a.discount_id
        WHERE a.id = p_discount_asset_id;

        IF NOT FOUND THEN
            RETURN jsonb_build_object('success', false, 'message', '指定卡券不存在');
        END IF;

        IF v_asset.user_id IS DISTINCT FROM v_effective_user_id THEN
            RETURN jsonb_build_object('success', false, 'message', '该卡券不属于当前账号');
        END IF;

        CASE LOWER(BTRIM(COALESCE(v_asset.asset_status, 'available')))
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

        IF v_asset.expires_at IS NOT NULL AND v_asset.expires_at < NOW() THEN
            RETURN jsonb_build_object('success', false, 'message', '该卡券已过期');
        END IF;

        IF v_effective_discount_code IS NOT NULL AND v_effective_discount_code <> v_asset.code THEN
            RETURN jsonb_build_object('success', false, 'message', '卡券与优惠码不匹配');
        END IF;

        v_effective_discount_code := v_asset.code;
        v_discount_id := v_asset.discount_id;
        v_distribution_mode := COALESCE(v_asset.distribution_mode, 'general_code');
        v_audience_segment := v_asset.audience_segment;
        v_campaign_tag := v_asset.campaign_tag;
        v_is_exclusive := COALESCE(v_asset.is_exclusive, true);
        v_stack_priority := GREATEST(1, COALESCE(v_asset.stack_priority, 100));
        v_pricing_apply_stage := COALESCE(NULLIF(BTRIM(COALESCE(v_asset.pricing_apply_stage, '')), ''), 'order_discount');
    END IF;

    IF v_effective_discount_code IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '请输入优惠码');
    END IF;

    SELECT
        id,
        distribution_mode,
        audience_segment,
        campaign_tag,
        is_exclusive,
        stack_priority,
        pricing_apply_stage
    INTO v_discount_record
    FROM public.discount_codes
    WHERE code = v_effective_discount_code
    LIMIT 1;

    IF FOUND THEN
        v_discount_id := COALESCE(v_discount_id, v_discount_record.id);
        v_distribution_mode := COALESCE(NULLIF(BTRIM(COALESCE(v_discount_record.distribution_mode, '')), ''), v_distribution_mode, 'general_code');
        v_audience_segment := COALESCE(NULLIF(BTRIM(COALESCE(v_audience_segment, '')), ''), NULLIF(BTRIM(COALESCE(v_discount_record.audience_segment, '')), ''));
        v_campaign_tag := COALESCE(NULLIF(BTRIM(COALESCE(v_campaign_tag, '')), ''), NULLIF(BTRIM(COALESCE(v_discount_record.campaign_tag, '')), ''));
        v_is_exclusive := COALESCE(v_discount_record.is_exclusive, v_is_exclusive, true);
        v_stack_priority := GREATEST(1, COALESCE(v_discount_record.stack_priority, v_stack_priority, 100));
        v_pricing_apply_stage := COALESCE(NULLIF(BTRIM(COALESCE(v_discount_record.pricing_apply_stage, '')), ''), v_pricing_apply_stage, 'order_discount');
    END IF;

    IF p_discount_asset_id IS NULL AND v_distribution_mode = 'public_claim' THEN
        RETURN jsonb_build_object('success', false, 'message', '该优惠券需先领取到卡券包后使用');
    END IF;

    IF p_discount_asset_id IS NULL AND v_distribution_mode = 'user_assigned' THEN
        RETURN jsonb_build_object('success', false, 'message', '该优惠券仅限已到账户的用户使用');
    END IF;

    v_result := public.fn_validate_discount_code(
        p_product_id,
        v_effective_user_id,
        p_site,
        p_quantity,
        v_effective_discount_code,
        p_agent_id
    );

    IF COALESCE((v_result ->> 'success')::BOOLEAN, false) IS NOT TRUE THEN
        RETURN v_result;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'message', COALESCE(v_result ->> 'message', '优惠码可用'),
        'data', COALESCE(v_result -> 'data', '{}'::JSONB) || jsonb_build_object(
            'discount_id', v_discount_id,
            'discount_asset_id', p_discount_asset_id,
            'distribution_mode', v_distribution_mode,
            'campaign_tag', v_campaign_tag,
            'audience_segment', v_audience_segment,
            'is_exclusive', v_is_exclusive,
            'stack_priority', v_stack_priority,
            'pricing_apply_stage', v_pricing_apply_stage
        )
    );
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'message', '优惠码校验失败: ' || SQLERRM);
END;
$$;

DROP FUNCTION IF EXISTS public.fn_purchase_shop_item(UUID, UUID, VARCHAR, INT, VARCHAR, UUID, UUID);

CREATE OR REPLACE FUNCTION public.fn_purchase_shop_item(
    p_product_id UUID,
    p_user_id UUID,
    p_site VARCHAR,
    p_quantity INT,
    p_discount_code VARCHAR,
    p_discount_asset_id UUID,
    p_agent_id UUID
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
    v_effective_discount_code VARCHAR := NULLIF(UPPER(BTRIM(COALESCE(p_discount_code, ''))), '');
    v_discount_record RECORD;
    v_asset RECORD;
    v_result JSONB;
    v_order_id UUID;
    v_discount_id UUID := NULL;
    v_distribution_mode VARCHAR(32) := 'general_code';
    v_audience_segment VARCHAR(80) := NULL;
    v_campaign_tag VARCHAR(120) := NULL;
    v_is_exclusive BOOLEAN := true;
    v_stack_priority INT := 100;
    v_pricing_apply_stage VARCHAR(32) := 'order_discount';
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

    IF p_discount_asset_id IS NOT NULL THEN
        SELECT
            a.id,
            a.user_id,
            a.discount_id,
            a.asset_status,
            a.expires_at,
            a.source_type,
            a.source_channel,
            COALESCE(NULLIF(BTRIM(a.audience_segment), ''), NULLIF(BTRIM(d.audience_segment), '')) AS audience_segment,
            d.code,
            d.distribution_mode,
            d.campaign_tag,
            d.is_exclusive,
            d.stack_priority,
            d.pricing_apply_stage
        INTO v_asset
        FROM public.discount_user_assets a
        JOIN public.discount_codes d
            ON d.id = a.discount_id
        WHERE a.id = p_discount_asset_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RETURN jsonb_build_object('success', false, 'message', '指定卡券不存在');
        END IF;

        IF v_asset.user_id IS DISTINCT FROM v_effective_user_id THEN
            RETURN jsonb_build_object('success', false, 'message', '该卡券不属于当前账号');
        END IF;

        CASE LOWER(BTRIM(COALESCE(v_asset.asset_status, 'available')))
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

        IF v_asset.expires_at IS NOT NULL AND v_asset.expires_at < NOW() THEN
            RETURN jsonb_build_object('success', false, 'message', '该卡券已过期');
        END IF;

        IF v_effective_discount_code IS NOT NULL AND v_effective_discount_code <> v_asset.code THEN
            RETURN jsonb_build_object('success', false, 'message', '卡券与优惠码不匹配');
        END IF;

        v_effective_discount_code := v_asset.code;
        v_discount_id := v_asset.discount_id;
        v_distribution_mode := COALESCE(v_asset.distribution_mode, 'general_code');
        v_audience_segment := v_asset.audience_segment;
        v_campaign_tag := v_asset.campaign_tag;
        v_is_exclusive := COALESCE(v_asset.is_exclusive, true);
        v_stack_priority := GREATEST(1, COALESCE(v_asset.stack_priority, 100));
        v_pricing_apply_stage := COALESCE(NULLIF(BTRIM(COALESCE(v_asset.pricing_apply_stage, '')), ''), 'order_discount');
    END IF;

    IF v_effective_discount_code IS NOT NULL THEN
        SELECT
            id,
            distribution_mode,
            audience_segment,
            campaign_tag,
            is_exclusive,
            stack_priority,
            pricing_apply_stage
        INTO v_discount_record
        FROM public.discount_codes
        WHERE code = v_effective_discount_code
        LIMIT 1;

        IF FOUND THEN
            v_discount_id := COALESCE(v_discount_id, v_discount_record.id);
            v_distribution_mode := COALESCE(NULLIF(BTRIM(COALESCE(v_discount_record.distribution_mode, '')), ''), v_distribution_mode, 'general_code');
            v_audience_segment := COALESCE(NULLIF(BTRIM(COALESCE(v_audience_segment, '')), ''), NULLIF(BTRIM(COALESCE(v_discount_record.audience_segment, '')), ''));
            v_campaign_tag := COALESCE(NULLIF(BTRIM(COALESCE(v_campaign_tag, '')), ''), NULLIF(BTRIM(COALESCE(v_discount_record.campaign_tag, '')), ''));
            v_is_exclusive := COALESCE(v_discount_record.is_exclusive, v_is_exclusive, true);
            v_stack_priority := GREATEST(1, COALESCE(v_discount_record.stack_priority, v_stack_priority, 100));
            v_pricing_apply_stage := COALESCE(NULLIF(BTRIM(COALESCE(v_discount_record.pricing_apply_stage, '')), ''), v_pricing_apply_stage, 'order_discount');
        END IF;
    END IF;

    IF p_discount_asset_id IS NULL AND v_distribution_mode = 'public_claim' THEN
        RETURN jsonb_build_object('success', false, 'message', '该优惠券需先领取到卡券包后使用');
    END IF;

    IF p_discount_asset_id IS NULL AND v_distribution_mode = 'user_assigned' THEN
        RETURN jsonb_build_object('success', false, 'message', '该优惠券仅限已到账户的用户使用');
    END IF;

    v_result := public.fn_purchase_shop_item(
        p_product_id,
        v_effective_user_id,
        p_site,
        p_quantity,
        v_effective_discount_code,
        p_agent_id
    );

    IF COALESCE((v_result ->> 'success')::BOOLEAN, false) IS NOT TRUE THEN
        RETURN v_result;
    END IF;

    v_order_id := NULLIF(v_result #>> '{data,order_id}', '')::UUID;

    IF v_order_id IS NOT NULL AND v_effective_discount_code IS NOT NULL THEN
        UPDATE public.shop_orders
        SET discount_asset_id = COALESCE(p_discount_asset_id, discount_asset_id),
            discount_asset_restored = CASE
                WHEN p_discount_asset_id IS NOT NULL THEN false
                ELSE discount_asset_restored
            END,
            discount_snapshot = COALESCE(discount_snapshot, '{}'::JSONB) || jsonb_strip_nulls(jsonb_build_object(
                'discount_id', v_discount_id,
                'discount_asset_id', p_discount_asset_id,
                'distribution_mode', v_distribution_mode,
                'campaign_tag', v_campaign_tag,
                'audience_segment', v_audience_segment,
                'source_type', COALESCE(v_asset.source_type, NULL),
                'source_channel', COALESCE(v_asset.source_channel, NULL),
                'is_exclusive', v_is_exclusive,
                'stack_priority', v_stack_priority,
                'pricing_apply_stage', v_pricing_apply_stage
            ))
        WHERE id = v_order_id;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'message', COALESCE(v_result ->> 'message', '购买成功'),
        'data', COALESCE(v_result -> 'data', '{}'::JSONB) || jsonb_build_object(
            'discount_id', v_discount_id,
            'discount_asset_id', p_discount_asset_id,
            'distribution_mode', v_distribution_mode,
            'campaign_tag', v_campaign_tag,
            'audience_segment', v_audience_segment,
            'is_exclusive', v_is_exclusive,
            'stack_priority', v_stack_priority,
            'pricing_apply_stage', v_pricing_apply_stage
        )
    );
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'message', '交易失败: ' || SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_validate_discount_code(UUID, UUID, VARCHAR, INT, VARCHAR, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_validate_discount_code(UUID, UUID, VARCHAR, INT, VARCHAR, UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_validate_discount_code(UUID, UUID, VARCHAR, INT, VARCHAR, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_validate_discount_code(UUID, UUID, VARCHAR, INT, VARCHAR, UUID, UUID) TO service_role;

REVOKE ALL ON FUNCTION public.fn_purchase_shop_item(UUID, UUID, VARCHAR, INT, VARCHAR, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_purchase_shop_item(UUID, UUID, VARCHAR, INT, VARCHAR, UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_purchase_shop_item(UUID, UUID, VARCHAR, INT, VARCHAR, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_purchase_shop_item(UUID, UUID, VARCHAR, INT, VARCHAR, UUID, UUID) TO service_role;
