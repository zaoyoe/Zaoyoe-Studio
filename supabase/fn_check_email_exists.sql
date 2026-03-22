-- Function to check if an email is registered
-- Only service_role may call this to avoid public email enumeration

CREATE OR REPLACE FUNCTION fn_check_email_exists(check_email TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    RETURN EXISTS (
        SELECT 1 FROM auth.users WHERE lower(email) = lower(check_email)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION fn_check_email_exists(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_check_email_exists(TEXT) TO service_role;
