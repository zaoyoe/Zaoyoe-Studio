const crypto = require('crypto');

const DEFAULT_SECURITY_CONFIG = Object.freeze({
    login_lockout_attempts: 5,
    lockout_duration: 15 * 60 * 1000
});

function hasValidInternalAuthSecret(req, env = process.env) {
    const expectedSecret = String(env.INTERNAL_AUTH_SECURITY_SECRET || env.CRON_SECRET || '').trim();
    const providedSecret = String(req?.headers?.['x-internal-auth-secret'] || '').trim();
    if (!expectedSecret || !providedSecret) {
        return false;
    }

    const expectedDigest = crypto.createHash('sha256').update(expectedSecret).digest();
    const providedDigest = crypto.createHash('sha256').update(providedSecret).digest();
    return crypto.timingSafeEqual(expectedDigest, providedDigest);
}

function isInvalidCredentialsAuthError(error) {
    const code = String(error?.code || '').trim().toLowerCase();
    if (code === 'invalid_credentials') {
        return true;
    }
    const message = String(error?.message || '');
    return message.includes('Invalid login credentials')
        || message.includes('invalid_credentials')
        || message.includes('Invalid credentials');
}

function resolvePasswordVerificationClient(admin, env = process.env) {
    if (typeof admin?.createSupabasePasswordVerificationClient === 'function') {
        return admin.createSupabasePasswordVerificationClient();
    }

    const supabaseUrl = String(env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
    const publishableKey = String(
        env.SUPABASE_PUBLISHABLE_KEY
        || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
        || env.SUPABASE_ANON_KEY
        || env.NEXT_PUBLIC_SUPABASE_ANON_KEY
        || ''
    ).trim();

    if (!supabaseUrl || !publishableKey) {
        throw Object.assign(new Error('Password verification client is unavailable'), { statusCode: 503 });
    }

    const { createClient } = require('@supabase/supabase-js');
    return createClient(supabaseUrl, publishableKey, {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false
        }
    });
}

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

        if (error) {
            throw error;
        }

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

