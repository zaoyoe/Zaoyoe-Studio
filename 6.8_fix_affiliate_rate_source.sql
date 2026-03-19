-- ============================================
-- 6.8 修复历史返佣“误按分销渠道比例”问题
-- 适用场景：
-- 1. 后台基础商品提成是 0.1 (10%)
-- 2. 旧版 6 参数 fn_purchase_shop_item 曾把普通商城订单也按 commission_rate_agent 写进流水
-- 3. 6.7 已执行，但历史基础商品单仍被按旧 reason 里的 20% 显示/回算
--
-- 执行结果：
-- 1. 历史推广返佣改按“真实配置 + 商品类型”重算，不再信任旧 reason 文本
-- 2. 基础商品订单使用 commission_rate_shop
-- 3. 分销渠道资源订单使用 commission_rate_agent
-- 4. 同步修正 points_ledger.amount / reason / reference_id 以及邀请人 bonus_balance
-- 5. 重建 fn_get_affiliate_reward_detail，详情弹窗优先显示真实配置比例
--
-- 判定规则：
-- - 若存在 AGENT_PROF_{order_id} 流水，或商品 category = 'resource'，视为分销渠道资源单
-- - 其他订单按基础商品单处理
-- ============================================

DO $$
DECLARE
    v_points_balance_has_site BOOLEAN := false;
    v_points_ledger_has_site BOOLEAN := false;
    v_affiliate_config JSONB;
    v_rate_shop_percent NUMERIC(12,1) := 10.0;
    v_rate_agent_percent NUMERIC(12,1) := 10.0;
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

    SELECT config_value
    INTO v_affiliate_config
    FROM public.system_config
    WHERE config_key = 'affiliate_program';

    v_rate_shop_percent := ROUND(
        COALESCE(
            (v_affiliate_config->>'commission_rate_shop')::NUMERIC,
            (SELECT value::NUMERIC FROM public.system_settings WHERE key = 'commission_rate_shop'),
            0.10
        ) * 100,
        1
    );

    v_rate_agent_percent := ROUND(
        COALESCE(
            (v_affiliate_config->>'commission_rate_agent')::NUMERIC,
            (SELECT value::NUMERIC FROM public.system_settings WHERE key = 'commission_rate_agent'),
            0.10
        ) * 100,
        1
    );

    DROP TABLE IF EXISTS tmp_affiliate_rate_source_fix;

    EXECUTE format($sql$
        CREATE TEMP TABLE tmp_affiliate_rate_source_fix AS
        WITH reward_rows AS (
            SELECT
                pl.id AS ledger_id,
                pl.user_id,
                %s AS site,
                COALESCE(pl.amount, 0)::NUMERIC(12,1) AS current_amount,
                so.id AS order_id,
                COALESCE(so.price_paid, so.total_price, 0)::NUMERIC(12,1) AS order_amount,
                COALESCE(sp.category, '') AS product_category,
                EXISTS (
                    SELECT 1
                    FROM public.points_ledger profit
                    WHERE profit.reference_id = 'AGENT_PROF_' || so.id::TEXT
                ) AS has_agent_profit
            FROM public.points_ledger pl
            JOIN public.shop_orders so
              ON so.id::TEXT = CASE
                    WHEN pl.reference_id LIKE 'AFFILIATE_REWARD_%%' THEN SUBSTRING(pl.reference_id FROM LENGTH('AFFILIATE_REWARD_') + 1)
                    WHEN pl.reference_id LIKE 'AFF_REW_%%' THEN SUBSTRING(pl.reference_id FROM LENGTH('AFF_REW_') + 1)
                    ELSE NULL
                 END
            LEFT JOIN public.shop_products sp ON sp.id = so.product_id
            WHERE pl.reference_id LIKE 'AFFILIATE_REWARD_%%'
               OR pl.reference_id LIKE 'AFF_REW_%%'
        )
        SELECT
            ledger_id,
            user_id,
            site,
            order_id,
            current_amount,
            order_amount,
            CASE
                WHEN has_agent_profit OR product_category = 'resource' THEN 'agent'
                ELSE 'shop'
            END AS reward_kind,
            CASE
                WHEN has_agent_profit OR product_category = 'resource' THEN %L::NUMERIC(12,1)
                ELSE %L::NUMERIC(12,1)
            END AS expected_rate_percent,
            CASE
                WHEN has_agent_profit OR product_category = 'resource'
                    THEN ROUND((order_amount * %L / 100)::NUMERIC, 1)
                ELSE ROUND((order_amount * %L / 100)::NUMERIC, 1)
            END AS expected_amount,
            CASE
                WHEN has_agent_profit OR product_category = 'resource'
                    THEN '推广返佣 (' || %L || '%%): 下线购买分销资源'
                ELSE '推广返佣 (' || %L || '%%): 下线购买商品'
            END AS expected_reason,
            CASE
                WHEN has_agent_profit OR product_category = 'resource'
                    THEN 'AFF_REW_' || order_id::TEXT
                ELSE 'AFFILIATE_REWARD_' || order_id::TEXT
            END AS expected_reference_id,
            ROUND(
                CASE
                    WHEN has_agent_profit OR product_category = 'resource'
                        THEN ROUND((order_amount * %L / 100)::NUMERIC, 1) - current_amount
                    ELSE ROUND((order_amount * %L / 100)::NUMERIC, 1) - current_amount
                END,
                1
            ) AS delta
        FROM reward_rows
        WHERE order_amount > 0
    $sql$,
        CASE WHEN v_points_ledger_has_site THEN 'COALESCE(pl.site, ''cn'')' ELSE '''cn''' END,
        v_rate_agent_percent, v_rate_shop_percent,
        v_rate_agent_percent, v_rate_shop_percent,
        trim(to_char(v_rate_agent_percent, 'FM999999990.0')),
        trim(to_char(v_rate_shop_percent, 'FM999999990.0')),
        v_rate_agent_percent, v_rate_shop_percent
    );

    UPDATE public.points_ledger pl
    SET amount = fix.expected_amount,
        reason = fix.expected_reason,
        reference_id = fix.expected_reference_id
    FROM tmp_affiliate_rate_source_fix fix
    WHERE pl.id = fix.ledger_id
      AND (
            ABS(fix.expected_amount - COALESCE(pl.amount, 0)) >= 0.1
            OR COALESCE(pl.reason, '') <> COALESCE(fix.expected_reason, '')
            OR COALESCE(pl.reference_id, '') <> COALESCE(fix.expected_reference_id, '')
      );

    GET DIAGNOSTICS v_rows_fixed = ROW_COUNT;

    SELECT COALESCE(SUM(delta), 0)::NUMERIC(12,1)
    INTO v_total_delta
    FROM tmp_affiliate_rate_source_fix;

    IF v_total_delta <> 0 THEN
        IF v_points_balance_has_site THEN
            UPDATE public.points_balance pb
            SET bonus_balance = ROUND(COALESCE(pb.bonus_balance, 0) + fix.delta, 1),
                updated_at = NOW()
            FROM (
                SELECT user_id, site, SUM(delta)::NUMERIC(12,1) AS delta
                FROM tmp_affiliate_rate_source_fix
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
                FROM tmp_affiliate_rate_source_fix
                GROUP BY user_id
            ) fix
            WHERE pb.user_id = fix.user_id;
        END IF;
    END IF;

    RAISE NOTICE '[AffiliateRateSourceFix] fixed % ledger rows, total balance delta = %', v_rows_fixed, v_total_delta;
