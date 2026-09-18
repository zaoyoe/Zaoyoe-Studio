'use strict';

/**
 * Guest Order Access 2.0 — buyer credential resolution (A1b: the ORDER path).
 *
 * Design contract: docs/guest-shop-order-access-2.0.md
 *   §6.4   credential groups (N1 "forgot password must still be able to buy",
 *          N2 "a later buyer must never read an earlier buyer's card secrets")
 *   §8.1   double-dimension lockout, no scrypt while locked
 *   §8.4   constant-time comparison and EQUAL-COST responses
 *   §9.1   error semantics / anti-enumeration
 *   §10.1  registered_user_match is record-only and never a pricing input
 *   §6.4.5 access control uses buyer_id, promotion quota uses contact_hash
 *
 * ---------------------------------------------------------------------------
 * Why the order path needs brute-force bookkeeping at all
 * ---------------------------------------------------------------------------
 * Creating an order VERIFIES the submitted query password (that is how a
 * returning buyer is attached to the group they already own, §6.4.2 step 3),
 * so the order endpoint is a password oracle unless the observable behaviour
 * of "matched" and "did not match" is made identical.  It is:
 *
 *   groups < cap   matched      -> attach to the matched group, 201
 *   groups < cap   not matched  -> allocate a new group,          201
 *
 * Both return the same status, the same body shape and the same number of
 * scrypt operations, and the response never carries buyer_id or the group
 * number (asserted by tests/guest-shop-buyer-order-credentials.test.js).
 *
 * The ONE branch where the outcome is observable is "already at the group cap":
 *
 *   groups == cap  matched      -> attach, 201
 *   groups == cap  not matched  -> 409 guest_buyer_credential_conflict (§6.4.4)
 *
 * That difference is unavoidable — the document mandates the 409 and its
 * user-facing copy — so it is paid for instead: that branch shares the login
 * path's failure counter and exponential lock (§8.1), which bounds an attacker
 * to GUEST_SHOP_BUYER_LOGIN_MAX_FAILURES guesses per lock cycle, and the lock
 * check runs BEFORE any scrypt so a locked contact costs nothing to reject.
 * Below the cap no failure is recorded, because nothing is observable and
 * recording one would break N1 (a buyer who forgot their password would be
 * locked out of BUYING, which is a purchase wall, not a security control).
 *
 * The 409 itself is also the single deliberate information leak accepted by
 * §9.1 ("this email has ordered here before and used up 3 query passwords").
 * Card-secret cross-leak is a loss; enumeration is intelligence. Loss wins.
 */

const defaultSecurity = require('./security');
const { parseRuntimeNumericSetting } = require('./runtime-config');

const BUYER_CREDENTIAL_SWITCH = 'GUEST_SHOP_BUYER_CREDENTIAL_ENABLED';
const TRUE_VALUES = new Set(['1', 'true', 'yes', 'y', 'on', 'enabled']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'n', 'off', 'disabled']);

// Outer bound from guest_shop_buyers_group_range (BETWEEN 1 AND 5). The
// application cap K38 defaults to 3 and must never exceed this.
const BUYER_GROUP_DB_MAX = 5;

// A group that owns no order at all is only recyclable after this cooldown.
// Group resolution happens BEFORE fn_guest_shop_create_order runs, so a group
// can exist for a few seconds without its order. Recycling inside that window
// would hand an in-flight order to whoever set the new password. The cooldown
// is deliberately far longer than any create-order round trip.
const GUEST_BUYER_GROUP_RECYCLE_COOLDOWN_SECONDS = 600;

// §8.1 lock ladder. Stage 3 keeps auto-expiring after 24h on purpose: an
// attacker must never be able to lock a real buyer out permanently, and the
// admin unlock (A3) exists to clear a lock early rather than to be the only
// way out.
const BUYER_LOCK_STAGE_MINUTES = Object.freeze([15, 30, 24 * 60]);
const BUYER_LOCK_MAX_STAGE = 3;
const BUYER_FAILURE_CAS_RETRIES = 4;

// Payment states that can never become a delivered card secret, so a group
// owning only these orders protects nothing and may be recycled. Everything
// else (pending/created/review/confirmed/refunded/chargeback/partial/overpaid/
// amount_mismatch) is either still live or was paid at some point.
const TERMINAL_UNPAID_PAYMENT_STATUSES = Object.freeze(['expired', 'failed']);

