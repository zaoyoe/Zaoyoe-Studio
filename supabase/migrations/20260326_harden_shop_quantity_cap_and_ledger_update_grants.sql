-- ============================================
-- Harden shop purchase quantity caps & ledger update grants
-- - enforce a server-side max quantity for discount preview and purchase RPCs
-- - revoke direct UPDATE access on points_ledger from authenticated users
-- - keep history clearing on the controlled SECURITY DEFINER RPC
-- ============================================

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

    v_product RECORD;
    v_base_unit_price INT;
    v_actual_unit_price INT;
    v_subtotal INT;

    v_discount_record RECORD;
    v_discount_amount INT := 0;
    v_discount_code VARCHAR := NULL;

    v_rule JSONB;
    v_rule_qty INT;
    v_rule_price INT;

    v_agent_price INT := NULL;
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

    IF p_quantity > v_max_quantity THEN
        RETURN jsonb_build_object('success', false, 'message', '单次购买数量不能超过' || v_max_quantity);
    END IF;

    v_discount_code := NULLIF(UPPER(BTRIM(COALESCE(p_discount_code, ''))), '');
    IF v_discount_code IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '请输入优惠码');
    END IF;

    SELECT
        id,
        name,
        price_points,
        price_points_intl,
        quantity_rules,
        flash_sale_end,
        flash_sale_price
    INTO v_product
    FROM public.shop_products
    WHERE id = p_product_id
      AND is_active = true;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', '商品不存在或已下架');
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
            v_rule_price := (v_rule->>'price')::INT;
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

    v_subtotal := v_actual_unit_price * p_quantity;

    SELECT *
    INTO v_discount_record
    FROM public.discount_codes
    WHERE code = v_discount_code;

    IF NOT FOUND OR v_discount_record.is_active = false THEN
        RETURN jsonb_build_object('success', false, 'message', '无效的优惠码');
    END IF;

    IF v_discount_record.expires_at IS NOT NULL AND v_discount_record.expires_at < NOW() THEN
        RETURN jsonb_build_object('success', false, 'message', '该优惠码已过期');
    END IF;

    IF v_discount_record.max_uses > 0 AND v_discount_record.used_count >= v_discount_record.max_uses THEN
        RETURN jsonb_build_object('success', false, 'message', '该优惠码的使用次数已达上限');
    END IF;

    IF v_discount_record.discount_type = 'percent' THEN
        v_discount_amount := v_subtotal - FLOOR((v_subtotal::NUMERIC * v_discount_record.discount_value::NUMERIC) / 100)::INT;
    ELSIF v_discount_record.discount_type = 'fixed' THEN
        v_discount_amount := LEAST(v_subtotal, v_discount_record.discount_value);
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'message', '优惠码可用',
        'data', jsonb_build_object(
            'discount_code', v_discount_code,
            'discount_type', v_discount_record.discount_type,
            'discount_value', v_discount_record.discount_value,
            'unit_price', v_actual_unit_price,
            'subtotal', v_subtotal,
            'discount_amount', v_discount_amount,
            'final_total', GREATEST(0, v_subtotal - v_discount_amount),
            'site', v_site
        )
    );
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'message', '优惠码校验失败: ' || SQLERRM);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_validate_discount_code(
    p_product_id UUID,
    p_user_id UUID,
    p_site VARCHAR DEFAULT 'cn',
    p_quantity INT DEFAULT 1,
    p_discount_code VARCHAR DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    RETURN public.fn_validate_discount_code(
        p_product_id,
        p_user_id,
        p_site,
        p_quantity,
        p_discount_code,
        NULL
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_validate_discount_code(UUID, UUID, VARCHAR, INT, VARCHAR, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_validate_discount_code(UUID, UUID, VARCHAR, INT, VARCHAR, UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.fn_validate_discount_code(UUID, UUID, VARCHAR, INT, VARCHAR) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_validate_discount_code(UUID, UUID, VARCHAR, INT, VARCHAR) TO authenticated, service_role;

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

    v_product RECORD;
    v_base_unit_price INT;
    v_actual_unit_price INT;
    v_total_price INT;

    v_discount_record RECORD;
    v_discount_amount INT := 0;
    v_discount_code VARCHAR := NULL;

    v_user_balance NUMERIC(12,1);
    v_inventory_ids UUID[];
    v_contents TEXT[];

    v_order_id UUID;
    v_task_id UUID;
    v_rule JSONB;
    v_rule_qty INT;
    v_rule_price INT;

    v_agent_price INT := NULL;
    v_agent_markup INT := 0;

    v_affiliate_config JSONB;
    v_inviter_id UUID;
    v_commission NUMERIC(12,1) := 0;
    v_commission_rate FLOAT := 0.10;
    v_affiliate_reason TEXT;
    v_affiliate_reference_id TEXT;

    v_pending_reward RECORD;
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

    IF p_quantity > v_max_quantity THEN
        RETURN jsonb_build_object('success', false, 'message', '单次购买数量不能超过' || v_max_quantity);
    END IF;

    SELECT
        id,
        price_points,
        price_points_intl,
        name,
        quantity_rules,
        flash_sale_end,
        flash_sale_price,
        delivery_type,
        webhook_target,
        usage_instructions,
        show_usage_instructions
    INTO v_product
    FROM public.shop_products
    WHERE id = p_product_id
      AND is_active = true;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', '商品不存在或已下架');
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
    ELSE
        IF v_product.quantity_rules IS NOT NULL AND jsonb_array_length(v_product.quantity_rules) > 0 THEN
            FOR v_rule IN SELECT * FROM jsonb_array_elements(v_product.quantity_rules)
            LOOP
                v_rule_qty := (v_rule->>'qty')::INT;
                v_rule_price := (v_rule->>'price')::INT;
                IF p_quantity >= v_rule_qty AND v_rule_price < v_base_unit_price THEN
                    v_base_unit_price := v_rule_price;
                END IF;
            END LOOP;
        END IF;
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
            v_agent_markup := v_agent_price - v_base_unit_price;
        END IF;
    END IF;

    v_total_price := v_actual_unit_price * p_quantity;

    v_discount_code := NULLIF(UPPER(BTRIM(COALESCE(p_discount_code, ''))), '');
    IF v_discount_code IS NOT NULL THEN
        SELECT *
        INTO v_discount_record
        FROM public.discount_codes
        WHERE code = v_discount_code
        FOR UPDATE;

        IF NOT FOUND OR v_discount_record.is_active = false THEN
            RETURN jsonb_build_object('success', false, 'message', '无效的优惠码');
        END IF;

        IF v_discount_record.expires_at IS NOT NULL AND v_discount_record.expires_at < NOW() THEN
            RETURN jsonb_build_object('success', false, 'message', '该优惠码已过期');
        END IF;

        IF v_discount_record.max_uses > 0 AND v_discount_record.used_count >= v_discount_record.max_uses THEN
            RETURN jsonb_build_object('success', false, 'message', '该优惠码的使用次数已达上限');
        END IF;

        IF v_discount_record.discount_type = 'percent' THEN
            v_discount_amount := v_total_price - FLOOR((v_total_price::NUMERIC * v_discount_record.discount_value::NUMERIC) / 100)::INT;
        ELSIF v_discount_record.discount_type = 'fixed' THEN
            v_discount_amount := LEAST(v_total_price, v_discount_record.discount_value);
        END IF;

        v_total_price := GREATEST(0, v_total_price - v_discount_amount);
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
            v_current_bonus NUMERIC(12,1);
            v_current_paid NUMERIC(12,1);
            v_deduct_bonus NUMERIC(12,1) := 0;
            v_deduct_paid NUMERIC(12,1) := 0;
            v_remaining_cost NUMERIC(12,1) := v_total_price;
        BEGIN
            SELECT bonus_balance, paid_balance
            INTO v_current_bonus, v_current_paid
            FROM public.points_balance
            WHERE user_id = v_effective_user_id
              AND site = v_site;

            IF v_current_bonus >= v_remaining_cost THEN
                v_deduct_bonus := v_remaining_cost;
                v_remaining_cost := 0;
            ELSE
                v_deduct_bonus := v_current_bonus;
                v_remaining_cost := v_remaining_cost - v_current_bonus;
            END IF;

            IF v_remaining_cost > 0 THEN
                IF v_current_paid >= v_remaining_cost THEN
                    v_deduct_paid := v_remaining_cost;
                ELSE
                    RETURN jsonb_build_object('success', false, 'message', '余额扣款异常');
                END IF;
            END IF;

            UPDATE public.points_balance
            SET bonus_balance = bonus_balance - v_deduct_bonus,
                paid_balance = paid_balance - v_deduct_paid,
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
        site
    )
    VALUES (
        v_effective_user_id,
        p_product_id,
        v_total_price,
        v_total_price + v_discount_amount,
        p_quantity,
        v_product.name,
        v_discount_code,
        v_discount_amount,
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
        v_commission := ROUND((v_base_unit_price * p_quantity * v_commission_rate)::NUMERIC, 1);
        IF v_commission > 0 THEN
            INSERT INTO public.points_balance (user_id, site, paid_balance, bonus_balance)
            VALUES (v_inviter_id, v_site, 0, v_commission)
            ON CONFLICT (user_id, site) DO UPDATE
            SET bonus_balance = ROUND(COALESCE(points_balance.bonus_balance, 0) + EXCLUDED.bonus_balance, 1),
                updated_at = NOW();

            INSERT INTO public.points_ledger (user_id, amount, reason, reference_id, site)
            VALUES (v_inviter_id, v_commission, v_affiliate_reason, v_affiliate_reference_id, v_site);
        END IF;
    END IF;

    IF p_agent_id IS NOT NULL AND v_agent_markup > 0 AND v_total_price > 0 THEN
        INSERT INTO public.points_balance (user_id, site, paid_balance, bonus_balance)
        VALUES (p_agent_id, v_site, v_agent_markup * p_quantity, 0)
        ON CONFLICT (user_id, site) DO UPDATE
        SET paid_balance = COALESCE(points_balance.paid_balance, 0) + EXCLUDED.paid_balance,
            updated_at = NOW();

        INSERT INTO public.points_ledger (user_id, amount, reason, reference_id, site)
        VALUES (p_agent_id, v_agent_markup * p_quantity, '代理商网店利润差额: ' || v_product.name, 'AGENT_PROF_' || v_order_id, v_site);
    END IF;

    SELECT *
    INTO v_pending_reward
    FROM public.pending_referral_rewards
    WHERE invitee_id = v_effective_user_id;

    IF FOUND AND v_total_price > 0 THEN
        INSERT INTO public.points_balance (user_id, site, paid_balance, bonus_balance)
        VALUES (v_pending_reward.inviter_id, v_site, 0, v_pending_reward.reward_points)
        ON CONFLICT (user_id, site) DO UPDATE
        SET bonus_balance = ROUND(COALESCE(points_balance.bonus_balance, 0) + EXCLUDED.bonus_balance, 1),
            updated_at = NOW();

        INSERT INTO public.points_ledger (user_id, amount, reason, reference_id, site)
        VALUES (
            v_pending_reward.inviter_id,
            v_pending_reward.reward_points,
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
            'remaining_points', GREATEST(0, v_user_balance - v_total_price),
            'usage_instructions', CASE WHEN v_product.show_usage_instructions THEN v_product.usage_instructions ELSE NULL END,
            'show_usage_instructions', COALESCE(v_product.show_usage_instructions, false),
            'site', v_site
        )
    );
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'message', '交易失败: ' || SQLERRM);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_purchase_shop_item(
    p_product_id UUID,
    p_user_id UUID,
    p_site VARCHAR DEFAULT 'cn',
    p_quantity INT DEFAULT 1,
    p_discount_code VARCHAR DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    RETURN public.fn_purchase_shop_item(
        p_product_id,
        p_user_id,
        p_site,
        p_quantity,
        p_discount_code,
        NULL
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_purchase_shop_item(UUID, UUID, VARCHAR, INT, VARCHAR, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_purchase_shop_item(UUID, UUID, VARCHAR, INT, VARCHAR, UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.fn_purchase_shop_item(UUID, UUID, VARCHAR, INT, VARCHAR) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_purchase_shop_item(UUID, UUID, VARCHAR, INT, VARCHAR) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_clear_user_history()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    deleted_count INTEGER;
    v_user_id UUID := auth.uid();
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION '请先登录';
    END IF;

    UPDATE public.points_ledger
    SET is_visible = false
    WHERE user_id = v_user_id
      AND is_visible = true;

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_clear_user_history() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_clear_user_history() TO authenticated;

REVOKE UPDATE ON public.points_ledger FROM authenticated;
