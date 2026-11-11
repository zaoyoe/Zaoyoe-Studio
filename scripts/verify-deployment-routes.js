#!/usr/bin/env node
'use strict';

const { execFileSync } = require('node:child_process');

// Each public route is an independent acceptance check. A successful direct API
// response must never replace a failed frontend proxy or Cloudflare response.
const ROUTES = Object.freeze({
    verify: Object.freeze([
        { name: 'verify_health', url: 'https://verify-api.fatherkey.com/healthz', field: 'status', expected: 'ok' },
        { name: 'public_payments', url: 'https://www.fatherkey.com/api/payments/config?site=cn', field: 'success', expected: true },
        { name: 'api_payments', url: 'https://verify-api.fatherkey.com/api/payments/config?site=cn', field: 'success', expected: true },
        { name: 'public_catalog', url: 'https://www.fatherkey.com/api/shop/catalog?site=cn', field: 'success', expected: true },
        { name: 'api_catalog', url: 'https://verify-api.fatherkey.com/api/shop/catalog?site=cn', field: 'success', expected: true }
    ]),
    newapi: Object.freeze([
        { name: 'newapi_health', url: 'https://new.fatherkey.com/health', field: 'status', expected: 'ok' }
    ]),
    kc: Object.freeze([
        { name: 'kc_public_runtime', url: 'https://redeem.fatherkey.com/api/public/runtime', field: 'success', expected: true }
    ])
});
const SAFE_HEADERS = ['server', 'cf-ray', 'cf-mitigated', 'content-type'];
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const USER_AGENT = process.env.VERIFY_USER_AGENT || DEFAULT_USER_AGENT;

function curlFetch(url, options = {}) {
    const args = ['-s', '-i', '--http2', '--max-time', '15'];
    const headers = options.headers || {};
    for (const [k, v] of Object.entries(headers)) {
        args.push('-H', `${k}: ${v}`);
    }
    args.push(url);
    const buf = execFileSync('curl', args, { maxBuffer: 10 * 1024 * 1024 });
    const str = buf.toString('latin1');
    const sections = str.split(/\r?\n\r?\n/);
    let headerIdx = 0;
    for (let i = 0; i < sections.length - 1; i++) {
        if (/^HTTP\/[123]/i.test(sections[i])) headerIdx = i;
    }
    const headerLines = sections[headerIdx].split(/\r?\n/);
    const statusMatch = headerLines[0].match(/HTTP\/\S+\s+(\d+)/);
    const status = statusMatch ? parseInt(statusMatch[1], 10) : 500;
    const respHeaders = new Headers();
    for (let i = 1; i < headerLines.length; i++) {
        const colon = headerLines[i].indexOf(':');
        if (colon > 0) {
            respHeaders.append(headerLines[i].slice(0, colon).trim(), headerLines[i].slice(colon + 1).trim());
        }
    }
    let bodyOffset = 0;
    for (let i = 0; i <= headerIdx; i++) {
        const delim = str.slice(bodyOffset).indexOf(sections[i]);
        bodyOffset += delim + Buffer.byteLength(sections[i], 'latin1');
        const after = str.slice(bodyOffset);
        const nl = after.match(/^(\r?\n\r?\n)/);
        if (nl) bodyOffset += nl[1].length;
    }
    const bodyBuf = buf.subarray(bodyOffset);
    return new Response(bodyBuf, { status, headers: respHeaders });
}

function defaultFetch(url, options = {}) {
    try {
        return curlFetch(url, options);
    } catch {
        return globalThis.fetch(url, options);
    }
}

function diagnosticHeaders(response) {
    const headers = {};
    for (const name of SAFE_HEADERS) {
        const value = response.headers.get(name);
        if (value) headers[name] = value.replace(/[^\x20-\x7e]/g, '').slice(0, 180);
    }
    return headers;
}

