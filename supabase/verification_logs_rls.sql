-- =============================================
-- Fix: verification_logs RLS Policies (Complete)
-- =============================================

-- Drop existing policies to avoid conflicts
DROP POLICY IF EXISTS "Users can view their own verification logs" ON verification_logs;
DROP POLICY IF EXISTS "Service role can insert verification logs" ON verification_logs;
DROP POLICY IF EXISTS "Users can insert their own verification logs" ON verification_logs;

-- Ensure RLS is enabled
ALTER TABLE verification_logs ENABLE ROW LEVEL SECURITY;

-- Allow users to read their own logs
CREATE POLICY "Users can view their own verification logs"
ON verification_logs
FOR SELECT
USING (auth.uid() = user_id);

-- Allow authenticated users to insert their own logs (for client-side logging)
CREATE POLICY "Users can insert their own verification logs"
ON verification_logs
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Allow service role to insert (still needed for server-side)
CREATE POLICY "Service role can insert verification logs"
ON verification_logs
FOR INSERT
WITH CHECK (true);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_verification_logs_user_id 
ON verification_logs(user_id, created_at DESC);

-- Verify
SELECT count(*) as total_records FROM verification_logs;
