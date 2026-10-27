'use strict';

const { isIP } = require('node:net');
const { performance } = require('node:perf_hooks');

const PROBE_URLS = ['https://api.ipify.org/?format=text', 'https://ifconfig.me/ip'];
const REGION_PROBE_URL = 'https://www.cloudflare.com/cdn-cgi/trace';

function parseProbeIp(body) {
    const value = String(body || '').trim();
    return value.length <= 45 && isIP(value) ? value : null;
}

function parseNetworkRegion(body) {
    const matches = [...String(body || '').matchAll(/^loc=([A-Z]{2})\s*$/gm)];
    if (matches.length !== 1 || matches[0][1] === 'XX') return null;
    return matches[0][1];
}

function parseTraceEgress(body) {
    const text = String(body || '').trim();
    const ipMatch = text.match(/^ip=([^\r\n]+)/m);
    const locMatch = text.match(/^loc=([A-Z]{2})\s*$/m);
    const ip = ipMatch && isIP(ipMatch[1].trim()) ? ipMatch[1].trim() : null;
    const loc = locMatch && locMatch[1] !== 'XX' ? locMatch[1] : null;
    return { ip, loc };
}

function networkRegionError(code, message) {
    return Object.assign(new Error(`${message}；尚未提交支付 [${code}]`), { code });
}

/**
 * 0 浏览器纯协议探针：无需启动 Chromium，直接通过 Node HTTP + 代理连接 Cloudflare Trace 同时核验公网 IP 与目标地区。
 */
async function checkProxyAndRegionProtocol(proxyUrl, expectedRegion, options = {}) {
    const expected = String(expectedRegion || '').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(expected)) return null;

    const { fetch: undiciFetch, ProxyAgent } = require('undici');
    const dispatcher = proxyUrl ? new ProxyAgent(String(proxyUrl).trim()) : undefined;
    const urls = options.url
        ? [options.url]
        : [REGION_PROBE_URL, 'https://chatgpt.com/cdn-cgi/trace'];
    const timeoutMs = options.probeTimeoutMs ?? 4500;

    try {
        for (const url of urls) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            try {
                const resp = await undiciFetch(url, {
                    method: 'GET',
                    dispatcher,
                    signal: controller.signal,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
                        'Accept': 'text/plain,*/*'
                    }
                });
                if ([407, 597].includes(resp.status)) {
                    throw preflightError('proxy_auth');
                }
                if (resp.ok) {
                    const text = await resp.text();
                    const { ip, loc } = parseTraceEgress(text);
                    if (ip && loc) {
                        if (loc !== expected) {
                            throw networkRegionError('PAYMENT_REGION_NETWORK_MISMATCH',
                                `当前网络出口地区 ${loc} 与卡密支付地区 ${expected} 不一致，已停止支付`);
                        }
                        (options.log || console.log)(`[Network/region] 协议出口地区核验通过: ${loc}`);
                        return { ip, actualRegion: loc, expectedRegion: expected, transport: 'protocol', fastPath: true };
                    }
                }
            } catch (err) {
                if (err?.code === 'PAYMENT_REGION_NETWORK_MISMATCH'
                    || err?.code === 'NETWORK_REGION_UNCONFIRMED'
                    || String(err?.code || '').startsWith('PROXY_PREFLIGHT_')) {
                    throw err;
                }
                const kind = probeFailureKind(err);
                if (kind === 'proxy_auth' || kind === 'certificate') {
                    throw preflightError(kind);
                }
            } finally {
                clearTimeout(timer);
            }
        }
    } finally {
        await dispatcher?.close?.().catch(() => {});
    }
    return null;
}

/**
 * 极速合并预检：通过一次 Cloudflare Trace 探针同时核验代理连通性、出口公网 IP 与目标地区（<300ms）。
 * 成功后避免分开串行请求两次（一次查 IP 一次查地区），在弱网住宅代理下直接节省 4~20 秒。
 */
