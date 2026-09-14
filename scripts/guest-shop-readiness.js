'use strict';

/**
 * Read-only production readiness gate for the guest-shop cash channel.
 *
 * This checker intentionally does not create a Supabase client and does not
 * call a provider.  A production deploy can run it before exposing a guest
 * product; the output only contains configuration names/statuses and never a
 * secret value.  Provider enablement and rate-limit RPC existence still live
 * in the database, so those items are reported as explicit operator checks
 * rather than being guessed from environment variables.
 */

const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const {
    GUEST_SHOP_RUNTIME_SETTINGS,
    parseRuntimeNumericSetting
} = require('../api/_lib/guest-shop/runtime-config');

const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_ENV_FILE = path.resolve(__dirname, '../server/.env.production');

const SUPPORTED_PROVIDERS = Object.freeze(['zpay', 'nowpayments']);
const MEMORY_RATE_LIMIT_BACKENDS = new Set(['memory', 'in-memory', 'local']);
const PERSISTENT_RATE_LIMIT_BACKENDS = new Set([
    'supabase',
    'postgres',
    'postgresql',
    'redis',
    'upstash',
    'database',
    'durable'
]);
const PLACEHOLDER_SECRET_PATTERN = /^(?:__configured__|mock|test|fake|changeme|change[-_ ]?me|replace[-_ ]?me|your[-_ ]?|example|placeholder)[-_ :]/iu;
const PROVIDER_TOKEN_PATTERN = /^[a-z][a-z0-9._:-]{0,79}$/u;
const TRUE_VALUES = new Set(['1', 'true', 'yes', 'y', 'on', 'enabled']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'n', 'off', 'disabled']);

// Keep the exit codes distinct so automation can tell a malformed/unsafe
// configuration from an otherwise valid configuration that still needs
// production/operator evidence.  Any non-zero code remains a hard stop for
// launch scripts; the distinction is for diagnostics and remediation.
const READINESS_EXIT_CODES = Object.freeze({
    INVALID: 2,
    NOT_READY: 3
});

const REQUIRED_REPO_FILES = Object.freeze([
    'api/public.js',
    'api/_lib/guest-shop/security.js',
    'api/_lib/guest-shop/runtime-config.js',
    'api/_lib/payments/guest-shop-adapter.js',
    'api/shop/guest/preview.js',
    'api/shop/guest/orders.js',
    'api/shop/guest/status.js',
    'api/shop/guest/recover.js',
    'api/shop/guest/claim.js',
    'api/shop/guest/webhooks/zpay.js',
    'api/shop/guest/webhooks/nowpayments.js',
    'api/shop/guest/worker.js',
    'server/api-handlers/public/guest-shop.js',
    'server/guest-shop-worker.js',
    'deploy/kvm4/guest-shop-worker/zaoyoe-guest-shop-worker',
    'deploy/kvm4/guest-shop-worker/zaoyoe-guest-shop-worker.service',
    'deploy/kvm4/guest-shop-worker/zaoyoe-guest-shop-worker.timer',
    'scripts/install-kvm4-guest-shop-worker.sh',
    'supabase/migrations/20260913_add_guest_shop_cash_purchase.sql',
    'supabase/migrations/20260913_guest_shop_atomic_rpcs.sql',
    'docs/guest-shop-payment-fulfillment-runbook.md'
]);

const REQUIRED_TEST_FILES = Object.freeze([
    'tests/guest-shop-security.test.js',
    'tests/guest-shop-payment-adapter.test.js',
    'tests/guest-shop-webhook.test.js',
    'tests/guest-shop-worker-contract.test.js',
    'tests/guest-shop-worker-scheduler-contract.test.js',
    'tests/guest-shop-runtime-config.test.js',
    'tests/guest-shop-readiness.test.js',
    'tests/guest-shop-status-recovery.test.js',
    'tests/guest-shop-frontend-contract.test.js',
    'tests/guest-shop-public-route-contract.test.js'
]);

function parseArgs(argv = []) {
    const options = {
        envFile: DEFAULT_ENV_FILE,
        json: false,
        failOnInvalid: false,
        failOnNotReady: false
    };

    for (let index = 0; index < argv.length; index += 1) {
        const value = String(argv[index] || '').trim();
        if (!value) continue;

        if (value === '--env-file') {
            const next = String(argv[index + 1] || '').trim();
            if (next) options.envFile = path.resolve(process.cwd(), next);
            index += 1;
            continue;
        }

        if (value === '--json') {
            options.json = true;
            continue;
        }

        if (value === '--fail-on-invalid') {
            options.failOnInvalid = true;
            continue;
        }

        if (value === '--fail-on-not-ready') {
            options.failOnNotReady = true;
        }
    }

    return options;
}

/**
 * Merge a dotenv file over a base environment without mutating process.env.
 * Missing files are intentionally ignored here; callers can expose that fact
 * as a non-secret readiness check and still use environment-injected values.
 */
function loadEnvFile(envFile = DEFAULT_ENV_FILE, baseEnv = process.env) {
    const merged = { ...(baseEnv && typeof baseEnv === 'object' ? baseEnv : {}) };
    const filePath = String(envFile || '').trim();
    if (!filePath || !fs.existsSync(filePath)) return merged;

    try {
        const parsed = dotenv.parse(fs.readFileSync(filePath));
        Object.assign(merged, parsed);
    } catch (_) {
        // The CLI adds a dedicated env-file check.  Keeping this helper
        // side-effect free makes it safe to use in unit tests.
    }
    return merged;
}

function normalizeText(value, maxLength = 500) {
    if (value === undefined || value === null) return '';
    return String(value).trim().slice(0, Math.max(0, Number(maxLength) || 0));
}

function envValue(env, name, maxLength = 1000) {
    return normalizeText(env?.[name], maxLength);
}

function firstEnvValue(env, names = []) {
    for (const name of names) {
        const value = envValue(env, name);
        if (value) return { name, value };
    }
    return { name: '', value: '' };
}

function parseBoolean(value) {
    const normalized = normalizeText(value, 40).toLowerCase();
    if (TRUE_VALUES.has(normalized)) return true;
    if (FALSE_VALUES.has(normalized)) return false;
    return null;
}

function productionMarkers(env = {}) {
    return ['VERCEL_ENV', 'RAILWAY_ENVIRONMENT_NAME', 'DEPLOYMENT_TIER', 'APP_ENV']
        .map((name) => ({ name, value: envValue(env, name, 80).toLowerCase() }))
        .filter((entry) => entry.value);
}

function isProductionLikeRuntime(env = {}) {
    return productionMarkers(env).some((entry) => entry.value === 'production');
}

function looksLikePlaceholderSecret(value) {
    const normalized = normalizeText(value, 1000);
    if (!normalized) return true;
    if (PLACEHOLDER_SECRET_PATTERN.test(normalized)) return true;
    return ['__configured__', 'mock', 'test', 'fake', 'changeme', 'placeholder'].includes(normalized.toLowerCase());
}

function secretIsStrong(value, minimumBytes = 32) {
    const normalized = normalizeText(value, 4096);
    return Boolean(normalized)
        && !looksLikePlaceholderSecret(normalized)
        && Buffer.byteLength(normalized, 'utf8') >= minimumBytes;
}

