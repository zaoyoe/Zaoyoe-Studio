/**
 * Batch Verifier Widget
 * Modular component for Gemini verification service
 * Supports batch mode for multiple SheerID links
 */

(function () {
    'use strict';

    // =============================================
    // Configuration
    // =============================================
    const CONFIG = {
        // Will be loaded from system_config
        pricePerVerify: 3,
        // Node.js Puppeteer server endpoint
        nodeServerUrl: window.VERIFY_SERVER_URL || 'https://zaoyoe-verify-server-production.up.railway.app',
        // Container element ID
        containerId: 'verify-widget-container'
    };

    // Auto-detect Supabase Edge Function URL
    function getEdgeFunctionUrl() {
        // Try to get from Supabase URL (e.g., https://xxx.supabase.co -> https://xxx.supabase.co/functions/v1/verify)
        const supabaseUrl = window.SUPABASE_URL ||
            (typeof supabase !== 'undefined' && supabase.supabaseUrl) ||
            'https://mmkugdibsaeoevliebzk.supabase.co';
        return `${supabaseUrl}/functions/v1/verify`;
    }

    // State
    let currentUser = null;
    let userBalance = 0;
    let isLoading = false;
    let batchResults = []; // Store results for batch mode
    let batchStats = { success: 0, failed: 0, total: 0 };
    let activeEventSource = null; // Track active SSE connection for cancellation

    // i18n helper with fallback
    function t(key, fallback) {
        if (window.i18n && typeof window.i18n.t === 'function') {
            return window.i18n.t(key);
        }
        return fallback || key;
    }

    // =============================================
    // Initialize Widget
    // =============================================
    async function init() {
        const container = document.getElementById(CONFIG.containerId);
        if (!container) {
            console.warn('[VerifyWidget] Container not found:', CONFIG.containerId);
            return;
        }

        // Load config from system_config
        await loadConfig();

        // OPTIMIZATION: Check for cached user profile BEFORE rendering to prevent flash
        let isLoggedIn = false;
        try {
            const cachedProfile = localStorage.getItem('cached_user_profile');
            if (cachedProfile) {
                const user = JSON.parse(cachedProfile);
                if (user && (user.id || user.user_id)) {
                    console.log('[VerifyWidget] Found cached profile, rendering as logged in');
                    // Correct ID mapping if needed for consistency
                    if (!user.id && user.user_id) user.id = user.user_id;
                    currentUser = user;
                    isLoggedIn = true;
                }
            }
        } catch (e) {
            console.warn('[VerifyWidget] Error reading cached profile:', e);
        }

        // Wait for i18n to be ready (with timeout fallback)
        if (!window.i18n || typeof window.i18n.t !== 'function') {
            console.log('[VerifyWidget] Waiting for i18n to load...');
            await new Promise(resolve => {
                let checkCount = 0;
                const checkI18n = setInterval(() => {
                    checkCount++;
                    if (window.i18n && typeof window.i18n.t === 'function') {
                        clearInterval(checkI18n);
                        resolve();
                    } else if (checkCount > 20) { // 2 second timeout
                        clearInterval(checkI18n);
                        console.warn('[VerifyWidget] i18n not loaded, using fallback');
                        resolve();
                    }
                }, 100);
            });
        }

        // Render widget with initial auth state
        render(container, isLoggedIn);

        // Setup auth listener (will verify token and update final state)
        setupAuthListener();

        // Listen for language changes to re-render with new translations
        setupLanguageChangeListener(container);
    }

    // =============================================
    // Language Change Listener
    // =============================================
    function setupLanguageChangeListener(container) {
        // Listen for language change event from i18n system (dispatched on window)
        window.addEventListener('languageChanged', () => {
            console.log('[VerifyWidget] Language changed, re-rendering...');
            const isLoggedIn = !!currentUser;
            render(container, isLoggedIn);
            // Re-attach event listeners after re-render
            setupTextareaListeners();
        });
    }

    // =============================================
    // Load Configuration
    // =============================================
    async function loadConfig() {
        try {
            if (!window.supabaseClient) return;

            const { data, error } = await window.supabaseClient
                .from('system_config')
                .select('config_value')
                .eq('config_key', 'verify')
                .single();

            if (!error && data?.config_value) {
                CONFIG.pricePerVerify = data.config_value.price_per_verify || 3;
                CONFIG.batchApiKey = data.config_value.batch_api_key || null;
                CONFIG.apiEndpoint = data.config_value.api_endpoint || null;
            }

            console.log('[VerifyWidget] Config loaded:', CONFIG);
        } catch (e) {
            console.warn('[VerifyWidget] Failed to load config:', e);
        }
    }

    // =============================================
    // Render Widget
    // =============================================
    function render(container, isLoggedIn = false) {
        // Pre-calculate display styles based on initial auth state
        const loginPromptDisplay = isLoggedIn ? 'none' : 'block';
        const formDisplay = isLoggedIn ? 'block' : 'none';
        const balanceDisplay = isLoggedIn ? 'flex' : 'none';

        container.innerHTML = `
            <div class="verify-widget">
                <div class="verify-widget-header">
                    <div class="verify-widget-icon">
                        <!-- Custom Key Icon Design -->
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.1));">
                            <path fill-rule="evenodd" clip-rule="evenodd" d="M15.5 4C12.4624 4 10 6.46243 10 9.5C10 10.751 10.4173 11.9039 11.129 12.835L4.56066 19.4033C4.24647 19.7175 4.24647 20.227 4.56066 20.5412L5.45879 21.4393C5.77298 21.7535 6.28248 21.7535 6.59667 21.4393L8.5 19.536L10.4033 21.4393C10.7175 21.7535 11.227 21.7535 11.5412 21.4393L12.4393 20.5412C12.7535 20.227 12.7535 19.7175 12.4393 19.4033L11.536 17.5L12.835 16.129C13.7547 16.708 14.739 17 15.5 17C18.5376 17 21 14.5376 21 11.5C21 8.46243 18.5376 4 15.5 4ZM17 9C17.5523 9 18 8.55228 18 8C18 7.44772 17.5523 7 17 7C16.4477 7 16 7.44772 16 8C16 8.55228 16.4477 9 17 9Z" fill="white"/>
                        </svg>
                    </div>
                    <div class="verify-widget-title">
                        <h3>${t('verify.title', 'Gemini 验证服务')}</h3>
                        <p>${t('verify.subtitle', '支持批量验证')}</p>
                    </div>
                    <div class="verify-quota" id="verifyQuota" style="display: none;">
                        <i class="fas fa-ticket"></i>
                        ${t('verify.remaining', '剩余')}: <span id="verifyQuotaValue">--</span>
                    </div>
                    <div class="verify-balance" id="verifyBalance" style="display: ${balanceDisplay};">
                        <i class="fas fa-coins"></i>
                        <span id="verifyBalanceValue">0</span>
                    </div>
                </div>

                <div id="verifyContent">
                    <!-- Content will be dynamically loaded based on auth state -->
                    <div class="verify-login-prompt" id="verifyLoginPrompt" style="display: ${loginPromptDisplay};">
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

                <!-- Batch Results Panel -->
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

                <!-- Single result (hidden in batch mode) -->
                <div class="verify-result" id="verifyResult">
                    <div class="verify-result-header">
                        <div class="verify-result-icon">
                            <i class="fas fa-check"></i>
                        </div>
                        <div class="verify-result-title" id="verifyResultTitle">${t('verify.verifySuccess', '验证成功')}</div>
                    </div>
                    <div class="verify-result-message" id="verifyResultMessage"></div>
                </div>
            </div>
        `;

        updatePriceDisplay();
        setupInputListener();
    }

    // =============================================
    // Setup Input Listener for Link Count
    // =============================================
    function setupInputListener() {
        const input = document.getElementById('verifyIdInput');
        if (input) {
            input.addEventListener('input', updateLinkCount);
        }
    }

    function updateLinkCount() {
        const input = document.getElementById('verifyIdInput');
        const countEl = document.getElementById('verifyLinkCount');
        const totalCostEl = document.getElementById('verifyTotalCost');
        if (!input || !countEl) return;

        const links = parseLinks(input.value);
        const count = links.length;
        const totalCost = count * CONFIG.pricePerVerify;

        countEl.textContent = count;
        if (totalCostEl) {
            totalCostEl.textContent = totalCost;
        }
    }

    // =============================================
    // Parse Links from Input
    // =============================================
    function parseLinks(text) {
        if (!text.trim()) return [];

        // Split by newlines and filter valid links
        return text
            .split('\n')
            .map(line => line.trim())
            .filter(line => {
                // Must contain sheerid or verification-related patterns
                return line.includes('sheerid.com') ||
                    line.includes('verificationId') ||
                    (line.length > 20 && !line.includes(' '));
            });
    }

    // =============================================
    // Auth Listener
    // =============================================
    function setupAuthListener() {
        if (!window.supabaseClient) return;

        // Check initial auth state
        window.supabaseClient.auth.getUser().then(({ data: { user } }) => {
            updateAuthState(user);
        });

        // Listen for auth changes
        window.supabaseClient.auth.onAuthStateChange((event, session) => {
            updateAuthState(session?.user || null);
        });
    }

    async function updateAuthState(user) {
        currentUser = user;

        const loginPrompt = document.getElementById('verifyLoginPrompt');
        const form = document.getElementById('verifyForm');
        const balanceEl = document.getElementById('verifyBalance');

        if (user) {
            // User is logged in
            if (loginPrompt) loginPrompt.style.display = 'none';
            if (form) form.style.display = 'block';
            if (balanceEl) balanceEl.style.display = 'flex';

            // Sync cache (Robustness fix)
            try {
                // Ensure we have a profile-like object to cache (user object from Supabase is enough for ID check)
                const cacheData = {
                    id: user.id,
                    email: user.email,
                    // If we have metadata, use it
                    user_metadata: user.user_metadata
                };
                localStorage.setItem('cached_user_profile', JSON.stringify(cacheData));
            } catch (e) {
                console.warn('[VerifyWidget] Failed to update cache:', e);
            }

            // Load user balance
            await loadUserBalance();
        } else {
            // User is logged out
            if (loginPrompt) loginPrompt.style.display = 'block';
            if (form) form.style.display = 'none';
            if (balanceEl) balanceEl.style.display = 'none';

            // Clear cache
            localStorage.removeItem('cached_user_profile');
        }
    }

    // =============================================
    // Load User Balance
    // =============================================
    async function loadUserBalance() {
        if (!currentUser || !window.supabaseClient) return;

        try {
            let balance = 0;

            // Use PointsService if available (more reliable)
            if (window.PointsService && typeof window.PointsService.getBalance === 'function') {
                const result = await window.PointsService.getBalance();
                balance = result.total_balance || 0;
                console.log('[VerifyWidget] Got balance from PointsService:', balance);
            } else {
                // Fallback: direct query to points_balance
                const { data, error } = await window.supabaseClient
                    .from('points_balance')
                    .select('total_balance')
                    .eq('user_id', currentUser.id)
                    .maybeSingle();

                if (!error && data) {
                    balance = data.total_balance || 0;
                }
                console.log('[VerifyWidget] Got balance from direct query:', balance);
            }

            userBalance = balance;
            const balanceValueEl = document.getElementById('verifyBalanceValue');
            if (balanceValueEl) {
                balanceValueEl.textContent = userBalance;
            }
        } catch (e) {
            console.warn('[VerifyWidget] Failed to load balance:', e);
        }
    }

    // =============================================
    // Submit Verification (Batch Mode)
    // =============================================
    async function submit() {
        if (isLoading) return;

        const input = document.getElementById('verifyIdInput');
        const submitBtn = document.getElementById('verifySubmitBtn');
        const cancelBtn = document.getElementById('verifyCancelBtn');
        const singleResult = document.getElementById('verifyResult');
        const batchResultsPanel = document.getElementById('verifyBatchResults');

        if (!input || !submitBtn) return;

        const inputValue = input.value.trim();
        if (!inputValue) {
            showSingleResult('error', t('verify.enterContent', '请输入内容'), t('verify.enterSheerIdLink', '请输入 SheerID 验证链接'));
            return;
        }

        // Parse all links
        const links = parseLinks(inputValue);
        if (links.length === 0) {
            showSingleResult('error', t('verify.formatError', '格式错误'), t('verify.invalidLink', '无法识别有效的验证链接'));
            return;
        }

        // Calculate total cost
        const totalCost = links.length * CONFIG.pricePerVerify;
        if (userBalance < totalCost) {
            const msg = t('verify.needPoints', '验证 {count} 个链接需要 {cost} 积分，当前余额: {balance}')
                .replace('{count}', links.length)
                .replace('{cost}', totalCost)
                .replace('{balance}', userBalance);
            showSingleResult('error', t('verify.insufficientPoints', '积分不足'), msg);
            return;
        }

        // Hide single result, show batch results panel
        if (singleResult) singleResult.classList.remove('show');
        if (batchResultsPanel) batchResultsPanel.classList.add('show');

        // Reset batch state
        batchResults = [];
        batchStats = { success: 0, failed: 0, total: links.length };
        clearResultsList();
        updateBatchProgress(0, links.length);
        hideBatchSummary();

        // Extract and validate all verification IDs first
        const validLinks = [];
        const invalidIndices = [];

        console.log('[VerifyWidget] === EXTRACTION DEBUG ===');
        for (let i = 0; i < links.length; i++) {
            const link = links[i];
            console.log(`[VerifyWidget] Link[${i}]: "${link.substring(0, 80)}${link.length > 80 ? '...' : ''}"`);
            const verificationId = extractVerificationId(link);
            console.log(`[VerifyWidget] Extracted ID[${i}]: "${verificationId ? verificationId.substring(0, 80) : 'NULL'}${verificationId && verificationId.length > 80 ? '...' : ''}"`);

            if (!verificationId) {
                addResultItem(i, link, 'error', t('verify.invalidFormat', '无效的链接格式'));
                batchStats.failed++;
                invalidIndices.push(i);
            } else {
                validLinks.push({ index: i, link, verificationId });
                addResultItem(i, link, 'processing', t('verify.waiting', '等待验证...'));
            }
        }
        console.log('[VerifyWidget] === END EXTRACTION DEBUG ===');

        // If all links are invalid, show summary and return
        if (validLinks.length === 0) {
            showBatchSummary();
            return;
        }

        // Start loading
        isLoading = true;
        submitBtn.style.display = 'none';

        // Show cancel button
        if (cancelBtn) {
            cancelBtn.style.display = 'flex';
        }

        submitBtn.disabled = true;
        submitBtn.innerHTML = `<div class="spinner"></div> ${t('verify.verifying', '批量验证中...')}`;

        try {
            // Send all valid verification IDs in a single batch request
            const verificationIds = validLinks.map(v => v.verificationId);
            console.log('[VerifyWidget] Starting batch with IDs:');
            verificationIds.forEach((id, i) => {
                console.log(`[VerifyWidget] verificationIds[${i}]: "${id.substring(0, 80)}${id.length > 80 ? '...' : ''}"`);
            });

            // Call batch verification API with all IDs
            const result = await callBatchVerifyAPI(verificationIds, validLinks);
            console.log('[VerifyWidget] callBatchVerifyAPI returned:', JSON.stringify(result));

            // Update batch stats from server response
            if (result && result.stats) {
                console.log('[VerifyWidget] Updating batchStats with:', result.stats);
                batchStats.success = result.stats.success || 0;
                batchStats.failed = (result.stats.failed || 0) + invalidIndices.length;
                console.log('[VerifyWidget] batchStats after update:', batchStats);
            } else {
                console.warn('[VerifyWidget] No stats in result!');
            }

            // Update balance
            if (result && result.pointsDeducted) {
                userBalance -= result.pointsDeducted;
            }

            // Show summary
            console.log('[VerifyWidget] Calling showBatchSummary with batchStats:', batchStats);
            showBatchSummary();

            // Refresh balance
            await loadUserBalance();

        } catch (e) {
            console.error('[VerifyWidget] Batch verification error:', e);
            // Mark all processing items as failed
            validLinks.forEach(({ index }) => {
                updateResultItem(index, 'error', e.message || t('verify.failed', '验证失败'));
            });
            batchStats.failed += validLinks.length;
            showBatchSummary();
        } finally {
            isLoading = false;
            submitBtn.style.display = 'flex';
            if (cancelBtn) cancelBtn.style.display = 'none';
            submitBtn.disabled = false;
            submitBtn.innerHTML = `<i class="fas fa-check-circle"></i> ${t('verify.startVerify', '开始验证')}`;
        }
    }

    // =============================================
    // Extract Verification ID
    // =============================================
    function extractVerificationId(input) {
        input = input.trim();

        // If it's a SheerID URL, return the full URL (batch.1key.me needs full URL)
        if (input.includes('sheerid.com') || input.includes('services.sheerid')) {
            return input; // Return full URL for SheerID links
        }

        // If it's a direct ID (no URL)
        if (!input.includes('/') && !input.includes('?')) {
            return input;
        }

        // Try to extract from URL
        try {
            // Pattern: /verify/xxx/ (SheerID format)
            const sheerIdMatch = input.match(/\/verify\/([a-zA-Z0-9]+)/i);
            if (sheerIdMatch) return input; // Return full URL

            // Pattern: ?verificationId=xxx or /verify/xxx/?verificationId=xxx
            const match = input.match(/verificationId[=\/]([a-zA-Z0-9_-]+)/i);
            if (match) return match[1];

            // Pattern: /vid_xxx
            const vidMatch = input.match(/vid_([a-zA-Z0-9]+)/i);
            if (vidMatch) return 'vid_' + vidMatch[1];

            return null;
        } catch (e) {
            return null;
        }
    }


    // =============================================
    // Call Verification API via SSE (Server-Sent Events)
    // =============================================
    async function callVerifyAPI(verificationId, itemIndex) {
        // Get current user ID
        const { data: userData } = await window.supabaseClient.auth.getUser();
        const userId = userData?.user?.id;

        if (!userId) {
            throw new Error(t('verify.pleaseLogin', '请先登录'));
        }

        return new Promise((resolve, reject) => {
            const params = new URLSearchParams({
                verificationId: verificationId,
                userId: userId
            });

            const endpoint = `${CONFIG.nodeServerUrl}/api/verify-stream?${params}`;
            const eventSource = new EventSource(endpoint);
            let isCompleted = false; // Track completion to ignore post-close errors

            // Update status message in UI
            const updateStatus = (message) => {
                updateResultItem(itemIndex, 'processing', message);
            };

            eventSource.addEventListener('status', (event) => {
                if (isCompleted) return;
                try {
                    const data = JSON.parse(event.data);
                    console.log('[VerifyWidget] Status:', data);

                    // Skip debug_content messages - they are for debugging only
                    if (data.status === 'debug_content' || data.status === 'debug') {
                        return;
                    }

                    updateStatus(data.message);
                } catch (e) {
                    console.warn('[VerifyWidget] Failed to parse status:', e);
                }
            });

            eventSource.addEventListener('debug', (event) => {
                if (isCompleted) return;
                try {
                    const data = JSON.parse(event.data);
                    console.log('[VerifyWidget] Debug (page content):', data.content);
                } catch (e) {
                    console.warn('[VerifyWidget] Failed to parse debug:', e);
                }
            });

            // Handle quota updates from 1key
            eventSource.addEventListener('quota', (event) => {
                if (isCompleted) return;
                try {
                    const data = JSON.parse(event.data);
                    console.log('[VerifyWidget] Quota:', data);
                    updateQuotaDisplay(data.remaining);
                } catch (e) {
                    console.warn('[VerifyWidget] Failed to parse quota:', e);
                }
            });

            eventSource.addEventListener('result', (event) => {
                isCompleted = true;
                try {
                    const data = JSON.parse(event.data);
                    console.log('[VerifyWidget] Result:', data);
                    eventSource.close();
                    resolve(data);
                } catch (e) {
                    console.warn('[VerifyWidget] Failed to parse result:', e);
                    eventSource.close();
                    reject(new Error(t('verify.parseFailed', '解析响应失败')));
                }
            });

            eventSource.addEventListener('error', (event) => {
                // Ignore error after completion (SSE fires error on normal close)
                if (isCompleted) {
                    console.log('[VerifyWidget] Ignoring error after completion');
                    eventSource.close();
                    return;
                }

                try {
                    const data = JSON.parse(event.data);
                    console.log('[VerifyWidget] Error:', data);
                    isCompleted = true;
                    eventSource.close();
                    reject(new Error(data.message || t('verify.failed', '验证失败')));
                } catch (e) {
                    // Generic error
                    console.error('[VerifyWidget] SSE error:', event);
                    isCompleted = true;
                    eventSource.close();
                    reject(new Error(t('verify.connectionLost', '连接中断，请重试')));
                }
            });

            // Timeout fallback (6 minutes)
            setTimeout(() => {
                if (!isCompleted) {
                    isCompleted = true;
                    eventSource.close();
                    reject(new Error(t('verify.timeout', '验证超时，请稍后重试')));
                }
            }, 360000);
        });
    }

    // =============================================
    // Call Batch Verification API (all IDs at once)
    // =============================================
    async function callBatchVerifyAPI(verificationIds, validLinks) {
        // Get current user ID
        const { data: userData } = await window.supabaseClient.auth.getUser();
        const userId = userData?.user?.id;

        if (!userId) {
            throw new Error('请先登录');
        }

        return new Promise((resolve, reject) => {
            // Send all IDs with a safe separator (URLs may contain commas or other special chars)
            // Use triple pipe as separator since it's not valid in URLs
            const params = new URLSearchParams({
                verificationId: verificationIds.join('|||'),
                userId: userId
            });
            console.log('[VerifyWidget] Sending batch IDs:', verificationIds);

            const endpoint = `${CONFIG.nodeServerUrl}/api/verify-stream?${params}`;
            const eventSource = new EventSource(endpoint);
            activeEventSource = eventSource; // Store active connection

            const batchSize = validLinks.length;
            let isCompleted = false; // Track if we've received a result

            // Update all items with a single status
            const updateAllItems = (status, message) => {
                validLinks.forEach(({ index }) => {
                    updateResultItem(index, status, message);
                });
            };

            eventSource.addEventListener('status', (event) => {
                if (isCompleted) return;
                try {
                    const data = JSON.parse(event.data);
                    console.log('[VerifyWidget] Batch Status:', data);

                    // Skip debug messages
                    if (data.status === 'debug_content' || data.status === 'debug') {
                        return;
                    }

                    // Update progress for all items
                    if (data.status === 'progress') {
                        // Parse progress from metadata
                        updateBatchProgress(data.processed || 0, batchSize);
                    }

                    // Update all processing items with the current status
                    validLinks.forEach(({ index }) => {
                        updateResultItem(index, 'processing', data.message);
                    });
                } catch (e) {
                    console.warn('[VerifyWidget] Failed to parse batch status:', e);
                }
            });

            eventSource.addEventListener('debug', (event) => {
                if (isCompleted) return;
                try {
                    const data = JSON.parse(event.data);
                    console.log('[VerifyWidget] Debug (page content):', data.content);
                } catch (e) {
                    console.warn('[VerifyWidget] Failed to parse debug:', e);
                }
            });

            // Handle quota updates from 1key
            eventSource.addEventListener('quota', (event) => {
                if (isCompleted) return;
                try {
                    const data = JSON.parse(event.data);
                    console.log('[VerifyWidget] Quota:', data);
                    updateQuotaDisplay(data.remaining);
                } catch (e) {
                    console.warn('[VerifyWidget] Failed to parse quota:', e);
                }
            });

            eventSource.addEventListener('result', (event) => {
                isCompleted = true; // Mark as completed BEFORE closing
                try {
                    const data = JSON.parse(event.data);
                    eventSource.close();
                    if (activeEventSource === eventSource) activeEventSource = null;

                    if (data.stats) {
                        // Update global batch stats tracking
                        batchStats.success = data.stats.success || 0;
                        batchStats.failed = data.stats.failed || 0;
                        // Total is sum of known outcomes (or use server total if provided/larger)
                        batchStats.total = Math.max(data.stats.total || 0, batchStats.success + batchStats.failed);

                        console.log('[VerifyWidget] Received stats:', batchStats);

                        // Update UI with final stats
                        showBatchSummary(batchStats);

                        // Update individual item statuses based on stats
                        // Strategy: Mark first N items as success, rest as failed (approximation since API doesn't return per-ID status)
                        const items = document.querySelectorAll('.verify-result-item');
                        let successCount = batchStats.success;

                        items.forEach((item, i) => {
                            const index = parseInt(item.id.replace('result-item-', '')); // Extract original index
                            if (i < successCount) {
                                updateResultItem(index, 'success', t('verify.verifySuccess', '验证成功！'));
                            } else {
                                updateResultItem(index, 'error', data.message || t('verify.failed', '验证失败'));
                            }
                        });
                    } else {
                        // Fallback if stats are not provided, mark all as failed
                        validLinks.forEach(({ index }) => {
                            updateResultItem(index, 'error', data.message || t('verify.failed', '验证失败'));
                        });
                    }

                    if (batchStats.success > 0) {
                        const widget = document.querySelector('.verify-widget');
                        if (widget) {
                            widget.classList.remove('success-pulse'); // Reset
                            widget.classList.remove('error-pulse');
                            void widget.offsetWidth; // Trigger reflow
                            widget.classList.add('success-pulse');
                            setTimeout(() => {
                                widget.classList.remove('success-pulse');
                            }, 4500); // 1.5s * 3 iterations
                        }
                    } else if (batchStats.failed > 0) {
                        // All failed or no success
                        const widget = document.querySelector('.verify-widget');
                        if (widget) {
                            widget.classList.remove('success-pulse');
                            widget.classList.remove('error-pulse'); // Reset
                            void widget.offsetWidth;
                            widget.classList.add('error-pulse');
                            setTimeout(() => {
                                widget.classList.remove('error-pulse');
                            }, 4500);
                        }
                    }

                    updateBatchProgress(batchSize, batchSize);
                    resolve(data);
                } catch (e) {
                    console.warn('[VerifyWidget] Failed to parse batch result:', e);
                    eventSource.close();
                    if (activeEventSource === eventSource) activeEventSource = null;
                    reject(new Error(t('verify.parseFailed', '解析响应失败')));
                }
            });

            eventSource.addEventListener('error', (event) => {
                // Ignore error events if we've already received a result
                // (SSE triggers error when connection closes normally)
                if (isCompleted) {
                    console.log('[VerifyWidget] Ignoring error event after completion');
                    eventSource.close();
                    return;
                }

                try {
                    const data = JSON.parse(event.data);
                    console.log('[VerifyWidget] Batch Error:', data);
                    isCompleted = true;
                    eventSource.close();
                    if (activeEventSource === eventSource) activeEventSource = null;
                    reject(new Error(data.message || t('verify.failed', '验证失败')));
                } catch (e) {
                    // Generic error (connection lost, server error, etc.)
                    console.error('[VerifyWidget] Batch SSE error:', event);
                    isCompleted = true;
                    eventSource.close();
                    if (activeEventSource === eventSource) activeEventSource = null;
                    reject(new Error(t('verify.connectionLost', '连接中断，请重试')));
                }
            });

            // Timeout fallback (8 minutes for batch operations)
            setTimeout(() => {
                if (!isCompleted) {
                    isCompleted = true;
                    eventSource.close();
                    if (activeEventSource === eventSource) activeEventSource = null;
                    reject(new Error(t('verify.timeout', '批量验证超时，请稍后重试')));
                }
            }, 480000);
        });
    }

    // =============================================
    function clearResultsList() {
        const list = document.getElementById('verifyResultsList');
        if (list) list.innerHTML = '';
    }

    function addResultItem(index, link, status, message) {
        const list = document.getElementById('verifyResultsList');
        if (!list) return;

        const shortLink = link.length > 60 ? link.substring(0, 60) + '...' : link;
        const icons = {
            success: 'fa-check',
            error: 'fa-times',
            pending: 'fa-hourglass-half',
            processing: 'fa-spinner fa-spin',
            info: 'fa-info-circle'
        };

        const item = document.createElement('div');
        item.className = `verify-result-item ${status}`;
        item.id = `result-item-${index}`;
        item.innerHTML = `
            <div class="verify-result-item-icon">
                <i class="fas ${icons[status] || icons.pending}"></i>
            </div>
            <div class="verify-result-item-content">
                <div class="verify-result-item-id">#${index + 1}: ${shortLink}</div>
                <div class="verify-result-item-message">${message}</div>
            </div>
        `;

        list.appendChild(item);

        // Auto-scroll to bottom
        const resultsPanel = document.getElementById('verifyBatchResults');
        if (resultsPanel) {
            resultsPanel.scrollTop = resultsPanel.scrollHeight;
        }
    }

    function updateResultItem(index, status, message) {
        const item = document.getElementById(`result-item-${index}`);
        if (!item) {
            console.warn('[VerifyWidget] Item not found:', `result-item-${index}`);
            return;
        }

        const icons = {
            success: 'fa-check',
            error: 'fa-times',
            pending: 'fa-hourglass-half',
            processing: 'fa-spinner fa-spin',
            info: 'fa-info-circle'
        };

        item.className = `verify-result-item ${status}`;
        // Force reflow to ensure class update takes effect
        item.offsetHeight;

        const iconEl = item.querySelector('.verify-result-item-icon i');
        if (iconEl) {
            // Remove all existing icon classes
            iconEl.className = '';
            // Force reflow
            void iconEl.offsetWidth;
            // Add new icon classes
            iconEl.className = `fas ${icons[status] || icons.pending}`;
        } else {
            console.warn('[VerifyWidget] Icon element not found in item:', item.id);
        }

        const messageEl = item.querySelector('.verify-result-item-message');
        if (messageEl) {
            messageEl.textContent = message;
        }
    }

    function updateBatchProgress(current, total) {
        const progressEl = document.getElementById('verifyBatchProgress');
        if (progressEl) {
            progressEl.innerHTML = `${t('verify.progress', '进度')}: <span class="current">${current}</span>/<span class="total">${total}</span>`;
        }
    }

    function showBatchSummary() {
        const summary = document.getElementById('verifyBatchSummary');
        const successCount = document.getElementById('successCount');
        const failedCount = document.getElementById('failedCount');
        const totalCount = document.getElementById('totalCount');

        if (summary) summary.style.display = 'flex';
        if (successCount) successCount.textContent = batchStats.success;
        if (failedCount) failedCount.textContent = batchStats.failed;
        if (totalCount) totalCount.textContent = batchStats.total;
    }

    function hideBatchSummary() {
        const summary = document.getElementById('verifyBatchSummary');
        if (summary) summary.style.display = 'none';
    }

    // =============================================
    // Show Single Result (for errors before batch starts)
    // =============================================
    function showSingleResult(type, title, message) {
        const result = document.getElementById('verifyResult');
        const batchResults = document.getElementById('verifyBatchResults');
        const resultIcon = result?.querySelector('.verify-result-icon i');
        const resultTitle = document.getElementById('verifyResultTitle');
        const resultMessage = document.getElementById('verifyResultMessage');

        if (!result) return;

        // Hide batch results, show single result
        if (batchResults) batchResults.classList.remove('show');

        // Set type
        result.className = 'verify-result show ' + type;

        // Set icon
        if (resultIcon) {
            const icons = {
                success: 'fa-check',
                error: 'fa-times',
                pending: 'fa-hourglass-half'
            };
            resultIcon.className = 'fas ' + (icons[type] || icons.pending);
        }

        // Set content
        if (resultTitle) resultTitle.textContent = title;
        if (resultMessage) resultMessage.textContent = message;
    }

    // =============================================
    // Update Price Display
    // =============================================
    function updatePriceDisplay() {
        // Update the per-price text
        const perPriceElements = document.querySelectorAll('.per-price');
        perPriceElements.forEach(el => {
            el.textContent = `（${CONFIG.pricePerVerify}${t('verify.perPrice', '积分/次')}）`;
        });
        // Update total cost display
        updateLinkCount();
    }

    // =============================================
    // Update Quota Display (1key remaining count)
    // =============================================
    function updateQuotaDisplay(remaining) {
        const quotaEl = document.getElementById('verifyQuota');
        const quotaValueEl = document.getElementById('verifyQuotaValue');

        if (!quotaEl || !quotaValueEl) return;

        // Show the quota display
        quotaEl.style.display = 'flex';
        quotaValueEl.textContent = remaining;

        // Update styling based on remaining count
        quotaEl.classList.remove('warning', 'danger');

        if (remaining === 0) {
            quotaEl.classList.add('danger');
            // Show warning message
            showSingleResult('error', t('verify.serviceUnavailable', '服务暂不可用'), t('verify.quotaExhausted', 'API验证次数已用完，请联系管理员补货'));
        } else if (remaining <= 5) {
            quotaEl.classList.add('warning');
        }
    }

    // =============================================
    // Cancel Verification
    // =============================================
    function cancel() {
        if (!isLoading) return;

        console.log('[VerifyWidget] User cancelled verification');

        // Close SSE connection if active
        if (activeEventSource) {
            console.log('[VerifyWidget] Closing active EventSource');
            activeEventSource.close();
            activeEventSource = null;
        }

        // Reset UI state
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
        }

        // Mark processing items as cancelled
        const processingItems = document.querySelectorAll('.verify-result-item.processing');
        processingItems.forEach((item) => {
            const index = parseInt(item.id.replace('result-item-', ''));
            updateResultItem(index, 'error', t('verify.cancelled', '已取消验证'));
        });

        // Update batch stats
        const remaining = document.querySelectorAll('.verify-result-item.processing').length;
        if (remaining > 0) {
            batchStats.failed += remaining;
        }
        showBatchSummary();

        // Show toast or message
        // showSingleResult('error', '已取消', '验证已手动取消');
    }

    // =============================================
    // Debug: Trigger Success Animation
    // =============================================
    function debugSuccessAnimation() {
        const widget = document.querySelector('.verify-widget');
        if (widget) {
            console.log('[VerifyWidget] Triggering debug success animation');
            widget.classList.remove('success-pulse');
            void widget.offsetWidth;
            widget.classList.add('success-pulse');
            setTimeout(() => {
                widget.classList.remove('success-pulse');
            }, 4500);
        }
    }

    function debugErrorAnimation() {
        const widget = document.querySelector('.verify-widget');
        if (widget) {
            console.log('[VerifyWidget] Triggering debug error animation');
            widget.classList.remove('success-pulse');
            widget.classList.remove('error-pulse');
            void widget.offsetWidth;
            widget.classList.add('error-pulse');
            setTimeout(() => {
                widget.classList.remove('error-pulse');
            }, 4500);
        }
    }

    // =============================================
    // Public API
    // =============================================
    window.VerifyWidget = {
        init,
        submit,
        cancel,
        debugSuccessAnimation, // Converience for testing
        debugErrorAnimation,
        reload: loadConfig
    };

    // Auto-initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
