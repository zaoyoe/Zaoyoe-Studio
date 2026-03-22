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
SET search_path = public, pg_temp
AS $$
DECLARE
    v_request_user_id UUID := auth.uid();
    v_request_role TEXT := COALESCE(auth.role(), '');
    v_effective_user_id UUID;
BEGIN
    IF v_request_role = 'service_role' THEN
        v_effective_user_id := COALESCE(p_user_id, v_request_user_id);
    ELSE
        IF v_request_user_id IS NULL THEN
            RAISE EXCEPTION 'auth required';
        END IF;

        IF p_user_id IS NOT NULL AND p_user_id <> v_request_user_id THEN
            RAISE EXCEPTION 'Access denied';
        END IF;

        v_effective_user_id := v_request_user_id;
    END IF;

    IF v_effective_user_id IS NULL THEN
        RAISE EXCEPTION 'user_id required';
    END IF;

    RETURN QUERY
    SELECT 
        COALESCE(pb.paid_balance, 0),
        COALESCE(pb.bonus_balance, 0),
        COALESCE(pb.total_balance, 0)
    FROM points_balance pb
    WHERE pb.user_id = v_effective_user_id;
    
    -- If no rows returned, return zeros
    IF NOT FOUND THEN
        RETURN QUERY SELECT 0, 0, 0;
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION fn_get_user_balance(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_get_user_balance(UUID) TO authenticated, service_role;