// guest_shop_access_attempts.outcome CHECK values written by this module.
// The list must stay a subset of the DB CHECK in
// supabase/migrations/20260922_guest_shop_access_resets.sql section 3.
//
// The four A3 outcomes (reset_* / upgrade_*) live in ONE audit stream with the
// login outcomes on purpose: one table, one retention rule, one place to look
// during an incident. They are deliberately ABSENT from
// BUYER_ACCESS_FAILURE_OUTCOMES below. Neither A3 second factor is guessable
// (a 256-bit reset token, a 240-bit claim secret), so counting them into the
// per-IP LOGIN budget would hand an attacker a way to lock a whole shared NAT
// out of the login page by spamming invalid reset links — and would double
// count the upgrade path, whose credential failures are already recorded as
// `locked` / `credential_conflict` by resolveBuyerGroupForOrder.
const BUYER_ACCESS_OUTCOMES = Object.freeze([
    'success',
    'bad_password',
    'unknown_email',
    'locked',
    'captcha_required',
    'rate_limited',
    'credential_conflict',
    'reset_invalid',
    'reset_success',
    'upgrade_invalid',
    'upgrade_success'
]);
const BUYER_ACCESS_FAILURE_OUTCOMES = Object.freeze([
    'bad_password',
    'unknown_email',
    'locked',
    'credential_conflict'
]);

// P8 context tokens. Hard-coded on purpose: extra tokens only ever make the
// policy stricter, and deriving them from configuration would let a missing
// variable silently weaken the password policy.
const SITE_FORBIDDEN_PASSWORD_TOKENS = Object.freeze([
    'fatherkey.com',
    'zaoyoe.xyz',
    'nightjar.shop'
]);

/**
 * Named SQLSTATE tokens raised by fn_guest_shop_upsert_buyer_group and by the
 * buyer binding guard inside fn_guest_shop_create_order
 * (supabase/migrations/20260921_guest_shop_buyer_group_upsert.sql,
 *  supabase/migrations/20260920_guest_shop_buyer_credentials.sql).
 *
 * Every one of them means "the caller or the configuration is wrong", never
 * "the buyer typed something wrong", so they collapse into a single 503 with
 * expose:false. Letting them through as the raw driver error would return a 500
 * carrying a SQL token to an unauthenticated client.
 *
 * `guest_buyer_credential_conflict` is deliberately NOT here: it is the one
 * buyer-facing outcome (§9.1) and is mapped to 409 above.
 */
const BUYER_GROUP_SQL_MISCONFIG_TOKENS = Object.freeze([
    'guest_buyer_mismatch',
    'guest_buyer_contact_required',
    'guest_buyer_password_required',
    'guest_buyer_password_malformed',
    'guest_buyer_site_invalid'
]);

const BUYER_CREDENTIAL_SETTING_NAMES = Object.freeze([
    'GUEST_SHOP_BUYER_PASSWORD_MIN_LENGTH',
    'GUEST_SHOP_BUYER_CREDENTIAL_GROUP_CAP',
    'GUEST_SHOP_BUYER_LOGIN_MAX_FAILURES',
    'GUEST_SHOP_BUYER_LOGIN_WINDOW_SECONDS',
    'GUEST_SHOP_BUYER_IP_MAX_FAILURES'
]);

function securityOf(security) {
    return security && typeof security.verifyGuestQueryPassword === 'function'
        ? security
        : defaultSecurity;
}

function failMisconfigured(detail = '') {
    // expose:false — configuration problems are operator-facing, never buyer
    // facing, and must not become a database/config availability oracle.
    throw new defaultSecurity.GuestShopSecurityError(
        detail ? `游客查询凭证服务不可用：${detail}` : '游客查询凭证服务不可用',
        { statusCode: 503, code: 'guest_shop_misconfigured', expose: false }
    );
}

function failGuest(message, { statusCode = 400, code = 'guest_shop_invalid_request', field = '', expose = true } = {}) {
    throw new defaultSecurity.GuestShopSecurityError(message, { statusCode, code, field, expose });
}

function normalizeCount(value) {
    const numeric = Number(value);
    return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : 0;
}

