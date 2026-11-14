'use strict';

const { spawn } = require('child_process');
const path = require('path');

const BRIDGE_PATH = path.join(__dirname, 'sentinel_bridge.js');
const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';

const COUNTRY_LOCALE_PROFILE = {
    PH: { timezone: 'Asia/Manila', language: 'en-PH' },
    SG: { timezone: 'Asia/Singapore', language: 'en-SG' },
    MY: { timezone: 'Asia/Kuala_Lumpur', language: 'en-MY' },
    EG: { timezone: 'Africa/Cairo', language: 'ar-EG' },
    CL: { timezone: 'America/Santiago', language: 'es-CL' },
    JP: { timezone: 'Asia/Tokyo', language: 'ja-JP' },
    GB: { timezone: 'Europe/London', language: 'en-GB' },
    US: { timezone: 'America/New_York', language: 'en-US' }
};

function resolveSentinelLocaleProfile(country = '') {
    const code = String(country || '').trim().toUpperCase();
    return COUNTRY_LOCALE_PROFILE[code] || { timezone: 'America/Los_Angeles', language: 'en-US' };
}

/**
 * 铸造 OpenAI-Sentinel 风控令牌 (PoW 解答 + SO 传感器指纹 + OAI-Telemetry)
 * 用于调用受 Sentinel 保护的接口 (如 POST /backend-api/payments/checkout)
 *
 * @param {Object} [options]
 * @param {string} [options.flow='chatgpt_checkout'] - 业务流程标识
 * @param {string} [options.deviceId=''] - 客户端设备标识 oai-did
 * @param {string} [options.userAgent] - 浏览器 User-Agent (建议与当前 Chromium 实例一致)
 * @param {string} [options.proxy=''] - 代理服务器地址 (如 http://127.0.0.1:49599)
 * @param {string} [options.country=''] - 目标出口国家代码 (如 PH / US / EG / CL)
 * @param {string} [options.cookieHeader=''] - 当前会话 Cookie 请求头
 * @param {string} [options.timezone] - 显式覆盖时区
 * @param {string} [options.language] - 显式覆盖语言
 * @param {string} [options.pageUrl='https://chatgpt.com/'] - 发起请求的页面 URL
 * @param {string} [options.sentinelOrigin='https://chatgpt.com'] - Sentinel 服务源
 * @param {number} [options.timeoutMs=25000] - 超时时间 (毫秒)
 * @returns {Promise<{ sentinelToken: string, sentinelSoToken: string, telemetry: string, powReq?: boolean }>}
 */
function mintSentinelToken(options = {}) {
    const {
        flow = 'chatgpt_checkout',
        deviceId = '',
        userAgent = DEFAULT_UA,
        proxy = '',
        country = '',
        cookieHeader = '',
        timezone = '',
        language = '',
        pageUrl = 'https://chatgpt.com/',
        sentinelOrigin = 'https://chatgpt.com',
        timeoutMs = 25000
    } = options;

    const localeProfile = resolveSentinelLocaleProfile(country);
    const resolvedTimezone = String(timezone || localeProfile.timezone).trim();
    const resolvedLanguage = String(language || localeProfile.language).trim();

    return new Promise((resolve, reject) => {
        const payload = JSON.stringify({
            ua: userAgent || DEFAULT_UA,
            cores: 8,
            deviceId: String(deviceId || '').trim(),
            flow,
            proxy: String(proxy || '').trim(),
            version: '20260810913b',
            pageUrl: pageUrl || 'https://chatgpt.com/',
            language: resolvedLanguage,
            timezone: resolvedTimezone,
            platform: 'Win32',
            platformLabel: 'Windows',
            screenW: 1920,
            screenH: 1080,
            availH: 1032,
            maxTouchPoints: 0,
            cookieHeader: String(cookieHeader || '').trim(),
            sentinelOrigin: sentinelOrigin || 'https://chatgpt.com'
        });

        let timer = null;
        let child = null;

        try {
            child = spawn(process.execPath, [BRIDGE_PATH], {
                cwd: __dirname,
                stdio: ['pipe', 'pipe', 'pipe']
            });
        } catch (err) {
            return reject(new Error(`无法启动 Sentinel 桥接子进程: ${err.message}`));
        }

        timer = setTimeout(() => {
            if (child && !child.killed) {
                try { child.kill('SIGKILL'); } catch (_) {}
            }
            reject(new Error(`Sentinel 令牌生成超时 (${timeoutMs}ms)`));
        }, timeoutMs);

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (chunk) => { stdout += chunk; });
        child.stderr.on('data', (chunk) => { stderr += chunk; });

        child.on('close', (code) => {
            clearTimeout(timer);
            if (code !== 0) {
                const errDetail = stderr.trim() || `exit code ${code}`;
                return reject(new Error(`Sentinel 桥接异常退出: ${errDetail.slice(0, 300)}`));
            }

            try {
                const res = JSON.parse(stdout || '{}');
                if (res.error) {
                    return reject(new Error(`Sentinel 求解失败: ${res.error}`));
                }

                resolve({
                    sentinelToken: String(res.main || '').trim(),
                    sentinelSoToken: String(res.so || '').trim(),
                    telemetry: String(res.telemetry || '[1,null]').trim() || '[1,null]',
                    powReq: Boolean(res.powReq)
                });
            } catch (err) {
                reject(new Error(`解析 Sentinel 输出失败: ${err.message} (raw=${stdout.slice(0, 100)})`));
            }
        });

        child.on('error', (err) => {
            clearTimeout(timer);
            reject(new Error(`Sentinel 子进程通信错误: ${err.message}`));
        });

        child.stdin.end(payload);
    });
}

