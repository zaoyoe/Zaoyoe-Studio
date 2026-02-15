-- Function to allow a user to delete their own account
-- This runs with SECURITY DEFINER to access auth.users
-- Must be run in Supabase SQL Editor

CREATE OR REPLACE FUNCTION fn_delete_own_account()
RETURNS VOID AS $$
DECLARE
    v_user_id UUID;
BEGIN
    -- Get current authenticated user
    v_user_id := auth.uid();
    
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- Delete user data from all related tables
    -- Each wrapped in exception handler to skip missing tables/columns

    BEGIN DELETE FROM public.chat_messages WHERE session_id = v_user_id::text; EXCEPTION WHEN OTHERS THEN NULL; END;

    BEGIN DELETE FROM public.guestbook_likes WHERE user_id = v_user_id; EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN DELETE FROM public.guestbook_comments WHERE user_id = v_user_id; EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN DELETE FROM public.guestbook_messages WHERE user_id = v_user_id; EXCEPTION WHEN OTHERS THEN NULL; END;

    BEGIN DELETE FROM public.comment_likes WHERE user_id = v_user_id; EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN DELETE FROM public.prompt_comments WHERE user_id = v_user_id; EXCEPTION WHEN OTHERS THEN NULL; END;

    BEGIN DELETE FROM public.prompt_unlocks WHERE user_id = v_user_id; EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN DELETE FROM public.points_ledger WHERE user_id = v_user_id; EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN DELETE FROM public.user_points WHERE user_id = v_user_id; EXCEPTION WHEN OTHERS THEN NULL; END;

    BEGIN DELETE FROM public.user_tags WHERE user_id = v_user_id; EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN DELETE FROM public.user_login_history WHERE user_id = v_user_id; EXCEPTION WHEN OTHERS THEN NULL; END;

    BEGIN DELETE FROM public.admin_audit_log WHERE target_user_id = v_user_id OR admin_id = v_user_id; EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN DELETE FROM public.admin_notes WHERE target_user_id = v_user_id; EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN DELETE FROM public.block_history WHERE target_user_id = v_user_id; EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN DELETE FROM public.verification_logs WHERE user_id = v_user_id; EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN DELETE FROM public.user_events WHERE user_id = v_user_id; EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN DELETE FROM public.ab_assignments WHERE user_id = v_user_id; EXCEPTION WHEN OTHERS THEN NULL; END;

    -- Profile (must be after all FK references)
    BEGIN DELETE FROM public.profiles WHERE id = v_user_id; EXCEPTION WHEN OTHERS THEN NULL; END;

    -- Finally, delete from auth.users
    DELETE FROM auth.users WHERE id = v_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION fn_delete_own_account() TO authenticated;
