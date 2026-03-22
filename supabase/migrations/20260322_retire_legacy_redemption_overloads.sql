-- ============================================
-- Retire legacy redemption overloads and tighten helper RPC grants
-- 下线旧版兑换码重载，避免旧脚本重新暴露非 site-aware 入口
-- ============================================

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
    v_points_amount INT;
    v_package_name TEXT;
    v_effective_expires_at TIMESTAMPTZ;
    v_site VARCHAR := COALESCE(NULLIF(BTRIM(p_site), ''), 'cn');
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'auth required';
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
            v_points_amount := v_code_record.points_amount;
            v_package_name := '自定义积分';
        ELSE
            RETURN json_build_object('success', false, 'message', '关联的套餐不存在');
        END IF;
    ELSE
        v_points_amount := v_package.points_amount + COALESCE(v_package.bonus_points, 0);
        v_package_name := v_package.name;
    END IF;

    INSERT INTO public.points_ledger (user_id, amount, reason, reference_id, site)
    VALUES (
        v_user_id,
        v_points_amount,
        '兑换码充值: ' || v_package_name,
        'redeem_' || p_code,
        v_site
    );

    INSERT INTO public.points_balance (user_id, site, paid_balance, bonus_balance)
    VALUES (v_user_id, v_site, v_points_amount, 0)
    ON CONFLICT (user_id, site)
    DO UPDATE SET
        paid_balance = public.points_balance.paid_balance + EXCLUDED.paid_balance,
        updated_at = NOW(),
        version = public.points_balance.version + 1;

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

DROP FUNCTION IF EXISTS public.fn_get_user_balance(UUID);
DROP FUNCTION IF EXISTS public.fn_get_user_balance(VARCHAR);
