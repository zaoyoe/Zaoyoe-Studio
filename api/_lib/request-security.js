const { isIP } = require('node:net');

const sharedRateLimitStore = new Map();
const MAX_RATE_LIMIT_BUCKETS = 5000;
const MEMORY_RATE_LIMIT_BACKENDS = new Set(['memory', 'in-memory', 'local']);

function isProductionLikeRuntime(env = process.env) {
    const vercelEnv = String(env?.VERCEL_ENV || '').trim().toLowerCase();
    const railwayEnv = String(env?.RAILWAY_ENVIRONMENT_NAME || '').trim().toLowerCase();
    const deploymentTier = String(env?.DEPLOYMENT_TIER || env?.APP_ENV || '').trim().toLowerCase();

    return vercelEnv === 'production'
        || railwayEnv === 'production'
        || deploymentTier === 'production';
}

function shouldTrustAllProxies(env, explicitTrustAll = false) {
    if (isProductionLikeRuntime(env)) {
        return false;
    }

    return explicitTrustAll === true
        || String(env?.TRUST_ALL_PROXIES || '').trim() === '1'
        || String(env?.TRUST_ALL_PROXIES || '').trim().toLowerCase() === 'true';
}

function normalizeIp(value) {
    let raw = String(value || '').trim();
    if (!raw) return '';

    const bracketedHost = raw.match(/^\[([A-Fa-f0-9:.]+)\](?::\d+)?$/);
    if (bracketedHost?.[1]) {
        raw = bracketedHost[1];
    }

    const forwardedMatch = raw.match(/for=(?:"?\[?)([A-Fa-f0-9:.]+)(?:\]?"?)/i);
    if (forwardedMatch?.[1]) {
        raw = forwardedMatch[1];
    }

    if (raw.includes(',')) {
        raw = raw.split(',')[0].trim();
    }

    raw = raw.replace(/^"+|"+$/g, '');
    raw = raw.replace(/^\[|\]$/g, '');
    raw = raw.replace(/^::ffff:/i, '');
    raw = raw.split('%')[0];

    const ipv4WithPort = raw.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
    if (ipv4WithPort?.[1]) {
        raw = ipv4WithPort[1];
    }

    return raw;
}

function splitIpRules(value) {
    if (Array.isArray(value)) {
        return value.map((entry) => normalizeIpRule(entry)).filter(Boolean);
    }

    return String(value || '')
        .split(/[\n,]+/)
        .map((entry) => normalizeIpRule(entry))
        .filter(Boolean);
}

function normalizeIpRule(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';

    if (raw.includes('/')) {
        const [base, prefix] = raw.split('/');
        const normalizedBase = normalizeIp(base);
        const normalizedPrefix = Number(prefix);
        if (!normalizedBase || !Number.isInteger(normalizedPrefix)) {
            return '';
        }
        return `${normalizedBase}/${normalizedPrefix}`;
    }

    return normalizeIp(raw);
}

function ipv4ToBuffer(ip) {
    const octets = String(ip || '').split('.');
    if (octets.length !== 4) return null;

    const bytes = octets.map((octet) => Number(octet));
    if (bytes.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
        return null;
    }

    return Buffer.from(bytes);
}

