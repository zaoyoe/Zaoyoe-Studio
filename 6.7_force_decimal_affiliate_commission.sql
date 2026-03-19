-- ============================================
-- 6.7 强制修复返佣小数精度（未来订单 + 历史数据）
-- 适用场景：
-- 1. 推广返佣仍然按整数入账（例如应返 1.2，实际只到 1）
-- 2. 历史 AFFILIATE_REWARD_* / AFF_REW_* 流水已被错误写成整数
-- 3. 线上仍在跑旧版 6 参数 fn_purchase_shop_item
--
-- 执行结果：
-- 1. 强制将 points_balance / points_ledger 升级到 NUMERIC(12,1)
-- 2. 重建 6 参数购买函数，返佣统一按 0.1 精度计算
-- 3. 普通商城购买走 commission_rate_shop，代理分销资源走 commission_rate_agent
-- 4. 回算历史 AFFILIATE_REWARD_* 与 AFF_REW_*，并同步修正 bonus_balance
--
-- 使用方式：
-- - 直接在 Supabase SQL Editor 执行本文件
-- - 执行后重新下一个 6 分或 8 分的小单验证
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
        EXECUTE 'ALTER TABLE public.points_balance ALTER COLUMN paid_balance TYPE NUMERIC(12,1) USING ROUND(COALESCE(paid_balance, 0)::numeric, 1)';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'points_balance'
          AND column_name = 'bonus_balance'
    ) THEN
        EXECUTE 'ALTER TABLE public.points_balance ALTER COLUMN bonus_balance TYPE NUMERIC(12,1) USING ROUND(COALESCE(bonus_balance, 0)::numeric, 1)';
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
        EXECUTE 'ALTER TABLE public.points_balance ADD COLUMN total_balance NUMERIC(12,1) GENERATED ALWAYS AS (paid_balance + bonus_balance) STORED';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'points_ledger'
          AND column_name = 'amount'
    ) THEN
        EXECUTE 'ALTER TABLE public.points_ledger ALTER COLUMN amount TYPE NUMERIC(12,1) USING ROUND(COALESCE(amount, 0)::numeric, 1)';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'points_ledger'
          AND column_name = 'balance_snapshot'
    ) THEN
        EXECUTE 'ALTER TABLE public.points_ledger ALTER COLUMN balance_snapshot TYPE NUMERIC(12,1) USING ROUND(COALESCE(balance_snapshot, 0)::numeric, 1)';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'pending_referral_rewards'
          AND column_name = 'reward_points'
    ) THEN
        EXECUTE 'ALTER TABLE public.pending_referral_rewards ALTER COLUMN reward_points TYPE NUMERIC(12,1) USING ROUND(COALESCE(reward_points, 0)::numeric, 1)';
    END IF;
