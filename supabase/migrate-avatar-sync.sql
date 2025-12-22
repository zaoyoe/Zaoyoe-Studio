-- ==========================================
-- AVATAR SYNC MIGRATION
-- Run this in Supabase SQL Editor to sync
-- avatar_url from auth.users to profiles
-- ==========================================

-- 1. One-time sync: Update existing profiles with avatar from auth metadata
UPDATE public.profiles p
SET avatar_url = (
    SELECT u.raw_user_meta_data->>'avatar_url'
    FROM auth.users u
    WHERE u.id = p.id
)
WHERE p.avatar_url IS NULL OR p.avatar_url = '';

-- 2. Fix the trigger to also update on subsequent logins
-- This ensures future logins sync the avatar properly

-- Drop old trigger/function if exists
DROP TRIGGER IF EXISTS on_auth_user_updated ON auth.users;
DROP FUNCTION IF EXISTS public.handle_user_update();

-- Create function to handle avatar updates on login
CREATE OR REPLACE FUNCTION public.handle_user_update()
RETURNS TRIGGER AS $$
BEGIN
  -- Only update if avatar changed and is not null
  IF NEW.raw_user_meta_data->>'avatar_url' IS NOT NULL THEN
    UPDATE public.profiles 
    SET 
      avatar_url = NEW.raw_user_meta_data->>'avatar_url',
      updated_at = NOW()
    WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for user updates (fires on every login/metadata change)
CREATE TRIGGER on_auth_user_updated
  AFTER UPDATE ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_user_update();

-- ==========================================
-- VERIFICATION
-- After running, check if avatars are synced:
-- SELECT id, username, avatar_url FROM public.profiles LIMIT 10;
-- ==========================================
