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

COMMENT ON COLUMN public.system_notifications.scope IS 'Notification visibility scope. unspecified keeps legacy rows compatible during migration.';
COMMENT ON COLUMN public.system_notifications.category IS 'Notification category for client routing, such as chat_reply, admin_notice, assignment, or security.';

CREATE INDEX IF NOT EXISTS idx_system_notifications_user_scope_created_at
  ON public.system_notifications (user_id, scope, created_at DESC);
