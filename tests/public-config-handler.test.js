const test = require('node:test');
const assert = require('node:assert/strict');

const { createPublicConfigHandlers } = require('../server/api-handlers/public/config');

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
            this.headers[name.toLowerCase()] = value;
            return this;
        },
        end(payload) {
            this.body = payload;
            return this;
        }
    };
}

test('public notifications config handler returns sanitized announcement config for public pages', async () => {
    const handlers = createPublicConfigHandlers({
        admin: {
            getOptionalSupabaseAdmin() {
                return {
                    from(table) {
                        if (table === 'announcement_rules') {
                            return {
                                select() { return this; },
                                eq() { return this; },
                                order() { return this; },
                                async limit() {
                                    return {
                                        data: [{
                                            id: 'rule-1',
                                            title: '商城公告',
                                            enabled: true,
                                            status: 'approved',
                                            content: '<p>shop rule</p>',
                                            type: 'toast',
                                            color: 'blue',
                                            size: 'medium',
                                            decoration: 'snow',
                                            pages: ['shop'],
                                            page_overrides: {
                                                verify: {
                                                    content: '<p>verify rule</p>',
                                                    updated_at: '2026-04-12T01:23:45.000Z'
                                                }
                                            },
                                            priority: 8,
                                            starts_at: '2026-01-01T00:00:00.000Z',
                                            ends_at: '2027-01-01T00:00:00.000Z',
                                            updated_at: '2026-04-12T01:23:45.000Z'
                                        }],
                                        error: null
                                    };
                                }
                            };
                        }
                        assert.equal(table, 'system_config');
                        return {
                            select() { return this; },
                            eq() { return this; },
                            async maybeSingle() {
                                return {
                                    data: {
                                        config_value: {
                                            announcement_enabled: true,
                                            announcement_content: '<a href="https://zaoyoe.com">zaoyoe</a>',
                                            announcement_type: 'modal',
                                            announcement_color: 'blue',
                                            announcement_size: 'medium',
                                            announcement_decoration: 'fireworks',
                                            announcement_pages: ['homepage', 'guestbook'],
                                            announcement_page_overrides: {
                                                shop: {
                                                    content: '<p>shop only</p>',
                                                    updated_at: '2026-04-11T01:23:45.000Z'
                                                }
                                            },
                                            announcement_updated_at: '2026-04-10T01:23:45.000Z'
                                        }
                                    },
                                    error: null
                                };
                            }
                        };
                    }
                };
            },
            sendJson(res, status, payload) {
                res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify(payload));
                return payload;
            }
        }
    });

    const res = createResponseRecorder();
    await handlers.notifications({ method: 'GET' }, res);
    const payload = JSON.parse(String(res.body || '{}'));

    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.equal(payload.success, true);
    assert.equal(payload.site, 'cn');
    assert.deepEqual(payload.config.announcement_pages, ['index', 'guestbook']);
    assert.equal(payload.config.announcement_enabled, true);
    assert.equal(payload.config.announcement_type, 'modal');
    assert.equal(payload.config.announcement_theme, 'auto');
    assert.equal(payload.config.announcement_content, '<a href="https://zaoyoe.com">zaoyoe</a>');
    assert.deepEqual(payload.config.announcement_page_overrides, {
        shop: {
            enabled: true,
            content: '<p>shop only</p>',
            updated_at: '2026-04-11T01:23:45.000Z'
        }
    });
    assert.deepEqual(payload.config.announcement_rules, [{
        id: 'rule-1',
        title: '商城公告',
        site: 'cn',
        announcement_enabled: true,
        announcement_content: '<p>shop rule</p>',
        announcement_type: 'toast',
        announcement_color: 'blue',
        announcement_size: 'medium',
        announcement_decoration: 'snow',
        announcement_theme: 'auto',
        announcement_pages: ['shop'],
        announcement_page_overrides: {
            verify: {
                enabled: true,
                content: '<p>verify rule</p>',
                updated_at: '2026-04-12T01:23:45.000Z'
            }
        },
        priority: 8,
        status: 'approved',
        starts_at: '2026-01-01T00:00:00.000Z',
        ends_at: '2027-01-01T00:00:00.000Z',
        announcement_updated_at: '2026-04-12T01:23:45.000Z'
    }]);
});

