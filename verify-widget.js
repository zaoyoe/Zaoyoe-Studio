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

    function getLang() {
        return window.i18n?.getCurrentLanguage?.() || 'zh';
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

    function clampProgress(value) {
        const num = Number(value);
        if (!Number.isFinite(num)) return 0;
        return Math.max(0, Math.min(100, num));
    }

    function getWidgetElement() {
        return document.querySelector(`#${CONFIG.containerId} .verify-widget`) || document.querySelector('.verify-widget');
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

        widget.style.setProperty('--verify-progress', `${clampProgress(progress)}%`);
        widget.style.setProperty('--verify-progress-opacity', visible ? '1' : '0');
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
            setRingProgress(progress ?? 18, true);
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

        const emailInput = document.getElementById('verifyEmailInput');
        const passwordInput = document.getElementById('verifyPasswordInput');
        const totpInput = document.getElementById('verifyTotpInput');
        const email = String(emailInput?.value || '').trim();
        const password = String(passwordInput?.value || '').trim();
        const totp = String(totpInput?.value || '').trim();
        const priority = !!document.getElementById('verifyPriorityToggle')?.checked;
        const hasIntent = !!(email || password || totp || priority);
        const isFocused = [emailInput, passwordInput, totpInput].some((input) => input && input === document.activeElement);

        applyRingState(hasIntent || isFocused ? 'armed' : 'idle', hasIntent ? 22 : isFocused ? 12 : 0);
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

    async function loadApiQuota() {
        try {
            const res = await fetch(`${CONFIG.nodeServerUrl}/api/quota`);
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
                quotaEl.innerHTML = '<i class="fas fa-question-circle"></i> --';
            } else {
                const color = apiCredits > 5 ? '#27ae60' : apiCredits > 0 ? '#f39c12' : '#e74c3c';
                quotaEl.innerHTML = `<i class="fas fa-gem" style="color: ${color}"></i> <span style="color: ${color}">${escapeHtml(formatBalanceValue(apiCredits))}</span>`;
            }
        }

        if (quotaBar) {
            if (apiCredits === 0) {
                quotaBar.style.display = 'flex';
                if (submitBtn && !isLoading) submitBtn.disabled = true;
            } else {
                quotaBar.style.display = 'none';
                if (submitBtn && !isLoading) submitBtn.disabled = false;
            }
        }
    }

    function render(container, isLoggedIn = false) {
        const loginDisplay = isLoggedIn ? 'none' : 'block';
        const formDisplay = isLoggedIn ? 'block' : 'none';
        const balanceDisplay = isLoggedIn ? 'flex' : 'none';

        container.innerHTML = `
            <div class="verify-widget ring-idle">
                <div class="verify-widget-topline" aria-hidden="true">
                    <div class="verify-orbit-lights">
                        <span class="verify-orbit-light light-primary"></span>
                        <span class="verify-orbit-light light-secondary"></span>
                        <span class="verify-orbit-light light-accent"></span>
                    </div>
                    <div class="verify-orbit-trail"></div>
                </div>
                <div class="verify-widget-header">
                    <div class="verify-widget-icon">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.1));">
                            <path fill-rule="evenodd" clip-rule="evenodd" d="M15.5 4C12.4624 4 10 6.46243 10 9.5C10 10.751 10.4173 11.9039 11.129 12.835L4.56066 19.4033C4.24647 19.7175 4.24647 20.227 4.56066 20.5412L5.45879 21.4393C5.77298 21.7535 6.28248 21.7535 6.59667 21.4393L8.5 19.536L10.4033 21.4393C10.7175 21.7535 11.227 21.7535 11.5412 21.4393L12.4393 20.5412C12.7535 20.227 12.7535 19.7175 12.4393 19.4033L11.536 17.5L12.835 16.129C13.7547 16.708 14.739 17 15.5 17C18.5376 17 21 14.5376 21 11.5C21 8.46243 18.5376 4 15.5 4ZM17 9C17.5523 9 18 8.55228 18 8C18 7.44772 17.5523 7 17 7C16.4477 7 16 7.44772 16 8C16 8.55228 16.4477 9 17 9Z" fill="white"/>
                        </svg>
                    </div>
                    <div class="verify-widget-title">
                        <h3>${t('verify.title', 'Google One')}</h3>
                        <p>${t('verify.subtitle', '自动获取试用链接')}</p>
                    </div>
                    <div class="verify-header-right">
                        <div class="verify-api-quota" id="verifyApiQuota" title="API 剩余额度">
                            <i class="fas fa-gem"></i> --
                        </div>
                        <div class="verify-balance" id="verifyBalance" style="display: ${balanceDisplay}; cursor: pointer;" onclick="WalletModal.open()" title="我的钱包">
                            <i class="fas fa-coins"></i>
                            <span id="verifyBalanceValue">0</span>
                        </div>
                    </div>
                </div>

                <div class="verify-quota-warning" id="verifyQuotaWarning" style="display: none;">
                    <i class="fas fa-exclamation-triangle"></i>
                    ${t('verify.quotaExhausted', 'API 余额不足，暂时无法提交任务。')}
                </div>

                <div id="verifyContent">
                    <div class="verify-login-prompt" id="verifyLoginPrompt" style="display: ${loginDisplay};">
                        <p>${t('verify.loginPrompt', '登录后即可使用验证服务')}</p>
                        <button class="verify-login-btn" onclick="window.toggleLoginModal && window.toggleLoginModal()">
                            <i class="fas fa-sign-in-alt"></i>
                            ${t('verify.loginBtn', '登录 / 注册')}
                        </button>
                    </div>

                    <div id="verifyForm" style="display: ${formDisplay};">
                        <div class="verify-input-area verify-form-layout">
                            <div class="verify-form-notice">
                                <div class="verify-form-notice-icon">
                                    <i class="fas fa-shield-alt"></i>
                                </div>
                                <div class="verify-form-notice-copy">
                                    <strong>${t('verify.noticeTitle', '提交账号信息')}</strong>
                                    <span>${t('verify.noticeBody', '仅提交当前任务所需信息，密码与 2FA 密钥不会写入历史记录。')}</span>
                                </div>
                            </div>

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
                                        placeholder="${t('verify.passwordPlaceholder', '请输入 Google 账号密码')}"
                                    />
                                    <button
                                        class="verify-password-toggle"
                                        id="verifyPasswordToggle"
                                        type="button"
                                        onclick="VerifyWidget.togglePasswordVisibility()"
                                        aria-label="${t('verify.showPassword', '显示密码')}"
                                        title="${t('verify.showPassword', '显示密码')}"
                                    >
                                        <i class="fas fa-eye"></i>
                                    </button>
                                </div>
                            </label>

                            <label class="verify-form-field">
                                <span class="verify-field-label">${t('verify.totpLabel', '2FA 密钥（Base32）')} <em>*</em></span>
                                <input
                                    class="verify-input"
                                    id="verifyTotpInput"
                                    type="text"
                                    spellcheck="false"
                                    autocapitalize="characters"
                                    autocomplete="off"
                                    placeholder="${t('verify.totpPlaceholder', '例如：JBSWY3DPEHPK3PXP')}"
                                />
                            </label>

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
                                <button class="verify-reset-btn" id="verifyResetBtn" onclick="VerifyWidget.resetForm()">
                                    <i class="fas fa-rotate-left"></i>
                                    ${t('verify.resetForm', '清空')}
                                </button>
                                <button class="verify-submit-btn" id="verifySubmitBtn" onclick="VerifyWidget.submit()">
                                    <i class="fas fa-paper-plane"></i>
                                    ${t('verify.startVerify', '提交账号')}
                                </button>
                            </div>

                            <div class="verify-preview-module">
                                <div class="verify-preview-copy">
                                    <strong>${t('verify.previewTitle', '预执行模块')}</strong>
                                    <span>${t('verify.previewHint', '仅用于测试顶部星环和任务状态动效，不扣积分，也不会写入历史。')}</span>
                                </div>
                                <div class="verify-preview-toolbar">
                                    <div class="verify-preview-mode" role="group" aria-label="${t('verify.previewModeLabel', '预执行结果')}">
                                        <button
                                            class="verify-preview-mode-btn"
                                            id="verifyPreviewModeSuccess"
                                            type="button"
                                            data-mode="success"
                                            onclick="VerifyWidget.setPreviewMode('success')"
                                        >
                                            ${t('verify.previewSuccessMode', '成功')}
                                        </button>
                                        <button
                                            class="verify-preview-mode-btn"
                                            id="verifyPreviewModeError"
                                            type="button"
                                            data-mode="error"
                                            onclick="VerifyWidget.setPreviewMode('error')"
                                        >
                                            ${t('verify.previewFailureMode', '失败')}
                                        </button>
                                    </div>
                                    <button class="verify-preview-btn" id="verifyPreviewBtn" type="button" onclick="VerifyWidget.runPreviewExecution()">
                                        <i class="fas fa-flask"></i>
                                        ${t('verify.previewRun', '预执行')}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
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
                    <div class="verify-batch-summary" id="verifyBatchSummary" style="display: none;">
                        <div class="verify-batch-stat success">
                            <i class="fas fa-check-circle"></i>
                            ${t('verify.success', '成功')}: <span id="successCount">0</span>
                        </div>
                        <div class="verify-batch-stat error">
                            <i class="fas fa-times-circle"></i>
                            ${t('verify.failed', '失败')}: <span id="failedCount">0</span>
                        </div>
                        <div class="verify-batch-stat total">
                            <i class="fas fa-list"></i>
                            ${t('verify.total', '总计')}: <span id="totalCount">0</span>
                        </div>
                    </div>
                </div>

                <div class="verify-result" id="verifyResult">
                    <div class="verify-result-header">
                        <div class="verify-result-icon"><i class="fas fa-check"></i></div>
                        <div class="verify-result-title" id="verifyResultTitle"></div>
                    </div>
                    <div class="verify-result-message" id="verifyResultMessage"></div>
                </div>
            </div>

            <div class="verify-history-card" id="verifyHistoryCard">
                <div class="verify-history-header">
                    <div class="verify-history-title">
                        <i class="fas fa-clock-rotate-left"></i>
                        ${t('verify.history', '任务历史')}
                    </div>
                    <div class="verify-history-actions">
                        <button class="verify-history-export" onclick="VerifyWidget.exportHistory()" title="导出 CSV">
                            <i class="fas fa-file-export"></i>
                        </button>
                        <button class="verify-history-refresh" onclick="VerifyWidget.loadHistory()" title="刷新">
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
        `;

        setupInputListener();
        updatePreviewModeUI();
        updatePriceDisplay();
        updateQuotaDisplay();
        loadHistory();
        syncRingStateFromInputs();

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
            if (loginPrompt) loginPrompt.style.display = 'none';
            if (form) form.style.display = 'block';
            if (balanceEl) balanceEl.style.display = 'flex';
            persistMergedCachedProfile(currentUser);
            await loadUserBalance();
        } else {
            if (loginPrompt) loginPrompt.style.display = 'block';
            if (form) form.style.display = 'none';
            if (balanceEl) balanceEl.style.display = 'none';
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
        activeTasks.clear();
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
        if (submitBtn) submitBtn.disabled = true;
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

        const submitBtn = document.getElementById('verifySubmitBtn');
        const resetBtn = document.getElementById('verifyResetBtn');

        if (!submitBtn) return;

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
            const res = await fetch(`${CONFIG.nodeServerUrl}/api/verify`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: entry.email,
                    password: entry.password,
                    totpSecret: entry.totpSecret,
                    priority: entry.priority,
                    userId,
                    site: window.SiteConfig?.site || 'cn'
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

            const display = getResultDisplay({
                status: data.status || 'queued',
                queue_position: data.queue_position,
                estimated_wait_seconds: data.estimated_wait_seconds
            });
            updateResultItem(entry.index, display.status, display.html);
            updateExecutionRing(data);

            pollTask(jobId, userId, entry).then((result) => {
                if (result.success) {
                    batchStats.success = 1;
                    if (result.pointsDeducted) {
                        userBalance = Math.max(0, userBalance - result.pointsDeducted);
                        const balEl = document.getElementById('verifyBalanceValue');
                        if (balEl) balEl.textContent = userBalance;
                    }
                } else {
                    batchStats.failed = 1;
                }

                updateBatchProgress(1, 1);
                finishVerification({ outcome: result.success ? 'success' : 'error' });
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

    function pollTask(jobId, userId, entry) {
        return new Promise((resolve) => {
            const startTime = Date.now();

            const timer = setInterval(async () => {
                if (!activeTasks.has(jobId)) {
                    clearInterval(timer);
                    resolve({ success: false, pointsDeducted: 0 });
                    return;
                }

                if (Date.now() - startTime > CONFIG.pollTimeout) {
                    clearInterval(timer);
                    activeTasks.delete(jobId);
                    const timeoutText = t('verify.timeout', '任务超时，请稍后重试');
                    updateResultItem(entry.index, 'error', escapeHtml(timeoutText));
                    await logToHistory(entry.email, 'timeout', {
                        email: entry.email,
                        job_id: jobId,
                        error_message: timeoutText,
                        raw_status: 'timeout'
                    });
                    resolve({ success: false, pointsDeducted: 0 });
                    return;
                }

                try {
                    const site = encodeURIComponent(window.SiteConfig?.site || 'cn');
                    const email = encodeURIComponent(entry.email);
                    const res = await fetch(
                        `${CONFIG.nodeServerUrl}/api/verify/status/${encodeURIComponent(jobId)}?userId=${encodeURIComponent(userId)}&site=${site}&email=${email}`
                    );
                    const data = await res.json().catch(() => ({}));

                    if (!res.ok) {
                        clearInterval(timer);
                        activeTasks.delete(jobId);
                        const errorText = getErrorLabel(data.code, data.message || t('verify.loadFailed', '状态查询失败'));
                        updateResultItem(entry.index, 'error', escapeHtml(errorText));
                        await logToHistory(entry.email, 'failed', {
                            email: entry.email,
                            job_id: jobId,
                            error_code: data.code || '',
                            error_message: errorText,
                            raw_status: 'status_error'
                        });
                        resolve({ success: false, pointsDeducted: 0 });
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
                            pointsDeducted: Number(data.pointsDeducted) || 0
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
        const { skipRefresh = false, outcome = '' } = options;
        isLoading = false;
        activeTasks.clear();
        clearPreviewTimers();

        const submitBtn = document.getElementById('verifySubmitBtn');
        const resetBtn = document.getElementById('verifyResetBtn');
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = `<i class="fas fa-paper-plane"></i> ${t('verify.startVerify', '提交账号')}`;
        }
        if (resetBtn) resetBtn.disabled = false;
        setPreviewControlsDisabled(false);

        showBatchSummary();
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

        const icons = {
            success: 'fa-check',
            error: 'fa-times',
            processing: 'fa-spinner fa-spin',
            info: 'fa-info-circle'
        };

        const item = document.createElement('div');
        item.className = `verify-result-item ${status}`;
        item.id = `result-item-${index}`;
        item.innerHTML = `
            <div class="verify-result-item-icon">
                <i class="fas ${icons[status] || 'fa-spinner fa-spin'}"></i>
            </div>
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

        const icons = {
            success: 'fa-check',
            error: 'fa-times',
            processing: 'fa-spinner fa-spin',
            info: 'fa-info-circle'
        };

        item.className = `verify-result-item ${status}`;
        const iconEl = item.querySelector('.verify-result-item-icon i');
        if (iconEl) {
            iconEl.className = `fas ${icons[status] || 'fa-spinner fa-spin'}`;
        }

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
        if (el) el.style.display = 'flex';

        const successEl = document.getElementById('successCount');
        const failedEl = document.getElementById('failedCount');
        const totalEl = document.getElementById('totalCount');

        if (successEl) successEl.textContent = batchStats.success;
        if (failedEl) failedEl.textContent = batchStats.failed;
        if (totalEl) totalEl.textContent = batchStats.total;
    }

    function hideBatchSummary() {
        const el = document.getElementById('verifyBatchSummary');
        if (el) el.style.display = 'none';
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
            return `<i class="fas fa-check-circle" style="color: #22c55e;"></i> ${t('verify.successText', '成功')}`;
        }
        if (normalized.includes('queued') || normalized.includes('running') || normalized.includes('process')) {
            return `<i class="fas fa-sync fa-spin" style="color: #3498db;"></i> ${t('verify.processText', '处理中')}`;
        }
        if (normalized.includes('fail') || normalized.includes('error') || normalized.includes('timeout')) {
            return `<i class="fas fa-times-circle" style="color: #ef4444;"></i> ${t('verify.failText', '失败')}`;
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
                const time = new Date(item.created_at).toLocaleString('zh-CN', {
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
                            <div class="verify-history-item-id" title="${t('verify.clickToCopy', '点击复制')}: ${escapeHtml(email)}" data-copy="${escapeHtml(email)}" onclick="VerifyWidget.copyId(this)">${escapeHtml(shortEmail)}</div>
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
            el.innerHTML = `<i class="fas fa-check" style="color: #22c55e;"></i> ${t('verify.copied', '已复制')}`;
            el.style.color = '#22c55e';
            setTimeout(() => {
                el.innerHTML = original;
                el.style.color = '';
            }, 1200);
        }).catch(() => {
            const ta = document.createElement('textarea');
            ta.value = value;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
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

        const headers = ['时间', '邮箱', '状态', '详情', '积分消耗'];
        const rows = data.map((item) => {
            const time = new Date(item.created_at).toLocaleString('zh-CN');
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
        submitBtn.style.background = 'rgba(239, 68, 68, 0.3)';
        submitBtn.style.borderColor = 'rgba(239, 68, 68, 0.5)';
        submitBtn.style.cursor = 'pointer';
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