function normalizeVersion(value) {
    const numeric = Number(value);
    return Number.isSafeInteger(numeric) && numeric >= 1 ? numeric : 1;
}

function normalizeStage(value) {
    const numeric = Number(value);
    if (!Number.isSafeInteger(numeric) || numeric < 0) return 0;
    return Math.min(BUYER_LOCK_MAX_STAGE, numeric);
}

function parseTimestamp(value) {
    if (!value) return null;
    const time = value instanceof Date ? value.getTime() : Date.parse(String(value));
    return Number.isFinite(time) ? new Date(time) : null;
}

/**
 * Strict boolean parse of the 2.0 master switch. An unparseable value is
 * reported as invalid but resolves to DISABLED: "off" is exactly today's
 * behaviour, so a typo can never half-enable credential collection. The
 * readiness gate rejects the same value before it can reach production.
 */
function parseBuyerCredentialSwitch(env = {}) {
    const raw = String(env?.[BUYER_CREDENTIAL_SWITCH] ?? '').trim().toLowerCase();
    if (!raw) return Object.freeze({ present: false, valid: true, enabled: false });
    if (TRUE_VALUES.has(raw)) return Object.freeze({ present: true, valid: true, enabled: true });
    if (FALSE_VALUES.has(raw)) return Object.freeze({ present: true, valid: true, enabled: false });
    return Object.freeze({ present: true, valid: false, enabled: false });
}

function isBuyerCredentialEnabled(env = {}) {
    return parseBuyerCredentialSwitch(env).enabled;
}

function resolveBuyerCredentialSettings(env = {}) {
    const values = {};
    for (const name of BUYER_CREDENTIAL_SETTING_NAMES) {
        const parsed = parseRuntimeNumericSetting(env, name);
        if (!parsed.valid) failMisconfigured(name);
        values[parsed.key] = parsed.value;
    }
    return Object.freeze({
        passwordMinLength: values.buyerPasswordMinLength,
        groupCap: Math.min(BUYER_GROUP_DB_MAX, Math.max(1, values.buyerCredentialGroupCap)),
        loginMaxFailures: values.buyerLoginMaxFailures,
        loginWindowSeconds: values.buyerLoginWindowSeconds,
        ipMaxFailures: values.buyerIpMaxFailures,
        recycleCooldownSeconds: GUEST_BUYER_GROUP_RECYCLE_COOLDOWN_SECONDS
    });
}

function forbiddenPasswordTokens(env = {}) {
    const tokens = new Set(SITE_FORBIDDEN_PASSWORD_TOKENS);
    for (const name of ['APP_BASE_URL', 'APP_BASE_URL_INTL', 'SITE_BASE_URL']) {
        const raw = String(env?.[name] ?? '').trim();
        if (!raw) continue;
        try {
            const host = new URL(raw).hostname.toLowerCase();
            if (host) tokens.add(host);
        } catch (_) {
            // A malformed base URL must not weaken the password policy; the
            // hard-coded tokens above still apply.
        }
    }
    return [...tokens];
}

/**
 * §6.1.4 server-authoritative strength check for the ORDER path only. It
 * throws `guest_password_weak` carrying the failing rule (P1/P2a/…/P10), which
 * is safe here because the buyer is present and no secret exists yet. The
 * query path must never call this: echoing strength information there would
 * turn a rejection into a password-quality oracle.
 */
function assertBuyerQueryPasswordStrength(password, options = {}) {
    const security = securityOf(options.security);
    const env = options.env || {};
    const settings = options.settings || resolveBuyerCredentialSettings(env);
    return security.assertGuestQueryPasswordPolicy(password, {
        minLength: settings.passwordMinLength,
        email: options.email,
        field: options.field || 'orderPassword',
        forbiddenTokens: forbiddenPasswordTokens(env)
    });
}

/**
 * The ONE definition of "what is the next password_version".
 *
 * `password_version` is the session-revocation counter: the `__Host-gs-acc`
 * cookie carries the value it was minted with, and
 * `authenticateGuestOrderAccess` re-reads the row, so moving this number kills
 * every live session of that credential group. Three writers move it — the
 * §6.2 transparent rehash below, the A3 admin reset-link issue
 * (`bumpBuyerPasswordVersion`) and the A3 password reset
 * (`applyPasswordReset`). If any of them computed the next value differently
 * two writers could land on the SAME version and one of them would silently
 * stop revoking sessions, which is why this is exported rather than inlined.
 *
 * `password_version` is SMALLINT: saturate at 32767 instead of wrapping to a
 * negative, which would re-validate every old cookie.
 */
