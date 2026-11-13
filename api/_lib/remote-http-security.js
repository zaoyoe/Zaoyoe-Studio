'use strict';

const dns = require('node:dns').promises;
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');

const DENIED_NETWORKS = new net.BlockList();
for (const [ip, prefix] of [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.88.99.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 3]
]) {
    DENIED_NETWORKS.addSubnet(ip, prefix, 'ipv4');
}

// Restrict special-purpose / documentation / tunnel IPv6 prefixes.
for (const [ip, prefix] of [
    ['2001::', 23],
    ['2001:db8::', 32],
    ['2002::', 16],
    ['3fff::', 20]
]) {
    DENIED_NETWORKS.addSubnet(ip, prefix, 'ipv6');
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function buildSsrfError(message, code, statusCode = 400) {
    const error = new Error(message);
    error.code = code;
    error.statusCode = statusCode;
    return error;
}

function normalizeAddressLiteral(address = '') {
    return String(address || '').trim().replace(/^\[|\]$/g, '').split('%')[0];
}

function isPublicAddress(address) {
    const ip = normalizeAddressLiteral(address);
    const family = net.isIP(ip);
    if (family === 4) {
        return !DENIED_NETWORKS.check(ip, 'ipv4');
    }
    if (family === 6) {
        if (/^::ffff:/i.test(ip)) {
            const mappedIpv4 = ip.replace(/^::ffff:/i, '');
            if (net.isIP(mappedIpv4) === 4) {
                return !DENIED_NETWORKS.check(mappedIpv4, 'ipv4');
            }
            return false;
        }
        return /^[23][0-9a-f]{3}:/i.test(ip) && !DENIED_NETWORKS.check(ip, 'ipv6');
    }
    return false;
}

function validatePublicHttpUrl(input, { allowCustomPorts = false } = {}) {
    let url;
    try {
        url = input instanceof URL ? new URL(input.toString()) : new URL(String(input || '').trim());
    } catch (_) {
        throw buildSsrfError('unsafe_remote_url', 'unsafe_remote_url', 400);
    }

    const hostname = normalizeAddressLiteral(url.hostname).toLowerCase();
    const isBlockedHostLabel = !hostname
        || hostname.endsWith('.')
        || /(^|\.)(localhost|local|internal|home|lan|test|invalid)$/.test(hostname)
        || hostname === 'metadata.google.internal'
        || (!net.isIP(hostname) && !hostname.includes('.'));

    if (!['http:', 'https:'].includes(url.protocol)
        || url.username
        || url.password
        || (!allowCustomPorts && url.port && !['80', '443'].includes(url.port))
        || isBlockedHostLabel
        || (net.isIP(hostname) && !isPublicAddress(hostname))) {
        throw buildSsrfError('unsafe_remote_url', 'unsafe_remote_url', 400);
    }

    url.hash = '';
    return url;
}

async function resolvePublicAddresses(hostname, { lookup = dns.lookup.bind(dns) } = {}) {
    const host = normalizeAddressLiteral(hostname);
    if (!host) {
        throw buildSsrfError('unsafe_remote_address', 'unsafe_remote_address', 400);
    }

    const literalFamily = net.isIP(host);
    if (literalFamily) {
        if (!isPublicAddress(host)) {
            throw buildSsrfError('unsafe_remote_address', 'unsafe_remote_address', 400);
        }
        return [{ address: host, family: literalFamily }];
    }

    let resolved;
    try {
        resolved = await lookup(host, { all: true, verbatim: true });
    } catch (error) {
        throw buildSsrfError(`DNS resolution failed: ${error.message || 'unknown error'}`, 'remote_dns_failed', 502);
    }

    const addresses = Array.isArray(resolved) ? resolved : [];
    if (!addresses.length || addresses.some((entry) => !isPublicAddress(entry?.address))) {
        throw buildSsrfError('unsafe_remote_address', 'unsafe_remote_address', 400);
    }

    return addresses;
}

function detectImageMimeFromMagic(buffer = Buffer.alloc(0)) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 12) return '';
    const magic = buffer.subarray(0, 16);
    if (magic[0] === 0xff && magic[1] === 0xd8 && magic[2] === 0xff) return 'image/jpeg';
    if (magic.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'image/png';
    if (/^GIF8[79]a/.test(magic.toString('ascii', 0, 6))) return 'image/gif';
    if (magic.toString('ascii', 0, 4) === 'RIFF' && magic.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
    const brand = magic.toString('ascii', 4, 12);
    if (brand.startsWith('ftyp') && /^(avif|avis)/i.test(brand.slice(4))) return 'image/avif';
    return '';
}

function detectVideoMimeFromMagic(buffer = Buffer.alloc(0)) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 12) return '';
    const magic = buffer.subarray(0, 16);
    if (magic.subarray(0, 4).equals(Buffer.from('1a45dfa3', 'hex'))) return 'video/webm';
    if (magic.toString('ascii', 4, 8) === 'ftyp') {
        const subBrand = magic.toString('ascii', 8, 12);
        if (subBrand === 'qt  ') return 'video/quicktime';
        if (!/^(avif|avis|heic|mif1)/i.test(subBrand)) return 'video/mp4';
    }
    return '';
}

