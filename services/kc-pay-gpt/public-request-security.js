'use strict';
const crypto = require('node:crypto');

const PROTECTED_PATHS = new Set([
    '/api/public/subscription/check', '/api/public/probe-account',
    '/api/verify-cdk', '/api/cdk/query', '/api/run-process'
]);

// This budget is shared by all public expensive routes in this process. Deployment
// must keep one KC HTTP process; multiple replicas require a shared edge budget.
function createPublicRequestGuard({ now = Date.now, maxEntries = 10000, windowMs = 60000,
    perIp = 30, perCdk = 12, globalLimit = 180, maxConcurrent = 24, perIpConcurrent = 3 } = {}) {
    const buckets = new Map();
    const inflight = new Map();
    let active = 0;
    let lastSweep = 0;
    function consume(key, limit, time) {
        let bucket = buckets.get(key);
        if (!bucket || bucket.until <= time) {
            if (!bucket && buckets.size >= maxEntries) return false;
            bucket = { count: 0, until: time + windowMs };
            buckets.set(key, bucket);
        }
        if (bucket.count >= limit) return false;
        bucket.count++;
        return true;
    }
    return function publicRequestGuard(req, res, next) {
        if (req.method !== 'POST' || !PROTECTED_PATHS.has(String(req.path || '').toLowerCase().replace(/\/+$/, ''))) return next();
        res.setHeader('Cache-Control', 'no-store');
        const time = now();
        if (time - lastSweep >= windowMs || buckets.size >= maxEntries) {
            for (const [key, bucket] of buckets) if (bucket.until <= time) buckets.delete(key);
            lastSweep = time;
        }
        // req.ip uses Express's explicit trusted-proxy configuration; never read XFF here.
        const ip = String(req.ip || req.socket?.remoteAddress || 'unknown').replace(/^::ffff:/, '');
        const ipKey = 'ip:' + crypto.createHash('sha256').update(ip).digest('hex');
        // MySQL CDK columns use a case-insensitive collation; variants share a budget.
        const cdk = String(req.body?.cdk || '').trim().toUpperCase();
        const denied = active >= maxConcurrent || (inflight.get(ipKey) || 0) >= perIpConcurrent
            || !consume('global', globalLimit, time) || !consume(ipKey, perIp, time)
            || (cdk && !consume('cdk:' + crypto.createHash('sha256').update(cdk).digest('hex'), perCdk, time));
        if (denied) {
            res.setHeader('Retry-After', String(Math.ceil(windowMs / 1000)));
            return res.status(429).json({ success: false, message: '请求过于频繁，请稍后重试' });
        }
        active++;
        inflight.set(ipKey, (inflight.get(ipKey) || 0) + 1);
        let released = false;
        const release = () => {
            if (released) return;
            released = true;
            active--;
            const count = (inflight.get(ipKey) || 1) - 1;
            if (count) inflight.set(ipKey, count); else inflight.delete(ipKey);
        };
        res.once('finish', release);
        // A disconnected client does not cancel upstream work. Keep its slot until
        // the handler actually ends its response, even when the socket is gone.
        const end = res.end;
        res.end = function (...args) {
            try { return end.apply(this, args); } finally { release(); }
        };
        try { next(); } catch (error) { release(); throw error; }
    };
}

function securityHeaders(_req, res, next) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    // Existing pages use inline scripts/handlers and Lucide. Keep those working
    // while closing framing, plugins, base-tag and arbitrary script origins.
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' https://unpkg.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; media-src 'self' blob:; connect-src 'self' wss:; frame-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    next();
}
module.exports = { createPublicRequestGuard, securityHeaders };
