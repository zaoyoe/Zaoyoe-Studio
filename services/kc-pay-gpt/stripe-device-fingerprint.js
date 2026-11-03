'use strict';

const crypto = require('crypto');
const axios = require('axios');

const FINGERPRINT_URL = 'https://m.stripe.com/6';

const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';

const CANVAS_SAMPLES = [
    '0100100101111111101111101111111001110010110111110111111',
    '0100100101111111101111101111111001110010110111110111110',
    '0100100101111111101111101111111001110010110111110111101'
];

const AUDIO_SAMPLES = [
    'd331ca493eb692cfcd19ae5db713ad4b',
    'a7c5f72e1b3d4e8f9c0d2a6b7e8f1c3d',
    'e4b8d6f2a0c3d5e7f9b1c3d5e7f9a0b2'
];

const PLUGINS = 'PDF Viewer,internal-pdf-viewer,application/pdf,pdf++text/pdf,pdf, Chrome PDF Viewer,internal-pdf-viewer,application/pdf,pdf++text/pdf,pdf, Chromium PDF Viewer,internal-pdf-viewer,application/pdf,pdf++text/pdf,pdf';

function randomSeg(n = 32) {
    return crypto.randomBytes(n).toString('base64url');
}

function encodeFingerprintPayload(payload) {
    const raw = JSON.stringify(payload);
    const encoded = encodeURIComponent(raw);
    return Buffer.from(encoded).toString('base64');
}

/**
 * 向 Stripe 官方指纹端点 (https://m.stripe.com/6) 注册设备真实指纹并换取 guid, muid, sid
 * 使得后续调用可以明确区分“官方已签发的设备上下文”和“本地伪造值”。
 *
 * 重要：官方端点不可用、返回不完整或请求被拦截时必须失败关闭。随机生成的
 * guid/muid/sid 不是有效的 Stripe 设备凭证，不能继续用于支付请求。
 * @param {object} options
 * @param {string} [options.proxy] 代理地址
 * @param {number} [options.timeoutMs=3500] 超时时间
 * @param {string} [options.userAgent] 浏览器 UA
 * @param {Function} [options.request] 仅供离线测试注入的请求函数
 * @returns {Promise<{ guid: string, muid: string, sid: string, source: string }>}
 */
