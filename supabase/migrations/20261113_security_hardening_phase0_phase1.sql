-- ============================================================================
-- Security Hardening Migration: Phase 0 + Phase 1
-- Date: 2026-11-13
-- Scope:
--   1. Re-assert zero-trust privileges on internal/sensitive tables and revoke
--      direct browser INSERT/UPDATE/DELETE policies on public.prompt_unlocks.
--   2. Retire legacy public.unlock_prompt(...) overloads and restrict
--      service-only payment/checkout/shop-delivery/admin-points RPCs to service_role.
--   3. Harden public.unlock_prompt_v2 with search_path pinning, advisory + row
--      locking, site-scoped points_balance access, and prompt validation.
--   4. Harden public.fn_redeem_code with strict site normalization, batch/code
--      site matching, status allowlist ('pending'), and wallet advisory locking.
--   5. Harden public.fn_deduct_points_admin_site_with_breakdown with canonical
--      wallet advisory lock ordering before ledger/balance checks.
--   6. Harden public.fn_guest_shop_confirm_checkout_batch_payment against
--      confirming expired/cancelled/refunded checkout batches.
--   7. Add database-level refund concurrency & terminal-state protection trigger
--      (trg_payment_orders_guard_refund_state) on public.payment_orders.
--   8. Add idempotent partial unique index on public.discount_user_assets for
--      linkage event deduplication (safe duplicate-check guard included).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Part 1: Re-assert Sensitive Table & RLS Lockdowns
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    IF TO_REGCLASS('public.rate_limit_buckets') IS NOT NULL THEN
        REVOKE ALL ON TABLE public.rate_limit_buckets FROM PUBLIC, anon, authenticated;
        GRANT ALL ON TABLE public.rate_limit_buckets TO service_role;
    END IF;

    IF TO_REGCLASS('public.shop_cdk_secrets') IS NOT NULL THEN
        REVOKE ALL ON TABLE public.shop_cdk_secrets FROM PUBLIC, anon, authenticated;
        GRANT ALL ON TABLE public.shop_cdk_secrets TO service_role;
    END IF;

    IF TO_REGCLASS('public.redemption_codes') IS NOT NULL THEN
        REVOKE ALL ON TABLE public.redemption_codes FROM PUBLIC, anon;
        GRANT SELECT ON TABLE public.redemption_codes TO authenticated;
        GRANT ALL ON TABLE public.redemption_codes TO service_role;
    END IF;

    IF TO_REGCLASS('public.redemption_batches') IS NOT NULL THEN
        REVOKE ALL ON TABLE public.redemption_batches FROM PUBLIC, anon;
        GRANT SELECT ON TABLE public.redemption_batches TO authenticated;
        GRANT ALL ON TABLE public.redemption_batches TO service_role;
    END IF;

    IF TO_REGCLASS('public.prompt_unlocks') IS NOT NULL THEN
        ALTER TABLE public.prompt_unlocks ENABLE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS "Authenticated users can insert unlocks" ON public.prompt_unlocks;
        DROP POLICY IF EXISTS "Authenticated users can update unlocks" ON public.prompt_unlocks;
        REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.prompt_unlocks FROM PUBLIC, anon, authenticated;
        GRANT SELECT ON TABLE public.prompt_unlocks TO authenticated;
        GRANT ALL ON TABLE public.prompt_unlocks TO service_role;
    END IF;
END $$;

-- ----------------------------------------------------------------------------
-- Part 2: Retire Legacy unlock_prompt(...) & Restrict Internal RPCs to service_role
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.unlock_prompt(BIGINT, INTEGER);

DO $$
DECLARE
    v_proc RECORD;
