const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const adminLib = require('../api/_lib/admin');

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

const DEFAULT_PROMPT_SOURCE_FIELDS = Object.freeze({
    source_url: '',
    source_author_name: '',
    source_author_handle: '',
    source_author_avatar_url: ''
});

async function withPromptsManageHandler(options, callback) {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/prompts/manage.js');
    const originalLoad = Module._load;
    const state = {
        requireAdminCalls: [],
        rpcCalls: [],
        selectFilters: [],
        metricFilters: [],
        listRanges: [],
        updateFilters: [],
        deleteFilters: [],
        updatePayload: null,
        updatePayloads: [],
        insertPayload: null,
        rows: options.rows || [],
        row: options.row || null,
        rpcResponses: Array.isArray(options.rpcResponses) ? [...options.rpcResponses] : null,
        listResponses: Array.isArray(options.listResponses) ? [...options.listResponses] : null,
        singleResponses: Array.isArray(options.singleResponses) ? [...options.singleResponses] : null,
        unlockRows: options.unlockRows || [],
        commentRows: options.commentRows || [],
        metricResponses: options.metricResponses
            ? {
                prompt_unlocks: Array.isArray(options.metricResponses.prompt_unlocks)
                    ? [...options.metricResponses.prompt_unlocks]
                    : null,
                prompt_comments: Array.isArray(options.metricResponses.prompt_comments)
                    ? [...options.metricResponses.prompt_comments]
                    : null
            }
            : null,
        updateResponses: Array.isArray(options.updateResponses) ? [...options.updateResponses] : null,
        deletedRows: options.deletedRows || [],
        auditEntries: []
    };

    delete require.cache[handlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../../../../api/_lib/admin') {
            return {
                async requireAdmin(req, config = {}) {
                    state.requireAdminCalls.push({ req, config });
                    const supabase = {
                        from(table) {
                            if (table === 'prompt_unlocks' || table === 'prompt_comments') {
                                return {
                                    select() {
                                        return {
                                            in(field, values) {
                                                state.metricFilters.push({ table, field, values });
                                                if (state.metricResponses?.[table]?.length) {
                                                    return Promise.resolve(state.metricResponses[table].shift());
                                                }
                                                return Promise.resolve({
                                                    data: table === 'prompt_unlocks' ? state.unlockRows : state.commentRows,
                                                    error: null
                                                });
                                            }
                                        };
                                    }
                                };
                            }

                            if (table !== 'prompts') {
                                throw new Error(`Unexpected table: ${table}`);
                            }

                            return {
                                select() {
                                    return this;
                                },
                                order() {
                                    if (state.listResponses?.length) {
                                        return Promise.resolve(state.listResponses.shift());
                                    }
                                    return {
                                        range(from, to) {
                                            state.listRanges.push({ from, to });
                                            const slicedRows = state.rows.slice(from, to + 1);
                                            return Promise.resolve({
                                                data: slicedRows,
                                                count: state.rows.length,
                                                error: null
                                            });
                                        },
                                        then(resolve, reject) {
                                            return Promise.resolve({
                                                data: state.rows,
                                                error: null
                                            }).then(resolve, reject);
                                        }
                                    };
                                },
                                eq(field, value) {
                                    state.selectFilters.push({ field, value });
                                    return {
                                        select() {
                                            return this;
                                        },
                                        async single() {
                                            if (state.singleResponses?.length) {
                                                return state.singleResponses.shift();
                                            }
                                            if (!state.row) {
                                                return {
                                                    data: null,
                                                    error: { code: 'PGRST116', message: 'not found' }
                                                };
                                            }
                                            return {
                                                data: state.row,
                                                error: null
                                            };
                                        }
                                    };
                                },
                                insert(payload) {
                                    state.insertPayload = payload;
                                    return {
                                        select() {
                                            return this;
                                        },
                                        async single() {
                                            return {
                                                data: state.row,
                                                error: null
                                            };
                                        }
                                    };
                                },
                                update(payload) {
                                    state.updatePayload = payload;
                                    state.updatePayloads.push(payload);
                                    return {
                                        eq(field, value) {
                                            state.updateFilters.push({ field, value });
                                            return this;
                                        },
                                        select() {
                                            return this;
                                        },
                                        async single() {
                                            if (state.updateResponses?.length) {
                                                return state.updateResponses.shift();
                                            }
                                            return {
                                                data: state.row,
                                                error: state.row ? null : { code: 'PGRST116', message: 'not found' }
                                            };
                                        }
                                    };
                                },
                                delete() {
                                    return {
                                        in(field, values) {
                                            state.deleteFilters.push({ field, values });
                                            return {
                                                select() {
                                                    return Promise.resolve({
                                                        data: state.deletedRows,
                                                        error: null
                                                    });
                                                }
                                            };
                                        }
                                    };
                                }
                            };
                        }
                    };

                    if (state.rpcResponses) {
                        supabase.rpc = async (name, args) => {
                            state.rpcCalls.push({ name, args });
                            if (state.rpcResponses.length) {
                                return state.rpcResponses.shift();
                            }
                            return { data: null, error: null };
                        };
                    }

                    return {
                        user: { id: 'admin-1' },
                        supabase
                    };
                },
                async parseJsonBody(req) {
                    return req.body || {};
                },
                normalizeAdminSite: adminLib.normalizeAdminSite,
                requireWritableAdminSite: adminLib.requireWritableAdminSite,
                sendJson(res, status, payload) {
                    res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
                    res.end(JSON.stringify(payload));
                },
                async writeAdminAuditLog(entry) {
                    state.auditEntries.push(entry);
                }
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

test('prompts manage handler lists prompt rows for reads', async () => {
    await withPromptsManageHandler({
        rows: [
            {
                id: 'prompt-1',
                title: 'Prompt One',
                tags: ['Photography'],
                source_url: 'https://x.com/creator/status/123',
                source_author_name: 'Creator',
                source_author_handle: '@creator',
                source_author_avatar_url: 'https://cdn.example.com/avatar.jpg'
            }
        ],
        unlockRows: [
            { prompt_id: 'prompt-1', site: 'cn' },
            { prompt_id: 'prompt-1', site: 'cn' },
            { prompt_id: 'prompt-1', site: 'intl' }
        ],
        commentRows: [
            { prompt_id: 'prompt-1', site: 'cn' }
        ]
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'GET',
            url: '/api/admin/prompts/manage?site=all',
            headers: {}
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.json().success, true);
        assert.equal(res.json().siteContext, 'all');
        assert.deepEqual(res.json().rows, [{
            id: 'prompt-1',
            title: 'Prompt One',
            tags: ['Photography'],
            dominant_colors: [],
            ai_tags: {},
            quality_score: null,
            image_assets: [],
            video_assets: [],
            title_en: '',
            title_zh: '',
            description_en: '',
            description_zh: '',
            prompt_text_en: '',
            prompt_text_zh: '',
            source_url: 'https://x.com/creator/status/123',
            source_author_name: 'Creator',
            source_author_handle: '@creator',
            source_author_avatar_url: 'https://cdn.example.com/avatar.jpg',
            site_metrics: {
                cn: { unlock_count: 2, comment_count: 1 },
                intl: { unlock_count: 1, comment_count: 0 },
                total: { unlock_count: 3, comment_count: 1 }
            }
        }]);
        assert.deepEqual(state.metricFilters, [
            { table: 'prompt_unlocks', field: 'prompt_id', values: ['prompt-1'] },
            { table: 'prompt_comments', field: 'prompt_id', values: ['prompt-1'] }
        ]);
        assert.deepEqual(state.requireAdminCalls[0]?.config, {
            anyOf: ['prompts.manage', 'content.moderate']
        });
    });
});

test('prompts manage handler paginates prompt rows for manage cards', async () => {
    await withPromptsManageHandler({
        rows: [
            { id: 'prompt-1', title: 'Prompt One', tags: ['Photography'] },
            { id: 'prompt-2', title: 'Prompt Two', tags: ['Creative'] },
            { id: 'prompt-3', title: 'Prompt Three', tags: ['Illustration'] }
        ],
        unlockRows: [
            { prompt_id: 'prompt-3', site: 'intl' }
        ],
        commentRows: []
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'GET',
            url: '/api/admin/prompts/manage?site=all&page=2&pageSize=1&sort=created-desc',
            headers: {}
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.deepEqual(state.listRanges, [{ from: 1, to: 1 }]);
        assert.deepEqual(payload.rows.map((row) => row.id), ['prompt-2']);
        assert.deepEqual(payload.pagination, {
            page: 2,
            pageSize: 1,
            totalItems: 3,
            totalPages: 3,
            hasPrevPage: true,
            hasNextPage: true,
            returnedItems: 1
        });
        assert.deepEqual(state.metricFilters, [
            { table: 'prompt_unlocks', field: 'prompt_id', values: ['prompt-2'] },
            { table: 'prompt_comments', field: 'prompt_id', values: ['prompt-2'] }
        ]);
    });
});

test('prompts manage handler uses gallery manage rpc for derived filters and sorting', async () => {
    await withPromptsManageHandler({
        rpcResponses: [
            {
                data: JSON.stringify({
                    rows: [
                        {
                            id: 'prompt-rpc',
                            title: 'RPC Prompt',
                            tags: ['Creative'],
                            site_metrics: {
                                cn: { unlock_count: 2, comment_count: 1 },
                                total: { unlock_count: 3, comment_count: 1 }
                            }
                        }
                    ],
                    pagination: {
                        page: 2,
                        pageSize: 1,
                        totalItems: 7,
                        returnedItems: 1
                    }
                }),
                error: null
            }
        ]
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'GET',
            url: '/api/admin/prompts/manage?site=intl&page=2&pageSize=1&search=cat%20art&category=Creative&date=week&language=needs-translation&status=live&sort=engagement-desc',
            headers: {}
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.deepEqual(state.rpcCalls, [{
            name: 'fn_admin_gallery_prompt_manage_list',
            args: {
                p_site: 'intl',
                p_page: 2,
                p_page_size: 1,
                p_search: 'cat art',
                p_category: 'Creative',
                p_date_filter: 'week',
                p_language_filter: 'needs-translation',
                p_status_filter: 'live',
                p_sort: 'engagement-desc'
            }
        }]);
        assert.deepEqual(state.listRanges, []);
        assert.deepEqual(state.metricFilters, []);
        assert.equal(payload.rows[0].id, 'prompt-rpc');
        assert.deepEqual(payload.rows[0].site_metrics, {
            cn: { unlock_count: 2, comment_count: 1 },
            intl: { unlock_count: 0, comment_count: 0 },
            total: { unlock_count: 3, comment_count: 1 }
        });
        assert.deepEqual(payload.pagination, {
            page: 2,
            pageSize: 1,
            totalItems: 7,
            totalPages: 7,
            hasPrevPage: true,
            hasNextPage: true,
            returnedItems: 1
        });
    });
});

test('prompts manage handler falls back to query pagination when gallery manage rpc is unavailable', async () => {
    const originalWarn = console.warn;
    console.warn = () => {};

    try {
        await withPromptsManageHandler({
            rpcResponses: [
                {
                    data: null,
                    error: { message: 'function fn_admin_gallery_prompt_manage_list does not exist' }
                }
            ],
            rows: [
                { id: 'prompt-1', title: 'Prompt One', tags: ['Photography'] },
                { id: 'prompt-2', title: 'Prompt Two', tags: ['Creative'] }
            ]
        }, async ({ handler, state }) => {
            const res = createMockResponse();

            await handler({
                method: 'GET',
                url: '/api/admin/prompts/manage?site=all&page=2&pageSize=1&sort=created-desc',
                headers: {}
            }, res);

            const payload = res.json();
            assert.equal(res.statusCode, 200);
            assert.equal(payload.success, true);
            assert.equal(state.rpcCalls.length, 1);
            assert.deepEqual(state.listRanges, [{ from: 1, to: 1 }]);
            assert.deepEqual(payload.rows.map((row) => row.id), ['prompt-2']);
        });
    } finally {
        console.warn = originalWarn;
    }
});

test('prompts manage handler falls back to legacy select fields when bilingual columns are unavailable', async () => {
    await withPromptsManageHandler({
        listResponses: [
            {
                data: null,
                error: {
                    code: '42703',
                    message: 'column prompts.title_en does not exist'
                }
            },
            {
                data: [
                    { id: 'prompt-legacy', title: 'Legacy Prompt', tags: ['Photography'] }
                ],
                error: null
            }
        ]
    }, async ({ handler }) => {
        const res = createMockResponse();

        await handler({
            method: 'GET',
            url: '/api/admin/prompts/manage?site=all',
            headers: {}
        }, res);

        assert.equal(res.statusCode, 200);
        assert.deepEqual(res.json().rows, [{
            id: 'prompt-legacy',
            title: 'Legacy Prompt',
            tags: ['Photography'],
            dominant_colors: [],
            ai_tags: {},
            quality_score: null,
            image_assets: [],
            video_assets: [],
            title_en: '',
            title_zh: '',
            description_en: '',
            description_zh: '',
            prompt_text_en: '',
            prompt_text_zh: '',
            ...DEFAULT_PROMPT_SOURCE_FIELDS,
            site_metrics: {
                cn: { unlock_count: 0, comment_count: 0 },
                intl: { unlock_count: 0, comment_count: 0 },
                total: { unlock_count: 0, comment_count: 0 }
            }
        }]);
    });
});

test('prompts manage handler keeps listing rows when prompt metric site columns are unavailable', async () => {
    await withPromptsManageHandler({
        rows: [
            { id: 'prompt-legacy-metrics', title: 'Legacy Metrics Prompt', tags: ['Photography'] }
        ],
        metricResponses: {
            prompt_unlocks: [
                {
                    data: null,
                    error: {
                        code: '42703',
                        message: 'column prompt_unlocks.site does not exist'
                    }
                },
                {
                    data: [
                        { prompt_id: 'prompt-legacy-metrics' },
                        { prompt_id: 'prompt-legacy-metrics' }
                    ],
                    error: null
                }
            ],
            prompt_comments: [
                {
                    data: null,
                    error: {
                        code: '42703',
                        message: 'column prompt_comments.site does not exist'
                    }
                },
                {
                    data: [
                        { prompt_id: 'prompt-legacy-metrics' }
                    ],
                    error: null
                }
            ]
        }
    }, async ({ handler }) => {
        const res = createMockResponse();

        await handler({
            method: 'GET',
            url: '/api/admin/prompts/manage?site=all',
            headers: {}
        }, res);

        assert.equal(res.statusCode, 200);
        assert.deepEqual(res.json().rows, [{
            id: 'prompt-legacy-metrics',
            title: 'Legacy Metrics Prompt',
            tags: ['Photography'],
            dominant_colors: [],
            ai_tags: {},
            quality_score: null,
            image_assets: [],
            video_assets: [],
            title_en: '',
            title_zh: '',
            description_en: '',
            description_zh: '',
            prompt_text_en: '',
            prompt_text_zh: '',
            ...DEFAULT_PROMPT_SOURCE_FIELDS,
            site_metrics: {
                cn: { unlock_count: 2, comment_count: 1 },
                intl: { unlock_count: 0, comment_count: 0 },
                total: { unlock_count: 2, comment_count: 1 }
            }
        }]);
    });
});

test('prompts manage handler falls back when quality_score column is unavailable', async () => {
    await withPromptsManageHandler({
        listResponses: [
            {
                data: null,
                error: {
                    code: '42703',
                    message: 'column prompts.quality_score does not exist'
                }
            },
            {
                data: [
                    { id: 'prompt-no-quality', title: 'Prompt Without Quality', tags: ['Photography'] }
                ],
                error: null
            }
        ]
    }, async ({ handler }) => {
        const res = createMockResponse();

        await handler({
            method: 'GET',
            url: '/api/admin/prompts/manage?site=all',
            headers: {}
        }, res);

        assert.equal(res.statusCode, 200);
        assert.deepEqual(res.json().rows, [{
            id: 'prompt-no-quality',
            title: 'Prompt Without Quality',
            tags: ['Photography'],
            dominant_colors: [],
            ai_tags: {},
            quality_score: null,
            image_assets: [],
            video_assets: [],
            title_en: '',
            title_zh: '',
            description_en: '',
            description_zh: '',
            prompt_text_en: '',
            prompt_text_zh: '',
            ...DEFAULT_PROMPT_SOURCE_FIELDS,
            site_metrics: {
                cn: { unlock_count: 0, comment_count: 0 },
                intl: { unlock_count: 0, comment_count: 0 },
                total: { unlock_count: 0, comment_count: 0 }
            }
        }]);
    });
});

test('prompts manage handler falls back when updated_at column is unavailable', async () => {
    await withPromptsManageHandler({
        listResponses: [
            {
                data: null,
                error: {
                    code: '42703',
                    message: 'column prompts.updated_at does not exist'
                }
            },
            {
                data: [
                    { id: 'prompt-no-updated-at', title: 'Prompt Without UpdatedAt', tags: ['Photography'] }
                ],
                error: null
            }
        ]
    }, async ({ handler }) => {
        const res = createMockResponse();

        await handler({
            method: 'GET',
            url: '/api/admin/prompts/manage?site=all',
            headers: {}
        }, res);

        assert.equal(res.statusCode, 200);
        assert.deepEqual(res.json().rows, [{
            id: 'prompt-no-updated-at',
            title: 'Prompt Without UpdatedAt',
            tags: ['Photography'],
            dominant_colors: [],
            ai_tags: {},
            quality_score: null,
            image_assets: [],
            video_assets: [],
            title_en: '',
            title_zh: '',
            description_en: '',
            description_zh: '',
            prompt_text_en: '',
            prompt_text_zh: '',
            ...DEFAULT_PROMPT_SOURCE_FIELDS,
            site_metrics: {
                cn: { unlock_count: 0, comment_count: 0 },
                intl: { unlock_count: 0, comment_count: 0 },
                total: { unlock_count: 0, comment_count: 0 }
            }
        }]);
    });
});

test('prompts manage handler rejects all-site writes', async () => {
    await withPromptsManageHandler({}, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'create',
                site: 'all',
                title: 'Bad Prompt',
                tags: ['Photography']
            }
        }, res);

        assert.equal(res.statusCode, 400);
        assert.match(res.json().message, /Writable admin site must be cn or intl/i);
        assert.equal(state.insertPayload, null);
    });
});