function expandIpv6(ip) {
    const normalized = String(ip || '').toLowerCase();
    if (!normalized) return null;

    const halves = normalized.split('::');
    if (halves.length > 2) return null;

    const left = halves[0] ? halves[0].split(':').filter(Boolean) : [];
    const right = halves[1] ? halves[1].split(':').filter(Boolean) : [];

    if (right.length) {
        const last = right[right.length - 1];
        if (last && last.includes('.')) {
            const ipv4Buffer = ipv4ToBuffer(last);
            if (!ipv4Buffer) return null;
            right.splice(right.length - 1, 1, ipv4Buffer.readUInt16BE(0).toString(16), ipv4Buffer.readUInt16BE(2).toString(16));
        }
    }

    if (left.length) {
        const last = left[left.length - 1];
        if (last && last.includes('.')) {
            const ipv4Buffer = ipv4ToBuffer(last);
            if (!ipv4Buffer) return null;
            left.splice(left.length - 1, 1, ipv4Buffer.readUInt16BE(0).toString(16), ipv4Buffer.readUInt16BE(2).toString(16));
        }
    }

    const totalGroups = left.length + right.length;
    if ((halves.length === 1 && totalGroups !== 8) || totalGroups > 8) {
        return null;
    }

    const zeroGroups = halves.length === 2 ? 8 - totalGroups : 0;
    const groups = [
        ...left,
        ...Array.from({ length: zeroGroups }, () => '0'),
        ...right
    ];

    if (groups.length !== 8) return null;
    return groups.map((group) => group.padStart(4, '0'));
}

function ipv6ToBuffer(ip) {
    const groups = expandIpv6(ip);
    if (!groups) return null;

    const buffer = Buffer.alloc(16);
    for (let index = 0; index < groups.length; index += 1) {
        const group = groups[index];
        const value = Number.parseInt(group, 16);
        if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
            return null;
        }
        buffer.writeUInt16BE(value, index * 2);
    }

    return buffer;
}

function ipToBuffer(ip) {
    const normalized = normalizeIp(ip);
    const version = isIP(normalized);
    if (version === 4) {
        const buffer = ipv4ToBuffer(normalized);
        return buffer ? { version, buffer } : null;
    }
    if (version === 6) {
        const buffer = ipv6ToBuffer(normalized);
        return buffer ? { version, buffer } : null;
    }
    return null;
}

function ipMatchesCidr(ip, cidr) {
    const [base, prefixText] = String(cidr || '').split('/');
    const normalizedBase = normalizeIp(base);
    const normalizedIp = normalizeIp(ip);
    const prefix = Number(prefixText);
    const ipBuffer = ipToBuffer(normalizedIp);
    const cidrBuffer = ipToBuffer(normalizedBase);

    if (!ipBuffer || !cidrBuffer || ipBuffer.version !== cidrBuffer.version) {
        return false;
    }

    const maxBits = ipBuffer.buffer.length * 8;
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > maxBits) {
        return false;
    }

    let bitsRemaining = prefix;
    for (let index = 0; index < ipBuffer.buffer.length; index += 1) {
        if (bitsRemaining <= 0) return true;

        const maskBits = Math.min(8, bitsRemaining);
        const mask = 0xff << (8 - maskBits) & 0xff;
        if ((ipBuffer.buffer[index] & mask) !== (cidrBuffer.buffer[index] & mask)) {
            return false;
        }
        bitsRemaining -= maskBits;
    }

    return true;
}

function isIpAllowed(ip, rules = []) {
    const normalizedIp = normalizeIp(ip);
    if (!normalizedIp) return false;

    return splitIpRules(rules).some((rule) => {
        if (rule.includes('/')) {
            return ipMatchesCidr(normalizedIp, rule);
        }
        return normalizedIp === rule;
    });
}

function isPrivateOrLoopbackIp(ip) {
    return isIpAllowed(ip, [
        '127.0.0.0/8',
        '10.0.0.0/8',
        '172.16.0.0/12',
        '192.168.0.0/16',
        '169.254.0.0/16',
        '::1/128',
        'fc00::/7',
        'fe80::/10'
    ]);
}

function extractForwardedIps(req) {
    const headers = req?.headers || {};
    const forwardedChain = [];

    const singleValueHeaders = [
        headers['cf-connecting-ip'],
        headers['x-real-ip'],
        headers['true-client-ip']
    ];

    singleValueHeaders.forEach((entry) => {
        const normalized = normalizeIp(entry);
        if (normalized) {
            forwardedChain.push(normalized);
        }
    });

    const xForwardedFor = String(headers['x-forwarded-for'] || '');
    xForwardedFor
        .split(',')
        .map((entry) => normalizeIp(entry))
        .filter(Boolean)
        .forEach((entry) => forwardedChain.push(entry));

    const forwardedHeader = String(headers.forwarded || '');
    forwardedHeader
        .split(',')
        .map((entry) => normalizeIp(entry))
        .filter(Boolean)
        .forEach((entry) => forwardedChain.push(entry));

    return [...new Set(forwardedChain)];
}

