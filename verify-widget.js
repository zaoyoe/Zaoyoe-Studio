/**
 * Batch Verifier Widget
 * Modular component for Gemini verification service
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
                        <p>一键验证账户状态</p>
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
                            <input 
                                type="text" 
                                class="verify-input" 
                                id="verifyIdInput"
                                placeholder="输入 Verification ID 或 URL"
                            >
                            <button class="verify-submit-btn" id="verifySubmitBtn" onclick="VerifyWidget.submit()">
                                <i class="fas fa-check-circle"></i>
                                开始验证
                            </button>
                        </div>
                        <div class="verify-price-info">
                            <i class="fas fa-info-circle"></i>
                            每次验证消耗 <span class="price" id="verifyPriceDisplay">${CONFIG.pricePerVerify}</span> 积分
                        </div>
                    </div>
                </div>

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
    // Submit Verification
    // =============================================
    async function submit() {
        if (isLoading) return;

        const input = document.getElementById('verifyIdInput');
        const submitBtn = document.getElementById('verifySubmitBtn');
        const result = document.getElementById('verifyResult');

        if (!input || !submitBtn) return;

        const inputValue = input.value.trim();
        if (!inputValue) {
            showResult('error', '请输入内容', '请输入 Verification ID 或验证链接');
            return;
        }

        // Extract verification ID from URL if needed
        const verificationId = extractVerificationId(inputValue);
        if (!verificationId) {
            showResult('error', '格式错误', '无法识别的 Verification ID 或链接格式');
            return;
        }

        // Check balance
        if (userBalance < CONFIG.pricePerVerify) {
            showResult('error', '积分不足', `验证需要 ${CONFIG.pricePerVerify} 积分，当前余额: ${userBalance}`);
            return;
        }

        // Start loading
        isLoading = true;
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<div class="spinner"></div> 验证中...';

        try {
            // Call verification API
            const response = await callVerifyAPI(verificationId);

            if (response.success) {
                showResult('success', '验证完成', response.message || '账户验证成功');

                // Refresh balance (Edge Function already deducted points)
                await loadUserBalance();
            } else {
                showResult('error', '验证失败', response.message || '验证过程中发生错误');
            }
        } catch (e) {
            console.error('[VerifyWidget] Verification error:', e);
            showResult('error', '请求失败', e.message || '网络错误，请稍后重试');
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
        // If it's a direct ID (no URL)
        if (!input.includes('/') && !input.includes('?')) {
            return input;
        }

        // Try to extract from URL
        try {
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
    // Call Verification API via Node.js Puppeteer Server
    // =============================================
    async function callVerifyAPI(verificationId) {
        const endpoint = `${CONFIG.nodeServerUrl}/api/verify`;

        // Get current user ID
        const { data: userData } = await window.supabaseClient.auth.getUser();
        const userId = userData?.user?.id;

        if (!userId) {
            throw new Error('请先登录');
        }

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                verificationId: verificationId,
                userId: userId
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || 'API 请求失败');
        }

        // Update balance display after successful verification
        if (data.pointsDeducted) {
            userBalance -= data.pointsDeducted;
            const balanceValueEl = document.getElementById('verifyBalanceValue');
            if (balanceValueEl) {
                balanceValueEl.textContent = userBalance;
            }
        }

        return data;
    }

    // (Removed deductPoints - Edge Function handles point deduction)

    // =============================================
    // Show Result
    // =============================================
    function showResult(type, title, message) {
        const result = document.getElementById('verifyResult');
        const resultIcon = result?.querySelector('.verify-result-icon i');
        const resultTitle = document.getElementById('verifyResultTitle');
        const resultMessage = document.getElementById('verifyResultMessage');

        if (!result) return;

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
        const priceEl = document.getElementById('verifyPriceDisplay');
        if (priceEl) {
            priceEl.textContent = CONFIG.pricePerVerify;
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