test('prompts manage handler updates prompt rows with explicit id filter and audit site context', async () => {
    await withPromptsManageHandler({
        row: {
            id: 'prompt-1',
            title: 'Prompt One Updated',
            tags: ['Photography'],
            description: 'Updated'
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'update',
                id: 'prompt-1',
                site: 'intl',
                title: 'Prompt One Updated',
                tags: ['Photography'],
                description: 'Updated'
            }
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.json().success, true);
        assert.deepEqual(state.updateFilters, [{ field: 'id', value: 'prompt-1' }]);
        assert.deepEqual(state.updatePayload, {
            title: 'Prompt One Updated',
            tags: ['Photography'],
            description: 'Updated',
            updated_at: state.updatePayload.updated_at
        });
        assert.equal(typeof state.updatePayload.updated_at, 'string');
        assert.equal(state.auditEntries[0]?.site, 'intl');
        assert.equal(state.auditEntries[0]?.module, 'prompts');
    });
});

test('prompts manage handler canonicalizes prompt image variants before saving', async () => {
    await withPromptsManageHandler({
        row: {
            id: 'prompt-images-1',
            title: 'Prompt Images',
            tags: ['Photography']
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'update',
                id: 'prompt-images-1',
                site: 'cn',
                title: 'Prompt Images',
                tags: ['Photography'],
                images: [
                    'https://cdn.fatherkey.com/prompts/a.webp',
                    'https://cdn.fatherkey.com/prompts/thumb/a.webp',
                    'https://cdn.fatherkey.com/prompts/card/b.webp',
                    'https://cdn.fatherkey.com/prompts/b.webp'
                ],
                image_assets: [
                    {
                        original: 'https://cdn.fatherkey.com/prompts/a.webp',
                        featured: 'https://cdn.fatherkey.com/prompts/featured/a.webp'
                    },
                    'https://cdn.fatherkey.com/prompts/thumb/b.webp'
                ]
            }
        }, res);

        assert.equal(res.statusCode, 200);
        assert.deepEqual(state.updatePayload.images, [
            'https://cdn.fatherkey.com/prompts/a.webp',
            'https://cdn.fatherkey.com/prompts/b.webp'
        ]);
        assert.deepEqual(state.updatePayload.image_assets, [
            {
                original: 'https://cdn.fatherkey.com/prompts/a.webp',
                featured: 'https://cdn.fatherkey.com/prompts/featured/a.webp',
                thumb: 'https://cdn.fatherkey.com/prompts/thumb/a.webp'
            },
            {
                thumb: 'https://cdn.fatherkey.com/prompts/thumb/b.webp',
                original: 'https://cdn.fatherkey.com/prompts/b.webp',
                card: 'https://cdn.fatherkey.com/prompts/card/b.webp'
            }
        ]);
        assert.equal(typeof state.updatePayload.updated_at, 'string');
    });
});

