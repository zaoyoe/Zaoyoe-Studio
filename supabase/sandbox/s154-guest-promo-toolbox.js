#!/usr/bin/env node
'use strict';

/**
 * s154-guest-promo-toolbox.js · §15.4 九项沙箱验证 · service_role 诊断工具箱
 * ============================================================================
 * 为什么需要它（**先读这段**）
 * ----------------------------------------------------------------------------
 * 促销侧的四个关键函数都是 SECURITY DEFINER，且第一行就调
 * guest_shop_require_service_role()，它读的是 auth.role()（即 PostgREST 从
 * JWT 注入的 request.jwt.claim(s) GUC）。在 Supabase SQL Editor 里 auth.role()
 * 解析成 'anon'，所以**直接 SELECT 这些函数一定失败**：
 *     ERROR: guest shop RPC requires service_role
 * 本工具箱走 PostgREST + service_role JWT，auth.role() 天然是 'service_role'，
 * 因此一定能调通。SQL Editor 负责"改配置"（S154_fixture_setup.sql /
 * S154_cleanup.sql，表 owner 权限足够），本工具箱负责"调 RPC + 打 HTTP"，
 * 两者职责不重叠。
 *
 * 红线（与 AGENTS.md 一致，违反即视为事故）
 * ----------------------------------------------------------------------------
 *   R1 不执行任何 SQL/DDL。本文件只通过 PostgREST 调既有的 RPC 与读写既有表。
 *   R2 永不打印密钥：GUEST_SHOP_* pepper、zpay pid/pkey、worker secret、
 *      claim secret、卡密内容、password_hash、完整 contact_hash / ip_hash。
 *      输出前统一过 redact()，且 integration 对象整体不进输出。
 *   R3 所有**写**动作（breaker / sweep / simulate-zpay-underpay）必须显式 --yes，
 *      且默认只允许打本机回环地址；打非回环主机必须再加 --allow-remote-host。
 *   R4 不启用游客商品、不打开游客开关、不改预算/券配置（那是 SQL Editor 的活）。
 *   R5 evaluate 是**只读**函数（不写台账、不占额度），可以随便调；
 *      reserve 才是写路径，本工具箱**不提供** reserve 子命令 ——
 *      真实抵扣只能通过真实下单产生，这样台账里的每一行都对应一次真实请求。
 *
 * 用法
 * ----------------------------------------------------------------------------
 *   node supabase/sandbox/s154-guest-promo-toolbox.js <command> [options]
 *
 *   status                                  只读 · fn_guest_shop_promo_status()
 *   gate      --site cn --amount 1.00       只读 · guest_shop_promo_gate()
 *   evaluate  --site cn --product <uuid> --sku <uuid> --unit 10.00
 *             --code SBXPROMO10 [--buyer <uuid> | --latest-buyer]
 *             [--qty 1] [--ip-hash <64hex>] [--max-per-contact 3] [--max-per-ip 10]
 *                                           只读 · fn_guest_shop_evaluate_discount()
 *                                           ← 排查"为什么显示优惠码不可用"的主力：
 *                                             它会把 13 个内部 reject code 原样吐出来，
 *                                             而公网 HTTP 只会统一显示一个
 *                                             guest_discount_unavailable
 *   breaker   open|closed --actor <名字> [--reason <原因>] --yes
 *                                           写 · fn_guest_shop_promo_set_breaker()
 *                                           （会自动写 manual_open/manual_close 审计行）
 *   sweep     [--base-url http://127.0.0.1:8000] --yes
 *                                           写 · POST /api/shop/guest/worker
 *                                           第 7 项 TTL 归还用
 *   simulate-zpay-underpay
 *             --merchant-order-no <no> --money 9.00
 *             [--base-url http://127.0.0.1:8000] --yes
 *                                           写 · 伪造一个"少付"的易支付回调
 *                                           第 3 项用
 *
 *   全局：--env-file <path>（可重复；默认走 preview 同款 5 文件链）  --json
 *
 * 退出码：0 成功 / 1 命令自身判定失败（如 RPC 返回 allowed=false，属正常业务结果）
 *         / 2 用法或环境错误 / 3 护栏拦截（缺 --yes、非回环主机、金额不合法等）
 */

const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const { loadEnvFile } = require(path.join(REPO_ROOT, 'scripts', 'guest-shop-readiness'));
const { createGuestShopPaymentAdapter } = require(path.join(REPO_ROOT, 'api', '_lib', 'payments', 'guest-shop-adapter'));
const { buildZpaySign } = require(path.join(REPO_ROOT, 'api', '_lib', 'payments', 'zpay'));

const DEFAULT_BASE_URL = 'http://127.0.0.1:8000';
const SBX_PREFIX = 'SBX';

/**
 * 与 scripts/local-preview-server.js 的 getDefaultEnvFiles **完全同源**。
 * 必须走链而不是单文件：仓库里没有任何一个文件同时含
 * SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY（在 server/.env）与
 * GUEST_SHOP_WORKER_SECRET（在 .env.local）。后面的文件覆盖前面的，
 * process.env 覆盖全部 —— 与 preview 的行为一致，避免"工具箱看到的配置
 * 和本地服务看到的配置不是同一份"这种最难查的偏差。
 */
