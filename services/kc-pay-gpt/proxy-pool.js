'use strict';

const crypto = require('crypto');
const axios = require('axios');
const { ProxyAgent } = require('proxy-agent');

const PROBE_URLS = [
    'https://api.ipify.org/?format=text',
    'https://ifconfig.me/ip'
];

function substituteProxySession(rawProxy) {
    if (!rawProxy) {
        return rawProxy;
    }
    const sid = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const numSid = String(Math.floor(10000000 + Math.random() * 90000000));
    let replaced = rawProxy;
    if (/\{session\}/i.test(replaced)) {
        replaced = replaced.replace(/\{session\}/gi, numSid);
    } else if (/-session-[a-zA-Z0-9_]+(?=[-:@/]|$)/i.test(replaced)) {
        // 自动兼容形如 -session-29028475- 的固定动态住宅 session，替换为全新 8 位随机 session，避免重复使用相同节点
        replaced = replaced.replace(/-session-[a-zA-Z0-9_]+(?=[-:@/]|$)/i, `-session-${numSid}`);
    }
    if (/-sid-[a-zA-Z0-9_-]+-t-/i.test(replaced)) {
        replaced = replaced.replace(/-sid-[a-zA-Z0-9_-]+-t-/i, `-sid-${sid}-t-`);
    }
    return replaced;
}

function alignProxyRegion(rawProxy, targetRegion) {
    if (!rawProxy || !targetRegion) return rawProxy;
    const regionUpper = String(targetRegion).trim().toUpperCase();
    const regionLower = regionUpper.toLowerCase();
    if (!/^[A-Z]{2}$/.test(regionUpper)) return rawProxy;

    let aligned = rawProxy;
    aligned = aligned.replace(/\{region\}/gi, regionLower);
    aligned = aligned.replace(/\{country\}/gi, regionLower);

    if (/-region-[a-zA-Z]{2}-/i.test(aligned)) {
        aligned = aligned.replace(/-region-[a-zA-Z]{2}-/i, `-region-${regionUpper}-`);
    }
    if (/-country-[a-zA-Z]{2}-/i.test(aligned)) {
        aligned = aligned.replace(/-country-[a-zA-Z]{2}-/i, `-country-${regionUpper}-`);
    } else if (/_country-[a-zA-Z]{2}(?=[-:@/]|$)/i.test(aligned)) {
        aligned = aligned.replace(/_country-[a-zA-Z]{2}(?=[-:@/]|$)/i, `_country-${regionLower}`);
    }
    if (/-res_sc-[a-zA-Z]{2}(?:_[a-zA-Z0-9]+)?(?=[-:@/]|$)/i.test(aligned)) {
        aligned = aligned.replace(/-res_sc-[a-zA-Z]{2}(?:_[a-zA-Z0-9]+)?(?=[-:@/]|$)/i, `-res_sc-${regionUpper}`);
    }

    return aligned;
}

function maskProxyUrl(url) {
    return String(url || '').replace(/\/\/([^:@/]+):([^@/]+)@/i, '//$1:***@');
}

function hashProxyUrl(url) {
    return crypto.createHash('sha256').update(String(url || '').trim()).digest('hex');
}

/**
 * 将任意格式的代理文本智能标准化为标准的代理 URL
 * 兼容支持：
 * 1. 标准 URL：http://user:pass@host:port、socks5://user:pass@host:port
 * 2. 传统冒号格式：host:port:user:pass -> http://user:pass@host:port
 * 3. 简化冒号格式：host:port -> http://host:port
 * 4. 带认证无协议：user:pass@host:port -> http://user:pass@host:port
 */
function formatToStandardProxyUrl(raw) {
    if (!raw || typeof raw !== 'string') return '';
    let line = raw.trim();
    if (!line) return '';

    // 已包含标准协议头
    if (/^[a-zA-Z0-9+.-]+:\/\//.test(line)) {
        return line;
    }

    // 格式: user:pass@host:port
    if (line.includes('@')) {
        return `http://${line}`;
    }

    // 格式: host:port:user:pass 或 host:port
    const parts = line.split(':');
    if (parts.length === 4) {
        const [host, port, user, pass] = parts;
        return `http://${user}:${pass}@${host}:${port}`;
    } else if (parts.length === 2 && /^\d+$/.test(parts[1])) {
        return `http://${line}`;
    }

    return `http://${line}`;
}

function parseProxyMeta(url) {
    try {
        const stdUrl = formatToStandardProxyUrl(url);
        const parsed = new URL(String(stdUrl || '').trim());
        return {
            protocol: String(parsed.protocol || '').replace(':', '').toLowerCase(),
            host: parsed.hostname || ''
        };
    } catch (_) {
        return { protocol: '', host: '' };
    }
}

