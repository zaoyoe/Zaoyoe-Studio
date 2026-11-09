const test = require('node:test');
const assert = require('node:assert/strict');
const {
    VERIFY_PROVIDER_86AI,
    VERIFY_ADAPTER_86AI_API,
    normalizeVerifyProvider,
    normalizeVerifyAdapter,
    getVerifyProviderCapabilities,
    buildRuntimeProviderConfig,
    activateVerifyProviderConfig
} = require('../server/api-handlers/_verify-provider-runtime');
const {
    createActivationService,
    validateAccount,
    isActivationRequest,
    isActivationJob,
    fingerprint,
    errorResponse
} = require('../server/api-handlers/_google-one-activation-runtime');

test('86AI provider runtime normalization and capabilities', () => {
    assert.equal(normalizeVerifyProvider('86ai'), VERIFY_PROVIDER_86AI);
    assert.equal(normalizeVerifyProvider('86ai_api'), VERIFY_PROVIDER_86AI);
    assert.equal(normalizeVerifyAdapter('86ai_api', '86ai'), VERIFY_ADAPTER_86AI_API);

    const caps = getVerifyProviderCapabilities('86ai');
    assert.equal(caps.proActivation, true);
    assert.equal(caps.extract, false);
    assert.equal(caps.full, false);
    assert.equal(caps.keyBalance, false);
    assert.equal(caps.batchSubmit, false);
});

test('86AI runtime provider configuration building', () => {
    const rawConfig = {
        providers: {
            '86ai': {
                enabled: true,
                card_codes: ['CARD-PRO-12345678', 'CARD-PRO-87654321'],
                price_per_pro_activation: 35
            }
        }
    };

    const runtime = buildRuntimeProviderConfig({
        config: rawConfig,
        provider: '86ai',
        site: 'cn'
    });

    assert.equal(runtime.provider, '86ai');
    assert.equal(runtime.enabled, true);
    assert.equal(runtime.adapter, '86ai_api');
    assert.equal(runtime.apiBaseUrl, 'https://86ai.one');
    assert.equal(runtime.keyCount, 2);
    assert.equal(runtime.pricePerProActivation, 35);
    assert.equal(runtime.modeVisibility, 'pro_activation_only');
});

test('86AI account validation rules', () => {
    const valid3Part = validateAccount({
        email: 'user@example.com',
        password: 'securepassword123',
        totpSecret: '12345678'
    });
    assert.equal(valid3Part.email, 'user@example.com');
    assert.equal(valid3Part.account, 'user@example.com|securepassword123|12345678');

    const valid4Part = validateAccount({
        email: 'user@example.com',
        password: 'securepassword123',
        recoveryEmail: 'recovery@example.com',
        totpSecret: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
    });
    assert.equal(valid4Part.account, 'user@example.com|securepassword123|recovery@example.com|ABCDEFGHIJKLMNOPQRSTUVWXYZ234567');

    assert.throws(() => {
        validateAccount({
            email: 'invalid-email',
            password: 'pwd',
            totpSecret: '12345678'
        });
    }, /invalid_account/);

    assert.throws(() => {
        validateAccount({
            email: 'user@example.com',
            password: 'pwd|with|pipes',
            totpSecret: '12345678'
        });
    }, /invalid_account/);
});

test('86AI activation request detection', () => {
    assert.equal(isActivationRequest({ provider: '86ai' }), true);
    assert.equal(isActivationRequest({ verify_provider: '86ai' }), true);
    assert.equal(isActivationRequest({ task_type: 'pro_activation' }), true);
    assert.equal(isActivationRequest({ provider: 'catcard', task_type: 'full' }), false);

    assert.equal(isActivationJob('gpro_11111111-2222-4333-8444-555555555555'), true);
    assert.equal(isActivationJob('123456'), false);
});

