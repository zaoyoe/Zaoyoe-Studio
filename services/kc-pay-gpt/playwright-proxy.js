'use strict';

const http = require('http');
const https = require('https');
const ProxyChain = require('proxy-chain');

const activeTunnelSockets = new Set();

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
    const sid = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const numSid = String(Math.floor(10000000 + Math.random() * 90000000));
    let replaced = rawProxy;
    if (/\{session\}/i.test(replaced)) {
        replaced = replaced.replace(/\{session\}/gi, numSid);
    } else if (/-session-[a-zA-Z0-9_]+(?=[-:@/]|$)/i.test(replaced)) {
        // 自动兼容形如 -session-29028475- 的固定动态住宅 session，替换为全新 8 位随机 session，避免重复使用相同节点
        replaced = replaced.replace(/-session-[a-zA-Z0-9_]+(?=[-:@/]|$)/i, `-session-${numSid}`);
    }
    // 自动兼容形如 -sid-xxxx- 的固定 session，将其转换为新随机 session 避免 5 分钟超时
    if (/-sid-[a-zA-Z0-9_-]+-t-/i.test(replaced)) {
        replaced = replaced.replace(/-sid-[a-zA-Z0-9_-]+-t-/i, `-sid-${sid}-t-`);
    }
    return replaced;
}

/**
 * 主动断开当前所有本地代理中继隧道（用于页面支付前 reload 恢复时淘汰僵死的 HTTP/2 连接池，强制重新握手获取新住宅节点）
 */
function resetActiveProxyTunnels() {
    let closed = 0;
    for (const pair of [...activeTunnelSockets]) {
        activeTunnelSockets.delete(pair);
        try { pair.targetSocket?.destroy(); } catch (_) {}
        try { pair.sourceSocket?.destroy(); } catch (_) {}
        closed += 1;
    }
    return closed;
}

function attachTunnelWatchdog(sourceSocket, targetSocket, handshakeTimeoutMs = 12000) {
    const pair = { sourceSocket, targetSocket };
    activeTunnelSockets.add(pair);
    try { targetSocket.setKeepAlive(true, 5000); } catch (_) {}
    try { targetSocket.setNoDelay(true); } catch (_) {}
    try { sourceSocket.setNoDelay(true); } catch (_) {}

    // 仅监控隧道建立后的首个往返（TLS 握手）：浏览器已发出首包而上游住宅节点始终 0 字节返回，
    // 视为半开黑洞并销毁，让浏览器重新 CONNECT。一旦收到过任何上游字节即永久解除监控，
    // 绝不因 HTTP/2 空闲、WINDOW_UPDATE/PING 等无需回包的帧误杀健康连接。
    let stallTimer = null;
    let established = false;
    const clearStallTimer = () => {
        if (stallTimer) {
            clearTimeout(stallTimer);
            stallTimer = null;
        }
    };
    const onSourceData = () => {
        if (established || stallTimer) return;
        stallTimer = setTimeout(() => {
            stallTimer = null;
            if (established) return;
            activeTunnelSockets.delete(pair);
            try { targetSocket.destroy(); } catch (_) {}
            try { sourceSocket.destroy(); } catch (_) {}
        }, handshakeTimeoutMs);
        stallTimer.unref?.();
    };
    const onTargetData = () => {
        established = true;
        clearStallTimer();
        sourceSocket.off('data', onSourceData);
        targetSocket.off('data', onTargetData);
    };
    sourceSocket.on('data', onSourceData);
    targetSocket.on('data', onTargetData);

    const cleanupPair = () => {
        clearStallTimer();
        activeTunnelSockets.delete(pair);
    };
    sourceSocket.once('close', cleanupPair);
    targetSocket.once('close', cleanupPair);
    sourceSocket.once('error', cleanupPair);
    targetSocket.once('error', cleanupPair);
}

function connectUpstreamWithRetry(parsedProxy, targetHostPort, options = {}) {
    const maxAttempts = options.maxAttempts ?? 3;
    const connectTimeoutMs = options.connectTimeoutMs ?? 6500;
    const authHeader = (parsedProxy.username || parsedProxy.password)
        ? `Basic ${Buffer.from(`${decodeURIComponent(parsedProxy.username)}:${decodeURIComponent(parsedProxy.password)}`).toString('base64')}`
        : '';
    const requestModule = parsedProxy.protocol === 'https:' ? https : http;

    return new Promise((resolve, reject) => {
        let attempt = 0;
        const tryOnce = () => {
            attempt += 1;
            let settled = false;
            const req = requestModule.request({
                protocol: parsedProxy.protocol,
                hostname: parsedProxy.hostname,
                port: parsedProxy.port || (parsedProxy.protocol === 'https:' ? 443 : 80),
                method: 'CONNECT',
                path: targetHostPort,
                headers: {
                    host: targetHostPort,
                    ...(authHeader ? { 'proxy-authorization': authHeader } : {})
                },
                rejectUnauthorized: false
            });

            const timer = setTimeout(() => {
                if (settled) return;
                settled = true;
                try { req.destroy(); } catch (_) {}
                if (attempt < maxAttempts) {
                    return tryOnce();
                }
                reject(new Error(`Upstream CONNECT timeout after ${attempt} attempts`));
            }, connectTimeoutMs);
            timer.unref?.();

            req.once('connect', (res, targetSocket, head) => {
                clearTimeout(timer);
                if (settled) {
                    try { targetSocket.destroy(); } catch (_) {}
                    return;
                }
                if (res.statusCode === 200) {
                    settled = true;
                    resolve({ res, targetSocket, head });
                    return;
                }
                try { targetSocket.destroy(); } catch (_) {}
                // 住宅代理随机出口节点握手失败常返回 502/503，自动重试切换新节点
                if (attempt < maxAttempts && res.statusCode !== 407 && res.statusCode !== 401) {
                    settled = true;
                    return tryOnce();
                }
                settled = true;
                reject(new Error(`Upstream CONNECT HTTP ${res.statusCode}`));
            });

            req.once('error', (err) => {
                clearTimeout(timer);
                if (settled) return;
                settled = true;
                if (attempt < maxAttempts) {
                    return tryOnce();
                }
                reject(err);
            });

            req.end();
        };
        tryOnce();
    });
}

