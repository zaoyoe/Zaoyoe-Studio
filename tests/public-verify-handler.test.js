const test = require('node:test');
const assert = require('node:assert/strict');

const { createPublicVerifyHandlers } = require('../server/api-handlers/public/verify');
const { buildClientStatusMessage, fetchUpstreamJobStatus, postVerifyJobAction, postVerifyProviderAction } = require('../server/api-handlers/_verify-job-runtime');
const {
    VERIFY_PROVIDER_CATCARD,
    fetchDirectVerifyQuotaState,
    loadVerifyRuntimeConfig,
    selectVerifyCredentialForTask
} = require('../server/api-handlers/_verify-provider-runtime');

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
            this.headers[String(name || '').toLowerCase()] = value;
            return this;
        },
        end(payload) {
            this.body = payload;
            return this;
        }
    };
}

function sendJson(res, status, payload) {
    res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(payload));
    return payload;
}

test('verify status message keeps actionable failed-task guidance', () => {
    assert.equal(
        buildClientStatusMessage({
            status: 'failed',
            message: '请删除或者关闭付款资料后重试',
            error: ''
        }),
        '请删除或者关闭付款资料后重试'
    );
    assert.equal(
        buildClientStatusMessage({
            status: 'failed',
            message: '任务失败',
            error: 'payment_profile_conflict'
        }),
        'payment_profile_conflict'
    );
    assert.equal(
        buildClientStatusMessage({ status: 'failed' }),
        '任务失败'
    );
});

test('verify status message prefers provider realtime feedback while running', () => {
    assert.equal(
        buildClientStatusMessage({
            status: 'running',
            stage_label: 'login',
            step_status: 'running',
            provider_message: '正在登录 Google 账号'
        }),
        '正在登录 Google 账号'
    );
    assert.equal(
        buildClientStatusMessage({
            status: 'running',
            stage_label: 'login',
            step_status: 'running'
        }),
        '当前阶段：login（进行中）'
    );
});

test('public verify submit handler returns queued task metadata for authenticated users', async () => {
    const handlers = createPublicVerifyHandlers({
        admin: {
            async requireAuthenticatedUser() {
                return {
                    user: { id: 'user-1' },
                    adminSupabase: {
                        from() {
                            throw new Error('submit route should use injected runtime stubs');
                        }
                    }
                };
            },
            async parseJsonBody() {
                return {
                    email: 'member@example.com',
                    password: 'secret-pass',
                    totpSecret: 'JBSWY3DPEHPK3PXP',
                    priority: 0,
                    taskType: 'extract'
                };
            },
            getOptionalSupabaseAdmin() {
                return null;
            },
            sendJson
        },
        verifyRuntime: {
            normalizeVerifyTaskType(value) {
                return String(value || '').trim() === 'full' ? 'full' : 'extract';
            },
            resolveVerifyRequestSite() {
                return 'cn';
            },
            async loadVerifyRuntimeConfig(_supabase, _env, options) {
                assert.equal(options?.site, 'cn');
                return {
                    apiKey: 'SYS-38147DAAF78A',
                    apiKeys: ['SYS-38147DAAF78A', 'SYS-92AF0C7712BD'],
                    apiBaseUrl: 'https://aidone.lol',
                    pricePerVerifyExtract: 10,
                    pricePerVerifyFull: 20
                };
            },
            getVerifyPriceForTaskType(config, taskType) {
                return taskType === 'full' ? config.pricePerVerifyFull : config.pricePerVerifyExtract;
            },
            async validateUserBalance() {
                return { valid: true, balance: 200 };
            },
            async selectVerifyCredentialForTask() {
                return {
                    selected: {
                        apiKey: 'SYS-38147DAAF78A',
                        key_name: 'SYS-38147DAAF78A',
                        balance: 0.5
                    }
                };
            },
            buildVerifyCredentialFingerprint() {
                return 'fp-aidone-1';
            },
            async postVerifyProviderAction(config, payload) {
                assert.equal(config.apiKey, 'SYS-38147DAAF78A');
                assert.deepEqual(payload, {
                    action: 'submit_task',
                    cdkey: 'SYS-38147DAAF78A',
                    email: 'member@example.com',
                    password: 'secret-pass',
                    twofa: 'JBSWY3DPEHPK3PXP',
                    priority: 0,
                    task_type: 'extract'
                });

                return {
                    ok: true,
                    status: 200,
                    payload: {
                        success: true,
                        task_id: 'SYS-123',
                        status: 'queued',
                        queue_position: 2,
                        estimated_wait_seconds: 18,
                        task_type: 'extract'
                    }
                };
            },
            normalizeVerifyJobPayload(payload) {
                assert.equal(payload.task_id, 'SYS-123');
                return {
                    job_id: 'SYS-123',
                    task_id: 'SYS-123',
                    status: 'queued',
                    task_type: 'extract',
                    provider_key_fingerprint: 'fp-aidone-1',
                    provider_key_name: 'SYS-38147DAAF78A',
                    queue_position: 2,
                    estimated_wait_seconds: 18,
                    message: '任务已提交'
                };
            },
            async syncTrackedJobStatus() {
                return { pointsDeducted: 0 };
            }
        }
    });

    const res = createResponseRecorder();
    await handlers.submit({ method: 'POST', headers: {} }, res);
    const payload = JSON.parse(String(res.body || '{}'));

    assert.equal(res.statusCode, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.job_id, 'SYS-123');
    assert.equal(payload.status, 'queued');
    assert.equal(payload.task_type, 'extract');
});

