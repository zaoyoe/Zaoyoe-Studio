-- ============================================
-- Shop Delivery Pipeline V1
-- 数据库状态机 + 任务领取 + 最小履约闭环
-- ============================================

ALTER TABLE IF EXISTS public.shop_webhook_tasks
    ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 5,
    ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_error TEXT,
    ADD COLUMN IF NOT EXISTS last_response_status INTEGER,
    ADD COLUMN IF NOT EXISTS last_response_body TEXT,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS lock_expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS lock_token TEXT,
    ADD COLUMN IF NOT EXISTS worker_name TEXT,
    ADD COLUMN IF NOT EXISTS dedupe_key TEXT,
    ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS dead_lettered_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS manual_replay_requested_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS manual_replay_requested_by UUID,
    ADD COLUMN IF NOT EXISTS manual_replay_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE IF EXISTS public.shop_webhook_tasks
    ADD COLUMN IF NOT EXISTS executed_at TIMESTAMPTZ;

UPDATE public.shop_webhook_tasks
SET
    status = CASE
        WHEN COALESCE(status, '') IN ('delivered', 'completed', 'success') OR executed_at IS NOT NULL THEN 'delivered'
        WHEN COALESCE(status, '') = 'dead_letter' THEN 'dead_letter'
        WHEN COALESCE(status, '') IN ('retry_waiting', 'requeued') THEN status
        WHEN COALESCE(status, '') = 'processing' THEN 'retry_waiting'
        WHEN COALESCE(status, '') IN ('failed', 'error') THEN 'retry_waiting'
        ELSE 'pending'
    END,
    attempt_count = COALESCE(attempt_count, CASE WHEN executed_at IS NOT NULL THEN 1 ELSE 0 END),
    max_attempts = COALESCE(max_attempts, 5),
    next_attempt_at = COALESCE(next_attempt_at, NOW()),
    updated_at = COALESCE(updated_at, NOW()),
    dedupe_key = COALESCE(NULLIF(dedupe_key, ''), 'shop_delivery:' || order_id::TEXT),
    delivered_at = CASE
        WHEN (COALESCE(status, '') IN ('delivered', 'completed', 'success') OR executed_at IS NOT NULL)
            THEN COALESCE(delivered_at, executed_at, NOW())
        ELSE delivered_at
    END,
    dead_lettered_at = CASE
        WHEN COALESCE(status, '') = 'dead_letter' THEN COALESCE(dead_lettered_at, NOW())
        ELSE dead_lettered_at
    END;

CREATE INDEX IF NOT EXISTS idx_shop_webhook_tasks_status_next_attempt
    ON public.shop_webhook_tasks(status, next_attempt_at);

CREATE INDEX IF NOT EXISTS idx_shop_webhook_tasks_order_id
    ON public.shop_webhook_tasks(order_id);

CREATE INDEX IF NOT EXISTS idx_shop_webhook_tasks_lock_expires_at
    ON public.shop_webhook_tasks(lock_expires_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_shop_webhook_tasks_dedupe_key_unique
    ON public.shop_webhook_tasks(dedupe_key)
    WHERE dedupe_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.shop_webhook_task_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES public.shop_webhook_tasks(id) ON DELETE CASCADE,
    attempt_no INTEGER NOT NULL,
    worker_name TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    success BOOLEAN,
    response_status INTEGER,
    response_body TEXT,
    error_message TEXT,
    duration_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_shop_webhook_task_attempts_task_id
    ON public.shop_webhook_task_attempts(task_id, started_at DESC);

ALTER TABLE IF EXISTS public.shop_orders
    ADD COLUMN IF NOT EXISTS delivery_status TEXT,
    ADD COLUMN IF NOT EXISTS delivery_attempt_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS delivery_last_error TEXT,
    ADD COLUMN IF NOT EXISTS delivery_task_id UUID,
    ADD COLUMN IF NOT EXISTS delivery_completed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS delivery_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE table_schema = 'public'
          AND table_name = 'shop_orders'
          AND constraint_name = 'shop_orders_delivery_task_id_fkey'
    ) THEN
        ALTER TABLE public.shop_orders
            ADD CONSTRAINT shop_orders_delivery_task_id_fkey
            FOREIGN KEY (delivery_task_id)
            REFERENCES public.shop_webhook_tasks(id)
            ON DELETE SET NULL;
    END IF;
END $$;