END $$;

DROP FUNCTION IF EXISTS public.fn_get_affiliate_reward_detail(UUID, UUID);

CREATE OR REPLACE FUNCTION public.fn_get_affiliate_reward_detail(
    p_user_id UUID,
    p_ledger_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_entry RECORD;
    v_reward_type TEXT := 'affiliate_reward';
    v_reward_label TEXT := '推广奖励';
    v_source_kind TEXT := '';
    v_source_stage TEXT := '';
    v_invitee_id UUID;
    v_invitee_name TEXT;
    v_invitee_username TEXT;
    v_invitee_avatar_url TEXT;
    v_invitee_masked_email TEXT;
    v_invitee_registered_at TIMESTAMPTZ;
    v_source_order_id UUID;
    v_source_ledger_id UUID;
    v_source_reason TEXT;
    v_source_name TEXT;
    v_source_amount NUMERIC(12,1) := 0;
    v_source_created_at TIMESTAMPTZ;
    v_commission_rate NUMERIC(12,1);
    v_declared_commission_rate NUMERIC(12,1);
    v_expected_reward_amount NUMERIC(12,1);
    v_text_ref TEXT;
    v_affiliate_config JSONB;
    v_source_category TEXT;
    v_has_agent_profit BOOLEAN := false;
    v_is_agent_commission BOOLEAN := false;
    v_reason_declared_rate NUMERIC(12,1);
BEGIN
    SELECT
        pl.id,
        pl.amount,
        pl.reason,
        pl.reference_id,
        pl.created_at
    INTO v_entry
    FROM public.points_ledger pl
    WHERE pl.id = p_ledger_id
      AND pl.user_id = p_user_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('found', false);
    END IF;

    IF v_entry.reference_id LIKE 'AFFILIATE_REWARD_%' OR v_entry.reference_id LIKE 'AFF_REW_%' THEN
        v_reward_type := 'commission';
        v_reward_label := '推广返佣';
        v_source_kind := 'purchase';
        v_source_stage := '已消费';
        v_text_ref := CASE
            WHEN v_entry.reference_id LIKE 'AFFILIATE_REWARD_%' THEN SUBSTRING(v_entry.reference_id FROM LENGTH('AFFILIATE_REWARD_') + 1)
            ELSE SUBSTRING(v_entry.reference_id FROM LENGTH('AFF_REW_') + 1)
        END;
        IF v_text_ref ~ '^[0-9a-fA-F-]{36}$' THEN
            v_source_order_id := v_text_ref::UUID;
        END IF;

        SELECT
            so.user_id,
            COALESCE(NULLIF(BTRIM(p.username), ''), NULLIF(split_part(COALESCE(au.email, ''), '@', 1), ''), '新用户'),
            COALESCE(NULLIF(BTRIM(p.username), ''), ''),
            p.avatar_url,
            public.fn_mask_affiliate_email(au.email),
            au.created_at,
            so.snapshot_product_name,
            COALESCE(so.price_paid, so.total_price, 0)::NUMERIC(12,1),
            so.created_at,
            COALESCE(sp.category, '')
        INTO
            v_invitee_id,
            v_invitee_name,
            v_invitee_username,
            v_invitee_avatar_url,
            v_invitee_masked_email,
            v_invitee_registered_at,
            v_source_name,
            v_source_amount,
            v_source_created_at,
            v_source_category
        FROM public.shop_orders so
        LEFT JOIN public.shop_products sp ON sp.id = so.product_id
        LEFT JOIN public.profiles p ON p.id = so.user_id
        LEFT JOIN auth.users au ON au.id = so.user_id
        WHERE so.id = v_source_order_id;

        IF COALESCE(v_source_amount, 0) > 0 THEN
            v_commission_rate := ROUND((v_entry.amount / v_source_amount * 100)::NUMERIC, 1);
        END IF;

        BEGIN
            v_reason_declared_rate := NULLIF((regexp_match(v_entry.reason, '([0-9]+(?:\.[0-9]+)?)%'))[1], '')::NUMERIC;
        EXCEPTION WHEN OTHERS THEN
            v_reason_declared_rate := NULL;
        END;

        IF v_source_order_id IS NOT NULL THEN
            SELECT EXISTS (
                SELECT 1
                FROM public.points_ledger pl
                WHERE pl.reference_id = 'AGENT_PROF_' || v_source_order_id::TEXT
            ) INTO v_has_agent_profit;
        END IF;

        v_is_agent_commission := v_has_agent_profit OR COALESCE(v_source_category, '') = 'resource';

        SELECT config_value
        INTO v_affiliate_config
        FROM public.system_config
        WHERE config_key = 'affiliate_program';

        IF v_is_agent_commission THEN
            v_declared_commission_rate := ROUND(
                COALESCE(
                    (v_affiliate_config->>'commission_rate_agent')::NUMERIC,
                    (SELECT value::NUMERIC FROM public.system_settings WHERE key = 'commission_rate_agent'),
                    0.10
                ) * 100,
                1
            );
        ELSE
            v_declared_commission_rate := ROUND(
                COALESCE(
                    (v_affiliate_config->>'commission_rate_shop')::NUMERIC,
                    (SELECT value::NUMERIC FROM public.system_settings WHERE key = 'commission_rate_shop'),
                    0.10
                ) * 100,
                1
            );
        END IF;

        v_declared_commission_rate := COALESCE(v_declared_commission_rate, v_reason_declared_rate);

        IF v_declared_commission_rate IS NOT NULL AND COALESCE(v_source_amount, 0) > 0 THEN
            v_expected_reward_amount := ROUND((v_source_amount * v_declared_commission_rate / 100)::NUMERIC, 1);
        END IF;
    ELSIF v_entry.reference_id LIKE 'REG_REWARD_UNLOCK_RECHARGE_%' THEN
        v_reward_type := 'registration_reward';
        v_reward_label := '邀请首充奖励';
        v_source_kind := 'recharge';
        v_source_stage := '完成首充';
        v_text_ref := SUBSTRING(v_entry.reference_id FROM LENGTH('REG_REWARD_UNLOCK_RECHARGE_') + 1);
        IF v_text_ref ~ '^[0-9a-fA-F-]{36}$' THEN
            v_source_ledger_id := v_text_ref::UUID;
        END IF;

        SELECT
            pl.user_id,
            COALESCE(NULLIF(BTRIM(p.username), ''), NULLIF(split_part(COALESCE(au.email, ''), '@', 1), ''), '新用户'),
            COALESCE(NULLIF(BTRIM(p.username), ''), ''),
            p.avatar_url,
            public.fn_mask_affiliate_email(au.email),
            au.created_at,
            pl.reason,
            COALESCE(pl.amount, 0)::NUMERIC(12,1),
            pl.created_at
        INTO
            v_invitee_id,
            v_invitee_name,
            v_invitee_username,
            v_invitee_avatar_url,
            v_invitee_masked_email,
            v_invitee_registered_at,
            v_source_reason,
            v_source_amount,
            v_source_created_at
        FROM public.points_ledger pl
        LEFT JOIN public.profiles p ON p.id = pl.user_id
        LEFT JOIN auth.users au ON au.id = pl.user_id
        WHERE pl.id = v_source_ledger_id;
    ELSIF v_entry.reference_id LIKE 'REG_REWARD_UNLOCK_%' THEN
        v_reward_type := 'registration_reward';
        v_reward_label := '邀请消费奖励';
        v_source_kind := 'purchase';
        v_source_stage := '完成首单消费';
        v_text_ref := SUBSTRING(v_entry.reference_id FROM LENGTH('REG_REWARD_UNLOCK_') + 1);
        IF v_text_ref ~ '^[0-9a-fA-F-]{36}$' THEN
            v_source_order_id := v_text_ref::UUID;
        END IF;

        SELECT
            so.user_id,
            COALESCE(NULLIF(BTRIM(p.username), ''), NULLIF(split_part(COALESCE(au.email, ''), '@', 1), ''), '新用户'),
            COALESCE(NULLIF(BTRIM(p.username), ''), ''),
            p.avatar_url,
            public.fn_mask_affiliate_email(au.email),
            au.created_at,
            so.snapshot_product_name,
            COALESCE(so.price_paid, so.total_price, 0)::NUMERIC(12,1),
            so.created_at
        INTO
            v_invitee_id,
            v_invitee_name,
            v_invitee_username,
            v_invitee_avatar_url,
            v_invitee_masked_email,
            v_invitee_registered_at,
            v_source_name,
            v_source_amount,
            v_source_created_at
        FROM public.shop_orders so
        LEFT JOIN public.profiles p ON p.id = so.user_id
        LEFT JOIN auth.users au ON au.id = so.user_id
        WHERE so.id = v_source_order_id;
    ELSIF v_entry.reference_id ~ '^REG_REWARD_[0-9a-fA-F-]{36}$' THEN
        v_reward_type := 'registration_reward';
        v_reward_label := '邀请注册奖励';
        v_source_kind := 'register';
        v_source_stage := '完成注册';
        v_invitee_id := SUBSTRING(v_entry.reference_id FROM LENGTH('REG_REWARD_') + 1)::UUID;

        SELECT
            COALESCE(NULLIF(BTRIM(p.username), ''), NULLIF(split_part(COALESCE(au.email, ''), '@', 1), ''), '新用户'),
            COALESCE(NULLIF(BTRIM(p.username), ''), ''),
            p.avatar_url,
            public.fn_mask_affiliate_email(au.email),
            au.created_at
        INTO
            v_invitee_name,
            v_invitee_username,
            v_invitee_avatar_url,
            v_invitee_masked_email,
            v_invitee_registered_at
        FROM public.profiles p
        LEFT JOIN auth.users au ON au.id = p.id
        WHERE p.id = v_invitee_id;

        v_source_created_at := v_invitee_registered_at;
    END IF;

    RETURN jsonb_build_object(
        'found', true,
        'ledger_id', v_entry.id,
        'reward_type', v_reward_type,
        'reward_label', v_reward_label,
        'reward_amount', COALESCE(v_entry.amount, 0)::NUMERIC(12,1),
        'reward_reason', v_entry.reason,
        'reward_created_at', v_entry.created_at,
        'reference_id', v_entry.reference_id,
        'source_kind', v_source_kind,
        'source_stage', v_source_stage,
        'source_order_id', v_source_order_id,
        'source_ledger_id', v_source_ledger_id,
        'source_reason', v_source_reason,
        'source_name', v_source_name,
        'source_amount', COALESCE(v_source_amount, 0)::NUMERIC(12,1),
        'source_created_at', v_source_created_at,
        'commission_rate', v_commission_rate,
        'declared_commission_rate', v_declared_commission_rate,
        'expected_reward_amount', v_expected_reward_amount,
        'invitee_id', v_invitee_id,
        'invitee_name', v_invitee_name,
        'invitee_username', v_invitee_username,
        'invitee_avatar_url', v_invitee_avatar_url,
        'invitee_masked_email', v_invitee_masked_email,
        'invitee_registered_at', v_invitee_registered_at
    );
END;
$$;

SELECT
    COUNT(*) AS fixed_rows,
    COALESCE(SUM(delta), 0)::NUMERIC(12,1) AS total_balance_delta
FROM tmp_affiliate_rate_source_fix;

SELECT
    ledger_id,
    user_id,
    site,
    reward_kind,
    current_amount,
    expected_amount,
    delta,
    order_amount,
    expected_rate_percent,
    expected_reason,
    expected_reference_id
FROM tmp_affiliate_rate_source_fix
ORDER BY ABS(delta) DESC, ledger_id DESC
LIMIT 50;
