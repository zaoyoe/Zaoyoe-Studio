/**
 * Google One Job Widget
 * Submit Google account jobs and poll job status
 */

(function () {
    'use strict';

    const CONFIG = {
        pricePerVerify: 10,
        pricePerVerifyExtract: 10,
        pricePerVerifyFull: 20,
        modeVisibility: 'both',
        enabled: true,
        nodeServerUrl: window.VERIFY_SERVER_URL || 'https://verify-api.fatherkey.com',
        containerId: 'verify-widget-container',
        pollInterval: 3000,
        pollTimeout: 300000,
        pollTimeoutExtract: 10 * 60 * 1000,
        pollTimeoutFull: 30 * 60 * 1000
    };
    const PENDING_TASK_STORAGE_KEY = 'verify_pending_google_one_job_v1';
    const VERIFY_QUOTA_CACHE_KEY = 'verify_api_quota_cache_v1';
    const VERIFY_STYLE_DECL_KEY = 'style';
    const VERIFY_HISTORY_SELECT = 'id, user_id, verification_id, status, message, points_deducted, created_at, site';
    const VERIFY_BATCH_MAX_ENTRIES = 50;
    const VERIFY_BATCH_SUBMIT_CONCURRENCY = 2;
    const SUBMISSION_COUNT_SHORTAGE_MESSAGE_ZH = '当前剩余可提交任务的次数不足，请联系管理员补足后方可继续提交。';
    const SUBMISSION_COUNT_SHORTAGE_MESSAGE_EN = 'The remaining task submission count is insufficient. Please contact the admin to add more before continuing.';

    let currentUser = null;
    let userBalance = 0;
    let apiCredits = -1;
    let apiQuotaSummary = null;
    let apiUsageCosts = { extract: 0.5, full: 1 };
    let isLoading = false;
    let batchStats = { success: 0, failed: 0, total: 0 };
    let activeTasks = new Map(); // jobId -> { index, email, timer }
    let historyData = [];
    let authBootstrapResolved = false;
    let hadOptimisticLogin = false;
    let authNullConfirmTimer = null;
    let walletBalanceListenerBound = false;
    let quotaRefreshTimer = null;
    let quotaRefreshPending = false;
    let previewMode = 'success';
    let verifySubmitMode = 'single';
    let previewTimers = [];
    let ringResetTimer = null;
    let historyRepairInFlight = false;
    const attemptedHistoryRepairIds = new Set();

    const ERROR_CODE_MAP = {
        invalid_api_key: { zh: 'API Key 无效或缺失', en: 'Invalid or missing API key' },
        insufficient_balance: {
            zh: SUBMISSION_COUNT_SHORTAGE_MESSAGE_ZH,
            en: SUBMISSION_COUNT_SHORTAGE_MESSAGE_EN
        },
        already_queued: { zh: '该邮箱已在队列中', en: 'This email is already queued' },
        already_processed: { zh: '该邮箱已经成功处理过', en: 'This email was already processed' },
        service_paused: { zh: 'API 服务已暂停', en: 'API service is paused' },
        job_not_found: { zh: '任务不存在', en: 'Job not found' },
        sso_blocked: { zh: '不支持 SSO 域名邮箱', en: 'SSO domain accounts are not supported' },
        no_devices: { zh: '当前没有可用设备', en: 'No devices available' },
        missing_fields: { zh: '请填写邮箱、密码和 TOTP 密钥', en: 'Email, password, and TOTP secret are required' },
        invalid_email: { zh: '邮箱格式不正确', en: 'Invalid email format' },
        api_key_missing: { zh: '服务端未配置 API Key', en: 'API key is not configured on the server' },
        redeem_not_supported: { zh: '新版 API 不支持卡密兑换', en: 'Redeem is not supported by the new API' },
        cancel_not_supported: { zh: '新版 API 不支持取消任务', en: 'Cancel is not supported by the new API' },
        provider_action_not_supported: { zh: '当前通道不支持这个任务操作', en: 'This channel does not support this job action' },
        job_action_failed: { zh: '任务操作失败', en: 'Job action failed' },
        INTERNAL_ERROR: { zh: '系统内部错误', en: 'Internal error' },
        DEVICE_UNAVAILABLE: { zh: '设备不可用', en: 'Device unavailable' },
        DEVICE_PREP_FAILED: { zh: '设备准备失败', en: 'Device preparation failed' },
        PROXY_ERROR: { zh: '代理连接错误', en: 'Proxy connection error' },
        PASSKEY_BLOCKED: { zh: '账号要求 Passkey 验证', en: 'Passkey verification is required' },
        CAPTCHA: { zh: '遇到人机验证', en: 'Captcha encountered' },
        ACCOUNT_DISABLED: { zh: '账号已被停用或锁定', en: 'Account disabled or locked' },
        INVALID_EMAIL: { zh: '邮箱地址无效或不存在', en: 'Invalid or unavailable email address' },
        WRONG_PASSWORD: { zh: '密码错误', en: 'Wrong password' },
        TOTP_ERROR: { zh: 'TOTP 验证失败', en: 'Invalid TOTP code' },
        NO_AUTHENTICATOR: { zh: '账号未启用 TOTP 验证器', en: 'No authenticator configured' },
        SIGNIN_PAGE_FAILED: { zh: '登录页面加载失败', en: 'Failed to load sign-in page' },
        TWOFACTOR_PAGE_ERROR: { zh: '两步验证页面异常', en: 'Two-factor page error' },
        GOOGLE_LOGIN_ERROR: { zh: 'Google 登录过程异常', en: 'Google login error' },
        GOOGLE_ONE_UNAVAILABLE: { zh: '该账号不可使用 Google One 试用', en: 'Google One trial unavailable' },
        URL_CAPTURE_FAILED: { zh: '链接获取失败', en: 'Failed to capture the link' },
        SIGNIN_FAILED: { zh: '登录失败', en: 'Sign-in failed' },
        ACCOUNT_NOT_DETECTED: { zh: '登录后未检测到账号', en: 'Account was not detected after login' },
        BROWSER_LOGIN_FAILED: { zh: '浏览器登录失败', en: 'Browser login failed' },
        UNKNOWN_ERROR: { zh: '未知错误', en: 'Unknown error' }
    };

    function getUserId(user) {
        return user?.id || user?.user_id || user?.objectId || null;
    }

    function getCurrentSiteValue() {
        return window.SiteConfig?.site || 'cn';
    }

    function getQuotaCacheKey(site = getCurrentSiteValue()) {
        return `${VERIFY_QUOTA_CACHE_KEY}:${String(site || 'cn').trim().toLowerCase() || 'cn'}`;
    }

    function buildVerifyStatusEndpoints(jobId) {
        const encodedJobId = encodeURIComponent(String(jobId || '').trim());
        const encodedSite = encodeURIComponent(getCurrentSiteValue());

        return [
            `/api/public?scope=verify&route=status&taskId=${encodedJobId}&site=${encodedSite}`,
            `${CONFIG.nodeServerUrl}/api/verify/status/${encodedJobId}?site=${encodedSite}`
        ];
    }

    function buildVerifyActionEndpoints() {
        return [
            '/api/public?scope=verify&route=action',
            `${CONFIG.nodeServerUrl}/api/verify/action`
        ];
    }

    function normalizeVerifyClientStatus(data = {}) {
        const rawStatus = typeof data === 'string'
            ? data
            : (data?.status || data?.raw_status || '');
        const normalized = String(rawStatus || '').trim().toLowerCase().replace(/[\s-]+/g, '_');

        if (['success', 'completed', 'complete', 'done', 'ok'].includes(normalized)) {
            return 'success';
        }

        if (['failed', 'failure', 'fail', 'error', 'timeout', 'timed_out', 'cancelled', 'canceled'].includes(normalized)) {
            return 'failed';
        }

        if (['running', 'processing', 'working', 'in_progress', 'executing'].includes(normalized)) {
            return 'running';
        }

        if (['queued', 'queueing', 'waiting', 'pending'].includes(normalized)) {
            return 'queued';
        }

        if (!normalized && typeof data === 'object') {
            if (data?.success === true && (data?.url || data?.offer_url || data?.has_offer_url === true)) {
                return 'success';
            }
            if (data?.success === false && (data?.error || data?.code)) {
                return 'failed';
            }
        }

        return normalized;
    }

    function pickFiniteNumber(...values) {
        for (const value of values) {
            if (value === null || value === undefined || value === '') {
                continue;
            }
            const num = Number(value);
            if (Number.isFinite(num)) {
                return num;
            }
        }
        return null;
    }

    function normalizeNonNegativeAmount(value) {
        const num = Number(value);
        if (!Number.isFinite(num) || num < 0) return null;
        return Math.max(0, Math.round(num * 100) / 100);
    }

    function normalizeJobCount(value) {
        const num = Number(value);
        if (!Number.isFinite(num)) return null;
        return Math.max(0, Math.floor(num + 1e-9));
    }

    function readCachedApiQuota(site = getCurrentSiteValue()) {
        try {
            const raw = localStorage.getItem(getQuotaCacheKey(site));
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            const value = pickFiniteNumber(parsed?.balance, parsed?.credits, parsed?.remaining_uses, parsed?.remainingUses);
            if (!Number.isFinite(value)) return null;
            return {
                balance: value,
                remaining_uses: value,
                remaining_extract_uses: pickFiniteNumber(parsed?.remaining_extract_uses, parsed?.remainingExtractUses),
                remaining_full_uses: pickFiniteNumber(parsed?.remaining_full_uses, parsed?.remainingFullUses),
                remaining_extract_jobs: pickFiniteNumber(parsed?.remaining_extract_jobs, parsed?.remainingExtractJobs, parsed?.extractJobs),
                remaining_full_jobs: pickFiniteNumber(parsed?.remaining_full_jobs, parsed?.remainingFullJobs, parsed?.fullJobs),
                extractCostPerJob: pickFiniteNumber(parsed?.extract_cost_per_job, parsed?.extractCostPerJob),
                fullCostPerJob: pickFiniteNumber(parsed?.full_cost_per_job, parsed?.fullCostPerJob)
            };
        } catch (_) {
            return null;
        }
    }

    function normalizeApiUsageCosts(costs = {}) {
        const extract = Number(costs.extract ?? costs.extract_cost_per_job ?? costs.extractCostPerJob);
        const full = Number(costs.full ?? costs.full_cost_per_job ?? costs.fullCostPerJob);
        return {
            extract: Number.isFinite(extract) && extract > 0 ? extract : 0.5,
            full: Number.isFinite(full) && full > 0 ? full : 1
        };
    }

    function applyApiUsageCosts(costs = {}) {
        apiUsageCosts = normalizeApiUsageCosts({
            ...apiUsageCosts,
            ...costs
        });
    }

    function normalizeApiQuotaSummary(data = {}, fallbackBalance = null) {
        const rawExtractJobs = pickFiniteNumber(data?.remaining_extract_jobs, data?.remainingExtractJobs, data?.extractJobs);
        const rawFullJobs = pickFiniteNumber(data?.remaining_full_jobs, data?.remainingFullJobs, data?.fullJobs);
        const rawExtractUses = pickFiniteNumber(data?.remaining_extract_uses, data?.remainingExtractUses);
        const rawFullUses = pickFiniteNumber(data?.remaining_full_uses, data?.remainingFullUses);
        const extractCost = getTaskTypeUsageCost('extract');
        const fullCost = getTaskTypeUsageCost('full');
        const typedExtractUses = normalizeNonNegativeAmount(rawExtractUses);
        const typedFullUses = normalizeNonNegativeAmount(rawFullUses);
        const typedExtractUsesFromJobs = rawExtractJobs !== null
            ? normalizeNonNegativeAmount(normalizeJobCount(rawExtractJobs) * extractCost)
            : null;
        const typedFullUsesFromJobs = rawFullJobs !== null
            ? normalizeNonNegativeAmount(normalizeJobCount(rawFullJobs) * fullCost)
            : null;
        const hasTypedQuota = rawExtractJobs !== null
            || rawFullJobs !== null
            || rawExtractUses !== null
            || rawFullUses !== null;

        let rawBalance = pickFiniteNumber(
            data?.remaining_uses,
            data?.remainingUses,
            data?.balance,
            data?.credits,
            fallbackBalance
        );
        if (rawBalance === null && hasTypedQuota) {
            rawBalance = [
                typedExtractUses ?? typedExtractUsesFromJobs,
                typedFullUses ?? typedFullUsesFromJobs
            ].reduce((sum, value) => sum + (Number.isFinite(Number(value)) ? Number(value) : 0), 0);
        }
        const remainingUses = normalizeNonNegativeAmount(rawBalance);
        if (remainingUses === null) {
            return null;
        }

        const extractJobs = rawExtractJobs !== null
            ? normalizeJobCount(rawExtractJobs)
            : typedExtractUses !== null
                ? getRemainingTaskCount(typedExtractUses, 'extract')
                : hasTypedQuota
                    ? 0
                    : getRemainingTaskCount(remainingUses, 'extract');
        const fullJobs = rawFullJobs !== null
            ? normalizeJobCount(rawFullJobs)
            : typedFullUses !== null
                ? getRemainingTaskCount(typedFullUses, 'full')
                : hasTypedQuota
                    ? 0
                    : getRemainingTaskCount(remainingUses, 'full');

        return {
            remainingUses,
            remainingExtractUses: typedExtractUses
                ?? typedExtractUsesFromJobs
                ?? (hasTypedQuota ? 0 : remainingUses),
            remainingFullUses: typedFullUses
                ?? typedFullUsesFromJobs
                ?? (hasTypedQuota ? 0 : remainingUses),
            extractJobs: extractJobs ?? 0,
            fullJobs: fullJobs ?? 0,
            hasTypedQuota
        };
    }

    function formatApiQuotaShortageMessage() {
        return getSubmissionCountShortageMessage();
    }

    function persistCachedApiQuota(value, site = getCurrentSiteValue(), costs = apiUsageCosts, quotaSummary = null) {
        try {
            const balance = Number(value);
            if (!Number.isFinite(balance)) return;
            const normalizedCosts = normalizeApiUsageCosts(costs);
            const normalizedSummary = normalizeApiQuotaSummary(quotaSummary || { balance }, balance);
            localStorage.setItem(getQuotaCacheKey(site), JSON.stringify({
                balance: Math.max(0, Math.round(balance * 100) / 100),
                remaining_uses: normalizedSummary?.remainingUses,
                remaining_extract_uses: normalizedSummary?.remainingExtractUses,
                remaining_full_uses: normalizedSummary?.remainingFullUses,
                remaining_extract_jobs: normalizedSummary?.extractJobs,
                remaining_full_jobs: normalizedSummary?.fullJobs,
                extract_cost_per_job: normalizedCosts.extract,
                full_cost_per_job: normalizedCosts.full,
                checked_at: new Date().toISOString()
            }));
        } catch (_) {
            // ignore cache write errors
        }
    }

    function getVerifySourceValue() {
        try {
            const url = new URL(window.location.href);
            return String(url.searchParams.get('source') || '').trim();
        } catch (_error) {
            return '';
        }
    }

    function trackVerifyAnalyticsEvent(eventName, payload = {}, options = {}) {
        const tracker = window.UserEventTracker;
        if (!tracker || typeof tracker.track !== 'function') {
            return;
        }

        const metadata = payload?.metadata && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata)
            ? payload.metadata
            : {};
        const source = getVerifySourceValue();
        const normalizedPayload = {
            module: payload.module || 'verify_widget',
            entityType: payload.entityType || 'verify_task',
            entityId: payload.entityId || null,
            eventValue: payload.eventValue ?? null,
            pointsDelta: payload.pointsDelta ?? null,
            metadata: source ? { source, ...metadata } : metadata
        };

        const trackingPromise = options.dedupeKey && typeof tracker.trackOnce === 'function'
            ? tracker.trackOnce(options.dedupeKey, eventName, normalizedPayload, { eventType: options.eventType || 'conversion' })
            : tracker.track(eventName, normalizedPayload, { eventType: options.eventType || 'conversion' });

        void Promise.resolve(trackingPromise).catch((error) => {
            console.debug('[VerifyAnalytics] Track failed:', eventName, error?.message || error);
        });
    }

    function triggerVerifyEngagementEvent(triggerType = 'page_view', metadata = {}, options = {}) {
        const trigger = window.ZaoyoeEngagement?.trigger;
        if (typeof trigger !== 'function') return null;
        const normalizedMetadata = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
            ? metadata
            : {};
        try {
            return trigger(triggerType, {
                source_module: 'verify_widget',
                page_id: 'verify',
                site: getCurrentSiteValue(),
                ...normalizedMetadata
            }, {
                once: options.once !== false
            });
        } catch (error) {
            console.debug('[VerifyEngagement] Trigger skipped:', triggerType, error?.message || error);
            return null;
        }
    }

    function buildVerifySubmitButtonMarkup(label) {
        return `<i class="fas fa-paper-plane"></i> ${label}`;
    }

    function normalizeSubmitMode(value) {
        return String(value || '').trim().toLowerCase() === 'batch' ? 'batch' : 'single';
    }

    function normalizeTaskType(value, fallback = 'extract') {
        const normalized = String(value || '').trim().toLowerCase();
        if (normalized === 'full') return 'full';
        if (normalized === 'extract') return 'extract';
        return fallback;
    }

    function normalizeVerifyModeVisibility(value) {
        const normalized = String(value || '').trim().toLowerCase();
        return ['both', 'extract_only', 'full_only'].includes(normalized) ? normalized : 'both';
    }

    function getAvailableTaskTypes() {
        const modeVisibility = normalizeVerifyModeVisibility(CONFIG.modeVisibility);
        if (modeVisibility === 'full_only') return ['full'];
        if (modeVisibility === 'extract_only') return ['extract'];
        return ['extract', 'full'];
    }

    function getDefaultTaskType() {
        return getAvailableTaskTypes()[0] || 'extract';
    }

    function isTaskTypeAvailable(taskType = 'extract') {
        return getAvailableTaskTypes().includes(normalizeTaskType(taskType));
    }

    function getTaskTypePrice(taskType = 'extract') {
        return normalizeTaskType(taskType) === 'full'
            ? Number(CONFIG.pricePerVerifyFull || CONFIG.pricePerVerifyExtract || CONFIG.pricePerVerify || 20)
            : Number(CONFIG.pricePerVerifyExtract || CONFIG.pricePerVerify || 10);
    }

    function getTaskTypeUsageCost(taskType = 'extract') {
        const usageCosts = normalizeApiUsageCosts(apiUsageCosts);
        return normalizeTaskType(taskType) === 'full' ? usageCosts.full : usageCosts.extract;
    }

    function getTaskPollTimeoutMs(taskType = 'extract') {
        const fallbackTimeout = Number(CONFIG.pollTimeout) || 300000;
        const configuredTimeout = normalizeTaskType(taskType) === 'full'
            ? Number(CONFIG.pollTimeoutFull)
            : Number(CONFIG.pollTimeoutExtract);
        return Math.max(fallbackTimeout, Number.isFinite(configuredTimeout) && configuredTimeout > 0
            ? configuredTimeout
            : fallbackTimeout);
    }

    function getTaskTypeLabel(taskType = 'extract') {
        const normalized = normalizeTaskType(taskType);
        return normalized === 'full'
            ? t('verify.taskTypeFull', '全流程包绑卡')
            : t('verify.taskTypeExtract', '仅提取链接');
    }

    function getApiQuotaModeRemainingJobs(taskType = 'extract', quotaSummary = buildQuotaSummary(apiCredits)) {
        const normalized = normalizeTaskType(taskType);
        return normalized === 'full'
            ? quotaSummary?.fullJobs ?? 0
            : quotaSummary?.extractJobs ?? 0;
    }

    function updateSystemRemainingDisplay(quotaSummary = buildQuotaSummary(apiCredits)) {
        const remainingEl = document.getElementById('verifySystemRemainingCount');
        if (!remainingEl) return;
        if (apiCredits < 0) {
            remainingEl.textContent = '--';
            return;
        }
        remainingEl.textContent = formatBalanceValue(getApiQuotaModeRemainingJobs(getSelectedTaskType(), quotaSummary));
    }

    function getTaskTypeSubmitLabel(taskType = 'extract') {
        return t('verify.startTask', '提交任务');
    }

    function getSubmitButtonLabel(taskType = getSelectedTaskType()) {
        if (verifySubmitMode === 'batch') {
            return normalizeTaskType(taskType) === 'full'
                ? t('verify.startBatchFullTask', '批量提交包绑卡')
                : t('verify.startBatchExtractTask', '批量提交提链');
        }
        return getTaskTypeSubmitLabel(taskType);
    }

    function getTaskTypeSuccessText(taskType = 'extract', hasLink = false) {
        if (normalizeTaskType(taskType) === 'full') {
            return t('verify.fullSuccessText', '包绑卡流程完成');
        }
        return hasLink
            ? t('verify.extractSuccessText', '链接获取成功')
            : t('verify.extractCompleteText', '提链任务完成');
    }

    function getTaskTypeGuideText(taskType = 'extract') {
        if (normalizeTaskType(taskType) === 'full') {
            return t('verify.fullGuideNote', '全流程模式会由服务商完成绑卡与订阅，不需要你再手动开链接。');
        }
        return t('verify.extractGuideNote', '提链模式成功后，请自行打开链接完成绑卡订阅；没有卡可前往商城购卡。');
    }

    function getTaskTypeModeMeta(taskType = 'extract') {
        const normalized = normalizeTaskType(taskType);
        if (normalized === 'full') {
            return {
                badge: t('verify.modeBadgeFull', '服务商包绑卡'),
                description: t('verify.modeDescFull', '完成 Google One 订阅流程'),
                price: getTaskTypePrice('full')
            };
        }

        return {
            badge: t('verify.modeBadgeExtract', '自行绑卡'),
            description: t('verify.modeDescExtract', '仅拿到可用订阅链接'),
            price: getTaskTypePrice('extract')
        };
    }

    function getSelectedTaskType() {
        const checked = document.querySelector('input[name="verifyTaskType"]:checked');
        const normalized = normalizeTaskType(checked?.value || getDefaultTaskType(), getDefaultTaskType());
        return isTaskTypeAvailable(normalized) ? normalized : getDefaultTaskType();
    }

    function setSelectedTaskType(taskType = 'extract') {
        const normalized = isTaskTypeAvailable(taskType)
            ? normalizeTaskType(taskType)
            : getDefaultTaskType();
        const target = document.querySelector(`input[name="verifyTaskType"][value="${normalized}"]`);
        if (target) {
            target.checked = true;
        }
        updateTaskTypeUi();
    }

    function updateTaskTypeUi() {
        const taskType = getSelectedTaskType();
        const modeMeta = getTaskTypeModeMeta(taskType);
        const singleCost = document.getElementById('verifySingleCost');
        const submitBtn = document.getElementById('verifySubmitBtn');
        const taskTypeNote = document.getElementById('verifyTaskTypeNote');
        const extractPriceEl = document.getElementById('verifyExtractModePrice');
        const fullPriceEl = document.getElementById('verifyFullModePrice');
        const extractMetaEl = document.getElementById('verifyExtractModeMeta');
        const fullMetaEl = document.getElementById('verifyFullModeMeta');

        if (singleCost) singleCost.textContent = modeMeta.price;
        if (submitBtn && !isLoading) {
            submitBtn.innerHTML = buildVerifySubmitButtonMarkup(getSubmitButtonLabel(taskType));
        }
        if (taskTypeNote) {
            taskTypeNote.textContent = getTaskTypeGuideText(taskType);
        }
        if (extractPriceEl) extractPriceEl.textContent = getTaskTypePrice('extract');
        if (fullPriceEl) fullPriceEl.textContent = getTaskTypePrice('full');
        if (extractMetaEl) extractMetaEl.textContent = getTaskTypeModeMeta('extract').description;
        if (fullMetaEl) fullMetaEl.textContent = getTaskTypeModeMeta('full').description;
        updateQuotaDisplay();
    }

    function syncModeSelectorFromConfig() {
        const modeSelector = document.querySelector('.verify-mode-selector');
        if (!modeSelector) return false;

        const availableTaskTypes = getAvailableTaskTypes();
        const showExtractMode = availableTaskTypes.includes('extract');
        const showFullMode = availableTaskTypes.includes('full');
        const extractOption = modeSelector.querySelector('input[name="verifyTaskType"][value="extract"]')?.closest('.verify-mode-option');
        const fullOption = modeSelector.querySelector('input[name="verifyTaskType"][value="full"]')?.closest('.verify-mode-option');

        if (extractOption) {
            extractOption.hidden = !showExtractMode;
        }
        if (fullOption) {
            fullOption.hidden = !showFullMode;
        }

        modeSelector.classList.toggle('verify-mode-selector--single', availableTaskTypes.length <= 1);
        setSelectedTaskType(getSelectedTaskType());
        return true;
    }

    function isTransientAvatarUrl(url) {
        if (!url) return false;
        return /googleusercontent\.com|lh3\.googleusercontent\.com/i.test(String(url));
    }

    function isGeneratedAvatarUrl(url) {
        if (!url) return false;
        return /ui-avatars\.com|dicebear\.com/i.test(String(url));
    }

    function readCachedProfile() {
        try {
            const raw = localStorage.getItem('cached_user_profile');
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            const userId = getUserId(parsed);
            if (!userId) return null;
            return {
                ...parsed,
                id: parsed.id || userId,
                user_id: parsed.user_id || userId,
                objectId: parsed.objectId || userId
            };
        } catch (_) {
            return null;
        }
    }

    function persistMergedCachedProfile(authUser) {
        const authUserId = getUserId(authUser);
        if (!authUserId) return;

        const cached = readCachedProfile() || {};
        const incomingMeta = (authUser?.user_metadata && typeof authUser.user_metadata === 'object')
            ? authUser.user_metadata
            : {};
        const cachedMeta = (cached?.user_metadata && typeof cached.user_metadata === 'object')
            ? cached.user_metadata
            : {};

        const merged = {
            ...cached,
            id: authUserId,
            user_id: authUserId,
            objectId: authUserId,
            email: authUser?.email || cached?.email || '',
            user_metadata: { ...cachedMeta, ...incomingMeta }
        };

        const incomingNickname = typeof authUser?.nickname === 'string' ? authUser.nickname.trim() : '';
        const metadataName = typeof incomingMeta?.full_name === 'string' ? incomingMeta.full_name.trim() : '';
        if (!merged.nickname && (incomingNickname || metadataName)) {
            merged.nickname = incomingNickname || metadataName;
        }

        const incomingAvatarRaw = typeof authUser?.avatarUrl === 'string' ? authUser.avatarUrl.trim() : '';
        const metadataAvatarRaw = typeof incomingMeta?.avatar_url === 'string' ? incomingMeta.avatar_url.trim() : '';
        const incomingAvatar = isTransientAvatarUrl(incomingAvatarRaw) ? '' : incomingAvatarRaw;
        const metadataAvatar = isTransientAvatarUrl(metadataAvatarRaw) ? '' : metadataAvatarRaw;
        if (!merged.avatarUrl && (incomingAvatar || metadataAvatar)) {
            merged.avatarUrl = incomingAvatar || metadataAvatar;
        }

        if (isGeneratedAvatarUrl(merged.avatarUrl) || isTransientAvatarUrl(merged.avatarUrl)) {
            delete merged.avatarUrl;
        }

        localStorage.setItem('cached_user_profile', JSON.stringify(merged));
    }

    function normalizePendingTask(task) {
        if (!task || typeof task !== 'object') return null;

        const jobId = String(task.jobId || task.job_id || '').trim();
        const email = String(task.email || '').trim().toLowerCase();
        const userId = String(task.userId || task.user_id || '').trim();
        const site = String(task.site || getCurrentSiteValue()).trim() || 'cn';
        const createdAt = String(task.createdAt || task.created_at || new Date().toISOString()).trim();
        const taskType = normalizeTaskType(task.taskType || task.task_type || 'extract');

        if (!jobId || !email || !userId) return null;

        return { jobId, email, userId, site, createdAt, taskType };
    }

    function readPendingTask() {
        try {
            const raw = localStorage.getItem(PENDING_TASK_STORAGE_KEY);
            if (!raw) return null;
            const normalized = normalizePendingTask(JSON.parse(raw));
            if (!normalized) {
                localStorage.removeItem(PENDING_TASK_STORAGE_KEY);
                return null;
            }
            return normalized;
        } catch (_) {
            localStorage.removeItem(PENDING_TASK_STORAGE_KEY);
            return null;
        }
    }

    function persistPendingTask(task) {
        const normalized = normalizePendingTask(task);
        if (!normalized) return;
        localStorage.setItem(PENDING_TASK_STORAGE_KEY, JSON.stringify(normalized));
    }

    function clearPendingTask(jobId = '') {
        const pending = readPendingTask();
        if (!pending) return;
        if (!jobId || pending.jobId === jobId) {
            localStorage.removeItem(PENDING_TASK_STORAGE_KEY);
        }
    }

    function clearActiveTaskTimers() {
        activeTasks.forEach((task) => {
            if (task?.timer) clearInterval(task.timer);
        });
        activeTasks.clear();
    }

    function getLang() {
        return window.i18n?.getCurrentLanguage?.() || 'zh';
    }

    function getLocale() {
        return getLang() === 'zh' ? 'zh-CN' : 'en-US';
    }

    function getShopUrl() {
        const hostname = String(window.location.hostname || '').toLowerCase().replace(/^www\./, '');
        if (hostname === 'zaoyoe.xyz') return 'https://www.zaoyoe.xyz/shop';
        if (hostname === 'zaoyoe.com') return 'https://www.fatherkey.com/shop.html';
        return `${window.location.origin.replace(/\/$/, '')}/shop.html`;
    }

    function openLoginGate() {
        try {
            if (typeof window.openLoginModal === 'function') {
                const result = window.openLoginModal();
                if (result && typeof result.catch === 'function') {
                    result.catch((error) => {
                        console.warn('[VerifyWidget] Failed to open login modal:', error);
                    });
                }
                return true;
            }
            if (typeof window.toggleLoginModal === 'function') {
                window.toggleLoginModal();
                return true;
            }
        } catch (error) {
            console.warn('[VerifyWidget] Failed to open login modal:', error);
        }
        return false;
    }

    function t(key, fallback) {
        if (window.i18n && typeof window.i18n.t === 'function') {
            const translated = window.i18n.t(key);
            if (translated && translated !== key) {
                return translated;
            }
        }
        return fallback || key;
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    async function openVerifyWalletBalance() {
        const context = {
            entry: 'verify_balance',
            sourceModule: 'verify_widget'
        };

        const loader = window.ZaoyoeWalletModalBootstrap;
        if (loader?.open) {
            try {
                await loader.open('balance', context);
                return;
            } catch (error) {
                console.warn('[VerifyWidget] Failed to lazy load wallet modal:', error?.message || error);
            }
        }

        window.WalletModal?.open?.('balance', context);
    }

    function bindDelegatedUi(container) {
        if (!container || container.dataset.verifyDelegatesBound === '1') {
            return;
        }

        container.dataset.verifyDelegatesBound = '1';
        container.addEventListener('click', (event) => {
            const actionEl = event.target.closest('[data-verify-action]');
            if (!actionEl || !container.contains(actionEl)) {
                return;
            }

            switch (actionEl.dataset.verifyAction) {
                case 'wallet-open':
                    void openVerifyWalletBalance();
                    break;
                case 'switch-extract-mode':
                    setSelectedTaskType('extract');
                    syncRingStateFromInputs();
                    break;
                case 'switch-full-mode':
                    setSelectedTaskType('full');
                    syncRingStateFromInputs();
                    break;
                case 'set-submit-mode':
                    setSubmitMode(actionEl.dataset.verifyMode || 'single');
                    syncRingStateFromInputs();
                    break;
                case 'login-gate':
                    openLoginGate();
                    break;
                case 'toggle-password':
                    togglePasswordVisibility();
                    break;
                case 'reset-form':
                    resetForm();
                    break;
                case 'submit':
                    submit();
                    break;
                case 'export-history':
                    exportHistory();
                    break;
                case 'refresh-history':
                    loadHistory();
                    break;
                case 'copy-history-id':
                    copyId(actionEl);
                    break;
                case 'cancel-task':
                    void handleHistoryJobAction('cancel_task', actionEl);
                    break;
                case 'purchase-failed-link':
                    void handleHistoryJobAction('purchase_failed_link', actionEl);
                    break;
                default:
                    break;
            }
        });
    }

    function clampProgress(value) {
        const num = Number(value);
        if (!Number.isFinite(num)) return 0;
        return Math.max(0, Math.min(100, num));
    }

    function getProviderProgress(data = {}) {
        const raw = data?.provider_progress
            ?? data?.progress
            ?? data?.progress_percent
            ?? data?.progressPercentage
            ?? data?.percentage
            ?? data?.percent;
        if (raw === null || raw === undefined || raw === '') {
            return null;
        }

        const parsed = Number(raw);
        if (!Number.isFinite(parsed)) {
            return null;
        }

        return clampProgress(parsed > 0 && parsed <= 1 ? parsed * 100 : parsed);
    }

    function getProviderStageLabel(data = {}) {
        return formatStageLabel(data?.stage_label || data?.raw_step || data?.step);
    }

    function getProviderMessage(data = {}) {
        return String(data?.provider_message || '').trim();
    }

    function getProviderStepStatusLabel(data = {}) {
        const status = String(data?.step_status || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
        const lang = getLang();
        const labelMap = {
            running: { zh: '进行中', en: 'Running' },
            processing: { zh: '进行中', en: 'Processing' },
            working: { zh: '进行中', en: 'Working' },
            done: { zh: '已完成', en: 'Done' },
            success: { zh: '已完成', en: 'Done' },
            failed: { zh: '异常', en: 'Failed' },
            fail: { zh: '异常', en: 'Failed' },
            error: { zh: '异常', en: 'Error' }
        };

        return labelMap[status]?.[lang] || labelMap[status]?.zh || '';
    }

    function getWidgetElement() {
        return document.querySelector(`#${CONFIG.containerId} .verify-widget`) || document.querySelector('.verify-widget');
    }

    function setVerifyRuntimeStyles(target, styles = {}, priority = '') {
        if (!target || !styles || typeof styles !== 'object') return;
        const styleDecl = Reflect.get(target, VERIFY_STYLE_DECL_KEY);
        if (!styleDecl) return;

        Object.entries(styles).forEach(([name, value]) => {
            if (value === null || value === undefined || value === '') {
                styleDecl.removeProperty(name);
            } else {
                styleDecl.setProperty(name, String(value), priority);
            }
        });
    }

    function setVerifyHidden(target, hidden) {
        if (!target) return;
        target.hidden = !!hidden;
    }

    function setVerifyQuotaTone(target, tone = 'unknown') {
        if (!target) return;
        target.classList.remove(
            'verify-api-quota--unknown',
            'verify-api-quota--ok',
            'verify-api-quota--warning',
            'verify-api-quota--danger'
        );
        target.classList.add(`verify-api-quota--${tone}`);
    }

    function clearPreviewTimers() {
        previewTimers.forEach((timer) => clearTimeout(timer));
        previewTimers = [];
    }

    function clearRingResetTimer() {
        if (ringResetTimer) {
            clearTimeout(ringResetTimer);
            ringResetTimer = null;
        }
    }

    function setRingProgress(progress, visible = true) {
        const widget = getWidgetElement();
        if (!widget) return;

        setVerifyRuntimeStyles(widget, {
            '--verify-progress': `${clampProgress(progress)}%`,
            '--verify-progress-opacity': visible ? '1' : '0'
        });
    }

    function applyRingState(state, progress = null) {
        const widget = getWidgetElement();
        if (!widget) return;

        widget.classList.remove(
            'ring-idle',
            'ring-armed',
            'ring-running',
            'ring-success',
            'ring-error',
            'success-pulse',
            'error-pulse'
        );
        widget.classList.add(`ring-${state}`);

        if (state === 'idle') {
            setRingProgress(progress ?? 0, false);
            return;
        }

        if (state === 'armed') {
            setRingProgress(progress ?? 0, false);
            return;
        }

        if (state === 'running') {
            setRingProgress(progress ?? 12, true);
            return;
        }

        setRingProgress(progress ?? 100, true);
    }

    function syncRingStateFromInputs() {
        if (isLoading) return;
        applyRingState('idle', 0);
    }

    function triggerRingOutcome(outcome) {
        const widget = getWidgetElement();
        if (!widget) return;

        clearRingResetTimer();
        applyRingState(outcome, 100);
        const pulseClass = outcome === 'success' ? 'success-pulse' : 'error-pulse';

        widget.classList.remove('success-pulse', 'error-pulse');
        void widget.offsetWidth;
        widget.classList.add(pulseClass);

        ringResetTimer = window.setTimeout(() => {
            const currentWidget = getWidgetElement();
            if (!currentWidget) return;
            currentWidget.classList.remove('success-pulse', 'error-pulse', 'ring-success', 'ring-error');
            syncRingStateFromInputs();
        }, 3200);
    }

    function updateExecutionRing(data) {
        const status = normalizeVerifyClientStatus(data);
        const providerProgress = getProviderProgress(data);

        if (providerProgress !== null) {
            applyRingState('running', status === 'success' || status === 'failed' ? 100 : providerProgress);
            return;
        }

        if (status === 'queued') {
            const queuePosition = Number(data?.queue_position);
            const progress = Number.isFinite(queuePosition)
                ? Math.max(12, Math.min(28, 30 - queuePosition * 3))
                : 18;
            applyRingState('running', progress);
            return;
        }

        if (status === 'running') {
            const elapsed = Number(data?.elapsed_seconds);
            const progress = Number.isFinite(elapsed)
                ? Math.min(92, 46 + elapsed * 1.4)
                : 56;
            applyRingState('running', progress);
            return;
        }

        if (status === 'success' || status === 'failed') {
            applyRingState('running', 100);
            return;
        }

        applyRingState('running', 16);
    }

    function updatePreviewModeUI() {
        document.querySelectorAll('.verify-preview-mode-btn').forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.mode === previewMode);
        });
    }

    function updateSubmitModeUi() {
        const mode = normalizeSubmitMode(verifySubmitMode);
        const modeTabs = document.querySelector('.verify-submit-mode-tabs');
        if (modeTabs) {
            modeTabs.dataset.verifySubmitMode = mode;
        }

        document.querySelectorAll('.verify-submit-mode-btn').forEach((btn) => {
            const active = btn.dataset.verifyMode === mode;
            btn.classList.toggle('active', active);
            btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        });

        const singleFields = document.getElementById('verifySingleFields');
        const batchField = document.getElementById('verifyBatchField');
        setVerifyHidden(singleFields, mode !== 'single');
        setVerifyHidden(batchField, mode !== 'batch');
        updateTaskTypeUi();
        updateQuotaDisplay();
    }

    function setSubmitMode(mode = 'single') {
        verifySubmitMode = normalizeSubmitMode(mode);
        updateSubmitModeUi();
    }

    function setPreviewMode(mode) {
        previewMode = mode === 'error' ? 'error' : 'success';
        updatePreviewModeUI();
    }

    function setPreviewControlsDisabled(disabled, showRunningState = false) {
        const previewBtn = document.getElementById('verifyPreviewBtn');
        if (previewBtn) {
            previewBtn.disabled = disabled;
            previewBtn.innerHTML = disabled && showRunningState
                ? `<div class="spinner"></div> ${t('verify.previewRunningBtn', '预执行中...')}`
                : `<i class="fas fa-flask"></i> ${t('verify.previewRun', '预执行')}`;
        }

        document.querySelectorAll('.verify-preview-mode-btn').forEach((btn) => {
            btn.disabled = disabled;
        });
    }

    function formatBalanceValue(value) {
        const num = Number(value);
        if (!Number.isFinite(num)) return '--';
        return Number.isInteger(num) ? String(num) : num.toFixed(1);
    }

    function getRemainingTaskCount(balance, taskType = 'extract') {
        const numericBalance = Number(balance);
        const usageCost = getTaskTypeUsageCost(taskType);
        if (!Number.isFinite(numericBalance) || !Number.isFinite(usageCost) || usageCost <= 0) {
            return 0;
        }

        return Math.max(0, Math.floor((numericBalance + 1e-9) / usageCost));
    }

    function buildQuotaSummary(balance, summary = apiQuotaSummary) {
        const normalizedSummary = normalizeApiQuotaSummary(summary, balance);
        if (normalizedSummary) {
            return normalizedSummary;
        }

        return normalizeApiQuotaSummary({ balance });
    }

    function getQuotaAvailableJobs(quotaSummary = null, taskType = 'extract') {
        if (!quotaSummary) return Infinity;
        return normalizeTaskType(taskType) === 'full'
            ? Number(quotaSummary.fullJobs)
            : Number(quotaSummary.extractJobs);
    }

    function hasEnoughApiQuotaForTaskCount(taskType = 'extract', taskCount = 1, quotaSummary = null) {
        if (!quotaSummary) return true;
        const availableJobs = getQuotaAvailableJobs(quotaSummary, taskType);
        return Number.isFinite(availableJobs)
            ? availableJobs >= Math.max(1, Number(taskCount) || 1)
            : true;
    }

    function getEntryCountsByTaskType(entries = []) {
        return entries.reduce((counts, entry) => {
            const taskType = normalizeTaskType(entry?.taskType);
            counts[taskType] = (counts[taskType] || 0) + 1;
            return counts;
        }, { extract: 0, full: 0 });
    }

    function findApiQuotaShortageForEntries(entries = [], quotaSummary = buildQuotaSummary(apiCredits)) {
        if (!quotaSummary) return null;
        const counts = getEntryCountsByTaskType(entries);
        for (const taskType of ['extract', 'full']) {
            if (!counts[taskType]) continue;
            const availableJobs = getQuotaAvailableJobs(quotaSummary, taskType);
            if (Number.isFinite(availableJobs) && availableJobs < counts[taskType]) {
                return {
                    taskType,
                    neededJobs: counts[taskType],
                    availableJobs,
                    quotaSummary
                };
            }
        }
        return null;
    }

    function getQuotaUnavailableMessage(taskType = 'extract') {
        const normalizedTaskType = normalizeTaskType(taskType);
        if (normalizedTaskType === 'full') {
            return t('verify.fullQuotaExhausted', getSubmissionCountShortageMessage());
        }

        return t('verify.extractQuotaExhausted', getSubmissionCountShortageMessage());
    }

    function getSubmissionCountShortageMessage() {
        return getLang() === 'en'
            ? SUBMISSION_COUNT_SHORTAGE_MESSAGE_EN
            : SUBMISSION_COUNT_SHORTAGE_MESSAGE_ZH;
    }

    function buildQuotaWarningState(taskType = 'extract', quotaSummary = null, taskCount = 1) {
        const normalizedTaskType = normalizeTaskType(taskType);
        const normalizedTaskCount = Math.max(1, Number(taskCount) || 1);
        if (!quotaSummary) {
            return null;
        }

        if (hasEnoughApiQuotaForTaskCount(normalizedTaskType, normalizedTaskCount, quotaSummary)) {
            return null;
        }

        if (normalizedTaskCount > 1) {
            return {
                tone: 'danger',
                message: t(
                    'verify.batchQuotaExhausted',
                    getSubmissionCountShortageMessage()
                ),
                action: null
            };
        }

        return {
            tone: 'danger',
            message: getQuotaUnavailableMessage(normalizedTaskType),
            action: null
        };
    }

    function formatStageLabel(stageLabel) {
        return String(stageLabel || '').replace(/_/g, ' ').trim();
    }

    function formatWaitSeconds(seconds) {
        const total = Math.max(0, Math.round(Number(seconds) || 0));
        const lang = getLang();

        if (total < 60) {
            return lang === 'zh' ? `${total} 秒` : `${total}s`;
        }

        const minutes = Math.floor(total / 60);
        const remain = total % 60;
        if (lang === 'zh') {
            return remain > 0 ? `${minutes} 分 ${remain} 秒` : `${minutes} 分钟`;
        }
        return remain > 0 ? `${minutes}m ${remain}s` : `${minutes}m`;
    }

    function getErrorLabel(code, fallback) {
        const lang = getLang();
        const raw = String(code || '').trim();
        if (raw && ERROR_CODE_MAP[raw]) {
            return ERROR_CODE_MAP[raw][lang] || ERROR_CODE_MAP[raw].zh;
        }

        const normalized = raw.toUpperCase();
        if (normalized && ERROR_CODE_MAP[normalized]) {
            return ERROR_CODE_MAP[normalized][lang] || ERROR_CODE_MAP[normalized].zh;
        }

        return fallback || raw || (lang === 'zh' ? '任务失败' : 'Job failed');
    }

    function serializeHistoryMessage(payload) {
        try {
            return JSON.stringify({
                kind: 'google_one_job',
                ...payload
            });
        } catch (_) {
            return payload?.error_message || payload?.url || '';
        }
    }

    function parseHistoryMessage(message) {
        if (typeof message !== 'string' || !message.trim().startsWith('{')) {
            return null;
        }

        try {
            const parsed = JSON.parse(message);
            if (parsed?.kind === 'google_one_job') {
                return parsed;
            }
        } catch (_) {
            return null;
        }

        return null;
    }

    function isPixelBridgeHistoryPayload(payload = {}) {
        const provider = String(payload?.provider || '').trim().toLowerCase();
        const adapter = String(payload?.provider_adapter || payload?.adapter || '').trim().toLowerCase();
        return ['catcard', '1free', 'pixel', 'pixel_bridge', 'pixel_bridge_rest', 'qzz'].includes(provider)
            || ['pixel_bridge_rest', 'pixel-bridge-rest', 'catcard', '1free', 'pixel'].includes(adapter);
    }

    function isHistorySubmissionEcho(message = '', email = '') {
        const rawMessage = String(message || '').trim();
        const normalizedEmail = String(email || '').trim().toLowerCase();
        if (!rawMessage || !normalizedEmail) return false;

        const normalizedMessage = rawMessage.toLowerCase();
        if (normalizedMessage === normalizedEmail) return true;
        if (normalizedMessage.startsWith(`${normalizedEmail}----`)) return true;
        if (normalizedMessage.startsWith(`${normalizedEmail}\t`)) return true;
        if (normalizedMessage.startsWith(`${normalizedEmail},`)) return true;
        return /^[-,\s\t]*$/.test(normalizedMessage.slice(normalizedEmail.length));
    }

    function getHistoryEmail(item) {
        const payload = parseHistoryMessage(item?.message);
        return payload?.email || item?.verification_id || '--';
    }

    function getHistoryDetail(item) {
        const payload = parseHistoryMessage(item?.message);
        const taskType = normalizeTaskType(payload?.task_type);
        const status = normalizeVerifyClientStatus(item?.status || payload?.raw_status || '');
        const email = getHistoryEmail(item);
        const isFullTask = taskType === 'full';
        const isPixelBridgeTask = isPixelBridgeHistoryPayload(payload);
        const offerUrl = String(payload?.url || payload?.offer_url || '').trim();

        if (isPixelBridgeTask && status === 'success') {
            return { type: 'empty', text: '' };
        }

        if (isFullTask && status === 'success') {
            return { type: 'text', text: getTaskTypeSuccessText(taskType, false) };
        }

        if (offerUrl && !isFullTask && !isPixelBridgeTask) {
            return { type: 'url', text: offerUrl, href: offerUrl };
        }

        const errorText = payload?.error_message || (payload?.error_code ? getErrorLabel(payload.error_code, '') : '');
        if (errorText) {
            return { type: 'text', text: errorText };
        }

        if (payload?.message) {
            if (isPixelBridgeTask && isHistorySubmissionEcho(payload.message, email)) {
                return { type: 'empty', text: '' };
            }
            return { type: 'text', text: payload.message };
        }

        if (status === 'success') {
            return { type: 'text', text: getTaskTypeSuccessText(taskType, false) };
        }

        const rawMessage = String(item?.message || '').trim();
        return { type: 'text', text: rawMessage || '--' };
    }

    function shouldAttemptHistoryRepair(item) {
        const payload = parseHistoryMessage(item?.message);
        const repairKey = String(item?.id || payload?.job_id || item?.verification_id || '').trim();
        const jobId = String(payload?.job_id || item?.verification_id || '').trim();
        const status = normalizeVerifyClientStatus(item?.status || payload?.raw_status || '');
        const errorCode = String(payload?.error_code || '').trim().toLowerCase();
        const errorMessage = String(payload?.error_message || payload?.message || '').trim().toLowerCase();

        if (!jobId || !repairKey || attemptedHistoryRepairIds.has(repairKey)) {
            return false;
        }

        if (status !== 'failed' || payload?.url) {
            return false;
        }

        return errorCode === 'job_not_found'
            || errorMessage.includes('job_not_found')
            || errorMessage.includes('任务不存在')
            || errorMessage.includes('not found');
    }

    function getHistoryJobId(item = {}, payload = null) {
        const parsedPayload = payload || parseHistoryMessage(item?.message) || {};
        return String(parsedPayload.job_id || parsedPayload.task_id || item?.verification_id || '').trim();
    }

    function canCancelHistoryJob(item = {}, payload = null) {
        const parsedPayload = payload || parseHistoryMessage(item?.message) || {};
        const status = normalizeVerifyClientStatus(item?.status || parsedPayload.raw_status || parsedPayload.status || '');
        return Boolean(getHistoryJobId(item, parsedPayload)) && ['queued', 'running'].includes(status);
    }

    function canPurchaseFailedHistoryLink(item = {}, payload = null) {
        const parsedPayload = payload || parseHistoryMessage(item?.message) || {};
        const status = normalizeVerifyClientStatus(item?.status || parsedPayload.raw_status || parsedPayload.status || '');
        const hasCapturedLink = parsedPayload.has_offer_url === true || parsedPayload.has_offer_url === 'true';
        const hasUnlockedUrl = Boolean(String(parsedPayload.url || parsedPayload.offer_url || '').trim());
        if (normalizeTaskType(parsedPayload.task_type) === 'full') {
            return false;
        }
        return Boolean(getHistoryJobId(item, parsedPayload)) && status === 'failed' && hasCapturedLink && !hasUnlockedUrl;
    }

    function buildHistoryActionButtons(item = {}, payload = null) {
        const parsedPayload = payload || parseHistoryMessage(item?.message) || {};
        const jobId = getHistoryJobId(item, parsedPayload);
        if (!jobId) return '';

        const buttons = [];
        if (canCancelHistoryJob(item, parsedPayload)) {
            buttons.push(`
                <button type="button" class="verify-history-action-btn verify-history-action-btn--danger" data-verify-action="cancel-task" data-verify-job-id="${escapeHtml(jobId)}">
                    <i class="fas fa-ban"></i>
                    <span>${escapeHtml(t('verify.cancelTask', '取消任务'))}</span>
                </button>
            `);
        }

        if (canPurchaseFailedHistoryLink(item, parsedPayload)) {
            buttons.push(`
                <button type="button" class="verify-history-action-btn" data-verify-action="purchase-failed-link" data-verify-job-id="${escapeHtml(jobId)}">
                    <i class="fas fa-link"></i>
                    <span>${escapeHtml(t('verify.purchaseFailedLink', '提取链接'))}</span>
                </button>
            `);
        }

        return buttons.length
            ? `<div class="verify-history-item-actions">${buttons.join('')}</div>`
            : '';
    }

    async function repairFalseFailedHistory(items = []) {
        if (historyRepairInFlight || !Array.isArray(items) || !items.length || !currentUser) {
            return false;
        }

        const candidates = items.filter(shouldAttemptHistoryRepair).slice(0, 3);
        if (!candidates.length) {
            return false;
        }

        historyRepairInFlight = true;
        let repaired = false;

        try {
            const headers = await getVerifyRequestHeaders();

            for (const item of candidates) {
                const payload = parseHistoryMessage(item?.message);
                const repairKey = String(item?.id || payload?.job_id || item?.verification_id || '').trim();
                const jobId = String(payload?.job_id || item?.verification_id || '').trim();
                if (!jobId) continue;

                if (repairKey) {
                    attemptedHistoryRepairIds.add(repairKey);
                }

                const statusEndpoints = buildVerifyStatusEndpoints(jobId);

                for (const endpoint of statusEndpoints) {
                    try {
                        const response = await fetch(endpoint, { headers, cache: 'no-store' });
                        const responsePayload = await response.json().catch(() => ({}));

                        if (!response.ok && shouldFallbackVerifyEndpoint(response, responsePayload)) {
                            continue;
                        }

                        const normalizedStatus = normalizeVerifyClientStatus(responsePayload);
                        if (response.ok && normalizedStatus && normalizedStatus !== 'failed') {
                            repaired = true;
                        }
                        break;
                    } catch (_) {
                        // try the next endpoint
                    }
                }
            }
        } finally {
            historyRepairInFlight = false;
        }

        return repaired;
    }

    function getHistoryDetailText(item) {
        return getHistoryDetail(item).text || '--';
    }

    function getResultDisplay(data) {
        const lang = getLang();
        const status = normalizeVerifyClientStatus(data);
        const stageLabel = getProviderStageLabel(data);
        const providerMessage = getProviderMessage(data);
        const stepStatusLabel = getProviderStepStatusLabel(data);
        const providerProgress = getProviderProgress(data);
        const taskType = normalizeTaskType(data?.task_type);

        if (status === 'queued') {
            const segments = [providerMessage || (lang === 'zh' ? '排队中' : 'Queued')];
            const queuePosition = Number(data?.queue_position);
            const waitSeconds = Number(data?.estimated_wait_seconds);

            if (stageLabel) {
                segments.push(stageLabel);
            }

            if (stepStatusLabel) {
                segments.push(stepStatusLabel);
            }

            if (Number.isFinite(queuePosition) && queuePosition >= 0) {
                segments.push(lang === 'zh' ? `队列位置 ${queuePosition}` : `Position ${queuePosition}`);
            }

            if (Number.isFinite(waitSeconds) && waitSeconds > 0) {
                segments.push(lang === 'zh' ? `预计 ${formatWaitSeconds(waitSeconds)}` : `~${formatWaitSeconds(waitSeconds)}`);
            }

            if (providerProgress !== null) {
                segments.push(`${Math.round(providerProgress)}%`);
            }

            return {
                status: 'processing',
                html: escapeHtml(segments.join(' · ')),
                terminal: false,
                success: false
            };
        }

        if (status === 'running') {
            const segments = [providerMessage || (lang === 'zh' ? '执行中' : 'Running')];
            if (stageLabel) {
                segments.push(stageLabel);
            }

            if (stepStatusLabel) {
                segments.push(stepStatusLabel);
            }

            if (providerProgress !== null) {
                segments.push(`${Math.round(providerProgress)}%`);
            }

            const elapsed = Number(data?.elapsed_seconds);
            if (Number.isFinite(elapsed) && elapsed > 0) {
                segments.push(lang === 'zh'
                    ? `已耗时 ${Math.round(elapsed)} 秒`
                    : `${Math.round(elapsed)}s elapsed`);
            }

            return {
                status: 'processing',
                html: escapeHtml(segments.join(' · ')),
                terminal: false,
                success: false
            };
        }

        if (status === 'success') {
            const successText = getTaskTypeSuccessText(taskType, Boolean(data?.url));
            const safeUrl = String(data?.url || '').trim();

            return {
                status: 'success',
                html: safeUrl
                    ? `${escapeHtml(successText)}<div class="verify-result-link-row"><a class="verify-result-link" href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(safeUrl)}</a></div>`
                    : escapeHtml(successText),
                terminal: true,
                success: true
            };
        }

        if (status === 'failed') {
            const errorText = getErrorLabel(data?.error, data?.message || (lang === 'zh' ? '任务失败' : 'Job failed'));
            let html = escapeHtml(errorText);

            if (stageLabel) {
                html += `<div class="verify-result-subtle">${escapeHtml((lang === 'zh' ? '失败阶段: ' : 'Stage: ') + stageLabel)}</div>`;
            }

            return {
                status: 'error',
                html,
                terminal: true,
                success: false
            };
        }

        return {
            status: 'processing',
            html: escapeHtml(data?.message || (lang === 'zh' ? '处理中' : 'Processing')),
            terminal: false,
            success: false
        };
    }

    async function loadConfig() {
        try {
            const site = getCurrentSiteValue();
            const response = await fetch(`/api/public?scope=config&route=verify-settings&site=${encodeURIComponent(site)}`, {
                credentials: 'same-origin',
                cache: 'no-store'
            });
            if (response.ok) {
                const payload = await response.json().catch(() => ({}));
                const config = payload?.config;
                if (payload?.success && config) {
                    CONFIG.pricePerVerify = Number(config.price_per_verify || config.pricePerVerify) || 10;
                    CONFIG.pricePerVerifyExtract = Number(config.price_per_verify_extract || config.price_per_verify || config.pricePerVerifyExtract || config.pricePerVerify) || 10;
                    CONFIG.pricePerVerifyFull = Number(config.price_per_verify_full || config.pricePerVerifyFull) || Math.max(CONFIG.pricePerVerifyExtract, CONFIG.pricePerVerifyExtract * 2);
                    CONFIG.modeVisibility = normalizeVerifyModeVisibility(config.mode_visibility || config.modeVisibility);
                    CONFIG.enabled = config.enabled !== false;
                    syncModeSelectorFromConfig();
                }
            }
        } catch (_) {
            // ignore
        }
    }

    async function getVerifyRequestHeaders(includeJson = false) {
        const headers = {};

        if (includeJson) {
            headers['Content-Type'] = 'application/json';
        }

        const getSession = window.supabaseClient?.auth?.getSession;
        if (typeof getSession !== 'function') {
            return headers;
        }

        try {
            const { data: { session } = {} } = await getSession.call(window.supabaseClient.auth);
            if (session?.access_token) {
                headers.Authorization = `Bearer ${session.access_token}`;
            }
        } catch (_) {
            // ignore auth header lookup errors and let the server reject if needed
        }

        return headers;
    }

    function shouldFallbackVerifyEndpoint(res, data = {}) {
        const status = Number(res?.status || 0);
        const message = String(data?.message || '').trim().toLowerCase();

        if (status === 404 && (message === 'public route not found' || message.includes('route not found'))) {
            return true;
        }

        if (status === 405 && message === 'method not allowed') {
            return true;
        }

        if (status === 503 && message.includes('unavailable')) {
            return true;
        }

        return false;
    }

    async function callVerifyJobAction(action, jobId) {
        const normalizedAction = String(action || '').trim();
        const normalizedJobId = String(jobId || '').trim();
        if (!normalizedAction || !normalizedJobId) {
            throw new Error(t('verify.loadFailed', '加载失败'));
        }

        const headers = await getVerifyRequestHeaders(true);
        const requestBody = JSON.stringify({
            action: normalizedAction,
            taskId: normalizedJobId,
            site: getCurrentSiteValue()
        });
        let lastPayload = {};
        let lastResponse = null;

        for (const endpoint of buildVerifyActionEndpoints()) {
            try {
                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers,
                    body: requestBody,
                    cache: 'no-store'
                });
                const payload = await response.json().catch(() => ({}));

                if (response.ok && payload.success) {
                    return payload;
                }

                if (shouldFallbackVerifyEndpoint(response, payload)) {
                    lastPayload = payload;
                    lastResponse = response;
                    continue;
                }

                lastPayload = payload;
                lastResponse = response;
                break;
            } catch (error) {
                lastPayload = {
                    message: error?.message || t('verify.connectionLost', '连接中断，请重试')
                };
            }
        }

        const fallbackMessage = normalizedAction === 'purchase_failed_link'
            ? t('verify.purchaseFailedLinkFailed', '提取链接失败')
            : t('verify.cancelTaskFailed', '取消任务失败');
        const errorText = getErrorLabel(lastPayload?.code, lastPayload?.message || fallbackMessage);
        const error = new Error(errorText);
        error.status = lastResponse?.status || 0;
        error.payload = lastPayload;
        throw error;
    }

    function copyTextToClipboard(value = '') {
        const text = String(value || '').trim();
        if (!text) return Promise.resolve(false);

        if (navigator.clipboard?.writeText) {
            return navigator.clipboard.writeText(text).then(() => true).catch(() => false);
        }

        try {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.className = 'verify-copy-fallback';
            ta.setAttribute('aria-hidden', 'true');
            ta.tabIndex = -1;
            document.body.appendChild(ta);
            ta.select();
            const copied = document.execCommand('copy');
            document.body.removeChild(ta);
            return Promise.resolve(Boolean(copied));
        } catch (_) {
            return Promise.resolve(false);
        }
    }

    function setHistoryActionBusy(button, busy, label = '') {
        if (!button) return;
        if (busy) {
            button.dataset.verifyOriginalHtml = button.innerHTML;
            button.disabled = true;
            button.innerHTML = `<i class="fas fa-spinner fa-spin"></i><span>${escapeHtml(label || t('verify.loading', '加载中...'))}</span>`;
            return;
        }

        button.disabled = false;
        if (button.dataset.verifyOriginalHtml) {
            button.innerHTML = button.dataset.verifyOriginalHtml;
            delete button.dataset.verifyOriginalHtml;
        }
    }

    async function handleHistoryJobAction(action, button) {
        const jobId = String(button?.dataset?.verifyJobId || '').trim();
        if (!jobId) return;

        const isPurchaseAction = action === 'purchase_failed_link';
        const confirmMessage = isPurchaseAction
            ? t('verify.purchaseFailedLinkConfirm', '该操作会按仅提链价格扣除积分并解锁已暂存链接，确定继续吗？')
            : t('verify.cancelTaskConfirm', '确定取消这个任务吗？取消成功后上游会退回未执行额度。');
        if (!window.confirm(confirmMessage)) {
            return;
        }

        setHistoryActionBusy(button, true, isPurchaseAction
            ? t('verify.purchaseFailedLinkWorking', '提取中...')
            : t('verify.cancelTaskWorking', '取消中...'));

        try {
            const payload = await callVerifyJobAction(action, jobId);

            if (isPurchaseAction) {
                const unlockedUrl = String(payload.url || payload.offer_url || '').trim();
                if (Number(payload.pointsDeducted) > 0) {
                    userBalance = Math.max(0, userBalance - Number(payload.pointsDeducted));
                    const balEl = document.getElementById('verifyBalanceValue');
                    if (balEl) balEl.textContent = userBalance;
                }
                if (unlockedUrl) {
                    await copyTextToClipboard(unlockedUrl);
                    showSingleResult(
                        'success',
                        t('verify.previewSuccessText', '链接获取成功'),
                        t('verify.purchaseFailedLinkCopied', '链接已解锁并复制到剪贴板')
                    );
                } else {
                    showSingleResult(
                        'success',
                        t('verify.previewSuccessText', '链接获取成功'),
                        payload.message || t('verify.purchaseFailedLinkDone', '暂存链接已解锁')
                    );
                }
            } else {
                const taskInfo = activeTasks.get(jobId);
                if (taskInfo?.timer) clearInterval(taskInfo.timer);
                activeTasks.delete(jobId);
                clearPendingTask(jobId);
                showSingleResult(
                    'pending',
                    t('verify.cancelTaskDone', '任务已取消'),
                    payload.message || t('verify.cancelTaskDoneMessage', '任务已取消，上游额度已退回')
                );
            }

            loadUserBalance();
            loadApiQuota();
            loadHistory();
        } catch (error) {
            showSingleResult(
                'error',
                isPurchaseAction
                    ? t('verify.purchaseFailedLinkFailed', '提取链接失败')
                    : t('verify.cancelTaskFailed', '取消任务失败'),
                error?.message || t('verify.loadFailed', '加载失败')
            );
        } finally {
            setHistoryActionBusy(button, false);
        }
    }

    async function loadApiQuota() {
        try {
            const headers = await getVerifyRequestHeaders();
            const site = getCurrentSiteValue();
            const quotaEndpoints = [
                `/api/public?scope=config&route=verify-quota&site=${encodeURIComponent(site)}`,
                `${CONFIG.nodeServerUrl}/api/quota?site=${encodeURIComponent(site)}`
            ];

            const cachedQuota = readCachedApiQuota(site);
            apiCredits = Number.isFinite(Number(cachedQuota?.balance)) ? Number(cachedQuota.balance) : -1;
            if (cachedQuota) {
                applyApiUsageCosts(cachedQuota);
                apiQuotaSummary = buildQuotaSummary(apiCredits, cachedQuota);
            } else {
                apiQuotaSummary = null;
            }

            for (const endpoint of quotaEndpoints) {
                try {
                    const res = await fetch(endpoint, { headers, cache: 'no-store' });
                    const data = await res.json().catch(() => ({}));
                    if (res.ok && data.success) {
                        applyApiUsageCosts({
                            extract_cost_per_job: data.extract_cost_per_job,
                            full_cost_per_job: data.full_cost_per_job
                        });
                        apiQuotaSummary = buildQuotaSummary(
                            pickFiniteNumber(data.balance, data.credits, data.remaining_uses),
                            data
                        );
                        apiCredits = Number.isFinite(Number(apiQuotaSummary?.remainingUses))
                            ? Number(apiQuotaSummary.remainingUses)
                            : 0;
                        persistCachedApiQuota(apiCredits, site, apiUsageCosts, apiQuotaSummary);
                        break;
                    }
                } catch (_) {
                    // try the next endpoint
                }
            }
        } catch (_) {
            const cachedQuota = readCachedApiQuota();
            apiCredits = Number.isFinite(Number(cachedQuota?.balance)) ? Number(cachedQuota.balance) : -1;
            if (cachedQuota) {
                applyApiUsageCosts(cachedQuota);
                apiQuotaSummary = buildQuotaSummary(apiCredits, cachedQuota);
            } else {
                apiQuotaSummary = null;
            }
        }
        updateQuotaDisplay();
    }

    function scheduleQuotaRefresh(delayMs = 0) {
        if (quotaRefreshTimer) {
            clearTimeout(quotaRefreshTimer);
            quotaRefreshTimer = null;
        }

        quotaRefreshTimer = window.setTimeout(() => {
            quotaRefreshTimer = null;
            quotaRefreshPending = false;
            void loadApiQuota();
        }, Math.max(0, Number(delayMs) || 0));
    }

    function refreshQuotaSoon(delayMs = 0) {
        if (quotaRefreshPending) return;
        quotaRefreshPending = true;
        scheduleQuotaRefresh(delayMs);
    }

    function updateQuotaDisplay() {
        const quotaEl = document.getElementById('verifyApiQuota');
        const quotaBar = document.getElementById('verifyQuotaWarning');
        const submitBtn = document.getElementById('verifySubmitBtn');
        const selectedTaskType = getSelectedTaskType();
        const taskCount = getBatchLineCount();
        const quotaSummary = buildQuotaSummary(apiCredits);
        const hasEnoughForSelectedTask = hasEnoughApiQuotaForTaskCount(selectedTaskType, taskCount, quotaSummary);
        const quotaWarningState = buildQuotaWarningState(selectedTaskType, quotaSummary, taskCount);

        if (quotaEl) {
            quotaEl.removeAttribute('title');
            if (apiCredits < 0) {
                setVerifyQuotaTone(quotaEl, 'unknown');
                quotaEl.setAttribute('aria-label', t('verify.remainingSubmitCount', '剩余可提交次数'));
                quotaEl.innerHTML = '<i class="fas fa-question-circle"></i> <span class="verify-api-quota-value">--</span>';
            } else {
                const tone = !hasEnoughForSelectedTask
                    ? 'danger'
                    : apiCredits >= 1
                        ? 'ok'
                        : apiCredits > 0
                            ? 'warning'
                            : 'danger';
                setVerifyQuotaTone(quotaEl, tone);
                const selectedRemainingJobs = getApiQuotaModeRemainingJobs(selectedTaskType, quotaSummary);
                quotaEl.setAttribute('aria-label', `${t('verify.remainingSubmitCount', '剩余可提交次数')}: ${formatBalanceValue(selectedRemainingJobs)}`);
                quotaEl.innerHTML = `<i class="fas fa-gem"></i> <span class="verify-api-quota-value">${escapeHtml(formatBalanceValue(selectedRemainingJobs))}</span>`;
            }
        }
        updateSystemRemainingDisplay(quotaSummary);

        if (quotaBar) {
            if (quotaWarningState) {
                setVerifyHidden(quotaBar, false);
                quotaBar.dataset.tone = quotaWarningState.tone || 'danger';
                quotaBar.innerHTML = `<i class="fas fa-exclamation-triangle"></i><span class="verify-quota-warning__text">${escapeHtml(quotaWarningState.message)}</span>${quotaWarningState.action ? `<button type="button" class="verify-quota-warning__action" data-verify-action="${escapeHtml(quotaWarningState.action.action)}">${escapeHtml(quotaWarningState.action.label)}</button>` : ''}`;
                if (submitBtn && !isLoading) submitBtn.disabled = true;
            } else {
                setVerifyHidden(quotaBar, true);
                quotaBar.dataset.tone = '';
                if (submitBtn && !isLoading) submitBtn.disabled = false;
            }
        }
    }

    function render(container, isLoggedIn = false) {
        const supportedRegionsUrl = getLang() === 'zh'
            ? 'https://support.google.com/googleone/answer/9080668?hl=zh-Hans'
            : 'https://support.google.com/googleone/answer/9080668?hl=en';
        const shopUrl = getShopUrl();
        const availableTaskTypes = getAvailableTaskTypes();
        const showExtractMode = availableTaskTypes.includes('extract');
        const showFullMode = availableTaskTypes.includes('full');
        const defaultTaskType = getDefaultTaskType();
        const modeSelectorClass = availableTaskTypes.length <= 1
            ? 'verify-mode-selector verify-mode-selector--single'
            : 'verify-mode-selector';
        const extractModeMarkup = showExtractMode
            ? `
                                        <label class="verify-mode-option">
                                            <input type="radio" name="verifyTaskType" value="extract" ${defaultTaskType === 'extract' ? 'checked' : ''} />
                                            <span class="verify-mode-option__body">
                                                <span class="verify-mode-option__title">${t('verify.modeExtractTitle', '仅提链')}</span>
                                                <span class="verify-mode-option__meta"><span id="verifyExtractModePrice">${CONFIG.pricePerVerifyExtract}</span> ${t('verify.points', '积分')} · <span id="verifyExtractModeMeta">${t('verify.modeDescExtract', '仅拿到可用订阅链接')}</span></span>
                                            </span>
                                        </label>`
            : '';
        const fullModeMarkup = showFullMode
            ? `
                                        <label class="verify-mode-option verify-mode-option--accent">
                                            <input type="radio" name="verifyTaskType" value="full" ${defaultTaskType === 'full' ? 'checked' : ''} />
                                            <span class="verify-mode-option__body">
                                                <span class="verify-mode-option__title">${t('verify.modeFullTitle', '全流程包绑卡')}</span>
                                                <span class="verify-mode-option__meta"><span id="verifyFullModePrice">${CONFIG.pricePerVerifyFull}</span> ${t('verify.points', '积分')} · <span id="verifyFullModeMeta">${t('verify.modeDescFull', '完成 Google One 订阅流程')}</span></span>
                                            </span>
                                        </label>`
            : '';

        container.innerHTML = `
            <div class="verify-widget ring-idle">
                <div class="verify-widget-topline" aria-hidden="true">
                    <div class="verify-orbit-trail"></div>
                </div>
                <div class="verify-widget-header">
                    <div class="verify-widget-icon">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path fill-rule="evenodd" clip-rule="evenodd" d="M15.5 4C12.4624 4 10 6.46243 10 9.5C10 10.751 10.4173 11.9039 11.129 12.835L4.56066 19.4033C4.24647 19.7175 4.24647 20.227 4.56066 20.5412L5.45879 21.4393C5.77298 21.7535 6.28248 21.7535 6.59667 21.4393L8.5 19.536L10.4033 21.4393C10.7175 21.7535 11.227 21.7535 11.5412 21.4393L12.4393 20.5412C12.7535 20.227 12.7535 19.7175 12.4393 19.4033L11.536 17.5L12.835 16.129C13.7547 16.708 14.739 17 15.5 17C18.5376 17 21 14.5376 21 11.5C21 8.46243 18.5376 4 15.5 4ZM17 9C17.5523 9 18 8.55228 18 8C18 7.44772 17.5523 7 17 7C16.4477 7 16 7.44772 16 8C16 8.55228 16.4477 9 17 9Z" fill="white"/>
                        </svg>
                    </div>
                    <div class="verify-widget-title">
                        <h3>${t('verify.title', 'Google One')}</h3>
                        <p>${t('verify.subtitle', '获取 1年 pro 权限的使用权限')}</p>
                    </div>
                    <div class="verify-header-right">
                        <div class="verify-api-quota" id="verifyApiQuota" aria-label="${t('verify.remainingSubmitCount', '剩余可提交次数')}">
                            <i class="fas fa-gem"></i> <span class="verify-api-quota-value">--</span>
                        </div>
                        <div class="verify-balance" id="verifyBalance" data-verify-action="wallet-open" title="${t('verify.walletTitle', '我的钱包')}"${isLoggedIn ? '' : ' hidden'}>
                            <i class="fas fa-coins"></i>
                            <span id="verifyBalanceValue">0</span>
                        </div>
                    </div>
                </div>

                <div class="verify-quota-warning" id="verifyQuotaWarning" hidden>
                    <i class="fas fa-exclamation-triangle"></i>
                    ${t('verify.quotaExhausted', 'API 余额不足，暂时无法提交任务。')}
                </div>

                <div id="verifyContent">
                    <div class="verify-login-prompt" id="verifyLoginPrompt" hidden>
                        <p>${t('verify.loginPrompt', '登录后即可使用验证服务')}</p>
                        <button class="verify-login-btn" data-verify-action="login-gate">
                            <i class="fas fa-sign-in-alt"></i>
                            ${t('verify.loginBtn', '登录 / 注册')}
                        </button>
                    </div>

                    <div id="verifyForm">
                        <div class="verify-form-shell">
                            <div class="verify-input-area verify-form-main">
                                <div class="verify-submit-mode-tabs" role="group" aria-label="${t('verify.submitModeLabel', '提交方式')}" data-verify-submit-mode="single">
                                    <button class="verify-submit-mode-btn active" type="button" data-verify-action="set-submit-mode" data-verify-mode="single" aria-pressed="true">
                                        <i class="fas fa-user"></i>
                                        ${t('verify.singleMode', '单个账号')}
                                    </button>
                                    <button class="verify-submit-mode-btn" type="button" data-verify-action="set-submit-mode" data-verify-mode="batch" aria-pressed="false">
                                        <i class="fas fa-layer-group"></i>
                                        ${t('verify.batchMode', '批量账号')}
                                    </button>
                                </div>

                                <div class="verify-single-fields" id="verifySingleFields">
                                    <label class="verify-form-field">
                                        <span class="verify-field-label">${t('verify.emailLabel', 'Gmail 地址')} <em>*</em></span>
                                        <input
                                            class="verify-input"
                                            id="verifyEmailInput"
                                            type="email"
                                            inputmode="email"
                                            autocomplete="off"
                                            placeholder="${t('verify.emailPlaceholder', 'your.account@gmail.com')}"
                                        />
                                    </label>

                                    <label class="verify-form-field">
                                        <span class="verify-field-label">${t('verify.passwordLabel', '账号密码')} <em>*</em></span>
                                        <div class="verify-password-shell">
                                            <input
                                                class="verify-input"
                                                id="verifyPasswordInput"
                                                type="password"
                                                autocomplete="new-password"
                                                placeholder="${t('verify.passwordPlaceholder', '密码')}"
                                            />
                                            <button
                                                class="verify-password-toggle"
                                                id="verifyPasswordToggle"
                                                type="button"
                                                data-verify-action="toggle-password"
                                                aria-label="${t('verify.showPassword', '显示密码')}"
                                                title="${t('verify.showPassword', '显示密码')}"
                                            >
                                                <i class="fas fa-eye"></i>
                                            </button>
                                        </div>
                                    </label>

                                    <div class="verify-form-field">
                                        <span class="verify-field-label">${t('verify.totpLabel', '2FA 密钥（Base32）')} <em>*</em></span>
                                        <input
                                            class="verify-input"
                                            id="verifyTotpInput"
                                            type="text"
                                            spellcheck="false"
                                            autocapitalize="characters"
                                            autocomplete="off"
                                            placeholder="${t('verify.totpPlaceholder', '3r6cu37xch4ej6d5shgouvsknd7jmhoy')}"
                                        />
                                    </div>
                                </div>

                                <div class="verify-form-field verify-batch-field" id="verifyBatchField" hidden>
                                    <span class="verify-field-label">${t('verify.batchAccountsLabel', '批量账号')} <em>*</em></span>
                                    <textarea
                                        class="verify-input verify-batch-textarea"
                                        id="verifyBatchInput"
                                        spellcheck="false"
                                        autocomplete="off"
                                        placeholder="${t('verify.batchPlaceholder', '每行一个账号：邮箱----密码----2FA密钥')}"
                                    ></textarea>
                                    <div class="verify-batch-format-note">${t('verify.batchFormatNote', '支持 email----password----2FA，也兼容 Tab /逗号分隔。最多 50个账号。')}</div>
                                </div>

                                <div class="verify-form-field">
                                    <span class="verify-field-label">${t('verify.modeLabel', '业务模式')}</span>
                                    <div class="${modeSelectorClass}">
${extractModeMarkup}
${fullModeMarkup}
                                    </div>
                                    <div class="verify-mode-note" id="verifyTaskTypeNote">${getTaskTypeGuideText(defaultTaskType)}</div>
                                </div>

                                <div class="verify-form-meta">
                                    <div class="verify-price-info verify-form-price">
                                        <i class="fas fa-coins"></i>
                                        ${t('verify.singleCost', '本次提交消耗')} <span class="price" id="verifySingleCost">${CONFIG.pricePerVerify}</span> ${t('verify.points', '积分')}
                                        <span class="verify-price-separator" aria-hidden="true">·</span>
                                        <span class="verify-system-remaining">${t('verify.systemRemainingSubmitCount', '系统剩余可提交次数')} <span class="verify-system-remaining-count" id="verifySystemRemainingCount">--</span></span>
                                        <span class="verify-price-separator" aria-hidden="true">·</span>
                                        <span class="verify-bulk-contact">${t('verify.bulkContactSupport', '大批量可联系客服')}</span>
                                    </div>
                                </div>

                                <div class="verify-form-actions">
                                    <button class="verify-reset-btn" id="verifyResetBtn" data-verify-action="reset-form">
                                        ${t('verify.resetForm', '清空输入')}
                                    </button>
                                    <button class="verify-submit-btn" id="verifySubmitBtn" data-verify-action="submit">
                                        <i class="fas fa-paper-plane"></i>
                                        ${t('verify.startVerify', '提交任务')}
                                    </button>
                                </div>

                                <div class="verify-batch-results" id="verifyBatchResults">
                                    <div class="verify-batch-results-header">
                                        <div class="verify-batch-results-title">
                                            <i class="fas fa-list-check"></i>
                                            ${t('verify.results', '任务状态')}
                                        </div>
                                        <div class="verify-batch-progress" id="verifyBatchProgress">
                                            ${t('verify.progress', '进度')}: <span class="current">0</span>/<span class="total">1</span>
                                        </div>
                                    </div>
                                    <div id="verifyResultsList"></div>
                                    <div class="verify-batch-summary" id="verifyBatchSummary" hidden>
                                        <div class="verify-batch-stat success">
                                            ${t('verify.success', '成功')}: <span id="successCount">0</span>
                                        </div>
                                        <div class="verify-batch-stat error">
                                            ${t('verify.failed', '失败')}: <span id="failedCount">0</span>
                                        </div>
                                        <div class="verify-batch-stat total">
                                            ${t('verify.total', '总计')}: <span id="totalCount">0</span>
                                        </div>
                                    </div>
                                </div>

                                <div class="verify-history-card" id="verifyHistoryCard">
                                    <div class="verify-history-header">
                                        <div class="verify-history-title">
                                            <i class="fas fa-clock-rotate-left"></i>
                                            ${t('verify.history', '任务历史')}
                                        </div>
                                        <div class="verify-history-actions">
                                            <button class="verify-history-export" data-verify-action="export-history" title="${t('verify.exportCsv', '导出 CSV')}">
                                                <i class="fas fa-file-export"></i>
                                            </button>
                                            <button class="verify-history-refresh" data-verify-action="refresh-history" title="${t('verify.refreshHistory', '刷新')}">
                                                <i class="fas fa-sync-alt"></i>
                                            </button>
                                        </div>
                                    </div>
                                    <div class="verify-history-list" id="verifyHistoryList">
                                        <div class="verify-history-loading">
                                            <i class="fas fa-spinner fa-spin"></i> ${t('verify.loading', '加载中...')}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <aside class="verify-guide-card" id="help" data-verify-help="1" tabindex="-1">
                                <div class="verify-guide-head">
                                    <div class="verify-guide-badge">
                                        <i class="fas fa-book-open"></i>
                                        ${t('verify.instructionsTitle', '使用说明')}
                                    </div>
                                    <h4>${t('verify.guideCardTitle', '提交前请先确认这些条件')}</h4>
                                    <p>${t('verify.guideCardSubtitle', '准备好账号环境后再提交，可以明显减少失败与封控。')}</p>
                                </div>

                                <div class="verify-guide-section">
                                    <div class="verify-guide-section-title">${t('verify.guideRequiredTitle', '必要条件')}</div>
                                    <div class="verify-guide-list">
                                        <div class="verify-guide-item">
                                            <div class="verify-guide-item-title">${t('verify.guide2faTitle', '2FA 验证')}</div>
                                            <div class="verify-guide-item-body">
                                                ${t('verify.guide2faBodyPrefix', '必须开启')}
                                                <a class="verify-guide-link" href="https://zhuanlan.zhihu.com/p/1997015036741304912" target="_blank" rel="noopener noreferrer">${t('verify.guideViewTutorial', '点击查看教程')}</a>
                                            </div>
                                        </div>
                                        <div class="verify-guide-item">
                                            <div class="verify-guide-item-title">${t('verify.guideRegionTitle', '地区')}</div>
                                            <div class="verify-guide-item-body">
                                                ${t('verify.guideRegionBodyPrefix', '需在支持区域内')}
                                                <a class="verify-guide-link" href="${supportedRegionsUrl}" target="_blank" rel="noopener noreferrer">${t('verify.guideViewRegions', '点击查看支持地区')}</a>
                                            </div>
                                        </div>
                                        <div class="verify-guide-item">
                                            <div class="verify-guide-item-title">${t('verify.guidePaymentProfileTitle', '付款资料')}</div>
                                            <div class="verify-guide-item-body">
                                                ${t('verify.guidePaymentProfileBodyPrefix', '提交任务前必须点击')}
                                                <a class="verify-guide-link" href="https://payments.google.com/gp/w/u/0/home/settings" target="_blank" rel="noopener noreferrer">${t('verify.guideClosePaymentProfile', '关闭付款资料')}</a>
                                            </div>
                                        </div>
                                        <div class="verify-guide-item">
                                            <div class="verify-guide-item-title">${t('verify.guideFamilyTitle', '家庭组必须退出')}</div>
                                            <div class="verify-guide-item-body">${t('verify.guideFamilyBody', '确保该账号不存在其它可用的 pro 权限订阅')}</div>
                                        </div>
                                        <div class="verify-guide-item">
                                            <div class="verify-guide-item-title">${t('verify.guideAccountTitle', '账号建议')}</div>
                                            <div class="verify-guide-item-body">${t('verify.guideAccountBody', '建议使用老号，新号极其容易封控，导致账号无法登录。这不是认证的问题，而是账号本身的问题。')}</div>
                                        </div>
                                    </div>
                                </div>

                                <div class="verify-guide-section">
                                    <div class="verify-guide-section-title">${t('verify.guideNoteTitle', '注意')}</div>
                                    <div class="verify-guide-note-list">
                                        <div class="verify-guide-note">
                                            <i class="fas fa-clipboard-list"></i>
                                            <span>${t('verify.guideNoteBrowser', '领取时浏览器须登录该 Google 账号。报错请换节点。')}</span>
                                        </div>
                                        <div class="verify-guide-note">
                                            <i class="fas fa-earth-asia"></i>
                                            <span>${t('verify.guideNoteRegion', '不需要拥有学生资格才能订阅，所有符合支持地区的账号都可以进行订阅，按步骤操作即可。')}</span>
                                        </div>
                                        <div class="verify-guide-note verify-guide-note-privacy">
                                            <span class="verify-guide-note-shield" aria-hidden="true">
                                                <svg width="16" height="18" viewBox="0 0 16 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                    <path d="M8 0.85L13.6773 2.96565C14.2538 3.18038 14.6364 3.73107 14.6364 4.34626V8.10712C14.6364 12.2356 12.2037 15.9767 8.43275 17.6513C8.15639 17.774 7.84361 17.774 7.56725 17.6513C3.79625 15.9767 1.36364 12.2356 1.36364 8.10712V4.34626C1.36364 3.73107 1.74618 3.18038 2.32275 2.96565L8 0.85Z" fill="url(#shieldFill)"/>
                                                    <path d="M8 2.15L12.7105 3.90532C12.9658 4.00048 13.1364 4.24434 13.1364 4.51679V8.02703C13.1364 11.6332 11.0948 14.9122 8 16.4101C4.90522 14.9122 2.86364 11.6332 2.86364 8.02703V4.51679C2.86364 4.24434 3.03421 4.00048 3.28948 3.90532L8 2.15Z" fill="url(#shieldInner)"/>
                                                    <path d="M8 4.35C8.3866 4.35 8.7 4.6634 8.7 5.05V8.31195L10.4782 10.0902C10.7516 10.3636 10.7516 10.8068 10.4782 11.0802C10.2048 11.3536 9.76158 11.3536 9.48817 11.0802L7.50497 9.09703C7.3737 8.96576 7.3 8.78771 7.3 8.60205V5.05C7.3 4.6634 7.6134 4.35 8 4.35Z" fill="rgba(245,251,255,0.96)"/>
                                                    <path d="M3.8 4.6L8 3L12.2 4.6" stroke="rgba(255,255,255,0.42)" stroke-width="0.8" stroke-linecap="round"/>
                                                    <defs>
                                                        <linearGradient id="shieldFill" x1="8" y1="0.85" x2="8" y2="17.7433" gradientUnits="userSpaceOnUse">
                                                            <stop stop-color="#E3F5FF"/>
                                                            <stop offset="0.42" stop-color="#8BC1E0"/>
                                                            <stop offset="1" stop-color="#4E739D"/>
                                                        </linearGradient>
                                                        <linearGradient id="shieldInner" x1="8" y1="2.15" x2="8" y2="16.4101" gradientUnits="userSpaceOnUse">
                                                            <stop stop-color="rgba(255,255,255,0.22)"/>
                                                            <stop offset="1" stop-color="rgba(11,22,35,0.18)"/>
                                                        </linearGradient>
                                                    </defs>
                                                </svg>
                                            </span>
                                            <span class="verify-guide-note-privacy-body">${t('verify.guideNotePrivacy', '我们不会保存任何账户信息，提交的信息仅做订阅临时使用，订阅完成后自动销毁。为了账户安全，订阅完成后建议修改 2FA 码；不建议立即修改密码，以免触发封控。')}</span>
                                        </div>
                                        <div class="verify-guide-note verify-guide-note-success">
                                            <i class="fas fa-credit-card"></i>
                                            <span>${t('verify.guideNoteDualMode', '提链模式需要你自行打开链接绑卡；全流程模式会由服务商直接处理。需要卡时可前往')}<a class="verify-guide-link verify-guide-link-inline" href="${shopUrl}" target="_blank" rel="noopener noreferrer">${t('verify.guideShopLink', '商城')}</a>${t('verify.guideNoteDualModeSuffix', '购卡。')}</span>
                                        </div>
                                    </div>
                                </div>
                            </aside>
                        </div>
                    </div>
                </div>

                <div class="verify-result" id="verifyResult">
                    <div class="verify-result-header">
                        <div class="verify-result-title" id="verifyResultTitle"></div>
                    </div>
                    <div class="verify-result-message" id="verifyResultMessage"></div>
                </div>
            </div>
        `;

        bindDelegatedUi(container);
        setupInputListener();
        updatePreviewModeUI();
        updatePriceDisplay();
        updateTaskTypeUi();
        updateQuotaDisplay();
        loadHistory();
        syncRingStateFromInputs();
        if (currentUser) restorePendingTask({ restart: true });

        if (!walletBalanceListenerBound) {
            window.addEventListener('walletBalanceUpdated', (e) => {
                const newBalance = e.detail?.totalBalance;
                if (typeof newBalance === 'number') {
                    userBalance = newBalance;
                    const el = document.getElementById('verifyBalanceValue');
                    if (el) el.textContent = newBalance;
                }
            });
            walletBalanceListenerBound = true;
        }
    }

    function isVerifyHelpHash() {
        const hash = decodeURIComponent(String(window.location.hash || '').replace(/^#/, '').trim()).toLowerCase();
        return ['help', 'guide', 'verify-help', 'verify-guide'].includes(hash);
    }

    function isVerifyHistoryHash() {
        const hash = decodeURIComponent(String(window.location.hash || '').replace(/^#/, '').trim()).toLowerCase();
        return ['history', 'verify-history'].includes(hash);
    }

    function focusVerifyHelpFromEngagement() {
        return new Promise((resolve) => {
            const focusHelp = (retriesLeft = 12) => {
                const target = document.getElementById('help')
                    || document.querySelector('[data-verify-help="1"], .verify-guide-card');
                if (!target) {
                    if (retriesLeft <= 0) {
                        resolve(false);
                        return;
                    }
                    setTimeout(() => focusHelp(retriesLeft - 1), 120);
                    return;
                }

                target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                target.classList.remove('is-engagement-focus');
                void target.offsetWidth;
                target.classList.add('is-engagement-focus');
                if (typeof target.focus === 'function') {
                    target.focus({ preventScroll: true });
                }
                setTimeout(() => {
                    target.classList.remove('is-engagement-focus');
                }, 3200);
                resolve(true);
            };

            focusHelp();
        });
    }

    function focusVerifyHelpHash() {
        if (!isVerifyHelpHash()) return;
        void focusVerifyHelpFromEngagement();
    }

    function focusVerifyHistoryFromEngagement() {
        return new Promise((resolve) => {
            const focusHistory = (retriesLeft = 12) => {
                const target = document.getElementById('verifyHistoryCard')
                    || document.getElementById('verifyHistoryList')
                    || document.querySelector('.verify-history-card, .verify-history-list');
                if (!target) {
                    if (retriesLeft <= 0) {
                        resolve(false);
                        return;
                    }
                    setTimeout(() => focusHistory(retriesLeft - 1), 120);
                    return;
                }

                target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                target.classList.remove('is-engagement-focus');
                void target.offsetWidth;
                target.classList.add('is-engagement-focus');
                if (typeof target.focus === 'function') {
                    target.focus({ preventScroll: true });
                }
                setTimeout(() => {
                    target.classList.remove('is-engagement-focus');
                }, 3200);
                resolve(true);
            };

            focusHistory();
        });
    }

    function focusVerifyHistoryHash() {
        if (!isVerifyHistoryHash()) return;
        void focusVerifyHistoryFromEngagement();
    }

    window.ZaoyoeVerifyFocusHelp = focusVerifyHelpFromEngagement;
    window.ZaoyoeVerifyFocusHistory = focusVerifyHistoryFromEngagement;
    window.addEventListener('hashchange', focusVerifyHelpHash);
    window.addEventListener('hashchange', focusVerifyHistoryHash);

    function setupAuthListener() {
        if (!window.supabaseClient) return;

        const applyResolvedAuthState = (user, source = 'unknown') => {
            if (getUserId(user)) {
                authBootstrapResolved = true;
                updateAuthState(user, { source });
                return;
            }

            if (!authBootstrapResolved && hadOptimisticLogin) {
                return;
            }

            authBootstrapResolved = true;
            updateAuthState(null, { source, clearCache: true });
        };

        window.supabaseClient.auth.getUser()
            .then(({ data: { user } }) => applyResolvedAuthState(user, 'getUser'))
            .catch(() => applyResolvedAuthState(null, 'getUserError'));

        window.supabaseClient.auth.onAuthStateChange((event, session) => {
            if (authNullConfirmTimer) {
                clearTimeout(authNullConfirmTimer);
                authNullConfirmTimer = null;
            }

            if (event === 'INITIAL_SESSION') {
                if (session?.user) {
                    applyResolvedAuthState(session.user, 'INITIAL_SESSION');
                    return;
                }

                if (!hadOptimisticLogin) {
                    applyResolvedAuthState(null, 'INITIAL_SESSION_NO_SESSION');
                    return;
                }

                authNullConfirmTimer = setTimeout(async () => {
                    if (authBootstrapResolved) return;
                    try {
                        const { data: { user } } = await window.supabaseClient.auth.getUser();
                        if (getUserId(user)) {
                            applyResolvedAuthState(user, 'INITIAL_SESSION_CONFIRM');
                        } else {
                            authBootstrapResolved = true;
                            updateAuthState(null, { source: 'INITIAL_SESSION_CONFIRM_NULL', clearCache: true });
                        }
                    } catch (_) {
                        authBootstrapResolved = true;
                        updateAuthState(null, { source: 'INITIAL_SESSION_CONFIRM_ERROR', clearCache: true });
                    }
                }, 1200);
                return;
            }

            if (event === 'SIGNED_OUT') {
                authBootstrapResolved = true;
                updateAuthState(null, { source: 'SIGNED_OUT', clearCache: true });
                refreshQuotaSoon(0);
                return;
            }

            applyResolvedAuthState(session?.user || null, `onAuthStateChange:${event || 'unknown'}`);
            if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') {
                refreshQuotaSoon(50);
            }
        });
    }

    async function updateAuthState(user, options = {}) {
        const { clearCache = false } = options;
        currentUser = getUserId(user) ? user : null;

        const loginPrompt = document.getElementById('verifyLoginPrompt');
        const form = document.getElementById('verifyForm');
        const balanceEl = document.getElementById('verifyBalance');

        if (currentUser) {
            setVerifyHidden(loginPrompt, true);
            setVerifyHidden(form, false);
            setVerifyHidden(balanceEl, false);
            persistMergedCachedProfile(currentUser);
            await loadUserBalance();
            restorePendingTask();
            refreshQuotaSoon(0);
        } else {
            setVerifyHidden(loginPrompt, true);
            setVerifyHidden(form, false);
            setVerifyHidden(balanceEl, true);
            if (clearCache) localStorage.removeItem('cached_user_profile');
        }

        syncRingStateFromInputs();
    }

    async function loadUserBalance() {
        if (!currentUser || !window.supabaseClient) return;

        try {
            let balance = 0;
            if (window.PointsService && typeof window.PointsService.getBalance === 'function') {
                const result = await window.PointsService.getBalance();
                balance = result.total_balance || 0;
            } else {
                const { data, error } = await window.supabaseClient
                    .from('points_balance')
                    .select('total_balance')
                    .eq('user_id', currentUser.id)
                    .eq('site', window.SiteConfig?.site || 'cn')
                    .maybeSingle();

                if (!error && data) {
                    balance = data.total_balance || 0;
                }
            }

            userBalance = balance;
            const el = document.getElementById('verifyBalanceValue');
            if (el) el.textContent = userBalance;
        } catch (_) {
            // ignore
        }
    }

    function setupInputListener() {
        const emailInput = document.getElementById('verifyEmailInput');
        const passwordInput = document.getElementById('verifyPasswordInput');
        const totpInput = document.getElementById('verifyTotpInput');
        const batchInput = document.getElementById('verifyBatchInput');
        const taskTypeInputs = document.querySelectorAll('input[name="verifyTaskType"]');

        [emailInput, passwordInput, totpInput, batchInput].forEach((input) => {
            if (!input) return;
            input.addEventListener('input', () => {
                const result = document.getElementById('verifyResult');
                if (result) result.classList.remove('show');
                updatePriceDisplay();
                updateQuotaDisplay();
                syncRingStateFromInputs();
            });
            input.addEventListener('focus', syncRingStateFromInputs);
            input.addEventListener('blur', () => window.setTimeout(syncRingStateFromInputs, 0));
        });

        if (totpInput) {
            totpInput.addEventListener('input', () => {
                totpInput.value = totpInput.value.toUpperCase().replace(/[^A-Z2-7]/g, '');
            });
        }

        if (batchInput) {
            batchInput.addEventListener('blur', () => {
                const normalizedLines = String(batchInput.value || '')
                    .split(/\r?\n/)
                    .map((line) => line.trim())
                    .filter(Boolean);
                batchInput.value = normalizedLines.join('\n');
            });
        }

        taskTypeInputs.forEach((input) => {
            input.addEventListener('change', () => {
                updatePriceDisplay();
                updateTaskTypeUi();
                syncRingStateFromInputs();
            });
        });

        updateSubmitModeUi();
    }

    function readFormEntry() {
        const emailInput = document.getElementById('verifyEmailInput');
        const passwordInput = document.getElementById('verifyPasswordInput');
        const totpInput = document.getElementById('verifyTotpInput');
        const taskType = getSelectedTaskType();

        const email = String(emailInput?.value || '').trim().toLowerCase();
        const password = String(passwordInput?.value || '').trim();
        const totpSecret = String(totpInput?.value || '').trim().toUpperCase().replace(/[^A-Z2-7]/g, '');

        if (!email || !password || !totpSecret) {
            return {
                valid: false,
                reason: t('verify.missingRequired', '请完整填写邮箱、密码和 2FA 密钥')
            };
        }

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return {
                valid: false,
                reason: t('verify.invalidEmail', '邮箱格式不正确')
            };
        }

        if (!/^[A-Z2-7]{8,64}$/.test(totpSecret)) {
            return {
                valid: false,
                reason: t('verify.invalidTotp', '2FA 密钥需要是 Base32 格式，只能包含 A-Z 和 2-7')
            };
        }

        return {
            valid: true,
            entry: {
                index: 0,
                raw: email,
                email,
                password,
                totpSecret,
                priority: 0,
                taskType
            }
        };
    }

    function splitBatchCredentialLine(line = '') {
        const raw = String(line || '').trim();
        if (!raw) return [];

        if (raw.includes('----')) {
            return raw.split('----').map((part) => part.trim());
        }

        if (raw.includes('\t')) {
            return raw.split('\t').map((part) => part.trim());
        }

        if (raw.includes(',')) {
            return raw.split(',').map((part) => part.trim());
        }

        return raw.split(/\s+/).map((part) => part.trim());
    }

    function normalizeCredentialEntry(parts = [], index = 0, priority = 0, taskType = getSelectedTaskType()) {
        const email = String(parts[0] || '').trim().toLowerCase();
        const password = String(parts[1] || '').trim();
        const totpSecret = String(parts.slice(2).join('').replace(/\s+/g, '') || '')
            .trim()
            .toUpperCase()
            .replace(/[^A-Z2-7]/g, '');

        if (!email || !password || !totpSecret) {
            return {
                valid: false,
                reason: t('verify.batchLineMissing', '缺少邮箱、密码或 2FA 密钥')
            };
        }

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return {
                valid: false,
                reason: t('verify.invalidEmail', '邮箱格式不正确')
            };
        }

        if (!/^[A-Z2-7]{8,64}$/.test(totpSecret)) {
            return {
                valid: false,
                reason: t('verify.invalidTotp', '2FA 密钥需要是 Base32 格式，只能包含 A-Z 和 2-7')
            };
        }

        return {
            valid: true,
            entry: {
                index,
                raw: email,
                email,
                password,
                totpSecret,
                priority,
                taskType
            }
        };
    }

    function readBatchEntries() {
        const batchInput = document.getElementById('verifyBatchInput');
        const taskType = getSelectedTaskType();
        const priority = 0;
        const rawLines = String(batchInput?.value || '')
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean);

        if (!rawLines.length) {
            return {
                valid: false,
                reason: t('verify.batchMissing', '请粘贴至少一行账号信息')
            };
        }

        if (rawLines.length > VERIFY_BATCH_MAX_ENTRIES) {
            return {
                valid: false,
                reason: t('verify.batchTooMany', `单次最多提交 ${VERIFY_BATCH_MAX_ENTRIES} 个账号`)
            };
        }

        const entries = [];
        const seenEmails = new Set();

        for (const [lineIndex, line] of rawLines.entries()) {
            const parsed = normalizeCredentialEntry(splitBatchCredentialLine(line), entries.length, priority, taskType);
            if (!parsed.valid) {
                return {
                    valid: false,
                    reason: `${t('verify.batchLinePrefix', '第')} ${lineIndex + 1} ${t('verify.batchLineSuffix', '行')}: ${parsed.reason}`
                };
            }

            if (seenEmails.has(parsed.entry.email)) {
                return {
                    valid: false,
                    reason: `${t('verify.batchLinePrefix', '第')} ${lineIndex + 1} ${t('verify.batchLineSuffix', '行')}: ${t('verify.batchDuplicateEmail', '邮箱重复')}`
                };
            }

            seenEmails.add(parsed.entry.email);
            parsed.entry.index = entries.length;
            entries.push(parsed.entry);
        }

        return { valid: true, entries };
    }

    function readSubmissionEntries() {
        if (verifySubmitMode === 'batch') {
            return readBatchEntries();
        }

        const parsed = readFormEntry();
        if (!parsed.valid) {
            return parsed;
        }
        return {
            valid: true,
            entries: [parsed.entry]
        };
    }

    function getBatchLineCount() {
        const batchInput = document.getElementById('verifyBatchInput');
        if (verifySubmitMode !== 'batch' || !batchInput) {
            return 1;
        }

        return Math.max(1, String(batchInput.value || '')
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
            .length);
    }

    function resetForm() {
        if (isLoading) return;

        const emailInput = document.getElementById('verifyEmailInput');
        const passwordInput = document.getElementById('verifyPasswordInput');
        const totpInput = document.getElementById('verifyTotpInput');
        const batchInput = document.getElementById('verifyBatchInput');
        const passwordToggle = document.getElementById('verifyPasswordToggle');
        const result = document.getElementById('verifyResult');
        const batch = document.getElementById('verifyBatchResults');

        if (emailInput) emailInput.value = '';
        if (passwordInput) {
            passwordInput.value = '';
            passwordInput.type = 'password';
        }
        if (totpInput) totpInput.value = '';
        if (batchInput) batchInput.value = '';
        setSelectedTaskType(getDefaultTaskType());
        if (passwordToggle) {
            passwordToggle.innerHTML = '<i class="fas fa-eye"></i>';
            passwordToggle.setAttribute('aria-label', t('verify.showPassword', '显示密码'));
            passwordToggle.setAttribute('title', t('verify.showPassword', '显示密码'));
        }
        if (result) result.classList.remove('show');
        if (batch) batch.classList.remove('show');
        clearResultsList();
        hideBatchSummary();
        clearPreviewTimers();
        clearRingResetTimer();
        updatePriceDisplay();
        updateQuotaDisplay();
        syncRingStateFromInputs();
    }

    function togglePasswordVisibility() {
        const passwordInput = document.getElementById('verifyPasswordInput');
        const passwordToggle = document.getElementById('verifyPasswordToggle');
        if (!passwordInput || !passwordToggle) return;

        const willShow = passwordInput.type === 'password';
        passwordInput.type = willShow ? 'text' : 'password';
        passwordToggle.innerHTML = `<i class="fas ${willShow ? 'fa-eye-slash' : 'fa-eye'}"></i>`;

        const label = willShow
            ? t('verify.hidePassword', '隐藏密码')
            : t('verify.showPassword', '显示密码');
        passwordToggle.setAttribute('aria-label', label);
        passwordToggle.setAttribute('title', label);

        requestAnimationFrame(() => {
            passwordInput.focus({ preventScroll: true });
            const cursor = passwordInput.value.length;
            if (typeof passwordInput.setSelectionRange === 'function') {
                passwordInput.setSelectionRange(cursor, cursor);
            }
        });
    }

    function updatePriceDisplay() {
        document.querySelectorAll('.per-price').forEach((el) => {
            el.textContent = `（${getTaskTypePrice(getSelectedTaskType())}${t('verify.perPrice', '积分/次')}）`;
        });

        const taskCount = getBatchLineCount();
        const unitCost = getTaskTypePrice(getSelectedTaskType());
        const singleCost = document.getElementById('verifySingleCost');
        if (singleCost) singleCost.textContent = taskCount > 1 ? `${unitCost * taskCount}` : unitCost;
        updateSystemRemainingDisplay();
    }

    function prepareExecutionDisplay(label, waitingMessage, total = 1) {
        const batchPanel = document.getElementById('verifyBatchResults');
        const singleResult = document.getElementById('verifyResult');
        const normalizedTotal = Math.max(1, Number(total) || 1);

        if (singleResult) singleResult.classList.remove('show');
        if (batchPanel) batchPanel.classList.add('show');

        batchStats = { success: 0, failed: 0, total: normalizedTotal };
        clearActiveTaskTimers();
        clearResultsList();
        hideBatchSummary();
        addResultItem(0, label, 'processing', escapeHtml(waitingMessage));
        updateBatchProgress(0, normalizedTotal);
        applyRingState('running', 10);
    }

    function prepareBatchExecutionDisplay(entries, waitingMessage) {
        const batchPanel = document.getElementById('verifyBatchResults');
        const singleResult = document.getElementById('verifyResult');
        const total = Math.max(1, entries.length);

        if (singleResult) singleResult.classList.remove('show');
        if (batchPanel) batchPanel.classList.add('show');

        batchStats = { success: 0, failed: 0, total };
        clearActiveTaskTimers();
        clearResultsList();
        hideBatchSummary();
        entries.forEach((entry) => {
            addResultItem(entry.index, entry.email, 'pending', escapeHtml(waitingMessage));
        });
        updateBatchProgress(0, total);
        applyRingState('running', 10);
    }

    function runPreviewExecution() {
        if (isLoading) return;

        const label = String(document.getElementById('verifyEmailInput')?.value || '').trim().toLowerCase() || 'preview.demo@gmail.com';
        const submitBtn = document.getElementById('verifySubmitBtn');
        const resetBtn = document.getElementById('verifyResetBtn');
        const previewSuccessUrl = 'https://one.google.com/partner-eft-onboard/PREVIEW-DEMO-LINK';

        clearPreviewTimers();
        clearRingResetTimer();
        prepareExecutionDisplay(label, t('verify.previewQueued', '演示排队中...'));

        isLoading = true;
        if (submitBtn) {
            submitBtn.classList.remove('verify-submit-btn--maintenance');
            submitBtn.disabled = true;
        }
        if (resetBtn) resetBtn.disabled = true;
        setPreviewControlsDisabled(true, true);

        previewTimers.push(window.setTimeout(() => {
            updateResultItem(0, 'processing', escapeHtml(t('verify.previewQueuedDetail', '排队中 · 正在分配设备')));
            applyRingState('running', 26);
        }, 480));

        previewTimers.push(window.setTimeout(() => {
            updateResultItem(0, 'processing', escapeHtml(t('verify.previewRunningDetail', '执行中 · 模拟登录与领取流程')));
            applyRingState('running', 64);
        }, 1480));

        previewTimers.push(window.setTimeout(() => {
            clearPreviewTimers();

            if (previewMode === 'success') {
                batchStats.success = 1;
                updateResultItem(
                    0,
                    'success',
                    `${escapeHtml(t('verify.previewSuccessText', '链接获取成功'))}<div class="verify-result-link-row"><a class="verify-result-link" href="${escapeHtml(previewSuccessUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(previewSuccessUrl)}</a></div>`
                );
                updateBatchProgress(1, 1);
                finishVerification({ skipRefresh: true, outcome: 'success' });
                return;
            }

            batchStats.failed = 1;
            updateResultItem(
                0,
                'error',
                `${escapeHtml(t('verify.previewFailureDetail', '模拟执行失败 · 请检查账号或 2FA 配置'))}<div class="verify-result-subtle">${escapeHtml(t('verify.previewFailureStage', '失败阶段: 模拟领取流程'))}</div>`
            );
            updateBatchProgress(1, 1);
            finishVerification({ skipRefresh: true, outcome: 'error' });
        }, 2680));
    }

    async function logToHistory(email, status, payload = {}, pointsDeducted = 0) {
        if (!currentUser || !window.supabaseClient) return;

        try {
            await window.supabaseClient.from('verification_logs').insert({
                user_id: currentUser.id,
                verification_id: email || payload.job_id || '--',
                status,
                message: serializeHistoryMessage({
                    email: email || '',
                    task_type: normalizeTaskType(payload.task_type || getSelectedTaskType()),
                    ...payload
                }),
                points_deducted: pointsDeducted,
                batch_count: 1,
                batch_success: status === 'success' ? 1 : 0,
                batch_failed: status === 'success' ? 0 : 1,
                site: window.SiteConfig?.site || 'cn'
            });
        } catch (error) {
            console.warn('[VerifyHistory] Failed to write client-side history:', error.message);
        }
    }

    function restorePendingTask(options = {}) {
        const { restart = false } = options;
        const pending = readPendingTask();
        const currentUserId = getUserId(currentUser);

        if (!pending || !currentUserId || pending.userId !== String(currentUserId) || pending.site !== getCurrentSiteValue()) {
            return false;
        }

        if (!restart && activeTasks.has(pending.jobId)) {
            return true;
        }

        clearPreviewTimers();
        clearRingResetTimer();
        const pendingTaskType = normalizeTaskType(pending.taskType || getDefaultTaskType(), getDefaultTaskType());
        setSelectedTaskType(pendingTaskType);
        prepareExecutionDisplay(pending.email, t('verify.resumePending', '正在恢复任务状态...'));

        isLoading = true;
        const submitBtn = document.getElementById('verifySubmitBtn');
        const resetBtn = document.getElementById('verifyResetBtn');
        if (submitBtn) {
            submitBtn.classList.remove('verify-submit-btn--maintenance');
            submitBtn.disabled = true;
            submitBtn.innerHTML = `<div class="spinner"></div> ${t('verify.restoringTask', '恢复中...')}`;
        }
        if (resetBtn) resetBtn.disabled = true;
        setPreviewControlsDisabled(true);

        activeTasks.set(pending.jobId, {
            index: 0,
            email: pending.email,
            timer: null,
            submittedAt: Date.now(),
            priority: 0,
            taskType: pendingTaskType,
            pointsCost: getTaskTypePrice(pendingTaskType),
            restored: true
        });
        updateExecutionRing({ status: 'queued', queue_position: 0 });

        pollTask(pending.jobId, {
            index: 0,
            email: pending.email
        }).then((result) => {
            if (result.terminal && result.success) {
                batchStats.success = 1;
                if (result.pointsDeducted) {
                    userBalance = Math.max(0, userBalance - result.pointsDeducted);
                    const balEl = document.getElementById('verifyBalanceValue');
                    if (balEl) balEl.textContent = userBalance;
                }
            } else if (result.terminal) {
                batchStats.failed = 1;
            }

            if (result.terminal) {
                updateBatchProgress(1, 1);
            }

            finishVerification({
                outcome: result.terminal ? (result.success ? 'success' : 'error') : '',
                jobId: pending.jobId,
                preservePending: !result.terminal,
                showSummary: result.terminal
            });
        });

        return true;
    }

    async function resolveCurrentUserId() {
        let userId = currentUser?.id || currentUser?.user_id;
        if (userId) return userId;

        const userPromise = window.supabaseClient?.auth?.getUser?.();
        if (!userPromise || typeof userPromise.then !== 'function') {
            throw new Error(t('verify.pleaseLogin', '请先登录'));
        }

        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error(t('verify.pleaseLogin', '请先登录'))), 5000)
        );
        const { data } = await Promise.race([userPromise, timeoutPromise]);
        userId = data?.user?.id;
        if (!userId) {
            throw new Error(t('verify.pleaseLogin', '请先登录'));
        }
        return userId;
    }

    async function submitVerifyEntry(entry, userId, options = {}) {
        const totalCost = Number(options.pointsCost ?? getTaskTypePrice(entry.taskType)) || getTaskTypePrice(entry.taskType);
        const batchTotal = Math.max(1, Number(options.batchTotal) || 1);

        updateResultItem(entry.index, 'processing', escapeHtml(t('verify.verifying', '提交中...')));

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);
        const headers = await getVerifyRequestHeaders(true);
        const submitEndpoints = [
            '/api/public?scope=verify&route=submit',
            `${CONFIG.nodeServerUrl}/api/verify`
        ];
        const requestBody = JSON.stringify({
            email: entry.email,
            password: entry.password,
            totpSecret: entry.totpSecret,
            priority: entry.priority,
            taskType: entry.taskType
        });
        let res = null;
        let data = {};
        let submitError = null;

        for (const endpoint of submitEndpoints) {
            try {
                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers,
                    body: requestBody,
                    signal: controller.signal
                });
                const payload = await response.json().catch(() => ({}));

                if (response.ok && payload.success) {
                    res = response;
                    data = payload;
                    submitError = null;
                    break;
                }

                if (shouldFallbackVerifyEndpoint(response, payload)) {
                    continue;
                }

                res = response;
                data = payload;
                submitError = null;
                break;
            } catch (error) {
                submitError = error;
            }
        }
        clearTimeout(timeoutId);

        if (!res && submitError) {
            throw submitError;
        }

        if (!res) {
            throw new Error(t('verify.loadFailed', '提交失败'));
        }

        if (!res.ok || !data.success) {
            const errorText = getErrorLabel(data.code, data.message || t('verify.loadFailed', '提交失败'));
            updateResultItem(entry.index, 'error', escapeHtml(errorText));
            trackVerifyAnalyticsEvent('verify_fail', {
                metadata: {
                    reason_code: String(data.code || 'submit_failed').trim() || 'submit_failed',
                    stage_label: 'submit',
                    priority: entry.priority,
                    points_cost: totalCost,
                    task_type: entry.taskType,
                    batch_total: batchTotal,
                    batch_index: entry.index + 1
                }
            });
            await logToHistory(entry.email, 'failed', {
                email: entry.email,
                task_type: entry.taskType,
                error_code: data.code || '',
                error_message: errorText,
                raw_status: 'submit_failed'
            });
            return { submitted: false, terminal: true, success: false };
        }

        const jobId = data.job_id || data.task_id;
        if (!jobId) {
            const errorText = t('verify.loadFailed', '提交失败');
            updateResultItem(entry.index, 'error', escapeHtml(errorText));
            trackVerifyAnalyticsEvent('verify_fail', {
                metadata: {
                    reason_code: 'missing_job_id',
                    stage_label: 'submit',
                    priority: entry.priority,
                    points_cost: totalCost,
                    task_type: entry.taskType,
                    batch_total: batchTotal,
                    batch_index: entry.index + 1
                }
            });
            await logToHistory(entry.email, 'failed', {
                email: entry.email,
                task_type: entry.taskType,
                error_message: errorText,
                raw_status: 'missing_job_id'
            });
            return { submitted: false, terminal: true, success: false };
        }

        activeTasks.set(jobId, {
            index: entry.index,
            email: entry.email,
            timer: null,
            submittedAt: Date.now(),
            priority: entry.priority,
            taskType: normalizeTaskType(data.task_type || entry.taskType),
            pointsCost: totalCost,
            restored: false
        });
        trackVerifyAnalyticsEvent('verify_submit', {
            entityId: String(jobId || '').trim(),
            eventValue: totalCost,
            pointsDelta: -Math.abs(Number(totalCost) || 0),
            metadata: {
                priority: entry.priority,
                points_cost: totalCost,
                task_type: entry.taskType,
                batch_total: batchTotal,
                batch_index: entry.index + 1
            }
        }, {
            dedupeKey: `verify_submit:${String(jobId || '').trim()}`
        });
        triggerVerifyEngagementEvent('verify_queue', {
            source_event_id: `verify_queue:${String(jobId || '').trim()}`,
            source: 'verify_submit',
            job_id: String(jobId || '').trim(),
            queue_position: data.queue_position ?? null,
            estimated_wait_seconds: data.estimated_wait_seconds ?? null,
            priority: entry.priority,
            points_cost: totalCost,
            task_type: entry.taskType,
            batch_total: batchTotal,
            batch_index: entry.index + 1
        });
        persistPendingTask({
            jobId,
            email: entry.email,
            userId,
            site: getCurrentSiteValue(),
            taskType: normalizeTaskType(data.task_type || entry.taskType)
        });

        const display = getResultDisplay({
            status: data.status || 'queued',
            queue_position: data.queue_position,
            estimated_wait_seconds: data.estimated_wait_seconds,
            stage_label: data.stage_label,
            raw_step: data.raw_step,
            step_status: data.step_status,
            provider_message: data.provider_message,
            provider_progress: data.provider_progress ?? data.progress,
            progress: data.progress,
            elapsed_seconds: data.elapsed_seconds,
            task_type: data.task_type || entry.taskType
        });
        updateResultItem(entry.index, display.status, display.html);
        updateExecutionRing(data);

        return { submitted: true, jobId, data };
    }

    async function runBatchSubmit(entries, submitBtn, resetBtn) {
        const total = entries.length;
        const totalCost = entries.reduce((sum, entry) => sum + getTaskTypePrice(entry.taskType), 0);
        const requiredUses = entries.reduce((sum, entry) => sum + getTaskTypeUsageCost(entry.taskType), 0);

        if (userBalance < totalCost) {
            triggerVerifyEngagementEvent('points_insufficient', {
                source_event_id: `points_insufficient:verify_batch:${normalizeTaskType(entries[0]?.taskType)}:${Date.now()}`,
                source: 'verify_submit_precheck',
                current_balance: userBalance,
                points_cost: totalCost,
                task_type: normalizeTaskType(entries[0]?.taskType),
                batch_total: total
            });
            showSingleResult(
                'error',
                t('verify.insufficientPoints', '积分不足'),
                `${t('verify.needPoints', '需要积分')}: ${totalCost} / ${t('verify.remaining', '当前余额')}: ${userBalance}`
            );
            return;
        }

        const quotaShortage = apiCredits >= 0
            ? findApiQuotaShortageForEntries(entries, buildQuotaSummary(apiCredits))
            : null;
        if (quotaShortage) {
            showSingleResult(
                'error',
                t('verify.quotaExhausted', 'API 余额不足'),
                formatApiQuotaShortageMessage(quotaShortage, requiredUses, '本批需要接口额度')
            );
            return;
        }

        clearPreviewTimers();
        clearRingResetTimer();
        prepareBatchExecutionDisplay(entries, t('verify.waiting', '等待提交...'));

        isLoading = true;
        submitBtn.disabled = true;
        submitBtn.innerHTML = `<div class="spinner"></div> ${t('verify.batchSubmitting', '批量提交中...')}`;
        if (resetBtn) resetBtn.disabled = true;
        setPreviewControlsDisabled(true);

        let userId = '';
        try {
            userId = await resolveCurrentUserId();
        } catch (error) {
            const errorMessage = error.message || t('verify.pleaseLogin', '请先登录');
            entries.forEach((entry) => updateResultItem(entry.index, 'error', escapeHtml(errorMessage)));
            batchStats.failed = total;
            updateBatchProgress(total, total);
            finishVerification({ outcome: 'error' });
            return;
        }

        let cursor = 0;
        const pollPromises = [];
        const markTerminal = (result = {}, entry = {}, jobId = '') => {
            if (result.terminal && result.success) {
                batchStats.success += 1;
                if (result.pointsDeducted) {
                    userBalance = Math.max(0, userBalance - result.pointsDeducted);
                    const balEl = document.getElementById('verifyBalanceValue');
                    if (balEl) balEl.textContent = userBalance;
                }
            } else {
                batchStats.failed += 1;
            }

            if (jobId) {
                clearPendingTask(jobId);
            }
            updateBatchProgress(batchStats.success + batchStats.failed, batchStats.total);
        };

        const submitWorker = async () => {
            while (cursor < entries.length) {
                const entry = entries[cursor];
                cursor += 1;

                try {
                    const submitted = await submitVerifyEntry(entry, userId, {
                        pointsCost: getTaskTypePrice(entry.taskType),
                        batchTotal: total
                    });
                    if (!submitted.submitted) {
                        markTerminal({ terminal: true, success: false }, entry);
                        continue;
                    }

                    const pollPromise = pollTask(submitted.jobId, entry)
                        .then((result) => {
                            markTerminal(result, entry, submitted.jobId);
                            return result;
                        });
                    pollPromises.push(pollPromise);
                } catch (error) {
                    const errorText = error.message || t('verify.loadFailed', '提交失败');
                    updateResultItem(entry.index, 'error', escapeHtml(errorText));
                    trackVerifyAnalyticsEvent('verify_fail', {
                        metadata: {
                            reason_code: 'submit_error',
                            stage_label: 'submit',
                            priority: entry.priority,
                            points_cost: getTaskTypePrice(entry.taskType),
                            task_type: entry.taskType,
                            batch_total: total,
                            batch_index: entry.index + 1
                        }
                    });
                    await logToHistory(entry.email, 'error', {
                        email: entry.email,
                        task_type: entry.taskType,
                        error_message: errorText,
                        raw_status: 'submit_error'
                    });
                    markTerminal({ terminal: true, success: false }, entry);
                }
            }
        };

        const workerCount = Math.min(VERIFY_BATCH_SUBMIT_CONCURRENCY, total);
        await Promise.all(Array.from({ length: workerCount }, () => submitWorker()));
        await Promise.all(pollPromises);

        finishVerification({
            outcome: batchStats.failed > 0 ? 'error' : 'success',
            showSummary: true
        });
    }

    async function submit() {
        if (isLoading) return;

        if (CONFIG.enabled === false) {
            showSingleResult(
                'error',
                t('verify.serviceUnavailable', '服务维护中'),
                t('verify.serviceUnavailable', '服务维护中，请稍后再试')
            );
            return;
        }

        if (!currentUser) {
            const opened = openLoginGate();
            if (!opened) {
                showSingleResult(
                    'error',
                    t('verify.pleaseLogin', '请先登录'),
                    t('verify.loginPrompt', '登录后即可使用验证服务')
                );
            }
            return;
        }

        const submitBtn = document.getElementById('verifySubmitBtn');
        const resetBtn = document.getElementById('verifyResetBtn');

        if (!submitBtn) return;
        submitBtn.classList.remove('verify-submit-btn--maintenance');

        const parsed = readSubmissionEntries();
        if (!parsed.valid) {
            showSingleResult(
                'error',
                t('verify.formatError', '信息不完整'),
                parsed.reason || t('verify.missingRequired', '请完整填写邮箱、密码和 2FA 密钥')
            );
            return;
        }

        const entries = parsed.entries || [];
        if (!entries.length) {
            showSingleResult(
                'error',
                t('verify.formatError', '信息不完整'),
                t('verify.missingRequired', '请完整填写邮箱、密码和 2FA 密钥')
            );
            return;
        }

        if (entries.length > 1) {
            await runBatchSubmit(entries, submitBtn, resetBtn);
            return;
        }

        const entry = entries[0];
        const totalCost = getTaskTypePrice(entry.taskType);
        if (userBalance < totalCost) {
            triggerVerifyEngagementEvent('points_insufficient', {
                source_event_id: `points_insufficient:verify:${normalizeTaskType(entry.taskType)}:${Date.now()}`,
                source: 'verify_submit_precheck',
                current_balance: userBalance,
                points_cost: totalCost,
                task_type: normalizeTaskType(entry.taskType)
            });
            showSingleResult(
                'error',
                t('verify.insufficientPoints', '积分不足'),
                `${t('verify.needPoints', '需要积分')}: ${totalCost} / ${t('verify.remaining', '当前余额')}: ${userBalance}`
            );
            return;
        }

        const requiredUses = getTaskTypeUsageCost(entry.taskType);
        const quotaShortage = apiCredits >= 0
            ? findApiQuotaShortageForEntries([entry], buildQuotaSummary(apiCredits))
            : null;
        if (quotaShortage) {
            showSingleResult(
                'error',
                t('verify.quotaExhausted', 'API 余额不足'),
                formatApiQuotaShortageMessage(quotaShortage, requiredUses, '本次需要接口额度')
            );
            return;
        }

        clearPreviewTimers();
        clearRingResetTimer();
        prepareExecutionDisplay(entry.email, t('verify.waiting', '等待提交...'));

        isLoading = true;
        submitBtn.disabled = true;
        submitBtn.innerHTML = `<div class="spinner"></div> ${t('verify.verifying', '提交中...')}`;
        if (resetBtn) resetBtn.disabled = true;
        setPreviewControlsDisabled(true);

        try {
            const userId = await resolveCurrentUserId();
            const submitted = await submitVerifyEntry(entry, userId, {
                pointsCost: totalCost,
                batchTotal: 1
            });

            if (!submitted.submitted) {
                batchStats.failed = 1;
                updateBatchProgress(1, 1);
                finishVerification({ outcome: 'error' });
                return;
            }

            pollTask(submitted.jobId, entry).then((result) => {
                if (result.terminal && result.success) {
                    batchStats.success = 1;
                    if (result.pointsDeducted) {
                        userBalance = Math.max(0, userBalance - result.pointsDeducted);
                        const balEl = document.getElementById('verifyBalanceValue');
                        if (balEl) balEl.textContent = userBalance;
                    }
                } else if (result.terminal) {
                    batchStats.failed = 1;
                }

                if (result.terminal) {
                    updateBatchProgress(1, 1);
                }

                finishVerification({
                    outcome: result.terminal ? (result.success ? 'success' : 'error') : '',
                    jobId: submitted.jobId,
                    preservePending: !result.terminal,
                    showSummary: result.terminal
                });
            });
        } catch (error) {
            const errorText = error.message || t('verify.loadFailed', '提交失败');
            updateResultItem(entry.index, 'error', escapeHtml(errorText));
            batchStats.failed = 1;
            updateBatchProgress(1, 1);
            trackVerifyAnalyticsEvent('verify_fail', {
                metadata: {
                    reason_code: 'submit_error',
                    stage_label: 'submit',
                    priority: entry.priority,
                    points_cost: totalCost,
                    task_type: entry.taskType
                }
            });
            await logToHistory(entry.email, 'error', {
                email: entry.email,
                task_type: entry.taskType,
                error_message: errorText,
                raw_status: 'submit_error'
            });
            finishVerification({ outcome: 'error' });
        }
    }

    function pollTask(jobId, entry) {
        return new Promise((resolve) => {
            const startTime = Date.now();
            const taskInfoAtStart = activeTasks.get(jobId) || {};
            const pollTimeoutMs = getTaskPollTimeoutMs(taskInfoAtStart.taskType || entry.taskType || 'extract');
            const backgroundContinueText = t('verify.pendingBackgroundContinue', '任务耗时较长，仍在后台处理，可稍后在任务历史查看');
            const backgroundContinueHint = t('verify.pendingBackgroundContinueHint', '页面会继续自动同步；你也可以刷新页面继续追踪当前任务');
            const statusRetryText = t('verify.statusRetrying', '状态同步中，任务仍在后台处理...');
            let pollingRequestInFlight = false;
            let backgroundNoticeShown = false;

            const timer = setInterval(async () => {
                if (pollingRequestInFlight) {
                    return;
                }

                if (!activeTasks.has(jobId)) {
                    clearInterval(timer);
                    resolve({ success: false, pointsDeducted: 0, terminal: false });
                    return;
                }

                if (Date.now() - startTime > pollTimeoutMs) {
                    if (!backgroundNoticeShown) {
                        backgroundNoticeShown = true;
                        updateResultItem(
                            entry.index,
                            'processing',
                            `${escapeHtml(backgroundContinueText)}<div class="verify-result-subtle">${escapeHtml(backgroundContinueHint)}</div>`
                        );
                    }
                }

                pollingRequestInFlight = true;

                try {
                    const headers = await getVerifyRequestHeaders();
                    const statusEndpoints = buildVerifyStatusEndpoints(jobId);
                    let res = null;
                    let data = {};

                    for (const endpoint of statusEndpoints) {
                        try {
                            const response = await fetch(endpoint, { headers, cache: 'no-store' });
                            const payload = await response.json().catch(() => ({}));

                            if (response.ok || !shouldFallbackVerifyEndpoint(response, payload)) {
                                res = response;
                                data = payload;
                                break;
                            }
                        } catch (_) {
                            // try the next endpoint
                        }
                    }

                    if (!res) {
                        throw new Error(t('verify.connectionLost', '连接中断，请重试'));
                    }

                    if (!res.ok) {
                        updateResultItem(
                            entry.index,
                            'processing',
                            `${escapeHtml(statusRetryText)}<div class="verify-result-subtle">${escapeHtml(backgroundContinueHint)}</div>`
                        );
                        return;
                    }

                    const display = getResultDisplay(data);
                    updateResultItem(entry.index, display.status, display.html);
                    updateExecutionRing(data);

                    if (display.terminal) {
                        clearInterval(timer);
                        const taskInfo = activeTasks.get(jobId) || {};
                        const resolvedDurationMs = Number.isFinite(Number(data?.elapsed_seconds))
                            ? Math.max(0, Math.round(Number(data.elapsed_seconds) * 1000))
                            : Math.max(0, Date.now() - Number(taskInfo.submittedAt || startTime));
                        const resolvedJobId = String(jobId || '').trim();

                        if (display.success) {
                            trackVerifyAnalyticsEvent('verify_success', {
                                entityId: resolvedJobId || null,
                                eventValue: resolvedDurationMs,
                                metadata: {
                                    duration_ms: resolvedDurationMs,
                                    priority: Number(taskInfo.priority ?? entry.priority ?? 0) || 0,
                                    points_cost: Number(taskInfo.pointsCost ?? CONFIG.pricePerVerify) || CONFIG.pricePerVerify,
                                    task_type: normalizeTaskType(taskInfo.taskType || entry.taskType || data?.task_type),
                                    restored: taskInfo.restored === true
                                }
                            }, {
                                dedupeKey: resolvedJobId ? `verify_terminal:${resolvedJobId}:success` : ''
                            });
                            triggerVerifyEngagementEvent('verify_success', {
                                source_event_id: resolvedJobId ? `verify_success:${resolvedJobId}` : '',
                                source: 'verify_terminal',
                                job_id: resolvedJobId || null,
                                duration_ms: resolvedDurationMs,
                                priority: Number(taskInfo.priority ?? entry.priority ?? 0) || 0,
                                points_cost: Number(taskInfo.pointsCost ?? CONFIG.pricePerVerify) || CONFIG.pricePerVerify,
                                task_type: normalizeTaskType(taskInfo.taskType || entry.taskType || data?.task_type)
                            });
                        } else {
                            trackVerifyAnalyticsEvent('verify_fail', {
                                entityId: resolvedJobId || null,
                                metadata: {
                                    duration_ms: resolvedDurationMs,
                                    reason_code: String(data?.error || data?.code || 'failed').trim() || 'failed',
                                    stage_label: formatStageLabel(data?.stage_label),
                                    priority: Number(taskInfo.priority ?? entry.priority ?? 0) || 0,
                                    points_cost: Number(taskInfo.pointsCost ?? CONFIG.pricePerVerify) || CONFIG.pricePerVerify,
                                    task_type: normalizeTaskType(taskInfo.taskType || entry.taskType || data?.task_type),
                                    restored: taskInfo.restored === true
                                }
                            }, {
                                dedupeKey: resolvedJobId ? `verify_terminal:${resolvedJobId}:failed` : ''
                            });
                            triggerVerifyEngagementEvent('verify_failed', {
                                source_event_id: resolvedJobId ? `verify_failed:${resolvedJobId}` : '',
                                source: 'verify_terminal',
                                job_id: resolvedJobId || null,
                                duration_ms: resolvedDurationMs,
                                reason_code: String(data?.error || data?.code || 'failed').trim() || 'failed',
                                stage_label: formatStageLabel(data?.stage_label),
                                priority: Number(taskInfo.priority ?? entry.priority ?? 0) || 0,
                                points_cost: Number(taskInfo.pointsCost ?? CONFIG.pricePerVerify) || CONFIG.pricePerVerify,
                                task_type: normalizeTaskType(taskInfo.taskType || entry.taskType || data?.task_type)
                            });
                        }

                        activeTasks.delete(jobId);
                        resolve({
                            success: display.success,
                            pointsDeducted: Number(data.pointsDeducted) || 0,
                            terminal: true
                        });
                    }
                } catch (error) {
                    console.warn('[VerifyWidget] Poll error (retrying):', error.message);
                    updateResultItem(
                        entry.index,
                        'processing',
                        `${escapeHtml(statusRetryText)}<div class="verify-result-subtle">${escapeHtml(backgroundContinueHint)}</div>`
                    );
                } finally {
                    pollingRequestInFlight = false;
                }
            }, CONFIG.pollInterval);

            const taskInfo = activeTasks.get(jobId);
            if (taskInfo) {
                taskInfo.timer = timer;
            }
        });
    }

    function cancel() {
        return false;
    }

    function finishVerification(options = {}) {
        const {
            skipRefresh = false,
            outcome = '',
            jobId = '',
            preservePending = false,
            showSummary = true
        } = options;
        isLoading = false;
        clearActiveTaskTimers();
        if (jobId && !preservePending) clearPendingTask(jobId);
        clearPreviewTimers();

        const submitBtn = document.getElementById('verifySubmitBtn');
        const resetBtn = document.getElementById('verifyResetBtn');
        if (submitBtn) {
            submitBtn.classList.remove('verify-submit-btn--maintenance');
            submitBtn.disabled = false;
            submitBtn.innerHTML = buildVerifySubmitButtonMarkup(getSubmitButtonLabel(getSelectedTaskType()));
        }
        if (resetBtn) resetBtn.disabled = false;
        setPreviewControlsDisabled(false);

        if (showSummary) {
            showBatchSummary();
        } else {
            hideBatchSummary();
        }
        updateQuotaDisplay();

        if (!skipRefresh) {
            loadUserBalance();
            loadApiQuota();
            loadHistory();
        }

        if (outcome === 'success' || outcome === 'error') {
            triggerRingOutcome(outcome);
        } else {
            syncRingStateFromInputs();
        }

        if (CONFIG.enabled === false) {
            applyMaintenanceState();
        }
    }

    function clearResultsList() {
        const list = document.getElementById('verifyResultsList');
        if (list) list.innerHTML = '';
    }

    function addResultItem(index, label, status, messageHtml) {
        const list = document.getElementById('verifyResultsList');
        if (!list) return;

        const shortLabel = String(label || '').length > 55
            ? String(label).substring(0, 55) + '...'
            : String(label || '');

        const item = document.createElement('div');
        item.className = `verify-result-item ${status}`;
        item.id = `result-item-${index}`;
        item.innerHTML = `
            <div class="verify-result-item-content">
                <div class="verify-result-item-id">#${index + 1}: ${escapeHtml(shortLabel)}</div>
                <div class="verify-result-item-message">${messageHtml}</div>
            </div>
        `;
        list.appendChild(item);
    }

    function updateResultItem(index, status, messageHtml) {
        const item = document.getElementById(`result-item-${index}`);
        if (!item) return;

        item.className = `verify-result-item ${status}`;

        const msgEl = item.querySelector('.verify-result-item-message');
        if (msgEl) msgEl.innerHTML = messageHtml;
    }

    function updateBatchProgress(current, total) {
        const el = document.getElementById('verifyBatchProgress');
        if (el) {
            el.innerHTML = `${t('verify.progress', '进度')}: <span class="current">${current}</span>/<span class="total">${total}</span>`;
        }
    }

    function showBatchSummary() {
        const el = document.getElementById('verifyBatchSummary');
        setVerifyHidden(el, false);

        const successEl = document.getElementById('successCount');
        const failedEl = document.getElementById('failedCount');
        const totalEl = document.getElementById('totalCount');

        if (successEl) successEl.textContent = batchStats.success;
        if (failedEl) failedEl.textContent = batchStats.failed;
        if (totalEl) totalEl.textContent = batchStats.total;
    }

    function hideBatchSummary() {
        const el = document.getElementById('verifyBatchSummary');
        setVerifyHidden(el, true);

        const successEl = document.getElementById('successCount');
        const failedEl = document.getElementById('failedCount');
        const totalEl = document.getElementById('totalCount');
        if (successEl) successEl.textContent = '0';
        if (failedEl) failedEl.textContent = '0';
        if (totalEl) totalEl.textContent = String(batchStats.total || 0);
    }

    function showSingleResult(type, title, message) {
        const result = document.getElementById('verifyResult');
        const batch = document.getElementById('verifyBatchResults');
        if (!result) return;
        if (batch) batch.classList.remove('show');

        result.className = 'verify-result show ' + type;
        const titleEl = document.getElementById('verifyResultTitle');
        const msgEl = document.getElementById('verifyResultMessage');
        if (titleEl) titleEl.textContent = title;
        if (msgEl) msgEl.textContent = message;
        syncRingStateFromInputs();
    }

    function getHistoryStatusCss(status) {
        const normalized = normalizeVerifyClientStatus(status);
        if (normalized.includes('success') || normalized.includes('completed')) return 'success';
        if (normalized.includes('queued') || normalized.includes('running') || normalized.includes('process')) return 'processing';
        if (normalized.includes('fail') || normalized.includes('error') || normalized.includes('timeout')) return 'error';
        return '';
    }

    function getHistoryStatusText(status) {
        const normalized = normalizeVerifyClientStatus(status);

        if (normalized.includes('success') || normalized.includes('completed')) {
            return `<span class="verify-history-status-badge"><i class="fas fa-check-circle"></i> ${t('verify.successText', '成功')}</span>`;
        }
        if (normalized.includes('queued') || normalized.includes('running') || normalized.includes('process')) {
            return `<span class="verify-history-status-badge"><i class="fas fa-sync fa-spin"></i> ${t('verify.processText', '处理中')}</span>`;
        }
        if (normalized.includes('fail') || normalized.includes('error') || normalized.includes('timeout')) {
            return `<span class="verify-history-status-badge"><i class="fas fa-times-circle"></i> ${t('verify.failText', '失败')}</span>`;
        }

        return escapeHtml(status || '--');
    }

    async function loadHistory() {
        const listEl = document.getElementById('verifyHistoryList');
        if (!listEl) return;

        if (!currentUser || !window.supabaseClient) {
            listEl.innerHTML = `<div class="verify-history-empty">${t('verify.historyLoginPrompt', '登录后查看历史记录')}</div>`;
            return;
        }

        listEl.innerHTML = `<div class="verify-history-loading"><i class="fas fa-spinner fa-spin"></i> ${t('verify.loading', '加载中...')}</div>`;

        try {
            const { data, error } = await window.supabaseClient
                .from('verification_logs')
                .select(VERIFY_HISTORY_SELECT)
                .eq('user_id', currentUser.id)
                .eq('site', getCurrentSiteValue())
                .order('created_at', { ascending: false })
                .limit(20);

            if (error) {
                console.warn('[VerifyHistory] Failed to load history:', error.message || error);
                listEl.innerHTML = `<div class="verify-history-empty"><i class="fas fa-inbox"></i> ${t('verify.loadFailed', '加载失败')}</div>`;
                historyData = [];
                return;
            }

            if (!data || data.length === 0) {
                listEl.innerHTML = `<div class="verify-history-empty"><i class="fas fa-inbox"></i> ${t('verify.historyEmpty', '暂无历史记录')}</div>`;
                historyData = [];
                return;
            }

            historyData = data;

            listEl.innerHTML = data.map((item) => {
                const payload = parseHistoryMessage(item?.message) || {};
                const time = new Date(item.created_at).toLocaleString(getLocale(), {
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit'
                });
                const email = getHistoryEmail(item);
                const shortEmail = email.length > 28 ? email.substring(0, 28) + '...' : email;
                const detail = getHistoryDetail(item);
                const detailHtml = detail.type === 'url'
                    ? `<a class="verify-history-link-text" href="${escapeHtml(detail.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(detail.text)}</a>`
                    : escapeHtml(detail.text || '--');
                const detailRowHtml = detail.type === 'empty'
                    ? ''
                    : `<div class="verify-history-item-message">${detailHtml}</div>`;
                const actionHtml = buildHistoryActionButtons(item, payload);
                const cost = item.points_deducted || 0;

                return `
                    <div class="verify-history-item ${getHistoryStatusCss(item.status)}">
                        <div class="verify-history-item-time">${time}</div>
                        <div class="verify-history-item-main">
                            <div class="verify-history-item-id" title="${t('verify.clickToCopy', '点击复制')}: ${escapeHtml(email)}" data-copy="${escapeHtml(email)}" data-verify-action="copy-history-id">${escapeHtml(shortEmail)}</div>
                            ${detailRowHtml}
                            ${actionHtml}
                        </div>
                        <div class="verify-history-item-status">${getHistoryStatusText(item.status)}</div>
                        <div class="verify-history-item-cost">${cost > 0 ? '-' + cost : '--'}</div>
                    </div>
                `;
            }).join('');

            void repairFalseFailedHistory(data)
                .then((repaired) => {
                    if (repaired) {
                        loadHistory();
                    }
                })
                .catch((error) => {
                    console.warn('[VerifyHistory] Failed to repair false failures:', error?.message || error);
                });
        } catch (_) {
            listEl.innerHTML = `<div class="verify-history-empty">${t('verify.loadFailed', '加载失败')}</div>`;
        }
    }

    function copyId(el) {
        const value = el.getAttribute('data-copy');
        if (!value || value === '--') return;

        navigator.clipboard.writeText(value).then(() => {
            const original = el.innerHTML;
            el.classList.add('verify-history-item-id--copied');
            el.innerHTML = `<i class="fas fa-check"></i> ${t('verify.copied', '已复制')}`;
            setTimeout(() => {
                el.innerHTML = original;
                el.classList.remove('verify-history-item-id--copied');
            }, 1200);
        }).catch(() => {
            const ta = document.createElement('textarea');
            ta.value = value;
            ta.className = 'verify-copy-fallback';
            ta.setAttribute('aria-hidden', 'true');
            ta.tabIndex = -1;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
        });
    }

    async function exportHistory() {
        let data = historyData;

        if (!data || data.length === 0) {
            if (!currentUser || !window.supabaseClient) {
                alert(t('verify.historyLoginPrompt', '登录后查看历史记录'));
                return;
            }

            try {
                const result = await window.supabaseClient
                    .from('verification_logs')
                    .select(VERIFY_HISTORY_SELECT)
                    .eq('user_id', currentUser.id)
                    .eq('site', getCurrentSiteValue())
                    .order('created_at', { ascending: false });

                if (result.error) {
                    console.warn('[VerifyHistory] Failed to export history:', result.error.message || result.error);
                    alert(t('verify.loadFailed', '加载失败'));
                    return;
                }

                if (!result.data || result.data.length === 0) {
                    alert(t('verify.historyEmpty', '暂无历史记录'));
                    return;
                }

                data = result.data;
            } catch (_) {
                alert(t('verify.loadFailed', '加载失败'));
                return;
            }
        }

        const headers = [
            t('verify.exportHeaderTime', '时间'),
            t('verify.exportHeaderEmail', '邮箱'),
            t('verify.exportHeaderStatus', '状态'),
            t('verify.exportHeaderDetail', '详情'),
            t('verify.exportHeaderCost', '积分消耗')
        ];
        const rows = data.map((item) => {
            const time = new Date(item.created_at).toLocaleString(getLocale());
            const email = getHistoryEmail(item);
            const statusText = getHistoryStatusText(item.status).replace(/<[^>]*>?/gm, '').trim();
            const detailText = getHistoryDetailText(item);
            const cost = item.points_deducted || 0;

            return [time, email, statusText, detailText, cost > 0 ? '-' + cost : '0']
                .map((field) => `"${String(field).replace(/"/g, '""')}"`)
                .join(',');
        });

        const csv = '\uFEFF' + headers.join(',') + '\n' + rows.join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `google_one_history_${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    async function init() {
        const container = document.getElementById(CONFIG.containerId);
        if (!container) return;

        await loadConfig();

        let isLoggedIn = false;
        const cachedUser = readCachedProfile();
        if (cachedUser) {
            currentUser = cachedUser;
            isLoggedIn = true;
        }
        hadOptimisticLogin = isLoggedIn;

        if (!window.i18n || typeof window.i18n.t !== 'function') {
            await new Promise((resolve) => {
                let count = 0;
                const check = setInterval(() => {
                    count++;
                    if ((window.i18n && typeof window.i18n.t === 'function') || count > 20) {
                        clearInterval(check);
                        resolve();
                    }
                }, 100);
            });
        }

        render(container, isLoggedIn);
        focusVerifyHelpHash();
        focusVerifyHistoryHash();
        setupAuthListener();
        refreshQuotaSoon(0);

        if (CONFIG.enabled === false) {
            applyMaintenanceState();
        }

        window.addEventListener('languageChanged', () => {
            render(container, !!currentUser);
            focusVerifyHelpHash();
            focusVerifyHistoryHash();
            if (CONFIG.enabled === false) applyMaintenanceState();
        });
    }

    function applyMaintenanceState() {
        const submitBtn = document.getElementById('verifySubmitBtn');
        if (!submitBtn) return;

        submitBtn.disabled = false;
        submitBtn.classList.add('verify-submit-btn--maintenance');
        submitBtn.innerHTML = `<i class="fas fa-tools"></i> ${t('verify.serviceUnavailable', '服务维护中')}`;
    }

    window.VerifyWidget = {
        init,
        submit,
        cancel,
        resetForm,
        togglePasswordVisibility,
        runPreviewExecution,
        setPreviewMode,
        reload: loadConfig,
        loadHistory,
        exportHistory,
        copyId,
        refreshQuota: () => {
            quotaRefreshPending = false;
            return loadApiQuota();
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
