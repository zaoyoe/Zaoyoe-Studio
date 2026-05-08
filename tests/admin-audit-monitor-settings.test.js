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
        }
    };
}

function createState(overrides = {}) {
    return {
        user: { id: 'admin-user-1', email: 'admin@example.com' },
        auditLogs: [],
        opsAlertJobs: [],
        opsAlertCases: [],
        opsAlertCaseEvents: [],
        ...overrides
    };
}

function createSupabaseStub(state) {
    const tableMap = {
        admin_audit_logs_view: 'auditLogs',
        ops_alert_jobs: 'opsAlertJobs',
        ops_alert_cases: 'opsAlertCases',
        ops_alert_case_events: 'opsAlertCaseEvents'
    };

    return {
        from(table) {
            const stateKey = tableMap[table];
            if (!stateKey) {
                throw new Error(`Unexpected table access: ${table}`);
            }

            const queryState = {
                filters: [],
                order: null,
                limit: null
            };

            function executeRange(from = 0, to = Number.MAX_SAFE_INTEGER) {
                let rows = (state[stateKey] || []).slice();
                rows = rows.filter((row) => queryState.filters.every((filter) => {
                    if (filter.op === 'eq') {
                        return row[filter.column] === filter.value;
                    }
                    if (filter.op === 'gte') {
                        return new Date(row[filter.column]).getTime() >= new Date(filter.value).getTime();
                    }
                    if (filter.op === 'in') {
                        return filter.values.includes(row[filter.column]);
                    }
                    return true;
                }));

                if (queryState.order?.column) {
                    const { column, ascending } = queryState.order;
                    rows.sort((left, right) => {
                        const leftValue = new Date(left[column]).getTime();
                        const rightValue = new Date(right[column]).getTime();
                        return ascending ? leftValue - rightValue : rightValue - leftValue;
                    });
                }

                return {
                    data: rows.slice(from, to + 1),
                    error: null
                };
            }

            const query = {
                select() {
                    return query;
                },
                eq(column, value) {
                    queryState.filters.push({ op: 'eq', column, value });
                    return query;
                },
                gte(column, value) {
                    queryState.filters.push({ op: 'gte', column, value });
                    return query;
                },
                in(column, values) {
                    queryState.filters.push({
                        op: 'in',
                        column,
                        values: Array.isArray(values) ? values : []
                    });
                    return query;
                },
                order(column, options = {}) {
                    queryState.order = {
                        column,
                        ascending: options.ascending !== false
                    };
                    return query;
                },
                async range(from, to) {
                    return executeRange(from, to);
                },
                async limit(limitValue) {
                    return executeRange(0, limitValue - 1);
                }
            };

            return query;
        }
    };
}

function createAdminModule(state) {
    return {
        async requireAdmin() {
            return {
                supabase: createSupabaseStub(state),
                user: state.user
            };
        },
        normalizeAdminSite(value, options = {}) {
            const rawValue = Array.isArray(value) ? value[0] : value;
            const normalized = String(rawValue || '').trim().toLowerCase();
            const fallback = Object.prototype.hasOwnProperty.call(options, 'defaultValue')
                ? String(options.defaultValue || '').trim().toLowerCase()
                : '';
            if (!normalized) return fallback;
            if (normalized === 'global') return 'all';
            if (['all', 'cn', 'intl'].includes(normalized)) return normalized;
            return fallback;
        },
        sendJson(res, status, payload) {
            res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify(payload));
        }
    };
}

async function withHandler(stateOverrides, callback) {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/settings/admin-audit-monitor.js');
    const originalLoad = Module._load;
    const state = createState(stateOverrides);

    delete require.cache[handlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../../../../api/_lib/admin') {
            return createAdminModule(state);
        }
        return originalLoad(request, parent, isMain);
    };

    try {
        const handler = require(handlerPath);
        await callback(handler, state);
    } finally {
        Module._load = originalLoad;
        delete require.cache[handlerPath];
    }
}