function nextBuyerPasswordVersion(current) {
    const parsed = Number(current);
    const base = Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 1;
    return Math.min(32767, base + 1);
}

/**
 * All credential groups of one (site, contact_hash), ascending. Never more
 * than the DB cap, so the in-process sort is not a DoS surface. `order()` is
 * deliberately not used: sorting five rows in process keeps the read
 * independent of adapter support and makes the lock order deterministic.
 */
async function loadBuyerGroups({ supabase, site, contactHash }) {
    if (!supabase?.from) failMisconfigured('guest_shop_buyers 不可访问');
    if (!contactHash) failMisconfigured('contact_hash 缺失');
    const result = await supabase.from('guest_shop_buyers')
        // password_version is selected because §6.2's transparent upgrade must
        // bump it monotonically; reading it back as undefined silently pinned
        // every upgraded row to version 2.
        // merged_into_user_id is read so §10.4 account merges can retire guest
        // access fail-closed; nothing writes it until A4, and a NULL keeps the
        // group guest-accessible exactly as today.
        .select('id,credential_group_no,password_hash,password_version,failed_login_count,login_lock_stage,locked_until,merged_into_user_id')
        .eq('site', site)
        .eq('contact_hash', contactHash);
    if (result?.error) throw result.error;
    const rows = Array.isArray(result?.data) ? result.data : (result?.data ? [result.data] : []);
    return rows
        .map((row) => ({
            id: String(row?.id || ''),
            groupNo: Number(row?.credential_group_no),
            passwordHash: typeof row?.password_hash === 'string' ? row.password_hash : '',
            passwordVersion: normalizeVersion(row?.password_version),
            failedLoginCount: normalizeCount(row?.failed_login_count),
            loginLockStage: normalizeStage(row?.login_lock_stage),
            lockedUntil: parseTimestamp(row?.locked_until),
            mergedIntoUserId: row?.merged_into_user_id ? String(row.merged_into_user_id) : ''
        }))
        .filter((row) => row.id && Number.isSafeInteger(row.groupNo) && row.groupNo >= 1)
        .sort((a, b) => a.groupNo - b.groupNo);
}

/**
 * §8.1: a lock on ANY group of the contact locks the whole contact, and the
 * caller must check this BEFORE running scrypt so a locked contact is both
 * cheap to reject and free of a timing side channel.
 */
function findActiveBuyerLock(rows, now = new Date()) {
    const at = now instanceof Date ? now.getTime() : Date.now();
    for (const row of rows || []) {
        if (row.lockedUntil && row.lockedUntil.getTime() > at) return row;
    }
    return null;
}

/**
 * Equal-cost verification (§8.4). Two properties are load-bearing:
 *
 *   1. NO early exit. Stopping at the first match would make a correct
 *      password measurably faster than a wrong one.
 *   2. At least one scrypt even when the contact has no group at all, so
 *      "this email never ordered here" is not distinguishable by latency from
 *      "this email ordered here and the password was wrong".
 *
 * A row whose stored hash cannot be parsed still burns one dummy derivation:
 * a dirty row must not become a fast path.
 */
function verifyBuyerPasswordAcrossGroups(password, rows, security = defaultSecurity) {
    const sec = securityOf(security);
    const list = Array.isArray(rows) ? rows : [];
    let matched = null;
    let needsRehash = false;
    for (const row of list) {
        let result;
        if (typeof sec.parseGuestQueryPasswordHash === 'function'
            && !sec.parseGuestQueryPasswordHash(row.passwordHash).ok) {
            sec.runDummyGuestQueryPasswordVerification();
            result = { ok: false, needsRehash: false, reason: 'malformed_hash' };
        } else {
            result = sec.verifyGuestQueryPassword(password, row.passwordHash) || {};
        }
        if (result.ok) {
            if (!matched) matched = row;
            needsRehash = needsRehash || result.needsRehash === true;
        }
    }
    if (list.length === 0) sec.runDummyGuestQueryPasswordVerification();
    return { matched, needsRehash: Boolean(matched) && needsRehash };
}

