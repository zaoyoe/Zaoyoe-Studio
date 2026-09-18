-- Guest Shop Order Access 2.0 (A3): admin-issued one-time password-reset links.
-- Codex does not execute this file. Run it in the target Supabase SQL editor
-- after 20260921_guest_shop_buyer_group_upsert.sql. Design contract:
-- docs/guest-shop-order-access-2.0.md §10.5 (OTP 上线前的忘记密码路径).
--
-- This migration is strictly additive:
--   * one new table (guest_shop_access_resets),
--   * one widened CHECK constraint on guest_shop_access_attempts.outcome,
--   * no new function, no trigger, no job, no view, no column drop,
--   * no row of guest_shop_buyers / guest_shop_orders is read or modified,
--   * no GUEST_SHOP_* switch is turned on and no guest product is enabled.
-- With GUEST_SHOP_BUYER_CREDENTIAL_ENABLED off, nothing in the application ever
-- writes this table, so after applying the file production behaviour is
-- unchanged.
--
-- WHY A TABLE AND NOT A COLUMN ON guest_shop_buyers
--   A reset link is a bearer secret with a lifetime, a single use, an issuing
--   admin and a reason. Hanging that off the credential row would (a) leave no
--   forensic trail of who issued what, (b) make "revoke the previous link"
--   indistinguishable from "never issued one", and (c) put a secret-bearing
--   column on the hottest row in the credential path. A separate append-only
--   table keeps the credential row free of link state and gives the audit trail
--   somewhere to live.
--
-- WHAT IS STORED IS A HASH, NEVER THE TOKEN
--   token_hash = sha256(token). The plaintext token is returned to the issuing
--   admin exactly once, in the HTTP response of the issue call, and is never
--   written to this table, to admin_audit_logs, to any log, or to any chat
--   (AGENTS.md hard prohibition). A database dump therefore cannot be turned
--   into working reset links.
--
-- THREE TERMINAL STATES, NOT ONE
--   used_at   -> the buyer consumed it and set a new password
--   revoked_at-> an admin (or a re-issue) killed it before it was used
--   neither, but expires_at in the past -> it simply timed out
--   Collapsing revoke into used_at would make "the admin re-issued a link"
--   indistinguishable from "the buyer used it", which is exactly the difference
--   an incident reviewer needs. The two are also mutually exclusive by CHECK.

-- ---------------------------------------------------------------------------
-- 1. guest_shop_access_resets
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.guest_shop_access_resets (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site                VARCHAR(10)  NOT NULL,
    buyer_id            UUID         NOT NULL
        REFERENCES public.guest_shop_buyers(id) ON DELETE CASCADE,
    contact_hash        TEXT         NOT NULL,
    purpose             VARCHAR(24)  NOT NULL DEFAULT 'password_reset',
    token_hash          TEXT         NOT NULL,
    expires_at          TIMESTAMPTZ  NOT NULL,
    used_at             TIMESTAMPTZ,
    consumed_ip_hash    TEXT,
    revoked_at          TIMESTAMPTZ,
    created_by_admin_id UUID         NOT NULL,
    reason              TEXT         NOT NULL,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT guest_shop_access_resets_site_check    CHECK (site IN ('cn','intl')),
    CONSTRAINT guest_shop_access_resets_purpose_check CHECK (purpose IN ('password_reset')),
    CONSTRAINT guest_shop_access_resets_hash_check    CHECK (contact_hash ~ '^[0-9a-f]{64}$'),
    -- sha256 hex of a 256-bit CSPRNG token. The format check is what stops a
    -- caller from storing a plaintext token here by accident.
    CONSTRAINT guest_shop_access_resets_token_check   CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT guest_shop_access_resets_ip_check      CHECK (consumed_ip_hash IS NULL OR char_length(consumed_ip_hash) <= 128),
    -- The application enforces a 15-minute TTL (§10.5). The DB bound is the
    -- outer guard: a mis-set knob can never mint a link that outlives a day.
    CONSTRAINT guest_shop_access_resets_ttl_check     CHECK (expires_at > created_at AND expires_at <= created_at + INTERVAL '24 hours'),
    CONSTRAINT guest_shop_access_resets_reason_check  CHECK (char_length(reason) BETWEEN 8 AND 500),
    CONSTRAINT guest_shop_access_resets_used_order    CHECK (used_at IS NULL OR used_at >= created_at),
    CONSTRAINT guest_shop_access_resets_revoked_order CHECK (revoked_at IS NULL OR revoked_at >= created_at),
    -- A link is either spent or killed, never both. Enforcing it here means a
    -- bug in the revoke path cannot quietly rewrite history.
    CONSTRAINT guest_shop_access_resets_state_check   CHECK (NOT (used_at IS NOT NULL AND revoked_at IS NOT NULL)),
    -- Consuming an expired link must be impossible, not merely unchecked: the
    -- application filters on expires_at, and this CHECK turns any bypass into a
    -- hard write error.
    CONSTRAINT guest_shop_access_resets_used_live     CHECK (used_at IS NULL OR used_at <= expires_at),
    CONSTRAINT guest_shop_access_resets_token_uniq    UNIQUE (token_hash)
);

