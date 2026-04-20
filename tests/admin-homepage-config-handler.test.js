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

function createThenableResult(result) {
    return {
        then(onFulfilled, onRejected) {
            return Promise.resolve(result).then(onFulfilled, onRejected);
        }
    };
}

async function withHomepageConfigHandler(options, callback) {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/homepage/config.js');
    const originalLoad = Module._load;
    const state = {
        requireAdminCalls: [],
        homepageSelectFilters: [],
        homepageUpdateFilters: [],
        homepageUpdatePayload: null,
        homepageUpsertPayload: null,
        homepageUpsertOptions: null,
        draftSelectFilters: [],
        draftUpsertPayload: null,
        draftUpsertOptions: null,
        draftDeleteFilters: [],
        releaseSelectFilters: [],
        releaseLimit: null,
        releaseInsertPayload: null,
        auditCalls: [],
        rows: options.rows || [],
        updateRow: options.updateRow || null,
        draftRow: options.draftRow || null,
        draftUpsertRow: options.draftUpsertRow || null,
        releaseRows: options.releaseRows || [],
        releaseInsertRow: options.releaseInsertRow || null,
        publishedUpsertRows: options.publishedUpsertRows || null,
        shopCategoryRows: options.shopCategoryRows || []
    };

    function createHomepageConfigTable() {
        return {
            select() {
                return {
                    eq(field, value) {
                        state.homepageSelectFilters.push({ field, value });
                        return this;
                    },
                    order() {
                        return this;
                    },
                    then(onFulfilled, onRejected) {
                        return Promise.resolve({
                            data: state.rows,
                            error: null
                        }).then(onFulfilled, onRejected);
                    }
                };
            },
            update(payload) {
                state.homepageUpdatePayload = payload;
                return {
                    eq(field, value) {
                        state.homepageUpdateFilters.push({ field, value });
                        return this;
                    },
                    select() {
                        return this;
                    },
                    async single() {
                        return {
                            data: state.updateRow,
                            error: state.updateRow ? null : { code: 'PGRST116', message: 'not found' }
                        };
                    }
                };
            },
            upsert(payload, options = {}) {
                state.homepageUpsertPayload = payload;
                state.homepageUpsertOptions = options;
                return {
                    select() {
                        return createThenableResult({
                            data: state.publishedUpsertRows || payload,
                            error: null
                        });
                    }
                };
            }
        };
    }

    function createHomepageDraftTable() {
        return {
            select() {
                return {
                    eq(field, value) {
                        state.draftSelectFilters.push({ field, value });
                        return this;
                    },
                    async maybeSingle() {
                        return {
                            data: state.draftRow,
                            error: state.draftRow ? null : { code: 'PGRST116', message: 'not found' }
                        };
                    },
                    async single() {
                        return {
                            data: state.draftRow,
                            error: state.draftRow ? null : { code: 'PGRST116', message: 'not found' }
                        };
                    }
                };
            },
            upsert(payload, options = {}) {
                state.draftUpsertPayload = payload;
                state.draftUpsertOptions = options;
                return {
                    select() {
                        return {
                            async single() {
                                return {
                                    data: state.draftUpsertRow || payload,
                                    error: null
                                };
                            }
                        };
                    }
                };
            },
            delete() {
                return {
                    async eq(field, value) {
                        state.draftDeleteFilters.push({ field, value });
                        return { error: null };
                    }
                };
            }
        };
    }

    function createHomepageReleaseTable() {
        return {
            select() {
                return {
                    eq(field, value) {
                        state.releaseSelectFilters.push({ field, value });
                        return this;
                    },
                    order() {
                        return this;
                    },
                    limit(value) {
                        state.releaseLimit = value;
                        return this;
                    },
                    then(onFulfilled, onRejected) {
                        return Promise.resolve({
                            data: state.releaseRows,
                            error: null
                        }).then(onFulfilled, onRejected);
                    }
                };
            },
            insert(payload) {
                state.releaseInsertPayload = payload;
                return {
                    select() {
                        return {
                            async single() {
                                return {
                                    data: state.releaseInsertRow || payload,
                                    error: null
                                };
                            }
                        };
                    }
                };
            }
        };
    }

    function createShopCategoriesTable() {
        return {
            select() {
                return {
                    order() {
                        return createThenableResult({
                            data: state.shopCategoryRows,
                            error: null
                        });
                    }
                };
            }
        };
    }

    delete require.cache[handlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../../../../api/_lib/admin') {
            return {
                async requireAdmin(req, config = {}) {
                    state.requireAdminCalls.push({ req, config });
                    return {
                        user: { id: 'admin_homepage_1' },
                        supabase: {
                            from(table) {
                                if (table === 'homepage_config') {
                                    return createHomepageConfigTable();
                                }
                                if (table === 'homepage_site_drafts') {
                                    return createHomepageDraftTable();
                                }
                                if (table === 'homepage_site_releases') {
                                    return createHomepageReleaseTable();
                                }
                                if (table === 'shop_categories') {
                                    return createShopCategoriesTable();
                                }
                                throw new Error(`Unexpected table: ${table}`);
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
                    state.auditCalls.push(entry);
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

test('homepage config handler loads current site rows via admin api', async () => {
    await withHomepageConfigHandler({
        rows: [
            { id: 'hero_cn', site: 'cn', section: 'hero', is_visible: true, display_order: 1, content: {} }
        ]
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'GET',
            headers: {},
            adminSite: 'cn',
            query: {}
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.json().success, true);
        assert.equal(res.json().site, 'cn');
        assert.deepEqual(state.homepageSelectFilters, [{ field: 'site', value: 'cn' }]);
        assert.deepEqual(state.requireAdminCalls[0]?.config, { permission: 'homepage.manage' });
    });
});

test('homepage config handler supports all-site aggregate reads without forcing cn fallback', async () => {
    await withHomepageConfigHandler({
        rows: [
            { id: 'hero_cn', site: 'cn', section: 'hero', is_visible: true, display_order: 1, content: {} },
            { id: 'hero_intl', site: 'intl', section: 'hero', is_visible: false, display_order: 1, content: {} }
        ]
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'GET',
            headers: {},
            adminSite: 'all',
            query: {}
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.json().success, true);
        assert.equal(res.json().site, 'all');
        assert.equal(res.json().read_only, true);
        assert.equal(res.json().mode, 'aggregate');
        assert.deepEqual(state.homepageSelectFilters, []);
        assert.equal(Array.isArray(res.json().rows), true);
        assert.equal(res.json().rows.length, 2);
    });
});

test('homepage config handler rejects all-site writes', async () => {
    await withHomepageConfigHandler({}, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                id: 'hero_cn',
                section: 'hero',
                site: 'all',
                is_visible: true
            }
        }, res);

        assert.equal(res.statusCode, 400);
        assert.match(res.json().message, /Writable admin site must be cn or intl/i);
        assert.equal(state.homepageUpdatePayload, null);
    });
});

test('homepage config handler updates section rows with explicit site and id filters', async () => {
    await withHomepageConfigHandler({
        updateRow: {
            id: 'hero_intl',
            site: 'intl',
            section: 'hero',
            is_visible: false,
            display_order: 3,
            updated_at: '2026-03-31T12:00:00.000Z',
            content: { title: 'Hello' }
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                id: 'hero_intl',
                section: 'hero',
                site: 'intl',
                is_visible: false,
                display_order: 3,
                content: { title: 'Hello' }
            }
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.json().success, true);
        assert.deepEqual(state.homepageUpdatePayload, {
            content: { title: 'Hello', enable_auto: false },
            is_visible: false,
            display_order: 3
        });
        assert.deepEqual(state.homepageUpdateFilters, [
            { field: 'id', value: 'hero_intl' },
            { field: 'site', value: 'intl' },
            { field: 'section', value: 'hero' }
        ]);
        assert.equal(state.auditCalls.length, 1);
        assert.equal(state.auditCalls[0].actionType, 'homepage.config.update');
    });
});