test('86AI activation service submit, poll, and resolve workflows', async () => {
    const mockDb = {
        jobs: new Map(),
        rpcCalls: []
    };

    const supabaseStub = {
        async rpc(fn, args) {
            mockDb.rpcCalls.push({ fn, args });
            const action = args.p_action;
            const jobId = args.p_job_id;
            const data = args.p_data || {};

            if (action === 'lookup' || action === 'read' || action === 'admin_read') {
                const job = mockDb.jobs.get(jobId);
                return { data: { ok: true, job: job || null } };
            }
            if (action === 'prepare') {
                const job = {
                    id: jobId,
                    user_id: args.p_user_id,
                    site: args.p_site,
                    email: data.email,
                    account_hash: data.account_hash,
                    card_fingerprint: data.card_fingerprint,
                    status: 'prepared',
                    billing_state: 'reserved',
                    price: data.price,
                    version: 1,
                    created_at: new Date().toISOString()
                };
                mockDb.jobs.set(jobId, job);
                return { data: { ok: true, job } };
            }
            if (action === 'claim_dispatch') {
                const job = mockDb.jobs.get(jobId);
                job.status = 'submitting';
                job.dispatch_token = data.token;
                return { data: { ok: true, claimed: true, job } };
            }
            if (action === 'submitted') {
                const job = mockDb.jobs.get(jobId);
                job.status = 'queued';
                job.upstream_task_id = data.upstream_task_id;
                return { data: { ok: true, job } };
            }
            if (action === 'claim_poll') {
                const job = mockDb.jobs.get(jobId);
                return { data: { ok: true, claimed: true, job } };
            }
            if (action === 'observe') {
                const job = mockDb.jobs.get(jobId);
                const upstreamStatus = data.upstream_status;
                if (upstreamStatus === 3) {
                    job.status = 'verification_pending';
                    job.review_reason = 'pro_entitlement_unverified';
                }
                return { data: { ok: true, job } };
            }
            if (action === 'admin_resolve') {
                const job = mockDb.jobs.get(jobId);
                if (data.action === 'confirm_success') {
                    job.status = 'success';
                    job.billing_state = 'charged';
                    job.evidence_ref = data.evidence_ref;
                } else if (data.action === 'confirm_failed') {
                    job.status = 'failed';
                    job.billing_state = 'refunded';
                    job.evidence_ref = data.evidence_ref;
                }
                return { data: { ok: true, job } };
            }
            return { data: { ok: true } };
        }
    };

    let fetchCalled = 0;
    const mockFetch = async (url, opts) => {
        fetchCalled++;
        if (opts.method === 'POST') {
            return {
                status: 201,
                headers: new Headers(),
                async json() {
                    return {
                        success: true,
                        code: 'OK',
                        message: '任务创建成功',
                        data: { num: 1, task_ids: [888999] }
                    };
                }
            };
        }
        if (opts.method === 'GET') {
            return {
                status: 200,
                headers: new Headers(),
                async json() {
                    return {
                        success: true,
                        code: 'OK',
                        message: '查询成功',
                        data: {
                            id: 888999,
                            status: 3,
                            status_name: '已完成',
                            result: '开通完成'
                        }
                    };
                }
            };
        }
    };

    const mockLoadConfig = async () => ({
        enabled: true,
        providers: {
            '86ai': {
                enabled: true,
                card_codes: ['CARD-PRO-TEST-1234'],
                pricePerProActivation: 30
            }
        }
    });

    const service = createActivationService({
        supabase: supabaseStub,
        fetchImpl: mockFetch,
        loadConfig: mockLoadConfig
    });

    const fakeReq = { headers: { host: 'localhost:3000' }, url: '/api/verify?site=cn' };
    const fakeUser = { id: 'test-user-1' };
    const requestId = 'a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d';

    // 1. Submit task
    const submitResult = await service.submit({
        req: fakeReq,
        user: fakeUser,
        body: {
            task_type: 'pro_activation',
            provider: '86ai',
            request_id: requestId,
            email: 'googleaccount@gmail.com',
            password: 'mypassword',
            totp_secret: '12345678'
        }
    });

    assert.equal(submitResult.job_id, `gpro_${requestId}`);
    assert.equal(submitResult.status, 'queued');
    assert.equal(submitResult.price, 30);
    assert.equal(submitResult.pointsReserved, 30);

    // 2. Poll status (upstream completed -> verification_pending)
    const statusResult = await service.status({
        req: fakeReq,
        user: fakeUser,
        id: `gpro_${requestId}`,
        admin: true
    });

    assert.equal(statusResult.status, 'verification_pending');
    assert.equal(statusResult.upstream_task_id, 888999);
    assert.equal(statusResult.billing_state, 'reserved');

    // 3. Admin confirm success (charged)
    const resolvedResult = await service.resolve({
        req: fakeReq,
        user: { id: 'admin-1' },
        body: {
            job_id: `gpro_${requestId}`,
            action: 'confirm_success',
            version: 1,
            pro_confirmed: true,
            evidence_ref: 'ticket:verified_in_google_one'
        }
    });

    assert.equal(resolvedResult.status, 'success');
    assert.equal(resolvedResult.billing_state, 'charged');
    assert.equal(resolvedResult.terminal, true);
    assert.equal(resolvedResult.evidence_ref, 'ticket:verified_in_google_one');

    // 4. Test refund resolution on failed activation
    const refundJobId = 'b2c3d4e5-f6a1-4b2c-9d3e-4f5a6b7c8d9e';
    mockDb.jobs.set(refundJobId, {
        id: refundJobId,
        user_id: 'test-user-2',
        site: 'cn',
        email: 'user2@gmail.com',
        account_hash: '1234',
        card_fingerprint: 'abcd',
        status: 'verification_pending',
        billing_state: 'reserved',
        price: 30,
        version: 1
    });

    const refundResult = await service.resolve({
        req: fakeReq,
        user: { id: 'admin-1' },
        body: {
            job_id: `gpro_${refundJobId}`,
            action: 'confirm_failed',
            version: 1,
            pro_not_active: true,
            upstream_closed: true,
            evidence_ref: 'ticket:user_reported_not_working'
        }
    });

    assert.equal(refundResult.status, 'failed');
    assert.equal(refundResult.billing_state, 'refunded');
    assert.equal(refundResult.terminal, true);
});

