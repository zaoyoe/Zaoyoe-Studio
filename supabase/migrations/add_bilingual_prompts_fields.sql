-- Migration: Add bilingual fields to prompts table
-- Adds title_en, title_zh, description_en, description_zh, prompt_text_en, prompt_text_zh

ALTER TABLE prompts ADD COLUMN IF NOT EXISTS title_en TEXT;
ALTER TABLE prompts ADD COLUMN IF NOT EXISTS title_zh TEXT;
ALTER TABLE prompts ADD COLUMN IF NOT EXISTS description_en TEXT;
ALTER TABLE prompts ADD COLUMN IF NOT EXISTS description_zh TEXT;
ALTER TABLE prompts ADD COLUMN IF NOT EXISTS prompt_text_en TEXT;
ALTER TABLE prompts ADD COLUMN IF NOT EXISTS prompt_text_zh TEXT;

-- Backfill: Copy existing title/description values to default language fields
UPDATE prompts SET title_en = title WHERE title_en IS NULL;
UPDATE prompts SET description_en = description WHERE description_en IS NULL;
UPDATE prompts SET prompt_text_en = prompt_text WHERE prompt_text_en IS NULL;
