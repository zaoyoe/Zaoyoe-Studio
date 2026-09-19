'use strict';

/**
 * 游客促销 L1/L2：create-order 的错误契约（plan §11.2 / C-E6，纯静态 + 本地桩）
 *
 * 为什么必须有这个文件
 * ---------------------------------------------------------------------------
 * `fn_guest_shop_create_order` 及其被调函数把每一种拒绝都写成
 * `RAISE EXCEPTION 'guest_*'`，PostgREST 客户端把它变成
 * `{ code: 'P0001', message: 'guest_*', details: '<中文说明>' }`。
 * 如果没有映射层：
 *   1. 一个优惠码打错的买家会收到 500 `P0001`，和「服务真的坏了」无法区分；
 *   2. 前端 `handleCreateOrderError` 拿不到能识别的 code，优惠行不会被收回，
 *      屏幕上会留着一笔从未成立的优惠（这正是 §9.6 想避免的失败模式）；
 *   3. 如果把 SQL 的 message/details 直接回显，就等于给攻击者一个
 *      「这个券码存在吗 / 还有余量吗 / 是不是定向券」的枚举预言机。
 *
 * 所以映射表是唯一能把 SQL 异常翻译成买家可见响应的地方，并且必须同时满足：
 *   - C-E6 收敛：所有券生命周期拒绝 → 同一个 code / 同一个状态码 / 同一句话；
 *   - fail-closed：表里没有的 code 一律原样透传（保持 L1/L2 之前的 500）；
 *   - 不泄漏：响应体只有 success/code/message，SQL 内部码留在服务端对象上。
 *
 * 本文件同时反向锁住「迁移里新增的 RAISE 必须进映射表」：任何一条 create 路径
 * 上的 `guest_*` 异常没有公开映射就直接红，避免下一次改 SQL 时静默退化成 500。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const promo = require('../api/_lib/guest-shop/promo');
const defaultSecurity = require('../api/_lib/guest-shop/security');
const { createGuestShopHandlers } = require('../server/api-handlers/public/guest-shop');

const REPO_ROOT = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(REPO_ROOT, relative), 'utf8');

const migrationSql = read('supabase/migrations/20260923_guest_shop_promo_l1l2.sql');
const handlerSource = read('server/api-handlers/public/guest-shop.js');
const clientSource = read('js/guest-shop-client.js');

// The functions whose exceptions can surface from POST /api/shop/guest/orders.
const CREATE_ORDER_SQL_FUNCTIONS = [
    'fn_guest_shop_create_order',
    'fn_guest_shop_reserve_discount',
    'fn_guest_shop_evaluate_discount',
    'guest_shop_promo_gate'
];

/** Slice one plpgsql function out of the migration (start of CREATE → next CREATE). */
function sqlFunctionBody(name) {
    const start = migrationSql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
    assert.ok(start >= 0, `migration must keep CREATE OR REPLACE FUNCTION public.${name}`);
    const next = migrationSql.indexOf('CREATE OR REPLACE FUNCTION public.', start + 1);
    return next === -1 ? migrationSql.slice(start) : migrationSql.slice(start, next);
}

/**
 * Every machine code a piece of SQL can signal a rejection with. Only three
 * shapes ever reach a buyer, so only these three are collected; every other
 * quoted literal (column names, table names, audit event kinds) is by
 * definition not an exception message and must not dilute the contract check:
 *   1. bare:          RAISE EXCEPTION 'guest_x';
 *   2. dynamic:       RAISE EXCEPTION '%', COALESCE(NULLIF(BTRIM(v_x ->> 'code'), ''), 'guest_x')
 *   3. JSONB signal:  jsonb_build_object('code', 'guest_x', ...) - what shape 2
 *                     forwards. fn_guest_shop_evaluate_discount and
 *                     guest_shop_promo_gate never RAISE themselves; they RETURN
 *                     these payloads and fn_guest_shop_reserve_discount re-raises
 *                     them through shape 2, so collecting all three shapes over
 *                     the four create-path functions yields exactly the codes a
 *                     POST /api/shop/guest/orders rejection can carry.
 */