async function createResilientHttpProxyRelay(parsedProxy, stdUrl) {
    const authHeader = (parsedProxy.username || parsedProxy.password)
        ? `Basic ${Buffer.from(`${decodeURIComponent(parsedProxy.username)}:${decodeURIComponent(parsedProxy.password)}`).toString('base64')}`
        : '';
    const requestModule = parsedProxy.protocol === 'https:' ? https : http;

    const server = http.createServer((clientReq, clientRes) => {
        const forwardReq = requestModule.request({
            protocol: parsedProxy.protocol,
            hostname: parsedProxy.hostname,
            port: parsedProxy.port || (parsedProxy.protocol === 'https:' ? 443 : 80),
            method: clientReq.method,
            path: clientReq.url,
            headers: {
                ...clientReq.headers,
                ...(authHeader ? { 'proxy-authorization': authHeader } : {})
            },
            rejectUnauthorized: false
        }, (forwardRes) => {
            clientRes.writeHead(forwardRes.statusCode || 502, forwardRes.headers);
            forwardRes.pipe(clientRes);
        });
        forwardReq.on('error', () => {
            if (!clientRes.headersSent) {
                clientRes.writeHead(502);
            }
            clientRes.end();
        });
        clientReq.pipe(forwardReq);
    });

    server.on('connect', async (req, sourceSocket, head) => {
        sourceSocket.on('error', () => {});
        try {
            const { targetSocket, head: targetHead } = await connectUpstreamWithRetry(parsedProxy, req.url);
            if (sourceSocket.destroyed || !sourceSocket.writable) {
                try { targetSocket.destroy(); } catch (_) {}
                return;
            }
            targetSocket.on('error', () => {
                try { sourceSocket.destroy(); } catch (_) {}
            });
            sourceSocket.on('error', () => {
                try { targetSocket.destroy(); } catch (_) {}
            });

            sourceSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
            if (head && head.length > 0) {
                targetSocket.write(head);
            }
            if (targetHead && targetHead.length > 0) {
                sourceSocket.write(targetHead);
            }
            attachTunnelWatchdog(sourceSocket, targetSocket, 12000);
            sourceSocket.pipe(targetSocket);
            targetSocket.pipe(sourceSocket);
        } catch (_) {
            if (!sourceSocket.destroyed && sourceSocket.writable) {
                try {
                    sourceSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
                } catch (_) {
                    try { sourceSocket.destroy(); } catch (__) {}
                }
            }
        }
    });

    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });

    const address = server.address();
    const localProxyUrl = `http://127.0.0.1:${address.port}`;
    return {
        localProxyUrl,
        close: () => new Promise((resolve) => {
            resetActiveProxyTunnels();
            try { server.closeAllConnections?.(); } catch (_) {}
            const timer = setTimeout(() => resolve(), 1000);
            server.close(() => {
                clearTimeout(timer);
                resolve();
            });
        })
    };
}

/**
 * Playwright Chromium 原生对带账号密码的 SOCKS/HTTP 住宅代理容易因 CONNECT 握手断开。
 * 统一转成本地稳定 HTTP 中继，并针对 HTTP 住宅代理提供 CONNECT 自动重试与僵死隧道看门狗。
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
        if (!isSocksProtocol(parsed.protocol)) {
            try {
                const relay = await createResilientHttpProxyRelay(parsed, stdUrl);
                console.log(`🌐 [系统] HTTP 认证代理已转为本地稳定 HTTP 中继: ${maskProxyUrl(relay.localProxyUrl)}`);
                return {
                    proxyConfig: { server: relay.localProxyUrl },
                    relayed: true,
                    cleanup: async () => {
                        await relay.close().catch(() => {});
                    }
                };
            } catch (relayErr) {
                console.warn(`[!] [系统] 本地弹性 HTTP 中继启动失败，回退至 proxy-chain: ${relayErr.message}`);
            }
        }
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
    isSocksProtocol,
    substituteProxySession,
    formatToStandardProxyUrl,
    resetActiveProxyTunnels,
    attachTunnelWatchdog
};
