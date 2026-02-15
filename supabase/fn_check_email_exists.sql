-- Function to check if an email is registered
-- Returns true if registered, false if not
-- This is a SECURITY DEFINER function to query auth.users

CREATE OR REPLACE FUNCTION fn_check_email_exists(check_email TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM auth.users WHERE email = check_email
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Allow anonymous and authenticated users to call this
GRANT EXECUTE ON FUNCTION fn_check_email_exists(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION fn_check_email_exists(TEXT) TO authenticated;