async function recordBuyerAccessAttempt({ supabase, site, contactHash = null, buyerId = null, ipHash = null, deviceHash = null, outcome }) {
    if (!BUYER_ACCESS_OUTCOMES.includes(outcome)) return false;
    if (!supabase?.from || !ipHash) return false;
    try {
        const result = await supabase.from('guest_shop_access_attempts').insert({
            site,
            contact_hash: contactHash || null,
            buyer_id: buyerId || null,
            request_ip_hash: String(ipHash).slice(0, 128),
            request_device_hash: deviceHash ? String(deviceHash).slice(0, 128) : null,
            outcome
        });
        return !result?.error;
    } catch (_) {
        // Audit is best-effort on the buyer path: an audit outage must not
        // turn a legitimate order into a 500, and every caller that needs the
        // rejection has already decided to reject. Missing rows are visible to
        // the operator through the readiness/monitoring surface, not to the
        // buyer.
        return false;
    }
}

/**
 * §8.1 IP dimension, counted from the audit table so the login path (A2) and
 * the order path share ONE budget. An unavailable audit table fails closed
 * (treated as "over budget"), which only affects the at-cap branch that was
 * going to reject anyway.
 */
async function countRecentIpFailures({ supabase, ipHash, windowSeconds, budget }) {
    if (!ipHash) return 0;
    if (!supabase?.from) return Number.MAX_SAFE_INTEGER;
    const limit = Math.max(1, Number(budget) || 1);
    const since = new Date(Date.now() - Math.max(1, Number(windowSeconds) || 0) * 1000).toISOString();
    try {
        let query = supabase.from('guest_shop_access_attempts')
            .select('id')
            .eq('request_ip_hash', ipHash)
            .gte('created_at', since);
        if (typeof query.in === 'function') query = query.in('outcome', BUYER_ACCESS_FAILURE_OUTCOMES);
        if (typeof query.limit === 'function') query = query.limit(limit);
        const result = await query;
        if (result?.error) return Number.MAX_SAFE_INTEGER;
        return Array.isArray(result?.data) ? result.data.length : 0;
    } catch (_) {
        return Number.MAX_SAFE_INTEGER;
    }
}

/**
 * Shared failure counter (§8.1), written with the same optimistic CAS loop the
 * claim path already proved out: read -> conditional update -> reread on miss.
 * A plain `SET x = x + 1` loses increments under concurrency and would let an
 * attacker spread guesses across parallel requests.
 *
 * The counter lives on the LOWEST group row of the contact while the lock is
 * read across ALL rows, so both paths (order and login) converge on one
 * budget without needing a per-contact table.
 */
async function registerBuyerLoginFailure({ supabase, site, contactHash, rows, settings, now = new Date() }) {
    const target = (rows || [])[0];
    if (!supabase?.from || !target?.id) return Object.freeze({ locked: false, stage: target?.loginLockStage || 0 });
    let current = target;
    for (let attempt = 0; attempt < BUYER_FAILURE_CAS_RETRIES; attempt += 1) {
        const nextCount = current.failedLoginCount + 1;
        const shouldLock = nextCount >= settings.loginMaxFailures;
        const nextStage = shouldLock
            ? Math.min(BUYER_LOCK_MAX_STAGE, current.loginLockStage + 1)
            : current.loginLockStage;
        const stamp = now.toISOString();
        const patch = shouldLock
            ? {
                failed_login_count: 0,
                login_lock_stage: nextStage,
                locked_until: new Date(now.getTime() + BUYER_LOCK_STAGE_MINUTES[nextStage - 1] * 60_000).toISOString(),
                updated_at: stamp
            }
            : { failed_login_count: nextCount, updated_at: stamp };

        try {
            let query = supabase.from('guest_shop_buyers').update(patch)
                .eq('id', current.id)
                .eq('failed_login_count', current.failedLoginCount)
                .eq('login_lock_stage', current.loginLockStage);
            let missed = false;
            if (typeof query.select === 'function' && typeof query.maybeSingle === 'function') {
                const result = await query.select('id,failed_login_count,login_lock_stage').maybeSingle();
                if (result?.error) return Object.freeze({ locked: false, stage: nextStage });
                missed = !result?.data;
            } else {
                const result = await query;
                if (result?.error) return Object.freeze({ locked: false, stage: nextStage });
                missed = result?.data === null;
            }
            if (!missed) return Object.freeze({ locked: shouldLock, stage: nextStage });
        } catch (_) {
            return Object.freeze({ locked: false, stage: nextStage });
        }

        if (attempt >= BUYER_FAILURE_CAS_RETRIES - 1) break;
        try {
            const latest = await loadBuyerGroups({ supabase, site, contactHash });
            const refreshed = latest[0];
            if (!refreshed) break;
            current = refreshed;
        } catch (_) {
            break;
        }
    }
    return Object.freeze({ locked: false, stage: current.loginLockStage });
}

