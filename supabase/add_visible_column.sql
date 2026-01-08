-- 添加可见性字段到 points_ledger 表
-- 用于支持用户清除记录但保留后台数据（软删除）

ALTER TABLE points_ledger 
ADD COLUMN IF NOT EXISTS is_visible BOOLEAN DEFAULT TRUE;

-- 只有 RLS 策略允许用户更新自己的记录
-- 确保 is_visible 默认索引优化查询性能
CREATE INDEX IF NOT EXISTS idx_points_ledger_is_visible ON points_ledger(is_visible);
