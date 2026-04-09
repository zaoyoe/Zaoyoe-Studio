-- ============================================
-- Discount V2 P2
-- - unified marketing asset center workflow tables
-- - stacking / pricing-waterfall rule metadata
-- - 7-arg validate / purchase wrappers expose stacking policy
-- - purchase wrapper persists stacking metadata into order snapshot
-- ============================================

ALTER TABLE public.discount_codes
    ADD COLUMN IF NOT EXISTS is_exclusive BOOLEAN,
    ADD COLUMN IF NOT EXISTS stack_priority INT,
    ADD COLUMN IF NOT EXISTS pricing_apply_stage VARCHAR(32);

UPDATE public.discount_codes
SET is_exclusive = COALESCE(is_exclusive, true),
    stack_priority = GREATEST(1, COALESCE(stack_priority, 100)),
    pricing_apply_stage = CASE
        WHEN LOWER(BTRIM(COALESCE(pricing_apply_stage, ''))) IN ('catalog_price', 'order_discount', 'balance_offset')
            THEN LOWER(BTRIM(pricing_apply_stage))
        ELSE 'order_discount'
    END
WHERE is_exclusive IS NULL
   OR stack_priority IS NULL
   OR stack_priority < 1
   OR LOWER(BTRIM(COALESCE(pricing_apply_stage, ''))) NOT IN ('catalog_price', 'order_discount', 'balance_offset');

ALTER TABLE public.discount_codes
    ALTER COLUMN is_exclusive SET DEFAULT true;

ALTER TABLE public.discount_codes
    ALTER COLUMN is_exclusive SET NOT NULL;

ALTER TABLE public.discount_codes
    ALTER COLUMN stack_priority SET DEFAULT 100;

ALTER TABLE public.discount_codes
    ALTER COLUMN stack_priority SET NOT NULL;

ALTER TABLE public.discount_codes
    ALTER COLUMN pricing_apply_stage SET DEFAULT 'order_discount';

ALTER TABLE public.discount_codes
    ALTER COLUMN pricing_apply_stage SET NOT NULL;

ALTER TABLE public.discount_codes
    DROP CONSTRAINT IF EXISTS discount_codes_stack_priority_check;

ALTER TABLE public.discount_codes
    ADD CONSTRAINT discount_codes_stack_priority_check
    CHECK (stack_priority >= 1);

ALTER TABLE public.discount_codes
    DROP CONSTRAINT IF EXISTS discount_codes_pricing_apply_stage_check;

ALTER TABLE public.discount_codes
    ADD CONSTRAINT discount_codes_pricing_apply_stage_check
    CHECK (pricing_apply_stage IN ('catalog_price', 'order_discount', 'balance_offset'));

CREATE INDEX IF NOT EXISTS idx_discount_codes_pricing_stage_priority
    ON public.discount_codes (pricing_apply_stage, stack_priority, applicable_site);

COMMENT ON COLUMN public.discount_codes.is_exclusive IS 'Whether the discount should be treated as exclusive against other marketing rights in the pricing waterfall.';
COMMENT ON COLUMN public.discount_codes.stack_priority IS 'Priority inside the pricing waterfall. Lower values execute earlier.';
COMMENT ON COLUMN public.discount_codes.pricing_apply_stage IS 'Pricing waterfall stage: catalog_price, order_discount, balance_offset.';

CREATE TABLE IF NOT EXISTS public.marketing_asset_workflows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_key VARCHAR(80) NOT NULL UNIQUE,
    workflow_name VARCHAR(120) NOT NULL,
    asset_family VARCHAR(40) NOT NULL DEFAULT 'combined',
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    schedule_label VARCHAR(120),
    sort_order INT NOT NULL DEFAULT 0,
    next_run_at TIMESTAMPTZ,
    last_run_at TIMESTAMPTZ,
    last_run_status VARCHAR(40),
    last_run_summary VARCHAR(400),
    config JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.marketing_asset_workflows
    DROP CONSTRAINT IF EXISTS marketing_asset_workflows_status_check;

ALTER TABLE public.marketing_asset_workflows
    ADD CONSTRAINT marketing_asset_workflows_status_check
    CHECK (status IN ('active', 'paused'));

CREATE INDEX IF NOT EXISTS idx_marketing_asset_workflows_sort
    ON public.marketing_asset_workflows (sort_order, workflow_key);

COMMENT ON TABLE public.marketing_asset_workflows IS 'Automation/workflow definitions for the unified marketing asset center.';

CREATE TABLE IF NOT EXISTS public.marketing_asset_workflow_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID REFERENCES public.marketing_asset_workflows(id) ON DELETE SET NULL,
    workflow_key VARCHAR(80) NOT NULL,
    trigger_source VARCHAR(40) NOT NULL DEFAULT 'manual',
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    run_status VARCHAR(40) NOT NULL DEFAULT 'success',
    summary VARCHAR(400),
    stats JSONB NOT NULL DEFAULT '{}'::JSONB
);

CREATE INDEX IF NOT EXISTS idx_marketing_asset_workflow_runs_workflow
    ON public.marketing_asset_workflow_runs (workflow_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_marketing_asset_workflow_runs_key
    ON public.marketing_asset_workflow_runs (workflow_key, started_at DESC);

COMMENT ON TABLE public.marketing_asset_workflow_runs IS 'Execution history for unified marketing asset workflows.';

CREATE OR REPLACE FUNCTION public.fn_touch_marketing_asset_workflows_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_marketing_asset_workflows_touch_updated_at ON public.marketing_asset_workflows;

CREATE TRIGGER trg_marketing_asset_workflows_touch_updated_at
BEFORE INSERT OR UPDATE ON public.marketing_asset_workflows
FOR EACH ROW
EXECUTE FUNCTION public.fn_touch_marketing_asset_workflows_updated_at();

INSERT INTO public.marketing_asset_workflows (
    workflow_key,
    workflow_name,
    asset_family,
    status,
    schedule_label,
    sort_order,
    config
)
VALUES
    (
        'discount_lifecycle_sync',
        '优惠券生命周期同步',
        'discount',
        'active',
        '建议每小时执行',
        1,
        jsonb_build_object('interval_hours', 1)
    ),
    (
        'risk_observation_closeout',
        '观察期收口',
        'discount',
        'active',
        '建议每 2 小时执行',
        2,
        jsonb_build_object('interval_hours', 2)
    ),
    (
        'retired_discount_archive',
        '历史优惠归档',
        'discount',
        'active',
        '建议每日执行',
        3,
        jsonb_build_object('interval_hours', 24, 'archive_grace_days', 30)
    ),
    (
        'marketing_asset_recap',
        '营销资产复盘快照',
        'combined',
        'active',
        '建议每日执行',
        4,
        jsonb_build_object('interval_hours', 24)
    )
ON CONFLICT (workflow_key) DO UPDATE
SET workflow_name = EXCLUDED.workflow_name,
    asset_family = EXCLUDED.asset_family,
    schedule_label = EXCLUDED.schedule_label,
    sort_order = EXCLUDED.sort_order,
    config = COALESCE(public.marketing_asset_workflows.config, '{}'::JSONB) || EXCLUDED.config;

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