/**
 * §8.1: a SUCCESSFUL verification clears the shared failure counter, so an
 * honest buyer who mistyped twice is not carried one step closer to a lockout
 * forever. Two deliberate details:
 *
 *   - `login_lock_stage` is NOT reset. The stage is the escalation memory
 *     (15min -> 30min -> 24h -> manual), and clearing it on every success would
 *     let an attacker who knows one password of the contact keep re-arming the
 *     cheapest stage while spraying the others.
 *   - The write is guarded by `.eq('failed_login_count', <read value>)`, the
 *     same optimistic CAS as registerBuyerLoginFailure. A blind `SET 0` racing a
 *     concurrent failure would silently swallow that failure's increment.
 *
 * Best-effort by contract: this runs AFTER the password already verified, so a
 * failed write must never turn a valid credential into an error. It returns
 * false and the login proceeds.
 */
async function resetBuyerLoginFailures({ supabase, site, contactHash, rows, now = new Date() }) {
    const target = (rows || [])[0];
    if (!supabase?.from || !target?.id) return false;
    if (normalizeCount(target.failedLoginCount) === 0) return false;
    const expected = normalizeCount(target.failedLoginCount);
    try {
        let query = supabase.from('guest_shop_buyers').update({
            failed_login_count: 0,
            updated_at: now.toISOString()
        }).eq('id', target.id).eq('failed_login_count', expected);
        if (typeof query.select === 'function' && typeof query.maybeSingle === 'function') {
            query = query.select('id,failed_login_count').maybeSingle();
        }
        const result = await query;
        if (result?.error) return false;
        return result?.data !== null && result?.data !== undefined;
    } catch (_) {
        return false;
    }
}

/**
 * §6.2 transparent parameter upgrade. Only ever called after a SUCCESSFUL
 * verification against this exact row, so writing a freshly minted hash for
 * the same password cannot lock the buyer out. Best-effort: a failed rehash
 * leaves a still-verifiable low-parameter row and must not fail the order.
 */
async function rehashBuyerPasswordIfNeeded({ supabase, row, password, security, now = new Date() }) {
    if (!supabase?.from || !row?.id) return false;
    // This routine only ever mints, so honour any injected security that can
    // hash. securityOf() gates on verifyGuestQueryPassword, which would wrongly
    // discard a hash-only stub and silently fall back to the default module,
    // defeating the "same hash => no write" guard below.
    const sec = security && typeof security.hashGuestQueryPassword === 'function' ? security : securityOf(security);
    let nextHash;
    try {
        nextHash = sec.hashGuestQueryPassword(password);
    } catch (_) {
        return false;
    }
    if (!nextHash || nextHash === row.passwordHash) return false;
    try {
        const result = await supabase.from('guest_shop_buyers').update({
            password_hash: nextHash,
            password_version: nextBuyerPasswordVersion(row.passwordVersion),
            password_updated_at: now.toISOString(),
            updated_at: now.toISOString()
        }).eq('id', row.id).eq('password_hash', row.passwordHash);
        return !result?.error;
    } catch (_) {
        return false;
    }
}

/**
 * Allocate (or reuse) the credential group that will own this order, through
 * the guarded SQL RPC so the cap check, the recycling decision and the write
 * are one atomic step. Doing it with separate JS round-trips would let two
 * concurrent orders from the same email both read "1 group" and both allocate
 * group 2, and the UNIQUE constraint would surface as a 500.
 */
