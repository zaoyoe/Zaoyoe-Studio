'use strict';

const domain = require('./gpt-outsourcing');
const fail = (code, message, statusCode = 400) => Object.assign(new Error(message), { code, statusCode });
const PUBLIC_TASK_STATUSES = new Set(['running', 'manual', 'success', 'failed', 'cancelled', 'maintenance']);
const PUBLIC_PHASES = new Set(['preflight', 'submitting', 'polling', 'awaiting_credentials', 'supplementing', 'unknown', 'finished', 'legacy_unknown']);
const PUBLIC_PAYMENT_STATES = new Set(['not_started', 'declined', 'charged', 'paid', 'succeeded', 'captured', 'unknown']);
const PUBLIC_COUNTRIES = new Set(['US', 'PH', 'EG', 'CL']);
const PUBLIC_CURRENCIES = new Set(['USD', 'PHP', 'EGP', 'CLP']);
const ERROR_MESSAGES = Object.freeze({
    GPT_OUTSOURCE_CONFIG_INVALID: '请填写有效 API Key 和供应商提供的完整 HTTPS API 地址（包含接口路径）',
    GPT_OUTSOURCE_MAPPING_INVALID: '套餐映射包含无效或冲突的配置',
    GPT_OUTSOURCE_REGION_INVALID: '外包渠道的国家与币种不匹配',
    OUTSOURCE_NEW_ENDPOINT_KEY_REQUIRED: '更换供应商地址时，请重新填写该供应商的 API Key',
    OUTSOURCE_SESSION_INVALID: 'Session 必须是有效的完整 JSON 对象',
    OUTSOURCE_STATUS_INVALID: '订单筛选状态无效',
    OUTSOURCE_BUSY: '该订单正在核查，请稍后再试',
    OUTSOURCE_CVC_INVALID: '请填写有效的安全码',
    OUTSOURCE_ORDER_NOT_FOUND: '原订单不存在或不可补交凭证',
    OUTSOURCE_CREDENTIALS_NOT_REQUIRED: '原订单当前不允许补交凭证，请先核查结果',
    OUTSOURCE_ACCOUNT_MISMATCH: '新 Session 必须属于原订单的同一账号',
    OUTSOURCE_LEGACY_UNCONFIRMED: '历史订单缺少供应商绑定信息，请人工核对',
    OUTSOURCE_CHANNEL_CHANGED: '订单原供应商配置已变更，请恢复原渠道后核查'
});

function mergeChannelConfig(saved, body = {}, { allowIncompleteDisabled = false } = {}) {
    const enteredKey = String(body.api_key || '').trim();
    const base = String(body.base_url ?? saved.base_url ?? '').trim().replace(/\/+$/, '');
    const savedBase = String(saved.base_url || '').trim().replace(/\/+$/, '');
    if (base !== savedBase && !enteredKey) {
        throw fail('OUTSOURCE_NEW_ENDPOINT_KEY_REQUIRED', '更换供应商地址时，请重新填写该供应商的 API Key');
    }
    const merged = { ...saved, ...body, base_url: base, api_key: enteredKey || saved.api_key,
        enabled: body.enabled === undefined ? Boolean(saved.enabled) : body.enabled === true };
    // Old installations can always disable an incomplete channel. No guessed
    // API prefix is saved or requested and no key is moved to another endpoint.
    if (allowIncompleteDisabled && !merged.enabled && base === savedBase && !enteredKey) {
        try { return domain.validateOutsourceConfig(merged, { requireKey: false }); }
        catch (error) {
            if (error.code !== 'GPT_OUTSOURCE_CONFIG_INVALID') throw error;
            return { ...domain.validateOutsourceConfig({ ...merged, base_url: 'https://configuration.invalid/api' },
                { requireKey: false }), base_url: base };
        }
    }
    return domain.validateOutsourceConfig(merged, { requireKey: merged.enabled || !allowIncompleteDisabled });
}

function publicReferenceId(value) {
    if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? value : null;
    const text = String(value ?? '').trim();
    if (!/^\d{1,40}$/.test(text) || /^0+$/.test(text)) return null;
    const numeric = Number(text);
    return Number.isSafeInteger(numeric) ? numeric : text;
}

function publicEnum(value, supported, fallback) {
    const text = String(value || '').trim().toLowerCase();
    return supported.has(text) ? text : fallback;
}

function publicPlanType(value) {
    try { return domain.canonicalizeOutsourcePlan(value); } catch (_) { return null; }
}

function publicPlanKey(value) {
    const text = String(value || '').trim();
    return /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(text) ? text : null;
}

function publicRegion(value, supported) {
    const text = String(value || '').trim().toUpperCase();
    return supported.has(text) ? text : null;
}

