const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const {
    buildTicketCreatedAlert: buildTicketCreatedAlertReal
} = require('../api/_lib/ticket-alerts');

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

async function withSupportHandler({
    adminModule = {},
    requestSecurityModule = {},
    opsAlertsModule = {},
    ticketAlertsModule = {},
    guestSecret = 'test-only-support-ticket-signing-secret-20261107'
}, callback) {
    const handlerPath = path.resolve(__dirname, '../api/support.js');
    const originalLoad = Module._load;
    const previousSecret = process.env.SUPPORT_TICKET_ACCESS_SECRET;
    if (guestSecret === null) delete process.env.SUPPORT_TICKET_ACCESS_SECRET;
    else process.env.SUPPORT_TICKET_ACCESS_SECRET = guestSecret;
    const resolvedAdminModule = {
        async requireAuthenticatedUser() {
            throw Object.assign(new Error('Unauthorized'), { statusCode: 401 });
        },
        getOptionalSupabaseAdmin() {
            return null;
        },
        async parseJsonBody(req) {
            return req.body || {};
        },
        sendJson(res, status, payload) {
            res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify(payload));
        },
        ...adminModule
    };
    const resolvedRequestSecurityModule = {
        applyRateLimitHeaders() {},
        resolveClientIp() {
            return '203.0.113.8';
        },
        async takeRateLimitToken() {
            return {
                allowed: true,
                limit: 30,
                remaining: 29,
                resetAt: Date.now() + 60_000,
                retryAfterSeconds: 0
            };
        },
        ...requestSecurityModule
    };
    const resolvedOpsAlertsModule = {
        async enqueueOpsAlertJob() {
            return { queued: true };
        },
        ...opsAlertsModule
    };
    const resolvedTicketAlertsModule = {
        buildTicketCreatedAlert(ticket = {}) {
            return {
                alertType: 'ticket_new',
                severity: 'warning',
                title: `新售后工单（${String(ticket.id || '').slice(0, 8) || 'unknown'}）`,
                content: '收到新的售后工单，请尽快跟进。',
                payload: {
                    ticket_id: ticket.id || null,
                    user_id: ticket.user_id || null
                },
                dedupeKey: 'ticket-new-dedupe',
                dedupeWindowMinutes: 24 * 60
            };
        },
        ...ticketAlertsModule
    };

    delete require.cache[handlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === './_lib/admin') {
            return resolvedAdminModule;
        }
        if (request === './_lib/request-security') {
            return resolvedRequestSecurityModule;
        }
        if (request === './_lib/ops-alerts') {
            return resolvedOpsAlertsModule;
        }
        if (request === './_lib/ticket-alerts') {
            return resolvedTicketAlertsModule;
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
        if (previousSecret === undefined) delete process.env.SUPPORT_TICKET_ACCESS_SECRET;
        else process.env.SUPPORT_TICKET_ACCESS_SECRET = previousSecret;
    }
}

