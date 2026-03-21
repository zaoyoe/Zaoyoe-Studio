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
        return Number.isFinite(parsed) ? Math.round(parsed * 10) / 10 : fallback;
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

        /**
         * Get user's current balance
         */
        async getBalance() {
            try {
                const userId = await this._getUserId();
                if (!userId) {
                    return { paid_balance: 0, bonus_balance: 0, total_balance: 0 };
                }

                const { data, error } = await supabase
                    .from('points_balance')
                    .select('paid_balance, bonus_balance, total_balance')
                    .eq('user_id', userId)
                    .eq('site', window.SiteConfig?.site || 'cn')
                    .maybeSingle();

                if (error) {
                    console.error('[PointsService] Error fetching balance:', error);
                    return { paid_balance: 0, bonus_balance: 0, total_balance: 0 };
                }

                if (!data) {
                    return { paid_balance: 0, bonus_balance: 0, total_balance: 0 };
                }

                return {
                    paid_balance: normalizePointValue(data.paid_balance),
                    bonus_balance: normalizePointValue(data.bonus_balance),
                    total_balance: normalizePointValue(data.total_balance)
                };
            } catch (e) {
                console.error('[PointsService] Exception in getBalance:', e);
                return { paid_balance: 0, bonus_balance: 0, total_balance: 0 };
            }
        },

        /**
         * Get transaction history
         */
        async getHistory(limit = 20) {
            try {
                const { data, error } = await supabase
                    .from('points_ledger')
                    .select('*')
                    .eq('site', window.SiteConfig?.site || 'cn')
                    .eq('is_visible', true) // Only show visible records
                    .order('created_at', { ascending: false })
                    .limit(limit);

                if (error) {
                    console.error('[PointsService] Error fetching history:', error);
                    return [];
                }
                return (data || []).map((item) => ({
                    ...item,
                    amount: normalizePointValue(item.amount)
                }));
            } catch (e) {
                console.error('[PointsService] Exception in getHistory:', e);
                return [];
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