function publicTimestamp(value) {
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
    if (typeof value !== 'string') return null;
    const text = value.trim();
    if (text.length > 64 || !/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(text)) return null;
    const iso = text.replace(' ', 'T');
    const hasZone = /(?:Z|[+-]\d{2}:\d{2})$/.test(iso);
    const timestamp = Date.parse(hasZone ? iso : `${iso}Z`);
    if (!Number.isFinite(timestamp)) return null;
    if (new Date(timestamp).toISOString().slice(0, 10) !== iso.slice(0, 10) && !hasZone) return null;
    return new Date(timestamp).toISOString();
}

function publicOrder(row) {
    row = row && typeof row === 'object' && !Array.isArray(row) ? row : {};
    let envelope = {};
    try { envelope = typeof row.gpt_api_raw === 'string' ? JSON.parse(row.gpt_api_raw) : row.gpt_api_raw || {}; } catch (_) { }
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) envelope = {};
    const candidate = envelope.attempt ?? row.attempt;
    const attempt = candidate && typeof candidate === 'object' && !Array.isArray(candidate) ? candidate : {};
    const status = publicEnum(row.status, PUBLIC_TASK_STATUSES, 'manual');
    const settlement = publicEnum(attempt.settlement, new Set(['success', 'no_charge', 'hold']), 'hold');
    const phase = publicEnum(attempt.state, PUBLIC_PHASES, 'legacy_unknown');
    const terminal = ['success', 'no_charge'].includes(settlement);
    const orderId = publicReferenceId(attempt.orderId ?? row.gpt_api_order_id);
    const taskId = publicReferenceId(attempt.taskId ?? row.gpt_api_task_id);
    const upstreamStatus = domain.safeStatus(attempt.upstreamStatus);
    const jobKey = typeof row.job_key === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(row.job_key)
        ? row.job_key : null;
    return {
        job_key: jobKey, status,
        message: settlement === 'success' ? '外包代充已成功'
            : settlement === 'no_charge' ? '已确认未扣款，卡密未使用'
                : phase === 'awaiting_credentials' ? '原订单需要补交凭证，资产已保留'
                    : phase === 'polling' ? '供应商正在处理原订单'
                        : '原订单结果待确认，资产已保留，请勿重复充值',
        phase, plan_type: publicPlanType(attempt.planType), provider_plan_key: publicPlanKey(attempt.planKey),
        country: publicRegion(attempt.country, PUBLIC_COUNTRIES), currency: publicRegion(attempt.currency, PUBLIC_CURRENCIES),
        card_last4: /^\d{4}$/.test(String(attempt.cardLast4 || '')) ? attempt.cardLast4 : null,
        order_id: orderId, task_id: taskId,
        payment_state: publicEnum(row.payment_state || attempt.paymentState, PUBLIC_PAYMENT_STATES, 'unknown'),
        recovery_required: row.recovery_required === true || row.recovery_required === 1 || row.recovery_required === '1'
            || attempt.recoveryRequired === true,
        upstream_status: upstreamStatus, created_at: publicTimestamp(attempt.createdAt ?? row.created_at),
        updated_at: publicTimestamp(row.updated_at), last_checked_at: publicTimestamp(attempt.lastCheckedAt),
        can_recheck: !terminal,
        can_supplement_credentials: !terminal && attempt.existingOrderReused !== true
            && phase === 'awaiting_credentials' && upstreamStatus === 'requires_cvc'
            && Boolean(orderId && attempt.endpoint && /^[a-f0-9]{64}$/i.test(String(attempt.apiKeyFingerprint || '')))
    };
}