test('prompts manage handler updates source attribution fields', async () => {
    await withPromptsManageHandler({
        row: {
            id: 'prompt-source-1',
            title: 'Prompt With Source',
            tags: ['Photography'],
            source_url: 'https://x.com/creator/status/123',
            source_author_name: 'Creator',
            source_author_handle: '@creator',
            source_author_avatar_url: 'https://cdn.example.com/avatar.jpg'
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'update',
                id: 'prompt-source-1',
                site: 'cn',
                title: 'Prompt With Source',
                tags: ['Photography'],
                source_url: 'https://x.com/creator/status/123',
                source_author_name: 'Creator',
                source_author_handle: '@creator',
                source_author_avatar_url: 'https://cdn.example.com/avatar.jpg'
            }
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.json().success, true);
        assert.equal(state.updatePayload.source_url, 'https://x.com/creator/status/123');
        assert.equal(state.updatePayload.source_author_name, 'Creator');
        assert.equal(state.updatePayload.source_author_handle, '@creator');
        assert.equal(state.updatePayload.source_author_avatar_url, 'https://cdn.example.com/avatar.jpg');
        assert.equal(typeof state.updatePayload.updated_at, 'string');
    });
});

test('prompts manage handler updates prompt rows when updated_at schema cache is unavailable', async () => {
    await withPromptsManageHandler({
        row: {
            id: 'prompt-legacy-update',
            title: 'Legacy Prompt Updated',
            tags: ['Photography'],
            description: 'Updated without updated_at column'
        },
        updateResponses: [
            {
                data: null,
                error: {
                    code: 'PGRST204',
                    message: "Could not find the 'updated_at' column of 'prompts' in the schema cache"
                }
            },
            {
                data: {
                    id: 'prompt-legacy-update',
                    title: 'Legacy Prompt Updated',
                    tags: ['Photography'],
                    description: 'Updated without updated_at column'
                },
                error: null
            }
        ]
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'patch',
                id: 'prompt-legacy-update',
                site: 'cn',
                description: 'Updated without updated_at column'
            }
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.json().success, true);
        assert.equal(state.updatePayloads.length, 2);
        assert.deepEqual(state.updatePayloads[0], {
            description: 'Updated without updated_at column',
            updated_at: state.updatePayloads[0].updated_at
        });
        assert.equal(typeof state.updatePayloads[0].updated_at, 'string');
        assert.deepEqual(state.updatePayloads[1], {
            description: 'Updated without updated_at column'
        });
    });
});