async function checkIpBlockState(supabase, clientIp, { requireConfirmed = false } = {}) {
    const normalizedIp = String(clientIp || '').trim();
    if (!normalizedIp) {
        return buildSecurityPayload();
    }

    const { data, error } = await supabase.rpc('check_ip_blacklisted', {
        client_ip: normalizedIp
    });

    if (error) {
        throw error;
    }
    if (requireConfirmed && typeof data?.blocked !== 'boolean') {
        throw Object.assign(new Error('Login security is temporarily unavailable'), { statusCode: 503 });
    }

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

    if (error) {
        throw error;
    }

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

    if (error) {
        throw error;
    }

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
    if (action === 'preflight_ip' && !String(clientIp || '').trim()) {
        throw Object.assign(new Error('Login security is temporarily unavailable'), { statusCode: 503 });
    }
    const ipState = await checkIpBlockState(supabase, clientIp, { requireConfirmed: action === 'preflight_ip' });
    if (ipState.ip_blocked || action === 'preflight_ip') {
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

async function performPasswordLogin({
    supabase,
    admin,
    env,
    email,
    password,
    captchaToken,
    clientIp
}) {
    const preflightSecurity = await runSecurityAction({
        supabase,
        action: 'preflight',
        email,
        clientIp
    });

    if (preflightSecurity.ip_blocked) {
        return {
            statusCode: 403,
            body: {
                success: false,
                action: 'password_login',
                code: 'ip_blocked',
                message: 'IP is temporarily blocked',
                security: preflightSecurity
            }
        };
    }

    if (preflightSecurity.account_locked) {
        return {
            statusCode: 429,
            body: {
                success: false,
                action: 'password_login',
                code: 'account_locked',
                message: 'Account is temporarily locked',
                security: preflightSecurity
            }
        };
    }

    const authClient = resolvePasswordVerificationClient(admin, env);
    const signInPayload = {
        email,
        password
    };
    if (captchaToken) {
        signInPayload.options = { captchaToken };
    }

    const { data: authData, error: authError } = await authClient.auth.signInWithPassword(signInPayload);
    if (authError) {
        if (isInvalidCredentialsAuthError(authError)) {
            const securityConfig = await loadSecurityConfig(supabase);
            const failureSecurity = await recordFailureState(supabase, email, clientIp, securityConfig);
            return {
                statusCode: 401,
                body: {
                    success: false,
                    action: 'password_login',
                    code: 'invalid_credentials',
                    message: authError.message || 'Invalid login credentials',
                    security: failureSecurity
                }
            };
        }

        const rawStatus = Number(authError.status);
        const statusCode = rawStatus >= 400 && rawStatus < 500 ? rawStatus : 400;
        return {
            statusCode,
            body: {
                success: false,
                action: 'password_login',
                code: authError.code || 'auth_failed',
                message: authError.message || 'Authentication failed',
                security: preflightSecurity
            }
        };
    }

    if (!authData?.session?.access_token) {
        return {
            statusCode: 401,
            body: {
                success: false,
                action: 'password_login',
                code: 'auth_failed',
                message: 'Authentication failed',
                security: preflightSecurity
            }
        };
    }

    try {
        await supabase.rpc('reset_login_failures', { user_email: email });
    } catch (resetError) {
        console.warn('[AuthSecurity] Failed to reset login failures after login:', resetError?.message || resetError);
    }

    return {
        statusCode: 200,
        body: {
            success: true,
            action: 'password_login',
            security: preflightSecurity,
            session: {
                access_token: authData.session.access_token,
                refresh_token: authData.session.refresh_token,
                expires_in: authData.session.expires_in,
                expires_at: authData.session.expires_at,
                token_type: authData.session.token_type || 'bearer'
            },
            user: authData.user || authData.session.user || null
        }
    };
}

function createLoginSecurityHandler({
    admin,
    requestSecurity,
    env = process.env
} = {}) {
    const {
        getOptionalSupabaseAdmin,
        getSupabaseAdmin,
        parseJsonBody,
        sendJson
    } = admin || {};
    const {
        applyRateLimitHeaders,
        resolveClientIp,
        takeRateLimitToken
    } = requestSecurity || {};

    if (
        typeof getOptionalSupabaseAdmin !== 'function'
        || typeof getSupabaseAdmin !== 'function'
        || typeof parseJsonBody !== 'function'
        || typeof sendJson !== 'function'
    ) {
        throw new TypeError('admin helpers are required');
    }

    if (
        typeof applyRateLimitHeaders !== 'function'
        || typeof resolveClientIp !== 'function'
        || typeof takeRateLimitToken !== 'function'
    ) {
        throw new TypeError('request-security helpers are required');
    }

    return async function loginSecurityHandler(req, res) {
        if (req.method !== 'POST') {
            res.setHeader('Allow', 'POST');
            return sendJson(res, 405, {
                success: false,
                message: 'Method not allowed'
            });
        }

        const rateLimit = await takeRateLimitToken({
            supabase: getOptionalSupabaseAdmin(),
            key: `auth-login-security:${resolveClientIp(req, { env }) || 'unknown'}`,
            limit: Math.max(1, Number(env.AUTH_LOGIN_SECURITY_RATE_LIMIT_MAX || 20)),
            windowMs: Math.max(10_000, Number(env.AUTH_LOGIN_SECURITY_RATE_LIMIT_WINDOW_MS || 60_000))
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

            if (!email && action !== 'preflight_ip') {
                return sendJson(res, 400, {
                    success: false,
                    message: 'Email is required'
                });
            }

            if (
                action !== 'preflight'
                && action !== 'preflight_ip'
                && action !== 'record_failure'
                && action !== 'password_login'
            ) {
                return sendJson(res, 400, {
                    success: false,
                    message: 'Unsupported action'
                });
            }

            if (action === 'record_failure' && !hasValidInternalAuthSecret(req, env)) {
                return sendJson(res, 403, {
                    success: false,
                    code: 'record_failure_forbidden',
                    message: 'Direct failure recording is not permitted'
                });
            }

            const supabase = getSupabaseAdmin();
            const clientIp = resolveClientIp(req, { env });

            if (action === 'password_login') {
                const password = typeof body?.password === 'string' ? body.password : '';
                if (!password) {
                    return sendJson(res, 400, {
                        success: false,
                        message: 'Email and password are required'
                    });
                }
                const captchaToken = String(body?.captchaToken || '').trim() || undefined;
                const loginResult = await performPasswordLogin({
                    supabase,
                    admin,
                    env,
                    email,
                    password,
                    captchaToken,
                    clientIp
                });
                return sendJson(res, loginResult.statusCode, loginResult.body);
            }

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
    };
}

module.exports = {
    DEFAULT_SECURITY_CONFIG,
    buildSecurityPayload,
    createLoginSecurityHandler,
    hasValidInternalAuthSecret,
    isInvalidCredentialsAuthError,
    loadSecurityConfig,
    performPasswordLogin,
    recordFailureState,
    resolvePasswordVerificationClient,
    runSecurityAction,
    sanitizeEmail,
    unwrapSingleResult
};
