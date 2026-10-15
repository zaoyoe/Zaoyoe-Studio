'use strict';

const ProxyChain = require('proxy-chain');

function maskProxyUrl(url) {
    return String(url || '').replace(/\/\/([^:@/]+):([^@/]+)@/i, '//$1:***@');
}

function isSocksProtocol(protocol) {
    const p = String(protocol || '').replace(':', '').toLowerCase();
    return p === 'socks' || p === 'socks4' || p === 'socks5' || p === 'socks5h';
}

function buildDirectPlaywrightProxy(parsed) {
    const server = `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ''}`;
    const proxy = { server };
    if (parsed.username) {
        proxy.username = decodeURIComponent(parsed.username);
    }
    if (parsed.password) {
        proxy.password = decodeURIComponent(parsed.password);
    }
    return proxy;
}

/**
 * 将任意格式的代理文本智能标准化为标准的代理 URL
 */
function formatToStandardProxyUrl(raw) {
    if (!raw || typeof raw !== 'string') return '';
    let line = raw.trim();
    if (!line) return '';

    if (/^[a-zA-Z0-9+.-]+:\/\//.test(line)) {
        return line;
    }
    if (line.includes('@')) {
        return `http://${line}`;
    }
    const parts = line.split(':');
    if (parts.length === 4) {
        const [host, port, user, pass] = parts;
        return `http://${user}:${pass}@${host}:${port}`;
    } else if (parts.length === 2 && /^\d+$/.test(parts[1])) {
        return `http://${line}`;
    }
    return `http://${line}`;
}

function substituteProxySession(rawProxy) {
    if (!rawProxy) return rawProxy;
    if (!/\{session\}/i.test(rawProxy)) {
        // 自动兼容形如 -sid-xxxx- 的固定 session，将其转换为新随机 session 避免 5 分钟超时
        if (/-sid-[a-zA-Z0-9_-]+-t-/i.test(rawProxy)) {
            const sid = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
            return rawProxy.replace(/-sid-[a-zA-Z0-9_-]+-t-/i, `-sid-${sid}-t-`);
        }
        return rawProxy;
    }
    const sid = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    return rawProxy.replace(/\{session\}/gi, sid);
}

/**
 * Playwright Chromium 原生对带账号密码的 SOCKS/HTTP 住宅代理容易因 CONNECT 握手断开。
 * 统一通过 proxy-chain 转成本地 HTTP 中继，彻底消灭 "Proxy connection ended before receiving CONNECT response"。
 * @param {string} proxyValue
 * @returns {Promise<{ proxyConfig: object|null, cleanup: () => Promise<void>, relayed?: boolean }>}
 */
async function preparePlaywrightProxy(proxyValue) {
    const raw = String(proxyValue || '').trim();
    if (!raw) {
        return { proxyConfig: null, cleanup: async () => { } };
    }

    const stdUrl = substituteProxySession(formatToStandardProxyUrl(raw));

    let parsed;
    try {
        parsed = new URL(stdUrl);
    } catch (error) {
        console.warn(`[!] [系统] 代理 URL 解析失败，将按原始值使用: ${error.message}`);
        return {
            proxyConfig: { server: raw },
            cleanup: async () => { }
        };
    }

    const hasAuth = Boolean(parsed.username || parsed.password);
    if (hasAuth) {
        try {
            const localProxyUrl = await ProxyChain.anonymizeProxy(stdUrl);
            const protoLabel = isSocksProtocol(parsed.protocol) ? 'SOCKS' : 'HTTP';
            console.log(`🌐 [系统] ${protoLabel} 认证代理已转为本地稳定 HTTP 中继: ${maskProxyUrl(localProxyUrl)}`);
            return {
                proxyConfig: { server: localProxyUrl },
                relayed: true,
                cleanup: async () => {
                    await ProxyChain.closeAnonymizedProxy(localProxyUrl, true).catch(() => { });
                }
            };
        } catch (chainErr) {
            console.warn(`[!] [系统] proxy-chain 中继启动异常，回退到直连代理: ${chainErr.message}`);
        }
    }

    return {
        proxyConfig: buildDirectPlaywrightProxy(parsed),
        cleanup: async () => { }
    };
}

module.exports = {
    preparePlaywrightProxy,
    isSocksProtocol
};
