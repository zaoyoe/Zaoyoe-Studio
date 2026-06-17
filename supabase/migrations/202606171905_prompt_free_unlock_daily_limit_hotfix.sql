UPDATE public.system_config
SET config_value = CASE
    WHEN config_value ? '__site_scoped' THEN jsonb_set(
        config_value,
        '{default,free_daily_limit}',
        COALESCE(config_value #> '{default,free_daily_limit}', '3'::jsonb),
        true
    )
    ELSE jsonb_set(
        COALESCE(config_value, '{}'::jsonb),
        '{free_daily_limit}',
        COALESCE(config_value #> '{free_daily_limit}', '3'::jsonb),
        true
    )
END
WHERE config_key = 'unlock_pricing';

DROP FUNCTION IF EXISTS public.unlock_prompt_v2(text, integer);
DROP FUNCTION IF EXISTS public.unlock_prompt_v2(text, bigint);
DROP FUNCTION IF EXISTS public.unlock_prompt_v2(text, integer, text);
DROP FUNCTION IF EXISTS public.unlock_prompt_v2(text, bigint, text);
DROP FUNCTION IF EXISTS public.unlock_prompt_v2(text, integer, character varying);
DROP FUNCTION IF EXISTS public.unlock_prompt_v2(text, bigint, character varying);

CREATE OR REPLACE FUNCTION public.unlock_prompt_v2(p_prompt_id TEXT, p_cost INTEGER, p_site TEXT DEFAULT 'cn')
RETURNS JSONB AS $$
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
BEGIN
  v_user_id := auth.uid();

  IF p_prompt_id IS NULL OR p_prompt_id = '' THEN
      RETURN jsonb_build_object('success', false, 'error', '无效的 Prompt ID');
  END IF;

  IF v_user_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', '请先登录后再解锁');
  END IF;

  IF p_cost IS NOT NULL AND p_cost < 0 THEN
      RETURN jsonb_build_object('success', false, 'error', '无效的解锁积分');
  END IF;

  v_prompt_id_bigint := p_prompt_id::BIGINT;

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
      SELECT 1 FROM public.blocked_users
      WHERE user_id = v_user_id
      AND (scope = 'points_usage' OR scope = 'all')
      AND (expires_at IS NULL OR expires_at > NOW())
  ) INTO v_is_banned;

  IF v_is_banned THEN
      RETURN jsonb_build_object('success', false, 'error', '您的积分消费功能已被暂时冻结');
  END IF;

  SELECT paid_balance, bonus_balance
  INTO v_paid_balance, v_bonus_balance
  FROM public.points_balance
  WHERE user_id = v_user_id;

  v_paid_balance := COALESCE(v_paid_balance, 0);
  v_bonus_balance := COALESCE(v_bonus_balance, 0);
  v_total_balance := v_paid_balance + v_bonus_balance;

  IF v_total_balance < v_unlock_cost THEN
    RETURN jsonb_build_object('success', false, 'error', '积分不足，无法解锁');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.prompt_unlocks
    WHERE user_id = v_user_id
      AND prompt_id = v_prompt_id_bigint
      AND site = v_site
  ) THEN
    RETURN jsonb_build_object('success', true, 'message', '该内容已解锁', 'already_unlocked', true);
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

  DECLARE
    v_cost_remaining NUMERIC(12,1) := v_unlock_cost;
    v_new_bonus NUMERIC(12,1) := v_bonus_balance;
    v_new_paid NUMERIC(12,1) := v_paid_balance;
  BEGIN
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

      UPDATE public.points_balance
      SET paid_balance = v_new_paid, bonus_balance = v_new_bonus, updated_at = NOW()
      WHERE user_id = v_user_id;
  END;

  INSERT INTO public.points_ledger (user_id, amount, reason, reference_id, site)
  VALUES (v_user_id, -v_unlock_cost, 'unlock_prompt', p_prompt_id, v_site);

  INSERT INTO public.prompt_unlocks (user_id, prompt_id, cost, site)
  VALUES (v_user_id, v_prompt_id_bigint, v_unlock_cost, v_site);

  RETURN jsonb_build_object('success', true, 'new_balance', v_paid_balance + v_bonus_balance - v_unlock_cost);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION public.unlock_prompt_v2(TEXT, INTEGER, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.unlock_prompt_v2(TEXT, INTEGER, TEXT) TO authenticated;
