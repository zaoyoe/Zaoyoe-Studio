-- 允许用户删除自己的交易记录
-- 在 Supabase SQL Editor 中运行

CREATE POLICY "Users delete own ledger"
  ON public.points_ledger
  FOR DELETE
  USING (auth.uid() = user_id);