function resolveClientIp(req, options = {}) {
    const env = options.env || process.env;
    const trustedProxies = options.trustedProxies || env.TRUSTED_PROXY_IPS || env.TRUSTED_PROXY_CIDRS || '';
    const trustAllProxies = shouldTrustAllProxies(env, options.trustAllProxies === true);

    const socketIp = normalizeIp(
        req?.socket?.remoteAddress
        || req?.connection?.remoteAddress
        || req?.ip
    );
    const forwardedIps = extractForwardedIps(req);

    if (!forwardedIps.length) {
        return socketIp;
    }

    if (!socketIp) {
        return forwardedIps[0];
    }

    if (trustAllProxies || isIpAllowed(socketIp, trustedProxies)) {
        return forwardedIps[0];
    }

    return socketIp;
}

function explainClientIpResolution(req, options = {}) {
    const env = options.env || process.env;
    const trustedProxiesRaw = options.trustedProxies || env.TRUSTED_PROXY_IPS || env.TRUSTED_PROXY_CIDRS || '';
    const trustedProxies = splitIpRules(trustedProxiesRaw);
    const trustAllProxies = shouldTrustAllProxies(env, options.trustAllProxies === true);
    const socketIp = normalizeIp(
        req?.socket?.remoteAddress
        || req?.connection?.remoteAddress
        || req?.ip
    );
    const forwardedIps = extractForwardedIps(req);
    const directPeerTrusted = Boolean(socketIp) && (
        trustAllProxies
        || isIpAllowed(socketIp, trustedProxies)
    );
    const usedForwardedChain = Boolean(forwardedIps.length && (!socketIp || directPeerTrusted));
    const resolvedClientIp = usedForwardedChain
        ? forwardedIps[0]
        : socketIp;

    return {
        socketIp,
        forwardedIps,
        resolvedClientIp: resolvedClientIp || '',
        trustedProxies,
        trustAllProxies,
        directPeerTrusted,
        usedForwardedChain,
        directPeerTrustReason: !socketIp
            ? 'missing_direct_peer'
            : trustAllProxies
                ? 'trust_all_proxies'
                : isIpAllowed(socketIp, trustedProxies)
                    ? 'configured_trusted_proxy'
                    : 'untrusted_peer'
    };
}

function trimRateLimitStore(store = sharedRateLimitStore, now = Date.now()) {
    if (store.size < MAX_RATE_LIMIT_BUCKETS) return;

    for (const [key, entry] of store.entries()) {
        if (!entry || entry.resetAt <= now) {
            store.delete(key);
        }
    }

    if (store.size < MAX_RATE_LIMIT_BUCKETS) return;

    const overflow = store.size - MAX_RATE_LIMIT_BUCKETS + 100;
    if (overflow <= 0) return;

    let removed = 0;
    for (const key of store.keys()) {
        store.delete(key);
        removed += 1;
        if (removed >= overflow) {
            break;
        }
    }
}

function shouldUsePersistentRateLimitStore(env = process.env) {
    const backend = String(
        env?.RATE_LIMIT_BACKEND
        || env?.RATE_LIMIT_STORE
        || ''
    ).trim().toLowerCase();
    const disabled = String(env?.DISABLE_PERSISTENT_RATE_LIMITS || '').trim().toLowerCase();

    if (disabled === '1' || disabled === 'true') {
        return false;
    }

    return !MEMORY_RATE_LIMIT_BACKENDS.has(backend);
}

