const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

function extractFunction(source, functionName) {
    const asyncMarker = `async function ${functionName}(`;
    const plainMarker = `function ${functionName}(`;
    const start = source.indexOf(asyncMarker) !== -1
        ? source.indexOf(asyncMarker)
        : source.indexOf(plainMarker);

    assert.notEqual(start, -1, `Expected to find ${functionName}`);

    const paramsStart = source.indexOf('(', start);
    const bodyStart = source.indexOf('{', paramsStart);
    assert.notEqual(paramsStart, -1, `Expected parameter list for ${functionName}`);
    assert.notEqual(bodyStart, -1, `Expected function body for ${functionName}`);

    let depth = 0;
    let inSingle = false;
    let inDouble = false;
    let inTemplate = false;
    let escaped = false;

    for (let index = bodyStart; index < source.length; index += 1) {
        const char = source[index];

        if (escaped) {
            escaped = false;
            continue;
        }

        if (char === '\\') {
            escaped = true;
            continue;
        }

        if (inSingle) {
            if (char === '\'') inSingle = false;
            continue;
        }

        if (inDouble) {
            if (char === '"') inDouble = false;
            continue;
        }

        if (inTemplate) {
            if (char === '`') inTemplate = false;
            continue;
        }

        if (char === '\'') {
            inSingle = true;
            continue;
        }

        if (char === '"') {
            inDouble = true;
            continue;
        }

        if (char === '`') {
            inTemplate = true;
            continue;
        }

        if (char === '{') {
            depth += 1;
            continue;
        }

        if (char === '}') {
            depth -= 1;
            if (depth === 0) {
                return source.slice(start, index + 1);
            }
        }
    }

    throw new Error(`Failed to extract function ${functionName}`);
}

function createThenableQuery(result, name) {
    const state = {
        name,
        filters: [],
        order: null,
        limit: null,
        siteFilterApplied: false
    };

    const query = {
        __name: name,
        __state: state,
        eq(field, value) {
            state.filters.push({ kind: 'eq', field, value });
            return query;
        },
        gte(field, value) {
            state.filters.push({ kind: 'gte', field, value });
            return query;
        },
        order(field, options = {}) {
            state.order = { field, options };
            return query;
        },
        limit(value) {
            state.limit = value;
            return query;
        },
        maybeSingle() {
            return Promise.resolve(result);
        },
        then(onFulfilled, onRejected) {
            return Promise.resolve(result).then(onFulfilled, onRejected);
        }
    };

    return query;
}

function createDeferredThenableQuery(name) {
    const state = {
        name,
        filters: [],
        order: null,
        limit: null,
        siteFilterApplied: false
    };

    let resolveResult;
    const resultPromise = new Promise((resolve) => {
        resolveResult = resolve;
    });

    const query = {
        __name: name,
        __state: state,
        eq(field, value) {
            state.filters.push({ kind: 'eq', field, value });
            return query;
        },
        gte(field, value) {
            state.filters.push({ kind: 'gte', field, value });
            return query;
        },
        order(field, options = {}) {
            state.order = { field, options };
            return query;
        },
        limit(value) {
            state.limit = value;
            return query;
        },
        maybeSingle() {
            return resultPromise;
        },
        then(onFulfilled, onRejected) {
            return resultPromise.then(onFulfilled, onRejected);
        },
        resolve(payload) {
            resolveResult(payload);
        }
    };

    return query;
}

test('user modal summary keeps login history inside the active site scope', async () => {
    const source = readRepoFile('admin-users.js');
    const functionSource = extractFunction(source, 'fetchUserModalSummaryEnrichment');
    const siteFilterCalls = [];
    const queries = {
        points_balance: createThenableQuery({
            data: [
                { user_id: 'user-1', total_balance: 400 },
                { user_id: 'user-1', total_balance: 650 }
            ],
            error: null
        }, 'points_balance'),
        user_tags: createThenableQuery({
            data: [
                { tag: 'vip' },
                { tag: 'creator' }
            ],
            error: null
        }, 'user_tags'),
        user_login_history: createThenableQuery({
            data: {
                created_at: '2026-04-18T10:20:30.000Z'
            },
            error: null
        }, 'user_login_history')
    };

    const context = {
        console: {
            warn() {}
        },
        window: {
            supabaseClient: {
                from(table) {
                    return {
                        select() {
                            const query = queries[table];
                            assert.ok(query, `Unexpected table ${table}`);
                            return query;
                        }
                    };
                }
            },
            AdminSiteFilter: {
                applySiteFilter(query) {
                    query.__state.siteFilterApplied = true;
                    siteFilterCalls.push(query.__name);
                    return query;
                }
            }
        }
    };
    context.globalThis = context;

    vm.runInNewContext(`${functionSource}; globalThis.fetchUserModalSummaryEnrichment = fetchUserModalSummaryEnrichment;`, context);

    const result = await context.fetchUserModalSummaryEnrichment('user-1');

    assert.deepEqual(siteFilterCalls, ['points_balance', 'user_login_history']);
    assert.equal(queries.points_balance.__state.siteFilterApplied, true);
    assert.equal(queries.user_login_history.__state.siteFilterApplied, true);
    assert.equal(queries.user_tags.__state.siteFilterApplied, false);
    assert.equal(result.points, 1050);
    assert.equal(result.vip_level, 'VIP');
    assert.deepEqual([...result.tags], ['vip', 'creator']);
    assert.equal(result.last_sign_in_at, '2026-04-18T10:20:30.000Z');
});

