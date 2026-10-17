'use strict';

const crypto = require('node:crypto');
const security = require('../../api/_lib/guest-shop/security');
const { codePepper } = require('./code-secrets');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const HEADER = 'x-tg-order-credential';
const GROUP_CAP = 5;
function failure(message, statusCode = 503, code = 'order_query_unavailable') {
    return Object.assign(new Error(message), { statusCode, code, queryAccessError: true });
}
function unavailable() { return failure('邮箱订单查询升级尚未完成，请暂用原订单号和查询凭证查询。'); }
function denied() { return failure('邮箱或查询密码不正确，请核对下单时填写的信息。', 403, 'order_query_credentials_invalid'); }
function credentials(email, password, { creating = false } = {}) {
    try {
        const parsed = security.parseGuestOrderCredentialHeader(security.buildGuestOrderCredentialHeader(email, password));
        if (creating) security.assertGuestQueryPasswordPolicy(parsed.password, {
            email: parsed.email, minLength: 8, field: 'query_password', forbiddenTokens: ['fatherkey.com', 'zaoyoe.xyz']
        });
        return parsed;
    } catch (error) {
        throw failure(creating && error.code === 'guest_password_weak' ? error.message : '请输入有效邮箱和查询密码。', 400, 'order_query_credentials_invalid');
    }
}
function contactHash(email, env) {
    // Domain separation keeps the email index distinct from redemption-code
    // digests. The password itself uses the shop's salted scrypt implementation.
    return crypto.createHmac('sha256', codePepper(env)).update(`tg-order-query:email:v1\0${email}`).digest('hex');
}
async function rpc(db, name, args) {
    const result = await db.rpc(name, args);
    if (result?.error) {
        if (String(result.error.message || '').includes('tg_query_binding_conflict')) {
            throw failure('原订单已绑定其他查询信息，请使用原邮箱和查询密码。', 409, 'order_query_binding_conflict');
        }
        throw unavailable();
    }
    return result?.data;
}
async function ready(db) {
    try { return !!db?.rpc && await rpc(db, 'fn_tg_order_query_contract', {}) === 1; } catch (_) { return false; }
}
async function groups(db, hash) {
    const result = await db.from('tg_order_query_buyers').select('id,contact_hash,password_hash,group_no')
        .eq('contact_hash', hash).order('group_no', { ascending: true }).limit(GROUP_CAP + 1);
    if (result?.error || !Array.isArray(result?.data) || result.data.length > GROUP_CAP
        || result.data.some(row => !UUID.test(row.id || '') || row.contact_hash !== hash
            || !security.parseGuestQueryPasswordHash(row.password_hash).ok)) throw unavailable();
    return result.data;
}
function matchedBuyer(rows, password) {
    let match = null;
    if (!rows.length) security.runDummyGuestQueryPasswordVerification();
    for (const row of rows) {
        if (security.verifyGuestQueryPassword(password, row.password_hash).ok) {
            if (match) throw unavailable();
            match = row;
        }
    }
    return match;
}
async function createBuyer(db, input, env) {
    const parsed = credentials(input.query_email, input.query_password, { creating: true });
    const hash = contactHash(parsed.email, env);
    for (let attempt = 0; attempt < 2; attempt++) {
        const rows = await groups(db, hash);
        const matched = matchedBuyer(rows, parsed.password);
        if (matched) return matched.id;
        if (rows.length >= GROUP_CAP) throw failure('此邮箱已设置多组查询密码，请使用之前的查询密码。', 409, 'order_query_group_limit');
        const allocated = await rpc(db, 'fn_tg_upsert_query_buyer', {
            p_contact_hash: hash, p_password_hash: security.hashGuestQueryPassword(parsed.password), p_expected_groups: rows.length
        });
        if (UUID.test(allocated?.buyer_id || '')) return allocated.buyer_id;
        if (allocated?.code !== 'retry') throw unavailable();
    }
    throw failure('查询信息正在更新，请稍后重试。', 409, 'order_query_retry');
}
async function prepareCreation(db, input, env) {
    // Legacy callers retain bearer-token access. New UI collects these fields
    // only after the database contract is available, allowing an additive rollout.
    if (input.query_email === undefined && input.query_password === undefined) return null;
    if (!await ready(db)) throw unavailable();
    return createBuyer(db, input, env);
}
async function authenticate({ db, email, password, env, requestSecurity, req, res }) {
    const parsed = credentials(email, password);
    const hash = contactHash(parsed.email, env);
    const rate = await requestSecurity.takeRateLimitToken({ supabase: db, env,
        key: `tg:order-query:email:${hash}`, limit: 20, windowMs: 60000,
        requirePersistent: requestSecurity._private.isProductionLikeRuntime(env) });
    requestSecurity.applyRateLimitHeaders(res, rate);
    if (!rate.allowed) throw failure(rate.unavailable ? '查询服务暂不可用，请稍后重试。' : '查询过于频繁，请稍后重试。', rate.unavailable ? 503 : 429, 'order_query_rate_limited');
    if (!await ready(db)) throw unavailable();
    const matched = matchedBuyer(await groups(db, hash), parsed.password);
    if (!matched) throw denied();
    return matched.id;
}
async function ownedTokenHash({ db, kind, orderNo, ...context }) {
    let parsed;
    try { parsed = security.parseGuestOrderCredentialHeader(context.req.headers?.[HEADER]); } catch (_) { throw denied(); }
    const buyerId = await authenticate({ ...context, db, ...parsed });
    const hash = await rpc(db, 'fn_tg_query_order_token_hash', { p_buyer_id: buyerId, p_kind: kind, p_order_no: orderNo });
    if (typeof hash !== 'string' || !HASH.test(hash)) throw failure('订单不存在或不属于这组查询信息。', 404, 'not_found');
    return hash;
}
function rejectUrlCredentials(req) {
    const params = new URL(req.url || '/', 'https://tg.fatherkey.com').searchParams;
    if (['email', 'password', 'query_email', 'query_password', 'credential'].some(key => params.has(key))) {
        throw failure('查询信息只能通过表单提交，请勿放入网址。', 400, 'invalid_request');
    }
}
function sendError(res, error) {
    if (!error?.queryAccessError) return false;
    res.status(error.statusCode); res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer');
    res.end(JSON.stringify({ success: false, code: error.code, message: error.message }));
    return true;
}
module.exports = { HEADER, ready, credentials, contactHash, prepareCreation, createBuyer, authenticate, ownedTokenHash, rpc, failure, sendError, rejectUrlCredentials };
