const {
    resolveSiteScopedSystemConfigForRead
} = require('./_site-scoped-system-config');

const AI_IMAGE_GUARDRAILS_CONFIG_KEY = 'ai_image_guardrails';

const DEFAULT_AI_IMAGE_GUARDRAILS = Object.freeze({
    submit: {
        global: { limit: 180, windowMs: 60_000 },
        ip: { limit: 30, windowMs: 60_000 },
        user: { limit: 12, windowMs: 60_000 },
        heavyUser: { limit: 4, windowMs: 60_000 },
        model: { limit: 6, windowMs: 60_000 }
    },
    upload: {
        global: { limit: 420, windowMs: 60_000 },
        ip: { limit: 36, windowMs: 60_000 },
        user: { limit: 18, windowMs: 60_000 }
    },
    download: {
        global: { limit: 1200, windowMs: 60_000 },
        ip: { limit: 180, windowMs: 60_000 },
        user: { limit: 120, windowMs: 60_000 },
        resource: { limit: 24, windowMs: 60_000 }
    },
    tasks: {
        running: 2,
        queued: 5,
        active: 6
    }
});

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeSite(value = 'all') {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'cn' || normalized === 'intl') return normalized;
    return 'all';
}

function readPositiveInt(value, fallback = 1, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
    const parsed = Number.parseInt(String(value || '').trim(), 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
}

function readEnvInt(env = {}, name = '', fallback = 1, options = {}) {
    return readPositiveInt(env?.[name], fallback, options);
}

function normalizeLimitWindow(value = {}, fallback = {}, options = {}) {
    const source = isPlainObject(value) ? value : {};
    return {
        limit: readPositiveInt(source.limit ?? source.max ?? source.limit_value, fallback.limit, {
            min: options.minLimit || 1,
            max: options.maxLimit || 100000
        }),
        windowMs: readPositiveInt(source.windowMs ?? source.window_ms ?? source.window, fallback.windowMs, {
            min: options.minWindowMs || 1000,
            max: options.maxWindowMs || 86_400_000
        })
    };
}

function resolveAiImageGuardrailEnvDefaults(env = {}) {
    return {
        submit: {
            global: {
                limit: readEnvInt(env, 'AI_IMAGE_RATE_LIMIT_SUBMIT_GLOBAL_MAX', DEFAULT_AI_IMAGE_GUARDRAILS.submit.global.limit, { min: 1, max: 10000 }),
                windowMs: readEnvInt(env, 'AI_IMAGE_RATE_LIMIT_SUBMIT_GLOBAL_WINDOW_MS', DEFAULT_AI_IMAGE_GUARDRAILS.submit.global.windowMs, { min: 1000, max: 86_400_000 })
            },
            ip: {
                limit: readEnvInt(env, 'AI_IMAGE_RATE_LIMIT_SUBMIT_IP_MAX', DEFAULT_AI_IMAGE_GUARDRAILS.submit.ip.limit, { min: 1, max: 10000 }),
                windowMs: readEnvInt(env, 'AI_IMAGE_RATE_LIMIT_SUBMIT_IP_WINDOW_MS', DEFAULT_AI_IMAGE_GUARDRAILS.submit.ip.windowMs, { min: 1000, max: 86_400_000 })
            },
            user: {
                limit: readEnvInt(env, 'AI_IMAGE_RATE_LIMIT_SUBMIT_USER_MAX', DEFAULT_AI_IMAGE_GUARDRAILS.submit.user.limit, { min: 1, max: 10000 }),
                windowMs: readEnvInt(env, 'AI_IMAGE_RATE_LIMIT_SUBMIT_USER_WINDOW_MS', DEFAULT_AI_IMAGE_GUARDRAILS.submit.user.windowMs, { min: 1000, max: 86_400_000 })
            },
            heavyUser: {
                limit: readEnvInt(env, 'AI_IMAGE_RATE_LIMIT_SUBMIT_HEAVY_USER_MAX', DEFAULT_AI_IMAGE_GUARDRAILS.submit.heavyUser.limit, { min: 1, max: 10000 }),
                windowMs: readEnvInt(env, 'AI_IMAGE_RATE_LIMIT_SUBMIT_HEAVY_USER_WINDOW_MS', DEFAULT_AI_IMAGE_GUARDRAILS.submit.heavyUser.windowMs, { min: 1000, max: 86_400_000 })
            },
            model: {
                limit: readEnvInt(env, 'AI_IMAGE_RATE_LIMIT_SUBMIT_MODEL_MAX', DEFAULT_AI_IMAGE_GUARDRAILS.submit.model.limit, { min: 1, max: 10000 }),
                windowMs: readEnvInt(env, 'AI_IMAGE_RATE_LIMIT_SUBMIT_MODEL_WINDOW_MS', DEFAULT_AI_IMAGE_GUARDRAILS.submit.model.windowMs, { min: 1000, max: 86_400_000 })
            }
        },
        upload: {
            global: {
                limit: readEnvInt(env, 'AI_IMAGE_RATE_LIMIT_UPLOAD_GLOBAL_MAX', DEFAULT_AI_IMAGE_GUARDRAILS.upload.global.limit, { min: 1, max: 10000 }),
                windowMs: readEnvInt(env, 'AI_IMAGE_RATE_LIMIT_UPLOAD_GLOBAL_WINDOW_MS', DEFAULT_AI_IMAGE_GUARDRAILS.upload.global.windowMs, { min: 1000, max: 86_400_000 })
            },
            ip: {
                limit: readEnvInt(env, 'AI_IMAGE_RATE_LIMIT_UPLOAD_IP_MAX', DEFAULT_AI_IMAGE_GUARDRAILS.upload.ip.limit, { min: 1, max: 10000 }),
                windowMs: readEnvInt(env, 'AI_IMAGE_RATE_LIMIT_UPLOAD_IP_WINDOW_MS', DEFAULT_AI_IMAGE_GUARDRAILS.upload.ip.windowMs, { min: 1000, max: 86_400_000 })
            },
            user: {
                limit: readEnvInt(env, 'AI_IMAGE_RATE_LIMIT_UPLOAD_USER_MAX', DEFAULT_AI_IMAGE_GUARDRAILS.upload.user.limit, { min: 1, max: 10000 }),
                windowMs: readEnvInt(env, 'AI_IMAGE_RATE_LIMIT_UPLOAD_USER_WINDOW_MS', DEFAULT_AI_IMAGE_GUARDRAILS.upload.user.windowMs, { min: 1000, max: 86_400_000 })
            }
        },
        download: {
            global: {
                limit: readEnvInt(env, 'AI_IMAGE_RATE_LIMIT_DOWNLOAD_GLOBAL_MAX', DEFAULT_AI_IMAGE_GUARDRAILS.download.global.limit, { min: 1, max: 100000 }),
                windowMs: readEnvInt(env, 'AI_IMAGE_RATE_LIMIT_DOWNLOAD_GLOBAL_WINDOW_MS', DEFAULT_AI_IMAGE_GUARDRAILS.download.global.windowMs, { min: 1000, max: 86_400_000 })
            },
            ip: {
                limit: readEnvInt(env, 'AI_IMAGE_RATE_LIMIT_DOWNLOAD_IP_MAX', DEFAULT_AI_IMAGE_GUARDRAILS.download.ip.limit, { min: 1, max: 100000 }),
                windowMs: readEnvInt(env, 'AI_IMAGE_RATE_LIMIT_DOWNLOAD_IP_WINDOW_MS', DEFAULT_AI_IMAGE_GUARDRAILS.download.ip.windowMs, { min: 1000, max: 86_400_000 })
            },
            user: {
                limit: readEnvInt(env, 'AI_IMAGE_RATE_LIMIT_DOWNLOAD_USER_MAX', DEFAULT_AI_IMAGE_GUARDRAILS.download.user.limit, { min: 1, max: 100000 }),
                windowMs: readEnvInt(env, 'AI_IMAGE_RATE_LIMIT_DOWNLOAD_USER_WINDOW_MS', DEFAULT_AI_IMAGE_GUARDRAILS.download.user.windowMs, { min: 1000, max: 86_400_000 })
            },
            resource: {
                limit: readEnvInt(env, 'AI_IMAGE_RATE_LIMIT_DOWNLOAD_RESOURCE_MAX', DEFAULT_AI_IMAGE_GUARDRAILS.download.resource.limit, { min: 1, max: 100000 }),
                windowMs: readEnvInt(env, 'AI_IMAGE_RATE_LIMIT_DOWNLOAD_RESOURCE_WINDOW_MS', DEFAULT_AI_IMAGE_GUARDRAILS.download.resource.windowMs, { min: 1000, max: 86_400_000 })
            }
        },
        tasks: {
            running: readEnvInt(env, 'AI_IMAGE_USER_RUNNING_TASK_LIMIT', DEFAULT_AI_IMAGE_GUARDRAILS.tasks.running, { min: 1, max: 20 }),
            queued: readEnvInt(env, 'AI_IMAGE_USER_QUEUED_TASK_LIMIT', DEFAULT_AI_IMAGE_GUARDRAILS.tasks.queued, { min: 1, max: 100 }),
            active: readEnvInt(env, 'AI_IMAGE_USER_ACTIVE_TASK_LIMIT', DEFAULT_AI_IMAGE_GUARDRAILS.tasks.active, { min: 1, max: 100 })
        }
    };
}

function normalizeAiImageGuardrails(value = {}, { env = process.env } = {}) {
    const defaults = resolveAiImageGuardrailEnvDefaults(env);
    const source = isPlainObject(value) ? value : {};
    return {
        submit: {
            global: normalizeLimitWindow(source.submit?.global, defaults.submit.global, { maxLimit: 10000 }),
            ip: normalizeLimitWindow(source.submit?.ip, defaults.submit.ip, { maxLimit: 10000 }),
            user: normalizeLimitWindow(source.submit?.user, defaults.submit.user, { maxLimit: 10000 }),
            heavyUser: normalizeLimitWindow(source.submit?.heavyUser || source.submit?.heavy_user, defaults.submit.heavyUser, { maxLimit: 10000 }),
            model: normalizeLimitWindow(source.submit?.model, defaults.submit.model, { maxLimit: 10000 })
        },
        upload: {
            global: normalizeLimitWindow(source.upload?.global, defaults.upload.global, { maxLimit: 10000 }),
            ip: normalizeLimitWindow(source.upload?.ip, defaults.upload.ip, { maxLimit: 10000 }),
            user: normalizeLimitWindow(source.upload?.user, defaults.upload.user, { maxLimit: 10000 })
        },
        download: {
            global: normalizeLimitWindow(source.download?.global, defaults.download.global, { maxLimit: 100000 }),
            ip: normalizeLimitWindow(source.download?.ip, defaults.download.ip, { maxLimit: 100000 }),
            user: normalizeLimitWindow(source.download?.user, defaults.download.user, { maxLimit: 100000 }),
            resource: normalizeLimitWindow(source.download?.resource, defaults.download.resource, { maxLimit: 100000 })
        },
        tasks: {
            running: readPositiveInt(source.tasks?.running ?? source.tasks?.runningLimit, defaults.tasks.running, { min: 1, max: 20 }),
            queued: readPositiveInt(source.tasks?.queued ?? source.tasks?.queuedLimit, defaults.tasks.queued, { min: 1, max: 100 }),
            active: readPositiveInt(source.tasks?.active ?? source.tasks?.activeLimit, defaults.tasks.active, { min: 1, max: 100 })
        }
    };
}

function normalizeAiImageGuardrailsForSite(value = {}, { site = 'all', env = process.env } = {}) {
    const resolved = resolveSiteScopedSystemConfigForRead(AI_IMAGE_GUARDRAILS_CONFIG_KEY, value, normalizeSite(site));
    return normalizeAiImageGuardrails(resolved || {}, { env });
}

async function loadAiImageGuardrailsFromSystemConfig(supabase, { site = 'all', env = process.env } = {}) {
    if (!supabase?.from) {
        return normalizeAiImageGuardrails({}, { env });
    }

    try {
        const { data, error } = await supabase
            .from('system_config')
            .select('config_value')
            .eq('config_key', AI_IMAGE_GUARDRAILS_CONFIG_KEY)
            .maybeSingle();
        if (error) throw error;
        return normalizeAiImageGuardrailsForSite(data?.config_value || {}, { site, env });
    } catch (_) {
        return normalizeAiImageGuardrails({}, { env });
    }
}

module.exports = {
    AI_IMAGE_GUARDRAILS_CONFIG_KEY,
    DEFAULT_AI_IMAGE_GUARDRAILS,
    loadAiImageGuardrailsFromSystemConfig,
    normalizeAiImageGuardrails,
    normalizeAiImageGuardrailsForSite,
    resolveAiImageGuardrailEnvDefaults
};
