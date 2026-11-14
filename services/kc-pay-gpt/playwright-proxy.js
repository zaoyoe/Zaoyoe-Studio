'use strict';

const net = require('net');
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
    } else if (/([-_](?:sid|sessid|sessionid)[-_])([A-Za-z0-9]+)(?=[-_:@/]|$)/i.test(replaced)) {
        // 自动兼容形如 -sid-abc123- 或 -sessid-abc123- 的住宅代理格式，原地轮换 SID
        replaced = replaced.replace(/([-_](?:sid|sessid|sessionid)[-_])([A-Za-z0-9]+)(?=[-_:@/]|$)/i, `$1${sid}`);
    }
    // 自动兼容形如 -sid-xxxx-t- 的固定 session，将其转换为新随机 session 避免 5 分钟超时
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

function attachTunnelWatchdog(sourceSocket, targetSocket, handshakeTimeoutMs = 25000) {
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

function parseTargetHostPort(targetHostPort) {
    const raw = String(targetHostPort || '').trim();
    const ipv6Match = raw.match(/^\[([^\]]+)\](?::(\d+))?$/);
    if (ipv6Match) {
        return { host: ipv6Match[1], port: Number(ipv6Match[2] || 443) };
    }
    const lastColon = raw.lastIndexOf(':');
    if (lastColon > 0) {
        const maybePort = Number(raw.slice(lastColon + 1));
        if (Number.isInteger(maybePort) && maybePort > 0 && maybePort <= 65535) {
            return { host: raw.slice(0, lastColon), port: maybePort };
        }
    }
    return { host: raw, port: 443 };
}

