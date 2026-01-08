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

    const PointsService = {
        /**
         * Get user's current balance
         */
        async getBalance() {
            try {
                // Use getSession() - cached, instant
                const { data: { session } } = await supabase.auth.getSession();
                if (!session?.user) {
                    console.warn('[PointsService] User not logged in');
                    return { paid_balance: 0, bonus_balance: 0, total_balance: 0 };
                }

                const { data, error } = await supabase
                    .from('points_balance')
                    .select('paid_balance, bonus_balance, total_balance')
                    .eq('user_id', session.user.id)
                    .maybeSingle();

                if (error) {
                    console.error('[PointsService] Error fetching balance:', error);
                    return { paid_balance: 0, bonus_balance: 0, total_balance: 0 };
                }

                // If no record exists, return zeros
                return data || { paid_balance: 0, bonus_balance: 0, total_balance: 0 };
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
                    .eq('is_visible', true) // Only show visible records
                    .order('created_at', { ascending: false })
                    .limit(limit);

                if (error) {
                    console.error('[PointsService] Error fetching history:', error);
                    return [];
                }
                return data || [];
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
                return data || [];
            } catch (e) {
                console.error('[PointsService] Exception in getPackages:', e);
                return [];
            }
        },

        /**
         * Mock payment (for testing)
         */
        async mockPay(packageId) {
            // Use getSession() - instant
            const { data: { session } } = await supabase.auth.getSession();
            if (!session?.user) throw new Error('请先登录');

            // Get package info
            const { data: pkg, error: pkgError } = await supabase
                .from('points_packages')
                .select('*')
                .eq('id', packageId)
                .single();

            if (pkgError || !pkg) throw new Error('套餐不存在');

            console.log(`[PointsService] 🔄 Mock paying for: ${pkg.name}`);

            // Simulate delay (reduced for better UX)
            await new Promise(r => setTimeout(r, 800));

            // Call RPC to recharge points (separating paid and bonus)
            const { error: rpcError } = await supabase.rpc('fn_recharge_points', {
                target_user_id: session.user.id,
                p_paid: pkg.points_amount,
                p_bonus: pkg.bonus_points || 0,
                p_reason: `模拟充值: ${pkg.name}`,
                p_reference_id: `mock_${pkg.id}_${Date.now()}`
            });

            if (rpcError) throw rpcError;

            console.log('[PointsService] ✅ Mock payment successful');
            return { success: true };
        }
    };

    // Export to window
    window.PointsService = PointsService;
    console.log('[PointsService] ✅ Ready');
})();