function isHttpsUrl(value) {
    const normalized = normalizeText(value, 2000);
    if (!normalized) return false;
    try {
        const parsed = new URL(normalized);
        return parsed.protocol === 'https:' && Boolean(parsed.hostname) && !parsed.username && !parsed.password;
    } catch (_) {
        return false;
    }
}

function isLocalUrl(value) {
    try {
        const parsed = new URL(String(value || ''));
        return ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname.toLowerCase());
    } catch (_) {
        return false;
    }
}

function isManagedHostname(hostname) {
    const normalized = normalizeText(hostname, 255).toLowerCase().replace(/^www\./u, '');
    return normalized === 'fatherkey.com'
        || normalized.endsWith('.fatherkey.com')
        || normalized === 'zaoyoe.xyz'
        || normalized.endsWith('.zaoyoe.xyz');
}

function buildCheck(area, key, ok, status, message, detail = {}) {
    const normalizedOk = ok === true;
    const blocking = detail.blocking === undefined ? !normalizedOk : detail.blocking === true;
    const severity = detail.severity || (blocking ? 'high' : 'info');
    const result = {
        area,
        key,
        ok: normalizedOk,
        status,
        severity,
        blocking,
        message
    };
    Object.entries(detail).forEach(([name, value]) => {
        if (!['blocking', 'severity'].includes(name)) result[name] = value;
    });
    return result;
}

function optionalCheck(area, key, message, detail = {}) {
    return buildCheck(area, key, true, 'optional_not_configured', message, {
        severity: 'info',
        blocking: false,
        ...detail
    });
}

function warningCheck(area, key, message, detail = {}) {
    return buildCheck(area, key, true, 'warning', message, {
        severity: detail.severity || 'medium',
        blocking: false,
        ...detail
    });
}

function manualCheck(area, key, message, detail = {}) {
    return buildCheck(area, key, true, 'manual_review', message, {
        severity: detail.severity || 'high',
        blocking: false,
        requires_manual_review: true,
        ...detail
    });
}

function invalidCheck(area, key, message, detail = {}) {
    return buildCheck(area, key, false, 'invalid', message, {
        severity: detail.severity || 'high',
        blocking: true,
        ...detail
    });
}

function inspectRuntime(env = {}) {
    const markers = productionMarkers(env);
    const production = markers.some((entry) => entry.value === 'production');
    const unknown = markers.length === 0;
    const conflicting = new Set(markers.map((entry) => entry.value)).size > 1;

    if (unknown) {
        return warningCheck(
            'runtime',
            'production-marker',
            '未检测到 production 环境标识；仅可作为本地/预发布检查，不能据此放行生产游客购买。',
            { production_like: false, markers, requires_manual_review: true }
        );
    }

    if (!production) {
        return warningCheck(
            'runtime',
            'production-marker',
            '当前不是 production-like 环境；生产专用密钥检查按非生产模式处理。',
            { production_like: false, markers }
        );
    }

    return buildCheck(
        'runtime',
        'production-marker',
        true,
        conflicting ? 'configured_with_conflict' : 'configured',
        conflicting
            ? '已识别 production，但环境标识彼此不一致；请核对部署平台变量。'
            : '已识别 production-like 运行环境。',
        { production_like: true, markers, severity: conflicting ? 'medium' : 'info', blocking: false }
    );
}

function inspectEnvFile(envFile = '', env = {}) {
    const filePath = String(envFile || '').trim();
    if (!filePath) return optionalCheck('runtime', 'env-file', '未指定环境文件，使用进程环境变量。');
    if (!fs.existsSync(filePath)) {
        return warningCheck('runtime', 'env-file', '环境文件不存在；将只使用进程环境变量。', {
            path: filePath,
            severity: 'medium'
        });
    }
    try {
        fs.accessSync(filePath, fs.constants.R_OK);
        return buildCheck('runtime', 'env-file', true, 'readable', '环境文件可读，未输出其中的敏感值。', {
            path: filePath,
            blocking: false,
            severity: 'info'
        });
    } catch (_) {
        return invalidCheck('runtime', 'env-file', '环境文件存在但不可读。', { path: filePath });
    }
}

function inspectSupabase(env, production) {
    const url = firstEnvValue(env, ['SUPABASE_URL']);
    const key = firstEnvValue(env, ['SUPABASE_SERVICE_ROLE_KEY']);
    const checks = [];

    if (!url.value) {
        checks.push(production
            ? invalidCheck('env', 'supabase-url', '生产环境缺少 SUPABASE_URL。', { env_name: 'SUPABASE_URL' })
            : optionalCheck('env', 'supabase-url', '未配置 SUPABASE_URL（非生产环境）。', { env_name: 'SUPABASE_URL' }));
    } else {
        let valid = false;
        let local = false;
        try {
            const parsed = new URL(url.value);
            valid = Boolean(parsed.hostname) && !parsed.username && !parsed.password
                && (parsed.protocol === 'https:' || (!production && parsed.protocol === 'http:'));
            local = isLocalUrl(url.value);
        } catch (_) {
            valid = false;
        }
        checks.push(valid
            ? buildCheck('env', 'supabase-url', true, 'configured', production || !local
                ? 'SUPABASE_URL 格式正确。'
                : 'SUPABASE_URL 使用本地 HTTP（仅适用于非生产）。', { env_name: 'SUPABASE_URL', host: new URL(url.value).hostname, blocking: false, severity: 'info' })
            : invalidCheck('env', 'supabase-url', production
                ? '生产环境 SUPABASE_URL 必须是无凭据的 HTTPS URL。'
                : 'SUPABASE_URL 不是有效 URL。', { env_name: 'SUPABASE_URL' }));
    }

    if (!key.value) {
        checks.push(production
            ? invalidCheck('env', 'supabase-service-role-key', '生产环境缺少 SUPABASE_SERVICE_ROLE_KEY。', { env_name: 'SUPABASE_SERVICE_ROLE_KEY' })
            : optionalCheck('env', 'supabase-service-role-key', '未配置 SUPABASE_SERVICE_ROLE_KEY（非生产环境）。', { env_name: 'SUPABASE_SERVICE_ROLE_KEY' }));
    } else {
        checks.push(secretIsStrong(key.value, 16)
            ? buildCheck('env', 'supabase-service-role-key', true, 'configured', 'SUPABASE_SERVICE_ROLE_KEY 已配置（值已隐藏）。', { env_name: 'SUPABASE_SERVICE_ROLE_KEY', blocking: false, severity: 'info' })
            : invalidCheck('env', 'supabase-service-role-key', 'SUPABASE_SERVICE_ROLE_KEY 为空、占位值或强度不足。', { env_name: 'SUPABASE_SERVICE_ROLE_KEY' }));
    }

    return checks;
}

function inspectPepper(env, name, production, options = {}) {
    const value = envValue(env, name, 4096);
    const label = options.label || name;
    const minimumBytes = Number(options.minimumBytes) || 32;
    if (!value) {
        return production
            ? invalidCheck('secrets', name.toLowerCase(), `生产环境缺少 ${name}。`, { env_name: name })
            : optionalCheck('secrets', name.toLowerCase(), `未配置 ${name}（非生产环境）。`, { env_name: name });
    }
    if (!secretIsStrong(value, minimumBytes)) {
        return invalidCheck('secrets', name.toLowerCase(), `${label} 必须是至少 ${minimumBytes} 字节的非占位密钥。`, { env_name: name });
    }
    return buildCheck('secrets', name.toLowerCase(), true, 'configured', `${label} 已配置（值已隐藏）。`, {
        env_name: name,
        blocking: false,
        severity: 'info'
    });
}

