'use strict';

const { validateCdkPlan } = require('./cdk-plan-catalog');
const { extractClaudeSessionKey, isValidClaudeSessionKey } = require('./claude-auth');
const { extractGrokCredential, isValidGrokCredential } = require('./grok-auth');
const { extractEmailFromSession } = require('./session-auth');

function resolveActivationInput({ cdkDetails, requestedPlatform, rawSession, validateChatGpt }) {
    const plan = validateCdkPlan(cdkDetails.plan_type, cdkDetails.platform || undefined, { activation: true });
    if (requestedPlatform && String(requestedPlatform).trim().toLowerCase() !== plan.platform) {
        throw Object.assign(new Error('卡密平台与提交的平台不一致，已停止充值'), { statusCode: 400 });
    }
    let token;
    let storedSession = rawSession;
    if (plan.platform === 'claude') {
        if (!isValidClaudeSessionKey(rawSession)) {
            throw Object.assign(new Error('请输入有效的 Claude sessionKey 或完整登录 Cookie'), { statusCode: 400 });
        }
        token = extractClaudeSessionKey(rawSession);
    } else if (plan.platform === 'grok') {
        if (!isValidGrokCredential(rawSession)) {
            throw Object.assign(new Error('未识别到有效的 Grok 登录 Cookie，请重新复制完整 Cookie'), { statusCode: 400 });
        }
        token = extractGrokCredential(rawSession).value;
    } else {
        ({ token, storedSession } = validateChatGpt(rawSession));
    }
    // Account preview is metadata, never a credential fragment or proof of login.
    const email = extractEmailFromSession(rawSession);
    const tokenPreview = email || `${plan.platform} 登录凭证`;
    return { ...plan, token, storedSession, tokenPreview };
}

function buildActivationCredentialEnv({ platform, token, sessionRaw }) {
    return {
        PLATFORM: platform,
        CHATGPT_TOKEN: platform === 'chatgpt' ? token : '',
        CHATGPT_SESSION_JSON: platform === 'chatgpt' ? sessionRaw : '',
        CLAUDE_SESSION_KEY: platform === 'claude' ? sessionRaw : '',
        GROK_TOKEN: platform === 'grok' ? sessionRaw : ''
    };
}

module.exports = { resolveActivationInput, buildActivationCredentialEnv };
