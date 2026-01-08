CREATE OR REPLACE FUNCTION public.unlock_prompt(p_prompt_id BIGINT, p_cost INTEGER)
RETURNS JSONB AS $$
DECLARE
  v_user_id UUID;
  v_balance INTEGER;
  v_is_banned BOOLEAN;
BEGIN
  v_user_id := auth.uid();
  
  -- 1. Check for Points Ban (Scope: 'points_usage' or 'all')
  SELECT EXISTS (
      SELECT 1 FROM public.blocked_users 
      WHERE user_id = v_user_id 
      AND (scope = 'points_usage' OR scope = 'all')
      AND (expires_at IS NULL OR expires_at > NOW())
  ) INTO v_is_banned;

  IF v_is_banned THEN
      -- Return error explicitly so frontend can handle it
      RETURN jsonb_build_object('success', false, 'error', '您的积分消费功能已被暂时冻结');
  END IF;
  
  -- Check user balance
  SELECT balance INTO v_balance FROM public.user_points WHERE user_id = v_user_id;
  
  IF v_balance IS NULL OR v_balance < p_cost THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient points');
  END IF;
  
  -- Check if already unlocked
  IF EXISTS (SELECT 1 FROM public.prompt_unlocks WHERE user_id = v_user_id AND prompt_id = p_prompt_id) THEN
    RETURN jsonb_build_object('success', true, 'message', 'Already unlocked');
  END IF;

  -- 2. Deduct points (via ledger)
  INSERT INTO public.points_ledger (user_id, amount, reason, reference_id)
  VALUES (v_user_id, -p_cost, 'unlock_prompt', p_prompt_id::text);
  
  -- 3. Record unlock
  INSERT INTO public.prompt_unlocks (user_id, prompt_id, cost)
  VALUES (v_user_id, p_prompt_id, p_cost);
  
  RETURN jsonb_build_object('success', true, 'new_balance', v_balance - p_cost);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
