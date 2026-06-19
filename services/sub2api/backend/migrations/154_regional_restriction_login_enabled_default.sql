-- Preserve local regional restriction behavior after upstream updates:
-- when regional restriction is already enabled, existing-account login and
-- token refresh should be guarded unless the admin later disables this scope.
INSERT INTO settings (key, value, created_at)
SELECT 'regional_restriction_login_enabled', 'true', NOW()
WHERE EXISTS (
    SELECT 1 FROM settings
    WHERE key = 'regional_restriction_enabled'
      AND value = 'true'
)
ON CONFLICT (key) DO NOTHING;