function raisedCodesIn(text) {
    const codes = new Set();
    for (const match of text.matchAll(/RAISE EXCEPTION\s+'(guest_[a-z0-9_]+)'/gu)) codes.add(match[1]);
    for (const match of text.matchAll(/RAISE EXCEPTION\s+'%',[^;]*?'(guest_[a-z0-9_]+)'/gu)) codes.add(match[1]);
    for (const match of text.matchAll(/'code'\s*,\s*'(guest_[a-z0-9_]+)'/gu)) codes.add(match[1]);
    return codes;
}

/** Codes the four create-order-path SQL functions can surface. */
function createPathCodes() {
    const codes = new Set();
    for (const name of CREATE_ORDER_SQL_FUNCTIONS) {
        for (const code of raisedCodesIn(sqlFunctionBody(name))) codes.add(code);
    }
    return codes;
}

/**
 * Two table entries are legitimately not raised by the create-path functions.
 * Both are pinned here so "not stale" stays a proven property instead of an
 * allowlist that silently grows:
 *   - guest_provider_order_conflict: raised elsewhere in the SAME migration
 *     (fn_guest_shop_confirm_payment). The create-order table is the handler's
 *     single mapping surface, so the entry rides along; the test below proves
 *     the migration still raises it.
 *   - guest_discount_unavailable: the public C-E6 code itself, kept as a
 *     defensive self-alias so a future RAISE that uses the public name directly
 *     still lands on the one frozen response instead of fail-closing to a 500.
 */
const CROSS_PATH_TABLE_ENTRIES = ['guest_provider_order_conflict'];
const PUBLIC_SELF_ALIAS = 'guest_discount_unavailable';

test('every guest_* rejection on the create-order path has a public HTTP mapping', () => {
    const table = promo.GUEST_CREATE_ORDER_ERROR_CONTRACT;
    const raised = createPathCodes();
    // Sanity: the collector itself must not silently rot. If a future migration
    // reformats every RAISE so the patterns stop matching, `raised` collapses
    // and the unmapped check below would pass vacuously.
    assert.ok(raised.size >= 40, `the create path raises ${raised.size} codes; expected the full L1/L2 family (>=40)`);
    const unmapped = [...raised].filter((code) => !Object.prototype.hasOwnProperty.call(table, code));
    assert.deepEqual(
        unmapped,
        [],
        'a RAISE on the create path without a mapping degrades to a 500 P0001 for the buyer'
    );
    // The self-alias must map onto the SAME frozen response every coupon code
    // collapses to - otherwise it is not an alias but a second opinion.
    assert.equal(
        table[PUBLIC_SELF_ALIAS],
        table.guest_discount_code_rejected,
        'the public self-alias must be the identical frozen C-E6 response object'
    );
    // Cross-path entries are only tolerated while the migration really raises them.
    const anywhere = raisedCodesIn(migrationSql);
    for (const code of CROSS_PATH_TABLE_ENTRIES) {
        assert.ok(
            anywhere.has(code),
            `${code} is kept in the create-order table for another path; the migration must keep raising it`
        );
    }
    // The mapping table must not carry codes the SQL no longer raises either: a
    // stale alias is how a client ends up waiting for a signal nobody sends.
    const stale = Object.keys(table).filter((code) => !anywhere.has(code)
        && code !== PUBLIC_SELF_ALIAS
        && !promo.GUEST_CREATE_ORDER_NODE_LAYER_CODES.includes(code));
    assert.deepEqual(stale, [], 'the mapping table must not keep codes the migration stopped raising');
});