function takeLocalRateLimitToken({
    store = sharedRateLimitStore,
    key,
    limit = 60,
    windowMs = 60_000,
    now = Date.now()
}) {
    const normalizedKey = String(key || '').trim();
    const safeLimit = Math.max(1, Number(limit) || 1);
    const safeWindowMs = Math.max(1000, Number(windowMs) || 60_000);

    trimRateLimitStore(store, now);

    let entry = normalizedKey ? store.get(normalizedKey) : null;
    if (!entry || entry.resetAt <= now) {
        entry = {
            count: 0,
            resetAt: now + safeWindowMs
        };
    }

    const exhausted = entry.count >= safeLimit;
    if (!exhausted) {
        entry.count += 1;
        if (normalizedKey) {
            store.set(normalizedKey, entry);
        }
    } else if (normalizedKey) {
        store.set(normalizedKey, entry);
    }

    const retryAfterMs = Math.max(0, entry.resetAt - now);
    return {
        allowed: !exhausted,
        limit: safeLimit,
        remaining: exhausted ? 0 : Math.max(0, safeLimit - entry.count),
        resetAt: entry.resetAt,
        retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000))
    };
}

async function takePersistentRateLimitToken({
    supabase,
    store = sharedRateLimitStore,
    key,
    limit = 60,
    windowMs = 60_000,
    now = Date.now(),
    env = process.env
}) {
    const normalizedKey = String(key || '').trim();
    const safeLimit = Math.max(1, Number(limit) || 1);
    const safeWindowMs = Math.max(1000, Number(windowMs) || 60_000);
    const numericNow = Number.isFinite(Number(now)) ? Number(now) : Date.now();
    const fallback = () => takeLocalRateLimitToken({
        store,
        key: normalizedKey,
        limit: safeLimit,
        windowMs: safeWindowMs,
        now: numericNow
    });

    if (!normalizedKey || !supabase || typeof supabase.rpc !== 'function' || !shouldUsePersistentRateLimitStore(env)) {
        return fallback();
    }

    try {
        const rpcRequest = supabase.rpc('take_rate_limit_token', {
            p_key: normalizedKey,
            p_limit: safeLimit,
            p_window_ms: safeWindowMs,
            p_now: new Date(numericNow).toISOString()
        });
        const { data, error } = typeof rpcRequest?.single === 'function'
            ? await rpcRequest.single()
            : await rpcRequest;

        if (error) {
            throw error;
        }

        const payload = Array.isArray(data) ? data[0] : data;
        if (!payload || typeof payload !== 'object') {
            throw new Error('Persistent rate limit RPC returned no data');
        }

        const resetAt = Date.parse(payload.reset_at || payload.resetAt || '');
        const retryAfterSeconds = Number(payload.retry_after_seconds ?? payload.retryAfterSeconds);

        return {
            allowed: payload.allowed !== false,
            limit: Math.max(1, Number(payload.limit ?? payload.limit_value) || safeLimit),
            remaining: Math.max(0, Number(payload.remaining) || 0),
            resetAt: Number.isFinite(resetAt) ? resetAt : (numericNow + safeWindowMs),
            retryAfterSeconds: Math.max(
                1,
                Number.isFinite(retryAfterSeconds)
                    ? Math.ceil(retryAfterSeconds)
                    : Math.ceil(safeWindowMs / 1000)
            )
        };
    } catch (_) {
        return fallback();
    }
}

function isMissingBatchRateLimitRpc(error = {}) {
    const signal = [error?.code, error?.message, error?.details, error?.hint]
        .filter(Boolean)
        .join(' ');
    return /PGRST202|take_rate_limit_tokens|schema cache|function .* does not exist/i.test(signal);
}