function normalizeHeaderLookup(headers = {}) {
    const normalized = {};
    for (const [key, value] of Object.entries(headers || {})) {
        normalized[String(key).toLowerCase()] = value;
    }
    return {
        get(name) {
            const val = normalized[String(name || '').toLowerCase()];
            if (Array.isArray(val)) return val.join(', ');
            return val == null ? null : String(val);
        }
    };
}

function createSafeRemoteFetcher({
    lookup = dns.lookup.bind(dns),
    requestHttp = http.request,
    requestHttps = https.request
} = {}) {
    return async function fetchWithPinnedSsrfGuard(input, {
        method = 'GET',
        headers = {},
        body = null,
        signal = null,
        timeoutMs = 20000,
        maxBytes = 20 * 1024 * 1024,
        maxRedirects = 3,
        allowCustomPorts = false,
        allowUnsafeRedirectErrorMessage = 'remote_redirect_rejected'
    } = {}) {
        const byteLimit = Math.max(1, Math.min(60 * 1024 * 1024, Number(maxBytes) || 20 * 1024 * 1024));
        const redirectLimit = Math.max(0, Math.min(5, Math.floor(Number(maxRedirects) || 0)));
        const controller = signal ? null : new AbortController();
        const activeSignal = signal || controller.signal;
        const timer = !signal && Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0
            ? setTimeout(() => controller.abort(), Number(timeoutMs))
            : null;

        let url = validatePublicHttpUrl(input, { allowCustomPorts });

        try {
            for (let hop = 0; hop <= redirectLimit; hop += 1) {
                activeSignal?.throwIfAborted();
                const addresses = await resolvePublicAddresses(url.hostname, { lookup });
                activeSignal?.throwIfAborted();
                const pinned = addresses[0];
                const requestFn = url.protocol === 'https:' ? requestHttps : requestHttp;

                const response = await new Promise((resolve, reject) => {
                    const request = requestFn(url, {
                        method,
                        signal: activeSignal,
                        agent: false,
                        headers: {
                            'Accept-Encoding': 'identity',
                            ...headers
                        },
                        lookup: (_name, options, callback) => {
                            if (options?.all) {
                                callback(null, [{ address: pinned.address, family: pinned.family }]);
                            } else {
                                callback(null, pinned.address, pinned.family);
                            }
                        }
                    }, resolve);

                    request.on('error', reject);
                    if (body !== null && body !== undefined) {
                        request.write(body);
                    }
                    request.end();
                });

                const statusCode = Number(response.statusCode || 0);
                if (REDIRECT_STATUSES.has(statusCode)) {
                    const location = response.headers?.location;
                    response.destroy();
                    if (!location || hop === redirectLimit) {
                        throw buildSsrfError(allowUnsafeRedirectErrorMessage, 'remote_redirect_rejected', 400);
                    }
                    const nextUrl = validatePublicHttpUrl(new URL(location, url), { allowCustomPorts });
                    if (url.protocol === 'https:' && nextUrl.protocol !== 'https:') {
                        throw buildSsrfError('remote_redirect_downgrade', 'remote_redirect_downgrade', 400);
                    }
                    url = nextUrl;
                    continue;
                }

                try {
                    const contentLengthRaw = response.headers?.['content-length'];
                    if (contentLengthRaw && /^\d+$/.test(String(contentLengthRaw).trim())) {
                        const contentLength = Number.parseInt(String(contentLengthRaw).trim(), 10);
                        if (Number.isFinite(contentLength) && contentLength > byteLimit) {
                            throw buildSsrfError('响应体超过大小限制', 'remote_payload_too_large', 413);
                        }
                    }

                    const chunks = [];
                    let totalBytes = 0;
                    for await (const chunk of response) {
                        activeSignal?.throwIfAborted();
                        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                        totalBytes += buf.length;
                        if (totalBytes > byteLimit) {
                            throw buildSsrfError('响应体超过大小限制', 'remote_payload_too_large', 413);
                        }
                        chunks.push(buf);
                    }

                    const buffer = Buffer.concat(chunks, totalBytes);
                    return {
                        status: statusCode,
                        ok: statusCode >= 200 && statusCode < 300,
                        url: url.toString(),
                        headers: normalizeHeaderLookup(response.headers),
                        buffer
                    };
                } finally {
                    response.destroy();
                }
            }

            throw buildSsrfError(allowUnsafeRedirectErrorMessage, 'remote_redirect_rejected', 400);
        } finally {
            if (timer) clearTimeout(timer);
        }
    };
}

module.exports = {
    isPublicAddress,
    validatePublicHttpUrl,
    resolvePublicAddresses,
    detectImageMimeFromMagic,
    detectVideoMimeFromMagic,
    createSafeRemoteFetcher,
    fetchWithPinnedSsrfGuard: createSafeRemoteFetcher()
};
