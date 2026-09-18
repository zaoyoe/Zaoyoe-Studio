'use strict';

/**
 * Guest Shop Order Access 2.0 (A3) — buyer access administration primitives.
 *
 * Contract: docs/guest-shop-order-access-2.0.md
 *   §10.5  管理台：解锁登录锁定 / 一次性找回链接
 *   §13.2  历史订单自助升级为密码访问
 *   §6.4   凭证分组（buyer_id 是访问主体，contact_hash 不是）
 *   §8.1   锁定与预算
 *   §9.1   统一错误码（防枚举）
 *
 * This module owns the DATABASE side of A3. It is deliberately split out of
 * `server/api-handlers/public/guest-shop.js` (2.9k lines) and of the admin
 * handler so that:
 *
 *   1. the reset-link lifecycle is unit-testable without an HTTP harness;
 *   2. the public reset endpoint and the admin issue/revoke endpoint cannot
 *      drift apart on what "pending" means;
 *   3. every projection is written once, so no caller can accidentally
 *      `select('*')` a `password_hash` or a `token_hash` into a response.
 *
 * SECURITY INVARIANTS (do not weaken without updating the design doc):
 *
 *   I1. The plaintext reset token exists in exactly ONE place: the return value
 *       of `issueResetToken()`, which the admin handler puts into its HTTP
 *       response once. Only `sha256(token)` is ever persisted. A database dump
 *       therefore cannot be replayed into working links (AGENTS.md prohibition
 *       on printing secrets is the second half of this).
 *   I2. A reset link is single-use, single-pending and short-lived. All three
 *       are enforced by CAS predicates here AND by CHECK/UNIQUE constraints in
 *       `supabase/migrations/20260922_guest_shop_access_resets.sql`. The DB is
 *       the outer guard; this file is the fast path.
 *   I3. Issuing a link BUMPS `password_version` first. Because the session
 *       cookie carries `pv` and `authenticateGuestOrderAccess` re-reads it,
 *       bumping kills every live session of that credential group before the
 *       link even exists. Containment precedes remediation.
 *   I4. Every failure on the public reset path collapses to ONE error
 *       (`guest_reset_invalid`, 403). The real reason only ever reaches
 *       `guest_shop_access_attempts.outcome`.
 *   I5. Admin-facing views never contain `contact_hash`, `password_hash` or
 *       `token_hash`. `publicBuyerView()` is the only shape an admin response
 *       may carry.
 */

const crypto = require('node:crypto');

const defaultSecurity = require('./security');
// Required for ONE symbol only: `nextBuyerPasswordVersion`, the single source of
// truth for the session-revocation counter. Re-declaring the formula here would
// be exactly the drift its own doc comment warns about. There is no cycle:
// buyer-credentials never requires this module.
const { nextBuyerPasswordVersion } = require('./buyer-credentials');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * 256 bits of CSPRNG output. This is the whole reason the reset path needs no
 * scrypt and no pepper: an unguessable bearer secret cannot be brute-forced,
 * so unlike the 45-bit query password (§3) it buys nothing to slow down
 * verification. Adding a pepper here would only mean that rotating it silently
 * invalidates every outstanding link — a self-inflicted outage, not security.
 */
const RESET_TOKEN_BYTES = 32;

/** base64url(32 bytes) is exactly 43 characters, padding stripped. */
const RESET_TOKEN_LENGTH = 43;
const RESET_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

/**
 * §10.5: 15 minutes. A CONSTANT, not an environment knob, on purpose.
 * A knob can be typo'd to `900000` (15 hours) or copy-pasted as `900000ms`,
 * and the failure mode is invisible until a link is abused. The migration's
 * `expires_at <= created_at + INTERVAL '24 hours'` CHECK is the outer guard
 * against a future code change, not against configuration.
 */
const RESET_LINK_TTL_SECONDS = 15 * 60;

const RESET_PURPOSE = 'password_reset';
const RESET_TABLE = 'guest_shop_access_resets';
const BUYER_TABLE = 'guest_shop_buyers';
const ORDER_TABLE = 'guest_shop_orders';

const MIN_ADMIN_REASON_LENGTH = 8;
const MAX_ADMIN_REASON_LENGTH = 500;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** `password_version` is SMALLINT in the migration; saturate instead of wrap. */
const BUYER_PASSWORD_VERSION_MAX = 32767;

/** CAS retries for the low-frequency admin writes. Not the hot path. */
const ADMIN_CAS_RETRIES = 3;

