-- ============================================
-- 为单个兑换码添加独立有效期字段
-- ============================================

-- 添加 expires_at 字段到 redemption_codes 表
ALTER TABLE redemption_codes 
ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ DEFAULT NULL;

-- 添加注释
COMMENT ON COLUMN redemption_codes.expires_at IS '单个兑换码的独立有效期，优先于批次有效期';

-- ============================================
-- 请在 Supabase SQL Editor 中运行此脚本
-- ============================================