COMMENT ON TABLE public.guest_shop_access_resets IS
    'Admin-issued one-time guest query-password reset links (Order Access 2.0 §10.5). Stores sha256(token) only; the plaintext token is shown to the issuing admin exactly once and never persisted.';
COMMENT ON COLUMN public.guest_shop_access_resets.token_hash IS
    'sha256 hex of the 256-bit reset token. Never store the plaintext token here.';
COMMENT ON COLUMN public.guest_shop_access_resets.buyer_id IS
    'The single credential group this link may reset. A link is bound to ONE group so a reset can never cross the §6.4 group isolation wall.';
COMMENT ON COLUMN public.guest_shop_access_resets.reason IS
    'Admin-entered justification, >= 8 characters, enforced in both the app and here.';
COMMENT ON COLUMN public.guest_shop_access_resets.revoked_at IS
    'Set when an admin revokes the link or when a new link for the same buyer supersedes it. Mutually exclusive with used_at.';

-- Consume path: token_hash is already UNIQUE, this is the lookup index.
CREATE INDEX IF NOT EXISTS guest_shop_access_resets_token_idx
    ON public.guest_shop_access_resets (token_hash)
    WHERE used_at IS NULL AND revoked_at IS NULL;
-- Issue path: "revoke the previous pending link for this buyer" and the admin
-- view of outstanding links.
CREATE INDEX IF NOT EXISTS guest_shop_access_resets_buyer_idx
    ON public.guest_shop_access_resets (buyer_id, created_at DESC);

-- At most ONE pending link per credential group. The application revokes the
-- previous link before inserting, and this index is the hard guard that makes a
-- race between two admins fail closed instead of leaving two live links.
CREATE UNIQUE INDEX IF NOT EXISTS guest_shop_access_resets_one_pending_per_buyer
    ON public.guest_shop_access_resets (buyer_id)
    WHERE used_at IS NULL AND revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- 2. Row Level Security + privileges.
--
--    Same reasoning as 20260920 section 2b, and it is the single most
--    security-critical statement in this file: Supabase installs ALTER DEFAULT
--    PRIVILEGES that grant ALL on every new public table to anon and
--    authenticated, so WITHOUT the REVOKE below any anonymous browser could
--    read (or write) reset-link rows through PostgREST. RLS alone is not
--    enough and REVOKE alone is not enough; both are applied.
--
--    There are deliberately NO browser-facing policies. The reset link is
--    issued by the admin handler and consumed by the public guest handler, both
--    running as service_role (which bypasses RLS).
-- ---------------------------------------------------------------------------
ALTER TABLE public.guest_shop_access_resets ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.guest_shop_access_resets FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.guest_shop_access_resets TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Widen guest_shop_access_attempts.outcome.
--
--    Reset and self-upgrade attempts share the login audit stream on purpose:
--    one table, one retention rule, one place to look during an incident. Four
--    new outcomes are added and NONE is removed or renamed, so every existing
--    row keeps satisfying the constraint and no historical query breaks.
--
--    reset_*   -> §10.5 admin-issued one-time link (POST /guest/access/reset)
--    upgrade_* -> §13.2 historical order self-upgrade to password access
--                 (POST /guest/access/upgrade), whose second factor is the
--                 legacy claim secret
--
--    DROP + ADD (rather than creating a second constraint) is required because
--    PostgreSQL cannot widen a CHECK in place. The new constraint is validated
--    against existing rows, which trivially passes because the new value list is
--    a strict superset of the old one.
-- ---------------------------------------------------------------------------
ALTER TABLE public.guest_shop_access_attempts
    DROP CONSTRAINT IF EXISTS guest_shop_access_attempts_outcome_check;

ALTER TABLE public.guest_shop_access_attempts
    ADD CONSTRAINT guest_shop_access_attempts_outcome_check CHECK (outcome IN
        ('success','bad_password','unknown_email','locked','captcha_required',
         'rate_limited','credential_conflict',
         'reset_invalid','reset_success','upgrade_invalid','upgrade_success'));

-- ---------------------------------------------------------------------------
-- 4. Operator notes
--
--    a) No purge job is created here. Expired/used/revoked rows are small and
--       append-only; scheduling cleanup is operator work and must never be
--       turned on by a migration or a deploy (same convention as the
--       guest_shop_access_attempts 30-day retention note in 20260920).
--    b) This file does NOT create an admin view over guest_shop_buyers or over
--       this table. If one is ever added it must be security_invoker=on with an
--       explicit public.is_admin() SELECT policy and must never expose
--       password_hash or token_hash (20260920 section 2b).
--    c) ON DELETE CASCADE on buyer_id is intentional: if a credential group is
--       ever deleted, its outstanding reset links must die with it rather than
--       survive as orphans pointing at nothing.
--    d) created_by_admin_id is deliberately NOT a foreign key. Audit-style
--       attribution columns must survive the deletion of the admin account they
--       name; a cascading FK would erase the evidence trail exactly when
--       someone asks "who issued this link?".
--    e) Run 20260922_verify_guest_shop_access_resets.sql afterwards. Every row
--       must be PASS before GUEST_SHOP_BUYER_CREDENTIAL_ENABLED is turned on.
-- ---------------------------------------------------------------------------