test('public announcement event handler records read statistics without requiring auth', async () => {
    let capturedPayload = null;
    const handlers = createPublicConfigHandlers({
        admin: {
            getOptionalSupabaseAdmin() {
                return {
                    from(table) {
                        assert.equal(table, 'announcement_reads');
                        return {
                            async upsert(payload, options) {
                                capturedPayload = { payload, options };
                                return { error: null };
                            }
                        };
                    }
                };
            },
            async parseJsonBody() {
                return {
                    announcement_id: 'rule-1',
                    reader_key: 'reader-1',
                    page: 'homepage',
                    event_type: 'read',
                    ack_key: 'ack-1'
                };
            },
            sendJson(res, status, payload) {
                res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify(payload));
                return payload;
            }
        }
    });

    const res = createResponseRecorder();
    await handlers['announcement-event']({
        method: 'POST',
        headers: {
            'user-agent': 'node-test'
        }
    }, res);
    const payload = JSON.parse(String(res.body || '{}'));

    assert.equal(res.statusCode, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.recorded, true);
    assert.deepEqual(capturedPayload, {
        payload: {
            announcement_id: 'rule-1',
            reader_key: 'reader-1',
            page: 'index',
            event_type: 'read',
            ack_key: 'ack-1',
            user_agent: 'node-test',
            metadata: {
                site: 'cn'
            }
        },
        options: {
            onConflict: 'announcement_id,reader_key,page,event_type',
            ignoreDuplicates: true
        }
    });
});

test('public notifications config handler resolves site-scoped config and rules', async () => {
    const rules = [
        {
            id: 'rule-cn',
            site: 'cn',
            title: 'CN 公告',
            enabled: true,
            status: 'approved',
            content: '<p>cn</p>',
            pages: ['all'],
            updated_at: '2026-04-12T01:23:45.000Z'
        },
        {
            id: 'rule-intl',
            site: 'intl',
            title: 'INTL Notice',
            enabled: true,
            status: 'approved',
            content: '<p>intl</p>',
            pages: ['all'],
            updated_at: '2026-04-12T01:23:45.000Z'
        }
    ];
    const handlers = createPublicConfigHandlers({
        admin: {
            getOptionalSupabaseAdmin() {
                return {
                    from(table) {
                        if (table === 'announcement_rules') {
                            const filters = {};
                            return {
                                select() { return this; },
                                eq(field, value) {
                                    filters[field] = value;
                                    return this;
                                },
                                order() { return this; },
                                async limit() {
                                    return {
                                        data: rules.filter((row) => Object.entries(filters).every(([field, value]) => (
                                            String(row[field]) === String(value)
                                        ))),
                                        error: null
                                    };
                                }
                            };
                        }
                        assert.equal(table, 'system_config');
                        return {
                            select() { return this; },
                            eq() { return this; },
                            async maybeSingle() {
                                return {
                                    data: {
                                        config_value: {
                                            __site_scoped: true,
                                            default: {
                                                announcement_enabled: true,
                                                announcement_content: '<p>cn fallback</p>',
                                                announcement_pages: ['all']
                                            },
                                            sites: {
                                                intl: {
                                                    announcement_enabled: true,
                                                    announcement_content: '<p>intl config</p>',
                                                    announcement_pages: ['all']
                                                }
                                            }
                                        }
                                    },
                                    error: null
                                };
                            }
                        };
                    }
                };
            },
            sendJson(res, status, payload) {
                res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify(payload));
                return payload;
            }
        }
    });

    const res = createResponseRecorder();
    await handlers.notifications({
        method: 'GET',
        url: '/api/public?scope=config&route=notifications&site=intl',
        headers: {
            host: 'localhost:3000'
        }
    }, res);
    const payload = JSON.parse(String(res.body || '{}'));

    assert.equal(res.statusCode, 200);
    assert.equal(payload.site, 'intl');
    assert.equal(payload.config.announcement_content, '<p>intl config</p>');
    assert.deepEqual(payload.config.announcement_rules.map((rule) => rule.id), ['rule-intl']);
});

test('public notifications config handler rejects unsupported methods', async () => {
    const handlers = createPublicConfigHandlers({
        admin: {
            getOptionalSupabaseAdmin() {
                return {};
            },
            sendJson(res, status, payload) {
                res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify(payload));
                return payload;
            }
        }
    });

    const res = createResponseRecorder();
    await handlers.notifications({ method: 'POST' }, res);
    const payload = JSON.parse(String(res.body || '{}'));

    assert.equal(res.statusCode, 405);
    assert.equal(payload.success, false);
});

test('public verify quota handler returns remaining uses and derived task counts for authenticated users', async () => {
    const originalFetch = global.fetch;
    global.fetch = async (input, init = {}) => {
        assert.equal(String(input), 'https://aidone.lol/openapi');
        assert.equal(init.method, 'POST');
        assert.deepEqual(JSON.parse(init.body), {
            action: 'get_balance',
            cdkey: 'SYS-38147DAAF78A'
        });

        return new Response(JSON.stringify({
            success: true,
            remaining_uses: 0.5,
            total_used: 12
        }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json'
            }
        });
    };

    try {
        const handlers = createPublicConfigHandlers({
            admin: {
                async requireAuthenticatedUser() {
                    return {
                        user: {
                            id: 'user-1'
                        }
                    };
                },
                getOptionalSupabaseAdmin() {
                    return {
                        from(table) {
                            assert.equal(table, 'system_config');
                            return {
                                select() { return this; },
                                eq() { return this; },
                                async maybeSingle() {
                                    return {
                                        data: {
                                            config_value: {
                                                enabled: true,
                                                verify_cdkey: 'SYS-38147DAAF78A',
                                                verify_api_base_url: 'https://aidone.lol'
                                            }
                                        },
                                        error: null
                                    };
                                }
                            };
                        }
                    };
                },
                sendJson(res, status, payload) {
                    res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
                    res.end(JSON.stringify(payload));
                    return payload;
                }
            }
        });

        const res = createResponseRecorder();
        await handlers['verify-quota']({
            method: 'GET',
            headers: {
                authorization: 'Bearer member-token'
            }
        }, res);
        const payload = JSON.parse(String(res.body || '{}'));

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.remaining_uses, 0.5);
        assert.equal(payload.remaining_extract_jobs, 1);
        assert.equal(payload.remaining_full_jobs, 0);
    } finally {
        global.fetch = originalFetch;
    }
});

