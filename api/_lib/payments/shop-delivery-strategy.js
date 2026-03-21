const DEFAULT_SHOP_DELIVERY_STRATEGY = Object.freeze({
    max_attempts: 5,
    sweep_interval_ms: 10000,
    sweep_batch_size: 10,
    lease_seconds: 120,
    http_timeout_ms: 15000,
    base_backoff_seconds: 30,
    max_backoff_seconds: 1800
});

function sanitizeInteger(value, fallback, min, max) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
}

function normalizeShopDeliveryStrategyConfig(raw = {}, env = process.env) {
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const baseBackoffSeconds = sanitizeInteger(
        source.base_backoff_seconds,
        DEFAULT_SHOP_DELIVERY_STRATEGY.base_backoff_seconds,
        15,
        600
    );
    const maxBackoffSeconds = sanitizeInteger(
        source.max_backoff_seconds,
        sanitizeInteger(env.SHOP_DELIVERY_MAX_BACKOFF_SECONDS, DEFAULT_SHOP_DELIVERY_STRATEGY.max_backoff_seconds, 60, 86400),
        60,
        86400
    );

    return {
        max_attempts: sanitizeInteger(
            source.max_attempts,
            sanitizeInteger(env.SHOP_DELIVERY_MAX_ATTEMPTS, DEFAULT_SHOP_DELIVERY_STRATEGY.max_attempts, 1, 20),
            1,
            20
        ),
        sweep_interval_ms: sanitizeInteger(
            source.sweep_interval_ms,
            sanitizeInteger(env.SHOP_DELIVERY_SWEEP_INTERVAL_MS, DEFAULT_SHOP_DELIVERY_STRATEGY.sweep_interval_ms, 4000, 60000),
            4000,
            60000
        ),
        sweep_batch_size: sanitizeInteger(
            source.sweep_batch_size,
            sanitizeInteger(env.SHOP_DELIVERY_SWEEP_BATCH_SIZE, DEFAULT_SHOP_DELIVERY_STRATEGY.sweep_batch_size, 1, 50),
            1,
            50
        ),
        lease_seconds: sanitizeInteger(
            source.lease_seconds,
            sanitizeInteger(env.SHOP_DELIVERY_LEASE_SECONDS, DEFAULT_SHOP_DELIVERY_STRATEGY.lease_seconds, 30, 900),
            30,
            900
        ),
        http_timeout_ms: sanitizeInteger(
            source.http_timeout_ms,
            sanitizeInteger(env.SHOP_DELIVERY_HTTP_TIMEOUT_MS, DEFAULT_SHOP_DELIVERY_STRATEGY.http_timeout_ms, 3000, 60000),
            3000,
            60000
        ),
        base_backoff_seconds: baseBackoffSeconds,
        max_backoff_seconds: Math.max(baseBackoffSeconds, maxBackoffSeconds)
    };
}

async function loadShopDeliveryStrategyConfig(supabase, env = process.env) {
    if (!supabase) {
        return normalizeShopDeliveryStrategyConfig({}, env);
    }

    const { data, error } = await supabase
        .from('system_config')
        .select('config_value')
        .eq('config_key', 'shop_delivery_strategy')
        .maybeSingle();

    if (error) {
        throw new Error(error.message || 'Failed to load shop delivery strategy');
    }

    return normalizeShopDeliveryStrategyConfig(data?.config_value || {}, env);
}

async function upsertShopDeliveryStrategyConfig(supabase, config, adminId) {
    const normalized = normalizeShopDeliveryStrategyConfig(config);
    const { error } = await supabase
        .from('system_config')
        .upsert({
            config_key: 'shop_delivery_strategy',
            config_value: normalized,
            description: '商城 API 履约策略',
            updated_by: adminId,
            updated_at: new Date().toISOString()
        }, { onConflict: 'config_key' });

    if (error) {
        throw new Error(error.message || 'Failed to save shop delivery strategy');
    }

    return normalized;
}

module.exports = {
    DEFAULT_SHOP_DELIVERY_STRATEGY,
    loadShopDeliveryStrategyConfig,
    normalizeShopDeliveryStrategyConfig,
    upsertShopDeliveryStrategyConfig
};