function getDefaultEnvFiles(repoRoot = REPO_ROOT) {
    return [
        path.join(repoRoot, 'server', '.env.staging'),
        path.join(repoRoot, 'server', '.env'),
        path.join(repoRoot, '.env'),
        path.join(repoRoot, '.env.local'),
        path.join(repoRoot, '.vercel', '.env.production.local')
    ];
}

function loadEnvChain(envFiles = getDefaultEnvFiles(), baseEnv = process.env) {
    const merged = {};
    for (const filePath of envFiles) {
        // loadEnvFile 对缺失文件静默跳过，并把入参当作 base 合并进来。
        Object.assign(merged, loadEnvFile(filePath, merged));
    }
    return { ...merged, ...(baseEnv && typeof baseEnv === 'object' ? baseEnv : {}) };
}

// R2 · 输出脱敏。任何键名命中即整条丢弃（连值都不进 JSON）。
const FORBIDDEN_OUTPUT_KEYS = new Set([
    'claim_secret',
    'claim_secret_hash',
    'recovery_code',
    'content',
    'card_content',
    'card_secret',
    'inventory_content',
    'response_payload',
    'payload_redacted',
    'raw_body',
    'secret',
    'provider_metadata',
    'pkey',
    'zpay_pkey',
    'pid',
    'integration',
    'secret_values',
    'secretvalues',
    'password_hash',
    'buyer_password_hash',
    'access_token',
    'authorization',
    'apikey',
    'service_role_key'
]);

// 兜底：键名里出现这些片段也一律丢弃（防未来新增字段漏网）。
const FORBIDDEN_KEY_PATTERN = /(pkey|pepper|secret|password|token|api[_-]?key|card|content|authorization)/iu;

// 完整哈希不许出门，只留前 12 位。
const HASH_KEYS = new Set(['buyer_contact_hash', 'contact_hash', 'request_ip_hash', 'ip_hash', 'request_device_hash', 'body_sha256']);

const COMMANDS = new Set(['status', 'gate', 'evaluate', 'breaker', 'record-event', 'sweep', 'simulate-zpay-underpay', 'help']);
const WRITE_COMMANDS = new Set(['breaker', 'record-event', 'sweep', 'simulate-zpay-underpay']);

// 与 guest_shop_promo_breaker_events_kind_check 逐字一致（迁移 :495-497）。
const BREAKER_EVENT_KINDS = Object.freeze([
    'amount_mismatch', 'identity_limit_hit', 'budget_exhausted',
    'code_exhausted', 'manual_open', 'manual_close', 'auto_open'
]);

// 与 guest_shop_promo_breaker_events_detail_no_secrets_check 逐字一致（迁移 :503-514）。
// 提前在本地拦，避免 DB CHECK 抛错时你只看到一句 23514 而不知道是哪个键。
const FORBIDDEN_DETAIL_KEYS = Object.freeze([
    'email', 'buyer_contact_hash', 'contact_hash', 'claim_secret_hash',
    'password_hash', 'buyer_password_hash', 'content', 'card_content',
    'access_token', 'authorization'
]);

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

function normalizeText(value, maxLength = 500) {
    if (value === undefined || value === null) return '';
    return String(value).trim().slice(0, Math.max(0, Number(maxLength) || 0));
}

function parseNumber(value, fallback = Number.NaN) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function round2(value) {
    const parsed = parseNumber(value, Number.NaN);
    if (!Number.isFinite(parsed)) return null;
    return Math.round(parsed * 100) / 100;
}

function shortHash(value) {
    const text = normalizeText(value, 200);
    return text ? `${text.slice(0, 12)}…(${text.length})` : '';
}

/** 递归脱敏。返回 undefined 表示"该键整条丢弃"。 */
function redact(value, key = '') {
    const lowerKey = normalizeText(key, 120).toLowerCase();
    if (lowerKey && (FORBIDDEN_OUTPUT_KEYS.has(lowerKey) || FORBIDDEN_KEY_PATTERN.test(lowerKey))) {
        return undefined;
    }
    if (lowerKey && HASH_KEYS.has(lowerKey)) {
        return value === null || value === undefined ? value : shortHash(value);
    }
    if (value === undefined || value === null) return value;
    if (Array.isArray(value)) {
        return value.map((item) => redact(item, '')).filter((item) => item !== undefined);
    }
    if (typeof value === 'object') {
        const next = {};
        for (const [childKey, childValue] of Object.entries(value)) {
            const sanitized = redact(childValue, childKey);
            if (sanitized !== undefined) next[childKey] = sanitized;
        }
        return next;
    }
    return value;
}

function firstEnvValue(env, names) {
    for (const name of names) {
        const value = normalizeText(env?.[name], 4096);
        if (value) return value;
    }
    return '';
}

function createSupabaseFromEnv(env) {
    const url = firstEnvValue(env, ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'PUBLIC_SUPABASE_URL']);
    const key = firstEnvValue(env, ['SUPABASE_SERVICE_ROLE_KEY']);
    if (!url || !key) {
        throw usageError('缺少 SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY。用 --env-file 指定含这两项的文件（例如 .env.local 或 server/.env.production）。');
    }
    return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

class ToolboxError extends Error {
    constructor(message, exitCode = 2) {
        super(message);
        this.name = 'ToolboxError';
        this.exitCode = exitCode;
    }
}

function usageError(message) {
    return new ToolboxError(message, 2);
}

function guardError(message) {
    return new ToolboxError(message, 3);
}

