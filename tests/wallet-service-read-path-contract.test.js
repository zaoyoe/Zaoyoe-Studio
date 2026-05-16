const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

function encodeBase64Url(value) {
    return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function createTestJwt(payload = {}) {
    return [
        encodeBase64Url({ alg: 'none', typ: 'JWT' }),
        encodeBase64Url(payload),
        'signature'
    ].join('.');
}

function createLocalStorage(initialValues = {}) {
    const store = new Map(Object.entries(initialValues));
    return {
        get length() {
            return store.size;
        },
        key(index) {
            return Array.from(store.keys())[index] || null;
        },
        getItem(key) {
            return store.has(key) ? store.get(key) : null;
        },
        setItem(key, value) {
            store.set(key, String(value));
        },
        removeItem(key) {
            store.delete(key);
        }
    };
}

function loadPointsServiceContext({ session = null, persistedSession = null, refreshSession } = {}) {
    const source = readRepoFile('js/services/PointsService.js');
    const fetchCalls = [];
    const context = {
        console,
        URLSearchParams,
        setTimeout,
        clearTimeout,
        fetch: async (url, init = {}) => {
            fetchCalls.push({ url, init });
            return {
                ok: true,
                async json() {
                    return { success: true };
                }
            };
        },
        window: {
            SiteConfig: { site: 'cn' },
            location: { hostname: 'www.zaoyoe.com' },
            setTimeout,
            clearTimeout,
            atob(value) {
                return Buffer.from(value, 'base64').toString('binary');
            },
            localStorage: createLocalStorage(persistedSession ? {
                'sb-test-auth-token': JSON.stringify({ currentSession: persistedSession })
            } : {}),
            supabaseClient: {
                auth: {
                    async getSession() {
                        return { data: { session } };
                    },
                    onAuthStateChange() {},
                    refreshSession
                },
                from() {
                    return {
                        select() {
                            return this;
                        },
                        eq() {
                            return this;
                        },
                        order() {
                            return Promise.resolve({ data: [], error: null });
                        }
                    };
                }
            }
        }
    };
    context.globalThis = context;
    vm.runInNewContext(source, context);
    return {
        pointsService: context.window.PointsService,
        fetchCalls
    };
}

test('PointsService routes wallet overview and transaction reads through wallet APIs', () => {
    const source = readRepoFile('js/services/PointsService.js');

    assert.equal(source.includes("'/api/wallet/overview'"), true, 'PointsService should load wallet overview via /api/wallet/overview');
    assert.equal(source.includes("'/api/wallet/transactions'"), true, 'PointsService should load wallet transactions via /api/wallet/transactions');
    assert.equal(source.includes("'/api/wallet/prompt-titles'"), true, 'PointsService should load wallet prompt titles via /api/wallet/prompt-titles');
    assert.equal(source.includes("'/api/wallet/verify-log'"), true, 'PointsService should load wallet verify logs via /api/wallet/verify-log');
    assert.equal(source.includes("'/api/shop/my-discount-assets'"), true, 'PointsService should load wallet card assets via /api/shop/my-discount-assets');
    assert.equal(source.includes('peekWalletOverview({ historyLimit = 20, site = \'\' } = {})'), true, 'PointsService should expose a sync wallet overview cache peek helper');
    assert.equal(source.includes('peekWalletBalance({ site = \'\' } = {})'), true, 'PointsService should expose a sync wallet balance cache peek helper');
    assert.equal(source.includes('peekWalletDiscountAssets({ site = \'\' } = {})'), true, 'PointsService should expose a sync wallet card cache peek helper');
    assert.equal(source.includes('getWalletDiscountAssets({ site = \'\', force = false } = {})'), true, 'PointsService should expose a cached wallet card loader');
});

test('WalletModal main browse and search paths use PointsService transaction API instead of direct wallet table reads', () => {
    const source = readRepoFile('js/components/WalletModal.js');

    assert.equal(source.includes('pointsService?.getWalletTransactions'), true, 'WalletModal should use PointsService.getWalletTransactions');
    assert.equal(source.includes('pointsService?.getWalletPromptTitles'), true, 'WalletModal should use PointsService.getWalletPromptTitles');
    assert.equal(source.includes('pointsService?.getWalletVerifyLog'), true, 'WalletModal should use PointsService.getWalletVerifyLog');
    assert.equal(source.includes('const searchResult = await this.searchWalletTransactions('), true, 'WalletModal search path should remain routed through the wallet search helper');
    assert.equal(source.includes('const walletRecords = await pointsService.getWalletTransactions('), true, 'WalletModal browse path should fetch wallet records through PointsService');
    assert.equal(source.includes("from('prompts')"), false, 'WalletModal should no longer read prompts directly from Supabase');
    assert.equal(source.includes("from('verification_logs')"), false, 'WalletModal should no longer read verification_logs directly from Supabase');
    assert.equal(source.includes('pointsService?.peekWalletBalance'), true, 'WalletModal should reuse cached balance data when available');
    assert.equal(source.includes('pointsService?.getWalletDiscountAssets'), true, 'WalletModal cards view should use PointsService.getWalletDiscountAssets');
    assert.equal(source.includes('pointsService?.peekWalletDiscountAssets'), true, 'WalletModal cards view should reuse cached wallet card payloads when available');
    assert.equal(source.includes('const balancePromise = PointsService.getBalance('), true, 'WalletModal should start the balance request independently');
    assert.equal(source.includes('const auxiliaryWalletDataPromise = Promise.allSettled(['), true, 'WalletModal should keep non-balance wallet requests off the balance critical path');
    assert.equal(source.includes('this.restoreDiscountAssetsFromCache()'), true, 'WalletModal should hydrate the cards view from cache before starting a fresh request');
    assert.equal(source.includes('restoreWalletBalanceFromCache({ animate:'), true, 'WalletModal should hydrate the balance view from cache through the shared restore helper');
    assert.equal(source.includes('this.restoreWalletBalanceFromCache({ animate: true })'), true, 'WalletModal should restore cached balance with the number animation when opening');
    assert.equal(source.includes('const hadCachedBalance = this.getCurrentWalletTotalBalance() !== null'), true, 'WalletModal should avoid stomping the opening animation with a second cache hydration during load');
});

test('PointsService wallet reads fall back to the guarded persisted Supabase session', async () => {
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    const token = createTestJwt({
        sub: 'user-persisted-1',
        email: 'wallet@example.com',
        exp: expiresAt
    });
    const { pointsService, fetchCalls } = loadPointsServiceContext({
        session: null,
        persistedSession: {
            access_token: token,
            refresh_token: 'refresh-persisted',
            user: { id: 'user-persisted-1', email: 'wallet@example.com' },
            expires_at: expiresAt
        }
    });

    const context = await pointsService._getSessionContext();
    assert.equal(context.userId, 'user-persisted-1');
    assert.equal(context.accessToken, token);

    await pointsService._fetchWalletJson('/api/wallet/overview', { site: 'cn' });
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].url, '/api/wallet/overview?site=cn');
    assert.equal(fetchCalls[0].init.headers.Authorization, `Bearer ${token}`);
});

