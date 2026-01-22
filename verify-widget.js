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
        nodeServerUrl: window.VERIFY_SERVER_URL || 'http://localhost:3001',
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

        // Render widget
        render(container);

        // Setup auth listener
        setupAuthListener();
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
    function render(container) {
        container.innerHTML = `
            <div class="verify-widget">
                <div class="verify-widget-header">
                    <div class="verify-widget-icon">
                        <i class="fas fa-shield-check"></i>
                    </div>
                    <div class="verify-widget-title">
                        <h3>Gemini 验证服务</h3>
                        <p>支持批量验证账户状态</p>
                    </div>
                    <div class="verify-quota" id="verifyQuota" style="display: none;">
                        <i class="fas fa-ticket"></i>
                        剩余: <span id="verifyQuotaValue">--</span>
                    </div>
                    <div class="verify-balance" id="verifyBalance" style="display: none;">
                        <i class="fas fa-coins"></i>
                        <span id="verifyBalanceValue">0</span>
                    </div>
                </div>

                <div id="verifyContent">
                    <!-- Content will be dynamically loaded based on auth state -->
                    <div class="verify-login-prompt" id="verifyLoginPrompt">
                        <p>登录后即可使用验证服务</p>
                        <button class="verify-login-btn" onclick="window.toggleLoginModal && window.toggleLoginModal()">
                            <i class="fas fa-sign-in-alt"></i>
                            登录 / 注册
                        </button>
                    </div>

                    <div id="verifyForm" style="display: none;">
                        <div class="verify-input-area">
                            <textarea 
                                class="verify-textarea" 
                                id="verifyIdInput"
                                placeholder="输入 SheerID 验证链接&#10;每行一个，支持批量验证&#10;&#10;示例:&#10;https://services.sheerid.com/verify/xxx/?verificationId=yyy&#10;https://services.sheerid.com/verify/xxx/?verificationId=zzz"
                                rows="5"
                            ></textarea>
                            <div class="verify-batch-info">
                                <div class="verify-batch-count">
                                    <i class="fas fa-list-ol"></i>
                                    待验证: <span class="count" id="verifyLinkCount">0</span> 个
                                </div>
                                <div class="verify-price-info">
                                    <i class="fas fa-coins"></i>
                                    共需 <span class="price" id="verifyTotalCost">0</span> 积分
                                    <span class="per-price">（${CONFIG.pricePerVerify}积分/次）</span>
                                </div>
                            </div>
                            <button class="verify-submit-btn" id="verifySubmitBtn" onclick="VerifyWidget.submit()">
                                <i class="fas fa-check-circle"></i>
                                开始验证
                            </button>
                        </div>
                    </div>
                </div>

                <!-- Batch Results Panel -->
                <div class="verify-batch-results" id="verifyBatchResults">
                    <div class="verify-batch-results-header">
                        <div class="verify-batch-results-title">
                            <i class="fas fa-list-check"></i>
                            验证结果
                        </div>
                        <div class="verify-batch-progress" id="verifyBatchProgress">
                            进度: <span class="current">0</span>/<span class="total">0</span>
                        </div>
                    </div>
                    <div id="verifyResultsList"></div>
                    <div class="verify-batch-summary" id="verifyBatchSummary" style="display: none;">
                        <div class="verify-batch-stat success">
                            <i class="fas fa-check-circle"></i>
                            成功: <span id="successCount">0</span>
                        </div>
                        <div class="verify-batch-stat error">
                            <i class="fas fa-times-circle"></i>
                            失败: <span id="failedCount">0</span>
                        </div>
                        <div class="verify-batch-stat total">
                            <i class="fas fa-list"></i>
                            总计: <span id="totalCount">0</span>
                        </div>
                    </div>
                </div>

                <!-- Single result (hidden in batch mode) -->
                <div class="verify-result" id="verifyResult">
                    <div class="verify-result-header">
                        <div class="verify-result-icon">
                            <i class="fas fa-check"></i>
                        </div>
                        <div class="verify-result-title" id="verifyResultTitle">验证成功</div>
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

            // Load user balance
            await loadUserBalance();
        } else {
            // User is logged out
            if (loginPrompt) loginPrompt.style.display = 'block';
            if (form) form.style.display = 'none';
            if (balanceEl) balanceEl.style.display = 'none';
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
        const singleResult = document.getElementById('verifyResult');
        const batchResultsPanel = document.getElementById('verifyBatchResults');

        if (!input || !submitBtn) return;

        const inputValue = input.value.trim();
        if (!inputValue) {
            showSingleResult('error', '请输入内容', '请输入 SheerID 验证链接');
            return;
        }

        // Parse all links
        const links = parseLinks(inputValue);
        if (links.length === 0) {
            showSingleResult('error', '格式错误', '无法识别有效的验证链接');
            return;
        }

        // Calculate total cost
        const totalCost = links.length * CONFIG.pricePerVerify;
        if (userBalance < totalCost) {
            showSingleResult('error', '积分不足',
                `验证 ${links.length} 个链接需要 ${totalCost} 积分，当前余额: ${userBalance}`);
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
                addResultItem(i, link, 'error', '无效的链接格式');
                batchStats.failed++;
                invalidIndices.push(i);
            } else {
                validLinks.push({ index: i, link, verificationId });
                addResultItem(i, link, 'processing', '等待验证...');
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
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<div class="spinner"></div> 批量验证中...';

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
                updateResultItem(index, 'error', e.message || '验证失败');
            });
            batchStats.failed += validLinks.length;
            showBatchSummary();
        } finally {
            isLoading = false;
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fas fa-check-circle"></i> 开始验证';
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
            throw new Error('请先登录');
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
                    reject(new Error('解析响应失败'));
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
                    reject(new Error(data.message || '验证失败'));
                } catch (e) {
                    // Generic error
                    console.error('[VerifyWidget] SSE error:', event);
                    isCompleted = true;
                    eventSource.close();
                    reject(new Error('连接中断，请重试'));
                }
            });

            // Timeout fallback (6 minutes)
            setTimeout(() => {
                if (!isCompleted) {
                    isCompleted = true;
                    eventSource.close();
                    reject(new Error('验证超时，请稍后重试'));
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
                    console.log('[VerifyWidget] Batch Result RAW:', JSON.stringify(data));
                    console.log('[VerifyWidget] data.stats:', data.stats);
                    console.log('[VerifyWidget] data.stats type:', typeof data.stats);
                    eventSource.close();

                    // Update individual items based on batch stats
                    const stats = data.stats || { success: 0, failed: 0, total: batchSize };
                    console.log('[VerifyWidget] Final stats object:', JSON.stringify(stats));
                    console.log('[VerifyWidget] Parsed stats:', stats, 'batchSize:', batchSize);

                    // Since we don't have per-item results from 1key, 
                    // we need to mark items based on overall stats
                    if (stats.success === batchSize) {
                        // All succeeded
                        console.log('[VerifyWidget] All succeeded, updating items to success');
                        validLinks.forEach(({ index }) => {
                            console.log('[VerifyWidget] Updating item', index, 'to success');
                            updateResultItem(index, 'success', '验证成功！');
                        });
                    } else if (stats.success === 0) {
                        // All failed
                        console.log('[VerifyWidget] All failed, updating items to error');
                        validLinks.forEach(({ index }) => {
                            updateResultItem(index, 'error', data.message || '验证失败');
                        });
                    } else {
                        // Mixed results - mark first N as success, rest as failed
                        console.log('[VerifyWidget] Mixed results:', stats.success, 'success,', stats.failed, 'failed');
                        validLinks.forEach(({ index }, i) => {
                            if (i < stats.success) {
                                updateResultItem(index, 'success', '验证成功！');
                            } else {
                                updateResultItem(index, 'error', '验证失败');
                            }
                        });
                    }

                    updateBatchProgress(batchSize, batchSize);
                    resolve(data);
                } catch (e) {
                    console.warn('[VerifyWidget] Failed to parse batch result:', e);
                    eventSource.close();
                    reject(new Error('解析响应失败'));
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
                    reject(new Error(data.message || '验证失败'));
                } catch (e) {
                    // Generic error (connection lost, server error, etc.)
                    console.error('[VerifyWidget] SSE connection error:', event);
                    isCompleted = true;
                    eventSource.close();
                    reject(new Error('连接中断，请重试'));
                }
            });

            // Timeout fallback (8 minutes for batch operations)
            setTimeout(() => {
                if (!isCompleted) {
                    isCompleted = true;
                    eventSource.close();
                    reject(new Error('批量验证超时，请稍后重试'));
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
        console.log('[VerifyWidget] updateResultItem:', { index, status, message, itemFound: !!item });
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

        console.log('[VerifyWidget] Setting className:', `verify-result-item ${status}`);
        item.className = `verify-result-item ${status}`;
        // Force reflow to ensure class update takes effect
        item.offsetHeight;

        const iconEl = item.querySelector('.verify-result-item-icon i');
        if (iconEl) {
            const newIconClass = `fas ${icons[status] || icons.pending}`;
            console.log('[VerifyWidget] Setting icon:', newIconClass, 'on element:', iconEl);
            // Use requestAnimationFrame to ensure DOM update happens
            requestAnimationFrame(() => {
                iconEl.className = newIconClass;
                console.log('[VerifyWidget] Icon className after update:', iconEl.className);
            });
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
            progressEl.innerHTML = `进度: <span class="current">${current}</span>/<span class="total">${total}</span>`;
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
            el.textContent = `（${CONFIG.pricePerVerify}积分/次）`;
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
            showSingleResult('error', '服务暂不可用', 'API验证次数已用完，请联系管理员补货');
        } else if (remaining <= 5) {
            quotaEl.classList.add('warning');
        }
    }

    // =============================================
    // Public API
    // =============================================
    window.VerifyWidget = {
        init,
        submit,
        reload: loadConfig
    };

    // Auto-initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