function inspectGuestSecrets(env, production) {
    const checks = [
        inspectPepper(env, 'GUEST_SHOP_CLAIM_PEPPER', production, { label: '游客取货 pepper' }),
        inspectPepper(env, 'GUEST_SHOP_CLAIM_DERIVATION_PEPPER', production, { label: '游客取货派生 pepper' })
    ];
    const claim = envValue(env, 'GUEST_SHOP_CLAIM_PEPPER', 4096);
    const derivation = envValue(env, 'GUEST_SHOP_CLAIM_DERIVATION_PEPPER', 4096);
    const serviceRole = envValue(env, 'SUPABASE_SERVICE_ROLE_KEY', 4096);

    if (claim && derivation && claim === derivation) {
        checks.push(invalidCheck('secrets', 'claim-pepper-distinct', 'GUEST_SHOP_CLAIM_PEPPER 与 GUEST_SHOP_CLAIM_DERIVATION_PEPPER 必须使用不同密钥。', {
            env_name: 'GUEST_SHOP_CLAIM_PEPPER,GUEST_SHOP_CLAIM_DERIVATION_PEPPER'
        }));
    } else {
        checks.push(buildCheck('secrets', 'claim-pepper-distinct', true, 'configured', '两个游客 pepper 已通过不相同检查（值已隐藏）。', {
            blocking: false,
            severity: 'info'
        }));
    }

    if (claim && serviceRole && claim === serviceRole) {
        checks.push(invalidCheck('secrets', 'claim-pepper-not-service-role', '游客取货 pepper 不能复用 SUPABASE_SERVICE_ROLE_KEY。', {
            env_name: 'GUEST_SHOP_CLAIM_PEPPER,SUPABASE_SERVICE_ROLE_KEY'
        }));
    } else if (claim && serviceRole) {
        checks.push(buildCheck('secrets', 'claim-pepper-not-service-role', true, 'configured', '游客取货 pepper 未复用 service-role 密钥。', {
            blocking: false,
            severity: 'info'
        }));
    }

    if (derivation && serviceRole && derivation === serviceRole) {
        checks.push(invalidCheck('secrets', 'derivation-pepper-not-service-role', '游客取货派生 pepper 不能复用 SUPABASE_SERVICE_ROLE_KEY。', {
            env_name: 'GUEST_SHOP_CLAIM_DERIVATION_PEPPER,SUPABASE_SERVICE_ROLE_KEY'
        }));
    } else if (derivation && serviceRole) {
        checks.push(buildCheck('secrets', 'derivation-pepper-not-service-role', true, 'configured', '游客取货派生 pepper 未复用 service-role 密钥。', {
            blocking: false,
            severity: 'info'
        }));
    }

    // Dedicated contact/request peppers are recommended for blast-radius
    // separation. Existing runtime safely falls back to claim pepper, so a
    // missing dedicated value is a warning rather than an accidental outage.
    for (const name of ['GUEST_SHOP_CONTACT_HASH_PEPPER', 'GUEST_SHOP_REQUEST_HASH_PEPPER']) {
        const value = envValue(env, name, 4096);
        if (!value) {
            checks.push(warningCheck('secrets', name.toLowerCase(), `${name} 未配置；运行时会回退到 claim pepper，建议上线前使用独立密钥。`, {
                env_name: name,
                severity: production ? 'medium' : 'low'
            }));
            continue;
        }
        if (!secretIsStrong(value, 32) || value === claim || value === serviceRole) {
            checks.push(invalidCheck('secrets', name.toLowerCase(), `${name} 必须是独立且至少 32 字节的非占位密钥。`, { env_name: name }));
        } else {
            checks.push(buildCheck('secrets', name.toLowerCase(), true, 'configured', `${name} 已配置（值已隐藏）。`, {
                env_name: name,
                blocking: false,
                severity: 'info'
            }));
        }
    }

    return checks;
}

function inspectWorkerSecret(env, production) {
    const explicit = envValue(env, 'GUEST_SHOP_WORKER_SECRET', 4096);
    const fallback = firstEnvValue(env, ['GUEST_SHOP_CRON_SECRET', 'CRON_SECRET']);
    const serviceRole = envValue(env, 'SUPABASE_SERVICE_ROLE_KEY', 4096);
    if (!explicit) {
        if (fallback.value) {
            return invalidCheck('worker', 'worker-secret-explicit', '生产 worker 不能只依赖通用 GUEST_SHOP_CRON_SECRET/CRON_SECRET，必须配置专用 GUEST_SHOP_WORKER_SECRET。', {
                env_name: 'GUEST_SHOP_WORKER_SECRET',
                fallback_env_name: fallback.name
            });
        }
        return production
            ? invalidCheck('worker', 'worker-secret-explicit', '生产环境缺少 GUEST_SHOP_WORKER_SECRET。', { env_name: 'GUEST_SHOP_WORKER_SECRET' })
            : optionalCheck('worker', 'worker-secret-explicit', '未配置 GUEST_SHOP_WORKER_SECRET（非生产环境）。', { env_name: 'GUEST_SHOP_WORKER_SECRET' });
    }
    if (!secretIsStrong(explicit, 32)) {
        return invalidCheck('worker', 'worker-secret-strength', 'GUEST_SHOP_WORKER_SECRET 必须是至少 32 字节的非占位密钥。', { env_name: 'GUEST_SHOP_WORKER_SECRET' });
    }
    if (serviceRole && explicit === serviceRole) {
        return invalidCheck('worker', 'worker-secret-not-service-role', 'GUEST_SHOP_WORKER_SECRET 不能复用 SUPABASE_SERVICE_ROLE_KEY。', { env_name: 'GUEST_SHOP_WORKER_SECRET' });
    }
    return buildCheck('worker', 'worker-secret-explicit', true, 'configured', '已配置专用 GUEST_SHOP_WORKER_SECRET（值已隐藏）。', {
        env_name: 'GUEST_SHOP_WORKER_SECRET',
        blocking: false,
        severity: 'info'
    });
}

function strictInteger(value, name) {
    const raw = normalizeText(value, 80);
    if (!raw) return { present: false, valid: true, value: null };
    if (!/^\d+$/u.test(raw)) return { present: true, valid: false, value: null, reason: `${name} 必须是十进制整数` };
    const parsed = Number(raw);
    if (!Number.isSafeInteger(parsed)) return { present: true, valid: false, value: null, reason: `${name} 超出安全整数范围` };
    return { present: true, valid: true, value: parsed };
}

