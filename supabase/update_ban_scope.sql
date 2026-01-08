-- Update the check constraint for scope in blocked_users table
-- This allows 'points_usage' as a valid scope

ALTER TABLE blocked_users
DROP CONSTRAINT IF EXISTS blocked_users_scope_check;

ALTER TABLE blocked_users
ADD CONSTRAINT blocked_users_scope_check 
CHECK (scope IN ('guestbook', 'gallery', 'all', 'points_usage'));

COMMENT ON CONSTRAINT blocked_users_scope_check ON blocked_users IS 'Allow guestbook, gallery, all, and points_usage scopes';