test('support create_ticket enqueues an external ops alert for the new ticket', async () => {
    const insertedRows = [];
    const enqueuedAlerts = [];
    const selectClauses = [];
    const builtTickets = [];

    await withSupportHandler({
        adminModule: {
            async requireAuthenticatedUser() {
                return {
                    user: {
                        id: 'user-support-1',
                        email: ''
                    },
                    requestSupabase: {
                        from(table) {
                            assert.equal(table, 'shop_tickets');
                            return {
                                insert(payload) {
                                    insertedRows.push(payload);
                                    return {
                                        select(columns) {
                                            selectClauses.push(String(columns || ''));
                                            return {
                                                async single() {
                                                    return {
                                                        data: {
                                                            id: 'ticket-demo-001',
                                                            user_id: payload.user_id,
                                                            order_id: payload.order_id || null,
                                                            issue_type: payload.issue_type,
                                                            status: payload.status,
                                                            description: payload.description,
                                                            created_at: '2026-03-30T12:00:00.000Z',
                                                            updated_at: '2026-03-30T12:00:00.000Z'
                                                        },
                                                        error: null
                                                    };
                                                }
                                            };
                                        }
                                    };
                                }
                            };
                        }
                    },
                    adminSupabase: {
                        from(table) {
                            if (table === 'profiles') {
                                return {
                                    select() {
                                        return {
                                            eq() {
                                                return {
                                                    async single() {
                                                        return {
                                                            data: {
                                                                id: 'user-support-1',
                                                                email: 'profile-member@example.com'
                                                            },
                                                            error: null
                                                        };
                                                    }
                                                };
                                            }
                                        };
                                    }
                                };
                            }
                            throw new Error('enqueueOpsAlertJob should be stubbed');
                        }
                    }
                };
            }
        },
        ticketAlertsModule: {
            buildTicketCreatedAlert(ticket = {}) {
                builtTickets.push(ticket);
                return buildTicketCreatedAlertReal(ticket);
            }
        },
        opsAlertsModule: {
            async enqueueOpsAlertJob(_supabase, input) {
                enqueuedAlerts.push(input);
                return { queued: true };
            }
        }
    }, async (handler) => {
        const req = {
            method: 'POST',
            headers: {},
            body: {
                action: 'create_ticket',
                input: ' 卡密没有到账，请帮忙处理 '
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.payload.ticket_id, 'ticket-demo-001');
        assert.equal(insertedRows.length, 1);
        assert.deepEqual(insertedRows[0], {
            user_id: 'user-support-1',
            site: 'cn',
            issue_type: 'OTHER',
            status: 'PENDING',
            description: '卡密没有到账，请帮忙处理'
        });
        assert.equal(selectClauses.length, 1);
        assert.equal(selectClauses[0].includes('reason'), false);
        assert.equal(builtTickets.length, 1);
        assert.equal(builtTickets[0].user_email, 'profile-member@example.com');
        assert.equal(enqueuedAlerts.length, 1);
        assert.equal(enqueuedAlerts[0].alertType, 'ticket_new');
        assert.equal(enqueuedAlerts[0].source, 'support_ticket');
        assert.match(enqueuedAlerts[0].content, /创建时间：2026-03-30 20:00:00 北京时间/);
        assert.equal(enqueuedAlerts[0].payload.ticket_id, 'ticket-demo-001');
        assert.equal(enqueuedAlerts[0].payload.user_id, 'user-support-1');
        assert.equal(enqueuedAlerts[0].payload.user_email, 'profile-member@example.com');
        assert.equal(enqueuedAlerts[0].payload.site, 'cn');
        assert.equal(enqueuedAlerts[0].createdAt, '2026-03-30T12:00:00.000Z');
    });
});

test('support code_status uses the support-only RPC and returns its sanitized payload', async () => {
    const rpcCalls = [];

    await withSupportHandler({
        adminModule: {
            async requireAuthenticatedUser() {
                return {
                    user: {
                        id: 'user-support-code'
                    },
                    requestSupabase: {
                        from() {
                            throw new Error('code_status should not read request tables');
                        }
                    },
                    adminSupabase: {
                        async rpc(fn, args) {
                            rpcCalls.push({ fn, args });
                            assert.equal(fn, 'fn_check_support_code_status');
                            return {
                                data: {
                                    valid: false,
                                    status: 'revoked',
                                    code: 'ZY-C4B7-9F36-A9F0',
                                    message: '该兑换码已被撤销'
                                },
                                error: null
                            };
                        }
                    }
                };
            }
        }
    }, async (handler) => {
        const req = {
            method: 'POST',
            headers: {},
            body: {
                action: 'code_status',
                input: 'zy-c4b7-9f36-a9f0'
            }
        };
        const res = createMockResponse();

        await handler(req, res);

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.payload.status, 'revoked');
        assert.equal(rpcCalls[0]?.args?.p_code, 'ZY-C4B7-9F36-A9F0');
        assert.equal(Object.prototype.hasOwnProperty.call(payload.payload, 'code'), false);
        assert.equal(Object.prototype.hasOwnProperty.call(payload.payload, 'external_order_id'), false);
        assert.equal(Object.prototype.hasOwnProperty.call(payload.payload, 'used_by'), false);
        assert.equal(Object.prototype.hasOwnProperty.call(payload.payload, 'revoked_by'), false);
        assert.equal(Object.prototype.hasOwnProperty.call(payload.payload, 'batch_id'), false);
        assert.equal(Object.prototype.hasOwnProperty.call(payload.payload, 'batch_name'), false);
    });
});