test('public verify status handler returns normalized job progress for authenticated users', async () => {
    const handlers = createPublicVerifyHandlers({
        admin: {
            async requireAuthenticatedUser() {
                return {
                    user: { id: 'user-1' },
                    adminSupabase: {
                        from() {
                            throw new Error('status route should use injected runtime stubs');
                        }
                    }
                };
            },
            getOptionalSupabaseAdmin() {
                return null;
            },
            sendJson
        },
        verifyRuntime: {
            resolveVerifyRequestSite() {
                return 'cn';
            },
            async findTrackedJobLog() {
                return {
                    message: JSON.stringify({
                        kind: 'google_one_job',
                        email: 'member@example.com',
                        task_type: 'extract',
                        provider_key_fingerprint: 'fp-aidone-1',
                        provider_key_name: 'SYS-38147DAAF78A'
                    })
                };
            },
            parseHistoryMessage(message) {
                return JSON.parse(message);
            },
            async loadVerifyRuntimeConfig(_supabase, _env, options) {
                assert.equal(options?.site, 'cn');
                return {
                    apiKey: 'SYS-38147DAAF78A',
                    apiKeys: ['SYS-38147DAAF78A', 'SYS-92AF0C7712BD'],
                    apiBaseUrl: 'https://aidone.lol'
                };
            },
            resolveVerifyApiKeyByFingerprint(config, fingerprint) {
                assert.equal(fingerprint, 'fp-aidone-1');
                return config.apiKeys[0];
            },
            async fetchUpstreamJobStatus(config, taskId) {
                assert.equal(config.apiKey, 'SYS-38147DAAF78A');
                assert.equal(taskId, 'SYS-123');
                return {
                    ok: true,
                    data: {
                        job_id: 'SYS-123',
                        status: 'running',
                        task_type: 'extract',
                        stage_label: 'login',
                        raw_step: 'login',
                        step_status: 'running',
                        provider_message: '正在登录 Google 账号',
                        provider_progress: 42,
                        progress: 42,
                        elapsed_seconds: 42
                    }
                };
            },
            normalizeVerifyTaskType(value) {
                return String(value || '').trim() === 'full' ? 'full' : 'extract';
            },
            normalizeVerifyJobPayload(payload) {
                return {
                    job_id: String(payload.job_id || 'SYS-123'),
                    status: 'running',
                    task_type: 'extract',
                    stage_label: 'login',
                    raw_step: 'login',
                    step_status: 'running',
                    provider_message: '正在登录 Google 账号',
                    provider_progress: 42,
                    progress: 42,
                    url: '',
                    error: '',
                    elapsed_seconds: 42,
                    queue_position: 0,
                    estimated_wait_seconds: 0,
                    has_offer_url: false
                };
            },
            async syncTrackedJobStatus() {
                return {
                    pointsDeducted: 0
                };
            },
            buildClientStatusMessage(job) {
                return job.provider_message || '任务执行中';
            }
        }
    });

    const res = createResponseRecorder();
    await handlers.status({
        method: 'GET',
        url: '/api/public?scope=verify&route=status&taskId=SYS-123',
        headers: {}
    }, res);
    const payload = JSON.parse(String(res.body || '{}'));

    assert.equal(res.statusCode, 200);
    assert.equal(payload.success, false);
    assert.equal(payload.job_id, 'SYS-123');
    assert.equal(payload.status, 'running');
    assert.equal(payload.stage_label, 'login');
    assert.equal(payload.raw_step, 'login');
    assert.equal(payload.step_status, 'running');
    assert.equal(payload.provider_message, '正在登录 Google 账号');
    assert.equal(payload.provider_progress, 42);
    assert.equal(payload.progress, 42);
    assert.equal(payload.pointsDeducted, 0);
    assert.equal(payload.message, '正在登录 Google 账号');
});

