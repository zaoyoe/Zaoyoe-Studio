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

async function withPromptsManageHandler(options, callback) {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/prompts/manage.js');
    const originalLoad = Module._load;
    const state = {
        requireAdminCalls: [],
        selectFilters: [],
        metricFilters: [],
        updateFilters: [],
        deleteFilters: [],
        updatePayload: null,
        insertPayload: null,
        rows: options.rows || [],
        row: options.row || null,
        unlockRows: options.unlockRows || [],
        commentRows: options.commentRows || [],
        deletedRows: options.deletedRows || [],
        auditEntries: []
    };

    delete require.cache[handlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../../../../api/_lib/admin') {
            return {
                async requireAdmin(req, config = {}) {
                    state.requireAdminCalls.push({ req, config });
                    return {
                        user: { id: 'admin-1' },
                        supabase: {
                            from(table) {
                                if (table === 'prompt_unlocks' || table === 'prompt_comments') {
                                    return {
                                        select() {
                                            return {
                                                in(field, values) {
                                                    state.metricFilters.push({ table, field, values });
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
                                        return Promise.resolve({
                                            data: state.rows,
                                            error: null
                                        });
                                    },
                                    eq(field, value) {
                                        state.selectFilters.push({ field, value });
                                        return {
                                            select() {
                                                return this;
                                            },
                                            async single() {
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
                                        return {
                                            eq(field, value) {
                                                state.updateFilters.push({ field, value });
                                                return this;
                                            },
                                            select() {
                                                return this;
                                            },
                                            async single() {
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
                        }
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
            { id: 'prompt-1', title: 'Prompt One', tags: ['Photography'] }
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
