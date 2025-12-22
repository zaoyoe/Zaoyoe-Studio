-- ============================================
-- Auto-Link Reply Comments Trigger
-- ============================================
-- This trigger automatically detects @mentions in comments
-- and links them to their parent comments if parent_id is NULL

-- Step 1: Create the trigger function
CREATE OR REPLACE FUNCTION auto_link_reply_comment()
RETURNS TRIGGER AS $$
DECLARE
    mentioned_username TEXT;
    parent_comment_id UUID;
BEGIN
    -- Only process if:
    -- 1. parent_id is NULL (not already set)
    -- 2. content starts with @
    IF NEW.parent_id IS NULL AND NEW.content LIKE '@%' THEN
        
        -- Extract the @mention (everything after @ until space or end of string)
        mentioned_username := substring(NEW.content FROM '@([^ ]+)');
        
        -- Find the most recent comment in the same prompt by the mentioned user
        SELECT c.id INTO parent_comment_id
        FROM prompt_comments c
        INNER JOIN profiles p ON c.user_id = p.id
        WHERE c.prompt_id = NEW.prompt_id
          AND LOWER(p.username) = LOWER(mentioned_username)
          AND c.created_at < NEW.created_at  -- Parent must be older
          AND c.parent_id IS NULL  -- Only link to top-level comments (avoid deep nesting)
          AND c.id != NEW.id  -- Don't link to itself
        ORDER BY c.created_at DESC
        LIMIT 1;
        
        -- If we found a matching parent, set it
        IF parent_comment_id IS NOT NULL THEN
            NEW.parent_id := parent_comment_id;
            
            -- Log for debugging (optional)
            RAISE NOTICE 'Auto-linked reply % to parent %', NEW.id, parent_comment_id;
        END IF;
        
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 2: Create the trigger
DROP TRIGGER IF EXISTS trigger_auto_link_replies ON prompt_comments;

CREATE TRIGGER trigger_auto_link_replies
    BEFORE INSERT ON prompt_comments
    FOR EACH ROW
    EXECUTE FUNCTION auto_link_reply_comment();

-- Step 3: Verify the trigger is active
SELECT 
    trigger_name,
    event_manipulation,
    event_object_table,
    action_statement
FROM information_schema.triggers
WHERE trigger_name = 'trigger_auto_link_replies';