test('public verify action handler unlocks failed captured links through the original aidone key', async () => {
    const handlers = createPublicVerifyHandlers({
        admin: {
            async requireAuthenticatedUser() {
                return {
                    user: { id: 'user-1' },
                    adminSupabase: {
                        from() {
                            throw new Error('action route should use injected runtime stubs');
                        }
                    }
                };
            },
            async parseJsonBody() {
                return {
                    action: 'purchase_failed_link',
                    taskId: 'SYS-FAILED-1'
                };
            },
            getOptionalSupabaseAdmin() {
                return null;
            },
            sendJson
        },
        verifyRuntime: {
            resolveVerifyRequestSite() {
                return 'cn';
            },
            async findTrackedJobLog({ jobId }) {
                assert.equal(jobId, 'SYS-FAILED-1');
                return {
                    message: JSON.stringify({
                        kind: 'google_one_job',
                        job_id: 'SYS-FAILED-1',
                        email: 'member@example.com',
                        task_type: 'full',
                        provider: 'aidone',
                        provider_key_fingerprint: 'fp-aidone-1',
                        has_offer_url: true,
                        raw_status: 'failed'
                    })
                };
            },
            parseHistoryMessage(message) {
                return JSON.parse(message);
            },
            async loadVerifyRuntimeConfig(_supabase, _env, options) {
                assert.equal(options?.site, 'cn');
                return {
                    provider: 'aidone',
                    apiKey: 'SYS-38147DAAF78A',
                    apiKeys: ['SYS-38147DAAF78A'],
                    apiBaseUrl: 'https://aidone.lol',
                    pricePerVerifyExtract: 10,
                    pricePerVerifyFull: 20,
                    providers: {
                        aidone: {
                            provider: 'aidone',
                            apiKey: 'SYS-38147DAAF78A',
                            apiKeys: ['SYS-38147DAAF78A'],
                            apiBaseUrl: 'https://aidone.lol'
                        }
                    }
                };
            },
            activateVerifyProviderConfig(config, provider) {
                assert.equal(provider, 'aidone');
                return config.providers.aidone;
            },
            resolveVerifyApiKeyByFingerprint(config, fingerprint) {
                assert.equal(fingerprint, 'fp-aidone-1');
                return config.apiKeys[0];
            },
            normalizeVerifyTaskType(value) {
                return String(value || '').trim() === 'full' ? 'full' : 'extract';
            },
            async postVerifyJobAction(config, args) {
                assert.equal(config.apiKey, 'SYS-38147DAAF78A');
                assert.deepEqual(args, {
                    action: 'purchase_failed_link',
                    jobId: 'SYS-FAILED-1',
                    apiKey: 'SYS-38147DAAF78A',
                    taskType: 'full'
                });
                return {
                    ok: true,
                    status: 200,
                    data: {
                        job_id: 'SYS-FAILED-1',
                        task_id: 'SYS-FAILED-1',
                        status: 'success',
                        task_type: 'extract',
                        offer_url: 'https://offer.example/unlocked',
                        url: 'https://offer.example/unlocked',
                        has_offer_url: true,
                        message: '提取链接购买成功'
                    },
                    payload: {
                        success: true,
                        offer_url: 'https://offer.example/unlocked',
                        remaining_uses: 448.5
                    }
                };
            },
            normalizeVerifyJobPayload(payload, fallback) {
                assert.equal(fallback.task_type, 'extract');
                assert.equal(fallback.status, 'success');
                return {
                    job_id: 'SYS-FAILED-1',
                    task_id: 'SYS-FAILED-1',
                    status: 'success',
                    task_type: 'extract',
                    url: payload.url || payload.offer_url,
                    offer_url: payload.offer_url || payload.url,
                    has_offer_url: true,
                    message: payload.message || ''
                };
            },
            async syncTrackedJobStatus({ apiData }) {
                assert.equal(apiData.task_type, 'extract');
                assert.equal(apiData.status, 'success');
                return {
                    pointsDeducted: 10
                };
            },
            buildClientStatusMessage() {
                return '链接获取成功';
            }
        }
    });

    const res = createResponseRecorder();
    await handlers.action({ method: 'POST', headers: {} }, res);
    const payload = JSON.parse(String(res.body || '{}'));

    assert.equal(res.statusCode, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.action, 'purchase_failed_link');
    assert.equal(payload.job_id, 'SYS-FAILED-1');
    assert.equal(payload.task_type, 'extract');
    assert.equal(payload.url, 'https://offer.example/unlocked');
    assert.equal(payload.pointsDeducted, 10);
    assert.equal(payload.remaining_uses, 448.5);
});

