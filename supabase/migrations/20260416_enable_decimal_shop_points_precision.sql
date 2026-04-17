-- ============================================
-- Enable decimal shop point settlement (0.01 precision)
-- - allow shop coupon settlement to charge/pay with fractional points
-- - upgrade points balance / ledger precision from 0.1 to 0.01
-- - upgrade shop order amount columns to 0.01
-- - keep refund / recharge flows aligned with the new precision
-- ============================================

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'points_balance'
          AND column_name = 'total_balance'
    ) THEN
        EXECUTE 'ALTER TABLE public.points_balance DROP COLUMN total_balance';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'points_balance'
          AND column_name = 'paid_balance'
    ) THEN
        EXECUTE 'ALTER TABLE public.points_balance ALTER COLUMN paid_balance TYPE NUMERIC(12,2) USING ROUND(COALESCE(paid_balance, 0)::NUMERIC, 2)';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'points_balance'
          AND column_name = 'bonus_balance'
    ) THEN
        EXECUTE 'ALTER TABLE public.points_balance ALTER COLUMN bonus_balance TYPE NUMERIC(12,2) USING ROUND(COALESCE(bonus_balance, 0)::NUMERIC, 2)';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'points_balance'
          AND column_name = 'paid_balance'
    ) AND EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'points_balance'
          AND column_name = 'bonus_balance'
    ) AND NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'points_balance'
          AND column_name = 'total_balance'
    ) THEN
        EXECUTE 'ALTER TABLE public.points_balance ADD COLUMN total_balance NUMERIC(12,2) GENERATED ALWAYS AS (ROUND(COALESCE(paid_balance, 0) + COALESCE(bonus_balance, 0), 2)) STORED';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'points_ledger'
          AND column_name = 'amount'
    ) THEN
        EXECUTE 'ALTER TABLE public.points_ledger ALTER COLUMN amount TYPE NUMERIC(12,2) USING ROUND(COALESCE(amount, 0)::NUMERIC, 2)';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'points_ledger'
          AND column_name = 'balance_snapshot'
    ) THEN
        EXECUTE 'ALTER TABLE public.points_ledger ALTER COLUMN balance_snapshot TYPE NUMERIC(12,2) USING ROUND(COALESCE(balance_snapshot, 0)::NUMERIC, 2)';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'pending_referral_rewards'
          AND column_name = 'reward_points'
    ) THEN
        EXECUTE 'ALTER TABLE public.pending_referral_rewards ALTER COLUMN reward_points TYPE NUMERIC(12,2) USING ROUND(COALESCE(reward_points, 0)::NUMERIC, 2)';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'shop_orders'
          AND column_name = 'price_paid'
    ) THEN
        EXECUTE 'ALTER TABLE public.shop_orders ALTER COLUMN price_paid TYPE NUMERIC(12,2) USING ROUND(COALESCE(price_paid, 0)::NUMERIC, 2)';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'shop_orders'
          AND column_name = 'total_price'
    ) THEN
        EXECUTE 'ALTER TABLE public.shop_orders ALTER COLUMN total_price TYPE NUMERIC(12,2) USING ROUND(COALESCE(total_price, 0)::NUMERIC, 2)';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'shop_orders'
          AND column_name = 'discount_amount'
    ) THEN
        EXECUTE 'ALTER TABLE public.shop_orders ALTER COLUMN discount_amount TYPE NUMERIC(12,2) USING ROUND(COALESCE(discount_amount, 0)::NUMERIC, 2)';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'shop_orders'
          AND column_name = 'discount_refund_amount'
    ) THEN
        EXECUTE 'ALTER TABLE public.shop_orders ALTER COLUMN discount_refund_amount TYPE NUMERIC(12,2) USING ROUND(COALESCE(discount_refund_amount, 0)::NUMERIC, 2)';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'shop_order_items'
          AND column_name = 'price_paid'
    ) THEN
        EXECUTE 'ALTER TABLE public.shop_order_items ALTER COLUMN price_paid TYPE NUMERIC(12,2) USING ROUND(COALESCE(price_paid, 0)::NUMERIC, 2)';
    END IF;
