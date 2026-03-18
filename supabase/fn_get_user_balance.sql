-- Run this in Supabase SQL Editor
-- Creates RPC function to get user balance (bypasses RLS)

DROP FUNCTION IF EXISTS fn_get_user_balance(UUID);

CREATE OR REPLACE FUNCTION fn_get_user_balance(p_user_id UUID)
RETURNS TABLE (
    paid_balance NUMERIC(12,1),
    bonus_balance NUMERIC(12,1),
    total_balance NUMERIC(12,1)
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COALESCE(pb.paid_balance, 0),
        COALESCE(pb.bonus_balance, 0),
        COALESCE(pb.total_balance, 0)
    FROM points_balance pb
    WHERE pb.user_id = p_user_id;
    
    -- If no rows returned, return zeros
    IF NOT FOUND THEN
        RETURN QUERY SELECT 0, 0, 0;
    END IF;
END;
$$;

-- Grant execute to anon and authenticated
GRANT EXECUTE ON FUNCTION fn_get_user_balance(UUID) TO anon, authenticated;
