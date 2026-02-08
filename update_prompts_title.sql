-- Update homepage_config: Change "AI Prompt Studio" to "AI Prompt"
-- Run this in Supabase SQL Editor

-- Update Chinese title
UPDATE homepage_config 
SET content = jsonb_set(content, '{section_title}', '"AI 提示词"'::jsonb) 
WHERE section = 'prompts';

-- Update English title
UPDATE homepage_config 
SET content = jsonb_set(content, '{section_title_en}', '"AI Prompt"'::jsonb) 
WHERE section = 'prompts';

-- Verify the changes
SELECT section, content->'section_title' as title_zh, content->'section_title_en' as title_en 
FROM homepage_config 
WHERE section = 'prompts';
