/**
 * 💰 Points Service - Commercial Points System
 * A simple, robust implementation for managing user points.
 */
(function () {
    'use strict';

    // Wait for supabaseClient to be available
    const supabase = window.supabaseClient;
    if (!supabase) {
        console.error('[PointsService] ❌ Supabase client not found!');
        return;
    }

    console.log('[PointsService] ✅ Initializing...');

    function normalizePointValue(value, fallback = 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : fallback;
    }

    function isUnsafeDirectRechargeAllowed() {
        const host = String(window.location.hostname || '').toLowerCase();
        return host === 'localhost' || host === '127.0.0.1';
    }

    function isSimulatedPaymentAllowed(options = {}) {
        return options?.allowSimulatedPayment === true || isUnsafeDirectRechargeAllowed();
    }

    const PointsService = {
        // Cached session to avoid redundant getSession() calls
        _cachedUserId: null,
        _walletOverviewCache: null,
        _walletOverviewCacheLimit: 0,
        _walletOverviewCacheAt: 0,
        _walletOverviewPromise: null,
        isUnsafeDirectRechargeAllowed,

        async _getAccessToken() {
            const { data: { session } } = await supabase.auth.getSession();
            return session?.access_token || '';
        },

        async _getUserId() {
            if (this._cachedUserId) return this._cachedUserId;
            const { data: { session } } = await supabase.auth.getSession();
            this._cachedUserId = session?.user?.id || null;
            return this._cachedUserId;
        },

        async _fetchWalletJson(path, query = {}) {
            return this._requestWalletJson(path, {
                method: 'GET',
                query
            });
        },

        async _postWalletJson(path, body = {}, query = {}) {
            return this._requestWalletJson(path, {
                method: 'POST',
                query,
                body
            });
        },

        async _requestWalletJson(path, { method = 'GET', query = {}, body = null } = {}) {
            const token = await this._getAccessToken();
            if (!token) throw new Error('请先登录');

            const params = new URLSearchParams();
            Object.entries(query || {}).forEach(([key, value]) => {
                if (value === null || value === undefined || value === '') return;
                params.set(key, String(value));
            });

            const response = await fetch(`${path}${params.toString() ? `?${params.toString()}` : ''}`, {
                method,
                headers: {
                    ...(body ? { 'Content-Type': 'application/json' } : {}),
                    Authorization: `Bearer ${token}`
                },
                ...(body ? { body: JSON.stringify(body) } : {})
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || payload?.success === false) {
                throw new Error(payload?.message || '钱包数据加载失败');
            }
            return payload;
        },

        async _getWalletOverview({ historyLimit = 20, force = false } = {}) {
            const normalizedLimit = Math.max(1, Math.min(100, Number(historyLimit || 20) || 20));
            const now = Date.now();
            if (
                !force
                && this._walletOverviewCache
                && this._walletOverviewCacheLimit >= normalizedLimit
                && (now - this._walletOverviewCacheAt) < 10_000
            ) {
                return this._walletOverviewCache;
            }

            if (!force && this._walletOverviewPromise) {
                return this._walletOverviewPromise;
            }

            this._walletOverviewPromise = this._fetchWalletJson('/api/wallet/overview', {
                site: window.SiteConfig?.site || 'cn',
                history_limit: normalizedLimit
            }).then((payload) => {
                this._walletOverviewCache = payload;
                this._walletOverviewCacheLimit = normalizedLimit;
                this._walletOverviewCacheAt = Date.now();
                return payload;
            }).finally(() => {
                this._walletOverviewPromise = null;
            });

            return this._walletOverviewPromise;
        },

        async createPaymentRequest(payload = {}) {
            const token = await this._getAccessToken();
            if (!token) throw new Error('请先登录');

            const response = await fetch('/api/payments/create', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({
                    ...payload,
                    site: payload.site || window.SiteConfig?.site || 'cn'
                })
            });

            const responsePayload = await response.json().catch(() => ({}));
            if (!response.ok || responsePayload?.success === false) {
                throw new Error(responsePayload?.message || '创建支付请求失败');
            }

            return responsePayload;
        },

        async getPaymentRequestStatus(payload = {}) {
            const checkoutSessionId = String(payload?.checkout_session_id || '').trim();
            if (!checkoutSessionId) {
                throw new Error('缺少支付会话');
            }

            return this._postWalletJson('/api/payments/status', {
                checkout_session_id: checkoutSessionId,
                provider_order_no: String(payload?.provider_order_no || '').trim() || undefined,
                site: payload.site || window.SiteConfig?.site || 'cn'
            });
        },

        /**
         * Get user's current balance
         */
        async getBalance() {
            try {
                const userId = await this._getUserId();
                if (!userId) {
                    return {
                        paid_balance: 0,
                        bonus_balance: 0,
                        total_balance: 0,
                        site: window.SiteConfig?.site || 'cn',
                        current_site_has_account: false,
                        other_site_balances: [],
                        _load_failed: true,
                        error_message: '当前登录态尚未恢复'
                    };
                }

                const overview = await this._getWalletOverview({ historyLimit: 20 });
                const data = overview?.balance || {};

                return {
                    paid_balance: normalizePointValue(data.paid_balance),
                    bonus_balance: normalizePointValue(data.bonus_balance),
                    total_balance: normalizePointValue(data.total_balance),
                    site: overview?.site || window.SiteConfig?.site || 'cn',
                    current_site_has_account: overview?.current_site_has_account === true,
                    other_site_balances: Array.isArray(overview?.other_site_balances)
                        ? overview.other_site_balances.map((item) => ({
                            site: String(item?.site || '').trim().toLowerCase(),
                            paid_balance: normalizePointValue(item?.paid_balance),
                            bonus_balance: normalizePointValue(item?.bonus_balance),
                            total_balance: normalizePointValue(item?.total_balance)
                        }))
                        : [],
                    _load_failed: false,
                    error_message: ''
                };
            } catch (e) {
                console.error('[PointsService] Exception in getBalance:', e);
                return {
                    paid_balance: 0,
                    bonus_balance: 0,
                    total_balance: 0,
                    site: window.SiteConfig?.site || 'cn',
                    current_site_has_account: false,
                    other_site_balances: [],
                    _load_failed: true,
                    error_message: e?.message || '钱包余额加载失败'
                };
            }
        },

        /**
         * Get transaction history
         */
        async getHistory(limit = 20) {
            try {
                const overview = await this._getWalletOverview({ historyLimit: limit });
                const history = Array.isArray(overview?.recent_history) ? overview.recent_history : [];
                return history.map((item) => ({
                    ...item,
                    amount: normalizePointValue(item.amount)
                }));
            } catch (e) {
                console.error('[PointsService] Exception in getHistory:', e);
                return [];
            }
        },

        async getWalletTransactions(options = {}) {
            try {
                const payload = await this._fetchWalletJson('/api/wallet/transactions', {
                    site: options.site || window.SiteConfig?.site || 'cn',
                    q: String(options.query || '').trim(),
                    limit: options.limit || 100,
                    search_limit: options.searchLimit || 80
                });

                return {
                    shopOrders: Array.isArray(payload?.shop_orders) ? payload.shop_orders : [],
                    ledgerEntries: Array.isArray(payload?.ledger_entries)
                        ? payload.ledger_entries.map((entry) => ({
                            ...entry,
                            amount: normalizePointValue(entry.amount)
                        }))
                        : [],
                    promptTitles: payload?.prompt_titles && typeof payload.prompt_titles === 'object'
                        ? payload.prompt_titles
                        : {}
                };
            } catch (e) {
                console.error('[PointsService] Exception in getWalletTransactions:', e);
                return {
                    shopOrders: [],
                    ledgerEntries: [],
                    promptTitles: {}
                };
            }
        },

        async getWalletPromptTitles(ids = [], options = {}) {
            try {
                const normalizedIds = [...new Set(
                    (Array.isArray(ids) ? ids : [])
                        .map((item) => String(item || '').trim())
                        .filter(Boolean)
                )];
                if (!normalizedIds.length) {
                    return {};
                }

                const payload = await this._postWalletJson('/api/wallet/prompt-titles', {
                    site: options.site || window.SiteConfig?.site || 'cn',
                    ids: normalizedIds
                });

                return payload?.prompt_titles && typeof payload.prompt_titles === 'object'
                    ? payload.prompt_titles
                    : {};
            } catch (e) {
                console.error('[PointsService] Exception in getWalletPromptTitles:', e);
                return {};
            }
        },

        async getWalletVerifyLog(options = {}) {
            try {
                const payload = await this._postWalletJson('/api/wallet/verify-log', {
                    site: options.site || window.SiteConfig?.site || 'cn',
                    order_id: options.orderId || '',
                    reference_id: options.referenceId || '',
                    created_at: options.createdAt || '',
                    points_paid: options.pointsPaid ?? 0,
                    reason: options.reason || ''
                });

                return payload?.verify_log || null;
            } catch (e) {
                console.error('[PointsService] Exception in getWalletVerifyLog:', e);
                return null;
            }
        },

        /**
         * Get available packages
         */
        async getPackages() {
            try {
                const { data, error } = await supabase
                    .from('points_packages')
                    .select('*')
                    .eq('is_active', true)
                    .order('sort_order', { ascending: true });

                if (error) {
                    console.error('[PointsService] Error fetching packages:', error);
                    return [];
                }
                return (data || []).map((pkg) => ({
                    ...pkg,
                    points_amount: normalizePointValue(pkg.points_amount),
                    bonus_points: normalizePointValue(pkg.bonus_points)
                }));
            } catch (e) {
                console.error('[PointsService] Exception in getPackages:', e);
                return [];
            }
        },

        /**
         * Mock payment - accepts optional package data to skip DB fetch
         */
        async mockPay(packageId, packageData, options = {}) {
            if (!isSimulatedPaymentAllowed(options)) {
                throw new Error('当前未开启模拟支付，请使用真实支付流程');
            }
            return this.createPaymentRequest({
                provider_key: 'mock',
                package_id: packageId,
                order_no: `MOCK_PKG_${Date.now()}_${Math.random().toString(16).slice(2, 8).toUpperCase()}`,
                package_name: packageData?.name || ''
            });
        },

        /**
         * Custom recharge points
         */
        async customRecharge(pointsAmount, options = {}) {
            if (!isSimulatedPaymentAllowed(options)) {
                throw new Error('当前未开启模拟支付，请使用真实支付流程');
            }

            const normalizedAmount = normalizePointValue(pointsAmount);
            if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
                throw new Error('请输入大于 0 的充值积分');
            }

            const payload = await this.createPaymentRequest({
                provider_key: 'mock',
                points_amount: normalizedAmount,
                order_no: `MOCK_CUSTOM_${Date.now()}_${Math.random().toString(16).slice(2, 8).toUpperCase()}`,
                site: window.SiteConfig?.site || 'cn'
            });

            return {
                ...payload,
                amount: normalizedAmount
            };
        }
    };

    // Export to window
    window.PointsService = PointsService;
    console.log('[PointsService] ✅ Ready');
})();