function inspectRuntimeNumericSetting(env, name, {
    key,
    label,
    production
} = {}) {
    const spec = GUEST_SHOP_RUNTIME_SETTINGS[name];
    if (!spec) return invalidCheck('limits', key || name, `${name} 不是受支持的游客运行时配置。`, { env_name: name });

    const parsed = parseRuntimeNumericSetting(env, name);
    const displayLabel = label || spec.label || name;
    if (!parsed.present) {
        return buildCheck('limits', key || spec.key, true, 'default', `${name} 未设置，将使用安全默认值 ${spec.defaultValue}。`, {
            env_name: name,
            effective_value: spec.defaultValue,
            blocking: false,
            severity: production ? 'medium' : 'info'
        });
    }
    if (!parsed.valid) {
        const observed = Number.isFinite(parsed.value) ? parsed.value : undefined;
        const detail = {
            env_name: name,
            ...(observed === undefined ? {} : { observed }),
            min: spec.min,
            max: spec.max
        };
        // Keep the existing readiness convention for non-production range
        // tuning, while malformed syntax remains a hard failure everywhere.
        if (parsed.code === 'numeric_out_of_range' && !production) {
            return warningCheck('limits', key || spec.key, `${displayLabel} 超出建议范围 ${spec.min}-${spec.max}（非生产环境）。`, {
                ...detail,
                severity: 'low'
            });
        }
        return invalidCheck('limits', key || spec.key, parsed.reason || `${displayLabel} 配置无效。`, detail);
    }
    return buildCheck('limits', key || spec.key, true, 'configured', `${displayLabel}=${parsed.value} 在建议范围内。`, {
        env_name: name,
        observed: parsed.value,
        min: spec.min,
        max: spec.max,
        blocking: false,
        severity: 'info'
    });
}

function inspectNumericSetting(env, {
    name,
    key,
    label,
    defaultValue,
    min,
    max,
    production
}) {
    // `defaultValue`/`min`/`max` are retained in this signature for callers
    // and documentation; the shared runtime-config table is canonical.
    return inspectRuntimeNumericSetting(env, name, { key, label, production });
}

function inspectLimits(env, production) {
    const checks = [
        inspectNumericSetting(env, {
            name: 'GUEST_SHOP_ORDER_TTL_SECONDS',
            key: 'order-ttl',
            label: '游客订单 TTL',
            defaultValue: 1800,
            min: 300,
            max: 7200,
            production
        }),
        inspectNumericSetting(env, {
            name: 'GUEST_SHOP_WEBHOOK_GLOBAL_LIMIT',
            key: 'webhook-global-limit',
            label: '游客 webhook 全局每分钟上限',
            defaultValue: 1200,
            min: 10,
            max: 100000,
            production
        }),
        inspectNumericSetting(env, {
            name: 'GUEST_SHOP_WEBHOOK_IP_LIMIT',
            key: 'webhook-ip-limit',
            label: '游客 webhook 单 IP 每分钟上限',
            defaultValue: 120,
            min: 5,
            max: 10000,
            production
        })
    ];

    // Worker settings are deployment-controlled too.  They govern how many
    // paid orders can be claimed/refunded in one pass and how quickly a
    // failed fulfillment is retried, so malformed values must be visible in
    // the same readiness report as the public HTTP limits.
    const workerSettings = [
        ['GUEST_SHOP_WORKER_BATCH_SIZE', 'worker-batch-size', '游客履约 Worker 批量大小'],
        ['GUEST_SHOP_WORKER_MAX_ATTEMPTS', 'worker-max-attempts', '游客履约最大重试次数'],
        ['GUEST_SHOP_WORKER_REFUND_MAX_ATTEMPTS', 'worker-refund-max-attempts', '游客退款最大重试次数'],
        ['GUEST_SHOP_WORKER_BASE_BACKOFF_MS', 'worker-base-backoff', '游客履约基础退避时间'],
        ['GUEST_SHOP_WORKER_MAX_BACKOFF_MS', 'worker-max-backoff', '游客履约最大退避时间'],
        ['GUEST_SHOP_WORKER_LEASE_MS', 'worker-lease', '游客履约租约时间'],
        ['GUEST_SHOP_WORKER_RETRY_JITTER_RATIO', 'worker-jitter-ratio', '游客履约重试抖动比例']
    ];
    for (const [name, key, label] of workerSettings) {
        checks.push(inspectRuntimeNumericSetting(env, name, { key, label, production }));
    }

    const global = parseRuntimeNumericSetting(env, 'GUEST_SHOP_WEBHOOK_GLOBAL_LIMIT');
    const ip = parseRuntimeNumericSetting(env, 'GUEST_SHOP_WEBHOOK_IP_LIMIT');
    const globalValue = global.valid ? global.value : null;
    const ipValue = ip.valid ? ip.value : null;
    if (global.valid && ip.valid && globalValue < ipValue) {
        checks.push(invalidCheck('limits', 'webhook-limit-order', 'GUEST_SHOP_WEBHOOK_GLOBAL_LIMIT 不能小于单 IP 上限。', {
            env_name: 'GUEST_SHOP_WEBHOOK_GLOBAL_LIMIT,GUEST_SHOP_WEBHOOK_IP_LIMIT',
            global_limit: globalValue,
            ip_limit: ipValue
        }));
    } else if (!global.valid || !ip.valid) {
        checks.push(invalidCheck('limits', 'webhook-limit-order', '游客 webhook 全局/单 IP 上限无法验证，请先修复数值配置。', {
            env_name: 'GUEST_SHOP_WEBHOOK_GLOBAL_LIMIT,GUEST_SHOP_WEBHOOK_IP_LIMIT',
            severity: 'high'
        }));
    } else {
        checks.push(buildCheck('limits', 'webhook-limit-order', true, 'consistent', '游客 webhook 全局/单 IP 上限关系正常。', {
            blocking: false,
            severity: 'info'
        }));
    }

    const workerBase = parseRuntimeNumericSetting(env, 'GUEST_SHOP_WORKER_BASE_BACKOFF_MS');
    const workerMax = parseRuntimeNumericSetting(env, 'GUEST_SHOP_WORKER_MAX_BACKOFF_MS');
    if (workerBase.valid && workerMax.valid && workerMax.value < workerBase.value) {
        checks.push(invalidCheck('limits', 'worker-backoff-order', 'GUEST_SHOP_WORKER_MAX_BACKOFF_MS 不能小于基础退避时间。', {
            env_name: 'GUEST_SHOP_WORKER_BASE_BACKOFF_MS,GUEST_SHOP_WORKER_MAX_BACKOFF_MS',
            base_backoff_ms: workerBase.value,
            max_backoff_ms: workerMax.value
        }));
    } else if (!workerBase.valid || !workerMax.valid) {
        checks.push(invalidCheck('limits', 'worker-backoff-order', 'Worker 最大/基础退避关系无法验证，请先修复数值配置。', {
            env_name: 'GUEST_SHOP_WORKER_BASE_BACKOFF_MS,GUEST_SHOP_WORKER_MAX_BACKOFF_MS',
            severity: 'high'
        }));
    } else {
        checks.push(buildCheck('limits', 'worker-backoff-order', true, 'consistent', 'Worker 最大/基础退避关系正常。', {
            blocking: false,
            severity: 'info'
        }));
    }

    // Payment creation lease uses the same canonical parser as the other
    // public limits.  Keep its historical key/message for operator scripts.
    checks.push(inspectRuntimeNumericSetting(env, 'GUEST_SHOP_PAYMENT_CREATE_LEASE_MS', {
        key: 'payment-create-lease',
        label: '支付创建租约',
        production
    }));

    return checks;
}

