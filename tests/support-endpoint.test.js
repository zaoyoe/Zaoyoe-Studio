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

async function withSupportHandler({
    adminModule = {},
    requestSecurityModule = {},
    opsAlertsModule = {},
    ticketAlertsModule = {}
}, callback) {
    const handlerPath = path.resolve(__dirname, '../api/support.js');
    const originalLoad = Module._load;
    const resolvedAdminModule = {
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
                return {
                    alertType: 'ticket_new',
                    severity: 'warning',
                    title: `新售后工单（${String(ticket.id || '').slice(0, 8) || 'unknown'}）`,
                    content: '收到新的售后工单，请尽快跟进。',
                    payload: {
                        ticket_id: ticket.id || null,
                        user_id: ticket.user_id || null,
                        user_email: ticket.user_email || null
                    },
                    dedupeKey: 'ticket-new-dedupe',
                    dedupeWindowMinutes: 24 * 60
                };
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
        assert.equal(enqueuedAlerts[0].payload.ticket_id, 'ticket-demo-001');
        assert.equal(enqueuedAlerts[0].payload.user_id, 'user-support-1');
        assert.equal(enqueuedAlerts[0].payload.user_email, 'profile-member@example.com');
        assert.equal(enqueuedAlerts[0].createdAt, '2026-03-30T12:00:00.000Z');
    });
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
