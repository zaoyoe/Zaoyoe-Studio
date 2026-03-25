/**
 * System Config Management
 * 系统配置管理 - 定价配置
 */

// Config cache
let systemConfigCache = {};
let paymentChannelSecretStatus = getDefaultPaymentChannelSecretStatus();
let paymentChannelRuntimeState = getDefaultPaymentChannelRuntimeState();
let opsAlertSecretStatus = getDefaultOpsAlertSecretStatus();
let paymentChannelAccordionState = {
    mock: false,
    afdian: false,
    hupijiao: false
};
const ADMIN_CONFIG_TOGGLE_PULSE_CLASS = 'status-toggle--pulse';
const ADMIN_CONFIG_SAVE_VISIBLE_CLASS = 'visible';
const ADMIN_CONFIG_VERIFY_QUOTA_TONE_CLASSES = [
    'verify-quota-badge--neutral',
    'verify-quota-badge--success',
    'verify-quota-badge--warning',
    'verify-quota-badge--danger'
];
const ADMIN_CONFIG_RICH_TEXT_COLOR_SWATCH_CLASS_MAP = Object.freeze({
    '#ffffff': 'color-swatch--white',
    '#ffeb3b': 'color-swatch--yellow',
    '#ff9800': 'color-swatch--orange',
    '#4caf50': 'color-swatch--green',
    '#e57373': 'color-swatch--red',
    '#6b9ece': 'color-swatch--blue'
});
const ADMIN_CONFIG_AFFILIATE_POSTER_PRESET_CLASS_MAP = Object.freeze({
    midnight: 'affiliate-poster-preview--midnight',
    sunset: 'affiliate-poster-preview--sunset',
    crystal: 'affiliate-poster-preview--crystal'
});

function pulseAdminConfigToggle(toggleEl) {
    if (!toggleEl) return;
    toggleEl.classList.remove(ADMIN_CONFIG_TOGGLE_PULSE_CLASS);
    void toggleEl.offsetWidth;
    toggleEl.classList.add(ADMIN_CONFIG_TOGGLE_PULSE_CLASS);
    clearTimeout(toggleEl._adminConfigPulseTimer);
    toggleEl._adminConfigPulseTimer = setTimeout(() => {
        toggleEl.classList.remove(ADMIN_CONFIG_TOGGLE_PULSE_CLASS);
    }, 160);
}

function setAdminConfigHiddenState(target, hidden) {
    if (!target) return;
    target.hidden = !!hidden;
}

function showAdminConfigSaveIndicator(indicator, text = '✓ 已保存', durationMs = 1500) {
    if (!indicator) return;
    indicator.textContent = text;
    indicator.classList.add(ADMIN_CONFIG_SAVE_VISIBLE_CLASS);
    clearTimeout(indicator._adminConfigSaveTimer);
    indicator._adminConfigSaveTimer = setTimeout(() => {
        indicator.classList.remove(ADMIN_CONFIG_SAVE_VISIBLE_CLASS);
    }, durationMs);
}

function getAdminConfigRichTextColorClass(color) {
    return ADMIN_CONFIG_RICH_TEXT_COLOR_SWATCH_CLASS_MAP[color] || ADMIN_CONFIG_RICH_TEXT_COLOR_SWATCH_CLASS_MAP['#6b9ece'];
}

function applyAdminConfigRichTextColorSwatch(target, color, options = {}) {
    if (!target) return;
    const previewClass = options.preview ? 'preview' : '';
    target.className = ['color-swatch', previewClass, getAdminConfigRichTextColorClass(color)].filter(Boolean).join(' ');
}

function getAffiliatePosterPreviewClass(templateId) {
    return ADMIN_CONFIG_AFFILIATE_POSTER_PRESET_CLASS_MAP[templateId] || ADMIN_CONFIG_AFFILIATE_POSTER_PRESET_CLASS_MAP.midnight;
}

function renderVerifyQuotaState(quotaEl, tone, iconClass, message, options = {}) {
    if (!quotaEl) return;
    ADMIN_CONFIG_VERIFY_QUOTA_TONE_CLASSES.forEach((className) => quotaEl.classList.remove(className));
    quotaEl.classList.add('verify-quota-badge', `verify-quota-badge--${tone}`);
    const safeMessage = escapeConfigHtml(message);
    const textTag = options.emphasized ? 'strong' : 'span';
    quotaEl.innerHTML = `<i class="${iconClass} verify-quota-badge__icon" aria-hidden="true"></i> <${textTag} class="verify-quota-badge__text">${safeMessage}</${textTag}>`;
}

function getDefaultCheckinConfig() {
    return {
        base_points: 5,
        consecutive_7_points: 50,
        perfect_month_points: 200,
        makeup_cost_points: 10
    };
}

function getDefaultRechargeOptionsConfig() {
    return {
        custom_amount_enabled: false,
        mock_payment_enabled: false,
        custom_amount_min_points: 1,
        custom_amount_max_points: 50000,
        custom_amount_step: 1,
        custom_amount_points_per_cny: 50,
        custom_amount_quote_ttl_seconds: 1800
    };
}

function getDefaultPaymentChannelSecretStatus() {
    return {
        afdian_token: { configured: false, source: 'missing', updatedAt: null },
        hupijiao_api_key: { configured: false, source: 'missing', updatedAt: null },
        hupijiao_secret_key: { configured: false, source: 'missing', updatedAt: null }
    };
}

function getDefaultPaymentChannelRuntimeState() {
    return {
        mock_payment: {
            allowed: window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1',
            reason: 'unknown',
            message: '暂时无法确认当前环境是否允许模拟支付。',
            override_configured: false,
            override_active: false,
            override_env_name: '',
            override_mode: 'none',
            cleanup_message: ''
        }
    };
}

function getDefaultOpsAlertSecretStatus() {
    return {
        telegram_bot_token: { configured: false, source: 'missing', updatedAt: null },
        feishu_webhook_url: { configured: false, source: 'missing', updatedAt: null }
    };
}

function getDefaultOpsAlertConfig() {
    return {
        enabled: false,
        dedupe_window_minutes: 45,
        batch_size: 10,
        sweep_interval_ms: 15000,
        max_attempts: 6,
        retry_base_delay_ms: 60000,
        retry_max_delay_ms: 1800000,
        timeout_ms: 5000,
        channels: {
            telegram: {
                enabled: false,
                minimum_severity: 'warning',
                chat_ids: []
            },
            feishu: {
                enabled: false,
                minimum_severity: 'warning'
            }
        }
    };
}

function normalizeConfigBoolean(value, fallback = false) {
    if (typeof value === 'boolean') return value;
    const normalized = String(value ?? '').trim().toLowerCase();
    if (!normalized) return fallback;
    if (['1', 'true', 'yes', 'on', 'enabled'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off', 'disabled'].includes(normalized)) return false;
    return fallback;
}

function normalizeConfigStringArray(value) {
    if (Array.isArray(value)) {
        return Array.from(new Set(value.map((item) => String(item ?? '').trim()).filter(Boolean)));
    }

    if (typeof value === 'string') {
        return Array.from(new Set(
            value
                .split(/[\n,]/)
                .map((item) => String(item ?? '').trim())
                .filter(Boolean)
        ));
    }

    return [];
}

function normalizeOpsAlertSeverity(value, fallback = 'warning') {
    const normalized = String(value ?? '').trim().toLowerCase();
    return ['info', 'warning', 'critical'].includes(normalized) ? normalized : fallback;
}

function normalizePaymentChannelRuntimeState(raw) {
    const defaults = getDefaultPaymentChannelRuntimeState();
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const mockSource = source.mock_payment && typeof source.mock_payment === 'object' && !Array.isArray(source.mock_payment)
        ? source.mock_payment
        : {};

    return {
        mock_payment: {
            allowed: mockSource.allowed === true || String(mockSource.allowed) === 'true'
                ? true
                : (mockSource.allowed === false || String(mockSource.allowed) === 'false'
                    ? false
                    : defaults.mock_payment.allowed),
            reason: String(mockSource.reason || defaults.mock_payment.reason).trim() || defaults.mock_payment.reason,
            message: String(mockSource.message || defaults.mock_payment.message).trim() || defaults.mock_payment.message,
            override_configured: mockSource.override_configured === true || String(mockSource.override_configured) === 'true',
            override_active: mockSource.override_active === true || String(mockSource.override_active) === 'true',
            override_env_name: String(mockSource.override_env_name || defaults.mock_payment.override_env_name).trim(),
            override_mode: String(mockSource.override_mode || defaults.mock_payment.override_mode).trim() || defaults.mock_payment.override_mode,
            cleanup_message: String(mockSource.cleanup_message || defaults.mock_payment.cleanup_message).trim()
        }
    };
}

function getDefaultPaymentChannelsConfig() {
    const rechargeOptions = normalizeRechargeOptionsConfig(systemConfigCache['recharge_options']);
    const activeProvider = rechargeOptions.mock_payment_enabled ? 'mock' : 'afdian';

    return {
        active_provider: activeProvider,
        providers: {
            mock: {
                enabled: true,
                display_name: '模拟支付',
                description: '仅建议在正式支付接入前短期使用，开启后将直接到账积分。'
            },
            afdian: {
                enabled: true,
                display_name: '爱发电',
                checkout_url: 'https://afdian.com/a/zaoyoe',
                package_hint: '请在爱发电完成支付后，返回钱包输入订单号领取兑换码。',
                custom_amount_hint: '钱包会先生成本次应付金额，请按报价完成支付后返回输入订单号领取兑换码。'
            },
            hupijiao: {
                enabled: false,
                display_name: '虎皮椒',
                checkout_url: '',
                gateway_url: '',
                merchant_id: '',
                return_url: 'https://www.zaoyoe.com',
                notify_url: '',
                package_hint: '虎皮椒通道已启用，正式回调与自动发货接入后即可完整使用。',
                custom_amount_hint: '虎皮椒通道已启用。自定义金额订单能力接入后，这里会直接拉起真实支付。'
            }
        }
    };
}

function getDefaultAnalyticsPreferencesConfig() {
    return {
        refresh_interval_ms: 300000
    };
}

function normalizeAnalyticsPreferencesConfig(raw) {
    const defaults = getDefaultAnalyticsPreferencesConfig();
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const refreshInterval = parseInt(source.refresh_interval_ms, 10);

    return {
        refresh_interval_ms: Number.isFinite(refreshInterval) && refreshInterval > 0
            ? refreshInterval
            : defaults.refresh_interval_ms
    };
}

function getDefaultIntegrationsConfig() {
    return {
        google_login_enabled: true,
        wechat_login_enabled: false,
        supabase_realtime_enabled: true,
        ai_service: 'gemini'
    };
}

function normalizeIntegrationsConfig(raw) {
    const defaults = getDefaultIntegrationsConfig();
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const aiService = ['gemini', 'openai', 'claude'].includes(source.ai_service)
        ? source.ai_service
        : defaults.ai_service;

    return {
        google_login_enabled: source.google_login_enabled !== false,
        wechat_login_enabled: source.wechat_login_enabled === true,
        supabase_realtime_enabled: source.supabase_realtime_enabled !== false,
        ai_service: aiService
    };
}

function getDefaultSeoConfig() {
    return {
        site_title: '我的提示词画廊',
        site_description: '精选AI生成图片提示词，一键复制使用...',
        site_keywords: 'AI图片, 提示词, Midjourney, Stable Diffusion'
    };
}

function normalizeSeoConfig(raw) {
    const defaults = getDefaultSeoConfig();
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};

    return {
        site_title: typeof source.site_title === 'string' && source.site_title.trim()
            ? source.site_title.trim()
            : defaults.site_title,
        site_description: typeof source.site_description === 'string' && source.site_description.trim()
            ? source.site_description.trim()
            : defaults.site_description,
        site_keywords: typeof source.site_keywords === 'string' && source.site_keywords.trim()
            ? source.site_keywords.trim()
            : defaults.site_keywords
    };
}

function getDefaultPerformanceConfig() {
    return {
        lazy_load_enabled: true,
        image_quality: 85,
        cache_duration_seconds: 86400
    };
}

function normalizePerformanceConfig(raw) {
    const defaults = getDefaultPerformanceConfig();
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const imageQuality = parseInt(source.image_quality, 10);
    const cacheDuration = parseInt(source.cache_duration_seconds, 10);

    return {
        lazy_load_enabled: source.lazy_load_enabled !== false,
        image_quality: Number.isFinite(imageQuality)
            ? Math.min(100, Math.max(60, imageQuality))
            : defaults.image_quality,
        cache_duration_seconds: Number.isFinite(cacheDuration) && cacheDuration > 0
            ? cacheDuration
            : defaults.cache_duration_seconds
    };
}

function getDefaultAffiliateProgramConfig() {
    return {
        commission_rate_shop: 0.10,
        commission_rate_agent: 0.10,
        registration_reward_points: 0,
        registration_reward_requires_purchase: true,
        reward_notice: '拉新固定奖励与持续返佣可叠加发放；异常流量、作弊注册、退款订单与刷单行为不计入奖励统计。',
        legal_disclaimer: '活动最终解释权归平台所有'
    };
}

function getAffiliatePosterPresetDefinitions() {
    return [
        {
            id: 'midnight',
            name: '星幕邀请函',
            description: '深色高级感，适合作为默认分享海报。',
            preview_background: 'linear-gradient(160deg, #020617 0%, #0f172a 42%, #134e4a 100%)'
        },
        {
            id: 'sunset',
            name: '暖金品牌卡',
            description: '暖色氛围更强，适合活动档期与节庆传播。',
            preview_background: 'linear-gradient(160deg, #431407 0%, #9a3412 38%, #f59e0b 100%)'
        },
        {
            id: 'crystal',
            name: '清透极简版',
            description: '浅色留白更多，适合搭配自定义品牌底图。',
            preview_background: 'linear-gradient(160deg, #e2e8f0 0%, #cbd5e1 45%, #f8fafc 100%)'
        }
    ];
}

function getDefaultAffiliatePosterConfig() {
    return {
        chip_label: '推广',
        title: '专属邀请函',
        subtitle: '扫码注册 · 即享专属奖励',
        reward_badge_text: '',
        invite_code_label: '邀请码',
        qr_label: '扫码注册领取新人福利',
        footer: '邀请好友注册，享受固定奖励与持续返佣',
        active_template_id: 'midnight',
        templates: getAffiliatePosterPresetDefinitions().map(template => ({
            id: template.id,
            name: template.name,
            description: template.description,
            custom_background_url: ''
        }))
    };
}

function toWholeNumber(value, fallback = 0) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function toPointNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.round(parsed * 10) / 10 : fallback;
}

function toDecimal(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function escapeConfigHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function normalizeCheckinConfig(raw) {
    const defaults = getDefaultCheckinConfig();
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    return {
        base_points: Math.max(0, toPointNumber(source.base_points, defaults.base_points)),
        consecutive_7_points: Math.max(0, toPointNumber(source.consecutive_7_points, defaults.consecutive_7_points)),
        perfect_month_points: Math.max(0, toPointNumber(source.perfect_month_points, defaults.perfect_month_points)),
        makeup_cost_points: Math.max(0, toPointNumber(source.makeup_cost_points, defaults.makeup_cost_points))
    };
}

function normalizeRechargeOptionsConfig(raw) {
    const defaults = getDefaultRechargeOptionsConfig();
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};

    return {
        custom_amount_enabled: source.custom_amount_enabled === true || String(source.custom_amount_enabled) === 'true',
        mock_payment_enabled: source.mock_payment_enabled === true || String(source.mock_payment_enabled) === 'true',
        custom_amount_min_points: Math.max(1, Math.round(toPointNumber(source.custom_amount_min_points, defaults.custom_amount_min_points))),
        custom_amount_max_points: Math.max(
            Math.max(1, Math.round(toPointNumber(source.custom_amount_min_points, defaults.custom_amount_min_points))),
            Math.round(toPointNumber(source.custom_amount_max_points, defaults.custom_amount_max_points))
        ),
        custom_amount_step: Math.max(1, Math.round(toPointNumber(source.custom_amount_step, defaults.custom_amount_step))),
        custom_amount_points_per_cny: Math.max(0.01, toPointNumber(source.custom_amount_points_per_cny, defaults.custom_amount_points_per_cny)),
        custom_amount_quote_ttl_seconds: Math.max(60, Math.round(toPointNumber(source.custom_amount_quote_ttl_seconds, defaults.custom_amount_quote_ttl_seconds)))
    };
}

function normalizePaymentChannelsConfig(raw) {
    const defaults = getDefaultPaymentChannelsConfig();
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const sourceProviders = source.providers && typeof source.providers === 'object' && !Array.isArray(source.providers)
        ? source.providers
        : {};

    const normalized = {
        active_provider: ['mock', 'afdian', 'hupijiao'].includes(source.active_provider)
            ? source.active_provider
            : defaults.active_provider,
        providers: {
            mock: {
                enabled: sourceProviders.mock?.enabled !== undefined
                    ? (sourceProviders.mock.enabled === true || String(sourceProviders.mock.enabled) === 'true')
                    : defaults.providers.mock.enabled,
                display_name: String(sourceProviders.mock?.display_name || defaults.providers.mock.display_name).trim() || defaults.providers.mock.display_name,
                description: String(sourceProviders.mock?.description || defaults.providers.mock.description).trim() || defaults.providers.mock.description
            },
            afdian: {
                enabled: sourceProviders.afdian?.enabled !== undefined
                    ? (sourceProviders.afdian.enabled === true || String(sourceProviders.afdian.enabled) === 'true')
                    : defaults.providers.afdian.enabled,
                display_name: String(sourceProviders.afdian?.display_name || defaults.providers.afdian.display_name).trim() || defaults.providers.afdian.display_name,
                checkout_url: String(sourceProviders.afdian?.checkout_url || defaults.providers.afdian.checkout_url).trim() || defaults.providers.afdian.checkout_url,
                package_hint: String(sourceProviders.afdian?.package_hint || defaults.providers.afdian.package_hint).trim() || defaults.providers.afdian.package_hint,
                custom_amount_hint: String(sourceProviders.afdian?.custom_amount_hint || defaults.providers.afdian.custom_amount_hint).trim() || defaults.providers.afdian.custom_amount_hint
            },
            hupijiao: {
                enabled: sourceProviders.hupijiao?.enabled === true || String(sourceProviders.hupijiao?.enabled) === 'true',
                display_name: String(sourceProviders.hupijiao?.display_name || defaults.providers.hupijiao.display_name).trim() || defaults.providers.hupijiao.display_name,
                checkout_url: String(sourceProviders.hupijiao?.checkout_url || defaults.providers.hupijiao.checkout_url).trim(),
                gateway_url: String(sourceProviders.hupijiao?.gateway_url || defaults.providers.hupijiao.gateway_url).trim(),
                merchant_id: String(sourceProviders.hupijiao?.merchant_id || defaults.providers.hupijiao.merchant_id).trim(),
                return_url: String(sourceProviders.hupijiao?.return_url || defaults.providers.hupijiao.return_url).trim() || defaults.providers.hupijiao.return_url,
                notify_url: String(sourceProviders.hupijiao?.notify_url || defaults.providers.hupijiao.notify_url).trim(),
                package_hint: String(sourceProviders.hupijiao?.package_hint || defaults.providers.hupijiao.package_hint).trim() || defaults.providers.hupijiao.package_hint,
                custom_amount_hint: String(sourceProviders.hupijiao?.custom_amount_hint || defaults.providers.hupijiao.custom_amount_hint).trim() || defaults.providers.hupijiao.custom_amount_hint
            }
        }
    };

    if (!normalized.providers[normalized.active_provider]?.enabled) {
        normalized.providers[normalized.active_provider].enabled = true;
    }

    return normalized;
}

