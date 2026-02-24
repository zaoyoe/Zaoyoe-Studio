-- 升级现有的用户注册触发器，以支持从 raw_user_meta_data 解析 invite_code 并关联到 invited_by
CREATE OR REPLACE FUNCTION public.handle_new_user() 
RETURNS TRIGGER AS $$
DECLARE
    v_invited_by UUID := NULL;
    v_invite_code VARCHAR;
BEGIN
    -- Extract invite code from metadata if present
    v_invite_code := new.raw_user_meta_data->>'invite_code';
    
    -- Lookup the inviter's UUID by invite code
    IF v_invite_code IS NOT NULL AND TRIM(v_invite_code) <> '' THEN
        SELECT id INTO v_invited_by FROM public.profiles WHERE invite_code = UPPER(TRIM(v_invite_code)) LIMIT 1;
    END IF;

    INSERT INTO public.profiles (id, username, avatar_url, invited_by)
    VALUES (
        new.id, 
        new.raw_user_meta_data->>'full_name', 
        new.raw_user_meta_data->>'avatar_url',
        v_invited_by
    );
    RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
