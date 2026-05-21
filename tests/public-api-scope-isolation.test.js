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

test('public wallet overview remains available when wallet checkin module fails to load', async () => {
    await withPublicHandler((request, parent, isMain, originalLoad) => {
        if (request === '../server/api-handlers/public/wallet') {
            return {
                createWalletHandlers() {
                    return {
                        async overview(req, res) {
                            res.status(200).setHeader('Content-Type', 'application/json; charset=utf-8');
                            res.end(JSON.stringify({
                                success: true,
                                source: 'wallet-overview-stub'
                            }));
                        }
                    };
                }
            };
        }

        if (request === './_lib/site') {
            return {
                requireSupportedSite(value) {
                    return String(value || 'cn').trim().toLowerCase() || 'cn';
                }
            };
        }

        if (request === './wallet/checkin') {
            throw new Error('simulated wallet checkin bootstrap failure');
        }

        return originalLoad.call(Module, request, parent, isMain);
    }, async (handler) => {
        const req = {
            method: 'GET',
            url: '/api/public?scope=wallet&route=overview'
        };
        const res = createMockResponse();

        await handler(req, res);

        assert.equal(res.statusCode, 200);
        assert.deepEqual(res.json(), {
            success: true,
            source: 'wallet-overview-stub'
        });
    });
});

test('public ops scope exposes the protected recovery readiness sweep route', async () => {
    await withPublicHandler((request, parent, isMain, originalLoad) => {
        if (request === '../server/api-handlers/public/ops') {
            return {
                createOpsHandlers() {
                    return {
                        'recovery-readiness-sweep': async (req, res) => {
                            res.status(200).setHeader('Content-Type', 'application/json; charset=utf-8');
                            res.end(JSON.stringify({
                                success: true,
                                route: 'recovery-readiness-sweep'
                            }));
                        }
                    };
                }
            };
        }

        return originalLoad.call(Module, request, parent, isMain);
    }, async (handler) => {
        const req = {
            method: 'GET',
            url: '/api/public?scope=ops&route=recovery-readiness-sweep'
        };
        const res = createMockResponse();

        await handler(req, res);

        assert.equal(res.statusCode, 200);
        assert.deepEqual(res.json(), {
            success: true,
            route: 'recovery-readiness-sweep'
        });
    });
});

test('public ops scope exposes the protected external monitoring smoke route', async () => {
    await withPublicHandler((request, parent, isMain, originalLoad) => {
        if (request === '../server/api-handlers/public/ops') {
            return {
                createOpsHandlers() {
                    return {
                        'external-monitoring-smoke': async (req, res) => {
                            res.status(202).setHeader('Content-Type', 'application/json; charset=utf-8');
                            res.end(JSON.stringify({
                                success: true,
                                route: 'external-monitoring-smoke'
                            }));
                        }
                    };
                }
            };
        }

        return originalLoad.call(Module, request, parent, isMain);
    }, async (handler) => {
        const req = {
            method: 'GET',
            url: '/api/public?scope=ops&route=external-monitoring-smoke'
        };
        const res = createMockResponse();

        await handler(req, res);

        assert.equal(res.statusCode, 202);
        assert.deepEqual(res.json(), {
            success: true,
            route: 'external-monitoring-smoke'
        });
    });
});

test('public wallet scope exposes kebab-case route aliases used by Vercel rewrites', async () => {
    await withPublicHandler((request, parent, isMain, originalLoad) => {
        if (request === '../server/api-handlers/public/wallet') {
            const makeHandler = (routeName) => async (req, res) => {
                res.status(200).setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify({
                    success: true,
                    route: routeName
                }));
            };

            return {
                createWalletHandlers() {
                    return {
                        orderDetail: makeHandler('orderDetail'),
                        promptTitles: makeHandler('promptTitles'),
                        verifyLog: makeHandler('verifyLog')
                    };
                }
            };
        }

        if (request === './_lib/site') {
            return {
                requireSupportedSite(value) {
                    return String(value || 'cn').trim().toLowerCase() || 'cn';
                }
            };
        }

        return originalLoad.call(Module, request, parent, isMain);
    }, async (handler) => {
        const cases = [
            ['order-detail', 'orderDetail'],
            ['prompt-titles', 'promptTitles'],
            ['verify-log', 'verifyLog']
        ];

        for (const [route, expectedRoute] of cases) {
            const req = {
                method: 'POST',
                url: `/api/public?scope=wallet&route=${route}`
            };
            const res = createMockResponse();

            await handler(req, res);

            assert.equal(res.statusCode, 200);
            assert.deepEqual(res.json(), {
                success: true,
                route: expectedRoute
            });
        }
    });
});