BEGIN
    -- Remove any remaining legacy unlock_prompt overloads (keep unlock_prompt_v2).
    FOR v_proc IN
        SELECT p.oid::REGPROCEDURE AS signature
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = 'unlock_prompt'
    LOOP
        EXECUTE format('DROP FUNCTION IF EXISTS %s', v_proc.signature);
    END LOOP;

    -- Restrict internal/server-only payment, checkout, delivery, and points-deduction
    -- RPC overloads strictly to service_role.
    FOR v_proc IN
        SELECT p.oid::REGPROCEDURE AS signature
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN (
              'fn_create_payment_checkout_session',
              'fn_update_payment_checkout_session',
              'fn_create_pending_payment_order_for_checkout_session',
              'fn_claim_shop_webhook_tasks',
              'fn_acquire_shop_delivery_execution_reservation',
              'fn_record_shop_delivery_conflict',
              'fn_deduct_points',
              'fn_deduct_points_admin_site',
              'fn_deduct_points_admin_site_with_breakdown'
          )
    LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_proc.signature);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_proc.signature);
    END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- Part 3: Harden public.unlock_prompt_v2
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.unlock_prompt_v2(
    p_prompt_id TEXT,
    p_cost INTEGER,
    p_site TEXT DEFAULT 'cn'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_total_balance NUMERIC(12,1);
    v_paid_balance NUMERIC(12,1);
    v_bonus_balance NUMERIC(12,1);
    v_prompt_id_bigint BIGINT;
    v_is_banned BOOLEAN;
    v_site TEXT := CASE WHEN LOWER(BTRIM(COALESCE(p_site, 'cn'))) = 'intl' THEN 'intl' ELSE 'cn' END;
    v_unlock_pricing JSONB := '{}'::jsonb;
    v_unlock_cost INTEGER := 1;
    v_free_daily_limit INTEGER := 3;
    v_free_unlocks_today INTEGER := 0;
    v_cost_remaining NUMERIC(12,1);
    v_new_bonus NUMERIC(12,1);
    v_new_paid NUMERIC(12,1);
BEGIN
    v_user_id := auth.uid();

    IF p_prompt_id IS NULL OR BTRIM(p_prompt_id) !~ '^\d+$' THEN
        RETURN jsonb_build_object('success', false, 'error', '无效的 Prompt ID');
    END IF;

    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', '请先登录后再解锁');
    END IF;

    IF p_cost IS NOT NULL AND p_cost < 0 THEN
        RETURN jsonb_build_object('success', false, 'error', '无效的解锁积分');
    END IF;

    v_prompt_id_bigint := BTRIM(p_prompt_id)::BIGINT;

    IF NOT EXISTS (
        SELECT 1
        FROM public.prompts pr
        WHERE pr.id::TEXT = v_prompt_id_bigint::TEXT
          AND COALESCE(pr.gallery_status, 'published') = 'published'
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', '内容不存在或已下架');
    END IF;

    SELECT COALESCE(public.fn_resolve_site_scoped_system_config('unlock_pricing', v_site), '{}'::jsonb)
    INTO v_unlock_pricing;

    v_unlock_cost := CASE
        WHEN COALESCE(v_unlock_pricing->>'default_points', '') ~ '^\d+(\.\d+)?$'
            THEN GREATEST(0, FLOOR((v_unlock_pricing->>'default_points')::NUMERIC)::INTEGER)
        ELSE 1
    END;

    IF p_cost IS NOT NULL AND p_cost < v_unlock_cost THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'unlock_price_changed',
            'error', '解锁价格已更新，请刷新后重试'
        );
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM public.blocked_users
        WHERE user_id = v_user_id
          AND (scope = 'points_usage' OR scope = 'all')
          AND (expires_at IS NULL OR expires_at > NOW())
    ) INTO v_is_banned;

    IF v_is_banned THEN
        RETURN jsonb_build_object('success', false, 'error', '您的积分消费功能已被暂时冻结');
    END IF;

    -- Serialize concurrent unlock requests per user + site before reading/mutating balance.
    PERFORM pg_advisory_xact_lock(
        hashtext('points_wallet:' || v_user_id::TEXT || ':' || v_site)::BIGINT
    );

    IF EXISTS (
        SELECT 1
        FROM public.prompt_unlocks
        WHERE user_id = v_user_id
          AND prompt_id = v_prompt_id_bigint
          AND site = v_site
    ) THEN
        RETURN jsonb_build_object('success', true, 'message', '该内容已解锁', 'already_unlocked', true);
    END IF;

    SELECT paid_balance, bonus_balance
    INTO v_paid_balance, v_bonus_balance
    FROM public.points_balance
    WHERE user_id = v_user_id
      AND site = v_site
    FOR UPDATE;

    v_paid_balance := COALESCE(v_paid_balance, 0);
    v_bonus_balance := COALESCE(v_bonus_balance, 0);
    v_total_balance := v_paid_balance + v_bonus_balance;

    IF v_total_balance < v_unlock_cost THEN
        RETURN jsonb_build_object('success', false, 'error', '积分不足，无法解锁');
    END IF;

    IF v_unlock_cost = 0 THEN
        v_free_daily_limit := CASE
            WHEN COALESCE(v_unlock_pricing->>'free_daily_limit', '') ~ '^\d+$'
                THEN GREATEST(0, (v_unlock_pricing->>'free_daily_limit')::INTEGER)
            ELSE 3
        END;

        IF v_free_daily_limit > 0 THEN
            PERFORM pg_advisory_xact_lock(
                hashtext('unlock_prompt_free_daily:' || v_user_id::TEXT || ':' || v_site || ':' || TO_CHAR(NOW(), 'YYYY-MM-DD'))::BIGINT
            );

            SELECT COUNT(*)::INTEGER
            INTO v_free_unlocks_today
            FROM public.prompt_unlocks
            WHERE user_id = v_user_id
              AND site = v_site
              AND cost = 0
              AND unlocked_at >= date_trunc('day', NOW())
              AND unlocked_at < date_trunc('day', NOW()) + INTERVAL '1 day';

            IF v_free_unlocks_today >= v_free_daily_limit THEN
                RETURN jsonb_build_object(
                    'success', false,
                    'code', 'free_daily_limit_reached',
                    'error', '今日免费解锁次数已用完，请明天再来或联系管理员调整限制',
                    'free_daily_limit', v_free_daily_limit,
                    'free_unlocks_today', v_free_unlocks_today
                );
            END IF;
        END IF;
    END IF;

    v_cost_remaining := v_unlock_cost;
    v_new_bonus := v_bonus_balance;
    v_new_paid := v_paid_balance;

    IF v_new_bonus >= v_cost_remaining THEN
        v_new_bonus := v_new_bonus - v_cost_remaining;
        v_cost_remaining := 0;
    ELSE
        v_cost_remaining := v_cost_remaining - v_new_bonus;
        v_new_bonus := 0;
    END IF;

    IF v_cost_remaining > 0 THEN
        IF v_new_paid >= v_cost_remaining THEN
            v_new_paid := v_new_paid - v_cost_remaining;
            v_cost_remaining := 0;
        ELSE
            RETURN jsonb_build_object('success', false, 'error', '计算错误：积分扣除异常');
        END IF;
    END IF;

    IF v_unlock_cost > 0 THEN
        UPDATE public.points_balance
        SET paid_balance = v_new_paid,
            bonus_balance = v_new_bonus,
            updated_at = NOW(),
            version = COALESCE(version, 0) + 1
        WHERE user_id = v_user_id
          AND site = v_site;

        IF NOT FOUND THEN
            RETURN jsonb_build_object('success', false, 'error', '计算错误：积分扣除异常');
        END IF;
    END IF;

    INSERT INTO public.points_ledger (user_id, amount, reason, reference_id, site)
    VALUES (v_user_id, -v_unlock_cost, 'unlock_prompt', BTRIM(p_prompt_id), v_site);

    INSERT INTO public.prompt_unlocks (user_id, prompt_id, cost, site)
    VALUES (v_user_id, v_prompt_id_bigint, v_unlock_cost, v_site);

    RETURN jsonb_build_object('success', true, 'new_balance', v_paid_balance + v_bonus_balance - v_unlock_cost);