test('support code_status rejects arbitrary external order numbers before RPC', async () => {
    let rpcCalls = 0;
    await withSupportHandler({
        adminModule: {
            async requireAuthenticatedUser() {
                return {
                    user: { id: 'user-support-code-input' },
                    requestSupabase: { from() { throw new Error('must not query request tables'); } },
                    adminSupabase: {
                        async rpc() {
                            rpcCalls += 1;
                            return { data: null, error: null };
                        }
                    }
                };
            }
        }
    }, async (handler) => {
        const res = createMockResponse();
        await handler({
            method: 'POST',
            headers: {},
            body: { action: 'code_status', input: 'AFD-ORDER-20261006-001' }
        }, res);
        const payload = res.json();
        assert.equal(res.statusCode, 400);
        assert.equal(payload.code, 'code_status_input_invalid');
        assert.equal(rpcCalls, 0);
    });
});

test('support ticket_history returns the current user ticket results and focuses the linked ticket', async () => {
    const tickets = [
        {
            id: 'ticket-history-3',
            user_id: 'user-support-history',
            site: 'cn',
            order_id: 'order-history-3',
            issue_type: 'OTHER',
            status: 'PENDING',
            description: '想补充更多截图',
            admin_notes: '',
            created_at: '2026-03-30T10:00:00.000Z',
            updated_at: '2026-03-30T10:10:00.000Z'
        },
        {
            id: 'ticket-history-2',
            user_id: 'user-support-history',
            site: 'cn',
            order_id: 'order-history-2',
            issue_type: 'DELIVERY',
            status: 'RESOLVED',
            description: '订单未到账',
            admin_notes: '已补发完成',
            created_at: '2026-03-30T09:00:00.000Z',
            updated_at: '2026-03-30T11:00:00.000Z'
        },
        {
            id: 'ticket-history-1',
            user_id: 'user-support-history',
            site: 'cn',
            order_id: '',
            issue_type: 'ACCOUNT',
            status: 'REJECTED',
            description: '账号问题说明',
            admin_notes: '信息不足，请补充订单号',
            created_at: '2026-03-29T09:00:00.000Z',
            updated_at: '2026-03-29T10:00:00.000Z'
        },
        {
            id: 'ticket-history-other-user',
            user_id: 'someone-else',
            site: 'cn',
            order_id: 'order-other',
            issue_type: 'PAYMENT',
            status: 'RESOLVED',
            description: '不应该返回',
            admin_notes: '不应该返回',
            created_at: '2026-03-31T09:00:00.000Z',
            updated_at: '2026-03-31T10:00:00.000Z'
        },
        {
            id: 'ticket-history-intl',
            user_id: 'user-support-history',
            site: 'intl',
            order_id: 'order-intl',
            issue_type: 'PAYMENT',
            status: 'RESOLVED',
            description: '不应该混入 cn 历史',
            admin_notes: '不应该混入 cn 历史',
            created_at: '2026-03-30T12:00:00.000Z',
            updated_at: '2026-03-30T12:00:00.000Z'
        }
    ];

    await withSupportHandler({
        adminModule: {
            async requireAuthenticatedUser() {
                return {
                    user: {
                        id: 'user-support-history'
                    },
                    requestSupabase: {
                        from() {
                            throw new Error('ticket_history should query the admin supabase');
                        }
                    },
                    adminSupabase: {
                        from(table) {
                            assert.equal(table, 'shop_tickets');
                            return {
                                select() {
                                    const filters = {};
                                    const buildRows = () => tickets.filter((row) => {
                                        return Object.entries(filters).every(([field, value]) => String(row?.[field] || '') === String(value || ''));
                                    });
                                    const query = {
                                        eq(field, value) {
                                            filters[field] = value;
                                            return query;
                                        },
                                        order() {
                                            return query;
                                        },
                                        limit(count) {
                                            return Promise.resolve({
                                                data: buildRows().slice(0, count),
                                                error: null
                                            });
                                        },
                                        async maybeSingle() {
                                            const rows = buildRows();
                                            return {
                                                data: rows[0] || null,
                                                error: null
                                            };
                                        }
                                    };
                                    return query;
                                }
                            };
                        }
                    }
                };
            }
        }
    }, async (handler) => {
        const req = {
            method: 'POST',
            headers: {},
            body: {
                action: 'ticket_history',
                site: 'cn',
                input: {
                    ticket_id: 'ticket-history-2'
                }
            }
        };
        const res = createMockResponse();

        await handler(req, res);

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.payload.focus_ticket_id, 'ticket-history-2');
        assert.equal(payload.payload.limit, 6);
        assert.deepEqual(payload.payload.tickets.map((ticket) => ticket.id), [
            'ticket-history-2',
            'ticket-history-3',
            'ticket-history-1'
        ]);
        assert.equal(payload.payload.tickets[0].is_focus, true);
        assert.equal(payload.payload.tickets[0].admin_notes, '已补发完成');
        assert.equal(payload.payload.tickets[0].status, 'RESOLVED');
        assert.equal(payload.payload.tickets[1].is_open, true);
        assert.equal(payload.payload.tickets.some((ticket) => ticket.id === 'ticket-history-other-user'), false);
    });
});

