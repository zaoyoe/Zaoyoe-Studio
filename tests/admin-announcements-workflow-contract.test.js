const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

function createResponseRecorder() {
    return {
        statusCode: 200,
        headers: {},
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        setHeader(name, value) {
            this.headers[String(name).toLowerCase()] = value;
            return this;
        },
        end(payload) {
            this.body = payload;
            return this;
        }
    };
}

function loadAnnouncementHandlerWithMocks(state) {
    const handlerPath = path.resolve(__dirname, '..', 'server/api-handlers/admin/settings/announcements.js');
    const originalLoad = Module._load;

    delete require.cache[handlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../../../../api/_lib/admin') {
            return {
                normalizeAdminSite(value, options = {}) {
                    const normalized = String(value || '').trim().toLowerCase();
                    if (normalized === 'cn' || normalized === 'intl' || normalized === 'all') {
                        return normalized;
                    }
                    return Object.prototype.hasOwnProperty.call(options, 'defaultValue')
                        ? options.defaultValue
                        : '';
                },
                requireWritableAdminSite(value, options = {}) {
                    const normalized = String(value || '').trim().toLowerCase();
                    if (normalized === 'cn' || normalized === 'intl') {
                        return normalized;
                    }
                    const error = new Error(options.message || 'Writable site is required');
                    error.statusCode = 400;
                    throw error;
                },
                async requireAdmin(req, options = {}) {
                    state.requireAdminCalls.push({ req, options });
                    return {
                        supabase: state.supabase,
                        user: state.user
                    };
                },
                async parseJsonBody(req) {
                    return req.body || {};
                },
                sendJson(res, status, payload) {
                    res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
                    res.end(JSON.stringify(payload));
                    return payload;
                },
                async writeAdminAuditLog(payload) {
                    state.auditLogs.push(payload);
                }
            };
        }
        return originalLoad.call(this, request, parent, isMain);
    };

    try {
        return require(handlerPath);
    } finally {
        Module._load = originalLoad;
        delete require.cache[handlerPath];
    }
}

class AnnouncementQuery {
    constructor(table, state) {
        this.table = table;
        this.state = state;
        this.filters = {};
        this.pendingInsert = null;
        this.pendingUpdate = null;
    }

    select() { return this; }
    order() { return this; }
    limit() { return this; }

    eq(column, value) {
        this.filters[column] = value;
        return this;
    }

    in(column, values) {
        this.filters[column] = values;
        return this;
    }

    insert(payload) {
        this.pendingInsert = payload;
        return this;
    }

    update(payload) {
        this.pendingUpdate = payload;
        return this;
    }

    async maybeSingle() {
        if (this.table === 'announcement_rules' && this.pendingInsert) {
            const row = {
                id: 'rule-created',
                ...this.pendingInsert,
                created_at: '2026-05-01T00:00:00.000Z',
                updated_at: '2026-05-01T00:00:00.000Z'
            };
            this.state.rules.unshift(row);
            return { data: row, error: null };
        }

        if (this.table === 'announcement_rules' && this.pendingUpdate) {
            const row = this.state.rules.find((item) => item.id === this.filters.id);
            Object.assign(row, this.pendingUpdate, { updated_at: '2026-05-01T01:00:00.000Z' });
            return { data: row, error: null };
        }

        return {
            data: this.state.rules.find((item) => Object.entries(this.filters).every(([field, value]) => (
                String(item[field] || '') === String(value || '')
            ))) || null,
            error: null
        };
    }

    async execute() {
        if (this.table === 'announcement_history' && this.pendingInsert) {
            this.state.history.unshift({
                id: `history-${this.state.history.length + 1}`,
                created_at: '2026-05-01T00:00:00.000Z',
                ...this.pendingInsert
            });
            return { data: null, error: null };
        }

        if (this.table === 'announcement_rules') {
            return {
                data: this.state.rules.filter((row) => Object.entries(this.filters).every(([field, value]) => {
                    if (Array.isArray(value)) {
                        return value.includes(row[field]);
                    }
                    return String(row[field] || '') === String(value || '');
                })),
                error: null
            };
        }
        if (this.table === 'announcement_history') {
            const ids = Array.isArray(this.filters.announcement_id) ? this.filters.announcement_id : [];
            return {
                data: this.state.history.filter((row) => ids.includes(row.announcement_id)),
                error: null
            };
        }
        if (this.table === 'announcement_reads') {
            const ids = Array.isArray(this.filters.announcement_id) ? this.filters.announcement_id : [];
            return {
                data: this.state.reads.filter((row) => ids.includes(row.announcement_id)),
                error: null
            };
        }
        return { data: [], error: null };
    }

    then(resolve, reject) {
        return this.execute().then(resolve, reject);
    }
}

function createMockSupabase(state) {
    return {
        from(table) {
            return new AnnouncementQuery(table, state);
        }
    };
}

