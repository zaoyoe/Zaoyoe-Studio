const {
    activateVerifyProviderConfig,
    loadVerifyRuntimeConfig,
    normalizeVerifyProvider,
    selectVerifyCredentialForTask
} = require('../_verify-provider-runtime');
const {
    buildClientStatusMessage,
    buildVerifyCredentialFingerprint,
    fetchUpstreamJobStatus,
    findTrackedJobLog,
    getApiErrorCode,
    getApiErrorMessage,
    getVerifyPriceForTaskType,
    isVerifyInsufficientBalanceError,
    normalizeVerifyJobPayload,
    normalizeVerifyTaskType,
    parseHistoryMessage,
    postVerifyJobAction,
    postVerifyProviderAction,
    resolveVerifyRequestSite,
    resolveVerifyApiKeyByFingerprint,
    syncTrackedJobStatus,
    validateUserBalance
} = require('../_verify-job-runtime');

function createPublicVerifyHandlers({
    admin,
    verifyRuntime,
    env = process.env,
    fetchImpl = global.fetch
} = {}) {
    const {
        getOptionalSupabaseAdmin,
        parseJsonBody,
        requireAuthenticatedUser,
        sendJson
    } = admin || {};
    const runtime = verifyRuntime || {};
    const runtimeActivateVerifyProviderConfig = runtime.activateVerifyProviderConfig || activateVerifyProviderConfig;
    const runtimeLoadVerifyRuntimeConfig = runtime.loadVerifyRuntimeConfig || loadVerifyRuntimeConfig;
    const runtimeSelectVerifyCredentialForTask = runtime.selectVerifyCredentialForTask || selectVerifyCredentialForTask;
    const runtimeBuildClientStatusMessage = runtime.buildClientStatusMessage || buildClientStatusMessage;
    const runtimeBuildVerifyCredentialFingerprint = runtime.buildVerifyCredentialFingerprint || buildVerifyCredentialFingerprint;
    const runtimeFetchUpstreamJobStatus = runtime.fetchUpstreamJobStatus || fetchUpstreamJobStatus;
    const runtimeFindTrackedJobLog = runtime.findTrackedJobLog || findTrackedJobLog;
    const runtimeGetApiErrorCode = runtime.getApiErrorCode || getApiErrorCode;
    const runtimeGetApiErrorMessage = runtime.getApiErrorMessage || getApiErrorMessage;
    const runtimeGetVerifyPriceForTaskType = runtime.getVerifyPriceForTaskType || getVerifyPriceForTaskType;
    const runtimeIsVerifyInsufficientBalanceError = runtime.isVerifyInsufficientBalanceError || isVerifyInsufficientBalanceError;
    const runtimeNormalizeVerifyJobPayload = runtime.normalizeVerifyJobPayload || normalizeVerifyJobPayload;
    const runtimeNormalizeVerifyTaskType = runtime.normalizeVerifyTaskType || normalizeVerifyTaskType;
    const runtimeParseHistoryMessage = runtime.parseHistoryMessage || parseHistoryMessage;
    const runtimePostVerifyJobAction = runtime.postVerifyJobAction || postVerifyJobAction;
    const runtimePostVerifyProviderAction = runtime.postVerifyProviderAction || postVerifyProviderAction;
    const runtimeResolveVerifyRequestSite = runtime.resolveVerifyRequestSite || resolveVerifyRequestSite;
    const runtimeResolveVerifyApiKeyByFingerprint = runtime.resolveVerifyApiKeyByFingerprint || resolveVerifyApiKeyByFingerprint;
    const runtimeSyncTrackedJobStatus = runtime.syncTrackedJobStatus || syncTrackedJobStatus;
    const runtimeValidateUserBalance = runtime.validateUserBalance || validateUserBalance;

    async function resolveHandlerContext(req) {
        if (typeof requireAuthenticatedUser !== 'function') {
            const error = new Error('Verify service is unavailable');
            error.statusCode = 503;
            throw error;
        }

        const auth = await requireAuthenticatedUser(req);
        const supabase = auth?.adminSupabase
            || auth?.supabase
            || (typeof getOptionalSupabaseAdmin === 'function' ? getOptionalSupabaseAdmin() : null);

        if (!supabase?.from) {
            const error = new Error('Verify service is unavailable');
            error.statusCode = 503;
            throw error;
        }

        return {
            user: auth.user,
            supabase
        };
    }

    async function submitHandler(req, res) {
        if (req.method !== 'POST') {
            res.setHeader('Allow', 'POST');
            return sendJson(res, 405, {
                success: false,
                message: 'Method not allowed'
            });
        }

        const { user, supabase } = await resolveHandlerContext(req);
        const body = typeof parseJsonBody === 'function'
            ? await parseJsonBody(req)
            : (req.body && typeof req.body === 'object' ? req.body : {});

        const {
            email,
            password,
            totpSecret,
            totp_secret,
            priority,
            site,
            taskType,
            task_type,
            provider,
            verifyProvider,
            verify_provider
        } = body || {};
        const normalizedEmail = String(email || '').trim().toLowerCase();
        const normalizedPassword = String(password || '');
        const normalizedTotpSecret = String(totpSecret || totp_secret || '').trim();
        const normalizedPriority = Number(priority) === 1 ? 1 : 0;
        const normalizedTaskType = runtimeNormalizeVerifyTaskType(taskType || task_type);
        const currentSite = runtimeResolveVerifyRequestSite(req, site);

        if (!normalizedEmail || !normalizedPassword || !normalizedTotpSecret) {
            return sendJson(res, 400, {
                success: false,
                message: '请提供邮箱、密码和 TOTP 密钥',
                code: 'missing_fields'
            });
        }

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
            return sendJson(res, 400, {
                success: false,
                message: '邮箱格式无效',
                code: 'invalid_email'
            });
        }

        const loadedConfig = await runtimeLoadVerifyRuntimeConfig(supabase, env, {
            site: currentSite
        });
        const requestedProvider = normalizeVerifyProvider(
            provider || verifyProvider || verify_provider || loadedConfig.provider,
            loadedConfig.provider
        );
        const config = runtimeActivateVerifyProviderConfig(loadedConfig, requestedProvider);
        if (!config.apiKey) {
            return sendJson(res, 500, {
                success: false,
                message: 'Google One 服务商 CDKey 未配置',
                code: 'api_key_missing'
            });
        }

        const priceForTask = runtimeGetVerifyPriceForTaskType(config, normalizedTaskType);
        const requiredUses = normalizedTaskType === 'full' ? 1 : 0.5;
        const balanceCheck = await runtimeValidateUserBalance({
            supabase,
            userId: user.id,
            requiredPoints: priceForTask,
            site: currentSite
        });

        if (!balanceCheck.valid) {
            return sendJson(res, balanceCheck.status, {
                success: false,
                message: balanceCheck.error
            });
        }

        const credentialSelection = await runtimeSelectVerifyCredentialForTask(config, requiredUses, {
            fetchImpl,
            taskType: normalizedTaskType
        });
        const selectedCredential = credentialSelection?.selected || null;
        const credentialCandidates = [
            selectedCredential,
            ...(Array.isArray(credentialSelection?.healthySnapshots) ? credentialSelection.healthySnapshots : [])
        ].filter((candidate, index, list) => {
            const apiKey = String(candidate?.apiKey || '').trim();
            return apiKey && list.findIndex((item) => String(item?.apiKey || '').trim() === apiKey) === index;
        });
        if (!credentialCandidates.length) {
            return sendJson(res, 400, {
                success: false,
                message: '当前剩余可提交任务的次数不足，请联系管理员补足后方可继续提交。',
                code: 'insufficient_balance'
            });
        }

        let upstream = null;
        let submittedCredential = null;
        for (const candidate of credentialCandidates) {
            upstream = await runtimePostVerifyProviderAction(config, {
                action: 'submit_task',
                cdkey: candidate.apiKey,
                email: normalizedEmail,
                password: normalizedPassword,
                twofa: normalizedTotpSecret,
                priority: normalizedPriority,
                task_type: normalizedTaskType
            }, {
                fetchImpl
            });
            submittedCredential = candidate;

            if (upstream.ok) {
                break;
            }

            const errorMessage = runtimeGetApiErrorMessage(upstream.payload, '任务提交失败');
            if (!runtimeIsVerifyInsufficientBalanceError(upstream.payload, errorMessage)) {
                break;
            }
        }

        if (!upstream.ok) {
            return sendJson(res, upstream.status || 502, {
                success: false,
                message: runtimeGetApiErrorMessage(upstream.payload, '任务提交失败'),
                code: runtimeGetApiErrorCode(upstream.payload)
            });
        }

        const apiData = runtimeNormalizeVerifyJobPayload(upstream.payload, {
            status: 'queued',
            task_type: normalizedTaskType,
            provider: config.provider,
            provider_adapter: config.adapter || config.provider_adapter,
            provider_key_fingerprint: runtimeBuildVerifyCredentialFingerprint(submittedCredential.apiKey),
            provider_key_name: submittedCredential.key_name || submittedCredential.keyName || ''
        });
        const jobId = String(apiData.job_id || apiData.task_id || '').trim();

        if (jobId) {
            await runtimeSyncTrackedJobStatus({
                supabase,
                userId: user.id,
                site: currentSite,
                email: normalizedEmail,
                jobId,
                apiData,
                config
            });
        }

        return sendJson(res, 200, {
            success: true,
            task_id: jobId,
            job_id: jobId,
            status: apiData.status || 'queued',
            task_type: apiData.task_type || normalizedTaskType,
            provider: apiData.provider || config.provider,
            provider_label: config.provider_label || config.providerLabel || '',
            provider_adapter: apiData.provider_adapter || config.adapter || config.provider_adapter || '',
            queue_position: apiData.queue_position ?? null,
            estimated_wait_seconds: apiData.estimated_wait_seconds ?? 0,
            stage: apiData.stage,
            total_stages: apiData.total_stages,
            stage_label: apiData.stage_label,
            raw_step: apiData.raw_step,
            step_status: apiData.step_status,
            provider_message: apiData.provider_message || '',
            provider_progress: apiData.provider_progress,
            progress: apiData.progress,
            elapsed_seconds: apiData.elapsed_seconds,
            message: apiData.message || '任务已提交',
            pricePerVerify: priceForTask
        });
    }

    async function statusHandler(req, res) {
        if (req.method !== 'GET') {
            res.setHeader('Allow', 'GET');
            return sendJson(res, 405, {
                success: false,
                message: 'Method not allowed'
            });
        }

        const { user, supabase } = await resolveHandlerContext(req);
        const url = new URL(req.url || '', 'http://localhost');
        const taskId = String(url.searchParams.get('taskId') || '').trim();
        const currentSite = runtimeResolveVerifyRequestSite(req, url.searchParams.get('site') || '');

        if (!taskId) {
            return sendJson(res, 400, {
                success: false,
                message: '缺少任务编号',
                code: 'job_not_found'
            });
        }

        const trackedRecord = await runtimeFindTrackedJobLog({
            supabase,
            userId: user.id,
            jobId: taskId,
            site: currentSite
        });

        if (!trackedRecord) {
            return sendJson(res, 404, {
                success: false,
                message: '任务不存在或无权访问',
                code: 'job_not_found'
            });
        }

        const trackedPayload = runtimeParseHistoryMessage(trackedRecord?.message) || {};
        const loadedConfig = await runtimeLoadVerifyRuntimeConfig(supabase, env, {
            site: currentSite
        });
        const config = runtimeActivateVerifyProviderConfig(
            loadedConfig,
            trackedPayload.provider || loadedConfig.provider
        );

        if (!config.apiKey) {
            return sendJson(res, 500, {
                success: false,
                message: '验证服务未配置',
                code: 'api_key_missing'
            });
        }

        const preferredApiKey = runtimeResolveVerifyApiKeyByFingerprint(config, trackedPayload.provider_key_fingerprint || '')
            || config.apiKey;
        const upstream = await runtimeFetchUpstreamJobStatus({
            ...config,
            apiKey: preferredApiKey
        }, taskId, {
            fetchImpl,
            apiKey: preferredApiKey,
            taskType: runtimeNormalizeVerifyTaskType(trackedPayload.task_type)
        });
        if (!upstream.ok) {
            return sendJson(res, upstream.status || 502, {
                success: false,
                message: upstream.message,
                code: upstream.code
            });
        }

        const normalizedApiData = runtimeNormalizeVerifyJobPayload(upstream.data, {
            task_type: runtimeNormalizeVerifyTaskType(trackedPayload.task_type),
            provider: trackedPayload.provider || config.provider,
            provider_adapter: trackedPayload.provider_adapter || config.adapter || config.provider_adapter,
            provider_key_fingerprint: trackedPayload.provider_key_fingerprint || '',
            provider_key_name: trackedPayload.provider_key_name || ''
        });
        const syncResult = await runtimeSyncTrackedJobStatus({
            supabase,
            userId: user.id,
            site: currentSite,
            email: String(trackedPayload.email || '').trim().toLowerCase(),
            jobId: taskId,
            apiData: normalizedApiData,
            config
        });

        return sendJson(res, 200, {
            success: normalizedApiData.status === 'success',
            job_id: normalizedApiData.job_id || taskId,
            status: normalizedApiData.status,
            stage: normalizedApiData.stage,
            total_stages: normalizedApiData.total_stages,
            stage_label: normalizedApiData.stage_label,
            task_type: normalizedApiData.task_type,
            provider: normalizedApiData.provider || config.provider,
            provider_label: config.provider_label || config.providerLabel || '',
            provider_adapter: normalizedApiData.provider_adapter || config.adapter || config.provider_adapter || '',
            has_offer_url: normalizedApiData.has_offer_url === true,
            url: normalizedApiData.url || '',
            error: normalizedApiData.error || '',
            created_at: normalizedApiData.created_at,
            elapsed_seconds: normalizedApiData.elapsed_seconds,
            queue_position: normalizedApiData.queue_position,
            estimated_wait_seconds: normalizedApiData.estimated_wait_seconds,
            raw_step: normalizedApiData.raw_step,
            step_status: normalizedApiData.step_status,
            provider_message: normalizedApiData.provider_message || '',
            provider_progress: normalizedApiData.provider_progress,
            progress: normalizedApiData.progress,
            message: runtimeBuildClientStatusMessage(normalizedApiData),
            pointsDeducted: Number(syncResult?.pointsDeducted) || 0
        });
    }

    async function actionHandler(req, res) {
        if (req.method !== 'POST') {
            res.setHeader('Allow', 'POST');
            return sendJson(res, 405, {
                success: false,
                message: 'Method not allowed'
            });
        }

        const { user, supabase } = await resolveHandlerContext(req);
        const body = typeof parseJsonBody === 'function'
            ? await parseJsonBody(req)
            : (req.body && typeof req.body === 'object' ? req.body : {});
        const action = String(body?.action || '').trim();
        const taskId = String(body?.taskId || body?.task_id || body?.jobId || body?.job_id || '').trim();
        const currentSite = runtimeResolveVerifyRequestSite(req, body?.site || '');

        if (!['cancel_task', 'purchase_failed_link'].includes(action)) {
            return sendJson(res, 400, {
                success: false,
                message: '不支持的任务操作',
                code: 'unsupported_action'
            });
        }

        if (!taskId) {
            return sendJson(res, 400, {
                success: false,
                message: '缺少任务编号',
                code: 'job_not_found'
            });
        }

        const trackedRecord = await runtimeFindTrackedJobLog({
            supabase,
            userId: user.id,
            jobId: taskId,
            site: currentSite
        });

        if (!trackedRecord) {
            return sendJson(res, 404, {
                success: false,
                message: '任务不存在或无权访问',
                code: 'job_not_found'
            });
        }

        const trackedPayload = runtimeParseHistoryMessage(trackedRecord?.message) || {};
        const loadedConfig = await runtimeLoadVerifyRuntimeConfig(supabase, env, {
            site: currentSite
        });
        const config = runtimeActivateVerifyProviderConfig(
            loadedConfig,
            trackedPayload.provider || loadedConfig.provider
        );

        if (!config.apiKey) {
            return sendJson(res, 500, {
                success: false,
                message: '验证服务未配置',
                code: 'api_key_missing'
            });
        }

        const preferredApiKey = runtimeResolveVerifyApiKeyByFingerprint(config, trackedPayload.provider_key_fingerprint || '')
            || config.apiKey;
        const upstream = await runtimePostVerifyJobAction(config, {
            action,
            jobId: taskId,
            apiKey: preferredApiKey,
            taskType: runtimeNormalizeVerifyTaskType(trackedPayload.task_type)
        }, {
            fetchImpl,
            apiKey: preferredApiKey
        });

        if (!upstream.ok) {
            return sendJson(res, upstream.status || 502, {
                success: false,
                message: upstream.message || '操作失败',
                code: upstream.code || 'job_action_failed'
            });
        }

        const normalizedApiData = runtimeNormalizeVerifyJobPayload(upstream.data || upstream.payload, {
            job_id: taskId,
            task_type: action === 'purchase_failed_link'
                ? 'extract'
                : runtimeNormalizeVerifyTaskType(trackedPayload.task_type),
            status: action === 'purchase_failed_link' ? 'success' : 'failed',
            provider: trackedPayload.provider || config.provider,
            provider_adapter: trackedPayload.provider_adapter || config.adapter || config.provider_adapter,
            provider_key_fingerprint: trackedPayload.provider_key_fingerprint || '',
            provider_key_name: trackedPayload.provider_key_name || ''
        });
        const syncResult = await runtimeSyncTrackedJobStatus({
            supabase,
            userId: user.id,
            site: currentSite,
            email: String(trackedPayload.email || '').trim().toLowerCase(),
            jobId: taskId,
            apiData: normalizedApiData,
            config
        });

        return sendJson(res, 200, {
            success: true,
            action,
            job_id: normalizedApiData.job_id || taskId,
            task_id: normalizedApiData.task_id || taskId,
            status: normalizedApiData.status,
            task_type: normalizedApiData.task_type,
            provider: normalizedApiData.provider || config.provider,
            provider_label: config.provider_label || config.providerLabel || '',
            has_offer_url: normalizedApiData.has_offer_url === true,
            url: normalizedApiData.url || '',
            offer_url: normalizedApiData.offer_url || normalizedApiData.url || '',
            message: runtimeBuildClientStatusMessage(normalizedApiData),
            pointsDeducted: Number(syncResult?.pointsDeducted) || 0,
            remaining_uses: upstream.payload?.remaining_uses ?? upstream.data?.remaining_uses ?? null
        });
    }

    return {
        action: async (req, res) => {
            try {
                return await actionHandler(req, res);
            } catch (error) {
                return sendJson(res, error.statusCode || 500, {
                    success: false,
                    message: error.message || 'Public verify action request failed'
                });
            }
        },
        status: async (req, res) => {
            try {
                return await statusHandler(req, res);
            } catch (error) {
                return sendJson(res, error.statusCode || 500, {
                    success: false,
                    message: error.message || 'Public verify status request failed'
                });
            }
        },
        submit: async (req, res) => {
            try {
                return await submitHandler(req, res);
            } catch (error) {
                return sendJson(res, error.statusCode || 500, {
                    success: false,
                    message: error.message || 'Public verify submit request failed'
                });
            }
        }
    };
}

module.exports = {
    createPublicVerifyHandlers
};
