'use strict';

const { PLATFORM_CONFIG, getPlatformForPlan } = require('./region-config');
const { isLegacy } = require('./public/grok-plan-catalog');
const chatgptNames = { go: 'chatgptgoplan', plus: 'chatgptplusplan', team: 'chatgptteamplan',
    chatgpt_team: 'chatgptteamplan', team_monthly: 'chatgptteamplan', team_yearly: 'chatgptteamplan',
    team_2: 'chatgptteamplan', team_5: 'chatgptteamplan', team_10: 'chatgptteamplan', team_20: 'chatgptteamplan',
    pro_100: 'chatgptprolite', pro_200: 'chatgptpro', pro_500: 'chatgptpromax', pro_5x: 'chatgptprolite',
    pro_20x: 'chatgptpro', pro5x: 'chatgptprolite', pro20x: 'chatgptpro', pro100: 'chatgptprolite',
    pro200: 'chatgptpro', pro500: 'chatgptpromax' };
const aliases = { claude_pro_yearly: 'claude_pro_annual', claude_max_5x: 'claude_max_100', claude_max_20x: 'claude_max_200',
    claude_max5x: 'claude_max_100', claude_max20x: 'claude_max_200', grok_lite: 'supergrok_lite',
    grok_super: 'supergrok', grok_plus: 'supergrok_plus', grok_heavy: 'supergrok_heavy' };
const PLAN_NAME_MAP = Object.freeze({ ...Object.fromEntries(Object.values(PLATFORM_CONFIG).flatMap(platform =>
    Object.keys(platform.plans).map(key => [key, aliases[key] || key]))), ...chatgptNames });

function parseTeamSeats(planType) {
    const key = String(planType ?? '').trim().toLowerCase();
    const m = key.match(/^team_?(\d+)$/i);
    if (m && m[1]) {
        return Math.max(2, parseInt(m[1], 10) || 2);
    }
    if (key === 'team' || key === 'chatgpt_team' || key === 'team_monthly' || key === 'team_yearly') {
        return 2;
    }
    return null;
}

function planError(message) { return Object.assign(new Error(message), { code: 'CDK_PLAN_INVALID', statusCode: 400 }); }
function validateCdkPlan(planType, platform, { issuance = false, activation = false } = {}) {
    const key = String(planType ?? '').trim().toLowerCase();
    const teamSeats = parseTeamSeats(key);
    const isTeam = teamSeats !== null;
    if (!Object.hasOwn(PLAN_NAME_MAP, key) && !isTeam) throw planError('无法识别卡密套餐，请选择明确的商品和计费周期');
    const expectedPlatform = getPlatformForPlan(key);
    if (platform != null && String(platform).trim().toLowerCase() !== expectedPlatform) throw planError('卡密平台与套餐不一致，已停止');
    if (isLegacy(key) && (issuance || activation)) throw planError(issuance
        ? '旧版 Grok 套餐已停止生成和导入，请选择 The X Subscription 新商品'
        : '该卡密属于旧版 Grok 商品，不能自动兑换成新版组合订阅，请联系客服处理，卡密未使用');
    const planName = isTeam ? 'chatgptteamplan' : PLAN_NAME_MAP[key];
    return { planType: key, platform: expectedPlatform, planName, seatQuantity: teamSeats || undefined };
}
function resolvePlanName(planType) { return validateCdkPlan(planType).planName; }
module.exports = { PLAN_NAME_MAP, validateCdkPlan, resolvePlanName, parseTeamSeats };
