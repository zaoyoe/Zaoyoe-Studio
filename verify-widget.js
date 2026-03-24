/**
 * Google One Job Widget
 * Submit a single Google account job and poll job status
 */

(function () {
    'use strict';

    const CONFIG = {
        pricePerVerify: 10,
        enabled: true,
        nodeServerUrl: window.VERIFY_SERVER_URL || 'https://zaoyoe-verify-server-production.up.railway.app',
        containerId: 'verify-widget-container',
        pollInterval: 3000,
        pollTimeout: 300000
    };
    const PENDING_TASK_STORAGE_KEY = 'verify_pending_google_one_job_v1';
    const VERIFY_STYLE_DECL_KEY = 'style';

    let currentUser = null;
    let userBalance = 0;
    let apiCredits = -1;
    let isLoading = false;
    let batchStats = { success: 0, failed: 0, total: 0 };
    let activeTasks = new Map(); // jobId -> { index, email, timer }
    let historyData = [];
    let authBootstrapResolved = false;
    let hadOptimisticLogin = false;
    let authNullConfirmTimer = null;
    let walletBalanceListenerBound = false;
    let previewMode = 'success';
    let previewTimers = [];
    let ringResetTimer = null;

    const ERROR_CODE_MAP = {
        invalid_api_key: { zh: 'API Key 无效或缺失', en: 'Invalid or missing API key' },
        insufficient_balance: { zh: 'API Key 余额不足', en: 'Insufficient API key balance' },
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

        if (!jobId || !email || !userId) return null;

        return { jobId, email, userId, site, createdAt };
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
        if (hostname === 'zaoyoe.com') return 'https://www.zaoyoe.com/shop';
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
                    window.WalletModal?.open?.();
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
        const status = String(data?.status || '').toLowerCase();

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

    function getHistoryEmail(item) {
        const payload = parseHistoryMessage(item?.message);
        return payload?.email || item?.verification_id || '--';
    }

    function getHistoryDetail(item) {
        const payload = parseHistoryMessage(item?.message);

        if (payload?.url) {
            return { type: 'url', text: payload.url, href: payload.url };
        }

        const errorText = payload?.error_message || getErrorLabel(payload?.error_code, '');
        if (errorText) {
            return { type: 'text', text: errorText };
        }

        const rawMessage = String(item?.message || '').trim();
        return { type: 'text', text: rawMessage || '--' };
    }

    function getHistoryDetailText(item) {
        return getHistoryDetail(item).text || '--';
    }

    function getResultDisplay(data) {
        const lang = getLang();
        const status = String(data?.status || '').toLowerCase();
        const stageLabel = formatStageLabel(data?.stage_label);

        if (status === 'queued') {
            const segments = [lang === 'zh' ? '排队中' : 'Queued'];
            const queuePosition = Number(data?.queue_position);
            const waitSeconds = Number(data?.estimated_wait_seconds);

            if (Number.isFinite(queuePosition) && queuePosition >= 0) {
                segments.push(lang === 'zh' ? `队列位置 ${queuePosition}` : `Position ${queuePosition}`);
            }

            if (Number.isFinite(waitSeconds) && waitSeconds > 0) {
                segments.push(lang === 'zh' ? `预计 ${formatWaitSeconds(waitSeconds)}` : `~${formatWaitSeconds(waitSeconds)}`);
            }

            return {
                status: 'processing',
                html: escapeHtml(segments.join(' · ')),
                terminal: false,
                success: false
            };
        }

        if (status === 'running') {
            const segments = [lang === 'zh' ? '执行中' : 'Running'];
            if (stageLabel) {
                segments.push(stageLabel);
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
            const successText = lang === 'zh' ? '链接获取成功' : 'Link ready';
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
            if (!window.supabaseClient) return;
            const { data, error } = await window.supabaseClient
                .from('system_config')
                .select('config_value')
                .eq('config_key', 'verify_settings')
                .single();

            if (!error && data?.config_value) {
                CONFIG.pricePerVerify = Number(data.config_value.price_per_verify) || 10;
                CONFIG.enabled = data.config_value.enabled !== false;
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

    async function loadApiQuota() {
        try {
            const headers = await getVerifyRequestHeaders();
            const res = await fetch(`${CONFIG.nodeServerUrl}/api/quota`, { headers });
            const data = await res.json();
            if (data.success) {
                apiCredits = Number(data.balance ?? data.credits ?? 0);
            } else {
                apiCredits = -1;
            }
        } catch (_) {
            apiCredits = -1;
        }
        updateQuotaDisplay();
    }

    function updateQuotaDisplay() {
        const quotaEl = document.getElementById('verifyApiQuota');
        const quotaBar = document.getElementById('verifyQuotaWarning');
        const submitBtn = document.getElementById('verifySubmitBtn');

        if (quotaEl) {
            if (apiCredits < 0) {
                setVerifyQuotaTone(quotaEl, 'unknown');
                quotaEl.innerHTML = '<i class="fas fa-question-circle"></i> <span class="verify-api-quota-value">--</span>';
            } else {
                const tone = apiCredits > 5 ? 'ok' : apiCredits > 0 ? 'warning' : 'danger';
                setVerifyQuotaTone(quotaEl, tone);
                quotaEl.innerHTML = `<i class="fas fa-gem"></i> <span class="verify-api-quota-value">${escapeHtml(formatBalanceValue(apiCredits))}</span>`;
            }
        }

        if (quotaBar) {
            if (apiCredits === 0) {
                setVerifyHidden(quotaBar, false);
                if (submitBtn && !isLoading) submitBtn.disabled = true;
            } else {
                setVerifyHidden(quotaBar, true);
                if (submitBtn && !isLoading) submitBtn.disabled = false;
            }
        }
    }

    function render(container, isLoggedIn = false) {
        const supportedRegionsUrl = getLang() === 'zh'
            ? 'https://support.google.com/googleone/answer/9080668?hl=zh-Hans'
            : 'https://support.google.com/googleone/answer/9080668?hl=en';
        const shopUrl = getShopUrl();

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
                        <p>${t('verify.subtitle', '获取 1年 pro 权限的试用链接')}</p>
                    </div>
                    <div class="verify-header-right">
                        <div class="verify-api-quota" id="verifyApiQuota" title="${t('verify.apiQuotaTitle', 'API 剩余额度')}">
                            <i class="fas fa-gem"></i> --
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

                                <div class="verify-form-meta">
                                    <label class="verify-priority-pill" for="verifyPriorityToggle">
                                        <input id="verifyPriorityToggle" type="checkbox" />
                                        <span>${t('verify.priorityLabel', '高优先级任务')}</span>
                                    </label>
                                    <div class="verify-price-info verify-form-price">
                                        <i class="fas fa-coins"></i>
                                        ${t('verify.singleCost', '本次提交消耗')} <span class="price" id="verifySingleCost">${CONFIG.pricePerVerify}</span> ${t('verify.points', '积分')}
                                    </div>
                                </div>

                                <div class="verify-form-actions">
                                    <button class="verify-reset-btn" id="verifyResetBtn" data-verify-action="reset-form">
                                        <i class="fas fa-rotate-left"></i>
                                        ${t('verify.resetForm', '清空')}
                                    </button>
                                    <button class="verify-submit-btn" id="verifySubmitBtn" data-verify-action="submit">
                                        <i class="fas fa-paper-plane"></i>
                                        ${t('verify.startVerify', '提交账号')}
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

                            <aside class="verify-guide-card">
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
                                            <span>${t('verify.guideNoteSuccessPrefix', '成功后：自行打开链接绑卡订阅。无卡可前往')}<a class="verify-guide-link verify-guide-link-inline" href="${shopUrl}" target="_blank" rel="noopener noreferrer">${t('verify.guideShopLink', '商城')}</a>${t('verify.guideNoteSuccessSuffix', '购卡。')}</span>
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
                return;
            }

            applyResolvedAuthState(session?.user || null, `onAuthStateChange:${event || 'unknown'}`);
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
        const priorityToggle = document.getElementById('verifyPriorityToggle');

        [emailInput, passwordInput, totpInput].forEach((input) => {
            if (!input) return;
            input.addEventListener('input', () => {
                const result = document.getElementById('verifyResult');
                if (result) result.classList.remove('show');
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

        if (priorityToggle) {
            priorityToggle.addEventListener('change', syncRingStateFromInputs);
        }
    }

    function readFormEntry() {
        const emailInput = document.getElementById('verifyEmailInput');
        const passwordInput = document.getElementById('verifyPasswordInput');
        const totpInput = document.getElementById('verifyTotpInput');
        const priorityToggle = document.getElementById('verifyPriorityToggle');

        const email = String(emailInput?.value || '').trim().toLowerCase();
        const password = String(passwordInput?.value || '').trim();
        const totpSecret = String(totpInput?.value || '').trim().toUpperCase().replace(/[^A-Z2-7]/g, '');
        const priority = priorityToggle?.checked ? 1 : 0;

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
                priority
            }
        };
    }

    function resetForm() {
        if (isLoading) return;

        const emailInput = document.getElementById('verifyEmailInput');
        const passwordInput = document.getElementById('verifyPasswordInput');
        const totpInput = document.getElementById('verifyTotpInput');
        const priorityToggle = document.getElementById('verifyPriorityToggle');
        const passwordToggle = document.getElementById('verifyPasswordToggle');
        const result = document.getElementById('verifyResult');
        const batch = document.getElementById('verifyBatchResults');

        if (emailInput) emailInput.value = '';
        if (passwordInput) {
            passwordInput.value = '';
            passwordInput.type = 'password';
        }
        if (totpInput) totpInput.value = '';
        if (priorityToggle) priorityToggle.checked = false;
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
            el.textContent = `（${CONFIG.pricePerVerify}${t('verify.perPrice', '积分/次')}）`;
        });

        const singleCost = document.getElementById('verifySingleCost');
        if (singleCost) singleCost.textContent = CONFIG.pricePerVerify;
    }

    function prepareExecutionDisplay(label, waitingMessage) {
        const batchPanel = document.getElementById('verifyBatchResults');
        const singleResult = document.getElementById('verifyResult');

        if (singleResult) singleResult.classList.remove('show');
        if (batchPanel) batchPanel.classList.add('show');

        batchStats = { success: 0, failed: 0, total: 1 };
        clearActiveTaskTimers();
        clearResultsList();
        hideBatchSummary();
        addResultItem(0, label, 'processing', escapeHtml(waitingMessage));
        updateBatchProgress(0, 1);
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
            timer: null
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

        const parsed = readFormEntry();
        if (!parsed.valid) {
            showSingleResult(
                'error',
                t('verify.formatError', '信息不完整'),
                parsed.reason || t('verify.missingRequired', '请完整填写邮箱、密码和 2FA 密钥')
            );
            return;
        }

        const entry = parsed.entry;
        const totalCost = CONFIG.pricePerVerify;
        if (userBalance < totalCost) {
            showSingleResult(
                'error',
                t('verify.insufficientPoints', '积分不足'),
                `${t('verify.needPoints', '需要积分')}: ${totalCost} / ${t('verify.remaining', '当前余额')}: ${userBalance}`
            );
            return;
        }

        if (apiCredits === 0) {
            showSingleResult(
                'error',
                t('verify.quotaExhausted', 'API 余额不足'),
                t('verify.quotaExhausted', 'API 余额不足，暂时无法提交任务。')
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

        let userId = currentUser?.id || currentUser?.user_id;

        if (!userId) {
            try {
                const userPromise = window.supabaseClient.auth.getUser();
                const timeoutPromise = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error(t('verify.pleaseLogin', '请先登录'))), 5000)
                );
                const { data } = await Promise.race([userPromise, timeoutPromise]);
                userId = data?.user?.id;
            } catch (error) {
                const errorMessage = error.message || t('verify.pleaseLogin', '请先登录');
                updateResultItem(entry.index, 'error', escapeHtml(errorMessage));
                batchStats.failed = 1;
                finishVerification({ outcome: 'error' });
                return;
            }
        }

        try {
            updateResultItem(entry.index, 'processing', escapeHtml(t('verify.verifying', '提交中...')));

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000);
            const headers = await getVerifyRequestHeaders(true);
            const res = await fetch(`${CONFIG.nodeServerUrl}/api/verify`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    email: entry.email,
                    password: entry.password,
                    totpSecret: entry.totpSecret,
                    priority: entry.priority
                }),
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            const data = await res.json().catch(() => ({}));

            if (!res.ok || !data.success) {
                const errorText = getErrorLabel(data.code, data.message || t('verify.loadFailed', '提交失败'));
                updateResultItem(entry.index, 'error', escapeHtml(errorText));
                batchStats.failed = 1;
                updateBatchProgress(1, 1);
                await logToHistory(entry.email, 'failed', {
                    email: entry.email,
                    error_code: data.code || '',
                    error_message: errorText,
                    raw_status: 'submit_failed'
                });
                finishVerification({ outcome: 'error' });
                return;
            }

            const jobId = data.job_id || data.task_id;
            if (!jobId) {
                const errorText = t('verify.loadFailed', '提交失败');
                updateResultItem(entry.index, 'error', escapeHtml(errorText));
                batchStats.failed = 1;
                updateBatchProgress(1, 1);
                await logToHistory(entry.email, 'failed', {
                    email: entry.email,
                    error_message: errorText,
                    raw_status: 'missing_job_id'
                });
                finishVerification({ outcome: 'error' });
                return;
            }

            activeTasks.set(jobId, {
                index: entry.index,
                email: entry.email,
                timer: null
            });
            persistPendingTask({
                jobId,
                email: entry.email,
                userId,
                site: getCurrentSiteValue()
            });

            const display = getResultDisplay({
                status: data.status || 'queued',
                queue_position: data.queue_position,
                estimated_wait_seconds: data.estimated_wait_seconds
            });
            updateResultItem(entry.index, display.status, display.html);
            updateExecutionRing(data);

            pollTask(jobId, entry).then((result) => {
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
                    jobId,
                    preservePending: !result.terminal,
                    showSummary: result.terminal
                });
            });
        } catch (error) {
            const errorText = error.message || t('verify.loadFailed', '提交失败');
            updateResultItem(entry.index, 'error', escapeHtml(errorText));
            batchStats.failed = 1;
            updateBatchProgress(1, 1);
            await logToHistory(entry.email, 'error', {
                email: entry.email,
                error_message: errorText,
                raw_status: 'submit_error'
            });
            finishVerification({ outcome: 'error' });
        }
    }

    function pollTask(jobId, entry) {
        return new Promise((resolve) => {
            const startTime = Date.now();
            const backgroundContinueText = t('verify.pendingBackgroundContinue', '连接暂时中断，任务仍在后台处理，可稍后在任务历史查看');
            const backgroundContinueHint = t('verify.pendingBackgroundContinueHint', '你也可以刷新页面继续追踪当前任务');

            const timer = setInterval(async () => {
                if (!activeTasks.has(jobId)) {
                    clearInterval(timer);
                    resolve({ success: false, pointsDeducted: 0, terminal: false });
                    return;
                }

                if (Date.now() - startTime > CONFIG.pollTimeout) {
                    clearInterval(timer);
                    activeTasks.delete(jobId);
                    updateResultItem(
                        entry.index,
                        'processing',
                        `${escapeHtml(backgroundContinueText)}<div class="verify-result-subtle">${escapeHtml(backgroundContinueHint)}</div>`
                    );
                    resolve({ success: false, pointsDeducted: 0, terminal: false });
                    return;
                }

                try {
                    const headers = await getVerifyRequestHeaders();
                    const res = await fetch(
                        `${CONFIG.nodeServerUrl}/api/verify/status/${encodeURIComponent(jobId)}`,
                        { headers }
                    );
                    const data = await res.json().catch(() => ({}));

                    if (!res.ok) {
                        clearInterval(timer);
                        activeTasks.delete(jobId);
                        updateResultItem(
                            entry.index,
                            'processing',
                            `${escapeHtml(backgroundContinueText)}<div class="verify-result-subtle">${escapeHtml(backgroundContinueHint)}</div>`
                        );
                        resolve({ success: false, pointsDeducted: 0, terminal: false });
                        return;
                    }

                    const display = getResultDisplay(data);
                    updateResultItem(entry.index, display.status, display.html);
                    updateExecutionRing(data);

                    if (display.terminal) {
                        clearInterval(timer);
                        activeTasks.delete(jobId);
                        resolve({
                            success: display.success,
                            pointsDeducted: Number(data.pointsDeducted) || 0,
                            terminal: true
                        });
                    }
                } catch (error) {
                    console.warn('[VerifyWidget] Poll error (retrying):', error.message);
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
            submitBtn.innerHTML = `<i class="fas fa-paper-plane"></i> ${t('verify.startVerify', '提交账号')}`;
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
        const normalized = String(status || '').toLowerCase();
        if (normalized.includes('success') || normalized.includes('completed')) return 'success';
        if (normalized.includes('queued') || normalized.includes('running') || normalized.includes('process')) return 'processing';
        if (normalized.includes('fail') || normalized.includes('error') || normalized.includes('timeout')) return 'error';
        return '';
    }

    function getHistoryStatusText(status) {
        const normalized = String(status || '').toLowerCase();

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
                .select('*')
                .eq('user_id', currentUser.id)
                .eq('site', window.SiteConfig?.site || 'cn')
                .order('created_at', { ascending: false })
                .limit(20);

            if (error || !data || data.length === 0) {
                listEl.innerHTML = `<div class="verify-history-empty"><i class="fas fa-inbox"></i> ${t('verify.historyEmpty', '暂无历史记录')}</div>`;
                historyData = [];
                return;
            }

            historyData = data;

            listEl.innerHTML = data.map((item) => {
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
                const cost = item.points_deducted || 0;

                return `
                    <div class="verify-history-item ${getHistoryStatusCss(item.status)}">
                        <div class="verify-history-item-time">${time}</div>
                        <div class="verify-history-item-main">
                            <div class="verify-history-item-id" title="${t('verify.clickToCopy', '点击复制')}: ${escapeHtml(email)}" data-copy="${escapeHtml(email)}" data-verify-action="copy-history-id">${escapeHtml(shortEmail)}</div>
                            <div class="verify-history-item-message">${detailHtml}</div>
                        </div>
                        <div class="verify-history-item-status">${getHistoryStatusText(item.status)}</div>
                        <div class="verify-history-item-cost">${cost > 0 ? '-' + cost : '--'}</div>
                    </div>
                `;
            }).join('');
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
                    .select('*')
                    .eq('user_id', currentUser.id)
                    .eq('site', window.SiteConfig?.site || 'cn')
                    .order('created_at', { ascending: false });

                if (result.error || !result.data || result.data.length === 0) {
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
        setupAuthListener();
        loadApiQuota();

        if (CONFIG.enabled === false) {
            applyMaintenanceState();
        }

        window.addEventListener('languageChanged', () => {
            render(container, !!currentUser);
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
        refreshQuota: loadApiQuota
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