test('chat support code_status stays on the authenticated support endpoint', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../js/components/ChatWidget.js'), 'utf8');

    assert.match(source, /async callSupportApi\(action, input\)/);
    assert.doesNotMatch(source, /callSupportCodeStatusRpcFallback/);
    assert.doesNotMatch(source, /fn_check_support_code_status/);
    assert.doesNotMatch(source, /fn_check_code_status/);
});

test('support create_ticket still succeeds when external alert enqueue fails', async () => {
    await withSupportHandler({
        adminModule: {
            async requireAuthenticatedUser() {
                return {
                    user: {
                        id: 'user-support-2'
                    },
                    requestSupabase: {
                        from() {
                            return {
                                insert(payload) {
                                    return {
                                        select() {
                                            return {
                                                async single() {
                                                    return {
                                                        data: {
                                                            id: 'ticket-demo-002',
                                                            user_id: payload.user_id,
                                                            issue_type: payload.issue_type,
                                                            status: payload.status,
                                                            description: payload.description,
                                                            created_at: '2026-03-30T12:05:00.000Z',
                                                            updated_at: '2026-03-30T12:05:00.000Z'
                                                        },
                                                        error: null
                                                    };
                                                }
                                            };
                                        }
                                    };
                                }
                            };
                        }
                    },
                    adminSupabase: {
                        from(table) {
                            if (table === 'profiles') {
                                return {
                                    select() {
                                        return {
                                            eq() {
                                                return {
                                                    async single() {
                                                        return {
                                                            data: null,
                                                            error: {
                                                                code: 'PGRST116',
                                                                message: '0 rows'
                                                            }
                                                        };
                                                    }
                                                };
                                            }
                                        };
                                    }
                                };
                            }
                            throw new Error('enqueueOpsAlertJob should be stubbed');
                        }
                    }
                };
            }
        },
        opsAlertsModule: {
            async enqueueOpsAlertJob() {
                throw new Error('queue_failed');
            }
        }
    }, async (handler) => {
        const req = {
            method: 'POST',
            headers: {},
            body: {
                action: 'create_ticket',
                input: ' 用户重复反馈未收到卡密 '
            }
        };
        const res = createMockResponse();
        const originalWarn = console.warn;
        const warnings = [];
        console.warn = (...args) => {
            warnings.push(args.join(' '));
        };

        try {
            await handler(req, res);
        } finally {
            console.warn = originalWarn;
        }

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.payload.ticket_id, 'ticket-demo-002');
        assert.equal(warnings.length, 1);
        assert.match(warnings[0], /Failed to enqueue ticket alert/);
    });
});