function minutesAgo(minutes) {
    return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

function buildAuditRow(actionType, overrides = {}) {
    return {
        id: overrides.id || `${actionType}-1`,
        action_type: actionType,
        admin_id: overrides.admin_id || 'admin-user-1',
        admin_email: overrides.admin_email || 'admin@example.com',
        created_at: overrides.created_at || minutesAgo(5),
        details: overrides.details || {}
    };
}

function buildAuditAlertJob(alertType, overrides = {}) {
    return {
        id: overrides.id || `${alertType}-1`,
        alert_type: alertType,
        severity: overrides.severity || 'warning',
        title: overrides.title || '审计告警',
        content: overrides.content || '审计告警\n需要进一步处理',
        payload: overrides.payload || {},
        created_at: overrides.created_at || minutesAgo(3)
    };
}

test('admin audit monitor handler returns recent access rows, anomaly signals, and payment config audit rows', async () => {
    await withHandler({
        auditLogs: [
            buildAuditRow('admin.access.session.issue', {
                id: 'access-older',
                created_at: minutesAgo(180),
                details: {
                    client_ip: '203.0.113.8',
                    user_agent: 'Chrome / baseline',
                    origin: 'https://www.zaoyoe.com'
                }
            }),
            buildAuditRow('admin.access.session.issue', {
                id: 'access-recent-a',
                created_at: minutesAgo(8),
                details: {
                    client_ip: '198.51.100.20',
                    user_agent: 'Chrome / desktop',
                    origin: 'https://www.zaoyoe.com',
                    referer: 'https://www.zaoyoe.com/admin-entry.html',
                    granted: true
                }
            }),
            buildAuditRow('admin.access.session.issue', {
                id: 'access-recent-b',
                created_at: minutesAgo(2),
                details: {
                    client_ip: '198.51.100.21',
                    user_agent: 'Safari / laptop',
                    origin: 'https://www.zaoyoe.com',
                    granted: true
                }
            }),
            buildAuditRow('admin.payment_channels.upsert', {
                id: 'config-upsert',
                created_at: minutesAgo(6),
                admin_email: 'ops@example.com',
                details: {
                    active_provider: 'mock',
                    updated_providers: ['mock', 'hupijiao'],
                    updated_secrets: ['hupijiao_secret_key']
                }
            }),
            buildAuditRow('admin.payment_channels.secret.delete', {
                id: 'config-delete',
                created_at: minutesAgo(4),
                admin_email: 'owner@example.com',
                details: {
                    secret_name: 'hupijiao_secret_key'
                }
            })
        ],
        opsAlertJobs: [
            buildAuditAlertJob('security_admin_login_anomaly', {
                id: 'audit-alert-security',
                severity: 'critical',
                title: '管理员异常登录（admin@example.com）',
                content: '管理员异常登录\n登录 IP：198.51.100.21',
                payload: {
                    target_id: 'admin-user-1',
                    admin_id: 'admin-user-1',
                    admin_email: 'admin@example.com',
                    client_ip: '198.51.100.21',
                    detected_reasons: ['最近窗口内出现 2 个登录 IP']
                },
                created_at: minutesAgo(2)
            }),
            buildAuditAlertJob('payment_config_incident_recovered', {
                id: 'audit-alert-payment-recovered',
                severity: 'warning',
                title: '支付配置事故已恢复',
                content: '支付配置事故恢复\n恢复通道：虎皮椒',
                payload: {
                    target_id: 'payment_config_incident:global',
                    admin_email: 'ops@example.com',
                    action_label: '支付通道配置更新',
                    active_provider_label: '虎皮椒'
                },
                created_at: minutesAgo(1)
            })
        ],
        opsAlertCases: [
            {
                category_key: 'payments',
                target_id: 'payment_config_incident:global',
                alert_type: 'payment_config_incident',
                status: 'claimed',
                owner_admin_id: 'admin-user-1',
                owner_label: 'admin@example.com',
                note: '继续观察恢复后是否再次切到 mock。',
                resolution: null,
                metadata: {},
                last_action: 'noted',
                last_action_at: minutesAgo(0.8),
                updated_at: minutesAgo(0.8)
            }
        ],
        opsAlertCaseEvents: [
            {
                id: 'audit-event-1',
                category_key: 'payments',
                target_id: 'payment_config_incident:global',
                alert_type: 'payment_config_incident',
                action: 'add_note',
                status: 'claimed',
                owner_admin_id: 'admin-user-1',
                owner_label: 'admin@example.com',
                actor_admin_id: 'admin-user-1',
                actor_label: 'admin@example.com',
                note: '继续观察恢复后是否再次切到 mock。',
                resolution: null,
                metadata: {},
                created_at: minutesAgo(0.8)
            }
        ]
    }, async (handler) => {
        const req = { method: 'GET', headers: {} };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.access_summary.access_count, 3);
        assert.equal(payload.access_summary.distinct_ip_count, 3);
        assert.equal(Array.isArray(payload.recent_accesses), true);
        assert.equal(payload.recent_accesses[0].id, 'access-recent-b');
        assert.equal(payload.access_anomalies.length > 0, true);
        assert.equal(payload.config_summary.config_change_count, 2);
        assert.equal(payload.config_summary.secret_delete_count, 1);
        assert.equal(payload.config_summary.mock_switch_count, 1);
        assert.equal(payload.facts.access_sample_count, 3);
        assert.equal(payload.facts.config_sample_count, 2);
        assert.equal(payload.facts.issued_access_count, 2);
        assert.equal(Array.isArray(payload.facts.top_access_admins), true);
        assert.equal(Array.isArray(payload.facts.anomaly_reason_breakdown), true);
        assert.equal(payload.payment_config_events[0].id, 'config-delete');
        assert.equal(payload.payment_config_events[1].id, 'config-upsert');
        assert.equal(payload.recent_access_pagination.page, 1);
        assert.equal(payload.recent_access_pagination.total_items, 3);
        assert.equal(payload.anomaly_pagination.page, 1);
        assert.equal(payload.config_event_pagination.total_items, 2);
        assert.equal(payload.alert_summary.visible_count, 2);
        assert.equal(payload.alert_summary.active_problem_count, 1);
        assert.equal(payload.alert_summary.claimed_count, 1);
        assert.equal(payload.alert_items[0].category_key, 'security');
        assert.equal(payload.alert_items[0].target_id, 'admin-user-1');
        assert.equal(payload.alert_items[1].category_key, 'payments');
        assert.equal(payload.alert_items[1].case_status, 'claimed');
        assert.equal(payload.alert_items[1].case_recent_events[0].action, 'add_note');
    });
});