test('every coupon-lifecycle rejection collapses onto one public response (C-E6)', () => {
    const couponCodes = [
        'guest_discount_code_rejected',
        'guest_discount_code_exhausted',
        'guest_discount_code_mismatch',
        'guest_discount_code_empty',
        'guest_discount_no_effect',
        'guest_discount_below_floor',
        'guest_discount_identity_required',
        'guest_discount_rate_limited',
        'guest_discount_reservation_failed',
        'guest_discount_rejected',
        'guest_invalid_discount_code',
        'guest_promo_halted',
        'guest_promo_budget_closed',
        'guest_promo_budget_exhausted'
    ];
    assert.ok(couponCodes.length >= 10, 'this test must cover the whole coupon family');
    for (const code of couponCodes) {
        // The SQL DETAIL is the human text the migration authors wrote. It differs
        // per code, which is exactly why it must never reach the buyer: two
        // different DETAILS for "unknown code" and "exhausted code" is an oracle.
        const resolved = promo.resolveGuestCreateOrderError({
            code: 'P0001',
            message: code,
            details: code === 'guest_discount_code_exhausted' ? '该优惠码已被领完' : '内部说明'
        });
        assert.ok(resolved, `${code} must be mapped`);
        assert.equal(resolved.statusCode, 400, `${code} must not be distinguishable by status`);
        assert.equal(resolved.code, 'guest_discount_unavailable', `${code} must not be distinguishable by code`);
        assert.equal(resolved.message, '优惠码不可用', `${code} must not be distinguishable by message`);
        assert.equal(resolved.internalCode, code, 'the granular code stays on the server-side object');
        assert.ok(!JSON.stringify({
            statusCode: resolved.statusCode,
            code: resolved.code,
            message: resolved.message
        }).includes(code.replace('guest_', '')), 'the public payload must not embed the internal code');
    }
    // Non-coupon rejections stay distinguishable: they carry no coupon signal and
    // the buyer can act on them (wrong quantity, sold out, changed selection).
    const quantity = promo.resolveGuestCreateOrderError({ code: 'P0001', message: 'guest_quantity_not_allowed' });
    assert.equal(quantity.statusCode, 409);
    assert.equal(quantity.code, 'guest_quantity_not_allowed');
    const conflict = promo.resolveGuestCreateOrderError({ code: 'P0001', message: 'guest_idempotency_conflict' });
    assert.equal(conflict.statusCode, 409);
    assert.equal(conflict.code, 'guest_idempotency_conflict');
});

test('an unknown or already-HTTP-shaped error is passed through unchanged (fail closed)', () => {
    // A brand-new RAISE that nobody taught the table about must NOT become a
    // friendly 4xx: it keeps the pre-L1 500 and the generic message.
    assert.equal(promo.resolveGuestCreateOrderError({ code: 'P0001', message: 'guest_something_new' }), null);
    assert.equal(promo.resolveGuestCreateOrderError({ code: '42P01', message: 'relation "x" does not exist' }), null);
    assert.equal(promo.resolveGuestCreateOrderError(new Error('订单创建失败')), null);
    // The Node-layer guards already decided status + message; remapping them would
    // overwrite a reviewed 403 with a table entry.
    const guarded = new defaultSecurity.GuestShopSecurityError('游客优惠码通道未开启', {
        statusCode: 403,
        code: 'guest_discount_disabled'
    });
    assert.equal(promo.resolveGuestCreateOrderError(guarded), null);
    assert.equal(promo.resolveGuestCreateOrderError(null), null);
    assert.equal(promo.resolveGuestCreateOrderError(undefined), null);
    assert.equal(promo.resolveGuestCreateOrderError('guest_discount_unavailable'), null);
    // Server faults stay 500 and stay silent about the code.
    const invalidAmount = promo.resolveGuestCreateOrderError({ code: 'P0001', message: 'guest_discount_amount_invalid' });
    assert.equal(invalidAmount.statusCode, 500);
    assert.equal(invalidAmount.code, 'guest_shop_request_failed');
    assert.equal(invalidAmount.expose, false);
});