test('public verify submit handler forwards the selected CDKey from the pool to upstream', async () => {
    const handlers = createPublicVerifyHandlers({
        admin: {
            async requireAuthenticatedUser() {
                return {
                    user: { id: 'user-2' },
                    adminSupabase: {
                        from() {
                            throw new Error('submit route should use injected runtime stubs');
                        }
                    }
                };
            },
            async parseJsonBody() {
                return {
                    email: 'pool@example.com',
                    password: 'secret-pass',
                    totpSecret: 'JBSWY3DPEHPK3PXP',
                    priority: 0,
                    taskType: 'extract'
                };
            },
            getOptionalSupabaseAdmin() {
                return null;
            },
            sendJson
        },
        verifyRuntime: {
            normalizeVerifyTaskType() {
                return 'extract';
            },
            resolveVerifyRequestSite() {
                return 'cn';
            },
            async loadVerifyRuntimeConfig(_supabase, _env, options) {
                assert.equal(options?.site, 'cn');
                return {
                    apiKey: 'SYS-AAA111',
                    apiKeys: ['SYS-AAA111', 'SYS-BBB222'],
                    apiBaseUrl: 'https://aidone.lol',
                    pricePerVerifyExtract: 10,
                    pricePerVerifyFull: 20
                };
            },
            getVerifyPriceForTaskType(config, taskType) {
                return taskType === 'full' ? config.pricePerVerifyFull : config.pricePerVerifyExtract;
            },
            async validateUserBalance() {
                return { valid: true, balance: 88 };
            },
            async selectVerifyCredentialForTask() {
                return {
                    selected: {
                        apiKey: 'SYS-BBB222',
                        key_name: 'SYS-BBB222',
                        balance: 1.5
                    }
                };
            },
            buildVerifyCredentialFingerprint(value) {
                assert.equal(value, 'SYS-BBB222');
                return 'fp-bbb222';
            },
            async postVerifyProviderAction(config, payload) {
                assert.equal(config.apiKey, 'SYS-AAA111');
                assert.equal(payload.cdkey, 'SYS-BBB222');
                return {
                    ok: true,
                    status: 200,
                    payload: {
                        success: true,
                        task_id: 'SYS-POOL-1',
                        status: 'queued',
                        task_type: 'extract'
                    }
                };
            },
            normalizeVerifyJobPayload(payload) {
                return {
                    job_id: String(payload.task_id || 'SYS-POOL-1'),
                    task_id: String(payload.task_id || 'SYS-POOL-1'),
                    status: 'queued',
                    task_type: 'extract',
                    provider_key_fingerprint: 'fp-bbb222',
                    provider_key_name: 'SYS-BBB222'
                };
            },
            async syncTrackedJobStatus() {
                return { pointsDeducted: 0 };
            }
        }
    });

    const res = createResponseRecorder();
    await handlers.submit({ method: 'POST', headers: {} }, res);
    const payload = JSON.parse(String(res.body || '{}'));

    assert.equal(res.statusCode, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.job_id, 'SYS-POOL-1');
    assert.equal(payload.task_type, 'extract');
});