async function allocateBuyerGroup({ supabase, site, contactHash, matchedGroupNo, passwordHash, settings }) {
    if (!supabase?.rpc) failMisconfigured('guest_shop_buyers 不可访问');
    const result = await supabase.rpc('fn_guest_shop_upsert_buyer_group', {
        p_site: site,
        p_contact_hash: contactHash,
        p_matched_group_no: matchedGroupNo == null ? null : matchedGroupNo,
        // NULL on the reuse path unless a transparent rehash is owed: the RPC
        // may only overwrite a password it was given together with a verified
        // group match, never on the allocate path of an effective group.
        p_password_hash: passwordHash || null,
        p_group_cap: settings.groupCap,
        p_recycle_cooldown_seconds: settings.recycleCooldownSeconds,
        // §10.1 / H1-H4: deliberately never computed on the public order path.
        // It is record-only, and answering it would require an auth.users
        // lookup that adds both a hot-path dependency and a "is this email
        // registered?" enumeration oracle. A3/A4 populate it from an
        // authenticated surface.
        p_registered_user_match: null
    });
    if (result?.error) {
        const message = String(result.error.message || '');
        if (message.includes('guest_buyer_credential_conflict')) {
            failGuest('该邮箱已设置过 3 套查询密码，为保护订单安全无法再新增。请用原查询密码登录，或点击「忘记查询密码」。', {
                statusCode: 409,
                code: 'guest_buyer_credential_conflict'
            });
        }
        if (BUYER_GROUP_SQL_MISCONFIG_TOKENS.some((token) => message.includes(token))) {
            failMisconfigured('凭证分组解析失败');
        }
        throw result.error;
    }
    const row = Array.isArray(result?.data) ? result.data[0] : result?.data;
    const buyerId = String(row?.buyer_id || '').trim();
    if (!buyerId) failMisconfigured('凭证分组解析失败');
    return Object.freeze({
        buyerId,
        groupNo: Number(row?.credential_group_no) || 0,
        allocation: String(row?.allocation || '')
    });
}

/**
 * Full order-path resolution. Returns `{ buyerId, groupNo, allocation }` or
 * throws the documented buyer-facing error.
 *
 * Order of operations is a contract, not a style choice:
 *   1. lock check            -> 423, zero scrypt (§8.1)
 *   2. IP budget (at cap)    -> 429, zero scrypt (§8.1)
 *   3. equal-cost verify     -> §8.4
 *   4. matched               -> reuse the group (never overwrite its password)
 *   5. not matched, room     -> allocate a new group (N1: still able to buy)
 *   6. not matched, at cap   -> count a failure, 409 (the only oracle, paid for)
 */