/**
 * §5.3 / migration section 3: the four A3 outcomes share the login audit
 * stream. Listed here so `recordBuyerAccessAttempt`'s allow-list and this
 * module can never disagree about a spelling.
 *
 * They are deliberately NOT failure outcomes (i.e. they must not be added to
 * `BUYER_ACCESS_FAILURE_OUTCOMES`): neither second factor is guessable, so
 * counting them into the per-IP login budget would let an attacker lock a
 * shared NAT out of the LOGIN page by spamming invalid reset links.
 */
const RESET_ACCESS_OUTCOMES = Object.freeze([
    'reset_invalid',
    'reset_success',
    'upgrade_invalid',
    'upgrade_success'
]);

/**
 * The projection used by every read in this module. `password_hash` is
 * intentionally absent: nothing in A3 needs to VERIFY an old password (the
 * link is the proof), so the hash is never loaded into the admin or reset
 * process at all. `token_hash` is likewise never selected.
 */
const BUYER_ACCESS_FIELDS = Object.freeze([
    'id',
    'site',
    'contact_hash',
    'credential_group_no',
    'password_version',
    'failed_login_count',
    'login_lock_stage',
    'locked_until',
    'merged_into_user_id'
]);

const BUYER_ACCESS_SELECT = BUYER_ACCESS_FIELDS.join(',');

const ORDER_LINK_FIELDS = Object.freeze([
    'id',
    'order_no',
    'site',
    'buyer_id',
    'payment_status',
    'fulfillment_status',
    'created_at'
]);

const ORDER_LINK_SELECT = ORDER_LINK_FIELDS.join(',');

const PENDING_RESET_FIELDS = Object.freeze([
    'id',
    'site',
    'buyer_id',
    'contact_hash',
    'purpose',
    'expires_at',
    'created_at'
]);

const PENDING_RESET_SELECT = PENDING_RESET_FIELDS.join(',');

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * A plain Error carrying `statusCode` + `code` (+ `expose`). Both callers
 * already understand this shape: the public handler's `failResponse` and the
 * admin handler's `sendGuestOrderError`-style mapper pass 400/403/404/409/503
 * straight through and flatten anything else to a 500.
 *
 * `expose` defaults to TRUE for the buyer-facing codes (the message is generic
 * by construction) and must be set to false for the 503s, matching
 * `guestDatabaseUnavailableError` in the public handler.
 */
function adminAccessError(message, code, statusCode = 400, expose = true) {
    const error = new Error(String(message || '请求无效'));
    error.code = String(code || 'guest_shop_invalid_request');
    error.statusCode = Number(statusCode) || 400;
    error.expose = expose !== false;
    return error;
}

function databaseUnavailable(detail = '') {
    // 503 + expose:false so a database outage can never be turned into a
    // distinguishable "this email does not exist" signal by an attacker.
    return adminAccessError('游客订单数据库不可用', 'guest_database_unavailable', 503, false);
}

function assertSupabase(supabase) {
    if (!supabase || typeof supabase.from !== 'function') throw databaseUnavailable();
    return supabase;
}

// ---------------------------------------------------------------------------
// Small normalizers
// ---------------------------------------------------------------------------

function normalizeCount(value) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function normalizeVersion(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1) return 1;
    return Math.min(BUYER_PASSWORD_VERSION_MAX, Math.floor(parsed));
}

function normalizeStage(value) {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 0) return 0;
    return Math.min(3, parsed);
}