async function checkProxyAndRegionFast(context, expectedRegion, options = {}) {
    const expected = String(expectedRegion || '').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(expected)) return null;

    if (typeof context?.request?.get === 'function') {
        let resp;
        try {
            resp = await context.request.get(options.url || REGION_PROBE_URL, {
                timeout: options.probeTimeoutMs ?? 3500,
                maxRetries: 0,
                maxRedirects: 0
            });
            if (resp && resp.ok()) {
                const text = await resp.text();
                const { ip, loc } = parseTraceEgress(text);
                if (ip && loc) {
                    if (loc !== expected) {
                        throw networkRegionError('PAYMENT_REGION_NETWORK_MISMATCH',
                            `当前网络出口地区 ${loc} 与卡密支付地区 ${expected} 不一致，已停止支付`);
                    }
                    (options.log || console.log)(`[Network/region] 浏览器出口地区核验通过: ${loc}`);
                    return { ip, actualRegion: loc, expectedRegion: expected, transport: 'request', fastPath: true };
                }
            }
        } catch (err) {
            if (err?.code === 'PAYMENT_REGION_NETWORK_MISMATCH' || err?.code === 'NETWORK_REGION_UNCONFIRMED') {
                throw err;
            }
        } finally {
            await resp?.dispose().catch(() => {});
        }
    }
    return null;
}

async function checkEgressRegion(context, expectedRegion, options = {}) {
    const expected = String(expectedRegion || '').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(expected)) {
        throw networkRegionError('NETWORK_REGION_UNCONFIRMED', '卡密支付地区无效，无法核验网络出口');
    }

    const log = options.log || console.warn;

    // 性能优化：优先通过 APIRequestContext 发起轻量 GET 探针（<400ms），避免打开整页与视频录制开销（省 5 秒）
    if (typeof context?.request?.get === 'function') {
        let resp;
        try {
            resp = await context.request.get(options.url || REGION_PROBE_URL, {
                timeout: options.probeTimeoutMs ?? 4000,
                maxRetries: 0,
                maxRedirects: 0
            });
            if (resp && resp.ok()) {
                const actual = parseNetworkRegion(await resp.text());
                if (actual) {
                    if (actual !== expected) {
                        throw networkRegionError('PAYMENT_REGION_NETWORK_MISMATCH',
                            `当前网络出口地区 ${actual} 与卡密支付地区 ${expected} 不一致，已停止支付`);
                    }
                    (options.log || console.log)(`[Network/region] 浏览器出口地区核验通过: ${actual}`);
                    return { expectedRegion: expected, actualRegion: actual, transport: 'request' };
                }
            }
        } catch (err) {
            if (err?.code === 'PAYMENT_REGION_NETWORK_MISMATCH' || err?.code === 'NETWORK_REGION_UNCONFIRMED') {
                throw err;
            }
        } finally {
            await resp?.dispose().catch(() => {});
        }
    }

    let page;
    let video;
    try {
        page = await context.newPage();
        video = page.video();
        const response = await page.goto(options.url || REGION_PROBE_URL, {
            timeout: options.timeoutMs ?? 10000,
            waitUntil: 'domcontentloaded'
        });
        const status = Number(response?.status?.());
        if (!response?.ok()) {
            const statusLabel = Number.isInteger(status) && status > 0 ? `HTTP ${status}` : '无 HTTP 响应';
            log(`[Network/region] 地区探针未通过: ${statusLabel}`);
            throw networkRegionError('NETWORK_REGION_UNCONFIRMED',
                `无法确认当前网络出口地区（Cloudflare Trace 返回 ${statusLabel}），已停止支付`);
        }

        const actual = parseNetworkRegion(await response.text());
        if (!actual) {
            log('[Network/region] 地区探针未通过: 响应中没有唯一有效的国家代码');
            throw networkRegionError('NETWORK_REGION_UNCONFIRMED',
                '无法确认当前网络出口地区（Cloudflare Trace 响应格式无效），已停止支付');
        }
        if (actual !== expected) {
            throw networkRegionError('PAYMENT_REGION_NETWORK_MISMATCH',
                `当前网络出口地区 ${actual} 与卡密支付地区 ${expected} 不一致，已停止支付`);
        }
        (options.log || console.log)(`[Network/region] 浏览器出口地区核验通过: ${actual}`);
        return { expectedRegion: expected, actualRegion: actual, transport: 'browser' };
    } catch (error) {
        if (error?.code === 'PAYMENT_REGION_NETWORK_MISMATCH'
            || error?.code === 'NETWORK_REGION_UNCONFIRMED') throw error;

        const kind = probeFailureKind(error);
        log(`[Network/region] 地区探针请求失败: ${kind}`);
        const labels = {
            proxy_auth: '代理认证失败',
            tls_protocol: 'TLS 握手失败',
            timeout: '请求超时',
            certificate: '证书验证失败',
            connection: '连接失败'
        };
        throw networkRegionError('NETWORK_REGION_UNCONFIRMED',
            `无法确认当前网络出口地区（地区探针${labels[kind] || '请求失败'}），已停止支付`);
    } finally {
        await page?.close().catch(() => {});
        await video?.delete().catch(() => {});
    }
}

