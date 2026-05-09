-- ============================================
-- Optimize shop purchase RPC hot path
-- - collapse repeated shop_orders purchase-limit scans into one aggregate query
-- - reuse the locked points_balance row instead of re-reading balances
-- - write the common KEY delivery status directly during order insert
-- ============================================

CREATE TABLE IF NOT EXISTS public.shop_purchase_reward_jobs (
    order_id UUID PRIMARY KEY REFERENCES public.shop_orders(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    product_id UUID NOT NULL,
    product_name VARCHAR(255),
    site VARCHAR(16) NOT NULL DEFAULT 'cn',
    quantity INT NOT NULL DEFAULT 1,
    base_unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
    total_price NUMERIC(12,2) NOT NULL DEFAULT 0,
    agent_id UUID,
    agent_markup NUMERIC(12,2) NOT NULL DEFAULT 0,
    status VARCHAR(24) NOT NULL DEFAULT 'pending',
    attempt_count INT NOT NULL DEFAULT 0,
    last_error TEXT,
    processed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.shop_purchase_reward_jobs ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_shop_purchase_reward_jobs_status
    ON public.shop_purchase_reward_jobs (status, created_at)
    WHERE status <> 'processed';

CREATE OR REPLACE FUNCTION public.fn_process_shop_purchase_rewards(
    p_order_id UUID,
    p_site VARCHAR DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_now TIMESTAMPTZ := NOW();
    v_job RECORD;
    v_site VARCHAR;
    v_affiliate_config JSONB;
    v_inviter_id UUID;
    v_commission NUMERIC(12,2) := 0;
    v_commission_rate FLOAT := 0.10;
    v_affiliate_reason TEXT;
    v_affiliate_reference_id TEXT;
    v_agent_profit NUMERIC(12,2) := 0;
    v_pending_reward RECORD;
    v_processed_rewards INT := 0;
BEGIN
    IF p_order_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '缺少订单号');
    END IF;

    SELECT *
    INTO v_job
    FROM public.shop_purchase_reward_jobs
    WHERE order_id = p_order_id
    FOR UPDATE SKIP LOCKED;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', true, 'skipped', 'job_not_found_or_locked');
    END IF;

    IF COALESCE(v_job.status, '') = 'processed' THEN
        RETURN jsonb_build_object('success', true, 'skipped', 'already_processed');
    END IF;

    v_site := LOWER(BTRIM(COALESCE(NULLIF(p_site, ''), v_job.site, 'cn')));
    IF v_site NOT IN ('cn', 'intl') THEN
        v_site := 'cn';
    END IF;

    UPDATE public.shop_purchase_reward_jobs
    SET status = 'processing',
        attempt_count = COALESCE(attempt_count, 0) + 1,
        last_error = NULL,
        updated_at = v_now
    WHERE order_id = p_order_id;

    SELECT config_value
    INTO v_affiliate_config
    FROM public.system_config
    WHERE config_key = 'affiliate_program';

    IF v_job.agent_id IS NOT NULL THEN
        v_commission_rate := COALESCE(
            (v_affiliate_config->>'commission_rate_agent')::FLOAT,
            (SELECT value::FLOAT FROM public.system_settings WHERE key = 'commission_rate_agent'),
            0.10
        );
        v_affiliate_reason := '推广返佣 (' || (v_commission_rate * 100) || '%): 下线购买分销资源';
        v_affiliate_reference_id := 'AFF_REW_' || p_order_id::TEXT;
    ELSE
        v_commission_rate := COALESCE(
            (v_affiliate_config->>'commission_rate_shop')::FLOAT,
            (SELECT value::FLOAT FROM public.system_settings WHERE key = 'commission_rate_shop'),
            0.10
        );
        v_affiliate_reason := '推广返佣 (' || (v_commission_rate * 100) || '%): 下线购买商品';
        v_affiliate_reference_id := 'AFFILIATE_REWARD_' || p_order_id::TEXT;
    END IF;

    SELECT invited_by
    INTO v_inviter_id
    FROM public.profiles
    WHERE id = v_job.user_id;

    IF v_inviter_id IS NOT NULL AND COALESCE(v_job.total_price, 0) > 0 THEN
        v_commission := ROUND((COALESCE(v_job.base_unit_price, 0) * COALESCE(v_job.quantity, 1) * v_commission_rate)::NUMERIC, 2);

        IF v_commission > 0 AND NOT EXISTS (
            SELECT 1
            FROM public.points_ledger
            WHERE user_id = v_inviter_id
              AND reference_id = v_affiliate_reference_id
              AND COALESCE(site, 'cn') = v_site
        ) THEN
            INSERT INTO public.points_balance (user_id, site, paid_balance, bonus_balance)
            VALUES (v_inviter_id, v_site, 0, v_commission)
            ON CONFLICT (user_id, site) DO UPDATE
            SET bonus_balance = ROUND(COALESCE(points_balance.bonus_balance, 0) + EXCLUDED.bonus_balance, 2),
                updated_at = v_now;

            INSERT INTO public.points_ledger (user_id, amount, reason, reference_id, site)
            VALUES (v_inviter_id, v_commission, v_affiliate_reason, v_affiliate_reference_id, v_site);

            v_processed_rewards := v_processed_rewards + 1;
        END IF;
    END IF;

    IF v_job.agent_id IS NOT NULL
        AND COALESCE(v_job.agent_markup, 0) > 0
        AND COALESCE(v_job.total_price, 0) > 0 THEN
        v_agent_profit := ROUND(COALESCE(v_job.agent_markup, 0) * COALESCE(v_job.quantity, 1), 2);

        IF v_agent_profit > 0 AND NOT EXISTS (
            SELECT 1
            FROM public.points_ledger
            WHERE user_id = v_job.agent_id
              AND reference_id = 'AGENT_PROF_' || p_order_id::TEXT
              AND COALESCE(site, 'cn') = v_site
        ) THEN
            INSERT INTO public.points_balance (user_id, site, paid_balance, bonus_balance)
            VALUES (v_job.agent_id, v_site, v_agent_profit, 0)
            ON CONFLICT (user_id, site) DO UPDATE
            SET paid_balance = ROUND(COALESCE(points_balance.paid_balance, 0) + EXCLUDED.paid_balance, 2),
                updated_at = v_now;

            INSERT INTO public.points_ledger (user_id, amount, reason, reference_id, site)
            VALUES (v_job.agent_id, v_agent_profit, '代理商网店利润差额: ' || COALESCE(v_job.product_name, '商城商品'), 'AGENT_PROF_' || p_order_id::TEXT, v_site);

            v_processed_rewards := v_processed_rewards + 1;
        END IF;
    END IF;

    SELECT *
    INTO v_pending_reward
    FROM public.pending_referral_rewards
    WHERE invitee_id = v_job.user_id
    FOR UPDATE;

    IF FOUND AND COALESCE(v_job.total_price, 0) > 0 THEN
        IF NOT EXISTS (
            SELECT 1
            FROM public.points_ledger
            WHERE user_id = v_pending_reward.inviter_id
              AND reference_id = 'REG_REWARD_UNLOCK_' || p_order_id::TEXT
              AND COALESCE(site, 'cn') = v_site
        ) THEN
            INSERT INTO public.points_balance (user_id, site, paid_balance, bonus_balance)
            VALUES (v_pending_reward.inviter_id, v_site, 0, ROUND(v_pending_reward.reward_points, 2))
            ON CONFLICT (user_id, site) DO UPDATE
            SET bonus_balance = ROUND(COALESCE(points_balance.bonus_balance, 0) + EXCLUDED.bonus_balance, 2),
                updated_at = v_now;

            INSERT INTO public.points_ledger (user_id, amount, reason, reference_id, site)
            VALUES (
                v_pending_reward.inviter_id,
                ROUND(v_pending_reward.reward_points, 2),
                '拉新固定奖励 (下线首单激活)',
                'REG_REWARD_UNLOCK_' || p_order_id::TEXT,
                v_site
            );

            v_processed_rewards := v_processed_rewards + 1;
        END IF;

        DELETE FROM public.pending_referral_rewards
        WHERE id = v_pending_reward.id;
    END IF;

    UPDATE public.shop_purchase_reward_jobs
    SET status = 'processed',
        processed_at = v_now,
        updated_at = v_now,
        last_error = NULL
    WHERE order_id = p_order_id;

    RETURN jsonb_build_object(
        'success', true,
        'order_id', p_order_id,
        'processed_rewards', v_processed_rewards
    );
EXCEPTION WHEN OTHERS THEN
    UPDATE public.shop_purchase_reward_jobs
    SET status = 'failed',
        attempt_count = COALESCE(attempt_count, 0) + 1,
        last_error = SQLERRM,
        updated_at = NOW()
    WHERE order_id = p_order_id;

    RETURN jsonb_build_object('success', false, 'message', '奖励处理失败: ' || SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_process_shop_purchase_rewards(UUID, VARCHAR) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_process_shop_purchase_rewards(UUID, VARCHAR) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_purchase_shop_item(
    p_product_id UUID,
    p_user_id UUID,
    p_site VARCHAR DEFAULT 'cn',
    p_quantity INT DEFAULT 1,
    p_discount_code VARCHAR DEFAULT NULL,
    p_agent_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_now TIMESTAMPTZ := NOW();
    v_request_user_id UUID := auth.uid();
    v_request_role TEXT := COALESCE(auth.role(), '');
    v_effective_user_id UUID;
    v_site VARCHAR := LOWER(BTRIM(COALESCE(p_site, 'cn')));
    v_max_quantity INT := 99;
    v_product_max_quantity INT := 99;
    v_unlimited_shop_purchases BOOLEAN := FALSE;

    v_product RECORD;
    v_base_unit_price NUMERIC(12,2);
    v_actual_unit_price NUMERIC(12,2);
    v_total_price NUMERIC(12,2);
    v_gross_total NUMERIC(12,2) := 0;
    v_final_total NUMERIC(12,2);

    v_discount_record RECORD;
    v_discount_amount NUMERIC(12,2) := 0;
    v_discount_code VARCHAR := NULL;
    v_applied_discount_type VARCHAR(32) := NULL;
    v_applied_discount_value INT := NULL;
    v_user_discount_use_count INT := 0;
    v_effective_lifecycle_status VARCHAR(32);
    v_discount_snapshot JSONB := NULL;
    v_discount_version INT := NULL;
    v_has_effective_discount BOOLEAN := FALSE;

    v_user_balance NUMERIC(12,2);
    v_balance_bonus NUMERIC(12,2) := 0;
    v_balance_paid NUMERIC(12,2) := 0;
    v_inventory_ids UUID[];
    v_inventory_primary_id UUID := NULL;
    v_contents TEXT[];

    v_order_id UUID;
    v_task_id UUID;
    v_rule JSONB;
    v_rule_qty INT;
    v_rule_price NUMERIC(12,2);

    v_agent_price NUMERIC(12,2) := NULL;
    v_agent_markup NUMERIC(12,2) := 0;

    v_user_product_total_quantity INT := 0;
    v_user_product_24h_quantity INT := 0;
    v_user_product_window_quantity INT := 0;
    v_remaining_quantity INT := 0;
    v_purchase_limit_lock_name TEXT := NULL;
    v_purchase_limit_24h_started_at TIMESTAMPTZ := NULL;
    v_purchase_limit_window_started_at TIMESTAMPTZ := NULL;
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

    IF v_site NOT IN ('cn', 'intl') THEN
        RETURN jsonb_build_object('success', false, 'message', '站点参数无效');
    END IF;

    IF p_quantity < 1 THEN
        RETURN jsonb_build_object('success', false, 'message', '购买数量必须大于0');
    END IF;

    SELECT COALESCE(unlimited_shop_purchases, false)
    INTO v_unlimited_shop_purchases
    FROM public.user_purchase_entitlements
    WHERE user_id = v_effective_user_id;

    v_unlimited_shop_purchases := COALESCE(v_unlimited_shop_purchases, false);

    IF NOT v_unlimited_shop_purchases AND p_quantity > v_max_quantity THEN
        RETURN jsonb_build_object('success', false, 'message', '单次购买数量不能超过' || v_max_quantity);
    END IF;

    SELECT
        id,
        category,
        price_points,
        price_points_intl,
        name,
        quantity_rules,
        flash_sale_end,
        flash_sale_price,
        delivery_type,
        webhook_target,
        usage_instructions,
        show_usage_instructions,
        max_purchase_quantity,
        purchase_limit_24h_quantity,
        purchase_limit_window_minutes,
        purchase_limit_window_quantity,
        per_account_purchase_limit
    INTO v_product
    FROM public.shop_products
    WHERE id = p_product_id
      AND is_active = true;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', '商品不存在或已下架');
    END IF;

    IF NOT v_unlimited_shop_purchases THEN
        v_product_max_quantity := LEAST(
            v_max_quantity,
            GREATEST(1, COALESCE(v_product.max_purchase_quantity, v_max_quantity))
        );

        IF p_quantity > v_product_max_quantity THEN
            RETURN jsonb_build_object('success', false, 'message', '当前商品单次最多购买' || v_product_max_quantity || '件');
        END IF;

        IF v_product.per_account_purchase_limit IS NOT NULL
            OR v_product.purchase_limit_24h_quantity IS NOT NULL
            OR (
                v_product.purchase_limit_window_minutes IS NOT NULL
                AND v_product.purchase_limit_window_quantity IS NOT NULL
            ) THEN
            v_purchase_limit_lock_name := v_effective_user_id::TEXT || ':' || p_product_id::TEXT;
            PERFORM pg_advisory_xact_lock(60424, hashtext(v_purchase_limit_lock_name));

            v_purchase_limit_24h_started_at := v_now - INTERVAL '24 hours';
            IF v_product.purchase_limit_window_minutes IS NOT NULL
                AND v_product.purchase_limit_window_quantity IS NOT NULL THEN
                v_purchase_limit_window_started_at := v_now - make_interval(mins => v_product.purchase_limit_window_minutes);
            END IF;

            SELECT
                COALESCE(SUM(COALESCE(item_count, 0)), 0)::INT,
                COALESCE(SUM(CASE
                    WHEN v_product.purchase_limit_24h_quantity IS NOT NULL
                        AND created_at >= v_purchase_limit_24h_started_at
                        THEN COALESCE(item_count, 0)
                    ELSE 0
                END), 0)::INT,
                COALESCE(SUM(CASE
                    WHEN v_purchase_limit_window_started_at IS NOT NULL
                        AND created_at >= v_purchase_limit_window_started_at
                        THEN COALESCE(item_count, 0)
                    ELSE 0
                END), 0)::INT
            INTO
                v_user_product_total_quantity,
                v_user_product_24h_quantity,
                v_user_product_window_quantity
            FROM public.shop_orders
            WHERE user_id = v_effective_user_id
              AND product_id = p_product_id
              AND COALESCE(refund_status, 'none') NOT IN ('refunded', 'full_refund');
        END IF;

        IF v_product.per_account_purchase_limit IS NOT NULL THEN
            v_remaining_quantity := GREATEST(0, v_product.per_account_purchase_limit - v_user_product_total_quantity);
            IF v_remaining_quantity < p_quantity THEN
                IF v_remaining_quantity = 0 THEN
                    RETURN jsonb_build_object('success', false, 'message', '当前账号已达到该商品的累计限购上限');
                END IF;

                RETURN jsonb_build_object('success', false, 'message', '当前账号最多还可购买' || v_remaining_quantity || '件');
            END IF;
        END IF;

        IF v_product.purchase_limit_24h_quantity IS NOT NULL THEN
            v_remaining_quantity := GREATEST(0, v_product.purchase_limit_24h_quantity - v_user_product_24h_quantity);
            IF v_remaining_quantity < p_quantity THEN
                IF v_remaining_quantity = 0 THEN
                    RETURN jsonb_build_object('success', false, 'message', '当前账号在24小时内已达到该商品的购买上限');
                END IF;

                RETURN jsonb_build_object('success', false, 'message', '当前账号在24小时内最多还可购买' || v_remaining_quantity || '件');
            END IF;
        END IF;

        IF v_purchase_limit_window_started_at IS NOT NULL
            AND v_product.purchase_limit_window_quantity IS NOT NULL THEN
            v_remaining_quantity := GREATEST(0, v_product.purchase_limit_window_quantity - v_user_product_window_quantity);
            IF v_remaining_quantity < p_quantity THEN
                IF v_remaining_quantity = 0 THEN
                    RETURN jsonb_build_object(
                        'success', false,
                        'message', '当前账号在最近' || v_product.purchase_limit_window_minutes || '分钟内已达到该商品的购买上限'
                    );
                END IF;

                RETURN jsonb_build_object(
                    'success', false,
                    'message', '当前账号在最近' || v_product.purchase_limit_window_minutes || '分钟内最多还可购买' || v_remaining_quantity || '件'
                );
            END IF;
        END IF;
    END IF;

    IF v_site = 'intl' THEN
        v_base_unit_price := v_product.price_points_intl;
    ELSE
        v_base_unit_price := v_product.price_points;
    END IF;

    IF v_base_unit_price IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '商品未在当前站点销售');
    END IF;

    IF v_product.flash_sale_end IS NOT NULL
        AND v_product.flash_sale_end > v_now
        AND v_product.flash_sale_price IS NOT NULL THEN
        v_base_unit_price := LEAST(v_base_unit_price, v_product.flash_sale_price);
    ELSIF v_product.quantity_rules IS NOT NULL AND jsonb_array_length(v_product.quantity_rules) > 0 THEN
        FOR v_rule IN SELECT * FROM jsonb_array_elements(v_product.quantity_rules)
        LOOP
            v_rule_qty := (v_rule->>'qty')::INT;
            v_rule_price := COALESCE(NULLIF(BTRIM(COALESCE(v_rule->>'price', '')), ''), '0')::NUMERIC(12,2);
            IF p_quantity >= v_rule_qty AND v_rule_price < v_base_unit_price THEN
                v_base_unit_price := v_rule_price;
            END IF;
        END LOOP;
    END IF;

    v_actual_unit_price := v_base_unit_price;

    IF p_agent_id IS NOT NULL THEN
        SELECT custom_price
        INTO v_agent_price
        FROM public.agent_prices
        WHERE agent_id = p_agent_id
          AND product_id = p_product_id;

        IF v_agent_price IS NOT NULL AND v_agent_price > v_base_unit_price THEN
            v_actual_unit_price := v_agent_price;
            v_agent_markup := ROUND(v_agent_price - v_base_unit_price, 2);
        END IF;
    END IF;

    v_total_price := ROUND(v_actual_unit_price * p_quantity, 2);
    v_gross_total := v_total_price;

    v_discount_code := NULLIF(UPPER(BTRIM(COALESCE(p_discount_code, ''))), '');
    IF v_discount_code IS NOT NULL THEN
        SELECT *
        INTO v_discount_record
        FROM public.discount_codes
        WHERE code = v_discount_code
        FOR UPDATE;

        IF NOT FOUND THEN
            RETURN jsonb_build_object('success', false, 'message', '无效的优惠码');
        END IF;

        v_effective_lifecycle_status := COALESCE(
            NULLIF(BTRIM(COALESCE(v_discount_record.lifecycle_status, '')), ''),
            CASE WHEN COALESCE(v_discount_record.is_active, true) THEN 'active' ELSE 'paused_manual' END
        );

        IF v_effective_lifecycle_status = 'archived' THEN
            RETURN jsonb_build_object('success', false, 'message', '该优惠码已归档');
        END IF;

        IF v_discount_record.starts_at IS NOT NULL AND v_discount_record.starts_at > v_now THEN
            RETURN jsonb_build_object('success', false, 'message', '该优惠码尚未生效');
        END IF;

        IF v_discount_record.expires_at IS NOT NULL AND v_discount_record.expires_at < v_now THEN
            RETURN jsonb_build_object('success', false, 'message', '该优惠码已过期');
        END IF;

        IF COALESCE(v_discount_record.is_active, true) = false OR v_effective_lifecycle_status IN ('paused_manual', 'paused_risk') THEN
            IF v_effective_lifecycle_status = 'paused_risk' OR COALESCE(v_discount_record.status_reason, '') LIKE 'risk_%' THEN
                RETURN jsonb_build_object('success', false, 'message', '该优惠码当前因风控暂停使用');
            END IF;

            RETURN jsonb_build_object('success', false, 'message', '该优惠码当前已停用');
        END IF;

        IF v_discount_record.max_uses > 0 AND v_discount_record.used_count >= v_discount_record.max_uses THEN
            RETURN jsonb_build_object('success', false, 'message', '该优惠码的使用次数已达上限');
        END IF;

        IF v_discount_record.applicable_site IS NOT NULL
            AND v_discount_record.applicable_site <> v_site THEN
            RETURN jsonb_build_object('success', false, 'message', '该优惠码仅适用于指定站点');
        END IF;

        IF COALESCE(v_discount_record.scope_type, 'all') = 'category'
            AND COALESCE(v_product.category, '') <> COALESCE(v_discount_record.scope_category, '') THEN
            RETURN jsonb_build_object('success', false, 'message', '该优惠码仅适用于指定分类商品');
        END IF;

        IF COALESCE(v_discount_record.scope_type, 'all') = 'product'
            AND v_discount_record.scope_product_id IS DISTINCT FROM p_product_id THEN
            RETURN jsonb_build_object('success', false, 'message', '该优惠码仅适用于指定商品');
        END IF;

        IF COALESCE(v_discount_record.max_uses_per_user, 0) > 0 THEN
            SELECT COUNT(*)::INT
            INTO v_user_discount_use_count
            FROM public.shop_orders
            WHERE user_id = v_effective_user_id
              AND discount_code = v_discount_code
              AND COALESCE(refund_status, 'none') NOT IN ('refunded', 'full_refund');

            IF v_user_discount_use_count >= v_discount_record.max_uses_per_user THEN
                RETURN jsonb_build_object('success', false, 'message', '当前账号已达到该优惠码的使用上限');
            END IF;
        END IF;

        v_applied_discount_type := v_discount_record.discount_type;
        v_applied_discount_value := v_discount_record.discount_value;

        IF v_discount_record.discount_type = 'percent' THEN
            SELECT
                resolved.discount_amount,
                resolved.final_total,
                resolved.has_effective_discount
            INTO
                v_discount_amount,
                v_final_total,
                v_has_effective_discount
            FROM public.fn_resolve_shop_percent_discount(
                v_total_price,
                v_discount_record.discount_value,
                COALESCE(v_discount_record.allow_zero_total, false)
            ) AS resolved;

            IF NOT v_has_effective_discount THEN
                RETURN jsonb_build_object('success', false, 'message', '当前商品暂无可优惠金额，无法使用这张优惠码');
            END IF;
        ELSIF v_discount_record.discount_type = 'fixed' THEN
            v_discount_amount := LEAST(v_total_price, v_discount_record.discount_value::NUMERIC(12,2));
            v_final_total := ROUND(GREATEST(0, v_total_price - v_discount_amount), 2);
            v_has_effective_discount := v_discount_amount > 0;
        ELSE
            v_final_total := v_total_price;
            v_has_effective_discount := false;
        END IF;

        IF v_discount_amount > 0
            AND v_final_total = 0
            AND NOT COALESCE(v_discount_record.allow_zero_total, false) THEN
            RETURN jsonb_build_object('success', false, 'message', '该优惠码不允许全额抵扣');
        END IF;

        v_discount_version := COALESCE(v_discount_record.version_no, 1);
        v_discount_snapshot := jsonb_build_object(
            'code', v_discount_code,
            'version_no', v_discount_version,
            'discount_type', v_discount_record.discount_type,
            'discount_value', v_discount_record.discount_value,
            'max_uses', v_discount_record.max_uses,
            'max_uses_per_user', v_discount_record.max_uses_per_user,
            'starts_at', v_discount_record.starts_at,
            'expires_at', v_discount_record.expires_at,
            'lifecycle_status', v_effective_lifecycle_status,
            'status_reason', v_discount_record.status_reason,
            'applicable_site', v_discount_record.applicable_site,
            'scope_type', COALESCE(v_discount_record.scope_type, 'all'),
            'scope_category', v_discount_record.scope_category,
            'scope_product_id', v_discount_record.scope_product_id,
            'allow_zero_total', COALESCE(v_discount_record.allow_zero_total, false),
            'recovery_strategy', COALESCE(v_discount_record.recovery_strategy, 'manual_only'),
            'observation_window_hours', COALESCE(v_discount_record.observation_window_hours, 24),
            'observation_ends_at', v_discount_record.observation_ends_at,
            'site', v_site,
            'quantity', p_quantity,
            'unit_price', v_actual_unit_price,
            'subtotal', v_gross_total,
            'discount_amount', v_discount_amount,
            'final_total', v_final_total
        );

        v_total_price := v_final_total;
    END IF;

    IF v_product.delivery_type = 'KEY' OR v_product.delivery_type IS NULL THEN
        SELECT array_agg(id), array_agg(content)
        INTO v_inventory_ids, v_contents
        FROM (
            SELECT id, content
            FROM public.shop_inventory
            WHERE product_id = p_product_id
              AND status = 'available'
            LIMIT p_quantity
            FOR UPDATE SKIP LOCKED
        ) t;

        IF v_inventory_ids IS NULL OR array_length(v_inventory_ids, 1) < p_quantity THEN
            RETURN jsonb_build_object('success', false, 'message', '商品库存不足，无法满足当前数量');
        END IF;

        IF array_length(v_inventory_ids, 1) = 1 THEN
            v_inventory_primary_id := v_inventory_ids[1];
        END IF;
    ELSIF v_product.delivery_type = 'API' THEN
        v_contents := ARRAY['您的订单信息已通过 API Webhook 推送至第三方商户，请留意履约通知。'];
    ELSE
        RETURN jsonb_build_object('success', false, 'message', '未知的发货模式: ' || v_product.delivery_type);
    END IF;

    SELECT total_balance, bonus_balance, paid_balance
    INTO v_user_balance, v_balance_bonus, v_balance_paid
    FROM public.points_balance
    WHERE user_id = v_effective_user_id
      AND site = v_site
    FOR UPDATE;

    IF v_user_balance IS NULL OR v_user_balance < v_total_price THEN
        RETURN jsonb_build_object('success', false, 'message', '积分余额不足');
    END IF;

    IF v_total_price > 0 THEN
        DECLARE
            v_deduct_bonus NUMERIC(12,2) := 0;
            v_deduct_paid NUMERIC(12,2) := 0;
            v_remaining_cost NUMERIC(12,2) := v_total_price;
        BEGIN
            IF COALESCE(v_balance_bonus, 0) >= v_remaining_cost THEN
                v_deduct_bonus := v_remaining_cost;
                v_remaining_cost := 0;
            ELSE
                v_deduct_bonus := COALESCE(v_balance_bonus, 0);
                v_remaining_cost := ROUND(v_remaining_cost - COALESCE(v_balance_bonus, 0), 2);
            END IF;

            IF v_remaining_cost > 0 THEN
                IF COALESCE(v_balance_paid, 0) >= v_remaining_cost THEN
                    v_deduct_paid := v_remaining_cost;
                ELSE
                    RETURN jsonb_build_object('success', false, 'message', '余额扣款异常');
                END IF;
            END IF;

            UPDATE public.points_balance
            SET bonus_balance = ROUND(bonus_balance - v_deduct_bonus, 2),
                paid_balance = ROUND(paid_balance - v_deduct_paid, 2),
                updated_at = v_now
            WHERE user_id = v_effective_user_id
              AND site = v_site;
        END;
    END IF;

    IF v_discount_amount > 0 AND v_discount_code IS NOT NULL THEN
        UPDATE public.discount_codes
        SET used_count = used_count + 1
        WHERE code = v_discount_code;
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
        site
    )
    VALUES (
        v_effective_user_id,
        p_product_id,
        CASE
            WHEN v_product.delivery_type = 'KEY' OR v_product.delivery_type IS NULL THEN v_inventory_primary_id
            ELSE NULL
        END,
        v_total_price,
        v_gross_total,
        p_quantity,
        v_product.name,
        v_discount_code,
        v_discount_amount,
        v_discount_snapshot,
        v_discount_version,
        false,
        0,
        CASE
            WHEN v_product.delivery_type = 'API' THEN 'pending'
            ELSE 'delivered'
        END,
        CASE
            WHEN v_product.delivery_type = 'API' THEN NULL
            ELSE v_now
        END,
        v_now,
        0,
        v_site
    )
    RETURNING id INTO v_order_id;

    IF v_product.delivery_type = 'KEY' OR v_product.delivery_type IS NULL THEN
        UPDATE public.shop_inventory
        SET status = 'sold',
            buyer_id = v_effective_user_id,
            sold_at = v_now
        WHERE id = ANY(v_inventory_ids);

        INSERT INTO public.shop_order_items (order_id, inventory_id, snapshot_product_name, price_paid)
        SELECT v_order_id, unnest(v_inventory_ids), v_product.name, v_actual_unit_price;
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
                'user_id', v_effective_user_id,
                'order_id', v_order_id,
                'product_id', p_product_id,
                'quantity', p_quantity,
                'site', v_site
            ),
            'pending',
            0,
            5,
            v_now,
            'shop_delivery:' || v_order_id::TEXT
        )
        RETURNING id INTO v_task_id;

        INSERT INTO public.shop_order_items (order_id, inventory_id, snapshot_product_name, price_paid)
        VALUES (v_order_id, NULL, v_product.name || ' [API]', v_total_price);

        UPDATE public.shop_orders
        SET delivery_task_id = v_task_id
        WHERE id = v_order_id;
    END IF;

    IF v_total_price > 0 THEN
        INSERT INTO public.points_ledger (user_id, amount, reason, reference_id, site)
        VALUES (v_effective_user_id, -v_total_price, '商城购买: ' || v_product.name, 'SHOP_ORDER_' || v_order_id, v_site);
    END IF;

    IF v_total_price > 0 THEN
        INSERT INTO public.shop_purchase_reward_jobs (
            order_id,
            user_id,
            product_id,
            product_name,
            site,
            quantity,
            base_unit_price,
            total_price,
            agent_id,
            agent_markup,
            status,
            updated_at
        )
        VALUES (
            v_order_id,
            v_effective_user_id,
            p_product_id,
            v_product.name,
            v_site,
            p_quantity,
            v_base_unit_price,
            v_total_price,
            p_agent_id,
            v_agent_markup,
            'pending',
            v_now
        )
        ON CONFLICT (order_id) DO NOTHING;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'message', '购买成功',
        'data', jsonb_build_object(
            'content', array_to_string(v_contents, E'\n----\n'),
            'order_id', v_order_id,
            'product_name', v_product.name,
            'price_paid', v_total_price,
            'subtotal', v_gross_total,
            'discount_code', v_discount_code,
            'discount_type', v_applied_discount_type,
            'discount_value', v_applied_discount_value,
            'discount_amount', v_discount_amount,
            'final_total', v_total_price,
            'unit_price', v_actual_unit_price,
            'remaining_points', ROUND(GREATEST(0, COALESCE(v_user_balance, 0) - v_total_price), 2),
            'usage_instructions', CASE WHEN v_product.show_usage_instructions THEN v_product.usage_instructions ELSE NULL END,
            'show_usage_instructions', COALESCE(v_product.show_usage_instructions, false),
            'site', v_site,
            'discount_version', v_discount_version
        )
    );
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'message', '交易失败: ' || SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_purchase_shop_item(UUID, UUID, VARCHAR, INT, VARCHAR, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_purchase_shop_item(UUID, UUID, VARCHAR, INT, VARCHAR, UUID) TO authenticated, service_role;
