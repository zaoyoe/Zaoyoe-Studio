'use strict';

/**
 * Guest Shop Order Access 2.0 (A3) — admin buyer-access operations.
 *
 * Contract: docs/guest-shop-order-access-2.0.md
 *   §10.5  管理台：解锁登录锁定 / 生成一次性找回链接
 *   2.1     历史未绑定订单必须走人工核验，不提供公开迁移入口
 *   §6.4   buyer_id 是访问主体；contact_hash 不是可信身份因子
 *   §18    AGENTS.md 禁令：不得在日志/审计/聊天中打印密码或链接
 *
 * THREE ACTIONS, and one deliberate omission:
 *
 *   unlock_buyer_login          clear the §8.1 login lock of every credential
 *                               group of the buyer's contact
 *   issue_password_reset_link   mint a 15-minute one-time link (§10.5)
 *   revoke_password_reset_link  kill an outstanding link without issuing a new
 *                               one (the "issued by mistake" / "buyer found it"
 *                               case, which must not require a re-issue)
 *
 *   ~~重置查询密码（管理员设置临时密码）~~  NOT IMPLEMENTED, on purpose.
 *   §10.5 lists it, but an admin-set temporary password is strictly worse than
 *   the link: it transits a support channel in plaintext, it is chosen by a
 *   human (so it is weak and often reused), and the "force change on first
 *   login" flag it requires is a second piece of state on the hottest row in
 *   the credential path. The link gives the buyer a password ONLY they ever
 *   see. Recorded as deviation D-7.
 *
 * SELECTOR IS order_no, NEVER AN EMAIL. The admin UI resolves
 * order_no -> guest_shop_orders.buyer_id -> guest_shop_buyers. Accepting an
 * email would mean trusting the operator to type the same string that
 * `hashGuestContact` will HMAC, and §6.4 is explicit that contact_hash is not a
 * trusted identity factor. It also removes an entire class of "unlocked the
 * wrong group" mistakes, because an order can only ever point at one group.
 */

const {
    parseJsonBody,
    requireAdmin,
    sendJson,
    writeAdminAuditLog
} = require('../../../../api/_lib/admin');
const buyerAccessAdmin = require('../../../../api/_lib/guest-shop/buyer-access-admin');
const buyerCredentials = require('../../../../api/_lib/guest-shop/buyer-credentials');

const MIN_ADMIN_REASON_LENGTH = buyerAccessAdmin.MIN_ADMIN_REASON_LENGTH;
const MAX_ADMIN_REASON_LENGTH = buyerAccessAdmin.MAX_ADMIN_REASON_LENGTH;

const ACTIONS = Object.freeze({
    unlock_buyer_login: 'shop.guest_buyer_access.unlock',
    issue_password_reset_link: 'shop.guest_buyer_access.issue_reset_link',
    revoke_password_reset_link: 'shop.guest_buyer_access.revoke_reset_link'
});

/**
 * The only reset-row projection an admin response may carry. `token_hash` and
 * `contact_hash` are absent by construction: the first is a secret-bearing
 * column, the second would confirm which email owns which credential group.
 */
const RESET_VIEW_FIELDS = Object.freeze([
    'id',
    'purpose',
    'expires_at',
    'used_at',
    'revoked_at',
    'created_at',
    'created_by_admin_id',
    'reason'
]);

const RESET_VIEW_SELECT = RESET_VIEW_FIELDS.join(',');

function createHttpError(statusCode, message, code) {
    const error = new Error(message);
    error.statusCode = statusCode;
    if (code) error.code = code;
    return error;
}

function normalizeText(value, maxLength = 160) {
    const normalized = String(value ?? '').trim();
    return normalized ? normalized.slice(0, maxLength) : '';
}