function inspectPersistentRateLimit(env, production) {
    const disabledRaw = envValue(env, 'DISABLE_PERSISTENT_RATE_LIMITS', 80);
    const disabled = parseBoolean(disabledRaw);
    const backendEntry = firstEnvValue(env, ['RATE_LIMIT_BACKEND', 'RATE_LIMIT_STORE']);
    const checks = [];

    if (disabled === true) {
        checks.push(production
            ? invalidCheck('rate_limit', 'persistent-disabled', '生产环境禁止 DISABLE_PERSISTENT_RATE_LIMITS=true。', { env_name: 'DISABLE_PERSISTENT_RATE_LIMITS' })
            : warningCheck('rate_limit', 'persistent-disabled', '持久化限流已禁用（仅适用于本地/测试）。', { env_name: 'DISABLE_PERSISTENT_RATE_LIMITS', severity: 'low' }));
    } else if (disabled === null && disabledRaw) {
        checks.push(invalidCheck('rate_limit', 'persistent-disabled', 'DISABLE_PERSISTENT_RATE_LIMITS 必须是布尔值。', { env_name: 'DISABLE_PERSISTENT_RATE_LIMITS' }));
    } else {
        checks.push(buildCheck('rate_limit', 'persistent-disabled', true, disabled === false ? 'enabled' : 'default', '未检测到禁用持久化限流的配置。', {
            env_name: 'DISABLE_PERSISTENT_RATE_LIMITS',
            blocking: false,
            severity: 'info'
        }));
    }

    if (!backendEntry.value) {
        checks.push(manualCheck('rate_limit', 'persistent-backend', '未显式指定限流后端；运行时默认尝试 Supabase 持久化 RPC，必须在目标数据库确认 take_rate_limit_tokens 可用。', {
            env_name: 'RATE_LIMIT_BACKEND,RATE_LIMIT_STORE'
        }));
    } else {
        const backend = backendEntry.value.toLowerCase();
        if (MEMORY_RATE_LIMIT_BACKENDS.has(backend)) {
            checks.push(production
                ? invalidCheck('rate_limit', 'persistent-backend', `生产环境不能使用内存限流后端 ${backend}。`, { env_name: backendEntry.name, observed: backend })
                : warningCheck('rate_limit', 'persistent-backend', `当前使用内存限流后端 ${backend}（仅适用于本地/测试）。`, { env_name: backendEntry.name, observed: backend, severity: 'low' }));
        } else if (!PERSISTENT_RATE_LIMIT_BACKENDS.has(backend)) {
            checks.push(production
                ? invalidCheck('rate_limit', 'persistent-backend', `无法识别的限流后端 ${backend}；生产必须明确使用持久化实现。`, { env_name: backendEntry.name, observed: backend })
                : warningCheck('rate_limit', 'persistent-backend', `无法识别的限流后端 ${backend}，请人工确认不会回退到内存。`, { env_name: backendEntry.name, observed: backend, severity: 'low' }));
        } else {
            checks.push(buildCheck('rate_limit', 'persistent-backend', true, 'configured', `已配置持久化限流后端 ${backend}；仍需确认对应 RPC/存储可用。`, {
                env_name: backendEntry.name,
                observed: backend,
                blocking: false,
                severity: 'info'
            }));
        }
    }

    checks.push(manualCheck('rate_limit', 'persistent-rpc', '必须在目标 Supabase 中确认 take_rate_limit_tokens RPC、权限和持久化表已存在；本脚本不连接数据库。', {
        rpc_name: 'take_rate_limit_tokens'
    }));
    return checks;
}

function parseProviderList(env) {
    const entry = firstEnvValue(env, [
        'GUEST_SHOP_ENABLED_PROVIDERS',
        'GUEST_SHOP_PAYMENT_PROVIDERS',
        'GUEST_SHOP_PROVIDERS'
    ]);
    if (!entry.value) return { name: '', values: [], invalid: [] };
    const values = entry.value.split(/[\s,;]+/u).map((value) => value.trim().toLowerCase()).filter(Boolean);
    const invalid = values.filter((value) => !SUPPORTED_PROVIDERS.includes(value));
    return { name: entry.name, values: [...new Set(values)], invalid };
}

function providerActivation(env, provider) {
    const list = parseProviderList(env);
    if (list.name) {
        return { explicit: true, enabled: list.values.includes(provider), source: list.name, invalid: list.invalid };
    }
    const candidates = [
        `GUEST_SHOP_${provider.toUpperCase()}_ENABLED`,
        `GUEST_SHOP_PROVIDER_${provider.toUpperCase()}_ENABLED`
    ];
    for (const name of candidates) {
        const raw = envValue(env, name, 80);
        if (!raw) continue;
        const parsed = parseBoolean(raw);
        return { explicit: true, enabled: parsed === true, source: name, invalid: parsed === null ? [raw] : [] };
    }
    return { explicit: false, enabled: false, source: '', invalid: list.invalid };
}

function inspectCallbackUrl(env, provider, production) {
    const name = provider === 'zpay' ? 'GUEST_SHOP_ZPAY_WEBHOOK_URL' : 'GUEST_SHOP_NOWPAYMENTS_WEBHOOK_URL';
    const value = envValue(env, name, 2000);
    const expectedPath = `/api/shop/guest/webhooks/${provider}`;
    if (!value) {
        return buildCheck('provider', `${provider}-callback-url`, true, 'derived_default', `未设置 ${name}；适配器将使用 canonical origin 自动生成 ${expectedPath}，需在支付平台后台核对最终 URL。`, {
            env_name: name,
            expected_path: expectedPath,
            blocking: false,
            severity: production ? 'medium' : 'info',
            requires_manual_review: true
        });
    }
    let parsed;
    try {
        parsed = new URL(value);
    } catch (_) {
        return invalidCheck('provider', `${provider}-callback-url`, `${name} 不是有效 URL。`, { env_name: name });
    }
    const pathMatches = parsed.pathname.replace(/\/+$/u, '') === expectedPath;
    const hostAllowed = isManagedHostname(parsed.hostname) || (!production && isLocalUrl(value));
    const protocolAllowed = parsed.protocol === 'https:' && !parsed.username && !parsed.password;
    if (!protocolAllowed || !pathMatches || !hostAllowed) {
        return invalidCheck('provider', `${provider}-callback-url`, `${name} 必须是受管域名上的 HTTPS ${expectedPath} URL。`, {
            env_name: name,
            expected_path: expectedPath,
            observed_host: parsed.hostname
        });
    }
    return buildCheck('provider', `${provider}-callback-url`, true, 'configured', `${name} 已配置为 HTTPS guest webhook URL。`, {
        env_name: name,
        expected_path: expectedPath,
        host: parsed.hostname,
        blocking: false,
        severity: 'info'
    });
}

