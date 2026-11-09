'use strict';

const crypto = require('node:crypto');
const { resolveClientIp, resolveClientCountry, normalizeIp } = require('./request-security');

// In-memory active session fingerprint store with TTL
const activeSessions = new Map();
const MAX_TRACKED_SESSIONS = 20000;
const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

const AUTOMATED_TOOL_PATTERNS = Object.freeze([
    /python-requests/i,
    /aiohttp/i,
    /curl\//i,
    /postmanruntime/i,
    /insomnia/i,
    /go-http-client/i,
    /node-fetch/i,
    /axios\//i,
    /urllib/i,
    /scrapy/i
]);

function getIpPrefix(ip = '') {
    const normalized = normalizeIp(ip);
    if (!normalized) return '';
    if (normalized.includes('.')) {
        // IPv4 /24 subnet prefix
        const parts = normalized.split('.');
        if (parts.length === 4) {
            return `${parts[0]}.${parts[1]}.${parts[2]}`;
        }
    } else if (normalized.includes(':')) {
        // IPv6 prefix (first 3 segments)
        const parts = normalized.split(':');
        if (parts.length >= 3) {
            return `${parts[0]}:${parts[1]}:${parts[2]}`;
        }
    }
    return normalized;
}

function isAutomatedToolUa(userAgent = '') {
    const ua = String(userAgent || '').trim();
    if (!ua) return false;
    return AUTOMATED_TOOL_PATTERNS.some((pattern) => pattern.test(ua));
}

function extractClientFingerprint(req, options = {}) {
    const env = options.env || process.env;
    const clientIp = resolveClientIp(req, { env }) || 'unknown';
    const country = resolveClientCountry(req) || 'UNKNOWN';
    const rawUa = String(req?.headers?.['user-agent'] || '').trim();
    const uaHash = crypto.createHash('sha256').update(rawUa || 'empty').digest('hex').slice(0, 16);
    const ipPrefix = getIpPrefix(clientIp);
    const isTool = isAutomatedToolUa(rawUa);

    return {
        clientIp,
        country,
        uaHash,
        userAgent: rawUa,
        ipPrefix,
        isTool
    };
}

function cleanExpiredSessions(now = Date.now()) {
    for (const [userId, state] of activeSessions.entries()) {
        if (now - state.lastSeenAt >= SESSION_TTL_MS) {
            activeSessions.delete(userId);
        }
    }
    // Bound memory even when all entries are still within their TTL.
    while (activeSessions.size > MAX_TRACKED_SESSIONS) {
        activeSessions.delete(activeSessions.keys().next().value);
    }
}

function saveSessionState(userId, state) {
    // Refresh insertion order so a recently active baseline survives eviction.
    activeSessions.delete(userId);
    activeSessions.set(userId, state);
    while (activeSessions.size > MAX_TRACKED_SESSIONS) {
        activeSessions.delete(activeSessions.keys().next().value);
    }
}

/**
 * Detect session anomalies indicative of token theft / credential hijacking
 */
function detectSessionAnomaly(req, user, options = {}) {
    if (!user || !user.id) {
        return { anomalyDetected: false, reason: 'unauthenticated', riskScore: 0 };
    }

    const now = options.now ?? Date.now();
    cleanExpiredSessions(now);

    const current = extractClientFingerprint(req, options);
    const previous = activeSessions.get(user.id);

    // If first request or session baseline not recorded, record baseline
    if (!previous) {
        saveSessionState(user.id, {
            ...current,
            firstSeenAt: now,
            lastSeenAt: now
        });
        return { anomalyDetected: false, reason: 'baseline_created', riskScore: 0, current };
    }

    const timeDeltaMs = Math.max(1, now - previous.lastSeenAt);
    const timeDeltaSeconds = Math.round(timeDeltaMs / 1000);

    // 1. Critical Anomaly: Client suddenly switched from normal browser to automated bot tool
    if (!previous.isTool && current.isTool) {
        return {
            anomalyDetected: true,
            anomalyType: 'automated_tool_agent_switch',
            riskScore: 95,
            message: `会话客户端异常变更为自动化黑客/脚本工具 (${current.userAgent.slice(0, 50)})`,
            previous,
            current,
            timeDeltaSeconds
        };
    }

    // 2. High Anomaly: Impossible Geographic Travel (e.g. CN -> US in under 30 minutes)
    if (
        previous.country !== 'UNKNOWN' &&
        current.country !== 'UNKNOWN' &&
        previous.country !== current.country
    ) {
        const minTravelSeconds = 30 * 60; // 30 minutes minimum for cross-border trip
        if (timeDeltaSeconds < minTravelSeconds) {
            return {
                anomalyDetected: true,
                anomalyType: 'impossible_travel',
                riskScore: 88,
                message: `登录地理位置异常瞬移 (${previous.country} -> ${current.country}，间隔仅 ${timeDeltaSeconds} 秒)`,
                previous,
                current,
                timeDeltaSeconds
            };
        }
    }

    // 3. Medium-High Anomaly: Simultaneous multi-IP concurrency across different subnets
    if (
        previous.clientIp !== 'unknown' &&
        current.clientIp !== 'unknown' &&
        previous.ipPrefix !== current.ipPrefix
    ) {
        const concurrencyWindowSeconds = 45; // Different subnet within 45 seconds
        if (timeDeltaSeconds < concurrencyWindowSeconds) {
            return {
                anomalyDetected: true,
                anomalyType: 'concurrent_ip_mismatch',
                riskScore: 78,
                message: `同一凭证短时间内在异地不同网络并发调用 (${previous.clientIp} -> ${current.clientIp}，间隔 ${timeDeltaSeconds} 秒)`,
                previous,
                current,
                timeDeltaSeconds
            };
        }
    }

    // Normal progression: update active session state
    saveSessionState(user.id, {
        ...current,
        firstSeenAt: previous.firstSeenAt ?? now,
        lastSeenAt: now
    });

    return {
        anomalyDetected: false,
        riskScore: 0,
        current
    };
}

function recordSessionReauthentication(userId, fingerprint, options = {}) {
    if (!userId) return;
    const now = options.now ?? Date.now();
    cleanExpiredSessions(now);
    saveSessionState(userId, {
        ...fingerprint,
        firstSeenAt: now,
        lastSeenAt: now,
        reauthenticatedAt: now
    });
}

function clearSessionStoreForTest() {
    activeSessions.clear();
}

module.exports = {
    extractClientFingerprint,
    detectSessionAnomaly,
    recordSessionReauthentication,
    isAutomatedToolUa,
    clearSessionStoreForTest,
    _private: {
        activeSessions,
        MAX_TRACKED_SESSIONS,
        SESSION_TTL_MS,
        getIpPrefix,
        AUTOMATED_TOOL_PATTERNS
    }
};