END $$;

DROP FUNCTION IF EXISTS public.fn_resolve_shop_percent_discount(INT, INT, BOOLEAN);
DROP FUNCTION IF EXISTS public.fn_resolve_shop_percent_discount(NUMERIC, INT, BOOLEAN);

CREATE OR REPLACE FUNCTION public.fn_resolve_shop_percent_discount(
    p_subtotal NUMERIC,
    p_discount_value INT,
    p_allow_zero_total BOOLEAN DEFAULT false
)
RETURNS TABLE (
    discount_amount NUMERIC(12,2),
    final_total NUMERIC(12,2),
    has_effective_discount BOOLEAN
)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_subtotal NUMERIC(12,2) := ROUND(GREATEST(0, COALESCE(p_subtotal, 0))::NUMERIC, 2);
    v_discount_value INT := GREATEST(0, COALESCE(p_discount_value, 0));
    v_discounted_total NUMERIC(12,2) := 0;
    v_discount_amount NUMERIC(12,2) := 0;
BEGIN
    IF v_subtotal = 0 OR v_discount_value <= 0 THEN
        RETURN QUERY
        SELECT 0::NUMERIC(12,2), v_subtotal, false;
        RETURN;
    END IF;

    v_discounted_total := ROUND((v_subtotal * v_discount_value::NUMERIC) / 100, 2);
    v_discounted_total := GREATEST(0, LEAST(v_subtotal, v_discounted_total));
    v_discount_amount := ROUND(GREATEST(0, v_subtotal - v_discounted_total), 2);

    IF v_discount_amount = 0 THEN
        RETURN QUERY
        SELECT 0::NUMERIC(12,2), v_subtotal, false;
        RETURN;
    END IF;

    IF v_discounted_total = 0
        AND NOT COALESCE(p_allow_zero_total, false) THEN
        RETURN QUERY
        SELECT v_discount_amount, 0::NUMERIC(12,2), false;
        RETURN;
    END IF;

    RETURN QUERY
    SELECT v_discount_amount, v_discounted_total, true;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_recharge_points(
    target_user_id UUID,
    p_paid NUMERIC(12,2),
    p_bonus NUMERIC(12,2),
    p_reason TEXT,
    p_reference_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_new_balance RECORD;
    v_recharge_ledger_id UUID;
    v_pending_reward RECORD;
    v_paid NUMERIC(12,2) := ROUND(COALESCE(p_paid, 0), 2);
    v_bonus NUMERIC(12,2) := ROUND(COALESCE(p_bonus, 0), 2);
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    IF target_user_id IS NULL THEN
        RAISE EXCEPTION 'target_user_id is required';
    END IF;

    IF v_paid < 0 OR v_bonus < 0 THEN
        RAISE EXCEPTION 'paid and bonus must be non-negative';
    END IF;

    IF ROUND(v_paid + v_bonus, 2) <= 0 THEN
        RAISE EXCEPTION 'recharge total must be greater than 0';
    END IF;

    INSERT INTO public.points_ledger (user_id, amount, reason, reference_id)
    VALUES (target_user_id, ROUND(v_paid + v_bonus, 2), p_reason, p_reference_id)
    RETURNING id INTO v_recharge_ledger_id;

    INSERT INTO public.points_balance (user_id, paid_balance, bonus_balance)
    VALUES (target_user_id, v_paid, v_bonus)
    ON CONFLICT (user_id)
    DO UPDATE SET
        paid_balance = ROUND(public.points_balance.paid_balance + EXCLUDED.paid_balance, 2),
        bonus_balance = ROUND(public.points_balance.bonus_balance + EXCLUDED.bonus_balance, 2),
        updated_at = NOW()
    RETURNING paid_balance, bonus_balance, total_balance INTO v_new_balance;

    IF ROUND(v_paid + v_bonus, 2) > 0
       AND public.fn_is_affiliate_qualifying_recharge_reason(p_reason) THEN
        SELECT *
        INTO v_pending_reward
        FROM public.pending_referral_rewards
        WHERE invitee_id = target_user_id;

        IF FOUND THEN
            INSERT INTO public.points_balance (user_id, paid_balance, bonus_balance)
            VALUES (v_pending_reward.inviter_id, 0, ROUND(v_pending_reward.reward_points, 2))
            ON CONFLICT (user_id) DO UPDATE SET
                bonus_balance = ROUND(public.points_balance.bonus_balance + EXCLUDED.bonus_balance, 2),
                updated_at = NOW();

            INSERT INTO public.points_ledger (user_id, amount, reason, reference_id)
            VALUES (
                v_pending_reward.inviter_id,
                ROUND(v_pending_reward.reward_points, 2),
                '拉新固定奖励 (下线首充激活)',
                'REG_REWARD_UNLOCK_RECHARGE_' || v_recharge_ledger_id
            );

            DELETE FROM public.pending_referral_rewards
            WHERE id = v_pending_reward.id;
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'paid', v_new_balance.paid_balance,
        'bonus', v_new_balance.bonus_balance,
        'total', v_new_balance.total_balance
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_recharge_points(
    target_user_id UUID,
    p_paid NUMERIC(12,2),
    p_bonus NUMERIC(12,2),
    p_reason TEXT,
    p_reference_id TEXT,
    p_site VARCHAR DEFAULT 'cn'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_new_balance RECORD;
    v_recharge_ledger_id UUID;
    v_pending_reward RECORD;
    v_paid NUMERIC(12,2) := ROUND(COALESCE(p_paid, 0), 2);
    v_bonus NUMERIC(12,2) := ROUND(COALESCE(p_bonus, 0), 2);
    v_site VARCHAR := COALESCE(NULLIF(BTRIM(p_site), ''), 'cn');
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    IF target_user_id IS NULL THEN
        RAISE EXCEPTION 'target_user_id is required';
    END IF;

    IF v_paid < 0 OR v_bonus < 0 THEN
        RAISE EXCEPTION 'paid and bonus must be non-negative';
    END IF;

    IF ROUND(v_paid + v_bonus, 2) <= 0 THEN
        RAISE EXCEPTION 'recharge total must be greater than 0';
    END IF;

    INSERT INTO public.points_ledger (user_id, amount, reason, reference_id, site)
    VALUES (target_user_id, ROUND(v_paid + v_bonus, 2), p_reason, p_reference_id, v_site)
    RETURNING id INTO v_recharge_ledger_id;

    INSERT INTO public.points_balance (user_id, site, paid_balance, bonus_balance)
    VALUES (target_user_id, v_site, v_paid, v_bonus)
    ON CONFLICT (user_id, site)
    DO UPDATE SET
        paid_balance = ROUND(public.points_balance.paid_balance + EXCLUDED.paid_balance, 2),
        bonus_balance = ROUND(public.points_balance.bonus_balance + EXCLUDED.bonus_balance, 2),
        updated_at = NOW()
    RETURNING paid_balance, bonus_balance, total_balance INTO v_new_balance;

    IF ROUND(v_paid + v_bonus, 2) > 0
       AND public.fn_is_affiliate_qualifying_recharge_reason(p_reason) THEN
        SELECT *
        INTO v_pending_reward
        FROM public.pending_referral_rewards
        WHERE invitee_id = target_user_id;

        IF FOUND THEN
            INSERT INTO public.points_balance (user_id, site, paid_balance, bonus_balance)
            VALUES (v_pending_reward.inviter_id, v_site, 0, ROUND(v_pending_reward.reward_points, 2))
            ON CONFLICT (user_id, site) DO UPDATE SET
                bonus_balance = ROUND(public.points_balance.bonus_balance + EXCLUDED.bonus_balance, 2),
                updated_at = NOW();

            INSERT INTO public.points_ledger (user_id, amount, reason, reference_id, site)
            VALUES (
                v_pending_reward.inviter_id,
                ROUND(v_pending_reward.reward_points, 2),
                '拉新固定奖励 (下线首充激活)',
                'REG_REWARD_UNLOCK_RECHARGE_' || v_recharge_ledger_id,
                v_site
            );

            DELETE FROM public.pending_referral_rewards
            WHERE id = v_pending_reward.id;
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'paid', v_new_balance.paid_balance,
        'bonus', v_new_balance.bonus_balance,
        'total', v_new_balance.total_balance
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_validate_discount_code(
    p_product_id UUID,
    p_user_id UUID DEFAULT NULL,
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
    v_subtotal NUMERIC(12,2);
    v_final_total NUMERIC(12,2);

    v_discount_record RECORD;
    v_discount_amount NUMERIC(12,2) := 0;
    v_discount_code VARCHAR := NULL;
    v_user_discount_use_count INT := 0;
    v_effective_lifecycle_status VARCHAR(32);
    v_has_effective_discount BOOLEAN := FALSE;

    v_rule JSONB;
    v_rule_qty INT;
    v_rule_price NUMERIC(12,2);

    v_agent_price NUMERIC(12,2) := NULL;
    v_user_product_total_quantity INT := 0;
    v_user_product_24h_quantity INT := 0;
    v_user_product_window_quantity INT := 0;
    v_remaining_quantity INT := 0;
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

    v_discount_code := NULLIF(UPPER(BTRIM(COALESCE(p_discount_code, ''))), '');
    IF v_discount_code IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '请输入优惠码');
    END IF;

    SELECT
        id,
        name,
        category,
        price_points,
        price_points_intl,
        quantity_rules,
        flash_sale_end,
        flash_sale_price,
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

        IF v_product.per_account_purchase_limit IS NOT NULL THEN
            SELECT COALESCE(SUM(COALESCE(item_count, 0)), 0)::INT
            INTO v_user_product_total_quantity
            FROM public.shop_orders
            WHERE user_id = v_effective_user_id
              AND product_id = p_product_id
              AND COALESCE(refund_status, 'none') NOT IN ('refunded', 'full_refund');

            v_remaining_quantity := GREATEST(0, v_product.per_account_purchase_limit - v_user_product_total_quantity);
            IF v_remaining_quantity < p_quantity THEN
                IF v_remaining_quantity = 0 THEN
                    RETURN jsonb_build_object('success', false, 'message', '当前账号已达到该商品的累计限购上限');
                END IF;

                RETURN jsonb_build_object('success', false, 'message', '当前账号最多还可购买' || v_remaining_quantity || '件');
            END IF;
        END IF;

        IF v_product.purchase_limit_24h_quantity IS NOT NULL THEN
            SELECT COALESCE(SUM(COALESCE(item_count, 0)), 0)::INT
            INTO v_user_product_24h_quantity
            FROM public.shop_orders
            WHERE user_id = v_effective_user_id
              AND product_id = p_product_id
              AND created_at >= NOW() - INTERVAL '24 hours'
              AND COALESCE(refund_status, 'none') NOT IN ('refunded', 'full_refund');

            v_remaining_quantity := GREATEST(0, v_product.purchase_limit_24h_quantity - v_user_product_24h_quantity);
            IF v_remaining_quantity < p_quantity THEN
                IF v_remaining_quantity = 0 THEN
                    RETURN jsonb_build_object('success', false, 'message', '当前账号在24小时内已达到该商品的购买上限');
                END IF;

                RETURN jsonb_build_object('success', false, 'message', '当前账号在24小时内最多还可购买' || v_remaining_quantity || '件');
            END IF;
        END IF;

        IF v_product.purchase_limit_window_minutes IS NOT NULL
            AND v_product.purchase_limit_window_quantity IS NOT NULL THEN
            SELECT COALESCE(SUM(COALESCE(item_count, 0)), 0)::INT
            INTO v_user_product_window_quantity
            FROM public.shop_orders
            WHERE user_id = v_effective_user_id
              AND product_id = p_product_id
              AND created_at >= NOW() - make_interval(mins => v_product.purchase_limit_window_minutes)
              AND COALESCE(refund_status, 'none') NOT IN ('refunded', 'full_refund');

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
        AND v_product.flash_sale_end > NOW()
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
        END IF;
    END IF;

    v_subtotal := ROUND(v_actual_unit_price * p_quantity, 2);

    SELECT *
    INTO v_discount_record
    FROM public.discount_codes
    WHERE code = v_discount_code;

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

    IF v_discount_record.starts_at IS NOT NULL AND v_discount_record.starts_at > NOW() THEN
        RETURN jsonb_build_object('success', false, 'message', '该优惠码尚未生效');
    END IF;

    IF v_discount_record.expires_at IS NOT NULL AND v_discount_record.expires_at < NOW() THEN
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
            v_subtotal,
            v_discount_record.discount_value,
            COALESCE(v_discount_record.allow_zero_total, false)
        ) AS resolved;

        IF NOT v_has_effective_discount THEN
            RETURN jsonb_build_object('success', false, 'message', '当前商品暂无可优惠金额，无法使用这张优惠码');
        END IF;
    ELSIF v_discount_record.discount_type = 'fixed' THEN
        v_discount_amount := LEAST(v_subtotal, v_discount_record.discount_value::NUMERIC(12,2));
        v_final_total := ROUND(GREATEST(0, v_subtotal - v_discount_amount), 2);
        v_has_effective_discount := v_discount_amount > 0;
    ELSE
        v_final_total := v_subtotal;
        v_has_effective_discount := false;
    END IF;

    IF v_discount_amount > 0
        AND v_final_total = 0
        AND NOT COALESCE(v_discount_record.allow_zero_total, false) THEN
        RETURN jsonb_build_object('success', false, 'message', '该优惠码不允许全额抵扣');
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'message', '优惠码可用',
        'data', jsonb_build_object(
            'discount_code', v_discount_code,
            'discount_type', v_discount_record.discount_type,
            'discount_value', v_discount_record.discount_value,
            'discount_version', COALESCE(v_discount_record.version_no, 1),
            'unit_price', v_actual_unit_price,
            'subtotal', v_subtotal,
            'discount_amount', v_discount_amount,
            'final_total', v_final_total,
            'site', v_site,
            'applicable_site', v_discount_record.applicable_site,
            'scope_type', v_discount_record.scope_type,
            'scope_category', v_discount_record.scope_category,
            'scope_product_id', v_discount_record.scope_product_id,
            'max_uses_per_user', v_discount_record.max_uses_per_user,
            'starts_at', v_discount_record.starts_at,
            'expires_at', v_discount_record.expires_at,
            'lifecycle_status', v_effective_lifecycle_status,
            'status_reason', v_discount_record.status_reason,
            'recovery_strategy', COALESCE(v_discount_record.recovery_strategy, 'manual_only'),
            'observation_ends_at', v_discount_record.observation_ends_at
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
    v_inventory_ids UUID[];
    v_contents TEXT[];

    v_order_id UUID;
    v_task_id UUID;
    v_rule JSONB;
    v_rule_qty INT;
    v_rule_price NUMERIC(12,2);

    v_agent_price NUMERIC(12,2) := NULL;
    v_agent_markup NUMERIC(12,2) := 0;

    v_affiliate_config JSONB;
    v_inviter_id UUID;
    v_commission NUMERIC(12,2) := 0;
    v_commission_rate FLOAT := 0.10;
    v_affiliate_reason TEXT;
    v_affiliate_reference_id TEXT;

    v_pending_reward RECORD;
    v_user_product_total_quantity INT := 0;
    v_user_product_24h_quantity INT := 0;
    v_user_product_window_quantity INT := 0;
    v_remaining_quantity INT := 0;
    v_purchase_limit_lock_name TEXT := NULL;
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
        END IF;

        IF v_product.per_account_purchase_limit IS NOT NULL THEN
            SELECT COALESCE(SUM(COALESCE(item_count, 0)), 0)::INT
            INTO v_user_product_total_quantity
            FROM public.shop_orders
            WHERE user_id = v_effective_user_id
              AND product_id = p_product_id
              AND COALESCE(refund_status, 'none') NOT IN ('refunded', 'full_refund');

            v_remaining_quantity := GREATEST(0, v_product.per_account_purchase_limit - v_user_product_total_quantity);
            IF v_remaining_quantity < p_quantity THEN
                IF v_remaining_quantity = 0 THEN
                    RETURN jsonb_build_object('success', false, 'message', '当前账号已达到该商品的累计限购上限');
                END IF;

                RETURN jsonb_build_object('success', false, 'message', '当前账号最多还可购买' || v_remaining_quantity || '件');
            END IF;
        END IF;

        IF v_product.purchase_limit_24h_quantity IS NOT NULL THEN
            SELECT COALESCE(SUM(COALESCE(item_count, 0)), 0)::INT
            INTO v_user_product_24h_quantity
            FROM public.shop_orders
            WHERE user_id = v_effective_user_id
              AND product_id = p_product_id
              AND created_at >= NOW() - INTERVAL '24 hours'
              AND COALESCE(refund_status, 'none') NOT IN ('refunded', 'full_refund');

            v_remaining_quantity := GREATEST(0, v_product.purchase_limit_24h_quantity - v_user_product_24h_quantity);
            IF v_remaining_quantity < p_quantity THEN
                IF v_remaining_quantity = 0 THEN
                    RETURN jsonb_build_object('success', false, 'message', '当前账号在24小时内已达到该商品的购买上限');
                END IF;

                RETURN jsonb_build_object('success', false, 'message', '当前账号在24小时内最多还可购买' || v_remaining_quantity || '件');
            END IF;
        END IF;

        IF v_product.purchase_limit_window_minutes IS NOT NULL
            AND v_product.purchase_limit_window_quantity IS NOT NULL THEN
            SELECT COALESCE(SUM(COALESCE(item_count, 0)), 0)::INT
            INTO v_user_product_window_quantity
            FROM public.shop_orders
            WHERE user_id = v_effective_user_id
              AND product_id = p_product_id
              AND created_at >= NOW() - make_interval(mins => v_product.purchase_limit_window_minutes)
              AND COALESCE(refund_status, 'none') NOT IN ('refunded', 'full_refund');

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
        AND v_product.flash_sale_end > NOW()
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

        IF v_discount_record.starts_at IS NOT NULL AND v_discount_record.starts_at > NOW() THEN
            RETURN jsonb_build_object('success', false, 'message', '该优惠码尚未生效');
        END IF;

        IF v_discount_record.expires_at IS NOT NULL AND v_discount_record.expires_at < NOW() THEN
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
    ELSIF v_product.delivery_type = 'API' THEN
        v_contents := ARRAY['您的订单信息已通过 API Webhook 推送至第三方商户，请留意履约通知。'];
    ELSE
        RETURN jsonb_build_object('success', false, 'message', '未知的发货模式: ' || v_product.delivery_type);
    END IF;

    SELECT total_balance
    INTO v_user_balance
    FROM public.points_balance
    WHERE user_id = v_effective_user_id
      AND site = v_site
    FOR UPDATE;

    IF v_user_balance IS NULL OR v_user_balance < v_total_price THEN
        RETURN jsonb_build_object('success', false, 'message', '积分余额不足');
    END IF;

    IF v_total_price > 0 THEN
        DECLARE
            v_current_bonus NUMERIC(12,2);
            v_current_paid NUMERIC(12,2);
            v_deduct_bonus NUMERIC(12,2) := 0;
            v_deduct_paid NUMERIC(12,2) := 0;
            v_remaining_cost NUMERIC(12,2) := v_total_price;
        BEGIN
            SELECT bonus_balance, paid_balance
            INTO v_current_bonus, v_current_paid
            FROM public.points_balance
            WHERE user_id = v_effective_user_id
              AND site = v_site;

            IF COALESCE(v_current_bonus, 0) >= v_remaining_cost THEN
                v_deduct_bonus := v_remaining_cost;
                v_remaining_cost := 0;
            ELSE
                v_deduct_bonus := COALESCE(v_current_bonus, 0);
                v_remaining_cost := ROUND(v_remaining_cost - COALESCE(v_current_bonus, 0), 2);
            END IF;

            IF v_remaining_cost > 0 THEN
                IF COALESCE(v_current_paid, 0) >= v_remaining_cost THEN
                    v_deduct_paid := v_remaining_cost;
                ELSE
                    RETURN jsonb_build_object('success', false, 'message', '余额扣款异常');
                END IF;
            END IF;

            UPDATE public.points_balance
            SET bonus_balance = ROUND(bonus_balance - v_deduct_bonus, 2),
                paid_balance = ROUND(paid_balance - v_deduct_paid, 2),
                updated_at = NOW()
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
        site
    )
    VALUES (
        v_effective_user_id,
        p_product_id,
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
        v_site
    )
    RETURNING id INTO v_order_id;

    IF v_product.delivery_type = 'KEY' OR v_product.delivery_type IS NULL THEN
        UPDATE public.shop_inventory
        SET status = 'sold',
            buyer_id = v_effective_user_id,
            sold_at = NOW()
        WHERE id = ANY(v_inventory_ids);

        INSERT INTO public.shop_order_items (order_id, inventory_id, snapshot_product_name, price_paid)
        SELECT v_order_id, unnest(v_inventory_ids), v_product.name, v_actual_unit_price;

        UPDATE public.shop_orders
        SET delivery_status = 'delivered',
            delivery_completed_at = NOW(),
            delivery_updated_at = NOW()
        WHERE id = v_order_id;
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
            NOW(),
            'shop_delivery:' || v_order_id::TEXT
        )
        RETURNING id INTO v_task_id;

        INSERT INTO public.shop_order_items (order_id, inventory_id, snapshot_product_name, price_paid)
        VALUES (v_order_id, NULL, v_product.name || ' [API]', v_total_price);

        UPDATE public.shop_orders
        SET delivery_status = 'pending',
            delivery_task_id = v_task_id,
            delivery_attempt_count = 0,
            delivery_updated_at = NOW()
        WHERE id = v_order_id;
    END IF;

    IF v_total_price > 0 THEN
        INSERT INTO public.points_ledger (user_id, amount, reason, reference_id, site)
        VALUES (v_effective_user_id, -v_total_price, '商城购买: ' || v_product.name, 'SHOP_ORDER_' || v_order_id, v_site);
    END IF;

    SELECT config_value
    INTO v_affiliate_config
    FROM public.system_config
    WHERE config_key = 'affiliate_program';

    IF p_agent_id IS NOT NULL THEN
        v_commission_rate := COALESCE(
            (v_affiliate_config->>'commission_rate_agent')::FLOAT,
            (SELECT value::FLOAT FROM public.system_settings WHERE key = 'commission_rate_agent'),
            0.10
        );
        v_affiliate_reason := '推广返佣 (' || (v_commission_rate * 100) || '%): 下线购买分销资源';
        v_affiliate_reference_id := 'AFF_REW_' || v_order_id;
    ELSE
        v_commission_rate := COALESCE(
            (v_affiliate_config->>'commission_rate_shop')::FLOAT,
            (SELECT value::FLOAT FROM public.system_settings WHERE key = 'commission_rate_shop'),
            0.10
        );
        v_affiliate_reason := '推广返佣 (' || (v_commission_rate * 100) || '%): 下线购买商品';
        v_affiliate_reference_id := 'AFFILIATE_REWARD_' || v_order_id;
    END IF;

    SELECT invited_by
    INTO v_inviter_id
    FROM public.profiles
    WHERE id = v_effective_user_id;

    IF v_inviter_id IS NOT NULL AND v_total_price > 0 THEN
        v_commission := ROUND((v_base_unit_price * p_quantity * v_commission_rate)::NUMERIC, 2);
        IF v_commission > 0 THEN
            INSERT INTO public.points_balance (user_id, site, paid_balance, bonus_balance)
            VALUES (v_inviter_id, v_site, 0, v_commission)
            ON CONFLICT (user_id, site) DO UPDATE
            SET bonus_balance = ROUND(COALESCE(points_balance.bonus_balance, 0) + EXCLUDED.bonus_balance, 2),
                updated_at = NOW();

            INSERT INTO public.points_ledger (user_id, amount, reason, reference_id, site)
            VALUES (v_inviter_id, v_commission, v_affiliate_reason, v_affiliate_reference_id, v_site);
        END IF;
    END IF;

    IF p_agent_id IS NOT NULL AND v_agent_markup > 0 AND v_total_price > 0 THEN
        INSERT INTO public.points_balance (user_id, site, paid_balance, bonus_balance)
        VALUES (p_agent_id, v_site, ROUND(v_agent_markup * p_quantity, 2), 0)
        ON CONFLICT (user_id, site) DO UPDATE
        SET paid_balance = ROUND(COALESCE(points_balance.paid_balance, 0) + EXCLUDED.paid_balance, 2),
            updated_at = NOW();

        INSERT INTO public.points_ledger (user_id, amount, reason, reference_id, site)
        VALUES (p_agent_id, ROUND(v_agent_markup * p_quantity, 2), '代理商网店利润差额: ' || v_product.name, 'AGENT_PROF_' || v_order_id, v_site);
    END IF;

    SELECT *
    INTO v_pending_reward
    FROM public.pending_referral_rewards
    WHERE invitee_id = v_effective_user_id;

    IF FOUND AND v_total_price > 0 THEN
        INSERT INTO public.points_balance (user_id, site, paid_balance, bonus_balance)
        VALUES (v_pending_reward.inviter_id, v_site, 0, ROUND(v_pending_reward.reward_points, 2))
        ON CONFLICT (user_id, site) DO UPDATE
        SET bonus_balance = ROUND(COALESCE(points_balance.bonus_balance, 0) + EXCLUDED.bonus_balance, 2),
            updated_at = NOW();

        INSERT INTO public.points_ledger (user_id, amount, reason, reference_id, site)
        VALUES (
            v_pending_reward.inviter_id,
            ROUND(v_pending_reward.reward_points, 2),
            '拉新固定奖励 (下线首单激活)',
            'REG_REWARD_UNLOCK_' || v_order_id,
            v_site
        );

        DELETE FROM public.pending_referral_rewards
        WHERE id = v_pending_reward.id;
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