async function resolveBuyerGroupForOrder(options = {}) {
    const {
        supabase,
        security,
        env = {},
        site,
        email,
        password,
        contactHash,
        ipHash = null,
        deviceHash = null
    } = options;
    const sec = securityOf(security);
    const settings = options.settings || resolveBuyerCredentialSettings(env);
    const now = options.now instanceof Date ? options.now : new Date();

    // §6.3: a missing/short/reused contact pepper is fail-closed. Silently
    // falling back to the claim pepper would re-key every stored contact_hash
    // the day an operator rotates it, making all guest orders unreachable.
    const hash = contactHash || sec.hashGuestContact(email, { env, strict: true });
    if (!hash) failMisconfigured('contact_hash 不可用');

    const rows = await loadBuyerGroups({ supabase, site, contactHash: hash });

    if (findActiveBuyerLock(rows, now)) {
        await recordBuyerAccessAttempt({
            supabase, site, contactHash: hash, ipHash, deviceHash, outcome: 'locked'
        });
        failGuest('尝试次数过多，请稍后再试', { statusCode: 423, code: 'guest_order_locked' });
    }

    const atCap = rows.length >= settings.groupCap;
    if (atCap) {
        const ipFailures = await countRecentIpFailures({
            supabase,
            ipHash,
            windowSeconds: settings.loginWindowSeconds,
            budget: settings.ipMaxFailures
        });
        if (ipFailures >= settings.ipMaxFailures) {
            await recordBuyerAccessAttempt({
                supabase, site, contactHash: hash, ipHash, deviceHash, outcome: 'rate_limited'
            });
            failGuest('操作过于频繁，请稍后再试', { statusCode: 429, code: 'guest_rate_limited' });
        }
    }

    const { matched, needsRehash } = verifyBuyerPasswordAcrossGroups(password, rows, sec);

    if (matched) {
        // §6.2 transparent upgrade rides along in the SAME rpc call: the SQL may
        // only overwrite a password it was handed together with a verified group
        // match, so the hash cannot land on the wrong row and there is no second
        // round trip on the hot path. rehashBuyerPasswordIfNeeded stays exported
        // for the login path (A2), which verifies without allocating.
        let upgradedHash = null;
        if (needsRehash) {
            try {
                upgradedHash = sec.hashGuestQueryPassword(password);
            } catch (_) {
                // Minting can only fail on a crypto parameter problem; the buyer
                // already proved the password, so degrade to "no upgrade" rather
                // than failing the order. The low-parameter row still verifies.
                upgradedHash = null;
            }
        }
        if (!upgradedHash) {
            // §8.4 EQUAL-COST, and the reason this branch is not a one-liner.
            // The allocate branch below mints exactly one scrypt hash, so a
            // matched-with-no-rehash response would otherwise finish one
            // derivation (~50ms at N=32768) EARLIER than a not-matched one.
            // Below the group cap nothing is recorded and no lock applies, so
            // that latency gap is a free password oracle: an attacker could
            // submit full order forms with candidate passwords, detect "this
            // matched an existing group" purely by response time, and then read
            // that buyer's card secrets on the login path. Burning one dummy
            // derivation makes every 201-returning path cost max(rows,1)+1
            // scrypt, so matched and not-matched are timing-indistinguishable.
            // The only path left at max(rows,1) is the at-cap 409, which is
            // already observable by status and paid for via the §8.1 lock.
            sec.runDummyGuestQueryPasswordVerification();
        }
        return allocateBuyerGroup({
            supabase,
            site,
            contactHash: hash,
            matchedGroupNo: matched.groupNo,
            passwordHash: upgradedHash,
            settings
        });
    }

    if (!atCap) {
        const passwordHash = sec.hashGuestQueryPassword(password);
        return allocateBuyerGroup({
            supabase,
            site,
            contactHash: hash,
            matchedGroupNo: null,
            passwordHash,
            settings
        });
    }

    // At cap and no match: this is the observable branch, so it pays into the
    // same budget as the login path. `credential_conflict` is the audit
    // outcome reserved by §9.1 for exactly this case.
    const failure = await registerBuyerLoginFailure({
        supabase, site, contactHash: hash, rows, settings, now
    });
    await recordBuyerAccessAttempt({
        supabase,
        site,
        contactHash: hash,
        buyerId: rows[0]?.id || null,
        ipHash,
        deviceHash,
        outcome: 'credential_conflict'
    });
    if (failure.locked) {
        failGuest('尝试次数过多，请稍后再试', { statusCode: 423, code: 'guest_order_locked' });
    }
    failGuest('该邮箱已设置过 3 套查询密码，为保护订单安全无法再新增。请用原查询密码登录，或点击「忘记查询密码」。', {
        statusCode: 409,
        code: 'guest_buyer_credential_conflict'
    });
}

module.exports = {
    BUYER_ACCESS_FAILURE_OUTCOMES,
    BUYER_GROUP_SQL_MISCONFIG_TOKENS,
    BUYER_ACCESS_OUTCOMES,
    BUYER_CREDENTIAL_SETTING_NAMES,
    BUYER_GROUP_DB_MAX,
    BUYER_LOCK_MAX_STAGE,
    BUYER_LOCK_STAGE_MINUTES,
    GUEST_BUYER_GROUP_RECYCLE_COOLDOWN_SECONDS,
    SITE_FORBIDDEN_PASSWORD_TOKENS,
    TERMINAL_UNPAID_PAYMENT_STATUSES,
    allocateBuyerGroup,
    assertBuyerQueryPasswordStrength,
    countRecentIpFailures,
    findActiveBuyerLock,
    forbiddenPasswordTokens,
    isBuyerCredentialEnabled,
    loadBuyerGroups,
    nextBuyerPasswordVersion,
    parseBuyerCredentialSwitch,
    recordBuyerAccessAttempt,
    registerBuyerLoginFailure,
    resetBuyerLoginFailures,
    rehashBuyerPasswordIfNeeded,
    resolveBuyerCredentialSettings,
    resolveBuyerGroupForOrder,
    verifyBuyerPasswordAcrossGroups
};
