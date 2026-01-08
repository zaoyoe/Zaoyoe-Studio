-- ============================================================
-- 🔴 IMPORTANT: Run ALL lines in this file.
-- We must DROP the function first because the existing version 
-- has default parameter values, causing conflict (Error 42P13).
-- ============================================================

DROP FUNCTION IF EXISTS public.unlock_prompt_v2(text, integer);

-- Also drop potential other signatures just in case
DROP FUNCTION IF EXISTS public.unlock_prompt_v2(text, bigint);

-- Now re-create the function with the Ban Logic enforced
CREATE OR REPLACE FUNCTION public.unlock_prompt_v2(p_prompt_id TEXT, p_cost INTEGER)
RETURNS JSONB AS $$
DECLARE
  v_user_id UUID;
  v_total_balance INTEGER;
  v_paid_balance INTEGER;
  v_bonus_balance INTEGER;
  v_prompt_id_bigint BIGINT;
  v_is_banned BOOLEAN;
BEGIN
  v_user_id := auth.uid();
  
  -- Handle potential empty inputs
  IF p_prompt_id IS NULL OR p_prompt_id = '' THEN
      RETURN jsonb_build_object('success', false, 'error', '无效的 Prompt ID');
  END IF;

  v_prompt_id_bigint := p_prompt_id::BIGINT;
  
  -- 1. 🛡️ BAN CHECK (Scope: 'points_usage' or 'all')
  SELECT EXISTS (
      SELECT 1 FROM public.blocked_users 
      WHERE user_id = v_user_id 
      AND (scope = 'points_usage' OR scope = 'all')
      AND (expires_at IS NULL OR expires_at > NOW())
  ) INTO v_is_banned;

  IF v_is_banned THEN
      -- Explicitly deny points usage
      RETURN jsonb_build_object('success', false, 'error', '您的积分消费功能已被暂时冻结');
  END IF;
  
  -- 2. Balance Check (From points_balance table)
  SELECT paid_balance, bonus_balance 
  INTO v_paid_balance, v_bonus_balance
  FROM public.points_balance 
  WHERE user_id = v_user_id;

  v_paid_balance := COALESCE(v_paid_balance, 0);
  v_bonus_balance := COALESCE(v_bonus_balance, 0);
  v_total_balance := v_paid_balance + v_bonus_balance;
  
  IF v_total_balance < p_cost THEN
    RETURN jsonb_build_object('success', false, 'error', '积分不足，无法解锁');
  END IF;
  
  -- 3. Check if already unlocked
  IF EXISTS (SELECT 1 FROM public.prompt_unlocks WHERE user_id = v_user_id AND prompt_id = v_prompt_id_bigint) THEN
    RETURN jsonb_build_object('success', true, 'message', '该内容已解锁', 'already_unlocked', true);
  END IF;

  -- 4. Deduct Points Logic (Prioritize Bonus, then Paid? Or Paid then Bonus? Strategy: Usually Bonus first or Paid first. Let's assume Paid first if not specified, or simply subtract from total logic.)
  -- actually, let's keep it simple: Subtract from Bonus first to be nice? No, Usually paid is more valuable? 
  -- Let's subtract from PAID first (commercial logic usually consumes purchased credits before free ones, OR vice versa. Let's consume BONUS first (free credits) to encourage spending them? 
  -- Common pattern: Consume Purchased first to keep revenue recognized? 
  -- Let's just do a simple subtraction logic:
  -- If bonus >= cost: bonus - cost.
  -- If bonus < cost: paid - (cost - bonus), bonus = 0.
  
  DECLARE
    v_cost_remaining INTEGER := p_cost;
    v_new_bonus INTEGER := v_bonus_balance;
    v_new_paid INTEGER := v_paid_balance;
  BEGIN
      -- Deduct from Bonus first
      IF v_new_bonus >= v_cost_remaining THEN
          v_new_bonus := v_new_bonus - v_cost_remaining;
          v_cost_remaining := 0;
      ELSE
          v_cost_remaining := v_cost_remaining - v_new_bonus;
          v_new_bonus := 0;
      END IF;
      
      -- Deduct remaining from Paid
      IF v_cost_remaining > 0 THEN
          IF v_new_paid >= v_cost_remaining THEN
              v_new_paid := v_new_paid - v_cost_remaining;
              v_cost_remaining := 0;
          ELSE
              -- Should not happen due to check above, but safe guard
              RETURN jsonb_build_object('success', false, 'error', '计算错误：积分扣除异常');
          END IF;
      END IF;
      
      -- Update Table
      UPDATE public.points_balance
      SET paid_balance = v_new_paid, bonus_balance = v_new_bonus, updated_at = NOW()
      WHERE user_id = v_user_id;
  END;

  -- 5. Deduct points via Ledger (Log Only)
  INSERT INTO public.points_ledger (user_id, amount, reason, reference_id)
  VALUES (v_user_id, -p_cost, 'unlock_prompt', p_prompt_id);
  
  -- 6. Record unlock
  INSERT INTO public.prompt_unlocks (user_id, prompt_id, cost)
  VALUES (v_user_id, v_prompt_id_bigint, p_cost);
  
  -- 7. Sync Legacy (If keeping sync)
  -- UPDATE public.user_points SET balance = v_new_paid + v_new_bonus WHERE user_id = v_user_id;
  
  RETURN jsonb_build_object('success', true, 'new_balance', v_paid_balance + v_bonus_balance - p_cost);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