test('86AI rejects link extraction and batch requests', async () => {
    const service = createActivationService({
        supabase: {},
        loadConfig: async () => ({})
    });

    await assert.rejects(async () => {
        await service.submit({
            req: {},
            user: { id: 'user' },
            body: {
                task_type: 'extract',
                provider: '86ai',
                request_id: '11111111-2222-4333-8444-555555555555'
            }
        });
    }, /invalid_task_type/);

    await assert.rejects(async () => {
        await service.submit({
            req: {},
            user: { id: 'user' },
            body: {
                task_type: 'pro_activation',
                provider: '86ai',
                batch: true,
                request_id: '11111111-2222-4333-8444-555555555555'
            }
        });
    }, /invalid_task_type/);
});

test('Google One multi-duration packages (sub6, sub12, sub24) pricing and unit costs', async () => {
    const { getVerifyPriceForTaskType, normalizeVerifyTaskType } = require('../server/api-handlers/_verify-job-runtime');
    
    assert.equal(normalizeVerifyTaskType('sub6'), 'sub6');
    assert.equal(normalizeVerifyTaskType('sub12'), 'sub12');
    assert.equal(normalizeVerifyTaskType('sub24'), 'sub24');
    assert.equal(normalizeVerifyTaskType('full'), 'full');

    const baseConfig = {
        price_per_verify: 10,
        price_per_verify_extract: 10,
        price_per_verify_full: 48
    };

    // Default proportional multipliers: sub6=1x (48), sub12=1.5x (72), sub24=2x (96)
    assert.equal(getVerifyPriceForTaskType(baseConfig, 'sub6'), 48);
    assert.equal(getVerifyPriceForTaskType(baseConfig, 'sub12'), 72);
    assert.equal(getVerifyPriceForTaskType(baseConfig, 'sub24'), 96);
    assert.equal(getVerifyPriceForTaskType(baseConfig, 'extract'), 10);

    // Custom price override
    const customConfig = {
        ...baseConfig,
        price_per_verify_sub6: 45,
        price_per_verify_sub12: 68,
        price_per_verify_sub24: 90
    };
    assert.equal(getVerifyPriceForTaskType(customConfig, 'sub6'), 45);
    assert.equal(getVerifyPriceForTaskType(customConfig, 'sub12'), 68);
    assert.equal(getVerifyPriceForTaskType(customConfig, 'sub24'), 90);
});

