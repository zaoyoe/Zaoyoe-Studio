const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const handlerSource = fs.readFileSync(path.join(root, 'server/api-handlers/admin/shop/guest-order-sensitive-detail.js'), 'utf8');
const adminRoutes = fs.readFileSync(path.join(root, 'api/admin.js'), 'utf8');
const shopScript = fs.readFileSync(path.join(root, 'js/admin-shop.js'), 'utf8');

const fixture = {
    orders: [{
        id: 'order-1',
        order_no: 'GS-1',
        site: 'cn',
        claim_secret_hash: 'hash-not-returned',
        claim_attempt_count: 2,
        metadata: { internal: 'metadata-not-returned' }
    }],
    reservations: [{ order_id: 'order-1', inventory_id: 'inv-1', status: 'consumed', created_at: '2026-09-24T10:00:00Z' }],
    orderItems: [{ order_id: 'order-1', inventory_id: 'inv-2', created_at: '2026-09-24T10:00:01Z' }],
    inventories: [
        { id: 'inv-1', product_id: 'product-1', content: 'CARD-SECRET-1', status: 'sold', is_shared: false, sold_at: null, created_at: '2026-09-24T10:00:00Z' },
        { id: 'inv-2', product_id: 'product-2', content: 'CARD-SECRET-2', status: 'sold', is_shared: false, sold_at: null, created_at: '2026-09-24T10:00:01Z' }
    ],
    paymentEvents: [{ merchant_order_no: 'GS-1' }, { merchant_order_no: 'GS-1' }]
};

function createHandler({ auditError = null, auditReject = false, authError = null } = {}) {
    const calls = [];
    let auditRecord = null;

    function filtered(table, filters) {
        const rows = table === 'guest_shop_orders' ? fixture.orders
            : table === 'guest_shop_inventory_reservations' ? fixture.reservations
                : table === 'shop_order_items' ? fixture.orderItems
                    : table === 'shop_inventory' ? fixture.inventories
                        : table === 'guest_shop_payment_events' ? fixture.paymentEvents
                            : [];
        return rows.filter((row) => Object.entries(filters).every(([column, value]) => {
            if (Array.isArray(value)) return value.includes(row[column]);
            return row[column] === value;
        }));
    }

    const supabase = {
        from(table) {
            let fields = '*';
            let filters = {};
            let limitValue = null;
            let countMode = false;
            const query = {
                select(selection, options = {}) {
                    fields = selection;
                    countMode = options.count === 'exact' && options.head === true;
                    return query;
                },
                eq(column, value) {
                    filters[column] = value;
                    return query;
                },
                in(column, value) {
                    filters[column] = value;
                    return query;
                },
                order() { return query; },
                limit(value) {
                    limitValue = value;
                    return Promise.resolve(resolve());
                },
                insert(record) {
                    auditRecord = record;
                    calls.push('audit:insert');
                    return auditReject ? Promise.reject(new Error('audit network failed')) : Promise.resolve({ error: auditError });
                },
                then(resolvePromise, rejectPromise) {
                    return Promise.resolve(resolve()).then(resolvePromise, rejectPromise);
                }
            };
            function resolve() {
                if (table === 'admin_audit_logs') return { data: null, error: auditError };
                calls.push(`read:${table}:${fields}`);
                const rows = filtered(table, filters);
                if (countMode) return { data: null, count: rows.length, error: null };
                let projectedRows = rows;
                if (table === 'guest_shop_orders' && fields === 'claim_secret_hash,claim_attempt_count') {
                    projectedRows = rows.map(({ claim_secret_hash, claim_attempt_count }) => ({ claim_secret_hash, claim_attempt_count }));
                }
                if (Number.isFinite(limitValue)) projectedRows = projectedRows.slice(0, limitValue);
                return { data: projectedRows, error: null };
            }
            return query;
        }
    };

    const module = { exports: {} };
    const load = new Function('require', 'module', 'exports', handlerSource);
    load((id) => {
        if (id === '../../../../api/_lib/admin') {
            return {
                requireAdmin: async () => {
                    if (authError) throw authError;
                    return { supabase, user: { id: 'admin-1' } };
                },
                sendJson: (res, status, body) => {
                    res.statusCode = status;
                    res.body = body;
                    return body;
                }
            };
        }
        throw new Error(`Unexpected module: ${id}`);
    }, module, module.exports);

    const req = { method: 'GET', url: '/api/admin/shop/guest-order-sensitive-detail?orderNo=GS-1' };
    const res = { headers: {}, setHeader(name, value) { this.headers[name] = value; } };
    return {
        invoke: () => module.exports(req, res),
        calls,
        get auditRecord() { return auditRecord; },
        res
    };
}

test('sensitive guest order detail is an admin-only route and records audit before reading card content', async () => {
    assert.match(adminRoutes, /guest-order-sensitive-detail/);
    assert.match(handlerSource, /requireAdmin\(req, \{ permission: 'shop\.manage' \}\)/);
    assert.match(handlerSource, /writeRequiredSensitiveAuditLog\(supabase, user\?\.id, order\)/);

    const harness = createHandler();
    await harness.invoke();
    assert.equal(harness.res.statusCode, 200);
    assert.equal(harness.calls[0], 'read:guest_shop_orders:id,order_no,site');
    assert.equal(harness.calls[1], 'audit:insert');
    assert.ok(harness.calls.findIndex((call) => call.startsWith('audit:')) < harness.calls.findIndex((call) => call.startsWith('read:shop_inventory:')));
    assert.equal(harness.auditRecord.action_type, 'shop.guest_order.view_sensitive_detail');
    assert.equal(harness.auditRecord.details.order_no, 'GS-1');
    assert.equal(JSON.stringify(harness.auditRecord).includes('CARD-SECRET'), false);
    assert.equal(harness.res.headers['Cache-Control'], 'private, no-store, max-age=0');
});