test('homepage config handler saves section drafts and returns merged draft health', async () => {
    await withHomepageConfigHandler({
        rows: [
            {
                id: 'hero_cn',
                site: 'cn',
                section: 'hero',
                is_visible: true,
                display_order: 1,
                updated_at: '2026-04-10T08:00:00.000Z',
                content: { title: 'Old Hero', subtitle: 'Old Subtitle' }
            }
        ]
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            adminSite: 'cn',
            body: {
                action: 'save_draft',
                site: 'cn',
                section: 'hero',
                is_visible: true,
                display_order: 2,
                content: {
                    title: 'Draft Hero',
                    subtitle: 'Draft Subtitle'
                }
            }
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.json().success, true);
        assert.equal(res.json().draft.exists, true);
        assert.equal(res.json().row.section, 'hero');
        assert.equal(res.json().row.content.title, 'Draft Hero');
        assert.equal(res.json().row.display_order, 2);
        assert.equal(res.json().health.status === 'healthy' || res.json().health.status === 'warning', true);
        assert.equal(state.draftUpsertPayload.site, 'cn');
        assert.equal(state.draftUpsertPayload.sections.hero.display_order, 2);
        assert.equal(state.auditCalls.at(-1)?.actionType, 'homepage.draft.save');
    });
});

test('homepage config handler publishes merged draft rows and snapshots a release', async () => {
    await withHomepageConfigHandler({
        rows: [
            {
                id: 'hero_cn',
                site: 'cn',
                section: 'hero',
                is_visible: true,
                display_order: 1,
                updated_at: '2026-04-10T08:00:00.000Z',
                content: { title: 'Published Hero', subtitle: 'Published Subtitle' }
            }
        ],
        draftRow: {
            site: 'cn',
            updated_at: '2026-04-10T09:00:00.000Z',
            updated_by: 'admin_homepage_1',
            sections: {
                hero: {
                    content: { title: 'Draft Hero', subtitle: 'Draft Subtitle' },
                    is_visible: false,
                    display_order: 3
                }
            }
        },
        releaseRows: [
            {
                id: 88,
                site: 'cn',
                source: 'publish',
                note: null,
                payload: { schema_version: 'p0_v1', site: 'cn', sections: {} },
                published_at: '2026-04-10T10:00:00.000Z',
                published_by: 'admin_homepage_1',
                rollback_from_release_id: null
            }
        ],
        releaseInsertRow: {
            id: 89,
            site: 'cn',
            source: 'publish',
            note: null,
            payload: { schema_version: 'p0_v1', site: 'cn', sections: {} },
            published_at: '2026-04-10T10:10:00.000Z',
            published_by: 'admin_homepage_1',
            rollback_from_release_id: null
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            adminSite: 'cn',
            body: {
                action: 'publish',
                site: 'cn'
            }
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.json().success, true);
        assert.equal(Array.isArray(state.homepageUpsertPayload), true);
        assert.ok(state.homepageUpsertPayload.some((row) => row.section === 'hero' && row.content.title === 'Draft Hero'));
        assert.deepEqual(state.homepageUpsertOptions, { onConflict: 'site,section' });
        assert.equal(state.releaseInsertPayload.source, 'publish');
        assert.equal(Object.prototype.hasOwnProperty.call(res.json().release || {}, 'payload'), false);
        assert.equal(Array.isArray(res.json().releases), true);
        assert.equal(Object.prototype.hasOwnProperty.call(res.json().releases[0] || {}, 'payload'), false);
        assert.equal(state.draftDeleteFilters[0]?.value, 'cn');
        assert.equal(state.auditCalls.at(-1)?.actionType, 'homepage.publish');
    });
});