function createAnalyticsClient(results = {}) {
    const state = {
        fromCalls: [],
        rpcCalls: [],
        queries: {}
    };

    return {
        state,
        client: {
            from(table) {
                state.fromCalls.push(table);
                return {
                    select() {
                        const preset = results[table];
                        const query = preset && typeof preset.then === 'function'
                            ? preset
                            : createThenableQuery(preset || { data: [], error: null }, table);
                        state.queries[table] = query;
                        return query;
                    }
                };
            }
        }
    };
}

function attachAnalyticsRpc(clientBundle, rpcResults = {}) {
    clientBundle.client.rpc = (name, params) => {
        clientBundle.state.rpcCalls.push({ name, params });
        const result = rpcResults?.[name];
        if (typeof result === 'function') {
            return Promise.resolve(result(params));
        }
        return Promise.resolve(result || { data: null, error: { message: 'rpc not configured' } });
    };
    return clientBundle;
}

async function runUpdateOnlineUsersWithSite(siteParam) {
    const source = readRepoFile('js/admin-analytics-runtime-controls.js');
    const functionSource = extractFunction(source, 'updateOnlineUsers');
    const countEl = { textContent: 'pending' };
    const analytics = createAnalyticsClient({
        prompt_comments: { data: [], error: null },
        comment_likes: { data: [], error: null },
        user_events: { data: [], error: null },
        profiles: { count: 9, error: null }
    });

    const context = {
        console: {
            warn() {}
        },
        document: {
            getElementById(id) {
                return id === 'onlineUsersCount' ? countEl : null;
            }
        },
        getAnalyticsSupabaseClient() {
            return analytics.client;
        },
        ANALYTICS_ONLINE_USERS_CACHE_TTL_MS: 60000,
        analyticsOnlineUsersCache: {
            key: '',
            count: null,
            expiresAt: 0,
            pending: null,
            pendingKey: ''
        },
        window: {
            AdminSiteFilter: {
                getSiteParam() {
                    return siteParam;
                },
                applySiteFilter(query) {
                    if (siteParam) {
                        query.eq('site', siteParam);
                    }
                    return query;
                }
            }
        }
    };
    context.globalThis = context;

    vm.runInNewContext(`${functionSource}; globalThis.updateOnlineUsers = updateOnlineUsers;`, context);

    await context.updateOnlineUsers();

    return {
        analytics,
        countEl
    };
}

test('analytics online users skips the cross-site profiles fallback inside a scoped site view', async () => {
    const { analytics, countEl } = await runUpdateOnlineUsersWithSite('cn');

    assert.equal(countEl.textContent, '0');
    assert.deepEqual(analytics.state.fromCalls, ['prompt_comments', 'comment_likes', 'user_events']);
    assert.equal(
        analytics.state.queries.prompt_comments.__state.filters.some((filter) => filter.field === 'site' && filter.value === 'cn'),
        true
    );
    assert.equal(
        analytics.state.queries.comment_likes.__state.filters.some((filter) => filter.field === 'site' && filter.value === 'cn'),
        true
    );
    assert.equal(
        analytics.state.queries.user_events.__state.filters.some((filter) => filter.field === 'site' && filter.value === 'cn'),
        true
    );
});

test('analytics online users still uses the profiles fallback for the all-sites view', async () => {
    const { analytics, countEl } = await runUpdateOnlineUsersWithSite(null);

    assert.equal(countEl.textContent, '9');
    assert.deepEqual(analytics.state.fromCalls, ['prompt_comments', 'comment_likes', 'user_events', 'profiles']);
    assert.equal(
        analytics.state.queries.profiles.__state.filters.some((filter) => filter.field === 'updated_at' && filter.kind === 'gte'),
        true
    );
});