function inspectProvider(env, provider, production) {
    const activation = providerActivation(env, provider);
    const checks = [];
    if (activation.invalid.length) {
        checks.push(invalidCheck('provider', `${provider}-activation`, `游客支付 provider 配置包含未知或非法值：${activation.invalid.join(', ')}。`, {
            env_name: activation.source || 'GUEST_SHOP_ENABLED_PROVIDERS'
        }));
    }

    const secretNames = provider === 'zpay'
        ? ['ZPAY_PKEY', 'ZPAY_KEY']
        : ['NOWPAYMENTS_API_KEY', 'NOWPAYMENTS_IPN_SECRET'];
    const values = secretNames.map((name) => ({ name, value: envValue(env, name, 4096) }));
    const configuredCount = values.filter((entry) => Boolean(entry.value)).length;
    const anyPlaceholder = values.some((entry) => entry.value && looksLikePlaceholderSecret(entry.value));

    if (provider === 'zpay') {
        const pkey = values.find((entry) => entry.value)?.value || '';
        const bothAliases = values.every((entry) => entry.value);
        if (bothAliases && values[0].value !== values[1].value) {
            checks.push(invalidCheck('provider', 'zpay-secret-alias', 'ZPAY_PKEY 与 ZPAY_KEY 同时存在但不一致；请只保留一个真实密钥。', { env_name: 'ZPAY_PKEY,ZPAY_KEY' }));
        } else if (pkey && (anyPlaceholder || !secretIsStrong(pkey, 16))) {
            checks.push(invalidCheck('provider', 'zpay-secret', 'ZPay 密钥为空、占位值或强度不足。', { env_name: 'ZPAY_PKEY/ZPAY_KEY' }));
        } else if (activation.enabled && !pkey) {
            checks.push(invalidCheck('provider', 'zpay-secret', '已显式启用 ZPay，但缺少 ZPAY_PKEY（或兼容别名 ZPAY_KEY）。', { env_name: 'ZPAY_PKEY/ZPAY_KEY' }));
        } else if (pkey) {
            checks.push(buildCheck('provider', 'zpay-secret', true, 'configured', 'ZPay 密钥已配置（值已隐藏）。', { env_name: 'ZPAY_PKEY/ZPAY_KEY', blocking: false, severity: 'info' }));
        } else {
            checks.push(activation.explicit && !activation.enabled
                ? optionalCheck('provider', 'zpay-secret', 'ZPay 未启用，未配置密钥。', { env_name: 'ZPAY_PKEY/ZPAY_KEY' })
                : manualCheck('provider', 'zpay-secret', 'ZPay 是否启用由后台/数据库配置决定；请人工确认并补齐 ZPAY_PKEY。', { env_name: 'ZPAY_PKEY/ZPAY_KEY' }));
        }
    } else {
        if (configuredCount > 0 && configuredCount < values.length) {
            checks.push(invalidCheck('provider', 'nowpayments-secret-pair', 'NOWPayments_API_KEY 与 NOWPAYMENTS_IPN_SECRET 必须同时配置，不能只配置一项。', { env_name: 'NOWPAYMENTS_API_KEY,NOWPAYMENTS_IPN_SECRET' }));
        } else if (anyPlaceholder || values.some((entry) => entry.value && !secretIsStrong(entry.value, 16))) {
            checks.push(invalidCheck('provider', 'nowpayments-secret-pair', 'NOWPayments 密钥为空、占位值或强度不足。', { env_name: 'NOWPAYMENTS_API_KEY,NOWPAYMENTS_IPN_SECRET' }));
        } else if (activation.enabled && configuredCount < values.length) {
            checks.push(invalidCheck('provider', 'nowpayments-secret-pair', '已显式启用 NOWPayments，但缺少 API Key 或 IPN Secret。', { env_name: 'NOWPAYMENTS_API_KEY,NOWPAYMENTS_IPN_SECRET' }));
        } else if (configuredCount === values.length) {
            checks.push(buildCheck('provider', 'nowpayments-secret-pair', true, 'configured', 'NOWPayments API Key 与 IPN Secret 均已配置（值已隐藏）。', { env_name: 'NOWPAYMENTS_API_KEY,NOWPAYMENTS_IPN_SECRET', blocking: false, severity: 'info' }));
        } else {
            checks.push(activation.explicit && !activation.enabled
                ? optionalCheck('provider', 'nowpayments-secret-pair', 'NOWPayments 未启用，未配置密钥。', { env_name: 'NOWPAYMENTS_API_KEY,NOWPAYMENTS_IPN_SECRET' })
                : manualCheck('provider', 'nowpayments-secret-pair', 'NOWPayments 是否启用由后台/数据库配置决定；请人工确认并补齐 API Key/IPN Secret。', { env_name: 'NOWPAYMENTS_API_KEY,NOWPAYMENTS_IPN_SECRET' }));
        }

        const currencyEntry = firstEnvValue(env, ['GUEST_SHOP_NOWPAYMENTS_PAY_CURRENCY', 'NOWPAYMENTS_PAY_CURRENCY']);
        if (currencyEntry.value && currencyEntry.value.toLowerCase() !== 'usdtbsc') {
            checks.push(invalidCheck('provider', 'nowpayments-network', '游客 NOWPayments 只允许 usdtbsc（USDT-BEP20 / BNB Smart Chain）。', { env_name: currencyEntry.name, observed: currencyEntry.value.toLowerCase() }));
        } else if (currencyEntry.value) {
            checks.push(buildCheck('provider', 'nowpayments-network', true, 'configured', 'NOWPayments 游客支付网络为 usdtbsc。', { env_name: currencyEntry.name, observed: 'usdtbsc', blocking: false, severity: 'info' }));
        } else {
            checks.push(manualCheck('provider', 'nowpayments-network', '未显式设置 NOWPayments pay_currency；适配器默认 usdtbsc，但必须在后台/数据库和支付平台核对网络。', { env_name: 'NOWPAYMENTS_PAY_CURRENCY', expected: 'usdtbsc' }));
        }
        checks.push(warningCheck('provider', 'nowpayments-refund', 'NOWPayments 游客退款当前需要人工核验收款地址和出款凭证，不能把自动退款当作已就绪。', { severity: 'high', requires_manual_review: true }));
    }

    checks.push(inspectCallbackUrl(env, provider, production));

    const allowlistName = provider === 'zpay' ? 'ZPAY_WEBHOOK_ALLOWED_IPS' : 'NOWPAYMENTS_WEBHOOK_ALLOWED_IPS';
    const trustedName = provider === 'zpay' ? 'ZPAY_WEBHOOK_TRUSTED_PROXIES' : 'NOWPAYMENTS_WEBHOOK_TRUSTED_PROXIES';
    const allowlist = envValue(env, allowlistName, 2000);
    const trusted = envValue(env, trustedName, 2000);
    if (production && activation.enabled && !allowlist) {
        checks.push(provider === 'nowpayments'
            ? invalidCheck('provider', `${provider}-ip-allowlist`, `生产已启用 ${provider}，必须配置 ${allowlistName}。`, { env_name: allowlistName })
            : warningCheck('provider', `${provider}-ip-allowlist`, `未配置 ${allowlistName}；ZPay 将退回严格查单模式，建议补充最小来源 IP 白名单。`, { env_name: allowlistName, severity: 'high', requires_manual_review: true }));
    } else if (activation.enabled && allowlist) {
        checks.push(buildCheck('provider', `${provider}-ip-allowlist`, true, 'configured', `${allowlistName} 已配置（不输出具体 IP）。`, { env_name: allowlistName, blocking: false, severity: 'info' }));
    } else {
        checks.push(optionalCheck('provider', `${provider}-ip-allowlist`, `${allowlistName} 未显式配置；provider 未确认启用。`, { env_name: allowlistName }));
    }
    if (production && activation.enabled && !trusted) {
        checks.push(warningCheck('provider', `${provider}-trusted-proxies`, `建议配置 ${trustedName}，并核对反向代理链；当前脚本不猜测代理 IP。`, { env_name: trustedName, severity: 'medium', requires_manual_review: true }));
    }

    if (!activation.explicit) {
        checks.push(manualCheck('provider', `${provider}-database-activation`, `${provider} 启用状态存储在后台/数据库；本脚本未连接数据库，请确认商品 allowlist、provider enabled、PID/回调等配置。`, {
            provider,
            config_source: 'database'
        }));
    } else if (activation.enabled) {
        checks.push(buildCheck('provider', `${provider}-activation`, true, 'enabled', `${provider} 已由 ${activation.source} 显式标记启用；仍需核对数据库中的 provider 配置。`, {
            env_name: activation.source,
            provider,
            blocking: false,
            severity: 'info',
            requires_manual_review: true
        }));
    } else {
        checks.push(optionalCheck('provider', `${provider}-activation`, `${provider} 已显式关闭。`, { env_name: activation.source, provider }));
    }

    return checks;
}

