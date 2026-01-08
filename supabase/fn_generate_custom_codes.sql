-- Function to generate redemption codes with custom points amount
-- (Not linked to a specific package)

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
        -- Generate unique code: PREFIX + random alphanumeric
        v_code := 'ZY-' || upper(substring(md5(random()::text || clock_timestamp()::text) from 1 for 8));
        
        -- Insert code
        INSERT INTO redemption_codes (
            batch_id,
            code,
            points_amount,
            is_used,
            expires_at
        ) VALUES (
            v_batch_id,
            v_code,
            p_points_amount,
            FALSE,
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
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'redemption_batches' 
        AND column_name = 'custom_points_amount'
    ) THEN
        ALTER TABLE redemption_batches ADD COLUMN custom_points_amount INTEGER;
    END IF;
END $$;