function parseArgs(argv = []) {
    const options = {
        command: '',
        positional: [],
        envFile: '',          // 空 = 走 preview 同款 5 文件链；给了就只读这一个
        envFiles: null,
        json: false,
        yes: false,
        allowRemoteHost: false,
        baseUrl: normalizeText(process.env.GUEST_SHOP_SANDBOX_BASE_URL, 300) || DEFAULT_BASE_URL,
        site: 'cn',
        amount: null,
        money: null,
        product: '',
        sku: '',
        unit: null,
        qty: 1,
        code: '',
        buyer: '',
        latestBuyer: false,
        ipHash: '',
        maxPerContact: 3,
        maxPerIp: 10,
        actor: '',
        reason: '',
        merchantOrderNo: '',
        state: '',
        kind: '',
        detailJson: ''
    };

    const takeValue = (index, flag) => {
        const next = normalizeText(argv[index + 1], 4096);
        if (!next) throw usageError(`${flag} 需要一个值。`);
        return next;
    };

    for (let index = 0; index < argv.length; index += 1) {
        const raw = String(argv[index] || '').trim();
        if (!raw) continue;
        if (!raw.startsWith('--')) {
            if (!options.command) options.command = raw.toLowerCase();
            else if (raw.toLowerCase() === 'open' || raw.toLowerCase() === 'closed') options.state = raw.toLowerCase();
            else options.positional.push(raw);
            continue;
        }
        switch (raw) {
            case '--json': options.json = true; break;
            case '--yes': case '-y': options.yes = true; break;
            case '--latest-buyer': options.latestBuyer = true; break;
            case '--allow-remote-host': options.allowRemoteHost = true; break;
            case '--env-file':
                // 允许重复传，按传入顺序叠加（后面的赢），与 preview 链语义一致。
                options.envFiles = (options.envFiles || []).concat(path.resolve(process.cwd(), takeValue(index, raw)));
                options.envFile = path.resolve(process.cwd(), takeValue(index, raw));
                index += 1;
                break;
            case '--base-url': options.baseUrl = normalizeText(takeValue(index, raw), 300); index += 1; break;
            case '--site': options.site = normalizeText(takeValue(index, raw), 10).toLowerCase(); index += 1; break;
            case '--amount': options.amount = takeValue(index, raw); index += 1; break;
            case '--money': options.money = takeValue(index, raw); index += 1; break;
            case '--product': options.product = takeValue(index, raw); index += 1; break;
            case '--sku': options.sku = takeValue(index, raw); index += 1; break;
            case '--unit': options.unit = takeValue(index, raw); index += 1; break;
            case '--qty': options.qty = parseNumber(takeValue(index, raw), 1); index += 1; break;
            case '--code': options.code = normalizeText(takeValue(index, raw), 64).toUpperCase(); index += 1; break;
            case '--buyer': options.buyer = takeValue(index, raw); index += 1; break;
            case '--ip-hash': options.ipHash = takeValue(index, raw); index += 1; break;
            case '--max-per-contact': options.maxPerContact = parseNumber(takeValue(index, raw), 3); index += 1; break;
            case '--max-per-ip': options.maxPerIp = parseNumber(takeValue(index, raw), 10); index += 1; break;
            case '--actor': options.actor = takeValue(index, raw); index += 1; break;
            case '--reason': options.reason = takeValue(index, raw); index += 1; break;
            case '--merchant-order-no': options.merchantOrderNo = takeValue(index, raw); index += 1; break;
            case '--kind': options.kind = normalizeText(takeValue(index, raw), 40).toLowerCase(); index += 1; break;
            case '--detail-json': options.detailJson = takeValue(index, raw); index += 1; break;
            case '--help': case '-h': options.command = 'help'; break;
            default: throw usageError(`未知参数：${raw}`);
        }
    }

    if (!options.command) options.command = 'help';
    if (!COMMANDS.has(options.command)) throw usageError(`未知命令：${options.command}（可用：${[...COMMANDS].join(' / ')}）`);
    if (!['cn', 'intl'].includes(options.site)) throw usageError(`--site 只能是 cn / intl，当前=${options.site}`);
    return options;
}

/** R3 · 写命令的三重闸：--yes、回环主机、命令白名单。 */
const BASE_URL_COMMANDS = new Set(['sweep', 'simulate-zpay-underpay']);

function assertWriteAllowed(options, command) {
    if (!WRITE_COMMANDS.has(command)) return;
    if (!options.yes) {
        throw guardError(`${command} 是**写**动作，必须显式加 --yes 才会执行。`);
    }
    // breaker 只走 PostgREST，不打 base-url，所以不做回环检查。
    if (BASE_URL_COMMANDS.has(command)) assertLoopbackBaseUrl(options);
}

function assertLoopbackBaseUrl(options) {
    let host = '';
    try {
        host = new URL(options.baseUrl).hostname.toLowerCase();
    } catch (_) {
        throw usageError(`--base-url 不是合法 URL：${options.baseUrl}`);
    }
    const loopback = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
    if (!loopback && !options.allowRemoteHost) {
        throw guardError(
            `--base-url 指向非回环主机「${host}」。沙箱只应打本机 preview（${DEFAULT_BASE_URL}）。`
            + '确认你就是要打远端时，再加 --allow-remote-host。'
        );
    }
}

async function callRpc(supabase, fn, params) {
    const { data, error } = await supabase.rpc(fn, params);
    if (error) {
        throw new ToolboxError(`RPC ${fn} 失败：${normalizeText(error.message, 300)}（code=${normalizeText(error.code, 60)}）`, 1);
    }
    return data;
}