function normalizeProxyLines(input) {
    const lines = Array.isArray(input)
        ? input
        : String(input || '').split(/\r?\n/);
    return [...new Set(lines.map((line) => formatToStandardProxyUrl(line)).filter(Boolean))];
}

async function testProxyUrl(raw, options = {}) {
    const formatted = formatToStandardProxyUrl(raw);
    const proxyUrl = substituteProxySession(String(formatted || '').trim());
    const t0 = Date.now();
    if (!proxyUrl) {
        return { ok: false, error: '代理 URL 为空', latencyMs: 0 };
    }

    let agent;
    try {
        agent = new ProxyAgent({ getProxyForUrl: () => proxyUrl });
    } catch (error) {
        return { ok: false, error: `代理 URL 解析失败: ${error.message}`, latencyMs: Date.now() - t0 };
    }

    const timeout = Math.max(3000, Number(options.timeoutMs) || 12000);
    let lastErr = '';
    for (const probeUrl of PROBE_URLS) {
        try {
            const response = await axios.get(probeUrl, {
                httpsAgent: agent,
                httpAgent: agent,
                proxy: false,
                timeout,
                validateStatus: () => true
            });
            if (response.status === 200) {
                const ip = String(response.data || '').trim().split(/\s+/)[0];
                return {
                    ok: true,
                    ip,
                    latencyMs: Date.now() - t0,
                    probedVia: probeUrl
                };
            }
            lastErr = `HTTP ${response.status} via ${probeUrl}`;
        } catch (error) {
            lastErr = `${error.code || ''} ${error.message}`.trim();
        }
    }

    return {
        ok: false,
        error: lastErr || '未知错误',
        latencyMs: Date.now() - t0
    };
}

/**
 * 智能判定代理是否与目标地区匹配
 * 优先匹配：
 * 1. 代理备注 label（如 "智利", "CL", "菲律宾", "PH"）
 * 2. 代理 URL 中的区域标识参数（如 region-CL, region-PH, country-CL, country_code=ph, etc.）
 * @param {string} proxyUrl
 * @param {string} label
 * @param {string} targetRegion
 * @returns {boolean}
 */
function matchProxyRegion(proxyUrl, label, targetRegion) {
    if (proxyUrl && typeof proxyUrl === 'object' && targetRegion === undefined) {
        targetRegion = label;
        label = proxyUrl.label || '';
        proxyUrl = proxyUrl.proxy_url || proxyUrl.url || '';
    }
    if (!targetRegion) return true;
    const code = String(targetRegion).trim().toUpperCase();
    if (!code) return true;

    const urlStr = String(proxyUrl || '');
    const labelStr = String(label || '');

    // 1. 检查 label 是否包含地区标识或中文别名
    const regionAliases = {
        PH: ['PH', '菲律宾', 'Philippines', 'Pilipinas'],
        CL: ['CL', '智利', 'Chile'],
        US: ['US', 'USA', '美国', 'United States'],
        SG: ['SG', '新加坡', 'Singapore'],
        MY: ['MY', '马来西亚', 'Malaysia'],
        HK: ['HK', '香港', 'Hong Kong'],
        JP: ['JP', '日本', 'Japan'],
        TW: ['TW', '台湾', 'Taiwan'],
        GB: ['GB', 'UK', '英国', 'United Kingdom']
    };
    const aliases = regionAliases[code] || [code];
    for (const alias of aliases) {
        const re = new RegExp(`(^|[^a-zA-Z0-9])${alias}([^a-zA-Z0-9]|$)`, 'i');
        if (re.test(labelStr)) return true;
    }

    // 2. 检查 URL 中常见的地区参数 (例如 -region-PH-, country-PH, _region_PH, country_code=ph, etc.)
    const urlPatterns = [
        new RegExp(`(?:region|country|zone|geo)[-_=:]+${code}\\b`, 'i'),
        new RegExp(`[-_:]+${code}[-_:]+`, 'i'),
        new RegExp(`\\b${code}\\.(?:prox|cliprox|smartprox)`, 'i')
    ];
    for (const pat of urlPatterns) {
        if (pat.test(urlStr)) return true;
    }

    return false;
}

module.exports = {
    PROBE_URLS,
    substituteProxySession,
    maskProxyUrl,
    hashProxyUrl,
    parseProxyMeta,
    normalizeProxyLines,
    testProxyUrl,
    matchProxyRegion,
    alignProxyRegion
};
