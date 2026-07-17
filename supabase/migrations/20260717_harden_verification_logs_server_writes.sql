BEGIN;

ALTER TABLE public.verification_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can insert their own verification logs" ON public.verification_logs;
DROP POLICY IF EXISTS "Service role can insert verification logs" ON public.verification_logs;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.verification_logs FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.verification_logs FROM authenticated;

CREATE POLICY "Service role can manage verification logs"
ON public.verification_logs
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

GRANT SELECT ON TABLE public.verification_logs TO authenticated;
GRANT ALL ON TABLE public.verification_logs TO service_role;

COMMIT;
