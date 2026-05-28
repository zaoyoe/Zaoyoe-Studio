const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

function createMockResponse() {
    const state = {
        statusCode: 200,
        headers: {},
        body: ''
    };

    return {
        status(code) {
            state.statusCode = code;
            return this;
        },
        setHeader(name, value) {
            state.headers[String(name).toLowerCase()] = value;
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
        },
        get headers() {
            return state.headers;
        }
    };
}

function createMockAdminModule(options = {}) {
    const auditLogs = options.auditLogs || [];
    return {
        async requireAdmin() {
            if (options.requireAdminError) {
                throw options.requireAdminError;
            }
            return {
                user: options.user || { id: 'admin-user-1', email: 'admin@example.com' },
                supabase: options.supabase || { from() { throw new Error('unexpected supabase call'); } }
            };
        },
        async writeAdminAuditLog(entry) {
            auditLogs.push(entry);
        },
        sendJson(res, status, payload) {
            res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify(payload));
        }
    };
}

async function withAdminAccessSessionHandler(options, callback) {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/access/session.js');
    const originalLoad = Module._load;
    const mockAdminModule = createMockAdminModule(options);

    delete require.cache[handlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../../../../api/_lib/admin') {
            return mockAdminModule;
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
        return await callback(handler);
    } finally {
        delete require.cache[handlerPath];
    }
}

async function loadAccessHelpers() {
    return import('../api/_lib/admin-studio-access.mjs');
}

test('admin access session POST issues a short-lived cookie for admins', async () => {
    process.env.ADMIN_STUDIO_ACCESS_SECRET = 'session-secret-for-tests';
    process.env.ADMIN_STUDIO_ACCESS_TTL_SECONDS = '120';
    const auditLogs = [];

    await withAdminAccessSessionHandler({ auditLogs }, async (handler) => {
        const req = {
            method: 'POST',
            headers: {
                'user-agent': 'Mozilla/5.0 test',
                origin: 'https://www.fatherkey.com',
                referer: 'https://www.fatherkey.com/admin-entry.html'
            },
            socket: { remoteAddress: '127.0.0.1' }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();
        const setCookieHeader = res.headers['set-cookie'];

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.granted, true);
        assert.equal(payload.expiresInSeconds, 120);
        assert.match(setCookieHeader, /zaoyoe_admin_studio=/);
        assert.match(setCookieHeader, /HttpOnly/);
        assert.match(setCookieHeader, /Secure/);
        assert.match(setCookieHeader, /SameSite=Strict/);
        assert.match(setCookieHeader, /Max-Age=120/);

        const token = decodeURIComponent(String(setCookieHeader).split(';')[0].split('=').slice(1).join('='));
        const helpers = await loadAccessHelpers();
        const verified = await helpers.verifyAdminStudioToken(token);

        assert.equal(verified?.sub, 'admin-user-1');
        assert.equal(auditLogs.length, 1);
        assert.equal(auditLogs[0].actionType, 'admin.access.session.issue');
        assert.equal(auditLogs[0].details.admin_email, 'admin@example.com');
        assert.equal(auditLogs[0].details.user_agent, 'Mozilla/5.0 test');
    });
});

test('admin access session DELETE clears the admin studio cookie', async () => {
    process.env.ADMIN_STUDIO_ACCESS_SECRET = 'session-secret-for-tests';

    await withAdminAccessSessionHandler({}, async (handler) => {
        const req = { method: 'DELETE', headers: {} };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();
        const setCookieHeader = res.headers['set-cookie'];

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.cleared, true);
        assert.match(setCookieHeader, /zaoyoe_admin_studio=/);
        assert.match(setCookieHeader, /Max-Age=0/);
        assert.match(setCookieHeader, /Expires=Thu, 01 Jan 1970 00:00:00 GMT/);
    });
});

test('admin access session uses non-secure cookies on local preview hosts', async () => {
    process.env.ADMIN_STUDIO_ACCESS_SECRET = 'session-secret-for-tests';

    await withAdminAccessSessionHandler({}, async (handler) => {
        const postReq = {
            method: 'POST',
            headers: {
                host: '127.0.0.1:8000',
                origin: 'http://127.0.0.1:8000'
            },
            socket: { remoteAddress: '127.0.0.1' }
        };
        const postRes = createMockResponse();
        await handler(postReq, postRes);

        assert.equal(postRes.statusCode, 200);
        assert.doesNotMatch(String(postRes.headers['set-cookie'] || ''), /Secure/);

        const deleteReq = {
            method: 'DELETE',
            headers: {
                host: '127.0.0.1:8000',
                origin: 'http://127.0.0.1:8000'
            }
        };
        const deleteRes = createMockResponse();
        await handler(deleteReq, deleteRes);

        assert.equal(deleteRes.statusCode, 200);
        assert.doesNotMatch(String(deleteRes.headers['set-cookie'] || ''), /Secure/);
    });
});

test('admin access session POST rejects non-admin callers', async () => {
    process.env.ADMIN_STUDIO_ACCESS_SECRET = 'session-secret-for-tests';

    const forbiddenError = new Error('Admin access required');
    forbiddenError.statusCode = 403;

    await withAdminAccessSessionHandler({ requireAdminError: forbiddenError }, async (handler) => {
        const req = { method: 'POST', headers: {} };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 403);
        assert.equal(payload.success, false);
        assert.equal(payload.message, 'Admin access required');
        assert.equal(res.headers['set-cookie'], undefined);
    });
});

test('admin access session only allows POST and DELETE', async () => {
    process.env.ADMIN_STUDIO_ACCESS_SECRET = 'session-secret-for-tests';

    await withAdminAccessSessionHandler({}, async (handler) => {
        const req = { method: 'GET', headers: {} };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 405);
        assert.equal(payload.success, false);
        assert.equal(payload.message, 'Method not allowed');
        assert.equal(res.headers.allow, 'POST, DELETE');
    });
});
