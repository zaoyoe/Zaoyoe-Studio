CREATE OR REPLACE FUNCTION fn_get_affiliate_stats(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_invited_count INT := 0;
    v_total_commission INT := 0;
    v_invite_code VARCHAR;
BEGIN
    -- Get invite code
    SELECT invite_code INTO v_invite_code FROM profiles WHERE id = p_user_id;

    -- Count invites
    SELECT COUNT(id) INTO v_invited_count FROM profiles WHERE invited_by = p_user_id;

    -- Sum commission (from ledger: '推广返佣%')
    SELECT COALESCE(SUM(amount), 0) INTO v_total_commission 
    FROM points_ledger 
    WHERE user_id = p_user_id AND reason LIKE '推广返佣%';

    RETURN jsonb_build_object(
        'invite_code', v_invite_code,
        'invited_count', v_invited_count,
        'total_commission', v_total_commission
    );
END;
$$;
