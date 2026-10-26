'use strict';

const { plans: GROK_BUNDLE_PLANS, labels: GROK_BUNDLE_LABELS } = require('./public/grok-plan-catalog');

/**
 * 支付地区配置映射
 * 每个地区包含对应的币种和中文标签
 */
const REGION_CONFIG = {
    PH: { currency: 'PHP', label: '菲律宾', locale: 'en-PH', timezone: 'Asia/Manila' },
    US: { currency: 'USD', label: '美国', locale: 'en-US', timezone: 'America/New_York' },
    EG: { currency: 'EGP', label: '埃及', locale: 'ar-EG', timezone: 'Africa/Cairo' },
    CL: { currency: 'CLP', label: '智利', locale: 'es-CL', timezone: 'America/Santiago' },
    // 兼容历史已生成卡密
    SG: { currency: 'SGD', label: '新加坡', locale: 'en-SG', timezone: 'Asia/Singapore' },
    MY: { currency: 'MYR', label: '马来西亚', locale: 'en-MY', timezone: 'Asia/Kuala_Lumpur' }
};

/** 支持的地区代码列表（新增埃及 EG、智利 CL，移除新加坡 SG、马来西亚 MY） */
const SUPPORTED_REGIONS = ['PH', 'US', 'EG', 'CL'];

/** 默认支付地区 */
const DEFAULT_REGION = 'PH';

const PLATFORM_CONFIG = {
    chatgpt: {
        id: 'chatgpt',
        name: 'ChatGPT',
        plans: {
            go: { label: 'ChatGPT Go', amount: 5.00 },
            plus: { label: 'ChatGPT Plus', amount: 20.00 },
            team: { label: 'ChatGPT Team', amount: 30.00 },
            pro_100: { label: 'ChatGPT PRO 100', amount: 100.00 },
            pro_200: { label: 'ChatGPT PRO 200', amount: 200.00 },
            pro_500: { label: 'ChatGPT PRO 500', amount: 500.00 }
        }
    },
    claude: {
        id: 'claude',
        name: 'Claude',
        plans: {
            claude_pro: { label: 'Claude Pro', amount: 20.00 },
            claude_pro_annual: { label: 'Claude Pro (年费)', amount: 200.00 },
            claude_pro_yearly: { label: 'Claude Pro (年费)', amount: 200.00 },
            claude_max_100: { label: 'Claude Max 100 (5x)', amount: 100.00 },
            claude_max_200: { label: 'Claude Max 200 (20x)', amount: 200.00 },
            claude_max_5x: { label: 'Claude Max 100 (5x)', amount: 100.00 },
            claude_max_20x: { label: 'Claude Max 200 (20x)', amount: 200.00 },
            claude_max5x: { label: 'Claude Max 100 (5x)', amount: 100.00 },
            claude_max20x: { label: 'Claude Max 200 (20x)', amount: 200.00 },
            claude_team: { label: 'Claude Team', amount: 30.00 }
        }
    },
    grok: {
        id: 'grok',
        name: 'Grok',
        plans: {
            ...GROK_BUNDLE_PLANS,
            supergrok_lite: { label: 'SuperGrok Lite', amount: 10.00 },
            supergrok: { label: 'SuperGrok', amount: 30.00 },
            supergrok_plus: { label: 'SuperGrok Plus', amount: 100.00 },
            supergrok_heavy: { label: 'SuperGrok Heavy', amount: 300.00 },
            // 兼容历史与别名
            grok_lite: { label: 'SuperGrok Lite', amount: 10.00 },
            grok_super: { label: 'SuperGrok', amount: 30.00 },
            grok_plus: { label: 'SuperGrok Plus', amount: 100.00 },
            grok_heavy: { label: 'SuperGrok Heavy', amount: 300.00 },
            grok_premium: { label: 'Grok (X Premium)', amount: 8.00 },
            grok_premium_plus: { label: 'Grok (X Premium+)', amount: 16.00 }
        }
    }
};

const PLAN_TYPE_LABELS = {
    ...GROK_BUNDLE_LABELS,
    // ChatGPT
    go: 'ChatGPT Go',
    plus: 'ChatGPT Plus',
    team: 'ChatGPT Team',
    chatgpt_team: 'ChatGPT Team',
    pro_100: 'ChatGPT PRO 100',
    pro_200: 'ChatGPT PRO 200',
    pro_500: 'ChatGPT PRO 500',
    // 兼容历史标识
    pro_5x: 'ChatGPT PRO 100',
    pro_20x: 'ChatGPT PRO 200',
    pro5x: 'ChatGPT PRO 100',
    pro20x: 'ChatGPT PRO 200',
    // Claude
    claude_pro: 'Claude Pro',
    claude_pro_annual: 'Claude Pro (年费)',
    claude_pro_yearly: 'Claude Pro (年费)',
    claude_max_100: 'Claude Max 100 (5x)',
    claude_max_200: 'Claude Max 200 (20x)',
    claude_max_5x: 'Claude Max 100 (5x)',
    claude_max_20x: 'Claude Max 200 (20x)',
    claude_max5x: 'Claude Max 100 (5x)',
    claude_max20x: 'Claude Max 200 (20x)',
    claude_team: 'Claude Team'
};

function getPlatformForPlan(planType) {
    const key = String(planType || '').toLowerCase();
    if (key.startsWith('claude')) return 'claude';
    if (key.startsWith('grok') || key.startsWith('supergrok')) return 'grok';
    return 'chatgpt';
}

/**
 * 检查地区代码是否在支持列表中
 * @param {string} regionCode - 地区代码
 * @returns {boolean}
 */
function isSupportedRegion(regionCode) {
    return SUPPORTED_REGIONS.includes(String(regionCode || '').toUpperCase());
}

/**
 * 获取指定地区的配置（currency, label）
 * @param {string} regionCode - 地区代码
 * @returns {{ currency: string, label: string, locale: string, timezone: string } | null}
 */
function getRegionConfig(regionCode) {
    const code = String(regionCode || '').toUpperCase();
    return REGION_CONFIG[code] || null;
}

function getRegionBilling(regionCode) {
    const cfg = getRegionConfig(regionCode);
    if (!cfg) {
        return null;
    }
    const code = String(regionCode || '').toUpperCase();
    return {
        country: code,
        currency: cfg.currency,
        label: cfg.label
    };
}

function getRegionBrowserProfile(regionCode) {
    const cfg = getRegionConfig(regionCode) || REGION_CONFIG[DEFAULT_REGION];
    return {
        locale: cfg.locale,
        timezoneId: cfg.timezone
    };
}

function getPlanTypeLabel(planType) {
    return PLAN_TYPE_LABELS[planType] || String(planType || '未知套餐');
}

module.exports = {
    REGION_CONFIG,
    SUPPORTED_REGIONS,
    DEFAULT_REGION,
    PLATFORM_CONFIG,
    PLAN_TYPE_LABELS,
    getPlatformForPlan,
    isSupportedRegion,
    getRegionConfig,
    getRegionBilling,
    getRegionBrowserProfile,
    getPlanTypeLabel
};
