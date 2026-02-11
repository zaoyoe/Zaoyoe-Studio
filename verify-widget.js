/**
 * Batch Verifier Widget v2
 * Per-item polling with bilingual status + safe cancel
 */

(function () {
    'use strict';

    // =============================================
    // Configuration
    // =============================================
    const CONFIG = {
        pricePerVerify: 10,
        nodeServerUrl: window.VERIFY_SERVER_URL || 'https://zaoyoe-verify-server-production.up.railway.app',
        containerId: 'verify-widget-container',
        pollInterval: 3000,
        pollTimeout: 600000  // 10 minutes (review can take a while)
    };

    // State
    let currentUser = null;
    let userBalance = 0;
    let isLoading = false;
    let batchStats = { success: 0, failed: 0, total: 0 };
    let activeTasks = new Map(); // taskId -> { index, verificationId, timer, aborted }

    // =============================================
    // Bilingual Status Messages (hardcoded)
    // =============================================
    const STATUS_MAP = {
        // API status → { zh, en, icon, cssClass }
        'Verification completed successfully': {
            zh: '验证成功', en: 'Verified successfully', icon: '✅', css: 'success'
        },
        'Verification completed successfully!': {
            zh: '验证成功', en: 'Verified successfully', icon: '✅', css: 'success'
        },
        'Waiting for review': {
            zh: '等待人工审核中...', en: 'Under manual review...', icon: '⏳', css: 'processing'
        },
        'Waiting for review...': {
            zh: '等待人工审核中...', en: 'Under manual review...', icon: '⏳', css: 'processing'
        },
        'Failed to submit personal information': {
            zh: '提交个人信息失败', en: 'Failed to submit personal info', icon: '❌', css: 'error'
        },
        'Failed to check verification status': {
            zh: '查询验证状态失败', en: 'Status check failed', icon: '❌', css: 'error'
        },
        'Failed to select program': {
            zh: '选择项目失败', en: 'Failed to select program', icon: '❌', css: 'error'
        },
        'Verification failed': {
            zh: '验证失败', en: 'Verification failed', icon: '❌', css: 'error'
        },
        'Verification rejected': {
            zh: '验证被拒绝', en: 'Verification rejected', icon: '❌', css: 'error'
        },
        'Already verified': {
            zh: '已验证过', en: 'Already verified', icon: 'ℹ️', css: 'info'
        },
        'Invalid verification link': {
            zh: '无效的验证链接', en: 'Invalid verification link', icon: '❌', css: 'error'
        },
        'Verification expired': {
            zh: '验证已过期', en: 'Verification expired', icon: '❌', css: 'error'
        },
        'Cancelled': {
            zh: '已取消', en: 'Cancelled', icon: '⚪', css: 'cancelled'
        }
    };

    // Status by task status field
    const TASK_STATUS_MAP = {
        'pending': { zh: '排队等待中...', en: 'Queuing...', icon: '⏳' },
        'queued': { zh: '排队等待中...', en: 'Queuing...', icon: '⏳' },
        'processing': { zh: '正在验证...', en: 'Verifying...', icon: '🔄' },
        'running': { zh: '正在验证...', en: 'Verifying...', icon: '🔄' },
        'completed': { zh: '已完成', en: 'Completed', icon: '✅' },
        'failed': { zh: '失败', en: 'Failed', icon: '❌' },
        'error': { zh: '出错', en: 'Error', icon: '❌' },
        'cancelled': { zh: '已取消', en: 'Cancelled', icon: '⚪' }
    };

    /**
     * Translate API message to bilingual string
     */
    function translateStatus(message, status) {
        // Try exact message match first
        if (message) {
            for (const [key, val] of Object.entries(STATUS_MAP)) {
                if (message.toLowerCase().includes(key.toLowerCase())) {
                    return `${val.icon} ${val.zh} / ${val.en}`;
                }
            }
        }
        // Try status field match
        if (status && TASK_STATUS_MAP[status]) {
            const s = TASK_STATUS_MAP[status];
            return `${s.icon} ${s.zh} / ${s.en}`;
        }
        // Fallback: show original message
        return message || status || '未知状态 / Unknown';
    }

    /**
     * Get CSS class from message/status
     */
    function getStatusCss(message, status) {
        if (message) {
            for (const [key, val] of Object.entries(STATUS_MAP)) {
                if (message.toLowerCase().includes(key.toLowerCase())) {
                    return val.css;
                }
            }
        }
        if (status === 'completed' || status === 'success') return 'success';
        if (status === 'failed' || status === 'error') return 'error';
        if (status === 'cancelled') return 'cancelled';
        return 'processing';
    }

    /**
     * Check if status is terminal (no more polling needed)
     */
    function isTerminalStatus(message, status) {
        const terminalMessages = [
            'completed successfully', 'failed to submit', 'failed to check',
            'failed to select', 'verification failed', 'verification rejected',
            'already verified', 'invalid verification', 'verification expired'
        ];
        const terminalStatuses = ['completed', 'failed', 'error', 'success', 'cancelled'];

        if (message) {
            const lower = message.toLowerCase();
            if (terminalMessages.some(t => lower.includes(t))) return true;
        }
        if (status && terminalStatuses.includes(status)) return true;
        return false;
    }

    /**
     * Check if the result is a success
     */
    function isSuccessResult(message, status, successFlag) {
        if (successFlag === true) return true;
        if (status === 'success') return true;
        if (message) {
            const lower = message.toLowerCase();
            if (lower.includes('completed successfully') || lower.includes('already verified')) return true;
        }
        return false;
    }

    // i18n helper
    function t(key, fallback) {
        if (window.i18n && typeof window.i18n.t === 'function') {
            return window.i18n.t(key);
        }
        return fallback || key;
    }

    // =============================================
    // Initialize
    // =============================================
    async function init() {
        const container = document.getElementById(CONFIG.containerId);
        if (!container) return;

        await loadConfig();

        let isLoggedIn = false;
        try {
            const cachedProfile = localStorage.getItem('cached_user_profile');
            if (cachedProfile) {
                const user = JSON.parse(cachedProfile);
                if (user && (user.id || user.user_id)) {
                    if (!user.id && user.user_id) user.id = user.user_id;
                    currentUser = user;
                    isLoggedIn = true;
                }
            }
        } catch (e) { /* ignored */ }

        if (!window.i18n || typeof window.i18n.t !== 'function') {
            await new Promise(resolve => {
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
        window.addEventListener('languageChanged', () => {
            render(container, !!currentUser);
        });
    }

    // =============================================
    // Load Config
    // =============================================
    async function loadConfig() {
        try {
            if (!window.supabaseClient) return;
            const { data, error } = await window.supabaseClient
                .from('system_config')
                .select('config_value')
                .eq('config_key', 'verify_settings')
                .single();
            if (!error && data?.config_value) {
                CONFIG.pricePerVerify = data.config_value.price_per_verify || 10;
            }
        } catch (e) { /* ignored */ }
    }

    // =============================================
    // Render
    // =============================================
    function render(container, isLoggedIn = false) {
        const loginDisplay = isLoggedIn ? 'none' : 'block';
        const formDisplay = isLoggedIn ? 'block' : 'none';
        const balanceDisplay = isLoggedIn ? 'flex' : 'none';

        container.innerHTML = `
            <div class="verify-widget">
                <div class="verify-widget-header">
                    <div class="verify-widget-icon">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.1));">
                            <path fill-rule="evenodd" clip-rule="evenodd" d="M15.5 4C12.4624 4 10 6.46243 10 9.5C10 10.751 10.4173 11.9039 11.129 12.835L4.56066 19.4033C4.24647 19.7175 4.24647 20.227 4.56066 20.5412L5.45879 21.4393C5.77298 21.7535 6.28248 21.7535 6.59667 21.4393L8.5 19.536L10.4033 21.4393C10.7175 21.7535 11.227 21.7535 11.5412 21.4393L12.4393 20.5412C12.7535 20.227 12.7535 19.7175 12.4393 19.4033L11.536 17.5L12.835 16.129C13.7547 16.708 14.739 17 15.5 17C18.5376 17 21 14.5376 21 11.5C21 8.46243 18.5376 4 15.5 4ZM17 9C17.5523 9 18 8.55228 18 8C18 7.44772 17.5523 7 17 7C16.4477 7 16 7.44772 16 8C16 8.55228 16.4477 9 17 9Z" fill="white"/>
                        </svg>
                    </div>
                    <div class="verify-widget-title">
                        <h3>${t('verify.title', 'Gemini 验证服务')}</h3>
                        <p>${t('verify.subtitle', '支持批量验证')}</p>
                    </div>
                    <div class="verify-balance" id="verifyBalance" style="display: ${balanceDisplay};">
                        <i class="fas fa-coins"></i>
                        <span id="verifyBalanceValue">0</span>
                    </div>
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
                        <div class="verify-input-area">
                            <textarea 
                                class="verify-textarea" 
                                id="verifyIdInput"
                                placeholder="${t('verify.placeholder', '输入 SheerID 验证链接，每行一个')}"
                                rows="5"
                            ></textarea>
                            <div class="verify-batch-info">
                                <div class="verify-batch-count">
                                    <i class="fas fa-list-ol"></i>
                                    ${t('verify.pendingCount', '待验证')}: <span class="count" id="verifyLinkCount">0</span> ${t('verify.items', '个')}
                                </div>
                                <div class="verify-price-info">
                                    <i class="fas fa-coins"></i>
                                    ${t('verify.totalCost', '共需')} <span class="price" id="verifyTotalCost">0</span> ${t('verify.points', '积分')}
                                    <span class="per-price">（${CONFIG.pricePerVerify}${t('verify.perPrice', '积分/次')}）</span>
                                </div>
                            </div>
                            <button class="verify-submit-btn" id="verifySubmitBtn" onclick="VerifyWidget.submit()">
                                <i class="fas fa-check-circle"></i>
                                ${t('verify.startVerify', '开始验证')}
                            </button>
                            <button class="verify-cancel-btn" id="verifyCancelBtn" onclick="VerifyWidget.cancel()">
                                <i class="fas fa-times-circle"></i>
                                ${t('verify.cancelVerify', '取消验证')}
                            </button>
                        </div>
                    </div>
                </div>

                <div class="verify-batch-results" id="verifyBatchResults">
                    <div class="verify-batch-results-header">
                        <div class="verify-batch-results-title">
                            <i class="fas fa-list-check"></i>
                            ${t('verify.results', '验证结果')}
                        </div>
                        <div class="verify-batch-progress" id="verifyBatchProgress">
                            ${t('verify.progress', '进度')}: <span class="current">0</span>/<span class="total">0</span>
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
        `;

        setupInputListener();
        updatePriceDisplay();
    }

    // =============================================
    // Auth
    // =============================================
    function setupAuthListener() {
        if (!window.supabaseClient) return;
        window.supabaseClient.auth.getUser().then(({ data: { user } }) => updateAuthState(user));
        window.supabaseClient.auth.onAuthStateChange((_, session) => updateAuthState(session?.user || null));
    }

    async function updateAuthState(user) {
        currentUser = user;
        const loginPrompt = document.getElementById('verifyLoginPrompt');
        const form = document.getElementById('verifyForm');
        const balanceEl = document.getElementById('verifyBalance');

        if (user) {
            if (loginPrompt) loginPrompt.style.display = 'none';
            if (form) form.style.display = 'block';
            if (balanceEl) balanceEl.style.display = 'flex';
            try {
                localStorage.setItem('cached_user_profile', JSON.stringify({
                    id: user.id, email: user.email, user_metadata: user.user_metadata
                }));
            } catch (e) { /* ignored */ }
            await loadUserBalance();
        } else {
            if (loginPrompt) loginPrompt.style.display = 'block';
            if (form) form.style.display = 'none';
            if (balanceEl) balanceEl.style.display = 'none';
            localStorage.removeItem('cached_user_profile');
        }
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
                    .from('points_balance').select('total_balance')
                    .eq('user_id', currentUser.id).maybeSingle();
                if (!error && data) balance = data.total_balance || 0;
            }
            userBalance = balance;
            const el = document.getElementById('verifyBalanceValue');
            if (el) el.textContent = userBalance;
        } catch (e) { /* ignored */ }
    }

    // =============================================
    // Input Helpers
    // =============================================
    function setupInputListener() {
        const input = document.getElementById('verifyIdInput');
        if (input) input.addEventListener('input', updateLinkCount);
    }

    function updateLinkCount() {
        const input = document.getElementById('verifyIdInput');
        const countEl = document.getElementById('verifyLinkCount');
        const costEl = document.getElementById('verifyTotalCost');
        if (!input || !countEl) return;
        const links = parseLinks(input.value);
        countEl.textContent = links.length;
        if (costEl) costEl.textContent = links.length * CONFIG.pricePerVerify;
    }

    function parseLinks(text) {
        if (!text.trim()) return [];
        return text.split('\n').map(l => l.trim()).filter(l =>
            l.includes('sheerid.com') || l.includes('verificationId') || (l.length > 20 && !l.includes(' '))
        );
    }

    function extractVerificationId(input) {
        input = input.trim();
        if (input.includes('sheerid.com') || input.includes('services.sheerid')) return input;
        if (!input.includes('/') && !input.includes('?')) return input;
        try {
            if (input.match(/\/verify\/([a-zA-Z0-9]+)/i)) return input;
            const m = input.match(/verificationId[=\/]([a-zA-Z0-9_-]+)/i);
            if (m) return m[1];
            const vm = input.match(/vid_([a-zA-Z0-9]+)/i);
            if (vm) return 'vid_' + vm[1];
            return null;
        } catch (e) { return null; }
    }

    function updatePriceDisplay() {
        document.querySelectorAll('.per-price').forEach(el => {
            el.textContent = `（${CONFIG.pricePerVerify}${t('verify.perPrice', '积分/次')}）`;
        });
        updateLinkCount();
    }

    // =============================================
    // Submit: Per-item POST /verify + Parallel Polling
    // =============================================
    async function submit() {
        if (isLoading) return;

        const input = document.getElementById('verifyIdInput');
        const submitBtn = document.getElementById('verifySubmitBtn');
        const cancelBtn = document.getElementById('verifyCancelBtn');
        const batchPanel = document.getElementById('verifyBatchResults');
        const singleResult = document.getElementById('verifyResult');

        if (!input || !submitBtn) return;

        const inputValue = input.value.trim();
        if (!inputValue) {
            showSingleResult('error', '请输入内容 / Please enter content',
                '请输入 SheerID 验证链接 / Please enter SheerID verification links');
            return;
        }

        const links = parseLinks(inputValue);
        if (links.length === 0) {
            showSingleResult('error', '格式错误 / Invalid format',
                '无法识别有效的验证链接 / No valid verification links found');
            return;
        }

        const totalCost = links.length * CONFIG.pricePerVerify;
        if (userBalance < totalCost) {
            showSingleResult('error', '积分不足 / Insufficient points',
                `需要 ${totalCost} 积分，当前余额: ${userBalance} / Need ${totalCost} pts, balance: ${userBalance}`);
            return;
        }

        // Hide single result, show batch panel
        if (singleResult) singleResult.classList.remove('show');
        if (batchPanel) batchPanel.classList.add('show');

        // Reset state
        batchStats = { success: 0, failed: 0, total: links.length };
        activeTasks.clear();
        clearResultsList();
        updateBatchProgress(0, links.length);
        hideBatchSummary();

        // Validate links
        const validLinks = [];
        for (let i = 0; i < links.length; i++) {
            const vId = extractVerificationId(links[i]);
            if (!vId) {
                addResultItem(i, links[i], 'error', '❌ 无效链接格式 / Invalid link format');
                batchStats.failed++;
            } else {
                validLinks.push({ index: i, link: links[i], verificationId: vId });
                addResultItem(i, links[i], 'processing', '⏳ 排队等待中... / Queuing...');
            }
        }

        if (validLinks.length === 0) {
            showBatchSummary();
            return;
        }

        // Start loading UI
        isLoading = true;
        submitBtn.style.display = 'none';
        if (cancelBtn) cancelBtn.style.display = 'flex';

        // Get user ID
        let userId;
        try {
            const { data } = await window.supabaseClient.auth.getUser();
            userId = data?.user?.id;
            if (!userId) throw new Error('请先登录 / Please login first');
        } catch (e) {
            validLinks.forEach(({ index }) =>
                updateResultItem(index, 'error', '❌ ' + (e.message || '请先登录'))
            );
            batchStats.failed += validLinks.length;
            finishVerification();
            return;
        }

        // Submit each item and start polling
        let completedCount = 0;

        for (const item of validLinks) {
            // Check if cancelled
            if (!isLoading) break;

            try {
                updateResultItem(item.index, 'processing', '🚀 提交中... / Submitting...');

                const res = await fetch(`${CONFIG.nodeServerUrl}/api/verify`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ verificationId: item.verificationId, userId })
                });

                const data = await res.json();

                if (!res.ok || !data.success) {
                    updateResultItem(item.index, 'error',
                        translateStatus(data.message, 'failed'));
                    batchStats.failed++;
                    completedCount++;
                    updateBatchProgress(completedCount, validLinks.length);
                    continue;
                }

                const taskId = data.task_id;
                updateResultItem(item.index, 'processing', '🔄 正在验证... / Verifying...');

                // Store task info and start polling
                activeTasks.set(taskId, {
                    index: item.index,
                    verificationId: item.verificationId,
                    aborted: false
                });

                // Start async polling for this task
                pollTask(taskId, userId, item.index).then(result => {
                    completedCount++;

                    if (result.success) {
                        batchStats.success++;
                        if (result.pointsDeducted) {
                            userBalance -= result.pointsDeducted;
                            const balEl = document.getElementById('verifyBalanceValue');
                            if (balEl) balEl.textContent = userBalance;
                        }
                    } else if (result.cancelled) {
                        // Don't count cancelled as failed
                    } else {
                        batchStats.failed++;
                    }

                    updateBatchProgress(completedCount, validLinks.length);

                    // Check if all done
                    if (completedCount >= validLinks.length) {
                        finishVerification();
                    }
                });

                // Small delay between submissions to avoid overloading
                if (validLinks.indexOf(item) < validLinks.length - 1) {
                    await new Promise(r => setTimeout(r, 500));
                }

            } catch (err) {
                updateResultItem(item.index, 'error',
                    `❌ 提交失败 / Submit failed: ${err.message}`);
                batchStats.failed++;
                completedCount++;
                updateBatchProgress(completedCount, validLinks.length);
            }
        }
    }

    // =============================================
    // Poll Single Task
    // =============================================
    function pollTask(taskId, userId, itemIndex) {
        return new Promise((resolve) => {
            let deducted = false;
            const startTime = Date.now();

            const timer = setInterval(async () => {
                const taskInfo = activeTasks.get(taskId);

                // Check if aborted (cancelled)
                if (!taskInfo || taskInfo.aborted) {
                    clearInterval(timer);
                    resolve({ success: false, cancelled: true });
                    return;
                }

                // Check timeout
                if (Date.now() - startTime > CONFIG.pollTimeout) {
                    clearInterval(timer);
                    activeTasks.delete(taskId);
                    updateResultItem(itemIndex, 'error', '❌ 超时 / Timeout');
                    resolve({ success: false });
                    return;
                }

                try {
                    const url = `${CONFIG.nodeServerUrl}/api/verify/status/${taskId}?userId=${userId}&deducted=${deducted}`;
                    const res = await fetch(url);
                    const data = await res.json();

                    if (!res.ok) {
                        clearInterval(timer);
                        activeTasks.delete(taskId);
                        updateResultItem(itemIndex, 'error',
                            translateStatus(data.message, 'error'));
                        resolve({ success: false });
                        return;
                    }

                    // Update UI with translated status
                    const translated = translateStatus(data.message, data.status);
                    const cssClass = getStatusCss(data.message, data.status);
                    updateResultItem(itemIndex, cssClass, translated);

                    // Check if terminal
                    if (isTerminalStatus(data.message, data.status)) {
                        clearInterval(timer);
                        activeTasks.delete(taskId);

                        const success = isSuccessResult(data.message, data.status, data.success);

                        if (data.pointsDeducted) deducted = true;

                        if (success) {
                            triggerAnimation('success');
                        } else {
                            triggerAnimation('error');
                        }

                        resolve({
                            success,
                            pointsDeducted: data.pointsDeducted || 0
                        });
                        return;
                    }

                    // "Waiting for review" — continue polling (not terminal)

                } catch (err) {
                    // Network error, continue polling
                    console.warn('[VerifyWidget] Poll error (retrying):', err.message);
                }
            }, CONFIG.pollInterval);

            // Store timer for cleanup
            const taskInfo = activeTasks.get(taskId);
            if (taskInfo) taskInfo.timer = timer;
        });
    }

    // =============================================
    // Cancel: Safe cancel with final status check
    // =============================================
    async function cancel() {
        if (!isLoading) return;

        const submitBtn = document.getElementById('verifySubmitBtn');
        const cancelBtn = document.getElementById('verifyCancelBtn');

        // Disable cancel button during cancel process
        if (cancelBtn) {
            cancelBtn.disabled = true;
            cancelBtn.innerHTML = '<div class="spinner"></div> 取消中... / Cancelling...';
        }

        let userId;
        try {
            const { data } = await window.supabaseClient.auth.getUser();
            userId = data?.user?.id;
        } catch (e) { /* ignored */ }

        // Cancel each active task with safe final check
        const cancelPromises = [];

        for (const [taskId, taskInfo] of activeTasks.entries()) {
            // Stop polling first
            if (taskInfo.timer) clearInterval(taskInfo.timer);
            taskInfo.aborted = true;

            // Call cancel endpoint with final status check
            const promise = fetch(`${CONFIG.nodeServerUrl}/api/cancel`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    verificationId: taskInfo.verificationId,
                    taskId: taskId,
                    userId: userId
                })
            }).then(r => r.json()).then(data => {
                if (data.alreadyCompleted && data.verificationSuccess) {
                    // Task already succeeded — show success, deduct happened on server
                    updateResultItem(taskInfo.index, 'success',
                        '✅ 验证成功（取消前已完成）/ Verified (completed before cancel)');
                    batchStats.success++;
                    if (data.pointsDeducted) {
                        userBalance -= data.pointsDeducted;
                        const balEl = document.getElementById('verifyBalanceValue');
                        if (balEl) balEl.textContent = userBalance;
                    }
                } else {
                    // Actually cancelled
                    updateResultItem(taskInfo.index, 'cancelled',
                        '⚪ 已取消 / Cancelled');
                }
            }).catch(() => {
                updateResultItem(taskInfo.index, 'cancelled',
                    '⚪ 已取消 / Cancelled');
            });

            cancelPromises.push(promise);
        }

        // Wait for all cancel checks to complete
        await Promise.allSettled(cancelPromises);

        activeTasks.clear();
        finishVerification();
    }

    // =============================================
    // Finish Verification
    // =============================================
    function finishVerification() {
        isLoading = false;
        const submitBtn = document.getElementById('verifySubmitBtn');
        const cancelBtn = document.getElementById('verifyCancelBtn');

        if (submitBtn) {
            submitBtn.style.display = 'flex';
            submitBtn.disabled = false;
            submitBtn.innerHTML = `<i class="fas fa-check-circle"></i> ${t('verify.startVerify', '开始验证')}`;
        }
        if (cancelBtn) {
            cancelBtn.style.display = 'none';
            cancelBtn.disabled = false;
            cancelBtn.innerHTML = `<i class="fas fa-times-circle"></i> ${t('verify.cancelVerify', '取消验证')}`;
        }

        showBatchSummary();
        loadUserBalance(); // Refresh balance
    }

    // =============================================
    // UI Helpers
    // =============================================
    function clearResultsList() {
        const list = document.getElementById('verifyResultsList');
        if (list) list.innerHTML = '';
    }

    function addResultItem(index, link, status, message) {
        const list = document.getElementById('verifyResultsList');
        if (!list) return;

        const shortLink = link.length > 55 ? link.substring(0, 55) + '...' : link;
        const icons = {
            success: 'fa-check', error: 'fa-times', cancelled: 'fa-ban',
            processing: 'fa-spinner fa-spin', info: 'fa-info-circle'
        };

        const item = document.createElement('div');
        item.className = `verify-result-item ${status}`;
        item.id = `result-item-${index}`;
        item.innerHTML = `
            <div class="verify-result-item-icon">
                <i class="fas ${icons[status] || 'fa-spinner fa-spin'}"></i>
            </div>
            <div class="verify-result-item-content">
                <div class="verify-result-item-id">#${index + 1}: ${shortLink}</div>
                <div class="verify-result-item-message">${message}</div>
            </div>
        `;
        list.appendChild(item);
    }

    function updateResultItem(index, status, message) {
        const item = document.getElementById(`result-item-${index}`);
        if (!item) return;

        const icons = {
            success: 'fa-check', error: 'fa-times', cancelled: 'fa-ban',
            processing: 'fa-spinner fa-spin', info: 'fa-info-circle'
        };

        item.className = `verify-result-item ${status}`;
        const iconEl = item.querySelector('.verify-result-item-icon i');
        if (iconEl) {
            iconEl.className = '';
            void iconEl.offsetWidth;
            iconEl.className = `fas ${icons[status] || 'fa-spinner fa-spin'}`;
        }
        const msgEl = item.querySelector('.verify-result-item-message');
        if (msgEl) msgEl.textContent = message;
    }

    function updateBatchProgress(current, total) {
        const el = document.getElementById('verifyBatchProgress');
        if (el) el.innerHTML = `${t('verify.progress', '进度')}: <span class="current">${current}</span>/<span class="total">${total}</span>`;
    }

    function showBatchSummary() {
        const el = document.getElementById('verifyBatchSummary');
        if (el) el.style.display = 'flex';
        const s = document.getElementById('successCount');
        const f = document.getElementById('failedCount');
        const tt = document.getElementById('totalCount');
        if (s) s.textContent = batchStats.success;
        if (f) f.textContent = batchStats.failed;
        if (tt) tt.textContent = batchStats.total;
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
    }

    function triggerAnimation(type) {
        const widget = document.querySelector('.verify-widget');
        if (!widget) return;
        widget.classList.remove('success-pulse', 'error-pulse');
        void widget.offsetWidth;
        widget.classList.add(type === 'success' ? 'success-pulse' : 'error-pulse');
        setTimeout(() => widget.classList.remove('success-pulse', 'error-pulse'), 4500);
    }

    // =============================================
    // Public API
    // =============================================
    window.VerifyWidget = {
        init, submit, cancel, reload: loadConfig,
        debugSuccessAnimation: () => triggerAnimation('success'),
        debugErrorAnimation: () => triggerAnimation('error')
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
