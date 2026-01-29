/**
 * 💳 Wallet Modal - User Interface for Points System
 * A simple, robust wallet modal implementation.
 */
(function () {
    'use strict';

    const supabase = window.supabaseClient;
    if (!supabase) {
        console.error('[WalletModal] ❌ Supabase client not found!');
        return;
    }

    console.log('[WalletModal] ✅ Initializing...');

    // Inject CSS if not already present
    if (!document.getElementById('wallet-modal-css')) {
        const link = document.createElement('link');
        link.id = 'wallet-modal-css';
        link.rel = 'stylesheet';
        link.href = 'css/wallet.css';
        document.head.appendChild(link);
    }

    const WalletModal = {
        isOpen: false,
        modalEl: null,
        promptCache: {}, // Local simple cache for titles
        /**
         * Open the wallet modal
         */
        async open() {
            if (this.isOpen) return;

            console.log('[WalletModal] Opening...');

            // Close user dropdown menu first (prevent double overlay)
            const dropdown = document.getElementById('userDropdown');
            if (dropdown) dropdown.classList.remove('active');
            const dropdownOverlay = document.getElementById('dropdownOverlay');
            if (dropdownOverlay) dropdownOverlay.classList.remove('active');

            // Use getSession() - INSTANT (cached locally) instead of getUser() (network call)
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) {
                alert('请先登录');
                return;
            }

            this.isOpen = true;
            this.ordersLoaded = false; // Reset loaded flag for new session
            document.body.style.overflow = 'hidden'; // Lock body scroll
            this.render();

            // Load data immediately after render
            await this.loadData();

            // Initialize indicator position
            setTimeout(() => this.updateIndicatorPosition(), 50);
        },

        /**
         * Close the modal
         */
        close() {
            if (this.modalEl) {
                this.modalEl.remove();
                this.modalEl = null;
            }
            document.body.style.overflow = ''; // Unlock body scroll
            this.isOpen = false;
            this.ordersLoaded = false;
            console.log('[WalletModal] Closed');
        },

        /**
         * Render the modal HTML - Split Panel Layout
         */
        render() {
            const overlay = document.createElement('div');
            overlay.id = 'wallet-modal-overlay';
            overlay.className = 'wallet-overlay';
            overlay.innerHTML = `
                <div class="wallet-modal">
                    <button class="wallet-close-btn" onclick="WalletModal.close()">✕</button>
                    
                    <div class="wallet-header">
                        <h2>💰 我的钱包</h2>
                    </div>
                    
                    <div class="wallet-layout">
                        <!-- Left Sidebar Menu -->
                        <div class="wallet-sidebar">
                            <div class="sidebar-indicator"></div>
                            <div class="wallet-menu-item active" data-view="balance" onclick="WalletModal.switchView('balance')">
                                <span class="menu-icon">💳</span>
                                <span class="menu-text">余额</span>
                            </div>
                            <div class="wallet-menu-item" data-view="recharge" onclick="WalletModal.switchView('recharge')">
                                <span class="menu-icon">⚡</span>
                                <span class="menu-text">充值</span>
                            </div>

                            <div class="wallet-menu-item" data-view="history" onclick="WalletModal.switchView('history')">
                                <span class="menu-icon">📜</span>
                                <span class="menu-text">记录</span>
                            </div>
                            
                            <div class="wallet-menu-item" data-view="orders" onclick="WalletModal.switchView('orders')">
                                <span class="menu-icon">📦</span>
                                <span class="menu-text">订单</span>
                            </div>
                        </div>
                        
                        <!-- Right Content Area -->
                        <div class="wallet-content">
                            <!-- Balance View (Default) -->
                            <div class="wallet-view active" id="view-balance">
                                <div class="balance-card compact-premium-card">
                                    <div class="card-left">
                                        <label>当前可用积分</label>
                                        <div class="balance-amount" id="wallet-total">--</div>
                                    </div>
                                    <div class="card-right">
                                        <div class="balance-detail-row">
                                            <span class="detail-label">付费</span>
                                            <strong id="wallet-paid" class="detail-val">--</strong>
                                        </div>
                                        <div class="balance-detail-row">
                                            <span class="detail-label">赠送</span>
                                            <strong id="wallet-bonus" class="detail-val">--</strong>
                                        </div>
                                    </div>
                                </div>
                                
                                <!-- Consolidated Redeem Section -->
                                <div class="redeem-section">
                                    <div class="redeem-input-row">
                                        <input type="text" 
                                               id="redeem-code-input" 
                                               placeholder="输入兑换码"
                                               maxlength="19"
                                               autocomplete="off"
                                               onkeyup="if(event.key==='Enter') WalletModal.redeemCode()" />
                                        <button class="redeem-btn" onclick="WalletModal.redeemCode()">兑换</button>
                                    </div>
                                </div>
                            </div>
                            
                            <!-- Recharge View -->
                            <div class="wallet-view" id="view-recharge">
                                <h3 class="view-title">⚡ 充值套餐</h3>
                                <div class="packages-container" id="wallet-packages">
                                    <div class="loading-text">加载中...</div>
                                </div>
                                
                                <!-- Afdian Code Query Section -->
                                <div class="afdian-section">
                                    <div class="afdian-header">
                                        <span class="afdian-icon">❤️</span>
                                        <span>爱发电订单查询</span>
                                    </div>
                                    <p class="afdian-hint">在爱发电支付后，输入订单号获取兑换码</p>
                                    <div class="afdian-input-row">
                                        <input type="text" 
                                               id="afdian-order-input" 
                                               placeholder="爱发电订单号"
                                               autocomplete="off"
                                               onkeyup="if(event.key==='Enter') WalletModal.queryAfdianCode()" />
                                        <button class="afdian-query-btn" onclick="WalletModal.queryAfdianCode()">查询</button>
                                    </div>
                                    <div id="afdian-result" class="afdian-result"></div>
                                </div>
                            </div>

                            
                            <!-- History View -->
                            <div class="wallet-view" id="view-history">
                                <div class="history-header">
                                    <h3 class="view-title">📜 交易记录</h3>
                                    <div class="history-actions">
                                        <div class="filter-wrapper">
                                            <div class="filter-chip" onclick="WalletModal.toggleFilterMenu(event)">
                                                <span id="filter-label">全部</span>
                                                <span class="filter-arrow">▼</span>
                                            </div>
                                            <div class="filter-popup" id="filter-popup">
                                                <div class="filter-option active" data-value="all" onclick="WalletModal.selectFilter('all', '全部')">全部</div>
                                                <div class="filter-option" data-value="today" onclick="WalletModal.selectFilter('today', '今天')">今天</div>
                                                <div class="filter-option" data-value="week" onclick="WalletModal.selectFilter('week', '本周')">本周</div>
                                                <div class="filter-option" data-value="month" onclick="WalletModal.selectFilter('month', '本月')">本月</div>
                                                <div class="filter-divider"></div>
                                                <div class="filter-option" data-value="custom" onclick="WalletModal.showCustomDate()">📅 自定义...</div>
                                            </div>
                                        </div>
                                        <div class="clear-chip" onclick="WalletModal.clearHistory()">🗑</div>
                                    </div>
                                </div>
                                <div class="history-container" id="wallet-history">
                                    <div class="loading-text">加载中...</div>
                                </div>
                            </div>
                            
                            <!-- Orders View (Shop Purchase History) -->
                            <div class="wallet-view" id="view-orders">
                                <h3 class="view-title">📦 我的订单</h3>
                                <div class="orders-container" id="wallet-orders">
                                    <div class="loading-text">加载中...</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            // Close on overlay click
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) this.close();
            });

            document.body.appendChild(overlay);
            this.modalEl = overlay;
        },

        /**
         * Switch between views
         */
        /**
         * Switch between views
         */
        switchView(viewId) {
            // Update menu items
            document.querySelectorAll('.wallet-menu-item').forEach(item => {
                item.classList.toggle('active', item.dataset.view === viewId);
            });

            // Update Sidebar Indicator
            this.updateIndicatorPosition();

            // Update views
            document.querySelectorAll('.wallet-view').forEach(view => {
                view.classList.toggle('active', view.id === `view-${viewId}`);
            });

            // Load orders when switching to orders view
            if (viewId === 'orders' && !this.ordersLoaded) {
                this.loadOrders();
            }
        },

        /**
         * Update the position of the sliding sidebar indicator
         */
        updateIndicatorPosition() {
            const sidebar = document.querySelector('.wallet-sidebar');
            const activeItem = document.querySelector('.wallet-menu-item.active');
            const indicator = document.querySelector('.sidebar-indicator');

            if (sidebar && activeItem && indicator) {
                // Calculate relative position
                const sidebarRect = sidebar.getBoundingClientRect();
                const itemRect = activeItem.getBoundingClientRect();

                // 16 is container padding top
                const top = itemRect.top - sidebarRect.top;
                const height = itemRect.height;

                indicator.style.top = `${top}px`;
                indicator.style.height = `${height}px`;
                indicator.style.opacity = '1';
            }
        },

        /**
         * Load data into the modal - OPTIMIZED with parallel requests
         */
        async loadData() {
            try {
                console.log('[WalletModal] 🔄 Loading wallet data...');

                // Wait for PointsService
                if (!window.PointsService) {
                    throw new Error('PointsService not available');
                }

                // 🚀 Run ALL API calls in PARALLEL
                const [balance, packages, history] = await Promise.all([
                    PointsService.getBalance(),
                    PointsService.getPackages(),
                    PointsService.getHistory()
                ]);

                console.log('[WalletModal] ✅ Data loaded:', { balance, packagesLength: packages.length });

                // Update balance with animation
                const totalEl = document.getElementById('wallet-total');
                if (totalEl) {
                    const currentVal = parseInt(totalEl.dataset.value || 0);
                    const newVal = balance.total_balance;
                    this.animateValue(totalEl, currentVal, newVal, 800);
                    totalEl.dataset.value = newVal;
                }

                const paidEl = document.getElementById('wallet-paid');
                if (paidEl) paidEl.textContent = balance.paid_balance.toLocaleString();

                const bonusEl = document.getElementById('wallet-bonus');
                if (bonusEl) bonusEl.textContent = balance.bonus_balance.toLocaleString();

                // Update packages
                const pkgContainer = document.getElementById('wallet-packages');
                if (pkgContainer) {
                    if (packages.length === 0) {
                        pkgContainer.innerHTML = '<div class="empty-text">暂无套餐</div>';
                    } else {
                        pkgContainer.innerHTML = packages.map(pkg => `
                            <div class="package-item" onclick="WalletModal.buyPackage('${pkg.id}', '${pkg.name}')">
                                <div class="pkg-name">${pkg.name}</div>
                                <div class="pkg-points">${pkg.points_amount} 分${pkg.bonus_points > 0 ? ` <span class="pkg-bonus">+${pkg.bonus_points}</span>` : ''}</div>
                                <div class="pkg-price">¥${pkg.price_cny}</div>
                            </div>
                        `).join('');
                    }
                }

                // Store history data for filtering
                this.historyData = history;

                // Update history count (if element exists)
                const historyCount = document.getElementById('history-count');
                if (historyCount) {
                    historyCount.textContent = history.length > 0 ? `(${history.length})` : '';
                }

                // Render history
                this.renderHistory(history);
            } catch (err) {
                console.error('[WalletModal] ❌ Load data failed:', err);
                this.showToast('数据加载失败', 'error');
            }
        },

        /**
         * Animate number
         */
        animateValue(obj, start, end, duration) {
            if (start === end) {
                obj.textContent = end.toLocaleString();
                return;
            }
            let startTimestamp = null;
            const step = (timestamp) => {
                if (!startTimestamp) startTimestamp = timestamp;
                const progress = Math.min((timestamp - startTimestamp) / duration, 1);
                // Ease out expo
                const easeProgress = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);

                const value = Math.floor(easeProgress * (end - start) + start);
                obj.textContent = value.toLocaleString();

                if (progress < 1) {
                    window.requestAnimationFrame(step);
                } else {
                    obj.textContent = end.toLocaleString();
                }
            };
            window.requestAnimationFrame(step);
        },

        /**
         * Handle package purchase
         */
        async buyPackage(packageId, packageName) {
            if (!confirm(`确定要购买「${packageName}」吗？\n\n（这是模拟支付，用于测试）`)) {
                return;
            }

            const overlay = document.getElementById('wallet-modal-overlay');

            try {
                // Show loading state
                if (overlay) overlay.classList.add('loading');

                await PointsService.mockPay(packageId);

                // Remove loading state BEFORE refreshing data
                if (overlay) overlay.classList.remove('loading');

                // Refresh data to show new balance
                await this.loadData();

                // Show success toast (non-blocking)
                this.showToast('✅ 充值成功！', 'success');

            } catch (err) {
                console.error('[WalletModal] Purchase failed:', err);
                // Remove loading state on error
                if (overlay) overlay.classList.remove('loading');
                alert('❌ 支付失败: ' + (err.message || '未知错误'));
            }
        },

        /**
         * Redeem activation code
         */
        async redeemCode() {
            const input = document.getElementById('redeem-code-input');
            const code = input?.value?.trim()?.toUpperCase();

            if (!code) {
                this.showToast('请输入兑换码', 'error');
                return;
            }

            // Validate format: ZY-XXXX-XXXX-XXXX
            if (!/^ZY-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)) {
                this.showToast('兑换码格式不正确', 'error');
                return;
            }

            const redeemBtn = document.querySelector('.redeem-btn');
            const originalText = redeemBtn?.textContent;

            try {
                // Show loading
                if (redeemBtn) {
                    redeemBtn.textContent = '兑换中...';
                    redeemBtn.disabled = true;
                }

                // Call RPC function
                const { data, error } = await supabase.rpc('fn_redeem_code', {
                    p_code: code
                });

                if (error) throw error;

                if (data.success) {
                    // Clear input
                    input.value = '';

                    // Show success
                    this.showToast(`✅ ${data.message} +${data.points}分`, 'success');

                    // Refresh balance and history
                    await this.loadData();
                } else {
                    this.showToast(`❌ ${data.message}`, 'error');
                }

            } catch (err) {
                console.error('[WalletModal] Redeem failed:', err);
                this.showToast('❌ 兑换失败: ' + (err.message || '未知错误'), 'error');
            } finally {
                if (redeemBtn) {
                    redeemBtn.textContent = originalText;
                    redeemBtn.disabled = false;
                }
            }
        },

        /**
         * Query Afdian order for redemption code
         */
        async queryAfdianCode() {
            const input = document.getElementById('afdian-order-input');
            const resultDiv = document.getElementById('afdian-result');
            const orderNo = input?.value?.trim();

            if (!orderNo) {
                this.showToast('请输入订单号', 'error');
                return;
            }

            const queryBtn = document.querySelector('.afdian-query-btn');
            const originalText = queryBtn?.textContent;

            try {
                if (queryBtn) {
                    queryBtn.textContent = '查询中...';
                    queryBtn.disabled = true;
                }

                // Get server URL from verify config or default
                const serverUrl = window.VERIFY_SERVER_URL || 'https://zaoyoe-verify-server-production.up.railway.app';

                const response = await fetch(`${serverUrl}/api/afdian/query?order_no=${encodeURIComponent(orderNo)}`);
                const data = await response.json();

                if (data.success) {
                    // Show code in result area
                    resultDiv.innerHTML = `
                        <div class="afdian-code-result">
                            <div class="code-label">您的兑换码（${data.points}积分）：</div>
                            <div class="code-value" onclick="WalletModal.copyAfdianCode('${data.code}')">${data.code}</div>
                            <div class="code-hint">${data.is_redeemed ? '⚠️ 该兑换码已使用' : '点击复制，然后在余额页使用'}</div>
                        </div>
                    `;
                    resultDiv.style.display = 'block';
                } else {
                    resultDiv.innerHTML = `<div class="afdian-error">${data.message || '查询失败'}</div>`;
                    resultDiv.style.display = 'block';
                }

            } catch (err) {
                console.error('[WalletModal] Afdian query failed:', err);
                resultDiv.innerHTML = `<div class="afdian-error">查询失败，请稍后重试</div>`;
                resultDiv.style.display = 'block';
            } finally {
                if (queryBtn) {
                    queryBtn.textContent = originalText;
                    queryBtn.disabled = false;
                }
            }
        },

        /**
         * Copy Afdian code to clipboard
         */
        copyAfdianCode(code) {
            navigator.clipboard.writeText(code).then(() => {
                this.showToast('✅ 兑换码已复制', 'success');
            }).catch(() => {
                this.showToast('复制失败，请手动复制', 'error');
            });
        },

        /**
         * Show a toast notification
         */
        showToast(message, type = 'info') {
            const toast = document.createElement('div');
            toast.className = `wallet-toast wallet-toast-${type}`;
            toast.innerHTML = message;

            const borderColor = type === 'success'
                ? '#10b981'
                : type === 'error'
                    ? '#ef4444'
                    : '#ffffff';

            toast.style.cssText = `
                position: fixed;
                bottom: 80px;
                left: 50%;
                transform: translateX(-50%) translateY(20px);
                padding: 12px 24px;
                border-radius: 50px;
                background: rgba(20, 20, 20, 0.9);
                border: 1px solid ${borderColor};
                backdrop-filter: blur(12px);
                -webkit-backdrop-filter: blur(12px);
                color: white;
                font-size: 14px;
                font-weight: 500;
                letter-spacing: 0.5px;
                z-index: 10001;
                box-shadow: 0 8px 32px rgba(0,0,0,0.4);
                opacity: 0;
                animation: toastSlideIn 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards;
                white-space: nowrap;
                display: flex;
                align-items: center;
                gap: 8px;
            `;

            // Add animation keyframes if not exists
            if (!document.getElementById('wallet-toast-style')) {
                const style = document.createElement('style');
                style.id = 'wallet-toast-style';
                style.textContent = `
                    @keyframes toastSlideIn {
                        from { opacity: 0; transform: translateX(-50%) translateY(20px); }
                        to { opacity: 1; transform: translateX(-50%) translateY(0); }
                    }
                    @keyframes toastSlideOut {
                        from { opacity: 1; transform: translateX(-50%) translateY(0); }
                        to { opacity: 0; transform: translateX(-50%) translateY(-10px); }
                    }
                `;
                document.head.appendChild(style);
            }

            document.body.appendChild(toast);

            setTimeout(() => {
                toast.style.animation = 'toastSlideOut 0.3s ease forwards';
                setTimeout(() => toast.remove(), 300);
            }, 2000);
        },

        /**
         * Render history items
         */
        renderHistory(items) {
            const container = document.getElementById('wallet-history');
            if (!items || items.length === 0) {
                container.innerHTML = '<div class="empty-text">暂无记录</div>';
                return;
            }

            // identify missing prompts
            const missingPromptIds = new Set();
            items.forEach(item => {
                if (item.reason === 'unlock_prompt' && item.reference_id) {
                    // Check local cache first
                    if (!this.promptCache[item.reference_id]) {
                        // Check global PROMPTS
                        let found = false;
                        if (window.PROMPTS) {
                            const p = window.PROMPTS.find(pr => String(pr.id) === String(item.reference_id) || String(pr.supabaseId) === String(item.reference_id));
                            if (p) {
                                this.promptCache[item.reference_id] = p.title;
                                found = true;
                            }
                        }
                        if (!found) {
                            missingPromptIds.add(item.reference_id);
                        }
                    }
                }
            });

            // Fetch missing titles if any
            if (missingPromptIds.size > 0) {
                this.fetchPromptTitles(Array.from(missingPromptIds)).then(() => {
                    // Re-render to show titles (or update DOM directly if complex)
                    // For simplicity, re-rendering visible items is easiest if data changed
                    this.renderHistory(items);
                });
            }

            container.innerHTML = items.map((item, index) => {
                const date = new Date(item.created_at);
                const dateStr = `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;

                // Format Reason
                let reason = item.reason || '交易';
                let reasonClass = '';

                // 1. Handle Admin Adjustment
                if (reason.startsWith('admin_manual:')) {
                    // Remove admin email/id inside brackets [xxx]
                    reason = reason.replace(/admin_manual:\s*\[.*?\]\s*/, '管理员调整: ');
                    // Or if regex fails to match brackets but has prefix
                    if (reason.startsWith('admin_manual:')) {
                        reason = reason.replace('admin_manual:', '管理员调整');
                    }
                }

                // 2. Handle Unlock Prompt
                else if (reason === 'unlock_prompt') {
                    const promptId = item.reference_id;
                    let promptTitle = this.promptCache[promptId] || '加载中...'; // Use Cache

                    // If still loading (in missing set), show checking or ID
                    if (!this.promptCache[promptId]) {
                        promptTitle = `提示词 (ID: ${promptId})`;
                    }

                    reason = `解锁提示词: ${promptTitle}`;
                }

                return `
                    <div class="history-item" onclick="WalletModal.toggleItemDetails(this)">
                        <div class="history-row-main">
                            <div class="history-main">
                                <div class="history-desc" title="${item.reason}">${reason}</div>
                                <div class="history-date">${dateStr}</div>
                            </div>
                            <div class="history-amount ${item.amount > 0 ? 'positive' : 'negative'}">
                                ${item.amount > 0 ? '+' : ''}${item.amount}
                            </div>
                        </div>
                        <div class="history-details" onclick="event.stopPropagation()">
                             <div class="detail-row">
                                <span>订单号</span>
                                <span class="detail-val copyable" class="detail-val copyable" onclick="WalletModal.copyToClipboard('${item.id}', event)" title="点击复制订单号" style="font-family:monospace;color:#fff;">${item.id}</span>
                             </div>
                             <div class="detail-row">
                                <span>业务关联</span>
                                <span style="font-family:monospace;color:#fff;">${item.reference_id || '无'}</span>
                             </div>
                        </div>
                    </div>
                `;
            }).join('');
        },

        // Fetch prompt titles from Supabase
        async fetchPromptTitles(ids) {
            try {
                if (!ids || ids.length === 0) return;
                // Avoid redundant fetches
                const toFetch = ids.filter(id => !this.promptCache[id]);
                if (toFetch.length === 0) return;

                const { data, error } = await window.supabaseClient
                    .from('prompts')
                    .select('id, title')
                    .in('id', toFetch);

                if (error) throw error;
                if (data) {
                    data.forEach(p => {
                        this.promptCache[p.id] = p.title;
                    });
                }
            } catch (err) {
                console.error('Error fetching prompt titles:', err);
            }
        },

        /**
         * Toggle history section collapse
         */
        toggleHistory() {
            const container = document.getElementById('wallet-history');
            const toggle = document.getElementById('history-toggle');

            if (container.classList.contains('collapsed')) {
                container.classList.remove('collapsed');
                toggle.textContent = '▼';
            } else {
                container.classList.add('collapsed');
                toggle.textContent = '▶';
            }
        },

        /**
         * Toggle filter popup menu
         */
        toggleFilterMenu(event) {
            event.stopPropagation();
            const popup = document.getElementById('filter-popup');
            const isOpen = popup.classList.contains('open');

            if (isOpen) {
                popup.classList.remove('open');
            } else {
                popup.classList.add('open');

                // Close when clicking outside
                const closeHandler = (e) => {
                    if (!e.target.closest('.filter-wrapper')) {
                        popup.classList.remove('open');
                        document.removeEventListener('click', closeHandler);
                    }
                };
                setTimeout(() => document.addEventListener('click', closeHandler), 0);
            }
        },

        /**
         * Select filter option
         */
        selectFilter(value, label) {
            // Close popup
            document.getElementById('filter-popup').classList.remove('open');

            // Update label and active state
            document.getElementById('filter-label').textContent = label;
            document.querySelectorAll('.filter-option').forEach(opt => {
                opt.classList.toggle('active', opt.dataset.value === value);
            });

            this.currentFilter = value;
            this.applyFilter(value);
        },

        /**
         * Show custom date picker
         */
        showCustomDate() {
            document.getElementById('filter-popup').classList.remove('open');

            // Create date picker modal
            const modal = document.createElement('div');
            modal.className = 'date-picker-modal';
            modal.innerHTML = `
                <div class="date-picker-content">
                    <div class="date-picker-header">📅 选择日期范围</div>
                    <div class="date-picker-row">
                        <label>开始日期</label>
                        <input type="date" id="date-start" />
                    </div>
                    <div class="date-picker-row">
                        <label>结束日期</label>
                        <input type="date" id="date-end" />
                    </div>
                    <div class="date-picker-actions">
                        <button class="date-cancel" onclick="this.closest('.date-picker-modal').remove()">取消</button>
                        <button class="date-confirm" onclick="WalletModal.applyCustomDate()">确定</button>
                    </div>
                </div>
            `;

            // Set default dates (last 7 days)
            const today = new Date().toISOString().split('T')[0];
            const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

            document.body.appendChild(modal);
            document.getElementById('date-start').value = weekAgo;
            document.getElementById('date-end').value = today;

            // Close on backdrop click
            modal.addEventListener('click', (e) => {
                if (e.target === modal) modal.remove();
            });
        },

        /**
         * Apply custom date filter
         */
        applyCustomDate() {
            const startStr = document.getElementById('date-start').value;
            const endStr = document.getElementById('date-end').value;

            if (!startStr || !endStr) {
                alert('请选择开始和结束日期');
                return;
            }

            const start = new Date(startStr);
            const end = new Date(endStr);
            end.setHours(23, 59, 59, 999); // Include the whole end day

            if (start > end) {
                alert('开始日期不能晚于结束日期');
                return;
            }

            // Close modal
            document.querySelector('.date-picker-modal')?.remove();

            // Update label
            const label = `${start.getMonth() + 1}/${start.getDate()} - ${end.getMonth() + 1}/${end.getDate()}`;
            document.getElementById('filter-label').textContent = label;

            // Store custom dates
            this.customDateStart = start;
            this.customDateEnd = end;
            this.currentFilter = 'custom';

            this.applyFilter('custom');
        },

        /**
         * Apply filter to history
         */
        applyFilter(filter) {
            const now = new Date();
            let filtered = this.historyData || [];

            if (filter === 'today') {
                const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                filtered = filtered.filter(item => new Date(item.created_at) >= today);
            } else if (filter === 'week') {
                const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                filtered = filtered.filter(item => new Date(item.created_at) >= weekAgo);
            } else if (filter === 'month') {
                const monthAgo = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
                filtered = filtered.filter(item => new Date(item.created_at) >= monthAgo);
            } else if (filter === 'custom' && this.customDateStart && this.customDateEnd) {
                filtered = filtered.filter(item => {
                    const date = new Date(item.created_at);
                    return date >= this.customDateStart && date <= this.customDateEnd;
                });
            }

            const hc1 = document.getElementById('history-count');
            if (hc1) hc1.textContent = filtered.length > 0 ? `(${filtered.length})` : '';
            this.renderHistory(filtered);
        },

        /**
         * Clear all transaction history
         */
        async clearHistory() {
            // Get current count before delete
            const currentCount = (this.historyData || []).length;
            if (currentCount === 0) {
                this.showToast('暂无记录可清除', 'info');
                return;
            }

            if (!confirm(`确定要清除 ${currentCount} 条交易记录吗？\n\n此操作不可恢复！`)) {
                return;
            }

            try {
                // Use RPC function to bypass RLS issues
                const { data: deletedCount, error } = await supabase.rpc('fn_clear_user_history');

                console.log('[WalletModal] Delete result:', { deletedCount, error });

                if (error) throw error;

                this.historyData = [];
                this.renderHistory([]);
                const hc2 = document.getElementById('history-count');
                if (hc2) hc2.textContent = '';
                this.showToast(`已清除 ${currentCount} 条记录`, 'success');
            } catch (err) {
                console.error('[WalletModal] Clear history failed:', err);
                alert('清除失败: ' + (err.message || '未知错误'));
            }
        },

        /**
         * Expand item to show details
         */
        /**
         * Copy text to clipboard
         */
        async copyToClipboard(text, event) {
            if (event) event.stopPropagation();
            try {
                await navigator.clipboard.writeText(text);
                this.showToast('✅ 复制成功', 'success');
            } catch (err) {
                console.error('Copy failed:', err);
                this.showToast('❌ 复制失败', 'error');
            }
        },

        /**
         * Toggle item expansion
         */
        toggleItemDetails(element) {
            // Toggle expanded class
            element.classList.toggle('expanded');
        },

        /**
         * Load shop orders
         */
        async loadOrders() {
            try {
                console.log('[WalletModal] 🔄 Loading orders...');
                const container = document.getElementById('wallet-orders');
                if (!container) return;

                const { data: { session } } = await supabase.auth.getSession();
                if (!session) {
                    container.innerHTML = '<div class="empty-text">请先登录</div>';
                    return;
                }

                // Fetch orders from shop_orders table joined with items
                const { data: orders, error } = await supabase
                    .from('shop_orders')
                    .select(`
                        id, 
                        total_price, 
                        item_count, 
                        status, 
                        created_at, 
                        snapshot_product_name,
                        shop_order_items (
                            id,
                            snapshot_product_name
                        )
                    `)
                    .eq('user_id', session.user.id)
                    .order('created_at', { ascending: false })
                    .limit(50);

                if (error) throw error;

                this.ordersLoaded = true;
                this.renderOrders(orders || []);

            } catch (err) {
                console.error('[WalletModal] ❌ Load orders failed:', err);
                const container = document.getElementById('wallet-orders');
                if (container) {
                    container.innerHTML = '<div class="empty-text">加载失败</div>';
                }
            }
        },

        /**
         * Render shop orders
         */
        renderOrders(orders) {
            const container = document.getElementById('wallet-orders');
            if (!orders || orders.length === 0) {
                container.innerHTML = '<div class="empty-text">暂无订单记录</div>';
                return;
            }

            container.innerHTML = orders.map(order => {
                const date = new Date(order.created_at);
                const dateStr = `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;

                // Map status to display status
                const statusMap = {
                    'completed': { text: '已完成', class: 'status-completed' },
                    'full_refund': { text: '已退款', class: 'status-refunded' },
                    'partial_refund': { text: '部分退款', class: 'status-refunded' }
                };

                // Fallback for old data compatibility
                let statusInfo = statusMap[order.status];
                if (!statusInfo) {
                    // Check refund_status for old orders if status is missing
                    if (order.refund_status === 'refunded') statusInfo = { text: '已退款', class: 'status-refunded' };
                    else statusInfo = { text: '已完成', class: 'status-completed' };
                }

                // Display name: "Product Name" or "Product Name 等 X 件"
                let displayName = order.snapshot_product_name || '未知商品';
                const count = order.item_count || (order.shop_order_items ? order.shop_order_items.length : 1);

                if (count > 1) {
                    displayName = `${displayName} 等 ${count} 件`;
                }

                // Price display: order.total_price (new) or order.price_paid (old)
                const price = order.total_price != null ? order.total_price : order.price_paid;

                return `
                    <div class="order-item" onclick="event.stopPropagation(); WalletModal.showOrderDetail('${order.id}')">
                        <div class="order-main">
                            <div class="order-product">${this.escapeHtml(displayName)}</div>
                            <div class="order-meta">
                                <span class="order-date">${dateStr}</span>
                            </div>
                        </div>
                        <div class="order-right">
                            <div class="order-cost">-${price} 积分</div>
                            <div class="order-status ${statusInfo.class}">${statusInfo.text}</div>
                        </div>
                    </div>
                `;
            }).join('');
        },

        /**
         * Show order detail with purchased content
         */
        /**
         * Show order detail with purchased content (Premium Dark Glass UI)
         */
        async showOrderDetail(orderId) {
            try {
                // Fetch order basic info
                const { data: order, error } = await supabase
                    .from('shop_orders')
                    .select('*')
                    .eq('id', orderId)
                    .single();

                if (error) throw error;
                if (!order) {
                    this.showToast('订单不存在', 'error');
                    return;
                }

                // Fetch items with inventory content
                let items = [];
                let contentHtml = '';

                // Try to fetch from order_items first
                const { data: orderItems, error: itemsError } = await supabase
                    .from('shop_order_items')
                    .select(`
                        id,
                        snapshot_product_name,
                        price_paid,
                        shop_inventory ( content )
                    `)
                    .eq('order_id', orderId);

                if (orderItems && orderItems.length > 0) {
                    items = orderItems.map(item => ({
                        name: item.snapshot_product_name,
                        content: item.shop_inventory?.content || '内容加载失败',
                        price: item.price_paid
                    }));
                } else if (order.inventory_id) {
                    // Legacy fallback: single item in order table
                    const { data: inventory } = await supabase
                        .from('shop_inventory')
                        .select('content')
                        .eq('id', order.inventory_id)
                        .single();

                    items.push({
                        name: order.snapshot_product_name,
                        content: inventory?.content || '内容加载失败',
                        price: order.price_paid
                    });
                }

                const date = new Date(order.created_at);
                const dateStr = `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;

                // Helper to escape content for attribute
                const escapeAttr = (str) => (str || '').replace(/"/g, '&quot;');

                // Build content HTML using new premium structure
                contentHtml = items.map((item) => `
                    <div class="content-card">
                        <div class="item-name">
                             <span style="width:6px;height:6px;background:#6b9ece;border-radius:50%;display:inline-block;"></span>
                             ${this.escapeHtml(item.name)}
                        </div>
                        <div class="item-content-box">
                            <div class="item-text">${this.escapeHtml(item.content)}</div>
                        </div>
                    </div>
                `).join('');

                const totalPrice = order.total_price != null ? order.total_price : order.price_paid;

                // Create detail modal overlay with Premium UI
                const detailOverlay = document.createElement('div');
                detailOverlay.className = 'order-detail-overlay';

                // Embedded Premium Styles
                const styleId = 'order-detail-premium-style';
                if (!document.getElementById(styleId)) {
                    const style = document.createElement('style');
                    style.id = styleId;
                    style.innerHTML = `
                        .wallet-order-modal-overlay {
                            position: fixed !important; top: 0 !important; left: 0 !important; width: 100% !important; height: 100% !important;
                            background: rgba(0, 0, 0, 0.7) !important;
                            backdrop-filter: blur(4px) !important; -webkit-backdrop-filter: blur(4px) !important;
                            z-index: 200000 !important;
                            display: flex !important; justify-content: center !important; align-items: center !important;
                            animation: fadeIn 0.3s ease-out;
                        }
                        /* Wallet Order Modal - Unique class to avoid conflicts with global .premium-modal */
                        .wallet-order-modal {
                            width: 90% !important; max-width: 380px !important;
                            /* Premium Glass - Neutral Dark (Matches Wallet Modal) */
                            background: rgba(20, 20, 22, 0.75) !important;
                            backdrop-filter: blur(40px) !important; -webkit-backdrop-filter: blur(40px) !important;
                            border: 1px solid rgba(255, 255, 255, 0.12) !important;
                            border-top: 1px solid rgba(255, 255, 255, 0.25) !important; /* Premium Top Highlight */
                            border-radius: 24px !important;
                            box-shadow: 0 40px 80px -20px rgba(0, 0, 0, 0.7) !important;
                            overflow: hidden !important;
                            display: flex !important; flex-direction: column !important;
                            max-height: 85vh !important;
                            color: #fff !important;
                            animation: slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
                            opacity: 1;
                        }
                        .wallet-order-modal-header {
                            padding: 24px 24px 16px;
                            border-bottom: 1px solid rgba(255, 255, 255, 0.08); /* Subtle separator */
                            display: flex; justify-content: space-between; align-items: center;
                        }
                        .wallet-order-modal-title {
                            font-size: 18px; font-weight: 700; color: #fff;
                            display: flex; align-items: center; gap: 8px;
                            letter-spacing: -0.5px;
                        }
                        .wallet-order-close-btn {
                            width: 30px; height: 30px;
                            border-radius: 50%;
                            border: none;
                            background: rgba(255, 255, 255, 0.05);
                            color: rgba(255, 255, 255, 0.6);
                            cursor: pointer;
                            display: flex; align-items: center; justify-content: center;
                            transition: all 0.2s;
                        }
                        .wallet-order-close-btn:hover {
                            background: rgba(255, 255, 255, 0.15);
                            color: #fff;
                        }
                        .wallet-order-modal-body {
                            padding: 0 24px 24px;
                            overflow-y: auto;
                        }
                        
                        /* Metadata Section */
                        .meta-section {
                            margin-bottom: 20px;
                            padding-top: 10px;
                        }
                        .detail-row {
                            display: flex; justify-content: space-between; align-items: center;
                            margin-bottom: 10px;
                            font-size: 13px;
                        }
                        .detail-label { color: rgba(255, 255, 255, 0.4); }
                        .detail-val { color: rgba(255, 255, 255, 0.9); font-weight: 500; font-family: 'Outfit', sans-serif;}
                        .detail-val.mono { font-family: monospace; letter-spacing: 0.5px; opacity: 0.8; }
                        .detail-val.highlight { color: #f87171; font-weight: 700; }
                        
                        /* Action Buttons */
                        .modal-actions {
                            display: flex; gap: 10px; margin-bottom: 20px;
                        }
                        .action-btn.primary {
                            flex: 1;
                            background: linear-gradient(135deg, #4ade80 0%, #22c55e 100%);
                            color: #052e16;
                            border: none;
                            padding: 10px;
                            border-radius: 50px;
                            font-weight: 600;
                            font-size: 13px;
                            cursor: pointer;
                            display: flex; align-items: center; justify-content: center; gap: 6px;
                            box-shadow: 0 4px 12px rgba(34, 197, 94, 0.3);
                            transition: all 0.2s;
                        }
                        .action-btn.primary:hover {
                            transform: translateY(-1px);
                            box-shadow: 0 6px 16px rgba(34, 197, 94, 0.4);
                            filter: brightness(1.05);
                        }
                         .action-btn.secondary {
                            flex: 1;
                            background: rgba(255, 255, 255, 0.05);
                            color: rgba(255, 255, 255, 0.8);
                            border: 1px solid rgba(255, 255, 255, 0.1);
                            padding: 10px;
                            border-radius: 50px;
                            font-weight: 500;
                            font-size: 13px;
                            cursor: pointer;
                            display: flex; align-items: center; justify-content: center; gap: 6px;
                            transition: all 0.2s;
                        }
                        .action-btn.secondary:hover {
                            background: rgba(255, 255, 255, 0.1);
                            color: #fff;
                        }
                        
                        /* Content Box */
                        .content-section { margin-top: 0; }
                        .content-section-title {
                            font-size: 12px; font-weight: 600; color: rgba(255, 255, 255, 0.3);
                            margin-bottom: 10px; text-align: center;
                        }
                        
                        .content-card {
                            background: rgba(255, 255, 255, 0.05) !important;
                            backdrop-filter: blur(12px) !important;
                            -webkit-backdrop-filter: blur(12px) !important;
                            border-radius: 16px !important;
                            padding: 16px !important;
                            margin-bottom: 12px !important;
                            border: 1px solid rgba(255, 255, 255, 0.1) !important;
                            border-width: 1px !important;
                            border-style: solid !important;
                            box-sizing: border-box !important;
                            outline: none !important;
                            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2) !important;
                        }
                        
                        .item-name {
                            font-size: 13px; font-weight: 600; color: #e2e8f0;
                            margin-bottom: 8px;
                            display: flex; align-items: center; gap: 6px;
                        }
                        .item-content-box {
                            background: transparent;
                            border-radius: 0;
                            padding: 0;
                        }
                        .item-text {
                            font-family: 'Monaco', monospace;
                            font-size: 12px; color: #10b981;
                            word-break: break-all;
                            line-height: 1.5;
                            opacity: 0.9;
                        }

                        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
                        @keyframes slideUp { from { opacity: 0; transform: translateY(20px) scale(0.95); } to { opacity: 1; transform: translateY(0) scale(1); } }
                    `;
                    document.head.appendChild(style);
                }

                detailOverlay.className = 'wallet-order-modal-overlay';
                detailOverlay.onclick = (e) => {
                    if (e.target === detailOverlay) detailOverlay.remove();
                };


                // Prepare content for export/copy
                // Use clean single newline join, removing visual separators for copy
                const allContent = items.map(i => `${i.name}:\n${i.content}`).join('\n');

                // Attach button handlers
                window.WalletModal_export = () => {
                    const blob = new Blob([`订单编号: ${order.id}\n下单时间: ${dateStr}\n\n${allContent}`], { type: 'text/plain' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `order_${order.id.split('-')[0]}.txt`;
                    a.click();
                    URL.revokeObjectURL(url);
                };

                window.WalletModal_copyAll = () => {
                    navigator.clipboard.writeText(allContent).then(() => {
                        this.showToast('✅ 已复制全部内容', 'success');
                    }).catch(() => this.showToast('复制失败', 'error'));
                };

                detailOverlay.innerHTML = `
                    <div class="wallet-order-modal">
                        <div class="wallet-order-modal-header">
                            <div class="wallet-order-modal-title">
                                <i class="fas fa-box-open" style="color: #6b9ece;"></i> 订单详情
                            </div>
                            <button class="wallet-order-close-btn" onclick="this.closest('.wallet-order-modal-overlay').remove()">
                                <i class="fas fa-times"></i>
                            </button>
                        </div>
                        <div class="wallet-order-modal-body">
                            <div class="meta-section">
                                <div class="detail-row">
                                    <span class="detail-label">订单编号</span>
                                    <span class="detail-val mono" title="${order.id}">${order.id.split('-')[0]}...${order.id.slice(-4)}</span>
                                </div>
                                <div class="detail-row">
                                    <span class="detail-label">下单时间</span>
                                    <span class="detail-val">${dateStr}</span>
                                </div>
                                <div class="detail-row">
                                    <span class="detail-label">支付积分</span>
                                    <span class="detail-val highlight">-${totalPrice} 积分</span>
                                </div>
                            </div>

                            <div class="modal-actions">
                                <button class="action-btn primary" onclick="WalletModal_copyAll()">
                                    <i class="fas fa-copy"></i> 全部复制
                                </button>
                                <button class="action-btn secondary" onclick="WalletModal_export()">
                                    <i class="fas fa-download"></i> 导出
                                </button>
                            </div>
                            
                            <div class="content-section">
                                <div class="content-section-title">购买内容 (${items.length})</div>
                                ${contentHtml}
                            </div>
                        </div>
                    </div>
                `;

                document.body.appendChild(detailOverlay);

            } catch (err) {
                console.error('[WalletModal] Show order detail failed:', err);
                this.showToast('加载订单详情失败', 'error');
            }
        },

        /**
         * Escape HTML to prevent XSS
         */
        escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        },

        /**
         * Copy order content to clipboard
         */
        copyOrderContent(element) {
            const content = element.textContent;
            navigator.clipboard.writeText(content).then(() => {
                this.showToast('✅ 内容已复制', 'success');
            }).catch(() => {
                this.showToast('复制失败，请手动复制', 'error');
            });
        }
    };

    // Export to window
    window.WalletModal = WalletModal;
    console.log('[WalletModal] ✅ Ready');
})();