END $$;

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
AS $$
DECLARE
    v_product RECORD;
    v_base_unit_price INT;
    v_actual_unit_price INT;
    v_total_price INT;

    v_discount_record RECORD;
    v_discount_amount INT := 0;

    v_user_balance NUMERIC(12,1);
    v_inventory_ids UUID[];
    v_contents TEXT[];

    v_order_id UUID;
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
    IF p_quantity < 1 THEN
        RETURN jsonb_build_object('success', false, 'message', '购买数量必须大于0');
    END IF;

    SELECT id, price_points, name, quantity_rules, flash_sale_end, flash_sale_price, delivery_type, webhook_target, usage_instructions, show_usage_instructions
    INTO v_product
    FROM public.shop_products
    WHERE id = p_product_id
      AND is_active = true;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', '商品不存在或已下架');
    END IF;

    IF v_product.flash_sale_end IS NOT NULL AND v_product.flash_sale_end > NOW() AND v_product.flash_sale_price IS NOT NULL THEN
        v_base_unit_price := v_product.flash_sale_price;
    ELSE
        v_base_unit_price := v_product.price_points;
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

    IF p_discount_code IS NOT NULL AND BTRIM(p_discount_code) <> '' THEN
        p_discount_code := UPPER(BTRIM(p_discount_code));

        SELECT *
        INTO v_discount_record
        FROM public.discount_codes
        WHERE code = p_discount_code
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
            v_discount_amount := v_total_price - (v_total_price * v_discount_record.discount_value / 100);
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
    WHERE user_id = p_user_id
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
            WHERE user_id = p_user_id;

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
            WHERE user_id = p_user_id;
        END;
    END IF;

    IF v_discount_amount > 0 AND p_discount_code IS NOT NULL THEN
        UPDATE public.discount_codes
        SET used_count = used_count + 1
        WHERE code = p_discount_code;
    END IF;

    INSERT INTO public.shop_orders (
        user_id,
        product_id,
        price_paid,
        total_price,
        item_count,
        snapshot_product_name,
        discount_code,
        discount_amount
    )
    VALUES (
        p_user_id,
        p_product_id,
        v_total_price,
        v_total_price + v_discount_amount,
        p_quantity,
        v_product.name,
        p_discount_code,
        v_discount_amount
    )
    RETURNING id INTO v_order_id;

    IF v_product.delivery_type = 'KEY' OR v_product.delivery_type IS NULL THEN
        UPDATE public.shop_inventory
        SET status = 'sold',
            buyer_id = p_user_id,
            sold_at = NOW()
        WHERE id = ANY(v_inventory_ids);

        INSERT INTO public.shop_order_items (order_id, inventory_id, snapshot_product_name, price_paid)
        SELECT v_order_id, unnest(v_inventory_ids), v_product.name, v_actual_unit_price;
    ELSE
        INSERT INTO public.shop_webhook_tasks (order_id, target_url, payload)
        VALUES (
            v_order_id,
            v_product.webhook_target,
            jsonb_build_object(
                'user_id', p_user_id,
                'order_id', v_order_id,
                'product_id', p_product_id,
                'quantity', p_quantity
            )
        );

        INSERT INTO public.shop_order_items (order_id, inventory_id, snapshot_product_name, price_paid)
        VALUES (v_order_id, NULL, v_product.name || ' [API]', v_total_price);
    END IF;

    IF v_total_price > 0 THEN
        INSERT INTO public.points_ledger (user_id, amount, reason, reference_id)
        VALUES (p_user_id, -v_total_price, '商城购买: ' || v_product.name, 'SHOP_ORDER_' || v_order_id);
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
    WHERE id = p_user_id;

    IF v_inviter_id IS NOT NULL AND v_total_price > 0 THEN
        v_commission := ROUND((v_base_unit_price * p_quantity * v_commission_rate)::NUMERIC, 1);
        IF v_commission > 0 THEN
            UPDATE public.points_balance
            SET bonus_balance = ROUND(COALESCE(bonus_balance, 0) + v_commission, 1),
                updated_at = NOW()
            WHERE user_id = v_inviter_id;

            INSERT INTO public.points_ledger (user_id, amount, reason, reference_id)
            VALUES (v_inviter_id, v_commission, v_affiliate_reason, v_affiliate_reference_id);
        END IF;
    END IF;

    IF p_agent_id IS NOT NULL AND v_agent_markup > 0 AND v_total_price > 0 THEN
        UPDATE public.points_balance
        SET paid_balance = COALESCE(paid_balance, 0) + (v_agent_markup * p_quantity),
            updated_at = NOW()
        WHERE user_id = p_agent_id;

        INSERT INTO public.points_ledger (user_id, amount, reason, reference_id)
        VALUES (p_agent_id, (v_agent_markup * p_quantity), '代理商网店利润差额: ' || v_product.name, 'AGENT_PROF_' || v_order_id);
    END IF;

    SELECT *
    INTO v_pending_reward
    FROM public.pending_referral_rewards
    WHERE invitee_id = p_user_id;

    IF FOUND AND v_total_price > 0 THEN
        UPDATE public.points_balance
        SET bonus_balance = ROUND(COALESCE(bonus_balance, 0) + v_pending_reward.reward_points, 1),
            updated_at = NOW()
        WHERE user_id = v_pending_reward.inviter_id;

        INSERT INTO public.points_ledger (user_id, amount, reason, reference_id)
        VALUES (
            v_pending_reward.inviter_id,
            v_pending_reward.reward_points,
            '拉新固定奖励 (下线首单激活)',
            'REG_REWARD_UNLOCK_' || v_order_id
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
            'show_usage_instructions', COALESCE(v_product.show_usage_instructions, false)
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

DO $$
DECLARE
    v_points_balance_has_site BOOLEAN := false;
    v_points_ledger_has_site BOOLEAN := false;
    v_rows_fixed INTEGER := 0;
    v_total_delta NUMERIC(12,1) := 0;
BEGIN
    SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'points_balance'
          AND column_name = 'site'
    ) INTO v_points_balance_has_site;

    SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'points_ledger'
          AND column_name = 'site'
    ) INTO v_points_ledger_has_site;

    DROP TABLE IF EXISTS tmp_affiliate_commission_fix;

    EXECUTE format($sql$
        CREATE TEMP TABLE tmp_affiliate_commission_fix AS
        WITH reward_rows AS (
            SELECT
                pl.id AS ledger_id,
                pl.user_id,
                %s AS site,
                COALESCE(pl.amount, 0)::NUMERIC(12,1) AS current_amount,
                COALESCE(so.price_paid, so.total_price, 0)::NUMERIC(12,1) AS order_amount,
                NULLIF((regexp_match(pl.reason, '([0-9]+(?:\.[0-9]+)?)%%'))[1], '')::NUMERIC AS declared_rate_percent
            FROM public.points_ledger pl
            JOIN public.shop_orders so
              ON so.id::TEXT = CASE
                    WHEN pl.reference_id LIKE 'AFFILIATE_REWARD_%%' THEN SUBSTRING(pl.reference_id FROM LENGTH('AFFILIATE_REWARD_') + 1)
                    WHEN pl.reference_id LIKE 'AFF_REW_%%' THEN SUBSTRING(pl.reference_id FROM LENGTH('AFF_REW_') + 1)
                    ELSE NULL
                 END
            WHERE pl.reference_id LIKE 'AFFILIATE_REWARD_%%'
               OR pl.reference_id LIKE 'AFF_REW_%%'
        )
        SELECT
            ledger_id,
            user_id,
            site,
            current_amount,
            order_amount,
            declared_rate_percent,
            ROUND((order_amount * declared_rate_percent / 100)::NUMERIC, 1) AS expected_amount,
            ROUND(ROUND((order_amount * declared_rate_percent / 100)::NUMERIC, 1) - current_amount, 1) AS delta
        FROM reward_rows
        WHERE declared_rate_percent IS NOT NULL
          AND order_amount > 0
          AND ABS(ROUND((order_amount * declared_rate_percent / 100)::NUMERIC, 1) - current_amount) >= 0.1
    $sql$, CASE WHEN v_points_ledger_has_site THEN 'COALESCE(pl.site, ''cn'')' ELSE '''cn''' END);

    UPDATE public.points_ledger pl
    SET amount = fix.expected_amount
    FROM tmp_affiliate_commission_fix fix
    WHERE pl.id = fix.ledger_id;

    GET DIAGNOSTICS v_rows_fixed = ROW_COUNT;

    SELECT COALESCE(SUM(delta), 0)::NUMERIC(12,1)
    INTO v_total_delta
    FROM tmp_affiliate_commission_fix;

    IF v_total_delta <> 0 THEN
        IF v_points_balance_has_site THEN
            UPDATE public.points_balance pb
            SET bonus_balance = ROUND(COALESCE(pb.bonus_balance, 0) + fix.delta, 1),
                updated_at = NOW()
            FROM (
                SELECT user_id, site, SUM(delta)::NUMERIC(12,1) AS delta
                FROM tmp_affiliate_commission_fix
                GROUP BY user_id, site
            ) fix
            WHERE pb.user_id = fix.user_id
              AND pb.site = fix.site;
        ELSE
            UPDATE public.points_balance pb
            SET bonus_balance = ROUND(COALESCE(pb.bonus_balance, 0) + fix.delta, 1),
                updated_at = NOW()
            FROM (
                SELECT user_id, SUM(delta)::NUMERIC(12,1) AS delta
                FROM tmp_affiliate_commission_fix
                GROUP BY user_id
            ) fix
            WHERE pb.user_id = fix.user_id;
        END IF;
    END IF;

    RAISE NOTICE '[AffiliateCommissionDecimalHotfix] fixed % ledger rows, total balance delta = %', v_rows_fixed, v_total_delta;
END $$;

SELECT
    COUNT(*) AS fixed_rows,
    COALESCE(SUM(delta), 0)::NUMERIC(12,1) AS total_balance_delta
FROM tmp_affiliate_commission_fix;

SELECT
    ledger_id,
    user_id,
    site,
    current_amount,
    expected_amount,
    delta,
    order_amount,
    declared_rate_percent
FROM tmp_affiliate_commission_fix
ORDER BY ABS(delta) DESC, ledger_id DESC
LIMIT 50;