test('admin audit monitor handler filters payment config rows and payment workspace alerts by site context', async () => {
    await withHandler({
        auditLogs: [
            buildAuditRow('admin.payment_channels.upsert', {
                id: 'config-cn',
                created_at: minutesAgo(9),
                admin_email: 'cn@example.com',
                details: {
                    site: 'cn',
                    active_provider: 'mock',
                    updated_providers: ['mock']
                }
            }),
            buildAuditRow('admin.payment_channels.secret.delete', {
                id: 'config-intl',
                created_at: minutesAgo(4),
                admin_email: 'intl@example.com',
                details: {
                    site: 'intl',
                    secret_name: 'hupijiao_secret_key'
                }
            })
        ],
        opsAlertJobs: [
            buildAuditAlertJob('security_admin_login_anomaly', {
                id: 'audit-security-global',
                severity: 'critical',
                title: '管理员异常登录（global@example.com）',
                content: '管理员异常登录\n登录 IP：198.51.100.40',
                payload: {
                    target_id: 'admin-user-global',
                    admin_id: 'admin-user-global',
                    admin_email: 'global@example.com',
                    client_ip: '198.51.100.40',
                    detected_reasons: ['最近窗口内出现 2 个登录 IP']
                },
                created_at: minutesAgo(2)
            }),
            buildAuditAlertJob('payment_config_incident_recovered', {
                id: 'audit-payment-cn',
                severity: 'warning',
                title: '支付配置事故已恢复（CN）',
                content: '支付配置事故恢复\n站点：CN',
                payload: {
                    site: 'cn',
                    target_id: 'payment_config_incident:cn',
                    admin_email: 'cn@example.com',
                    action_label: '支付通道配置更新'
                },
                created_at: minutesAgo(1.5)
            }),
            buildAuditAlertJob('payment_config_incident_recovered', {
                id: 'audit-payment-intl',
                severity: 'warning',
                title: '支付配置事故已恢复（INTL）',
                content: '支付配置事故恢复\n站点：INTL',
                payload: {
                    site: 'intl',
                    target_id: 'payment_config_incident:intl',
                    admin_email: 'intl@example.com',
                    action_label: '支付通道配置更新'
                },
                created_at: minutesAgo(1)
            })
        ],
        opsAlertCases: [
            {
                category_key: 'payments',
                target_id: 'payment_config_incident:intl',
                alert_type: 'payment_config_incident',
                status: 'claimed',
                owner_admin_id: 'admin-user-1',
                owner_label: 'admin@example.com',
                note: 'INTL 继续观察',
                resolution: null,
                metadata: {},
                last_action: 'noted',
                last_action_at: minutesAgo(0.8),
                updated_at: minutesAgo(0.8)
            }
        ],
        opsAlertCaseEvents: [
            {
                id: 'audit-event-intl-1',
                category_key: 'payments',
                target_id: 'payment_config_incident:intl',
                alert_type: 'payment_config_incident',
                action: 'add_note',
                status: 'claimed',
                owner_admin_id: 'admin-user-1',
                owner_label: 'admin@example.com',
                actor_admin_id: 'admin-user-1',
                actor_label: 'admin@example.com',
                note: 'INTL 继续观察',
                resolution: null,
                metadata: {},
                created_at: minutesAgo(0.8)
            }
        ]
    }, async (handler) => {
        const req = {
            method: 'GET',
            headers: {},
            url: '/api/admin/settings/admin-audit-monitor?site=intl'
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.site_context, 'intl');
        assert.equal(payload.config_summary.config_change_count, 1);
        assert.equal(payload.payment_config_events.length, 1);
        assert.equal(payload.payment_config_events[0].id, 'config-intl');
        assert.equal(payload.payment_config_events[0].site, 'intl');
        assert.equal(payload.alert_summary.visible_count, 2);
        assert.equal(payload.alert_items[0].category_key, 'security');
        assert.equal(payload.alert_items[1].category_key, 'payments');
        assert.equal(payload.alert_items[1].target_id, 'payment_config_incident:intl');
        assert.equal(payload.alert_items[1].site, 'intl');
        assert.equal(payload.alert_items[1].case_recent_events[0].action, 'add_note');
    });
});

