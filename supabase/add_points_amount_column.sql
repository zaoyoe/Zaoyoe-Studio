-- Add points_amount column to redemption_codes table if not exists
-- This column stores the points value for custom codes (not linked to a package)

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'redemption_codes' 
        AND column_name = 'points_amount'
    ) THEN
        ALTER TABLE redemption_codes ADD COLUMN points_amount INTEGER;
        COMMENT ON COLUMN redemption_codes.points_amount IS '自定义积分数量（用于不关联套餐的兑换码）';
    END IF;
END $$;