test('public handler resolves direct KVM4-style /api scope paths', async () => {
    await withPublicHandler((request, parent, isMain, originalLoad) => {
        if (request === '../server/api-handlers/public/wallet') {
            return {
                createWalletHandlers() {
                    return {
                        async overview(req, res) {
                            res.status(200).setHeader('Content-Type', 'application/json; charset=utf-8');
                            res.end(JSON.stringify({
                                success: true,
                                route: 'wallet-overview'
                            }));
                        }
                    };
                }
            };
        }

        if (request === './_lib/site') {
            return {
                requireSupportedSite(value) {
                    return String(value || 'cn').trim().toLowerCase() || 'cn';
                }
            };
        }

        return originalLoad.call(Module, request, parent, isMain);
    }, async (handler) => {
        const req = {
            method: 'GET',
            url: '/api/wallet/overview?site=cn'
        };
        const res = createMockResponse();

        await handler(req, res);

        assert.equal(res.statusCode, 200);
        assert.deepEqual(res.json(), {
            success: true,
            route: 'wallet-overview'
        });
    });
});

test('public handler resolves marketplace ingestion scope paths', async () => {
    await withPublicHandler((request, parent, isMain, originalLoad) => {
        if (request === '../server/api-handlers/public/marketplace') {
            return {
                createMarketplaceHandlers() {
                    return {
                        async orders(req, res) {
                            res.status(200).setHeader('Content-Type', 'application/json; charset=utf-8');
                            res.end(JSON.stringify({
                                success: true,
                                route: 'marketplace-orders'
                            }));
                        },
                        'xianyu/orders': async function xianyuOrders(req, res) {
                            res.status(200).setHeader('Content-Type', 'application/json; charset=utf-8');
                            res.end(JSON.stringify({
                                success: true,
                                route: 'marketplace-xianyu-orders'
                            }));
                        }
                    };
                }
            };
        }

        return originalLoad.call(Module, request, parent, isMain);
    }, async (handler) => {
        const req = {
            method: 'POST',
            url: '/api/marketplace/orders'
        };
        const res = createMockResponse();

        await handler(req, res);

        assert.equal(res.statusCode, 200);
        assert.deepEqual(res.json(), {
            success: true,
            route: 'marketplace-orders'
        });

        const xianyuReq = {
            method: 'POST',
            url: '/api/marketplace/xianyu/orders'
        };
        const xianyuRes = createMockResponse();

        await handler(xianyuReq, xianyuRes);

        assert.equal(xianyuRes.statusCode, 200);
        assert.deepEqual(xianyuRes.json(), {
            success: true,
            route: 'marketplace-xianyu-orders'
        });
    });
});

test('public wallet checkin is served by the shared handler instead of the API route entrypoint', async () => {
    await withPublicHandler((request, parent, isMain, originalLoad) => {
        if (request === '../server/api-handlers/public/wallet') {
            return {
                createWalletHandlers() {
                    return {};
                }
            };
        }

        if (request === './_lib/site') {
            return {
                requireSupportedSite(value) {
                    return String(value || 'cn').trim().toLowerCase() || 'cn';
                }
            };
        }

        if (request === '../server/api-handlers/public/wallet-checkin') {
            return {
                createWalletCheckinHandler() {
                    return async (req, res) => {
                        res.status(200).setHeader('Content-Type', 'application/json; charset=utf-8');
                        res.end(JSON.stringify({
                            success: true,
                            source: 'shared-wallet-checkin-stub'
                        }));
                    };
                }
            };
        }

        if (request === './wallet/checkin') {
            throw new Error('simulated wallet checkin bootstrap failure');
        }

        return originalLoad.call(Module, request, parent, isMain);
    }, async (handler) => {
        const req = {
            method: 'POST',
            url: '/api/public?scope=wallet&route=checkin'
        };
        const res = createMockResponse();

        await handler(req, res);

        assert.equal(res.statusCode, 200);
        assert.deepEqual(res.json(), {
            success: true,
            source: 'shared-wallet-checkin-stub'
        });
    });
});