test('prompts manage handler returns a schema reload hint when bilingual prompt fields are unavailable in api schema cache', async () => {
    await withPromptsManageHandler({
        row: {
            id: 'prompt-bilingual-cache',
            title: 'Prompt bilingual cache',
            tags: ['Creative'],
            description: 'desc'
        },
        updateResponses: [
            {
                data: null,
                error: {
                    code: 'PGRST204',
                    message: "Could not find the 'title_en' column of 'prompts' in the schema cache"
                }
            }
        ]
    }, async ({ handler }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'patch',
                id: 'prompt-bilingual-cache',
                site: 'cn',
                title_en: 'Prompt bilingual cache',
                description_en: 'desc'
            }
        }, res);

        assert.equal(res.statusCode, 409);
        assert.match(res.json().message, /reload schema/i);
        assert.match(res.json().message, /pg_notify/i);
    });
});

test('prompts manage handler returns a schema reload hint when source attribution fields are unavailable in api schema cache', async () => {
    await withPromptsManageHandler({
        row: {
            id: 'prompt-source-cache',
            title: 'Prompt source cache',
            tags: ['Creative'],
            description: 'desc'
        },
        updateResponses: [
            {
                data: null,
                error: {
                    code: 'PGRST204',
                    message: "Could not find the 'source_url' column of 'prompts' in the schema cache"
                }
            }
        ]
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'patch',
                id: 'prompt-source-cache',
                site: 'cn',
                source_url: 'https://x.com/creator/status/123',
                source_author_name: 'Creator'
            }
        }, res);

        assert.equal(res.statusCode, 409);
        assert.match(res.json().message, /Prompt 引用原作者字段尚未被 API schema cache 识别/);
        assert.match(res.json().message, /20260619_add_prompt_source_attribution/);
        assert.match(res.json().message, /pg_notify/i);
        assert.equal(state.updatePayloads.length, 1);
    });
});