test('analytics online users prefers the single admin rpc when it is available', async () => {
    const source = readRepoFile('js/admin-analytics-runtime-controls.js');
    const functionSource = extractFunction(source, 'updateOnlineUsers');
    const countEl = { textContent: 'pending' };
    const analytics = attachAnalyticsRpc(createAnalyticsClient({
        prompt_comments: { data: [{ user_id: 'fallback-user' }], error: null },
        comment_likes: { data: [], error: null },
        user_events: { data: [], error: null }
    }), {
        get_online_user_count: { data: 7, error: null }
    });

    const context = {
        console: {
            warn() {}
        },
        document: {
            getElementById(id) {
                return id === 'onlineUsersCount' ? countEl : null;
            }
        },
        getAnalyticsSupabaseClient() {
            return analytics.client;
        },
        ANALYTICS_ONLINE_USERS_CACHE_TTL_MS: 60000,
        analyticsOnlineUsersCache: {
            key: '',
            count: null,
            expiresAt: 0,
            pending: null,
            pendingKey: ''
        },
        window: {
            AdminSiteFilter: {
                getSiteFilter() {
                    return 'cn';
                },
                getSiteParam() {
                    return 'cn';
                },
                applySiteFilter(query) {
                    query.eq('site', 'cn');
                    return query;
                }
            }
        }
    };
    context.globalThis = context;

    vm.runInNewContext(`${functionSource}; globalThis.updateOnlineUsers = updateOnlineUsers;`, context);

    await context.updateOnlineUsers();

    assert.equal(countEl.textContent, '7');
    assert.deepEqual(JSON.parse(JSON.stringify(analytics.state.rpcCalls)), [{
        name: 'get_online_user_count',
        params: {
            p_window_minutes: 5,
            p_site: 'cn'
        }
    }]);
    assert.deepEqual(analytics.state.fromCalls, [], 'table fallback should not run when the rpc succeeds');
});

function createFakeDate(nowRef) {
    return class FakeDate extends Date {
        constructor(...args) {
            if (args.length > 0) {
                super(...args);
                return;
            }
            super(nowRef.value);
        }

        static now() {
            return nowRef.value;
        }
    };
}

test('analytics online users reuses the same-site cache inside the ttl window', async () => {
    const source = readRepoFile('js/admin-analytics-runtime-controls.js');
    const functionSource = extractFunction(source, 'updateOnlineUsers');
    const nowRef = { value: Date.parse('2026-04-20T12:00:00.000Z') };
    const countEl = { textContent: 'pending' };
    const analytics = createAnalyticsClient({
        prompt_comments: { data: [], error: null },
        comment_likes: { data: [], error: null },
        user_events: { data: [], error: null },
        profiles: { count: 9, error: null }
    });

    const context = {
        console: {
            warn() {}
        },
        Date: createFakeDate(nowRef),
        document: {
            getElementById(id) {
                return id === 'onlineUsersCount' ? countEl : null;
            }
        },
        getAnalyticsSupabaseClient() {
            return analytics.client;
        },
        ANALYTICS_ONLINE_USERS_CACHE_TTL_MS: 60000,
        analyticsOnlineUsersCache: {
            key: '',
            count: null,
            expiresAt: 0,
            pending: null,
            pendingKey: ''
        },
        window: {
            AdminSiteFilter: {
                getSiteFilter() {
                    return 'all';
                },
                getSiteParam() {
                    return null;
                },
                applySiteFilter(query) {
                    return query;
                }
            }
        }
    };
    context.globalThis = context;

    vm.runInNewContext(`${functionSource}; globalThis.updateOnlineUsers = updateOnlineUsers;`, context);

    await context.updateOnlineUsers();
    assert.equal(countEl.textContent, '9');
    assert.deepEqual(analytics.state.fromCalls, ['prompt_comments', 'comment_likes', 'user_events', 'profiles']);

    nowRef.value += 30000;
    await context.updateOnlineUsers();

    assert.equal(countEl.textContent, '9');
    assert.deepEqual(
        analytics.state.fromCalls,
        ['prompt_comments', 'comment_likes', 'user_events', 'profiles'],
        'the second call should reuse the cached online-user count inside the ttl window'
    );
});