test('audit failure blocks every sensitive read and returns no card contents', async () => {
    const harness = createHandler({ auditError: { message: 'audit table unavailable' } });
    await harness.invoke();
    assert.equal(harness.res.statusCode, 503);
    assert.equal(harness.res.body.success, false);
    assert.match(harness.res.body.message, /未返回敏感内容/);
    assert.equal(harness.calls.some((call) => call.startsWith('read:shop_inventory:')), false);
    assert.equal(harness.calls.some((call) => call.startsWith('read:guest_shop_inventory_reservations:')), false);
    assert.equal(JSON.stringify(harness.res.body).includes('CARD-SECRET'), false);
});

test('audit transport failure and missing admin permission both fail before reading secrets', async (t) => {
    await t.test('audit transport rejection', async () => {
        const harness = createHandler({ auditReject: true });
        await harness.invoke();
        assert.equal(harness.res.statusCode, 503);
        assert.equal(harness.calls.some((call) => call.startsWith('read:shop_inventory:')), false);
    });
    await t.test('permission denied', async () => {
        const harness = createHandler({ authError: Object.assign(new Error('forbidden'), { statusCode: 403 }) });
        await harness.invoke();
        assert.equal(harness.res.statusCode, 403);
        assert.equal(harness.calls.length, 0);
    });
});

test('sensitive response includes linked card contents but omits unrelated metadata and raw payment payloads', async () => {
    const harness = createHandler();
    await harness.invoke();
    const body = harness.res.body;
    assert.equal(body.success, true);
    assert.deepEqual(body.inventories.map((row) => row.content), ['CARD-SECRET-1', 'CARD-SECRET-2']);
    assert.equal(body.order.claim_secret_hash_present, true);
    assert.equal(body.order.claim_secret_plaintext_status, 'not_saved_unrecoverable');
    assert.equal(body.payment_event_count, 2);
    assert.equal(Object.hasOwn(body.order, 'metadata'), false);
    assert.equal(Object.hasOwn(body.order, 'claim_secret_hash'), false);
    assert.equal(Object.hasOwn(body, 'order_items'), false);
    assert.equal(Object.hasOwn(body, 'payment_order'), false);
    assert.equal(Object.hasOwn(body, 'payment_events'), false);
    assert.equal(JSON.stringify(body).includes('provider_metadata'), false);
    assert.equal(JSON.stringify(body).includes('payload_redacted'), false);
});

test('sensitive detail is confirmed in the UI and does not appear in the regular detail view', () => {
    assert.match(shopScript, /guest-exception-sensitive-detail/);
    assert.match(shopScript, /敏感信息包含发货卡密、库存内容及订单领取诊断信息/);
    assert.match(shopScript, /loadGuestOrderSensitiveDetail/);
    assert.match(shopScript, /claim_secret_hash_present/);
    assert.match(shopScript, /payment_event_count/);
    assert.doesNotMatch(shopScript, /payload\.payment_events/);
    assert.doesNotMatch(shopScript.slice(shopScript.indexOf('renderGuestOrderSensitiveDetail:'), shopScript.indexOf('revealGuestOrderSensitiveDetail:')), /<pre>/);
    const normalDetail = shopScript.slice(shopScript.indexOf('renderGuestExceptionDetailBody:'), shopScript.indexOf('copyGuestExceptionOrder:'));
    assert.doesNotMatch(normalDetail, /row\.content/);
    assert.doesNotMatch(normalDetail, /row\.claim_secret_hash/);
    assert.doesNotMatch(normalDetail, /row\.raw_payload/);
});

test('every reserved inventory card has escaped copy and existing inventory-detail actions', () => {
    const start = shopScript.indexOf('renderGuestOrderSensitiveDetail: function');
    const end = shopScript.indexOf('revealGuestOrderSensitiveDetail: async function', start);
    assert.ok(start >= 0 && end > start);
    const rendererSource = shopScript.slice(start, end);
    const renderer = vm.runInNewContext(`({${rendererSource}}).renderGuestOrderSensitiveDetail`);
    const escapeHtml = (value) => String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
    const context = { escapeHtml, escapeForAttr: escapeHtml };
    const markup = renderer.call(context, {
        order: { order_no: 'GS-1' },
        inventories: [
            { id: 'inv-1', content: 'user-one----secret', status: 'sold', is_shared: false },
            { id: 'inv-2', content: '<script>alert(1)</script>', status: 'sold', is_shared: false }
        ]
    });

    assert.equal((markup.match(/data-shop-action="inventory-show-detail"/g) || []).length, 2);
    assert.equal((markup.match(/data-shop-action="inventory-detail-copy-main"/g) || []).length, 2);
    assert.match(markup, /data-inventory-id="inv-1"/);
    assert.match(markup, /data-inventory-id="inv-2"/);
    assert.match(markup, /data-content="user-one----secret"/);
    assert.match(markup, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.doesNotMatch(markup, /<script>alert/);
});