function connectUpstreamSocks5(parsedProxy, targetHostPort, connectTimeoutMs = 10000) {
    return new Promise((resolve, reject) => {
        const { host, port } = parseTargetHostPort(targetHostPort);
        const hostBuf = Buffer.from(host, 'utf8');
        if (!host || hostBuf.length > 255) {
            reject(new Error('SOCKS5 invalid target host'));
            return;
        }
        const username = parsedProxy.username ? decodeURIComponent(parsedProxy.username) : '';
        const password = parsedProxy.password ? decodeURIComponent(parsedProxy.password) : '';
        const uBuf = Buffer.from(username, 'utf8');
        const pBuf = Buffer.from(password, 'utf8');
        const hasAuth = Boolean(username || password);
        if (uBuf.length > 255 || pBuf.length > 255) {
            reject(new Error('SOCKS5 credentials exceed 255 bytes'));
            return;
        }

        const socket = net.connect({
            host: parsedProxy.hostname,
            port: Number(parsedProxy.port || 1080)
        });
        let settled = false;
        let stage = 'greeting';
        let buf = Buffer.alloc(0);

        const cleanup = () => {
            clearTimeout(timer);
            socket.off('connect', onConnect);
            socket.off('data', onData);
            socket.off('error', onError);
            socket.off('close', onClose);
        };
        const finishError = (err) => {
            if (settled) return;
            settled = true;
            cleanup();
            try { socket.destroy(); } catch (_) {}
            reject(err);
        };
        const finishSuccess = (head) => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve({ res: { statusCode: 200 }, targetSocket: socket, head });
        };

        const timer = setTimeout(() => {
            finishError(new Error('SOCKS5 CONNECT timeout'));
        }, connectTimeoutMs);
        timer.unref?.();

        const sendConnect = () => {
            stage = 'connect';
            const portBuf = Buffer.from([(port >> 8) & 0xff, port & 0xff]);
            socket.write(Buffer.concat([
                Buffer.from([0x05, 0x01, 0x00, 0x03, hostBuf.length]),
                hostBuf,
                portBuf
            ]));
        };

        const onConnect = () => {
            socket.write(hasAuth
                ? Buffer.from([0x05, 0x02, 0x00, 0x02])
                : Buffer.from([0x05, 0x01, 0x00]));
        };

        const onData = (chunk) => {
            if (settled) return;
            buf = Buffer.concat([buf, chunk]);
            while (!settled) {
                if (stage === 'greeting') {
                    if (buf.length < 2) return;
                    if (buf[0] !== 0x05) {
                        finishError(new Error(`SOCKS5 invalid greeting version ${buf[0]}`));
                        return;
                    }
                    const method = buf[1];
                    buf = buf.subarray(2);
                    if (method === 0x02) {
                        if (!hasAuth) {
                            finishError(new Error('SOCKS5 server requested auth without credentials'));
                            return;
                        }
                        stage = 'auth';
                        socket.write(Buffer.concat([
                            Buffer.from([0x01, uBuf.length]),
                            uBuf,
                            Buffer.from([pBuf.length]),
                            pBuf
                        ]));
                        continue;
                    }
                    if (method === 0x00) {
                        sendConnect();
                        continue;
                    }
                    finishError(new Error(`SOCKS5 unsupported auth method ${method}`));
                    return;
                }
                if (stage === 'auth') {
                    if (buf.length < 2) return;
                    const authOk = buf[0] === 0x01 && buf[1] === 0x00;
                    buf = buf.subarray(2);
                    if (!authOk) {
                        finishError(new Error('SOCKS5 authentication failed'));
                        return;
                    }
                    sendConnect();
                    continue;
                }
                if (stage === 'connect') {
                    if (buf.length < 4) return;
                    if (buf[0] !== 0x05) {
                        finishError(new Error(`SOCKS5 invalid reply version ${buf[0]}`));
                        return;
                    }
                    if (buf[1] !== 0x00) {
                        finishError(new Error(`SOCKS5 CONNECT rejected (rep=${buf[1]})`));
                        return;
                    }
                    const atyp = buf[3];
                    let needed = 0;
                    if (atyp === 0x01) {
                        needed = 10;
                    } else if (atyp === 0x03) {
                        if (buf.length < 5) return;
                        needed = 4 + 1 + buf[4] + 2;
                    } else if (atyp === 0x04) {
                        needed = 22;
                    } else {
                        finishError(new Error(`SOCKS5 unsupported address type ${atyp}`));
                        return;
                    }
                    if (buf.length < needed) return;
                    const head = buf.subarray(needed);
                    finishSuccess(head);
                    return;
                }
            }
        };

        const onError = (err) => finishError(err);
        const onClose = () => finishError(new Error('SOCKS5 connection closed before handshake completed'));

        socket.on('connect', onConnect);
        socket.on('data', onData);
        socket.on('error', onError);
        socket.on('close', onClose);
    });
}