function normalizeOpsAlertConfig(raw) {
    const defaults = getDefaultOpsAlertConfig();
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const sourceChannels = source.channels && typeof source.channels === 'object' && !Array.isArray(source.channels)
        ? source.channels
        : {};
    const telegramSource = sourceChannels.telegram && typeof sourceChannels.telegram === 'object' && !Array.isArray(sourceChannels.telegram)
        ? sourceChannels.telegram
        : {};
    const feishuSource = sourceChannels.feishu && typeof sourceChannels.feishu === 'object' && !Array.isArray(sourceChannels.feishu)
        ? sourceChannels.feishu
        : {};

    return {
        enabled: normalizeConfigBoolean(source.enabled, defaults.enabled),
        dedupe_window_minutes: clamp(toWholeNumber(source.dedupe_window_minutes, defaults.dedupe_window_minutes), 1, 1440),
        batch_size: clamp(toWholeNumber(source.batch_size, defaults.batch_size), 1, 50),
        sweep_interval_ms: clamp(toWholeNumber(source.sweep_interval_ms, defaults.sweep_interval_ms), 1000, 10 * 60 * 1000),
        max_attempts: clamp(toWholeNumber(source.max_attempts, defaults.max_attempts), 1, 20),
        retry_base_delay_ms: clamp(toWholeNumber(source.retry_base_delay_ms, defaults.retry_base_delay_ms), 1000, 60 * 60 * 1000),
        retry_max_delay_ms: clamp(
            toWholeNumber(source.retry_max_delay_ms, defaults.retry_max_delay_ms),
            Math.max(1000, toWholeNumber(source.retry_base_delay_ms, defaults.retry_base_delay_ms)),
            24 * 60 * 60 * 1000
        ),
        timeout_ms: clamp(toWholeNumber(source.timeout_ms, defaults.timeout_ms), 1000, 30000),
        channels: {
            telegram: {
                enabled: normalizeConfigBoolean(telegramSource.enabled, defaults.channels.telegram.enabled),
                minimum_severity: normalizeOpsAlertSeverity(telegramSource.minimum_severity, defaults.channels.telegram.minimum_severity),
                chat_ids: normalizeConfigStringArray(telegramSource.chat_ids)
            },
            feishu: {
                enabled: normalizeConfigBoolean(feishuSource.enabled, defaults.channels.feishu.enabled),
                minimum_severity: normalizeOpsAlertSeverity(feishuSource.minimum_severity, defaults.channels.feishu.minimum_severity)
            }
        }
    };
}

function normalizeAffiliateProgramConfig(raw) {
    const defaults = getDefaultAffiliateProgramConfig();
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const rewardNotice = typeof source.reward_notice === 'string' ? source.reward_notice : defaults.reward_notice;
    const legalDisclaimer = typeof source.legal_disclaimer === 'string' ? source.legal_disclaimer : defaults.legal_disclaimer;

    return {
        commission_rate_shop: clamp(toDecimal(source.commission_rate_shop, defaults.commission_rate_shop), 0, 1),
        commission_rate_agent: clamp(toDecimal(source.commission_rate_agent, defaults.commission_rate_agent), 0, 1),
        registration_reward_points: Math.max(0, toPointNumber(source.registration_reward_points, defaults.registration_reward_points)),
        registration_reward_requires_purchase: source.registration_reward_requires_purchase !== undefined
            ? String(source.registration_reward_requires_purchase) !== 'false'
            : defaults.registration_reward_requires_purchase,
        reward_notice: rewardNotice.trim() || defaults.reward_notice,
        legal_disclaimer: legalDisclaimer.trim() || defaults.legal_disclaimer
    };
}

function normalizeAffiliatePosterConfig(raw) {
    const defaults = getDefaultAffiliatePosterConfig();
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const sourceTemplates = Array.isArray(source.templates) ? source.templates : [];

    const templates = defaults.templates.map(defaultTemplate => {
        const match = sourceTemplates.find(template => template && template.id === defaultTemplate.id) || {};
        return {
            ...defaultTemplate,
            name: typeof match.name === 'string' && match.name.trim() ? match.name.trim() : defaultTemplate.name,
            description: typeof match.description === 'string' && match.description.trim() ? match.description.trim() : defaultTemplate.description,
            custom_background_url: typeof match.custom_background_url === 'string' ? match.custom_background_url.trim() : ''
        };
    });

    const activeTemplateId = templates.some(template => template.id === source.active_template_id)
        ? source.active_template_id
        : defaults.active_template_id;

    return {
        chip_label: typeof source.chip_label === 'string' && source.chip_label.trim() ? source.chip_label.trim() : defaults.chip_label,
        title: typeof source.title === 'string' && source.title.trim() ? source.title.trim() : defaults.title,
        subtitle: typeof source.subtitle === 'string' && source.subtitle.trim() ? source.subtitle.trim() : defaults.subtitle,
        reward_badge_text: typeof source.reward_badge_text === 'string' ? source.reward_badge_text.trim() : defaults.reward_badge_text,
        invite_code_label: typeof source.invite_code_label === 'string' && source.invite_code_label.trim() ? source.invite_code_label.trim() : defaults.invite_code_label,
        qr_label: typeof source.qr_label === 'string' && source.qr_label.trim() ? source.qr_label.trim() : defaults.qr_label,
        footer: typeof source.footer === 'string' && source.footer.trim() ? source.footer.trim() : defaults.footer,
        active_template_id: activeTemplateId,
        templates
    };
}

// ============================================
// INIT & LOAD
// ============================================

async function initSystemConfig() {
    console.log('[Config] Initializing system config...');
    try {
        await loadAllSystemConfig();
        setupConfigEventListeners();
        console.log('[Config] Initialized successfully');
    } catch (err) {
        console.error('[Config] Init error:', err);
    }
}

async function loadAllSystemConfig() {
    try {
        const { data, error } = await supabaseClient.rpc('get_all_system_config');

        if (error) throw error;

        // Cache configs
        (data || []).forEach(item => {
            systemConfigCache[item.config_key] = item.config_value;
        });

        // Render UI
        renderUnlockPricingConfig();
        renderPackagesConfig();
        renderPaymentChannelsConfig();
        renderOpsAlertSettings();
        renderChannelsConfig();
        renderRewardsConfig();
        renderGeneralSettingsConfig();
        renderSecurityConfig();
        renderNotificationsConfig();
        renderModerationConfig();
        renderGalleryConfig();
        renderCommentRulesConfig();
        renderVerifyConfig();
        loadAffiliateSettings();
        loadPaymentChannelSettings();
        loadOpsAlertSettings();

    } catch (err) {
        console.warn('[Config] Load error:', err.message);
        // Use defaults on error
    }
}

// ============================================
// RENDER FUNCTIONS
// ============================================

function renderUnlockPricingConfig() {
    const config = systemConfigCache['unlock_pricing'] || { default_points: 1, vip_discount: 0.9 };

    const pointsInput = document.getElementById('cfgUnlockPoints');
    const discountInput = document.getElementById('cfgVipDiscount');

    if (pointsInput) pointsInput.value = config.default_points || 1;
    if (discountInput) discountInput.value = (config.vip_discount || 0.9) * 100;
}

function renderPackagesConfig() {
    const packages = systemConfigCache['packages'] || [];
    const rechargeOptions = normalizeRechargeOptionsConfig(systemConfigCache['recharge_options']);
    const tbody = document.getElementById('packagesTableBody');
    if (!tbody) return;

    tbody.innerHTML = packages.map((pkg, index) => `
        <tr data-index="${index}">
            <td>
                <input
                    type="text"
                    value="${escapeConfigHtml(pkg.name)}"
                    data-admin-change-action="settings-update-package-field"
                    data-package-index="${index}"
                    data-package-field="name"
                    data-package-value-type="string">
            </td>
            <td>
                <input
                    type="number"
                    value="${escapeConfigHtml(pkg.points)}"
                    data-admin-change-action="settings-update-package-field"
                    data-package-index="${index}"
                    data-package-field="points"
                    data-package-value-type="int">
            </td>
            <td>
                <input
                    type="number"
                    value="${escapeConfigHtml(pkg.bonus || 0)}"
                    placeholder="0"
                    data-admin-change-action="settings-update-package-field"
                    data-package-index="${index}"
                    data-package-field="bonus"
                    data-package-value-type="int">
            </td>
            <td>
                <input
                    type="number"
                    value="${pkg.price == null ? '' : escapeConfigHtml(pkg.price)}"
                    step="0.1"
                    data-admin-change-action="settings-update-package-field"
                    data-package-index="${index}"
                    data-package-field="price"
                    data-package-value-type="float">
            </td>
            <td>
                <div class="status-toggle ${pkg.enabled ? 'active' : ''}" data-admin-action="settings-toggle-package-status" data-package-index="${index}"></div>
            </td>
            <td>
                <button class="btn-delete" type="button" data-admin-action="settings-delete-package" data-package-index="${index}">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        </tr>
    `).join('');

    const customRechargeToggle = document.getElementById('customRechargeStatusToggle');
    if (customRechargeToggle) {
        customRechargeToggle.classList.toggle('active', rechargeOptions.custom_amount_enabled);
    }

    const mockPaymentToggle = document.getElementById('mockPaymentStatusToggle');
    if (mockPaymentToggle) {
        mockPaymentToggle.classList.toggle('active', rechargeOptions.mock_payment_enabled);
    }
}

function normalizePackageFieldValue(field, value, fallback) {
    switch (field) {
        case 'name':
            return String(value ?? '').trim();
        case 'points':
        case 'bonus': {
            const parsed = parseInt(value ?? '', 10);
            return Math.max(0, Number.isFinite(parsed) ? parsed : (Number.isFinite(fallback) ? fallback : 0));
        }
        case 'price': {
            const trimmed = String(value ?? '').trim();
            if (!trimmed) {
                return null;
            }

            const parsed = Number(trimmed);
            const normalized = Number.isFinite(parsed) ? parsed : fallback;
            return Number.isFinite(normalized) ? Math.max(0, Math.round(normalized * 100) / 100) : null;
        }
        default:
            return value;
    }
}

function getPaymentSecretStatusMessage(secretName) {
    const status = paymentChannelSecretStatus?.[secretName];
    if (status?.configured) {
        return `已配置后台安全密钥${status.updatedAt ? ` · 更新于 ${new Date(status.updatedAt).toLocaleString('zh-CN')}` : ''}`;
    }
    return '未配置后台安全密钥';
}

function getOpsAlertSecretStatusMessage(secretName) {
    const status = opsAlertSecretStatus?.[secretName];
    if (!status?.configured) {
        return '未配置后台安全密钥';
    }

    const sourceLabel = status.source === 'environment' ? '环境变量' : '后台密钥仓';
    return `已配置${sourceLabel}${status.updatedAt ? ` · 更新于 ${new Date(status.updatedAt).toLocaleString('zh-CN')}` : ''}`;
}

function setOpsAlertDeleteButtonState(secretName, status) {
    const button = document.querySelector(`[data-admin-action="settings-delete-ops-alert-secret"][data-secret-name="${secretName}"]`);
    if (!button) return;

    if (status?.configured && status.source === 'stored') {
        button.disabled = false;
        button.title = '';
        return;
    }

    button.disabled = true;
    button.title = status?.source === 'environment'
        ? '当前密钥来自环境变量，请在 Vercel / Railway 中删除或修改。'
        : '当前没有可删除的后台密钥。';
}

function getPaymentProviderDomRefs(providerKey) {
    const suffixMap = {
        mock: 'Mock',
        afdian: 'Afdian',
        hupijiao: 'Hupijiao'
    };
    const suffix = suffixMap[providerKey];
    if (!suffix) return null;

    return {
        accordion: document.getElementById(`paymentProviderAccordion${suffix}`),
        title: document.getElementById(`paymentProviderHeaderName${suffix}`),
        status: document.getElementById(`paymentProviderHeaderStatus${suffix}`),
        desc: document.getElementById(`paymentProviderHeaderDesc${suffix}`),
        panel: document.getElementById(`paymentProviderPanel${suffix}`),
        chevron: document.getElementById(`paymentProviderChevron${suffix}`)
    };
}

function setPaymentProviderPanelExpanded(providerKey, expanded) {
    if (!(providerKey in paymentChannelAccordionState)) return;
    paymentChannelAccordionState[providerKey] = !!expanded;

    const refs = getPaymentProviderDomRefs(providerKey);
    if (!refs) return;

    refs.accordion?.classList.toggle('expanded', !!expanded);
    refs.panel?.classList.toggle('expanded', !!expanded);
    refs.chevron?.classList.toggle('expanded', !!expanded);
}

function togglePaymentProviderPanel(providerKey) {
    const nextState = !paymentChannelAccordionState[providerKey];
    setPaymentProviderPanelExpanded(providerKey, nextState);
}

function applyPaymentChannelOverview(config) {
    const activeProvider = config.providers[config.active_provider];
    const mockRuntime = normalizePaymentChannelRuntimeState(paymentChannelRuntimeState).mock_payment;
    const isMockCurrentlyEnabled = config.active_provider === 'mock';
    const isMockActiveButBlocked = config.active_provider === 'mock' && mockRuntime.allowed !== true;
    const hasMockOverrideCleanupNotice = !isMockCurrentlyEnabled
        && mockRuntime.override_configured === true
        && Boolean(mockRuntime.cleanup_message);
    const summaryMessage = isMockActiveButBlocked
        ? mockRuntime.message
        : (hasMockOverrideCleanupNotice
            ? mockRuntime.cleanup_message
            : '公开配置保存在系统设置中；敏感密钥会通过服务端加密保存，不再存浏览器。');
    const summaryIcon = (isMockActiveButBlocked || hasMockOverrideCleanupNotice) ? 'fa-exclamation-triangle' : 'fa-plug';
    const activeSelect = document.getElementById('paymentChannelActiveSelect');
    if (activeSelect && activeSelect.value !== config.active_provider) {
        activeSelect.value = config.active_provider;
    }

    const summary = document.getElementById('paymentChannelSummary');
    if (summary) {
        summary.innerHTML = `
            <i class="fas ${summaryIcon}"></i>
            <span>当前主通道：${escapeConfigHtml(activeProvider.display_name)}。${escapeConfigHtml(summaryMessage)}</span>
        `;
    }

    const toggleMap = {
        mock: 'paymentProviderMockToggle',
        afdian: 'paymentProviderAfdianToggle',
        hupijiao: 'paymentProviderHupijiaoToggle'
    };

    const descriptionMap = {
        mock: isMockActiveButBlocked
            ? `当前已选择为主通道，但 ${mockRuntime.message}`
            : (hasMockOverrideCleanupNotice
                ? mockRuntime.cleanup_message
                : (config.providers.mock.description || '直接到账，适合短期过渡验证。')),
        afdian: `${config.providers.afdian.package_hint || '支付后输入订单号领取兑换码'} · ${paymentChannelSecretStatus?.afdian_token?.configured ? 'Token 已配置' : 'Token 待配置'}`,
        hupijiao: `${config.providers.hupijiao.merchant_id ? `商户号 ${config.providers.hupijiao.merchant_id}` : '商户号待填写'} · ${(paymentChannelSecretStatus?.hupijiao_api_key?.configured && paymentChannelSecretStatus?.hupijiao_secret_key?.configured) ? '密钥已配置' : '密钥待配置'}`
    };

    Object.keys(toggleMap).forEach((providerKey) => {
        const provider = config.providers[providerKey];
        const toggleEl = document.getElementById(toggleMap[providerKey]);
        const refs = getPaymentProviderDomRefs(providerKey);
        const isActiveProvider = providerKey === config.active_provider;
        const statusText = isActiveProvider
            ? (provider.enabled ? '主通道 · 已启用' : '主通道')
            : (provider.enabled ? '已启用' : '已停用');

        if (toggleEl) {
            toggleEl.classList.toggle('active', provider.enabled === true);
        }

        if (refs?.title) refs.title.textContent = provider.display_name || '未命名通道';
        if (refs?.desc) refs.desc.textContent = descriptionMap[providerKey];
        if (refs?.status) {
            refs.status.textContent = statusText;
            refs.status.className = `payment-provider-accordion-status ${isActiveProvider ? 'is-current' : (provider.enabled ? 'is-enabled' : 'is-disabled')}`;
        }
        if (refs?.accordion) {
            refs.accordion.classList.toggle('active-provider', isActiveProvider);
            refs.accordion.classList.toggle('is-disabled', !provider.enabled);
        }
    });
}

function handlePaymentChannelActiveChange(providerKey) {
    const toggleMap = {
        mock: 'paymentProviderMockToggle',
        afdian: 'paymentProviderAfdianToggle',
        hupijiao: 'paymentProviderHupijiaoToggle'
    };
    const toggleEl = document.getElementById(toggleMap[providerKey]);
    if (toggleEl && !toggleEl.classList.contains('active')) {
        toggleEl.classList.add('active');
    }
    setPaymentProviderPanelExpanded(providerKey, true);
    applyPaymentChannelOverview(collectPaymentChannelsConfigFromForm());
}

function renderPaymentChannelsConfig() {
    const config = normalizePaymentChannelsConfig(systemConfigCache['payment_channels']);

    const setValue = (id, value) => {
        const input = document.getElementById(id);
        if (input) input.value = value || '';
    };

    setValue('paymentProviderMockDisplayName', config.providers.mock.display_name);
    setValue('paymentProviderMockDescription', config.providers.mock.description);
    setValue('paymentProviderAfdianDisplayName', config.providers.afdian.display_name);
    setValue('paymentProviderAfdianCheckoutUrl', config.providers.afdian.checkout_url);
    setValue('paymentProviderAfdianPackageHint', config.providers.afdian.package_hint);
    setValue('paymentProviderAfdianCustomHint', config.providers.afdian.custom_amount_hint);
    setValue('paymentProviderHupijiaoDisplayName', config.providers.hupijiao.display_name);
    setValue('paymentProviderHupijiaoCheckoutUrl', config.providers.hupijiao.checkout_url);
    setValue('paymentProviderHupijiaoGatewayUrl', config.providers.hupijiao.gateway_url);
    setValue('paymentProviderHupijiaoMerchantId', config.providers.hupijiao.merchant_id);
    setValue('paymentProviderHupijiaoReturnUrl', config.providers.hupijiao.return_url);
    setValue('paymentProviderHupijiaoNotifyUrl', config.providers.hupijiao.notify_url);
    setValue('paymentProviderHupijiaoPackageHint', config.providers.hupijiao.package_hint);
    setValue('paymentProviderHupijiaoCustomHint', config.providers.hupijiao.custom_amount_hint);

    const afdianStatus = document.getElementById('paymentProviderAfdianTokenStatus');
    if (afdianStatus) afdianStatus.textContent = getPaymentSecretStatusMessage('afdian_token');

    const hupijiaoApiKeyStatus = document.getElementById('paymentProviderHupijiaoApiKeyStatus');
    if (hupijiaoApiKeyStatus) hupijiaoApiKeyStatus.textContent = getPaymentSecretStatusMessage('hupijiao_api_key');

    const hupijiaoSecretStatus = document.getElementById('paymentProviderHupijiaoSecretKeyStatus');
    if (hupijiaoSecretStatus) hupijiaoSecretStatus.textContent = getPaymentSecretStatusMessage('hupijiao_secret_key');

    applyPaymentChannelOverview(config);
    Object.entries(paymentChannelAccordionState).forEach(([providerKey, expanded]) => {
        setPaymentProviderPanelExpanded(providerKey, expanded);
    });
}

