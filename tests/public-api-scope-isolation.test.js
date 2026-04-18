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
        },
        get body() {
            return state.body;
        }
    };
}

async function withEnv(patch, callback) {
    const previous = {};

    for (const [key, value] of Object.entries(patch || {})) {
        previous[key] = process.env[key];
        if (value === undefined || value === null) {
            delete process.env[key];
        } else {
            process.env[key] = String(value);
        }
    }

    try {
        return await callback();
    } finally {
        for (const key of Object.keys(patch || {})) {
            if (previous[key] === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = previous[key];
            }
        }
    }
}

async function withPublicHandler(loadPatch, callback) {
    const handlerPath = path.resolve(__dirname, '../api/public.js');
    const originalLoad = Module._load;

    delete require.cache[handlerPath];

    Module._load = function patchedLoad(request, parent, isMain) {
        return loadPatch(request, parent, isMain, originalLoad);
    };

    let handler;
    try {
        handler = require(handlerPath);
        return await callback(handler);
    } finally {
        Module._load = originalLoad;
        delete require.cache[handlerPath];
    }
}

test('public runtime scope remains available when payments modules fail to load', async () => {
    await withEnv({
        SUPABASE_URL: 'https://runtime.supabase.co',
        SUPABASE_PUBLISHABLE_KEY: 'runtime-key'
    }, async () => {
        await withPublicHandler((request, parent, isMain, originalLoad) => {
            if (request === './_lib/payments/orders' || request === './_lib/payments/providers') {
                throw new Error('simulated payments bootstrap failure');
            }

            return originalLoad.call(Module, request, parent, isMain);
        }, async (handler) => {
            const req = {
                method: 'GET',
                url: '/api/public?scope=runtime&route=supabase-config'
            };
            const res = createMockResponse();

            await handler(req, res);

            assert.equal(res.statusCode, 200);
            assert.equal(res.headers['content-type'], 'application/javascript; charset=utf-8');
            assert.match(res.body, /__ZAOYOE_SUPABASE_CONFIG__/);
            assert.match(res.body, /runtime\.supabase\.co/);
        });
    });
});

test('public payments scope returns a handled 500 when payments modules fail to load', async () => {
    await withPublicHandler((request, parent, isMain, originalLoad) => {
        if (request === './_lib/payments/orders' || request === './_lib/payments/providers') {
            throw new Error('simulated payments bootstrap failure');
        }

        return originalLoad.call(Module, request, parent, isMain);
    }, async (handler) => {
        const req = {
            method: 'GET',
            url: '/api/public?scope=payments&route=config'
        };
        const res = createMockResponse();

        await handler(req, res);

        assert.equal(res.statusCode, 500);
        assert.deepEqual(res.json(), {
            success: false,
            message: 'Public route handler unavailable'
        });
    });
});
