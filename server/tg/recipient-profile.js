'use strict';

// Gramix API v1 has no recipient lookup endpoint. This is a read-only preview
// of Telegram's public t.me page, never an ownership or delivery guarantee.
const USERNAME = /^[a-z][a-z0-9_]{4,31}$/;
const MAX_HTML_BYTES = 256 * 1024;
const PROFILE_TIMEOUT_MS = 8_000;
const CACHE_MAX_ENTRIES = 500;
const MAX_CONCURRENT_LOOKUPS = 50;

class TelegramProfileError extends Error {
    constructor(code) {
        super('Telegram public profile is unavailable');
        this.name = 'TelegramProfileError';
        this.code = code;
    }
}

function normalizeUsername(value) {
    if (typeof value !== 'string' || value.length > 64) throw new TelegramProfileError('invalid_username');
    const username = value.trim().replace(/^@/, '').toLowerCase();
    if (!USERNAME.test(username)) throw new TelegramProfileError('invalid_username');
    return username;
}

function decodeEntities(value) {
    const named = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
    return String(value || '').replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (match, entity) => {
        if (entity[0] !== '#') return named[entity.toLowerCase()] || match;
        const point = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
        return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : '';
    });
}

function attributes(tag) {
    const result = {};
    const pattern = /([a-z_:][a-z0-9_:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
    let match;
    while ((match = pattern.exec(tag))) result[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4]);
    return result;
}

function safeAvatarUrl(value) {
    if (typeof value !== 'string' || value.length > 2048) return null;
    try {
        const url = new URL(value);
        if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash
            || !/^cdn\d+\.telesco\.pe$/.test(url.hostname)
            || !/^\/file\/[A-Za-z0-9_-]+\.(?:jpe?g|png|webp)$/.test(url.pathname)) return null;
        return url.href;
    } catch (_) { return null; }
}

function parsePublicProfile(html, username) {
    const source = String(html || '');
    // Generic "Telegram: Contact @name" pages also exist for absent or private
    // accounts. Only an actual public profile title may produce a preview.
    if (!/<(?:div|h1)\b[^>]*\bclass\s*=\s*["'][^"']*\btgme_page_title\b[^"']*["']/i.test(source)) {
        throw new TelegramProfileError('recipient_not_found');
    }
    const meta = {};
    for (const match of source.matchAll(/<meta\b[^>]*>/gi)) {
        const item = attributes(match[0]);
        if (['og:title', 'og:image', 'og:site_name'].includes(item.property)) meta[item.property] = item.content;
    }
    const hasMatchingResolve = [...source.matchAll(/<a\b[^>]*>/gi)].some((match) => {
        try {
            const url = new URL(attributes(match[0]).href);
            return url.protocol === 'tg:' && url.hostname === 'resolve' && url.searchParams.get('domain')?.toLowerCase() === username;
        } catch (_) { return false; }
    });
    const displayName = String(meta['og:title'] || '').replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '').trim();
    if (meta['og:site_name'] !== 'Telegram' || !hasMatchingResolve || !displayName || displayName.length > 256
        || /^Telegram:\s*Contact\s*@/i.test(displayName)) throw new TelegramProfileError('recipient_not_found');
    const extra = [...source.matchAll(/<div\b[^>]*class\s*=\s*["'][^"']*\btgme_page_extra\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi)]
        .map((match) => decodeEntities(match[1].replace(/<[^>]*>/g, ' '))).join(' ');
    let recipientType = 'unknown';
    if (/\bsubscribers\b/i.test(extra)) recipientType = 'channel';
    else if (/\bmembers\b/i.test(extra)) recipientType = 'group';
    else if (/\bmonthly users\b/i.test(extra) || />\s*Start Bot\s*<\/a>/i.test(source)) recipientType = 'bot';
    else if (new RegExp(`@${username}(?:\\s|$)`, 'i').test(extra)) recipientType = 'user';
    return Object.freeze({ username, display_name: displayName, avatar_url: safeAvatarUrl(meta['og:image']), source: 'telegram_public', recipient_type: recipientType });
}

async function boundedHtml(response, controller) {
    const declared = Number(response.headers?.get?.('content-length') || 0);
    if (declared > MAX_HTML_BYTES) throw new TelegramProfileError('recipient_unavailable');
    const type = response.headers?.get?.('content-type');
    if (type && !/^text\/html(?:\s*;|$)/i.test(type)) throw new TelegramProfileError('recipient_unavailable');
    if (!response.body?.getReader) {
        const text = await response.text();
        if (Buffer.byteLength(text) > MAX_HTML_BYTES) throw new TelegramProfileError('recipient_unavailable');
        return text;
    }
    const reader = response.body.getReader();
    const chunks = [];
    let bytes = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            bytes += value.byteLength;
            if (bytes > MAX_HTML_BYTES) {
                controller.abort();
                void reader.cancel().catch(() => {});
                throw new TelegramProfileError('recipient_unavailable');
            }
            chunks.push(Buffer.from(value));
        }
        return Buffer.concat(chunks).toString('utf8');
    } finally { reader.releaseLock(); }
}

function createTelegramProfileClient({ fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = PROFILE_TIMEOUT_MS } = {}) {
    const cache = new Map();
    const pending = new Map();
    const duration = Number.isInteger(timeoutMs) && timeoutMs >= 20 && timeoutMs <= PROFILE_TIMEOUT_MS ? timeoutMs : PROFILE_TIMEOUT_MS;
    async function fetchProfile(username) {
        const controller = new AbortController();
        let timer;
        try {
            return await Promise.race([
                new Promise((_resolve, reject) => {
                    timer = setTimeout(() => {
                        controller.abort();
                        reject(new TelegramProfileError('recipient_timeout'));
                    }, duration);
                }),
                (async () => {
                    const response = await fetchImpl(`https://t.me/${username}`, {
                        method: 'GET', redirect: 'error', signal: controller.signal,
                        headers: { Accept: 'text/html', 'Accept-Language': 'en', 'User-Agent': 'Fatherkey-Telegram-Profile/1.0' }
                    });
                    if (response.status === 404) throw new TelegramProfileError('recipient_not_found');
                    if (response.status !== 200) throw new TelegramProfileError('recipient_unavailable');
                    return parsePublicProfile(await boundedHtml(response, controller), username);
                })()
            ]);
        } catch (error) {
            if (error instanceof TelegramProfileError) throw error;
            throw new TelegramProfileError(error?.name === 'AbortError' ? 'recipient_timeout' : 'recipient_unavailable');
        } finally {
            clearTimeout(timer);
            controller.abort();
        }
    }
    return {
        async lookup(input) {
            const username = normalizeUsername(input);
            const cached = cache.get(username);
            if (cached?.expiresAt > now()) {
                if (cached.error) throw new TelegramProfileError(cached.error);
                return cached.value;
            }
            cache.delete(username);
            if (pending.has(username)) return pending.get(username);
            if (pending.size >= MAX_CONCURRENT_LOOKUPS) throw new TelegramProfileError('recipient_unavailable');
            const task = fetchProfile(username).then((value) => {
                cache.set(username, { value, expiresAt: now() + 60_000 });
                return value;
            }).catch((error) => {
                if (error.code === 'recipient_not_found') cache.set(username, { error: error.code, expiresAt: now() + 15_000 });
                throw error;
            }).finally(() => {
                pending.delete(username);
                while (cache.size > CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value);
            });
            pending.set(username, task);
            return task;
        }
    };
}

module.exports = { createTelegramProfileClient, TelegramProfileError, normalizeUsername, safeAvatarUrl, parsePublicProfile };
