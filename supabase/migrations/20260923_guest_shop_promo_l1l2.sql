-- Guest Shop Promo L1+L2: guest-side quantity/tiered pricing (L1) and guest
-- discount codes (L2), settled in cash at credit parity (1 credit = 1 CNY).
-- Codex does not execute this file. Run it in the target Supabase SQL editor
-- after 20260922_guest_shop_access_resets.sql, then run
-- 20260923_verify_guest_shop_promo_l1l2.sql and require every row to be PASS.
--
-- WHY L1 AND L2 SHARE ONE FILE
--   fn_guest_shop_create_order must gain two new parameters. PostgreSQL cannot
--   change a function signature with CREATE OR REPLACE: replacing it would leave
--   TWO overloads, and PostgREST then fails every RPC call with "could not choose
--   the best candidate function". The only safe path is DROP + CREATE, which
--   briefly removes the function. Splitting L1 and L2 into two files would pay
--   that DROP window twice for no benefit, so both ship as one atomic migration.
--
-- WHAT THIS FILE DOES
--   §1 guest_shop_orders gains list/discount/fee columns and the amount CHECK
--      becomes total = unit*quantity + fee (with an anti-zero-purchase floor).
--   §2 guest_shop_inventory_reservations allows N rows per order.
--   §3 new append-only ledger guest_shop_discount_redemptions.
--   §3.1 discount_codes gains the guest whitelist and the per-code guest quota.
--   §3.2 new guest_shop_promo_budget: the per-site daily让利 ceiling.
--   §3.3 new guest_shop_promo_breaker: the manual/auto emergency stop.
--   §3.4 new guest_shop_promo_breaker_events: rolling-window counter + audit.
--   §3.5 the gate / budget-return / breaker-control / status functions.
--   §4 guest_shop_resolve_credit_unit_amount stops hard-locking quantity to 1,
--      which is what turns on tiered pricing and flash sales for guests.
--   §5 two new discount functions (read-only evaluate + atomic reserve).
--   §6 fn_guest_shop_create_order: 13 -> 15 parameters, multi-row inventory.
--   §7 confirm/claim/mark/release become multi-reservation aggregate aware, plus
--      a new read-only fn_guest_shop_list_delivered_content.
--   §8 privileges. §9 operator notes.
--
-- WHAT THIS FILE DELIBERATELY DOES NOT DO
--   * It enables nothing. GUEST_SHOP_DISCOUNT_ENABLED and GUEST_SHOP_MAX_QUANTITY
--     are application switches that default to off/1, and no guest product or SKU
--     is touched here. Deploying and applying this file leaves production
--     behaviour byte-identical until an operator raises those switches.
--   * It never stores a plaintext email, a claim secret, a query password or a
--     card content value. The ledger stores only contact_hash / ip_hash digests
--     that already exist on guest_shop_orders.
--   * It does not relax any existing guard. Every new path is additive and the
--     new amount CHECK is strictly stronger than the one it replaces (see §1).
--
-- RED LINE: NO CLIENT-SIDE MONEY, NO ZERO-PAYMENT
--   All pricing and all discount arithmetic live in these functions. The HTTP
--   layer only passes product/sku/quantity/code and then persists whatever this
--   file returns. A guest can never zero-pay: the discount engine is always
--   called with allow_zero_total = false, the net amount must stay > 0, and §1
--   adds a database CHECK so a fully-offset order is a hard write error rather
--   than a code path nobody tested.

