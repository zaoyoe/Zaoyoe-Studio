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

    const PointsService = {
        // Cached session to avoid redundant getSession() calls
        _cachedUserId: null,

        async _getUserId() {
            if (this._cachedUserId) return this._cachedUserId;
            const { data: { session } } = await supabase.auth.getSession();
            this._cachedUserId = session?.user?.id || null;
            return this._cachedUserId;
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
        async mockPay(packageId, packageData) {
            const userId = await this._getUserId();
            if (!userId) throw new Error('请先登录');

            // Use passed package data or fetch from DB
            let pkg = packageData;
            if (!pkg) {
                const { data, error } = await supabase
                    .from('points_packages')
                    .select('*')
                    .eq('id', packageId)
                    .single();
                if (error || !data) throw new Error('套餐不存在');
                pkg = data;
            }

            // Single RPC call — the only real network request
            const { error: rpcError } = await supabase.rpc('fn_recharge_points', {
                target_user_id: userId,
                p_paid: pkg.points_amount,
                p_bonus: pkg.bonus_points || 0,
                p_reason: `模拟充值: ${pkg.name}`,
                p_reference_id: `mock_${pkg.id}_${Date.now()}`,
                p_site: window.SiteConfig?.site || 'cn'
            });

            if (rpcError) throw rpcError;
            return { success: true };
        },

        /**
         * Custom recharge points
         */
        async customRecharge(pointsAmount) {
            const userId = await this._getUserId();
            if (!userId) throw new Error('请先登录');

            const normalizedAmount = normalizePointValue(pointsAmount);
            if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
                throw new Error('请输入大于 0 的充值积分');
            }

            const { error: rpcError } = await supabase.rpc('fn_recharge_points', {
                target_user_id: userId,
                p_paid: normalizedAmount,
                p_bonus: 0,
                p_reason: 'custom_recharge',
                p_reference_id: `custom_recharge_${Date.now()}`,
                p_site: window.SiteConfig?.site || 'cn'
            });

            if (rpcError) throw rpcError;
            return { success: true, amount: normalizedAmount };
        }
    };

    // Export to window
    window.PointsService = PointsService;
    console.log('[PointsService] ✅ Ready');
})();