test('public verify settings handler resolves site price without exposing CDKeys', async () => {
    const handlers = createPublicConfigHandlers({
        admin: {
            getOptionalSupabaseAdmin() {
                return {
                    from(table) {
                        assert.equal(table, 'system_config');
                        return {
                            select() { return this; },
                            eq() { return this; },
                            async maybeSingle() {
                                return {
                                    data: {
                                        config_value: {
                                            __site_scoped: true,
                                            default: {
                                                enabled: true,
                                                verify_cdkey: 'CN-SECRET',
                                                price_per_verify: 10,
                                                price_per_verify_full: 20,
                                                verify_api_base_url: 'https://aidone.lol'
                                            },
                                            sites: {
                                                intl: {
                                                    enabled: true,
                                                    verify_cdkey: 'INTL-SECRET',
                                                    price_per_verify: 6,
                                                    price_per_verify_full: 12,
                                                    verify_api_base_url: 'https://aidone.lol'
                                                }
                                            }
                                        }
                                    },
                                    error: null
                                };
                            }
                        };
                    }
                };
            },
            sendJson(res, status, payload) {
                res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify(payload));
                return payload;
            }
        }
    });

    const res = createResponseRecorder();
    await handlers['verify-settings']({
        method: 'GET',
        url: '/api/public?scope=config&route=verify-settings&site=intl',
        headers: {
            host: 'www.zaoyoe.xyz'
        }
    }, res);
    const payload = JSON.parse(String(res.body || '{}'));

    assert.equal(res.statusCode, 200);
    assert.equal(payload.site, 'intl');
    assert.equal(payload.config.price_per_verify, 6);
    assert.equal(payload.config.price_per_verify_full, 12);
    assert.equal('verify_cdkey' in payload.config, false);
    assert.equal('apiKey' in payload.config, false);
    assert.equal(JSON.stringify(payload).includes('INTL-SECRET'), false);
});

test('public verify quota handler aggregates balances across a configured CDKey pool', async () => {
    const originalFetch = global.fetch;
    const seenKeys = [];
    global.fetch = async (input, init = {}) => {
        assert.equal(String(input), 'https://aidone.lol/openapi');
        assert.equal(init.method, 'POST');

        const payload = JSON.parse(init.body);
        assert.equal(payload.action, 'get_balance');
        seenKeys.push(payload.cdkey);

        const remainingUsesByKey = {
            'SYS-AAA111': 0.5,
            'SYS-BBB222': 1.0
        };

        return new Response(JSON.stringify({
            success: true,
            remaining_uses: remainingUsesByKey[payload.cdkey] || 0,
            total_used: payload.cdkey === 'SYS-AAA111' ? 3 : 7
        }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json'
            }
        });
    };

    try {
        const handlers = createPublicConfigHandlers({
            admin: {
                async requireAuthenticatedUser() {
                    return {
                        user: {
                            id: 'user-2'
                        }
                    };
                },
                getOptionalSupabaseAdmin() {
                    return {
                        from(table) {
                            assert.equal(table, 'system_config');
                            return {
                                select() { return this; },
                                eq() { return this; },
                                async maybeSingle() {
                                    return {
                                        data: {
                                            config_value: {
                                                enabled: true,
                                                verify_cdkeys: ['SYS-AAA111', 'SYS-BBB222'],
                                                verify_api_base_url: 'https://aidone.lol'
                                            }
                                        },
                                        error: null
                                    };
                                }
                            };
                        }
                    };
                },
                sendJson(res, status, payload) {
                    res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
                    res.end(JSON.stringify(payload));
                    return payload;
                }
            }
        });

        const res = createResponseRecorder();
        await handlers['verify-quota']({
            method: 'GET',
            headers: {
                authorization: 'Bearer member-token'
            }
        }, res);
        const payload = JSON.parse(String(res.body || '{}'));

        assert.deepEqual(seenKeys, ['SYS-AAA111', 'SYS-BBB222']);
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.remaining_uses, 1.5);
        assert.equal(payload.remaining_extract_jobs, 3);
        assert.equal(payload.remaining_full_jobs, 1);
        assert.equal(payload.key_count, 2);
        assert.equal(payload.healthy_key_count, 2);
    } finally {
        global.fetch = originalFetch;
    }
});
