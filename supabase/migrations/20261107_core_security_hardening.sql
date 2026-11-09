-- ============================================================================
-- Core Security Hardening Migration
-- Date: 2026-11-07
-- Scope:
-- 1. Enforce physical non-negative balance CHECK constraints on points_balance.
-- 2. Lockdown PostgREST exposure on sensitive tables (redemption codes, batches, rate limit buckets, shop CDK secrets).
-- 3. Implement anti-brute-force rate limiting in fn_redeem_code.
-- 4. Provide automated CDK ciphertext-clearing routine for delivered keys.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Part 1: Physical CHECK Constraint on points_balance (Anti-Negative Balance)
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    IF TO_REGCLASS('public.points_balance') IS NOT NULL THEN
        -- Never repair financial records by silently changing account balances.
        IF EXISTS (SELECT 1 FROM public.points_balance WHERE paid_balance < 0 OR bonus_balance < 0) THEN
            RAISE EXCEPTION 'Negative balances require reconciliation before this migration';
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'points_balance_non_negative_check'
              AND conrelid = 'public.points_balance'::regclass
        ) THEN
            ALTER TABLE public.points_balance
            ADD CONSTRAINT points_balance_non_negative_check
            CHECK (paid_balance >= 0 AND bonus_balance >= 0);
        END IF;
    END IF;
END $$;

-- ----------------------------------------------------------------------------
-- Part 2: PostgREST Privilege Lockdown (Zero-Trust Access Control)
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    -- Anonymous access is forbidden. Authenticated admin SELECT still requires existing RLS policies.
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

    -- Strict internal-only tables: rate limits and encrypted CDK secrets
    IF TO_REGCLASS('public.rate_limit_buckets') IS NOT NULL THEN
        REVOKE ALL ON TABLE public.rate_limit_buckets FROM PUBLIC, anon, authenticated;
        GRANT ALL ON TABLE public.rate_limit_buckets TO service_role;
    END IF;

    IF TO_REGCLASS('public.shop_cdk_secrets') IS NOT NULL THEN
        REVOKE ALL ON TABLE public.shop_cdk_secrets FROM PUBLIC, anon, authenticated;
        GRANT ALL ON TABLE public.shop_cdk_secrets TO service_role;
    END IF;
END $$;

-- ----------------------------------------------------------------------------
-- Part 3: Anti-Brute-Force Rate Limiting in fn_redeem_code
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
    v_package RECORD;
    v_points_amount NUMERIC(12,2);
    v_package_name TEXT;
    v_effective_expires_at TIMESTAMPTZ;
    v_site VARCHAR := COALESCE(NULLIF(BTRIM(p_site), ''), 'cn');
    v_rate_limit_allowed BOOLEAN := FALSE;
    v_redeem_ledger_id UUID;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'auth required';
    END IF;

    -- Required dependency: errors or an empty limiter result must never authorize redemption.
    BEGIN
        SELECT allowed INTO v_rate_limit_allowed
        FROM public.take_rate_limit_token('redeem:user:' || v_user_id::text, 10, 60000);
    EXCEPTION WHEN OTHERS THEN
        RETURN json_build_object('success', false, 'code', 'rate_limit_unavailable',
            'message', '兑换服务暂不可用，请稍后重试');
    END;
    IF v_rate_limit_allowed IS NOT TRUE THEN
        RETURN json_build_object('success', false, 'code', 'rate_limited',
            'message', '兑换请求过于频繁，请稍后重试');
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
    END IF;

    SELECT expires_at
    INTO v_batch_expires_at
    FROM public.redemption_batches
    WHERE id = v_code_record.batch_id;

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
        version = public.points_balance.version + 1;

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

DROP FUNCTION IF EXISTS public.fn_redeem_code(VARCHAR);
REVOKE ALL ON FUNCTION public.fn_redeem_code(VARCHAR, VARCHAR) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_redeem_code(VARCHAR, VARCHAR) TO authenticated;

-- ----------------------------------------------------------------------------
-- Part 4: Automated CDK Ciphertext-Clearing Routine (Historical Key Cleansing)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_shred_expired_cdks(
    p_retention_days INTEGER DEFAULT 7,
    p_max_batch_size INTEGER DEFAULT 100
)
RETURNS TABLE (
    shredded_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_count INTEGER := 0;
    v_retention_days INTEGER := GREATEST(1, COALESCE(p_retention_days, 7));
    v_max_batch INTEGER := GREATEST(1, LEAST(COALESCE(p_max_batch_size, 100), 1000));
    v_cutoff TIMESTAMPTZ := NOW() - (v_retention_days || ' days')::INTERVAL;
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    WITH targets AS (
        SELECT inventory_id
        FROM public.shop_cdk_secrets
        WHERE delivered_at IS NOT NULL
          AND delivered_at < v_cutoff
          AND ciphertext <> 'SHREDDED'
        ORDER BY delivered_at ASC
        LIMIT v_max_batch
        FOR UPDATE SKIP LOCKED
    ),
    shredded AS (
        UPDATE public.shop_cdk_secrets
        SET
            ciphertext = 'SHREDDED',
            nonce = 'SHREDDED',
            auth_tag = 'SHREDDED'
        WHERE inventory_id IN (SELECT inventory_id FROM targets)
        RETURNING 1
    )
    SELECT COUNT(*)::INTEGER INTO v_count FROM shredded;

    RETURN QUERY SELECT v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_shred_expired_cdks(INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_shred_expired_cdks(INTEGER, INTEGER) TO service_role;

-- ----------------------------------------------------------------------------
-- Part 5: Automated Database RLS & PostgREST Exposure Audit Routine
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_audit_db_security()
RETURNS TABLE (
    table_name TEXT,
    rls_enabled BOOLEAN,
    rls_forced BOOLEAN,
    has_anon_access BOOLEAN,
    status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    RETURN QUERY
    SELECT
        c.relname::TEXT AS table_name,
        c.relrowsecurity AS rls_enabled,
        c.relforcerowsecurity AS rls_forced,
        has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS has_anon_access,
        CASE
            WHEN NOT c.relrowsecurity THEN 'RLS_DISABLED_CRITICAL'
            WHEN c.relname IN ('shop_cdk_secrets', 'rate_limit_buckets', 'redemption_codes', 'redemption_batches') AND has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN 'SENSITIVE_ANON_EXPOSED'
            WHEN c.relname IN ('shop_cdk_secrets', 'rate_limit_buckets') AND has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN 'SENSITIVE_AUTH_EXPOSED'
            ELSE 'OK'
        END AS status
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
    ORDER BY c.relname;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_audit_db_security() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_audit_db_security() TO service_role;