-- ---------------------------------------------------------------------------
-- §1. guest_shop_orders: list price, discount, and payment fee columns.
--
--    Money vocabulary used from here on:
--      list_unit_amount  credit unit price BEFORE any discount (tier/flash
--                        already applied, because those are the catalogue price)
--      list_amount       list_unit_amount * quantity          (derived, not stored)
--      discount_amount   list_amount - net_amount
--      unit_amount       net unit price AFTER discount = net_amount / quantity
--      total_amount      what the buyer actually pays = unit*quantity + fee
--      payment_fee_amount payment-channel surcharge (1% by default), which used
--                        to be baked into unit_amount and is now its own column
--                        so the discount lines can be shown honestly.
--
--    BACKWARD COMPATIBILITY OF THE CHECK SWAP
--    Old rows have quantity = 1 and unit_amount = total_amount = credit + fee,
--    and the new columns default to 0/NULL. For those rows the new expression is
--    total = unit*1 + 0, which is exactly the stored equality, so validation of
--    the new constraint against existing rows passes without a backfill. Note the
--    unit_amount SEMANTICS change for new rows only (fee moves out of unit_amount
--    into payment_fee_amount); old rows keep their old meaning and still satisfy
--    both constraints. The webhook anchor is guest_shop_payment_orders
--    .expected_amount, not unit_amount, so payment verification is unaffected.
-- ---------------------------------------------------------------------------
ALTER TABLE public.guest_shop_orders
    ADD COLUMN IF NOT EXISTS list_unit_amount NUMERIC(14,2),
    ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS discount_code VARCHAR(64),
    ADD COLUMN IF NOT EXISTS discount_snapshot JSONB,
    ADD COLUMN IF NOT EXISTS payment_fee_amount NUMERIC(14,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.guest_shop_orders.list_unit_amount IS
    'Credit unit price before discount (tier/flash applied). NULL on legacy rows created before L1/L2.';
COMMENT ON COLUMN public.guest_shop_orders.discount_amount IS
    'list_amount - net_amount. Always >= 0 and always < list_amount, so a guest order can never be fully offset.';
COMMENT ON COLUMN public.guest_shop_orders.discount_code IS
    'Upper-cased discount code actually applied. NULL when no code was used.';
COMMENT ON COLUMN public.guest_shop_orders.discount_snapshot IS
    'Immutable audit of the applied code: type, value, version, base amounts, floor check. No PII, no plaintext email.';
COMMENT ON COLUMN public.guest_shop_orders.payment_fee_amount IS
    'Payment-channel surcharge, previously folded into unit_amount. total_amount = unit_amount*quantity + payment_fee_amount.';

ALTER TABLE public.guest_shop_orders
    DROP CONSTRAINT IF EXISTS guest_shop_orders_amount_check;

-- The fee bound carries a +0.01 slack because the surcharge is rounded UP to the
-- cent; without the slack a 0.01 base with a 1% rate would compute fee 0.01 and
-- violate a strict 10% bound. It is still a hard cap against an absurd fee.
--
-- discount_amount <= 50% of list is the database-level floor price, and it is
-- the ONLY percent bound this batch ships. There is deliberately no env percent
-- knob: an operator cannot widen it, and cannot believe they tightened it while
-- the write still succeeds at 50%. Per-code tightening is done with
-- discount_codes.guest_max_uses / guest_max_total_discount, per-site tightening
-- with guest_shop_promo_budget.daily_budget_cny; both can only reduce the
-- discount below this ceiling. Raising 0.5 itself is a migration plus a re-run
-- of 20260923_verify_guest_shop_promo_l1l2.sql, never a config change.
ALTER TABLE public.guest_shop_orders
    ADD CONSTRAINT guest_shop_orders_amount_check CHECK (
        unit_amount > 0
        AND total_amount > 0
        AND payment_fee_amount >= 0
        AND discount_amount >= 0
        AND (list_unit_amount IS NULL OR list_unit_amount > 0)
        AND (discount_amount = 0 OR list_unit_amount IS NOT NULL)
        AND (
            list_unit_amount IS NULL
            OR (
                discount_amount < ROUND(list_unit_amount * quantity, 2)
                AND discount_amount <= ROUND(list_unit_amount * quantity * 0.5, 2)
            )
        )
        AND payment_fee_amount <= ROUND(unit_amount * quantity * 0.1, 2) + 0.01
        AND total_amount = unit_amount * quantity + payment_fee_amount
    );

-- L1 hard quantity ceiling. The application clamp is
-- min(GUEST_SHOP_MAX_QUANTITY, guest_max_quantity, max_purchase_quantity, 5);
-- this CHECK is the outer bound that survives a mis-set environment variable.
-- Existing rows are all quantity = 1, so validation passes. Raising the ceiling
-- later is a deliberate migration, never an env change.
ALTER TABLE public.guest_shop_orders
    DROP CONSTRAINT IF EXISTS guest_shop_orders_quantity_check;
ALTER TABLE public.guest_shop_orders
    ADD CONSTRAINT guest_shop_orders_quantity_check
    CHECK (quantity >= 1 AND quantity <= 5);

ALTER TABLE public.guest_shop_orders
    DROP CONSTRAINT IF EXISTS guest_shop_orders_discount_code_check;
ALTER TABLE public.guest_shop_orders
    ADD CONSTRAINT guest_shop_orders_discount_code_check
    CHECK (discount_code IS NULL OR discount_code ~ '^[A-Z0-9][A-Z0-9_-]{0,49}$');

-- ---------------------------------------------------------------------------
-- §2. guest_shop_inventory_reservations: N rows per order.
--
--    P0 sold exactly one row per order and encoded that as a column-level UNIQUE
--    on order_id. L1 sells up to 5 rows, so the uniqueness has to move to the
--    pair (order_id, inventory_id): one order may still never hold the SAME
--    physical card twice. The existing partial unique index
--    ux_guest_shop_inventory_active_reservation on (inventory_id) WHERE status IN
--    ('held','consumed') is untouched and remains the guard that stops two
--    different orders from holding one card.
--
--    The constraint is located through pg_constraint instead of being dropped by
--    a hard-coded name, because an inline column UNIQUE is auto-named and that
--    name is not guaranteed across environments.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    v_con RECORD;
BEGIN
    FOR v_con IN
        SELECT c.conname
        FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
        WHERE c.conrelid = to_regclass('public.guest_shop_inventory_reservations')
          AND c.contype = 'u'
          AND array_length(c.conkey, 1) = 1
          AND a.attname = 'order_id'
    LOOP
        EXECUTE format(
            'ALTER TABLE public.guest_shop_inventory_reservations DROP CONSTRAINT %I',
            v_con.conname
        );
    END LOOP;
END;
$$;

ALTER TABLE public.guest_shop_inventory_reservations
    DROP CONSTRAINT IF EXISTS guest_shop_inventory_reservations_order_inventory_uniq;
ALTER TABLE public.guest_shop_inventory_reservations
    ADD CONSTRAINT guest_shop_inventory_reservations_order_inventory_uniq
    UNIQUE (order_id, inventory_id);

-- Claim/fulfilment now walks several rows per order and needs a stable order.
--
-- NOTE ON THE INDEX NAME. 20260913 already created
-- idx_guest_shop_inventory_reservations_order on (order_id) alone. Reusing that
-- name here under CREATE INDEX IF NOT EXISTS would be a SILENT NO-OP: the old
-- single-column index would survive and the intended (order_id, created_at, id)
-- ordering index would never exist, with no error to tell anybody. So the
-- composite gets its own name and the P0 index is left in place, because other
-- queries filter on order_id without an ordering need. At most five rows exist
-- per order, so keeping both costs nothing measurable.
CREATE INDEX IF NOT EXISTS idx_guest_shop_inventory_reservations_order_claim
    ON public.guest_shop_inventory_reservations (order_id, created_at, id);

-- ---------------------------------------------------------------------------
-- §3. guest_shop_discount_redemptions: the guest-side redemption ledger.
--
--    WHY A SEPARATE LEDGER INSTEAD OF REUSING shop_orders
--    The logged-in engine counts per-user redemptions with
--    "SELECT COUNT(*) FROM shop_orders WHERE user_id = $1 AND discount_code = $2".
--    A guest has no shop_orders row, so that count is always 0 and
--    max_uses_per_user would be unenforced for guests. Rather than teach the
--    shared engine about guest tables (which would put guest identity into the
--    hottest logged-in code path), guests get their own append-only ledger.
--
--    COUNTED BY contact_hash, NEVER BY buyer_id
--    One email can own up to 5 credential groups (20260920 §6.4). Keying a limit
--    on buyer_id would let a buyer multiply their allowance by rotating groups.
--    contact_hash is the identity, so it is the counting key. buyer_id is stored
--    only for audit and is ON DELETE SET NULL because a deleted credential group
--    must not erase the evidence that a code was redeemed.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.guest_shop_discount_redemptions (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id             UUID NOT NULL
        REFERENCES public.guest_shop_orders(id) ON DELETE CASCADE,
    code                 VARCHAR(64) NOT NULL,
    discount_code_id     UUID,
    site                 VARCHAR(10) NOT NULL,
    product_id           UUID NOT NULL REFERENCES public.shop_products(id) ON DELETE RESTRICT,
    sku_id               UUID,
    quantity             INTEGER NOT NULL DEFAULT 1,
    list_amount          NUMERIC(14,2) NOT NULL,
    discount_amount      NUMERIC(14,2) NOT NULL,
    net_amount           NUMERIC(14,2) NOT NULL,
    discount_version     INTEGER NOT NULL DEFAULT 1,
    buyer_contact_hash   TEXT NOT NULL,
    buyer_id             UUID REFERENCES public.guest_shop_buyers(id) ON DELETE SET NULL,
    request_ip_hash      TEXT,
    request_device_hash  TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    -- Budget/usage return bookkeeping (C-C5 / C-D6). A redemption is written
    -- once and returned at most once: returned_at is the idempotency claim for
    -- fn_guest_shop_return_discount_reservation, so an expiry sweep that runs
    -- twice, or an expiry followed by a manual refund, can never hand the same
    -- marketing budget back two times.
    returned_at          TIMESTAMPTZ,
    return_reason        VARCHAR(120),
    CONSTRAINT guest_shop_discount_redemptions_return_check
        CHECK ((returned_at IS NULL) = (return_reason IS NULL)),
    CONSTRAINT guest_shop_discount_redemptions_site_check CHECK (site IN ('cn','intl')),
    CONSTRAINT guest_shop_discount_redemptions_code_check
        CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{0,49}$'),
    CONSTRAINT guest_shop_discount_redemptions_hash_check
        CHECK (buyer_contact_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT guest_shop_discount_redemptions_qty_check
        CHECK (quantity >= 1 AND quantity <= 5),
    CONSTRAINT guest_shop_discount_redemptions_amount_check CHECK (
        list_amount > 0
        AND discount_amount > 0
        AND net_amount > 0
        -- Same two invariants as the order CHECK, restated here so a bad ledger
        -- row cannot be written even if the order row was written by an older
        -- code path.
        AND discount_amount < list_amount
        AND discount_amount <= ROUND(list_amount * 0.5, 2)
        AND net_amount = ROUND(list_amount - discount_amount, 2)
    ),
    CONSTRAINT guest_shop_discount_redemptions_ip_check
        CHECK (request_ip_hash IS NULL OR char_length(request_ip_hash) <= 128),
    -- One redemption per order per code. An order is created once (idempotency
    -- key) so this also caps a retried create at a single ledger row.
    CONSTRAINT guest_shop_discount_redemptions_order_code_uniq UNIQUE (order_id, code)
);

COMMENT ON TABLE public.guest_shop_discount_redemptions IS
    'Append-only ledger of guest discount-code redemptions. Per-identity limits count buyer_contact_hash across credential groups, never buyer_id. Service-role only; no browser policy exists.';
COMMENT ON COLUMN public.guest_shop_discount_redemptions.buyer_contact_hash IS
    'HMAC-SHA256 contact digest copied from the order. This is the rate-limit identity.';
COMMENT ON COLUMN public.guest_shop_discount_redemptions.buyer_id IS
    'Credential group for audit only. ON DELETE SET NULL so deleting a group never erases redemption evidence.';
COMMENT ON COLUMN public.guest_shop_discount_redemptions.discount_code_id IS
    'discount_codes.id at redemption time. Not a foreign key: a deleted marketing code must not cascade away the ledger.';
COMMENT ON COLUMN public.guest_shop_discount_redemptions.returned_at IS
    'Set once when the order died unpaid or was refunded and the reserved usage/budget was handed back. NULL while the redemption still stands. This column is the idempotency claim for the return path.';
COMMENT ON COLUMN public.guest_shop_discount_redemptions.return_reason IS
    'Why the redemption was returned (expired / cancelled / refunded / paid_order_partial_stock_loss). Never a secret, never an email.';

-- 24h rate-limit lookups. Both are partial so the indexes stay small once rows
-- age out of the window, and neither stores plaintext.
CREATE INDEX IF NOT EXISTS idx_guest_shop_discount_redemptions_contact_24h
    ON public.guest_shop_discount_redemptions (buyer_contact_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_guest_shop_discount_redemptions_ip_24h
    ON public.guest_shop_discount_redemptions (request_ip_hash, created_at DESC)
    WHERE request_ip_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_guest_shop_discount_redemptions_code
    ON public.guest_shop_discount_redemptions (code, created_at DESC);
-- Return-path lookups are by order, and only un-returned rows are candidates.
CREATE INDEX IF NOT EXISTS idx_guest_shop_discount_redemptions_unreturned
    ON public.guest_shop_discount_redemptions (order_id)
    WHERE returned_at IS NULL;

-- Same reasoning as 20260920 §2b and 20260922 §2: Supabase installs ALTER
-- DEFAULT PRIVILEGES that grant ALL on every new public table to anon and
-- authenticated, so without this REVOKE any anonymous browser could read the
-- ledger through PostgREST. RLS alone is not enough and REVOKE alone is not
-- enough; both are applied. There are deliberately NO browser-facing policies:
-- the ledger is written by fn_guest_shop_reserve_discount and read by the
-- service-role handlers only.
ALTER TABLE public.guest_shop_discount_redemptions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.guest_shop_discount_redemptions FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.guest_shop_discount_redemptions TO service_role;

-- ---------------------------------------------------------------------------
-- §3.1 discount_codes: the guest whitelist and the per-code guest budget.
--
--    WHY THESE COLUMNS EXIST
--    Without them, flipping GUEST_SHOP_DISCOUNT_ENABLED would expose EVERY
--    marketing code in the database to anonymous cash buyers at once - including
--    codes created for a logged-in points campaign, an internal compensation
--    code, or a 90%-off launch code nobody intended to be publicly guessable.
--    Eligibility for the *shared* rules (scope, site, lifecycle, window,
--    max_uses, max_uses_per_user) stays delegated to fn_validate_discount_code_core
--    so marketing keeps ONE place to configure a coupon; what is added here is
--    the guest-specific gate on top of it.
--
--    TWO GATES, BOTH CLOSED BY DEFAULT
--      gate 1  allow_guest = true              (explicit per-code opt-in)
--      gate 2  guest_max_uses > 0              (an explicit guest quota)
--    A code that passes the shared engine but fails either gate is rejected with
--    the SAME generic message as an unknown code, so these columns are not a
--    code-enumeration oracle (plan §11).
--
--    ZERO MEANS CLOSED, NEVER UNLIMITED
--    guest_max_uses = 0 does not mean "unlimited guest uses". It means the code
--    has no guest quota and cannot be used by a guest. This deliberately differs
--    from the legacy max_uses semantics (0 = unlimited) because the guest channel
--    is anonymous: an unlimited anonymous quota is exactly the "损失上限由攻击者
--    决定" outcome plan §22.5.3 forbids.
--
--    guest_max_total_discount = 0 DOES mean "no separate per-code money cap",
--    because a zero money cap would make the code unusable and the per-use quota
--    above already bounds it. The site daily budget (§3.2) still applies.
-- ---------------------------------------------------------------------------
ALTER TABLE public.discount_codes
    ADD COLUMN IF NOT EXISTS allow_guest BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS guest_max_uses INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS guest_used_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS guest_max_total_discount NUMERIC(14,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS guest_discount_total NUMERIC(14,2) NOT NULL DEFAULT 0;

-- One constraint, restated as a single name so the verify script can assert it
-- survived. The two "count <= cap" clauses are what make an over-issued guest
-- quota UNREPRESENTABLE: even a buggy function body cannot commit a row where
-- guest_used_count exceeds guest_max_uses.
ALTER TABLE public.discount_codes
    DROP CONSTRAINT IF EXISTS discount_codes_guest_caps_check;
ALTER TABLE public.discount_codes
    ADD CONSTRAINT discount_codes_guest_caps_check CHECK (
        guest_max_uses >= 0
        AND guest_used_count >= 0
        AND guest_max_total_discount >= 0
        AND guest_discount_total >= 0
        AND (guest_max_uses = 0 OR guest_used_count <= guest_max_uses)
        AND (guest_max_total_discount = 0 OR guest_discount_total <= guest_max_total_discount)
    );

COMMENT ON COLUMN public.discount_codes.allow_guest IS
    'Guest cash channel whitelist. Default false: a code that was never explicitly opened to guests can never be redeemed anonymously, no matter what the shared engine says.';
COMMENT ON COLUMN public.discount_codes.guest_max_uses IS
    'Hard guest quota for this code. 0 = CLOSED (not unlimited). The guest channel is anonymous, so an unlimited quota is never the default.';
COMMENT ON COLUMN public.discount_codes.guest_used_count IS
    'Guest redemptions currently standing. Decremented by fn_guest_shop_return_discount_reservation when an order dies unpaid or is refunded, so an expired order does not permanently consume quota.';
COMMENT ON COLUMN public.discount_codes.guest_max_total_discount IS
    'Per-code ceiling on total guest让利 (CNY). 0 = no separate money cap; the per-use quota and the site daily budget still bound it.';
COMMENT ON COLUMN public.discount_codes.guest_discount_total IS
    'Sum of guest discount_amount currently standing for this code.';

-- ---------------------------------------------------------------------------
-- §3.2 guest_shop_promo_budget: the site-level daily ceiling.
--
--    This is the number that answers "最坏情况我会少赚多少" (plan §22.5.3). It is
--    a single row per site, deducted inside fn_guest_shop_reserve_discount with
--    ONE atomic UPDATE, and the table CHECK below makes over-spend
--    unrepresentable even if a future function edit removes the WHERE guard.
--
--    CLOSED BY DEFAULT, IN BOTH DIRECTIONS
--      enabled = false          -> no guest discount at all for that site
--      daily_budget_cny <= 0    -> no guest discount at all for that site
--    There is no "unlimited daily budget" spelling. An operator who wants an
--    effectively unlimited day writes a large explicit number, which keeps the
--    loss bound a decision instead of an omission.
--
--    DAY BOUNDARY
--    Asia/Shanghai, which has no DST, so the rollover instant never moves. The
--    rollover is performed by the same UPDATE that deducts (it compares
--    budget_date to today and resets spent_cny in the same row version), so
--    there is no window where a stale date makes yesterday's spend count
--    against today, and no cron job to forget.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.guest_shop_promo_budget (
    site              VARCHAR(10) PRIMARY KEY,
    enabled           BOOLEAN NOT NULL DEFAULT false,
    daily_budget_cny  NUMERIC(14,2) NOT NULL DEFAULT 0,
    budget_date       DATE NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Shanghai')::DATE,
    spent_cny         NUMERIC(14,2) NOT NULL DEFAULT 0,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT guest_shop_promo_budget_site_check CHECK (site IN ('cn', 'intl')),
    CONSTRAINT guest_shop_promo_budget_amount_check CHECK (
        daily_budget_cny >= 0
        AND daily_budget_cny <= 99999999
        AND spent_cny >= 0
        AND (daily_budget_cny = 0 OR spent_cny <= daily_budget_cny)
    )
);

COMMENT ON TABLE public.guest_shop_promo_budget IS
    'One row per site: the daily ceiling on total guest discount让利. enabled=false or daily_budget_cny<=0 means the guest promo channel is closed for that site. Deducted atomically by fn_guest_shop_reserve_discount, returned by fn_guest_shop_return_discount_reservation. Service-role only.';

INSERT INTO public.guest_shop_promo_budget (site, enabled, daily_budget_cny)
VALUES ('cn', false, 0), ('intl', false, 0)
ON CONFLICT (site) DO NOTHING;

ALTER TABLE public.guest_shop_promo_budget ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.guest_shop_promo_budget FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.guest_shop_promo_budget TO service_role;

-- ---------------------------------------------------------------------------
-- §3.3 guest_shop_promo_breaker: the emergency stop (plan §12).
--
--    Singleton row. 'open' means EVERY guest discount is refused while原价 guest
--    checkout keeps working, which is the intended degradation: a promo incident
--    must never take the shop down, and stopping the promo must never need a
--    deploy. Recovery is manual only - there is deliberately no half-open state
--    and no automatic re-close, because an attacker who can trip the breaker can
--    otherwise simply wait out a cooldown and resume.
--
--    The thresholds live on the row so an operator can retune them without a
--    migration; the CHECK keeps them inside a sane band so a typo cannot set
--    threshold 0 (trip on the first event, i.e. permanent promo outage) or a
--    window of 0.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.guest_shop_promo_breaker (
    id                       INTEGER PRIMARY KEY,
    state                    VARCHAR(16) NOT NULL DEFAULT 'closed',
    reason                   VARCHAR(160),
    opened_at                TIMESTAMPTZ,
    opened_by                VARCHAR(120),
    closed_at                TIMESTAMPTZ,
    closed_by                VARCHAR(120),
    mismatch_trip_threshold  INTEGER NOT NULL DEFAULT 3,
    identity_trip_threshold  INTEGER NOT NULL DEFAULT 20,
    trip_window_seconds      INTEGER NOT NULL DEFAULT 900,
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT guest_shop_promo_breaker_singleton_check CHECK (id = 1),
    CONSTRAINT guest_shop_promo_breaker_state_check CHECK (state IN ('closed', 'open')),
    -- 'open' must carry an opened_at, 'closed' must not: the pair is the audit
    -- trail, and a row that says open with no timestamp is a corrupted stop.
    CONSTRAINT guest_shop_promo_breaker_state_exclusive_check CHECK (
        (state = 'open' AND opened_at IS NOT NULL AND opened_by IS NOT NULL)
        OR (state = 'closed' AND opened_at IS NULL AND opened_by IS NULL)
    ),
    CONSTRAINT guest_shop_promo_breaker_threshold_check CHECK (
        mismatch_trip_threshold >= 1 AND mismatch_trip_threshold <= 100
        AND identity_trip_threshold >= 1 AND identity_trip_threshold <= 1000
        AND trip_window_seconds >= 60 AND trip_window_seconds <= 86400
    )
);

COMMENT ON TABLE public.guest_shop_promo_breaker IS
    'Singleton guest-promo circuit breaker. open = every guest discount refused (原价 checkout unaffected); recovery is manual via fn_guest_shop_promo_set_breaker. Service-role only.';

INSERT INTO public.guest_shop_promo_breaker (id, state)
VALUES (1, 'closed')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.guest_shop_promo_breaker ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.guest_shop_promo_breaker FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.guest_shop_promo_breaker TO service_role;

-- ---------------------------------------------------------------------------
-- §3.4 guest_shop_promo_breaker_events: the rolling-window counter and audit.
--
--    Append-only. It is BOTH the evidence log and the data source for the
--    automatic trip, so the trip decision is a plain COUNT over an indexed
--    window rather than an in-memory counter that a container restart would
--    silently reset (which is exactly how an attacker survives a redeploy).
--
--    NO SECRETS, NO PII: the detail CHECK rejects the keys that could carry an
--    email, a contact hash, a claim secret, a password hash or card content, so
--    a future caller cannot turn the audit log into a leak.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.guest_shop_promo_breaker_events (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    kind         VARCHAR(32) NOT NULL,
    site         VARCHAR(10),
    detail       JSONB NOT NULL DEFAULT '{}'::JSONB,
    occurred_at  TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT guest_shop_promo_breaker_events_kind_check CHECK (
        kind IN ('amount_mismatch', 'identity_limit_hit', 'budget_exhausted',
                 'code_exhausted', 'manual_open', 'manual_close', 'auto_open')
    ),
    CONSTRAINT guest_shop_promo_breaker_events_site_check
        CHECK (site IS NULL OR site IN ('cn', 'intl')),
    CONSTRAINT guest_shop_promo_breaker_events_detail_shape_check
        CHECK (jsonb_typeof(detail) = 'object'),
    CONSTRAINT guest_shop_promo_breaker_events_detail_no_secrets_check CHECK (
        NOT jsonb_exists(detail, 'email')
        AND NOT jsonb_exists(detail, 'buyer_contact_hash')
        AND NOT jsonb_exists(detail, 'contact_hash')
        AND NOT jsonb_exists(detail, 'claim_secret_hash')
        AND NOT jsonb_exists(detail, 'password_hash')
        AND NOT jsonb_exists(detail, 'buyer_password_hash')
        AND NOT jsonb_exists(detail, 'content')
        AND NOT jsonb_exists(detail, 'card_content')
        AND NOT jsonb_exists(detail, 'access_token')
        AND NOT jsonb_exists(detail, 'authorization')
    )
);

COMMENT ON TABLE public.guest_shop_promo_breaker_events IS
    'Append-only guest-promo event log. Feeds the rolling-window automatic breaker trip and doubles as the audit trail. 7-day retention is enforced by fn_guest_shop_promo_record_event. Service-role only.';

CREATE INDEX IF NOT EXISTS idx_guest_shop_promo_breaker_events_window
    ON public.guest_shop_promo_breaker_events (kind, occurred_at DESC);

ALTER TABLE public.guest_shop_promo_breaker_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.guest_shop_promo_breaker_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.guest_shop_promo_breaker_events TO service_role;

-- ---------------------------------------------------------------------------
-- §3.5 Promo gate, budget return, breaker control and status.
--
--    guest_shop_promo_gate is the single read-only answer to "may this site hand
--    out a guest discount right now, and is there room for this amount". Both
--    evaluate() and reserve() call it, so the two can never disagree about what
--    "halted" means. It writes nothing: the authoritative deduction is the
--    atomic UPDATE in reserve().
--
--    fn_guest_shop_return_discount_reservation is the C-C5 / C-D6 return path.
--    It is idempotent by construction (it claims the ledger row with
--    returned_at IS NULL) so an expiry sweep, a manual refund and a retried
--    worker pass can each call it without handing the same quota back twice.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guest_shop_promo_gate(
    p_site TEXT,
    p_discount_amount NUMERIC DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
-- VOLATILE because it calls guest_shop_require_service_role(), which is
-- declared volatile. It still performs no write.
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_site TEXT := public.guest_shop_normalize_site(p_site);
    v_amount NUMERIC(14,2);
    v_today DATE := (now() AT TIME ZONE 'Asia/Shanghai')::DATE;
    v_state TEXT;
    v_enabled BOOLEAN;
    v_daily NUMERIC(14,2);
    v_spent NUMERIC(14,2);
BEGIN
    PERFORM public.guest_shop_require_service_role();

    IF v_site NOT IN ('cn', 'intl') THEN
        RETURN jsonb_build_object('allowed', false, 'code', 'guest_invalid_site', 'message', '站点参数无效');
    END IF;

    -- An amount the database could never store is rejected rather than clamped:
    -- NaN / infinity must not be able to slip past the headroom comparison.
    IF p_discount_amount IS NOT NULL THEN
        IF LOWER(p_discount_amount::TEXT) IN ('nan', 'infinity', '-infinity')
           OR p_discount_amount < 0
           OR p_discount_amount > 99999999 THEN
            RETURN jsonb_build_object('allowed', false, 'code', 'guest_discount_amount_invalid', 'message', '优惠金额无效');
        END IF;
        v_amount := ROUND(p_discount_amount, 2);
    ELSE
        v_amount := 0;
    END IF;

    SELECT b.state INTO v_state
    FROM public.guest_shop_promo_breaker b
    WHERE b.id = 1;
    -- A missing breaker row means the schema was applied partially: fail closed.
    IF NOT FOUND OR COALESCE(v_state, 'closed') <> 'closed' THEN
        RETURN jsonb_build_object('allowed', false, 'code', 'guest_promo_halted', 'message', '优惠活动已暂停');
    END IF;

    SELECT b.enabled, b.daily_budget_cny,
           CASE WHEN b.budget_date = v_today THEN COALESCE(b.spent_cny, 0) ELSE 0 END
    INTO v_enabled, v_daily, v_spent
    FROM public.guest_shop_promo_budget b
    WHERE b.site = v_site;

    IF NOT FOUND OR COALESCE(v_enabled, false) IS NOT TRUE OR COALESCE(v_daily, 0) <= 0 THEN
        RETURN jsonb_build_object('allowed', false, 'code', 'guest_promo_budget_closed', 'message', '优惠活动未开放');
    END IF;
    IF v_spent + v_amount > v_daily THEN
        RETURN jsonb_build_object('allowed', false, 'code', 'guest_promo_budget_exhausted', 'message', '今日优惠额度已用完');
    END IF;

    RETURN jsonb_build_object(
        'allowed', true,
        'code', 'ok',
        'message', 'ok',
        'data', jsonb_build_object(
            'site', v_site,
            'daily_budget_cny', v_daily,
            'spent_cny', v_spent,
            'remaining_cny', ROUND(v_daily - v_spent, 2),
            'budget_date', v_today
        )
    );
END;
$$;

COMMENT ON FUNCTION public.guest_shop_promo_gate(TEXT, NUMERIC) IS
    'Read-only guest-promo gate: circuit breaker plus today''s remaining site budget for an optional discount amount. Returns {allowed,code,message,data}. Never writes; the authoritative deduction is fn_guest_shop_reserve_discount. service_role only.';

CREATE OR REPLACE FUNCTION public.fn_guest_shop_return_discount_reservation(
    p_order_id UUID,
    p_reason TEXT DEFAULT 'order_expired'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_code TEXT;
    v_discount_amount NUMERIC(14,2);
    v_site VARCHAR(10);
    v_reason TEXT := LEFT(COALESCE(NULLIF(BTRIM(p_reason), ''), 'order_expired'), 120);
    v_now TIMESTAMPTZ := clock_timestamp();
    v_today DATE := (now() AT TIME ZONE 'Asia/Shanghai')::DATE;
BEGIN
    PERFORM public.guest_shop_require_service_role();
    IF p_order_id IS NULL THEN
        RAISE EXCEPTION 'guest_order_required';
    END IF;

    -- Idempotency claim. Only the caller that flips returned_at from NULL to a
    -- timestamp proceeds; every later call finds no row and returns false, so a
    -- double sweep cannot decrement used_count or the daily budget twice.
    UPDATE public.guest_shop_discount_redemptions
    SET returned_at = v_now,
        return_reason = v_reason
    WHERE order_id = p_order_id
      AND returned_at IS NULL
    RETURNING code, discount_amount, site
    INTO v_code, v_discount_amount, v_site;

    IF NOT FOUND THEN
        RETURN false;
    END IF;

    -- Give back the shared counter and both guest counters. GREATEST(0, ...) is
    -- a floor, not a licence: the CHECK in §3.1 already forbids a negative or
    -- over-cap value, and this function only ever subtracts what §5 added.
    UPDATE public.discount_codes AS d
    SET used_count = GREATEST(0, COALESCE(d.used_count, 0) - 1),
        guest_used_count = GREATEST(0, COALESCE(d.guest_used_count, 0) - 1),
        guest_discount_total = GREATEST(0, COALESCE(d.guest_discount_total, 0) - v_discount_amount)
    WHERE d.code = v_code;

    -- Return the money to the day it was taken from. If the day has rolled over
    -- the spend is no longer on today's row, and moving it would corrupt today's
    -- headroom, so nothing is deducted. The ledger row keeps the evidence.
    UPDATE public.guest_shop_promo_budget AS b
    SET spent_cny = GREATEST(0, COALESCE(b.spent_cny, 0) - v_discount_amount),
        updated_at = v_now
    WHERE b.site = v_site
      AND b.budget_date = v_today;

    RETURN true;
END;
$$;

COMMENT ON FUNCTION public.fn_guest_shop_return_discount_reservation(UUID, TEXT) IS
    'Idempotently returns the usage counters and the daily budget reserved by one guest order''s discount code. Call on expiry, cancellation and refund. Returns true only for the call that actually claimed the ledger row. service_role only.';

CREATE OR REPLACE FUNCTION public.fn_guest_shop_promo_record_event(
    p_kind TEXT,
    p_site TEXT DEFAULT NULL,
    p_detail JSONB DEFAULT '{}'::JSONB
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_kind TEXT := LOWER(BTRIM(COALESCE(p_kind, '')));
    v_site TEXT := CASE
                       WHEN NULLIF(BTRIM(COALESCE(p_site, '')), '') IS NULL THEN NULL
                       ELSE public.guest_shop_normalize_site(p_site)
                   END;
    v_detail JSONB := COALESCE(p_detail, '{}'::JSONB);
    v_state TEXT;
    v_window INTEGER;
    v_threshold INTEGER;
    v_count INTEGER := 0;
BEGIN
    PERFORM public.guest_shop_require_service_role();

    IF v_kind NOT IN ('amount_mismatch', 'identity_limit_hit', 'budget_exhausted',
                      'code_exhausted', 'manual_open', 'manual_close', 'auto_open') THEN
        RAISE EXCEPTION 'guest_promo_event_kind_invalid';
    END IF;
    IF jsonb_typeof(v_detail) <> 'object' THEN
        RAISE EXCEPTION 'guest_promo_event_detail_invalid';
    END IF;
    IF v_site IS NOT NULL AND v_site NOT IN ('cn', 'intl') THEN
        RAISE EXCEPTION 'guest_invalid_site';
    END IF;

    INSERT INTO public.guest_shop_promo_breaker_events (kind, site, detail)
    VALUES (v_kind, v_site, v_detail);

    -- Retention. Indexed by occurred_at through the (kind, occurred_at) index
    -- scan below; in steady state this deletes nothing.
    DELETE FROM public.guest_shop_promo_breaker_events
    WHERE occurred_at < clock_timestamp() - INTERVAL '7 days';

    SELECT b.state, b.trip_window_seconds,
           CASE
               WHEN v_kind = 'amount_mismatch' THEN b.mismatch_trip_threshold
               ELSE b.identity_trip_threshold
           END
    INTO v_state, v_window, v_threshold
    FROM public.guest_shop_promo_breaker b
    WHERE b.id = 1;

    -- Automatic trip. Only the two high-signal kinds trip it: an amount mismatch
    -- means somebody is trying to pay less than the order says, and a burst of
    -- identity-limit hits means a script is rotating credentials. A budget or
    -- quota exhaustion is a NORMAL business outcome and must not stop the promo.
    IF v_kind IN ('amount_mismatch', 'identity_limit_hit')
       AND COALESCE(v_state, 'closed') = 'closed' THEN
        SELECT COUNT(*)::INTEGER INTO v_count
        FROM public.guest_shop_promo_breaker_events e
        WHERE e.kind = v_kind
          AND e.occurred_at >= clock_timestamp() - make_interval(secs => GREATEST(60, COALESCE(v_window, 900)));

        IF v_count >= GREATEST(1, COALESCE(v_threshold, 3)) THEN
            UPDATE public.guest_shop_promo_breaker
            SET state = 'open',
                reason = LEFT('auto:' || v_kind || ':' || v_count, 160),
                opened_at = clock_timestamp(),
                opened_by = 'auto',
                closed_at = NULL,
                closed_by = NULL,
                updated_at = clock_timestamp()
            WHERE id = 1
              AND state = 'closed';
            IF FOUND THEN
                INSERT INTO public.guest_shop_promo_breaker_events (kind, site, detail)
                VALUES ('auto_open', v_site,
                        jsonb_build_object('trigger_kind', v_kind, 'window_count', v_count));
            END IF;
        END IF;
    END IF;

    SELECT b.state INTO v_state
    FROM public.guest_shop_promo_breaker b
    WHERE b.id = 1;

    RETURN COALESCE(v_state, 'closed');
END;
$$;

COMMENT ON FUNCTION public.fn_guest_shop_promo_record_event(TEXT, TEXT, JSONB) IS
    'Appends a guest-promo event and, for amount_mismatch / identity_limit_hit bursts inside the rolling window, opens the breaker. Returns the resulting breaker state. Recovery stays manual. service_role only.';

CREATE OR REPLACE FUNCTION public.fn_guest_shop_promo_set_breaker(
    p_state TEXT,
    p_reason TEXT DEFAULT NULL,
    p_actor TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_state TEXT := LOWER(BTRIM(COALESCE(p_state, '')));
    v_reason TEXT := LEFT(BTRIM(COALESCE(p_reason, '')), 160);
    v_actor TEXT := LEFT(BTRIM(COALESCE(p_actor, '')), 120);
    v_previous TEXT;
BEGIN
    PERFORM public.guest_shop_require_service_role();

    IF v_state NOT IN ('open', 'closed') THEN
        RAISE EXCEPTION 'guest_promo_breaker_state_invalid';
    END IF;
    -- An anonymous stop or restart is unauditable, and the table CHECK requires
    -- opened_by whenever state = open. Refuse instead of writing 'unknown'.
    IF char_length(v_actor) < 2 THEN
        RAISE EXCEPTION 'guest_promo_breaker_actor_required';
    END IF;
    IF v_state = 'open' AND char_length(v_reason) < 4 THEN
        RAISE EXCEPTION 'guest_promo_breaker_reason_required';
    END IF;

    SELECT b.state INTO v_previous
    FROM public.guest_shop_promo_breaker b
    WHERE b.id = 1
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'guest_promo_breaker_missing';
    END IF;

    IF v_state = 'open' THEN
        UPDATE public.guest_shop_promo_breaker
        SET state = 'open',
            reason = v_reason,
            opened_at = clock_timestamp(),
            opened_by = v_actor,
            closed_at = NULL,
            closed_by = NULL,
            updated_at = clock_timestamp()
        WHERE id = 1
          AND state = 'closed';
    ELSE
        UPDATE public.guest_shop_promo_breaker
        SET state = 'closed',
            reason = NULL,
            opened_at = NULL,
            opened_by = NULL,
            closed_at = clock_timestamp(),
            closed_by = v_actor,
            updated_at = clock_timestamp()
        WHERE id = 1
          AND state = 'open';
    END IF;

    IF FOUND THEN
        PERFORM public.fn_guest_shop_promo_record_event(
            CASE WHEN v_state = 'open' THEN 'manual_open' ELSE 'manual_close' END,
            NULL,
            jsonb_build_object('actor', v_actor, 'reason', v_reason, 'previous_state', v_previous)
        );
    END IF;

    RETURN v_state;
END;
$$;

COMMENT ON FUNCTION public.fn_guest_shop_promo_set_breaker(TEXT, TEXT, TEXT) IS
    'Manual guest-promo emergency stop / restart. Requires an actor, requires a reason when opening, and logs the transition. There is no automatic half-open: closing is always a human decision. service_role only.';

CREATE OR REPLACE FUNCTION public.fn_guest_shop_promo_status()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_today DATE := (now() AT TIME ZONE 'Asia/Shanghai')::DATE;
BEGIN
    PERFORM public.guest_shop_require_service_role();

    -- Operator/readiness view. Aggregates only; contains no email, no hash, no
    -- card content and no secret, and it never writes.
    RETURN jsonb_build_object(
        'breaker', (
            SELECT jsonb_build_object(
                'state', b.state,
                'reason', b.reason,
                'opened_at', b.opened_at,
                'opened_by', b.opened_by,
                'closed_at', b.closed_at,
                'closed_by', b.closed_by,
                'mismatch_trip_threshold', b.mismatch_trip_threshold,
                'identity_trip_threshold', b.identity_trip_threshold,
                'trip_window_seconds', b.trip_window_seconds
            )
            FROM public.guest_shop_promo_breaker b
            WHERE b.id = 1
        ),
        'budget_date', v_today,
        'budgets', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object(
                       'site', b.site,
                       'enabled', b.enabled,
                       'daily_budget_cny', b.daily_budget_cny,
                       'spent_cny', CASE WHEN b.budget_date = v_today THEN COALESCE(b.spent_cny, 0) ELSE 0 END,
                       'remaining_cny', CASE
                                            WHEN b.budget_date = v_today
                                                THEN ROUND(GREATEST(0, b.daily_budget_cny - COALESCE(b.spent_cny, 0)), 2)
                                            ELSE b.daily_budget_cny
                                        END,
                       'stale_date', b.budget_date IS DISTINCT FROM v_today
                   ) ORDER BY b.site), '[]'::jsonb)
            FROM public.guest_shop_promo_budget b
        ),
        'guest_enabled_codes', (
            SELECT COUNT(*) FROM public.discount_codes d
            WHERE COALESCE(d.allow_guest, false)
              AND COALESCE(d.guest_max_uses, 0) > 0
        ),
        'redemptions_24h', (
            SELECT COUNT(*) FROM public.guest_shop_discount_redemptions r
            WHERE r.created_at >= clock_timestamp() - INTERVAL '24 hours'
        ),
        'redemptions_discount_24h', (
            SELECT COALESCE(SUM(r.discount_amount), 0) FROM public.guest_shop_discount_redemptions r
            WHERE r.created_at >= clock_timestamp() - INTERVAL '24 hours'
              AND r.returned_at IS NULL
        ),
        'events_24h', (
            SELECT COALESCE(jsonb_object_agg(e.kind, e.n), '{}'::jsonb)
            FROM (
                SELECT e.kind, COUNT(*) AS n
                FROM public.guest_shop_promo_breaker_events e
                WHERE e.occurred_at >= clock_timestamp() - INTERVAL '24 hours'
                GROUP BY e.kind
            ) e
        )
    );
END;
$$;

COMMENT ON FUNCTION public.fn_guest_shop_promo_status() IS
    'Read-only operator/readiness snapshot of the guest promo channel: breaker state, per-site budget headroom, number of guest-enabled codes and 24h aggregates. No PII, no secrets, no writes. service_role only.';

-- ---------------------------------------------------------------------------
-- §4. guest_shop_resolve_credit_unit_amount: allow quantity > 1.
--
--    Same identity arguments, so this is a plain CREATE OR REPLACE with no DROP
--    and no overload risk. The function returns a UNIT price, not a line total:
--    the caller multiplies by quantity. Flash sale wins over tier rules exactly
--    as it does for logged-in buyers (LEAST of base and flash price, else the
--    cheapest satisfied tier), which is the "积分与现金等值" parity the guest
--    channel promises.
--
--    This is the ONLY change to the function. The CN/INTL fallback rules from
--    20260916 are preserved verbatim, including the rule that INTL may reuse CN
--    credit points but may never fall back to product list prices or to the
--    leftover guest cash columns.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guest_shop_resolve_credit_unit_amount(
    p_site TEXT,
    p_sku_price_points NUMERIC,
    p_sku_price_points_intl NUMERIC,
    p_sku_is_default BOOLEAN,
    p_sku_quantity_rules JSONB,
    p_sku_quantity_rules_intl JSONB,
    p_product_quantity_rules JSONB,
    p_product_quantity_rules_intl JSONB,
    p_product_flash_sale_price NUMERIC,
    p_product_flash_sale_price_intl NUMERIC,
    p_product_flash_sale_end TIMESTAMP WITH TIME ZONE,
    p_product_flash_sale_end_intl TIMESTAMP WITH TIME ZONE,
    p_quantity INTEGER,
    p_now TIMESTAMP WITH TIME ZONE
)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_site TEXT := LOWER(BTRIM(COALESCE(p_site, '')));
    v_base NUMERIC;
    v_rules JSONB;
    v_flash_price NUMERIC;
    v_flash_end TIMESTAMP WITH TIME ZONE;
    v_now TIMESTAMP WITH TIME ZONE := COALESCE(p_now, clock_timestamp());
    v_rule JSONB;
    v_rule_qty INTEGER;
    v_rule_price NUMERIC;
    v_result NUMERIC(14,2);
    v_cn_rules JSONB;
    v_intl_rules JSONB;
    v_has_intl_flash BOOLEAN;
BEGIN
    IF v_site NOT IN ('cn', 'intl') THEN
        RETURN NULL;
    END IF;
    -- L1: quantity is no longer hard-locked to 1. The tier loop below already
    -- selects the cheapest rule whose qty is <= p_quantity, so relaxing this
    -- guard is what turns on tiered pricing for guests; the flash-sale branch
    -- above already ignores quantity. Bounds are checked here and the outer cap
    -- (<= 5) is enforced by the caller and by the guest_shop_orders CHECK.
    IF p_quantity IS NULL OR p_quantity < 1 OR p_quantity > 99 THEN
        RETURN NULL;
    END IF;

    v_cn_rules := COALESCE(
        p_sku_quantity_rules,
        CASE
            WHEN p_sku_is_default IS TRUE THEN p_product_quantity_rules
            ELSE NULL
        END
    );
    v_intl_rules := COALESCE(
        p_sku_quantity_rules_intl,
        CASE
            WHEN p_sku_is_default IS TRUE THEN p_product_quantity_rules_intl
            ELSE NULL
        END
    );

    IF v_site = 'intl' THEN
        -- intl_missing_points_reuse_cn
        v_base := p_sku_price_points_intl;
        IF v_base IS NULL
           OR LOWER(v_base::TEXT) IN ('nan', 'infinity', '-infinity')
           OR v_base <= 0 THEN
            v_base := p_sku_price_points;
        END IF;
        v_rules := COALESCE(v_intl_rules, v_cn_rules);
        v_has_intl_flash := p_product_flash_sale_price_intl IS NOT NULL
            OR p_product_flash_sale_end_intl IS NOT NULL;
        IF v_has_intl_flash THEN
            v_flash_price := p_product_flash_sale_price_intl;
            v_flash_end := p_product_flash_sale_end_intl;
        ELSE
            v_flash_price := p_product_flash_sale_price;
            v_flash_end := p_product_flash_sale_end;
        END IF;
    ELSE
        v_base := p_sku_price_points;
        v_rules := v_cn_rules;
        v_flash_price := p_product_flash_sale_price;
        v_flash_end := p_product_flash_sale_end;
    END IF;

    IF v_base IS NULL
       OR LOWER(v_base::TEXT) IN ('nan', 'infinity', '-infinity')
       OR v_base <= 0 THEN
        RETURN NULL;
    END IF;

    IF v_flash_end IS NOT NULL
       AND v_flash_end > v_now
       AND v_flash_price IS NOT NULL
       AND LOWER(v_flash_price::TEXT) NOT IN ('nan', 'infinity', '-infinity') THEN
        v_base := LEAST(v_base, v_flash_price);
    ELSIF v_rules IS NOT NULL
          AND jsonb_typeof(v_rules) = 'array'
          AND jsonb_array_length(v_rules) > 0 THEN
        FOR v_rule IN SELECT * FROM jsonb_array_elements(v_rules)
        LOOP
            v_rule_qty := NULL;
            v_rule_price := NULL;
            BEGIN
                v_rule_qty := (v_rule->>'qty')::INTEGER;
                v_rule_price := COALESCE(NULLIF(BTRIM(COALESCE(v_rule->>'price', '')), ''), '0')::NUMERIC;
            EXCEPTION WHEN OTHERS THEN
                v_rule_qty := NULL;
                v_rule_price := NULL;
            END;
            IF v_rule_qty IS NOT NULL
               AND v_rule_qty >= 1
               AND p_quantity >= v_rule_qty
               AND v_rule_price IS NOT NULL
               AND LOWER(v_rule_price::TEXT) NOT IN ('nan', 'infinity', '-infinity')
               AND v_rule_price < v_base THEN
                v_base := v_rule_price;
            END IF;
        END LOOP;
    END IF;

    IF v_base IS NULL
       OR LOWER(v_base::TEXT) IN ('nan', 'infinity', '-infinity')
       OR v_base <= 0 THEN
        RETURN NULL;
    END IF;

    v_result := ROUND(v_base, 2);
    IF v_result IS NULL OR v_result <= 0 THEN
        RETURN NULL;
    END IF;
    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.guest_shop_resolve_credit_unit_amount(TEXT, NUMERIC, NUMERIC, BOOLEAN, JSONB, JSONB, JSONB, JSONB, NUMERIC, NUMERIC, TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE, INTEGER, TIMESTAMP WITH TIME ZONE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guest_shop_resolve_credit_unit_amount(TEXT, NUMERIC, NUMERIC, BOOLEAN, JSONB, JSONB, JSONB, JSONB, NUMERIC, NUMERIC, TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE, INTEGER, TIMESTAMP WITH TIME ZONE) TO service_role;

-- ---------------------------------------------------------------------------
-- §5. Guest discount codes.
--
--    TWO FUNCTIONS, ONE AUTHORITY
--    fn_guest_shop_evaluate_discount is READ-ONLY and never raises: it returns
--    {success:false,...} so the preview endpoint can render a friendly message
--    and so a rejected code can never roll back an unrelated statement.
--    fn_guest_shop_reserve_discount is the ONLY authority. It re-runs the same
--    evaluation inside advisory locks, then performs the atomic usage increment
--    and writes the ledger. Evaluate is advice; reserve is the decision. A
--    buyer who previews a code and then submits it 10 minutes later is judged
--    entirely by reserve, so the preview can never be used to smuggle a stale
--    approval into an order.
--
--    ELIGIBILITY IS DELEGATED, ARITHMETIC IS NOT
--    Scope, site, lifecycle, start/expiry, global max_uses and the shared
--    per-user counter all come from the logged-in engine
--    fn_validate_discount_code_core, so a guest can never use a code that a
--    logged-in buyer could not, and marketing keeps ONE place to configure
--    coupons. But the core's discount_amount / final_total are DISCARDED:
--    it prices from shop_product_skus.price_points, while a guest is priced by
--    guest_shop_resolve_credit_unit_amount (which has the INTL->CN credit
--    fallback the core intentionally lacks after 20260604). Trusting the core's
--    numbers would let the two price bases disagree and leak money. The amount
--    is therefore recomputed here from the guest list amount with the same
--    fn_resolve_shop_discount_amount helper the core itself was patched to use
--    in 20260617, which keeps percent / fixed / max_discount_quantity semantics
--    identical between channels.
--
--    p_user_id := p_buyer_id IS AN IDENTITY CONTEXT, NOT A PRICING INPUT
--    The core is SECURITY DEFINER and, for service_role, resolves
--    effective_user = COALESCE(p_user_id, auth.uid()). A guest has no auth.uid(),
--    so p_buyer_id is passed to give the engine a non-null identity; without it
--    the core returns '缺少有效的用户身份'. guest_shop_buyers.id is a UUID from a
--    different table than auth.users, so the core's shop_orders-based counters
--    find no rows and simply do not bind a guest. That is expected and is exactly
--    why §3's ledger enforces the real per-identity limits by contact_hash.
--    Consistent with the Order Access 2.0 rule that buyer_id is access control
--    only, it never influences a price.
--
--    NO ZERO-PAY, EVER
--    fn_resolve_shop_discount_amount is always called with
--    p_allow_zero_total := false, the net amount must stay > 0, and the net must
--    stay >= 50% of list. A marketing code configured with allow_zero_total = true
--    for logged-in points redemption therefore CANNOT zero out a cash guest order;
--    it is rejected instead. This is the single most important difference between
--    the guest channel and the points channel and it is enforced in the database.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_guest_shop_evaluate_discount(
    p_site TEXT,
    p_product_id UUID,
    p_sku_id UUID,
    p_quantity INTEGER,
    p_list_unit_amount NUMERIC,
    p_discount_code TEXT,
    p_buyer_id UUID,
    p_buyer_contact_hash TEXT,
    p_request_ip_hash TEXT DEFAULT NULL,
    p_max_per_contact_24h INTEGER DEFAULT 3,
    p_max_per_ip_24h INTEGER DEFAULT 10
)
RETURNS JSONB
LANGUAGE plpgsql
-- VOLATILE on purpose: it calls fn_validate_discount_code_core, which is
-- VOLATILE, and PostgreSQL forbids a STABLE function from calling one.
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_site TEXT := public.guest_shop_normalize_site(p_site);
    v_code TEXT := NULLIF(UPPER(BTRIM(COALESCE(p_discount_code, ''))), '');
    v_quantity INTEGER := COALESCE(p_quantity, 1);
    v_list_unit NUMERIC(14,2);
    v_list_amount NUMERIC(14,2);
    v_net_unit NUMERIC(14,2);
    v_net_amount NUMERIC(14,2);
    v_discount_amount NUMERIC(14,2);
    v_final_total NUMERIC(12,2);
    v_has_effective BOOLEAN;
    v_floor NUMERIC(14,2);
    v_max_contact INTEGER := LEAST(10, GREATEST(0, COALESCE(p_max_per_contact_24h, 3)));
    v_max_ip INTEGER := LEAST(50, GREATEST(0, COALESCE(p_max_per_ip_24h, 10)));
    v_core JSONB;
    v_record RECORD;
    v_contact_uses INTEGER := 0;
    v_ip_uses INTEGER := 0;
    v_gate JSONB;
BEGIN
    PERFORM public.guest_shop_require_service_role();

    IF v_site NOT IN ('cn', 'intl') THEN
        RETURN jsonb_build_object('success', false, 'code', 'guest_invalid_site', 'message', '站点参数无效');
    END IF;

    -- Site-level promo gate FIRST (breaker + daily budget), before any code
    -- lookup. Two reasons: an open breaker must not cost a discount_codes scan
    -- per request, and the answer must not depend on which code was typed, so
    -- this branch leaks nothing about code existence.
    v_gate := public.guest_shop_promo_gate(v_site, NULL);
    IF COALESCE((v_gate ->> 'allowed')::BOOLEAN, false) IS NOT TRUE THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', COALESCE(NULLIF(BTRIM(v_gate ->> 'code'), ''), 'guest_promo_halted'),
            'message', COALESCE(NULLIF(BTRIM(v_gate ->> 'message'), ''), '优惠活动暂不可用')
        );
    END IF;

    -- Format is checked BEFORE any lookup so an attacker cannot use the
    -- response to enumerate which codes exist: every malformed input produces
    -- the same shape of rejection as a well-formed but unknown code.
    IF v_code IS NULL THEN
        RETURN jsonb_build_object('success', false, 'code', 'guest_discount_code_empty', 'message', '请输入优惠码');
    END IF;
    IF v_code !~ '^[A-Z0-9][A-Z0-9_-]{0,49}$' THEN
        RETURN jsonb_build_object('success', false, 'code', 'guest_invalid_discount_code', 'message', '优惠码格式无效');
    END IF;
    IF p_product_id IS NULL OR p_sku_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'code', 'guest_product_or_sku_required', 'message', '商品或规格缺失');
    END IF;

    -- A discount is a per-identity benefit, so an identity is mandatory. Without
    -- the credential switch there is no buyer_id and no contact_hash, and any
    -- limit would be counted against NULL - i.e. unenforceable. Fail closed
    -- rather than hand out an unattributable discount.
    IF p_buyer_id IS NULL
       OR p_buyer_contact_hash IS NULL
       OR p_buyer_contact_hash !~ '^[0-9a-f]{64}$' THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'guest_discount_identity_required',
            'message', '请先填写邮箱和查询密码，再使用优惠码'
        );
    END IF;

    IF v_quantity < 1 OR v_quantity > 5 THEN
        RETURN jsonb_build_object('success', false, 'code', 'guest_invalid_quantity', 'message', '购买数量超出游客允许范围');
    END IF;

    -- The list unit price is supplied by the caller, which always derives it
    -- from guest_shop_resolve_credit_unit_amount. It is re-validated here so a
    -- buggy or malicious caller cannot anchor a percentage discount to a
    -- fabricated base.
    IF p_list_unit_amount IS NULL
       OR LOWER(p_list_unit_amount::TEXT) IN ('nan', 'infinity', '-infinity')
       OR p_list_unit_amount <= 0
       OR p_list_unit_amount > 999999999999.99 THEN
        RETURN jsonb_build_object('success', false, 'code', 'guest_credit_price_unavailable', 'message', '商品积分价不可用');
    END IF;
    v_list_unit := ROUND(p_list_unit_amount, 2);
    IF v_list_unit <> p_list_unit_amount THEN
        RETURN jsonb_build_object('success', false, 'code', 'guest_credit_price_unavailable', 'message', '商品积分价精度无效');
    END IF;
    v_list_amount := ROUND(v_list_unit * v_quantity, 2);

    -- Eligibility: one shared engine for both channels.
    v_core := public.fn_validate_discount_code_core(
        p_product_id,
        p_buyer_id,
        v_site,
        v_quantity,
        v_code,
        NULL,
        p_sku_id
    );
    IF v_core IS NULL OR COALESCE((v_core ->> 'success')::BOOLEAN, false) IS NOT TRUE THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'guest_discount_code_rejected',
            'message', COALESCE(NULLIF(BTRIM(v_core ->> 'message'), ''), '优惠码不可用')
        );
    END IF;
    -- Defensive: the engine must have judged the same code we are about to
    -- price. If a future patch changed its normalisation, fail closed instead
    -- of discounting against a different row.
    IF COALESCE(v_core #>> '{data,discount_code}', '') <> v_code THEN
        RETURN jsonb_build_object('success', false, 'code', 'guest_discount_code_mismatch', 'message', '优惠码校验结果不一致');
    END IF;

    -- Per-identity 24h limits from the guest ledger. Counted by contact_hash so
    -- rotating credential groups does not reset the allowance.
    SELECT COUNT(*)::INTEGER INTO v_contact_uses
    FROM public.guest_shop_discount_redemptions
    WHERE buyer_contact_hash = p_buyer_contact_hash
      AND created_at >= clock_timestamp() - INTERVAL '24 hours';
    IF v_contact_uses >= v_max_contact THEN
        RETURN jsonb_build_object(
            'success', false, 'code', 'guest_discount_rate_limited',
            'message', '24小时内优惠码使用次数已达上限'
        );
    END IF;

    IF p_request_ip_hash IS NOT NULL AND char_length(p_request_ip_hash) BETWEEN 8 AND 128 THEN
        SELECT COUNT(*)::INTEGER INTO v_ip_uses
        FROM public.guest_shop_discount_redemptions
        WHERE request_ip_hash = p_request_ip_hash
          AND created_at >= clock_timestamp() - INTERVAL '24 hours';
        IF v_ip_uses >= v_max_ip THEN
            RETURN jsonb_build_object(
                'success', false, 'code', 'guest_discount_rate_limited',
                'message', '当前网络24小时内优惠码使用次数过多，请稍后再试'
            );
        END IF;
    END IF;

    SELECT d.id, d.discount_type, d.discount_value,
           COALESCE(d.max_discount_quantity, 0) AS max_discount_quantity,
           COALESCE(d.version_no, 1) AS version_no,
           COALESCE(d.allow_guest, false) AS allow_guest,
           COALESCE(d.guest_max_uses, 0) AS guest_max_uses,
           COALESCE(d.guest_used_count, 0) AS guest_used_count,
           COALESCE(d.guest_max_total_discount, 0) AS guest_max_total_discount,
           COALESCE(d.guest_discount_total, 0) AS guest_discount_total
    INTO v_record
    FROM public.discount_codes d
    WHERE d.code = v_code;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'code', 'guest_discount_code_rejected', 'message', '无效的优惠码');
    END IF;

    -- §3.1 gate 1 + gate 2. Both rejections return the SAME machine code and the
    -- SAME message as an unknown code on purpose: "this code exists but is not
    -- open to guests" is precisely the answer a code-enumeration script is
    -- looking for, and the buyer loses nothing by seeing the generic text.
    IF v_record.allow_guest IS NOT TRUE OR v_record.guest_max_uses <= 0 THEN
        RETURN jsonb_build_object('success', false, 'code', 'guest_discount_code_rejected', 'message', '无效的优惠码');
    END IF;
    IF v_record.guest_used_count >= v_record.guest_max_uses THEN
        RETURN jsonb_build_object(
            'success', false, 'code', 'guest_discount_code_exhausted',
            'message', '所选优惠码额度已被使用完，请重新选择'
        );
    END IF;

    -- Amount, recomputed from the GUEST base. allow_zero_total is hard-wired to
    -- false here: guests pay cash and may never be fully offset.
    SELECT resolved.discount_amount, resolved.final_total, resolved.has_effective_discount
    INTO v_discount_amount, v_final_total, v_has_effective
    FROM public.fn_resolve_shop_discount_amount(
        v_list_amount,
        v_record.discount_type,
        v_record.discount_value,
        false,
        v_list_unit,
        v_quantity,
        v_record.max_discount_quantity
    ) AS resolved;

    IF COALESCE(v_has_effective, false) IS NOT TRUE
       OR v_discount_amount IS NULL
       OR v_discount_amount <= 0 THEN
        RETURN jsonb_build_object(
            'success', false, 'code', 'guest_discount_no_effect',
            'message', '当前商品暂无可优惠金额，无法使用这张优惠码'
        );
    END IF;

    -- Renormalise so the order CHECK (total = unit*quantity + fee) holds EXACTLY.
    -- Splitting a discount across N units can leave a fractional cent; deriving
    -- net_amount from the rounded unit price and then recomputing discount_amount
    -- from the two stored values removes the drift instead of hiding it.
    v_net_amount := ROUND(v_list_amount - v_discount_amount, 2);
    v_net_unit := ROUND(v_net_amount / v_quantity, 2);
    v_net_amount := ROUND(v_net_unit * v_quantity, 2);
    v_discount_amount := ROUND(v_list_amount - v_net_amount, 2);

    v_floor := ROUND(v_list_amount * 0.5, 2);
    IF v_net_amount <= 0 OR v_discount_amount <= 0 THEN
        RETURN jsonb_build_object('success', false, 'code', 'guest_discount_below_floor', 'message', '优惠后金额无效');
    END IF;
    IF v_net_amount < v_floor THEN
        RETURN jsonb_build_object(
            'success', false, 'code', 'guest_discount_below_floor',
            'message', '优惠幅度超出游客通道允许范围'
        );
    END IF;

    -- Per-code money cap (§3.1) and the site daily budget (§3.2), now that the
    -- real discount amount is known. Both are advisory here: the authoritative
    -- deduction is the atomic UPDATE pair in fn_guest_shop_reserve_discount, so
    -- a concurrent buyer draining the last of the budget between this read and
    -- the reserve is caught there, not here.
    IF v_record.guest_max_total_discount > 0
       AND v_record.guest_discount_total + v_discount_amount > v_record.guest_max_total_discount THEN
        RETURN jsonb_build_object(
            'success', false, 'code', 'guest_discount_code_exhausted',
            'message', '所选优惠码额度已被使用完，请重新选择'
        );
    END IF;

    v_gate := public.guest_shop_promo_gate(v_site, v_discount_amount);
    IF COALESCE((v_gate ->> 'allowed')::BOOLEAN, false) IS NOT TRUE THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', COALESCE(NULLIF(BTRIM(v_gate ->> 'code'), ''), 'guest_promo_halted'),
            'message', COALESCE(NULLIF(BTRIM(v_gate ->> 'message'), ''), '优惠活动暂不可用')
        );
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'code', 'ok',
        'message', '优惠码可用',
        'data', jsonb_build_object(
            'discount_code', v_code,
            'discount_type', v_record.discount_type,
            'discount_value', v_record.discount_value,
            'discount_version', v_record.version_no,
            'discount_code_id', v_record.id,
            'max_discount_quantity', v_record.max_discount_quantity,
            'site', v_site,
            'currency', 'CNY',
            'quantity', v_quantity,
            'list_unit_amount', v_list_unit,
            'list_amount', v_list_amount,
            'discount_amount', v_discount_amount,
            'net_unit_amount', v_net_unit,
            'net_amount', v_net_amount,
            'floor_amount', v_floor,
            'guest_max_uses', v_record.guest_max_uses,
            'guest_used_count_before', v_record.guest_used_count,
            'guest_max_total_discount', v_record.guest_max_total_discount,
            'guest_discount_total_before', v_record.guest_discount_total,
            'daily_budget_cny', COALESCE((v_gate #>> '{data,daily_budget_cny}')::NUMERIC, 0),
            'budget_spent_before', COALESCE((v_gate #>> '{data,spent_cny}')::NUMERIC, 0)
        )
    );
END;
$$;

-- Atomic reservation. Called from inside fn_guest_shop_create_order's
-- transaction, so a later failure in that transaction rolls the usage increment
-- and the ledger row back together - there is no window where a code is consumed
-- by an order that does not exist.
CREATE OR REPLACE FUNCTION public.fn_guest_shop_reserve_discount(
    p_site TEXT,
    p_product_id UUID,
    p_sku_id UUID,
    p_quantity INTEGER,
    p_list_unit_amount NUMERIC,
    p_discount_code TEXT,
    p_buyer_id UUID,
    p_buyer_contact_hash TEXT,
    p_request_ip_hash TEXT DEFAULT NULL,
    p_request_device_hash TEXT DEFAULT NULL,
    p_order_id UUID DEFAULT NULL,
    p_max_per_contact_24h INTEGER DEFAULT 3,
    p_max_per_ip_24h INTEGER DEFAULT 10
)
RETURNS TABLE (
    discount_code TEXT,
    discount_type TEXT,
    discount_value NUMERIC,
    list_amount NUMERIC,
    discount_amount NUMERIC,
    net_unit_amount NUMERIC,
    net_amount NUMERIC,
    snapshot JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_site TEXT := public.guest_shop_normalize_site(p_site);
    v_code TEXT := NULLIF(UPPER(BTRIM(COALESCE(p_discount_code, ''))), '');
    v_quantity INTEGER := COALESCE(p_quantity, 1);
    v_max_contact INTEGER := LEAST(10, GREATEST(0, COALESCE(p_max_per_contact_24h, 3)));
    v_max_ip INTEGER := LEAST(50, GREATEST(0, COALESCE(p_max_per_ip_24h, 10)));
    v_eval JSONB;
    v_data JSONB;
    v_list_unit NUMERIC(14,2);
    v_list_amount NUMERIC(14,2);
    v_net_unit NUMERIC(14,2);
    v_net_amount NUMERIC(14,2);
    v_discount_amount NUMERIC(14,2);
    v_code_id UUID;
    v_discount_type TEXT;
    v_discount_value NUMERIC;
    v_max_discount_quantity INTEGER;
    v_version_no INTEGER;
    v_snapshot JSONB;
    v_gate JSONB;
    v_today DATE := (now() AT TIME ZONE 'Asia/Shanghai')::DATE;
BEGIN
    PERFORM public.guest_shop_require_service_role();

    IF p_order_id IS NULL THEN
        RAISE EXCEPTION 'guest_order_required';
    END IF;
    IF p_buyer_contact_hash IS NULL OR p_buyer_contact_hash !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'guest_discount_identity_required'
            USING DETAIL = '请先填写邮箱和查询密码，再使用优惠码';
    END IF;

    -- Fixed lock order (contact, then IP) for every caller, so two concurrent
    -- reservations can never form a cycle. The locks are transaction-scoped and
    -- are what make the 24h counters below non-racy: without them two parallel
    -- orders from one identity could both read 2 uses and both write a third.
    PERFORM pg_advisory_xact_lock(hashtextextended('guest-discount-contact:' || p_buyer_contact_hash, 0));
    IF p_request_ip_hash IS NOT NULL AND char_length(p_request_ip_hash) BETWEEN 8 AND 128 THEN
        PERFORM pg_advisory_xact_lock(hashtextextended('guest-discount-ip:' || p_request_ip_hash, 1));
    END IF;

    v_eval := public.fn_guest_shop_evaluate_discount(
        v_site, p_product_id, p_sku_id, v_quantity, p_list_unit_amount, v_code,
        p_buyer_id, p_buyer_contact_hash, p_request_ip_hash, v_max_contact, v_max_ip
    );
    IF v_eval IS NULL OR COALESCE((v_eval ->> 'success')::BOOLEAN, false) IS NOT TRUE THEN
        -- The exception MESSAGE is the stable machine code and DETAIL is the
        -- human text. The HTTP layer maps the message to a 4xx and shows the
        -- detail; it must never surface SQLSTATE internals.
        RAISE EXCEPTION '%', COALESCE(NULLIF(BTRIM(v_eval ->> 'code'), ''), 'guest_discount_rejected')
            USING DETAIL = COALESCE(NULLIF(BTRIM(v_eval ->> 'message'), ''), '优惠码不可用');
    END IF;

    v_data := v_eval -> 'data';
    v_list_unit := (v_data ->> 'list_unit_amount')::NUMERIC(14,2);
    v_list_amount := (v_data ->> 'list_amount')::NUMERIC(14,2);
    v_discount_amount := (v_data ->> 'discount_amount')::NUMERIC(14,2);
    v_net_unit := (v_data ->> 'net_unit_amount')::NUMERIC(14,2);
    v_net_amount := (v_data ->> 'net_amount')::NUMERIC(14,2);
    v_version_no := COALESCE((v_data ->> 'discount_version')::INTEGER, 1);
    v_max_discount_quantity := COALESCE((v_data ->> 'max_discount_quantity')::INTEGER, 0);

    -- Re-assert the invariants after the JSONB round-trip. Cheap, and it means a
    -- future edit to evaluate() cannot silently produce a zero or over-discounted
    -- order: this function is the last line before money is written.
    IF v_list_amount <= 0 OR v_net_amount <= 0 OR v_discount_amount <= 0
       OR v_discount_amount >= v_list_amount
       OR v_net_amount < ROUND(v_list_amount * 0.5, 2)
       OR v_net_amount <> ROUND(v_list_amount - v_discount_amount, 2)
       OR v_net_amount <> ROUND(v_net_unit * v_quantity, 2) THEN
        RAISE EXCEPTION 'guest_discount_amount_invalid'
            USING DETAIL = '优惠金额计算结果无效';
    END IF;

    -- Atomic global usage reservation, using exactly the guard shape the
    -- logged-in settlement path uses (20260617_harden_discount_settlement_and_
    -- refunds.sql). max_uses <= 0 means unlimited. The lifecycle / window / site
    -- predicates are restated here so the increment itself is the authority: a
    -- code paused or expired between evaluate() and this statement is rejected
    -- by the write, not by a stale read.
    -- Every column below is qualified with the alias `d` on purpose. This
    -- function RETURNS TABLE (discount_code, discount_type, discount_value, ...),
    -- and PL/pgSQL binds OUT parameters as variables. A bare `discount_type` in
    -- the RETURNING list therefore matches BOTH the discount_codes column and
    -- the OUT variable, which Postgres rejects at run time with
    -- "column reference \"discount_type\" is ambiguous" - after CREATE succeeded
    -- and after the money was already moving. Qualifying removes the ambiguity
    -- at the source instead of papering over it with #variable_conflict.
    -- Gate re-check immediately before money moves. evaluate() ran a few
    -- statements ago inside THIS transaction, but an operator may have flipped
    -- the breaker, or another buyer may have taken the last of the daily
    -- budget, in the meantime. The authoritative enforcement is still the two
    -- atomic UPDATEs below; this read only turns a doomed write into a clean
    -- rejection.
    v_gate := public.guest_shop_promo_gate(v_site, v_discount_amount);
    IF COALESCE((v_gate ->> 'allowed')::BOOLEAN, false) IS NOT TRUE THEN
        RAISE EXCEPTION '%', COALESCE(NULLIF(BTRIM(v_gate ->> 'code'), ''), 'guest_promo_halted')
            USING DETAIL = COALESCE(NULLIF(BTRIM(v_gate ->> 'message'), ''), '优惠活动暂不可用');
    END IF;

    UPDATE public.discount_codes AS d
    SET used_count = COALESCE(d.used_count, 0) + 1,
        guest_used_count = COALESCE(d.guest_used_count, 0) + 1,
        guest_discount_total = COALESCE(d.guest_discount_total, 0) + v_discount_amount
    WHERE d.code = v_code
      AND COALESCE(d.is_active, true)
      AND COALESCE(NULLIF(BTRIM(COALESCE(d.lifecycle_status, '')), ''), 'active')
          NOT IN ('archived', 'paused_manual', 'paused_risk')
      AND (d.starts_at IS NULL OR d.starts_at <= clock_timestamp())
      AND (d.expires_at IS NULL OR d.expires_at >= clock_timestamp())
      AND (d.applicable_site IS NULL OR d.applicable_site = v_site)
      AND (COALESCE(d.max_uses, 0) <= 0
           OR COALESCE(d.used_count, 0) < COALESCE(d.max_uses, 0))
      -- §3.1 gate 1: explicit guest whitelist. Restated here (evaluate already
      -- checked it) because THIS statement is the authority: a code closed to
      -- guests between evaluate and reserve is rejected by the write.
      AND COALESCE(d.allow_guest, false)
      -- §3.1 gate 2: explicit guest quota, and the increment must not exceed it.
      -- The CHECK discount_codes_guest_caps_check is the backstop that makes an
      -- over-issued quota unrepresentable even if this clause were removed.
      AND COALESCE(d.guest_max_uses, 0) > 0
      AND COALESCE(d.guest_used_count, 0) < COALESCE(d.guest_max_uses, 0)
      -- §3.1 money cap: 0 means no separate per-code cap (see the §3.1 header).
      AND (COALESCE(d.guest_max_total_discount, 0) <= 0
           OR COALESCE(d.guest_discount_total, 0) + v_discount_amount
              <= d.guest_max_total_discount)
    RETURNING d.id, d.discount_type, d.discount_value,
              COALESCE(d.max_discount_quantity, 0), COALESCE(d.version_no, 1)
    INTO v_code_id, v_discount_type, v_discount_value, v_max_discount_quantity, v_version_no;

    IF NOT FOUND THEN
        -- One generic code for "the code cannot take this redemption", whether
        -- the cause is the shared max_uses, the guest whitelist, the guest quota
        -- or the per-code money cap. The cause is deliberately not distinguishable
        -- from the outside (plan §11).
        RAISE EXCEPTION 'guest_discount_code_exhausted'
            USING DETAIL = '所选优惠码额度已被使用完，请重新选择';
    END IF;

    -- §3.2 daily budget: ONE atomic statement that also performs the day
    -- rollover. Every SET expression reads the OLD row version, so the CASE
    -- below compares the stored budget_date and resets spent_cny in the same
    -- write; two concurrent reservations serialise on this row and can never
    -- both believe they took the last of the budget. The table CHECK
    -- (spent_cny <= daily_budget_cny) is the backstop.
    UPDATE public.guest_shop_promo_budget AS b
    SET budget_date = v_today,
        spent_cny = CASE
                        WHEN b.budget_date = v_today THEN COALESCE(b.spent_cny, 0)
                        ELSE 0
                    END + v_discount_amount,
        updated_at = clock_timestamp()
    WHERE b.site = v_site
      AND COALESCE(b.enabled, false)
      AND COALESCE(b.daily_budget_cny, 0) > 0
      AND (CASE
               WHEN b.budget_date = v_today THEN COALESCE(b.spent_cny, 0)
               ELSE 0
           END) + v_discount_amount <= b.daily_budget_cny;

    IF NOT FOUND THEN
        -- Raised AFTER the code counters were incremented, inside the same
        -- transaction, so the whole create_order rolls back: no partial spend,
        -- no consumed quota, no order.
        RAISE EXCEPTION 'guest_promo_budget_exhausted'
            USING DETAIL = '今日优惠额度已用完';
    END IF;

    v_snapshot := jsonb_build_object(
        'schema', 'guest-discount-v1',
        'discount_code', v_code,
        'discount_code_id', v_code_id,
        'discount_type', v_discount_type,
        'discount_value', v_discount_value,
        'discount_version', v_version_no,
        'max_discount_quantity', v_max_discount_quantity,
        'site', v_site,
        'currency', 'CNY',
        'quantity', v_quantity,
        'list_unit_amount', v_list_unit,
        'list_amount', v_list_amount,
        'discount_amount', v_discount_amount,
        'net_unit_amount', v_net_unit,
        'net_amount', v_net_amount,
        'floor_amount', ROUND(v_list_amount * 0.5, 2),
        'allow_zero_total_used', false,
        -- Caps as they were BEFORE this reservation, so an auditor can replay
        -- "was this redemption allowed at the time" from the order row alone.
        'daily_budget_cny', COALESCE((v_gate #>> '{data,daily_budget_cny}')::NUMERIC, 0),
        'budget_spent_before', COALESCE((v_gate #>> '{data,spent_cny}')::NUMERIC, 0),
        'budget_spent_after', COALESCE((v_gate #>> '{data,spent_cny}')::NUMERIC, 0) + v_discount_amount,
        'budget_date', v_today,
        'reserved_at', clock_timestamp()
    );

    INSERT INTO public.guest_shop_discount_redemptions (
        order_id, code, discount_code_id, site, product_id, sku_id, quantity,
        list_amount, discount_amount, net_amount, discount_version,
        buyer_contact_hash, buyer_id, request_ip_hash, request_device_hash
    ) VALUES (
        p_order_id, v_code, v_code_id, v_site, p_product_id, p_sku_id, v_quantity,
        v_list_amount, v_discount_amount, v_net_amount, v_version_no,
        p_buyer_contact_hash, p_buyer_id, p_request_ip_hash, p_request_device_hash
    );

    RETURN QUERY SELECT
        v_code,
        v_discount_type,
        v_discount_value::NUMERIC,
        v_list_amount::NUMERIC,
        v_discount_amount::NUMERIC,
        v_net_unit::NUMERIC,
        v_net_amount::NUMERIC,
        v_snapshot;
END;
$$;

-- ---------------------------------------------------------------------------
-- §6. fn_guest_shop_create_order: 13 -> 15 parameters.
--
--    DROP + CREATE, NOT CREATE OR REPLACE. Changing a signature with CREATE OR
--    REPLACE would leave the old 13-parameter overload in place alongside the new
--    15-parameter one, and PostgREST would then reject every RPC with "could not
--    choose the best candidate function". The old signature is dropped
--    explicitly, by its exact argument list, so an unrelated overload could never
--    be removed by accident. The drop window is a few milliseconds and guest
--    checkout is not enabled in production, so no live order can observe it.
--
--    Everything below is the 20260920 function with the L1/L2 changes marked.
--    The security-critical parts are untouched and are repeated here verbatim:
--    the service_role gate, the idempotency key + fingerprint conflict rules, the
--    claim-secret binding, the (buyer_id, site, contact_hash) triple check, the
--    payment-channel allowlist, the inventory source-chain proof, and the
--    exclusion of shared/manual/non-KEY stock.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.fn_guest_shop_create_order(
    TEXT, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, INTEGER
);

CREATE OR REPLACE FUNCTION public.fn_guest_shop_create_order(
    p_site TEXT,
    p_product_id UUID,
    p_sku_id UUID,
    p_idempotency_key TEXT,
    p_request_fingerprint TEXT,
    p_claim_secret_hash TEXT,
    p_provider TEXT,
    p_channel TEXT,
    p_buyer_contact_hash TEXT DEFAULT NULL,
    p_buyer_id UUID DEFAULT NULL,
    p_request_ip_hash TEXT DEFAULT NULL,
    p_request_device_hash TEXT DEFAULT NULL,
    p_ttl_seconds INTEGER DEFAULT 1800,
    -- L1/L2. Both default to the P0 behaviour (one unit, no code) so any caller
    -- that has not been upgraded keeps producing byte-identical orders.
    p_quantity INTEGER DEFAULT 1,
    p_discount_code TEXT DEFAULT NULL
)
RETURNS TABLE (
    order_id UUID,
    order_no TEXT,
    payment_order_id UUID,
    merchant_order_no TEXT,
    site TEXT,
    currency TEXT,
    unit_amount NUMERIC,
    total_amount NUMERIC,
    expires_at TIMESTAMPTZ,
    claim_secret_version SMALLINT,
    reservation_status TEXT,
    payment_status TEXT,
    quantity INTEGER,
    list_unit_amount NUMERIC,
    discount_amount NUMERIC,
    discount_code TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_site TEXT := public.guest_shop_normalize_site(p_site);
    v_currency TEXT;
    v_provider TEXT := LOWER(BTRIM(COALESCE(p_provider, '')));
    v_channel TEXT := LOWER(BTRIM(COALESCE(p_channel, '')));
    v_key TEXT := BTRIM(COALESCE(p_idempotency_key, ''));
    v_fingerprint TEXT := BTRIM(COALESCE(p_request_fingerprint, ''));
    v_product public.shop_products%ROWTYPE;
    v_sku public.shop_product_skus%ROWTYPE;
    v_source_sku public.shop_product_skus%ROWTYPE;
    v_unit_amount NUMERIC(14,2);
    v_order_id UUID;
    v_buyer_id UUID;
    v_payment_order_id UUID;
    v_inventory_id UUID;
    v_order_no TEXT;
    v_now TIMESTAMPTZ := clock_timestamp();
    v_expires_at TIMESTAMPTZ;
    v_existing RECORD;
    v_existing_payment RECORD;
    v_guest_enabled BOOLEAN;
    v_allowed_channels JSONB;
    v_delivery_type TEXT;
    v_raw_source_ids UUID[];
    v_configured_source_ids UUID[];
    v_source_ids UUID[];
    v_inventory_source_sku_id UUID;
    -- L1 (multi-unit / tiered price) and L2 (discount code) state. The single-row
    -- v_inventory_id / v_inventory_source_sku_id declarations above are retained
    -- but unused: L1 reserves an ARRAY of rows instead.
    v_quantity INTEGER;
    v_guest_quantity_cap INTEGER;
    v_list_unit_amount NUMERIC(14,2);
    v_net_unit_amount NUMERIC(14,2);
    v_list_amount NUMERIC(14,2);
    v_net_amount NUMERIC(14,2);
    v_discount_amount NUMERIC(14,2) := 0;
    v_discount_code TEXT := NULL;
    v_discount_snapshot JSONB := NULL;
    v_discount_row RECORD;
    v_inventory_ids UUID[] := ARRAY[]::UUID[];
    v_inventory_source_ids UUID[] := ARRAY[]::UUID[];
    v_reservation_rows INTEGER := 0;
BEGIN
    PERFORM public.guest_shop_require_service_role();

    IF v_site NOT IN ('cn', 'intl') THEN
        RAISE EXCEPTION 'guest_invalid_site';
    END IF;
    v_currency := 'CNY';

    IF p_product_id IS NULL OR p_sku_id IS NULL THEN
        RAISE EXCEPTION 'guest_product_or_sku_required';
    END IF;
    IF char_length(v_key) < 16 OR char_length(v_key) > 200 THEN
        RAISE EXCEPTION 'guest_invalid_idempotency_key';
    END IF;
    IF v_fingerprint !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'guest_invalid_request_fingerprint';
    END IF;
    IF p_claim_secret_hash IS NULL
       OR p_claim_secret_hash !~ '^hmac-sha256:v1:[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'guest_invalid_claim_secret_hash';
    END IF;
    IF p_ttl_seconds IS NULL OR p_ttl_seconds < 300 OR p_ttl_seconds > 7200 THEN
        RAISE EXCEPTION 'guest_invalid_order_ttl';
    END IF;

    -- L1: bound the raw quantity before it can influence anything. 5 is the hard
    -- ceiling and matches the guest_shop_orders CHECK; the product/SKU ceilings
    -- are applied further down, after those rows are locked.
    v_quantity := COALESCE(p_quantity, 1);
    IF v_quantity < 1 OR v_quantity > 5 THEN
        RAISE EXCEPTION 'guest_invalid_quantity';
    END IF;

    -- L2: normalise and format-check the code before any lookup, so a malformed
    -- value can never reach the discount engine or be stored.
    v_discount_code := NULLIF(UPPER(BTRIM(COALESCE(p_discount_code, ''))), '');
    IF v_discount_code IS NOT NULL
       AND v_discount_code !~ '^[A-Z0-9][A-Z0-9_-]{0,49}$' THEN
        RAISE EXCEPTION 'guest_invalid_discount_code';
    END IF;
    IF v_provider = '' OR char_length(v_provider) > 80
       OR v_provider !~ '^[a-z0-9][a-z0-9._:-]{0,79}$'
       OR v_provider IN ('mock', 'test', 'fake')
       OR v_channel = '' OR char_length(v_channel) > 80
       OR v_channel !~ '^[a-z0-9][a-z0-9._:-]{0,79}$'
       OR v_channel IN ('mock', 'test', 'fake') THEN
        RAISE EXCEPTION 'guest_invalid_payment_provider';
    END IF;

    -- Order Access 2.0 (§6.4): buyer_id is an ACCESS-CONTROL key, never a
    -- pricing or quota input. It must be bound to the same site and the same
    -- contact hash as this order, so a caller can never attach an order to
    -- somebody else's credential group and later read their card secrets.
    -- Fail closed: a buyer_id without a matching contact hash is rejected,
    -- not silently ignored.
    IF p_buyer_id IS NOT NULL THEN
        IF p_buyer_contact_hash IS NULL OR p_buyer_contact_hash !~ '^[0-9a-f]{64}$' THEN
            RAISE EXCEPTION 'guest_buyer_contact_required';
        END IF;
        SELECT b.id INTO v_buyer_id
        FROM public.guest_shop_buyers b
        WHERE b.id = p_buyer_id
          AND b.site = v_site
          AND b.contact_hash = p_buyer_contact_hash;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'guest_buyer_mismatch';
        END IF;
    ELSE
        v_buyer_id := NULL;
    END IF;

    -- L2: a discount is a per-identity benefit and §3's ledger counts identities
    -- by contact_hash. With no resolved credential group there is nothing to
    -- count against, so the code is REJECTED rather than applied
    -- unattributably - an anonymous, unlimited discount is exactly the "被刷"
    -- scenario this channel must not have. This is also why the application
    -- layer makes GUEST_SHOP_DISCOUNT_ENABLED require
    -- GUEST_SHOP_BUYER_CREDENTIAL_ENABLED.
    IF v_discount_code IS NOT NULL THEN
        IF v_buyer_id IS NULL
           OR p_buyer_contact_hash IS NULL
           OR p_buyer_contact_hash !~ '^[0-9a-f]{64}$' THEN
            RAISE EXCEPTION 'guest_discount_identity_required';
        END IF;
    END IF;

    -- The advisory lock makes the idempotency lookup and inventory decision a
    -- single serial point even when two retries arrive simultaneously.
    PERFORM pg_advisory_xact_lock(hashtextextended(v_site || ':' || v_key, 0));

    SELECT o.*,
           p.id AS existing_payment_order_id,
           p.merchant_order_no AS existing_merchant_order_no,
           p.status AS existing_payment_status
    INTO v_existing
    FROM public.guest_shop_orders o
    LEFT JOIN public.guest_shop_payment_orders p ON p.guest_order_id = o.id
    WHERE o.site = v_site
      AND o.idempotency_key = v_key;

    IF FOUND THEN
        IF v_existing.request_fingerprint IS DISTINCT FROM v_fingerprint THEN
            RAISE EXCEPTION 'guest_idempotency_conflict';
        END IF;
        IF v_existing.claim_secret_hash IS DISTINCT FROM p_claim_secret_hash THEN
            RAISE EXCEPTION 'guest_idempotency_claim_secret_conflict';
        END IF;
        RETURN QUERY SELECT
            v_existing.id,
            v_existing.order_no,
            v_existing.existing_payment_order_id,
            v_existing.existing_merchant_order_no,
            v_existing.site::TEXT,
            v_existing.currency::TEXT,
            v_existing.unit_amount,
            v_existing.total_amount,
            v_existing.expires_at,
            v_existing.claim_secret_version,
            v_existing.reservation_status,
            v_existing.existing_payment_status,
            v_existing.quantity,
            v_existing.list_unit_amount,
            v_existing.discount_amount,
            -- discount_code is VARCHAR(64) on the table but TEXT in this
            -- function's RETURNS TABLE. plpgsql compares the two result
            -- row types by type OID, and varchar/text are distinct OIDs even
            -- though they are binary coercible, so an uncast column here makes
            -- EVERY idempotent replay die with "structure of query does not
            -- match function result type". site/currency are cast for the same
            -- reason; discount_code was missed. Cast it explicitly.
            v_existing.discount_code::TEXT;
        RETURN;
    END IF;

    -- Product then selected SKU then source SKU is the lock order used by all
    -- creation calls.  Source aliases stay within one product by migration
    -- constraints; P0 still rejects shared inventory itself below.
    SELECT * INTO v_product
    FROM public.shop_products
    WHERE id = p_product_id
    FOR UPDATE;
    IF NOT FOUND OR COALESCE(v_product.is_active, false) IS NOT TRUE THEN
        RAISE EXCEPTION 'guest_product_unavailable';
    END IF;

    SELECT * INTO v_sku
    FROM public.shop_product_skus
    WHERE id = p_sku_id
      AND product_id = p_product_id
    FOR UPDATE;
    IF NOT FOUND OR COALESCE(v_sku.is_active, false) IS NOT TRUE THEN
        RAISE EXCEPTION 'guest_sku_unavailable';
    END IF;

    -- P0 is automatic KEY delivery only. Manual/API products can never enter
    -- this cash channel, even if an operator accidentally enables guest sale.
    v_delivery_type := UPPER(BTRIM(COALESCE(v_product.delivery_type, 'KEY')));
    IF v_delivery_type <> 'KEY'
       OR COALESCE(v_product.manual_delivery, false)
       OR COALESCE(v_sku.manual_delivery, false) THEN
        RAISE EXCEPTION 'guest_delivery_mode_unsupported';
    END IF;

    -- L1 cap: three independent ceilings, smallest wins.
    --   * 5                      hard DB bound (§1 CHECK)
    --   * guest_max_quantity     operator's per-SKU/per-product guest ceiling
    --   * max_purchase_quantity  operator's general per-order ceiling, which an
    --                            anonymous buyer must not be able to bypass
    -- A guest is therefore never able to buy more per order than a logged-in
    -- buyer could, even if the guest ceiling is misconfigured upwards.
    v_guest_quantity_cap := LEAST(
        5,
        GREATEST(1, COALESCE(v_sku.guest_max_quantity, v_product.guest_max_quantity, 1)),
        GREATEST(1, COALESCE(v_product.max_purchase_quantity, 5))
    );
    IF v_quantity > v_guest_quantity_cap THEN
        RAISE EXCEPTION 'guest_quantity_not_allowed';
    END IF;

    -- Validate the raw configured source list before using the resolver.  The
    -- resolver intentionally uses joins and can omit a deleted source; a new
    -- guest order must instead fail closed when configuration is stale,
    -- cross-product, points at an inactive SKU, or contains a NULL that a
    -- convenience unnest() filter would otherwise silently discard.
    v_raw_source_ids := CASE
        WHEN v_site = 'intl'
             AND COALESCE(array_length(v_sku.inventory_source_sku_ids_intl, 1), 0) > 0
            THEN v_sku.inventory_source_sku_ids_intl
        WHEN v_site <> 'intl'
             AND COALESCE(array_length(v_sku.inventory_source_sku_ids, 1), 0) > 0
            THEN v_sku.inventory_source_sku_ids
        WHEN v_site = 'intl'
            THEN ARRAY[v_sku.id]::UUID[]
        WHEN v_sku.inventory_sku_id IS NOT NULL
            THEN ARRAY[v_sku.inventory_sku_id]::UUID[]
        ELSE ARRAY[v_sku.id]::UUID[]
    END;
    IF v_raw_source_ids IS NULL
       OR COALESCE(array_length(v_raw_source_ids, 1), 0) = 0
       OR array_position(v_raw_source_ids, NULL) IS NOT NULL THEN
        RAISE EXCEPTION 'guest_inventory_source_invalid';
    END IF;

    SELECT COALESCE(array_agg(source_id ORDER BY first_rank), ARRAY[]::UUID[])
    INTO v_configured_source_ids
    FROM (
        SELECT source_id, MIN(source_rank) AS first_rank
        FROM unnest(v_raw_source_ids) WITH ORDINALITY AS source(source_id, source_rank)
        GROUP BY source_id
    ) configured;
    IF COALESCE(array_length(v_configured_source_ids, 1), 0) = 0 THEN
        RAISE EXCEPTION 'guest_inventory_source_unavailable';
    END IF;
    IF EXISTS (
        SELECT 1
        FROM unnest(v_configured_source_ids) AS configured(source_id)
        LEFT JOIN public.shop_product_skus source_sku ON source_sku.id = configured.source_id
        WHERE source_sku.id IS NULL
           OR source_sku.product_id IS DISTINCT FROM v_product.id
           OR COALESCE(source_sku.is_active, false) IS NOT TRUE
           OR COALESCE(source_sku.manual_delivery, false)
    ) THEN
        RAISE EXCEPTION 'guest_inventory_source_invalid';
    END IF;

    -- Resolve the site-specific source chain and lock source SKUs in priority
    -- order. The resolver enforces same-product aliases and default semantics.
    -- Prove both directions: cardinality alone accepts two different source
    -- sets of equal length, which could reserve inventory from a stale alias.
    SELECT COALESCE(array_agg(src.source_sku_id ORDER BY src.source_rank), ARRAY[]::UUID[])
    INTO v_source_ids
    FROM public.fn_resolve_shop_sku_inventory_sources(v_sku.id, v_site) src;
    IF COALESCE(array_length(v_source_ids, 1), 0) = 0
       OR COALESCE(array_length(v_source_ids, 1), 0)
          <> COALESCE(array_length(v_configured_source_ids, 1), 0)
       OR EXISTS (
           SELECT 1
           FROM unnest(v_configured_source_ids) AS configured(source_id)
           WHERE NOT EXISTS (
               SELECT 1
               FROM unnest(v_source_ids) AS resolved(source_id)
               WHERE resolved.source_id = configured.source_id
           )
       )
       OR EXISTS (
           SELECT 1
           FROM unnest(v_source_ids) AS resolved(source_id)
           WHERE NOT EXISTS (
               SELECT 1
               FROM unnest(v_configured_source_ids) AS configured(source_id)
               WHERE configured.source_id = resolved.source_id
           )
       )
       -- Preserve first-occurrence priority too: it decides which available
       -- inventory row is held when several source pools have stock.
       OR v_source_ids IS DISTINCT FROM v_configured_source_ids THEN
        RAISE EXCEPTION 'guest_inventory_source_invalid';
    END IF;
    IF EXISTS (
        SELECT 1
        FROM public.shop_product_skus source_sku
        WHERE source_sku.id = ANY(v_source_ids)
          AND (
              source_sku.product_id IS DISTINCT FROM v_product.id
              OR COALESCE(source_sku.is_active, false) IS NOT TRUE
              OR COALESCE(source_sku.manual_delivery, false)
          )
    ) THEN
        RAISE EXCEPTION 'guest_inventory_source_invalid';
    END IF;
    FOR v_source_sku IN
        SELECT s.*
        FROM public.shop_product_skus s
        WHERE s.id = ANY(v_source_ids)
        ORDER BY array_position(v_source_ids, s.id)
        FOR UPDATE
    LOOP
        NULL;
    END LOOP;

    v_guest_enabled := COALESCE(v_sku.allow_guest_purchase, v_product.allow_guest_purchase, false);
    IF v_guest_enabled IS NOT TRUE THEN
        RAISE EXCEPTION 'guest_purchase_disabled';
    END IF;

    v_unit_amount := public.guest_shop_resolve_credit_unit_amount(
        v_site,
        v_sku.price_points,
        v_sku.price_points_intl,
        COALESCE(v_sku.is_default, false),
        v_sku.quantity_rules,
        v_sku.quantity_rules_intl,
        v_product.quantity_rules,
        v_product.quantity_rules_intl,
        v_product.flash_sale_price,
        v_product.flash_sale_price_intl,
        v_product.flash_sale_end,
        v_product.flash_sale_end_intl,
        -- L1: the quantity now drives the tier loop inside the resolver, so a
        -- guest buying 3 units gets the same tier price a logged-in buyer gets.
        v_quantity,
        v_now
    );
    IF v_unit_amount IS NULL
       OR LOWER(v_unit_amount::TEXT) IN ('nan', 'infinity', '-infinity')
       OR v_unit_amount <= 0
       OR v_unit_amount <> ROUND(v_unit_amount, 2) THEN
        RAISE EXCEPTION 'guest_credit_price_unavailable';
    END IF;
    v_unit_amount := ROUND(v_unit_amount, 2);

    -- L1/L2 money chain. v_unit_amount is the LIST unit price: catalogue credit
    -- points with tier/flash already applied, i.e. exactly what a logged-in
    -- buyer sees for this quantity. Any discount is taken off THAT number, never
    -- off a separately derived base, which is what keeps 积分 and 现金 equivalent.
    v_list_unit_amount := v_unit_amount;
    v_net_unit_amount := v_unit_amount;
    v_list_amount := ROUND(v_list_unit_amount * v_quantity, 2);
    v_net_amount := v_list_amount;

    v_allowed_channels := COALESCE(v_sku.guest_payment_channels, v_product.guest_payment_channels, '[]'::JSONB);
    -- Payment channel configuration is an allowlist, never an opt-out.  An
    -- empty/malformed list must fail closed, and each entry must be a string
    -- token or an explicit provider:channel pair.  Never accept mock/test/fake
    -- values through configuration even if an operator accidentally stores
    -- them in JSONB.
    IF jsonb_typeof(v_allowed_channels) <> 'array'
       OR jsonb_array_length(v_allowed_channels) = 0 THEN
        RAISE EXCEPTION 'guest_payment_channel_allowlist_empty';
    END IF;
    IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements(v_allowed_channels) AS allowed(value)
        WHERE jsonb_typeof(allowed.value) <> 'string'
           OR LOWER(BTRIM(allowed.value #>> '{}')) !~ '^[a-z0-9][a-z0-9._:-]{0,159}$'
           OR LOWER(BTRIM(allowed.value #>> '{}')) IN ('mock', 'test', 'fake')
    ) THEN
        RAISE EXCEPTION 'guest_payment_channel_allowlist_invalid';
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(v_allowed_channels) AS allowed(channel)
        WHERE LOWER(BTRIM(allowed.channel)) IN (
            v_channel,
            v_provider,
            v_provider || ':' || v_channel
        )
    ) THEN
        RAISE EXCEPTION 'guest_payment_channel_unavailable';
    END IF;

    v_expires_at := v_now + make_interval(secs => p_ttl_seconds);

    -- L1: reserve v_quantity rows in one statement. P0 sold exactly one row and
    -- excluded reusable/shared rows; both properties are preserved - the WHERE
    -- clause is unchanged and only LIMIT 1 became LIMIT v_quantity.
    --
    -- Why this stays a single statement: FOR UPDATE SKIP LOCKED picks the rows
    -- and the UPDATE flips them to 'reserve' atomically, so two concurrent
    -- guests can never be handed the same card. Aggregating the RETURNING rows
    -- by reserved_id keeps inventory_id and its source snapshot paired; the
    -- pairing must not be re-derived afterwards, because a concurrent
    -- configuration change could then mislabel which logical source authorised a
    -- held row (the reason the original code carried the source inline).
    WITH source_rows AS MATERIALIZED (
        SELECT src.source_sku_id, src.source_is_default, src.source_rank
        FROM public.fn_resolve_shop_sku_inventory_sources(v_sku.id, v_site) src
    ), candidate AS (
        SELECT i.id,
               src.source_sku_id AS matched_source_sku_id
        FROM public.shop_inventory i
        JOIN source_rows src
          ON i.sku_id = src.source_sku_id
          OR (src.source_is_default AND i.sku_id IS NULL)
        WHERE i.product_id = p_product_id
          AND i.status = 'available'
          AND COALESCE(i.is_shared, false) = false
        ORDER BY src.source_rank ASC, i.created_at ASC, i.id ASC
        LIMIT v_quantity
        FOR UPDATE SKIP LOCKED
    ), reserved AS (
        UPDATE public.shop_inventory AS i
        SET status = 'reserve'
        FROM candidate
        WHERE i.id = candidate.id
          AND i.status = 'available'
        RETURNING i.id AS reserved_id,
                  candidate.matched_source_sku_id AS reserved_source_sku_id
    )
    SELECT COALESCE(array_agg(r.reserved_id ORDER BY r.reserved_id), ARRAY[]::UUID[]),
           COALESCE(array_agg(r.reserved_source_sku_id ORDER BY r.reserved_id), ARRAY[]::UUID[])
    INTO v_inventory_ids, v_inventory_source_ids
    FROM reserved r;

    -- All-or-nothing stock. A partial hold would mean selling cards nobody
    -- holds, so any shortfall raises and rolls the whole order back.
    IF COALESCE(array_length(v_inventory_ids, 1), 0) <> v_quantity
       OR COALESCE(array_length(v_inventory_source_ids, 1), 0) <> v_quantity THEN
        RAISE EXCEPTION 'guest_inventory_unavailable';
    END IF;
    -- Defence in depth: the same physical card must never be reserved twice for
    -- one order even if a future source-chain change made two candidate rows
    -- point at one inventory row. (order_id, inventory_id) is also UNIQUE (§2).
    IF (SELECT COUNT(DISTINCT x) FROM unnest(v_inventory_ids) AS x) <> v_quantity THEN
        RAISE EXCEPTION 'guest_inventory_unavailable';
    END IF;
    -- Default inventory rows intentionally have NULL i.sku_id; the candidate
    -- source carried above preserves which logical source authorized them.
    IF EXISTS (
        SELECT 1 FROM unnest(v_inventory_source_ids) AS s(source_sku_id)
        WHERE s.source_sku_id IS NULL
    ) THEN
        RAISE EXCEPTION 'guest_inventory_source_snapshot_failed';
    END IF;

    v_order_no := 'GS' || to_char(v_now, 'YYYYMMDDHH24MISSMS')
        || upper(substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 12));
    v_order_id := gen_random_uuid();
    v_payment_order_id := gen_random_uuid();

    INSERT INTO public.guest_shop_orders (
        id, order_no, idempotency_key, request_fingerprint, source_channel,
        site, currency, product_id, sku_id, snapshot_product_name,
        snapshot_sku_name, snapshot_delivery_type, snapshot_manual_delivery,
        snapshot_sku_manual_delivery, quantity, unit_amount, total_amount, payment_status,
        reservation_status, fulfillment_status, refund_status, claim_secret_hash,
        claim_secret_version, buyer_contact_hash, buyer_id, request_ip_hash,
        request_device_hash, expires_at, metadata,
        list_unit_amount, discount_amount, discount_code, discount_snapshot,
        payment_fee_amount
    ) VALUES (
        v_order_id, v_order_no, v_key, v_fingerprint, 'website_guest',
        v_site, v_currency, v_product.id, v_sku.id,
        COALESCE(NULLIF(BTRIM(v_product.name), ''), 'Product'),
        COALESCE(NULLIF(BTRIM(v_sku.sku_name), ''), 'Default'),
        v_delivery_type, COALESCE(v_product.manual_delivery, false),
        COALESCE(v_sku.manual_delivery, false),
        -- unit_amount / total_amount are written NET of discount and EXCLUDING
        -- the payment fee; the HTTP layer adds payment_fee_amount once the
        -- provider surcharge is known and total_amount becomes
        -- unit*quantity + fee, which is what §1's CHECK requires.
        v_quantity, v_net_unit_amount, v_net_amount, 'pending', 'held', 'pending', 'none',
        p_claim_secret_hash, 1, p_buyer_contact_hash, v_buyer_id, p_request_ip_hash,
        p_request_device_hash, v_expires_at, '{}'::JSONB,
        v_list_unit_amount, v_discount_amount, v_discount_code, v_discount_snapshot,
        0
    );

    INSERT INTO public.guest_shop_inventory_reservations (
        id, order_id, inventory_id, inventory_source_sku_id, product_id, sku_id, site, status,
        reserved_at, reserved_until
    )
    SELECT gen_random_uuid(), v_order_id, rows.inventory_id, rows.inventory_source_sku_id,
           v_product.id, v_sku.id,
           v_site, 'held', v_now, v_expires_at
    FROM unnest(v_inventory_ids, v_inventory_source_ids)
        AS rows(inventory_id, inventory_source_sku_id);

    GET DIAGNOSTICS v_reservation_rows = ROW_COUNT;
    IF v_reservation_rows <> v_quantity THEN
        -- Unreachable given the length/distinctness checks above plus the
        -- (order_id, inventory_id) UNIQUE constraint, but an under-reservation
        -- would mean selling cards nobody holds, so it is asserted rather than
        -- assumed.
        RAISE EXCEPTION 'guest_reservation_count_mismatch';
    END IF;

    -- L2: reserve the discount AFTER the order row exists (the ledger has a
    -- NOT NULL FK to it) and BEFORE the payment intent, because the payment must
    -- carry the discounted amount. Runs in this same transaction, so a later
    -- failure rolls the used_count increment and the ledger row back with it.
    IF v_discount_code IS NOT NULL THEN
        SELECT r.reserved_code, r.reserved_discount_amount, r.reserved_net_unit_amount,
               r.reserved_net_amount, r.reserved_snapshot
        INTO v_discount_row
        FROM (
            SELECT d.discount_code AS reserved_code,
                   d.discount_amount AS reserved_discount_amount,
                   d.net_unit_amount AS reserved_net_unit_amount,
                   d.net_amount AS reserved_net_amount,
                   d.snapshot AS reserved_snapshot
            FROM public.fn_guest_shop_reserve_discount(
                v_site, v_product.id, v_sku.id, v_quantity, v_list_unit_amount,
                v_discount_code, v_buyer_id, p_buyer_contact_hash,
                p_request_ip_hash, p_request_device_hash, v_order_id
            ) d
        ) r;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'guest_discount_reservation_failed';
        END IF;

        v_net_unit_amount := v_discount_row.reserved_net_unit_amount;
        v_net_amount := v_discount_row.reserved_net_amount;
        v_discount_amount := v_discount_row.reserved_discount_amount;
        v_discount_snapshot := v_discount_row.reserved_snapshot;

        -- Re-assert every money invariant before persisting. The reserve
        -- function already checked these; checking them again here means no
        -- future edit to that function can quietly produce a zero-pay or
        -- over-discounted order through this call site.
        IF v_net_unit_amount IS NULL OR v_net_amount IS NULL
           OR v_discount_amount IS NULL OR v_discount_amount <= 0
           OR v_net_unit_amount <= 0 OR v_net_amount <= 0
           OR v_net_amount <> ROUND(v_net_unit_amount * v_quantity, 2)
           OR v_net_amount <> ROUND(v_list_amount - v_discount_amount, 2)
           OR v_net_amount < ROUND(v_list_amount * 0.5, 2) THEN
            RAISE EXCEPTION 'guest_discount_amount_invalid';
        END IF;

        UPDATE public.guest_shop_orders
        SET unit_amount = v_net_unit_amount,
            total_amount = v_net_amount,
            discount_amount = v_discount_amount,
            discount_snapshot = v_discount_snapshot,
            updated_at = v_now
        WHERE id = v_order_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'guest_order_not_found';
        END IF;
    END IF;

    INSERT INTO public.guest_shop_payment_orders (
        id, guest_order_id, merchant_order_no, purpose, provider, channel,
        site, currency, expected_amount, status, expires_at
    ) VALUES (
        v_payment_order_id, v_order_id, v_order_no, 'shop_direct', v_provider,
        -- expected_amount is the webhook anchor. It is written NET of discount
        -- and EXCLUDING the provider fee, exactly as P0 wrote the credit amount;
        -- the HTTP layer then patches it to the final payable (net + fee) before
        -- any provider call, and the webhook compares against that patched value.
        v_channel, v_site, v_currency, v_net_amount, 'pending', v_expires_at
    );

    RETURN QUERY SELECT
        v_order_id,
        v_order_no,
        v_payment_order_id,
        v_order_no,
        v_site,
        v_currency,
        v_net_unit_amount,
        v_net_amount,
        v_expires_at,
        1::SMALLINT,
        'held'::TEXT,
        'pending'::TEXT,
        v_quantity,
        v_list_unit_amount,
        v_discount_amount,
        v_discount_code;
END;
$$;

-- ---------------------------------------------------------------------------
-- §7. Multi-reservation state machine.
--
--    P0 reserved exactly one card per guest order, so every state function read
--    a single reservation row with SELECT ... INTO and treated that row as the
--    whole order. L1 lets one order hold up to five cards, which makes every one
--    of those reads wrong in a way that loses money or stock:
--
--      * confirm would look at ONE arbitrary row and could mark a 3-card order
--        fulfilled while two cards were still merely held;
--      * claim would hand back the same card three times (SELECT INTO with no
--        ORDER BY is not deterministic across calls);
--      * mark would declare the order delivered after the FIRST card;
--      * release would write reservation_status = 'released' while two cards
--        were still pinned, hiding them from every dashboard and sweep.
--
--    The four functions below are therefore rewritten to evaluate the
--    reservation SET. Two small shared helpers carry the logic that must not
--    diverge between call sites.
--
--    LOCK ORDER IS UNCHANGED: order -> payment -> reservation -> inventory.
--    Every guest state function takes the order row lock first, so all work on
--    one order is serialized and the "lock the whole set, then aggregate"
--    pattern below cannot deadlock with itself. Different orders never share a
--    reservation row.
-- ---------------------------------------------------------------------------

-- Rollup of N reservation rows into the single order-level reservation_status.
-- The returned value is always inside the existing
-- guest_shop_orders_reservation_status_check domain ('none','held','released',
-- 'consumed'); precedence is deliberately held > consumed > released so an order
-- is never reported as finished while a card is still waiting to be handed over.
CREATE OR REPLACE FUNCTION public.guest_shop_reservation_rollup(
    p_order_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_total INTEGER := 0;
    v_held INTEGER := 0;
    v_consumed INTEGER := 0;
BEGIN
    PERFORM public.guest_shop_require_service_role();
    IF p_order_id IS NULL THEN
        RAISE EXCEPTION 'guest_order_required';
    END IF;

    SELECT COUNT(*),
           COUNT(*) FILTER (WHERE r.status = 'held'),
           COUNT(*) FILTER (WHERE r.status = 'consumed')
    INTO v_total, v_held, v_consumed
    FROM public.guest_shop_inventory_reservations r
    WHERE r.order_id = p_order_id;

    IF v_total = 0 THEN
        RETURN 'none';
    END IF;
    IF v_held > 0 THEN
        RETURN 'held';
    END IF;
    IF v_consumed = v_total THEN
        RETURN 'consumed';
    END IF;
    RETURN 'released';
END;
$$;

COMMENT ON FUNCTION public.guest_shop_reservation_rollup(UUID) IS
    'Order-level reservation_status rollup for multi-card guest orders. service_role only.';

-- Bulk release of every still-held card of one order.
--
-- Called by every path that concludes "this paid order cannot be delivered in
-- full". Releasing only the offending row would leave the remaining cards
-- pinned as 'reserve' until the TTL sweep notices, and a paid order that is
-- already on its way to the refund queue must not keep sellable stock hostage.
--
-- Each inventory row is locked and re-checked before it is flipped back, and the
-- flip is conditional on it still being a NON-SHARED 'reserve' row, so this
-- helper can never un-sell a delivered card or touch shared stock.
CREATE OR REPLACE FUNCTION public.guest_shop_release_held_reservations(
    p_order_id UUID,
    p_reason TEXT DEFAULT 'paid_order_partial_stock_loss'
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_row RECORD;
    v_inventory_status TEXT;
    v_inventory_shared BOOLEAN;
    v_reason TEXT := LEFT(COALESCE(NULLIF(BTRIM(p_reason), ''), 'paid_order_partial_stock_loss'), 120);
    v_now TIMESTAMPTZ := clock_timestamp();
    v_released INTEGER := 0;
BEGIN
    PERFORM public.guest_shop_require_service_role();
    IF p_order_id IS NULL THEN
        RAISE EXCEPTION 'guest_order_required';
    END IF;

    FOR v_row IN
        SELECT r.id AS reservation_id, r.inventory_id AS inventory_id
        FROM public.guest_shop_inventory_reservations r
        WHERE r.order_id = p_order_id
          AND r.status = 'held'
        ORDER BY r.created_at ASC, r.id ASC
        FOR UPDATE
    LOOP
        SELECT i.status, COALESCE(i.is_shared, false)
        INTO v_inventory_status, v_inventory_shared
        FROM public.shop_inventory i
        WHERE i.id = v_row.inventory_id
        FOR UPDATE;

        IF FOUND AND v_inventory_status = 'reserve' AND NOT v_inventory_shared THEN
            UPDATE public.shop_inventory
            SET status = 'available'
            WHERE id = v_row.inventory_id
              AND status = 'reserve'
              AND COALESCE(is_shared, false) = false;
        END IF;

        UPDATE public.guest_shop_inventory_reservations
        SET status = 'released',
            released_at = COALESCE(released_at, v_now),
            release_reason = v_reason,
            updated_at = v_now
        WHERE id = v_row.reservation_id
          AND order_id = p_order_id
          AND status = 'held';
        IF FOUND THEN
            v_released := v_released + 1;
        END IF;
    END LOOP;

    -- C-C5 / C-D6: an order whose stock is being handed back is an order that
    -- will not deliver, so the marketing让利 it reserved must go back to the
    -- code quota and to today's budget. The call is idempotent (it claims the
    -- ledger row), so invoking it here AND from fn_guest_shop_release_reservation
    -- AND from a later manual refund can never return the same budget twice.
    PERFORM public.fn_guest_shop_return_discount_reservation(p_order_id, v_reason);

    RETURN v_released;
END;
$$;

COMMENT ON FUNCTION public.guest_shop_release_held_reservations(UUID, TEXT) IS
    'Releases every held reservation of one guest order and returns its stock. service_role only.';

-- 7.1 fn_guest_shop_confirm_payment: aggregate over the reservation set.
CREATE OR REPLACE FUNCTION public.fn_guest_shop_confirm_payment(
    p_payment_order_id UUID,
    p_event_id UUID DEFAULT NULL,
    p_provider TEXT DEFAULT NULL,
    p_provider_order_no TEXT DEFAULT NULL,
    p_observed_site TEXT DEFAULT NULL,
    p_observed_currency TEXT DEFAULT NULL,
    p_observed_amount NUMERIC DEFAULT NULL,
    p_observed_purpose TEXT DEFAULT NULL,
    p_observed_status TEXT DEFAULT NULL,
    p_signature_verified BOOLEAN DEFAULT false,
    p_amount_verified BOOLEAN DEFAULT false,
    p_currency_verified BOOLEAN DEFAULT false,
    p_final_status_verified BOOLEAN DEFAULT false
)
RETURNS TABLE (
    confirmed BOOLEAN,
    order_id UUID,
    payment_order_id UUID,
    payment_status TEXT,
    fulfillment_status TEXT,
    reservation_status TEXT,
    refund_status TEXT,
    event_status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order_id UUID;
    v_order public.guest_shop_orders%ROWTYPE;
    v_payment public.guest_shop_payment_orders%ROWTYPE;
    v_event public.guest_shop_payment_events%ROWTYPE;
    -- L1/L2: the single-reservation rowtype and its two inventory probe
    -- variables are gone; the confirm path now evaluates the reservation set.
    v_res_total INTEGER := 0;
    v_res_held INTEGER := 0;
    v_res_consumed INTEGER := 0;
    v_res_lost_inventory INTEGER := 0;
    v_release_reason TEXT;
    v_provider TEXT := LOWER(BTRIM(COALESCE(p_provider, '')));
    v_provider_order_no TEXT := BTRIM(COALESCE(p_provider_order_no, ''));
    v_site TEXT := public.guest_shop_normalize_site(p_observed_site);
    v_currency TEXT := UPPER(BTRIM(COALESCE(p_observed_currency, '')));
    v_purpose TEXT := LOWER(BTRIM(COALESCE(p_observed_purpose, '')));
    v_status TEXT := LOWER(BTRIM(COALESCE(p_observed_status, '')));
    v_now TIMESTAMPTZ := clock_timestamp();
    v_event_status TEXT := 'processed';
    v_confirmed BOOLEAN := true;
    v_late_success BOOLEAN := false;
BEGIN
    PERFORM public.guest_shop_require_service_role();
    IF p_payment_order_id IS NULL THEN
        RAISE EXCEPTION 'guest_payment_order_required';
    END IF;
    IF p_event_id IS NULL THEN
        RAISE EXCEPTION 'guest_payment_event_required';
    END IF;
    IF v_provider = '' OR char_length(v_provider) > 80
       OR v_provider !~ '^[a-z0-9][a-z0-9._:-]{0,79}$'
       OR v_provider IN ('mock', 'test', 'fake') THEN
        RAISE EXCEPTION 'guest_invalid_payment_provider';
    END IF;
    IF v_provider_order_no = '' OR char_length(v_provider_order_no) > 300
       OR v_provider_order_no ~ '[[:cntrl:][:space:]]' THEN
        RAISE EXCEPTION 'guest_invalid_provider_order_no';
    END IF;
    IF v_site NOT IN ('cn', 'intl') THEN
        RAISE EXCEPTION 'guest_invalid_site';
    END IF;
    IF v_currency NOT IN ('CNY', 'USD') THEN
        RAISE EXCEPTION 'guest_invalid_currency';
    END IF;
    IF v_purpose <> 'shop_direct' THEN
        RAISE EXCEPTION 'guest_invalid_payment_purpose';
    END IF;
    IF p_observed_amount IS NULL
       OR LOWER(p_observed_amount::TEXT) IN ('nan', 'infinity', '-infinity')
       OR p_observed_amount < 0
       OR p_observed_amount > 999999999999.99
       OR p_observed_amount <> ROUND(p_observed_amount, 2) THEN
        RAISE EXCEPTION 'guest_invalid_payment_amount';
    END IF;
    IF p_signature_verified IS NOT TRUE
       OR p_amount_verified IS NOT TRUE
       OR p_currency_verified IS NOT TRUE
       OR p_final_status_verified IS NOT TRUE
       OR NOT public.guest_shop_payment_is_final_success(v_status) THEN
        RAISE EXCEPTION 'guest_payment_verification_required';
    END IF;

    -- Resolve the order before taking the payment lock.  All guest state
    -- transitions use order -> payment -> reservation -> inventory ordering.
    SELECT p.guest_order_id
    INTO v_order_id
    FROM public.guest_shop_payment_orders p
    WHERE p.id = p_payment_order_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'guest_payment_order_not_found';
    END IF;

    SELECT * INTO v_order
    FROM public.guest_shop_orders o
    WHERE o.id = v_order_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'guest_order_not_found';
    END IF;

    SELECT * INTO v_payment
    FROM public.guest_shop_payment_orders p
    WHERE p.id = p_payment_order_id
    FOR UPDATE;
    IF NOT FOUND OR v_payment.guest_order_id <> v_order.id THEN
        RAISE EXCEPTION 'guest_payment_order_mismatch';
    END IF;

    IF v_payment.provider <> v_provider
       OR v_payment.merchant_order_no <> v_order.order_no
       OR v_payment.purpose <> v_purpose
       OR v_payment.site <> v_site
       OR v_payment.currency <> v_currency
       OR v_payment.expected_amount <> p_observed_amount THEN
        RAISE EXCEPTION 'guest_payment_binding_mismatch';
    END IF;
    IF v_payment.provider_order_no IS NOT NULL
       AND v_payment.provider_order_no <> v_provider_order_no THEN
        RAISE EXCEPTION 'guest_provider_order_conflict';
    END IF;

    IF p_event_id IS NOT NULL THEN
        SELECT * INTO v_event
        FROM public.guest_shop_payment_events e
        WHERE e.id = p_event_id
        FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'guest_payment_event_not_found';
        END IF;
        IF v_event.payment_order_id IS DISTINCT FROM p_payment_order_id
           OR LOWER(BTRIM(v_event.provider)) <> v_provider
           OR v_event.provider_order_no IS DISTINCT FROM v_provider_order_no
           OR v_event.merchant_order_no IS DISTINCT FROM v_payment.merchant_order_no
           OR v_event.observed_site IS DISTINCT FROM v_site
           OR v_event.observed_currency IS DISTINCT FROM v_currency
           OR v_event.observed_amount IS DISTINCT FROM p_observed_amount
           OR v_event.observed_purpose IS DISTINCT FROM v_purpose
           OR LOWER(BTRIM(COALESCE(v_event.observed_status, ''))) <> v_status
           OR v_event.signature_verified IS NOT TRUE
           OR v_event.amount_verified IS NOT TRUE
           OR v_event.currency_verified IS NOT TRUE
           OR v_event.final_status_verified IS NOT TRUE THEN
            RAISE EXCEPTION 'guest_payment_event_binding_mismatch';
        END IF;

        -- A provider retry for the same event is a no-op.  The event is
        -- already bound to this payment and the state below is authoritative.
        IF v_event.processing_status IN ('processed', 'duplicate') THEN
            v_event_status := v_event.processing_status;
            RETURN QUERY
            SELECT
                v_payment.status = 'confirmed',
                v_order.id,
                v_payment.id,
                v_payment.status,
                v_order.fulfillment_status,
                v_order.reservation_status,
                v_order.refund_status,
                v_event_status;
            RETURN;
        END IF;
        IF v_event.processing_status IN ('rejected', 'dead_letter') THEN
            RAISE EXCEPTION 'guest_payment_event_not_processable';
        END IF;
        IF v_event.processing_status <> 'verified' THEN
            RAISE EXCEPTION 'guest_payment_event_not_verified';
        END IF;
    END IF;

    -- A refund/chargeback is terminal for fulfillment.  Mark the event as a
    -- duplicate rather than reviving a paid order or consuming stock again.
    IF v_payment.status IN ('refunded', 'chargeback')
       OR v_order.payment_status IN ('refunded', 'chargeback') THEN
        v_confirmed := false;
        v_event_status := 'duplicate';
        IF p_event_id IS NOT NULL THEN
            UPDATE public.guest_shop_payment_events
            SET processing_status = 'duplicate',
                processed_at = COALESCE(processed_at, v_now),
                updated_at = v_now
            WHERE id = p_event_id;
        END IF;
        RETURN QUERY
        SELECT v_confirmed, v_order.id, v_payment.id, v_payment.status,
               v_order.fulfillment_status, v_order.reservation_status,
               v_order.refund_status, v_event_status;
        RETURN;
    END IF;

    -- Bind the provider order number before setting confirmed.  The partial
    -- unique index on (provider, provider_order_no) rejects cross-order reuse.
    UPDATE public.guest_shop_payment_orders
    SET provider_order_no = v_provider_order_no,
        paid_amount = p_observed_amount,
        sign_verified = true,
        amount_verified = true,
        currency_verified = true,
        final_status_verified = true,
        status = 'confirmed',
        paid_at = COALESCE(paid_at, v_now),
        verified_at = COALESCE(verified_at, v_now),
        last_event_at = v_now,
        last_error_code = NULL,
        last_error_message = NULL,
        updated_at = v_now
    WHERE id = v_payment.id;

    -- Lock the whole reservation set before reading it. Aggregates cannot be
    -- combined with a locking clause in PostgreSQL, so the lock and the count
    -- are two statements; both are safe because the order row lock taken above
    -- already serializes every guest transition for this order.
    PERFORM 1
    FROM public.guest_shop_inventory_reservations r
    WHERE r.order_id = v_order.id
    FOR UPDATE;

    SELECT COUNT(*),
           COUNT(*) FILTER (WHERE r.status = 'held'),
           COUNT(*) FILTER (WHERE r.status = 'consumed')
    INTO v_res_total, v_res_held, v_res_consumed
    FROM public.guest_shop_inventory_reservations r
    WHERE r.order_id = v_order.id;

    -- Consumed is a terminal stock transition. A retry that arrives after the
    -- order TTL must remain successful/idempotent and must never downgrade an
    -- already delivered order to paid_unfulfillable.
    IF v_res_total = 0 THEN
        -- Nothing was ever reserved. The buyer paid for stock that does not
        -- exist, so this is the refund path, not the fulfillment path.
        v_late_success := true;
        v_release_reason := 'payment_confirmed_no_reservation';
    ELSIF v_res_consumed > 0 THEN
        -- At least one card has already been handed over, which means a previous
        -- confirm already ran (claim requires payment_status = 'confirmed').
        -- Never release a delivered card and never rewind the order: just
        -- re-assert confirmed and refresh the rollup.
        UPDATE public.guest_shop_orders
        SET payment_status = 'confirmed',
            paid_at = COALESCE(paid_at, v_now),
            reservation_status = public.guest_shop_reservation_rollup(v_order.id),
            updated_at = v_now
        WHERE id = v_order.id;
    ELSE
        IF v_res_held <> v_res_total OR v_order.expires_at <= v_now THEN
            -- Some row was already released by the TTL sweep, or the order TTL
            -- itself has passed. Either way the buyer cannot be served in full.
            v_late_success := true;
            v_release_reason := CASE
                WHEN v_order.expires_at <= v_now THEN 'payment_confirmed_after_expiry'
                ELSE 'payment_confirmed_reservation_lost'
            END;
        ELSE
            -- Every row is held and the order is still inside its TTL, so each
            -- held card must still be a non-shared 'reserve' inventory row. One
            -- lost card is enough: a partial delivery would be a partial refund
            -- dispute, so the whole order goes to the refund queue instead.
            SELECT COUNT(*)
            INTO v_res_lost_inventory
            FROM public.guest_shop_inventory_reservations r
            LEFT JOIN public.shop_inventory i ON i.id = r.inventory_id
            WHERE r.order_id = v_order.id
              AND r.status = 'held'
              AND (
                  i.id IS NULL
                  OR i.status <> 'reserve'
                  OR COALESCE(i.is_shared, false)
              );
            IF v_res_lost_inventory > 0 THEN
                v_late_success := true;
                v_release_reason := 'payment_confirmed_inventory_not_reservable';
            END IF;
        END IF;

        IF v_late_success THEN
            -- Release ALL held cards, not just the offending one. The helper
            -- re-locks and re-checks each inventory row before flipping it.
            PERFORM public.guest_shop_release_held_reservations(v_order.id, v_release_reason);

            UPDATE public.guest_shop_orders
            SET payment_status = 'confirmed',
                paid_at = COALESCE(paid_at, v_now),
                reservation_status = public.guest_shop_reservation_rollup(v_order.id),
                fulfillment_status = CASE
                    WHEN v_order.fulfillment_status IN ('delivered', 'refunded') THEN v_order.fulfillment_status
                    ELSE 'paid_unfulfillable'
                END,
                refund_status = CASE
                    WHEN v_order.refund_status = 'succeeded' THEN v_order.refund_status
                    ELSE 'pending'
                END,
                last_error_code = CASE
                    WHEN v_order.fulfillment_status IN ('delivered', 'refunded') THEN last_error_code
                    ELSE 'paid_inventory_not_reservable'
                END,
                last_error_message = CASE
                    WHEN v_order.fulfillment_status IN ('delivered', 'refunded') THEN last_error_message
                    ELSE 'payment confirmed after reservation expiry or inventory loss'
                END,
                updated_at = v_now
            WHERE id = v_order.id;
        ELSE
            UPDATE public.guest_shop_orders
            SET payment_status = 'confirmed',
                paid_at = COALESCE(paid_at, v_now),
                updated_at = v_now
            WHERE id = v_order.id;
        END IF;
    END IF;

    IF p_event_id IS NOT NULL THEN
        UPDATE public.guest_shop_payment_events
        SET processing_status = 'processed',
            processed_at = COALESCE(processed_at, v_now),
            updated_at = v_now
        WHERE id = p_event_id;
    END IF;

    RETURN QUERY
    SELECT v_confirmed, o.id, p.id, p.status, o.fulfillment_status,
           o.reservation_status, o.refund_status,
           CASE WHEN p_event_id IS NULL THEN NULL ELSE v_event_status END
    FROM public.guest_shop_orders o
    JOIN public.guest_shop_payment_orders p ON p.guest_order_id = o.id
    WHERE o.id = v_order.id;
END;
$$;

-- 7.2 fn_guest_shop_claim_fulfillment: deterministic per-card claim.
CREATE OR REPLACE FUNCTION public.fn_guest_shop_claim_fulfillment(
    p_order_id UUID,
    p_reservation_id UUID DEFAULT NULL
)
RETURNS TABLE (
    order_id UUID,
    reservation_id UUID,
    inventory_id UUID,
    content TEXT,
    fulfillment_status TEXT,
    reservation_status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order public.guest_shop_orders%ROWTYPE;
    v_reservation public.guest_shop_inventory_reservations%ROWTYPE;
    v_inventory public.shop_inventory%ROWTYPE;
    v_inventory_found BOOLEAN;
    -- L1/L2: order-level rollup over the reservation set.
    v_res_total INTEGER := 0;
    v_res_held INTEGER := 0;
    v_res_consumed INTEGER := 0;
    v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
    PERFORM public.guest_shop_require_service_role();
    IF p_order_id IS NULL THEN
        RAISE EXCEPTION 'guest_order_required';
    END IF;

    SELECT * INTO v_order
    FROM public.guest_shop_orders o
    WHERE o.id = p_order_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'guest_order_not_found';
    END IF;
    IF v_order.payment_status <> 'confirmed'
       OR v_order.payment_status IN ('refunded', 'chargeback')
       OR v_order.refund_status IN ('succeeded', 'manual_review')
       OR v_order.fulfillment_status IN ('paid_unfulfillable', 'refunded', 'dead_letter') THEN
        RAISE EXCEPTION 'guest_payment_not_fulfillable';
    END IF;

    -- L1/L2: with N rows per order a NULL p_reservation_id must still resolve to
    -- exactly ONE row, and it must resolve to the same kind of row on every
    -- retry. Held rows sort first so the worker always consumes a live card
    -- before it can pick up a released one; created_at, id then gives a stable
    -- order. Without this the worker could be handed the same card twice and
    -- leave the others unconsumed, which is stock sold but never delivered.
    SELECT * INTO v_reservation
    FROM public.guest_shop_inventory_reservations r
    WHERE r.order_id = p_order_id
      AND (p_reservation_id IS NULL OR r.id = p_reservation_id)
    ORDER BY (r.status = 'held') DESC, r.created_at ASC, r.id ASC
    LIMIT 1
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'guest_reservation_not_found';
    END IF;
    IF p_reservation_id IS NOT NULL AND v_reservation.id <> p_reservation_id THEN
        RAISE EXCEPTION 'guest_reservation_order_mismatch';
    END IF;

    IF v_reservation.status = 'consumed' THEN
        SELECT * INTO v_inventory
        FROM public.shop_inventory i
        WHERE i.id = v_reservation.inventory_id
        FOR UPDATE;
        IF NOT FOUND OR v_inventory.status <> 'sold' OR COALESCE(v_inventory.is_shared, false) THEN
            RAISE EXCEPTION 'guest_consumed_inventory_inconsistent';
        END IF;
        RETURN QUERY SELECT
            v_order.id, v_reservation.id, v_inventory.id, v_inventory.content,
            v_order.fulfillment_status, v_reservation.status;
        RETURN;
    END IF;

    IF v_reservation.status <> 'held' THEN
        -- Released rows are terminal.  Do not try to find replacement stock.
        RETURN QUERY SELECT
            v_order.id, v_reservation.id, v_reservation.inventory_id, NULL::TEXT,
            v_order.fulfillment_status, v_reservation.status;
        RETURN;
    END IF;

    SELECT * INTO v_inventory
    FROM public.shop_inventory i
    WHERE i.id = v_reservation.inventory_id
    FOR UPDATE;

    v_inventory_found := FOUND;

    IF v_order.expires_at <= v_now
       OR v_reservation.reserved_until <= v_now
       OR NOT v_inventory_found
       OR (v_inventory_found AND (v_inventory.status <> 'reserve'
           OR COALESCE(v_inventory.is_shared, false))) THEN
        -- Do not raise after writing this state: an exception would roll the
        -- paid_unfulfillable marker back and make the refund queue blind.
        IF v_inventory_found AND v_inventory.status = 'reserve' AND NOT COALESCE(v_inventory.is_shared, false) THEN
            UPDATE public.shop_inventory
            SET status = 'available'
            WHERE id = v_inventory.id
              AND status = 'reserve'
              AND COALESCE(is_shared, false) = false;
        END IF;
        UPDATE public.guest_shop_inventory_reservations
        SET status = 'released',
            released_at = COALESCE(released_at, v_now),
            release_reason = CASE
                WHEN v_order.expires_at <= v_now OR v_reservation.reserved_until <= v_now
                    THEN 'paid_reservation_expired'
                ELSE 'paid_inventory_not_reservable'
            END,
            updated_at = v_now
        WHERE id = v_reservation.id
          AND status = 'held';
        -- One card of a multi-card order is gone, so the order can never be
        -- delivered in full. Release the remaining held cards too before the
        -- refund queue picks this order up, then roll the order status up from
        -- the surviving rows instead of asserting a literal.
        PERFORM public.guest_shop_release_held_reservations(v_order.id, 'paid_order_partial_stock_loss');
        UPDATE public.guest_shop_orders
        SET reservation_status = public.guest_shop_reservation_rollup(v_order.id),
            fulfillment_status = 'paid_unfulfillable',
            refund_status = CASE
                WHEN v_order.refund_status = 'succeeded' THEN v_order.refund_status
                ELSE 'pending'
            END,
            last_error_code = 'paid_inventory_not_reservable',
            last_error_message = 'payment confirmed but held inventory expired or was lost',
            updated_at = v_now
        WHERE id = v_order.id;
        RETURN QUERY SELECT
            v_order.id, v_reservation.id, v_reservation.inventory_id, NULL::TEXT,
            'paid_unfulfillable'::TEXT, 'released'::TEXT;
        RETURN;
    END IF;

    UPDATE public.shop_inventory
    SET status = 'sold',
        sold_at = COALESCE(sold_at, v_now),
        buyer_id = NULL
    WHERE id = v_inventory.id
      AND status = 'reserve'
      AND COALESCE(is_shared, false) = false;
    IF NOT FOUND THEN
        -- The row changed despite the lock only if an out-of-band trigger or
        -- manual operation violated the state contract.  Persist a visible
        -- compensation state rather than throwing it away in a rollback.
        UPDATE public.guest_shop_inventory_reservations
        SET status = 'released',
            released_at = COALESCE(released_at, v_now),
            release_reason = 'paid_inventory_update_race',
            updated_at = v_now
        WHERE id = v_reservation.id
          AND status = 'held';
        PERFORM public.guest_shop_release_held_reservations(v_order.id, 'paid_inventory_update_race');
        UPDATE public.guest_shop_orders
        SET reservation_status = public.guest_shop_reservation_rollup(v_order.id),
            fulfillment_status = 'paid_unfulfillable',
            refund_status = CASE WHEN v_order.refund_status = 'succeeded' THEN v_order.refund_status ELSE 'pending' END,
            last_error_code = 'paid_inventory_update_race',
            last_error_message = 'inventory could not be consumed after payment confirmation',
            updated_at = v_now
        WHERE id = v_order.id;
        RETURN QUERY SELECT
            v_order.id, v_reservation.id, v_reservation.inventory_id, NULL::TEXT,
            'paid_unfulfillable'::TEXT, 'released'::TEXT;
        RETURN;
    END IF;

    UPDATE public.guest_shop_inventory_reservations
    SET status = 'consumed',
        consumed_at = COALESCE(consumed_at, v_now),
        updated_at = v_now
    WHERE id = v_reservation.id
      AND status = 'held';
    IF NOT FOUND THEN
        -- This should be impossible under the reservation lock, but leave a
        -- compensatable state if a future trigger changes the row semantics.
        PERFORM public.guest_shop_release_held_reservations(v_order.id, 'guest_reservation_update_race');
        UPDATE public.guest_shop_orders
        SET reservation_status = public.guest_shop_reservation_rollup(v_order.id),
            fulfillment_status = 'paid_unfulfillable',
            refund_status = CASE WHEN v_order.refund_status = 'succeeded' THEN v_order.refund_status ELSE 'pending' END,
            last_error_code = 'guest_reservation_update_race',
            last_error_message = 'reservation could not be consumed after inventory sale',
            updated_at = v_now
        WHERE id = v_order.id;
        RETURN QUERY SELECT
            v_order.id, v_reservation.id, v_reservation.inventory_id, NULL::TEXT,
            'paid_unfulfillable'::TEXT, v_reservation.status;
        RETURN;
    END IF;

    -- Order-level rollup. reservation_status is now an aggregate: 'held' while
    -- any card is still waiting, 'consumed' only once every card has been handed
    -- over. fulfillment_status stays 'fulfilling' until
    -- fn_guest_shop_mark_fulfilled sees the whole set consumed and writes
    -- 'delivered', so a 1-of-3 delivery can never claim to be finished.
    UPDATE public.guest_shop_orders
    SET reservation_status = public.guest_shop_reservation_rollup(v_order.id),
        fulfillment_status = CASE
            WHEN v_order.fulfillment_status = 'delivered' THEN v_order.fulfillment_status
            ELSE 'fulfilling'
        END,
        updated_at = v_now
    WHERE id = v_order.id
      AND payment_status = 'confirmed';

    RETURN QUERY SELECT
        v_order.id, v_reservation.id, v_inventory.id, v_inventory.content,
        (SELECT o.fulfillment_status FROM public.guest_shop_orders o WHERE o.id = v_order.id),
        'consumed'::TEXT;
END;
$$;

-- 7.3 fn_guest_shop_mark_fulfilled: delivered only when ALL cards are gone.
CREATE OR REPLACE FUNCTION public.fn_guest_shop_mark_fulfilled(
    p_order_id UUID,
    p_reservation_id UUID DEFAULT NULL
)
RETURNS TABLE (
    fulfilled BOOLEAN,
    order_id UUID,
    reservation_id UUID,
    fulfillment_status TEXT,
    fulfilled_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order public.guest_shop_orders%ROWTYPE;
    -- L1/L2: mark_fulfilled is an ORDER-level transition, so the single
    -- reservation rowtype and its inventory probe are replaced by set state.
    v_res_total INTEGER := 0;
    v_res_consumed INTEGER := 0;
    v_res_ids UUID[] := ARRAY[]::UUID[];
    v_res_inventory_ids UUID[] := ARRAY[]::UUID[];
    v_reservation_id UUID;
    v_fulfilled_at TIMESTAMPTZ;
BEGIN
    PERFORM public.guest_shop_require_service_role();
    IF p_order_id IS NULL THEN
        RAISE EXCEPTION 'guest_order_required';
    END IF;

    SELECT * INTO v_order
    FROM public.guest_shop_orders
    WHERE id = p_order_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'guest_order_not_found';
    END IF;
    IF v_order.payment_status <> 'confirmed'
       OR v_order.payment_status IN ('refunded', 'chargeback')
       OR v_order.refund_status IN ('succeeded', 'manual_review')
       OR v_order.fulfillment_status IN ('paid_unfulfillable', 'refunded', 'dead_letter') THEN
        RAISE EXCEPTION 'guest_payment_not_confirmed';
    END IF;

    -- p_reservation_id is kept for signature compatibility only. It proves the
    -- caller is talking about this order; it must NOT narrow the delivered
    -- decision, otherwise claiming one card of three would mark the whole order
    -- delivered and the buyer would never receive the other two.
    IF p_reservation_id IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM public.guest_shop_inventory_reservations r
        WHERE r.id = p_reservation_id
          AND r.order_id = p_order_id
    ) THEN
        RAISE EXCEPTION 'guest_reservation_order_mismatch';
    END IF;

    PERFORM 1
    FROM public.guest_shop_inventory_reservations r
    WHERE r.order_id = p_order_id
    FOR UPDATE;

    SELECT COUNT(*),
           COUNT(*) FILTER (WHERE r.status = 'consumed'),
           COALESCE(array_agg(r.id ORDER BY r.created_at ASC, r.id ASC), ARRAY[]::UUID[]),
           COALESCE(array_agg(r.inventory_id ORDER BY r.created_at ASC, r.id ASC), ARRAY[]::UUID[])
    INTO v_res_total, v_res_consumed, v_res_ids, v_res_inventory_ids
    FROM public.guest_shop_inventory_reservations r
    WHERE r.order_id = p_order_id;

    IF v_res_total = 0 THEN
        RAISE EXCEPTION 'guest_reservation_not_found';
    END IF;
    IF v_res_consumed <> v_res_total THEN
        -- Any held or released row means the order is not fully handed over.
        RAISE EXCEPTION 'guest_reservation_not_consumed';
    END IF;

    PERFORM 1
    FROM public.shop_inventory i
    WHERE i.id = ANY (v_res_inventory_ids)
    FOR UPDATE;

    -- Every consumed card must be a sold, non-shared inventory row. LEFT JOIN so
    -- a missing inventory row counts as inconsistent instead of being skipped.
    IF EXISTS (
        SELECT 1
        FROM public.guest_shop_inventory_reservations r
        LEFT JOIN public.shop_inventory i ON i.id = r.inventory_id
        WHERE r.order_id = p_order_id
          AND (i.id IS NULL OR i.status <> 'sold' OR COALESCE(i.is_shared, false))
    ) THEN
        RAISE EXCEPTION 'guest_inventory_not_sold';
    END IF;

    v_reservation_id := COALESCE(p_reservation_id, v_res_ids[1]);

    IF v_order.fulfillment_status = 'delivered' THEN
        RETURN QUERY SELECT
            true,
            p_order_id,
            v_reservation_id,
            v_order.fulfillment_status,
            v_order.fulfilled_at;
        RETURN;
    END IF;

    v_fulfilled_at := COALESCE(v_order.fulfilled_at, clock_timestamp());
    UPDATE public.guest_shop_orders o
    SET fulfillment_status = 'delivered',
        fulfilled_at = v_fulfilled_at,
        updated_at = clock_timestamp()
    WHERE o.id = p_order_id
      AND o.payment_status = 'confirmed'
      AND o.fulfillment_status <> 'delivered';

    RETURN QUERY SELECT
        true,
        p_order_id,
        v_reservation_id,
        'delivered'::TEXT,
        v_fulfilled_at;
END;
$$;

-- 7.4 fn_guest_shop_release_reservation: aggregate order rollup.
CREATE OR REPLACE FUNCTION public.fn_guest_shop_release_reservation(
    p_reservation_id UUID,
    p_order_id UUID,
    p_reason TEXT DEFAULT 'expired'
)
RETURNS TABLE (
    released BOOLEAN,
    reservation_status TEXT,
    payment_status TEXT,
    fulfillment_status TEXT,
    refund_status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order public.guest_shop_orders%ROWTYPE;
    v_reservation public.guest_shop_inventory_reservations%ROWTYPE;
    v_inventory_status TEXT;
    v_released BOOLEAN := false;
    v_reason TEXT := LEFT(COALESCE(NULLIF(BTRIM(p_reason), ''), 'expired'), 120);
BEGIN
    PERFORM public.guest_shop_require_service_role();
    IF p_reservation_id IS NULL OR p_order_id IS NULL THEN
        RAISE EXCEPTION 'guest_reservation_and_order_required';
    END IF;

    -- State-transition functions consistently lock order -> reservation ->
    -- inventory, which prevents release/consume races from deadlocking.
    SELECT * INTO v_order
    FROM public.guest_shop_orders
    WHERE id = p_order_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'guest_order_not_found';
    END IF;

    SELECT * INTO v_reservation
    FROM public.guest_shop_inventory_reservations
    WHERE id = p_reservation_id
    FOR UPDATE;
    IF NOT FOUND OR v_reservation.order_id <> p_order_id THEN
        RAISE EXCEPTION 'guest_reservation_order_mismatch';
    END IF;

    IF v_reservation.status = 'held' THEN
        SELECT i.status INTO v_inventory_status
        FROM public.shop_inventory i
        WHERE i.id = v_reservation.inventory_id
        FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'guest_inventory_not_found';
        END IF;

        IF v_inventory_status = 'reserve' THEN
            UPDATE public.shop_inventory
            SET status = 'available'
            WHERE id = v_reservation.inventory_id
              AND status = 'reserve';
            v_released := true;
        END IF;

        UPDATE public.guest_shop_inventory_reservations
        SET status = 'released',
            released_at = clock_timestamp(),
            release_reason = v_reason,
            updated_at = clock_timestamp()
        WHERE id = v_reservation.id
          AND order_id = p_order_id
          AND status = 'held';

        IF v_order.payment_status = 'confirmed' THEN
            -- Paid, and this card is gone: the order can never be delivered in
            -- full, so release every remaining held card as well. Leaving them
            -- held would pin stock that the refund queue is about to give up on.
            -- Also performs the idempotent discount/budget return for this order.
            PERFORM public.guest_shop_release_held_reservations(p_order_id, 'paid_order_partial_stock_loss');
            UPDATE public.guest_shop_orders
            SET reservation_status = public.guest_shop_reservation_rollup(p_order_id),
                fulfillment_status = 'paid_unfulfillable',
                refund_status = CASE
                    WHEN v_order.refund_status = 'succeeded' THEN v_order.refund_status
                    ELSE 'pending'
                END,
                last_error_code = CASE
                    WHEN v_released THEN last_error_code
                    ELSE 'paid_inventory_not_reservable'
                END,
                last_error_message = CASE
                    WHEN v_released THEN last_error_message
                    ELSE 'payment confirmed but inventory was not in reserve state'
                END,
                updated_at = clock_timestamp()
            WHERE id = p_order_id;
        ELSE
            -- Unpaid. Only roll the order up: the sibling cards of a multi-card
            -- order may still be inside their TTL, and forcing 'released' here
            -- would hide rows that the TTL sweep still has to process.
            UPDATE public.guest_shop_orders
            SET reservation_status = public.guest_shop_reservation_rollup(p_order_id),
                last_error_code = NULL,
                last_error_message = NULL,
                updated_at = clock_timestamp()
            WHERE id = p_order_id;

            -- Once the LAST held card of an unpaid order is gone the order can
            -- never be paid, so its reserved discount quota and daily budget are
            -- returned. Not before: with a sibling still inside its TTL the buyer
            -- can still pay, and returning the budget early would let the same
            -- money be spent twice. Idempotent, so a repeated sweep is a no-op.
            IF (SELECT o.reservation_status FROM public.guest_shop_orders o WHERE o.id = p_order_id) = 'released' THEN
                PERFORM public.fn_guest_shop_return_discount_reservation(p_order_id, v_reason);
            END IF;
        END IF;
    ELSE
        -- Releasing an already released/consumed row is idempotent.  A consumed
        -- row is never rewound to available, even for a repeated expiry job.
        v_released := v_reservation.status = 'released';
    END IF;

    RETURN QUERY SELECT
        v_released,
        (SELECT r.status FROM public.guest_shop_inventory_reservations r WHERE r.id = p_reservation_id),
        (SELECT o.payment_status FROM public.guest_shop_orders o WHERE o.id = p_order_id),
        (SELECT o.fulfillment_status FROM public.guest_shop_orders o WHERE o.id = p_order_id),
        (SELECT o.refund_status FROM public.guest_shop_orders o WHERE o.id = p_order_id);
END;
$$;

-- 7.5 fn_guest_shop_list_delivered_content: read-only delivery view.
-- Read-only delivery view for a FINISHED multi-card guest order.
--
-- The claim page needs every card of the order, in a stable order, and it must
-- not be able to read a card that has not actually been handed over. This
-- function therefore refuses unless the order is payment-confirmed, marked
-- delivered, and every one of its reservations is consumed against a sold
-- non-shared inventory row. It changes no state, so it is safe to call on every
-- page load and safe to retry.
CREATE OR REPLACE FUNCTION public.fn_guest_shop_list_delivered_content(
    p_order_id UUID
)
RETURNS TABLE (
    reservation_id UUID,
    item_index INTEGER,
    content TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order public.guest_shop_orders%ROWTYPE;
    v_total INTEGER := 0;
    v_consumed INTEGER := 0;
    v_inconsistent INTEGER := 0;
BEGIN
    PERFORM public.guest_shop_require_service_role();
    IF p_order_id IS NULL THEN
        RAISE EXCEPTION 'guest_order_required';
    END IF;

    SELECT * INTO v_order
    FROM public.guest_shop_orders o
    WHERE o.id = p_order_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'guest_order_not_found';
    END IF;
    IF v_order.payment_status <> 'confirmed'
       OR v_order.payment_status IN ('refunded', 'chargeback') THEN
        RAISE EXCEPTION 'guest_payment_not_confirmed';
    END IF;
    IF v_order.fulfillment_status <> 'delivered' THEN
        RAISE EXCEPTION 'guest_order_not_delivered';
    END IF;

    SELECT COUNT(*),
           COUNT(*) FILTER (WHERE r.status = 'consumed')
    INTO v_total, v_consumed
    FROM public.guest_shop_inventory_reservations r
    WHERE r.order_id = p_order_id;
    IF v_total = 0 OR v_consumed <> v_total THEN
        RAISE EXCEPTION 'guest_reservation_not_consumed';
    END IF;

    SELECT COUNT(*)
    INTO v_inconsistent
    FROM public.guest_shop_inventory_reservations r
    LEFT JOIN public.shop_inventory i ON i.id = r.inventory_id
    WHERE r.order_id = p_order_id
      AND (i.id IS NULL OR i.status <> 'sold' OR COALESCE(i.is_shared, false));
    IF v_inconsistent > 0 THEN
        RAISE EXCEPTION 'guest_consumed_inventory_inconsistent';
    END IF;

    RETURN QUERY
    SELECT r.id,
           (ROW_NUMBER() OVER (ORDER BY r.created_at ASC, r.id ASC))::INTEGER,
           i.content
    FROM public.guest_shop_inventory_reservations r
    JOIN public.shop_inventory i ON i.id = r.inventory_id
    WHERE r.order_id = p_order_id
    ORDER BY r.created_at ASC, r.id ASC;
END;
$$;

COMMENT ON FUNCTION public.fn_guest_shop_list_delivered_content(UUID) IS
    'Returns every delivered card of a finished guest order, ordered by reservation creation. service_role only; read-only.';


-- ---------------------------------------------------------------------------
-- §8. Privileges.
--
--    Every function this file creates or replaces is service_role only. The
--    REVOKE is re-emitted even for the functions whose signature did not change,
--    because CREATE OR REPLACE keeps the previous ACL and an operator who ever
--    granted EXECUTE to anon by hand would otherwise keep that grant forever.
--    These functions read card content, buyer hashes and money columns; anon or
--    authenticated EXECUTE on any of them would be a full guest-shop bypass,
--    because each one only checks auth.role() = 'service_role' at runtime and
--    relies on the grant layer to keep browsers away.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.fn_guest_shop_evaluate_discount(TEXT, UUID, UUID, INTEGER, NUMERIC, TEXT, UUID, TEXT, TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_guest_shop_evaluate_discount(TEXT, UUID, UUID, INTEGER, NUMERIC, TEXT, UUID, TEXT, TEXT, INTEGER, INTEGER) TO service_role;
REVOKE ALL ON FUNCTION public.fn_guest_shop_reserve_discount(TEXT, UUID, UUID, INTEGER, NUMERIC, TEXT, UUID, TEXT, TEXT, TEXT, UUID, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_guest_shop_reserve_discount(TEXT, UUID, UUID, INTEGER, NUMERIC, TEXT, UUID, TEXT, TEXT, TEXT, UUID, INTEGER, INTEGER) TO service_role;
REVOKE ALL ON FUNCTION public.fn_guest_shop_create_order(TEXT, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, INTEGER, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_guest_shop_create_order(TEXT, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, INTEGER, INTEGER, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.fn_guest_shop_confirm_payment(UUID, UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_guest_shop_confirm_payment(UUID, UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN) TO service_role;
REVOKE ALL ON FUNCTION public.fn_guest_shop_claim_fulfillment(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_guest_shop_claim_fulfillment(UUID, UUID) TO service_role;
REVOKE ALL ON FUNCTION public.fn_guest_shop_mark_fulfilled(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_guest_shop_mark_fulfilled(UUID, UUID) TO service_role;
REVOKE ALL ON FUNCTION public.fn_guest_shop_release_reservation(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_guest_shop_release_reservation(UUID, UUID, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.guest_shop_reservation_rollup(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guest_shop_reservation_rollup(UUID) TO service_role;
REVOKE ALL ON FUNCTION public.guest_shop_release_held_reservations(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guest_shop_release_held_reservations(UUID, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.fn_guest_shop_list_delivered_content(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_guest_shop_list_delivered_content(UUID) TO service_role;
REVOKE ALL ON FUNCTION public.guest_shop_promo_gate(TEXT, NUMERIC) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guest_shop_promo_gate(TEXT, NUMERIC) TO service_role;
REVOKE ALL ON FUNCTION public.fn_guest_shop_return_discount_reservation(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_guest_shop_return_discount_reservation(UUID, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.fn_guest_shop_promo_record_event(TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_guest_shop_promo_record_event(TEXT, TEXT, JSONB) TO service_role;
REVOKE ALL ON FUNCTION public.fn_guest_shop_promo_set_breaker(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_guest_shop_promo_set_breaker(TEXT, TEXT, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.fn_guest_shop_promo_status() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_guest_shop_promo_status() TO service_role;

-- The old 13-parameter create_order overload was dropped in §6. Belt and
-- braces: if a stale overload somehow survives (for example because it was
-- recreated by hand after 20260920), remove its browser grants too. This is a
-- no-op when the function does not exist.
DO $$
DECLARE
    v_sig TEXT;
BEGIN
    FOREACH v_sig IN ARRAY ARRAY[
        'public.fn_guest_shop_create_order(TEXT, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER)',
        'public.fn_guest_shop_create_order(TEXT, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, INTEGER)'
    ]
    LOOP
        BEGIN
            EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_sig);
        EXCEPTION WHEN undefined_function THEN
            NULL;
        END;
    END LOOP;
END;
$$;

-- Fail closed if ANY guest-shop function is still executable by a browser role.
-- The migration aborts rather than shipping a privilege hole; the message names
-- the offending function so the fix is obvious.
DO $$
DECLARE
    v_bad TEXT;
BEGIN
    SELECT string_agg(DISTINCT p.proname || '(' || COALESCE(pg_get_function_identity_arguments(p.oid), '') || ') -> ' || g.grantee, ', ')
    INTO v_bad
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS g
    WHERE n.nspname = 'public'
      AND p.proname LIKE '%guest_shop%'
      AND g.grantee::TEXT IN ('anon', 'authenticated', 'PUBLIC')
      AND g.privilege_type = 'EXECUTE';
    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'guest_shop_privilege_leak: %', v_bad;
    END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- §9. Operator notes.
--
--    APPLYING THIS FILE
--      1. Codex does not execute SQL. This file and its verify counterpart are
--         handed over as absolute paths and run by an operator in the Supabase
--         SQL editor of the target project.
--      2. Apply AFTER 20260922_guest_shop_access_resets.sql.
--      3. Then run 20260923_verify_guest_shop_promo_l1l2.sql (23 rows). EVERY
--         row from 1 to 22 must be PASS. A single FAIL means the schema does not
--         match what the Node layer assumes, and the guest discount switch must
--         stay off. Row 23 (operator_state_review) is PASS or REVIEW BY DESIGN:
--         it prints live operator state (guest-enabled product count, switch
--         values) instead of pinning it to a constant, because opening a product
--         to guest checkout is a human decision no migration can make. A REVIEW
--         there means "a human must read the listed state and confirm it", never
--         "the migration broke". Confirm row 23 before raising
--         GUEST_SHOP_MAX_QUANTITY or turning on GUEST_SHOP_DISCOUNT_ENABLED.
--      4. The file is idempotent for the DDL parts (IF NOT EXISTS / DROP IF
--         EXISTS / CREATE OR REPLACE) but it is NOT re-runnable blindly once
--         guest orders with quantity > 1 exist: §2 rebuilds a unique constraint
--         and §6 drops a function signature. Re-running on a live guest shop
--         needs a maintenance window.
--
--    WHAT IS STILL OFF AFTER APPLYING
--      * No product or SKU is enabled for guest checkout here.
--      * NO discount code is guest-usable: §3.1 sets allow_guest = false and
--        guest_max_uses = 0 on every existing row, and BOTH must be opened
--        per code before a guest can redeem it. Deploying this file therefore
--        cannot expose an existing marketing code to anonymous buyers.
--      * The site daily budget is CLOSED: §3.2 seeds enabled = false and
--        daily_budget_cny = 0 for 'cn' and 'intl', and either value alone stops
--        every guest discount. There is no "unlimited budget" spelling.
--      * The breaker is seeded 'closed', which is the only state that allows
--        discounts; opening it is an operator action or an automatic trip.
--      * GUEST_SHOP_DISCOUNT_ENABLED stays off by default, so no guest order can
--        carry a discount code until an operator turns it on in the KVM4
--        verify-server environment (and recreates the container with
--        --force-recreate so env_file is re-read).
--      * GUEST_SHOP_MAX_QUANTITY stays 1 by default, so guest orders keep
--        reserving exactly one card and behave byte-identically to P0.
--      * Discount codes additionally require GUEST_SHOP_BUYER_CREDENTIAL_ENABLED,
--        because per-identity limits are counted by buyer_contact_hash and an
--        order without credentials has no stable identity to count against.
--
--    MONEY SAFETY SUMMARY
--      * The guest discount engine is always called with allow_zero_total=false.
--      * §1's amount CHECK rejects discount_amount >= list_amount, so a
--        zero-payment guest order is a hard write error, not an untested branch.
--      * §1's amount CHECK also caps discount_amount at 50% of the list amount.
--        The Node switch may be stricter; it can never be looser.
--      * Per-identity redemption limits live in the §3 ledger, keyed by
--        contact_hash and ip_hash, never by buyer_id, so rotating a guest
--        credential group cannot reset a limit.
--      * Aggregate loss is bounded FOUR ways, all enforced in the database and
--        all deducted in one transaction: per-code guest quota
--        (guest_max_uses / guest_used_count), per-code让利 cap
--        (guest_max_total_discount / guest_discount_total), per-site daily
--        budget (guest_shop_promo_budget), and the circuit breaker. The CHECK
--        constraints make an over-issued quota and an over-spent budget
--        unrepresentable even if a function body regresses.
--      * Reserved quota and budget are RETURNED when an order dies unpaid or is
--        refunded (fn_guest_shop_return_discount_reservation), idempotently, so
--        an expiry sweep cannot leak allowance and cannot double-return it.
--      * An amount mismatch burst or an identity-limit burst opens the breaker
--        automatically; closing it is always a human decision.
--      * All arithmetic happens in these functions. The HTTP layer stores
--        whatever they return and computes no amount of its own.
--
--    ROLLBACK
--      * Turning guest checkout off (product/SKU switch) is the rollback for the
--        feature. It is not a database rollback and not a Vercel-only rollback.
--      * The new columns are nullable/defaulted and the new functions are
--        additive, so an application rollback to the P0 commit keeps working
--        against this schema: P0's create_order call site passes 13 arguments,
--        which still resolves because p_quantity and p_discount_code have
--        defaults. NOTE the P0 code path writes total_amount = unit*1 + 0 and
--        never sets payment_fee_amount, which satisfies §1's CHECK.
-- ---------------------------------------------------------------------------
