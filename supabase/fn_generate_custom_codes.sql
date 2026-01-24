-- Function to generate redemption codes with custom points amount
-- (Not linked to a specific package)
-- Updated to match actual table schema

CREATE OR REPLACE FUNCTION fn_generate_custom_codes(
    p_batch_name TEXT,
    p_points_amount INTEGER,
    p_count INTEGER,
    p_channel TEXT DEFAULT 'manual',
    p_expires_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE(code TEXT) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_batch_id UUID;
    v_code TEXT;
    i INTEGER;
BEGIN
    -- Validate inputs
    IF p_points_amount <= 0 THEN
        RAISE EXCEPTION 'Points amount must be positive';
    END IF;
    
    IF p_count <= 0 OR p_count > 1000 THEN
        RAISE EXCEPTION 'Count must be between 1 and 1000';
    END IF;

    -- Create batch record (package_id is NULL for custom points)
    INSERT INTO redemption_batches (
        name,
        package_id,
        channel,
        total_count,
        used_count,
        expires_at,
        custom_points_amount
    ) VALUES (
        p_batch_name,
        NULL,  -- No package for custom points
        p_channel,
        p_count,
        0,
        p_expires_at,
        p_points_amount  -- Store custom points amount
    ) RETURNING id INTO v_batch_id;

    -- Generate codes
    FOR i IN 1..p_count LOOP
        -- Generate unique code: ZY-XXXX-XXXX-XXXX format
        v_code := 'ZY-' || 
                  upper(substring(md5(random()::text) from 1 for 4)) || '-' ||
                  upper(substring(md5(random()::text) from 1 for 4)) || '-' ||
                  upper(substring(md5(random()::text) from 1 for 4));
        
        -- Insert code using correct column names (status instead of is_used)
        INSERT INTO redemption_codes (
            batch_id,
            code,
            status,
            expires_at
        ) VALUES (
            v_batch_id,
            v_code,
            'unused',  -- Use status enum value instead of is_used boolean
            p_expires_at
        );
        
        RETURN QUERY SELECT v_code;
    END LOOP;
    
    RETURN;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION fn_generate_custom_codes TO authenticated;

-- Add custom_points_amount column to redemption_batches if not exists
-- Run this separately first if the column doesn't exist:
-- ALTER TABLE redemption_batches ADD COLUMN IF NOT EXISTS custom_points_amount INTEGER;
