-- Keep existing-account login covered when regional restriction is already enabled.
--
-- This is intentionally scoped: installations that have not enabled regional
-- restriction remain unchanged, so the login page and whole site are not blocked.

INSERT INTO settings (key, value, updated_at)
SELECT 'regional_restriction_login_enabled', 'true', NOW()
WHERE EXISTS (
    SELECT 1
    FROM settings regional_enabled
    WHERE regional_enabled.key = 'regional_restriction_enabled'
      AND regional_enabled.value = 'true'
)
ON CONFLICT (key) DO UPDATE
SET value = 'true',
    updated_at = NOW()
WHERE EXISTS (
    SELECT 1
    FROM settings regional_enabled
    WHERE regional_enabled.key = 'regional_restriction_enabled'
      AND regional_enabled.value = 'true'
)
  AND settings.value <> 'true';