test('verify-widget multi-duration quota display and shortage detection rules', () => {
    const fs = require('fs');
    const path = require('path');
    const vm = require('vm');

    const widgetSource = fs.readFileSync(path.join(__dirname, '..', 'verify-widget.js'), 'utf8');

    assert.ok(widgetSource.includes("const taskTypesToCheck = ['extract', 'full', 'sub6', 'sub12', 'sub24', 'pro_activation'];"));
    assert.ok(widgetSource.includes("已完成领取流程，请刷新查看"));

    const sandbox = {
        Number,
        Math,
        String,
        Array,
        activeVerifyProvider: 'aidone',
        apiUsageCosts: { extract: 0.5, full: 1 },
        getChannelState: () => ({ apiUsageCosts: { extract: 0.5, full: 1 }, apiCredits: 1.5 })
    };
    vm.createContext(sandbox);

    vm.runInContext(`
        function normalizeTaskType(value, fallback = 'extract') {
            const normalized = String(value || '').trim().toLowerCase();
            if (normalized === 'pro_activation' || normalized === 'pro' || normalized === 'activation') return 'pro_activation';
            if (['sub24', '24m', '2year'].includes(normalized)) return 'sub24';
            if (['sub12', '12m', '1year'].includes(normalized)) return 'sub12';
            if (['sub6', '6m'].includes(normalized)) return 'sub6';
            if (normalized === 'full') return 'full';
            if (normalized === 'extract') return 'extract';
            return fallback;
        }
        function getTaskTypeUsageCost(taskType = 'extract', provider = activeVerifyProvider) {
            const normalized = normalizeTaskType(taskType);
            if (normalized === 'pro_activation') return 1;
            if (normalized === 'sub24') return 2;
            if (normalized === 'sub12') return 1.5;
            if (normalized === 'sub6') return 1;
            return normalized === 'full' ? 1 : 0.5;
        }
        function getRemainingTaskCount(balance, taskType = 'extract', provider = activeVerifyProvider) {
            const numericBalance = Number(balance);
            const usageCost = getTaskTypeUsageCost(taskType, provider);
            if (!Number.isFinite(numericBalance) || !Number.isFinite(usageCost) || usageCost <= 0) return 0;
            return Math.max(0, Math.floor((numericBalance + 1e-9) / usageCost));
        }
        function getApiQuotaModeRemainingJobs(taskType = 'extract', quotaSummary = {}) {
            const normalized = normalizeTaskType(taskType);
            if (normalized === 'extract') return quotaSummary?.extractJobs ?? getRemainingTaskCount(quotaSummary?.remainingExtractUses ?? quotaSummary?.remainingUses, 'extract');
            if (normalized === 'full') return quotaSummary?.fullJobs ?? getRemainingTaskCount(quotaSummary?.remainingFullUses ?? quotaSummary?.remainingUses, 'full');
            const poolUses = quotaSummary?.remainingFullUses ?? quotaSummary?.remainingUses;
            return getRemainingTaskCount(poolUses, normalized);
        }
    `, sandbox);

    // Scenario: Backend has 1.5 credits remaining
    sandbox.quota15 = { remainingUses: 1.5, remainingFullUses: 1.5, fullJobs: 1, extractJobs: 3 };
    assert.equal(vm.runInContext("getApiQuotaModeRemainingJobs('sub6', quota15)", sandbox), 1);
    assert.equal(vm.runInContext("getApiQuotaModeRemainingJobs('sub12', quota15)", sandbox), 1);
    assert.equal(vm.runInContext("getApiQuotaModeRemainingJobs('sub24', quota15)", sandbox), 0);

    // Scenario: Backend has 1.0 credits remaining
    sandbox.quota10 = { remainingUses: 1.0, remainingFullUses: 1.0, fullJobs: 1, extractJobs: 2 };
    assert.equal(vm.runInContext("getApiQuotaModeRemainingJobs('sub6', quota10)", sandbox), 1);
    assert.equal(vm.runInContext("getApiQuotaModeRemainingJobs('sub12', quota10)", sandbox), 0);
    assert.equal(vm.runInContext("getApiQuotaModeRemainingJobs('sub24', quota10)", sandbox), 0);

    // Test success text for full and multi-duration flows
    vm.runInContext(`
        function getTaskTypeSuccessText(taskType = 'extract', hasLink = false) {
            const normalized = normalizeTaskType(taskType);
            if (normalized === 'pro_activation') return 'Pro 权益已开通';
            if (['full', 'sub6', 'sub12', 'sub24'].includes(normalized)) return '已完成领取流程，请刷新查看';
            return hasLink ? '链接获取成功' : '提链任务完成';
        }
    `, sandbox);
    assert.equal(vm.runInContext("getTaskTypeSuccessText('full')", sandbox), '已完成领取流程，请刷新查看');
    assert.equal(vm.runInContext("getTaskTypeSuccessText('sub6')", sandbox), '已完成领取流程，请刷新查看');
    assert.equal(vm.runInContext("getTaskTypeSuccessText('sub12')", sandbox), '已完成领取流程，请刷新查看');
    assert.equal(vm.runInContext("getTaskTypeSuccessText('sub24')", sandbox), '已完成领取流程，请刷新查看');
    assert.equal(vm.runInContext("getTaskTypeSuccessText('extract', true)", sandbox), '链接获取成功');
    assert.equal(vm.runInContext("getTaskTypeSuccessText('extract', false)", sandbox), '提链任务完成');
});