function createGptOutsourcingAdmin({ store, client, service, ensureStoreReady = async () => {}, log = () => {} }) {
    function handler(action) {
        return async (req, res) => {
            try { await ensureStoreReady(); return await action(req, res); }
            catch (error) {
                const expected = /^GPT_OUTSOURCE_|^OUTSOURCE_/.test(String(error.code || ''));
                log(`外包渠道后台操作未完成 code=${expected ? error.code : 'OUTSOURCE_ADMIN_UNAVAILABLE'}`);
                return res.status(expected ? error.statusCode || 400 : 503).json({ success: false,
                    code: expected ? error.code : 'OUTSOURCE_ADMIN_UNAVAILABLE',
                    message: ERROR_MESSAGES[error.code] || '渠道操作暂未完成，请检查配置并核查原订单' });
            }
        };
    }
    const getConfig = handler(async (_req, res) => {
        const cfg = await store.getGptApiConfig();
        return res.json({ success: true, config: { enabled: cfg.enabled, base_url: cfg.base_url,
            api_key_saved: Boolean(cfg.api_key), api_key_preview: client.maskApiKey(cfg.api_key),
            plan_mapping: cfg.plan_mapping || {}, country: cfg.country, currency: cfg.currency } });
    });
    const saveConfig = handler(async (req, res) => {
        const cfg = mergeChannelConfig(await store.getGptApiConfig(), req.body, { allowIncompleteDisabled: true });
        await store.saveGptApiConfig({ enabled: cfg.enabled, base_url: cfg.base_url, api_key: cfg.api_key,
            plan_mapping: cfg.plan_mapping, country: cfg.country, currency: cfg.currency });
        return res.json({ success: true, message: 'GPT 外包代充渠道配置已保存' });
    });
    const test = handler(async (req, res) => {
        const cfg = mergeChannelConfig(await store.getGptApiConfig(), req.body);
        const result = await client.testConnection(cfg);
        const selections = [];
        for (const [plan, key] of Object.entries(cfg.plan_mapping)) {
            try {
                selections.push(domain.resolveOutsourcePlan(plan, result.plans, cfg.plan_mapping));
                result.checks.push({ key: `mapping_${plan}`, label: `${plan} → ${key} 商品匹配`, state: 'passed' });
            } catch (error) {
                result.success = false;
                result.checks.push({ key: `mapping_${plan}`, label: `${plan} → ${key} 商品匹配`, state: 'failed',
                    code: error.code, error: error.message });
            }
        }
        if (!Object.keys(cfg.plan_mapping).length) {
            result.success = false;
            result.checks.push({ key: 'mapping', label: '本地套餐映射', state: 'failed', error: '尚未配置任何套餐映射' });
        }
        if (req.body?.session != null) {
            const session = req.body.session;
            if (!session || typeof session !== 'object' || Array.isArray(session)) {
                throw fail('OUTSOURCE_SESSION_INVALID', 'Session 必须是完整 JSON 对象');
            }
            const selection = selections[0];
            const inspected = selection ? await client.inspectPay(cfg, { planKey: selection.planKey, session }) : null;
            result.checks = result.checks.filter(check => check.key !== 'inspect');
            result.checks.push({ key: 'inspect', label: 'Session 格式与有效期检查',
                state: inspected?.success ? 'passed' : 'failed',
                error: inspected?.success ? undefined : inspected?.error || '需先通过套餐匹配检查' });
            result.checks.push({ key: 'official_login', label: '官方账号实际登录', state: 'unverified' });
            if (!inspected?.success) result.success = false;
        }
        result.message = result.success ? '只读检查与已配置商品匹配通过；实际登录、建单及付款仍未验证'
            : '协议检查未全部通过，详情见检查结果；未创建充值订单';
        return res.status(result.success ? 200 : 400).json(result);
    });
    const status = handler(async (_req, res) => {
        const saved = await store.getGptApiConfig();
        if (!saved.enabled) return res.json({ success: true, enabled: false, gpt_plans: [], credit_plans: [],
            balance: null, message: '渠道已关闭，未查询供应商；本地订单仍可核查' });
        const cfg = domain.validateOutsourceConfig(saved);
        const result = await client.testConnection(cfg);
        return res.status(result.success ? 200 : 400).json({ ...result, enabled: true,
            gpt_plans: result.gptPlans, credit_plans: result.creditPlans,
            balance_error: result.success ? null : result.error });
    });
    const orders = handler(async (req, res) => {
        const status = String(req.query?.status || '');
        if (status && !['running', 'manual', 'success', 'failed', 'cancelled'].includes(status)) {
            throw fail('OUTSOURCE_STATUS_INVALID', '订单筛选状态无效');
        }
        const listing = await store.listGptApiAttempts({ limit: req.query?.limit, offset: req.query?.offset, status });
        return res.json({ success: true, ...listing, orders: listing.orders.map(publicOrder) });
    });
    const recheck = handler(async (req, res) => {
        const result = await service.recheck(String(req.params.jobKey || ''));
        return res.json({ success: true, message: result.assetsHeld || result.finished === false
            ? '原订单仍在处理或待确认，已保留资产，请勿重复充值' : '原订单核查完成',
            status: result.attempt?.status || null, recovery_required: Boolean(result.attempt?.recoveryRequired) });
    });
    const credentials = handler(async (req, res) => {
        const result = await service.supplement(String(req.params.jobKey || ''), req.body || {});
        return res.status(result.accepted ? 200 : 409).json({ success: Boolean(result.accepted),
            message: result.accepted ? '凭证已发送给原订单，等待供应商确认' : '补交结果待确认，已保留原订单和资产，请勿重复充值' });
    });
    return { getConfig, saveConfig, test, status, orders, recheck, credentials };
}

module.exports = { mergeChannelConfig, publicOrder, createGptOutsourcingAdmin };