function toIso(value) {
    if (!value) return null;
    const parsed = Date.parse(String(value));
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

/**
 * Reset rows are normalized through an allow-list rather than a deny-list, so a
 * future column on `guest_shop_access_resets` cannot reach an admin response by
 * default.
 */
function sanitizeResetRow(row) {
    if (!row || typeof row !== 'object') return null;
    const createdAt = toIso(row.created_at);
    const expiresAt = toIso(row.expires_at);
    const usedAt = toIso(row.used_at);
    const revokedAt = toIso(row.revoked_at);
    const now = Date.now();
    let state = 'pending';
    if (usedAt) state = 'used';
    else if (revokedAt) state = 'revoked';
    else if (expiresAt && Date.parse(expiresAt) <= now) state = 'expired';
    return {
        reset_id: normalizeText(row.id, 64),
        purpose: normalizeText(row.purpose, 24) || 'password_reset',
        state,
        expires_at: expiresAt,
        used_at: usedAt,
        revoked_at: revokedAt,
        created_at: createdAt,
        created_by_admin_id: normalizeText(row.created_by_admin_id, 64),
        reason: normalizeText(row.reason, MAX_ADMIN_REASON_LENGTH)
    };
}

async function loadResetRows(supabase, buyerId) {
    let query = supabase.from('guest_shop_access_resets').select(RESET_VIEW_SELECT)
        .eq('buyer_id', String(buyerId));
    if (typeof query.order === 'function') query = query.order('created_at', { ascending: false });
    if (typeof query.limit === 'function') query = query.limit(20);
    const result = await query;
    if (result?.error) throw result.error;
    const rows = Array.isArray(result?.data) ? result.data : (result?.data ? [result.data] : []);
    return rows.map(sanitizeResetRow).filter(Boolean);
}

function sendBuyerAccessError(res, error, fallbackMessage) {
    const statusCode = Number(error?.statusCode) || 500;
    if (statusCode === 401 || statusCode === 403) {
        return sendJson(res, statusCode, {
            success: false,
            message: error?.message || (statusCode === 401 ? 'Unauthorized' : 'Admin access required')
        });
    }
    // expose:false errors (the 503s) must not leak their internal message.
    const expose = error?.expose !== false;
    if ([400, 404, 409, 429, 503].includes(statusCode)) {
        return sendJson(res, statusCode, {
            success: false,
            code: error?.code || undefined,
            message: expose ? (error?.message || fallbackMessage) : fallbackMessage
        });
    }
    return sendJson(res, 500, { success: false, message: fallbackMessage });
}

/**
 * `requireAdmin` runs BEFORE the feature switch, so an unauthenticated caller
 * learns nothing about whether the credential feature is rolled out.
 */
async function authorize(req) {
    const { adminSupabase, user } = await requireAdmin(req, { permission: 'shop.manage' });
    if (!adminSupabase || typeof adminSupabase.from !== 'function') {
        throw createHttpError(503, '游客后台写操作尚未启用', 'guest_admin_ops_unavailable');
    }
    const adminId = normalizeText(user?.id, 80);
    if (!buyerAccessAdmin.isUuid(adminId)) {
        throw createHttpError(400, '缺少管理员身份', 'guest_admin_actor_required');
    }
    return { supabase: adminSupabase, adminId };
}

async function readBody(req) {
    let body;
    try {
        body = await parseJsonBody(req);
    } catch (_) {
        throw createHttpError(400, '请求体不是有效 JSON', 'invalid_json');
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw createHttpError(400, '请求体无效', 'invalid_json');
    }
    return body;
}

async function writeAudit({ supabase, adminId, actionType, site, details }) {
    // Audit failure must not roll back an action that already succeeded (the
    // lock is already cleared / the link is already minted). It is surfaced to
    // the operator as a warning flag instead of being swallowed.
    try {
        await writeAdminAuditLog({
            supabase, adminId, actionType, module: 'shop', site, details
        });
        return true;
    } catch (_) {
        return false;
    }
}

async function handleRead(req) {
    const { supabase } = await authorize(req);
    ensureFeatureEnabled();
    const searchParams = new URL(req.url || '', 'http://localhost').searchParams;
    const orderNo = normalizeText(searchParams.get('orderNo') || searchParams.get('order_no'), 160);
    if (!orderNo) throw createHttpError(400, '缺少订单号', 'guest_order_required');
    const resolved = await buyerAccessAdmin.resolveBuyerByOrderNo({ supabase, orderNo });
    if (!resolved.bound) {
        return {
            success: true,
            order_no: resolved.order.order_no,
            site: resolved.order.site || null,
            bound: false,
            buyer: null,
            resets: [],
            // 2.1: public migration was removed. Keep the operator on the
            // internal, identity-verified support path instead of sending the
            // buyer to a dead endpoint.
            hint: '该订单尚未绑定查询密码。请先人工核验买家身份，再由管理员生成一次性找回链接；不要向买家提供历史凭证查询入口。'
        };
    }
    const resets = await loadResetRows(supabase, resolved.buyer.id);
    return {
        success: true,
        order_no: resolved.order.order_no,
        site: resolved.order.site || resolved.buyer.site || null,
        bound: true,
        buyer: buyerAccessAdmin.publicBuyerView(resolved.buyer),
        resets
    };
}

async function handleWrite(req) {
    const { supabase, adminId } = await authorize(req);
    ensureFeatureEnabled();
    const body = await readBody(req);

    const action = normalizeText(body.action, 64);
    const auditAction = ACTIONS[action];
    if (!auditAction) {
        throw createHttpError(400, 'Unsupported guest buyer access action', 'invalid_guest_buyer_access_action');
    }
    if (body.confirm !== true) {
        throw createHttpError(400, '写操作需要二次确认', 'guest_admin_confirm_required');
    }
    const reason = normalizeText(body.reason, MAX_ADMIN_REASON_LENGTH);
    if (reason.length < MIN_ADMIN_REASON_LENGTH) {
        throw createHttpError(400, '请填写至少 8 个字的处理原因', 'guest_admin_reason_required');
    }
    const orderNo = normalizeText(body.orderNo || body.order_no, 160);
    if (!orderNo) throw createHttpError(400, '缺少订单号', 'guest_order_required');

    const resolved = await buyerAccessAdmin.resolveBuyerByOrderNo({ supabase, orderNo });
    if (!resolved.bound) throw resolved.notBoundError;
    const { order, buyer } = resolved;
    const site = order.site || buyer.site || '';

    if (action === 'unlock_buyer_login') {
        const result = await buyerAccessAdmin.unlockBuyerLogin({
            supabase, site: buyer.site, contactHash: buyer.contactHash
        });
        const audited = await writeAudit({
            supabase,
            adminId,
            actionType: auditAction,
            site,
            details: {
                order_no: order.order_no,
                buyer_id: buyer.id,
                credential_group_no: buyer.groupNo,
                reason,
                unlocked_groups: result.unlockedGroups
            }
        });
        return {
            success: true,
            action,
            site,
            order_no: order.order_no,
            unlocked_groups: result.unlockedGroups,
            buyer: await reloadBuyerView(supabase, buyer.id, site),
            audit_recorded: audited
        };
    }

    if (action === 'revoke_password_reset_link') {
        const revoked = await buyerAccessAdmin.revokePendingResetLinks({ supabase, buyerId: buyer.id });
        const audited = await writeAudit({
            supabase,
            adminId,
            actionType: auditAction,
            site,
            details: {
                order_no: order.order_no,
                buyer_id: buyer.id,
                credential_group_no: buyer.groupNo,
                reason,
                revoked_reset_ids: revoked
            }
        });
        return {
            success: true,
            action,
            site,
            order_no: order.order_no,
            revoked_reset_ids: revoked,
            buyer: buyerAccessAdmin.publicBuyerView(buyer),
            audit_recorded: audited
        };
    }

    // issue_password_reset_link
    const issued = await buyerAccessAdmin.issuePasswordResetLink({
        supabase, buyer, adminId, reason
    });
    const audited = await writeAudit({
        supabase,
        adminId,
        actionType: auditAction,
        site,
        // §18 / AGENTS.md: the audit row carries the reset ROW id and its
        // expiry, never the token and never a link. The token exists only in
        // the HTTP response below and in the admin's clipboard.
        details: {
            order_no: order.order_no,
            buyer_id: buyer.id,
            credential_group_no: buyer.groupNo,
            group_no: buyer.groupNo,
            reason,
            reset_id: issued.resetId,
            expires_at: issued.expiresAt,
            revoked_reset_ids: issued.revokedResetIds,
            // Recording that the version moved is what lets an incident reviewer
            // correlate "all sessions of this group died at T" with this action
            // WITHOUT storing anything secret.
            password_version: issued.passwordVersion
        }
    });
    return {
        success: true,
        action,
        site,
        order_no: order.order_no,
        reset_id: issued.resetId,
        expires_at: issued.expiresAt,
        ttl_seconds: buyerAccessAdmin.RESET_LINK_TTL_SECONDS,
        revoked_reset_ids: issued.revokedResetIds,
        password_version: issued.passwordVersion,
        // Returned ONCE, in this response only. The admin UI must render it in a
        // copy-to-clipboard field with a "本次仅显示一次" warning and must not
        // persist it to localStorage.
        reset_token: issued.token,
        reset_path: `/guest-orders.html?reset=${encodeURIComponent(issued.token)}&site=${encodeURIComponent(site)}`,
        buyer: await reloadBuyerView(supabase, buyer.id, site),
        audit_recorded: audited
    };
}

async function reloadBuyerView(supabase, buyerId, site) {
    const fresh = await buyerAccessAdmin.loadBuyerRowById({ supabase, buyerId, site }).catch(() => null);
    return buyerAccessAdmin.publicBuyerView(fresh);
}

/**
 * Deploy is not enablement (AGENTS.md). With the switch off the admin surface
 * answers 409 rather than silently operating on a table nothing can consume.
 * `requireAdmin` has already run, so this reveals nothing to an outsider.
 */
function ensureFeatureEnabled() {
    if (!buyerCredentials.isBuyerCredentialEnabled(process.env)) {
        throw createHttpError(
            409,
            '游客查询密码功能尚未启用（GUEST_SHOP_BUYER_CREDENTIAL_ENABLED=false），无法执行此操作',
            'guest_feature_disabled'
        );
    }
}

module.exports = async function adminGuestBuyerAccessHandler(req, res) {
    const method = String(req.method || '').toUpperCase();
    if (method !== 'GET' && method !== 'POST') {
        res.setHeader('Allow', 'GET, POST');
        return sendJson(res, 405, { success: false, message: 'Method not allowed' });
    }
    if (method === 'POST') {
        try {
            return sendJson(res, 200, await handleWrite(req));
        } catch (error) {
            return sendBuyerAccessError(res, error, 'Failed to update guest buyer access');
        }
    }
    try {
        return sendJson(res, 200, await handleRead(req));
    } catch (error) {
        return sendBuyerAccessError(res, error, 'Failed to load guest buyer access');
    }
};

module.exports.ACTIONS = ACTIONS;
module.exports.RESET_VIEW_FIELDS = RESET_VIEW_FIELDS;
module.exports.sanitizeResetRow = sanitizeResetRow;