// ---------------------------------------------------------------------------
// 子命令
// ---------------------------------------------------------------------------

async function cmdStatus({ supabase }) {
    const status = await callRpc(supabase, 'fn_guest_shop_promo_status', {});
    return { ok: true, exitCode: 0, title: 'fn_guest_shop_promo_status()', payload: status };
}

function validateGate(options) {
    if (options.amount === null || options.amount === '') return null;
    const amount = round2(options.amount);
    if (amount === null) throw usageError(`--amount 不是合法数字：${options.amount}`);
    if (amount <= 0) {
        throw usageError(`--amount 必须 > 0（想问"下一笔 ¥1.00 抵扣会不会被拦"就传 1.00），当前=${amount}`);
    }
    return amount;
}

async function cmdGate({ supabase, options }) {
    const amount = validateGate(options);
    const gate = await callRpc(supabase, 'guest_shop_promo_gate', {
        p_site: options.site,
        p_discount_amount: amount
    });
    const allowed = Boolean(gate && gate.allowed === true);
    return {
        ok: allowed,
        exitCode: 0,
        title: `guest_shop_promo_gate(site=${options.site}, amount=${amount === null ? 'NULL' : amount})`,
        payload: gate
    };
}

async function resolveBuyer(supabase, options) {
    if (options.buyer) {
        const { data, error } = await supabase
            .from('guest_shop_buyers')
            .select('id, site, contact_hash, credential_group_no, registered_user_match')
            .eq('id', options.buyer)
            .maybeSingle();
        if (error) throw error;
        if (!data) throw usageError(`guest_shop_buyers 里找不到 id=${options.buyer}`);
        return data;
    }
    if (options.latestBuyer) {
        const { data, error } = await supabase
            .from('guest_shop_buyers')
            .select('id, site, contact_hash, credential_group_no, registered_user_match')
            .eq('site', options.site)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (error) throw error;
        if (!data) throw usageError(`site=${options.site} 还没有任何 buyer 行。先在前端下过一单，或用 --buyer 指定 id。`);
        return data;
    }
    throw usageError('evaluate 需要 --buyer <uuid> 或 --latest-buyer。');
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function validateEvaluate(options) {
    if (!options.product) throw usageError('evaluate 需要 --product <uuid>。');
    if (!options.sku) throw usageError('evaluate 需要 --sku <uuid>。');
    if (!UUID_PATTERN.test(options.product)) throw usageError(`--product 不是合法 UUID：${options.product}`);
    if (!UUID_PATTERN.test(options.sku)) throw usageError(`--sku 不是合法 UUID：${options.sku}`);

    const unit = round2(options.unit);
    if (unit === null || unit <= 0) throw usageError(`evaluate 需要合法的 --unit（>0），当前=${options.unit}`);

    const qty = Math.trunc(parseNumber(options.qty, 1));
    if (!Number.isInteger(qty) || qty < 1 || qty > 5) throw usageError(`--qty 只能是 1~5（DB CHECK 同口径），当前=${options.qty}`);

    if (!options.buyer && !options.latestBuyer) {
        throw usageError('evaluate 需要 --buyer <uuid> 或 --latest-buyer（contact_hash 只能从库里读，本工具**绝不**自己用 pepper 算哈希）。');
    }
    if (options.buyer && !UUID_PATTERN.test(options.buyer)) {
        throw usageError(`--buyer 不是合法 UUID：${options.buyer}`);
    }

    const ipHash = normalizeText(options.ipHash, 200) || null;
    if (ipHash && !/^[0-9a-f]{64}$/iu.test(ipHash)) {
        throw usageError('--ip-hash 必须是 64 位小写十六进制（与 request_ip_hash 的 DB CHECK 同口径）。留空则传 NULL，per-IP 限流不计数。');
    }

    const maxPerContact = Math.trunc(parseNumber(options.maxPerContact, 3));
    const maxPerIp = Math.trunc(parseNumber(options.maxPerIp, 10));
    // DB 侧把这两个值硬夹到 <=10 / <=50；这里提前拦，避免你以为放宽了其实没放宽。
    if (!Number.isInteger(maxPerContact) || maxPerContact < 1 || maxPerContact > 10) {
        throw usageError(`--max-per-contact 只能是 1~10（DB 侧硬夹上限 10），当前=${options.maxPerContact}`);
    }
    if (!Number.isInteger(maxPerIp) || maxPerIp < 1 || maxPerIp > 50) {
        throw usageError(`--max-per-ip 只能是 1~50（DB 侧硬夹上限 50），当前=${options.maxPerIp}`);
    }

    return { unit, qty, ipHash, maxPerContact, maxPerIp };
}

async function cmdEvaluate({ supabase, options }) {
    const { unit, qty, ipHash, maxPerContact, maxPerIp } = validateEvaluate(options);
    const buyer = await resolveBuyer(supabase, options);

    const result = await callRpc(supabase, 'fn_guest_shop_evaluate_discount', {
        p_site: options.site,
        p_product_id: options.product,
        p_sku_id: options.sku,
        p_quantity: qty,
        p_list_unit_amount: unit,
        p_discount_code: options.code || null,
        p_buyer_id: buyer.id,
        p_buyer_contact_hash: buyer.contact_hash,
        p_request_ip_hash: ipHash,
        p_max_per_contact_24h: maxPerContact,
        p_max_per_ip_24h: maxPerIp
    });

    const allowed = Boolean(result && result.allowed === true);
    return {
        ok: allowed,
        exitCode: 0,
        title: 'fn_guest_shop_evaluate_discount()（只读：不写台账、不占 24h 额度、不改计数器）',
        payload: {
            request: {
                site: options.site,
                product_id: options.product,
                sku_id: options.sku,
                quantity: qty,
                list_unit_amount: unit,
                discount_code: options.code || null,
                buyer_id: buyer.id,
                buyer_contact_hash: shortHash(buyer.contact_hash),
                request_ip_hash: ipHash ? shortHash(ipHash) : null,
                max_per_contact_24h: maxPerContact,
                max_per_ip_24h: maxPerIp
            },
            buyer_context: {
                credential_group_no: buyer.credential_group_no,
                registered_user_match: buyer.registered_user_match
            },
            result
        },
        hint: allowed
            ? null
            : '内部 reject code 见 result.code。公网 HTTP 只会把它统一显示成「优惠码不可用」（guest_discount_unavailable），所以这一步是唯一能看到真实原因的地方。'
    };
}

function validateBreaker(options) {
    const state = options.state || normalizeText(options.positional[0], 16).toLowerCase();
    if (!['open', 'closed'].includes(state)) {
        throw usageError('breaker 需要子状态：breaker open|closed --actor <名字> [--reason <原因>] --yes');
    }
    const actor = normalizeText(options.actor, 120);
    if (actor.length < 2) throw usageError('--actor 至少 2 个字符（要写进 opened_by / closed_by 做审计）。');
    const reason = normalizeText(options.reason, 160);
    if (state === 'open' && reason.length < 4) {
        throw usageError('open 必须给 --reason（>= 4 字符）：DB 侧 fn_guest_shop_promo_set_breaker 也是这个要求。');
    }
    return { state, actor, reason };
}

async function cmdBreaker({ supabase, options }) {
    const { state, actor, reason } = validateBreaker(options);
    const returned = await callRpc(supabase, 'fn_guest_shop_promo_set_breaker', {
        p_state: state,
        p_reason: reason || null,
        p_actor: actor
    });
    const status = await callRpc(supabase, 'fn_guest_shop_promo_status', {});
    return {
        ok: true,
        exitCode: 0,
        title: `fn_guest_shop_promo_set_breaker('${state}') → ${normalizeText(returned, 20)}`,
        payload: { returned, breaker_after: status && status.breaker, budget_after: status && status.budget },
        hint: state === 'open'
            ? '熔断已打开：所有游客抵扣被拒，但**原价游客结账不受影响**（这正是第 8 项要验的降级语义）。恢复：breaker closed --actor <名字> --yes'
            : '熔断已合上，审计行 manual_close 已由函数写入 guest_shop_promo_breaker_events。'
    };
}

// ---------------------------------------------------------------------------
// record-event · 直接调 fn_guest_shop_promo_record_event()
// ---------------------------------------------------------------------------
// **为什么需要它**：§15.4 第 3 项原文要求「少付 → 熔断计数 +1」。DB 侧的自动跳闸
// 机器（滚动窗口计数 → 达阈值 auto_open → 写审计行）在迁移 :681-773 里是**完整的**，
// 但 Node 侧的 webhook 拒绝路径**没有接线**去调它（全仓 grep `record_event`
// 只有 readiness 的静态正则命中，没有任何调用点）。所以第 3 项的「+1」这一半
// 在端到端层面**当前无法通过**。
//
// 本子命令把这一半拆成**可独立验证的单元**：由你手工投喂 kind='amount_mismatch'
// 事件，验证「投喂 3 次（mismatch_trip_threshold 默认 3）→ breaker 自动 open
// → 事件表多一行 auto_open」。这样归档时能明确区分：
//   ✓ DB 自动跳闸机器本身是对的（本子命令验证）
//   ✗ webhook → record_event 的接线缺失（这是待补的缺陷，不是验证失败）
// 没有这个子命令，你只能把第 3 项整条记成「未验证」，把两件事混为一谈。
//
// 红线：detail 里**绝不**放 email / contact_hash / 任何密钥（DB CHECK 也会拒），
//       validateRecordEvent 先在本地把键名逐个过一遍。

function validateRecordEvent(options) {
    const kind = normalizeText(options.kind, 40).toLowerCase();
    if (!BREAKER_EVENT_KINDS.includes(kind)) {
        throw usageError(
            `--kind 只能是 ${BREAKER_EVENT_KINDS.join(' / ')} 之一（与 DB CHECK 逐字一致），当前=${kind || '<空>'}`
        );
    }
    // manual_open / manual_close / auto_open 是**函数自己写**的审计行，
    // 手工投喂会伪造出一条"有人手工合闸/跳闸"的假审计，污染第 8 项的证据链。
    if (kind === 'manual_open' || kind === 'manual_close' || kind === 'auto_open') {
        throw guardError(
            `--kind ${kind} 是 fn_guest_shop_promo_set_breaker / 自动跳闸**自己写**的审计行，`
            + '手工投喂等于伪造审计。要跳闸/合闸请用：breaker open|closed --actor <名字> --yes'
        );
    }
    if (!['cn', 'intl'].includes(options.site)) {
        throw usageError(`--site 只能是 cn / intl，当前=${options.site}`);
    }

    const rawDetail = normalizeText(options.detailJson, 4000);
    let detail = { source: 's154-toolbox' };
    if (rawDetail) {
        let parsed;
        try {
            parsed = JSON.parse(rawDetail);
        } catch (error) {
            throw usageError(`--detail-json 不是合法 JSON：${normalizeText(error && error.message, 200)}`);
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw usageError('--detail-json 必须是 JSON **对象**（DB CHECK 要求 jsonb_typeof(detail)=\'object\'）。');
        }
        for (const key of Object.keys(parsed)) {
            const lower = normalizeText(key, 120).toLowerCase();
            if (FORBIDDEN_DETAIL_KEYS.includes(lower) || FORBIDDEN_KEY_PATTERN.test(lower)) {
                throw guardError(
                    `--detail-json 含被禁键「${key}」。审计 detail 里不得出现 email / contact_hash / `
                    + '任何密钥（guest_shop_promo_breaker_events_detail_no_secrets_check 也会拒）。'
                );
            }
        }
        detail = { source: 's154-toolbox', ...parsed };
    }
    return { kind, site: options.site, detail };
}

async function cmdRecordEvent({ supabase, options }) {
    const { kind, site, detail } = validateRecordEvent(options);

    const statusBefore = await callRpc(supabase, 'fn_guest_shop_promo_status', {});
    const returned = await callRpc(supabase, 'fn_guest_shop_promo_record_event', {
        p_kind: kind,
        p_site: site,
        p_detail: detail
    });
    const statusAfter = await callRpc(supabase, 'fn_guest_shop_promo_status', {});

    const stateBefore = normalizeText(statusBefore?.breaker?.state, 20);
    const stateAfter = normalizeText(statusAfter?.breaker?.state, 20);
    const countBefore = Number(statusBefore?.events_24h?.[kind] || 0);
    const countAfter = Number(statusAfter?.events_24h?.[kind] || 0);
    const tripped = stateBefore === 'closed' && stateAfter === 'open';

    return {
        ok: countAfter === countBefore + 1,
        exitCode: 0,
        title: `fn_guest_shop_promo_record_event('${kind}', '${site}') → ${normalizeText(returned, 20)}`,
        payload: {
            detail_keys: Object.keys(detail),
            breaker_before: statusBefore?.breaker || null,
            breaker_after: statusAfter?.breaker || null,
            event_count_24h_before: countBefore,
            event_count_24h_after: countAfter,
            auto_tripped: tripped
        },
        hint: kind === 'amount_mismatch'
            ? `第 3 项的「熔断计数 +1」**DB 侧**判据：event_count_24h 从 ${countBefore} → ${countAfter}。`
              + `阈值 mismatch_trip_threshold=${statusAfter?.breaker?.mismatch_trip_threshold ?? '?'}，`
              + '连投到阈值即应 auto_tripped=true，且事件表多一行 kind=auto_open（用 S154_probe_readonly.sql 段 13 核对）。'
              + '⚠️ 端到端仍未接线：真实少付回调**不会**自己投喂这个事件，归档时把「接线缺失」记为待补缺陷。'
              + '跳闸后记得 breaker closed --actor <你的名字> --yes 恢复，否则第 4~9 项全部会被拒。'
            : `已投喂 ${kind}。budget_exhausted / code_exhausted 不参与自动跳闸（只有 amount_mismatch 与 identity_limit_hit 会），仅作为事件计数与 7 天保留窗口的验证。`
    };
}

function validateSweep(options, env) {
    const workerSecret = firstEnvValue(env, ['GUEST_SHOP_WORKER_SECRET']);
    if (!workerSecret) {
        throw usageError('缺少 GUEST_SHOP_WORKER_SECRET（env 链里要有，默认链已含 .env.local）。本工具**不会**回退去用 CRON_SECRET —— 那两个凭据必须保持独立。');
    }
    return workerSecret;
}

async function cmdSweep({ supabase, options, env }) {
    const workerSecret = validateSweep(options, env);
    const url = `${options.baseUrl.replace(/\/+$/, '')}/api/shop/guest/worker`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'x-guest-shop-worker-secret': workerSecret }
    });
    const text = await response.text();
    let body = null;
    try { body = JSON.parse(text); } catch (_) { body = { raw_length: text.length }; }
    return {
        ok: response.ok,
        exitCode: response.ok ? 0 : 1,
        title: `POST ${url}`,
        payload: { http_status: response.status, body },
        hint: '第 7 项期望：过期未付订单 reservation_status held → released，shop_inventory 对应行 reserve → available，'
            + '券的 guest_used_count / guest_discount_total 与 budget.spent_cny **同步**回落，redemption 行 returned_at 有值。'
            + '容器日志里还会有 [GuestShopMonitor] Sweep complete: 一行。'
    };
}

