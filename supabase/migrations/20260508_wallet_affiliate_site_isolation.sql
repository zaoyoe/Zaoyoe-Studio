-- Isolate wallet affiliate views by active site without breaking legacy all-site admin lookups.

CREATE OR REPLACE FUNCTION public.fn_get_affiliate_stats(
    p_user_id UUID,
    p_site TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_invite_code TEXT;
    v_rate_shop FLOAT;
    v_rate_agent FLOAT;
    v_reg_reward NUMERIC(12,1);
    v_requires_purchase BOOLEAN;
    v_reward_notice TEXT;
    v_legal_disclaimer TEXT;
    v_affiliate_config JSONB;
    v_members JSONB := '[]'::JSONB;
    v_invited_count INT := 0;
    v_first_recharge_count INT := 0;
    v_consumed_count INT := 0;
    v_pending_reward_count INT := 0;
    v_total_order_commission NUMERIC(12,1) := 0;
    v_total_registration_rewards NUMERIC(12,1) := 0;
    v_total_rewards NUMERIC(12,1) := 0;
    v_total_invitee_spend NUMERIC(12,1) := 0;
    v_request_user_id UUID := auth.uid();
    v_request_role TEXT := COALESCE(auth.role(), '');
    v_request_is_admin BOOLEAN := FALSE;
    v_effective_user_id UUID;
    v_site TEXT := LOWER(BTRIM(COALESCE(p_site, '')));
    v_site_login_invitees UUID[] := ARRAY[]::UUID[];
BEGIN
    IF v_request_role = 'service_role' THEN
        v_effective_user_id := COALESCE(p_user_id, v_request_user_id);
    ELSE
        IF v_request_user_id IS NULL THEN
            RAISE EXCEPTION 'auth required';
        END IF;

        v_request_is_admin := public.is_admin();
        IF p_user_id IS NOT NULL AND p_user_id <> v_request_user_id AND NOT v_request_is_admin THEN
            RAISE EXCEPTION 'Access denied';
        END IF;

        v_effective_user_id := COALESCE(p_user_id, v_request_user_id);
    END IF;

    IF v_effective_user_id IS NULL THEN
        RAISE EXCEPTION 'user_id required';
    END IF;

    IF v_site = '' OR v_site = 'all' THEN
        RETURN public.fn_get_affiliate_stats(v_effective_user_id);
    END IF;

    IF v_site NOT IN ('cn', 'intl') THEN
        v_site := 'cn';
    END IF;

    IF TO_REGCLASS('public.user_login_history') IS NOT NULL THEN
        EXECUTE $sql$
            SELECT COALESCE(array_agg(DISTINCT ulh.user_id), ARRAY[]::UUID[])
            FROM public.user_login_history ulh
            JOIN public.profiles p ON p.id = ulh.user_id
            WHERE p.invited_by = $1
              AND COALESCE(NULLIF(BTRIM(LOWER(ulh.site)), ''), 'cn') = $2
        $sql$
        INTO v_site_login_invitees
        USING v_effective_user_id, v_site;
    END IF;

    SELECT COALESCE(invite_code, UPPER(SUBSTRING(v_effective_user_id::TEXT, 1, 8)))
    INTO v_invite_code
    FROM public.profiles
    WHERE id = v_effective_user_id;

    SELECT config_value INTO v_affiliate_config
    FROM public.system_config
    WHERE config_key = 'affiliate_program';

    v_rate_shop := COALESCE(
        (v_affiliate_config->>'commission_rate_shop')::FLOAT,
        (SELECT value::FLOAT FROM public.system_settings WHERE key = 'commission_rate_shop'),
        0.10
    );
    v_rate_agent := COALESCE(
        (v_affiliate_config->>'commission_rate_agent')::FLOAT,
        (SELECT value::FLOAT FROM public.system_settings WHERE key = 'commission_rate_agent'),
        0.10
    );
    v_reg_reward := COALESCE(
        (v_affiliate_config->>'registration_reward_points')::NUMERIC(12,1),
        (SELECT value::NUMERIC(12,1) FROM public.system_settings WHERE key = 'registration_reward_points'),
        0
    );
    v_requires_purchase := COALESCE(
        (v_affiliate_config->>'registration_reward_requires_purchase')::BOOLEAN,
        (SELECT value::BOOLEAN FROM public.system_settings WHERE key = 'registration_reward_requires_purchase'),
        true
    );
    v_reward_notice := COALESCE(
        NULLIF(v_affiliate_config->>'reward_notice', ''),
        '拉新固定奖励与持续返佣可叠加发放；异常流量、作弊注册、退款订单与刷单行为不计入奖励统计。'
    );
    v_legal_disclaimer := COALESCE(
        NULLIF(v_affiliate_config->>'legal_disclaimer', ''),
        '活动最终解释权归平台所有'
    );

    WITH invitees AS (
        SELECT
            p.id AS invitee_id,
            p.username,
            p.avatar_url,
            au.email,
            au.created_at AS registered_at
        FROM public.profiles p
        LEFT JOIN auth.users au ON au.id = p.id
        WHERE p.invited_by = v_effective_user_id
    ),
    site_touch_invitees AS (
        SELECT DISTINCT scoped.invitee_id
        FROM (
            SELECT unnest(COALESCE(v_site_login_invitees, ARRAY[]::UUID[])) AS invitee_id

            UNION

            SELECT so.user_id AS invitee_id
            FROM public.shop_orders so
            JOIN invitees i ON i.invitee_id = so.user_id
            WHERE COALESCE(so.price_paid, so.total_price, 0) > 0
              AND COALESCE(NULLIF(BTRIM(LOWER(so.site)), ''), 'cn') = v_site

            UNION

            SELECT pl.user_id AS invitee_id
            FROM public.points_ledger pl
            JOIN invitees i ON i.invitee_id = pl.user_id
            WHERE COALESCE(pl.amount, 0) > 0
              AND public.fn_is_affiliate_qualifying_recharge_reason(pl.reason)
              AND COALESCE(NULLIF(BTRIM(LOWER(pl.site)), ''), 'cn') = v_site

            UNION

            SELECT so.user_id AS invitee_id
            FROM public.points_ledger pl
            JOIN public.shop_orders so
              ON so.id::TEXT = CASE
                  WHEN pl.reference_id LIKE 'AFFILIATE_REWARD_%' THEN SUBSTRING(pl.reference_id FROM LENGTH('AFFILIATE_REWARD_') + 1)
                  WHEN pl.reference_id LIKE 'AFF_REW_%' THEN SUBSTRING(pl.reference_id FROM LENGTH('AFF_REW_') + 1)
                  WHEN pl.reference_id LIKE 'REG_REWARD_UNLOCK_%' THEN SUBSTRING(pl.reference_id FROM LENGTH('REG_REWARD_UNLOCK_') + 1)
                  ELSE NULL
              END
            JOIN invitees i ON i.invitee_id = so.user_id
            WHERE pl.user_id = v_effective_user_id
              AND (
                  pl.reference_id LIKE 'AFFILIATE_REWARD_%'
                  OR pl.reference_id LIKE 'AFF_REW_%'
                  OR (
                      pl.reference_id LIKE 'REG_REWARD_UNLOCK_%'
                      AND pl.reference_id NOT LIKE 'REG_REWARD_UNLOCK_RECHARGE_%'
                  )
              )
              AND COALESCE(NULLIF(BTRIM(LOWER(pl.site)), ''), 'cn') = v_site
              AND COALESCE(NULLIF(BTRIM(LOWER(so.site)), ''), 'cn') = v_site

            UNION

            SELECT reward.invitee_id
            FROM (
                SELECT SUBSTRING(pl.reference_id FROM LENGTH('REG_REWARD_') + 1)::UUID AS invitee_id
                FROM public.points_ledger pl
                WHERE pl.user_id = v_effective_user_id
                  AND pl.reference_id ~ '^REG_REWARD_[0-9a-fA-F-]{36}$'
                  AND COALESCE(NULLIF(BTRIM(LOWER(pl.site)), ''), 'cn') = v_site
            ) reward
            JOIN invitees i ON i.invitee_id = reward.invitee_id

            UNION

            SELECT source_ledger.user_id AS invitee_id
            FROM public.points_ledger pl
            JOIN public.points_ledger source_ledger
              ON source_ledger.id::TEXT = SUBSTRING(pl.reference_id FROM LENGTH('REG_REWARD_UNLOCK_RECHARGE_') + 1)
            JOIN invitees i ON i.invitee_id = source_ledger.user_id
            WHERE pl.user_id = v_effective_user_id
              AND pl.reference_id LIKE 'REG_REWARD_UNLOCK_RECHARGE_%'
              AND COALESCE(NULLIF(BTRIM(LOWER(pl.site)), ''), 'cn') = v_site
              AND COALESCE(NULLIF(BTRIM(LOWER(source_ledger.site)), ''), 'cn') = v_site
        ) scoped
        WHERE scoped.invitee_id IS NOT NULL
    ),
    scoped_invitees AS (
        SELECT i.*
        FROM invitees i
        JOIN site_touch_invitees sti ON sti.invitee_id = i.invitee_id
    ),
    recharge_events AS (
        SELECT
            pl.user_id AS invitee_id,
            MIN(pl.created_at) AS first_recharge_at
        FROM public.points_ledger pl
        JOIN scoped_invitees i ON i.invitee_id = pl.user_id
        WHERE COALESCE(pl.amount, 0) > 0
          AND public.fn_is_affiliate_qualifying_recharge_reason(pl.reason)
          AND COALESCE(NULLIF(BTRIM(LOWER(pl.site)), ''), 'cn') = v_site
        GROUP BY pl.user_id
    ),
    purchase_events AS (
        SELECT
            so.user_id AS invitee_id,
            COUNT(*) FILTER (WHERE COALESCE(so.price_paid, so.total_price, 0) > 0) AS paid_order_count,
            MIN(so.created_at) FILTER (WHERE COALESCE(so.price_paid, so.total_price, 0) > 0) AS first_purchase_at,
            MAX(so.created_at) FILTER (WHERE COALESCE(so.price_paid, so.total_price, 0) > 0) AS last_order_at,
            COALESCE(SUM(COALESCE(so.price_paid, so.total_price, 0)) FILTER (WHERE COALESCE(so.price_paid, so.total_price, 0) > 0), 0)::NUMERIC(12,1) AS total_spend
        FROM public.shop_orders so
        JOIN scoped_invitees i ON i.invitee_id = so.user_id
        WHERE COALESCE(NULLIF(BTRIM(LOWER(so.site)), ''), 'cn') = v_site
        GROUP BY so.user_id
    ),
    last_purchase AS (
        SELECT DISTINCT ON (so.user_id)
            so.user_id AS invitee_id,
            so.id AS last_order_id,
            so.snapshot_product_name AS last_order_name,
            COALESCE(so.price_paid, so.total_price, 0)::NUMERIC(12,1) AS last_order_amount,
            so.created_at AS last_order_at
        FROM public.shop_orders so
        JOIN scoped_invitees i ON i.invitee_id = so.user_id
        WHERE COALESCE(so.price_paid, so.total_price, 0) > 0
          AND COALESCE(NULLIF(BTRIM(LOWER(so.site)), ''), 'cn') = v_site
        ORDER BY so.user_id, so.created_at DESC, so.id DESC
    ),
    commission_rewards AS (
        SELECT
            so.user_id AS invitee_id,
            COALESCE(SUM(pl.amount), 0)::NUMERIC(12,1) AS commission_earned
        FROM public.points_ledger pl
        JOIN public.shop_orders so
          ON so.id::TEXT = CASE
              WHEN pl.reference_id LIKE 'AFFILIATE_REWARD_%' THEN SUBSTRING(pl.reference_id FROM LENGTH('AFFILIATE_REWARD_') + 1)
              WHEN pl.reference_id LIKE 'AFF_REW_%' THEN SUBSTRING(pl.reference_id FROM LENGTH('AFF_REW_') + 1)
              ELSE NULL
          END
        JOIN scoped_invitees i ON i.invitee_id = so.user_id
        WHERE pl.user_id = v_effective_user_id
          AND (
              pl.reference_id LIKE 'AFFILIATE_REWARD_%'
              OR pl.reference_id LIKE 'AFF_REW_%'
          )
          AND COALESCE(NULLIF(BTRIM(LOWER(pl.site)), ''), 'cn') = v_site
          AND COALESCE(NULLIF(BTRIM(LOWER(so.site)), ''), 'cn') = v_site
        GROUP BY so.user_id
    ),
    direct_registration_rewards AS (
        SELECT
            reward.invitee_id,
            COALESCE(SUM(reward.amount), 0)::NUMERIC(12,1) AS granted_points
        FROM (
            SELECT
                SUBSTRING(pl.reference_id FROM LENGTH('REG_REWARD_') + 1)::UUID AS invitee_id,
                pl.amount
            FROM public.points_ledger pl
            WHERE pl.user_id = v_effective_user_id
              AND pl.reference_id ~ '^REG_REWARD_[0-9a-fA-F-]{36}$'
              AND COALESCE(NULLIF(BTRIM(LOWER(pl.site)), ''), 'cn') = v_site
        ) reward
        JOIN scoped_invitees i ON i.invitee_id = reward.invitee_id
        GROUP BY reward.invitee_id
    ),
    purchase_unlocked_rewards AS (
        SELECT
            so.user_id AS invitee_id,
            COALESCE(SUM(pl.amount), 0)::NUMERIC(12,1) AS granted_points
        FROM public.points_ledger pl
        JOIN public.shop_orders so
          ON so.id::TEXT = SUBSTRING(pl.reference_id FROM LENGTH('REG_REWARD_UNLOCK_') + 1)
        JOIN scoped_invitees i ON i.invitee_id = so.user_id
        WHERE pl.user_id = v_effective_user_id
          AND pl.reference_id LIKE 'REG_REWARD_UNLOCK_%'
          AND pl.reference_id NOT LIKE 'REG_REWARD_UNLOCK_RECHARGE_%'
          AND COALESCE(NULLIF(BTRIM(LOWER(pl.site)), ''), 'cn') = v_site
          AND COALESCE(NULLIF(BTRIM(LOWER(so.site)), ''), 'cn') = v_site
        GROUP BY so.user_id
    ),
    recharge_unlocked_rewards AS (
        SELECT
            source_ledger.user_id AS invitee_id,
            COALESCE(SUM(pl.amount), 0)::NUMERIC(12,1) AS granted_points
        FROM public.points_ledger pl
        JOIN public.points_ledger source_ledger
          ON source_ledger.id::TEXT = SUBSTRING(pl.reference_id FROM LENGTH('REG_REWARD_UNLOCK_RECHARGE_') + 1)
        JOIN scoped_invitees i ON i.invitee_id = source_ledger.user_id
        WHERE pl.user_id = v_effective_user_id
          AND pl.reference_id LIKE 'REG_REWARD_UNLOCK_RECHARGE_%'
          AND COALESCE(NULLIF(BTRIM(LOWER(pl.site)), ''), 'cn') = v_site
          AND COALESCE(NULLIF(BTRIM(LOWER(source_ledger.site)), ''), 'cn') = v_site
        GROUP BY source_ledger.user_id
    ),
    pending_rewards AS (
        SELECT
            pr.invitee_id,
            COALESCE(MAX(pr.reward_points), 0)::NUMERIC(12,1) AS pending_points
        FROM public.pending_referral_rewards pr
        JOIN scoped_invitees i ON i.invitee_id = pr.invitee_id
        WHERE pr.inviter_id = v_effective_user_id
        GROUP BY pr.invitee_id
    ),
    member_rows AS (
        SELECT
            i.invitee_id,
            COALESCE(NULLIF(BTRIM(i.username), ''), NULLIF(split_part(COALESCE(i.email, ''), '@', 1), ''), '新用户') AS display_name,
            COALESCE(NULLIF(BTRIM(i.username), ''), '') AS username,
            public.fn_mask_affiliate_email(i.email) AS masked_email,
            i.avatar_url,
            i.registered_at,
            r.first_recharge_at,
            pe.first_purchase_at,
            pe.last_order_at,
            lp.last_order_id,
            lp.last_order_name,
            lp.last_order_amount,
            COALESCE(pe.paid_order_count, 0) AS paid_order_count,
            COALESCE(pe.total_spend, 0)::NUMERIC(12,1) AS total_spend,
            COALESCE(cr.commission_earned, 0)::NUMERIC(12,1) AS commission_earned,
            (
                COALESCE(drr.granted_points, 0)
                + COALESCE(pur.granted_points, 0)
                + COALESCE(rur.granted_points, 0)
            )::NUMERIC(12,1) AS registration_reward_granted,
            COALESCE(pr.pending_points, 0)::NUMERIC(12,1) AS registration_reward_pending
        FROM scoped_invitees i
        LEFT JOIN recharge_events r ON r.invitee_id = i.invitee_id
        LEFT JOIN purchase_events pe ON pe.invitee_id = i.invitee_id
        LEFT JOIN last_purchase lp ON lp.invitee_id = i.invitee_id
        LEFT JOIN commission_rewards cr ON cr.invitee_id = i.invitee_id
        LEFT JOIN direct_registration_rewards drr ON drr.invitee_id = i.invitee_id
        LEFT JOIN purchase_unlocked_rewards pur ON pur.invitee_id = i.invitee_id
        LEFT JOIN recharge_unlocked_rewards rur ON rur.invitee_id = i.invitee_id
        LEFT JOIN pending_rewards pr ON pr.invitee_id = i.invitee_id
    )
    SELECT
        COUNT(*),
        COUNT(*) FILTER (WHERE first_recharge_at IS NOT NULL),
        COUNT(*) FILTER (WHERE first_purchase_at IS NOT NULL),
        COUNT(*) FILTER (WHERE registration_reward_pending > 0 AND registration_reward_granted <= 0),
        COALESCE(SUM(commission_earned), 0)::NUMERIC(12,1),
        COALESCE(SUM(registration_reward_granted), 0)::NUMERIC(12,1),
        COALESCE(SUM(commission_earned + registration_reward_granted), 0)::NUMERIC(12,1),
        COALESCE(SUM(total_spend), 0)::NUMERIC(12,1),
        COALESCE(
            jsonb_agg(
                jsonb_build_object(
                    'user_id', invitee_id,
                    'display_name', display_name,
                    'username', username,
                    'masked_email', masked_email,
                    'avatar_url', avatar_url,
                    'registered_at', registered_at,
                    'first_recharge_at', first_recharge_at,
                    'first_purchase_at', first_purchase_at,
                    'last_order_at', last_order_at,
                    'last_order_id', last_order_id,
                    'last_order_name', last_order_name,
                    'last_order_amount', last_order_amount,
                    'paid_order_count', paid_order_count,
                    'total_spend', total_spend,
                    'commission_earned', commission_earned,
                    'registration_reward_granted', registration_reward_granted,
                    'registration_reward_pending', registration_reward_pending,
                    'total_rewards', (commission_earned + registration_reward_granted)::NUMERIC(12,1),
                    'current_stage', CASE
                        WHEN first_purchase_at IS NOT NULL THEN 'purchased'
                        WHEN first_recharge_at IS NOT NULL THEN 'recharged'
                        ELSE 'registered'
                    END,
                    'stage_step', CASE
                        WHEN first_purchase_at IS NOT NULL THEN 3
                        WHEN first_recharge_at IS NOT NULL THEN 2
                        ELSE 1
                    END,
                    'reward_status', CASE
                        WHEN registration_reward_granted > 0 THEN 'granted'
                        WHEN registration_reward_pending > 0 AND (first_recharge_at IS NOT NULL OR first_purchase_at IS NOT NULL) THEN 'processing'
                        WHEN registration_reward_pending > 0 THEN 'pending'
                        ELSE 'none'
                    END
                )
                ORDER BY COALESCE(last_order_at, first_recharge_at, registered_at) DESC NULLS LAST, registered_at DESC NULLS LAST
            ),
            '[]'::JSONB
        )
    INTO
        v_invited_count,
        v_first_recharge_count,
        v_consumed_count,
        v_pending_reward_count,
        v_total_order_commission,
        v_total_registration_rewards,
        v_total_rewards,
        v_total_invitee_spend,
        v_members
    FROM member_rows;

    RETURN jsonb_build_object(
        'site', v_site,
        'invite_code', COALESCE(v_invite_code, UPPER(SUBSTRING(v_effective_user_id::TEXT, 1, 8))),
        'invited_count', COALESCE(v_invited_count, 0),
        'first_recharge_count', COALESCE(v_first_recharge_count, 0),
        'consumed_count', COALESCE(v_consumed_count, 0),
        'pending_reward_count', COALESCE(v_pending_reward_count, 0),
        'total_commission', COALESCE(v_total_rewards, 0),
        'total_order_commission', COALESCE(v_total_order_commission, 0),
        'total_registration_rewards', COALESCE(v_total_registration_rewards, 0),
        'total_rewards', COALESCE(v_total_rewards, 0),
        'total_invitee_spend', COALESCE(v_total_invitee_spend, 0),
        'commission_rate_shop', v_rate_shop,
        'commission_rate_agent', v_rate_agent,
        'registration_reward_points', v_reg_reward,
        'registration_reward_requires_purchase', v_requires_purchase,
        'reward_notice', v_reward_notice,
        'legal_disclaimer', v_legal_disclaimer,
        'members', COALESCE(v_members, '[]'::JSONB)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_get_affiliate_stats(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_get_affiliate_stats(UUID, TEXT) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_get_affiliate_reward_detail(
    p_user_id UUID,
    p_ledger_id UUID,
    p_site TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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
    v_request_user_id UUID := auth.uid();
    v_request_role TEXT := COALESCE(auth.role(), '');
    v_request_is_admin BOOLEAN := FALSE;
    v_effective_user_id UUID;
    v_site TEXT := LOWER(BTRIM(COALESCE(p_site, '')));
BEGIN
    IF v_request_role = 'service_role' THEN
        v_effective_user_id := COALESCE(p_user_id, v_request_user_id);
    ELSE
        IF v_request_user_id IS NULL THEN
            RAISE EXCEPTION 'auth required';
        END IF;

        v_request_is_admin := public.is_admin();
        IF p_user_id IS NOT NULL AND p_user_id <> v_request_user_id AND NOT v_request_is_admin THEN
            RAISE EXCEPTION 'Access denied';
        END IF;

        v_effective_user_id := COALESCE(p_user_id, v_request_user_id);
    END IF;

    IF v_effective_user_id IS NULL THEN
        RAISE EXCEPTION 'user_id required';
    END IF;

    IF v_site = '' OR v_site = 'all' THEN
        RETURN public.fn_get_affiliate_reward_detail(v_effective_user_id, p_ledger_id);
    END IF;

    IF v_site NOT IN ('cn', 'intl') THEN
        v_site := 'cn';
    END IF;

    SELECT
        pl.id,
        pl.amount,
        pl.reason,
        pl.reference_id,
        pl.created_at
    INTO v_entry
    FROM public.points_ledger pl
    WHERE pl.id = p_ledger_id
      AND pl.user_id = v_effective_user_id
      AND COALESCE(NULLIF(BTRIM(LOWER(pl.site)), ''), 'cn') = v_site;

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
        WHERE so.id = v_source_order_id
          AND COALESCE(NULLIF(BTRIM(LOWER(so.site)), ''), 'cn') = v_site;

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
                  AND COALESCE(NULLIF(BTRIM(LOWER(pl.site)), ''), 'cn') = v_site
            ) INTO v_has_agent_profit;
        END IF;

        v_is_agent_commission := v_has_agent_profit OR COALESCE(v_source_category, '') = 'resource';

        SELECT config_value
        INTO v_affiliate_config
        FROM public.system_config
        WHERE config_key = 'affiliate_program';

        v_declared_commission_rate := CASE
            WHEN v_is_agent_commission THEN COALESCE((v_affiliate_config->>'commission_rate_agent')::NUMERIC, v_reason_declared_rate, v_commission_rate)
            ELSE COALESCE((v_affiliate_config->>'commission_rate_shop')::NUMERIC, v_reason_declared_rate, v_commission_rate)
        END;

        v_expected_reward_amount := CASE
            WHEN COALESCE(v_source_amount, 0) > 0 AND COALESCE(v_declared_commission_rate, 0) > 0
                THEN ROUND((v_source_amount * v_declared_commission_rate / 100.0)::NUMERIC, 1)
            ELSE NULL
        END;
    ELSIF v_entry.reference_id LIKE 'REG_REWARD_%' THEN
        v_reward_type := 'registration_reward';
        v_reward_label := '拉新固定奖励';
        v_source_kind := 'registration';
        v_source_stage := '已注册';

        IF v_entry.reference_id LIKE 'REG_REWARD_UNLOCK_RECHARGE_%' THEN
            v_text_ref := SUBSTRING(v_entry.reference_id FROM LENGTH('REG_REWARD_UNLOCK_RECHARGE_') + 1);
            IF v_text_ref ~ '^[0-9a-fA-F-]{36}$' THEN
                v_source_ledger_id := v_text_ref::UUID;
            END IF;

            SELECT
                pl.user_id,
                pl.reason,
                pl.amount,
                pl.created_at
            INTO
                v_invitee_id,
                v_source_reason,
                v_source_amount,
                v_source_created_at
            FROM public.points_ledger pl
            WHERE pl.id = v_source_ledger_id
              AND COALESCE(NULLIF(BTRIM(LOWER(pl.site)), ''), 'cn') = v_site;

            v_source_kind := 'recharge';
            v_source_stage := '已首充';
            v_source_name := COALESCE(NULLIF(BTRIM(v_source_reason), ''), '首充入账');
        ELSIF v_entry.reference_id LIKE 'REG_REWARD_UNLOCK_%' THEN
            v_text_ref := SUBSTRING(v_entry.reference_id FROM LENGTH('REG_REWARD_UNLOCK_') + 1);
            IF v_text_ref ~ '^[0-9a-fA-F-]{36}$' THEN
                v_source_order_id := v_text_ref::UUID;
            END IF;

            SELECT
                so.user_id,
                so.snapshot_product_name,
                COALESCE(so.price_paid, so.total_price, 0)::NUMERIC(12,1),
                so.created_at
            INTO
                v_invitee_id,
                v_source_name,
                v_source_amount,
                v_source_created_at
            FROM public.shop_orders so
            WHERE so.id = v_source_order_id
              AND COALESCE(NULLIF(BTRIM(LOWER(so.site)), ''), 'cn') = v_site;

            v_source_kind := 'purchase';
            v_source_stage := '已消费';
        ELSE
            v_text_ref := SUBSTRING(v_entry.reference_id FROM LENGTH('REG_REWARD_') + 1);
            IF v_text_ref ~ '^[0-9a-fA-F-]{36}$' THEN
                v_invitee_id := v_text_ref::UUID;
            END IF;
        END IF;

        IF v_invitee_id IS NOT NULL THEN
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
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'found', true,
        'site', v_site,
        'ledger_id', v_entry.id,
        'reward_type', v_reward_type,
        'reward_label', v_reward_label,
        'reward_amount', COALESCE(v_entry.amount, 0),
        'reward_reason', v_entry.reason,
        'reward_created_at', v_entry.created_at,
        'reference_id', v_entry.reference_id,
        'invitee_id', v_invitee_id,
        'invitee_name', v_invitee_name,
        'invitee_username', v_invitee_username,
        'invitee_avatar_url', v_invitee_avatar_url,
        'invitee_masked_email', v_invitee_masked_email,
        'invitee_registered_at', v_invitee_registered_at,
        'source_kind', v_source_kind,
        'source_stage', v_source_stage,
        'source_order_id', v_source_order_id,
        'source_ledger_id', v_source_ledger_id,
        'source_name', v_source_name,
        'source_amount', v_source_amount,
        'source_reason', v_source_reason,
        'source_created_at', v_source_created_at,
        'commission_rate', v_commission_rate,
        'declared_commission_rate', v_declared_commission_rate,
        'expected_reward_amount', v_expected_reward_amount,
        'is_agent_commission', v_is_agent_commission
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_get_affiliate_reward_detail(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_get_affiliate_reward_detail(UUID, UUID, TEXT) TO authenticated, service_role;
