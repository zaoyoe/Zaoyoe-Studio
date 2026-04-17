-- ============================================
-- Add atomic public-claim discount RPC
-- - serialize claim requests per user+discount
-- - enforce claim_limit_per_user inside the same transaction
-- - prevent duplicate assets caused by repeated clicks / concurrent requests
-- ============================================

CREATE OR REPLACE FUNCTION public.fn_claim_public_discount(
    p_discount_id UUID DEFAULT NULL,
    p_discount_code VARCHAR DEFAULT NULL,
    p_user_id UUID DEFAULT NULL,
    p_site VARCHAR DEFAULT 'cn',
    p_source_channel VARCHAR DEFAULT NULL
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
    v_site VARCHAR := LOWER(BTRIM(COALESCE(p_site, 'cn')));
    v_source_channel VARCHAR := LOWER(BTRIM(COALESCE(p_source_channel, 'claim_center')));
    v_lookup_discount_id UUID := p_discount_id;
    v_lookup_discount_code VARCHAR := NULLIF(UPPER(BTRIM(COALESCE(p_discount_code, ''))), '');
    v_discount RECORD;
    v_asset RECORD;
    v_claim_count INT := 0;
    v_claim_limit_per_user INT := 0;
    v_now TIMESTAMPTZ := NOW();
    v_lock_name TEXT := NULL;
BEGIN
    IF v_request_role = 'service_role' THEN
        v_effective_user_id := COALESCE(p_user_id, v_request_user_id);
    ELSE
        IF v_request_user_id IS NULL THEN
            RETURN jsonb_build_object('success', false, 'status_code', 401, 'message', '请先登录');
        END IF;

        IF p_user_id IS NOT NULL AND p_user_id <> v_request_user_id THEN
            RETURN jsonb_build_object('success', false, 'status_code', 403, 'message', '非法的用户上下文');
        END IF;

        v_effective_user_id := v_request_user_id;
    END IF;

    IF v_effective_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'status_code', 401, 'message', '缺少有效的用户身份');
    END IF;

    IF v_site NOT IN ('cn', 'intl') THEN
        RETURN jsonb_build_object('success', false, 'status_code', 400, 'message', '站点参数无效');
    END IF;

    IF v_lookup_discount_id IS NULL AND v_lookup_discount_code IS NULL THEN
        RETURN jsonb_build_object('success', false, 'status_code', 400, 'message', '缺少优惠券标识');
    END IF;

    SELECT
        d.id,
        d.code
    INTO v_discount
    FROM public.discount_codes d
    WHERE (
        v_lookup_discount_id IS NOT NULL
        AND d.id = v_lookup_discount_id
    ) OR (
        v_lookup_discount_id IS NULL
        AND v_lookup_discount_code IS NOT NULL
        AND d.code = v_lookup_discount_code
    )
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'status_code', 404, 'message', '优惠券不存在');
    END IF;

    v_lock_name := v_effective_user_id::TEXT || ':' || v_discount.id::TEXT;
    PERFORM pg_advisory_xact_lock(60425, hashtext(v_lock_name));

    SELECT
        d.id,
        d.code,
        d.is_active,
        d.applicable_site,
        d.expires_at,
        d.distribution_mode,
        d.claim_starts_at,
        d.claim_expires_at,
        d.claim_limit_per_user,
        d.campaign_tag,
        d.audience_segment
    INTO v_discount
    FROM public.discount_codes d
    WHERE d.id = v_discount.id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'status_code', 404, 'message', '优惠券不存在');
    END IF;

    IF LOWER(BTRIM(COALESCE(v_discount.distribution_mode, ''))) <> 'public_claim' THEN
        RETURN jsonb_build_object('success', false, 'status_code', 409, 'message', '该优惠券当前不支持公开领取');
    END IF;

    IF COALESCE(v_discount.applicable_site, 'all') NOT IN ('all', v_site) THEN
        RETURN jsonb_build_object('success', false, 'status_code', 409, 'message', '当前站点下不可领取该优惠券');
    END IF;

    IF COALESCE(v_discount.is_active, true) = false THEN
        RETURN jsonb_build_object('success', false, 'status_code', 409, 'message', '该优惠券当前未开放领取');
    END IF;

    IF v_discount.claim_starts_at IS NOT NULL AND v_discount.claim_starts_at > v_now THEN
        RETURN jsonb_build_object('success', false, 'status_code', 409, 'message', '该优惠券尚未开始领取');
    END IF;

    IF v_discount.claim_expires_at IS NOT NULL AND v_discount.claim_expires_at <= v_now THEN
        RETURN jsonb_build_object('success', false, 'status_code', 409, 'message', '该优惠券领取期已结束');
    END IF;

    v_claim_limit_per_user := GREATEST(0, COALESCE(v_discount.claim_limit_per_user, 0));

    SELECT COUNT(*)::INT
    INTO v_claim_count
    FROM public.discount_user_assets a
    WHERE a.user_id = v_effective_user_id
      AND a.discount_id = v_discount.id;

    IF v_claim_limit_per_user > 0 AND v_claim_count >= v_claim_limit_per_user THEN
        RETURN jsonb_build_object('success', false, 'status_code', 409, 'message', '你已达到该优惠券的领取上限');
    END IF;

    INSERT INTO public.discount_user_assets (
        discount_id,
        user_id,
        asset_status,
        assigned_at,
        claimed_at,
        expires_at,
        source_type,
        source_channel,
        audience_segment,
        source_batch_id,
        created_by,
        restored_at,
        consumed_at,
        last_order_id
    )
    VALUES (
        v_discount.id,
        v_effective_user_id,
        'available',
        v_now,
        v_now,
        v_discount.expires_at,
        'public_claim',
        CASE WHEN v_source_channel <> '' THEN v_source_channel ELSE 'claim_center' END,
        LOWER(BTRIM(COALESCE(v_discount.audience_segment, 'public_claim'))),
        NULL,
        NULL,
        NULL,
        NULL,
        NULL
    )
    RETURNING
        id,
        discount_id,
        user_id,
        asset_status,
        assigned_at,
        claimed_at,
        expires_at,
        source_type,
        source_channel,
        audience_segment
    INTO v_asset;

    v_claim_count := v_claim_count + 1;

    RETURN jsonb_build_object(
        'success', true,
        'message', '领取成功',
        'asset', jsonb_build_object(
            'id', v_asset.id,
            'discount_id', v_asset.discount_id,
            'user_id', v_asset.user_id,
            'asset_status', v_asset.asset_status,
            'assigned_at', v_asset.assigned_at,
            'claimed_at', v_asset.claimed_at,
            'expires_at', v_asset.expires_at,
            'source_type', v_asset.source_type,
            'source_channel', v_asset.source_channel,
            'audience_segment', v_asset.audience_segment
        ),
        'discount', jsonb_build_object(
            'id', v_discount.id,
            'code', v_discount.code,
            'campaign_tag', v_discount.campaign_tag,
            'audience_segment', v_discount.audience_segment,
            'claim_limit_per_user', v_claim_limit_per_user,
            'claimed_count', v_claim_count,
            'remaining_claims', CASE
                WHEN v_claim_limit_per_user > 0 THEN GREATEST(0, v_claim_limit_per_user - v_claim_count)
                ELSE NULL
            END
        )
    );
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'status_code', 500, 'message', '领取失败: ' || SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_claim_public_discount(UUID, VARCHAR, UUID, VARCHAR, VARCHAR) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_claim_public_discount(UUID, VARCHAR, UUID, VARCHAR, VARCHAR) TO authenticated, service_role;