async function loadZpayRuntime({ supabase, env, site }) {
    const adapter = createGuestShopPaymentAdapter({ supabase, env });
    // integration 里有 pid/pkey，**整体不进输出**（R2）。
    const runtime = await adapter.resolveRuntime({ provider: 'zpay', site });
    const pid = normalizeText(runtime?.integration?.pid, 64);
    const pkey = normalizeText(runtime?.integration?.pkey, 200);
    if (!pid || !pkey) {
        throw usageError(`site=${site} 的易支付 pid/pkey 未就绪，无法伪造回调。先确认支付通道配置（不要在这里打印密钥）。`);
    }
    return { pid, pkey };
}

function validateSimulate(options) {
    const merchantOrderNo = normalizeText(options.merchantOrderNo, 160);
    if (!merchantOrderNo) throw usageError('需要 --merchant-order-no（guest_shop_payment_orders.merchant_order_no）。');
    const money = round2(options.money);
    if (money === null || money <= 0) throw usageError(`--money 必须是 > 0 的金额，当前=${options.money}`);
    return { merchantOrderNo, money };
}

async function cmdSimulateZpayUnderpay({ supabase, options, env }) {
    const { merchantOrderNo, money } = validateSimulate(options);

    const { data: payment, error: paymentError } = await supabase
        .from('guest_shop_payment_orders')
        .select('id, merchant_order_no, provider, site, currency, expected_amount, paid_amount, status, amount_verified, sign_verified, guest_order_id')
        .eq('merchant_order_no', merchantOrderNo)
        .maybeSingle();
    if (paymentError) throw paymentError;
    if (!payment) throw usageError(`找不到 merchant_order_no=${merchantOrderNo} 的支付单。`);
    if (normalizeText(payment.provider, 40).toLowerCase() !== 'zpay') {
        throw usageError(`该支付单的 provider=${payment.provider}，不是 zpay。本子命令只伪造易支付回调。`);
    }

    const expected = round2(payment.expected_amount);
    if (expected === null) throw usageError('该支付单的 expected_amount 不可读，拒绝伪造。');
    if (money >= expected) {
        throw guardError(
            `--money ${money} 必须**严格小于** expected_amount ${expected}（第 3 项验的是"少付被拒"）。`
            + '想验全额到账请走真实支付，不要用本工具伪造成功回调。'
        );
    }
    if (payment.status === 'paid' || payment.amount_verified === true) {
        throw guardError(`该支付单已是 status=${payment.status} / amount_verified=${payment.amount_verified}，拒绝再打伪造回调（会污染一笔好单的证据）。`);
    }

    const { data: order, error: orderError } = await supabase
        .from('guest_shop_orders')
        .select('order_no, site, discount_code, total_amount, payment_status, fulfillment_status')
        .eq('id', payment.guest_order_id)
        .maybeSingle();
    if (orderError) throw orderError;
    if (!normalizeText(order?.discount_code, 64).toUpperCase().startsWith(SBX_PREFIX)) {
        throw guardError(
            `该订单的 discount_code=${normalizeText(order?.discount_code, 64) || '<空>'}，不是 ${SBX_PREFIX} 前缀的沙箱单。`
            + '本工具只对沙箱单伪造回调，避免动到真实交易。'
        );
    }

    const { pid, pkey } = await loadZpayRuntime({ supabase, env, site: normalizeText(payment.site, 10).toLowerCase() || options.site });

    // 与 api/_lib/payments/zpay.js 的 buildZpaySign 完全同源：
    // 排序后的 k=v&… 拼接 + pkey 再取 md5，跳过 sign / sign_type / 空值。
    const payload = {
        pid,
        trade_no: `SBXSIM${Date.now()}`,
        out_trade_no: merchantOrderNo,
        trade_status: 'TRADE_SUCCESS',
        money: money.toFixed(2),
        type: 'alipay',
        name: 'S154 underpay simulation'
    };
    const sign = buildZpaySign(payload, pkey);
    const body = new URLSearchParams({ ...payload, sign_type: 'md5', sign }).toString();

    const url = `${options.baseUrl.replace(/\/+$/, '')}/api/shop/guest/webhooks/zpay`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body
    });
    const text = await response.text();
    let responseBody = null;
    try { responseBody = JSON.parse(text); } catch (_) { responseBody = { raw_length: text.length }; }

    const { data: events, error: eventsError } = await supabase
        .from('guest_shop_payment_events')
        .select('id, merchant_order_no, event_type, observed_status, signature_verified, amount_verified, currency_verified, final_status_verified, processing_status, error_code, created_at')
        .eq('merchant_order_no', merchantOrderNo)
        .order('created_at', { ascending: false })
        .limit(3);
    if (eventsError) throw eventsError;

    const { data: orderAfter, error: orderAfterError } = await supabase
        .from('guest_shop_orders')
        .select('order_no, payment_status, fulfillment_status, reservation_status')
        .eq('id', payment.guest_order_id)
        .maybeSingle();
    if (orderAfterError) throw orderAfterError;

    const latest = Array.isArray(events) && events.length ? events[0] : null;
    const rejected = normalizeText(latest?.processing_status, 40).toLowerCase() === 'rejected';
    const notFulfilled = normalizeText(orderAfter?.fulfillment_status, 40).toLowerCase() !== 'fulfilled';

    return {
        ok: rejected && notFulfilled,
        exitCode: 0,
        title: `伪造少付回调 → POST ${url}`,
        payload: {
            submitted: {
                merchant_order_no: merchantOrderNo,
                money: money.toFixed(2),
                expected_amount: expected,
                trade_status: 'TRADE_SUCCESS',
                signed_with_provider_pkey: true,
                pid_printed: false,
                pkey_printed: false
            },
            http_status: response.status,
            response_body: responseBody,
            latest_payment_event: latest,
            order_after: orderAfter
        },
        hint: '第 3 项判据：processing_status=rejected、amount_verified=false、'
            + 'error_code=guest_webhook_verification_failed，且订单仍 pending / 未发货（never confirm_payment）。'
            + '⚠️ 计划原文那句「熔断计数 +1」**当前未接线**：webhook 拒绝路径不写 '
            + 'amount_mismatch 事件，所以 breaker_events 不会 +1。归档时按"偏差"记录，不要写 PASS。'
    };
}

