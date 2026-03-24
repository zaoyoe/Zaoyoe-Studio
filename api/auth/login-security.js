const {
    getOptionalSupabaseAdmin,
    getSupabaseAdmin,
    parseJsonBody,
    sendJson
} = require('../_lib/admin');
const {
    applyRateLimitHeaders,
    resolveClientIp,
    takeRateLimitToken
} = require('../_lib/request-security');

const DEFAULT_SECURITY_CONFIG = Object.freeze({
    login_lockout_attempts: 5,
    lockout_duration: 15 * 60 * 1000
});

function sanitizeEmail(value) {
    return String(value || '').trim().toLowerCase();
}

function normalizeRemainingSeconds(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return 0;
    }
    return Math.max(0, Math.ceil(parsed));
}

function buildSecurityPayload({
    ipBlocked = false,
    ipBlockReason = null,
    ipBlockExpiresAt = null,
    accountLocked = false,
    lockedUntil = null,
    remainingSeconds = 0
} = {}) {
    return {
        ip_blocked: ipBlocked === true,
        ip_block_reason: ipBlockReason || null,
        ip_block_expires_at: ipBlockExpiresAt || null,
        account_locked: accountLocked === true,
        locked_until: lockedUntil || null,
        remaining_seconds: normalizeRemainingSeconds(remainingSeconds)
    };
}

async function unwrapSingleResult(query) {
    if (!query) {
        return { data: null, error: null };
    }

    if (typeof query.single === 'function') {
        return query.single();
    }

    return query;
}

async function loadSecurityConfig(supabase) {
    try {
        const { data, error } = await supabase
            .from('system_config')
            .select('config_value')
            .eq('config_key', 'security')
            .maybeSingle();

        if (error) throw error;

        const config = data?.config_value || {};
        const maxAttempts = Math.max(1, Number(config.login_lockout_attempts) || DEFAULT_SECURITY_CONFIG.login_lockout_attempts);
        const lockoutDurationMs = Math.max(60_000, Number(config.lockout_duration) || DEFAULT_SECURITY_CONFIG.lockout_duration);

        return {
            login_lockout_attempts: maxAttempts,
            lockout_duration: lockoutDurationMs,
            lockout_minutes: Math.max(1, Math.ceil(lockoutDurationMs / 60_000))
        };
    } catch (error) {
        console.warn('[AuthSecurity] Failed to load security config, using defaults:', error.message);
        return {
            login_lockout_attempts: DEFAULT_SECURITY_CONFIG.login_lockout_attempts,
            lockout_duration: DEFAULT_SECURITY_CONFIG.lockout_duration,
            lockout_minutes: Math.max(1, Math.ceil(DEFAULT_SECURITY_CONFIG.lockout_duration / 60_000))
        };
    }
}

async function checkIpBlockState(supabase, clientIp) {
    const normalizedIp = String(clientIp || '').trim();
    if (!normalizedIp) {
        return buildSecurityPayload();
    }

    const { data, error } = await supabase.rpc('check_ip_blacklisted', {
        client_ip: normalizedIp
    });

    if (error) throw error;

    return buildSecurityPayload({
        ipBlocked: data?.blocked === true,
        ipBlockReason: data?.reason || null,
        ipBlockExpiresAt: data?.expires_at || null
    });
}

async function checkAccountLockState(supabase, email) {
    if (!email) {
        return buildSecurityPayload();
    }

    const { data, error } = await unwrapSingleResult(
        supabase.rpc('check_user_locked', {
            user_email: email
        })
    );

    if (error) throw error;

    return buildSecurityPayload({
        accountLocked: data?.is_locked === true,
        lockedUntil: data?.locked_until || null,
        remainingSeconds: data?.remaining_seconds || 0
    });
}

async function recordFailureState(supabase, email, clientIp, securityConfig) {
    if (!email) {
        return buildSecurityPayload();
    }

    const { data, error } = await unwrapSingleResult(
        supabase.rpc('record_login_failure', {
            user_email: email,
            max_attempts: securityConfig.login_lockout_attempts,
            lockout_minutes: securityConfig.lockout_minutes,
            client_ip: clientIp || null
        })
    );

    if (error) throw error;

    const failureState = buildSecurityPayload({
        accountLocked: data?.is_now_locked === true,
        lockedUntil: data?.locked_until || null,
        remainingSeconds: data?.locked_until ? Math.ceil((Date.parse(data.locked_until) - Date.now()) / 1000) : 0
    });

    if (data?.ip_auto_blocked === true && clientIp) {
        const ipState = await checkIpBlockState(supabase, clientIp);
        return {
            ...failureState,
            ip_blocked: ipState.ip_blocked,
            ip_block_reason: ipState.ip_block_reason,
            ip_block_expires_at: ipState.ip_block_expires_at
        };
    }

    return failureState;
}

async function runSecurityAction({ supabase, action, email, clientIp }) {
    const ipState = await checkIpBlockState(supabase, clientIp);
    if (ipState.ip_blocked) {
        return ipState;
    }

    if (action === 'preflight') {
        const accountState = await checkAccountLockState(supabase, email);
        return {
            ...accountState,
            ip_blocked: ipState.ip_blocked,
            ip_block_reason: ipState.ip_block_reason,
            ip_block_expires_at: ipState.ip_block_expires_at
        };
    }

    const securityConfig = await loadSecurityConfig(supabase);
    return recordFailureState(supabase, email, clientIp, securityConfig);
}

async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return sendJson(res, 405, {
            success: false,
            message: 'Method not allowed'
        });
    }

    const rateLimit = await takeRateLimitToken({
        supabase: getOptionalSupabaseAdmin(),
        key: `auth-login-security:${resolveClientIp(req, { env: process.env }) || 'unknown'}`,
        limit: Math.max(1, Number(process.env.AUTH_LOGIN_SECURITY_RATE_LIMIT_MAX || 20)),
        windowMs: Math.max(10_000, Number(process.env.AUTH_LOGIN_SECURITY_RATE_LIMIT_WINDOW_MS || 60_000))
    });
    applyRateLimitHeaders(res, rateLimit);
    if (!rateLimit.allowed) {
        return sendJson(res, 429, {
            success: false,
            message: 'Too many login security requests',
            retry_after_seconds: rateLimit.retryAfterSeconds
        });
    }

    try {
        const body = await parseJsonBody(req);
        const action = String(body?.action || '').trim();
        const email = sanitizeEmail(body?.email);

        if (!email) {
            return sendJson(res, 400, {
                success: false,
                message: 'Email is required'
            });
        }

        if (action !== 'preflight' && action !== 'record_failure') {
            return sendJson(res, 400, {
                success: false,
                message: 'Unsupported action'
            });
        }

        const supabase = getSupabaseAdmin();
        const clientIp = resolveClientIp(req, { env: process.env });
        const security = await runSecurityAction({
            supabase,
            action,
            email,
            clientIp
        });

        return sendJson(res, 200, {
            success: true,
            action,
            security
        });
    } catch (error) {
        console.error('[AuthSecurity] Request failed:', error);
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: error.message || 'Failed to evaluate login security'
        });
    }
}

module.exports = handler;
module.exports._private = {
    buildSecurityPayload,
    loadSecurityConfig,
    recordFailureState,
    runSecurityAction,
    sanitizeEmail,
    unwrapSingleResult
};