test('verify job runtime status lookup falls back across the CDKey pool when the preferred key reports job_not_found', async () => {
    const originalFetch = global.fetch;
    const seenKeys = [];

    global.fetch = async (input, init = {}) => {
        assert.equal(String(input), 'https://aidone.lol/openapi');
        const payload = JSON.parse(init.body || '{}');
        seenKeys.push(payload.cdkey);

        if (payload.cdkey === 'SYS-AAA111') {
            return new Response(JSON.stringify({
                success: false,
                code: 'job_not_found',
                message: '任务不存在'
            }), {
                status: 404,
                headers: {
                    'Content-Type': 'application/json'
                }
            });
        }

        return new Response(JSON.stringify({
            success: true,
            task_id: 'SYS-STATUS-1',
            status: 'Success',
            task_type: 'extract',
            offer_url: 'https://offer.example/fallback-success'
        }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json'
            }
        });
    };

    try {
        const result = await fetchUpstreamJobStatus({
            apiKey: 'SYS-AAA111',
            apiKeys: ['SYS-AAA111', 'SYS-BBB222'],
            apiBaseUrl: 'https://aidone.lol'
        }, 'SYS-STATUS-1', {
            apiKey: 'SYS-AAA111',
            fetchImpl: global.fetch
        });

        assert.deepEqual(seenKeys, ['SYS-AAA111', 'SYS-BBB222']);
        assert.equal(result.ok, true);
        assert.equal(result.data.status, 'success');
        assert.equal(result.data.url, 'https://offer.example/fallback-success');
    } finally {
        global.fetch = originalFetch;
    }
});

test('verify job runtime posts aidone job actions and rejects unsupported 1free job actions', async () => {
    const requests = [];
    const fetchImpl = async (input, init = {}) => {
        requests.push({
            url: String(input),
            body: JSON.parse(init.body || '{}')
        });
        return new Response(JSON.stringify({
            success: true,
            message: '提取链接购买成功！扣除额度: 0.5',
            offer_url: 'https://offer.example/purchased',
            remaining_uses: 448.5
        }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json'
            }
        });
    };

    const purchase = await postVerifyJobAction({
        provider: 'aidone',
        adapter: 'aidone_openapi',
        apiKey: 'SYS-AIDONE-1',
        apiKeys: ['SYS-AIDONE-1'],
        apiBaseUrl: 'https://aidone.lol'
    }, {
        action: 'purchase_failed_link',
        jobId: 'SYS-FAILED-1',
        apiKey: 'SYS-AIDONE-1',
        taskType: 'full'
    }, {
        fetchImpl
    });

    assert.equal(purchase.ok, true);
    assert.equal(purchase.data.status, 'success');
    assert.equal(purchase.data.task_type, 'extract');
    assert.equal(purchase.data.url, 'https://offer.example/purchased');
    assert.equal(purchase.payload.remaining_uses, 448.5);
    assert.deepEqual(requests, [{
        url: 'https://aidone.lol/openapi',
        body: {
            action: 'purchase_failed_link',
            cdkey: 'SYS-AIDONE-1',
            task_id: 'SYS-FAILED-1'
        }
    }]);

    const unsupported = await postVerifyJobAction({
        provider: 'catcard',
        adapter: 'pixel_bridge_rest',
        apiKey: 'SUB-KEY',
        apiKeys: ['SUB-KEY'],
        apiBaseUrl: 'https://1free.qzz.io'
    }, {
        action: 'cancel_task',
        jobId: 'PX-1001',
        apiKey: 'SUB-KEY'
    }, {
        fetchImpl
    });

    assert.equal(unsupported.ok, false);
    assert.equal(unsupported.status, 400);
    assert.equal(unsupported.code, 'provider_action_not_supported');
});

