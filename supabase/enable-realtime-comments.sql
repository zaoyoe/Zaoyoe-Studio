-- Enable Supabase Realtime for prompt_comments table
-- This allows real-time updates when new comments are inserted

-- Step 1: Enable Realtime for the publication
ALTER PUBLICATION supabase_realtime ADD TABLE prompt_comments;

-- Step 2: Verify it's enabled
-- You can check in Supabase Dashboard > Database > Replication
-- The prompt_comments table should be listed under "supabase_realtime" publication