test('homepage config handler rolls back to the previous release snapshot', async () => {
    await withHomepageConfigHandler({
        rows: [
            {
                id: 'hero_cn',
                site: 'cn',
                section: 'hero',
                is_visible: false,
                display_order: 3,
                updated_at: '2026-04-10T10:00:00.000Z',
                content: { title: 'Current Hero', subtitle: 'Current Subtitle' }
            }
        ],
        releaseRows: [
            {
                id: 101,
                site: 'cn',
                source: 'publish',
                note: null,
                payload: {
                    schema_version: 'p0_v1',
                    site: 'cn',
                    sections: {
                        hero: {
                            content: { title: 'Current Hero', subtitle: 'Current Subtitle' },
                            is_visible: false,
                            display_order: 3
                        }
                    }
                },
                published_at: '2026-04-10T10:00:00.000Z',
                published_by: 'admin_homepage_1',
                rollback_from_release_id: null
            },
            {
                id: 99,
                site: 'cn',
                source: 'publish',
                note: null,
                payload: {
                    schema_version: 'p0_v1',
                    site: 'cn',
                    sections: {
                        hero: {
                            content: { title: 'Previous Hero', subtitle: 'Previous Subtitle' },
                            is_visible: true,
                            display_order: 1
                        }
                    }
                },
                published_at: '2026-04-10T09:00:00.000Z',
                published_by: 'admin_homepage_1',
                rollback_from_release_id: null
            }
        ],
        releaseInsertRow: {
            id: 102,
            site: 'cn',
            source: 'rollback',
            note: 'Rollback to release 99',
            payload: { schema_version: 'p0_v1', site: 'cn', sections: {} },
            published_at: '2026-04-10T10:20:00.000Z',
            published_by: 'admin_homepage_1',
            rollback_from_release_id: 99
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            adminSite: 'cn',
            body: {
                action: 'rollback',
                site: 'cn'
            }
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.json().success, true);
        assert.equal(res.json().rolled_back_to.id, 99);
        assert.ok(state.homepageUpsertPayload.some((row) => row.section === 'hero' && row.content.title === 'Previous Hero'));
        assert.equal(state.releaseInsertPayload.source, 'rollback');
        assert.equal(state.releaseInsertPayload.rollback_from_release_id, 99);
        assert.equal(state.auditCalls.at(-1)?.actionType, 'homepage.rollback');
    });
});