test('analytics online users keeps cache entries isolated per site key and refreshes after ttl expiry', async () => {
    const source = readRepoFile('js/admin-analytics-runtime-controls.js');
    const functionSource = extractFunction(source, 'updateOnlineUsers');
    const nowRef = { value: Date.parse('2026-04-20T12:00:00.000Z') };
    const countEl = { textContent: 'pending' };
    const analytics = createAnalyticsClient({
        prompt_comments: { data: [], error: null },
        comment_likes: { data: [], error: null },
        user_events: { data: [], error: null },
        profiles: { count: 9, error: null }
    });
    const siteState = { value: 'all' };

    const context = {
        console: {
            warn() {}
        },
        Date: createFakeDate(nowRef),
        document: {
            getElementById(id) {
                return id === 'onlineUsersCount' ? countEl : null;
            }
        },
        getAnalyticsSupabaseClient() {
            return analytics.client;
        },
        ANALYTICS_ONLINE_USERS_CACHE_TTL_MS: 60000,
        analyticsOnlineUsersCache: {
            key: '',
            count: null,
            expiresAt: 0,
            pending: null,
            pendingKey: ''
        },
        window: {
            AdminSiteFilter: {
                getSiteFilter() {
                    return siteState.value;
                },
                getSiteParam() {
                    return siteState.value === 'all' ? null : siteState.value;
                },
                applySiteFilter(query) {
                    if (siteState.value !== 'all') {
                        query.eq('site', siteState.value);
                    }
                    return query;
                }
            }
        }
    };
    context.globalThis = context;

    vm.runInNewContext(`${functionSource}; globalThis.updateOnlineUsers = updateOnlineUsers;`, context);

    await context.updateOnlineUsers();
    assert.deepEqual(analytics.state.fromCalls, ['prompt_comments', 'comment_likes', 'user_events', 'profiles']);

    siteState.value = 'cn';
    await context.updateOnlineUsers();
    assert.deepEqual(
        analytics.state.fromCalls,
        ['prompt_comments', 'comment_likes', 'user_events', 'profiles', 'prompt_comments', 'comment_likes', 'user_events'],
        'switching to a scoped site should bypass the all-sites cache entry'
    );

    nowRef.value += 61000;
    siteState.value = 'all';
    await context.updateOnlineUsers();
    assert.deepEqual(
        analytics.state.fromCalls,
        [
            'prompt_comments',
            'comment_likes',
            'user_events',
            'profiles',
            'prompt_comments',
            'comment_likes',
            'user_events',
            'prompt_comments',
            'comment_likes',
            'user_events',
            'profiles'
        ],
        'the all-sites cache should expire after the ttl window and refresh from the source tables'
    );
});

test('analytics online users fans out comment, like, and event probes in parallel on a cache miss', async () => {
    const source = readRepoFile('js/admin-analytics-runtime-controls.js');
    const functionSource = extractFunction(source, 'updateOnlineUsers');
    const countEl = { textContent: 'pending' };
    const commentsQuery = createDeferredThenableQuery('prompt_comments');
    const likesQuery = createDeferredThenableQuery('comment_likes');
    const eventsQuery = createDeferredThenableQuery('user_events');
    const analytics = createAnalyticsClient({
        prompt_comments: commentsQuery,
        comment_likes: likesQuery,
        user_events: eventsQuery,
        profiles: { count: 9, error: null }
    });

    const context = {
        console: {
            warn() {}
        },
        document: {
            getElementById(id) {
                return id === 'onlineUsersCount' ? countEl : null;
            }
        },
        getAnalyticsSupabaseClient() {
            return analytics.client;
        },
        ANALYTICS_ONLINE_USERS_CACHE_TTL_MS: 60000,
        analyticsOnlineUsersCache: {
            key: '',
            count: null,
            expiresAt: 0,
            pending: null,
            pendingKey: ''
        },
        window: {
            AdminSiteFilter: {
                getSiteFilter() {
                    return 'cn';
                },
                getSiteParam() {
                    return 'cn';
                },
                applySiteFilter(query) {
                    query.eq('site', 'cn');
                    return query;
                }
            }
        }
    };
    context.globalThis = context;

    vm.runInNewContext(`${functionSource}; globalThis.updateOnlineUsers = updateOnlineUsers;`, context);

    const pendingUpdate = context.updateOnlineUsers();
    await Promise.resolve();

    assert.deepEqual(
        analytics.state.fromCalls,
        ['prompt_comments', 'comment_likes', 'user_events'],
        'the three online-user probes should all start before the first one resolves'
    );

    commentsQuery.resolve({ data: [{ user_id: 'u-1' }], error: null });
    likesQuery.resolve({ data: [{ user_id: 'u-2' }], error: null });
    eventsQuery.resolve({ data: [{ user_id: 'u-3' }], error: null });

    await pendingUpdate;

    assert.equal(countEl.textContent, '3');
});
