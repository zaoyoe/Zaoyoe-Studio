const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

test('standalone Supabase helper SQL files stay aligned with hardened site-aware signatures', () => {
    const balanceSql = readRepoFile(path.join('supabase', 'fn_get_user_balance.sql'));
    const rechargeSql = readRepoFile(path.join('supabase', 'fn_recharge_points.sql'));
    const reclaimSql = readRepoFile(path.join('supabase', 'fn_admin_deduct_points_site_with_breakdown.sql'));
    const redeemSql = readRepoFile(path.join('supabase', 'fn_redeem_code_v2.sql'));
    const customCodesSql = readRepoFile(path.join('supabase', 'fn_generate_custom_codes.sql'));

    assert.match(
        balanceSql,
        /CREATE OR REPLACE FUNCTION public\.fn_get_user_balance\(\s*p_user_id UUID DEFAULT NULL,\s*p_site VARCHAR DEFAULT 'cn'/s,
        'fn_get_user_balance helper should expose the hardened site-aware signature'
    );
    assert.doesNotMatch(
        balanceSql,
        /GRANT EXECUTE ON FUNCTION fn_get_user_balance\(UUID\) TO authenticated, service_role;/,
        'fn_get_user_balance helper must not re-grant the legacy single-argument overload'
    );

    assert.match(
        rechargeSql,
        /CREATE OR REPLACE FUNCTION public\.fn_recharge_points\(\s*target_user_id UUID,\s*p_paid NUMERIC\(12,2\),\s*p_bonus NUMERIC\(12,2\),\s*p_reason TEXT,\s*p_reference_id TEXT,\s*p_site VARCHAR DEFAULT 'cn'/s,
        'fn_recharge_points helper should preserve the site-aware overload'
    );
    assert.match(
        reclaimSql,
        /CREATE OR REPLACE FUNCTION public\.fn_deduct_points_admin_site_with_breakdown\(\s*p_target_user_id UUID,\s*p_amount INT,\s*p_reason TEXT DEFAULT 'Admin Deduction',\s*p_reference_id TEXT DEFAULT NULL,\s*p_site VARCHAR DEFAULT 'cn'/s,
        'refund reclaim helper should expose the site-aware breakdown signature'
    );
    assert.match(
        reclaimSql,
        /GRANT EXECUTE ON FUNCTION public\.fn_deduct_points_admin_site_with_breakdown\(UUID, INT, TEXT, TEXT, VARCHAR\) TO service_role;/,
        'refund reclaim helper should stay restricted to service_role'
    );

    assert.match(
        redeemSql,
        /CREATE OR REPLACE FUNCTION public\.fn_redeem_code\(\s*p_code VARCHAR,\s*p_site VARCHAR DEFAULT 'cn'/s,
        'fn_redeem_code helper should only define the site-aware overload'
    );
    assert.match(
        redeemSql,
        /DROP FUNCTION IF EXISTS public\.fn_redeem_code\(VARCHAR\);/,
        'fn_redeem_code helper should remove the legacy single-argument overload'
    );
    assert.match(
        redeemSql,
        /GRANT EXECUTE ON FUNCTION public\.fn_redeem_code\(VARCHAR, VARCHAR\) TO authenticated;/,
        'fn_redeem_code helper should only grant authenticated callers access to the site-aware overload'
    );

    assert.match(
        customCodesSql,
        /CREATE OR REPLACE FUNCTION public\.fn_generate_custom_codes\(\s*p_batch_name TEXT,\s*p_points_amount NUMERIC\(12,2\),\s*p_count INTEGER,\s*p_channel TEXT DEFAULT 'manual',\s*p_expires_at TIMESTAMPTZ DEFAULT NULL,\s*p_site VARCHAR DEFAULT 'cn'/s,
        'fn_generate_custom_codes helper should expose the hardened site-aware signature'
    );
    assert.match(
        customCodesSql,
        /CREATE OR REPLACE FUNCTION public\.fn_generate_custom_codes\(\s*p_batch_name TEXT,\s*p_points_amount NUMERIC\(12,2\),\s*p_count INTEGER,\s*p_channel TEXT DEFAULT 'manual',\s*p_expires_at TIMESTAMPTZ DEFAULT NULL\s*\)/s,
        'fn_generate_custom_codes helper should keep the legacy wrapper only as a delegator'
    );
});

test('database migrations retire the legacy redemption overload and formalize the new guardrails', () => {
    const migrationSql = readRepoFile(path.join('supabase', 'migrations', '20260322_retire_legacy_redemption_overloads.sql'));
    const verificationSql = readRepoFile(path.join('supabase', 'verify_payment_redemption_hardening.sql'));
    const paymentCreationSql = readRepoFile(path.join('supabase', 'migrations', '20260322_harden_payment_creation_entrypoints.sql'));
    const paymentSiteSql = readRepoFile(path.join('supabase', 'migrations', '20260322_constrain_payment_sites.sql'));
    const rateLimitSql = readRepoFile(path.join('supabase', 'migrations', '20260324_add_persistent_rate_limits.sql'));
    const refundReclaimSql = readRepoFile(path.join('supabase', 'migrations', '20260324_add_admin_refund_reclaim_rpc.sql'));
    const notificationScopeSql = readRepoFile(path.join('supabase', 'migrations', '20260330_add_system_notification_scopes.sql'));
    const adminExtensionsSql = readRepoFile(path.join('supabase', 'admin_extensions.sql'));

    assert.match(
        migrationSql,
        /CREATE OR REPLACE FUNCTION public\.fn_redeem_code\(\s*p_code VARCHAR,\s*p_site VARCHAR DEFAULT 'cn'/s,
        'retirement migration should define the site-aware redemption RPC'
    );
    assert.match(
        migrationSql,
        /DROP FUNCTION IF EXISTS public\.fn_redeem_code\(VARCHAR\);/,
        'retirement migration should drop the legacy redemption overload'
    );
    assert.match(
        migrationSql,
        /REVOKE ALL ON FUNCTION public\.fn_redeem_code\(VARCHAR, VARCHAR\) FROM PUBLIC;/,
        'retirement migration should remove PUBLIC execute from fn_redeem_code'
    );
    assert.match(
        migrationSql,
        /GRANT EXECUTE ON FUNCTION public\.fn_redeem_code\(VARCHAR, VARCHAR\) TO authenticated;/,
        'retirement migration should re-grant fn_redeem_code only to authenticated callers'
    );
    assert.match(
        migrationSql,
        /DROP FUNCTION IF EXISTS public\.fn_get_user_balance\(UUID\);/,
        'retirement migration should remain idempotent against old balance overloads'
    );
    assert.match(
        verificationSql,
        /public\.fn_redeem_code\(character varying\)/,
        'verification SQL should explicitly check that the legacy single-argument redemption overload is gone'
    );
    assert.match(
        verificationSql,
        /public\.fn_redeem_code\(character varying,character varying\)/,
        'verification SQL should explicitly check the site-aware redemption overload'
    );
    assert.match(
        verificationSql,
        /public\.fn_get_user_balance\(uuid\)/,
        'verification SQL should explicitly check that the old single-argument balance overload is gone'
    );
    assert.match(
        verificationSql,
        /public\.fn_get_user_balance\(uuid,character varying\)/,
        'verification SQL should explicitly check the site-aware balance overload'
    );
    assert.match(
        paymentCreationSql,
        /ALTER TABLE IF EXISTS public\.payment_orders ENABLE ROW LEVEL SECURITY;/,
        'payment creation hardening should enable RLS on payment_orders'
    );
    assert.match(
        paymentCreationSql,
        /CREATE POLICY "Users view own payment orders"/,
        'payment creation hardening should scope payment order reads to the owner'
    );
    assert.match(
        paymentCreationSql,
        /CREATE OR REPLACE FUNCTION public\.fn_create_payment_checkout_session\(/,
        'payment creation hardening should define a user-bound checkout session creation RPC'
    );
    assert.match(
        paymentCreationSql,
        /CREATE OR REPLACE FUNCTION public\.fn_update_payment_checkout_session\(/,
        'payment creation hardening should define a user-bound checkout session update RPC'
    );
    assert.match(
        paymentCreationSql,
        /CREATE OR REPLACE FUNCTION public\.fn_create_pending_payment_order_for_checkout_session\(/,
        'payment creation hardening should define a user-bound pending payment order RPC'
    );
    assert.match(
        paymentSiteSql,
        /payment_checkout_sessions contains unsupported site values/,
        'payment site guardrail should fail the migration if legacy checkout sessions still carry unknown site values'
    );
    assert.match(
        paymentSiteSql,
        /ADD CONSTRAINT payment_checkout_sessions_site_check\s+CHECK \(site IN \('cn', 'intl'\)\);/s,
        'payment site guardrail should constrain checkout sessions to the supported site set'
    );
    assert.match(
        paymentSiteSql,
        /ADD CONSTRAINT payment_orders_site_check\s+CHECK \(site IN \('cn', 'intl'\)\);/s,
        'payment site guardrail should constrain payment orders to the supported site set'
    );
    assert.match(
        rateLimitSql,
        /CREATE TABLE IF NOT EXISTS public\.rate_limit_buckets\s*\(/s,
        'persistent rate limit migration should create the shared bucket table'
    );
    assert.match(
        rateLimitSql,
        /CREATE OR REPLACE FUNCTION public\.take_rate_limit_token\(/,
        'persistent rate limit migration should define the shared limiter RPC'
    );
    assert.match(
        rateLimitSql,
        /GRANT EXECUTE ON FUNCTION public\.take_rate_limit_token\(TEXT, INTEGER, INTEGER, TIMESTAMPTZ\) TO service_role;/,
        'persistent rate limit migration should keep limiter execution restricted to service_role'
    );
    assert.match(
        refundReclaimSql,
        /CREATE OR REPLACE FUNCTION public\.fn_deduct_points_admin_site_with_breakdown\(/,
        'refund reclaim migration should define the explicit paid\/bonus breakdown RPC'
    );
    assert.match(
        refundReclaimSql,
        /'deducted_paid', deduct_from_paid/s,
        'refund reclaim migration should return the exact paid deduction split'
    );
    assert.match(
        refundReclaimSql,
        /'deducted_bonus', deduct_from_bonus/s,
        'refund reclaim migration should return the exact bonus deduction split'
    );
    assert.match(
        refundReclaimSql,
        /GRANT EXECUTE ON FUNCTION public\.fn_deduct_points_admin_site_with_breakdown\(UUID, INT, TEXT, TEXT, VARCHAR\) TO service_role;/,
        'refund reclaim migration should keep execution restricted to service_role'
    );
    assert.match(
        notificationScopeSql,
        /ADD COLUMN IF NOT EXISTS scope TEXT DEFAULT 'unspecified'/,
        'system notification scope migration should add a compatible scope column'
    );
    assert.match(
        notificationScopeSql,
        /ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'general'/,
        'system notification scope migration should add a category column for message routing'
    );
    assert.match(
        notificationScopeSql,
        /CHECK \(scope IN \('unspecified', 'user_personal', 'admin_personal'\)\)/,
        'system notification scope migration should constrain scope values'
    );
    assert.match(
        notificationScopeSql,
        /CREATE INDEX IF NOT EXISTS idx_system_notifications_user_scope_created_at/s,
        'system notification scope migration should add a scoped lookup index'
    );
    assert.match(
        adminExtensionsSql,
        /scope text default 'unspecified' not null check \(scope in \('unspecified', 'user_personal', 'admin_personal'\)\)/,
        'bootstrap admin extensions SQL should keep the scoped notification schema'
    );
    assert.match(
        adminExtensionsSql,
        /category text default 'general' not null/,
        'bootstrap admin extensions SQL should keep the notification category column'
    );
});

test('analytics site attribution migration formalizes first-site new-user and retention semantics', () => {
    const migrationSql = readRepoFile(path.join('supabase', 'migrations', '20260405_admin_analytics_site_attribution_alignment.sql'));

    assert.match(
        migrationSql,
        /CREATE OR REPLACE FUNCTION get_overview_stats\(p_site VARCHAR DEFAULT NULL\)/,
        'analytics site attribution migration should redefine overview stats'
    );
    assert.match(
        migrationSql,
        /'site_attribution_model', 'first_site_activity'/,
        'analytics site attribution migration should publish the first-site attribution model in overview payloads'
    );
    assert.match(
        migrationSql,
        /CREATE OR REPLACE FUNCTION get_user_trend\(/,
        'analytics site attribution migration should redefine the user trend RPC'
    );
    assert.match(
        migrationSql,
        /COUNT\(\*\) FILTER \(WHERE attributed_site = p_site\)::INTEGER/,
        'analytics site attribution migration should scope site new-user counts through attributed users'
    );
    assert.match(
        migrationSql,
        /CREATE OR REPLACE FUNCTION get_retention_cohort\(p_weeks INTEGER DEFAULT 8, p_site VARCHAR DEFAULT NULL\)/,
        'analytics site attribution migration should redefine the retention cohort RPC'
    );
    assert.match(
        migrationSql,
        /WHERE p_site IS NULL OR ac\.attributed_site = p_site/,
        'analytics site attribution migration should filter retention cohorts through the attributed site'
    );
    assert.match(
        migrationSql,
        /GRANT EXECUTE ON FUNCTION get_retention_cohort\(INTEGER, VARCHAR\) TO authenticated;/,
        'analytics site attribution migration should preserve retention cohort grants'
    );
});

test('analytics business-active migration promotes effective events while preserving login references', () => {
    const migrationSql = readRepoFile(path.join('supabase', 'migrations', '20260405_admin_analytics_business_active_alignment.sql'));

    assert.match(
        migrationSql,
        /'active_users_scope', 'business_event'/,
        'analytics business-active migration should expose business-event semantics in overview payloads'
    );
    assert.match(
        migrationSql,
        /'active_users_model', 'effective_business_event'/,
        'analytics business-active migration should describe the effective business-event model'
    );
    assert.match(
        migrationSql,
        /'login_dau', COALESCE\(v_login_dau, 0\)/,
        'analytics business-active migration should preserve login dau as a reference field'
    );
    assert.match(
        migrationSql,
        /DROP FUNCTION IF EXISTS get_user_trend\(INTEGER, VARCHAR, DATE, DATE\);/,
        'analytics business-active migration should drop the prior user trend signature before changing the return shape'
    );
    assert.match(
        migrationSql,
        /login_active_users INTEGER/,
        'analytics business-active migration should expose login_active_users in the user trend return shape'
    );
    assert.match(
        migrationSql,
        /COUNT\(DISTINCT user_id\) FILTER \(WHERE event_name <> 'page_view'\) AS business_active_users/,
        'analytics business-active migration should exclude bare page views from business-active rollups'
    );
    assert.match(
        migrationSql,
        /'login_dau_growth'/,
        'analytics business-active migration should preserve login dau growth as a reference metric'
    );
});

test('analytics range migration materializes explicit start and end date signatures', () => {
    const migrationSql = readRepoFile(path.join('supabase', 'migrations', '20260405_admin_analytics_explicit_range_dates.sql'));

    const markers = [
        'CREATE OR REPLACE FUNCTION get_user_trend(',
        'CREATE OR REPLACE FUNCTION get_content_trend(',
        'CREATE OR REPLACE FUNCTION get_revenue_trend(',
        'CREATE OR REPLACE FUNCTION get_content_top(',
        'CREATE OR REPLACE FUNCTION get_content_top_v2(',
        'CREATE OR REPLACE FUNCTION get_community_stats(',
        'CREATE OR REPLACE FUNCTION get_activity_heatmap(',
        'CREATE OR REPLACE FUNCTION get_conversion_funnel(',
        'CREATE OR REPLACE FUNCTION get_conversion_funnel_v2(',
        'CREATE OR REPLACE FUNCTION get_points_flow(',
        'CREATE OR REPLACE FUNCTION get_points_flow_v2(',
        'CREATE OR REPLACE FUNCTION get_redemption_funnel(',
        'CREATE OR REPLACE FUNCTION get_channel_breakdown(',
        'CREATE OR REPLACE FUNCTION get_channel_breakdown_v2(',
        'CREATE OR REPLACE FUNCTION get_ai_summary_data(',
        'CREATE OR REPLACE FUNCTION get_ai_summary_data_v2(',
        'p_start_date DATE DEFAULT NULL',
        'p_end_date DATE DEFAULT NULL',
        'BETWEEN v_start_date AND v_end_date',
        'GRANT EXECUTE ON FUNCTION get_ai_summary_data_v2(INTEGER, VARCHAR, DATE, DATE) TO authenticated;'
    ];

    for (const marker of markers) {
        assert.equal(
            migrationSql.includes(marker),
            true,
            `analytics explicit range migration should contain ${marker}`
        );
    }
});

test('analytics proxy metric migration materializes explicit metadata for login-based panels', () => {
    const migrationSql = readRepoFile(path.join('supabase', 'migrations', '20260405_admin_analytics_proxy_metric_annotations.sql'));

    const markers = [
        'DROP FUNCTION IF EXISTS get_activity_heatmap(INTEGER, VARCHAR, DATE, DATE);',
        'DROP FUNCTION IF EXISTS get_retention_cohort(INTEGER, VARCHAR);',
        'is_proxy_metric BOOLEAN',
        'metric_basis TEXT',
        'metric_label TEXT',
        "'login_history'::TEXT AS metric_basis",
        "'登录活跃代理口径'::TEXT AS metric_label",
        "'site_attributed_cohort_login_activity'::TEXT AS metric_basis",
        "'首站点归因 cohort + 登录回访代理口径'::TEXT AS metric_label",
        'GRANT EXECUTE ON FUNCTION get_activity_heatmap(INTEGER, VARCHAR, DATE, DATE) TO authenticated;',
        'GRANT EXECUTE ON FUNCTION get_retention_cohort(INTEGER, VARCHAR) TO authenticated;'
    ];

    for (const marker of markers) {
        assert.equal(
            migrationSql.includes(marker),
            true,
            `analytics proxy metric migration should contain ${marker}`
        );
    }
});

test('analytics heatmap migration promotes real business events before login fallback', () => {
    const migrationSql = readRepoFile(path.join('supabase', 'migrations', '20260405_admin_analytics_heatmap_business_event_alignment.sql'));

    const markers = [
        'DROP FUNCTION IF EXISTS get_activity_heatmap(INTEGER, VARCHAR, DATE, DATE);',
        'v_has_business_events BOOLEAN := FALSE;',
        'FROM public.user_events ue',
        "'effective_business_event_heatmap'::TEXT AS metric_basis",
        "'真实业务事件热度'::TEXT AS metric_label",
        "'login_history'::TEXT AS metric_basis",
        "'登录活跃代理口径'::TEXT AS metric_label",
        'GRANT EXECUTE ON FUNCTION get_activity_heatmap(INTEGER, VARCHAR, DATE, DATE) TO authenticated;'
    ];

    for (const marker of markers) {
        assert.equal(
            migrationSql.includes(marker),
            true,
            `analytics heatmap business-event migration should contain ${marker}`
        );
    }
});

test('analytics heatmap cleanup migration removes the legacy login fallback path', () => {
    const migrationSql = readRepoFile(path.join('supabase', 'migrations', '20260405_admin_analytics_heatmap_remove_login_fallback.sql'));

    const markers = [
        'DROP FUNCTION IF EXISTS get_activity_heatmap(INTEGER, VARCHAR, DATE, DATE);',
        'FROM public.user_events ue',
        "'effective_business_event_heatmap'::TEXT AS metric_basis",
        "'真实业务事件热度'::TEXT AS metric_label",
        'GRANT EXECUTE ON FUNCTION get_activity_heatmap(INTEGER, VARCHAR, DATE, DATE) TO authenticated;'
    ];

    for (const marker of markers) {
        assert.equal(
            migrationSql.includes(marker),
            true,
            `analytics heatmap cleanup migration should contain ${marker}`
        );
    }

    assert.equal(
        migrationSql.includes("'login_history'::TEXT AS metric_basis"),
        false,
        'analytics heatmap cleanup migration should remove the login-history fallback basis'
    );
    assert.equal(
        migrationSql.includes('FROM public.user_login_history'),
        false,
        'analytics heatmap cleanup migration should no longer query user_login_history'
    );
});

test('analytics retention migration promotes real business activity before login fallback', () => {
    const migrationSql = readRepoFile(path.join('supabase', 'migrations', '20260405_admin_analytics_retention_business_activity_alignment.sql'));

    const markers = [
        'DROP FUNCTION IF EXISTS get_retention_cohort(INTEGER, VARCHAR, DATE, DATE);',
        'p_start_date DATE DEFAULT NULL',
        'p_end_date DATE DEFAULT NULL',
        'v_has_business_events BOOLEAN := FALSE;',
        'FROM public.user_events ue',
        'site_attributed_cohort_effective_business_activity',
        '首站点归因 cohort + 真实业务回访',
        'site_attributed_cohort_login_activity',
        '首站点归因 cohort + 登录回访代理口径',
        'GRANT EXECUTE ON FUNCTION get_retention_cohort(INTEGER, VARCHAR, DATE, DATE) TO authenticated;'
    ];

    for (const marker of markers) {
        assert.equal(
            migrationSql.includes(marker),
            true,
            `analytics retention business-activity migration should contain ${marker}`
        );
    }
});

test('analytics retention cleanup migration removes the legacy login fallback path', () => {
    const migrationSql = readRepoFile(path.join('supabase', 'migrations', '20260405_admin_analytics_retention_remove_login_fallback.sql'));

    const markers = [
        'DROP FUNCTION IF EXISTS get_retention_cohort(INTEGER, VARCHAR, DATE, DATE);',
        'FROM public.user_events ue',
        'site_attributed_cohort_effective_business_activity',
        '首站点归因 cohort + 真实业务回访',
        'GRANT EXECUTE ON FUNCTION get_retention_cohort(INTEGER, VARCHAR, DATE, DATE) TO authenticated;'
    ];

    for (const marker of markers) {
        assert.equal(
            migrationSql.includes(marker),
            true,
            `analytics retention cleanup migration should contain ${marker}`
        );
    }

    assert.equal(
        migrationSql.includes('site_attributed_cohort_login_activity'),
        false,
        'analytics retention cleanup migration should remove the login-activity fallback basis'
    );
    assert.equal(
        migrationSql.includes('v_has_business_events BOOLEAN := FALSE;'),
        false,
        'analytics retention cleanup migration should remove the business-vs-login fallback gate'
    );
    assert.equal(
        migrationSql.includes('WHERE NOT v_has_business_events'),
        false,
        'analytics retention cleanup migration should no longer switch retention activity to login history'
    );
});

test('analytics cleanup migration removes the legacy proxy conversion funnel overloads', () => {
    const migrationSql = readRepoFile(path.join('supabase', 'migrations', '20260405_admin_analytics_remove_legacy_conversion_funnel.sql'));

    const markers = [
        'REVOKE ALL ON FUNCTION public.get_conversion_funnel(INTEGER, VARCHAR, DATE, DATE) FROM PUBLIC;',
        'REVOKE ALL ON FUNCTION public.get_conversion_funnel(INTEGER, VARCHAR, DATE, DATE) FROM authenticated;',
        'DROP FUNCTION IF EXISTS public.get_conversion_funnel(INTEGER, VARCHAR, DATE, DATE);',
        'REVOKE ALL ON FUNCTION public.get_conversion_funnel(INTEGER, VARCHAR) FROM authenticated;',
        'DROP FUNCTION IF EXISTS public.get_conversion_funnel(INTEGER, VARCHAR);',
        'REVOKE ALL ON FUNCTION public.get_conversion_funnel(INTEGER) FROM authenticated;',
        'DROP FUNCTION IF EXISTS public.get_conversion_funnel(INTEGER);'
    ];

    for (const marker of markers) {
        assert.equal(
            migrationSql.includes(marker),
            true,
            `analytics legacy conversion cleanup migration should contain ${marker}`
        );
    }
});

test('analytics content top prompt id fix keeps prompt key selection disambiguated', () => {
    const rootSql = readRepoFile(path.join('supabase', 'analytics_site_filter.sql'));
    const migrationSql = readRepoFile(path.join('supabase', 'migrations', '20260405_admin_analytics_content_top_prompt_id_disambiguation.sql'));

    for (const source of [rootSql, migrationSql]) {
        assert.match(
            source,
            /SELECT per\.prompt_id AS prompt_id FROM prompt_event_rollup per/,
            'content top SQL should qualify prompt_event_rollup.prompt_id to avoid RETURNS TABLE ambiguity'
        );
        assert.match(
            source,
            /SELECT pcr\.prompt_id AS prompt_id FROM prompt_comment_rollup pcr/,
            'content top SQL should qualify prompt_comment_rollup.prompt_id to avoid RETURNS TABLE ambiguity'
        );
    }
});

test('root legacy SQL scripts no longer ship executable single-site payment or redemption entrypoints', () => {
    const rootCommercialSql = readRepoFile('commercial_points_functions.sql');
    const rootRedemptionSql = readRepoFile('redemption_functions.sql');
    const affiliateUpgradeSql = readRepoFile('6.5_affiliate_dashboard_upgrade.sql');
    const fixRedemptionSiteSql = readRepoFile(path.join('supabase', 'fix_redemption_site.sql'));
    const dualSiteFunctionsSql = readRepoFile(path.join('supabase', 'dual_site_functions.sql'));
    const afdianOrdersSql = readRepoFile(path.join('supabase', 'afdian_orders.sql'));

    assert.doesNotMatch(
        rootCommercialSql,
        /CREATE OR REPLACE FUNCTION fn_add_points\(/,
        'commercial_points_functions.sql should be a deprecated stub, not an executable fn_add_points source'
    );
    assert.doesNotMatch(
        rootCommercialSql,
        /CREATE OR REPLACE FUNCTION fn_deduct_points\(/,
        'commercial_points_functions.sql should be a deprecated stub, not an executable fn_deduct_points source'
    );

    assert.doesNotMatch(
        rootRedemptionSql,
        /CREATE OR REPLACE FUNCTION fn_redeem_code\(/,
        'redemption_functions.sql should not redefine the legacy redemption RPC'
    );
    assert.doesNotMatch(
        rootRedemptionSql,
        /GRANT EXECUTE ON FUNCTION fn_redeem_code\(VARCHAR\) TO authenticated;/,
        'redemption_functions.sql must not re-grant the legacy single-argument redemption overload'
    );

    assert.doesNotMatch(
        affiliateUpgradeSql,
        /CREATE OR REPLACE FUNCTION public\.fn_recharge_points\(/,
        '6.5_affiliate_dashboard_upgrade.sql should not redeclare points recharge RPCs'
    );

    assert.doesNotMatch(
        fixRedemptionSiteSql,
        /CREATE OR REPLACE FUNCTION fn_generate_codes\(/,
        'fix_redemption_site.sql should be a deprecated stub, not an executable fn_generate_codes source'
    );
    assert.doesNotMatch(
        fixRedemptionSiteSql,
        /CREATE OR REPLACE FUNCTION fn_generate_custom_codes\(/,
        'fix_redemption_site.sql should be a deprecated stub, not an executable fn_generate_custom_codes source'
    );

    assert.doesNotMatch(
        dualSiteFunctionsSql,
        /CREATE OR REPLACE FUNCTION fn_(purchase_shop_item|get_user_balance|recharge_points|add_points|deduct_points|redeem_code)\(/,
        'dual_site_functions.sql should be a deprecated stub, not an executable RPC bundle'
    );

    assert.doesNotMatch(
        afdianOrdersSql,
        /CREATE OR REPLACE FUNCTION public\.fn_(ensure_redemption_code_for_payment_order|apply_payment_order_review|process_afdian_payment|finalize_afdian_custom_payment)\(/,
        'afdian_orders.sql should be a deprecated stub, not an executable payment bundle'
    );
});

test('root legacy analytics SQL scripts are deprecated stubs instead of executable single-site entrypoints', () => {
    const analyticsRpcSql = readRepoFile(path.join('supabase', 'analytics_rpc.sql'));
    const analyticsTrendSql = readRepoFile(path.join('supabase', 'analytics_trend.sql'));
    const analyticsAdvancedSql = readRepoFile(path.join('supabase', 'analytics_advanced.sql'));

    for (const [label, source] of [
        ['analytics_rpc.sql', analyticsRpcSql],
        ['analytics_trend.sql', analyticsTrendSql],
        ['analytics_advanced.sql', analyticsAdvancedSql]
    ]) {
        assert.match(
            source,
            /Deprecated stub\./,
            `${label} should explicitly declare itself as a deprecated stub`
        );
        assert.match(
            source,
            /Do not add executable analytics/i,
            `${label} should warn against reintroducing executable analytics SQL`
        );
    }

    assert.doesNotMatch(
        analyticsRpcSql,
        /CREATE OR REPLACE FUNCTION get_(overview_stats|user_trend|content_trend|revenue_trend|channel_breakdown|activity_heatmap)\(/,
        'analytics_rpc.sql should not redefine executable legacy overview or chart RPCs'
    );
    assert.doesNotMatch(
        analyticsTrendSql,
        /CREATE OR REPLACE FUNCTION get_overview_stats_with_trend\(/,
        'analytics_trend.sql should not redefine the old overview trend RPC'
    );
    assert.doesNotMatch(
        analyticsAdvancedSql,
        /CREATE OR REPLACE FUNCTION (public\.)?(require_admin_access|get_retention_cohort|get_points_flow|get_geo_distribution|get_geo_distribution_by_site|get_conversion_funnel)\(/,
        'analytics_advanced.sql should not redefine executable advanced analytics RPCs'
    );
});

test('phase3 A/B analytics migrations are explicitly marked as historical optional paths', () => {
    const abResultsEventAlignmentSql = readRepoFile(path.join('supabase', 'migrations', '20260404_admin_analytics_phase3_ab_results_event_alignment.sql'));
    const abResultsDrilldownSql = readRepoFile(path.join('supabase', 'migrations', '20260404_admin_analytics_phase3_ab_results_drilldown_v2.sql'));
    const analyticsUpgradePlan = readRepoFile(path.join('docs', 'admin-studio-analytics-2-upgrade-plan.md'));

    assert.match(
        abResultsEventAlignmentSql,
        /Historical note:/,
        'phase3 A/B event-alignment migration should declare that it is historical-only context'
    );
    assert.match(
        abResultsEventAlignmentSql,
        /Daily admin analytics no longer exposes A\/B result surfaces/i,
        'phase3 A/B event-alignment migration should clarify that the daily admin path no longer exposes these results'
    );

    assert.match(
        abResultsDrilldownSql,
        /Historical note:/,
        'phase3 A/B drilldown migration should declare that it is historical-only context'
    );
    assert.match(
        abResultsDrilldownSql,
        /Daily admin analytics no longer exposes A\/B drilldown panels/i,
        'phase3 A/B drilldown migration should clarify that the daily admin path no longer exposes these panels'
    );

    assert.match(
        analyticsUpgradePlan,
        /experiment_id`（可选，仅在手动启用 experiment runtime 时上报）/,
        'analytics upgrade plan should mark experiment_id as optional and runtime-gated'
    );
    assert.match(
        analyticsUpgradePlan,
        /variant_id`（可选，仅在手动启用 experiment runtime 时上报）/,
        'analytics upgrade plan should mark variant_id as optional and runtime-gated'
    );
    assert.match(
        analyticsUpgradePlan,
        /可选：仅在手动启用 experiment runtime 时补 `A\/B experiment exposure \+ conversion`/,
        'analytics upgrade plan should demote A/B exposure work to an optional manual-runtime track'
    );
});

test('traffic runtime config migration promotes traffic_runtime as the canonical key while preserving legacy compatibility', () => {
    const migrationSql = readRepoFile(path.join('supabase', 'migrations', '20260405_admin_traffic_runtime_config_key_alignment.sql'));

    for (const marker of [
        "WHERE sc.config_key IN ('traffic_runtime', 'experiment_runtime')",
        "'traffic_runtime'",
        "'前台分流 runtime 开关'",
        "'experiment_runtime'",
        "'前台实验 runtime 开关（兼容旧键）'",
        'ON CONFLICT (config_key) DO UPDATE'
    ]) {
        assert.equal(
            migrationSql.includes(marker),
            true,
            `traffic runtime key-alignment migration should contain ${marker}`
        );
    }

    assert.match(
        migrationSql,
        /ORDER BY sc\.updated_at DESC NULLS LAST, sc\.config_key = 'traffic_runtime' DESC/,
        'traffic runtime key-alignment migration should prefer the newest traffic_runtime-compatible record'
    );
});
