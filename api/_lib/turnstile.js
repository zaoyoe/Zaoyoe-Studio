const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

// In-memory token replay store with TTL
const usedTokens = new Map();
const MAX_USED_TOKENS = 10000;
const TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutes

function cleanExpiredTokens(now = Date.now()) {
    for (const [token, timestamp] of usedTokens.entries()) {
        if (now - timestamp > TOKEN_TTL_MS) {
            usedTokens.delete(token);
        }
    }
}

function isTokenReplayed(token, now = Date.now()) {
    if (!token) return false;
    cleanExpiredTokens(now);
    return usedTokens.has(token);
}

function markTokenUsed(token, now = Date.now()) {
    if (!token) return;
    if (usedTokens.size >= MAX_USED_TOKENS) {
        cleanExpiredTokens(now);
        if (usedTokens.size >= MAX_USED_TOKENS) {
            const firstKey = usedTokens.keys().next().value;
            if (firstKey) usedTokens.delete(firstKey);
        }
    }
    usedTokens.set(token, now);
}

function clearUsedTokensForTest() {
    usedTokens.clear();
}

/**
 * Validate Cloudflare Turnstile token on the backend
 * @param {string} token - The client response token
 * @param {object} options
 * @param {string} [options.clientIp] - Client's remote IP
 * @param {string} [options.secretKey] - Cloudflare Turnstile secret key (defaults to CLOUDFLARE_TURNSTILE_SECRET_KEY)
 * @param {string} [options.idempotencyKey] - Optional UUID to prevent double verification
 * @param {function} [options.fetchImpl] - Fetch implementation (defaults to globalThis.fetch)
 * @param {boolean} [options.isProduction] - Whether current runtime is production
 * @returns {Promise<{ success: boolean, error?: string, errorCodes?: string[], challengeTs?: string, hostname?: string, simulated?: boolean }>}
 */
async function verifyTurnstileToken(token, {
    clientIp = '',
    secretKey = process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY,
    idempotencyKey = '',
    fetchImpl = globalThis.fetch,
    isProduction = process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production'
} = {}) {
    const normalizedToken = String(token || '').trim();
    const effectiveSecret = String(secretKey || '').trim();

    // If Turnstile is not yet configured, allow safe degradation in non-production environments
    if (!effectiveSecret) {
        if (!isProduction) {
            return {
                success: true,
                simulated: true,
                warning: 'Turnstile secret key not configured; bypassed in non-production environment.'
            };
        }
        return {
            success: false,
            error: 'TURNSTILE_SECRET_NOT_CONFIGURED',
            errorCodes: ['missing-input-secret']
        };
    }

    if (!normalizedToken) {
        return {
            success: false,
            error: 'MISSING_CAPTCHA_TOKEN',
            errorCodes: ['missing-input-response']
        };
    }

    // Check token replay
    if (isTokenReplayed(normalizedToken)) {
        return {
            success: false,
            error: 'CAPTCHA_TOKEN_REPLAYED',
            errorCodes: ['timeout-or-duplicate']
        };
    }

    const payload = new URLSearchParams();
    payload.append('secret', effectiveSecret);
    payload.append('response', normalizedToken);
    if (clientIp) {
        payload.append('remoteip', clientIp);
    }
    if (idempotencyKey) {
        payload.append('idempotency_key', idempotencyKey);
    }

    try {
        const response = await fetchImpl(TURNSTILE_VERIFY_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: payload.toString()
        });

        if (!response.ok) {
            console.error(`[Turnstile] Cloudflare siteverify HTTP error: ${response.status}`);
            return {
                success: false,
                error: 'TURNSTILE_UPSTREAM_HTTP_ERROR',
                statusCode: response.status
            };
        }

        const data = await response.json();

        if (data.success === true) {
            markTokenUsed(normalizedToken);
            return {
                success: true,
                challengeTs: data.challenge_ts || null,
                hostname: data.hostname || null,
                action: data.action || null,
                cdata: data.cdata || null
            };
        }

        return {
            success: false,
            error: 'CAPTCHA_VERIFICATION_FAILED',
            errorCodes: Array.isArray(data['error-codes']) ? data['error-codes'] : [],
            messages: data.messages || []
        };
    } catch (error) {
        console.error('[Turnstile] Cloudflare siteverify network error:', error.message);
        return {
            success: false,
            error: 'TURNSTILE_NETWORK_FAILED',
            message: error.message
        };
    }
}

/**
 * Honeypot & Timing verification helper
 * @param {object} payload
 * @param {string} [payload.trapValue] - Value of the invisible honeypot field (should be empty)
 * @param {number} [payload.renderedAt] - Timestamp when the form was rendered on client
 * @param {number} [payload.minDurationMs=500] - Minimum acceptable fill duration (in ms)
 * @returns {{ pass: boolean, reason?: string }}
 */
function verifyHoneypotAndTiming({ trapValue = '', renderedAt = 0, minDurationMs = 500 } = {}) {
    // 1. Trap field check: bots fill hidden inputs
    if (String(trapValue || '').trim().length > 0) {
        return { pass: false, reason: 'HONEYPOT_TRAP_TRIGGERED' };
    }

    // 2. Timing check: bots submit in 0-200ms
    const parsedRenderedAt = Number(renderedAt);
    if (Number.isFinite(parsedRenderedAt) && parsedRenderedAt > 0) {
        const elapsed = Date.now() - parsedRenderedAt;
        if (elapsed > 0 && elapsed < minDurationMs) {
            return { pass: false, reason: 'SUBMIT_TOO_FAST', elapsedMs: elapsed };
        }
    }

    return { pass: true };
}

module.exports = {
    TURNSTILE_VERIFY_URL,
    verifyTurnstileToken,
    verifyHoneypotAndTiming,
    isTokenReplayed,
    markTokenUsed,
    clearUsedTokensForTest
};