async function takeRateLimitTokens({
    supabase,
    checks = [],
    store = sharedRateLimitStore,
    now = Date.now(),
    env = process.env
} = {}) {
    const normalizedChecks = (Array.isArray(checks) ? checks : [])
        .map((check = {}) => ({
            scope: String(check.scope || '').trim(),
            key: String(check.key || '').trim(),
            limit: Math.max(1, Number(check.limit) || 1),
            windowMs: Math.max(1000, Number(check.windowMs || check.window_ms) || 60_000)
        }))
        .filter((check) => check.key);
    if (!normalizedChecks.length) return [];

    const numericNow = Number.isFinite(Number(now)) ? Number(now) : Date.now();
    if (supabase?.rpc && shouldUsePersistentRateLimitStore(env)) {
        try {
            const { data, error } = await supabase.rpc('take_rate_limit_tokens', {
                p_checks: normalizedChecks.map((check) => ({
                    scope: check.scope,
                    key: check.key,
                    limit: check.limit,
                    window_ms: check.windowMs
                })),
                p_now: new Date(numericNow).toISOString()
            });
            if (error) throw error;
            const batchStoppedAtDenial = Array.isArray(data)
                && data.length > 0
                && data.length < normalizedChecks.length
                && data[data.length - 1]?.allowed === false;
            if (!Array.isArray(data) || data.length === 0 || (data.length < normalizedChecks.length && !batchStoppedAtDenial)) {
                throw new Error('Persistent batch rate limit RPC returned no data');
            }
            return data.map((result = {}, index) => ({
                scope: String(result.scope || normalizedChecks[index]?.scope || '').trim(),
                allowed: result.allowed !== false,
                limit: Math.max(1, Number(result.limit ?? result.limit_value) || normalizedChecks[index]?.limit || 1),
                remaining: Math.max(0, Number(result.remaining) || 0),
                resetAt: Number.isFinite(Date.parse(result.reset_at || result.resetAt || ''))
                    ? Date.parse(result.reset_at || result.resetAt)
                    : numericNow + (normalizedChecks[index]?.windowMs || 60_000),
                retryAfterSeconds: Math.max(1, Number(result.retry_after_seconds ?? result.retryAfterSeconds) || 1)
            }));
        } catch (error) {
            if (!isMissingBatchRateLimitRpc(error)) {
                return normalizedChecks.map((check) => ({
                    scope: check.scope,
                    ...takeLocalRateLimitToken({
                        store,
                        key: check.key,
                        limit: check.limit,
                        windowMs: check.windowMs,
                        now: numericNow
                    })
                }));
            }
        }
    }

    return Promise.all(normalizedChecks.map(async (check) => ({
        scope: check.scope,
        ...await takePersistentRateLimitToken({
            supabase,
            store,
            key: check.key,
            limit: check.limit,
            windowMs: check.windowMs,
            now: numericNow,
            env
        })
    })));
}

function takeRateLimitToken(options = {}) {
    if (options?.supabase) {
        return takePersistentRateLimitToken(options);
    }

    return takeLocalRateLimitToken(options);
}

function applyRateLimitHeaders(res, result = {}) {
    if (!res || typeof res.setHeader !== 'function') return;

    res.setHeader('X-RateLimit-Limit', String(result.limit || 0));
    res.setHeader('X-RateLimit-Remaining', String(result.remaining || 0));
    res.setHeader('X-RateLimit-Reset', String(Math.floor((result.resetAt || Date.now()) / 1000)));

    if (result.allowed === false) {
        res.setHeader('Retry-After', String(result.retryAfterSeconds || 1));
    }
}

function resetSharedRateLimitStore() {
    sharedRateLimitStore.clear();
}

module.exports = {
    applyRateLimitHeaders,
    explainClientIpResolution,
    ipMatchesCidr,
    isIpAllowed,
    normalizeIp,
    resolveClientIp,
    splitIpRules,
    takeRateLimitToken,
    takeRateLimitTokens,
    _private: {
        extractForwardedIps,
        ipToBuffer,
        isPrivateOrLoopbackIp,
        isProductionLikeRuntime,
        resetSharedRateLimitStore,
        sharedRateLimitStore,
        shouldTrustAllProxies,
        shouldUsePersistentRateLimitStore,
        takeLocalRateLimitToken,
        takePersistentRateLimitToken,
        trimRateLimitStore
    }
};
