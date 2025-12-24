-- Clean up legacy comments that have redundant @mentions in the content
-- Only targets replies (parent_id IS NOT NULL) that start with '@'

UPDATE prompt_comments
SET content = REGEXP_REPLACE(content, '^@\S+\s*', '')
WHERE parent_id IS NOT NULL 
  AND content ~ '^@\S+';

-- Verify the changes (optional check)
-- SELECT id, content FROM prompt_comments WHERE parent_id IS NOT NULL AND content ~ '^@';
