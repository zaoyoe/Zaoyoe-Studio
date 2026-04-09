-- ============================================
-- Discount V2 P1
-- - asset-backed coupon issuance and claiming
-- - wallet / claim-center metadata on discount master records
-- - discount asset usage linkage on shop orders
-- - event logs for apply / redeem / refund restore funnels
-- - 7-arg validate / purchase wrappers with asset enforcement
-- ============================================

ALTER TABLE public.discount_codes
    ADD COLUMN IF NOT EXISTS distribution_mode VARCHAR(32),
    ADD COLUMN IF NOT EXISTS claim_starts_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS claim_expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS claim_limit_per_user INT,
    ADD COLUMN IF NOT EXISTS campaign_tag VARCHAR(120),
    ADD COLUMN IF NOT EXISTS audience_segment VARCHAR(80);

UPDATE public.discount_codes
SET distribution_mode = CASE
    WHEN LOWER(BTRIM(COALESCE(distribution_mode, ''))) IN ('general_code', 'public_claim', 'user_assigned')
        THEN LOWER(BTRIM(distribution_mode))
    ELSE 'general_code'
END
WHERE distribution_mode IS NULL
   OR LOWER(BTRIM(COALESCE(distribution_mode, ''))) NOT IN ('general_code', 'public_claim', 'user_assigned');

UPDATE public.discount_codes
SET claim_limit_per_user = GREATEST(0, COALESCE(claim_limit_per_user, 0))
WHERE claim_limit_per_user IS NULL
   OR claim_limit_per_user < 0;

UPDATE public.discount_codes
SET claim_starts_at = NULL,
    claim_expires_at = NULL,
    claim_limit_per_user = 0
WHERE distribution_mode <> 'public_claim';

ALTER TABLE public.discount_codes
    ALTER COLUMN distribution_mode SET DEFAULT 'general_code';

ALTER TABLE public.discount_codes
    ALTER COLUMN distribution_mode SET NOT NULL;

ALTER TABLE public.discount_codes
    ALTER COLUMN claim_limit_per_user SET DEFAULT 0;

ALTER TABLE public.discount_codes
    ALTER COLUMN claim_limit_per_user SET NOT NULL;

ALTER TABLE public.discount_codes
    DROP CONSTRAINT IF EXISTS discount_codes_distribution_mode_check;

ALTER TABLE public.discount_codes
    ADD CONSTRAINT discount_codes_distribution_mode_check
    CHECK (distribution_mode IN ('general_code', 'public_claim', 'user_assigned'));

ALTER TABLE public.discount_codes
    DROP CONSTRAINT IF EXISTS discount_codes_claim_limit_per_user_check;

ALTER TABLE public.discount_codes
    ADD CONSTRAINT discount_codes_claim_limit_per_user_check
    CHECK (claim_limit_per_user >= 0);

ALTER TABLE public.discount_codes
    DROP CONSTRAINT IF EXISTS discount_codes_claim_window_check;

ALTER TABLE public.discount_codes
    ADD CONSTRAINT discount_codes_claim_window_check
    CHECK (
        claim_starts_at IS NULL
        OR claim_expires_at IS NULL
        OR claim_expires_at >= claim_starts_at
    );

CREATE INDEX IF NOT EXISTS idx_discount_codes_distribution_mode
    ON public.discount_codes (distribution_mode, applicable_site, claim_starts_at, claim_expires_at);

COMMENT ON COLUMN public.discount_codes.distribution_mode IS 'Coupon distribution mode: general_code, public_claim, user_assigned.';
COMMENT ON COLUMN public.discount_codes.claim_starts_at IS 'Public claim start time for claim-center coupons.';
COMMENT ON COLUMN public.discount_codes.claim_expires_at IS 'Public claim end time for claim-center coupons.';
COMMENT ON COLUMN public.discount_codes.claim_limit_per_user IS 'Maximum number of times the same user can claim this coupon asset.';
COMMENT ON COLUMN public.discount_codes.campaign_tag IS 'Marketing campaign tag used for reporting and targeting.';
COMMENT ON COLUMN public.discount_codes.audience_segment IS 'Audience segment label for ROI and funnel segmentation.';

