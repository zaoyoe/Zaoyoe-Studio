'use strict';

function resolveImpitBrowser(userAgent = '') {
    const match = String(userAgent || '').match(/Chrome\/(\d+)/i);
    if (!match) return 'chrome151';
    const major = Number(match[1]);
    if (!Number.isFinite(major)) return 'chrome151';
    if (major >= 146) return 'chrome151';
    if (major >= 140) return 'chrome142';
    if (major >= 136) return 'chrome136';
    if (major >= 131) return 'chrome131';
    return 'chrome151';
}

function parseCookiePairs(cookieHeader = '') {
    const pairs = [];
    for (const part of String(cookieHeader || '').split(';')) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const eq = trimmed.indexOf('=');
        if (eq <= 0) continue;
        const name = trimmed.slice(0, eq).trim();
        const value = trimmed.slice(eq + 1).trim();
        if (!name) continue;
        pairs.push([name, value]);
    }
    return pairs;
}

function createInMemoryCookieJar(initialCookieHeader = '') {
    const store = new Map();

    const mergeCookieHeader = (cookieHeader = '', { overwrite = false } = {}) => {
        for (const [name, value] of parseCookiePairs(cookieHeader)) {
            if (overwrite || !store.has(name)) {
                store.set(name, value);
            }
        }
    };

    const setCookie = (rawSetCookie = '') => {
        const parts = String(rawSetCookie || '').split(';');
        const first = (parts[0] || '').trim();
        const eq = first.indexOf('=');
        if (eq <= 0) return;
        const name = first.slice(0, eq).trim();
        const value = first.slice(eq + 1).trim();
        if (!name) return;

        let expired = value === '';
        for (let i = 1; i < parts.length; i += 1) {
            const attr = parts[i].trim().toLowerCase();
            if (attr === 'max-age=0' || /^max-age=-\d+/.test(attr)) {
                expired = true;
                break;
            }
            if (attr.startsWith('expires=')) {
                const ts = Date.parse(attr.slice('expires='.length));
                if (Number.isFinite(ts) && ts <= Date.now()) {
                    expired = true;
                    break;
                }
            }
        }
        if (expired) {
            store.delete(name);
        } else {
            store.set(name, value);
        }
    };

    const ingestSetCookieHeaders = (headers) => {
        if (!headers) return;
        if (typeof headers.getSetCookie === 'function') {
            for (const item of headers.getSetCookie()) {
                setCookie(item);
            }
            return;
        }
        if (typeof headers.get === 'function') {
            const single = headers.get('set-cookie');
            if (single) setCookie(single);
            return;
        }
        const raw = headers['set-cookie'];
        if (Array.isArray(raw)) {
            for (const item of raw) setCookie(item);
        } else if (typeof raw === 'string' && raw) {
            setCookie(raw);
        }
    };

    const getCookieString = () => Array.from(store.entries())
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');

    if (initialCookieHeader) {
        mergeCookieHeader(initialCookieHeader, { overwrite: true });
    }

    return {
        setCookie,
        getCookieString,
        mergeCookieHeader,
        ingestSetCookieHeaders,
        toHeaderString: getCookieString
    };
}

function prepareImpitHeaders(headers = {}, { mode = 'cors', stripCookie = false } = {}) {
    const out = {};
    const lowerMap = new Map();

    const setHeader = (key, value) => {
        const lower = key.toLowerCase();
        const existingKey = lowerMap.get(lower);
        if (existingKey && existingKey !== key) {
            delete out[existingKey];
        }
        out[key] = value;
        lowerMap.set(lower, key);
    };

    for (const [k, v] of Object.entries(headers || {})) {
        if (v === undefined) continue;
        if (stripCookie && k.toLowerCase() === 'cookie') continue;
        setHeader(k, v);
    }

    if (mode === 'cors') {
        if (!lowerMap.has('sec-fetch-site')) setHeader('sec-fetch-site', 'same-origin');
        if (!lowerMap.has('sec-fetch-mode')) setHeader('sec-fetch-mode', 'cors');
        if (!lowerMap.has('sec-fetch-dest')) setHeader('sec-fetch-dest', 'empty');
        if (!lowerMap.has('priority')) setHeader('priority', 'u=1, i');
        // Impit uses "" to suppress its default navigation-only impersonation headers.
        if (!lowerMap.has('upgrade-insecure-requests')) setHeader('upgrade-insecure-requests', '');
        if (!lowerMap.has('sec-fetch-user')) setHeader('sec-fetch-user', '');
    }

    return out;
}

function createChatGptImpitClient({
    browser = '',
    userAgent = '',
    proxyUrl = '',
    timeoutMs = 25000,
    cookieJar = null,
    initialCookieHeader = '',
    mode = 'cors'
} = {}) {
    let Impit = null;
    try {
        ({ Impit } = require('impit'));
    } catch (_) {
        return null;
    }

    const jar = cookieJar || (initialCookieHeader ? createInMemoryCookieJar(initialCookieHeader) : null);
    const resolvedBrowser = browser || resolveImpitBrowser(userAgent);
    const client = new Impit({
        browser: resolvedBrowser,
        proxyUrl: String(proxyUrl || '').trim() || undefined,
        ignoreTlsErrors: true,
        timeout: timeoutMs,
        ...(jar ? { cookieJar: jar } : {})
    });

    return {
        browser: resolvedBrowser,
        cookieJar: jar,
        raw: client,
        async fetch(url, init = {}) {
            const rawHeaders = init?.headers || {};
            if (jar) {
                for (const [k, v] of Object.entries(rawHeaders)) {
                    if (k.toLowerCase() === 'cookie' && v) {
                        jar.mergeCookieHeader(String(v));
                    }
                }
            }
            const headers = prepareImpitHeaders(rawHeaders, {
                mode,
                stripCookie: Boolean(jar)
            });
            return client.fetch(url, {
                ...init,
                headers
            });
        }
    };
}

module.exports = {
    resolveImpitBrowser,
    parseCookiePairs,
    createInMemoryCookieJar,
    prepareImpitHeaders,
    createChatGptImpitClient
};
