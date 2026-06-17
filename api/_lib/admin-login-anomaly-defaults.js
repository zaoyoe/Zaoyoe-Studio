const DEFAULT_ADMIN_LOGIN_ANOMALY_MONITOR_CONFIG = Object.freeze({
    enabled: true,
    sweep_interval_ms: 10 * 60 * 1000,
    recent_window_minutes: 30,
    baseline_lookback_days: 30,
    dedupe_window_minutes: 6 * 60,
    ip_grouping_enabled: true,
    ipv4_group_prefix_bits: 24,
    ipv6_group_prefix_bits: 64,
    recent_distinct_ip_group_threshold: 3,
    user_agent_family_grouping_enabled: true,
    recent_distinct_user_agent_family_threshold: 3,
    page_size: 500,
    max_pages: 10
});

module.exports = {
    DEFAULT_ADMIN_LOGIN_ANOMALY_MONITOR_CONFIG
};
