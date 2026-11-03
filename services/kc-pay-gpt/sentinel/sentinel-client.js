'use strict';

const { spawn } = require('child_process');
const path = require('path');

const BRIDGE_PATH = path.join(__dirname, 'sentinel_bridge.js');
const DEFAULT_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';

/**
 * 铸造 OpenAI-Sentinel 风控令牌 (PoW 解答 + SO 传感器指纹)
 * 用于调用受 Sentinel 保护的接口 (如 POST /backend-api/payments/checkout)
 *
 * @param {Object} [options]
 * @param {string} [options.flow='chatgpt_checkout'] - 业务流程标识
 * @param {string} [options.deviceId=''] - 客户端设备标识 oai-did
 * @param {string} [options.userAgent] - 浏览器 User-Agent (建议与当前 Chromium 实例一致)
 * @param {string} [options.proxy=''] - 代理服务器地址 (如 http://127.0.0.1:49599)
 * @param {string} [options.pageUrl='https://chatgpt.com/'] - 发起请求的页面 URL
 * @param {string} [options.sentinelOrigin='https://chatgpt.com'] - Sentinel 服务源
 * @param {number} [options.timeoutMs=25000] - 超时时间 (毫秒)
 * @returns {Promise<{ sentinelToken: string, sentinelSoToken: string, powReq?: boolean }>}
 */
function mintSentinelToken(options = {}) {
    const {
        flow = 'chatgpt_checkout',
        deviceId = '',
        userAgent = DEFAULT_UA,
        proxy = '',
        pageUrl = 'https://chatgpt.com/',
        sentinelOrigin = 'https://chatgpt.com',
        timeoutMs = 25000
    } = options;

    return new Promise((resolve, reject) => {
        const payload = JSON.stringify({
            ua: userAgent || DEFAULT_UA,
            cores: 8,
            deviceId: String(deviceId || '').trim(),
            flow,
            proxy: String(proxy || '').trim(),
            version: '20260810913b',
            pageUrl: pageUrl || 'https://chatgpt.com/',
            language: 'en-US',
            timezone: 'America/New_York',
            platform: 'Win32',
            platformLabel: 'Windows',
            screenW: 1920,
            screenH: 1080,
            availH: 1032,
            maxTouchPoints: 0,
            cookieHeader: '',
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