CREATE TABLE IF NOT EXISTS public.discount_user_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    discount_id UUID NOT NULL REFERENCES public.discount_codes(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    asset_status VARCHAR(32) NOT NULL DEFAULT 'available',
    assigned_at TIMESTAMPTZ,
    claimed_at TIMESTAMPTZ,
    consumed_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    restored_at TIMESTAMPTZ,
    source_type VARCHAR(40),
    source_channel VARCHAR(80),
    audience_segment VARCHAR(80),
    source_batch_id VARCHAR(120),
    created_by UUID,
    last_order_id UUID REFERENCES public.shop_orders(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.discount_user_assets
    DROP CONSTRAINT IF EXISTS discount_user_assets_status_check;

ALTER TABLE public.discount_user_assets
    ADD CONSTRAINT discount_user_assets_status_check
    CHECK (asset_status IN ('available', 'used', 'expired', 'revoked'));

CREATE INDEX IF NOT EXISTS idx_discount_user_assets_discount_status
    ON public.discount_user_assets (discount_id, asset_status, assigned_at DESC);

CREATE INDEX IF NOT EXISTS idx_discount_user_assets_user_status
    ON public.discount_user_assets (user_id, asset_status, assigned_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_discount_user_assets_last_order_id_unique
    ON public.discount_user_assets (last_order_id)
    WHERE last_order_id IS NOT NULL;

COMMENT ON TABLE public.discount_user_assets IS 'User-owned coupon assets that back claim-center and assigned coupon flows.';
COMMENT ON COLUMN public.discount_user_assets.asset_status IS 'Asset lifecycle: available, used, expired, revoked.';
COMMENT ON COLUMN public.discount_user_assets.source_type IS 'How the asset was created, e.g. admin_assign or public_claim.';
COMMENT ON COLUMN public.discount_user_assets.source_channel IS 'Acquisition channel for segment reporting.';
COMMENT ON COLUMN public.discount_user_assets.audience_segment IS 'Audience segment attached to the asset.';

CREATE TABLE IF NOT EXISTS public.discount_event_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    discount_id UUID NOT NULL REFERENCES public.discount_codes(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    discount_asset_id UUID REFERENCES public.discount_user_assets(id) ON DELETE SET NULL,
    order_id UUID REFERENCES public.shop_orders(id) ON DELETE SET NULL,
    event_type VARCHAR(32) NOT NULL,
    site VARCHAR(20),
    source_channel VARCHAR(80),
    event_source VARCHAR(80),
    audience_segment VARCHAR(80),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.discount_event_logs
    DROP CONSTRAINT IF EXISTS discount_event_logs_event_type_check;

ALTER TABLE public.discount_event_logs
    ADD CONSTRAINT discount_event_logs_event_type_check
    CHECK (event_type IN ('discover', 'claim', 'apply_attempt', 'redeem', 'refund_restore'));

CREATE INDEX IF NOT EXISTS idx_discount_event_logs_discount_created
    ON public.discount_event_logs (discount_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_discount_event_logs_asset_created
    ON public.discount_event_logs (discount_asset_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_discount_event_logs_order_created
    ON public.discount_event_logs (order_id, created_at DESC);

COMMENT ON TABLE public.discount_event_logs IS 'Marketing funnel events for asset-backed discount coupons.';

ALTER TABLE public.shop_orders
    ADD COLUMN IF NOT EXISTS discount_asset_id UUID REFERENCES public.discount_user_assets(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS discount_asset_restored BOOLEAN;

UPDATE public.shop_orders
SET discount_asset_restored = false
WHERE discount_asset_restored IS NULL;

ALTER TABLE public.shop_orders
    ALTER COLUMN discount_asset_restored SET DEFAULT false;

ALTER TABLE public.shop_orders
    ALTER COLUMN discount_asset_restored SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_shop_orders_discount_asset_id
    ON public.shop_orders (discount_asset_id, created_at DESC);

COMMENT ON COLUMN public.shop_orders.discount_asset_id IS 'User asset used to redeem the coupon on this order, if any.';
COMMENT ON COLUMN public.shop_orders.discount_asset_restored IS 'Whether refund handling already restored the linked coupon asset.';

CREATE OR REPLACE FUNCTION public.fn_touch_discount_user_assets_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_discount_user_assets_touch_updated_at ON public.discount_user_assets;

CREATE TRIGGER trg_discount_user_assets_touch_updated_at
BEFORE INSERT OR UPDATE ON public.discount_user_assets
FOR EACH ROW
EXECUTE FUNCTION public.fn_touch_discount_user_assets_updated_at();

CREATE OR REPLACE FUNCTION public.fn_sync_discount_asset_redemption()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_asset RECORD;
BEGIN
    IF NEW.discount_asset_id IS NULL THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF OLD.discount_asset_id IS NOT DISTINCT FROM NEW.discount_asset_id THEN
            RETURN NEW;
        END IF;
    END IF;

    SELECT
        a.id,
        a.user_id,
        a.discount_id,
        COALESCE(NULLIF(BTRIM(a.source_channel), ''), 'shop_wallet') AS source_channel,
        COALESCE(NULLIF(BTRIM(a.audience_segment), ''), NULLIF(BTRIM(d.audience_segment), ''), 'all_users') AS audience_segment
    INTO v_asset
    FROM public.discount_user_assets a
    JOIN public.discount_codes d
        ON d.id = a.discount_id
    WHERE a.id = NEW.discount_asset_id;

    IF NOT FOUND THEN
        RETURN NEW;
    END IF;

    UPDATE public.discount_user_assets
    SET asset_status = 'used',
        consumed_at = COALESCE(consumed_at, COALESCE(NEW.created_at, NOW())),
        restored_at = NULL,
        last_order_id = NEW.id,
        updated_at = NOW()
    WHERE id = v_asset.id;

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
        COALESCE(NEW.user_id, v_asset.user_id),
        v_asset.id,
        NEW.id,
        'redeem',
        COALESCE(NULLIF(BTRIM(NEW.site), ''), 'cn'),
        v_asset.source_channel,
        'shop_purchase',
        v_asset.audience_segment,
        COALESCE(NEW.created_at, NOW())
    );

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_shop_orders_sync_discount_asset_redemption ON public.shop_orders;

CREATE TRIGGER trg_shop_orders_sync_discount_asset_redemption
AFTER INSERT OR UPDATE OF discount_asset_id ON public.shop_orders
FOR EACH ROW
EXECUTE FUNCTION public.fn_sync_discount_asset_redemption();

CREATE OR REPLACE FUNCTION public.fn_restore_discount_asset_on_refund()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_asset RECORD;
BEGIN
    IF NEW.discount_asset_id IS NULL THEN
        RETURN NEW;
    END IF;

    IF COALESCE(NEW.refund_status, 'none') NOT IN ('refunded', 'full_refund') THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE' AND COALESCE(OLD.refund_status, 'none') IN ('refunded', 'full_refund') THEN
        RETURN NEW;
    END IF;

    SELECT
        a.id,
        a.discount_id,
        COALESCE(NULLIF(BTRIM(a.source_channel), ''), 'shop_wallet') AS source_channel,
        COALESCE(NULLIF(BTRIM(a.audience_segment), ''), NULLIF(BTRIM(d.audience_segment), ''), 'all_users') AS audience_segment
    INTO v_asset
    FROM public.discount_user_assets a
    JOIN public.discount_codes d
        ON d.id = a.discount_id
    WHERE a.id = NEW.discount_asset_id;

    IF NOT FOUND THEN
        RETURN NEW;
    END IF;

    UPDATE public.discount_user_assets
    SET asset_status = 'available',
        restored_at = NOW(),
        consumed_at = NULL,
        last_order_id = NULL,
        updated_at = NOW()
    WHERE id = v_asset.id;

    UPDATE public.shop_orders
    SET discount_asset_restored = true
    WHERE id = NEW.id
      AND COALESCE(discount_asset_restored, false) = false;

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
        NEW.user_id,
        v_asset.id,
        NEW.id,
        'refund_restore',
        COALESCE(NULLIF(BTRIM(NEW.site), ''), 'cn'),
        v_asset.source_channel,
        'shop_refund_restore',
        v_asset.audience_segment,
        NOW()
    );

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_shop_orders_restore_discount_asset_on_refund ON public.shop_orders;

CREATE TRIGGER trg_shop_orders_restore_discount_asset_on_refund
AFTER UPDATE OF refund_status ON public.shop_orders
FOR EACH ROW
EXECUTE FUNCTION public.fn_restore_discount_asset_on_refund();

CREATE OR REPLACE FUNCTION public.fn_validate_discount_code(
    p_product_id UUID,
    p_user_id UUID DEFAULT NULL,
    p_site VARCHAR DEFAULT 'cn',
    p_quantity INT DEFAULT 1,
    p_discount_code VARCHAR DEFAULT NULL,
    p_discount_asset_id UUID DEFAULT NULL,
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
    v_effective_discount_code VARCHAR := NULLIF(UPPER(BTRIM(COALESCE(p_discount_code, ''))), '');
    v_discount_record RECORD;
    v_asset RECORD;
    v_result JSONB;
    v_distribution_mode VARCHAR(32) := 'general_code';
    v_discount_id UUID := NULL;
    v_audience_segment VARCHAR(80) := NULL;
    v_campaign_tag VARCHAR(120) := NULL;
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
            d.campaign_tag
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
    END IF;

    IF v_effective_discount_code IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '请输入优惠码');
    END IF;

    SELECT
        id,
        distribution_mode,
        audience_segment,
        campaign_tag
    INTO v_discount_record
    FROM public.discount_codes
    WHERE code = v_effective_discount_code
    LIMIT 1;

    IF FOUND THEN
        v_discount_id := COALESCE(v_discount_id, v_discount_record.id);
        v_distribution_mode := COALESCE(NULLIF(BTRIM(COALESCE(v_discount_record.distribution_mode, '')), ''), v_distribution_mode, 'general_code');
        v_audience_segment := COALESCE(NULLIF(BTRIM(COALESCE(v_audience_segment, '')), ''), NULLIF(BTRIM(COALESCE(v_discount_record.audience_segment, '')), ''));
        v_campaign_tag := COALESCE(NULLIF(BTRIM(COALESCE(v_campaign_tag, '')), ''), NULLIF(BTRIM(COALESCE(v_discount_record.campaign_tag, '')), ''));
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
            'audience_segment', v_audience_segment
        )
    );
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'message', '优惠码校验失败: ' || SQLERRM);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_purchase_shop_item(
    p_product_id UUID,
    p_user_id UUID,
    p_site VARCHAR DEFAULT 'cn',
    p_quantity INT DEFAULT 1,
    p_discount_code VARCHAR DEFAULT NULL,
    p_discount_asset_id UUID DEFAULT NULL,
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
    v_effective_discount_code VARCHAR := NULLIF(UPPER(BTRIM(COALESCE(p_discount_code, ''))), '');
    v_discount_record RECORD;
    v_asset RECORD;
    v_result JSONB;
    v_order_id UUID;
    v_discount_id UUID := NULL;
    v_distribution_mode VARCHAR(32) := 'general_code';
    v_audience_segment VARCHAR(80) := NULL;
    v_campaign_tag VARCHAR(120) := NULL;
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
            d.campaign_tag
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
    END IF;

    IF v_effective_discount_code IS NOT NULL THEN
        SELECT
            id,
            distribution_mode,
            audience_segment,
            campaign_tag
        INTO v_discount_record
        FROM public.discount_codes
        WHERE code = v_effective_discount_code
        LIMIT 1;

        IF FOUND THEN
            v_discount_id := COALESCE(v_discount_id, v_discount_record.id);
            v_distribution_mode := COALESCE(NULLIF(BTRIM(COALESCE(v_discount_record.distribution_mode, '')), ''), v_distribution_mode, 'general_code');
            v_audience_segment := COALESCE(NULLIF(BTRIM(COALESCE(v_audience_segment, '')), ''), NULLIF(BTRIM(COALESCE(v_discount_record.audience_segment, '')), ''));
            v_campaign_tag := COALESCE(NULLIF(BTRIM(COALESCE(v_campaign_tag, '')), ''), NULLIF(BTRIM(COALESCE(v_discount_record.campaign_tag, '')), ''));
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

    IF p_discount_asset_id IS NOT NULL AND v_order_id IS NOT NULL THEN
        UPDATE public.shop_orders
        SET discount_asset_id = p_discount_asset_id,
            discount_asset_restored = false,
            discount_snapshot = COALESCE(discount_snapshot, '{}'::JSONB) || jsonb_build_object(
                'discount_id', v_discount_id,
                'discount_asset_id', p_discount_asset_id,
                'distribution_mode', v_distribution_mode,
                'campaign_tag', v_campaign_tag,
                'audience_segment', v_audience_segment,
                'source_type', COALESCE(v_asset.source_type, 'asset_wallet'),
                'source_channel', COALESCE(v_asset.source_channel, 'shop_wallet')
            )
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
            'audience_segment', v_audience_segment
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

REVOKE ALL ON FUNCTION public.fn_validate_discount_code(UUID, UUID, VARCHAR, INT, VARCHAR, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_validate_discount_code(UUID, UUID, VARCHAR, INT, VARCHAR, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.fn_validate_discount_code(UUID, UUID, VARCHAR, INT, VARCHAR, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_validate_discount_code(UUID, UUID, VARCHAR, INT, VARCHAR, UUID) TO service_role;

REVOKE ALL ON FUNCTION public.fn_purchase_shop_item(UUID, UUID, VARCHAR, INT, VARCHAR, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_purchase_shop_item(UUID, UUID, VARCHAR, INT, VARCHAR, UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_purchase_shop_item(UUID, UUID, VARCHAR, INT, VARCHAR, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_purchase_shop_item(UUID, UUID, VARCHAR, INT, VARCHAR, UUID, UUID) TO service_role;

REVOKE ALL ON FUNCTION public.fn_purchase_shop_item(UUID, UUID, VARCHAR, INT, VARCHAR, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_purchase_shop_item(UUID, UUID, VARCHAR, INT, VARCHAR, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.fn_purchase_shop_item(UUID, UUID, VARCHAR, INT, VARCHAR, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_purchase_shop_item(UUID, UUID, VARCHAR, INT, VARCHAR, UUID) TO service_role;