async function readJson(response) {
    const declaredLength = Number(response.headers.get('content-length'));
    if (declaredLength > MAX_BODY_BYTES) throw new Error('body_too_large');
    if (!response.body) throw new Error('invalid_json');
    const reader = response.body.getReader();
    const chunks = [];
    let bytes = 0;
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            bytes += value.byteLength;
            if (bytes > MAX_BODY_BYTES) throw new Error('body_too_large');
            chunks.push(Buffer.from(value));
        }
        try {
            return JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
            throw new Error('invalid_json');
        }
    } finally {
        // Do not let an unresponsive response body hold up the deadline.
        reader.cancel().catch(() => {});
        reader.releaseLock();
    }
}

async function checkAttempt(route, fetchImpl, timeoutMs) {
    const controller = new AbortController();
    let timer;
    let diagnostics = {};
    let timedOut = false;
    const request = (async () => {
        const response = await fetchImpl(route.url, {
            redirect: 'manual',
            signal: controller.signal,
            headers: { accept: 'application/json', 'user-agent': USER_AGENT }
        });
        diagnostics = { status: response.status, headers: diagnosticHeaders(response) };
        if (response.status !== 200) {
            response.body?.cancel().catch(() => {});
            return { ok: false, reason: response.status >= 300 && response.status < 400 ? 'unexpected_redirect' : 'http_error', ...diagnostics };
        }
        if (response.headers.get('cf-mitigated') === 'challenge') {
            response.body?.cancel().catch(() => {});
            return { ok: false, reason: 'cloudflare_challenge', ...diagnostics };
        }
        if (!/^application\/(?:[\w.+-]+\+)?json\b/i.test(response.headers.get('content-type') || '')) {
            response.body?.cancel().catch(() => {});
            return { ok: false, reason: 'non_json_response', ...diagnostics };
        }
        const payload = await readJson(response);
        const ok = payload !== null && typeof payload === 'object' && !Array.isArray(payload)
            && payload[route.field] === route.expected;
        // No response bodies, cookies, redirect locations, credentials or remote
        // error messages belong in deployment logs.
        return { ok, reason: ok ? 'healthy' : 'unexpected_payload', ...diagnostics };
    })();
    try {
        return await Promise.race([
            request,
            new Promise((resolve) => {
                timer = setTimeout(() => {
                    timedOut = true;
                    resolve({ ok: false, reason: 'timeout', ...diagnostics });
                    controller.abort();
                }, timeoutMs);
            })
        ]);
    } catch (error) {
        const safeReason = ['body_too_large', 'invalid_json'].includes(error.message) ? error.message : 'network_error';
        return { ok: false, reason: timedOut ? 'timeout' : safeReason, ...diagnostics };
    } finally {
        clearTimeout(timer);
        controller.abort();
    }
}

async function verifyDeploymentRoutes(chain, {
    fetchImpl = defaultFetch,
    attempts = 3,
    timeoutMs = 15000,
    retryDelayMs = 2000,
    delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log = console.log
} = {}) {
    if (!Object.hasOwn(ROUTES, chain)) throw new Error('Expected chain: verify, newapi, or kc');
    if (!Number.isInteger(attempts) || attempts < 1 || attempts > 5
        || !Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60000
        || !Number.isFinite(retryDelayMs) || retryDelayMs < 0 || retryDelayMs > 10000) {
        throw new Error('Invalid bounded retry settings');
    }
    const results = [];
    for (const route of ROUTES[chain]) {
        let result;
        for (let attempt = 1; attempt <= attempts; attempt += 1) {
            result = { route: route.name, attempt, ...await checkAttempt(route, fetchImpl, timeoutMs) };
            log(JSON.stringify(result));
            if (result.ok) break;
            if (attempt < attempts) await delay(retryDelayMs);
        }
        results.push(result);
    }
    return { ok: results.every((result) => result.ok), results };
}

module.exports = { verifyDeploymentRoutes, ROUTES };

if (require.main === module) {
    verifyDeploymentRoutes(process.argv[2]).then(({ ok }) => {
        process.exitCode = ok ? 0 : 1;
    }).catch(() => {
        console.error('Deployment route verification failed: use verify, newapi, or kc with bounded settings.');
        process.exitCode = 1;
    });
}