async function registerStripeDeviceFingerprint(options = {}) {
    const timeoutMs = options.timeoutMs ?? 3500;
    const fpId = crypto.randomBytes(16).toString('hex');
    const s = [randomSeg(), randomSeg(), randomSeg(), randomSeg(), randomSeg()];
    const ua = options.userAgent || DEFAULT_UA;

    const screens = [
        { sw: 1920, sh: 1080, dpr: 1 },
        { sw: 1536, sh: 864, dpr: 1.25 },
        { sw: 2560, sh: 1440, dpr: 1 }
    ];
    const pickedScreen = screens[Math.floor(Math.random() * screens.length)];
    const vh = pickedScreen.sh - Math.floor(40 + Math.random() * 30);
    const cpu = [4, 8, 12, 16][Math.floor(Math.random() * 4)];
    const canvas = CANVAS_SAMPLES[Math.floor(Math.random() * CANVAS_SAMPLES.length)];
    const audio = AUDIO_SAMPLES[Math.floor(Math.random() * AUDIO_SAMPLES.length)];

    const payload = {
        v2: 1,
        id: fpId,
        t: Number((Math.random() * 60 + 5).toFixed(1)),
        tag: '6',
        src: 'js',
        a: {
            a: { v: 'true', t: 0 },
            b: { v: 'true', t: 0 },
            c: { v: 'en-US', t: 0 },
            d: { v: 'Win32', t: 0 },
            e: { v: PLUGINS, t: Number((Math.random() * 0.4).toFixed(1)) },
            f: { v: `${pickedScreen.sw}w_${vh}h_24d_${pickedScreen.dpr}r`, t: 0 },
            g: { v: String(cpu), t: 0 },
            h: { v: 'false', t: 0 },
            i: { v: 'sessionStorage-enabled, localStorage-enabled', t: Number((Math.random() * 1.5 + 0.5).toFixed(1)) },
            j: { v: canvas, t: Number((Math.random() * 20 + 5).toFixed(1)) },
            k: { v: '', t: 0 },
            l: { v: ua, t: 0 },
            m: { v: '', t: 0 },
            n: { v: 'false', t: Number((Math.random() * 15 + 2).toFixed(1)) },
            o: { v: audio, t: Number((Math.random() * 10 + 15).toFixed(1)) }
        },
        b: {
            a: `https://${s[0]}.${s[1]}.${s[2]}/`,
            b: `https://${s[0]}.${s[2]}/${s[3]}/${s[4]}/${randomSeg()}`,
            c: randomSeg(),
            d: 'NA',
            e: 'NA',
            f: false,
            g: true,
            h: true,
            i: ['location'],
            j: [],
            n: Math.floor(Math.random() * 1200 + 800),
            u: 'chatgpt.com',
            v: 'auth.openai.com',
            w: `${Date.now()}:${crypto.createHash('sha256').update(crypto.randomBytes(32)).digest('hex')}`
        },
        h: crypto.randomBytes(10).toString('hex')
    };

    const config = {
        timeout: timeoutMs,
        validateStatus: () => true,
        headers: {
            'User-Agent': ua,
            'Content-Type': 'text/plain;charset=UTF-8',
            'Accept': '*/*',
            'Origin': 'https://m.stripe.network',
            'Referer': 'https://m.stripe.network/'
        }
    };

    if (options.proxy && String(options.proxy).trim()) {
        try {
            const { ProxyAgent } = require('proxy-agent');
            const agent = new ProxyAgent({ getProxyForUrl: () => String(options.proxy).trim() });
            config.httpAgent = agent;
            config.httpsAgent = agent;
            config.proxy = false;
        } catch (_) {}
    }

    const assertRegistered = (status, data) => {
        const guid = String(data?.guid || '').trim();
        const muid = String(data?.muid || '').trim();
        const sid = String(data?.sid || '').trim();
        if (Number(status) === 200 && data && typeof data === 'object' && guid && muid && sid) {
            return {
                guid,
                muid,
                sid,
                clientSessionId: options.clientSessionId || crypto.randomUUID(),
                userAgent: ua,
                source: 'stripe_registered'
            };
        }
        throw Object.assign(
            new Error(`Stripe 官方设备指纹未确认 (HTTP ${status || 'unknown'})`),
            { code: 'STRIPE_DEVICE_FINGERPRINT_UNAVAILABLE' }
        );
    };

    try {
        const bodyData = encodeFingerprintPayload(payload);
        const proxyStr = String(options.proxy || '').trim();
        let data = null;
        let status = 0;

        if (typeof options.request === 'function') {
            const response = await options.request({
                url: FINGERPRINT_URL,
                body: bodyData,
                headers: config.headers,
                timeoutMs,
                proxy: proxyStr
            });
            status = response?.status;
            data = response?.data;
            if (typeof data === 'string') {
                try { data = JSON.parse(data); } catch (_) {}
            }
            return assertRegistered(status, data);
        }

        try {
            const { Impit } = require('impit');
            const client = new Impit({
                browser: 'chrome',
                proxyUrl: proxyStr || undefined,
                ignoreTlsErrors: true,
                timeout: timeoutMs
            });
            const resp = await client.fetch(FINGERPRINT_URL, {
                method: 'POST',
                headers: config.headers,
                body: bodyData
            });
            status = resp.status;
            const text = await resp.text();
            data = JSON.parse(text);
        } catch (_) {
            const res = await axios.post(FINGERPRINT_URL, bodyData, config);
            status = res.status;
            data = res.data;
        }

        return assertRegistered(status, data);
    } catch (err) {
        if (err?.code === 'STRIPE_DEVICE_FINGERPRINT_UNAVAILABLE') throw err;
        throw Object.assign(
            new Error(`Stripe 官方设备指纹请求失败: ${err.message || 'unknown error'}`),
            { code: 'STRIPE_DEVICE_FINGERPRINT_UNAVAILABLE', cause: err }
        );
    }
}

module.exports = {
    registerStripeDeviceFingerprint,
    encodeFingerprintPayload
};