test('the handler maps the create RPC error once, and only serializes success/code/message', () => {
    assert.equal(
        (handlerSource.match(/mapGuestCreateOrderError/gu) || []).length,
        2,
        'the mapper is defined once and used by the create-order catch only'
    );
    // Asserted on slices, not on the whole 3800-line handler: a failure here
    // should print the function under test, not the file. Keeping failure
    // payloads small is deliberate - a multi-kilobyte `actual` in a TAP/spec
    // diagnostic is unreadable and drags the reporter down.
    const slice = (startMarker, endMarker) => {
        const start = handlerSource.indexOf(startMarker);
        assert.ok(start >= 0, `handler must keep ${startMarker}`);
        const end = handlerSource.indexOf(endMarker, start);
        assert.ok(end > start, `handler must keep ${endMarker} after ${startMarker}`);
        return handlerSource.slice(start, end);
    };
    const mapperSource = slice('function mapGuestCreateOrderError(error)', 'function rateLimitUnavailable(res)');
    assert.ok(mapperSource.includes('const mapped = defaultGuestPromo.resolveGuestCreateOrderError(error);'));
    assert.ok(mapperSource.includes('if (mapped) {'));
    assert.ok(
        handlerSource.includes('} catch (error) { return failResponse(res, mapGuestCreateOrderError(error)); }'),
        'the create-order catch must route through the mapper exactly once'
    );
    // The response body is the only thing a buyer sees, so pin its exact shape:
    // no details, no hint, no internalCode, no SQLSTATE.
    const failResponseSource = slice('function failResponse(res, error', 'function mapGuestCreateOrderError(error)');
    assert.match(
        failResponseSource,
        /return sendJson\(res, status, \{\s*success: false,\s*code: String\(error\?\.code \|\| \(status === 429 \? 'rate_limited' : 'guest_shop_request_failed'\)\),\s*message: expose \? String\(error\?\.message \|\| fallback\) : fallback\s*\}\);/
    );
    // Scoped to the two functions that shape a buyer-facing error, CODE ONLY:
    // comments legitimately discuss the SQL DETAIL/SQLSTATE to explain the ban
    // (the failResponse slice even ends with the promo design note), so
    // full-line comments are stripped before scanning. The rest of the handler
    // legitimately reads error.details (mapDeliveredContentError matches a known
    // SQL family before collapsing it), so a file-wide ban would be noise.
    const stripFullLineComments = (source) => source
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('//'))
        .join('\n');
    for (const [label, source] of [
        ['failResponse', failResponseSource],
        ['mapGuestCreateOrderError', mapperSource]
    ]) {
        const leaks = [...stripFullLineComments(source).matchAll(/details|hint|internalCode:|sqlstate/giu)]
            .map((match) => `${label} touches "${match[0]}" at offset ${match.index}`);
        assert.deepEqual(leaks, [], 'a buyer-facing error function must not read details/hint or echo a SQLSTATE');
    }
    // The internal code rides along on the server-side object only, so an operator
    // inspecting a captured error can still tell which guard fired.
    assert.ok(mapperSource.includes('mappedError.internalCode = mapped.internalCode;'));
    // Fail closed, but not leaky: an unmapped database rejection keeps the pre-L1
    // 500 while losing the SQLSTATE and the SQL exception text. Ordered indexOf,
    // not a [\s\S]*? regex chain - same guarantee, zero backtracking risk.
    let cursor = 0;
    for (const needle of [
        'if (defaultGuestPromo.isOpaqueGuestDatabaseError(error)) {',
        'statusCode: 500,',
        "code: 'guest_shop_request_failed',",
        'expose: false'
    ]) {
        const at = mapperSource.indexOf(needle, cursor);
        assert.ok(at >= 0, `mapGuestCreateOrderError must keep \`${needle}\` (in this order)`);
        cursor = at + needle.length;
    }
    assert.ok(mapperSource.includes('return error;'), 'an unmapped non-database error must pass through untouched');
});

