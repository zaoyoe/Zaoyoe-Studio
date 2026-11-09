'use strict';

const dns = require('node:dns').promises;
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');

const denied = new net.BlockList();
for (const [ip, prefix] of [
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
    ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
    ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
    ['224.0.0.0', 3]
]) denied.addSubnet(ip, prefix, 'ipv4');
// Only native global unicast IPv6 is eligible. Exclude special-purpose/tunnel ranges.
for (const [ip, prefix] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]]) {
    denied.addSubnet(ip, prefix, 'ipv6');
}

function isPublicAddress(address) {
    const ip = String(address || '').replace(/^\[|\]$/g, '');
    const family = net.isIP(ip);
    if (family === 4) return !denied.check(ip, 'ipv4');
    if (family === 6) return /^[23][0-9a-f]{3}:/i.test(ip) && !denied.check(ip, 'ipv6');
    return false;
}

function validateMediaUrl(input) {
    const url = new URL(input);
    const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
        || (url.port && !['80', '443'].includes(url.port))
        || !hostname || hostname.endsWith('.')
        || /(^|\.)(localhost|local|internal|home|lan|test|invalid)$/.test(hostname)
        || (!net.isIP(hostname) && !hostname.includes('.'))
        || (net.isIP(hostname) && !isPublicAddress(hostname))) {
        throw new Error('unsafe_media_url');
    }
    url.hash = '';
    return url;
}

function detectMedia(buffer, contentType) {
    const mime = String(contentType || '').split(';')[0].trim().toLowerCase();
    const magic = buffer.subarray(0, 16);
    const formats = [
        ['image/png', 'png', magic.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))],
        ['image/jpeg', 'jpg', magic[0] === 0xff && magic[1] === 0xd8 && magic[2] === 0xff],
        ['image/gif', 'gif', /^GIF8[79]a/.test(magic.toString('ascii'))],
        ['image/webp', 'webp', magic.toString('ascii', 0, 4) === 'RIFF' && magic.toString('ascii', 8, 12) === 'WEBP'],
        ['video/mp4', 'mp4', magic.toString('ascii', 4, 8) === 'ftyp' && !/^(avif|avis|heic|mif1)$/.test(magic.toString('ascii', 8, 12))],
        ['video/quicktime', 'mov', magic.toString('ascii', 4, 8) === 'ftyp' && magic.toString('ascii', 8, 12) === 'qt  '],
        ['video/webm', 'webm', magic.subarray(0, 4).equals(Buffer.from('1a45dfa3', 'hex'))],
        ['image/avif', 'avif', magic.toString('ascii', 4, 8) === 'ftyp' && /^(avif|avis)$/.test(magic.toString('ascii', 8, 12))]
    ];
    const found = formats.find(([type, , valid]) => type === mime && valid);
    if (!found) throw new Error('unsupported_media_content');
    return { mimeType: found[0], extension: found[1] };
}

// Resolve each hop once, validate every answer and pin the connection to the checked
// address. Host/TLS SNI still use the original hostname. No proxy environment is used.
function createMediaDownloader({ lookup = dns.lookup.bind(dns), requestHttp = http.request, requestHttps = https.request } = {}) {
    return async function downloadRemoteMedia(input, { signal, maxBytes = 20 * 1024 * 1024, maxRedirects = 3 } = {}) {
        const limit = Math.max(1, Math.min(50 * 1024 * 1024, Number(maxBytes) || 20 * 1024 * 1024));
        const redirectLimit = Math.max(0, Math.min(3, Math.floor(Number(maxRedirects) || 0)));
        let url = validateMediaUrl(input);
        for (let hop = 0; hop <= redirectLimit; hop++) {
            signal?.throwIfAborted();
            const host = url.hostname.replace(/^\[|\]$/g, '');
            const addresses = net.isIP(host) ? [{ address: host, family: net.isIP(host) }] : await lookup(host, { all: true, verbatim: true });
            signal?.throwIfAborted();
            if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) throw new Error('unsafe_media_address');
            const pinned = addresses[0];
            const response = await new Promise((resolve, reject) => {
                const request = (url.protocol === 'https:' ? requestHttps : requestHttp)(url, {
                    method: 'GET', signal, agent: false,
                    headers: { 'User-Agent': 'ZaoyoeShopMedia/1.0', 'Accept-Encoding': 'identity' },
                    lookup: (_name, options, callback) => {
                        if (options?.all) callback(null, [pinned]);
                        else callback(null, pinned.address, pinned.family);
                    }
                }, resolve);
                request.on('error', reject);
                request.end();
            });
            if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
                response.destroy();
                if (!response.headers.location || hop === redirectLimit) throw new Error('media_redirect_limit');
                const next = validateMediaUrl(new URL(response.headers.location, url));
                if (url.protocol === 'https:' && next.protocol !== 'https:') throw new Error('media_redirect_downgrade');
                url = next;
                continue;
            }
            try {
                if (response.statusCode !== 200 || (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity')) throw new Error('invalid_media_response');
                const length = response.headers['content-length'];
                if (length && (!/^\d+$/.test(length) || Number(length) > limit)) throw new Error('media_too_large');
                const chunks = [];
                let total = 0;
                for await (const chunk of response) {
                    signal?.throwIfAborted();
                    total += chunk.length;
                    if (total > limit) throw new Error('media_too_large');
                    chunks.push(chunk);
                }
                const buffer = Buffer.concat(chunks, total);
                return { buffer, ...detectMedia(buffer, response.headers['content-type']) };
            } finally { response.destroy(); }
        }
        throw new Error('media_redirect_limit');
    };
}

module.exports = { isPublicAddress, validateMediaUrl, detectMedia, createMediaDownloader, downloadRemoteMedia: createMediaDownloader() };
