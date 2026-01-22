-- ============================================
-- LOGIN SECURITY - PART 1: 表结构和基础函数
-- 在 Supabase SQL 编辑器中执行此文件
-- ============================================

-- 1. Add security columns to profiles table
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS locked_until TIMESTAMP WITH TIME ZONE DEFAULT NULL;

-- 2. Create index for email lookup
CREATE INDEX IF NOT EXISTS idx_profiles_locked_until ON public.profiles(locked_until);