test('announcement workflow exposes admin API, history, review states, and read statistics', () => {
    const apiAdminSource = readRepoFile('api/admin.js');
    const handlerSource = readRepoFile('server/api-handlers/admin/settings/announcements.js');
    const publicConfigSource = readRepoFile('server/api-handlers/public/config.js');
    const migrationSource = readRepoFile('supabase/migrations/20260501_announcement_rules_workflow_stats.sql');

    assert.equal(
        apiAdminSource.includes("'settings/announcements': settingsAnnouncementsHandler"),
        true,
        'api/admin.js should route announcement workflow requests'
    );
    assert.equal(
        handlerSource.includes("const ANNOUNCEMENT_STATUSES = new Set(['draft', 'pending_review', 'approved', 'rejected', 'archived']);"),
        true,
        'announcement handler should define review workflow states'
    );
    assert.equal(handlerSource.includes('announcement_history'), true, 'announcement handler should write history');
    assert.equal(handlerSource.includes('announcement_reads'), true, 'announcement handler should aggregate reads');
    assert.equal(handlerSource.includes("'submit_review'"), true, 'announcement handler should submit review');
    assert.equal(handlerSource.includes("'approve'"), true, 'announcement handler should approve announcements');
    assert.equal(handlerSource.includes("'reject'"), true, 'announcement handler should reject announcements');
    assert.equal(handlerSource.includes("'archive'"), true, 'announcement handler should archive announcements');
    assert.equal(handlerSource.includes('writeAdminAuditLog'), true, 'announcement handler should write admin audit logs');

    assert.equal(migrationSource.includes('CREATE TABLE IF NOT EXISTS public.announcement_rules'), true);
    assert.equal(migrationSource.includes('CREATE TABLE IF NOT EXISTS public.announcement_history'), true);
    assert.equal(migrationSource.includes('CREATE TABLE IF NOT EXISTS public.announcement_reads'), true);
    assert.equal(
        migrationSource.includes('CONSTRAINT announcement_reads_unique_event UNIQUE (announcement_id, reader_key, page, event_type)'),
        true,
        'read statistics should deduplicate repeated events by reader and page'
    );
    assert.equal(
        readRepoFile('supabase/migrations/20260513_site_scope_announcements.sql').includes('ADD COLUMN IF NOT EXISTS site VARCHAR(16) DEFAULT \'cn\' NOT NULL'),
        true,
        'announcement workflow should add a site column for CN/INTL isolation'
    );
    assert.equal(handlerSource.includes('requireWritableAdminSite'), true, 'announcement writes should require a concrete writable site');
    assert.equal(handlerSource.includes(".eq('site', site)"), true, 'announcement list reads should filter by site');
    assert.equal(publicConfigSource.includes('fetchPublicAnnouncementRules'), true, 'public config should publish approved announcement rules');
    assert.equal(publicConfigSource.includes(".eq('site', normalizedSite)"), true, 'public announcement reads should filter by site');
    assert.equal(publicConfigSource.includes("'announcement-event'"), true, 'public config should accept read events');
});

test('announcement workflow handler creates draft announcements and records history/audit', async () => {
    const state = {
        user: { id: 'admin-1', email: 'admin@example.com' },
        rules: [],
        history: [],
        reads: [],
        auditLogs: [],
        requireAdminCalls: []
    };
    state.supabase = createMockSupabase(state);

    const handler = loadAnnouncementHandlerWithMocks(state);
    const res = createResponseRecorder();

    await handler({
        method: 'POST',
        url: '/api/admin/settings/announcements',
        adminSite: 'cn',
        body: {
            site: 'cn',
            action: 'create',
            announcement: {
                title: '五一商城公告',
                content: '<p>商城活动</p>',
                pages: ['shop'],
                enabled: true,
                priority: 9,
                status: 'draft'
            }
        }
    }, res);

    const payload = JSON.parse(String(res.body || '{}'));

    assert.equal(res.statusCode, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.announcement.id, 'rule-created');
    assert.equal(payload.announcement.site, 'cn');
    assert.equal(payload.announcement.status, 'draft');
    assert.deepEqual(payload.announcement.pages, ['shop']);
    assert.equal(payload.items.length, 1);
    assert.equal(payload.history[0].action, 'create');
    assert.equal(payload.history[0].to_status, 'draft');
    assert.deepEqual(state.requireAdminCalls[0].options, { permission: 'settings.manage' });
    assert.equal(state.auditLogs[0].actionType, 'announcement.create');
});

test('announcement workflow handler filters rules by admin site', async () => {
    const state = {
        user: { id: 'admin-1', email: 'admin@example.com' },
        rules: [
            {
                id: 'rule-cn',
                site: 'cn',
                title: 'CN 公告',
                content: '<p>cn</p>',
                status: 'approved',
                enabled: true,
                pages: ['all']
            },
            {
                id: 'rule-intl',
                site: 'intl',
                title: 'INTL 公告',
                content: '<p>intl</p>',
                status: 'approved',
                enabled: true,
                pages: ['all']
            }
        ],
        history: [],
        reads: [],
        auditLogs: [],
        requireAdminCalls: []
    };
    state.supabase = createMockSupabase(state);

    const handler = loadAnnouncementHandlerWithMocks(state);
    const res = createResponseRecorder();

    await handler({
        method: 'GET',
        url: '/api/admin/settings/announcements?site=intl'
    }, res);

    const payload = JSON.parse(String(res.body || '{}'));

    assert.equal(res.statusCode, 200);
    assert.equal(payload.site, 'intl');
    assert.deepEqual(payload.items.map((item) => item.id), ['rule-intl']);
});