function probeFailureKind(error) {
    const value = String(error?.message || error || '');
    if (/407|597|ERR_PROXY_AUTH|proxy authentication/i.test(value)) return 'proxy_auth';
    if (/EPROTO|wrong version number|ERR_SSL_PROTOCOL_ERROR/i.test(value)) return 'tls_protocol';
    if (/timeout|timed out/i.test(value)) return 'timeout';
    if (/ERR_CERT|CERT_|certificate/i.test(value)) return 'certificate';
    return 'connection';
}

function preflightError(kind) {
    const auth = kind === 'proxy_auth';
    const certificate = kind === 'certificate';
    const code = auth ? 'PROXY_PREFLIGHT_AUTH' : certificate ? 'PROXY_PREFLIGHT_CERTIFICATE' : 'PROXY_PREFLIGHT_NETWORK';
    const detail = auth ? '代理认证失败，请联系管理员检查代理配置'
        : certificate ? '代理连接证书校验失败，请联系管理员检查网络'
            : '代理连接暂时异常，请稍后重试';
    return Object.assign(new Error(`${detail}；尚未提交支付 [${code}]`), { code });
}

// Only used before account navigation/card reservation. All probes keep the
// browser context's configured proxy and certificate verification enabled.
async function checkProxyConnectivity(context, options = {}) {
    const deadline = performance.now() + (options.timeoutMs ?? 20000);
    const requestTimeout = () => Math.max(1, Math.min(options.probeTimeoutMs ?? 3500, deadline - performance.now()));
    const log = options.log || console.log;
    let kind = 'connection';
    for (const url of PROBE_URLS) {
        if (performance.now() >= deadline) break;
        let response;
        try {
            response = await context.request.get(url, { timeout: requestTimeout(), maxRetries: 0, maxRedirects: 0 });
            if ([407, 597].includes(response.status())) throw preflightError('proxy_auth');
            const ip = response.ok() ? parseProbeIp(await response.text()) : null;
            if (ip) return { ip, transport: 'request' };
            kind = response.ok() ? 'invalid_ip' : `http_${response.status()}`;
        } catch (error) {
            if (error.code === 'PROXY_PREFLIGHT_AUTH') throw error;
            kind = probeFailureKind(error);
            if (kind === 'proxy_auth' || kind === 'certificate') throw preflightError(kind);
        } finally {
            await response?.dispose().catch(() => {});
        }
        log(`[Proxy/preflight] 接口探针未通过（${kind}），尝试备用检查`);
    }

    // APIRequestContext uses Node TLS; Chromium has a separate network stack.
    // A failed IP service/CONNECT attempt must not alone condemn the browser.
    if (performance.now() >= deadline) throw preflightError(kind);
    let page;
    let video;
    try {
        log('[Proxy/preflight] 使用同一代理的浏览器通道复核连通性...');
        page = await context.newPage();
        video = page.video();
        for (const url of PROBE_URLS) {
            if (performance.now() >= deadline) break;
            try {
                const response = await page.goto(url, { timeout: requestTimeout(), waitUntil: 'domcontentloaded' });
                if ([407, 597].includes(response?.status())) throw preflightError('proxy_auth');
                const ip = response?.ok() ? parseProbeIp(await response.text()) : null;
                if (ip) {
                    log('[Proxy/preflight] 浏览器通道复核通过，继续当前任务');
                    return { ip, transport: 'browser' };
                }
                kind = response?.ok() ? 'invalid_ip' : `http_${response?.status() || 0}`;
            } catch (error) {
                if (error.code === 'PROXY_PREFLIGHT_AUTH') throw error;
                kind = probeFailureKind(error);
                if (kind === 'proxy_auth' || kind === 'certificate') throw preflightError(kind);
            }
            log(`[Proxy/preflight] 浏览器探针未通过（${kind}）`);
        }
    } catch (error) {
        if (String(error.code || '').startsWith('PROXY_PREFLIGHT_')) throw error;
        throw preflightError(probeFailureKind(error));
    } finally {
        await page?.close().catch(() => {});
        await video?.delete().catch(() => {});
    }
    throw preflightError(kind);
}

module.exports = { parseProbeIp, parseNetworkRegion, parseTraceEgress, probeFailureKind, checkProxyConnectivity, checkEgressRegion, checkProxyAndRegionFast, checkProxyAndRegionProtocol };
