'use strict';

const crypto = require('node:crypto');
const { filters } = require('../../../tg/operations');
const dataCenter = require('../../../tg/data-center');
const sharedAdmin = require('../../../../api/_lib/admin');
const { requireTgAdmin, requireTgAdminWriteRequest, secureAdminResponse, adminErrorResponse } = require('../../../tg/admin-access');
const { codePepper, encryptionKey } = require('../../../tg/code-secrets');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function text(value, max = 512) { return String(value ?? '').trim().slice(0, max); }
function invalid(message) { return Object.assign(new Error(message), { statusCode: 400, code: 'invalid_request' }); }
function positive(value, name, max) {
    const raw = typeof value === 'number' ? value : String(value ?? '').trim();
    const parsed = Number(raw);
    if (!/^\d+$/.test(String(raw)) || !Number.isSafeInteger(parsed) || parsed <= 0 || parsed > max) throw invalid(`${name} 必须是 1 至 ${max} 的整数`);
    return parsed;
}
function duration(value) {
    const parsed = positive(value, 'term_months', 12);
    if (![3, 6, 12].includes(parsed)) throw invalid('会员时长仅支持 3、6、12 个月');
    return parsed;
}
function parseExpiry(value) {
    if (value === undefined || value === null || value === '') return null;
    const date = new Date(String(value));
    if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) throw invalid('兑换码有效期必须是未来的有效时间');
    return date.toISOString();
}
function encryptCode(code, key) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(code, 'utf8'), cipher.final()]);
    return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ciphertext.toString('base64url')}`;
}
function buildCode(family) {
    const raw = crypto.randomBytes(16).toString('hex').toUpperCase();
    return `TG-${family === 'telegram_stars' ? 'STAR' : 'PREM'}-${raw.match(/.{1,8}/g).join('-')}`;
}
function digest(code, secret) { return crypto.createHmac('sha256', secret).update(code).digest('hex'); }

function decryptCode(record, env) {
    if (typeof record.code_ciphertext !== 'string' || !record.code_ciphertext.trim()) {
        throw Object.assign(new Error('此兑换码没有可恢复的加密原文，请使用生成时保存的原码'), { statusCode: 409, code: 'tg_code_plaintext_unavailable' });
    }
    const key = encryptionKey(env);
    const pepper = codePepper(env);
    try {
        if (record.code_ciphertext.length > 1024) throw new Error('invalid_ciphertext');
        const parts = record.code_ciphertext.split('.');
        if (parts.length !== 4 || parts[0] !== 'v1' || !parts.slice(1).every(part => /^[A-Za-z0-9_-]+$/.test(part))) throw new Error('invalid_ciphertext');
        const [, encodedIv, encodedTag, encodedCiphertext] = parts;
        const iv = Buffer.from(encodedIv, 'base64url');
        const tag = Buffer.from(encodedTag, 'base64url');
        const ciphertext = Buffer.from(encodedCiphertext, 'base64url');
        if (iv.length !== 12 || tag.length !== 16 || ciphertext.length < 1 || ciphertext.length > 512) throw new Error('invalid_ciphertext');
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tag);
        const code = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
        if (!/^TG-(?:PREM|STAR)-(?:[A-F0-9]{8}-){3}[A-F0-9]{8}$/.test(code)
            || code.slice(-4) !== record.code_last4 || !/^[a-f0-9]{64}$/i.test(record.code_digest || '')
            || !crypto.timingSafeEqual(Buffer.from(digest(code, pepper), 'hex'), Buffer.from(record.code_digest, 'hex'))) throw new Error('code_integrity_mismatch');
        return code;
    } catch (_) {
        throw Object.assign(new Error('兑换码暂时无法读取，请核对加密配置或使用原码'), { statusCode: 503, code: 'tg_code_decryption_unavailable' });
    }
}

function createCodesHandler({ admin = sharedAdmin, env = process.env } = {}) {
    return async function handler(req, res) {
        secureAdminResponse(res);
        try {
            const method = String(req.method || '').toUpperCase();
            const { supabase, user } = await requireTgAdmin(req, admin);
            const url = new URL(req.url || '', 'http://localhost');
            if (method === 'GET') {
                const batchId = text(url.searchParams.get('batchId'));
                if (batchId) {
                    if (!UUID_PATTERN.test(batchId)) throw invalid('批次编号无效');
                    const { data: batch, error: batchError } = await supabase.from('tg_redemption_batches').select('*').eq('id', batchId).maybeSingle();
                    if (batchError) throw batchError;
                    if (!batch) return admin.sendJson(res, 404, { success: false, message: '批次不存在' });
                    if (url.searchParams.get('data_center') === '1' && url.searchParams.get('inventory')) {
                        const codeParams = new URLSearchParams(url.searchParams);
                        codeParams.delete('batchId'); codeParams.set('batch_id', batchId);
                        const result = await dataCenter.list(supabase, codeParams, 'code', 1, 1000);
                        return admin.sendJson(res, 200, { success: true, batch, codes: result.rows, filtered: true, total: result.total });
                    }
                    const { data: codes, error } = await supabase.from('tg_redemption_codes')
                        .select('id, batch_id, code_last4, status, expires_at, reserved_at, reservation_expires_at, fulfillment_started_at, fulfilled_at, revoked_at, telegram_username, created_at')
                        .eq('batch_id', batchId).order('created_at').limit(1000);
                    if (error) throw error;
                    return admin.sendJson(res, 200, { success: true, batch, codes: codes || [] });
                }
                const page = positive(url.searchParams.get('page') || 1, 'page', 100000);
                const pageSize = positive(url.searchParams.get('pageSize') || 50, 'pageSize', 100);
                if (url.searchParams.get('data_center') === '1') {
                    const result = await dataCenter.list(supabase, url.searchParams, 'batch', page, pageSize);
                    return admin.sendJson(res, 200, { success: true, batches: result.rows, total: result.total, matching_codes: result.matching_codes, page, page_size: pageSize, snapshot_at: result.snapshot_at });
                }
                let query = supabase.from('tg_redemption_batches').select('*', { count: 'exact' })
                    .order('created_at', { ascending: false }).order('id', { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1);
                query = filters(query, url.searchParams, 'batch');
                const { data, error, count } = await query;
                if (error) throw error;
                return admin.sendJson(res, 200, { success: true, batches: data || [], total: count || 0, page, page_size: pageSize });
            }
            if (method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return admin.sendJson(res, 405, { success: false, message: 'Method not allowed' }); }
            // SameSite cookies also accompany requests from sibling subdomains.
            // Check the exact TG administration origin before parsing any body.
            requireTgAdminWriteRequest(req, env);
            let input;
            try { input = await admin.parseJsonBody(req); } catch (_) { throw invalid('请求内容格式无效'); }
            const action = text(input.action || 'generate').toLowerCase();
            if (action === 'reveal') {
                const codeId = text(input.code_id);
                if (typeof input.code_id !== 'string' || !UUID_PATTERN.test(codeId) || input.batch_id != null) throw invalid('请指定一个有效的兑换码编号');
                const { data: record, error } = await supabase.from('tg_redemption_codes')
                    .select('id, batch_id, code_ciphertext, code_digest, code_last4').eq('id', codeId).maybeSingle();
                if (error) throw error;
                if (!record) return admin.sendJson(res, 404, { success: false, code: 'tg_code_not_found', message: '兑换码不存在' });
                const code = decryptCode(record, env);
                // A plaintext read must have an audit record. The shared best-effort
                // logger intentionally swallows failures, so check this insert directly.
                const { error: auditError } = await supabase.from('admin_audit_logs').insert({
                    admin_id: user.id, target_user_id: null, action_type: 'tg_code_revealed',
                    details: { module: 'tg_redemption', code_id: record.id, batch_id: record.batch_id, code_last4: record.code_last4 }
                });
                if (auditError) throw Object.assign(new Error('audit_unavailable'), { statusCode: 503 });
                return admin.sendJson(res, 200, { success: true, code_id: record.id, code });
            }
            if (action === 'generate') {
                const family = input.product_family === undefined ? 'telegram_premium' : input.product_family;
                if (!['telegram_premium', 'telegram_stars'].includes(family)) throw invalid('兑换商品类型无效');
                const isStars = family === 'telegram_stars';
                let termMonths = null;
                let starsQuantity = null;
                if (isStars) {
                    if ([input.term_months, input.duration_months, input.durationMonths].some((value) => value != null)) throw invalid('Stars 兑换码不能包含会员时长');
                    starsQuantity = positive(input.stars_quantity, 'stars_quantity', 1000000);
                    if (starsQuantity < 50) throw invalid('Stars 数量必须是 50 至 1000000 的整数');
                } else {
                    if (input.stars_quantity != null) throw invalid('会员兑换码不能包含 Stars 数量');
                    termMonths = duration(input.term_months ?? input.duration_months ?? input.durationMonths);
                }
                const count = positive(input.count, 'count', 1000);
                const validUntil = parseExpiry(input.valid_until ?? input.expires_at ?? input.expiresAt);
                const productName = isStars ? `Telegram Stars ${starsQuantity} 颗` : `Telegram Premium ${termMonths} 个月`;
                const metadata = { name: text(input.name || productName, 120), notes: text(input.notes, 1000) || null };
                const encryptionSecret = encryptionKey(env);
                const pepperSecret = codePepper(env);
                const codes = Array.from({ length: count }, () => buildCode(family));
                const batchNo = `TGB-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
                const rows = codes.map((code) => ({ code_digest: digest(code, pepperSecret), code_ciphertext: encryptCode(code, encryptionSecret), code_last4: code.slice(-4) }));
                // A failed transaction never leaves a partially generated active
                // batch, and plaintext codes are returned only after it commits.
                const { data, error } = await supabase.rpc(isStars ? 'fn_tg_generate_stars_batch' : 'fn_tg_generate_batch', {
                    p_batch_no: batchNo, ...(isStars ? { p_stars_quantity: starsQuantity } : { p_term_months: termMonths }), p_quantity: count,
                    p_valid_until: validUntil, p_created_by: user.id, p_metadata: metadata, p_codes: rows
                });
                if (error || data?.success !== true || !data.batch_id) throw error || new Error('TG batch transaction was not confirmed');
                await admin.writeAdminAuditLog({ supabase, adminId: user.id, actionType: 'tg_codes_generated', module: 'tg_redemption', details: { batch_id: data.batch_id, product_family: family, term_months: termMonths, stars_quantity: starsQuantity, count } });
                return admin.sendJson(res, 201, { success: true, batch: { id: data.batch_id, batch_no: data.batch_no, product_family: family, term_months: termMonths, stars_quantity: starsQuantity, quantity: count, generated_count: count, valid_until: validUntil, status: 'active', metadata }, codes });
            }
            if (action === 'revoke') {
                const codeId = text(input.code_id || input.codeId);
                const batchId = text(input.batch_id || input.batchId);
                const reason = text(input.reason, 500) || '管理员撤销';
                if ((!codeId && !batchId) || (codeId && batchId) || (codeId && !UUID_PATTERN.test(codeId)) || (batchId && !UUID_PATTERN.test(batchId))) throw invalid('请指定一个有效的兑换码或批次编号');
                const { data, error } = await supabase.rpc('fn_tg_revoke_codes', { p_code_id: codeId || null, p_batch_id: batchId || null, p_actor: user.id, p_reason: reason });
                if (error || data?.success !== true) throw error || new Error('TG revoke transaction was not confirmed');
                await admin.writeAdminAuditLog({ supabase, adminId: user.id, actionType: 'tg_codes_revoked', module: 'tg_redemption', details: { code_id: codeId || null, batch_id: batchId || null, count: data.revoked_count || 0, reason } });
                return admin.sendJson(res, 200, { success: true, revoked_count: data.revoked_count || 0 });
            }
            throw invalid('不支持的操作');
        } catch (error) {
            return adminErrorResponse(admin, res, error, 'TG 兑换码操作失败，请稍后重试');
        }
    };
}

module.exports = createCodesHandler();
module.exports.createCodesHandler = createCodesHandler;
