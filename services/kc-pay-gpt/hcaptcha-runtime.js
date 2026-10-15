/**
 * 将后台 DB 中的 hCaptcha 配置转为子进程 / solver 可用的环境变量
 */

const path = require('path');

const DEFAULT_VLM_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_VLM_MODEL = 'gpt-6.1-sol';
const DEFAULT_CAPTCHA_PLATFORM_API_URL = 'https://api.capsolver.com';

function normalizeVlmModel(rawModel) {
    const m = String(rawModel || '').trim();
    const low = m.toLowerCase().replace(/[\s_]+/g, '-');
    if (low.includes('6.1') && low.includes('sol')) {
        return 'gpt-6.1-sol';
    }
    if (low.includes('5.6') && low.includes('sol')) {
        return 'gpt-5.6-sol';
    }
    if (low.includes('6') && low.includes('sol')) {
        return 'gpt-6-sol';
    }
    if (low.includes('astra')) {
        return 'gpt-6-astra';
    }
    return m;
}

function normalizeHcaptchaConfig(raw = {}) {
    return {
        enabled: raw.enabled !== false && String(raw.enabled ?? '1') !== '0',
        vlm_api_key: String(raw.vlm_api_key || '').trim(),
        vlm_base_url: String(raw.vlm_base_url || DEFAULT_VLM_BASE_URL).trim() || DEFAULT_VLM_BASE_URL,
        vlm_model: normalizeVlmModel(raw.vlm_model || DEFAULT_VLM_MODEL) || DEFAULT_VLM_MODEL,
        vlm_timeout: Math.max(10, Number(raw.vlm_timeout || 25) || 25),
        solver_timeout: Math.max(60, Number(raw.solver_timeout || 360) || 360),
        no_vlm: Boolean(raw.no_vlm),
        cdp_port: String(raw.cdp_port || '9222').trim() || '9222',
        captcha_platform_api_key: String(raw.captcha_platform_api_key || '').trim(),
        captcha_platform_api_url: String(raw.captcha_platform_api_url || DEFAULT_CAPTCHA_PLATFORM_API_URL).trim()
            .replace(/\/+$/, '') || DEFAULT_CAPTCHA_PLATFORM_API_URL,
        captcha_platform_timeout: Math.max(30, Number(raw.captcha_platform_timeout || 180) || 180)
    };
}

function resolveSolverPython() {
    const candidates = [
        process.env.HCAPTCHA_SOLVER_PYTHON,
        process.env.CTFML_PYTHON,
        '/usr/bin/python3',
        '/usr/local/bin/python3',
        'python3'
    ].filter(Boolean);
    return candidates[0] || 'python3';
}

function buildHcaptchaEnvFromConfig(cfg = {}) {
    const normalized = normalizeHcaptchaConfig(cfg);
    const cdpUrl = `http://127.0.0.1:${normalized.cdp_port}`;
    const autoSolveEnabled = normalized.enabled && Boolean(normalized.captcha_platform_api_key);
    const env = {
        HCAPTCHA_SOLVER_ENABLED: normalized.enabled ? '1' : '0',
        INTERACTIVE_CAPTCHA_PRIORITY: !autoSolveEnabled ? 'true' : (process.env.INTERACTIVE_CAPTCHA_PRIORITY || 'false'),
        CTF_VLM_API_KEY: normalized.vlm_api_key,
        CTF_VLM_BASE_URL: normalized.vlm_base_url,
        CTF_VLM_MODEL: normalized.vlm_model,
        CTF_VLM_TIMEOUT: String(normalized.vlm_timeout),
        HCAPTCHA_SOLVER_TIMEOUT: String(normalized.solver_timeout),
        HCAPTCHA_SOLVER_NO_VLM: normalized.no_vlm ? '1' : '0',
        CDP_PORT: normalized.cdp_port,
        CDP_URL: cdpUrl,
        HCAPTCHA_SOLVER_SCRIPT: process.env.HCAPTCHA_SOLVER_SCRIPT
            || path.join(__dirname, 'hcaptcha', 'solver.py'),
        HCAPTCHA_SOLVER_PYTHON: resolveSolverPython(),
        HCAPTCHA_SOLVER_OUT_DIR: process.env.HCAPTCHA_SOLVER_OUT_DIR || '/tmp/hcaptcha_auto_solver_live',
        HCAPTCHA_CAPTCHA_PLATFORM_API_KEY: normalized.captcha_platform_api_key,
        CAPTCHA_PLATFORM_API_KEY: normalized.captcha_platform_api_key,
        HCAPTCHA_CAPTCHA_PLATFORM_API_URL: normalized.captcha_platform_api_url,
        CAPTCHA_PLATFORM_API_URL: normalized.captcha_platform_api_url,
        HCAPTCHA_CAPTCHA_PLATFORM_TIMEOUT: String(normalized.captcha_platform_timeout)
    };
    return { normalized, env };
}

function applyHcaptchaEnvToProcess(envPatch = {}) {
    for (const [key, value] of Object.entries(envPatch)) {
        if (value === undefined || value === null) continue;
        process.env[key] = String(value);
    }
}

module.exports = {
    normalizeHcaptchaConfig,
    buildHcaptchaEnvFromConfig,
    applyHcaptchaEnvToProcess,
    resolveSolverPython
};