END;
$$;

REVOKE ALL ON FUNCTION public.unlock_prompt_v2(TEXT, INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unlock_prompt_v2(TEXT, INTEGER, TEXT) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Part 4: Harden public.fn_redeem_code
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_redeem_code(
    p_code VARCHAR,
    p_site VARCHAR DEFAULT 'cn'
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_code_record RECORD;
    v_batch_expires_at TIMESTAMPTZ;
    v_batch_site VARCHAR;
    v_effective_code_site VARCHAR;
    v_package RECORD;
    v_points_amount NUMERIC(12,2);
    v_package_name TEXT;
    v_effective_expires_at TIMESTAMPTZ;
    v_site VARCHAR := CASE WHEN LOWER(BTRIM(COALESCE(p_site, 'cn'))) = 'intl' THEN 'intl' ELSE 'cn' END;
    v_rate_limit_allowed BOOLEAN := FALSE;
    v_redeem_ledger_id UUID;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'auth required';
    END IF;

    -- Required dependency: errors or an empty limiter result must never authorize redemption.
    BEGIN
        SELECT allowed INTO v_rate_limit_allowed
        FROM public.take_rate_limit_token('redeem:user:' || v_user_id::TEXT, 10, 60000);
    EXCEPTION WHEN OTHERS THEN
        RETURN json_build_object(
            'success', false,
            'code', 'rate_limit_unavailable',
            'message', '兑换服务暂不可用，请稍后重试'
        );
    END;
    IF v_rate_limit_allowed IS NOT TRUE THEN
        RETURN json_build_object(
            'success', false,
            'code', 'rate_limited',
            'message', '兑换请求过于频繁，请稍后重试'
        );
    END IF;

    p_code := UPPER(TRIM(COALESCE(p_code, '')));

    IF p_code = '' THEN
        RETURN json_build_object('success', false, 'message', '兑换码不能为空');
    END IF;

    SELECT *
    INTO v_code_record
    FROM public.redemption_codes
    WHERE code = p_code
    FOR UPDATE;

    IF v_code_record IS NULL THEN
        RETURN json_build_object('success', false, 'message', '无效的兑换码');
    END IF;

    IF v_code_record.status = 'used' THEN
        RETURN json_build_object('success', false, 'message', '该兑换码已被使用');
    ELSIF v_code_record.status = 'revoked' THEN
        RETURN json_build_object('success', false, 'message', '该兑换码已被撤销');
    ELSIF v_code_record.status = 'locked' THEN
        RETURN json_build_object('success', false, 'message', '该兑换码已被锁定');
    ELSIF v_code_record.status = 'disabled' THEN
        RETURN json_build_object('success', false, 'message', '该兑换码已被禁用');
    ELSIF COALESCE(v_code_record.status, 'pending') <> 'pending' THEN
        RETURN json_build_object('success', false, 'message', '该兑换码当前不可兑换');
    END IF;

    SELECT expires_at, site
    INTO v_batch_expires_at, v_batch_site
    FROM public.redemption_batches
    WHERE id = v_code_record.batch_id;

    v_effective_code_site := CASE
        WHEN LOWER(BTRIM(COALESCE(NULLIF(BTRIM(v_code_record.site), ''), NULLIF(BTRIM(v_batch_site), ''), 'cn'))) = 'intl'
            THEN 'intl'
        ELSE 'cn'
    END;

    IF v_effective_code_site <> v_site THEN
        RETURN json_build_object(
            'success', false,
            'code', 'site_mismatch',
            'message', '该兑换码不适用于当前站点'
        );
    END IF;

    v_effective_expires_at := COALESCE(v_code_record.expires_at, v_batch_expires_at);

    IF v_effective_expires_at IS NOT NULL AND v_effective_expires_at < NOW() THEN
        RETURN json_build_object('success', false, 'message', '该兑换码已过期');
    END IF;

    SELECT *
    INTO v_package
    FROM public.points_packages
    WHERE id = v_code_record.package_id;

    IF v_package IS NULL THEN
        IF COALESCE(v_code_record.points_amount, 0) > 0 THEN
            v_points_amount := ROUND(COALESCE(v_code_record.points_amount, 0), 2);
            v_package_name := '自定义积分';
        ELSE
            RETURN json_build_object('success', false, 'message', '关联的套餐不存在');
        END IF;
    ELSE
        v_points_amount := ROUND(COALESCE(v_package.points_amount, 0) + COALESCE(v_package.bonus_points, 0), 2);
        v_package_name := v_package.name;
    END IF;

    IF v_points_amount IS NULL OR v_points_amount <= 0 THEN
        RETURN json_build_object('success', false, 'message', '兑换码积分配置无效');
    END IF;

    PERFORM pg_advisory_xact_lock(
        hashtext('points_wallet:' || v_user_id::TEXT || ':' || v_site)::BIGINT
    );

    INSERT INTO public.points_ledger (user_id, amount, reason, reference_id, site)
    VALUES (
        v_user_id,
        v_points_amount,
        '兑换码充值: ' || v_package_name,
        'redeem_' || p_code,
        v_site
    ) RETURNING id INTO v_redeem_ledger_id;

    INSERT INTO public.points_balance (user_id, site, paid_balance, bonus_balance)
    VALUES (v_user_id, v_site, v_points_amount, 0)
    ON CONFLICT (user_id, site)
    DO UPDATE SET
        paid_balance = ROUND(public.points_balance.paid_balance + EXCLUDED.paid_balance, 2),
        updated_at = NOW(),
        version = COALESCE(public.points_balance.version, 0) + 1;

    PERFORM public.fn_create_wallet_point_lot(
        v_user_id, v_site, 'redemption_code',
        '兑换码充值: ' || v_package_name, 'redeem_' || p_code,
        v_points_amount, v_points_amount, 'CNY', v_redeem_ledger_id,
        jsonb_build_object('code', p_code, 'package_id', v_code_record.package_id)
    );

    UPDATE public.redemption_codes
    SET status = 'used',
        used_by = v_user_id,
        used_at = NOW(),
        points_granted = v_points_amount
    WHERE id = v_code_record.id;

    RETURN json_build_object(
        'success', true,
        'message', '兑换成功！',
        'points', v_points_amount,
        'package_name', v_package_name
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_redeem_code(VARCHAR, VARCHAR) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_redeem_code(VARCHAR, VARCHAR) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Part 5: Harden public.fn_deduct_points_admin_site_with_breakdown Lock Ordering
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_deduct_points_admin_site_with_breakdown(
    p_target_user_id UUID,
    p_amount NUMERIC,
    p_reason TEXT DEFAULT 'Admin Deduction',
    p_reference_id TEXT DEFAULT NULL,
    p_site VARCHAR DEFAULT 'cn'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_site VARCHAR := CASE WHEN LOWER(BTRIM(COALESCE(p_site, 'cn'))) = 'intl' THEN 'intl' ELSE 'cn' END;
    current_bonus NUMERIC(18,6);
    current_paid NUMERIC(18,6);
    deduct_from_bonus NUMERIC(18,6) := 0;
    deduct_from_paid NUMERIC(18,6) := 0;
    actual_deducted NUMERIC(18,6) := 0;
    existing_amount NUMERIC(18,6) := 0;
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    IF p_target_user_id IS NULL THEN
        RAISE EXCEPTION 'target_user_id is required';
    END IF;

    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'Amount must be positive';
    END IF;

    -- Canonical per-user-per-site advisory lock prevents races and lock-order inversion.
    PERFORM pg_advisory_xact_lock(
        hashtext('points_wallet:' || p_target_user_id::TEXT || ':' || v_site)::BIGINT
    );

    IF p_reference_id IS NOT NULL THEN
        SELECT ABS(amount) INTO existing_amount
        FROM public.points_ledger
        WHERE user_id = p_target_user_id
          AND reference_id = p_reference_id
          AND site = v_site
          AND amount < 0
        ORDER BY created_at DESC
        LIMIT 1;

        IF existing_amount > 0 THEN
            RETURN jsonb_build_object(
                'success', true,
                'deducted', existing_amount,
                'deducted_paid', 0,
                'deducted_bonus', 0,
                'duplicate', true,
                'site', v_site
            );
        END IF;
    END IF;

    SELECT bonus_balance, paid_balance INTO current_bonus, current_paid
    FROM public.points_balance
    WHERE user_id = p_target_user_id
      AND site = v_site
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', true,
            'deducted', 0,
            'deducted_paid', 0,
            'deducted_bonus', 0,
            'message', 'User has no balance account for this site',
            'site', v_site
        );
    END IF;

    actual_deducted := ROUND(LEAST(ROUND(p_amount, 6), ROUND(current_bonus + current_paid, 6)), 6);

    IF actual_deducted <= 0 THEN
        RETURN jsonb_build_object(
            'success', true,
            'deducted', 0,
            'deducted_paid', 0,
            'deducted_bonus', 0,
            'message', 'User has zero balance',
            'site', v_site
        );
    END IF;

    IF current_bonus >= actual_deducted THEN
        deduct_from_bonus := actual_deducted;
        deduct_from_paid := 0;
    ELSE
        deduct_from_bonus := current_bonus;
        deduct_from_paid := actual_deducted - current_bonus;
    END IF;

    UPDATE public.points_balance
    SET bonus_balance = ROUND(bonus_balance - deduct_from_bonus, 6),
        paid_balance = ROUND(paid_balance - deduct_from_paid, 6),
        updated_at = NOW(),
        version = COALESCE(version, 0) + 1
    WHERE user_id = p_target_user_id
      AND site = v_site;

    INSERT INTO public.points_ledger (user_id, amount, reason, reference_id, site)
    VALUES (p_target_user_id, -actual_deducted, p_reason, p_reference_id, v_site);

    RETURN jsonb_build_object(
        'success', true,
        'deducted', actual_deducted,
        'deducted_paid', deduct_from_paid,
        'deducted_bonus', deduct_from_bonus,
        'new_total', ROUND(current_bonus + current_paid - actual_deducted, 6),
        'site', v_site
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_deduct_points_admin_site_with_breakdown(UUID, NUMERIC, TEXT, TEXT, VARCHAR) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_deduct_points_admin_site_with_breakdown(UUID, NUMERIC, TEXT, TEXT, VARCHAR) TO service_role;

-- ----------------------------------------------------------------------------
-- Part 6: Harden public.fn_guest_shop_confirm_checkout_batch_payment
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    IF TO_REGPROCEDURE('public.fn_guest_shop_confirm_checkout_batch_payment(uuid,text,text,numeric,text)') IS NOT NULL THEN
        EXECUTE $fn$
            CREATE OR REPLACE FUNCTION public.fn_guest_shop_confirm_checkout_batch_payment(
                p_payment_id UUID, p_provider TEXT, p_provider_order_no TEXT,
                p_observed_amount NUMERIC, p_observed_status TEXT
            )
            RETURNS TABLE (batch_id UUID, batch_no TEXT, payment_status TEXT, fulfillment_status TEXT)
            LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $body$
            DECLARE
                v_payment public.guest_shop_checkout_payments%ROWTYPE;
                v_batch public.guest_shop_checkout_batches%ROWTYPE;
            BEGIN
                PERFORM public.guest_shop_require_service_role();
                SELECT * INTO v_payment FROM public.guest_shop_checkout_payments WHERE id = p_payment_id FOR UPDATE;
                IF NOT FOUND THEN RAISE EXCEPTION 'guest_checkout_payment_not_found'; END IF;
                SELECT * INTO v_batch FROM public.guest_shop_checkout_batches WHERE id = v_payment.batch_id FOR UPDATE;
                IF NOT FOUND THEN RAISE EXCEPTION 'guest_checkout_batch_not_found'; END IF;
                IF v_payment.provider <> LOWER(BTRIM(COALESCE(p_provider, ''))) THEN
                    RAISE EXCEPTION 'guest_payment_binding_mismatch';
                END IF;
                IF NULLIF(BTRIM(p_provider_order_no), '') IS NULL THEN
                    RAISE EXCEPTION 'guest_payment_provider_order_missing';
                END IF;
                IF v_payment.provider_order_no IS NOT NULL
                   AND v_payment.provider_order_no <> BTRIM(p_provider_order_no) THEN
                    RAISE EXCEPTION 'guest_payment_binding_mismatch';
                END IF;
                IF v_batch.payment_status IN ('expired', 'cancelled', 'refunded')
                   OR v_payment.status IN ('expired', 'cancelled', 'refunded') THEN
                    RAISE EXCEPTION 'guest_checkout_batch_not_confirmable';
                END IF;
                IF ROUND(COALESCE(p_observed_amount, 0), 2) <> v_payment.expected_amount THEN
                    RAISE EXCEPTION 'guest_payment_amount_mismatch';
                END IF;
                IF LOWER(BTRIM(COALESCE(p_observed_status, ''))) NOT IN ('paid', 'confirmed', 'complete', 'completed', 'success') THEN
                    RAISE EXCEPTION 'guest_payment_status_not_final';
                END IF;
                IF v_payment.status <> 'confirmed' THEN
                    UPDATE public.guest_shop_checkout_payments
                    SET provider_order_no = NULLIF(BTRIM(p_provider_order_no), ''),
                        paid_amount = v_payment.expected_amount,
                        status = 'confirmed',
                        paid_at = clock_timestamp(),
                        updated_at = clock_timestamp()
                    WHERE id = v_payment.id;

                    UPDATE public.guest_shop_checkout_batches
                    SET payment_status = 'confirmed',
                        paid_at = clock_timestamp(),
                        updated_at = clock_timestamp()
                    WHERE guest_shop_checkout_batches.id = v_batch.id AND guest_shop_checkout_batches.payment_status <> 'confirmed';
                END IF;
                RETURN QUERY SELECT v_batch.id, v_batch.batch_no, 'confirmed'::TEXT, v_batch.fulfillment_status;
            END;
            $body$;
        $fn$;
        REVOKE ALL ON FUNCTION public.fn_guest_shop_confirm_checkout_batch_payment(UUID, TEXT, TEXT, NUMERIC, TEXT) FROM PUBLIC, anon, authenticated;
        GRANT EXECUTE ON FUNCTION public.fn_guest_shop_confirm_checkout_batch_payment(UUID, TEXT, TEXT, NUMERIC, TEXT) TO service_role;
    END IF;
END $$;

-- ----------------------------------------------------------------------------
-- Part 7: Database-Level Refund Concurrency & Terminal State Guard on payment_orders
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_guard_payment_order_refund_state()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_old_status TEXT := LOWER(BTRIM(COALESCE(OLD.status, '')));
    v_new_status TEXT := LOWER(BTRIM(COALESCE(NEW.status, '')));
    v_old_refund_status TEXT := LOWER(BTRIM(COALESCE(OLD.provider_metadata->>'refund_status', '')));
    v_new_refund_status TEXT := LOWER(BTRIM(COALESCE(NEW.provider_metadata->>'refund_status', '')));
    v_old_attempt_id TEXT := NULLIF(BTRIM(COALESCE(OLD.provider_metadata->>'refund_attempt_id', '')), '');
    v_new_attempt_id TEXT := NULLIF(BTRIM(COALESCE(NEW.provider_metadata->>'refund_attempt_id', '')), '');
BEGIN
    -- Prevent a refunded order from being resurrected by late webhooks or active polling.
    IF v_old_status = 'refunded' AND v_new_status <> 'refunded' THEN
        RAISE EXCEPTION 'payment_order_already_refunded' USING ERRCODE = '55000';
    END IF;

    -- Prevent two concurrent admin refund claims from entering refund_pending together.
    IF v_old_refund_status = 'refund_pending'
       AND v_new_refund_status = 'refund_pending'
       AND v_new_attempt_id IS DISTINCT FROM v_old_attempt_id THEN
        RAISE EXCEPTION 'payment_refund_already_pending' USING ERRCODE = '55000';
    END IF;

    -- Prevent non-refund settlement writes while an active refund is in flight.
    IF v_old_refund_status = 'refund_pending'
       AND v_new_status <> 'refunded'
       AND v_new_refund_status NOT IN ('refund_failed', 'refund_compensation_failed', 'refunded')
       AND v_new_status IN ('paid', 'redeemed', 'pending_review', 'amount_mismatch')
       AND v_new_status IS DISTINCT FROM v_old_status THEN
        RAISE EXCEPTION 'payment_refund_already_pending' USING ERRCODE = '55000';
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_guard_payment_order_refund_state() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
    IF TO_REGCLASS('public.payment_orders') IS NOT NULL THEN
        DROP TRIGGER IF EXISTS trg_payment_orders_guard_refund_state ON public.payment_orders;
        CREATE TRIGGER trg_payment_orders_guard_refund_state
            BEFORE UPDATE ON public.payment_orders
            FOR EACH ROW
            EXECUTE FUNCTION public.fn_guard_payment_order_refund_state();
    END IF;
END $$;

-- ----------------------------------------------------------------------------
-- Part 8: Discount Trigger Linkage Deduplication Partial Unique Index
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_has_duplicates BOOLEAN := FALSE;
BEGIN
    IF TO_REGCLASS('public.discount_user_assets') IS NOT NULL THEN
        SELECT EXISTS (
            SELECT 1
            FROM public.discount_user_assets
            WHERE source_batch_id IS NOT NULL
              AND source_type IN ('recharge_linkage', 'checkin_linkage', 'affiliate_linkage')
            GROUP BY user_id, discount_id, source_batch_id
            HAVING COUNT(*) > 1
        ) INTO v_has_duplicates;

        IF v_has_duplicates THEN
            RAISE NOTICE 'Skipped idx_discount_user_assets_linkage_batch_unique: historical duplicate linkage rows exist in discount_user_assets';
        ELSE
            CREATE UNIQUE INDEX IF NOT EXISTS idx_discount_user_assets_linkage_batch_unique
                ON public.discount_user_assets (user_id, discount_id, source_batch_id)
                WHERE source_batch_id IS NOT NULL
                  AND source_type IN ('recharge_linkage', 'checkin_linkage', 'affiliate_linkage');
        END IF;
    END IF;
END $$;
