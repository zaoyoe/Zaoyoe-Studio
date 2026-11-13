'use strict';

const { spawn } = require('child_process');
const path = require('path');
const { getChatGptProtocolProfile } = require('../region-config');

const BRIDGE_PATH = path.join(__dirname, 'sentinel_bridge.js');
const DEFAULT_UA = getChatGptProtocolProfile('US').userAgent;

/**
 * 铸造 OpenAI-Sentinel 风控令牌 (PoW 解答 + SO 传感器指纹)
 * 用于调用受 Sentinel 保护的接口 (如 POST /backend-api/payments/checkout)
 *
 * @param {Object} [options]
 * @param {string} [options.flow='chatgpt_checkout'] - 业务流程标识
 * @param {string} [options.deviceId=''] - 客户端设备标识 oai-did
 * @param {string} [options.userAgent] - 浏览器 User-Agent (建议与当前链路完全一致)
 * @param {string} [options.region=''] - 出口/结算地区代码 (如 PH/US/EG/CL)
 * @param {string} [options.language] - 浏览器语言 (默认按 region 推导)
 * @param {string} [options.acceptLanguage] - Accept-Language 请求头 (默认按 language 推导)
 * @param {string} [options.timezone] - 时区 (默认按 region 推导)
 * @param {string} [options.cookieHeader=''] - ChatGPT 会话 Cookie 请求头
 * @param {string} [options.proxy=''] - 代理服务器地址 (如 http://127.0.0.1:49599)
 * @param {string} [options.pageUrl='https://chatgpt.com/'] - 发起请求的页面 URL
 * @param {string} [options.sentinelOrigin='https://chatgpt.com'] - Sentinel 服务源
 * @param {number} [options.timeoutMs=25000] - 超时时间 (毫秒)
 * @returns {Promise<{ sentinelToken: string, sentinelSoToken: string, powReq?: boolean }>}
 */
function mintSentinelToken(options = {}) {
    const profile = getChatGptProtocolProfile(options.region || options.country || 'US', {
        userAgent: options.userAgent,
        language: options.language,
        timezone: options.timezone,
        acceptLanguage: options.acceptLanguage
    });
    const {
        flow = 'chatgpt_checkout',
        deviceId = '',
        cookieHeader = '',
        proxy = '',
        pageUrl = 'https://chatgpt.com/',
        sentinelOrigin = 'https://chatgpt.com',
        timeoutMs = 25000
    } = options;

    return new Promise((resolve, reject) => {
        const payload = JSON.stringify({
            ua: profile.userAgent,
            cores: 8,
            deviceId: String(deviceId || '').trim(),
            flow,
            proxy: String(proxy || '').trim(),
            version: '20260810913b',
            pageUrl: pageUrl || 'https://chatgpt.com/',
            language: profile.language,
            acceptLanguage: profile.acceptLanguage,
            timezone: profile.timezone,
            platform: options.platform || profile.platform,
            platformLabel: options.platformLabel || profile.platformLabel,
            secChUa: options.secChUa || profile.secChUa,
            secChUaPlatform: options.secChUaPlatform || profile.secChUaPlatform,
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

module.exports = {
    mintSentinelToken,
    DEFAULT_UA
};