test('support create_ticket accepts flat body without input wrapper', async () => {
    let capturedRow = null;
    await withSupportHandler({
        adminModule: {
            getOptionalSupabaseAdmin() {
                return {
                    from(table) {
                        if (table === 'shop_tickets') {
                            return {
                                insert(row) {
                                    capturedRow = row;
                                    return {
                                        select() {
                                            return {
                                                async single() {
                                                    return {
                                                        data: { id: 'ticket-flat-001', ticket_no: 888 },
                                                        error: null
                                                    };
                                                }
                                            };
                                        }
                                    };
                                }
                            };
                        }
                        return { select() { return { eq() { return { async single() { return { data: null, error: { code: 'PGRST116' } }; } }; } }; } };
                    }
                };
            }
        },
        opsAlertsModule: {
            async enqueueOpsAlertJob() {
                return { success: true };
            }
        }
    }, async (handler) => {
        const req = {
            method: 'POST',
            headers: {},
            body: {
                action: 'create_ticket',
                order_id: 'GS202611060143452393B54BEB',
                contact_email: 'wangyongchao802@gmail.com',
                issue_type: 'INVALID_KEY',
                description: '请及时处理'
            }
        };
        const res = createMockResponse();
        await handler(req, res);

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.payload.ticket_id, 'ticket-flat-001');
        assert.ok(capturedRow);
        assert.match(capturedRow.description, /请及时处理/);
        assert.match(capturedRow.description, /GS202611060143452393B54BEB/);
    });
});


function ticketDatabase(seed = [], orders = [], options = {}) {
    const rows = seed.map(row => ({ ...row }));
    const queries = [];
    let nextId = 1;
    const db = { from(table) {
        const state = { table, filters: [], operation: 'read', payload: null };
        queries.push(state);
        const matches = row => state.filters.every(([op, key, value]) => op === 'in' ? value.includes(row[key]) : row[key] === value);
        const execute = () => {
            if (options.error) return { data: null, error: options.error };
            const source = table === 'shop_tickets' ? rows : table === 'shop_orders' ? orders : [];
            if (state.operation === 'insert') {
                const row = { id: `guest-ticket-${nextId++}`, user_id: null, ...state.payload };
                rows.push(row);
                return { data: [row], error: null };
            }
            if (state.operation === 'update' && options.beforeUpdate) options.beforeUpdate(rows);
            const found = source.filter(matches);
            if (state.operation === 'update') found.forEach(row => Object.assign(row, state.payload));
            return { data: found.map(row => ({ ...row })), error: null };
        };
        const query = {
            select() { return query; },
            insert(payload) { state.operation = 'insert'; state.payload = payload; return query; },
            update(payload) { state.operation = 'update'; state.payload = payload; return query; },
            eq(key, value) { state.filters.push(['eq', key, value]); return query; },
            is(key, value) { state.filters.push(['is', key, value]); return query; },
            in(key, value) { state.filters.push(['in', key, value]); return query; },
            order() { return query; },
            limit() { return query; },
            async maybeSingle() { const result = execute(); return { ...result, data: result.data?.[0] || null }; },
            async single() { return query.maybeSingle(); },
            then(resolve, reject) { return Promise.resolve(execute()).then(resolve, reject); }
        };
        return query;
    } };
    return { db, rows, queries };
}

async function supportRequest(handler, action, input, { cookie = '', site = 'cn', headers = {} } = {}) {
    const res = createMockResponse();
    await handler({ method: 'POST', headers: { ...(cookie ? { cookie } : {}), ...headers }, body: { action, input, site } }, res);
    return res;
}

function guestCookie(ticketId, site = 'cn') {
    const { grantGuestTicketAccess } = require('../api/_lib/support-ticket-access');
    const res = createMockResponse();
    grantGuestTicketAccess(res, { tickets: [] }, { ticketId, site });
    return res.headers['set-cookie'].split(';')[0];
}