// ---------------------------------------------------------------------------
// 输出
// ---------------------------------------------------------------------------

function formatHuman(result) {
    const lines = [];
    lines.push(`\n=== ${result.title} ===`);
    lines.push(JSON.stringify(redact(result.payload), null, 2));
    if (result.hint) {
        lines.push('');
        lines.push(`说明：${result.hint}`);
    }
    lines.push(`\n结论：${result.ok ? '符合预期 ✓' : '未通过 / 需要人工判读 ✗'}`);
    return `${lines.join('\n')}\n`;
}

function usage() {
    return `
s154-guest-promo-toolbox · §15.4 沙箱诊断工具箱（service_role RPC + 本机 HTTP）

只读命令（可以随便跑，不写库、不占额度）
  status
  gate      --site cn --amount 1.00
  evaluate  --site cn --product <uuid> --sku <uuid> --unit 10.00 --code SBXPROMO10
            (--buyer <uuid> | --latest-buyer) [--qty 1] [--ip-hash <64hex>]

写命令（必须 --yes；默认只打 ${DEFAULT_BASE_URL}）
  breaker   open|closed --actor <名字> [--reason <原因>] --yes
  record-event --kind amount_mismatch --site cn [--detail-json '{"probe":1}'] --yes
            手工投喂熔断事件（第 3 项 DB 侧自动跳闸机器的**单元**验证；
            端到端接线仍缺失。kind 不得用 manual_open/manual_close/auto_open）
  sweep     [--base-url <url>] --yes
  simulate-zpay-underpay --merchant-order-no <no> --money 9.00 [--base-url <url>] --yes

全局
  --env-file <path>   可重复；默认走 preview 同款 5 文件链
                      (server/.env.staging → server/.env → .env → .env.local
                       → .vercel/.env.production.local)
  --json              机器可读输出
  --allow-remote-host 允许打非回环主机（谨慎）

红线：不执行 SQL/DDL、不打印任何密钥、不提供 reserve（真实抵扣只能来自真实下单）。
`;
}