function raceWithTimeout(promise, ms, fallbackValue = null) {
    const capMs = Math.max(100, Number(ms || 0));
    let timer = null;
    return Promise.race([
        Promise.resolve(promise),
        new Promise((resolve) => {
            timer = setTimeout(() => resolve(fallbackValue), capMs);
        })
    ]).finally(() => {
        if (timer) clearTimeout(timer);
    });
}

/**
 * 在已打开 https://chatgpt.com 的页面内按官网 Cq5Q 模块同款方式加载 /backend-api/sentinel/sdk.js
 *
 * @param {import('playwright').Page|null} page
 * @param {number} [timeoutMs=8000]
 * @returns {Promise<boolean>}
 */
async function ensureInPageSentinelSdk(page, timeoutMs = 8000) {
    if (!page || page.isClosed?.() || typeof page.evaluate !== 'function' || typeof page.url !== 'function') {
        return false;
    }
    const currentUrl = String(page.url() || '');
    if (!/^https:\/\/chatgpt\.com/i.test(currentUrl)) {
        return false;
    }
    const capMs = Math.max(1000, Number(timeoutMs || 8000));
    const evalPromise = page.evaluate(async (waitMs) => {
        if (window?.SentinelSDK && typeof window.SentinelSDK.token === 'function') {
            return true;
        }
        const deadline = Date.now() + Math.max(1000, Number(waitMs || 8000));
        return await new Promise((resolve) => {
            if (!window.__kcSentinelSdkPromise) {
                window.__kcSentinelSdkPromise = new Promise((sdkResolve) => {
                    const finish = (ok) => sdkResolve(Boolean(ok));
                    const existing = document.querySelector('script[src*="/backend-api/sentinel/sdk.js"]');
                    if (existing) {
                        existing.addEventListener('load', () => finish(Boolean(window?.SentinelSDK?.token)), { once: true });
                        existing.addEventListener('error', () => finish(false), { once: true });
                        return;
                    }
                    const script = document.createElement('script');
                    script.async = true;
                    script.defer = true;
                    script.src = 'https://chatgpt.com/backend-api/sentinel/sdk.js';
                    script.addEventListener('load', () => finish(Boolean(window?.SentinelSDK?.token)), { once: true });
                    script.addEventListener('error', () => finish(false), { once: true });
                    (document.head || document.documentElement).append(script);
                }).finally(() => {
                    if (!window?.SentinelSDK?.token) {
                        window.__kcSentinelSdkPromise = null;
                    }
                });
            }
            const timer = setInterval(() => {
                if (window?.SentinelSDK && typeof window.SentinelSDK.token === 'function') {
                    clearInterval(timer);
                    resolve(true);
                } else if (Date.now() >= deadline) {
                    clearInterval(timer);
                    resolve(false);
                }
            }, 80);
            Promise.resolve(window.__kcSentinelSdkPromise).then((ok) => {
                clearInterval(timer);
                resolve(Boolean(ok && window?.SentinelSDK && typeof window.SentinelSDK.token === 'function'));
            }).catch(() => {
                clearInterval(timer);
                resolve(false);
            });
        });
    }, capMs).catch(() => false);
    return Boolean(await raceWithTimeout(evalPromise, capMs + 1500, false));
}

/**
 * 优先从已加载 chatgpt.com 的浏览器页面上下文调用实时 window.SentinelSDK 签发风控令牌
 *
 * @param {import('playwright').Page|null} page
 * @param {string} [flow='chatgpt_checkout']
 * @param {{ waitForSdkMs?: number, tokenTimeoutMs?: number }} [options]
 * @returns {Promise<{ sentinelToken: string, sentinelSoToken: string, telemetry: string, source: string } | null>}
 */