DROP FUNCTION IF EXISTS public.fn_admin_lookup_order(UUID);

CREATE OR REPLACE FUNCTION public.fn_admin_lookup_order(p_order_id UUID DEFAULT NULL)
RETURNS TABLE (
    id UUID,
    user_id UUID,
    product_id UUID,
    inventory_id UUID,
    price_paid NUMERIC(12,2),
    snapshot_product_name VARCHAR,
    refund_status VARCHAR,
    created_at TIMESTAMPTZ,
    inventory_content TEXT,
    inventory_status VARCHAR
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Access denied: Admin only';
    END IF;

    RETURN QUERY
    SELECT
        o.id,
        o.user_id,
        o.product_id,
        o.inventory_id,
        o.price_paid,
        o.snapshot_product_name,
        o.refund_status,
        o.created_at,
        i.content AS inventory_content,
        i.status AS inventory_status
    FROM public.shop_orders o
    LEFT JOIN public.shop_inventory i ON o.inventory_id = i.id
    WHERE (p_order_id IS NULL OR o.id = p_order_id)
    ORDER BY o.created_at DESC
    LIMIT 50;
END;
$$;

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
        o.site
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
        delivery_updated_at = NOW()
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
        'message', '退款成功，库存已标记为: ' || (v_status_map ->> p_target_status)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_recharge_points(UUID, NUMERIC, NUMERIC, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_recharge_points(UUID, NUMERIC, NUMERIC, TEXT, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.fn_recharge_points(UUID, NUMERIC, NUMERIC, TEXT, TEXT, VARCHAR) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_recharge_points(UUID, NUMERIC, NUMERIC, TEXT, TEXT, VARCHAR) TO service_role;

REVOKE ALL ON FUNCTION public.fn_admin_lookup_order(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_admin_lookup_order(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_admin_lookup_order(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_admin_lookup_order(UUID) TO service_role;

REVOKE ALL ON FUNCTION public.fn_admin_refund_order(UUID, UUID, VARCHAR, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_admin_refund_order(UUID, UUID, VARCHAR, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.fn_admin_refund_order(UUID, UUID, VARCHAR, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_admin_refund_order(UUID, UUID, VARCHAR, TEXT) TO service_role;
