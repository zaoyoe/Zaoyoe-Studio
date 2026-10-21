'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const f = require('./helpers/shop-supplier-resolution-fixture');
const filename = path.join(__dirname, '../server/api-handlers/admin/shop/supplier-resolution.js');
function fixture(options = {}) {
    const calls = { permissions: [], rpc: [], audits: [] };
    const db = { async rpc(name, args) { calls.rpc.push({ name, args });
        if (options.rpcError) return { error: { message: 'private SQL with secret' } };
        return { data: name === 'fn_shop_supplier_operations_v2' ? { rows: [f.operation()], hasMore: false, limit: 1 }
            : options.result || f.result() }; } };
    const admin = {
        async requireAdmin(req, rule) { calls.permissions.push(rule.permission);
            if (options.denied) throw Object.assign(new Error('无权限'), { statusCode: 403 });
            return { adminSupabase: db, user: { id: f.IDS.actor } }; },
        parseJsonBody: async req => req.body,
        sendJson(res, status, data) { res.statusCode = status; res.payload = data; },
        async writeAdminAuditLog(value) { calls.audits.push(value); if (options.auditError) throw Error('audit unavailable'); }
    };
    const module = { exports: {} }; const realRequire = createRequire(filename);
    vm.runInNewContext('(function(require,module,exports){' + fs.readFileSync(filename, 'utf8') + '\n})', { URL, console })(
        name => name.endsWith('/_lib/admin') ? admin : realRequire(name), module, module.exports);
    return { calls, async send(body = { ...f.input(), actorId: undefined }, method = 'POST', query = '') {
        if (body && !Array.isArray(body)) body = Object.fromEntries(Object.entries(body).filter(([,v]) => v !== undefined));
        const res = { statusCode: 200, headers: {}, setHeader(k,v) { this.headers[k] = v; } };
        await module.exports({ method, body, url: '/api/admin/shop/supplier-resolution' + query }, res); return res;
    } };
}
function commit(patch = {}) { const { actorId, ...body } = f.input(); return { ...body, confirm: true, ...patch }; }

test('admin commit enforces shop.manage, uses authenticated actor and returns no-store receipt even when audit fails', async () => {
    const h = fixture({ auditError: true }); const res = await h.send(commit());
    assert.equal(res.statusCode, 200); assert.deepEqual(h.calls.permissions, ['shop.manage']);
    assert.equal(h.calls.rpc[0].args.p_actor_id, f.IDS.actor);
    assert.equal(res.headers['Cache-Control'], 'no-store'); assert.equal(res.payload.result.status, 'completed');
    assert.equal(h.calls.audits.length, 1); assert.doesNotMatch(JSON.stringify(h.calls.audits), /evidenceRef|internalNote|publicNote/);
});
test('admin query reuses operation and order without a new request or audit', async () => {
    const h = fixture({ result: { status: 'not_found', operationId: f.IDS.operation } });
    const res = await h.send(commit({ action: 'query', confirm: undefined, request: undefined }));
    assert.equal(res.statusCode, 200); assert.equal(h.calls.rpc[0].args.p_action, 'query');
    assert.deepEqual(h.calls.rpc[0].args.p_request, {}); assert.equal(h.calls.audits.length, 0);
});
test('single order GET is bounded and read-only', async () => {
    const h = fixture(); const res = await h.send(null, 'GET', `?orderId=${f.IDS.order}&fundingKind=points&site=cn`);
    assert.equal(res.statusCode, 200); assert.equal(res.payload.order.canResolve, true);
    assert.equal(h.calls.rpc.length, 1); assert.equal(h.calls.rpc[0].name, 'fn_shop_supplier_operations_v2');
    assert.equal(h.calls.rpc[0].args.p_limit, 1); assert.equal(h.calls.rpc[0].args.p_native_order_id, f.IDS.order);
    assert.equal(h.calls.audits.length, 0);
});
for (const query of ['', `?orderId=${f.IDS.order}`, `?orderId=${f.IDS.order}&fundingKind=points&request=invalid`,
    `?orderId=${f.IDS.order}&fundingKind=points&site=intl`]) {
    test(`GET rejects incomplete or widened queries (${query})`, async () => {
        const h = fixture(); assert.equal((await h.send(null, 'GET', query)).statusCode, 400); assert.equal(h.calls.rpc.length, 0);
    });
}
for (const body of [[], commit({ confirm: false }), commit({ actorId: f.IDS.other }), commit({ action: 'delete' }),
    commit({ request: f.request({ amount: 20 }) })]) {
    test(`POST rejects unconfirmed or untrusted financial inputs (${JSON.stringify(body).slice(0, 100)})`, async () => {
        const h = fixture(); assert.equal((await h.send(body)).statusCode, 400); assert.equal(h.calls.rpc.length, 0);
    });
}
test('permission denial cannot read or resolve an order', async () => {
    const h = fixture({ denied: true }); assert.equal((await h.send(commit())).statusCode, 403); assert.equal(h.calls.rpc.length, 0);
});
test('RPC failures reveal no internal database or credential details', async () => {
    const h = fixture({ rpcError: true }); const res = await h.send(commit());
    assert.equal(res.statusCode, 503); assert.doesNotMatch(JSON.stringify(res.payload), /private|SQL|secret/);
});
test('unsupported method declares allowed operations without authentication or writes', async () => {
    const h = fixture(); const res = await h.send(null, 'DELETE');
    assert.equal(res.statusCode, 405); assert.equal(res.headers.Allow, 'GET, POST'); assert.equal(h.calls.permissions.length, 0);
});
