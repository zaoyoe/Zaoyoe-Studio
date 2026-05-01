const test = require('node:test');
const assert = require('node:assert/strict');

const { createPublicVerifyHandlers } = require('../server/api-handlers/public/verify');
const { buildClientStatusMessage, fetchUpstreamJobStatus } = require('../server/api-handlers/_verify-job-runtime');

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
            async loadVerifyRuntimeConfig() {
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
            async loadVerifyRuntimeConfig() {
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
                        status: 'success',
                        task_type: 'extract',
                        url: 'https://offer.example/link',
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
                    status: 'success',
                    task_type: 'extract',
                    url: 'https://offer.example/link',
                    error: '',
                    elapsed_seconds: 42,
                    queue_position: 0,
                    estimated_wait_seconds: 0,
                    has_offer_url: true
                };
            },
            async syncTrackedJobStatus() {
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
    await handlers.status({
        method: 'GET',
        url: '/api/public?scope=verify&route=status&taskId=SYS-123',
        headers: {}
    }, res);
    const payload = JSON.parse(String(res.body || '{}'));

    assert.equal(res.statusCode, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.job_id, 'SYS-123');
    assert.equal(payload.url, 'https://offer.example/link');
    assert.equal(payload.pointsDeducted, 10);
    assert.equal(payload.message, '链接获取成功');
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
            async loadVerifyRuntimeConfig() {
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
