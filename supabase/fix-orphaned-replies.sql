-- ============================================
-- Fix Orphaned Reply Comments
-- ============================================
-- This script identifies comments that appear to be replies (start with @mention)
-- but have parent_id = NULL, and attempts to link them to their parent comments.

-- First, let's see what we're dealing with
SELECT 
    c.id,
    c.content,
    c.created_at,
    c.prompt_id,
    c.user_id,
    c.parent_id,
    p.username as commenter_username
FROM prompt_comments c
LEFT JOIN profiles p ON c.user_id = p.id
WHERE c.parent_id IS NULL
  AND c.content LIKE '@%'
ORDER BY c.prompt_id, c.created_at;

-- Strategy: For each orphaned reply, find the most recent comment in the same prompt
-- whose author's username matches the @mention at the start of the content

-- Step 1: Create a temporary function to extract @username from content
CREATE OR REPLACE FUNCTION extract_mention(content TEXT)
RETURNS TEXT AS $$
DECLARE
    mention TEXT;
BEGIN
    -- Extract the first @mention (everything after @ until space or end)
    mention := substring(content FROM '@([^ ]+)');
    RETURN mention;
END;
$$ LANGUAGE plpgsql;

-- Step 2: Find and update orphaned replies
-- This uses a CTE to match each orphaned reply with a potential parent
WITH orphaned_replies AS (
    SELECT 
        c.id as reply_id,
        c.prompt_id,
        c.created_at as reply_created_at,
        extract_mention(c.content) as mentioned_user
    FROM prompt_comments c
    WHERE c.parent_id IS NULL
      AND c.content LIKE '@%'
),
potential_parents AS (
    SELECT DISTINCT ON (or1.reply_id)
        or1.reply_id,
        pc.id as potential_parent_id,
        pc.created_at as parent_created_at,
        p.username as parent_username
    FROM orphaned_replies or1
    INNER JOIN prompt_comments pc ON pc.prompt_id = or1.prompt_id
    INNER JOIN profiles p ON pc.user_id = p.id
    WHERE pc.created_at < or1.reply_created_at  -- Parent must be created before reply
      AND LOWER(p.username) = LOWER(or1.mentioned_user)  -- Username matches @mention
      AND pc.parent_id IS NULL  -- Only match to top-level comments (avoid deep nesting)
    ORDER BY or1.reply_id, pc.created_at DESC  -- Get the most recent matching comment
)
UPDATE prompt_comments
SET parent_id = pp.potential_parent_id
FROM potential_parents pp
WHERE prompt_comments.id = pp.reply_id;

-- Step 3: Report what was fixed
SELECT 
    c.id,
    c.content,
    c.parent_id,
    p_parent.username as parent_author,
    p_reply.username as reply_author
FROM prompt_comments c
LEFT JOIN prompt_comments parent ON c.parent_id = parent.id
LEFT JOIN profiles p_parent ON parent.user_id = p_parent.id
LEFT JOIN profiles p_reply ON c.user_id = p_reply.id
WHERE c.content LIKE '@%'
  AND c.parent_id IS NOT NULL
ORDER BY c.created_at;

-- Step 4: Clean up temporary function
DROP FUNCTION IF EXISTS extract_mention(TEXT);