test('admin audit monitor handler paginates access, anomaly, and config lists from query params', async () => {
    await withHandler({
        auditLogs: [
            buildAuditRow('admin.access.session.issue', {
                id: 'access-1',
                created_at: minutesAgo(25),
                details: {
                    client_ip: '198.51.100.11',
                    user_agent: 'Chrome / 1',
                    origin: 'https://www.zaoyoe.com'
                }
            }),
            buildAuditRow('admin.access.session.issue', {
                id: 'access-2',
                created_at: minutesAgo(20),
                details: {
                    client_ip: '198.51.100.12',
                    user_agent: 'Chrome / 2',
                    origin: 'https://www.zaoyoe.com'
                }
            }),
            buildAuditRow('admin.access.session.issue', {
                id: 'access-3',
                created_at: minutesAgo(15),
                details: {
                    client_ip: '198.51.100.13',
                    user_agent: 'Chrome / 3',
                    origin: 'https://www.zaoyoe.com'
                }
            }),
            buildAuditRow('admin.access.session.issue', {
                id: 'access-4',
                created_at: minutesAgo(10),
                details: {
                    client_ip: '198.51.100.14',
                    user_agent: 'Chrome / 4',
                    origin: 'https://www.zaoyoe.com'
                }
            }),
            buildAuditRow('admin.access.session.issue', {
                id: 'access-5',
                created_at: minutesAgo(5),
                details: {
                    client_ip: '198.51.100.15',
                    user_agent: 'Chrome / 5',
                    origin: 'https://www.zaoyoe.com'
                }
            }),
            buildAuditRow('admin.payment_channels.upsert', {
                id: 'config-1',
                created_at: minutesAgo(9),
                admin_email: 'ops@example.com',
                details: {
                    active_provider: 'mock',
                    updated_providers: ['mock', 'hupijiao'],
                    updated_secrets: ['hupijiao_secret_key']
                }
            }),
            buildAuditRow('admin.payment_channels.secret.delete', {
                id: 'config-2',
                created_at: minutesAgo(7),
                admin_email: 'ops@example.com',
                details: {
                    secret_name: 'hupijiao_secret_key'
                }
            }),
            buildAuditRow('admin.payment_channels.upsert', {
                id: 'config-3',
                created_at: minutesAgo(4),
                admin_email: 'owner@example.com',
                details: {
                    active_provider: 'hupijiao',
                    updated_providers: ['hupijiao']
                }
            })
        ]
    }, async (handler) => {
        const req = {
            method: 'GET',
            headers: {},
            url: '/api/admin/settings/admin-audit-monitor?accessPage=2&accessPageSize=2&anomalyPage=2&anomalyPageSize=2&configPage=2&configPageSize=1'
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.deepEqual(payload.recent_accesses.map((row) => row.id), ['access-3', 'access-2']);
        assert.equal(payload.recent_access_pagination.page, 2);
        assert.equal(payload.recent_access_pagination.page_size, 2);
        assert.equal(payload.recent_access_pagination.total_items, 5);
        assert.equal(payload.recent_access_pagination.returned_items, 2);
        assert.equal(payload.anomaly_pagination.page, 2);
        assert.equal(payload.anomaly_pagination.page_size, 2);
        assert.equal(payload.anomaly_pagination.total_items >= 4, true);
        assert.equal(payload.anomaly_pagination.returned_items, 2);
        assert.equal(payload.config_event_pagination.page, 2);
        assert.equal(payload.config_event_pagination.page_size, 1);
        assert.equal(payload.config_event_pagination.total_items, 3);
        assert.equal(payload.payment_config_events.length, 1);
        assert.equal(payload.payment_config_events[0].id, 'config-2');
    });
});

test('admin audit monitor handler excludes resolved problem alerts from actionable summary counts', async () => {
    await withHandler({
        opsAlertJobs: [
            buildAuditAlertJob('security_admin_login_anomaly', {
                id: 'audit-alert-resolved-security',
                severity: 'critical',
                title: '管理员异常登录（resolved@example.com）',
                content: '管理员异常登录\n登录 IP：203.0.113.17',
                payload: {
                    target_id: 'admin-user-resolved',
                    admin_id: 'admin-user-resolved',
                    admin_email: 'resolved@example.com',
                    client_ip: '203.0.113.17',
                    detected_reasons: ['最近窗口内出现 2 个登录设备指纹']
                },
                created_at: minutesAgo(3)
            })
        ],
        opsAlertCases: [
            {
                category_key: 'security',
                target_id: 'admin-user-resolved',
                alert_type: 'security_admin_login_anomaly',
                status: 'resolved',
                owner_admin_id: 'admin-user-1',
                owner_label: 'admin@example.com',
                note: '已完成复核。',
                resolution: '确认本人操作，无需继续跟进。',
                metadata: {},
                last_action: 'resolved',
                last_action_at: minutesAgo(2),
                updated_at: minutesAgo(2)
            }
        ]
    }, async (handler) => {
        const req = { method: 'GET', headers: {} };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.alert_summary.visible_count, 1);
        assert.equal(payload.alert_summary.active_problem_count, 0);
        assert.equal(payload.alert_summary.claimed_count, 0);
        assert.equal(payload.alert_items[0].case_status, 'resolved');
    });
});

test('admin audit monitor handler rejects non-GET methods', async () => {
    await withHandler({}, async (handler) => {
        const req = { method: 'POST', headers: {} };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 405);
        assert.equal(payload.success, false);
        assert.equal(payload.message, 'Method not allowed');
    });
});