test('PointsService refreshes an expired wallet token before calling wallet APIs', async () => {
    const now = Math.floor(Date.now() / 1000);
    const expiredToken = createTestJwt({
        sub: 'user-refresh-1',
        email: 'refresh@example.com',
        exp: now - 60
    });
    const freshToken = createTestJwt({
        sub: 'user-refresh-1',
        email: 'refresh@example.com',
        exp: now + 3600
    });
    let refreshCalls = 0;
    const { pointsService, fetchCalls } = loadPointsServiceContext({
        session: {
            access_token: expiredToken,
            refresh_token: 'refresh-token-1',
            user: { id: 'user-refresh-1', email: 'refresh@example.com' },
            expires_at: now - 60
        },
        refreshSession: async (payload) => {
            refreshCalls += 1;
            assert.equal(payload.refresh_token, 'refresh-token-1');
            return {
                data: {
                    session: {
                        access_token: freshToken,
                        refresh_token: 'refresh-token-2',
                        user: { id: 'user-refresh-1', email: 'refresh@example.com' },
                        expires_at: now + 3600
                    }
                }
            };
        }
    });

    await pointsService._fetchWalletJson('/api/wallet/overview', { site: 'cn' });
    assert.equal(refreshCalls, 1);
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].init.headers.Authorization, `Bearer ${freshToken}`);
});