test('guest ticket create, history and reply require a signed HttpOnly credential', async () => {
    const { db, rows, queries } = ticketDatabase();
    let alert;
    await withSupportHandler({ adminModule: { getOptionalSupabaseAdmin: () => db }, opsAlertsModule: {
        async enqueueOpsAlertJob(_db, value) { alert = value; }
    } }, async handler => {
        const created = await supportRequest(handler, 'create_ticket', { description: '未收到内容', contact_email: 'guest@example.com', order_id: 'GS1234' });
        assert.equal(created.statusCode, 200);
        const id = created.json().payload.ticket_id;
        assert.match(created.headers['set-cookie'], /; Path=\/; HttpOnly; Secure; SameSite=Strict;/);
        assert.equal(created.headers['cache-control'], 'private, no-store');
        const cookie = created.headers['set-cookie'].split(';')[0];
        rows[0].status = 'RESOLVED';
        rows.push({ id: 'other-ticket', user_id: null, site: 'cn', description: 'private' });
        const history = await supportRequest(handler, 'ticket_history', { email: '%', order_id: '_' }, { cookie });
        assert.equal(history.statusCode, 200);
        assert.deepEqual(history.json().payload.tickets.map(row => row.id), [id]);
        const reply = await supportRequest(handler, 'reply_ticket', { ticket_id: id, reply: '仍需处理' }, { cookie });
        assert.equal(reply.statusCode, 200);
        assert.equal(rows[0].status, 'PENDING');
        assert.match(rows[0].description, /用户补充.*\n仍需处理/s);
        assert.equal(alert.is_reply, true);
        const update = queries.find(q => q.operation === 'update');
        assert.ok(update.filters.some(f => f[1] === 'site' && f[2] === 'cn'));
        assert.ok(update.filters.some(f => f[1] === 'user_id' && f[2] === null));
    });
});

test('anonymous email, wildcard and ticket IDs cannot read or modify tickets', async () => {
    const { db, queries } = ticketDatabase();
    await withSupportHandler({ adminModule: { getOptionalSupabaseAdmin: () => db } }, async handler => {
        for (const input of [{ email: '%' }, { order_id: '_' }, { ticket_id: 'known-ticket' }]) {
            assert.equal((await supportRequest(handler, 'ticket_history', input)).statusCode, 403);
        }
        assert.equal((await supportRequest(handler, 'reply_ticket', { ticket_id: 'known-ticket', reply: 'attack' })).statusCode, 403);
        assert.equal(queries.length, 0);
    });
});

test('guest credentials reject tampering, cross-site tickets and member-owned tickets', async () => {
    const { db, rows } = ticketDatabase([{ id: 'ticket-1', site: 'cn', user_id: 'member', description: 'private', status: 'RESOLVED' }]);
    await withSupportHandler({ adminModule: { getOptionalSupabaseAdmin: () => db } }, async handler => {
        const cookie = guestCookie('ticket-1');
        assert.equal((await supportRequest(handler, 'ticket_history', { ticket_id: 'ticket-1' }, { cookie, site: 'intl' })).statusCode, 403);
        const forged = cookie.slice(0, -1) + (cookie.endsWith('A') ? 'B' : 'A');
        assert.equal((await supportRequest(handler, 'ticket_history', {}, { cookie: forged })).statusCode, 403);
        assert.equal((await supportRequest(handler, 'reply_ticket', { ticket_id: 'ticket-1', reply: 'attack' }, { cookie })).statusCode, 404);
        assert.equal(rows[0].description, 'private');
    });
});

test('member replies enforce owner and site while preserving legitimate replies', async () => {
    const { db, rows } = ticketDatabase([
        { id: 'own', user_id: 'member', site: 'cn', description: 'mine', status: 'PENDING' },
        { id: 'other', user_id: 'other-member', site: 'cn', description: 'private', status: 'PENDING' },
        { id: 'guest', user_id: null, site: 'cn', description: 'private', status: 'PENDING' },
        { id: 'intl', user_id: 'member', site: 'intl', description: 'private', status: 'PENDING' }
    ]);
    await withSupportHandler({ adminModule: { getOptionalSupabaseAdmin: () => db,
        async requireAuthenticatedUser() { return { user: { id: 'member' }, adminSupabase: db, requestSupabase: db }; }
    } }, async handler => {
        for (const ticket_id of ['other', 'guest', 'intl']) {
            assert.equal((await supportRequest(handler, 'reply_ticket', { ticket_id, reply: 'attack' })).statusCode, 404);
        }
        assert.equal((await supportRequest(handler, 'reply_ticket', { ticket_id: 'own', reply: 'hello' })).statusCode, 200);
        assert.match(rows[0].description, /hello/);
        assert.deepEqual(rows.slice(1).map(row => row.description), ['private', 'private', 'private']);
    });
});