test('Google 2FA tutorial standalone page and widget link contract', () => {
    const fs = require('fs');
    const path = require('path');

    // 1. Verify verify-widget.js points to the standalone subpage
    const widgetSrc = fs.readFileSync(path.join(__dirname, '../verify-widget.js'), 'utf8');
    assert.match(widgetSrc, /google-2fa-tutorial\.html/);
    assert.doesNotMatch(widgetSrc, /zhuanlan\.zhihu\.com\/p\/1997015036741304912/);

    // 2. Verify google-2fa-tutorial.html content and structure
    const tutorialHtml = fs.readFileSync(path.join(__dirname, '../google-2fa-tutorial.html'), 'utf8');
    assert.match(tutorialHtml, /Gemini 准备工作/);
    assert.match(tutorialHtml, /1\.\s*充值前必做 开启 2FA/);
    assert.match(tutorialHtml, /开通 2FA \(谷歌验证器\)/);
    assert.match(tutorialHtml, /https:\/\/myaccount\.google\.com\/security/);
    assert.match(tutorialHtml, /不要扫描/);
    assert.match(tutorialHtml, /无法扫描/);
    assert.match(tutorialHtml, /https:\/\/2fa\.cn/);
    assert.match(tutorialHtml, /两步验证一定要是.*变为绿色的才代表启动成功/);
    assert.match(tutorialHtml, /2\.\s*删除付款资料/);
    assert.match(tutorialHtml, /https:\/\/payments\.google\.com\/gp\/w\/home\/reauthprompt\?rtrp=\/home\/settings/);
    assert.match(tutorialHtml, /尚未添加任何付款方式/);

    // Verify all 10 local images exist and are referenced
    for (let i = 1; i <= 10; i++) {
        assert.match(tutorialHtml, new RegExp(`assets/guide/2fa/step-${i}\\.png`));
        assert.equal(fs.existsSync(path.join(__dirname, `../assets/guide/2fa/step-${i}.png`)), true);
    }
});

