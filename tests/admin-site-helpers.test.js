const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const {
    normalizeAdminSite,
    requireWritableAdminSite,
    writeAdminAuditLog
} = require('../api/_lib/admin');

test('normalizeAdminSite normalizes supported values and aliases', () => {
    assert.equal(normalizeAdminSite(' CN '), 'cn');
    assert.equal(normalizeAdminSite('INTL'), 'intl');
    assert.equal(normalizeAdminSite('ALL'), 'all');
    assert.equal(normalizeAdminSite('global'), 'all');
    assert.equal(normalizeAdminSite('', { defaultValue: 'all' }), 'all');
    assert.equal(normalizeAdminSite('legacy-site', { defaultValue: 'cn' }), 'cn');
    assert.equal(normalizeAdminSite('legacy-site'), '');
});

test('requireWritableAdminSite accepts cn and intl only', () => {
    assert.equal(requireWritableAdminSite('cn'), 'cn');
    assert.equal(requireWritableAdminSite('INTL'), 'intl');

    assert.throws(
        () => requireWritableAdminSite('all'),
        (error) => {
            assert.equal(error.statusCode, 400);
            assert.equal(error.code, 'admin_site_not_writable');
            assert.equal(error.site, 'all');
            return true;
        }
    );

    assert.throws(
        () => requireWritableAdminSite(''),
        (error) => {
            assert.equal(error.statusCode, 400);
            assert.equal(error.code, 'admin_site_required');
            assert.equal(error.site, null);
            return true;
        }
    );

    assert.throws(
        () => requireWritableAdminSite('legacy-site'),
        (error) => {
            assert.equal(error.statusCode, 400);
            assert.equal(error.code, 'admin_site_invalid');
            assert.equal(error.site, null);
            assert.equal(error.input, 'legacy-site');
            return true;
        }
    );
});

test('writeAdminAuditLog adds normalized site and module details when provided', async () => {
    const inserts = [];
    const supabase = {
        from(table) {
            assert.equal(table, 'admin_audit_logs');
            return {
                async insert(payload) {
                    inserts.push(payload);
                    return { data: null, error: null };
                }
            };
        }
    };

    await writeAdminAuditLog({
        supabase,
        adminId: 'admin-1',
        actionType: 'homepage.update',
        site: 'INTL',
        module: 'homepage',
        details: {
            section: 'hero'
        }
    });

    assert.equal(inserts.length, 1);
    assert.deepEqual(inserts[0].details, {
        section: 'hero',
        site: 'intl',
        module: 'homepage'
    });
});

test('writeAdminAuditLog does not override explicit site or module details', async () => {
    const inserts = [];
    const supabase = {
        from() {
            return {
                async insert(payload) {
                    inserts.push(payload);
                    return { data: null, error: null };
                }
            };
        }
    };

    await writeAdminAuditLog({
        supabase,
        adminId: 'admin-1',
        actionType: 'legacy.action',
        site: 'cn',
        module: 'homepage',
        details: {
            site: 'intl',
            module: 'legacy-module'
        }
    });

    assert.equal(inserts.length, 1);
    assert.deepEqual(inserts[0].details, {
        site: 'intl',
        module: 'legacy-module'
    });
});

function createMockResponse() {
    const state = {
        statusCode: 200,
        body: ''
    };

    return {
        status(code) {
            state.statusCode = code;
            return this;
        },
        setHeader() {
            return this;
        },
        end(payload = '') {
            state.body = String(payload || '');
            return this;
        },
        json() {
            return state.body ? JSON.parse(state.body) : {};
        },
        get statusCode() {
            return state.statusCode;
        }
    };
}

async function withAdminApiRouter(callback) {
    const handlerPath = path.resolve(__dirname, '../api/admin.js');
    const originalLoad = Module._load;
    const state = {
        handlerCalls: []
    };

    delete require.cache[handlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request.startsWith('../server/api-handlers/admin/')) {
            return async function mockHandler(req, res) {
                state.handlerCalls.push({
                    request,
                    adminRoute: req.adminRoute,
                    adminSite: req.adminSite
                });
                return res.status(200).setHeader('Content-Type', 'application/json; charset=utf-8').end(JSON.stringify({
                    success: true
                }));
            };
        }

        return originalLoad.call(this, request, parent, isMain);
    };

    let handler;
    try {
        handler = require(handlerPath);
    } finally {
        Module._load = originalLoad;
    }

    try {
        return await callback({ handler, state });
    } finally {
        delete require.cache[handlerPath];
    }
}

test('admin router exposes normalized route and site context to handlers', async () => {
    await withAdminApiRouter(async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'GET',
            url: '/api/admin?route=payments/summary&site=INTL',
            headers: {}
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(state.handlerCalls.length, 1);
        assert.equal(state.handlerCalls[0].adminRoute, 'payments/summary');
        assert.equal(state.handlerCalls[0].adminSite, 'intl');
    });
});

test('admin router resolves nested path routes without requiring query route rewrites', async () => {
    await withAdminApiRouter(async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'GET',
            url: '/api/admin/homepage/config?site=cn',
            headers: {}
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(state.handlerCalls.length, 1);
        assert.equal(state.handlerCalls[0].adminRoute, 'homepage/config');
        assert.equal(state.handlerCalls[0].adminSite, 'cn');
    });
});

test('admin router prefers explicit query route when both query and path routes are present', async () => {
    await withAdminApiRouter(async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'GET',
            url: '/api/admin/homepage/config?route=comments/summary&site=all',
            headers: {}
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(state.handlerCalls.length, 1);
        assert.equal(state.handlerCalls[0].adminRoute, 'comments/summary');
        assert.equal(state.handlerCalls[0].adminSite, 'all');
    });
});
