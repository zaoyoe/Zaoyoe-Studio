-- 已废弃：不要再给用户开放 points_ledger 的直接删除权限
-- 如需隐藏历史，请使用 fn_clear_user_history()
-- 在 Supabase SQL Editor 中运行

DROP POLICY IF EXISTS "Users delete own ledger"
  ON public.points_ledger;

REVOKE DELETE ON public.points_ledger FROM PUBLIC;
REVOKE DELETE ON public.points_ledger FROM anon;
REVOKE DELETE ON public.points_ledger FROM authenticated;
