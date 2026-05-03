-- Prevent admin-only bell notifications from being visible to ordinary users
-- even when a stale or bad row is addressed to their user_id.

ALTER TABLE IF EXISTS public.system_notifications
  ADD COLUMN IF NOT EXISTS scope TEXT DEFAULT 'unspecified',
  ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'general';

UPDATE public.system_notifications
SET
  scope = COALESCE(NULLIF(scope, ''), 'unspecified'),
  category = COALESCE(NULLIF(category, ''), 'general')
WHERE
  scope IS NULL
  OR scope = ''
  OR category IS NULL
  OR category = '';

ALTER TABLE IF EXISTS public.system_notifications
  ALTER COLUMN scope SET DEFAULT 'unspecified',
  ALTER COLUMN scope SET NOT NULL,
  ALTER COLUMN category SET DEFAULT 'general',
  ALTER COLUMN category SET NOT NULL;

ALTER TABLE IF EXISTS public.system_notifications
  DROP CONSTRAINT IF EXISTS system_notifications_scope_check;

ALTER TABLE IF EXISTS public.system_notifications
  ADD CONSTRAINT system_notifications_scope_check
  CHECK (scope IN ('unspecified', 'user_personal', 'admin_personal'));

DROP POLICY IF EXISTS "Users can view own notifications" ON public.system_notifications;
CREATE POLICY "Users can view own notifications"
  ON public.system_notifications FOR SELECT
  USING (
    auth.uid() = user_id
    AND (
      scope <> 'admin_personal'
      OR public.is_admin()
    )
  );

DROP POLICY IF EXISTS "Users can update own notifications" ON public.system_notifications;
CREATE POLICY "Users can update own notifications"
  ON public.system_notifications FOR UPDATE
  USING (
    auth.uid() = user_id
    AND (
      scope <> 'admin_personal'
      OR public.is_admin()
    )
  );

DROP POLICY IF EXISTS "Users can delete own notifications" ON public.system_notifications;
CREATE POLICY "Users can delete own notifications"
  ON public.system_notifications FOR DELETE
  USING (
    auth.uid() = user_id
    AND (
      scope <> 'admin_personal'
      OR public.is_admin()
    )
  );

CREATE INDEX IF NOT EXISTS idx_system_notifications_user_scope_created_at
  ON public.system_notifications (user_id, scope, created_at DESC);