function toIso(value) {
    if (!value) return null;
    const parsed = Date.parse(String(value));
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function isUuid(value) {
    return UUID_PATTERN.test(String(value || '').trim());
}

// ---------------------------------------------------------------------------
// Reset token
// ---------------------------------------------------------------------------

/**
 * Canonicalize a token from a URL/JSON body. Returns '' for anything that is
 * not exactly 43 base64url characters — the shape check is what stops a caller
 * from smuggling a 4 KB string into a SHA-256 call or into a query filter.
 */
function normalizeResetToken(value) {
    const raw = String(value ?? '').trim();
    return RESET_TOKEN_PATTERN.test(raw) ? raw : '';
}

function hashResetToken(token) {
    const normalized = normalizeResetToken(token);
    if (!normalized) return '';
    return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
}

function issueResetToken() {
    const token = crypto.randomBytes(RESET_TOKEN_BYTES).toString('base64url');
    const tokenHash = hashResetToken(token);
    // Paranoia that costs nothing: if base64url ever changed shape the whole
    // scheme would degrade to "short tokens", so refuse to mint instead.
    if (token.length !== RESET_TOKEN_LENGTH || !tokenHash) {
        throw adminAccessError('找回链接生成失败', 'guest_shop_misconfigured', 503, false);
    }
    return Object.freeze({ token, tokenHash });
}

// ---------------------------------------------------------------------------
// Buyer row projection
// ---------------------------------------------------------------------------

/**
 * Raw-column -> normalized-field map.
 *
 * Normalization MUST be idempotent, and this is why: `loadBuyerRowById` and
 * `resolveBuyerByOrderNo` already hand their callers a normalized row, and
 * `issuePasswordResetLink` / `applyPasswordReset` normalize again defensively.
 * Reading only the snake_case column names would turn that second pass into
 * `contactHash: ''` — a reset link bound to no email, which the migration's
 * `contact_hash ~ '^[0-9a-f]{64}$'` CHECK rejects as an opaque 23514 and which
 * `matchesResetContact` could never match. Accepting both spellings makes
 * double normalization a no-op instead of a silent data loss.
 */
const BUYER_ROW_ALIASES = Object.freeze({
    site: ['site'],
    contactHash: ['contact_hash', 'contactHash'],
    groupNo: ['credential_group_no', 'groupNo'],
    passwordVersion: ['password_version', 'passwordVersion'],
    failedLoginCount: ['failed_login_count', 'failedLoginCount'],
    loginLockStage: ['login_lock_stage', 'loginLockStage'],
    lockedUntil: ['locked_until', 'lockedUntil'],
    mergedIntoUserId: ['merged_into_user_id', 'mergedIntoUserId']
});

function pickBuyerField(row, keys) {
    for (const key of keys) {
        const value = row[key];
        if (value !== undefined && value !== null && value !== '') return value;
    }
    return null;
}

function normalizeBuyerRow(row) {
    if (!row || typeof row !== 'object') return null;
    const id = String(row.id || '').trim();
    if (!id) return null;
    const merged = pickBuyerField(row, BUYER_ROW_ALIASES.mergedIntoUserId);
    return Object.freeze({
        id,
        site: String(pickBuyerField(row, BUYER_ROW_ALIASES.site) || '').trim(),
        contactHash: String(pickBuyerField(row, BUYER_ROW_ALIASES.contactHash) || '').trim(),
        groupNo: normalizeCount(pickBuyerField(row, BUYER_ROW_ALIASES.groupNo)),
        passwordVersion: normalizeVersion(pickBuyerField(row, BUYER_ROW_ALIASES.passwordVersion)),
        failedLoginCount: normalizeCount(pickBuyerField(row, BUYER_ROW_ALIASES.failedLoginCount)),
        loginLockStage: normalizeStage(pickBuyerField(row, BUYER_ROW_ALIASES.loginLockStage)),
        lockedUntil: toIso(pickBuyerField(row, BUYER_ROW_ALIASES.lockedUntil)),
        mergedIntoUserId: merged ? String(merged) : ''
    });
}

/**
 * §I5: the ONLY buyer shape an admin response may carry. No contact_hash
 * (it is an HMAC of the email and would confirm which email owns which group),
 * no password_hash, no token_hash.
 */
function publicBuyerView(buyer, now = new Date()) {
    const normalized = normalizeBuyerRow(buyer);
    if (!normalized) return null;
    const at = now instanceof Date ? now.getTime() : Date.now();
    return Object.freeze({
        buyer_id: normalized.id,
        site: normalized.site,
        credential_group_no: normalized.groupNo,
        password_version: normalized.passwordVersion,
        failed_login_count: normalized.failedLoginCount,
        login_lock_stage: normalized.loginLockStage,
        locked_until: normalized.lockedUntil,
        locked: Boolean(normalized.lockedUntil && Date.parse(normalized.lockedUntil) > at),
        merged_into_user_id: normalized.mergedIntoUserId || null
    });
}

function isBuyerLocked(buyer, now = new Date()) {
    const at = now instanceof Date ? now.getTime() : Date.now();
    return Boolean(buyer?.lockedUntil && Date.parse(buyer.lockedUntil) > at);
}

async function loadBuyerRowById({ supabase, buyerId, site = '' }) {
    const db = assertSupabase(supabase);
    const id = String(buyerId || '').trim();
    if (!isUuid(id)) throw adminAccessError('凭证分组不存在', 'guest_buyer_not_found', 404);
    let query = db.from(BUYER_TABLE).select(BUYER_ACCESS_SELECT).eq('id', id);
    // Site is part of the group key (§6.4.2). Scoping the read means a link
    // minted for a `cn` group can never be spent against an `intl` row even if
    // an attacker could somehow forge the id.
    if (site) query = query.eq('site', String(site));
    const result = await query.maybeSingle();
    if (result?.error) throw result.error;
    return normalizeBuyerRow(result?.data);
}

// ---------------------------------------------------------------------------
// Order -> buyer resolution (admin actions are keyed by order_no, never by a
// client-supplied email: §6.4 says contact_hash is not a trusted identity
// factor, so the admin UI must not accept one as the selector).
// ---------------------------------------------------------------------------

async function loadOrderForAccess({ supabase, orderNo }) {
    const db = assertSupabase(supabase);
    const normalized = String(orderNo || '').trim();
    if (!normalized) throw adminAccessError('缺少订单号', 'guest_order_required', 400);
    const result = await db.from(ORDER_TABLE).select(ORDER_LINK_SELECT)
        .eq('order_no', normalized)
        .maybeSingle();
    if (result?.error) throw result.error;
    if (!result?.data) throw adminAccessError('游客订单不存在', 'guest_order_not_found', 404);
    return result.data;
}

/**
 * Resolve the credential group that owns an order.
 *
 * `buyer_id IS NULL` is NOT an error here — it is the §13.2 case (a historical
 * order that was placed before the credential switch existed). The caller
 * decides: the admin unlock/issue actions answer 409 `guest_buyer_not_bound`
 * with a hint to use the self-upgrade form, because there is no group to unlock
 * and no email an admin is allowed to invent one for.
 */
async function resolveBuyerByOrderNo({ supabase, orderNo }) {
    const order = await loadOrderForAccess({ supabase, orderNo });
    const buyerId = String(order.buyer_id || '').trim();
    if (!buyerId) {
        return Object.freeze({
            order,
            buyer: null,
            bound: false,
            notBoundError: adminAccessError(
                '该订单尚未绑定查询密码，无法执行此操作。请引导用户在游客订单页的「使用订单号 + 取货口令找回」中自助设置查询密码。',
                'guest_buyer_not_bound',
                409
            )
        });
    }
    const buyer = await loadBuyerRowById({ supabase, buyerId, site: order.site });
    if (!buyer) {
        // The order names a group that no longer exists. Fail closed and make
        // the operator look, rather than silently operating on nothing.
        throw adminAccessError('订单绑定的凭证分组不存在', 'guest_buyer_not_found', 409);
    }
    return Object.freeze({ order, buyer, bound: true, notBoundError: null });
}

// ---------------------------------------------------------------------------
// §10.5 action 1 — unlock
// ---------------------------------------------------------------------------

/**
 * Clear the login lock of EVERY credential group of one (site, contact_hash).
 *
 * Why all groups and not just the bound one: §8.1 reads the lock across all
 * groups of the contact (`findActiveBuyerLock`), so clearing only the bound
 * group would leave the buyer locked out and the admin action would appear to
 * have done nothing.
 *
 * Why `login_lock_stage` goes back to 0 and not merely "unlocked": the stage is
 * an exponential-backoff escalation (15/30/1440 minutes). A SUCCESSFUL password
 * guess deliberately keeps the stage, because a guess proves nothing about who
 * was guessing. An ADMIN unlock is different — a human verified the buyer
 * through a support channel, which is exactly the evidence the stage machine
 * exists to wait for. Resetting it is the point of the action.
 *
 * The bulk update needs `.select()` to return the touched rows; a bare
 * supabase-js update returns `data: null` even on success, which is why the
 * caller gets an array here instead of a maybeSingle.
 */
async function unlockBuyerLogin({ supabase, site, contactHash, now = new Date() }) {
    const db = assertSupabase(supabase);
    const normalizedSite = String(site || '').trim();
    const hash = String(contactHash || '').trim();
    if (!normalizedSite || !hash) throw adminAccessError('缺少凭证分组信息', 'guest_buyer_not_found', 404);
    const nowIso = (now instanceof Date ? now : new Date()).toISOString();
    let query = db.from(BUYER_TABLE).update({
        failed_login_count: 0,
        login_lock_stage: 0,
        locked_until: null,
        updated_at: nowIso
    }).eq('site', normalizedSite).eq('contact_hash', hash);
    if (typeof query.select === 'function') query = query.select('id,credential_group_no');
    const result = await query;
    if (result?.error) throw result.error;
    const rows = Array.isArray(result?.data) ? result.data : (result?.data ? [result.data] : []);
    return Object.freeze({
        unlockedGroups: rows.length,
        groupIds: rows.map((row) => String(row?.id || '')).filter(Boolean)
    });
}

// ---------------------------------------------------------------------------
// password_version bump (the session-revocation primitive)
// ---------------------------------------------------------------------------

/**
 * Bump `password_version` with a CAS on the current value. Every live session
 * cookie of this group carries the OLD `pv`, and
 * `authenticateGuestOrderAccess` re-reads the row, so a successful bump
 * revokes all of them at once.
 *
 * Returns the new version, or throws 503 if the CAS keeps losing (which would
 * mean something else is writing the row concurrently — the operator should
 * see that, not swallow it).
 */
async function bumpBuyerPasswordVersion({ supabase, buyerId, expectedVersion, now = new Date() }) {
    const db = assertSupabase(supabase);
    const id = String(buyerId || '').trim();
    if (!isUuid(id)) throw adminAccessError('凭证分组不存在', 'guest_buyer_not_found', 404);
    let current = normalizeVersion(expectedVersion);
    for (let attempt = 0; attempt < ADMIN_CAS_RETRIES; attempt += 1) {
        const next = nextBuyerPasswordVersion(current);
        const nowIso = (now instanceof Date ? now : new Date()).toISOString();
        let query = db.from(BUYER_TABLE).update({
            password_version: next,
            updated_at: nowIso
        }).eq('id', id).eq('password_version', current);
        if (typeof query.select === 'function') query = query.select('id,password_version');
        const result = await (typeof query.maybeSingle === 'function' ? query.maybeSingle() : query);
        if (result?.error) throw result.error;
        if (result?.data) return next;
        // CAS lost: re-read and retry against the newest value.
        const fresh = await loadBuyerRowById({ supabase: db, buyerId: id });
        if (!fresh) throw adminAccessError('凭证分组不存在', 'guest_buyer_not_found', 404);
        if (fresh.passwordVersion === current) {
            // Nothing changed but the update still missed — an adapter that
            // returns data:null on a bare update would land here. Treat the
            // re-read value as authoritative and try once more.
            current = fresh.passwordVersion;
            continue;
        }
        current = fresh.passwordVersion;
    }
    throw adminAccessError('凭证版本更新失败，请重试', 'guest_buyer_version_conflict', 409);
}

// ---------------------------------------------------------------------------
// §10.5 action 2/3 — one-time reset link
// ---------------------------------------------------------------------------

/**
 * Revoke every outstanding (unspent, unrevoked, including already-expired)
 * link of one group. Expired rows are revoked too: an expired-but-unrevoked
 * row is indistinguishable from a live one in the admin view, and the UNIQUE
 * partial index only counts pending rows, so revoking them is what keeps
 * "one pending link per group" true under a re-issue race.
 */
async function revokePendingResetLinks({ supabase, buyerId, now = new Date() }) {
    const db = assertSupabase(supabase);
    const id = String(buyerId || '').trim();
    if (!isUuid(id)) throw adminAccessError('凭证分组不存在', 'guest_buyer_not_found', 404);
    const nowIso = (now instanceof Date ? now : new Date()).toISOString();
    let query = db.from(RESET_TABLE).update({ revoked_at: nowIso })
        .eq('buyer_id', id)
        .is('used_at', null)
        .is('revoked_at', null);
    if (typeof query.select === 'function') query = query.select('id');
    const result = await query;
    if (result?.error) throw result.error;
    const rows = Array.isArray(result?.data) ? result.data : (result?.data ? [result.data] : []);
    return rows.map((row) => String(row?.id || '')).filter(Boolean);
}

/**
 * Mint a one-time reset link for a credential group.
 *
 * ORDER OF OPERATIONS IS THE SECURITY PROPERTY (I3):
 *   1. bump password_version  -> every live session of this group dies NOW
 *   2. revoke pending links   -> at most one link can ever be outstanding
 *   3. insert the new row
 *
 * If step 3 fails the buyer is left with no link and no session, which is the
 * safe direction: an admin re-issues. Reversing the order would leave a window
 * where a NEW link coexists with an OLD session minted from the password the
 * admin is about to replace.
 *
 * The returned `token` is shown to the admin exactly once and must never be
 * logged, audited or persisted (AGENTS.md).
 */
async function issuePasswordResetLink({ supabase, buyer, adminId, reason, now = new Date() }) {
    const db = assertSupabase(supabase);
    const normalizedBuyer = normalizeBuyerRow(buyer);
    if (!normalizedBuyer) throw adminAccessError('凭证分组不存在', 'guest_buyer_not_found', 404);
    if (!isUuid(adminId)) throw adminAccessError('缺少管理员身份', 'guest_admin_actor_required', 400);
    const text = String(reason || '').trim();
    if (text.length < MIN_ADMIN_REASON_LENGTH || text.length > MAX_ADMIN_REASON_LENGTH) {
        throw adminAccessError('请填写至少 8 个字的处理原因', 'guest_admin_reason_required', 400);
    }
    if (normalizedBuyer.mergedIntoUserId) {
        // §10.4: a merged group is retired from guest access. Issuing a guest
        // reset link for it would hand back exactly the access the merge took
        // away. The operator must use the account path instead.
        throw adminAccessError('该凭证分组已并入注册账号，请使用账号流程重置', 'guest_buyer_merged', 409);
    }
    // The link is bound to the group's contact_hash: `matchesResetContact` is
    // what proves the email on the reset form belongs to it. A row without one
    // would mint a link nobody can ever spend, so refuse here with a named code
    // rather than letting the migration's CHECK surface as an opaque 23514.
    if (!/^[0-9a-f]{64}$/u.test(normalizedBuyer.contactHash)) {
        throw adminAccessError('凭证分组缺少可用的联系方式，无法签发找回链接', 'guest_buyer_contact_required', 409);
    }

    const at = now instanceof Date ? now : new Date();
    const passwordVersion = await bumpBuyerPasswordVersion({
        supabase: db,
        buyerId: normalizedBuyer.id,
        expectedVersion: normalizedBuyer.passwordVersion,
        now: at
    });
    const revoked = await revokePendingResetLinks({ supabase: db, buyerId: normalizedBuyer.id, now: at });
    const { token, tokenHash } = issueResetToken();
    const expiresAt = new Date(at.getTime() + RESET_LINK_TTL_SECONDS * 1000);
    const row = {
        site: normalizedBuyer.site,
        buyer_id: normalizedBuyer.id,
        contact_hash: normalizedBuyer.contactHash,
        purpose: RESET_PURPOSE,
        token_hash: tokenHash,
        expires_at: expiresAt.toISOString(),
        created_by_admin_id: String(adminId).trim(),
        reason: text.slice(0, MAX_ADMIN_REASON_LENGTH),
        created_at: at.toISOString()
    };
    let insertQuery = db.from(RESET_TABLE).insert(row);
    if (typeof insertQuery.select === 'function') insertQuery = insertQuery.select('id,expires_at');
    const inserted = await (typeof insertQuery.maybeSingle === 'function'
        ? insertQuery.maybeSingle()
        : insertQuery);
    if (inserted?.error) {
        // The partial UNIQUE index is the hard guard against two admins racing.
        // Surface it as a retryable conflict instead of a 500.
        if (isUniqueViolation(inserted.error)) {
            throw adminAccessError('该分组已有一条待使用的找回链接，请先撤销', 'guest_reset_link_conflict', 409);
        }
        throw inserted.error;
    }
    const created = inserted?.data || {};
    return Object.freeze({
        resetId: String(created.id || '').trim(),
        token,
        expiresAt: toIso(created.expires_at) || expiresAt.toISOString(),
        passwordVersion,
        revokedResetIds: Object.freeze(revoked)
    });
}

function isUniqueViolation(error) {
    const code = String(error?.code || '');
    const message = String(error?.message || '');
    return code === '23505' || message.includes('duplicate key') || message.includes('unique');
}

/**
 * Load the one pending link for a token hash. Expired / used / revoked rows are
 * filtered OUT here, so "not found" and "expired" are the same answer — the
 * caller collapses both to `guest_reset_invalid` (I4) and there is no oracle to
 * protect anyway, because the token is 256 bits.
 */
async function loadPendingResetByTokenHash({ supabase, tokenHash, now = new Date() }) {
    const db = assertSupabase(supabase);
    const hash = String(tokenHash || '').trim();
    if (!/^[0-9a-f]{64}$/u.test(hash)) return null;
    const nowIso = (now instanceof Date ? now : new Date()).toISOString();
    let query = db.from(RESET_TABLE).select(PENDING_RESET_SELECT)
        .eq('token_hash', hash)
        .is('used_at', null)
        .is('revoked_at', null);
    if (typeof query.gt === 'function') query = query.gt('expires_at', nowIso);
    const result = await query.maybeSingle();
    if (result?.error) throw result.error;
    const row = result?.data;
    if (!row) return null;
    return Object.freeze({
        id: String(row.id || ''),
        site: String(row.site || ''),
        buyerId: String(row.buyer_id || ''),
        contactHash: String(row.contact_hash || ''),
        purpose: String(row.purpose || RESET_PURPOSE),
        expiresAt: toIso(row.expires_at)
    });
}

/**
 * CAS-consume a link. The predicate repeats the pending/expiry conditions of
 * the read on purpose: two browsers opening the same link must produce exactly
 * one success, and the loser gets `null` (which the caller turns into the same
 * unified 403 as an invalid token).
 *
 * `.select().maybeSingle()` is REQUIRED — supabase-js v2 returns `data: null`
 * for a bare update even when a row matched, so a missing select would make
 * every consume look like a lost race.
 */
async function consumeResetToken({ supabase, tokenHash, ipHash = null, now = new Date() }) {
    const db = assertSupabase(supabase);
    const hash = String(tokenHash || '').trim();
    if (!/^[0-9a-f]{64}$/u.test(hash)) return null;
    const at = now instanceof Date ? now : new Date();
    let query = db.from(RESET_TABLE).update({
        used_at: at.toISOString(),
        consumed_ip_hash: ipHash ? String(ipHash).slice(0, 128) : null
    })
        .eq('token_hash', hash)
        .is('used_at', null)
        .is('revoked_at', null);
    if (typeof query.gt === 'function') query = query.gt('expires_at', at.toISOString());
    if (typeof query.select === 'function') query = query.select('id,buyer_id,site,contact_hash');
    const result = await (typeof query.maybeSingle === 'function' ? query.maybeSingle() : query);
    if (result?.error) throw result.error;
    const row = result?.data;
    if (!row) return null;
    return Object.freeze({
        id: String(row.id || ''),
        buyerId: String(row.buyer_id || ''),
        site: String(row.site || ''),
        contactHash: String(row.contact_hash || '')
    });
}

/**
 * Constant-time check that the email submitted with the link belongs to the
 * group the link was minted for.
 *
 * This is checked BEFORE the consume, which is a deliberate anti-griefing
 * choice: an attacker who steals a link but not the email cannot burn it, and
 * a buyer who typos the email does not lose their own link. There is no
 * enumeration cost, because learning anything here already requires the
 * 256-bit token.
 */
function matchesResetContact({ reset, email, security = defaultSecurity, env = {} }) {
    const sec = security || defaultSecurity;
    const expected = String(reset?.contactHash || '');
    if (!expected) return false;
    const normalized = String(email || '').trim().toLowerCase();
    if (!normalized) return false;
    let actual = '';
    try {
        actual = String(sec.hashGuestContact(normalized, { env, strict: true }) || '');
    } catch (_) {
        // A missing/short contact pepper fails closed (§6.3): "cannot prove the
        // email matches" must never become "assume it matches".
        return false;
    }
    if (!actual) return false;
    return sec.constantTimeEqual(expected, actual);
}

/**
 * Apply the new query password.
 *
 * The CAS is on `password_version`, not on `password_hash`, because the whole
 * point of the pv bump in `issuePasswordResetLink` is that the version has
 * already moved: a stale concurrent writer is then guaranteed to miss.
 *
 * The failure counters are cleared here on purpose. `failed_login_count` counts
 * guesses against a password that no longer exists after this write; keeping it
 * would let an attacker's earlier spray lock out a buyer who has just proven
 * link+email possession. This is the same reasoning as the admin unlock, and it
 * is why a reset is audited as `reset_success` rather than as a login.
 */
async function applyPasswordReset({ supabase, buyer, password, security = defaultSecurity, expectedVersion = null, now = new Date() }) {
    const db = assertSupabase(supabase);
    const sec = security || defaultSecurity;
    const normalizedBuyer = normalizeBuyerRow(buyer);
    if (!normalizedBuyer) throw adminAccessError('凭证分组不存在', 'guest_buyer_not_found', 404);
    if (normalizedBuyer.mergedIntoUserId) {
        throw adminAccessError('该凭证分组已并入注册账号', 'guest_buyer_merged', 409);
    }
    let passwordHash = '';
    try {
        passwordHash = sec.hashGuestQueryPassword(password);
    } catch (_) {
        throw adminAccessError('查询密码更新失败，请重试', 'guest_shop_misconfigured', 503, false);
    }
    if (!passwordHash) throw adminAccessError('查询密码更新失败，请重试', 'guest_shop_misconfigured', 503, false);

    const expected = expectedVersion == null ? normalizedBuyer.passwordVersion : normalizeVersion(expectedVersion);
    const next = nextBuyerPasswordVersion(expected);
    const at = (now instanceof Date ? now : new Date()).toISOString();
    let query = db.from(BUYER_TABLE).update({
        password_hash: passwordHash,
        password_version: next,
        password_updated_at: at,
        failed_login_count: 0,
        login_lock_stage: 0,
        locked_until: null,
        updated_at: at
    }).eq('id', normalizedBuyer.id).eq('password_version', expected);
    if (typeof query.select === 'function') query = query.select('id,password_version');
    const result = await (typeof query.maybeSingle === 'function' ? query.maybeSingle() : query);
    if (result?.error) throw result.error;
    if (!result?.data) {
        // Someone else moved the version between the link read and this write.
        // Fail closed: the link is already consumed, so the buyer asks support
        // for a new one rather than us guessing which password won.
        throw adminAccessError('查询密码已被更新，请重新申请找回链接', 'guest_buyer_version_conflict', 409);
    }
    return Object.freeze({ buyerId: normalizedBuyer.id, passwordVersion: next });
}

// ---------------------------------------------------------------------------
// §13.2 historical order self-upgrade
// ---------------------------------------------------------------------------

/**
 * Bind a historical order (`buyer_id IS NULL`) to a credential group.
 *
 * Idempotent by design: a second submit that resolves to the SAME group is a
 * success, not a 409, because the buyer double-clicking must not be told their
 * order is broken. A DIFFERENT group is a hard 409 `guest_order_already_bound`
 * and needs support, exactly as §13.2 specifies.
 *
 * The direct UPDATE is safe with respect to the guest-shop SQL contract: the
 * `guest_shop_orders` triggers guard inventory and payment transitions, and
 * `buyer_id` is not part of any of them (verified against
 * 20260920_guest_shop_buyer_credentials.sql §2).
 */
async function bindOrderToBuyer({ supabase, order, buyerId, now = new Date() }) {
    const db = assertSupabase(supabase);
    const orderId = String(order?.id || '').trim();
    const target = String(buyerId || '').trim();
    if (!isUuid(orderId) || !isUuid(target)) {
        throw adminAccessError('订单或凭证分组无效', 'guest_order_already_bound', 409);
    }
    const at = (now instanceof Date ? now : new Date()).toISOString();
    let query = db.from(ORDER_TABLE).update({ buyer_id: target, updated_at: at })
        .eq('id', orderId)
        .is('buyer_id', null);
    if (typeof query.select === 'function') query = query.select('id,buyer_id');
    const result = await (typeof query.maybeSingle === 'function' ? query.maybeSingle() : query);
    if (result?.error) throw result.error;
    if (result?.data) {
        return Object.freeze({ orderId, buyerId: target, alreadyBound: false });
    }
    // CAS missed: either a concurrent upgrade won, or the order was bound long
    // ago. Re-read and decide — same group is idempotent success.
    const fresh = await db.from(ORDER_TABLE).select('id,buyer_id').eq('id', orderId).maybeSingle();
    if (fresh?.error) throw fresh.error;
    const current = String(fresh?.data?.buyer_id || '').trim();
    if (current && current === target) {
        return Object.freeze({ orderId, buyerId: target, alreadyBound: true });
    }
    throw adminAccessError('该订单已绑定其他查询密码，请联系客服处理', 'guest_order_already_bound', 409);
}

module.exports = {
    ADMIN_CAS_RETRIES,
    BUYER_ACCESS_FIELDS,
    BUYER_ACCESS_SELECT,
    BUYER_PASSWORD_VERSION_MAX,
    MIN_ADMIN_REASON_LENGTH,
    MAX_ADMIN_REASON_LENGTH,
    ORDER_LINK_FIELDS,
    ORDER_LINK_SELECT,
    PENDING_RESET_FIELDS,
    PENDING_RESET_SELECT,
    RESET_ACCESS_OUTCOMES,
    RESET_LINK_TTL_SECONDS,
    RESET_PURPOSE,
    RESET_TABLE,
    RESET_TOKEN_BYTES,
    RESET_TOKEN_LENGTH,
    RESET_TOKEN_PATTERN,
    adminAccessError,
    applyPasswordReset,
    bindOrderToBuyer,
    bumpBuyerPasswordVersion,
    consumeResetToken,
    databaseUnavailable,
    hashResetToken,
    isBuyerLocked,
    isUuid,
    issuePasswordResetLink,
    issueResetToken,
    loadBuyerRowById,
    loadOrderForAccess,
    loadPendingResetByTokenHash,
    matchesResetContact,
    nextBuyerPasswordVersion,
    normalizeBuyerRow,
    normalizeResetToken,
    publicBuyerView,
    resolveBuyerByOrderNo,
    revokePendingResetLinks,
    unlockBuyerLogin
};