function inspectRepo(repoRoot = REPO_ROOT) {
    const checks = [];
    for (const relativePath of REQUIRED_REPO_FILES) {
        const exists = fs.existsSync(path.join(repoRoot, relativePath));
        checks.push(exists
            ? buildCheck('repo', `file:${relativePath}`, true, 'present', `${relativePath} 已存在。`, { relative_path: relativePath, blocking: false, severity: 'info' })
            : invalidCheck('repo', `file:${relativePath}`, `${relativePath} 缺失。`, { relative_path: relativePath }));
    }
    for (const relativePath of REQUIRED_TEST_FILES) {
        const exists = fs.existsSync(path.join(repoRoot, relativePath));
        checks.push(exists
            ? buildCheck('repo', `test:${relativePath}`, true, 'present', `${relativePath} 已存在。`, { relative_path: relativePath, blocking: false, severity: 'info' })
            : warningCheck('repo', `test:${relativePath}`, `${relativePath} 缺失；无法确认游客回归覆盖。`, { relative_path: relativePath, severity: 'high', requires_manual_review: true }));
    }

    const read = (relativePath) => {
        try { return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'); } catch (_) { return ''; }
    };
    const router = read('api/public.js');
    checks.push(router.includes("'guest/preview'")
        && router.includes("'guest/orders'")
        && router.includes("'guest/status'")
        && router.includes("'guest/recover'")
        && router.includes("'guest/claim'")
        && router.includes("'guest/webhooks/zpay'")
        && router.includes("'guest/webhooks/nowpayments'")
        ? buildCheck('repo', 'guest-routes-registered', true, 'present', '游客 preview/order/status/recover/claim 与 provider webhook 路由均已注册。', { blocking: false, severity: 'info' })
        : invalidCheck('repo', 'guest-routes-registered', 'api/public.js 未完整注册游客路由。'));

    const handler = read('server/api-handlers/public/guest-shop.js');
    checks.push(handler.includes('fn_guest_shop_create_order')
        && handler.includes('fn_guest_shop_confirm_payment')
        && handler.includes('readRawBodyWithLimit')
        && handler.includes('paymentAdapter')
        ? buildCheck('repo', 'guest-handler-security-boundary', true, 'present', '游客 handler 使用原子 RPC、原始 body 限制和独立 payment adapter。', { blocking: false, severity: 'info' })
        : invalidCheck('repo', 'guest-handler-security-boundary', '游客 handler 缺少独立支付/原始 body/原子 RPC 安全边界。'));

    const worker = read('server/guest-shop-worker.js');
    checks.push(worker.includes('fn_guest_shop_claim_fulfillment')
        && worker.includes('fn_guest_shop_release_expired_reservations')
        && worker.includes('GUEST_SHOP_WORKER_SECRET')
        ? buildCheck('repo', 'guest-worker-contract', true, 'present', '游客 worker 具备租约、履约与过期释放入口。', { blocking: false, severity: 'info' })
        : invalidCheck('repo', 'guest-worker-contract', '游客 worker 契约不完整。'));

    const adapter = read('api/_lib/payments/guest-shop-adapter.js');
    checks.push(adapter.includes("GUEST_PURPOSE = 'shop_direct'")
        && adapter.includes('NOWPAYMENTS_GUEST_PAY_CURRENCY')
        && adapter.includes('verifyGuestWebhook')
        ? buildCheck('repo', 'guest-payment-adapter-contract', true, 'present', '游客支付 adapter 与 shop_direct/USDT-BEP20 验证逻辑存在。', { blocking: false, severity: 'info' })
        : invalidCheck('repo', 'guest-payment-adapter-contract', '游客支付 adapter 契约不完整。'));

    let readinessScript = '';
    try {
        readinessScript = String(JSON.parse(read('package.json')).scripts['readiness:guest-shop'] || '').trim();
    } catch (_) {
        readinessScript = '';
    }
    checks.push(readinessScript === 'node -- scripts/guest-shop-readiness.js'
        ? buildCheck('repo', 'guest-readiness-npm-script', true, 'present', 'readiness:guest-shop 使用 node -- 转发参数，避免 Node 25 把闸门参数当成运行时选项。', { blocking: false, severity: 'info' })
        : invalidCheck('repo', 'guest-readiness-npm-script', 'package.json 的 readiness:guest-shop 必须是 node -- scripts/guest-shop-readiness.js。'));

    return checks;
}

function inspectRunbook(repoRoot = REPO_ROOT) {
    const relativePath = 'docs/guest-shop-payment-fulfillment-runbook.md';
    let source = '';
    try { source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'); } catch (_) { return [invalidCheck('docs', 'runbook', '游客支付运行手册缺失。', { relative_path: relativePath })]; }
    const requirements = [
        ['worker-endpoint', /\/api\/shop\/guest\/worker/i, 'worker endpoint'],
        ['worker-schedule', /cron|systemd|scheduler|调度|每分钟|1 分钟|1分钟/i, 'worker schedule'],
        ['worker-secret', /GUEST_SHOP_WORKER_SECRET/i, 'dedicated worker secret'],
        ['provider-console', /ZPay|NOWPayments|支付平台|控制台/i, 'provider console callback configuration'],
        ['nowpayments-manual-refund', /NOWPayments[\s\S]{0,240}(人工|手工|manual)[\s\S]{0,240}退款/i, 'NOWPayments manual refund'],
        ['dead-letter-alert', /dead[_ -]?letter|死信/i, 'dead-letter alert'],
        ['readiness-command', /readiness:guest-shop|guest-shop-readiness/i, 'readiness command'],
        ['readiness-strict-gate', /--fail-on-not-ready/i, 'strict readiness gate'],
        ['deploy-enable-separation', /发布不等于启用|不得打开游客商品|关闭游客/i, 'deploy does not enable guest products'],
        ['env-file-recreate', /docker compose up -d --no-deps --force-recreate --no-build verify-server/i, 'verify-server env_file recreate after secret changes'],
        ['no-docker-restart-reload', /docker restart[\s\S]{0,80}(不会重读|不会重新读取|does not reread|will not reread)/i, 'docker restart does not reload env_file'],
        ['stored-secret-preferred', /resolvePaymentProviderSecrets/i, 'payment stored secret preferred over env']
    ];
    return requirements.map(([key, pattern, label]) => pattern.test(source)
        ? buildCheck('docs', `runbook:${key}`, true, 'documented', `运行手册已说明 ${label}。`, { relative_path: relativePath, blocking: false, severity: 'info' })
        : invalidCheck('docs', `runbook:${key}`, `运行手册缺少 ${label} 说明。`, { relative_path: relativePath }));
}

function inspectProductionCallbacks(env, production) {
    const checks = [];
    const baseEntry = firstEnvValue(env, ['APP_BASE_URL']);
    if (!baseEntry.value) {
        checks.push(production
            ? manualCheck('callback', 'app-base-url', '未显式设置 APP_BASE_URL；请核对生产 canonical origin 与两个站点回调地址。', { env_name: 'APP_BASE_URL' })
            : optionalCheck('callback', 'app-base-url', '未设置 APP_BASE_URL（非生产环境）。', { env_name: 'APP_BASE_URL' }));
    } else if (!isHttpsUrl(baseEntry.value) || (!isManagedHostname(new URL(baseEntry.value).hostname) && production)) {
        checks.push(invalidCheck('callback', 'app-base-url', '生产 APP_BASE_URL 必须是受管域名上的 HTTPS URL。', { env_name: 'APP_BASE_URL' }));
    } else {
        checks.push(buildCheck('callback', 'app-base-url', true, 'configured', 'APP_BASE_URL 使用受管 HTTPS origin。', { env_name: 'APP_BASE_URL', host: new URL(baseEntry.value).hostname, blocking: false, severity: 'info' }));
    }
    return checks;
}

function runReadiness({ env = process.env, repoRoot = REPO_ROOT, envFile = '', now = new Date() } = {}) {
    const production = isProductionLikeRuntime(env);
    const checks = [
        inspectEnvFile(envFile, env),
        inspectRuntime(env),
        ...inspectSupabase(env, production),
        ...inspectGuestSecrets(env, production),
        inspectWorkerSecret(env, production),
        ...inspectPersistentRateLimit(env, production),
        ...inspectLimits(env, production),
        ...inspectProductionCallbacks(env, production),
        ...SUPPORTED_PROVIDERS.flatMap((provider) => inspectProvider(env, provider, production)),
        ...inspectRepo(repoRoot),
        ...inspectRunbook(repoRoot)
    ];

    const blockingChecks = checks.filter((check) => check.blocking === true && check.ok !== true);
    const warnings = checks.filter((check) => check.status === 'warning');
    const manualReview = checks.filter((check) => check.requires_manual_review === true);
    const findings = blockingChecks.map((check) => ({
        severity: check.severity || 'high',
        key: check.key,
        message: check.message,
        area: check.area,
        env_name: check.env_name || ''
    }));

    const checkedAt = now instanceof Date && Number.isFinite(now.getTime()) ? now.toISOString() : new Date().toISOString();
    return {
        checked_at: checkedAt,
        production_like: production,
        providers: SUPPORTED_PROVIDERS,
        checks,
        findings,
        warnings: warnings.map((check) => ({ key: check.key, message: check.message, severity: check.severity, area: check.area })),
        manual_review: manualReview.map((check) => ({ key: check.key, message: check.message, area: check.area })),
        invalid_count: blockingChecks.length,
        warning_count: warnings.length,
        manual_review_count: manualReview.length,
        // `ok` means automated checks found no hard-invalid values. `ready`
        // additionally requires a production marker and completion of all
        // operator/database checks, which cannot be proven offline.
        ok: blockingChecks.length === 0,
        ready: production && blockingChecks.length === 0 && manualReview.length === 0
    };
}

function formatHumanReport(summary = {}) {
    const lines = [
        'Guest Shop Production Readiness',
        '',
        `checked_at: ${summary.checked_at || ''}`,
        `production_like: ${summary.production_like === true ? 'true' : 'false'}`,
        ''
    ];
    for (const check of summary.checks || []) {
        const marker = check.ok ? (check.status === 'warning' || check.status === 'manual_review' ? '[WARN]' : '[OK]') : '[FAIL]';
        lines.push(`${marker} ${check.area}/${check.key}: ${check.message}`);
    }
    lines.push('');
    lines.push(summary.findings?.length ? 'findings:' : 'findings: none');
    for (const finding of summary.findings || []) {
        lines.push(`- [${finding.severity}] ${finding.key}: ${finding.message}`);
    }
    lines.push('');
    lines.push(`result: ${summary.ok === true ? 'PASS (automated)' : 'FAIL'}`);
    lines.push(`operational_ready: ${summary.ready === true ? 'true' : 'false; complete manual/database checks before enabling guest products'}`);
    lines.push(`manual_review_count: ${Number(summary.manual_review_count) || 0}`);
    return lines.join('\n');
}

/**
 * Resolve the process exit code for the optional strict CLI gates.
 *
 * `ok` only describes hard-invalid automated findings.  `ready` is the
 * stronger launch invariant and also requires a production marker plus zero
 * manual/database review items.  Preserve the historical code 2 for the
 * explicit `--fail-on-invalid` gate; code 3 identifies a strict readiness
 * failure when no hard-invalid finding took precedence.
 */
function getReadinessExitCode(options = {}, summary = {}) {
    if (options.failOnInvalid === true && summary.ok !== true) {
        return READINESS_EXIT_CODES.INVALID;
    }
    if (options.failOnNotReady === true && summary.ready !== true) {
        return READINESS_EXIT_CODES.NOT_READY;
    }
    return 0;
}

function main() {
    const options = parseArgs(process.argv.slice(2));
    const env = loadEnvFile(options.envFile, process.env);
    const summary = runReadiness({ env, repoRoot: REPO_ROOT, envFile: options.envFile });
    process.stdout.write(`${options.json ? JSON.stringify(summary, null, 2) : formatHumanReport(summary)}\n`);
    const exitCode = getReadinessExitCode(options, summary);
    if (exitCode > 0) process.exitCode = exitCode;
}

if (require.main === module) {
    try {
        main();
    } catch (error) {
        // Do not echo arbitrary parser/env contents; only expose a generic
        // failure line suitable for CI logs.
        console.error(`guest-shop-readiness failed: ${error?.message || 'unknown error'}`);
        process.exitCode = 1;
    }
}

module.exports = {
    DEFAULT_ENV_FILE,
    READINESS_EXIT_CODES,
    REQUIRED_REPO_FILES,
    REQUIRED_TEST_FILES,
    SUPPORTED_PROVIDERS,
    formatHumanReport,
    getReadinessExitCode,
    inspectCallbackUrl,
    inspectGuestSecrets,
    inspectLimits,
    inspectPersistentRateLimit,
    inspectProductionCallbacks,
    inspectProvider,
    inspectRepo,
    inspectRunbook,
    inspectSupabase,
    inspectWorkerSecret,
    isProductionLikeRuntime,
    loadEnvFile,
    parseArgs,
    parseProviderList,
    runReadiness
};