test('ticket auth errors and invalid bearer tokens never fall back to guest privileges', async () => {
    for (const statusCode of [401, 503]) {
        await withSupportHandler({ adminModule: {
            getOptionalSupabaseAdmin: () => ticketDatabase().db,
            async requireAuthenticatedUser() { throw Object.assign(new Error('auth failed'), { statusCode }); }
        } }, async handler => {
            const res = await supportRequest(handler, 'create_ticket', { description: 'test' }, { headers: { authorization: 'Bearer invalid' } });
            assert.equal(res.statusCode, statusCode);
            assert.equal(res.headers['set-cookie'], undefined);
            if (statusCode === 503) assert.equal((await supportRequest(handler, 'create_ticket', { description: 'test' })).statusCode, 503);
        });
    }
});

test('guest ticket creation fails closed before inserting if its independent secret is missing', async () => {
    const { db, rows } = ticketDatabase();
    await withSupportHandler({ guestSecret: null, adminModule: { getOptionalSupabaseAdmin: () => db } }, async handler => {
        const res = await supportRequest(handler, 'create_ticket', { description: 'test' });
        assert.equal(res.statusCode, 503);
        assert.equal(rows.length, 0);
    });
});

test('ticket operations reject foreign origins and cross-site browser requests', async () => {
    const { db, queries } = ticketDatabase();
    await withSupportHandler({ adminModule: { getOptionalSupabaseAdmin: () => db } }, async handler => {
        for (const headers of [{ origin: 'https://evil.example', host: 'www.fatherkey.com' }, { 'sec-fetch-site': 'cross-site' }]) {
            assert.equal((await supportRequest(handler, 'create_ticket', { description: 'test' }, { headers })).statusCode, 403);
        }
        assert.equal(queries.length, 0);
    });
});

test('member order association validates ownership and site; guests cannot attach member orders', async () => {
    const orderId = '01234567-89ab-4cde-8fab-0123456789ab';
    const { db, rows } = ticketDatabase([], [{ id: orderId, user_id: 'other', site: 'cn' }]);
    await withSupportHandler({ adminModule: { getOptionalSupabaseAdmin: () => db } }, async handler => {
        assert.equal((await supportRequest(handler, 'create_ticket', { description: 'test', order_id: orderId })).statusCode, 403);
    });
    await withSupportHandler({ adminModule: { getOptionalSupabaseAdmin: () => db,
        async requireAuthenticatedUser() { return { user: { id: 'member' }, requestSupabase: db, adminSupabase: db }; }
    } }, async handler => {
        assert.equal((await supportRequest(handler, 'create_ticket', { description: 'test', order_id: orderId })).statusCode, 404);
        assert.equal(rows.length, 0);
    });
});

test('missing site schema is an error, never permission to remove the site filter', async () => {
    const { db, queries } = ticketDatabase([], [], { error: { code: '42703', message: 'column site does not exist' } });
    await withSupportHandler({ adminModule: { getOptionalSupabaseAdmin: () => db,
        async requireAuthenticatedUser() { return { user: { id: 'member' }, requestSupabase: db, adminSupabase: db }; }
    } }, async handler => {
        assert.equal((await supportRequest(handler, 'ticket_history', {})).statusCode, 500);
        assert.equal(queries.length, 1);
        assert.ok(queries[0].filters.some(f => f[1] === 'site'));
    });
});

test('concurrent ticket updates return a conflict without overwriting the newer reply', async () => {
    const { db, rows } = ticketDatabase([{ id: 'ticket-1', site: 'cn', user_id: null, description: 'old', status: 'PENDING' }], [], {
        beforeUpdate(list) { list[0].description = 'newer reply'; }
    });
    await withSupportHandler({ adminModule: { getOptionalSupabaseAdmin: () => db } }, async handler => {
        const res = await supportRequest(handler, 'reply_ticket', { ticket_id: 'ticket-1', reply: 'my reply' }, { cookie: guestCookie('ticket-1') });
        assert.equal(res.statusCode, 409);
        assert.equal(rows[0].description, 'newer reply');
    });
});