function applyOpsAlertOverview(config) {
    const normalizedConfig = normalizeOpsAlertConfig(config);
    const telegramSecret = opsAlertSecretStatus?.telegram_bot_token || getDefaultOpsAlertSecretStatus().telegram_bot_token;
    const feishuSecret = opsAlertSecretStatus?.feishu_webhook_url || getDefaultOpsAlertSecretStatus().feishu_webhook_url;
    const telegramChatCount = normalizedConfig.channels.telegram.chat_ids.length;
    const channelStates = [];
    const deliveryIssues = [];

    if (normalizedConfig.channels.telegram.enabled) {
        const telegramSummary = `Telegram · ${normalizedConfig.channels.telegram.minimum_severity}+ · ${telegramChatCount || 0} 个 chat`;
        if (telegramSecret.configured && telegramChatCount > 0) {
            channelStates.push(`${telegramSummary} · 已就绪`);
        } else {
            channelStates.push(`${telegramSummary} · 待补充配置`);
            if (!telegramSecret.configured) deliveryIssues.push('Telegram Bot Token 未配置');
            if (!telegramChatCount) deliveryIssues.push('Telegram Chat ID 未填写');
        }
    }

    if (normalizedConfig.channels.feishu.enabled) {
        const feishuSummary = `飞书 · ${normalizedConfig.channels.feishu.minimum_severity}+`;
        if (feishuSecret.configured) {
            channelStates.push(`${feishuSummary} · 已就绪`);
        } else {
            channelStates.push(`${feishuSummary} · 待补充配置`);
            deliveryIssues.push('飞书 Webhook 未配置');
        }
    }

    const summaryEl = document.getElementById('opsAlertSummary');
    if (summaryEl) {
        const isEnabled = normalizedConfig.enabled;
        const hasChannels = channelStates.length > 0;
        const hasIssues = deliveryIssues.length > 0;
        const summaryIcon = !isEnabled
            ? 'fa-bell-slash'
            : (hasIssues ? 'fa-exclamation-triangle' : 'fa-satellite-dish');
        let summaryText = '当前未启用站外退款告警，退款异常仍只会保留站内后台通知。';

        if (isEnabled && !hasChannels) {
            summaryText = '已启用站外退款告警，但还没有打开任何外部通道。';
        } else if (isEnabled) {
            summaryText = `已启用站外退款告警：${channelStates.join('；')}。发送采用异步队列，不阻塞退款主流程。`;
            if (deliveryIssues.length) {
                summaryText += ` 当前待补充：${deliveryIssues.join('、')}。`;
            }
        } else if (hasChannels) {
            summaryText = `当前未启用站外退款告警，已预设通道：${channelStates.join('；')}。保存后启用即可生效。`;
        }

        summaryEl.innerHTML = `
            <i class="fas ${summaryIcon}"></i>
            <span>${escapeConfigHtml(summaryText)}</span>
        `;
    }

    const masterToggle = document.getElementById('opsAlertEnabledToggle');
    if (masterToggle) {
        masterToggle.classList.toggle('active', normalizedConfig.enabled);
    }

    const telegramToggle = document.getElementById('opsAlertTelegramEnabledToggle');
    if (telegramToggle) {
        telegramToggle.classList.toggle('active', normalizedConfig.channels.telegram.enabled);
    }

    const feishuToggle = document.getElementById('opsAlertFeishuEnabledToggle');
    if (feishuToggle) {
        feishuToggle.classList.toggle('active', normalizedConfig.channels.feishu.enabled);
    }

    const telegramInputIds = [
        'opsAlertTelegramChatIds',
        'opsAlertTelegramSeverity',
        'opsAlertTelegramBotToken'
    ];
    telegramInputIds.forEach((id) => {
        const input = document.getElementById(id);
        if (input) input.disabled = !normalizedConfig.channels.telegram.enabled;
    });

    const feishuInputIds = [
        'opsAlertFeishuSeverity',
        'opsAlertFeishuWebhookUrl'
    ];
    feishuInputIds.forEach((id) => {
        const input = document.getElementById(id);
        if (input) input.disabled = !normalizedConfig.channels.feishu.enabled;
    });

    const telegramStatus = document.getElementById('opsAlertTelegramBotTokenStatus');
    if (telegramStatus) {
        telegramStatus.textContent = getOpsAlertSecretStatusMessage('telegram_bot_token');
    }

    const feishuStatus = document.getElementById('opsAlertFeishuWebhookStatus');
    if (feishuStatus) {
        feishuStatus.textContent = getOpsAlertSecretStatusMessage('feishu_webhook_url');
    }

    setOpsAlertDeleteButtonState('telegram_bot_token', telegramSecret);
    setOpsAlertDeleteButtonState('feishu_webhook_url', feishuSecret);
}

function renderOpsAlertSettings() {
    const config = normalizeOpsAlertConfig(systemConfigCache['ops_alerts']);

    const telegramChatIds = document.getElementById('opsAlertTelegramChatIds');
    if (telegramChatIds) {
        telegramChatIds.value = config.channels.telegram.chat_ids.join('\n');
    }

    const telegramSeverity = document.getElementById('opsAlertTelegramSeverity');
    if (telegramSeverity) {
        telegramSeverity.value = config.channels.telegram.minimum_severity;
    }

    const feishuSeverity = document.getElementById('opsAlertFeishuSeverity');
    if (feishuSeverity) {
        feishuSeverity.value = config.channels.feishu.minimum_severity;
    }

    applyOpsAlertOverview(config);
}

function renderChannelsConfig() {
    const channels = systemConfigCache['channels'] || [];
    const container = document.getElementById('channelTags');
    if (!container) return;

    container.innerHTML = channels.map((ch, index) => `
        <div class="channel-tag ${ch.is_default ? 'default' : ''}" data-index="${index}">
            <span>${ch.name}</span>
            <button class="remove-tag" type="button" data-admin-action="settings-delete-channel" data-channel-index="${index}">✕</button>
        </div>
    `).join('');
}

function renderRewardsConfig() {
    const rewardsConfig = systemConfigCache['rewards'] || {};
    const checkinConfig = normalizeCheckinConfig(systemConfigCache['checkin_system']);

    const fields = {
        'cfgSignupBonus': Math.max(0, toPointNumber(rewardsConfig.signup_bonus, 50)),
        'cfgDailyCheckin': checkinConfig.base_points,
        'cfgCheckinStreakBonus': checkinConfig.consecutive_7_points,
        'cfgCheckinPerfectBonus': checkinConfig.perfect_month_points,
        'cfgCheckinMakeupCost': checkinConfig.makeup_cost_points,
        'cfgCommentReward': Math.max(0, toPointNumber(rewardsConfig.comment_reward, 2))
    };

    Object.entries(fields).forEach(([id, value]) => {
        const input = document.getElementById(id);
        if (input) input.value = value;
    });
}

function loadAffiliateSettings() {
    const affiliateConfig = normalizeAffiliateProgramConfig(systemConfigCache['affiliate_program']);
    const posterConfig = normalizeAffiliatePosterConfig(systemConfigCache['affiliate_poster']);

    const affiliateFieldMap = {
        affiliate_setting_commission_rate_shop: affiliateConfig.commission_rate_shop,
        affiliate_setting_commission_rate_agent: affiliateConfig.commission_rate_agent,
        affiliate_setting_registration_reward_points: affiliateConfig.registration_reward_points,
        affiliate_setting_reward_notice: affiliateConfig.reward_notice,
        affiliate_setting_legal_disclaimer: affiliateConfig.legal_disclaimer
    };

    Object.entries(affiliateFieldMap).forEach(([id, value]) => {
        const input = document.getElementById(id);
        if (input) input.value = value;
    });

    const requiresPurchaseInput = document.getElementById('affiliate_setting_registration_reward_requires_purchase');
    if (requiresPurchaseInput) requiresPurchaseInput.checked = !!affiliateConfig.registration_reward_requires_purchase;

    const posterFieldMap = {
        affiliate_poster_chip_label: posterConfig.chip_label,
        affiliate_poster_title: posterConfig.title,
        affiliate_poster_subtitle: posterConfig.subtitle,
        affiliate_poster_reward_badge_text: posterConfig.reward_badge_text,
        affiliate_poster_invite_code_label: posterConfig.invite_code_label,
        affiliate_poster_qr_label: posterConfig.qr_label,
        affiliate_poster_footer: posterConfig.footer
    };

    Object.entries(posterFieldMap).forEach(([id, value]) => {
        const input = document.getElementById(id);
        if (input) input.value = value;
    });

    renderAffiliatePosterTemplates(posterConfig);
}

