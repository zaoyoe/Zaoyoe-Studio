-- =============================================
-- Fix: verification_logs RLS Policies (Complete)
-- =============================================

-- Drop existing policies to avoid conflicts
DROP POLICY IF EXISTS "Users can view their own verification logs" ON verification_logs;
DROP POLICY IF EXISTS "Service role can insert verification logs" ON verification_logs;
DROP POLICY IF EXISTS "Users can insert their own verification logs" ON verification_logs;
DROP POLICY IF EXISTS "Service role can manage verification logs" ON verification_logs;

-- Ensure RLS is enabled
ALTER TABLE verification_logs ENABLE ROW LEVEL SECURITY;

-- Allow users to read their own logs
CREATE POLICY "Users can view their own verification logs"
ON verification_logs
FOR SELECT
USING (auth.uid() = user_id);

-- Only the server may create or mutate upstream task ownership records.
CREATE POLICY "Service role can manage verification logs"
ON verification_logs
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

REVOKE INSERT, UPDATE, DELETE ON TABLE verification_logs FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE verification_logs FROM authenticated;
GRANT SELECT ON TABLE verification_logs TO authenticated;
GRANT ALL ON TABLE verification_logs TO service_role;

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_verification_logs_user_id 
ON verification_logs(user_id, created_at DESC);

-- Verify
SELECT count(*) as total_records FROM verification_logs;