function connectUpstreamWithRetry(parsedProxy, targetHostPort, options = {}) {
    const maxAttempts = options.maxAttempts ?? 3;
    const connectTimeoutMs = options.connectTimeoutMs ?? 10000;
    const authHeader = (parsedProxy.username || parsedProxy.password)
        ? `Basic ${Buffer.from(`${decodeURIComponent(parsedProxy.username)}:${decodeURIComponent(parsedProxy.password)}`).toString('base64')}`
        : '';
    const requestModule = parsedProxy.protocol === 'https:' ? https : http;
    const targetHost = String(targetHostPort || '').toLowerCase().replace(/:\d+$/, '');
    const target = targetHost === 'chatgpt.com' ? 'chatgpt'
        : targetHost === 'www.cloudflare.com' ? 'cloudflare' : 'other';
    const logResult = (attempt, start, upstreamStatus, result) => {
        try {
            (options.log || console.log)(`[Proxy/relay/connect] ${JSON.stringify({
                target, attempt, maxAttempts, upstreamStatus, result, elapsedMs: Date.now() - start
            })}`);
        } catch (_) { /* optional diagnostics must not change tunnel handling */ }
    };

    return new Promise((resolve, reject) => {
        let attempt = 0;
        const tryOnce = () => {
            attempt += 1;
            const start = Date.now();
            let settled = false;

            if (parsedProxy._preferSocks5) {
                connectUpstreamSocks5(parsedProxy, targetHostPort, connectTimeoutMs)
                    .then((result) => {
                        if (settled) {
                            try { result.targetSocket?.destroy(); } catch (_) {}
                            return;
                        }
                        settled = true;
                        logResult(attempt, start, 200, 'ok');
                        resolve(result);
                    })
                    .catch((sockErr) => {
                        if (settled) return;
                        settled = true;
                        logResult(attempt, start, null, /timeout|timed out/i.test(sockErr?.message || '') ? 'timeout' : 'connection');
                        if (attempt < maxAttempts) {
                            return tryOnce();
                        }
                        reject(sockErr);
                    });
                return;
            }

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
                logResult(attempt, start, null, 'timeout');
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
                    logResult(attempt, start, res.statusCode, 'ok');
                    resolve({ res, targetSocket, head });
                    return;
                }
                try { targetSocket.destroy(); } catch (_) {}
                logResult(attempt, start, res.statusCode,
                    [401, 407, 597].includes(res.statusCode) ? 'proxy_auth' : 'upstream_http');
                // Retry only transient gateway failures within the existing connection budget.
                if (attempt < maxAttempts && [500, 502, 503, 504].includes(res.statusCode)) {
                    settled = true;
                    return tryOnce();
                }
                settled = true;
                reject(Object.assign(new Error(`Upstream CONNECT HTTP ${res.statusCode}`), {
                    upstreamStatus: res.statusCode
                }));
            });

            req.once('error', (err) => {
                clearTimeout(timer);
                if (settled) return;
                settled = true;
                const canFallbackSocks5 = parsedProxy.protocol === 'http:'
                    && (err?.code === 'ECONNRESET' || /socket hang up/i.test(err?.message || ''));
                if (canFallbackSocks5) {
                    connectUpstreamSocks5(parsedProxy, targetHostPort, connectTimeoutMs)
                        .then((result) => {
                            parsedProxy._preferSocks5 = true;
                            logResult(attempt, start, 200, 'ok');
                            resolve(result);
                        })
                        .catch(() => {
                            logResult(attempt, start, null, /timeout|timed out/i.test(err?.message || '') ? 'timeout' : 'connection');
                            if (attempt < maxAttempts) {
                                return tryOnce();
                            }
                            reject(err);
                        });
                    return;
                }
                logResult(attempt, start, null, /timeout|timed out/i.test(err?.message || '') ? 'timeout' : 'connection');
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

async function createResilientHttpProxyRelay(parsedProxy, options = {}) {
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
            const { targetSocket, head: targetHead } = await connectUpstreamWithRetry(parsedProxy, req.url, { log: options.log });
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
            attachTunnelWatchdog(sourceSocket, targetSocket, 25000);
            sourceSocket.pipe(targetSocket);
            targetSocket.pipe(sourceSocket);
        } catch (error) {
            if (!sourceSocket.destroyed && sourceSocket.writable) {
                try {
                    const upstreamStatus = error?.upstreamStatus;
                    const status = [401, 407, 597].includes(upstreamStatus) ? 407
                        : Number.isInteger(upstreamStatus) && upstreamStatus >= 400 && upstreamStatus <= 599
                            ? upstreamStatus : 502;
                    sourceSocket.end(`HTTP/1.1 ${status} ${http.STATUS_CODES[status] || 'Proxy Error'}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
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
async function preparePlaywrightProxy(proxyValue, options = {}) {
    const raw = String(proxyValue || '').trim();
    if (!raw) {
        return { proxyConfig: null, cleanup: async () => { } };
    }

    const targetRegion = options.region || process.env.PAYMENT_REGION_OVERRIDE || '';
    const formatted = formatToStandardProxyUrl(raw);
    const aligned = targetRegion ? alignProxyRegion(formatted, targetRegion) : formatted;
    const stdUrl = substituteProxySession(aligned);

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
                const relay = await createResilientHttpProxyRelay(parsed, options);
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
    alignProxyRegion,
    substituteProxySession,
    formatToStandardProxyUrl,
    resetActiveProxyTunnels,
    attachTunnelWatchdog
};