function renderAffiliatePosterTemplates(config = normalizeAffiliatePosterConfig(systemConfigCache['affiliate_poster'])) {
    const container = document.getElementById('affiliatePosterTemplateGrid');
    if (!container) return;

    const presets = getAffiliatePosterPresetDefinitions();

    container.innerHTML = config.templates.map(template => {
        const preset = presets.find(item => item.id === template.id) || presets[0];
        const isActive = config.active_template_id === template.id;
        const previewMedia = template.custom_background_url
            ? `<img class="affiliate-poster-preview-media" src="${escapeConfigHtml(template.custom_background_url)}" alt="">`
            : '';

        return `
            <div class="affiliate-poster-card ${isActive ? 'active' : ''}">
                <div class="affiliate-poster-preview ${getAffiliatePosterPreviewClass(preset.id)}">
                    ${previewMedia}
                    <div class="affiliate-poster-chip">${escapeConfigHtml(config.chip_label || '推广')}</div>
                    <div class="affiliate-poster-preview-content">
                        <div class="affiliate-poster-preview-title">${escapeConfigHtml(config.title)}</div>
                        <div class="affiliate-poster-preview-subtitle">${escapeConfigHtml(config.subtitle)}</div>
                        <div class="affiliate-poster-preview-footer">${escapeConfigHtml(config.footer)}</div>
                    </div>
                </div>
                <div class="affiliate-poster-card-body">
                    <div class="affiliate-poster-card-header-row">
                        <div>
                            <div class="affiliate-poster-card-title">${escapeConfigHtml(template.name)}</div>
                            <div class="affiliate-poster-card-desc">${escapeConfigHtml(template.description)}</div>
                        </div>
                        <span class="affiliate-poster-status ${isActive ? 'active' : ''}">${isActive ? '已启用' : '未启用'}</span>
                    </div>
                    <div class="affiliate-poster-asset-state">
                        ${template.custom_background_url ? '已上传自定义底图' : '使用内置背景'}
                    </div>
                    <div class="affiliate-poster-actions">
                        <button type="button" class="poster-action-btn primary" data-admin-action="settings-select-affiliate-poster-template" data-poster-template-id="${template.id}">
                            ${isActive ? '当前模板' : '设为默认'}
                        </button>
                        <label class="poster-action-btn upload">
                            上传底图
                            <input type="file" accept="image/*" data-admin-change-action="settings-affiliate-poster-upload" data-poster-template-id="${template.id}">
                        </label>
                        <button type="button" class="poster-action-btn" ${template.custom_background_url ? '' : 'disabled'} data-admin-action="settings-reset-affiliate-poster-background" data-poster-template-id="${template.id}">
                            恢复默认
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// ============================================
// UPDATE FUNCTIONS
// ============================================

async function saveConfig(key, value) {
    try {
        const { error } = await supabaseClient.rpc('update_system_config', {
            p_key: key,
            p_value: value
        });

        if (error) throw error;

        systemConfigCache[key] = value;

        // Sync packages to points_packages table
        if (key === 'packages') {
            await syncPackagesToDatabase(value);
        }

        return true;
    } catch (err) {
        console.error('[Config] Save error:', err);
        if (typeof showToast === 'function') {
            showToast('保存失败: ' + err.message, 'error');
        }
        return false;
    }
}

async function getAdminConfigApiHeaders() {
    const headers = {
        'Content-Type': 'application/json'
    };

    const { data: { session } = {} } = await window.supabaseClient.auth.getSession();
    if (session?.access_token) {
        headers.Authorization = `Bearer ${session.access_token}`;
    }

    return headers;
}

async function loadPaymentChannelSettings(force = false) {
    if (loadPaymentChannelSettings._loadingPromise && !force) {
        return loadPaymentChannelSettings._loadingPromise;
    }

    loadPaymentChannelSettings._loadingPromise = (async () => {
        try {
            const headers = await getAdminConfigApiHeaders();
            const response = await fetch('/api/admin/settings/payment-channels', {
                method: 'GET',
                headers
            });

            const payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload.success) {
                throw new Error(payload.message || '加载支付通道配置失败');
            }

            systemConfigCache['payment_channels'] = normalizePaymentChannelsConfig(payload.config);
            paymentChannelSecretStatus = payload.secrets || getDefaultPaymentChannelSecretStatus();
            paymentChannelRuntimeState = normalizePaymentChannelRuntimeState(payload.runtime);
            const rechargeOptions = normalizeRechargeOptionsConfig(systemConfigCache['recharge_options']);
            rechargeOptions.mock_payment_enabled = systemConfigCache['payment_channels'].active_provider === 'mock';
            systemConfigCache['recharge_options'] = rechargeOptions;
            renderPaymentChannelsConfig();
            renderPackagesConfig();
            return payload;
        } catch (error) {
            console.warn('[Config] Payment channel settings load failed:', error.message);
            paymentChannelSecretStatus = getDefaultPaymentChannelSecretStatus();
            paymentChannelRuntimeState = getDefaultPaymentChannelRuntimeState();
            renderPaymentChannelsConfig();
            return null;
        }
    })();

    try {
        return await loadPaymentChannelSettings._loadingPromise;
    } finally {
        loadPaymentChannelSettings._loadingPromise = null;
    }
}

async function loadOpsAlertSettings(force = false) {
    if (loadOpsAlertSettings._loadingPromise && !force) {
        return loadOpsAlertSettings._loadingPromise;
    }

    loadOpsAlertSettings._loadingPromise = (async () => {
        try {
            const headers = await getAdminConfigApiHeaders();
            const response = await fetch('/api/admin/settings/ops-alerts', {
                method: 'GET',
                headers
            });

            const payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload.success) {
                throw new Error(payload.message || '加载站外告警配置失败');
            }

            systemConfigCache['ops_alerts'] = normalizeOpsAlertConfig(payload.config);
            opsAlertSecretStatus = payload.secrets || getDefaultOpsAlertSecretStatus();
            renderOpsAlertSettings();
            return payload;
        } catch (error) {
            console.warn('[Config] Ops alert settings load failed:', error.message);
            systemConfigCache['ops_alerts'] = normalizeOpsAlertConfig(systemConfigCache['ops_alerts']);
            opsAlertSecretStatus = getDefaultOpsAlertSecretStatus();
            renderOpsAlertSettings();
            return null;
        }
    })();

    try {
        return await loadOpsAlertSettings._loadingPromise;
    } finally {
        loadOpsAlertSettings._loadingPromise = null;
    }
}

// Sync packages config to points_packages table
async function syncPackagesToDatabase(packages) {
    try {
        if (!packages || !Array.isArray(packages)) return;

        console.log('[Config] Syncing packages to database...');

        // Get existing packages from database
        const { data: existingPackages } = await supabaseClient
            .from('points_packages')
            .select('id, name');

        const existingMap = {};
        (existingPackages || []).forEach(p => {
            existingMap[p.name] = p.id;
        });

        // Track which names are in the config
        const configNames = new Set(packages.map(p => p.name));

        // Update or insert packages
        for (const pkg of packages) {
            const existingId = existingMap[pkg.name];

            const packageData = {
                name: pkg.name,
                points_amount: pkg.points || 0,
                bonus_points: pkg.bonus || 0,
                price_cny: pkg.price || 0,
                is_active: pkg.enabled !== false,
                sort_order: pkg.sort || 0
            };

            let error;

            if (existingId) {
                // Update existing
                const result = await supabaseClient
                    .from('points_packages')
                    .update(packageData)
                    .eq('id', existingId);
                error = result.error;
            } else {
                // Insert new
                const result = await supabaseClient
                    .from('points_packages')
                    .insert(packageData);
                error = result.error;
            }

            if (error) {
                console.warn('[Config] Sync package error:', error.message);
            }
        }

        // Delete packages that are not in config anymore
        for (const existing of (existingPackages || [])) {
            if (!configNames.has(existing.name)) {
                console.log('[Config] Deleting removed package:', existing.name);
                await supabaseClient
                    .from('points_packages')
                    .delete()
                    .eq('id', existing.id);
            }
        }

        console.log('[Config] Packages synced successfully');
        if (typeof showToast === 'function') {
            showToast('礼包已同步到数据库', 'success');
        }
    } catch (err) {
        console.error('[Config] Sync packages error:', err);
    }
}

function showConfigSavedToast(message) {
    if (typeof showToast === 'function') {
        showToast(message, 'success');
    }
}

async function saveAffiliateSetting(field, rawValue) {
    const config = normalizeAffiliateProgramConfig(systemConfigCache['affiliate_program']);

    switch (field) {
        case 'commission_rate_shop':
        case 'commission_rate_agent':
            config[field] = clamp(toDecimal(rawValue, config[field]), 0, 1);
            break;
        case 'registration_reward_points':
            config[field] = Math.max(0, toPointNumber(rawValue, config[field]));
            break;
        case 'registration_reward_requires_purchase':
            config[field] = String(rawValue) !== 'false';
            break;
        case 'reward_notice':
        case 'legal_disclaimer':
            config[field] = String(rawValue || '').trim() || getDefaultAffiliateProgramConfig()[field];
            break;
        default:
            return false;
    }

    if (await saveConfig('affiliate_program', config)) {
        loadAffiliateSettings();
        showConfigSavedToast('推广返现设置已保存');
        return true;
    }

    return false;
}

async function saveAffiliatePosterField(field, rawValue) {
    const config = normalizeAffiliatePosterConfig(systemConfigCache['affiliate_poster']);
    const allowedFields = new Set(['chip_label', 'title', 'subtitle', 'reward_badge_text', 'invite_code_label', 'qr_label', 'footer']);
    if (!allowedFields.has(field)) return false;

    if (field === 'reward_badge_text') {
        config[field] = String(rawValue || '').trim();
    } else {
        config[field] = String(rawValue || '').trim() || getDefaultAffiliatePosterConfig()[field];
    }

    if (await saveConfig('affiliate_poster', config)) {
        renderAffiliatePosterTemplates(config);
        showConfigSavedToast('海报文案已保存');
        return true;
    }

    return false;
}

async function selectAffiliatePosterTemplate(templateId) {
    const config = normalizeAffiliatePosterConfig(systemConfigCache['affiliate_poster']);
    if (!config.templates.some(template => template.id === templateId)) return false;

    config.active_template_id = templateId;

    if (await saveConfig('affiliate_poster', config)) {
        renderAffiliatePosterTemplates(config);
        showConfigSavedToast('默认海报模板已更新');
        return true;
    }

    return false;
}

function compressConfigImage(file, options = {}) {
    const maxWidth = options.maxWidth || 1600;
    const maxHeight = options.maxHeight || 2400;
    const quality = options.quality || 0.9;

    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const img = new Image();
            img.onload = () => {
                let { width, height } = img;

                if (width > height && width > maxWidth) {
                    height = Math.round(height * (maxWidth / width));
                    width = maxWidth;
                } else if (height >= width && height > maxHeight) {
                    width = Math.round(width * (maxHeight / height));
                    height = maxHeight;
                }

                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                canvas.width = width;
                canvas.height = height;

                if (!ctx) {
                    reject(new Error('无法初始化图片画布'));
                    return;
                }

                ctx.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.onerror = () => reject(new Error('图片解析失败'));
            img.src = reader.result;
        };
        reader.onerror = () => reject(new Error('图片读取失败'));
        reader.readAsDataURL(file);
    });
}

async function uploadAffiliatePosterBackgroundToR2(templateId, file) {
    const { data: { session } } = await window.supabaseClient.auth.getSession();
    if (!session) {
        throw new Error('请先登录');
    }

    const imageData = await compressConfigImage(file, {
        maxWidth: 1800,
        maxHeight: 2600,
        quality: 0.92
    });

    const response = await fetch(
        window.getZaoyoeSupabaseFunctionUrl('upload-avatar'),
        {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${session.access_token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                userId: session.user.id,
                type: 'poster',
                posterId: `affiliate_${templateId}`,
                imageData
            })
        }
    );

    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result?.imageUrl) {
        throw new Error(result?.error || '海报底图上传失败');
    }

    return result.imageUrl;
}

async function handleAffiliatePosterUpload(templateId, inputEl) {
    const file = inputEl?.files?.[0];
    if (!file) return false;

    const config = normalizeAffiliatePosterConfig(systemConfigCache['affiliate_poster']);
    const template = config.templates.find(item => item.id === templateId);
    if (!template) return false;

    const labelEl = inputEl.closest('.poster-action-btn.upload');
    if (labelEl) labelEl.classList.add('uploading');

    try {
        const imageUrl = await uploadAffiliatePosterBackgroundToR2(templateId, file);
        template.custom_background_url = imageUrl;

        if (await saveConfig('affiliate_poster', config)) {
            renderAffiliatePosterTemplates(config);
            showConfigSavedToast('海报底图已上传');
            return true;
        }
    } catch (err) {
        console.error('[Config] Affiliate poster upload failed:', err);
        if (typeof showToast === 'function') {
            showToast('上传失败: ' + err.message, 'error');
        }
    } finally {
        if (labelEl) labelEl.classList.remove('uploading');
        if (inputEl) inputEl.value = '';
    }

    return false;
}

async function resetAffiliatePosterBackground(templateId) {
    const config = normalizeAffiliatePosterConfig(systemConfigCache['affiliate_poster']);
    const template = config.templates.find(item => item.id === templateId);
    if (!template) return false;

    template.custom_background_url = '';

    if (await saveConfig('affiliate_poster', config)) {
        renderAffiliatePosterTemplates(config);
        showConfigSavedToast('已恢复内置海报背景');
        return true;
    }

    return false;
}

// Show save indicator animation
function showSaveIndicator(element) {
    const indicator = element.closest('.config-input-wrapper')?.querySelector('.config-save-indicator');
    if (indicator) {
        indicator.classList.add('visible');
        setTimeout(() => indicator.classList.remove('visible'), 1500);
    }
}

// Debounce helper
let saveTimeouts = {};
function debouncedSave(key, fn, delay = 500) {
    clearTimeout(saveTimeouts[key]);
    saveTimeouts[key] = setTimeout(fn, delay);
}

// ============================================
// EVENT HANDLERS
// ============================================

function setupConfigEventListeners() {
    // Unlock pricing
    const unlockPointsInput = document.getElementById('cfgUnlockPoints');
    const vipDiscountInput = document.getElementById('cfgVipDiscount');

    if (unlockPointsInput) {
        unlockPointsInput.addEventListener('change', async (e) => {
            const config = systemConfigCache['unlock_pricing'] || {};
            config.default_points = parseInt(e.target.value) || 1;
            if (await saveConfig('unlock_pricing', config)) {
                showSaveIndicator(e.target);
            }
        });
    }

    if (vipDiscountInput) {
        vipDiscountInput.addEventListener('change', async (e) => {
            const config = systemConfigCache['unlock_pricing'] || {};
            config.vip_discount = (parseInt(e.target.value) || 90) / 100;
            if (await saveConfig('unlock_pricing', config)) {
                showSaveIndicator(e.target);
            }
        });
    }

    // Rewards config
    ['cfgSignupBonus', 'cfgCommentReward'].forEach(id => {
        const input = document.getElementById(id);
        if (input) {
            input.addEventListener('change', async (e) => {
                const config = systemConfigCache['rewards'] || {};
                const fieldMap = {
                    'cfgSignupBonus': 'signup_bonus',
                    'cfgCommentReward': 'comment_reward'
                };
                const normalizedValue = Math.max(0, toPointNumber(e.target.value, 0));
                e.target.value = normalizedValue;
                config[fieldMap[id]] = normalizedValue;
                if (await saveConfig('rewards', config)) {
                    showSaveIndicator(e.target);
                }
            });
        }
    });

    ['cfgDailyCheckin', 'cfgCheckinStreakBonus', 'cfgCheckinPerfectBonus', 'cfgCheckinMakeupCost'].forEach(id => {
        const input = document.getElementById(id);
        if (input) {
            input.addEventListener('change', async (e) => {
                const config = normalizeCheckinConfig(systemConfigCache['checkin_system']);
                const fieldMap = {
                    'cfgDailyCheckin': 'base_points',
                    'cfgCheckinStreakBonus': 'consecutive_7_points',
                    'cfgCheckinPerfectBonus': 'perfect_month_points',
                    'cfgCheckinMakeupCost': 'makeup_cost_points'
                };
                const normalizedValue = Math.max(0, toPointNumber(e.target.value, config[fieldMap[id]]));
                e.target.value = normalizedValue;
                config[fieldMap[id]] = normalizedValue;
                if (await saveConfig('checkin_system', config)) {
                    showSaveIndicator(e.target);
                }
            });
        }
    });

    setupGeneralSettingsEventListeners();

    // Setup security event listeners
    setupSecurityEventListeners();

    // Setup notifications event listeners
    setupNotificationsEventListeners();

    // Setup moderation event listeners
    setupModerationEventListeners();
}

function setupGeneralSettingsEventListeners() {
    const bindToggle = (elementId, configKey, field) => {
        const element = document.getElementById(elementId);
        if (!element || element.dataset.configBound === '1') {
            return;
        }

        element.dataset.configBound = '1';
        element.addEventListener('change', async (event) => {
            const config = configKey === 'integrations'
                ? normalizeIntegrationsConfig(systemConfigCache[configKey])
                : normalizePerformanceConfig(systemConfigCache[configKey]);

            config[field] = event.target.checked;
            await saveConfig(configKey, config);
        });
    };

    bindToggle('cfgGoogleLogin', 'integrations', 'google_login_enabled');
    bindToggle('cfgWechatLogin', 'integrations', 'wechat_login_enabled');
    bindToggle('cfgSupabaseRealtime', 'integrations', 'supabase_realtime_enabled');
    bindToggle('cfgLazyLoad', 'performance', 'lazy_load_enabled');

    const imageQualityInput = document.getElementById('cfgImageQuality');
    if (imageQualityInput && imageQualityInput.dataset.configBound !== '1') {
        imageQualityInput.dataset.configBound = '1';

        imageQualityInput.addEventListener('input', (event) => {
            const output = document.getElementById('cfgImageQualityValue');
            if (output) output.textContent = `${event.target.value}%`;
        });

        imageQualityInput.addEventListener('change', (event) => {
            const normalizedValue = Math.min(100, Math.max(60, parseInt(event.target.value, 10) || 85));
            event.target.value = normalizedValue;
            const output = document.getElementById('cfgImageQualityValue');
            if (output) output.textContent = `${normalizedValue}%`;

            debouncedSave('performance.image_quality', async () => {
                const config = normalizePerformanceConfig(systemConfigCache['performance']);
                config.image_quality = normalizedValue;
                await saveConfig('performance', config);
            }, 150);
        });
    }
}

// Toggle card collapse
function toggleConfigCard(headerEl) {
    const card = headerEl.closest('.config-card');
    if (card) {
        card.classList.toggle('collapsed');
    }
}

// ============================================
// PACKAGES CRUD
// ============================================

async function updatePackage(index, field, value) {
    const packages = systemConfigCache['packages'] || [];
    if (packages[index]) {
        packages[index][field] = normalizePackageFieldValue(field, value, packages[index][field]);
        await saveConfig('packages', packages);
    }
}

async function togglePackageStatus(index) {
    const packages = systemConfigCache['packages'] || [];
    if (!packages[index]) return;

    // Immediately toggle and update UI (optimistic update)
    packages[index].enabled = !packages[index].enabled;

    // Instantly update the toggle visual
    const toggleEl = document.querySelector(`#packagesTableBody tr[data-index="${index}"] .status-toggle`);
    if (toggleEl) {
        toggleEl.classList.toggle('active', packages[index].enabled);
        pulseAdminConfigToggle(toggleEl);
    }

    // Save in background (don't wait)
    saveConfig('packages', packages).catch(err => {
        // Revert on error
        console.error('[Config] Toggle save failed:', err);
        packages[index].enabled = !packages[index].enabled;
        if (toggleEl) toggleEl.classList.toggle('active', packages[index].enabled);
    });
}

async function deletePackage(index) {
    if (!confirm('确定删除这个礼包吗？')) return;

    const packages = systemConfigCache['packages'] || [];
    packages.splice(index, 1);

    // Optimistic update - render immediately
    renderPackagesConfig();

    // Save in background
    saveConfig('packages', packages);
}

async function addPackageRow() {
    const packages = systemConfigCache['packages'] || [];
    const newId = Math.max(...packages.map(p => p.id || 0), 0) + 1;

    packages.push({
        id: newId,
        name: '新礼包',
        points: 100,
        bonus: 0,
        price: 9.9,
        enabled: true,
        sort: packages.length + 1
    });

    // Optimistic update - render immediately
    renderPackagesConfig();

    // Save in background
    saveConfig('packages', packages);
}

async function toggleCustomRechargeEntryStatus() {
    const config = normalizeRechargeOptionsConfig(systemConfigCache['recharge_options']);
    const toggleEl = document.getElementById('customRechargeStatusToggle');
    const nextValue = !config.custom_amount_enabled;

    config.custom_amount_enabled = nextValue;

    if (toggleEl) {
        toggleEl.classList.toggle('active', nextValue);
        pulseAdminConfigToggle(toggleEl);
    }

    const success = await saveConfig('recharge_options', config);
    if (!success) {
        config.custom_amount_enabled = !nextValue;
        if (toggleEl) {
            toggleEl.classList.toggle('active', config.custom_amount_enabled);
        }
        return false;
    }

    showConfigSavedToast(nextValue ? '已开启自定义充值入口' : '已关闭自定义充值入口');
    return true;
}

function collectPaymentChannelsConfigFromForm() {
    const currentConfig = normalizePaymentChannelsConfig(systemConfigCache['payment_channels']);
    const activeSelect = document.getElementById('paymentChannelActiveSelect');
    const activeProvider = ['mock', 'afdian', 'hupijiao'].includes(activeSelect?.value)
        ? activeSelect.value
        : currentConfig.active_provider;

    const config = {
        active_provider: activeProvider,
        providers: {
            mock: {
                enabled: document.getElementById('paymentProviderMockToggle')?.classList.contains('active') ?? currentConfig.providers.mock.enabled,
                display_name: document.getElementById('paymentProviderMockDisplayName')?.value?.trim() || currentConfig.providers.mock.display_name,
                description: document.getElementById('paymentProviderMockDescription')?.value?.trim() || currentConfig.providers.mock.description
            },
            afdian: {
                enabled: document.getElementById('paymentProviderAfdianToggle')?.classList.contains('active') ?? currentConfig.providers.afdian.enabled,
                display_name: document.getElementById('paymentProviderAfdianDisplayName')?.value?.trim() || currentConfig.providers.afdian.display_name,
                checkout_url: document.getElementById('paymentProviderAfdianCheckoutUrl')?.value?.trim() || currentConfig.providers.afdian.checkout_url,
                package_hint: document.getElementById('paymentProviderAfdianPackageHint')?.value?.trim() || currentConfig.providers.afdian.package_hint,
                custom_amount_hint: document.getElementById('paymentProviderAfdianCustomHint')?.value?.trim() || currentConfig.providers.afdian.custom_amount_hint
            },
            hupijiao: {
                enabled: document.getElementById('paymentProviderHupijiaoToggle')?.classList.contains('active') ?? currentConfig.providers.hupijiao.enabled,
                display_name: document.getElementById('paymentProviderHupijiaoDisplayName')?.value?.trim() || currentConfig.providers.hupijiao.display_name,
                checkout_url: document.getElementById('paymentProviderHupijiaoCheckoutUrl')?.value?.trim() || currentConfig.providers.hupijiao.checkout_url,
                gateway_url: document.getElementById('paymentProviderHupijiaoGatewayUrl')?.value?.trim() || currentConfig.providers.hupijiao.gateway_url,
                merchant_id: document.getElementById('paymentProviderHupijiaoMerchantId')?.value?.trim() || currentConfig.providers.hupijiao.merchant_id,
                return_url: document.getElementById('paymentProviderHupijiaoReturnUrl')?.value?.trim() || currentConfig.providers.hupijiao.return_url,
                notify_url: document.getElementById('paymentProviderHupijiaoNotifyUrl')?.value?.trim() || currentConfig.providers.hupijiao.notify_url,
                package_hint: document.getElementById('paymentProviderHupijiaoPackageHint')?.value?.trim() || currentConfig.providers.hupijiao.package_hint,
                custom_amount_hint: document.getElementById('paymentProviderHupijiaoCustomHint')?.value?.trim() || currentConfig.providers.hupijiao.custom_amount_hint
            }
        }
    };

    if (!config.providers[config.active_provider]?.enabled) {
        config.providers[config.active_provider].enabled = true;
    }

    return normalizePaymentChannelsConfig(config);
}

function clearPaymentChannelSecretInputs() {
    [
        'paymentProviderAfdianToken',
        'paymentProviderHupijiaoApiKey',
        'paymentProviderHupijiaoSecretKey'
    ].forEach((id) => {
        const input = document.getElementById(id);
        if (input) input.value = '';
    });
}

async function savePaymentChannelSettings(options = {}) {
    try {
        const config = options.configOverride
            ? normalizePaymentChannelsConfig(options.configOverride)
            : collectPaymentChannelsConfigFromForm();
        const headers = await getAdminConfigApiHeaders();
        const body = {
            config,
            secrets: {
                afdian_token: document.getElementById('paymentProviderAfdianToken')?.value?.trim() || '',
                hupijiao_api_key: document.getElementById('paymentProviderHupijiaoApiKey')?.value?.trim() || '',
                hupijiao_secret_key: document.getElementById('paymentProviderHupijiaoSecretKey')?.value?.trim() || ''
            }
        };

        const response = await fetch('/api/admin/settings/payment-channels', {
            method: 'POST',
            headers,
            body: JSON.stringify(body)
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.success) {
            throw new Error(payload.message || '保存支付通道配置失败');
        }

        systemConfigCache['payment_channels'] = normalizePaymentChannelsConfig(payload.config);
        paymentChannelSecretStatus = payload.secrets || getDefaultPaymentChannelSecretStatus();
        paymentChannelRuntimeState = normalizePaymentChannelRuntimeState(payload.runtime);

        const rechargeOptions = normalizeRechargeOptionsConfig(systemConfigCache['recharge_options']);
        rechargeOptions.mock_payment_enabled = systemConfigCache['payment_channels'].active_provider === 'mock';
        systemConfigCache['recharge_options'] = rechargeOptions;

        renderPaymentChannelsConfig();
        renderPackagesConfig();
        clearPaymentChannelSecretInputs();
        showConfigSavedToast(options.successMessage || payload.message || '支付通道配置已保存');
        return true;
    } catch (err) {
        console.error('[Config] Save payment channels failed:', err);
        showToast('保存失败: ' + (err.message || '未知错误'), 'error');
        renderPaymentChannelsConfig();
        renderPackagesConfig();
        return false;
    }
}

async function togglePaymentProviderEnabled(providerKey) {
    const toggleMap = {
        mock: 'paymentProviderMockToggle',
        afdian: 'paymentProviderAfdianToggle',
        hupijiao: 'paymentProviderHupijiaoToggle'
    };
    const toggleEl = document.getElementById(toggleMap[providerKey]);
    if (!toggleEl) return;

    const nextValue = !toggleEl.classList.contains('active');
    toggleEl.classList.toggle('active', nextValue);
    pulseAdminConfigToggle(toggleEl);

    if (nextValue) {
        setPaymentProviderPanelExpanded(providerKey, true);
    } else {
        setPaymentProviderPanelExpanded(providerKey, false);
    }

    const activeSelect = document.getElementById('paymentChannelActiveSelect');
    if (!nextValue && activeSelect?.value === providerKey) {
        const fallback = ['mock', 'afdian', 'hupijiao'].find((key) => key !== providerKey && document.getElementById(toggleMap[key])?.classList.contains('active'));
        if (fallback) {
            activeSelect.value = fallback;
        } else {
            toggleEl.classList.add('active');
            showToast('至少需要保留一个可用的支付通道', 'warning');
        }
    }

    applyPaymentChannelOverview(collectPaymentChannelsConfigFromForm());
}

async function toggleMockPaymentStatus() {
    const currentConfig = normalizePaymentChannelsConfig(systemConfigCache['payment_channels']);
    const nextValue = !(normalizeRechargeOptionsConfig(systemConfigCache['recharge_options']).mock_payment_enabled);

    if (nextValue) {
        currentConfig.active_provider = 'mock';
        currentConfig.providers.mock.enabled = true;
    } else if (currentConfig.active_provider === 'mock') {
        currentConfig.active_provider = currentConfig.providers.afdian.enabled ? 'afdian' : 'hupijiao';
        if (!currentConfig.providers[currentConfig.active_provider]?.enabled) {
            currentConfig.providers.afdian.enabled = true;
            currentConfig.active_provider = 'afdian';
        }
    }

    return savePaymentChannelSettings({
        configOverride: currentConfig,
        successMessage: nextValue ? '已开启临时模拟支付' : '已关闭临时模拟支付'
    });
}

function collectOpsAlertConfigFromForm() {
    const currentConfig = normalizeOpsAlertConfig(systemConfigCache['ops_alerts']);
    const nextConfig = {
        ...currentConfig,
        channels: {
            telegram: {
                ...currentConfig.channels.telegram
            },
            feishu: {
                ...currentConfig.channels.feishu
            }
        }
    };

    nextConfig.enabled = document.getElementById('opsAlertEnabledToggle')?.classList.contains('active') ?? currentConfig.enabled;
    nextConfig.channels.telegram.enabled = document.getElementById('opsAlertTelegramEnabledToggle')?.classList.contains('active')
        ?? currentConfig.channels.telegram.enabled;
    nextConfig.channels.telegram.chat_ids = normalizeConfigStringArray(
        document.getElementById('opsAlertTelegramChatIds')?.value ?? currentConfig.channels.telegram.chat_ids
    );
    nextConfig.channels.telegram.minimum_severity = normalizeOpsAlertSeverity(
        document.getElementById('opsAlertTelegramSeverity')?.value,
        currentConfig.channels.telegram.minimum_severity
    );
    nextConfig.channels.feishu.enabled = document.getElementById('opsAlertFeishuEnabledToggle')?.classList.contains('active')
        ?? currentConfig.channels.feishu.enabled;
    nextConfig.channels.feishu.minimum_severity = normalizeOpsAlertSeverity(
        document.getElementById('opsAlertFeishuSeverity')?.value,
        currentConfig.channels.feishu.minimum_severity
    );

    return normalizeOpsAlertConfig(nextConfig);
}

function clearOpsAlertSecretInputs() {
    [
        'opsAlertTelegramBotToken',
        'opsAlertFeishuWebhookUrl'
    ].forEach((id) => {
        const input = document.getElementById(id);
        if (input) input.value = '';
    });
}

async function saveOpsAlertSettings() {
    try {
        const config = collectOpsAlertConfigFromForm();
        const headers = await getAdminConfigApiHeaders();
        const body = {
            config,
            secrets: {
                telegram_bot_token: document.getElementById('opsAlertTelegramBotToken')?.value?.trim() || '',
                feishu_webhook_url: document.getElementById('opsAlertFeishuWebhookUrl')?.value?.trim() || ''
            }
        };

        const response = await fetch('/api/admin/settings/ops-alerts', {
            method: 'POST',
            headers,
            body: JSON.stringify(body)
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.success) {
            throw new Error(payload.message || '保存站外退款告警配置失败');
        }

        systemConfigCache['ops_alerts'] = normalizeOpsAlertConfig(payload.config);
        opsAlertSecretStatus = payload.secrets || getDefaultOpsAlertSecretStatus();
        renderOpsAlertSettings();
        clearOpsAlertSecretInputs();
        showConfigSavedToast(payload.message || '站外退款告警配置已保存');
        return true;
    } catch (error) {
        console.error('[Config] Save ops alert settings failed:', error);
        showToast('保存失败: ' + (error.message || '未知错误'), 'error');
        renderOpsAlertSettings();
        return false;
    }
}

async function sendOpsAlertTelegramRequest(action, fallbackMessage) {
    const config = collectOpsAlertConfigFromForm();
    const telegramEnabled = config.channels?.telegram?.enabled === true;
    const feishuEnabled = config.channels?.feishu?.enabled === true;
    const chatIds = Array.isArray(config.channels?.telegram?.chat_ids)
        ? config.channels.telegram.chat_ids
        : [];
    const hasStoredTelegramToken = Boolean(opsAlertSecretStatus?.telegram_bot_token?.configured);
    const hasStoredFeishuWebhook = Boolean(opsAlertSecretStatus?.feishu_webhook_url?.configured);
    const providedTelegramToken = document.getElementById('opsAlertTelegramBotToken')?.value?.trim() || '';
    const providedFeishuWebhook = document.getElementById('opsAlertFeishuWebhookUrl')?.value?.trim() || '';

    if (!telegramEnabled && !feishuEnabled) {
        throw new Error('请先启用至少一个站外告警通道');
    }

    if (telegramEnabled) {
        if (!chatIds.length) {
            throw new Error('已启用 Telegram 告警，请先填写至少一个 Telegram Chat ID');
        }

        if (!providedTelegramToken && !hasStoredTelegramToken) {
            throw new Error('已启用 Telegram 告警，请先填写 Telegram Bot Token，或先保存已配置的后台密钥');
        }
    }

    if (feishuEnabled && !providedFeishuWebhook && !hasStoredFeishuWebhook) {
        throw new Error('已启用飞书告警，请先填写飞书 Webhook，或先保存已配置的后台密钥');
    }

    const headers = await getAdminConfigApiHeaders();
    const response = await fetch('/api/admin/settings/ops-alerts', {
        method: 'POST',
        headers,
        body: JSON.stringify({
            action,
            config,
            secrets: {
                telegram_bot_token: providedTelegramToken,
                feishu_webhook_url: providedFeishuWebhook
            }
        })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.success) {
        throw new Error(payload.message || fallbackMessage);
    }

    showConfigSavedToast(payload.message || fallbackMessage);
    return true;
}

async function sendOpsAlertTelegramTest() {
    try {
        return await sendOpsAlertTelegramRequest('send_test_telegram', '测试站外告警已发送');
    } catch (error) {
        console.error('[Config] Send ops alert test failed:', error);
        showToast('发送失败: ' + (error.message || '未知错误'), 'error');
        return false;
    }
}

async function sendOpsAlertRefundSample() {
    try {
        return await sendOpsAlertTelegramRequest('send_sample_refund_telegram', '退款详情示例消息已发送');
    } catch (error) {
        console.error('[Config] Send Telegram refund sample failed:', error);
        showToast('发送失败: ' + (error.message || '未知错误'), 'error');
        return false;
    }
}

async function sendOpsAlertGatewaySample() {
    try {
        return await sendOpsAlertTelegramRequest('send_sample_gateway_degraded', '支付通道异常示例消息已发送');
    } catch (error) {
        console.error('[Config] Send payment gateway degraded sample failed:', error);
        showToast('发送失败: ' + (error.message || '未知错误'), 'error');
        return false;
    }
}

async function sendOpsAlertVerifyServiceDisabledSample() {
    try {
        return await sendOpsAlertTelegramRequest('send_sample_verify_service_disabled', '验证服务停摆示例消息已发送');
    } catch (error) {
        console.error('[Config] Send verify service disabled sample failed:', error);
        showToast('发送失败: ' + (error.message || '未知错误'), 'error');
        return false;
    }
}

async function sendOpsAlertVerifyQueueBacklogSample() {
    try {
        return await sendOpsAlertTelegramRequest('send_sample_verify_queue_backlog', '验证任务堆积示例消息已发送');
    } catch (error) {
        console.error('[Config] Send verify queue backlog sample failed:', error);
        showToast('发送失败: ' + (error.message || '未知错误'), 'error');
        return false;
    }
}

async function sendOpsAlertVerifyFailureRateSpikeSample() {
    try {
        return await sendOpsAlertTelegramRequest('send_sample_verify_failure_rate_spike', '验证失败率异常示例消息已发送');
    } catch (error) {
        console.error('[Config] Send verify failure rate spike sample failed:', error);
        showToast('发送失败: ' + (error.message || '未知错误'), 'error');
        return false;
    }
}

async function sendOpsAlertVerifyIncidentEscalatedSample() {
    try {
        return await sendOpsAlertTelegramRequest('send_sample_verify_incident_escalated', '验证综合异常示例消息已发送');
    } catch (error) {
        console.error('[Config] Send verify incident escalation sample failed:', error);
        showToast('发送失败: ' + (error.message || '未知错误'), 'error');
        return false;
    }
}

async function sendOpsAlertVerifyIncidentRecoveredSample() {
    try {
        return await sendOpsAlertTelegramRequest('send_sample_verify_incident_recovered', '验证恢复示例消息已发送');
    } catch (error) {
        console.error('[Config] Send verify incident recovered sample failed:', error);
        showToast('发送失败: ' + (error.message || '未知错误'), 'error');
        return false;
    }
}

async function sendOpsAlertVerifyQuotaSample() {
    try {
        return await sendOpsAlertTelegramRequest('send_sample_verify_quota_low', '验证额度告警示例消息已发送');
    } catch (error) {
        console.error('[Config] Send verify quota sample failed:', error);
        showToast('发送失败: ' + (error.message || '未知错误'), 'error');
        return false;
    }
}

async function sendOpsAlertTicketSlaSample() {
    try {
        return await sendOpsAlertTelegramRequest('send_sample_ticket_sla_overdue', '工单超时示例消息已发送');
    } catch (error) {
        console.error('[Config] Send ticket SLA sample failed:', error);
        showToast('发送失败: ' + (error.message || '未知错误'), 'error');
        return false;
    }
}

async function sendOpsAlertShopInventorySample() {
    try {
        return await sendOpsAlertTelegramRequest('send_sample_shop_inventory_low', '库存预警示例消息已发送');
    } catch (error) {
        console.error('[Config] Send shop inventory sample failed:', error);
        showToast('发送失败: ' + (error.message || '未知错误'), 'error');
        return false;
    }
}

async function sendOpsAlertAdminLoginAnomalySample() {
    try {
        return await sendOpsAlertTelegramRequest('send_sample_admin_login_anomaly', '管理员异常登录示例消息已发送');
    } catch (error) {
        console.error('[Config] Send admin login anomaly sample failed:', error);
        showToast('发送失败: ' + (error.message || '未知错误'), 'error');
        return false;
    }
}

async function sendOpsAlertShopOrderDeliveryFailedSample() {
    try {
        return await sendOpsAlertTelegramRequest('send_sample_shop_order_delivery_failed', '履约失败示例消息已发送');
    } catch (error) {
        console.error('[Config] Send shop order delivery failed sample failed:', error);
        showToast('发送失败: ' + (error.message || '未知错误'), 'error');
        return false;
    }
}

async function sendOpsAlertPaymentConfigChangedSample() {
    try {
        return await sendOpsAlertTelegramRequest('send_sample_payment_config_changed', '支付配置变更示例消息已发送');
    } catch (error) {
        console.error('[Config] Send payment config changed sample failed:', error);
        showToast('发送失败: ' + (error.message || '未知错误'), 'error');
        return false;
    }
}

async function deleteOpsAlertSecret(secretName) {
    const secretLabels = {
        telegram_bot_token: 'Telegram Bot Token',
        feishu_webhook_url: '飞书 Webhook'
    };
    const normalizedSecretName = String(secretName || '').trim();
    if (!secretLabels[normalizedSecretName]) {
        showToast('无效的站外告警密钥标识', 'warning');
        return false;
    }

    const currentStatus = opsAlertSecretStatus?.[normalizedSecretName];
    if (currentStatus?.source === 'environment') {
        showToast(`${secretLabels[normalizedSecretName]} 当前来自环境变量，请在部署平台里删除。`, 'warning');
        return false;
    }

    if (!confirm(`确定删除 ${secretLabels[normalizedSecretName]} 吗？删除后将无法继续通过该通道发送站外退款告警。`)) {
        return false;
    }

    try {
        const headers = await getAdminConfigApiHeaders();
        const response = await fetch('/api/admin/settings/ops-alerts', {
            method: 'DELETE',
            headers,
            body: JSON.stringify({ secretName: normalizedSecretName })
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.success) {
            throw new Error(payload.message || '删除站外告警密钥失败');
        }

        systemConfigCache['ops_alerts'] = normalizeOpsAlertConfig(payload.config);
        opsAlertSecretStatus = payload.secrets || getDefaultOpsAlertSecretStatus();
        renderOpsAlertSettings();
        clearOpsAlertSecretInputs();
        showConfigSavedToast(payload.message || '站外告警密钥已删除');
        return true;
    } catch (error) {
        console.error('[Config] Delete ops alert secret failed:', error);
        showToast('删除失败: ' + (error.message || '未知错误'), 'error');
        renderOpsAlertSettings();
        return false;
    }
}

function toggleOpsAlertsEnabled() {
    const toggleEl = document.getElementById('opsAlertEnabledToggle');
    if (!toggleEl) return;

    toggleEl.classList.toggle('active');
    pulseAdminConfigToggle(toggleEl);
    applyOpsAlertOverview(collectOpsAlertConfigFromForm());
}

function toggleOpsAlertChannelEnabled(channelKey) {
    const toggleMap = {
        telegram: 'opsAlertTelegramEnabledToggle',
        feishu: 'opsAlertFeishuEnabledToggle'
    };
    const toggleEl = document.getElementById(toggleMap[channelKey]);
    if (!toggleEl) return;

    toggleEl.classList.toggle('active');
    pulseAdminConfigToggle(toggleEl);
    applyOpsAlertOverview(collectOpsAlertConfigFromForm());
}

// ============================================
// CHANNELS CRUD
// ============================================

async function deleteChannel(index) {
    const channels = systemConfigCache['channels'] || [];
    channels.splice(index, 1);
    await saveConfig('channels', channels);
    renderChannelsConfig();
}

async function addChannel() {
    const input = document.getElementById('newChannelName');
    const name = input?.value.trim();
    if (!name) return;

    const channels = systemConfigCache['channels'] || [];
    const newId = Math.max(...channels.map(c => c.id || 0), 0) + 1;

    channels.push({
        id: newId,
        name: name,
        icon: 'tag',
        is_default: false
    });

    await saveConfig('channels', channels);
    renderChannelsConfig();

    if (input) input.value = '';
}

// ============================================
// SECURITY SETTINGS
// ============================================

function renderSecurityConfig() {
    const config = systemConfigCache['security'] || {
        login_lockout_attempts: 5,
        lockout_duration: 900000,
        session_timeout: 3600000,
        ip_blacklist: []
    };

    // Login lockout attempts
    const lockoutInput = document.getElementById('cfgLoginLockoutAttempts');
    if (lockoutInput) lockoutInput.value = config.login_lockout_attempts || 5;

    // Lockout duration dropdown (now shows minutes only)
    const lockoutDurationValue = document.getElementById('lockoutDurationValue');
    if (lockoutDurationValue) {
        const duration = config.lockout_duration || 900000;
        const minutes = Math.round(duration / 60000);
        lockoutDurationValue.textContent = minutes;
    }

    // Session timeout dropdown (now shows minutes only)
    const sessionTimeoutValue = document.getElementById('sessionTimeoutValue');
    if (sessionTimeoutValue) {
        const timeout = config.session_timeout || 3600000;
        const minutes = Math.round(timeout / 60000);
        sessionTimeoutValue.textContent = minutes;
    }

    // IP blacklist
    const blacklistTextarea = document.getElementById('cfgIpBlacklist');
    if (blacklistTextarea) {
        const ips = config.ip_blacklist || [];
        blacklistTextarea.value = ips.join('\n');
    }
}

async function saveIpBlacklist() {
    const textarea = document.getElementById('cfgIpBlacklist');
    if (!textarea) return;

    const lines = textarea.value.split('\n').map(l => l.trim()).filter(l => l);
    const config = systemConfigCache['security'] || {};
    config.ip_blacklist = lines;

    const success = await saveConfig('security', config);

    const indicator = document.getElementById('ipBlacklistSaveIndicator');
    if (indicator && success) {
        showAdminConfigSaveIndicator(indicator, '✓ 已保存', 2000);
    }
}

function setupSecurityEventListeners() {
    // Login lockout attempts - no auto-save, user will click save button
    // We removed the auto-save to require explicit save button click

    // Load locked accounts when security settings view is shown
    document.querySelectorAll('[data-settings-view="security"]').forEach(btn => {
        btn.addEventListener('click', () => {
            setTimeout(refreshLockedAccounts, 300);
        });
    });
}

// ============================================
// LOGIN SECURITY FUNCTIONS
// ============================================

// Save all login security settings at once
async function saveLoginSecuritySettings() {
    try {
        const lockoutInput = document.getElementById('cfgLoginLockoutAttempts');
        const lockoutDurationValue = document.getElementById('lockoutDurationValue');
        const sessionTimeoutValue = document.getElementById('sessionTimeoutValue');

        // Map display values (minutes) to milliseconds
        const durationMinutes = parseInt(lockoutDurationValue?.textContent) || 15;
        const timeoutMinutes = parseInt(sessionTimeoutValue?.textContent) || 60;

        const config = systemConfigCache['security'] || {};
        config.login_lockout_attempts = parseInt(lockoutInput?.value) || 5;
        config.lockout_duration = durationMinutes * 60 * 1000; // minutes to ms
        config.session_timeout = timeoutMinutes * 60 * 1000; // minutes to ms

        const success = await saveConfig('security', config);

        if (success) {
            const indicator = document.getElementById('loginSecuritySaveIndicator');
            if (indicator) {
                showAdminConfigSaveIndicator(indicator, '✓ 已保存', 2000);
            }
            if (typeof showToast === 'function') {
                showToast('登录安全设置已保存', 'success');
            }
        }
    } catch (err) {
        console.error('保存登录安全设置失败:', err);
        if (typeof showToast === 'function') {
            showToast('保存失败: ' + err.message, 'error');
        }
    }
}

// Refresh locked accounts list
async function refreshLockedAccounts() {
    const listEl = document.getElementById('lockedAccountsList');
    const badgeEl = document.getElementById('lockedCountBadge');
    const unlockAllBtn = document.getElementById('unlockAllBtn');
    const emptyMsg = document.getElementById('noLockedAccountsMsg');

    if (!listEl) return;

    try {
        // Query profiles with locked_until > now
        const { data: lockedAccounts, error } = await supabaseClient
            .from('profiles')
            .select('id, username, failed_login_attempts, locked_until')
            .gt('locked_until', new Date().toISOString())
            .order('locked_until', { ascending: false });

        if (error) throw error;

        // Get emails from auth.users via admin view
        let accountsWithEmail = lockedAccounts || [];

        // Try to get emails if admin view exists
        try {
            const { data: usersData } = await supabaseClient
                .from('admin_users_view')
                .select('id, email')
                .in('id', accountsWithEmail.map(a => a.id));

            if (usersData) {
                const emailMap = {};
                usersData.forEach(u => emailMap[u.id] = u.email);
                accountsWithEmail = accountsWithEmail.map(a => ({
                    ...a,
                    email: emailMap[a.id] || a.username || a.id.substring(0, 8) + '...'
                }));
            }
        } catch (e) {
            // Fallback to username if admin view not available
            accountsWithEmail = accountsWithEmail.map(a => ({
                ...a,
                email: a.username || a.id.substring(0, 8) + '...'
            }));
        }

        // Update badge
        if (badgeEl) {
            badgeEl.textContent = accountsWithEmail.length;
            setAdminConfigHiddenState(badgeEl, accountsWithEmail.length === 0);
        }

        // Update unlock all button
        if (unlockAllBtn) {
            setAdminConfigHiddenState(unlockAllBtn, accountsWithEmail.length === 0);
        }

        // Render list
        if (accountsWithEmail.length === 0) {
            setAdminConfigHiddenState(emptyMsg, false);
            // Remove any account items
            listEl.querySelectorAll('.locked-account-item').forEach(el => el.remove());
        } else {
            setAdminConfigHiddenState(emptyMsg, true);

            // Clear existing items
            listEl.querySelectorAll('.locked-account-item').forEach(el => el.remove());

            // Render locked accounts
            accountsWithEmail.forEach(account => {
                const expiresAt = new Date(account.locked_until);
                const now = new Date();
                const remainingMs = expiresAt - now;
                const remainingMins = Math.ceil(remainingMs / 60000);

                const itemHtml = `
                    <div class="locked-account-item" data-user-id="${account.id}">
                        <div class="locked-account-info">
                            <div class="locked-account-email">${escapeHtml(account.email)}</div>
                            <div class="locked-account-meta">
                                <span class="attempts">${account.failed_login_attempts} 次失败</span>
                                <span class="expires"><i class="fas fa-clock"></i> ${remainingMins} 分钟后解锁</span>
                            </div>
                        </div>
                        <button class="btn-unlock"
                            type="button"
                            data-admin-action="settings-unlock-account"
                            data-user-id="${escapeHtml(account.id)}">
                            <i class="fas fa-unlock"></i> 解锁
                        </button>
                    </div>
                `;
                listEl.insertAdjacentHTML('beforeend', itemHtml);
            });
        }

    } catch (err) {
        console.error('加载锁定账户失败:', err);
        if (typeof showToast === 'function') {
            showToast('加载失败: ' + err.message, 'error');
        }
    }
}

// Unlock a single account
async function unlockAccount(userId) {
    try {
        // Use RPC to bypass RLS
        const { data, error } = await supabaseClient
            .rpc('admin_unlock_account', { target_user_id: userId });

        if (error) throw error;

        if (typeof showToast === 'function') {
            showToast('账户已解锁', 'success');
        }

        // Refresh list
        await refreshLockedAccounts();

    } catch (err) {
        console.error('解锁账户失败:', err);
        if (typeof showToast === 'function') {
            showToast('解锁失败: ' + err.message, 'error');
        }
    }
}

// Unlock all accounts
async function unlockAllAccounts() {
    if (!confirm('确定要解锁所有账户吗？')) return;

    try {
        // Use RPC to bypass RLS
        const { data, error } = await supabaseClient
            .rpc('admin_unlock_all_accounts');

        if (error) throw error;

        if (typeof showToast === 'function') {
            showToast(`已解锁 ${data || 0} 个账户`, 'success');
        }

        // Refresh list
        await refreshLockedAccounts();

    } catch (err) {
        console.error('批量解锁失败:', err);
        if (typeof showToast === 'function') {
            showToast('解锁失败: ' + err.message, 'error');
        }
    }
}

// Helper function to escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Expose to window
window.saveLoginSecuritySettings = saveLoginSecuritySettings;
window.refreshLockedAccounts = refreshLockedAccounts;
window.unlockAccount = unlockAccount;
window.unlockAllAccounts = unlockAllAccounts;

// ============================================
// NOTIFICATIONS SETTINGS
// ============================================

function renderNotificationsConfig() {
    const config = systemConfigCache['notifications'] || {
        new_user_notify: false,
        announcement_enabled: false,
        announcement_content: '',
        announcement_type: 'banner',
        announcement_color: 'purple',
        announcement_size: 'medium',
        announcement_decoration: 'none',
        announcement_pages: ['all']
    };

    // New user notification toggle
    const newUserNotify = document.getElementById('cfgNewUserNotify');
    if (newUserNotify) newUserNotify.checked = config.new_user_notify || false;

    // Announcement enabled toggle
    const announcementEnabled = document.getElementById('cfgAnnouncementEnabled');
    if (announcementEnabled) announcementEnabled.checked = config.announcement_enabled || false;

    // Announcement content (for contenteditable div, use innerHTML)
    const announcementContent = document.getElementById('cfgAnnouncementContent');
    if (announcementContent) {
        announcementContent.innerHTML = config.announcement_content || '';
    }

    // Announcement type (radio buttons)
    const typeRadios = document.querySelectorAll('input[name="announcementType"]');
    typeRadios.forEach(radio => {
        if (radio.value === (config.announcement_type || 'banner')) {
            radio.checked = true;
        }
    });

    // Announcement color (radio buttons)
    const colorRadios = document.querySelectorAll('input[name="announcementColor"]');
    colorRadios.forEach(radio => {
        if (radio.value === (config.announcement_color || 'purple')) {
            radio.checked = true;
        }
    });

    // Decoration theme
    const savedDecoration = config.announcement_decoration || 'none';
    const decorationEnabled = document.getElementById('decorationEnabled');
    const decorationSelector = document.getElementById('decorationSelector');

    if (savedDecoration !== 'none' && decorationEnabled && decorationSelector) {
        decorationEnabled.checked = true;
        decorationSelector.classList.add('active');
        selectDecoration(savedDecoration);
    }

    // Page target selector - restore saved pages
    const savedPages = config.announcement_pages || ['all'];
    restorePageSelector(savedPages);

    // Update preview
    updateAnnouncementPreview();
}

function updateAnnouncementPreview() {
    const preview = document.getElementById('announcementPreview');
    if (!preview) return;

    const contentEl = document.getElementById('cfgAnnouncementContent');
    const typeRadio = document.querySelector('input[name="announcementType"]:checked');

    // For contenteditable div, use innerHTML; for textarea, use value
    const content = contentEl?.innerHTML || contentEl?.value || '在此预览公告效果...';
    const type = typeRadio?.value || 'banner';

    // Update preview content - target the new announcement-text element
    const textContent = document.getElementById('previewTextContent');
    if (textContent) {
        textContent.innerHTML = content || '在此预览公告效果...';
    }

    // Update type style (currently only modal style is truly supported in preview)
    preview.classList.remove('modal-style', 'toast-style');
    if (type === 'modal') {
        preview.classList.add('modal-style');
    } else if (type === 'toast') {
        preview.classList.add('toast-style');
    }
}

async function saveAnnouncement() {
    const contentEl = document.getElementById('cfgAnnouncementContent');
    const enabledEl = document.getElementById('cfgAnnouncementEnabled');
    const typeRadio = document.querySelector('input[name="announcementType"]:checked');

    if (!contentEl) return;

    const config = systemConfigCache['notifications'] || {};
    // For contenteditable div, use innerHTML
    config.announcement_content = contentEl.innerHTML || contentEl.value || '';
    config.announcement_enabled = enabledEl?.checked || false;
    config.announcement_type = typeRadio?.value || 'banner';
    // Save decoration theme
    config.announcement_decoration = getCurrentDecoration();
    // Save target pages
    config.announcement_pages = getSelectedPages();
    // Add timestamp so each publish generates a new ackKey
    config.announcement_updated_at = new Date().toISOString();

    const success = await saveConfig('notifications', config);

    // Get the save button
    const saveBtn = document.querySelector('.editor-actions .btn-primary');

    if (success && saveBtn) {
        if (typeof showToast === 'function') {
            showToast('公告已发布', 'success');
        } else {
            console.warn('showToast function not found');
        }
    }
}

function setupNotificationsEventListeners() {
    // New user notification toggle
    const newUserNotify = document.getElementById('cfgNewUserNotify');
    if (newUserNotify) {
        newUserNotify.addEventListener('change', async (e) => {
            const config = systemConfigCache['notifications'] || {};
            config.new_user_notify = e.target.checked;
            await saveConfig('notifications', config);
        });
    }

    // Announcement enabled toggle
    const announcementEnabled = document.getElementById('cfgAnnouncementEnabled');
    if (announcementEnabled) {
        announcementEnabled.addEventListener('change', async (e) => {
            const config = systemConfigCache['notifications'] || {};
            config.announcement_enabled = e.target.checked;
            await saveConfig('notifications', config);
        });
    }

    // Type radio buttons - update preview
    const typeRadios = document.querySelectorAll('input[name="announcementType"]');
    typeRadios.forEach(radio => {
        radio.addEventListener('change', updateAnnouncementPreview);
    });

    // Color radio buttons - update preview
    const colorRadios = document.querySelectorAll('input[name="announcementColor"]');
    colorRadios.forEach(radio => {
        radio.addEventListener('change', updateAnnouncementPreview);
    });

    // Content editor - update preview on input
    const contentEl = document.getElementById('cfgAnnouncementContent');
    if (contentEl) {
        contentEl.addEventListener('input', updateAnnouncementPreview);
    }
}


// ============================================
// WYSIWYG TOOLBAR FUNCTIONS
// ============================================

const AdminRichTextEditor = (() => {
    const instances = new Map();
    const richTextTagPattern = /<\/?(?:a|b|strong|i|em|u|div|p|br|font|span|ul|ol|li)\b/i;
    const defaultEmojis = ['🎉', '📢', '⚠️', '✨', '🔥', '💡', '🎁', '❤️', '👍', '🚀', '🌟', '💯'];
    const defaultColors = [
        { value: '#ffffff', label: '白色' },
        { value: '#ffeb3b', label: '黄色' },
        { value: '#ff9800', label: '橙色' },
        { value: '#4caf50', label: '绿色' },
        { value: '#e57373', label: '红色' },
        { value: '#6b9ece', label: '蓝色' }
    ];
    const defaultSizes = [
        { value: '2', label: '小', className: 'small' },
        { value: '3', label: '中', className: 'medium' },
        { value: '5', label: '大', className: 'large' }
    ];

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function getInstance(key = 'announcement') {
        return instances.get(key) || null;
    }

    function isEditorEmpty(editor) {
        if (!editor) return true;
        const text = (editor.textContent || '').replace(/\u00a0/g, ' ').trim();
        return !text && !editor.querySelector('img, video, iframe, a, font, b, i, u, strong, em');
    }

    function serializeEditorHtml(editor) {
        return isEditorEmpty(editor) ? '' : editor.innerHTML;
    }

    function normalizeStoredContent(value) {
        if (typeof value !== 'string' || !value.trim()) return '';
        if (richTextTagPattern.test(value)) return value;
        return escapeHtml(value).replace(/\n/g, '<br>');
    }

    function placeCursorAtEnd(editor) {
        if (!editor) return;
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
    }

    function saveSelection(instance) {
        if (!instance?.editor) return;
        const selection = window.getSelection();
        if (!selection || !selection.rangeCount) return;
        const range = selection.getRangeAt(0);
        if (instance.editor.contains(range.commonAncestorContainer)) {
            instance.selection = range.cloneRange();
        }
    }

    function restoreSelection(instance) {
        if (!instance?.editor) return;
        const selection = window.getSelection();
        if (!selection) return;

        selection.removeAllRanges();
        if (instance.selection) {
            selection.addRange(instance.selection);
            return;
        }

        placeCursorAtEnd(instance.editor);
    }

    function syncHiddenInput(instance, invokeCallback = true) {
        if (!instance) return;
        if (instance.hiddenInput) {
            instance.hiddenInput.value = serializeEditorHtml(instance.editor);
        }
        if (invokeCallback && typeof instance.onInput === 'function') {
            instance.onInput(instance);
        }
    }

    function closeDropdownElement(dropdown) {
        if (!dropdown) return;
        dropdown.querySelector('.dropdown-trigger, .toolbar-btn')?.classList.remove('active');
        dropdown.querySelector('.dropdown-menu')?.classList.remove('show');
    }

    function closeFloatingPanels(exceptKey = null, exceptDropdownId = null) {
        instances.forEach(instance => {
            if (instance.key !== exceptKey) {
                instance.emojiPicker?.classList.remove('active');
                instance.alignPicker?.classList.remove('active');
            }

            Object.values(instance.dropdowns || {}).forEach(dropdown => {
                if (!dropdown) return;
                if (dropdown.id === exceptDropdownId) return;
                closeDropdownElement(dropdown);
            });
        });
    }

    function bindToolbarMouseDown(instance) {
        if (!instance?.toolbarRoot) return;
        instance.toolbarRoot.querySelectorAll('button').forEach(button => {
            if (button.dataset.rteMouseBound === '1') return;
            button.dataset.rteMouseBound = '1';
            button.addEventListener('mousedown', (event) => {
                event.preventDefault();
            });
        });
    }

    function updateColorUI(instance, color) {
        if (!instance) return;
        if (instance.colorPreview) {
            applyAdminConfigRichTextColorSwatch(instance.colorPreview, color, { preview: true });
        }
        const colorDropdown = instance.dropdowns?.color;
        colorDropdown?.querySelectorAll('.dropdown-item').forEach(item => {
            item.classList.toggle('selected', item.dataset.colorOption === color);
        });
    }

    function updateSizeUI(instance, size, sizeClass) {
        if (!instance) return;
        if (instance.sizePreview) {
            instance.sizePreview.className = `size-indicator ${sizeClass}`;
        }
        const sizeDropdown = instance.dropdowns?.size;
        sizeDropdown?.querySelectorAll('.dropdown-item').forEach(item => {
            item.classList.toggle('selected', item.dataset.sizeOption === size);
        });
    }

    function focusAndRestore(instance) {
        if (!instance?.editor) return false;
        instance.editor.focus();
        restoreSelection(instance);
        return true;
    }

    function execCommand(key, command, value = null) {
        const instance = getInstance(key);
        if (!focusAndRestore(instance)) return;

        document.execCommand(command, false, value);
        saveSelection(instance);
        syncHiddenInput(instance);
    }

    function createMarkup(config) {
        const colorItems = defaultColors.map(({ value, label }) => `
            <button type="button" class="dropdown-item${value === '#6b9ece' ? ' selected' : ''}"
                data-color-option="${value}"
                data-admin-action="settings-rich-text-select-color"
                data-rich-text-key="${config.key}"
                data-rich-text-color="${value}">
                <span class="color-swatch ${getAdminConfigRichTextColorClass(value)}"></span> ${label}
            </button>
        `).join('');

        const sizeItems = defaultSizes.map(({ value, label, className }) => `
            <button type="button" class="dropdown-item${value === '3' ? ' selected' : ''}"
                data-size-option="${value}"
                data-admin-action="settings-rich-text-select-font-size"
                data-rich-text-key="${config.key}"
                data-rich-text-size="${value}"
                data-rich-text-size-class="${className}">
                <span class="size-indicator ${className}">A</span> ${label}
            </button>
        `).join('');

        const emojiItems = defaultEmojis.map(emoji => `
            <button type="button" class="emoji-item"
                data-admin-action="settings-rich-text-select-emoji"
                data-rich-text-key="${config.key}"
                data-rich-text-emoji="${emoji}">${emoji}</button>
        `).join('');

        return `
            <div class="announcement-toolbar" id="${config.toolbarRootId}">
                <button type="button" class="toolbar-btn"
                    data-admin-action="settings-rich-text-format"
                    data-rich-text-key="${config.key}"
                    data-rich-text-format="b" title="加粗">
                    <i class="fas fa-bold"></i>
                </button>
                <button type="button" class="toolbar-btn"
                    data-admin-action="settings-rich-text-format"
                    data-rich-text-key="${config.key}"
                    data-rich-text-format="i" title="斜体">
                    <i class="fas fa-italic"></i>
                </button>
                <button type="button" class="toolbar-btn"
                    data-admin-action="settings-rich-text-format"
                    data-rich-text-key="${config.key}"
                    data-rich-text-format="u" title="下划线">
                    <i class="fas fa-underline"></i>
                </button>
                <div class="align-picker-container">
                    <button type="button" class="toolbar-btn" id="${config.alignButtonId}"
                        data-admin-action="settings-rich-text-toggle-align-picker"
                        data-rich-text-key="${config.key}" title="对齐">
                        <i class="fas fa-align-center"></i>
                    </button>
                    <div class="align-picker" id="${config.alignPickerId}">
                        <button type="button" class="align-item"
                            data-admin-action="settings-rich-text-apply-align"
                            data-rich-text-key="${config.key}"
                            data-rich-text-align="left" title="左对齐">
                            <i class="fas fa-align-left"></i>
                        </button>
                        <button type="button" class="align-item"
                            data-admin-action="settings-rich-text-apply-align"
                            data-rich-text-key="${config.key}"
                            data-rich-text-align="center" title="居中">
                            <i class="fas fa-align-center"></i>
                        </button>
                        <button type="button" class="align-item"
                            data-admin-action="settings-rich-text-apply-align"
                            data-rich-text-key="${config.key}"
                            data-rich-text-align="right" title="右对齐">
                            <i class="fas fa-align-right"></i>
                        </button>
                    </div>
                </div>
                <div class="toolbar-divider"></div>
                <button type="button" class="toolbar-btn"
                    data-admin-action="settings-rich-text-insert-link"
                    data-rich-text-key="${config.key}" title="链接">
                    <i class="fas fa-link"></i>
                </button>
                <div class="emoji-picker-container">
                    <button type="button" class="toolbar-btn" id="${config.emojiButtonId}"
                        data-admin-action="settings-rich-text-toggle-emoji-picker"
                        data-rich-text-key="${config.key}" title="表情">
                        <i class="fas fa-smile"></i>
                    </button>
                    <div class="emoji-picker" id="${config.emojiPickerId}">
                        <div class="emoji-picker-header">表情</div>
                        <div class="emoji-grid">
                            ${emojiItems}
                        </div>
                    </div>
                </div>
                <div class="toolbar-dropdown" id="${config.colorDropdownId}">
                    <button type="button" class="toolbar-btn"
                        data-admin-action="settings-rich-text-toggle-dropdown"
                        data-rich-text-key="${config.key}"
                        data-rich-text-dropdown="color" title="文字颜色">
                        <span class="color-swatch preview ${getAdminConfigRichTextColorClass('#6b9ece')}" id="${config.colorPreviewId}"></span>
                    </button>
                    <div class="dropdown-menu">
                        ${colorItems}
                    </div>
                </div>
                <div class="toolbar-dropdown" id="${config.sizeDropdownId}">
                    <button type="button" class="toolbar-btn"
                        data-admin-action="settings-rich-text-toggle-dropdown"
                        data-rich-text-key="${config.key}"
                        data-rich-text-dropdown="size" title="字号">
                        <span class="size-indicator medium" id="${config.sizePreviewId}">A</span>
                    </button>
                    <div class="dropdown-menu">
                        ${sizeItems}
                    </div>
                </div>
            </div>
            <div class="wysiwyg-editor" id="${config.editorId}" contenteditable="true"
                data-placeholder="${escapeHtml(config.placeholder || '请输入内容...')}"></div>
        `;
    }

    function register(config) {
        if (!config?.key || !config.editorId) return null;

        const existing = getInstance(config.key);
        if (existing) {
            Object.assign(existing, config);
            return existing;
        }

        const instance = {
            ...config,
            editor: document.getElementById(config.editorId),
            hiddenInput: config.hiddenInputId ? document.getElementById(config.hiddenInputId) : null,
            toolbarRoot: config.toolbarRootId ? document.getElementById(config.toolbarRootId) : null,
            emojiPicker: config.emojiPickerId ? document.getElementById(config.emojiPickerId) : null,
            emojiButton: config.emojiButtonId ? document.getElementById(config.emojiButtonId) : null,
            alignPicker: config.alignPickerId ? document.getElementById(config.alignPickerId) : null,
            alignButton: config.alignButtonId ? document.getElementById(config.alignButtonId) : null,
            colorPreview: config.colorPreviewId ? document.getElementById(config.colorPreviewId) : null,
            sizePreview: config.sizePreviewId ? document.getElementById(config.sizePreviewId) : null,
            dropdowns: {
                color: config.colorDropdownId ? document.getElementById(config.colorDropdownId) : null,
                size: config.sizeDropdownId ? document.getElementById(config.sizeDropdownId) : null
            },
            selection: null
        };

        if (!instance.editor) return null;

        if (instance.hiddenInput) {
            instance.hiddenInput.hidden = true;
        }

        bindToolbarMouseDown(instance);

        instance.editor.addEventListener('input', () => {
            saveSelection(instance);
            syncHiddenInput(instance);
        });

        ['mouseup', 'keyup', 'focus'].forEach(eventName => {
            instance.editor.addEventListener(eventName, () => saveSelection(instance));
        });

        instance.editor.addEventListener('blur', () => {
            setTimeout(() => saveSelection(instance), 0);
        });

        instances.set(instance.key, instance);

        if (instance.hiddenInput && !serializeEditorHtml(instance.editor) && instance.hiddenInput.value) {
            setContent(instance.key, instance.hiddenInput.value, { syncHiddenInput: false });
        }

        return instance;
    }

    function ensureInjectedEditor(config) {
        if (!config?.key || !config.hiddenInputId) return null;

        const hiddenInput = document.getElementById(config.hiddenInputId);
        if (!hiddenInput) return null;

        if (!document.getElementById(config.editorId)) {
            const shell = document.createElement('div');
            shell.className = 'rich-text-editor-shell';
            shell.innerHTML = createMarkup(config);
            hiddenInput.parentNode.insertBefore(shell, hiddenInput);
        }

        return register(config);
    }

    function setContent(key, value, options = {}) {
        const instance = getInstance(key);
        if (!instance?.editor) return;

        instance.editor.innerHTML = normalizeStoredContent(value || '');
        instance.selection = null;

        if (!options.syncHiddenInput && instance.hiddenInput && typeof value === 'string') {
            instance.hiddenInput.value = value;
        }

        if (options.syncHiddenInput) {
            syncHiddenInput(instance, options.invokeCallback !== false);
        } else if (typeof instance.onRender === 'function') {
            instance.onRender(instance);
        }
    }

    function togglePicker(key, pickerType) {
        const instance = getInstance(key);
        const picker = pickerType === 'emoji' ? instance?.emojiPicker : instance?.alignPicker;
        if (!picker) return;

        const shouldOpen = !picker.classList.contains('active');
        closeFloatingPanels(shouldOpen ? key : null);
        picker.classList.toggle('active', shouldOpen);
    }

    function toggleDropdown(key, dropdownType) {
        const instance = getInstance(key);
        const dropdown = instance?.dropdowns?.[dropdownType];
        if (!dropdown) return;

        const trigger = dropdown.querySelector('.dropdown-trigger, .toolbar-btn');
        const menu = dropdown.querySelector('.dropdown-menu');
        const shouldOpen = !menu?.classList.contains('show');

        closeFloatingPanels(shouldOpen ? key : null, shouldOpen ? dropdown.id : null);
        trigger?.classList.toggle('active', shouldOpen);
        menu?.classList.toggle('show', shouldOpen);
    }

    return {
        register,
        ensureInjectedEditor,
        setContent,
        getContent(key) {
            const instance = getInstance(key);
            return instance?.editor ? serializeEditorHtml(instance.editor) : '';
        },
        syncHiddenInput(key, invokeCallback = true) {
            syncHiddenInput(getInstance(key), invokeCallback);
        },
        insertFormat(key, tag) {
            execCommand(key, tag === 'b' ? 'bold' : tag === 'i' ? 'italic' : 'underline');
        },
        applyTextAlign(key, align) {
            const commands = {
                left: 'justifyLeft',
                center: 'justifyCenter',
                right: 'justifyRight'
            };
            execCommand(key, commands[align] || 'justifyCenter');
            getInstance(key)?.alignPicker?.classList.remove('active');
        },
        toggleAlignPicker(key) {
            togglePicker(key, 'align');
        },
        insertLink(key) {
            let url = prompt('请输入链接地址:', 'https://');
            if (!url) return;
            url = url.trim();
            if (!url || url === 'https://') return;
            if (!/^https?:\/\//i.test(url)) {
                url = `https://${url.replace(/^\/+/, '')}`;
            }
            execCommand(key, 'createLink', url);
        },
        selectEmoji(key, emoji) {
            execCommand(key, 'insertText', emoji);
            getInstance(key)?.emojiPicker?.classList.remove('active');
        },
        toggleEmojiPicker(key) {
            togglePicker(key, 'emoji');
        },
        toggleDropdown,
        selectColor(key, color) {
            execCommand(key, 'foreColor', color);
            const instance = getInstance(key);
            updateColorUI(instance, color);
            closeDropdownElement(instance?.dropdowns?.color);
        },
        selectFontSize(key, size, sizeClass) {
            execCommand(key, 'fontSize', size);
            const instance = getInstance(key);
            updateSizeUI(instance, size, sizeClass);
            closeDropdownElement(instance?.dropdowns?.size);
        }
    };
})();

window.AdminRichTextEditor = AdminRichTextEditor;

AdminRichTextEditor.register({
    key: 'announcement',
    editorId: 'cfgAnnouncementContent',
    toolbarRootId: 'announcementToolbar',
    emojiPickerId: 'emojiPicker',
    emojiButtonId: 'emojiPickerBtn',
    alignPickerId: 'alignPicker',
    alignButtonId: 'alignPickerBtn',
    colorDropdownId: 'colorDropdown',
    colorPreviewId: 'colorPreview',
    sizeDropdownId: 'sizeDropdown',
    sizePreviewId: 'sizePreview',
    onInput: () => updateAnnouncementPreview()
});

function insertFormat(tag) {
    AdminRichTextEditor.insertFormat('announcement', tag);
}

function applyTextColor(color) {
    if (!color) return;
    AdminRichTextEditor.selectColor('announcement', color);
}

function applyTextSize(size) {
    if (!size) return;
    const sizeClass = size === '2' ? 'small' : size === '5' ? 'large' : 'medium';
    AdminRichTextEditor.selectFontSize('announcement', size, sizeClass);
}

function applyTextAlign(align) {
    AdminRichTextEditor.applyTextAlign('announcement', align);
}

function toggleAlignPicker() {
    AdminRichTextEditor.toggleAlignPicker('announcement');
}

function insertLink() {
    AdminRichTextEditor.insertLink('announcement');
}

function selectEmoji(emoji) {
    AdminRichTextEditor.selectEmoji('announcement', emoji);
}

function toggleEmojiPicker() {
    AdminRichTextEditor.toggleEmojiPicker('announcement');
}

// ============================================
// CUSTOM DROPDOWN FUNCTIONS
// ============================================

function toggleDropdown(dropdownId) {
    if (dropdownId === 'colorDropdown') {
        AdminRichTextEditor.toggleDropdown('announcement', 'color');
        return;
    }
    if (dropdownId === 'sizeDropdown') {
        AdminRichTextEditor.toggleDropdown('announcement', 'size');
        return;
    }

    const dropdown = document.getElementById(dropdownId);
    if (!dropdown) return;

    const trigger = dropdown.querySelector('.dropdown-trigger, .toolbar-btn');
    const menu = dropdown.querySelector('.dropdown-menu');
    const shouldOpen = !menu?.classList.contains('show');

    document.querySelectorAll('.custom-dropdown, .toolbar-dropdown').forEach(dd => {
        if (dd.id !== dropdownId) {
            dd.querySelector('.dropdown-trigger, .toolbar-btn')?.classList.remove('active');
            dd.querySelector('.dropdown-menu')?.classList.remove('show');
        }
    });

    trigger?.classList.toggle('active', shouldOpen);
    menu?.classList.toggle('show', shouldOpen);
}

function selectColor(color) {
    AdminRichTextEditor.selectColor('announcement', color);
}

function selectFontSize(size, sizeClass) {
    AdminRichTextEditor.selectFontSize('announcement', size, sizeClass);
}

document.addEventListener('click', (e) => {
    document.querySelectorAll('.emoji-picker-container').forEach(container => {
        const picker = container.querySelector('.emoji-picker');
        const btn = container.querySelector('.toolbar-btn');
        if (picker && btn && !picker.contains(e.target) && !btn.contains(e.target)) {
            picker.classList.remove('active');
        }
    });

    document.querySelectorAll('.align-picker-container').forEach(container => {
        const picker = container.querySelector('.align-picker');
        const btn = container.querySelector('.toolbar-btn');
        if (picker && btn && !picker.contains(e.target) && !btn.contains(e.target)) {
            picker.classList.remove('active');
        }
    });

    document.querySelectorAll('.custom-dropdown, .toolbar-dropdown').forEach(dropdown => {
        if (!dropdown.contains(e.target)) {
            dropdown.querySelector('.dropdown-trigger, .toolbar-btn')?.classList.remove('active');
            dropdown.querySelector('.dropdown-menu')?.classList.remove('show');
        }
    });
});

// ============================================
// MODERATION SETTINGS
// ============================================

function renderModerationConfig() {
    const config = systemConfigCache['moderation'] || {
        auto_filter: false,
        sensitive_words: [],
        ai_content_detection: false
    };

    // Auto filter toggle
    const autoFilter = document.getElementById('cfgAutoFilter');
    if (autoFilter) autoFilter.checked = config.auto_filter || false;

    // Sensitive words
    const sensitiveWords = document.getElementById('cfgSensitiveWords');
    if (sensitiveWords) {
        const words = config.sensitive_words || [];
        sensitiveWords.value = words.join('\n');
    }

    // AI content detection toggle
    const aiDetection = document.getElementById('cfgAiContentDetection');
    if (aiDetection) aiDetection.checked = config.ai_content_detection || false;
}

function renderGalleryConfig() {
    const config = systemConfigCache['gallery'] || {
        items_per_page: 24,
        default_sort: 'newest'
    };

    // Per page dropdown
    const perPageValue = document.getElementById('perPageValue');
    if (perPageValue) perPageValue.textContent = config.items_per_page || 24;

    // Default sort dropdown
    const sortValue = document.getElementById('defaultSortValue');
    const sortLabels = { newest: '最新', popular: '最热', random: '随机' };
    if (sortValue) sortValue.textContent = sortLabels[config.default_sort] || '最新';
}

function renderCommentRulesConfig() {
    const config = systemConfigCache['comments'] || {
        allow_anonymous: false,
        max_comment_length: 500,
        max_nesting_level: 3
    };

    // Allow anonymous toggle
    const allowAnonymous = document.getElementById('cfgAllowAnonymous');
    if (allowAnonymous) allowAnonymous.checked = config.allow_anonymous || false;

    // Max comment length
    const maxLength = document.getElementById('cfgMaxCommentLength');
    if (maxLength) maxLength.value = config.max_comment_length || 500;

    // Max nesting level
    const maxNesting = document.getElementById('cfgMaxNestingLevel');
    if (maxNesting) maxNesting.value = config.max_nesting_level || 3;
}

// ============================================
// VERIFICATION SERVICE CONFIG
// ============================================

function renderVerifyConfig() {
    const config = systemConfigCache['verify_settings'] || {
        price_per_verify: 10,
        enabled: true,
        verify_api_key: ''
    };

    // Price input
    const priceInput = document.getElementById('cfgVerifyPrice');
    if (priceInput) priceInput.value = config.price_per_verify || 10;

    // Enabled toggle
    const enabledToggle = document.getElementById('cfgVerifyEnabled');
    if (enabledToggle) enabledToggle.checked = config.enabled !== false;

    // API Key (show masked for security)
    const apiKeyInput = document.getElementById('cfgVerifyApiKey');
    if (apiKeyInput && config.verify_api_key) {
        // Show first 8 chars + masked rest
        const key = config.verify_api_key;
        apiKeyInput.value = key.length > 8 ? key.slice(0, 8) + '...' : key;
        apiKeyInput.dataset.hasKey = 'true';
    }

    // Auto-load API quota
    checkVerifyQuota();
}

const REFRESH_INTERVAL_LABELS = {
    60000: '1 分钟',
    180000: '3 分钟',
    300000: '5 分钟',
    600000: '10 分钟',
    900000: '15 分钟',
    1800000: '30 分钟'
};

const AI_SERVICE_LABELS = {
    gemini: 'Gemini',
    openai: 'OpenAI',
    claude: 'Claude'
};

const CACHE_DURATION_LABELS = {
    3600: '1 小时',
    86400: '1 天',
    604800: '1 周'
};

function applyCustomDropdownValue(dropdownId, value, label) {
    const dropdown = document.getElementById(dropdownId);
    if (!dropdown) return;

    const valueEl = dropdown.querySelector('.dropdown-value');
    if (valueEl) valueEl.textContent = label;

    dropdown.querySelectorAll('.dropdown-option').forEach((option) => {
        option.classList.toggle('selected', String(option.dataset.value) === String(value));
    });
}

function renderGeneralSettingsConfig() {
    const analyticsConfig = normalizeAnalyticsPreferencesConfig(systemConfigCache['analytics_preferences']);
    const integrationsConfig = normalizeIntegrationsConfig(systemConfigCache['integrations']);
    const seoConfig = normalizeSeoConfig(systemConfigCache['seo']);
    const performanceConfig = normalizePerformanceConfig(systemConfigCache['performance']);

    systemConfigCache['analytics_preferences'] = analyticsConfig;
    systemConfigCache['integrations'] = integrationsConfig;
    systemConfigCache['seo'] = seoConfig;
    systemConfigCache['performance'] = performanceConfig;

    applyCustomDropdownValue(
        'refreshIntervalDropdown',
        analyticsConfig.refresh_interval_ms,
        REFRESH_INTERVAL_LABELS[analyticsConfig.refresh_interval_ms] || REFRESH_INTERVAL_LABELS[300000]
    );

    const googleLoginToggle = document.getElementById('cfgGoogleLogin');
    if (googleLoginToggle) googleLoginToggle.checked = integrationsConfig.google_login_enabled;

    const wechatLoginToggle = document.getElementById('cfgWechatLogin');
    if (wechatLoginToggle) wechatLoginToggle.checked = integrationsConfig.wechat_login_enabled;

    const realtimeToggle = document.getElementById('cfgSupabaseRealtime');
    if (realtimeToggle) realtimeToggle.checked = integrationsConfig.supabase_realtime_enabled;

    applyCustomDropdownValue(
        'aiServiceDropdown',
        integrationsConfig.ai_service,
        AI_SERVICE_LABELS[integrationsConfig.ai_service] || AI_SERVICE_LABELS.gemini
    );

    const siteTitleInput = document.getElementById('cfgSiteTitle');
    if (siteTitleInput) siteTitleInput.value = seoConfig.site_title;

    const siteDescriptionInput = document.getElementById('cfgSiteDescription');
    if (siteDescriptionInput) siteDescriptionInput.value = seoConfig.site_description;

    const siteKeywordsInput = document.getElementById('cfgSiteKeywords');
    if (siteKeywordsInput) siteKeywordsInput.value = seoConfig.site_keywords;

    const lazyLoadToggle = document.getElementById('cfgLazyLoad');
    if (lazyLoadToggle) lazyLoadToggle.checked = performanceConfig.lazy_load_enabled;

    const imageQualityInput = document.getElementById('cfgImageQuality');
    if (imageQualityInput) imageQualityInput.value = performanceConfig.image_quality;

    const imageQualityValue = document.getElementById('cfgImageQualityValue');
    if (imageQualityValue) imageQualityValue.textContent = `${performanceConfig.image_quality}%`;

    applyCustomDropdownValue(
        'cacheDurationDropdown',
        performanceConfig.cache_duration_seconds,
        CACHE_DURATION_LABELS[performanceConfig.cache_duration_seconds] || CACHE_DURATION_LABELS[86400]
    );
}

async function saveVerifyConfig() {
    const priceInput = document.getElementById('cfgVerifyPrice');
    const enabledToggle = document.getElementById('cfgVerifyEnabled');
    const apiKeyInput = document.getElementById('cfgVerifyApiKey');

    const config = systemConfigCache['verify_settings'] || {};

    // Update price
    if (priceInput) {
        config.price_per_verify = parseInt(priceInput.value) || 10;
    }

    // Update enabled
    if (enabledToggle) {
        config.enabled = enabledToggle.checked;
    }

    // Update API key only if it was changed (not masked)
    if (apiKeyInput && !apiKeyInput.value.includes('...')) {
        const newKey = apiKeyInput.value.trim();
        if (newKey) {
            config.verify_api_key = newKey;
        }
    }

    const success = await saveConfig('verify_settings', config);

    if (success && typeof showToast === 'function') {
        showToast('Google One API 配置已保存', 'success');
    }

    // Update cache
    systemConfigCache['verify_settings'] = config;
}

// Expose globally for HTML onclick handlers
window.saveVerifyConfig = saveVerifyConfig;

function showStandaloneSaveIndicator(elementId, text = '✓ 已保存') {
    const indicator = document.getElementById(elementId);
    if (!indicator) return;

    showAdminConfigSaveIndicator(indicator, text, 1500);
}

async function saveSeoSettings() {
    const defaults = getDefaultSeoConfig();
    const config = {
        site_title: document.getElementById('cfgSiteTitle')?.value.trim() || defaults.site_title,
        site_description: document.getElementById('cfgSiteDescription')?.value.trim() || defaults.site_description,
        site_keywords: document.getElementById('cfgSiteKeywords')?.value.trim() || defaults.site_keywords
    };

    if (await saveConfig('seo', config)) {
        renderGeneralSettingsConfig();
        showStandaloneSaveIndicator('seoSaveIndicator');
    }
}

function downloadExportBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

function escapeCsvCell(value) {
    const normalized = value == null
        ? ''
        : (typeof value === 'string'
            ? value
            : JSON.stringify(value));
    return `"${String(normalized).replace(/"/g, '""')}"`;
}

function convertRowsToCsv(rows) {
    if (!Array.isArray(rows) || rows.length === 0) {
        return '';
    }

    const headers = [...rows.reduce((keys, row) => {
        Object.keys(row || {}).forEach((key) => keys.add(key));
        return keys;
    }, new Set())];

    const lines = [
        headers.join(','),
        ...rows.map((row) => headers.map((key) => escapeCsvCell(row?.[key])).join(','))
    ];

    return lines.join('\n');
}

async function fetchAllSupabaseRows(buildQuery, pageSize = 1000) {
    const rows = [];
    let from = 0;

    while (true) {
        const { data, error } = await buildQuery().range(from, from + pageSize - 1);
        if (error) throw error;

        rows.push(...(data || []));

        if (!data || data.length < pageSize) {
            break;
        }

        from += pageSize;
    }

    return rows;
}

async function fetchUsersExportRows() {
    let profiles = [];
    const { data: rpcData, error: rpcError } = await window.supabaseClient.rpc('get_admin_users');

    if (!rpcError && Array.isArray(rpcData)) {
        profiles = rpcData;
    } else {
        const { data: profileData, error: profileError } = await window.supabaseClient
            .from('profiles')
            .select('id, username, email, avatar_url, created_at, updated_at');

        if (profileError) throw profileError;
        profiles = profileData || [];
    }

    let balanceQuery = window.supabaseClient
        .from('points_balance')
        .select('user_id, total_balance');
    balanceQuery = window.AdminSiteFilter?.applySiteFilter?.(balanceQuery) || balanceQuery;

    const [{ data: pointsData, error: pointsError }, { data: rolesData, error: rolesError }] = await Promise.all([
        balanceQuery,
        window.supabaseClient.from('admin_roles').select('user_id, role_name, expires_at')
    ]);

    if (pointsError) throw pointsError;
    if (rolesError) throw rolesError;

    const siteFilter = window.AdminSiteFilter?.getSiteParam?.();
    if (siteFilter) {
        const [loginResult, commentResult, messageResult] = await Promise.all([
            window.supabaseClient.from('user_login_history').select('user_id').eq('site', siteFilter),
            window.supabaseClient.from('prompt_comments').select('user_id').eq('site', siteFilter).not('user_id', 'is', null),
            window.supabaseClient.from('guestbook_messages').select('user_id').eq('site', siteFilter).not('user_id', 'is', null)
        ]);

        const activeUserIds = new Set();
        (loginResult.data || []).forEach((row) => activeUserIds.add(row.user_id));
        (commentResult.data || []).forEach((row) => activeUserIds.add(row.user_id));
        (messageResult.data || []).forEach((row) => activeUserIds.add(row.user_id));
        (pointsData || []).forEach((row) => activeUserIds.add(row.user_id));

        profiles = profiles.filter((profile) => activeUserIds.has(profile.out_id || profile.id));
    }

    const pointsMap = new Map((pointsData || []).map((row) => [row.user_id, row.total_balance || 0]));
    const rolesMap = new Map(
        (rolesData || [])
            .filter((row) => !row.expires_at || new Date(row.expires_at) > new Date())
            .map((row) => [row.user_id, row.role_name || 'admin'])
    );

    return profiles.map((profile) => {
        const id = profile.out_id || profile.id;
        const email = profile.out_email || profile.email || '';
        const username = profile.out_username || profile.username || '';
        const avatarUrl = profile.out_avatar_url || profile.avatar_url || '';
        const lastActiveAt = profile.out_last_active_at || profile.out_last_sign_in_at || profile.last_sign_in_at || '';
        const createdAt = profile.out_created_at || profile.created_at || '';

        return {
            id,
            username,
            email,
            avatar_url: avatarUrl,
            current_points: pointsMap.get(id) || 0,
            admin_role: rolesMap.get(id) || '',
            last_active_at: lastActiveAt,
            created_at: createdAt
        };
    });
}

async function fetchCommentsExportRows() {
    const [guestbookRows, galleryRows] = await Promise.all([
        fetchAllSupabaseRows(() => {
            let query = window.supabaseClient
                .from('guestbook_messages')
                .select(`
                    id,
                    content,
                    user_id,
                    created_at,
                    image_url,
                    like_count,
                    site,
                    profiles:user_id (username, avatar_url, email)
                `)
                .order('created_at', { ascending: false });
            query = window.AdminSiteFilter?.applySiteFilter?.(query) || query;
            return query;
        }),
        fetchAllSupabaseRows(() => {
            let query = window.supabaseClient
                .from('prompt_comments')
                .select(`
                    id,
                    content,
                    user_id,
                    created_at,
                    image_url,
                    parent_id,
                    prompt_id,
                    is_pinned,
                    is_featured,
                    site,
                    profiles:user_id (username, avatar_url, email),
                    prompts:prompt_id (title),
                    comment_likes (count)
                `)
                .order('created_at', { ascending: false });
            query = window.AdminSiteFilter?.applySiteFilter?.(query) || query;
            return query;
        })
    ]);

    return [
        ...(guestbookRows || []).map((row) => ({
            id: row.id,
            type: 'guestbook',
            site: row.site || '',
            author: row.profiles?.username || '未知用户',
            email: row.profiles?.email || '',
            content: row.content || '',
            likes: row.like_count || 0,
            user_id: row.user_id || '',
            prompt_title: '',
            parent_id: '',
            image_url: row.image_url || '',
            created_at: row.created_at
        })),
        ...(galleryRows || []).map((row) => ({
            id: row.id,
            type: 'gallery',
            site: row.site || '',
            author: row.profiles?.username || '未知用户',
            email: row.profiles?.email || '',
            content: row.content || '',
            likes: row.comment_likes?.[0]?.count || 0,
            user_id: row.user_id || '',
            prompt_title: row.prompts?.title || '',
            parent_id: row.parent_id || '',
            image_url: row.image_url || '',
            is_pinned: row.is_pinned === true,
            is_featured: row.is_featured === true,
            created_at: row.created_at
        }))
    ].sort((left, right) => String(right.created_at || '').localeCompare(String(left.created_at || '')));
}

async function fetchPointsExportRows() {
    return fetchAllSupabaseRows(() => {
        let query = window.supabaseClient
            .from('points_ledger')
            .select('*')
            .order('created_at', { ascending: false });
        query = window.AdminSiteFilter?.applySiteFilter?.(query) || query;
        return query;
    });
}

async function exportSettingsData(dataset, format = 'json') {
    const normalizedDataset = String(dataset || '').trim();
    const normalizedFormat = String(format || 'json').trim().toLowerCase();

    const loaders = {
        users: fetchUsersExportRows,
        comments: fetchCommentsExportRows,
        points: fetchPointsExportRows
    };

    const loadRows = loaders[normalizedDataset];
    if (!loadRows) {
        throw new Error(`不支持的导出类型: ${normalizedDataset}`);
    }

    try {
        const rows = await loadRows();
        if (!Array.isArray(rows) || rows.length === 0) {
            window.showToast?.('暂无可导出的数据', 'info');
            return;
        }

        const timestamp = new Date().toISOString().slice(0, 10);
        if (normalizedFormat === 'csv') {
            const csv = convertRowsToCsv(rows);
            downloadExportBlob(
                new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }),
                `${normalizedDataset}_export_${timestamp}.csv`
            );
        } else {
            downloadExportBlob(
                new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' }),
                `${normalizedDataset}_export_${timestamp}.json`
            );
        }

        window.showToast?.(`已导出 ${rows.length} 条${normalizedDataset === 'users' ? '用户' : (normalizedDataset === 'comments' ? '评论' : '积分')}数据`, 'success');
    } catch (err) {
        console.error('Export settings data failed:', err);
        window.showToast?.(`导出失败: ${err.message}`, 'error');
    }
}

const VERIFY_SERVER_URL = window.VERIFY_SERVER_URL || 'https://zaoyoe-verify-server-production.up.railway.app';

async function checkVerifyQuota() {
    const quotaEl = document.getElementById('cfgVerifyQuota');
    if (!quotaEl) return;

    renderVerifyQuotaState(quotaEl, 'neutral', 'fas fa-spinner fa-spin', '查询中...');

    try {
        const headers = await getAdminConfigApiHeaders();
        const res = await fetch(`${VERIFY_SERVER_URL}/api/quota`, { headers });
        const data = await res.json();

        if (data.success) {
            const balance = Number(data.balance ?? data.credits ?? 0);
            const tone = balance > 5 ? 'success' : balance > 0 ? 'warning' : 'danger';
            const display = Number.isInteger(balance) ? balance : balance.toFixed(1);
            renderVerifyQuotaState(quotaEl, tone, 'fas fa-gem', display, { emphasized: true });
        } else {
            renderVerifyQuotaState(quotaEl, 'danger', 'fas fa-exclamation-triangle', data.message || '查询失败');
        }
    } catch (e) {
        renderVerifyQuotaState(quotaEl, 'danger', 'fas fa-exclamation-triangle', '网络错误');
    }
}

window.checkVerifyQuota = checkVerifyQuota;

async function saveSensitiveWords() {
    const textarea = document.getElementById('cfgSensitiveWords');
    if (!textarea) return;

    const lines = textarea.value.split('\n').map(l => l.trim()).filter(l => l);
    const config = systemConfigCache['moderation'] || {};
    config.sensitive_words = lines;

    const success = await saveConfig('moderation', config);

    if (success && typeof showToast === 'function') {
        showToast('敏感词列表已保存', 'success');
    }
}

function setupModerationEventListeners() {
    // Auto filter toggle
    const autoFilter = document.getElementById('cfgAutoFilter');
    if (autoFilter) {
        autoFilter.addEventListener('change', async (e) => {
            const config = systemConfigCache['moderation'] || {};
            config.auto_filter = e.target.checked;
            await saveConfig('moderation', config);
        });
    }

    // AI content detection toggle
    const aiDetection = document.getElementById('cfgAiContentDetection');
    if (aiDetection) {
        aiDetection.addEventListener('change', async (e) => {
            const config = systemConfigCache['moderation'] || {};
            config.ai_content_detection = e.target.checked;
            await saveConfig('moderation', config);
        });
    }

    // Gallery settings
    setupGalleryEventListeners();

    // Comment rules
    setupCommentRulesEventListeners();
}

// ============================================
// GALLERY SETTINGS
// ============================================

function loadGallerySettings(config) {
    // Per page dropdown
    const perPageValue = document.getElementById('perPageValue');
    if (perPageValue && config.items_per_page) {
        perPageValue.textContent = config.items_per_page;
    }
}

function setupGalleryEventListeners() {
    // Gallery settings are saved via dropdown selection override
    // No additional event listeners needed for now
}

// Override dropdown selection to save gallery settings
const originalSelectDropdownOption = window.selectDropdownOption;
window.selectDropdownOption = function (dropdownId, value, displayText) {
    // Call original
    if (typeof originalSelectDropdownOption === 'function') {
        originalSelectDropdownOption(dropdownId, value, displayText);
    }

    // Handle gallery dropdowns
    if (dropdownId === 'perPageDropdown') {
        const config = systemConfigCache['gallery'] || {};
        config.items_per_page = parseInt(value);
        saveConfig('gallery', config);
    } else if (dropdownId === 'defaultSortDropdown') {
        const config = systemConfigCache['gallery'] || {};
        config.default_sort = value;
        saveConfig('gallery', config);
    } else if (dropdownId === 'refreshIntervalDropdown') {
        const config = normalizeAnalyticsPreferencesConfig(systemConfigCache['analytics_preferences']);
        config.refresh_interval_ms = parseInt(value, 10) || getDefaultAnalyticsPreferencesConfig().refresh_interval_ms;
        saveConfig('analytics_preferences', config);
    } else if (dropdownId === 'aiServiceDropdown') {
        const config = normalizeIntegrationsConfig(systemConfigCache['integrations']);
        config.ai_service = value;
        saveConfig('integrations', config);
    } else if (dropdownId === 'cacheDurationDropdown') {
        const config = normalizePerformanceConfig(systemConfigCache['performance']);
        config.cache_duration_seconds = parseInt(value, 10) || getDefaultPerformanceConfig().cache_duration_seconds;
        saveConfig('performance', config);
    }
};

// ============================================
// COMMENT RULES
// ============================================

function loadCommentRules(config) {
    // Allow anonymous toggle
    const allowAnonymous = document.getElementById('cfgAllowAnonymous');
    if (allowAnonymous) allowAnonymous.checked = config.allow_anonymous || false;

    // Max comment length
    const maxLength = document.getElementById('cfgMaxCommentLength');
    if (maxLength) maxLength.value = config.max_comment_length || 500;

    // Max nesting level
    const maxNesting = document.getElementById('cfgMaxNestingLevel');
    if (maxNesting) maxNesting.value = config.max_nesting_level || 3;
}

function setupCommentRulesEventListeners() {
    // Allow anonymous toggle
    const allowAnonymous = document.getElementById('cfgAllowAnonymous');
    if (allowAnonymous) {
        allowAnonymous.addEventListener('change', async (e) => {
            const config = systemConfigCache['comments'] || {};
            config.allow_anonymous = e.target.checked;
            await saveConfig('comments', config);
        });
    }

    // Max comment length
    const maxLength = document.getElementById('cfgMaxCommentLength');
    if (maxLength) {
        maxLength.addEventListener('change', async (e) => {
            const config = systemConfigCache['comments'] || {};
            config.max_comment_length = parseInt(e.target.value) || 500;
            await saveConfig('comments', config);
        });
    }

    // Max nesting level
    const maxNesting = document.getElementById('cfgMaxNestingLevel');
    if (maxNesting) {
        maxNesting.addEventListener('change', async (e) => {
            const config = systemConfigCache['comments'] || {};
            config.max_nesting_level = parseInt(e.target.value) || 3;
            await saveConfig('comments', config);
        });
    }
}

// ============================================
// DECORATION SYSTEM
// ============================================

let currentDecoration = 'none';

function toggleDecoration() {
    const checkbox = document.getElementById('decorationEnabled');
    const selector = document.getElementById('decorationSelector');

    if (checkbox && selector) {
        if (checkbox.checked) {
            selector.classList.add('active');
        } else {
            selector.classList.remove('active');
            // Clear decoration when disabled
            selectDecoration('none');
        }
    }
}

function selectDecoration(theme) {
    currentDecoration = theme;

    // Update button states
    document.querySelectorAll('.decoration-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.decoration === theme);
    });

    // Apply decoration to preview
    applyDecorationToPreview(theme);
}

// Apply decoration to preview stage
function applyDecorationToPreview(theme) {
    const preview = document.getElementById('announcementPreview');
    if (!preview) return;

    // Remove existing particles container
    const existingParticles = preview.querySelector('.decoration-particles');
    if (existingParticles) {
        existingParticles.remove();
    }

    // Remove existing heart container (specific to hearts theme)
    const existingHearts = preview.querySelectorAll('.heart-container');
    existingHearts.forEach(h => h.remove());

    // If no decoration selected, exit
    if (theme === 'none') {
        // Also ensure any running particle system is stopped
        if (window.stopContinuousParticles) {
            window.stopContinuousParticles();
        }
        return;
    }

    // Use the shared generator from prompts-poetry.js
    if (window.generateDecorationParticles) {
        // Insert HTML
        preview.insertAdjacentHTML('afterbegin', window.generateDecorationParticles(theme));

        // Start animation based on theme
        if (theme === 'hearts') {
            if (window.startHeartFloat) {
                // Ensure the hearts are positioned relative to the preview container
                window.startHeartFloat(preview);
            }
        } else {
            // Only use active JS ParticleSystem for complex physics themes
            // Sakura and Leaves use the CSS-based particles we generated
            const activePhysicsThemes = ['snow', 'rain', 'fireworks'];

            if (activePhysicsThemes.includes(theme)) {
                const particleContainer = preview.querySelector('.decoration-particles');
                if (particleContainer && window.startContinuousParticles) {
                    // Slight delay to ensure DOM is rendered and dimensions are available
                    setTimeout(() => {
                        window.startContinuousParticles(particleContainer, theme);
                    }, 50);
                }
            }
        }
    } else {
        console.warn('generateDecorationParticles not found. Ensure prompts-poetry.js is loaded.');
    }
}

// Get current decoration for saving
function getCurrentDecoration() {
    const checkbox = document.getElementById('decorationEnabled');
    if (!checkbox || !checkbox.checked) return 'none';
    return currentDecoration;
}

// ============================================
// PAGE TARGET SELECTOR FUNCTIONS
// ============================================

// Toggle page target selection
function togglePageTarget(page) {
    const selector = document.getElementById('pageTargetSelector');
    if (!selector) return;

    const allBtn = selector.querySelector('[data-page="all"]');
    const pageBtns = selector.querySelectorAll('[data-page]:not([data-page="all"])');
    const clickedBtn = selector.querySelector(`[data-page="${page}"]`);

    if (page === 'all') {
        // Toggle "all" - if clicking "all", select only "all" and deselect others
        if (allBtn.classList.contains('active')) {
            // Already selected, do nothing (must have at least one page)
            return;
        }
        // Select "all", deselect individual pages
        allBtn.classList.add('active');
        pageBtns.forEach(btn => btn.classList.remove('active'));
    } else {
        // Toggle individual page
        clickedBtn.classList.toggle('active');

        // If any individual page is selected, deselect "all"
        const anyPageSelected = Array.from(pageBtns).some(btn => btn.classList.contains('active'));
        if (anyPageSelected) {
            allBtn.classList.remove('active');
        } else {
            // No individual pages selected, auto-select "all"
            allBtn.classList.add('active');
        }

        // If all individual pages are selected, switch to "all"
        const allPagesSelected = Array.from(pageBtns).every(btn => btn.classList.contains('active'));
        if (allPagesSelected) {
            allBtn.classList.add('active');
            pageBtns.forEach(btn => btn.classList.remove('active'));
        }
    }
}

// Get selected pages from UI
function getSelectedPages() {
    const selector = document.getElementById('pageTargetSelector');
    if (!selector) return ['all'];

    const allBtn = selector.querySelector('[data-page="all"]');
    if (allBtn && allBtn.classList.contains('active')) {
        return ['all'];
    }

    const selectedPages = [];
    selector.querySelectorAll('[data-page]:not([data-page="all"])').forEach(btn => {
        if (btn.classList.contains('active')) {
            selectedPages.push(btn.dataset.page);
        }
    });

    return selectedPages.length > 0 ? selectedPages : ['all'];
}

// Restore page selector state from saved config
function restorePageSelector(pages) {
    const selector = document.getElementById('pageTargetSelector');
    if (!selector) return;

    // Clear all active states
    selector.querySelectorAll('.page-btn').forEach(btn => btn.classList.remove('active'));

    if (!pages || pages.length === 0 || pages.includes('all')) {
        // Select "all" button
        const allBtn = selector.querySelector('[data-page="all"]');
        if (allBtn) allBtn.classList.add('active');
    } else {
        // Select individual pages
        pages.forEach(page => {
            const btn = selector.querySelector(`[data-page="${page}"]`);
            if (btn) btn.classList.add('active');
        });
    }
}

// ============================================
// EXPORTS
// ============================================

window.initSystemConfig = initSystemConfig;
window.toggleConfigCard = toggleConfigCard;
window.updatePackage = updatePackage;
window.togglePackageStatus = togglePackageStatus;
window.deletePackage = deletePackage;
window.addPackageRow = addPackageRow;
window.toggleCustomRechargeEntryStatus = toggleCustomRechargeEntryStatus;
window.toggleMockPaymentStatus = toggleMockPaymentStatus;
window.togglePaymentProviderEnabled = togglePaymentProviderEnabled;
window.togglePaymentProviderPanel = togglePaymentProviderPanel;
window.handlePaymentChannelActiveChange = handlePaymentChannelActiveChange;
window.savePaymentChannelSettings = savePaymentChannelSettings;
window.loadOpsAlertSettings = loadOpsAlertSettings;
window.toggleOpsAlertsEnabled = toggleOpsAlertsEnabled;
window.toggleOpsAlertChannelEnabled = toggleOpsAlertChannelEnabled;
window.saveOpsAlertSettings = saveOpsAlertSettings;
window.sendOpsAlertTelegramTest = sendOpsAlertTelegramTest;
window.sendOpsAlertRefundSample = sendOpsAlertRefundSample;
window.sendOpsAlertGatewaySample = sendOpsAlertGatewaySample;
window.sendOpsAlertVerifyServiceDisabledSample = sendOpsAlertVerifyServiceDisabledSample;
window.sendOpsAlertVerifyQueueBacklogSample = sendOpsAlertVerifyQueueBacklogSample;
window.sendOpsAlertVerifyFailureRateSpikeSample = sendOpsAlertVerifyFailureRateSpikeSample;
window.sendOpsAlertVerifyIncidentEscalatedSample = sendOpsAlertVerifyIncidentEscalatedSample;
window.sendOpsAlertVerifyIncidentRecoveredSample = sendOpsAlertVerifyIncidentRecoveredSample;
window.sendOpsAlertVerifyQuotaSample = sendOpsAlertVerifyQuotaSample;
window.sendOpsAlertTicketSlaSample = sendOpsAlertTicketSlaSample;
window.sendOpsAlertShopInventorySample = sendOpsAlertShopInventorySample;
window.sendOpsAlertAdminLoginAnomalySample = sendOpsAlertAdminLoginAnomalySample;
window.sendOpsAlertShopOrderDeliveryFailedSample = sendOpsAlertShopOrderDeliveryFailedSample;
window.sendOpsAlertPaymentConfigChangedSample = sendOpsAlertPaymentConfigChangedSample;
window.deleteOpsAlertSecret = deleteOpsAlertSecret;
window.deleteChannel = deleteChannel;
window.addChannel = addChannel;
window.saveIpBlacklist = saveIpBlacklist;
window.saveAnnouncement = saveAnnouncement;
window.saveSensitiveWords = saveSensitiveWords;
window.saveSeoSettings = saveSeoSettings;
window.exportSettingsData = exportSettingsData;
window.toggleDecoration = toggleDecoration;
window.selectDecoration = selectDecoration;
window.togglePageTarget = togglePageTarget;
window.loadAffiliateSettings = loadAffiliateSettings;
window.saveAffiliateSetting = saveAffiliateSetting;
window.saveAffiliatePosterField = saveAffiliatePosterField;
window.selectAffiliatePosterTemplate = selectAffiliatePosterTemplate;
window.handleAffiliatePosterUpload = handleAffiliatePosterUpload;
window.resetAffiliatePosterBackground = resetAffiliatePosterBackground;