async function run(argv = process.argv.slice(2), dependencies = {}) {
    const options = dependencies.options || parseArgs(argv);
    if (options.command === 'help') {
        (dependencies.stdout || process.stdout).write(usage());
        return 0;
    }

    const env = dependencies.env || loadEnvChain(
        options.envFiles && options.envFiles.length ? options.envFiles : getDefaultEnvFiles(),
        process.env
    );

    // 先做**纯参数校验**（不碰网络、不碰数据库），再做写动作护栏，最后才建连接。
    // 顺序很重要：护栏必须在"缺凭据"之前触发，否则 --yes 忘了加会被
    // "缺少 SUPABASE_URL" 之类的报错掩盖，你就以为命令跑过了。
    switch (options.command) {
        case 'gate': validateGate(options); break;
        case 'evaluate': validateEvaluate(options); break;
        case 'breaker': validateBreaker(options); break;
        case 'record-event': validateRecordEvent(options); break;
        case 'sweep': validateSweep(options, env); break;
        case 'simulate-zpay-underpay': validateSimulate(options); break;
        default: break;
    }
    assertWriteAllowed(options, options.command);

    const supabase = dependencies.supabase || createSupabaseFromEnv(env);
    const context = { supabase, options, env };
    let result;
    switch (options.command) {
        case 'status': result = await cmdStatus(context); break;
        case 'gate': result = await cmdGate(context); break;
        case 'evaluate': result = await cmdEvaluate(context); break;
        case 'breaker': result = await cmdBreaker(context); break;
        case 'record-event': result = await cmdRecordEvent(context); break;
        case 'sweep': result = await cmdSweep(context); break;
        case 'simulate-zpay-underpay': result = await cmdSimulateZpayUnderpay(context); break;
        default: throw usageError(`未知命令：${options.command}`);
    }

    const output = options.json
        ? `${JSON.stringify(redact({ ok: result.ok, title: result.title, payload: result.payload, hint: result.hint || null }), null, 2)}\n`
        : formatHuman(result);
    (dependencies.stdout || process.stdout).write(output);
    return typeof result.exitCode === 'number' ? result.exitCode : 0;
}

if (require.main === module) {
    run().then((code) => {
        process.exit(code);
    }).catch((error) => {
        const message = normalizeText(error?.message || error, 400);
        const code = error instanceof ToolboxError ? error.exitCode : 2;
        process.stderr.write(`${code === 3 ? '护栏拦截' : '工具箱失败'}：${message}\n`);
        process.exit(code);
    });
}

module.exports = {
    BASE_URL_COMMANDS,
    COMMANDS,
    FORBIDDEN_OUTPUT_KEYS,
    WRITE_COMMANDS,
    getDefaultEnvFiles,
    loadEnvChain,
    parseArgs,
    redact,
    shortHash,
    BREAKER_EVENT_KINDS,
    FORBIDDEN_DETAIL_KEYS,
    validateBreaker,
    validateEvaluate,
    validateRecordEvent,
    validateGate,
    validateSimulate,
    validateSweep,
    run
};
