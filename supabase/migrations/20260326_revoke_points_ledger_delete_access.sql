-- ============================================
-- Revoke direct points_ledger delete access
-- - drop any legacy self-delete policy on points_ledger
-- - revoke delete privileges from unaudited caller roles
-- - keep history hiding on fn_clear_user_history()
-- ============================================

DROP POLICY IF EXISTS "Users delete own ledger" ON public.points_ledger;

REVOKE DELETE ON public.points_ledger FROM PUBLIC;
REVOKE DELETE ON public.points_ledger FROM anon;
REVOKE DELETE ON public.points_ledger FROM authenticated;