test('prompts manage handler deletes multiple ids through admin api', async () => {
    await withPromptsManageHandler({
        deletedRows: [
            { id: 'prompt-1', title: 'Prompt One' },
            { id: 'prompt-2', title: 'Prompt Two' }
        ]
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'DELETE',
            headers: {},
            body: {
                site: 'cn',
                ids: ['prompt-1', 'prompt-2']
            }
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.json().deletedCount, 2);
        assert.deepEqual(state.deleteFilters, [{
            field: 'id',
            values: ['prompt-1', 'prompt-2']
        }]);
        assert.equal(state.auditEntries[0]?.actionType, 'prompt.delete_many');
    });
});

test('prompts manage handler accepts delete ids from query params when delete body is stripped', async () => {
    await withPromptsManageHandler({
        deletedRows: [
            { id: 'prompt-query-1', title: 'Prompt Query One' },
            { id: 'prompt-query-2', title: 'Prompt Query Two' }
        ]
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'DELETE',
            url: '/api/admin/prompts/manage?site=cn&ids=prompt-query-1&ids=prompt-query-2',
            headers: {},
            body: {}
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.json().deletedCount, 2);
        assert.deepEqual(state.deleteFilters, [{
            field: 'id',
            values: ['prompt-query-1', 'prompt-query-2']
        }]);
        assert.equal(state.auditEntries[0]?.actionType, 'prompt.delete_many');
    });
});
