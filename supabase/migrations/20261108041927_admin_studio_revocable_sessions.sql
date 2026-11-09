-- Local candidate only. Not applied by this change. Coordinate with the runtime release.
-- All RPCs are callable only by the server's service_role. No browser table access.
BEGIN;
CREATE SCHEMA IF NOT EXISTS private;
CREATE TABLE IF NOT EXISTS private.admin_studio_sessions (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    source_session_id uuid NOT NULL,
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (expires_at > created_at AND expires_at <= created_at + interval '1 hour')
);
CREATE INDEX IF NOT EXISTS admin_studio_sessions_source_idx
    ON private.admin_studio_sessions(user_id, source_session_id);
CREATE TABLE IF NOT EXISTS private.admin_studio_revoked_sources (
    source_session_id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    revoked_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE private.admin_studio_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.admin_studio_revoked_sources ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.admin_studio_sessions, private.admin_studio_revoked_sources
    FROM PUBLIC, anon, authenticated, service_role;

-- VOLATILE gives each internal query a fresh snapshot after a lock wait in
-- create/revoke. A calling-query snapshot must not hide a committed tombstone.
CREATE OR REPLACE FUNCTION private.admin_auth_session_active(p_user_id uuid, p_source_session_id uuid)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
    SELECT EXISTS (
        SELECT 1 FROM auth.sessions s WHERE s.id = p_source_session_id AND s.user_id = p_user_id
        AND (s.not_after IS NULL OR s.not_after > clock_timestamp())
        AND NOT EXISTS (SELECT 1 FROM private.admin_studio_revoked_sources r
                        WHERE r.source_session_id = s.id)
    );
$$;
CREATE OR REPLACE FUNCTION private.admin_studio_session_active(p_id uuid, p_user_id uuid, p_expires_at timestamptz)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
    SELECT EXISTS (
        SELECT 1 FROM private.admin_studio_sessions g WHERE g.id = p_id AND g.user_id = p_user_id
        AND g.expires_at = p_expires_at AND g.expires_at > clock_timestamp() AND g.revoked_at IS NULL
        AND private.admin_auth_session_active(g.user_id, g.source_session_id)
    );
$$;
CREATE OR REPLACE FUNCTION private.admin_studio_session_create(
    p_id uuid, p_user_id uuid, p_source_session_id uuid, p_expires_at timestamptz)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    -- Creation and source revocation serialize on the same Auth row. A late
    -- request can never revive a source which was logged out concurrently.
    PERFORM 1 FROM auth.sessions s WHERE s.id = p_source_session_id AND s.user_id = p_user_id FOR UPDATE;
    IF NOT FOUND OR NOT private.admin_auth_session_active(p_user_id, p_source_session_id)
       OR p_expires_at IS NULL OR p_expires_at <= clock_timestamp() OR p_expires_at > now() + interval '1 hour' THEN
        RETURN false;
    END IF;
    DELETE FROM private.admin_studio_sessions WHERE user_id = p_user_id AND expires_at <= now();
    INSERT INTO private.admin_studio_sessions(id, user_id, source_session_id, expires_at)
        VALUES (p_id, p_user_id, p_source_session_id, p_expires_at);
    RETURN true;
END;
$$;
CREATE OR REPLACE FUNCTION private.admin_studio_session_revoke(
    p_user_id uuid, p_id uuid DEFAULT NULL, p_source_session_id uuid DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE source_id uuid;
BEGIN
    IF p_id IS NOT NULL THEN
        SELECT g.source_session_id INTO source_id FROM private.admin_studio_sessions g
            WHERE g.id = p_id AND g.user_id = p_user_id;
    ELSE
        source_id := p_source_session_id;
    END IF;
    IF source_id IS NULL THEN RETURN true; END IF;
    PERFORM 1 FROM auth.sessions s WHERE s.id = source_id AND s.user_id = p_user_id FOR UPDATE;
    INSERT INTO private.admin_studio_revoked_sources(source_session_id, user_id)
        VALUES (source_id, p_user_id) ON CONFLICT (source_session_id) DO NOTHING;
    UPDATE private.admin_studio_sessions SET revoked_at = COALESCE(revoked_at, now())
        WHERE user_id = p_user_id AND source_session_id = source_id;
    RETURN true;
END;
$$;
CREATE OR REPLACE FUNCTION private.admin_studio_session_discard(p_id uuid, p_user_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    UPDATE private.admin_studio_sessions SET revoked_at = COALESCE(revoked_at, now())
        WHERE id = p_id AND user_id = p_user_id;
    RETURN true;
END;
$$;

-- PostgREST-exposed wrappers retain invoker permissions. The narrow privileged
-- functions live in an unexposed schema, with fixed search paths and explicit ACLs.
CREATE OR REPLACE FUNCTION public.admin_auth_session_active(p_user_id uuid, p_source_session_id uuid)
RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
    SELECT private.admin_auth_session_active(p_user_id, p_source_session_id);
$$;
CREATE OR REPLACE FUNCTION public.admin_studio_session_active(p_id uuid, p_user_id uuid, p_expires_at timestamptz)
RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
    SELECT private.admin_studio_session_active(p_id, p_user_id, p_expires_at);
$$;
CREATE OR REPLACE FUNCTION public.admin_studio_session_create(p_id uuid, p_user_id uuid, p_source_session_id uuid, p_expires_at timestamptz)
RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
    SELECT private.admin_studio_session_create(p_id, p_user_id, p_source_session_id, p_expires_at);
$$;
CREATE OR REPLACE FUNCTION public.admin_studio_session_revoke(p_user_id uuid, p_id uuid DEFAULT NULL, p_source_session_id uuid DEFAULT NULL)
RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
    SELECT private.admin_studio_session_revoke(p_user_id, p_id, p_source_session_id);
$$;
CREATE OR REPLACE FUNCTION public.admin_studio_session_discard(p_id uuid, p_user_id uuid)
RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
    SELECT private.admin_studio_session_discard(p_id, p_user_id);
$$;

REVOKE ALL ON FUNCTION private.admin_auth_session_active(uuid,uuid),
    private.admin_studio_session_active(uuid,uuid,timestamptz),
    private.admin_studio_session_create(uuid,uuid,uuid,timestamptz),
    private.admin_studio_session_revoke(uuid,uuid,uuid),
    private.admin_studio_session_discard(uuid,uuid),
    public.admin_auth_session_active(uuid,uuid),
    public.admin_studio_session_active(uuid,uuid,timestamptz),
    public.admin_studio_session_create(uuid,uuid,uuid,timestamptz),
    public.admin_studio_session_revoke(uuid,uuid,uuid),
    public.admin_studio_session_discard(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO service_role;
GRANT EXECUTE ON FUNCTION private.admin_auth_session_active(uuid,uuid),
    private.admin_studio_session_active(uuid,uuid,timestamptz),
    private.admin_studio_session_create(uuid,uuid,uuid,timestamptz),
    private.admin_studio_session_revoke(uuid,uuid,uuid),
    private.admin_studio_session_discard(uuid,uuid),
    public.admin_auth_session_active(uuid,uuid),
    public.admin_studio_session_active(uuid,uuid,timestamptz),
    public.admin_studio_session_create(uuid,uuid,uuid,timestamptz),
    public.admin_studio_session_revoke(uuid,uuid,uuid),
    public.admin_studio_session_discard(uuid,uuid) TO service_role;
COMMIT;
