'use strict';

const { isIP } = require('node:net');
const { performance } = require('node:perf_hooks');

const PROBE_URLS = ['https://api.ipify.org/?format=text', 'https://ifconfig.me/ip'];

function parseProbeIp(body) {
    const value = String(body || '').trim();
    return value.length <= 45 && isIP(value) ? value : null;
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
    const deadline = performance.now() + (options.timeoutMs ?? 24000);
    const requestTimeout = () => Math.max(1, Math.min(options.probeTimeoutMs ?? 6000, deadline - performance.now()));
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

module.exports = { parseProbeIp, probeFailureKind, checkProxyConnectivity };