test('a raw database rejection is recognisable without trusting its message', () => {
    assert.equal(promo.isOpaqueGuestDatabaseError({ code: 'P0001', message: 'guest_x' }), true);
    assert.equal(promo.isOpaqueGuestDatabaseError({ code: '42P01', message: 'relation "shop" does not exist' }), true);
    // An HTTP-shaped error already decided its own contract.
    assert.equal(promo.isOpaqueGuestDatabaseError(
        new defaultSecurity.GuestShopSecurityError('x', { statusCode: 403, code: 'guest_discount_disabled' })
    ), false);
    // A plain application error keeps its own code through failResponse.
    assert.equal(promo.isOpaqueGuestDatabaseError(new Error('订单创建失败')), false);
    assert.equal(promo.isOpaqueGuestDatabaseError(null), false);
});

test('the client only reacts to codes the server can actually emit', () => {
    const publicCodes = new Set(promo.listGuestCreateOrderPublicCodes());
    const parseSet = (name) => {
        const block = new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\);`).exec(clientSource);
        assert.ok(block, `js/guest-shop-client.js must keep ${name}`);
        return [...block[1].matchAll(/'([a-z0-9_]+)'/gu)].map((m) => m[1]);
    };
    const discountCodes = parseSet('PROMO_DISCOUNT_CODES');
    const requoteCodes = parseSet('PROMO_REQUOTE_CODES');
    assert.ok(discountCodes.includes('guest_discount_unavailable'), 'the unified coupon code must drive the retract path');
    for (const code of [...discountCodes, ...requoteCodes, 'guest_idempotency_conflict']) {
        assert.ok(
            publicCodes.has(code),
            `${code} is handled by the client but is not in the server public contract (a dead branch)`
        );
    }
    // The granular SQL codes must NOT come back into the client: listing them
    // would mean expecting a signal C-E6 forbids the server to send.
    for (const forbidden of [
        'guest_discount_code_exhausted',
        'guest_discount_below_floor',
        'guest_discount_rate_limited',
        'guest_promo_budget_exhausted',
        'guest_promo_halted'
    ]) {
        assert.ok(!discountCodes.includes(forbidden), `${forbidden} is internal and must not be branched on`);
    }
    assert.ok(publicCodes.has('guest_discount_unavailable'));
    assert.ok(publicCodes.has('guest_pricing_parity_mismatch'));
});

// ---------------------------------------------------------------------------
// End-to-end through the real handler with a stubbed database, so the mapping is
// proven on the wire and not just in the table.
// ---------------------------------------------------------------------------

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const SKU_ID = '22222222-2222-4222-8222-222222222222';
const CLAIM_PEPPER = 'guest-claim-pepper-012345678901234567890123456789';
const DERIVATION_PEPPER = 'guest-claim-derivation-pepper-012345678901234567890';

function createResponse() {
    const state = { statusCode: 200, body: '' };
    return {
        setHeader() { return this; },
        status(code) { state.statusCode = code; return this; },
        end(body = '') { state.body = String(body); return this; },
        get statusCode() { return state.statusCode; },
        get payload() { return state.body ? JSON.parse(state.body) : null; }
    };
}

/** Post the order and return whatever the buyer receives when the RPC rejects. */
async function postOrderWithRpcError(rpcError, bodyOverrides = {}) {
    const product = {
        id: PRODUCT_ID,
        name: 'Test product',
        is_active: true,
        allow_guest_purchase: true,
        delivery_type: 'KEY',
        manual_delivery: false,
        guest_payment_channels: ['zpay']
    };
    const sku = {
        id: SKU_ID,
        product_id: PRODUCT_ID,
        sku_name: 'Default',
        is_active: true,
        allow_guest_purchase: null,
        price_points: 12.34,
        price_points_intl: 12.34,
        is_default: true,
        manual_delivery: false,
        guest_payment_channels: null
    };
    const supabase = {
        from(table) {
            const rows = table === 'shop_products' ? [product] : (table === 'shop_product_skus' ? [sku] : []);
            const query = {
                select() { return query; },
                eq() { return query; },
                is() { return query; },
                in() { return query; },
                async maybeSingle() { return { data: rows[0] ? JSON.parse(JSON.stringify(rows[0])) : null, error: null }; },
                then(resolve) { return query.maybeSingle().then(resolve); }
            };
            return query;
        },
        async rpc(name) {
            if (name === 'fn_guest_shop_create_order') return { data: null, error: rpcError };
            if (name === 'guest_shop_release_held_reservations') return { data: 1, error: null };
            throw new Error(`unexpected rpc ${name}`);
        }
    };
    const handlers = createGuestShopHandlers({
        admin: {
            getOptionalSupabaseAdmin() { return supabase; },
            getSupabaseAdmin() { return supabase; },
            sendJson(res, status, payload) {
                res.status(status);
                res.setHeader('content-type', 'application/json');
                res.end(JSON.stringify(payload));
            }
        },
        requestSecurity: {
            async takeRateLimitToken() { return { allowed: true }; },
            applyRateLimitHeaders() {},
            resolveClientIp() { return '198.51.100.10'; }
        },
        security: { ...defaultSecurity, async readJsonBodyWithLimit(req) { return req.body; } },
        paymentAdapter: { async createGuestPayment() { throw new Error('must not create a payment for a rejected order'); } },
        env: {
            APP_ENV: 'test',
            APP_BASE_URL: 'https://www.fatherkey.com',
            GUEST_SHOP_CLAIM_PEPPER: CLAIM_PEPPER,
            GUEST_SHOP_CLAIM_DERIVATION_PEPPER: DERIVATION_PEPPER
        }
    });
    const req = {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': 'guest-test' },
        body: {
            site: 'cn',
            productId: PRODUCT_ID,
            skuId: SKU_ID,
            quantity: 1,
            idempotencyKey: 'idem-key-error-contract-001',
            provider: 'zpay',
            channel: 'alipay',
            ...bodyOverrides
        }
    };
    const res = createResponse();
    await handlers.orders(req, res);
    return res;
}

test('a coupon the database rejects reaches the buyer as one neutral 400', async () => {
    const res = await postOrderWithRpcError({
        code: 'P0001',
        message: 'guest_discount_code_exhausted',
        details: '该优惠码已被领完',
        hint: null
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.payload.success, false);
    assert.equal(res.payload.code, 'guest_discount_unavailable');
    assert.equal(res.payload.message, '优惠码不可用');
    const raw = JSON.stringify(res.payload);
    assert.ok(!raw.includes('exhausted'), 'the granular SQL code must not leak');
    assert.ok(!raw.includes('该优惠码已被领完'), 'the SQL DETAIL must not leak');
    assert.ok(!raw.includes('P0001'), 'the SQLSTATE must not leak');
    assert.deepEqual(Object.keys(res.payload).sort(), ['code', 'message', 'success']);
});

test('an idempotency conflict reaches the buyer as a 409 the client can act on', async () => {
    const res = await postOrderWithRpcError({ code: 'P0001', message: 'guest_idempotency_conflict', details: null });
    assert.equal(res.statusCode, 409);
    assert.equal(res.payload.code, 'guest_idempotency_conflict');
    assert.equal(res.payload.message, '下单信息已变化，请重新提交');
    // The client's live branch: no order number in hand, so the next click mints a
    // fresh key instead of replaying into the same conflict forever.
    assert.match(
        clientSource,
        /if \(code === 'guest_idempotency_conflict' && !state\.orderNo\) \{\s*\n\s*state\.idempotencyKey = '';/
    );
});

test('a rejection the table does not know stays a silent 500', async () => {
    const res = await postOrderWithRpcError({
        code: 'P0001',
        message: 'guest_something_nobody_mapped',
        details: '内部细节'
    });
    assert.equal(res.statusCode, 500);
    assert.equal(res.payload.code, 'guest_shop_request_failed');
    const raw = JSON.stringify(res.payload);
    assert.ok(!raw.includes('guest_something_nobody_mapped'));
    assert.ok(!raw.includes('内部细节'));
});