test('verify provider runtime selects 1free key by task type and reports pixel bridge balance', async () => {
    const requestedKeys = [];
    const supabase = {
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
                                active_provider: 'catcard',
                                providers: {
                                    catcard: {
                                        api_base_url: 'https://1free.qzz.io',
                                        subscribe_cdkeys: ['SUB-KEY'],
                                        extract_cdkeys: ['EXT-KEY']
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
    const fetchImpl = async (input, init = {}) => {
        assert.equal(String(input), 'https://1free.qzz.io/api/pixel-keys/verify');
        assert.equal(init.method, 'POST');
        const body = JSON.parse(init.body || '{}');
        requestedKeys.push(body.key);
        return new Response(JSON.stringify({
            code: 0,
            msg: 'success',
            data: {
                key: body.key,
                key_type: body.key === 'SUB-KEY' ? 'subscribe' : 'extract_link',
                label: body.key === 'SUB-KEY' ? 'Subscribe Key' : 'Extract Key',
                total: 10,
                used: body.key === 'SUB-KEY' ? 2 : 4,
                remaining: body.key === 'SUB-KEY' ? 8 : 6,
                status: 'active'
            }
        }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json'
            }
        });
    };

    const config = await loadVerifyRuntimeConfig(supabase, {}, { site: 'cn' });
    assert.equal(config.provider, VERIFY_PROVIDER_CATCARD);
    assert.equal(config.adapter, 'pixel_bridge_rest');

    const fullSelection = await selectVerifyCredentialForTask(config, 1, {
        fetchImpl,
        taskType: 'full'
    });
    assert.equal(fullSelection.selected.apiKey, 'SUB-KEY');
    assert.equal(fullSelection.selected.key_type, 'subscribe');

    const extractSelection = await selectVerifyCredentialForTask(config, 1, {
        fetchImpl,
        taskType: 'extract'
    });
    assert.equal(extractSelection.selected.apiKey, 'EXT-KEY');
    assert.equal(extractSelection.selected.key_type, 'extract_link');

    const quotaState = await fetchDirectVerifyQuotaState(supabase, {
        fetchImpl,
        site: 'cn'
    });
    assert.equal(quotaState.success, true);
    assert.equal(quotaState.remaining_uses, 14);
    assert.equal(quotaState.remaining_extract_uses, 6);
    assert.equal(quotaState.remaining_full_uses, 8);
    assert.equal(quotaState.remaining_extract_jobs, 6);
    assert.equal(quotaState.remaining_full_jobs, 8);
    assert.deepEqual(requestedKeys, ['SUB-KEY', 'EXT-KEY', 'SUB-KEY', 'EXT-KEY', 'SUB-KEY', 'EXT-KEY']);
});

test('verify provider runtime reports zero extract balance when only 1free subscribe keys are configured', async () => {
    const supabase = {
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
                                active_provider: 'catcard',
                                providers: {
                                    catcard: {
                                        api_base_url: 'https://1free.qzz.io',
                                        subscribe_cdkeys: ['SUB-KEY'],
                                        extract_cdkeys: []
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
    const fetchImpl = async (input, init = {}) => {
        assert.equal(String(input), 'https://1free.qzz.io/api/pixel-keys/verify');
        assert.equal(init.method, 'POST');
        const body = JSON.parse(init.body || '{}');
        assert.equal(body.key, 'SUB-KEY');
        return new Response(JSON.stringify({
            code: 0,
            msg: 'success',
            data: {
                key: body.key,
                key_type: 'subscribe',
                label: 'Subscribe Key',
                total: 10,
                used: 0,
                remaining: 10,
                status: 'active'
            }
        }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json'
            }
        });
    };

    const quotaState = await fetchDirectVerifyQuotaState(supabase, {
        fetchImpl,
        site: 'cn'
    });

    assert.equal(quotaState.success, true);
    assert.equal(quotaState.remaining_uses, 10);
    assert.equal(quotaState.remaining_extract_uses, 0);
    assert.equal(quotaState.remaining_full_uses, 10);
    assert.equal(quotaState.remaining_extract_jobs, 0);
    assert.equal(quotaState.remaining_full_jobs, 10);
    assert.equal(quotaState.key_states.length, 1);
    assert.equal(quotaState.key_states[0].key_type, 'subscribe');
    assert.equal(quotaState.key_states[0].remaining_extract_uses, 0);
    assert.equal(quotaState.key_states[0].remaining_full_uses, 10);
    assert.equal(quotaState.key_states[0].remaining_extract_jobs, 0);
    assert.equal(quotaState.key_states[0].remaining_full_jobs, 10);
});

test('verify job runtime submits and polls 1free pixel bridge tasks', async () => {
    const requests = [];
    const fetchImpl = async (input, init = {}) => {
        requests.push({
            url: String(input),
            method: init.method || 'GET',
            body: init.body ? JSON.parse(init.body) : null
        });

        if (String(input) === 'https://1free.qzz.io/api/pixel-bridge/submit-task') {
            return new Response(JSON.stringify({
                code: 0,
                msg: 'ok',
                data: {
                    task: {
                        id: 'PX-1001',
                        email: 'member@example.com',
                        status: 'queued'
                    },
                    remaining: 9
                }
            }), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json'
                }
            });
        }

        const url = new URL(String(input));
        assert.equal(url.origin + url.pathname, 'https://1free.qzz.io/api/pixel-bridge/tasks');
        assert.equal(url.searchParams.get('key'), 'SUB-KEY');
        return new Response(JSON.stringify({
            code: 0,
            msg: 'success',
            data: {
                tasks: [{
                        id: 'PX-1001',
                        email: 'member@example.com',
                        status: 'running',
                        step: 'login',
                        step_status: 'running',
                        message: '正在登录 Google 账号',
                        progress: 42,
                        duration: 18
                    }]
                }
            }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json'
            }
        });
    };
    const config = {
        provider: 'catcard',
        adapter: 'pixel_bridge_rest',
        apiKey: 'SUB-KEY',
        apiKeys: ['SUB-KEY'],
        apiBaseUrl: 'https://1free.qzz.io'
    };

    const submit = await postVerifyProviderAction(config, {
        action: 'submit_task',
        cdkey: 'SUB-KEY',
        email: 'member@example.com',
        password: 'secret-pass',
        twofa: 'JBSWY3DPEHPK3PXP',
        task_type: 'full'
    }, {
        fetchImpl
    });
    assert.equal(submit.ok, true);
    assert.equal(submit.payload.data.task_id, 'PX-1001');
    assert.equal(submit.payload.data.provider, 'catcard');
    assert.equal(requests[0].url, 'https://1free.qzz.io/api/pixel-bridge/submit-task');
    assert.deepEqual(requests[0].body, {
        key: 'SUB-KEY',
        email: 'member@example.com',
        password: 'secret-pass',
        totp_secret: 'JBSWY3DPEHPK3PXP',
        recovery: '',
        remark: ''
    });

    const status = await fetchUpstreamJobStatus(config, 'PX-1001', {
        fetchImpl,
        apiKey: 'SUB-KEY',
        taskType: 'full'
    });
    assert.equal(status.ok, true);
    assert.equal(status.data.status, 'running');
    assert.equal(status.data.stage_label, 'login');
    assert.equal(status.data.raw_step, 'login');
    assert.equal(status.data.step_status, 'running');
    assert.equal(status.data.provider_message, '正在登录 Google 账号');
    assert.equal(status.data.provider_progress, 42);
    assert.equal(status.data.progress, 42);
    assert.equal(status.data.elapsed_seconds, 18);
    assert.equal(requests[1].method, 'GET');
});
