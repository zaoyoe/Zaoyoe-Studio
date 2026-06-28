ALTER TABLE groups
    ADD COLUMN IF NOT EXISTS allow_video_generation BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN groups.allow_video_generation IS '是否允许该分组使用视频生成能力';