WITH latest_task AS (
    SELECT DISTINCT ON (t.order_id)
        t.id,
        t.order_id,
        t.status,
        COALESCE(t.attempt_count, 0) AS attempt_count,
        t.last_error,
        t.delivered_at,
        t.updated_at
    FROM public.shop_webhook_tasks t
    WHERE t.order_id IS NOT NULL
    ORDER BY t.order_id, COALESCE(t.updated_at, t.created_at) DESC, t.created_at DESC
)
UPDATE public.shop_orders o
SET
    delivery_status = CASE
        WHEN COALESCE(o.refund_status, 'none') IN ('refunded', 'full_refund') THEN 'refunded'
        WHEN lt.status = 'delivered' THEN 'delivered'
        WHEN lt.status = 'dead_letter' THEN 'dead_letter'
        WHEN lt.status = 'processing' THEN 'processing'
        WHEN lt.status IN ('retry_waiting', 'requeued') THEN lt.status
        WHEN lt.id IS NOT NULL THEN 'pending'
        WHEN o.inventory_id IS NOT NULL
            OR EXISTS (
                SELECT 1
                FROM public.shop_order_items soi
                WHERE soi.order_id = o.id
                  AND soi.inventory_id IS NOT NULL
            ) THEN 'delivered'
        ELSE COALESCE(o.delivery_status, 'pending')
    END,
    delivery_task_id = COALESCE(o.delivery_task_id, lt.id),
    delivery_attempt_count = GREATEST(COALESCE(o.delivery_attempt_count, 0), COALESCE(lt.attempt_count, 0)),
    delivery_last_error = COALESCE(lt.last_error, o.delivery_last_error),
    delivery_completed_at = COALESCE(
        o.delivery_completed_at,
        lt.delivered_at,
        CASE
            WHEN o.inventory_id IS NOT NULL
                OR EXISTS (
                    SELECT 1
                    FROM public.shop_order_items soi
                    WHERE soi.order_id = o.id
                      AND soi.inventory_id IS NOT NULL
                ) THEN o.created_at
            ELSE NULL
        END
    ),
    delivery_updated_at = NOW()
FROM latest_task lt
WHERE o.id = lt.order_id;

UPDATE public.shop_orders o
SET
    delivery_status = CASE
        WHEN COALESCE(o.refund_status, 'none') IN ('refunded', 'full_refund') THEN 'refunded'
        WHEN o.inventory_id IS NOT NULL
            OR EXISTS (
                SELECT 1
                FROM public.shop_order_items soi
                WHERE soi.order_id = o.id
                  AND soi.inventory_id IS NOT NULL
            ) THEN 'delivered'
        ELSE COALESCE(o.delivery_status, 'pending')
    END,
    delivery_completed_at = COALESCE(
        o.delivery_completed_at,
        CASE
            WHEN o.inventory_id IS NOT NULL
                OR EXISTS (
                    SELECT 1
                    FROM public.shop_order_items soi
                    WHERE soi.order_id = o.id
                      AND soi.inventory_id IS NOT NULL
                ) THEN o.created_at
            ELSE NULL
        END
    ),
    delivery_updated_at = COALESCE(o.delivery_updated_at, NOW())
WHERE o.delivery_status IS NULL;

CREATE OR REPLACE FUNCTION public.fn_claim_shop_webhook_tasks(
    p_limit INTEGER DEFAULT 10,
    p_lock_seconds INTEGER DEFAULT 120,
    p_worker_name TEXT DEFAULT 'shop-delivery-worker'
)
RETURNS TABLE (
    id UUID,
    order_id UUID,
    target_url TEXT,
    payload JSONB,
    status TEXT,
    attempt_count INTEGER,
    max_attempts INTEGER,
    dedupe_key TEXT,
    lock_token TEXT,
    worker_name TEXT,
    next_attempt_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_now TIMESTAMPTZ := NOW();
    v_limit INTEGER := GREATEST(COALESCE(p_limit, 10), 1);
    v_lock_seconds INTEGER := GREATEST(COALESCE(p_lock_seconds, 120), 30);
    v_worker_name TEXT := COALESCE(NULLIF(BTRIM(p_worker_name), ''), 'shop-delivery-worker');
BEGIN
    RETURN QUERY
    WITH candidates AS (
        SELECT t.id
        FROM public.shop_webhook_tasks t
        WHERE (
            (
                t.status IN ('pending', 'retry_waiting', 'requeued')
                AND COALESCE(t.next_attempt_at, v_now) <= v_now
            )
            OR (
                t.status = 'processing'
                AND COALESCE(t.lock_expires_at, TO_TIMESTAMP(0)) <= v_now
            )
        )
          AND COALESCE(t.attempt_count, 0) < COALESCE(t.max_attempts, 5)
        ORDER BY COALESCE(t.next_attempt_at, t.created_at) ASC, t.created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT v_limit
    ),
    claimed AS (
        UPDATE public.shop_webhook_tasks t
        SET
            status = 'processing',
            attempt_count = COALESCE(t.attempt_count, 0) + 1,
            last_attempt_at = v_now,
            locked_at = v_now,
            lock_expires_at = v_now + make_interval(secs => v_lock_seconds),
            lock_token = gen_random_uuid()::TEXT,
            worker_name = v_worker_name,
            updated_at = v_now
        FROM candidates c
        WHERE t.id = c.id
        RETURNING
            t.id,
            t.order_id,
            t.target_url::TEXT,
            t.payload,
            t.status,
            t.attempt_count,
            t.max_attempts,
            t.dedupe_key,
            t.lock_token,
            t.worker_name,
            t.next_attempt_at
    )
    SELECT
        claimed.id,
        claimed.order_id,
        claimed.target_url,
        claimed.payload,
        claimed.status,
        claimed.attempt_count,
        claimed.max_attempts,
        claimed.dedupe_key,
        claimed.lock_token,
        claimed.worker_name,
        claimed.next_attempt_at
    FROM claimed;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_claim_shop_webhook_tasks(INTEGER, INTEGER, TEXT) TO authenticated, service_role;

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
                'user_id', p_user_id,
                'order_id', v_order_id,
                'product_id', p_product_id,
                'quantity', p_quantity
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