async function mintInPageSentinelToken(page, flow = 'chatgpt_checkout', options = {}) {
    if (!page || page.isClosed?.() || typeof page.evaluate !== 'function' || typeof page.url !== 'function') {
        return null;
    }
    const currentUrl = String(page.url() || '');
    if (!/^https:\/\/chatgpt\.com/i.test(currentUrl)) {
        return null;
    }
    const startedAt = Date.now();
    const waitForSdkMs = Math.max(0, Number(options?.waitForSdkMs || 0));
    const tokenTimeoutMs = Math.max(1000, Number(options?.tokenTimeoutMs || 7000));
    if (waitForSdkMs > 0) {
        const sdkLoaded = await ensureInPageSentinelSdk(page, waitForSdkMs);
        if (!sdkLoaded) {
            console.log(`[Sentinel/inpage] ${JSON.stringify({ stage: 'sdk_load_timeout', sdkLoaded: false, elapsedMs: Date.now() - startedAt })}`);
            return null;
        }
    }
    const evalPromise = page.evaluate(async ({ targetFlow, budgetMs }) => {
        const sdk = window?.SentinelSDK;
        if (!sdk || typeof sdk.token !== 'function') {
            return { ok: false, stage: 'sdk_missing' };
        }
        const bounded = (promise, ms, fallback = null) => new Promise((resolve) => {
            const t = setTimeout(() => resolve({ timedOut: true, value: fallback }), Math.max(100, ms));
            Promise.resolve(promise)
                .then((value) => {
                    clearTimeout(t);
                    resolve({ timedOut: false, value });
                })
                .catch(() => {
                    clearTimeout(t);
                    resolve({ timedOut: false, value: fallback });
                });
        });
        try {
            const deadline = Date.now() + budgetMs;
            const remaining = (minMs = 400) => Math.max(minMs, deadline - Date.now());
            let stage = 'sdk_init';
            if (typeof sdk.init === 'function') {
                const initRes = await bounded(sdk.init(targetFlow), Math.min(7500, remaining()), null);
                if (initRes.timedOut) {
                    return { ok: false, stage: 'sdk_init_timeout' };
                }
            }
            stage = 'sdk_token';
            const [soRes, tokenRes] = await Promise.all([
                typeof sdk.sessionObserverToken === 'function' && remaining(0) > 300
                    ? bounded(sdk.sessionObserverToken('chatgpt_checkout'), Math.min(2000, remaining()), '')
                    : Promise.resolve({ timedOut: false, value: '' }),
                bounded(sdk.token(targetFlow), Math.max(2000, remaining()), '')
            ]);
            const sentinelSoToken = String(soRes?.value || '').trim();
            if (tokenRes.timedOut) {
                return { ok: false, stage: 'sdk_token_timeout', hasSoToken: Boolean(sentinelSoToken) };
            }
            const sentinelToken = String(tokenRes.value || '').trim();
            if (!sentinelToken) {
                return { ok: false, stage: 'sdk_token_empty', hasSoToken: Boolean(sentinelSoToken) };
            }
            let timingVal = null;
            if (typeof sdk.timing === 'function') {
                const timingRes = await bounded(sdk.timing(), 500, null);
                timingVal = timingRes.value;
            }
            const telemetry = timingVal ? String(timingVal).trim() : '[1,null]';
            return { ok: true, stage: 'ready', sentinelToken, sentinelSoToken, telemetry, source: 'browser_sdk' };
        } catch (err) {
            return { ok: false, stage: 'sdk_eval_error', error: String(err?.message || err || '').slice(0, 80) };
        }
    }, { targetFlow: flow, budgetMs: tokenTimeoutMs }).catch(() => ({ ok: false, stage: 'page_evaluate_error' }));

    const result = await raceWithTimeout(evalPromise, tokenTimeoutMs + 1500, { ok: false, stage: 'node_eval_timeout' });
    console.log(`[Sentinel/inpage] ${JSON.stringify({
        stage: result?.stage || 'unknown',
        ok: Boolean(result?.ok),
        elapsedMs: Date.now() - startedAt
    })}`);
    if (!result?.ok || !result?.sentinelToken) {
        return null;
    }
    return {
        sentinelToken: result.sentinelToken,
        sentinelSoToken: result.sentinelSoToken || '',
        telemetry: result.telemetry || '[1,null]',
        source: result.source || 'browser_sdk'
    };
}

module.exports = {
    mintSentinelToken,
    mintInPageSentinelToken,
    ensureInPageSentinelSdk,
    resolveSentinelLocaleProfile,
    DEFAULT_UA
};
