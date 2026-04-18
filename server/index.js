/**
 * Google One User API Proxy Server
 * Proxies requests to the upstream Google One job API
 * Handles Supabase auth + points deduction
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const {
    getPaymentProviderAdapter,
    normalizePointValue,
    roundCurrencyAmount: roundPaymentCurrencyAmount,
    amountsMatch: paymentAmountsMatch
} = require('../api/_lib/payments/provider-adapters');
const {
    reconcileCheckoutSessionForPaymentOrder,
    resolvePendingPaymentOrderFromCheckoutContext,
    sanitizeSite,
    verifyCustomRechargeQuoteToken,
    verifyPaymentIntentClaimToken
} = require('../api/_lib/payments/orders');
const {
    getHupijiaoGatewayOrderId,
    normalizeHupijiaoPaymentStatus,
    parseHupijiaoAttach
} = require('../api/_lib/payments/hupijiao');
const {
    createZpayWebhookHandler
} = require('../api/_lib/payments/zpay-webhook');
const {
    maybeIssueAffiliateDiscountAssetsForRecharge,
    maybeIssueRechargeDiscountAssets
} = require('../api/_lib/discount-trigger-linkage');
const {
    deriveHupijiaoPointBreakdown
} = require('../api/_lib/payments/hupijiao-points');
const {
    deductPointsForService,
    finalizeAfdianCustomPayment,
    getUserBalance,
    processAfdianPayment,
    rechargePointsForPayment
} = require('../api/_lib/payments/rpc');
const {
    loadShopDeliveryStrategyConfig,
    normalizeShopDeliveryStrategyConfig
} = require('../api/_lib/payments/shop-delivery-strategy');
const {
    hasVerifyMonitorInternalAccess
} = require('../api/_lib/verify-monitor-internal-access');
const {
    applyRateLimitHeaders,
    explainClientIpResolution,
    isIpAllowed,
    resolveClientIp,
    splitIpRules,
    takeRateLimitToken
} = require('../api/_lib/request-security');
const {
    loadOpsAlertsRuntimeConfig,
    sweepOpsAlertJobs
} = require('../api/_lib/ops-alerts');
const {
    normalizePaymentConfigChangeMonitorConfig,
    runPaymentConfigChangedSweep
} = require('../api/_lib/payment-config-change-alerts');
const {
    normalizePaymentGatewayMonitorConfig,
    runPaymentGatewayDegradationSweep
} = require('../api/_lib/payment-gateway-alerts');
const {
    normalizeVerifyQuotaMonitorConfig,
    runVerifyQuotaLowSweep
} = require('../api/_lib/verify-quota-alerts');
const {
    normalizeVerifyServiceMonitorConfig,
    runVerifyServiceDisabledSweep
} = require('../api/_lib/verify-service-alerts');
const {
    normalizeVerifyQueueMonitorConfig,
    runVerifyQueueBacklogSweep
} = require('../api/_lib/verify-queue-alerts');
const {
    normalizeVerifyFailureMonitorConfig,
    runVerifyFailureRateSpikeSweep
} = require('../api/_lib/verify-failure-alerts');
const {
    normalizeVerifyIncidentMonitorConfig,
    runVerifyIncidentEscalationSweep
} = require('../api/_lib/verify-incident-alerts');
const {
    normalizeTicketSlaMonitorConfig,
    runTicketSlaOverdueSweep
} = require('../api/_lib/ticket-sla-alerts');
const {
    normalizeShopInventoryMonitorConfig,
    runShopInventoryLowSweep
} = require('../api/_lib/shop-inventory-alerts');
const {
    normalizeShopOrderDeliveryMonitorConfig,
    runShopOrderDeliveryFailedSweep
} = require('../api/_lib/shop-order-delivery-alerts');
const {
    normalizeShopOrderRiskMonitorConfig,
    runShopOrderRiskSweep
} = require('../api/_lib/shop-order-risk-alerts');
const {
    normalizeAdminLoginAnomalyMonitorConfig,
    runAdminLoginAnomalySweep
} = require('../api/_lib/admin-login-anomaly-alerts');
const {
    normalizeChatMessageMonitorConfig,
    runCustomerChatMessageSweep
} = require('../api/_lib/chat-message-alerts');
const {
    normalizeCommerceSuccessMonitorConfig,
    runCommerceSuccessSweep
} = require('../api/_lib/commerce-success-alerts');

const app = express();
const PORT = process.env.PORT || 3001;

// Upstream API base URL
const DEFAULT_VERIFY_API_BASE_URL = 'https://aidone.lol';
const VERIFY_API_BASE = process.env.VERIFY_API_BASE_URL || DEFAULT_VERIFY_API_BASE_URL;
const HEALTHCHECK_UPSTREAM_TIMEOUT_MS = Math.max(1000, Number(process.env.HEALTHCHECK_UPSTREAM_TIMEOUT_MS || 5000));
const ACTIVE_TRACKED_JOB_STATUSES = ['queued', 'running', 'processing', 'pending'];
const TERMINAL_TRACKED_JOB_STATUSES = ['success', 'failed'];
const DEFAULT_VERIFY_TASK_TYPE = 'extract';
const VERIFY_TASK_UNIT_COSTS = Object.freeze({
    extract: 0.5,
    full: 1
});
const PENDING_JOB_SWEEP_INTERVAL_MS = Math.max(2000, Number(process.env.VERIFY_PENDING_SWEEP_INTERVAL_MS || 5000));
const PENDING_JOB_SWEEP_BATCH_SIZE = Math.max(1, Number(process.env.VERIFY_PENDING_SWEEP_BATCH_SIZE || 20));
const SHOP_DELIVERY_STRATEGY_CACHE_TTL_MS = Math.max(2000, Number(process.env.SHOP_DELIVERY_STRATEGY_CACHE_TTL_MS || 5000));
const jobSyncLocks = new Map();
let pendingJobSweepTimer = null;
let pendingJobSweepRunning = false;
let shopDeliverySweepTimer = null;
let shopDeliverySweepRunning = false;
let opsAlertSweepTimer = null;
let opsAlertSweepRunning = false;
let paymentConfigChangeSweepTimer = null;
let paymentConfigChangeSweepRunning = false;
let paymentGatewaySweepTimer = null;
let paymentGatewaySweepRunning = false;
let verifyQuotaSweepTimer = null;
let verifyQuotaSweepRunning = false;
let verifyServiceSweepTimer = null;
let verifyServiceSweepRunning = false;
let verifyQueueSweepTimer = null;
let verifyQueueSweepRunning = false;
let verifyFailureSweepTimer = null;
let verifyFailureSweepRunning = false;
let verifyIncidentSweepTimer = null;
let verifyIncidentSweepRunning = false;
let ticketSlaSweepTimer = null;
let ticketSlaSweepRunning = false;
let shopInventorySweepTimer = null;
let shopInventorySweepRunning = false;
let shopOrderDeliverySweepTimer = null;
let shopOrderDeliverySweepRunning = false;
let shopOrderRiskSweepTimer = null;
let shopOrderRiskSweepRunning = false;
let adminLoginAnomalySweepTimer = null;
let adminLoginAnomalySweepRunning = false;
let customerChatMessageSweepTimer = null;
let customerChatMessageSweepRunning = false;
let shopPurchaseSuccessSweepTimer = null;
let shopPurchaseSuccessSweepRunning = false;
let walletRechargeSuccessSweepTimer = null;
let walletRechargeSuccessSweepRunning = false;
let cachedShopDeliveryStrategy = null;
let cachedShopDeliveryStrategyAt = 0;
const afdianProvider = getPaymentProviderAdapter('afdian');
const hupijiaoProvider = getPaymentProviderAdapter('hupijiao');

// Initialize Supabase
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);
const zpayWebhookHandler = createZpayWebhookHandler({
    supabase,
    env: process.env
});

// Middleware — merge env var origins WITH code defaults (env var alone used to override defaults)
const defaultOrigins = [
    'http://localhost:8000',
    'http://127.0.0.1:8000',
    'https://zaoyoe.com',
    'https://www.zaoyoe.com',
    'https://zaoyoe.xyz',
    'https://www.zaoyoe.xyz'
];
const envOrigins = process.env.ALLOWED_ORIGINS?.split(',').map(s => s.trim()) || [];
const allOrigins = [...new Set([...defaultOrigins, ...envOrigins])];
app.use(cors({
    origin: allOrigins,
    credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

function getLocalHealthPayload() {
    return {
        status: 'ok',
        service: 'verify-proxy-server',
        port: Number(PORT),
        uptime_seconds: Math.round(process.uptime()),
        timestamp: new Date().toISOString()
    };
}

async function probeUpstreamHealth() {
    try {
        const config = await getVerifyConfig();
        const upstreamUrl = normalizeVerifyApiBaseUrl(config.apiBaseUrl || VERIFY_API_BASE);

        if (!upstreamUrl || !config.apiKey) {
            return {
                ok: false,
                status: 503,
                url: upstreamUrl || null,
                payload: null,
                error: 'verify_provider_not_configured'
            };
        }

        const upstream = await postVerifyProviderAction(config, {
            action: 'get_balance',
            cdkey: config.apiKey
        }, {
            timeoutMs: HEALTHCHECK_UPSTREAM_TIMEOUT_MS
        });

        return {
            ok: upstream.ok,
            status: upstream.status || (upstream.ok ? 200 : 503),
            url: upstreamUrl,
            payload: upstream.payload
        };
    } catch (error) {
        return {
            ok: false,
            status: 503,
            url: normalizeVerifyApiBaseUrl(VERIFY_API_BASE),
            payload: null,
            error: error.message
        };
    }
}

function buildUpstreamHealthResponse(result = {}) {
    const base = getLocalHealthPayload();
    const statusCode = Number(result.status || 503);
    const payload = {
        ...base,
        status: result.ok ? 'ok' : 'degraded',
        upstream: {
            status: result.ok ? 'ok' : 'unavailable',
            http_status: statusCode,
            url: result.url || null,
            error: result.error || null,
            response: result.payload
        }
    };

    return {
        statusCode,
        payload
    };
}

// Liveness check for Railway/container healthchecks.
app.get('/healthz', (req, res) => {
    return res.json(getLocalHealthPayload());
});

// Readiness check for upstream dependency visibility.
app.get('/ready', async (req, res) => {
    const result = await probeUpstreamHealth();
    const response = buildUpstreamHealthResponse(result);
    return res.status(response.statusCode).json(response.payload);
});

// Backward-compatible upstream-aware health check.
app.get('/health', async (req, res) => {
    const result = await probeUpstreamHealth();
    const response = buildUpstreamHealthResponse(result);
    return res.status(response.statusCode).json(response.payload);
});

// =============================================
// Helpers
// =============================================
async function getVerifyConfig() {
    const { data: configData } = await supabase
        .from('system_config')
        .select('config_value')
        .eq('config_key', 'verify_settings')
        .single();

    const config = configData?.config_value || {};
    const prices = getVerifyPriceMap(config);
    const apiKeys = normalizeVerifyCredentialList([
        ...(Array.isArray(config.verify_cdkeys) ? config.verify_cdkeys : []),
        config.verify_cdkey,
        config.verify_api_key,
        process.env.VERIFY_CDKEYS,
        process.env.VERIFY_CDKEY,
        process.env.VERIFY_API_KEY,
        process.env.VERIFY_API_TOKEN
    ]);

    return {
        pricePerVerify: prices.extract,
        pricePerVerifyExtract: prices.extract,
        pricePerVerifyFull: prices.full,
        apiKey: apiKeys[0] || '',
        apiKeys,
        keyCount: apiKeys.length,
        apiBaseUrl: normalizeVerifyApiBaseUrl(
            config.verify_api_base_url
            || process.env.VERIFY_API_BASE_URL
            || VERIFY_API_BASE
        ),
        monitorConfig: config.verify_quota_monitor && typeof config.verify_quota_monitor === 'object'
            ? config.verify_quota_monitor
            : {},
        serviceMonitorConfig: config.verify_service_monitor && typeof config.verify_service_monitor === 'object'
            ? config.verify_service_monitor
            : {},
        queueMonitorConfig: config.verify_queue_monitor && typeof config.verify_queue_monitor === 'object'
            ? config.verify_queue_monitor
            : {},
        failureMonitorConfig: config.verify_failure_monitor && typeof config.verify_failure_monitor === 'object'
            ? config.verify_failure_monitor
            : {},
        incidentMonitorConfig: config.verify_incident_monitor && typeof config.verify_incident_monitor === 'object'
            ? config.verify_incident_monitor
            : {}
    };
}

function getCurrentSite(req, explicitSite) {
    if (explicitSite) {
        return sanitizeSite(explicitSite);
    }

    const requestHints = [
        req?.headers?.origin,
        req?.headers?.referer,
        req?.headers?.['x-forwarded-host'],
        req?.headers?.host,
        req?.hostname
    ];

    for (const hint of requestHints) {
        const normalizedHint = String(hint || '').trim().toLowerCase();
        if (!normalizedHint) continue;
        if (normalizedHint.includes('zaoyoe.xyz')) return 'intl';
        if (normalizedHint.includes('zaoyoe.com')) return 'cn';
    }

    return 'cn';
}

function sanitizeResolvedPaymentSite(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized === 'cn' || normalized === 'intl' ? normalized : '';
}

function isProductionLikeRuntime(env = process.env) {
    const vercelEnv = String(env?.VERCEL_ENV || '').trim().toLowerCase();
    const railwayEnv = String(env?.RAILWAY_ENVIRONMENT_NAME || '').trim().toLowerCase();
    const deploymentTier = String(env?.DEPLOYMENT_TIER || env?.APP_ENV || '').trim().toLowerCase();

    return vercelEnv === 'production'
        || railwayEnv === 'production'
        || deploymentTier === 'production';
}

function resolveRequestClientIp(req, options = {}) {
    return resolveClientIp(req, {
        env: process.env,
        trustedProxies: options.trustedProxies
    });
}

function getAfdianWebhookTrustedProxies() {
    return process.env.AFDIAN_WEBHOOK_TRUSTED_PROXIES
        || process.env.TRUSTED_PROXY_IPS
        || process.env.TRUSTED_PROXY_CIDRS
        || '';
}

function getHupijiaoWebhookTrustedProxies() {
    return process.env.HUPIJIAO_WEBHOOK_TRUSTED_PROXIES
        || process.env.TRUSTED_PROXY_IPS
        || process.env.TRUSTED_PROXY_CIDRS
        || '';
}

function getZpayWebhookTrustedProxies() {
    return process.env.ZPAY_WEBHOOK_TRUSTED_PROXIES
        || process.env.TRUSTED_PROXY_IPS
        || process.env.TRUSTED_PROXY_CIDRS
        || '';
}

async function applyRequestRateLimit(req, res, {
    keyPrefix,
    limit,
    windowMs,
    trustedProxies = ''
}) {
    const clientIp = resolveRequestClientIp(req, { trustedProxies });
    const rateLimit = await takeRateLimitToken({
        supabase,
        env: process.env,
        key: `${keyPrefix}:${clientIp || 'unknown'}`,
        limit,
        windowMs
    });

    applyRateLimitHeaders(res, rateLimit);

    return {
        clientIp,
        rateLimit
    };
}

function getForwardingHeaderSnapshot(req) {
    const headers = req?.headers || {};
    const snapshot = {};

    for (const headerName of [
        'cf-connecting-ip',
        'x-real-ip',
        'true-client-ip',
        'x-forwarded-for',
        'forwarded'
    ]) {
        const value = String(headers[headerName] || '').trim();
        if (value) {
            snapshot[headerName] = value;
        }
    }

    return snapshot;
}

function buildRequestNetworkContext(req, {
    trustedProxies = '',
    allowedIps = ''
} = {}) {
    const diagnostic = explainClientIpResolution(req, {
        env: process.env,
        trustedProxies
    });
    const normalizedAllowedIps = splitIpRules(allowedIps);

    return {
        host: getRequestHostName(req) || null,
        forwarding_headers: getForwardingHeaderSnapshot(req),
        socket_ip: diagnostic.socketIp || null,
        forwarded_ips: diagnostic.forwardedIps,
        resolved_client_ip: diagnostic.resolvedClientIp || null,
        trusted_proxies: diagnostic.trustedProxies,
        trust_all_proxies: diagnostic.trustAllProxies,
        direct_peer_trusted: diagnostic.directPeerTrusted,
        direct_peer_trust_reason: diagnostic.directPeerTrustReason,
        used_forwarded_chain: diagnostic.usedForwardedChain,
        allowlist_rules: normalizedAllowedIps,
        allowlist_configured: normalizedAllowedIps.length > 0,
        would_pass_allowlist: !normalizedAllowedIps.length
            || Boolean(diagnostic.resolvedClientIp && isIpAllowed(diagnostic.resolvedClientIp, normalizedAllowedIps))
    };
}

function buildNetworkDiagnosticFindings({ appContext, webhookContext }) {
    const findings = [];

    if (!appContext.trust_all_proxies && !appContext.trusted_proxies.length && !webhookContext.trusted_proxies.length) {
        findings.push({
            severity: 'high',
            code: 'proxy_trust_chain_missing',
            message: 'Missing TRUSTED_PROXY_IPS / AFDIAN_WEBHOOK_TRUSTED_PROXIES; Railway ingress proxy headers cannot be verified yet.'
        });
    }

    if (
        appContext.forwarded_ips.length
        && appContext.trusted_proxies.length
        && !appContext.trust_all_proxies
        && !appContext.direct_peer_trusted
        && appContext.socket_ip
    ) {
        findings.push({
            severity: 'high',
            code: 'proxy_trust_chain_mismatch',
            message: `Configured TRUSTED_PROXY_IPS do not match the current Railway peer ${appContext.socket_ip}; update the proxy allowlist to include the latest ingress IPs.`
        });
    }

    if (
        webhookContext.forwarded_ips.length
        && webhookContext.trusted_proxies.length
        && !webhookContext.trust_all_proxies
        && !webhookContext.direct_peer_trusted
        && webhookContext.socket_ip
    ) {
        findings.push({
            severity: 'high',
            code: 'afdian_webhook_proxy_trust_mismatch',
            message: `Configured AFDIAN_WEBHOOK_TRUSTED_PROXIES do not match the current Railway peer ${webhookContext.socket_ip}; webhook source IPs cannot be resolved until this is updated.`
        });
    }

    if (!webhookContext.allowlist_configured) {
        findings.push({
            severity: 'high',
            code: 'afdian_webhook_allowlist_missing',
            message: 'Missing AFDIAN_WEBHOOK_ALLOWED_IPS; webhook source IP filtering is not fully enabled.'
        });
    }

    if (!appContext.forwarded_ips.length) {
        findings.push({
            severity: 'info',
            code: 'forwarded_headers_absent',
            message: 'No forwarded client IP headers were observed on this request.'
        });
    }

    if (webhookContext.allowlist_configured && !webhookContext.would_pass_allowlist) {
        findings.push({
            severity: 'info',
            code: 'current_request_not_in_webhook_allowlist',
            message: 'This admin/browser request does not match AFDIAN_WEBHOOK_ALLOWED_IPS. Use Railway webhook logs to validate the real Afdian source IPs.'
        });
    }

    return findings;
}

function getApiErrorDetail(payload) {
    if (!payload || typeof payload !== 'object') return null;
    return (payload.detail && typeof payload.detail === 'object') ? payload.detail : null;
}

function getApiErrorCode(payload) {
    const detail = getApiErrorDetail(payload);
    return detail?.code || payload?.code || payload?.error || '';
}

function getApiErrorMessage(payload, fallback) {
    const detail = getApiErrorDetail(payload);
    return detail?.message || payload?.message || payload?.error || fallback;
}

function normalizeVerifyApiBaseUrl(value) {
    const normalized = String(value || '').trim().replace(/\/+$/, '');
    if (!normalized) return '';
    return /\/openapi$/i.test(normalized) ? normalized : `${normalized}/openapi`;
}

function normalizeVerifyTaskType(value, fallback = DEFAULT_VERIFY_TASK_TYPE) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'full') return 'full';
    if (normalized === 'extract') return 'extract';
    return fallback;
}

function getVerifyPriceMap(config = {}) {
    const legacyPrice = Math.max(1, Number(config.pricePerVerify || config.price_per_verify) || 10);
    const extractPrice = Math.max(
        1,
        Number(config.pricePerVerifyExtract || config.price_per_verify_extract || legacyPrice) || legacyPrice
    );
    const fullFallback = Math.max(extractPrice, Math.round(extractPrice * 2));
    const fullPrice = Math.max(
        1,
        Number(config.pricePerVerifyFull || config.price_per_verify_full || fullFallback) || fullFallback
    );

    return {
        extract: extractPrice,
        full: fullPrice
    };
}

function getVerifyPriceForTaskType(config = {}, taskType = DEFAULT_VERIFY_TASK_TYPE) {
    const prices = getVerifyPriceMap(config);
    return normalizeVerifyTaskType(taskType) === 'full' ? prices.full : prices.extract;
}

function getVerifyUnitCost(taskType = DEFAULT_VERIFY_TASK_TYPE) {
    return VERIFY_TASK_UNIT_COSTS[normalizeVerifyTaskType(taskType)] || VERIFY_TASK_UNIT_COSTS.extract;
}

function getVerifyRemainingTaskCount(remainingUses, taskType = DEFAULT_VERIFY_TASK_TYPE) {
    const numericRemainingUses = Number(remainingUses);
    const unitCost = getVerifyUnitCost(taskType);
    if (!Number.isFinite(numericRemainingUses) || !Number.isFinite(unitCost) || unitCost <= 0) {
        return 0;
    }

    return Math.max(0, Math.floor((numericRemainingUses + 1e-9) / unitCost));
}

function buildVerifyUsageSummary(remainingUses) {
    const numericRemainingUses = Number(remainingUses);
    const safeRemainingUses = Number.isFinite(numericRemainingUses)
        ? Math.max(0, Math.round(numericRemainingUses * 100) / 100)
        : 0;

    return {
        remaining_uses: safeRemainingUses,
        extract_cost_per_job: getVerifyUnitCost('extract'),
        full_cost_per_job: getVerifyUnitCost('full'),
        remaining_extract_jobs: getVerifyRemainingTaskCount(safeRemainingUses, 'extract'),
        remaining_full_jobs: getVerifyRemainingTaskCount(safeRemainingUses, 'full')
    };
}

function normalizeVerifyCredentialList(value) {
    const queue = Array.isArray(value) ? [...value] : [value];
    const normalizedValues = [];
    const seen = new Set();

    while (queue.length) {
        const current = queue.shift();
        if (Array.isArray(current)) {
            queue.unshift(...current);
            continue;
        }

        String(current || '')
            .split(/[\n,;]+/)
            .map((entry) => String(entry || '').trim())
            .filter(Boolean)
            .forEach((entry) => {
                if (seen.has(entry)) return;
                seen.add(entry);
                normalizedValues.push(entry);
            });
    }

    return normalizedValues;
}

function maskVerifyCredential(value) {
    const normalized = String(value || '').trim();
    if (!normalized) return '';
    if (normalized.length <= 8) return normalized;
    return `${normalized.slice(0, 4)}...${normalized.slice(-4)}`;
}

function buildVerifyCredentialFingerprint(value) {
    const normalized = String(value || '').trim();
    if (!normalized) return '';
    return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

function resolveVerifyApiKeyByFingerprint(config = {}, fingerprint = '') {
    const normalizedFingerprint = String(fingerprint || '').trim();
    if (!normalizedFingerprint) return '';

    return normalizeVerifyCredentialList(config.apiKeys || config.apiKey)
        .find((candidate) => buildVerifyCredentialFingerprint(candidate) === normalizedFingerprint) || '';
}

function normalizeVerifyUpstreamStatus(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return 'queued';
    if (['success', 'completed', 'done', 'ok'].includes(normalized)) return 'success';
    if (['failed', 'fail', 'error', 'timeout', 'cancelled', 'canceled'].includes(normalized)) return 'failed';
    if (['running', 'processing', 'working', 'in_progress'].includes(normalized)) return 'running';
    if (['queued', 'queueing', 'waiting', 'pending'].includes(normalized)) return 'queued';
    return normalized;
}

function normalizeOptionalNumber(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function extractVerifyProviderPayload(payload) {
    if (payload?.data && typeof payload.data === 'object' && !Array.isArray(payload.data)) {
        return payload.data;
    }

    return payload && typeof payload === 'object' ? payload : {};
}

function normalizeVerifyJobPayload(payload = {}, fallback = {}) {
    const source = extractVerifyProviderPayload(payload);
    const offerUrl = String(source.offer_url || source.url || fallback.offer_url || fallback.url || '').trim();
    const queuePositionValue = normalizeOptionalNumber(source.queue_position ?? fallback.queue_position);
    const waitSecondsValue = normalizeOptionalNumber(source.estimated_wait_seconds ?? fallback.estimated_wait_seconds);
    const elapsedSecondsValue = normalizeOptionalNumber(source.elapsed_seconds ?? fallback.elapsed_seconds);

    return {
        ...source,
        job_id: String(source.job_id || source.task_id || fallback.job_id || fallback.task_id || '').trim(),
        task_id: String(source.task_id || source.job_id || fallback.task_id || fallback.job_id || '').trim(),
        status: normalizeVerifyUpstreamStatus(source.status || source.raw_status || fallback.status),
        task_type: normalizeVerifyTaskType(source.task_type || fallback.task_type),
        url: offerUrl,
        offer_url: offerUrl,
        has_offer_url: source.has_offer_url === true || fallback.has_offer_url === true || Boolean(offerUrl),
        error: String(source.error_code || source.error || fallback.error || '').trim(),
        message: String(source.message || fallback.message || '').trim(),
        stage_label: String(source.stage_label || fallback.stage_label || '').trim(),
        queue_position: queuePositionValue,
        estimated_wait_seconds: waitSecondsValue,
        elapsed_seconds: elapsedSecondsValue,
        created_at: String(source.completed_at || source.created_at || fallback.created_at || '').trim() || null,
        provider_key_fingerprint: String(source.provider_key_fingerprint || fallback.provider_key_fingerprint || '').trim(),
        provider_key_name: String(source.provider_key_name || fallback.provider_key_name || '').trim()
    };
}

function buildVerifyFetchOptions(timeoutMs = 0) {
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' && Number(timeoutMs) > 0) {
        return {
            signal: AbortSignal.timeout(Number(timeoutMs))
        };
    }

    return {};
}

async function postVerifyProviderAction(config = {}, payload = {}, options = {}) {
    const endpoint = normalizeVerifyApiBaseUrl(config.apiBaseUrl || config.api_base_url);
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        ...buildVerifyFetchOptions(options.timeoutMs)
    });
    const responsePayload = await response.json().catch(() => ({}));

    return {
        ok: response.ok && responsePayload?.success !== false,
        status: response.status,
        endpoint,
        payload: responsePayload
    };
}

async function fetchVerifyQuotaStates(config = {}) {
    const apiKeys = normalizeVerifyCredentialList(config.apiKeys || config.apiKey);
    const snapshots = [];

    for (const apiKey of apiKeys) {
        const upstream = await postVerifyProviderAction(config, {
            action: 'get_balance',
            cdkey: apiKey
        });

        if (!upstream.ok) {
            snapshots.push({
                ok: false,
                apiKey,
                keyName: maskVerifyCredential(apiKey),
                status: upstream.status || 502,
                message: getApiErrorMessage(upstream.payload, '查询额度失败'),
                code: getApiErrorCode(upstream.payload)
            });
            continue;
        }

        const apiData = extractVerifyProviderPayload(upstream.payload);
        const remainingUses = Number(apiData.remaining_uses ?? apiData.balance ?? apiData.credits ?? 0);
        const usageSummary = buildVerifyUsageSummary(remainingUses);
        snapshots.push({
            ok: true,
            apiKey,
            keyName: String(apiData.name || apiData.key_name || apiData.keyName || '').trim() || maskVerifyCredential(apiKey),
            remainingUses: usageSummary.remaining_uses,
            totalUsed: Number(apiData.total_used || 0),
            usageSummary
        });
    }

    return snapshots;
}

async function selectVerifyCredentialForTask(config = {}, requiredUses = 0) {
    const apiKeys = normalizeVerifyCredentialList(config.apiKeys || config.apiKey);
    if (apiKeys.length <= 1) {
        const onlyKey = apiKeys[0] || '';
        return {
            selected: onlyKey
                ? {
                    ok: true,
                    apiKey: onlyKey,
                    keyName: maskVerifyCredential(onlyKey),
                    remainingUses: null,
                    totalUsed: null,
                    usageSummary: null
                }
                : null,
            snapshots: onlyKey
                ? [{
                    ok: true,
                    apiKey: onlyKey,
                    keyName: maskVerifyCredential(onlyKey),
                    remainingUses: null,
                    totalUsed: null,
                    usageSummary: null
                }]
                : [],
            healthySnapshots: onlyKey
                ? [{
                    ok: true,
                    apiKey: onlyKey,
                    keyName: maskVerifyCredential(onlyKey),
                    remainingUses: null,
                    totalUsed: null,
                    usageSummary: null
                }]
                : [],
            totalRemainingUses: onlyKey ? null : 0
        };
    }

    const snapshots = await fetchVerifyQuotaStates(config);
    const healthySnapshots = snapshots
        .filter((snapshot) => snapshot.ok)
        .sort((left, right) => Number(right.remainingUses || 0) - Number(left.remainingUses || 0));
    const selected = healthySnapshots.find((snapshot) => Number(snapshot.remainingUses || 0) >= Number(requiredUses || 0)) || null;
    const totalRemainingUses = healthySnapshots.reduce((sum, snapshot) => sum + Number(snapshot.remainingUses || 0), 0);

    return {
        selected,
        snapshots,
        healthySnapshots,
        totalRemainingUses: Math.max(0, Math.round(totalRemainingUses * 100) / 100)
    };
}

const LEGACY_AFDIAN_PRICE_TO_POINTS = {
    5: 5,
    20: 20,
    50: 50
};

function roundCurrencyAmount(value) {
    return roundPaymentCurrencyAmount(value);
}

function amountsMatch(expected, actual, epsilon = 0.01) {
    return paymentAmountsMatch(expected, actual, epsilon);
}

function buildAfdianEventKey(orderNo, status, payload) {
    return afdianProvider.buildEventKey({ orderNo, status, payload });
}

function getBearerToken(req) {
    const authHeader = req.headers.authorization || req.headers.Authorization || '';
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    return match?.[1] || '';
}

function getRequestHostName(req) {
    const rawHost = String(req.headers.host || req.headers.Host || '').trim().toLowerCase();
    if (!rawHost) return '';
    return rawHost.replace(/^\[|\]$/g, '').split(':')[0];
}

function isLocalRequestOrigin(req) {
    const origin = String(req.headers.origin || req.headers.Origin || '').trim().toLowerCase();
    const host = getRequestHostName(req);
    return origin.includes('localhost')
        || origin.includes('127.0.0.1')
        || host === 'localhost'
        || host === '127.0.0.1';
}

function resolveSecureRequestSite(req, explicitSite = '') {
    const normalizedExplicitSite = String(explicitSite || '').trim().toLowerCase();
    const origin = String(req.headers.origin || req.headers.Origin || '').trim().toLowerCase();
    const host = String(req.headers.host || req.headers.Host || '').trim().toLowerCase();
    const derivedSite = origin.includes('zaoyoe.xyz') || host.includes('zaoyoe.xyz') ? 'intl' : 'cn';

    if (isLocalRequestOrigin(req) && ['cn', 'intl'].includes(normalizedExplicitSite)) {
        return normalizedExplicitSite;
    }

    return derivedSite;
}

async function getAuthenticatedUser(req) {
    const token = getBearerToken(req);
    if (!token) return null;

    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) {
        return null;
    }

    return data.user;
}

async function requireAuthenticatedUser(req, res) {
    const user = await getAuthenticatedUser(req);
    if (user) return user;

    res.status(401).json({
        success: false,
        message: '请先登录',
        code: 'unauthorized'
    });
    return null;
}

async function isAdminUser(userId) {
    const normalizedUserId = String(userId || '').trim();
    if (!normalizedUserId) return false;

    try {
        const { data: permissionData, error: permissionError } = await supabase
            .rpc('get_user_permissions', { p_user_id: normalizedUserId });

        if (!permissionError && (permissionData?.is_admin || permissionData?.is_super_admin)) {
            return true;
        }
    } catch (error) {
        console.warn('[Auth] get_user_permissions check failed:', error.message);
    }

    const { data, error } = await supabase
        .from('admin_roles')
        .select('role_name, expires_at')
        .eq('user_id', normalizedUserId);

    if (error) {
        throw new Error(error.message || 'Failed to verify admin role');
    }

    const now = Date.now();
    return (Array.isArray(data) ? data : []).some((role) => {
        if (!role?.expires_at) return true;
        return new Date(role.expires_at).getTime() > now;
    });
}

async function requireAdminUser(req, res) {
    const user = await requireAuthenticatedUser(req, res);
    if (!user) return null;

    try {
        const allowed = await isAdminUser(user.id);
        if (allowed) {
            return user;
        }
    } catch (error) {
        console.error('[Auth] Admin permission check error:', error);
        res.status(500).json({
            success: false,
            message: error.message || '管理员权限校验失败',
            code: 'admin_check_failed'
        });
        return null;
    }

    res.status(403).json({
        success: false,
        message: '需要管理员权限',
        code: 'admin_required'
    });
    return null;
}

async function requireAdminOrInternalAccess(req, res) {
    return requireAdminUser(req, res);
}

async function requireAdminOrVerifyMonitorInternalAccess(req, res) {
    if (hasVerifyMonitorInternalAccess(req, process.env)) {
        return {
            id: 'verify-monitor-internal',
            role: 'internal_verify_monitor'
        };
    }

    return requireAdminUser(req, res);
}

async function recordPaymentEvent(eventPayload) {
    const { data, error } = await supabase
        .from('payment_events')
        .insert(eventPayload)
        .select('id')
        .limit(1);

    if (error) {
        if (error.code === '23505') {
            return { duplicate: true, id: null };
        }
        throw error;
    }

    return {
        duplicate: false,
        id: data?.[0]?.id || null
    };
}

async function finalizePaymentEvent(eventKey, patch = {}) {
    const payload = {
        ...patch,
        processed_at: new Date().toISOString()
    };

    const { error } = await supabase
        .from('payment_events')
        .update(payload)
        .eq('event_key', eventKey);

    if (error) {
        console.warn('[Payments] Failed to finalize payment event:', error.message);
    }
}

async function deletePaymentEvent(eventKey) {
    const normalizedEventKey = String(eventKey || '').trim();
    if (!normalizedEventKey) return;

    const { error } = await supabase
        .from('payment_events')
        .delete()
        .eq('event_key', normalizedEventKey);

    if (error) {
        console.warn('[Payments] Failed to delete payment event:', error.message);
    }
}

function isMissingSupabaseStructureError(error) {
    const code = String(error?.code || '').trim();
    const message = String(error?.message || '').toLowerCase();
    return code === '42703'
        || code === '42P01'
        || (message.includes('column') && message.includes('does not exist'))
        || (message.includes('relation') && message.includes('does not exist'));
}

async function recordPaymentQueryAttempt(payload = {}) {
    const metadata = payload?.metadata && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata)
        ? payload.metadata
        : {};

    try {
        const { error } = await supabase
            .from('payment_query_attempts')
            .insert({
                provider: String(payload.provider || 'unknown').trim().toLowerCase() || 'unknown',
                site: String(payload.site || 'cn').trim().toLowerCase() || 'cn',
                order_no: String(payload.orderNo || '').trim() || null,
                user_id: payload.userId || null,
                payment_order_id: payload.paymentOrderId || null,
                checkout_session_id: payload.checkoutSessionId || null,
                success: payload.success === true,
                response_status: Number.isFinite(Number(payload.responseStatus))
                    ? Number(payload.responseStatus)
                    : null,
                outcome_code: String(payload.outcomeCode || (payload.success ? 'success' : 'unknown')).trim().toLowerCase() || 'unknown',
                message: String(payload.message || '').trim() || null,
                metadata
            });

        if (error && !isMissingSupabaseStructureError(error)) {
            console.warn('[Payments] Failed to record payment query attempt:', error.message);
        }
    } catch (error) {
        if (!isMissingSupabaseStructureError(error)) {
            console.warn('[Payments] Failed to record payment query attempt:', error.message);
        }
    }
}

function mergePaymentObjects(baseValue, patchValue) {
    const base = baseValue && typeof baseValue === 'object' && !Array.isArray(baseValue) ? baseValue : {};
    const patch = patchValue && typeof patchValue === 'object' && !Array.isArray(patchValue) ? patchValue : {};
    return {
        ...base,
        ...patch
    };
}

async function loadPaymentOrderSnapshotByProviderOrderNo(provider, providerOrderNo) {
    const normalizedProvider = String(provider || '').trim().toLowerCase();
    const normalizedOrderNo = String(providerOrderNo || '').trim();
    if (!normalizedProvider || !normalizedOrderNo) {
        return null;
    }

    const { data, error } = await supabase
        .from('payment_orders')
        .select('id, user_id, provider, provider_order_no, checkout_session_id, site, package_id, package_name, expected_amount, paid_amount, points_amount, status, sign_verified, amount_verified, provider_metadata, raw_payload, created_at, paid_at, claimed_at, verified_at, last_error')
        .eq('provider', normalizedProvider)
        .eq('provider_order_no', normalizedOrderNo)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) {
        throw new Error(error.message || 'Failed to inspect payment order snapshot');
    }

    return data || null;
}

async function loadPaymentOrderSnapshotByCheckoutSessionId(provider, checkoutSessionId) {
    const normalizedProvider = String(provider || '').trim().toLowerCase();
    const normalizedCheckoutSessionId = String(checkoutSessionId || '').trim();
    if (!normalizedProvider || !normalizedCheckoutSessionId) {
        return null;
    }

    const { data, error } = await supabase
        .from('payment_orders')
        .select('id, user_id, provider, provider_order_no, checkout_session_id, site, package_id, package_name, expected_amount, paid_amount, points_amount, status, sign_verified, amount_verified, provider_metadata, raw_payload, created_at, paid_at, claimed_at, verified_at, last_error')
        .eq('provider', normalizedProvider)
        .eq('checkout_session_id', normalizedCheckoutSessionId)
        .order('created_at', { ascending: false })
        .limit(6);

    if (error) {
        throw new Error(error.message || 'Failed to inspect payment order snapshot by checkout session');
    }

    const rows = Array.isArray(data) ? data : [];
    if (!rows.length) {
        return null;
    }

    const scoredRows = rows
        .map((row) => {
            const metadata = row?.provider_metadata && typeof row.provider_metadata === 'object'
                ? row.provider_metadata
                : {};
            let score = 0;
            if (metadata.provider_order_pending === true) score += 120;
            if (String(row.provider_order_no || '').toUpperCase().startsWith('PENDING_')) score += 100;
            if (String(row.status || '').trim().toLowerCase() === 'pending') score += 60;
            if (String(row.status || '').trim().toLowerCase() === 'pending_review') score += 30;
            return { row, score };
        })
        .sort((left, right) => {
            if (right.score !== left.score) return right.score - left.score;
            return Date.parse(String(right.row.created_at || '')) - Date.parse(String(left.row.created_at || ''));
        });

    return scoredRows[0]?.row || null;
}

async function ensureHupijiaoRecoveredPaymentOrder({
    providerOrderNo,
    attachData = {},
    payload = {},
    amount,
    signatureValid,
    currentSite
}) {
    let paymentOrder = await loadPaymentOrderSnapshotByProviderOrderNo('hupijiao', providerOrderNo);
    if (paymentOrder) {
        return paymentOrder;
    }

    const recoveredSite = sanitizeSite(attachData.site || currentSite || 'cn');
    const recoveredPoints = normalizePointValue(attachData.granted_points, 0);
    const recoveredExpectedAmount = Number.isFinite(Number(attachData.expected_amount))
        ? roundPaymentCurrencyAmount(attachData.expected_amount)
        : roundPaymentCurrencyAmount(amount);
    const nowIso = new Date().toISOString();
    const insertPayload = {
        provider: 'hupijiao',
        provider_order_no: providerOrderNo,
        user_id: String(attachData.user_id || '').trim() || null,
        checkout_session_id: String(attachData.checkout_session_id || '').trim() || null,
        site: recoveredSite,
        package_id: String(attachData.package_id || '').trim() || null,
        package_name: String(attachData.package_name || '').trim() || '充值订单',
        expected_amount: recoveredExpectedAmount > 0 ? recoveredExpectedAmount : null,
        paid_amount: roundPaymentCurrencyAmount(amount),
        points_amount: recoveredPoints,
        status: 'pending_review',
        sign_verified: signatureValid === true,
        amount_verified: false,
        raw_payload: {
            source: 'hupijiao_webhook_recovery',
            attach: attachData,
            webhook: payload
        },
        provider_metadata: {
            recovered_from: 'hupijiao_attach',
            checkout_session_key: String(attachData.checkout_session_key || '').trim() || null,
            charge_type: String(attachData.charge_type || '').trim() || null,
            custom_quote_id: String(attachData.custom_quote_id || '').trim() || null
        },
        created_at: nowIso,
        updated_at: nowIso
    };

    const { data, error } = await supabase
        .from('payment_orders')
        .insert(insertPayload)
        .select('id, user_id, provider, provider_order_no, checkout_session_id, site, package_id, package_name, expected_amount, paid_amount, points_amount, status, sign_verified, amount_verified, provider_metadata, raw_payload, created_at, paid_at, claimed_at, verified_at, last_error')
        .single();

    if (error) {
        throw new Error(error.message || 'Failed to recover Hupijiao payment order');
    }

    return data || null;
}

async function ensureZpayRecoveredPaymentOrder({
    providerOrderNo,
    attachData = {},
    payload = {},
    amount,
    signatureValid,
    currentSite
}) {
    let paymentOrder = await loadPaymentOrderSnapshotByProviderOrderNo('zpay', providerOrderNo);
    if (paymentOrder) {
        return paymentOrder;
    }

    const recoveredSite = sanitizeSite(attachData.site || currentSite || 'cn');
    const recoveredPoints = normalizePointValue(attachData.granted_points, 0);
    const recoveredExpectedAmount = Number.isFinite(Number(attachData.expected_amount))
        ? roundPaymentCurrencyAmount(attachData.expected_amount)
        : roundPaymentCurrencyAmount(amount);
    const nowIso = new Date().toISOString();
    const insertPayload = {
        provider: 'zpay',
        provider_order_no: providerOrderNo,
        user_id: String(attachData.user_id || '').trim() || null,
        checkout_session_id: String(attachData.checkout_session_id || '').trim() || null,
        site: recoveredSite,
        package_id: String(attachData.package_id || '').trim() || null,
        package_name: String(attachData.package_name || '').trim() || '充值订单',
        expected_amount: recoveredExpectedAmount > 0 ? recoveredExpectedAmount : null,
        paid_amount: roundPaymentCurrencyAmount(amount),
        points_amount: recoveredPoints,
        status: 'pending_review',
        sign_verified: signatureValid === true,
        amount_verified: false,
        raw_payload: {
            source: 'zpay_webhook_recovery',
            attach: attachData,
            webhook: payload
        },
        provider_metadata: {
            recovered_from: 'zpay_param',
            checkout_session_key: String(attachData.checkout_session_key || '').trim() || null,
            charge_type: String(attachData.charge_type || '').trim() || null,
            custom_quote_id: String(attachData.custom_quote_id || '').trim() || null
        },
        created_at: nowIso,
        updated_at: nowIso
    };

    const { data, error } = await supabase
        .from('payment_orders')
        .insert(insertPayload)
        .select('id, user_id, provider, provider_order_no, checkout_session_id, site, package_id, package_name, expected_amount, paid_amount, points_amount, status, sign_verified, amount_verified, provider_metadata, raw_payload, created_at, paid_at, claimed_at, verified_at, last_error')
        .single();

    if (error) {
        throw new Error(error.message || 'Failed to recover ZPAY payment order');
    }

    return data || null;
}

async function resolveAfdianPackage({ planId, amount }) {
    const resolvedPackage = await afdianProvider.resolvePackage({
        supabase,
        planId,
        amount
    });
    if (resolvedPackage) {
        return resolvedPackage;
    }

    const normalizedAmount = roundCurrencyAmount(amount);
    const legacyPoints = LEGACY_AFDIAN_PRICE_TO_POINTS[Math.round(normalizedAmount)];
    if (legacyPoints) {
        return {
            packageId: null,
            packageName: `Afdian ${normalizedAmount} CNY`,
            expectedAmount: normalizedAmount,
            pointsTotal: legacyPoints,
            matchType: 'legacy_amount'
        };
    }

    return null;
}

function normalizeQuoteTokens(input) {
    const values = Array.isArray(input)
        ? input
        : typeof input === 'string'
            ? input.split(',')
            : [];

    return [...new Set(values
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .slice(0, 12))];
}

function normalizeClaimTokens(input) {
    const values = Array.isArray(input)
        ? input
        : typeof input === 'string'
            ? input.split(',')
            : [];

    return [...new Set(values
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .slice(0, 12))];
}

async function loadAfdianQuerySnapshot(orderNo) {
    const normalizedOrderNo = String(orderNo || '').trim();
    if (!normalizedOrderNo) {
        return {
            afdianOrder: null,
            paymentOrder: null
        };
    }

    const { data: afdianOrder, error: afdianOrderError } = await supabase
        .from('afdian_orders')
        .select('id, out_trade_no, total_amount, points, redeem_code, is_redeemed, created_at, payment_status, sign_verified, amount_verified, site, site_user_id, claimed_at, payment_order_id, plan_id, raw_payload, paid_at, verified_at')
        .eq('out_trade_no', normalizedOrderNo)
        .maybeSingle();

    if (afdianOrderError) {
        throw new Error(afdianOrderError.message || 'Failed to inspect afdian order');
    }

    if (!afdianOrder) {
        return {
            afdianOrder: null,
            paymentOrder: null
        };
    }

    let paymentOrder = null;
    let paymentOrderError = null;
    if (afdianOrder.payment_order_id) {
        ({ data: paymentOrder, error: paymentOrderError } = await supabase
            .from('payment_orders')
            .select('id, user_id, provider, provider_order_no, site, checkout_session_id, package_id, package_name, expected_amount, paid_amount, points_amount, status, sign_verified, amount_verified, provider_metadata, created_at, paid_at, claimed_at, raw_payload, last_error')
            .eq('id', afdianOrder.payment_order_id)
            .maybeSingle());
    }

    if (!paymentOrder && !paymentOrderError) {
        ({ data: paymentOrder, error: paymentOrderError } = await supabase
            .from('payment_orders')
            .select('id, user_id, provider, provider_order_no, site, checkout_session_id, package_id, package_name, expected_amount, paid_amount, points_amount, status, sign_verified, amount_verified, provider_metadata, created_at, paid_at, claimed_at, raw_payload, last_error')
            .eq('provider', 'afdian')
            .eq('provider_order_no', normalizedOrderNo)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle());
    }

    if (paymentOrderError) {
        throw new Error(paymentOrderError.message || 'Failed to inspect afdian payment order');
    }

    return {
        afdianOrder,
        paymentOrder: paymentOrder || null
    };
}

async function loadPaymentOrderSiteById(paymentOrderId) {
    const normalizedPaymentOrderId = String(paymentOrderId || '').trim();
    if (!normalizedPaymentOrderId) return '';

    const { data, error } = await supabase
        .from('payment_orders')
        .select('site')
        .eq('id', normalizedPaymentOrderId)
        .maybeSingle();

    if (error) {
        throw new Error(error.message || 'Failed to inspect payment order site');
    }

    return String(data?.site || '').trim();
}

async function loadCheckoutSessionSiteById(checkoutSessionId) {
    const normalizedCheckoutSessionId = String(checkoutSessionId || '').trim();
    if (!normalizedCheckoutSessionId) return '';

    const { data, error } = await supabase
        .from('payment_checkout_sessions')
        .select('site')
        .eq('id', normalizedCheckoutSessionId)
        .maybeSingle();

    if (error) {
        throw new Error(error.message || 'Failed to inspect checkout session site');
    }

    return String(data?.site || '').trim();
}

async function resolveAfdianWebhookContext({
    orderNo,
    resolvedPackage = null,
    amount
}) {
    const snapshot = await loadAfdianQuerySnapshot(orderNo);
    const snapshotSite = String(snapshot.paymentOrder?.site || snapshot.afdianOrder?.site || '').trim();
    if (snapshotSite) {
        return {
            currentSite: sanitizeResolvedPaymentSite(snapshotSite),
            pendingPaymentOrder: snapshot.paymentOrder?.id
                ? {
                    paymentOrderId: snapshot.paymentOrder.id,
                    checkoutSessionId: snapshot.paymentOrder.checkout_session_id || null,
                    resolvedBy: 'existing_payment_order'
                }
                : null
        };
    }

    const pendingPaymentOrder = await resolvePendingPaymentOrderFromCheckoutContext({
        supabase,
        providerKey: 'afdian',
        providerOrderNo: orderNo,
        site: '',
        packageId: resolvedPackage?.packageId ?? null,
        packageName: resolvedPackage?.packageName ?? null,
        expectedAmount: resolvedPackage?.expectedAmount ?? amount,
        paidAmount: amount,
        pointsAmount: resolvedPackage?.pointsTotal ?? 0,
        lookbackMinutes: 120
    });

    let resolvedSite = '';
    if (pendingPaymentOrder?.paymentOrderId) {
        resolvedSite = await loadPaymentOrderSiteById(pendingPaymentOrder.paymentOrderId);
    }
    if (!resolvedSite && pendingPaymentOrder?.checkoutSessionId) {
        resolvedSite = await loadCheckoutSessionSiteById(pendingPaymentOrder.checkoutSessionId);
    }

    return {
        currentSite: sanitizeResolvedPaymentSite(resolvedSite),
        pendingPaymentOrder
    };
}

function deriveAfdianOwnershipState({ userId, afdianOrder = null, paymentOrder = null } = {}) {
    const normalizedUserId = String(userId || '').trim();
    const orderOwnerId = String(afdianOrder?.site_user_id || '').trim();
    const paymentOwnerId = String(paymentOrder?.user_id || '').trim();

    if (!normalizedUserId) {
        return {
            state: 'missing_user'
        };
    }

    if ((orderOwnerId && orderOwnerId !== normalizedUserId) || (paymentOwnerId && paymentOwnerId !== normalizedUserId)) {
        return {
            state: 'denied',
            ownerSource: orderOwnerId && orderOwnerId !== normalizedUserId ? 'afdian_order' : 'payment_order'
        };
    }

    if (orderOwnerId === normalizedUserId || paymentOwnerId === normalizedUserId) {
        return {
            state: 'owned',
            ownerSource: orderOwnerId === normalizedUserId ? 'afdian_order' : 'payment_order'
        };
    }

    return {
        state: 'unowned'
    };
}

function buildAfdianQueryOrderInfo({ afdianOrder = null, paymentOrder = null } = {}) {
    if (!afdianOrder && !paymentOrder) {
        return null;
    }

    return {
        code: String(afdianOrder?.redeem_code || '').trim() || null,
        points: normalizePointValue(paymentOrder?.points_amount ?? afdianOrder?.points, 0),
        is_redeemed: Boolean(afdianOrder?.is_redeemed),
        created_at: afdianOrder?.created_at || paymentOrder?.created_at || null,
        payment_status: String(paymentOrder?.status || afdianOrder?.payment_status || 'pending').trim() || 'pending',
        sign_verified: paymentOrder?.sign_verified === true || afdianOrder?.sign_verified === true,
        amount_verified: paymentOrder?.amount_verified === true || afdianOrder?.amount_verified === true,
        last_error: String(paymentOrder?.last_error || '').trim() || null
    };
}

function extractAfdianQueryRequest(req) {
    if (req.method === 'POST') {
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        return {
            orderNo: String(body.order_no || '').trim(),
            quoteTokens: normalizeQuoteTokens(body.quote_tokens || body.quote_token || []),
            claimTokens: normalizeClaimTokens(body.claim_tokens || body.claim_token || [])
        };
    }

    return {
        orderNo: String(req.query.order_no || '').trim(),
        quoteTokens: normalizeQuoteTokens(req.query.quote_tokens || req.query.quote_token || []),
        claimTokens: normalizeClaimTokens(req.query.claim_tokens || req.query.claim_token || [])
    };
}

function getCustomQuoteSnapshot(order = {}) {
    const metadata = order?.provider_metadata && typeof order.provider_metadata === 'object'
        ? order.provider_metadata
        : {};
    const quote = metadata?.custom_quote && typeof metadata.custom_quote === 'object'
        ? metadata.custom_quote
        : {};
    const quoteId = String(metadata.custom_quote_id || quote.quote_id || '').trim();
    const expiresAt = String(metadata.custom_quote_expires_at || quote.expires_at || '').trim() || null;
    const expectedAmount = roundPaymentCurrencyAmount(
        quote.paid_amount ?? order.expected_amount ?? order.paid_amount ?? 0
    );
    const pointsAmount = Math.max(
        0,
        normalizePointValue(quote.points_amount ?? order.points_amount, 0)
    );
    const site = String(order.site || quote.site || '').trim().toLowerCase() || 'cn';
    const chargeType = String(metadata.charge_type || '').trim().toLowerCase();
    const pricingMode = String(quote.pricing_mode || '').trim().toLowerCase() || 'fixed_rate';
    const checkoutSessionId = String(order.checkout_session_id || '').trim() || null;
    const paidAt = String(order.paid_at || '').trim() || null;
    const createdAt = String(order.created_at || '').trim() || null;

    if (!quoteId || pointsAmount <= 0 || expectedAmount <= 0) {
        return null;
    }

    return {
        quoteId,
        expectedAmount,
        pointsAmount,
        expiresAt,
        site,
        chargeType,
        pricingMode,
        checkoutSessionId,
        paidAt,
        createdAt
    };
}

async function findMatchingCustomRechargeQuote({
    userId,
    site,
    paidAmount,
    paidAt = '',
    linkedPaymentOrder = null,
    quoteTokens = []
}) {
    if (!userId || !Number.isFinite(Number(paidAmount)) || Number(paidAmount) <= 0) {
        return null;
    }

    const verifiedQuoteIds = new Set(
        normalizeQuoteTokens(quoteTokens)
            .map((token) => verifyCustomRechargeQuoteToken(token, {
                env: process.env,
                userId,
                site,
                providerKey: 'afdian'
            }))
            .filter(Boolean)
            .map((item) => item.quoteId)
    );

    const lookbackIso = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
        .from('payment_orders')
        .select('id, user_id, provider_order_no, checkout_session_id, site, expected_amount, paid_amount, points_amount, status, provider_metadata, created_at, paid_at')
        .eq('provider', 'afdian')
        .eq('user_id', userId)
        .gte('created_at', lookbackIso)
        .order('created_at', { ascending: false })
        .limit(20);

    if (error) {
        throw new Error(error.message || 'Failed to inspect custom recharge quotes');
    }

    const candidates = (Array.isArray(data) ? data : [])
        .map((item) => ({
            order: item,
            quote: getCustomQuoteSnapshot(item)
        }))
        .filter((item) => item.quote && item.quote.chargeType === 'custom')
        .filter((item) => {
            const status = String(item.order.status || '').trim().toLowerCase();
            if (['pending', 'pending_review', 'amount_mismatch'].includes(status)) {
                return true;
            }
            return !!linkedPaymentOrder?.id && item.order.id === linkedPaymentOrder.id;
        })
        .filter((item) => paymentAmountsMatch(item.quote.expectedAmount, paidAmount))
        .filter((item) => sanitizeSite(item.quote.site) === sanitizeSite(site))
        .filter((item) => {
            if (!item.quote.expiresAt) return true;
            const paidAtTs = Date.parse(String(paidAt || item.quote.paidAt || ''));
            const expiresAtTs = Date.parse(String(item.quote.expiresAt || ''));
            if (!Number.isFinite(expiresAtTs)) return true;
            if (!Number.isFinite(paidAtTs)) return true;
            return paidAtTs <= expiresAtTs;
        })
        .map((item) => {
            let score = 0;
            if (verifiedQuoteIds.has(item.quote.quoteId)) score += 200;
            if (linkedPaymentOrder?.checkout_session_id && item.quote.checkoutSessionId === linkedPaymentOrder.checkout_session_id) score += 80;
            if (String(item.order.provider_order_no || '').toUpperCase().startsWith('PENDING_')) score += 30;
            if (item.order.status === 'pending') score += 20;
            return {
                ...item,
                score
            };
        })
        .sort((left, right) => {
            if (right.score !== left.score) return right.score - left.score;
            return Date.parse(String(right.order.created_at || '')) - Date.parse(String(left.order.created_at || ''));
        });

    if (!candidates.length) {
        return null;
    }

    if (verifiedQuoteIds.size > 0) {
        const tokenMatchedCandidates = candidates.filter((item) => verifiedQuoteIds.has(item.quote.quoteId));
        if (tokenMatchedCandidates.length === 1) {
            return tokenMatchedCandidates[0];
        }
        if (tokenMatchedCandidates.length > 1 && linkedPaymentOrder?.checkout_session_id) {
            const exactSessionCandidate = tokenMatchedCandidates.find(
                (item) => item.quote.checkoutSessionId === linkedPaymentOrder.checkout_session_id
            );
            if (exactSessionCandidate) {
                return exactSessionCandidate;
            }
        }
        if (tokenMatchedCandidates.length > 1) {
            return null;
        }
    }

    const [bestCandidate, secondCandidate] = candidates;
    if (!secondCandidate) {
        return bestCandidate;
    }

    if (bestCandidate.quote.quoteId === secondCandidate.quote.quoteId) {
        return bestCandidate;
    }

    if (bestCandidate.score - secondCandidate.score >= 80) {
        return bestCandidate;
    }

    return null;
}

async function resolveAfdianPaymentIntentClaim({
    user,
    claimTokens = [],
    linkedPaymentOrder = null,
    afdianOrder = null
}) {
    const normalizedUserId = String(user?.id || '').trim();
    const normalizedClaimTokens = normalizeClaimTokens(claimTokens);
    if (!normalizedUserId || !normalizedClaimTokens.length) {
        return null;
    }

    const targetAmount = roundPaymentCurrencyAmount(
        afdianOrder?.total_amount
            ?? linkedPaymentOrder?.paid_amount
            ?? linkedPaymentOrder?.expected_amount
            ?? 0
    );
    if (!(targetAmount > 0)) {
        return null;
    }

    const linkedPackageId = String(linkedPaymentOrder?.package_id || '').trim() || null;
    const linkedPointsAmount = Math.max(
        0,
        normalizePointValue(linkedPaymentOrder?.points_amount ?? afdianOrder?.points, 0)
    );
    const orderSite = sanitizeSite(linkedPaymentOrder?.site || afdianOrder?.site || '');
    const orderCreatedAtTs = Date.parse(String(
        afdianOrder?.paid_at
        || afdianOrder?.created_at
        || linkedPaymentOrder?.paid_at
        || linkedPaymentOrder?.created_at
        || ''
    ));
    const candidates = [];

    for (const token of normalizedClaimTokens) {
        const claim = verifyPaymentIntentClaimToken(token, {
            env: process.env,
            userId: normalizedUserId,
            providerKey: 'afdian'
        });
        if (!claim?.intentId || !claim.checkoutSessionId) {
            continue;
        }

        if (!paymentAmountsMatch(claim.expectedAmount, targetAmount)) {
            continue;
        }

        const sourceOrder = await loadPaymentOrderSnapshotByCheckoutSessionId('afdian', claim.checkoutSessionId);
        if (!sourceOrder?.id) {
            continue;
        }

        if (String(sourceOrder.user_id || '').trim() !== normalizedUserId) {
            continue;
        }

        const sourceSite = sanitizeSite(sourceOrder.site || claim.site || orderSite || '');
        if (!sourceSite || sourceSite !== sanitizeSite(claim.site)) {
            continue;
        }

        const sourceExpectedAmount = roundPaymentCurrencyAmount(
            sourceOrder.expected_amount ?? sourceOrder.paid_amount ?? claim.expectedAmount ?? 0
        );
        if (!(sourceExpectedAmount > 0) || !paymentAmountsMatch(sourceExpectedAmount, targetAmount)) {
            continue;
        }

        const sourcePointsAmount = Math.max(
            0,
            normalizePointValue(sourceOrder.points_amount ?? claim.pointsAmount, 0)
        );
        if (sourcePointsAmount <= 0 || sourcePointsAmount !== claim.pointsAmount) {
            continue;
        }

        let score = 0;
        if (sourceOrder.checkout_session_id === claim.checkoutSessionId) score += 260;
        if (orderSite && sourceSite === orderSite) score += 80;
        if (linkedPackageId && String(sourceOrder.package_id || '').trim() === linkedPackageId) score += 70;
        if (linkedPointsAmount > 0 && sourcePointsAmount === linkedPointsAmount) score += 50;
        if (String(sourceOrder.provider_order_no || '').toUpperCase().startsWith('PENDING_')) score += 30;
        if (String(sourceOrder.status || '').trim().toLowerCase() === 'pending') score += 20;

        const sourceCreatedAtTs = Date.parse(String(sourceOrder.created_at || ''));
        const timeDistanceMs = Number.isFinite(orderCreatedAtTs) && Number.isFinite(sourceCreatedAtTs)
            ? Math.abs(orderCreatedAtTs - sourceCreatedAtTs)
            : Number.MAX_SAFE_INTEGER;
        if (Number.isFinite(timeDistanceMs) && timeDistanceMs !== Number.MAX_SAFE_INTEGER) {
            if (timeDistanceMs <= 5 * 60 * 1000) score += 40;
            else if (timeDistanceMs <= 30 * 60 * 1000) score += 20;
            else if (timeDistanceMs <= 2 * 60 * 60 * 1000) score += 10;
        }

        candidates.push({
            claim,
            sourceOrder,
            site: sourceSite,
            score,
            timeDistanceMs
        });
    }

    if (!candidates.length) {
        return null;
    }

    candidates.sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score;
        if (left.timeDistanceMs !== right.timeDistanceMs) return left.timeDistanceMs - right.timeDistanceMs;
        return Date.parse(String(right.sourceOrder.created_at || '')) - Date.parse(String(left.sourceOrder.created_at || ''));
    });

    const [bestCandidate, secondCandidate] = candidates;
    if (!secondCandidate) {
        return {
            ...bestCandidate.claim,
            sourceOrder: bestCandidate.sourceOrder,
            site: bestCandidate.site
        };
    }

    if (bestCandidate.sourceOrder.id === secondCandidate.sourceOrder.id) {
        return {
            ...bestCandidate.claim,
            sourceOrder: bestCandidate.sourceOrder,
            site: bestCandidate.site
        };
    }

    if (bestCandidate.score - secondCandidate.score >= 80) {
        return {
            ...bestCandidate.claim,
            sourceOrder: bestCandidate.sourceOrder,
            site: bestCandidate.site
        };
    }

    return null;
}

async function applyAfdianPaymentIntentClaim({
    orderNo,
    user,
    linkedPaymentOrder = null,
    afdianOrder = null,
    claimResolution = null
}) {
    if (!claimResolution?.sourceOrder?.id || !claimResolution?.intentId) {
        return null;
    }

    const sourceOrder = claimResolution.sourceOrder;
    const targetPaymentOrder = linkedPaymentOrder
        || await loadPaymentOrderSnapshotByProviderOrderNo('afdian', orderNo);
    if (!targetPaymentOrder?.id && !afdianOrder?.id) {
        return null;
    }

    const claimSite = sanitizeSite(claimResolution.site || sourceOrder.site || afdianOrder?.site || '');
    const targetCheckoutSessionId = String(
        targetPaymentOrder?.checkout_session_id
        || claimResolution.checkoutSessionId
        || sourceOrder.checkout_session_id
        || ''
    ).trim() || null;

    if (targetPaymentOrder?.checkout_session_id
        && claimResolution.checkoutSessionId
        && targetPaymentOrder.checkout_session_id !== claimResolution.checkoutSessionId) {
        return null;
    }

    const nowIso = new Date().toISOString();
    const expectedAmount = roundPaymentCurrencyAmount(
        targetPaymentOrder?.expected_amount
            ?? sourceOrder.expected_amount
            ?? claimResolution.expectedAmount
            ?? afdianOrder?.total_amount
            ?? 0
    );
    const paidAmount = roundPaymentCurrencyAmount(
        targetPaymentOrder?.paid_amount
            ?? afdianOrder?.total_amount
            ?? sourceOrder.paid_amount
            ?? sourceOrder.expected_amount
            ?? claimResolution.expectedAmount
            ?? 0
    );
    const pointsAmount = Math.max(
        0,
        Math.round(Number(
            targetPaymentOrder?.points_amount
            ?? sourceOrder.points_amount
            ?? claimResolution.pointsAmount
            ?? afdianOrder?.points
            ?? 0
        ) || 0)
    );

    if (targetPaymentOrder?.id) {
        const targetProviderMetadata = mergePaymentObjects(targetPaymentOrder.provider_metadata, {
            claim_token_bound: true,
            claim_token_intent_id: claimResolution.intentId,
            claim_token_bound_at: nowIso,
            claim_token_bound_user_id: String(user?.id || '').trim() || null,
            claim_token_bound_site: claimSite || null,
            claim_token_source_payment_order_id: sourceOrder.id,
            claim_token_checkout_session_id: claimResolution.checkoutSessionId || null
        });

        const { error: targetUpdateError } = await supabase
            .from('payment_orders')
            .update({
                user_id: String(user?.id || '').trim() || null,
                site: claimSite || targetPaymentOrder.site || null,
                checkout_session_id: targetCheckoutSessionId,
                package_id: String(sourceOrder.package_id || targetPaymentOrder.package_id || claimResolution.packageId || '').trim() || null,
                package_name: String(sourceOrder.package_name || targetPaymentOrder.package_name || claimResolution.packageName || '充值订单').trim(),
                expected_amount: expectedAmount > 0 ? expectedAmount : null,
                paid_amount: paidAmount > 0 ? paidAmount : null,
                points_amount: pointsAmount,
                claimed_at: targetPaymentOrder.claimed_at || nowIso,
                provider_metadata: targetProviderMetadata
            })
            .eq('id', targetPaymentOrder.id);

        if (targetUpdateError) {
            throw new Error(targetUpdateError.message || 'Failed to bind claimed afdian payment order');
        }
    }

    if (targetPaymentOrder?.id && sourceOrder.id !== targetPaymentOrder.id && sourceOrder.checkout_session_id) {
        const sourceProviderMetadata = mergePaymentObjects(sourceOrder.provider_metadata, {
            checkout_session_detached_by: 'afdian_query_claim_token',
            checkout_session_detached_at: nowIso,
            checkout_session_reassigned_to_payment_order_id: targetPaymentOrder?.id || null,
            claim_token_consumed_intent_id: claimResolution.intentId
        });

        const { error: sourceUpdateError } = await supabase
            .from('payment_orders')
            .update({
                checkout_session_id: null,
                provider_metadata: sourceProviderMetadata
            })
            .eq('id', sourceOrder.id);

        if (sourceUpdateError) {
            throw new Error(sourceUpdateError.message || 'Failed to detach claimed checkout session');
        }
    }

    if (afdianOrder?.id) {
        const { error: afdianOrderUpdateError } = await supabase
            .from('afdian_orders')
            .update({
                site: claimSite || afdianOrder.site || null,
                site_user_id: String(user?.id || '').trim() || null,
                claimed_at: afdianOrder.claimed_at || nowIso,
                payment_order_id: targetPaymentOrder?.id || afdianOrder.payment_order_id || null
            })
            .eq('id', afdianOrder.id);

        if (afdianOrderUpdateError) {
            throw new Error(afdianOrderUpdateError.message || 'Failed to bind afdian order ownership');
        }
    }

    if (targetPaymentOrder?.id) {
        try {
            await reconcileCheckoutSessionForPaymentOrder({
                supabase,
                providerKey: 'afdian',
                paymentOrderId: targetPaymentOrder.id,
                providerOrderNo: orderNo,
                userId: String(user?.id || '').trim() || null,
                site: claimSite || targetPaymentOrder.site || sourceOrder.site || null,
                packageId: String(sourceOrder.package_id || targetPaymentOrder.package_id || claimResolution.packageId || '').trim() || null,
                packageName: String(sourceOrder.package_name || targetPaymentOrder.package_name || claimResolution.packageName || '充值订单').trim(),
                expectedAmount,
                paidAmount,
                pointsAmount,
                orderStatus: String(targetPaymentOrder.status || afdianOrder?.payment_status || 'paid').trim() || 'paid',
                linkedBy: 'afdian_query_claim_token',
                allowHeuristic: true,
                lookbackMinutes: 1440
            });
        } catch (claimLinkError) {
            console.warn('[Afdian] Failed to reconcile checkout session for claim token:', claimLinkError.message);
        }
    }

    return {
        intentId: claimResolution.intentId,
        paymentOrderId: targetPaymentOrder?.id || null,
        checkoutSessionId: targetCheckoutSessionId,
        site: claimSite || null
    };
}

async function tryFinalizeCustomRechargeFromQuote({
    orderNo,
    user,
    site,
    linkedPaymentOrder = null,
    orderInfo = null,
    quoteTokens = []
}) {
    const paidAmount = roundPaymentCurrencyAmount(
        linkedPaymentOrder?.paid_amount
            ?? orderInfo?.paid_amount
            ?? 0
    );
    const paidAt = String(linkedPaymentOrder?.paid_at || orderInfo?.paid_at || '').trim() || null;
    const signVerified = linkedPaymentOrder?.sign_verified === true || orderInfo?.sign_verified === true;

    if (!signVerified || paidAmount <= 0) {
        return null;
    }

    const matchedCandidate = await findMatchingCustomRechargeQuote({
        userId: user.id,
        site,
        paidAmount,
        paidAt,
        linkedPaymentOrder,
        quoteTokens
    });

    if (!matchedCandidate?.quote) {
        return null;
    }

    const { data, error } = await finalizeAfdianCustomPayment({
        supabase,
        orderNo,
        userId: user.id,
        site: matchedCandidate.quote.site || site,
        points: matchedCandidate.quote.pointsAmount,
        expectedAmount: matchedCandidate.quote.expectedAmount,
        quoteId: matchedCandidate.quote.quoteId,
        packageName: '自定义充值'
    });

    if (error) {
        throw new Error(error.message || 'Failed to finalize custom recharge quote');
    }

    if (!data?.payment_order_id) {
        return null;
    }

    try {
        await reconcileCheckoutSessionForPaymentOrder({
            supabase,
            providerKey: 'afdian',
            paymentOrderId: data.payment_order_id,
            providerOrderNo: orderNo,
            userId: user.id,
            site: matchedCandidate.quote.site || site,
            packageId: null,
            packageName: '自定义充值',
            expectedAmount: matchedCandidate.quote.expectedAmount,
            paidAmount,
            pointsAmount: matchedCandidate.quote.pointsAmount,
            orderStatus: data.status || 'paid',
            linkedBy: 'afdian_query_custom_quote',
            allowHeuristic: true,
            lookbackMinutes: 1440
        });
    } catch (linkError) {
        console.warn('[Afdian] Failed to reconcile checkout session after custom quote finalization:', linkError.message);
    }

    return {
        code: data.code,
        points: data.points,
        paymentOrderId: data.payment_order_id,
        checkoutSessionId: data.checkout_session_id || linkedPaymentOrder?.checkout_session_id || null,
        quoteId: data.quote_id || matchedCandidate.quote.quoteId
    };
}

function buildClientStatusMessage(job) {
    const status = String(job?.status || '').toLowerCase();
    const taskType = normalizeVerifyTaskType(job?.task_type || job?.taskType);
    const offerUrl = String(job?.offer_url || job?.url || '').trim();

    if (status === 'queued') {
        const queuePosition = Number(job?.queue_position);
        const waitSeconds = Number(job?.estimated_wait_seconds);
        const queueLabel = Number.isFinite(queuePosition) && queuePosition >= 0
            ? `排队中（队列位置 ${queuePosition}）`
            : '排队中';
        return Number.isFinite(waitSeconds) && waitSeconds > 0
            ? `${queueLabel}，预计等待 ${waitSeconds} 秒`
            : queueLabel;
    }

    if (status === 'running') {
        return job?.stage_label ? `当前阶段：${job.stage_label}` : '任务执行中';
    }

    if (status === 'success') {
        if (taskType === 'full') {
            return String(job?.message || '').trim() || '绑卡流程完成';
        }
        return offerUrl ? '链接获取成功' : (String(job?.message || '').trim() || '提链任务完成');
    }

    if (status === 'failed') {
        return job?.error || '任务失败';
    }

    return job?.message || job?.status || '处理中';
}

function buildHistoryMessage(payload) {
    return JSON.stringify({
        kind: 'google_one_job',
        ...payload
    });
}

function parseHistoryMessage(message) {
    if (typeof message !== 'string' || !message.trim().startsWith('{')) {
        return null;
    }

    try {
        const parsed = JSON.parse(message);
        if (parsed?.kind === 'google_one_job') {
            return parsed;
        }
    } catch (_) {
        return null;
    }

    return null;
}

function isTerminalTrackedStatus(status) {
    return TERMINAL_TRACKED_JOB_STATUSES.includes(String(status || '').toLowerCase());
}

function isActiveTrackedStatus(status) {
    return ACTIVE_TRACKED_JOB_STATUSES.includes(String(status || '').toLowerCase());
}

function buildTrackedJobPayload({ email, jobId, apiData = {}, status = '', pointsDeducted = 0 }) {
    const queuePosition = Number(apiData?.queue_position);
    const estimatedWait = Number(apiData?.estimated_wait_seconds);
    const elapsedSeconds = Number(apiData?.elapsed_seconds);
    const offerUrl = String(apiData?.offer_url || apiData?.url || '').trim();
    const taskType = normalizeVerifyTaskType(apiData?.task_type);

    return {
        email: email || '',
        job_id: jobId || '',
        url: offerUrl,
        offer_url: offerUrl,
        has_offer_url: apiData?.has_offer_url === true || Boolean(offerUrl),
        task_type: taskType,
        provider_key_fingerprint: String(apiData?.provider_key_fingerprint || '').trim(),
        provider_key_name: String(apiData?.provider_key_name || '').trim(),
        error_code: apiData?.error || '',
        message: apiData?.message || '',
        error_message: buildClientStatusMessage(apiData),
        stage_label: apiData?.stage_label || '',
        raw_status: apiData?.status || status || '',
        queue_position: Number.isFinite(queuePosition) ? queuePosition : null,
        estimated_wait_seconds: Number.isFinite(estimatedWait) ? estimatedWait : null,
        elapsed_seconds: Number.isFinite(elapsedSeconds) ? elapsedSeconds : null,
        points_deducted: pointsDeducted,
        logged_at: new Date().toISOString()
    };
}

async function withJobSyncLock(lockKey, task) {
    const previous = jobSyncLocks.get(lockKey) || Promise.resolve();
    let releaseCurrent;
    const current = new Promise((resolve) => {
        releaseCurrent = resolve;
    });
    const tail = previous.finally(() => current);
    jobSyncLocks.set(lockKey, tail);

    await previous;

    try {
        return await task();
    } finally {
        releaseCurrent();
        if (jobSyncLocks.get(lockKey) === tail) {
            jobSyncLocks.delete(lockKey);
        }
    }
}

function applyTrackedLogMatch(query, existingRecord, { userId, site, jobId }) {
    if (existingRecord?.id) {
        return query.eq('id', existingRecord.id);
    }

    if (existingRecord?.created_at && existingRecord?.verification_id) {
        return query
            .eq('user_id', userId)
            .eq('site', site)
            .eq('verification_id', existingRecord.verification_id)
            .eq('created_at', existingRecord.created_at);
    }

    return query
        .eq('user_id', userId)
        .eq('site', site)
        .eq('verification_id', jobId);
}

async function findTrackedJobLog(userId, jobId, site = 'cn') {
    if (!userId || !jobId) return null;

    try {
        const { data: exactData, error: exactError } = await supabase
            .from('verification_logs')
            .select('*')
            .eq('user_id', userId)
            .eq('site', site)
            .eq('verification_id', jobId)
            .order('created_at', { ascending: false })
            .limit(1);

        if (exactError) {
            console.warn('[Verify] Failed to query tracked job log by verification_id:', exactError.message);
        } else if (exactData?.length) {
            return exactData[0];
        }

        const { data, error } = await supabase
            .from('verification_logs')
            .select('*')
            .eq('user_id', userId)
            .eq('site', site)
            .order('created_at', { ascending: false })
            .limit(80);

        if (error) {
            console.warn('[Verify] Failed to query tracked job logs:', error.message);
            return null;
        }

        return (data || []).find((row) => parseHistoryMessage(row.message)?.job_id === jobId) || null;
    } catch (error) {
        console.warn('[Verify] Tracked job log lookup failed:', error.message);
        return null;
    }
}

async function upsertTrackedJobLog({
    existingRecord = null,
    userId,
    site = 'cn',
    email,
    jobId,
    status,
    apiData = {},
    pointsDeducted = 0
}) {
    if (!userId || !jobId) return existingRecord;

    const normalizedStatus = String(status || apiData?.status || 'queued').toLowerCase();
    const message = buildHistoryMessage(buildTrackedJobPayload({
        email,
        jobId,
        apiData,
        status: normalizedStatus,
        pointsDeducted
    }));
    const payload = {
        verification_id: jobId,
        status: normalizedStatus,
        message,
        points_deducted: pointsDeducted,
        batch_count: 1,
        batch_success: normalizedStatus === 'success' ? 1 : 0,
        batch_failed: normalizedStatus === 'failed' ? 1 : 0,
        site
    };

    try {
        if (existingRecord) {
            let query = supabase
                .from('verification_logs')
                .update(payload);
            query = applyTrackedLogMatch(query, existingRecord, { userId, site, jobId });
            const { data, error } = await query.select('*').limit(1);

            if (error) {
                console.warn('[Verify] Failed to update tracked job log:', error.message);
                return existingRecord;
            }

            return data?.[0] || existingRecord;
        }

        const { data, error } = await supabase
            .from('verification_logs')
            .insert({
                user_id: userId,
                ...payload
            })
            .select('*')
            .limit(1);

        if (error) {
            console.warn('[Verify] Failed to insert tracked job log:', error.message);
            return null;
        }

        return data?.[0] || null;
    } catch (error) {
        console.warn('[Verify] Tracked job log upsert failed:', error.message);
        return existingRecord;
    }
}

async function findExistingJobDeduction(userId, jobId, site = 'cn') {
    if (!userId || !jobId) return 0;

    const runQuery = async (withSite) => {
        let query = supabase
            .from('points_ledger')
            .select('amount')
            .eq('user_id', userId)
            .eq('reference_id', jobId)
            .lt('amount', 0)
            .order('created_at', { ascending: false })
            .limit(1);

        if (withSite) {
            query = query.eq('site', site);
        }

        return query;
    };

    try {
        let { data, error } = await runQuery(true);
        if (error) {
            ({ data, error } = await runQuery(false));
        }

        if (error) {
            console.warn('[Verify] Failed to inspect points ledger:', error.message);
            return 0;
        }

        const amount = Number(data?.[0]?.amount);
        return Number.isFinite(amount) ? Math.abs(amount) : 0;
    } catch (error) {
        console.warn('[Verify] Points ledger lookup failed:', error.message);
        return 0;
    }
}

async function deductPointsForJob(userId, jobId, amount, site = 'cn', taskType = DEFAULT_VERIFY_TASK_TYPE) {
    const normalizedTaskType = normalizeVerifyTaskType(taskType);
    const existingDeduction = await findExistingJobDeduction(userId, jobId, site);
    if (existingDeduction > 0) {
        return existingDeduction;
    }

    const { data: deductData, error: deductError } = await deductPointsForService({
        supabase,
        userId,
        amount,
        reason: normalizedTaskType === 'full'
            ? 'Google One 全流程包绑卡服务'
            : 'Google One 试用链接提取服务',
        referenceId: jobId,
        site
    });

    if (deductError) {
        console.error('[Verify] Failed to deduct points:', deductError);
        return 0;
    }

    return Number(deductData?.deducted) || amount;
}

async function syncTrackedJobStatus({
    userId,
    site = 'cn',
    email = '',
    jobId,
    apiData = {},
    config = null
}) {
    if (!userId || !jobId) {
        return { pointsDeducted: 0, record: null };
    }

    const lockKey = `${site}:${userId}:${jobId}`;
    return withJobSyncLock(lockKey, async () => {
        let existingRecord = await findTrackedJobLog(userId, jobId, site);
        const existingPayload = parseHistoryMessage(existingRecord?.message) || {};
        const normalizedApiData = normalizeVerifyJobPayload(apiData, {
            job_id: jobId,
            task_type: existingPayload.task_type || DEFAULT_VERIFY_TASK_TYPE
        });
        const upstreamStatus = String(normalizedApiData?.status || '').toLowerCase();
        const taskType = normalizeVerifyTaskType(normalizedApiData?.task_type || existingPayload.task_type);

        if (!upstreamStatus) {
            return {
                pointsDeducted: Number(existingRecord?.points_deducted) || 0,
                record: existingRecord
            };
        }

        if (!isTerminalTrackedStatus(upstreamStatus)) {
            existingRecord = await upsertTrackedJobLog({
                existingRecord,
                userId,
                site,
                email,
                jobId,
                status: upstreamStatus,
                apiData: normalizedApiData,
                pointsDeducted: Number(existingRecord?.points_deducted) || 0
            });

            return {
                pointsDeducted: Number(existingRecord?.points_deducted) || 0,
                record: existingRecord
            };
        }

        if (existingRecord && isTerminalTrackedStatus(existingRecord.status)) {
            const existingTerminalStatus = String(existingRecord.status || '').toLowerCase();
            if (existingTerminalStatus === 'success' || upstreamStatus !== 'success') {
                return {
                    pointsDeducted: Number(existingRecord.points_deducted) || 0,
                    record: existingRecord
                };
            }
        }

        let pointsDeducted = Number(existingRecord?.points_deducted) || 0;
        const runtimeConfig = config || await getVerifyConfig();

        if (upstreamStatus === 'success') {
            pointsDeducted = await deductPointsForJob(
                userId,
                jobId,
                getVerifyPriceForTaskType(runtimeConfig, taskType),
                site,
                taskType
            );
        }

        existingRecord = await upsertTrackedJobLog({
            existingRecord,
            userId,
            site,
            email,
            jobId,
            status: upstreamStatus === 'success' ? 'success' : 'failed',
            apiData: normalizedApiData,
            pointsDeducted
        });

        return { pointsDeducted, record: existingRecord };
    });
}

async function fetchUpstreamJobStatus(config, jobId, options = {}) {
    const candidateApiKeys = normalizeVerifyCredentialList([
        options.apiKey,
        config.apiKeys,
        config.apiKey
    ]);

    let lastError = null;
    let lastNotFound = null;

    for (const apiKey of candidateApiKeys) {
        const upstream = await postVerifyProviderAction(config, {
            action: 'get_status',
            cdkey: apiKey,
            task_id: jobId
        });

        if (upstream.ok) {
            return {
                ok: true,
                data: normalizeVerifyJobPayload(upstream.payload, {
                    job_id: jobId,
                    task_type: options.taskType || DEFAULT_VERIFY_TASK_TYPE,
                    provider_key_fingerprint: buildVerifyCredentialFingerprint(apiKey),
                    provider_key_name: maskVerifyCredential(apiKey)
                })
            };
        }

        const errorCode = getApiErrorCode(upstream.payload);
        const errorMessage = getApiErrorMessage(upstream.payload, '查询状态失败');
        const currentError = {
            status: upstream.status || 502,
            code: errorCode,
            message: errorMessage
        };

        if (
            upstream.status === 404
            || errorCode === 'job_not_found'
            || /任务不存在|not found/i.test(errorMessage)
        ) {
            lastNotFound = currentError;
            continue;
        }

        lastError = currentError;
    }

    if (lastError) {
        return {
            ok: false,
            status: lastError.status,
            code: lastError.code,
            message: lastError.message
        };
    }

    const missingJobError = lastNotFound || {
        status: 404,
        code: 'job_not_found',
        message: '任务不存在'
    };

    return {
        ok: true,
        data: normalizeVerifyJobPayload({
            job_id: jobId,
            status: 'failed',
            error: missingJobError.code || 'job_not_found',
            message: missingJobError.message || '任务不存在'
        }, {
            task_type: options.taskType || DEFAULT_VERIFY_TASK_TYPE
        })
    };
}

async function buildLocalVerifyQueueSnapshot(config = {}) {
    const { data, error } = await supabase
        .from('verification_logs')
        .select('status')
        .in('status', ACTIVE_TRACKED_JOB_STATUSES)
        .limit(5000);

    if (error) {
        throw error;
    }

    const rows = Array.isArray(data) ? data : [];
    const queueSize = rows.filter((row) => ['queued', 'pending'].includes(String(row?.status || '').trim().toLowerCase())).length;
    const runningJobs = rows.filter((row) => ['running', 'processing'].includes(String(row?.status || '').trim().toLowerCase())).length;

    return {
        queue_size: queueSize,
        running_jobs: runningJobs,
        key_name: Number(config.keyCount || 0) > 1
            ? `CDKey 池（${Number(config.keyCount || 0)}）`
            : maskVerifyCredential(config.apiKey)
    };
}

async function loadPendingTrackedJobs(limit = PENDING_JOB_SWEEP_BATCH_SIZE) {
    try {
        const { data, error } = await supabase
            .from('verification_logs')
            .select('*')
            .in('status', ACTIVE_TRACKED_JOB_STATUSES)
            .order('created_at', { ascending: true })
            .limit(limit);

        if (error) {
            console.warn('[VerifyWorker] Failed to load pending jobs:', error.message);
            return [];
        }

        const seen = new Set();
        const jobs = [];

        for (const row of data || []) {
            const payload = parseHistoryMessage(row.message) || {};
            const jobId = String(payload.job_id || row.verification_id || '').trim();
            const userId = String(row.user_id || '').trim();
            const site = String(row.site || 'cn').trim() || 'cn';
            const email = String(payload.email || '').trim().toLowerCase();
            if (!jobId || !userId) continue;

            const uniqueKey = `${site}:${userId}:${jobId}`;
            if (seen.has(uniqueKey)) continue;
            seen.add(uniqueKey);
            jobs.push({ jobId, userId, site, email });
        }

        return jobs;
    } catch (error) {
        console.warn('[VerifyWorker] Pending job load failed:', error.message);
        return [];
    }
}

async function sweepPendingJobs() {
    if (pendingJobSweepRunning) return;
    pendingJobSweepRunning = true;

    try {
        const config = await getVerifyConfig();
        if (!config.apiKey) return;

        const pendingJobs = await loadPendingTrackedJobs();

        for (const job of pendingJobs) {
            const upstream = await fetchUpstreamJobStatus(config, job.jobId);
            if (!upstream.ok) {
                console.warn(`[VerifyWorker] Failed to poll ${job.jobId}: ${upstream.message}`);
                continue;
            }

            await syncTrackedJobStatus({
                userId: job.userId,
                site: job.site,
                email: job.email,
                jobId: job.jobId,
                apiData: upstream.data,
                config
            });
        }
    } catch (error) {
        console.error('[VerifyWorker] Pending job sweep failed:', error);
    } finally {
        pendingJobSweepRunning = false;
    }
}

function startPendingJobSweep() {
    if (pendingJobSweepTimer) return;

    pendingJobSweepTimer = setInterval(() => {
        sweepPendingJobs().catch((error) => {
            console.error('[VerifyWorker] Sweep tick failed:', error);
        });
    }, PENDING_JOB_SWEEP_INTERVAL_MS);

    setTimeout(() => {
        sweepPendingJobs().catch((error) => {
            console.error('[VerifyWorker] Initial sweep failed:', error);
        });
    }, 1200);
}

function getShopDeliveryWorkerName() {
    return String(
        process.env.SHOP_DELIVERY_WORKER_NAME
        || process.env.RAILWAY_SERVICE_NAME
        || `shop-delivery-worker:${process.pid}`
    ).trim();
}

function clampDeliveryText(value, limit = 4000) {
    if (value == null) return null;
    const text = String(value);
    return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function normalizeShopDeliveryUrl(targetUrl) {
    const raw = String(targetUrl || '').trim();
    if (!raw) return null;

    try {
        const parsed = new URL(raw);
        const host = String(parsed.host || '').trim().toLowerCase();
        const path = parsed.pathname || '/';
        if (!host) return null;
        return {
            host,
            path: path || '/',
            targetKey: `${host}${path || '/'}`,
            channelKey: host
        };
    } catch (_) {
        return null;
    }
}

function getShopDeliveryTargetKey(task = {}) {
    const explicit = String(task.target_key || '').trim().toLowerCase();
    if (explicit) return explicit;
    return normalizeShopDeliveryUrl(task.target_url)?.targetKey || null;
}

function getShopDeliveryChannelKey(task = {}) {
    const explicit = String(task.channel_key || '').trim().toLowerCase();
    if (explicit) return explicit;
    return normalizeShopDeliveryUrl(task.target_url)?.channelKey || null;
}

function createShopDeliveryConflict(scope, reasonKey, waitMs = 0, detail = '') {
    const normalizedScope = String(scope || 'worker').trim().toLowerCase() || 'worker';
    const normalizedReason = String(reasonKey || 'unknown_conflict').trim().toLowerCase() || 'unknown_conflict';
    const normalizedWaitMs = Math.max(0, Number(waitMs || 0));
    return {
        scope: normalizedScope,
        reasonKey: normalizedReason,
        waitMs: normalizedWaitMs,
        waitSeconds: Math.max(0, Math.ceil(normalizedWaitMs / 1000)),
        detail: detail || `${normalizedScope}:${normalizedReason}`
    };
}

function isShopDeliveryReservationStaleResult(result = {}) {
    const reasonKey = String(result?.reasonKey || result?.reason_key || '').trim().toLowerCase();
    return reasonKey === 'lock_token_mismatch' || reasonKey === 'task_missing';
}

async function acquireShopDeliveryExecutionReservation(task, strategy = null) {
    const config = strategy || cachedShopDeliveryStrategy || normalizeShopDeliveryStrategyConfig({}, process.env);
    const targetKey = getShopDeliveryTargetKey(task);
    const channelKey = getShopDeliveryChannelKey(task);
    const { data, error } = await supabase.rpc('fn_acquire_shop_delivery_execution_reservation', {
        p_task_id: task.id,
        p_lock_token: task.lock_token || null,
        p_worker_name: task.worker_name || getShopDeliveryWorkerName(),
        p_target_key: targetKey,
        p_channel_key: channelKey,
        p_target_max_inflight: Math.max(1, Number(config?.target_max_inflight || 1)),
        p_target_min_interval_ms: Math.max(0, Number(config?.target_min_interval_ms || 0)),
        p_channel_max_inflight: Math.max(1, Number(config?.channel_max_inflight || 2)),
        p_channel_min_interval_ms: Math.max(0, Number(config?.channel_min_interval_ms || 0)),
        p_lease_seconds: Math.max(30, Number(config?.lease_seconds || 120))
    });

    if (error) {
        throw error;
    }

    const result = Array.isArray(data) ? (data[0] || null) : data;
    if (!result || result.acquired) {
        if (result?.target_key) {
            task.target_key = result.target_key;
        }
        if (result?.channel_key) {
            task.channel_key = result.channel_key;
        }
        return {
            acquired: true,
            stale: false,
            conflict: null
        };
    }

    return {
        acquired: false,
        stale: isShopDeliveryReservationStaleResult(result),
        conflict: createShopDeliveryConflict(
            result.scope || 'worker',
            result.reason_key || 'unknown_conflict',
            Number(result.wait_ms || 0),
            result.detail || `${result.scope || 'worker'}:${result.reason_key || 'unknown_conflict'}`
        )
    };
}

async function getShopDeliveryStrategy(options = {}) {
    const forceRefresh = options?.forceRefresh === true;
    const now = Date.now();

    if (
        !forceRefresh
        && cachedShopDeliveryStrategy
        && cachedShopDeliveryStrategyAt
        && (now - cachedShopDeliveryStrategyAt) < SHOP_DELIVERY_STRATEGY_CACHE_TTL_MS
    ) {
        return cachedShopDeliveryStrategy;
    }

    try {
        const strategy = await loadShopDeliveryStrategyConfig(supabase, process.env);
        cachedShopDeliveryStrategy = strategy;
        cachedShopDeliveryStrategyAt = now;
        return strategy;
    } catch (error) {
        const fallback = cachedShopDeliveryStrategy || normalizeShopDeliveryStrategyConfig({}, process.env);
        cachedShopDeliveryStrategy = fallback;
        cachedShopDeliveryStrategyAt = now;
        console.warn('[ShopDeliveryWorker] Failed to load strategy config:', error.message);
        return fallback;
    }
}

function buildShopDeliveryBackoffSeconds(attemptCount, strategy = null) {
    const safeAttempt = Math.max(1, Number(attemptCount || 1));
    const config = strategy || cachedShopDeliveryStrategy || normalizeShopDeliveryStrategyConfig({}, process.env);
    const baseBackoffSeconds = Math.max(15, Number(config?.base_backoff_seconds || 30));
    const maxBackoffSeconds = Math.max(baseBackoffSeconds, Number(config?.max_backoff_seconds || 1800));

    return Math.min(
        maxBackoffSeconds,
        Math.max(15, Math.pow(2, safeAttempt - 1) * baseBackoffSeconds)
    );
}

function isRetryableDeliveryStatus(status) {
    const code = Number(status || 0);
    return !code || code === 408 || code === 409 || code === 425 || code === 429 || code >= 500;
}

async function claimShopDeliveryTasks(limit = null, strategy = null) {
    const config = strategy || await getShopDeliveryStrategy();
    const taskLimit = Math.max(1, Number(limit || config?.sweep_batch_size || 10));
    const leaseSeconds = Math.max(30, Number(config?.lease_seconds || 120));

    const { data, error } = await supabase.rpc('fn_claim_shop_webhook_tasks', {
        p_limit: taskLimit,
        p_lock_seconds: leaseSeconds,
        p_worker_name: getShopDeliveryWorkerName()
    });

    if (error) {
        throw error;
    }

    return Array.isArray(data) ? data : [];
}

async function loadShopDeliveryContext(orderId) {
    if (!orderId) return null;

    const { data: order, error: orderError } = await supabase
        .from('shop_orders')
        .select('id, user_id, product_id, total_price, item_count, snapshot_product_name, delivery_status, delivery_attempt_count, delivery_last_error, created_at')
        .eq('id', orderId)
        .single();

    if (orderError || !order) {
        return null;
    }

    const { data: items } = await supabase
        .from('shop_order_items')
        .select('id, snapshot_product_name, price_paid, inventory_id')
        .eq('order_id', orderId)
        .order('created_at', { ascending: true });

    return {
        ...order,
        items: Array.isArray(items) ? items : []
    };
}

function buildShopDeliveryPayload(task, orderContext) {
    const basePayload = task && typeof task.payload === 'object' && task.payload !== null
        ? task.payload
        : {};

    return {
        ...basePayload,
        _meta: {
            source: 'zaoyoe_shop_delivery_worker',
            task_id: task.id,
            order_id: task.order_id,
            dedupe_key: task.dedupe_key,
            target_key: getShopDeliveryTargetKey(task),
            channel_key: getShopDeliveryChannelKey(task),
            attempt_no: task.attempt_count,
            worker_name: task.worker_name || getShopDeliveryWorkerName(),
            requested_at: new Date().toISOString()
        },
        order: orderContext ? {
            id: orderContext.id,
            user_id: orderContext.user_id,
            product_id: orderContext.product_id,
            product_name: orderContext.snapshot_product_name,
            total_price: orderContext.total_price,
            item_count: orderContext.item_count,
            created_at: orderContext.created_at
        } : undefined,
        items: orderContext?.items || []
    };
}

async function recordShopDeliveryAttempt({
    task,
    success,
    responseStatus = null,
    responseBody = null,
    errorMessage = null,
    startedAt,
    finishedAt,
    durationMs
}) {
    try {
        await supabase
            .from('shop_webhook_task_attempts')
            .insert({
                task_id: task.id,
                attempt_no: Number(task.attempt_count || 0),
                worker_name: task.worker_name || getShopDeliveryWorkerName(),
                started_at: startedAt,
                finished_at: finishedAt,
                success,
                response_status: responseStatus,
                response_body: clampDeliveryText(responseBody, 4000),
                error_message: clampDeliveryText(errorMessage, 1000),
                duration_ms: durationMs
            });
    } catch (error) {
        console.warn('[ShopDeliveryWorker] Failed to record task attempt:', error.message);
    }
}

async function recordShopDeliveryConflict(task, conflict = {}, strategy = null) {
    if (!task?.id) return null;

    const config = strategy || await getShopDeliveryStrategy();
    const waitSeconds = Math.max(
        5,
        Number(config?.conflict_backoff_seconds || 45),
        Number(conflict.waitSeconds || 0)
    );
    const strategySnapshot = {
        worker_parallelism: Number(config?.worker_parallelism || 1),
        target_min_interval_ms: Number(config?.target_min_interval_ms || 0),
        target_max_inflight: Number(config?.target_max_inflight || 1),
        channel_min_interval_ms: Number(config?.channel_min_interval_ms || 0),
        channel_max_inflight: Number(config?.channel_max_inflight || 2),
        conflict_backoff_seconds: Number(config?.conflict_backoff_seconds || 45),
        conflict_dead_letter_threshold: Number(config?.conflict_dead_letter_threshold || 0)
    };

    const { data, error } = await supabase.rpc('fn_record_shop_delivery_conflict', {
        p_task_id: task.id,
        p_lock_token: task.lock_token || null,
        p_scope: String(conflict.scope || 'worker').trim().toLowerCase() || 'worker',
        p_reason_key: String(conflict.reasonKey || 'unknown_conflict').trim().toLowerCase() || 'unknown_conflict',
        p_detail: clampDeliveryText(conflict.detail, 1000),
        p_worker_name: task.worker_name || getShopDeliveryWorkerName(),
        p_target_key: getShopDeliveryTargetKey(task),
        p_channel_key: getShopDeliveryChannelKey(task),
        p_strategy_snapshot: strategySnapshot,
        p_backoff_seconds: waitSeconds,
        p_conflict_dead_letter_threshold: Math.max(0, Number(config?.conflict_dead_letter_threshold || 0))
    });

    if (error) {
        console.warn('[ShopDeliveryWorker] Conflict RPC failed, falling back to direct requeue:', error.message);
        const fallbackNextAttemptAt = new Date(Date.now() + waitSeconds * 1000).toISOString();
        const fallbackError = `冲突保护已重排队: ${conflict.detail || `${conflict.scope || 'worker'}/${conflict.reasonKey || 'unknown_conflict'}`}`;
        const { error: fallbackUpdateError } = await supabase
            .from('shop_webhook_tasks')
            .update({
                status: 'retry_waiting',
                next_attempt_at: fallbackNextAttemptAt,
                last_error: clampDeliveryText(fallbackError, 1000),
                updated_at: new Date().toISOString(),
                locked_at: null,
                lock_expires_at: null,
                lock_token: null,
                worker_name: null,
                reservation_acquired_at: null,
                reservation_lock_token: null,
                reservation_worker_name: null
            })
            .eq('id', task.id)
            .eq('lock_token', task.lock_token);

        if (fallbackUpdateError) {
            throw fallbackUpdateError;
        }

        if (task.order_id) {
            await supabase
                .from('shop_orders')
                .update({
                    delivery_status: 'retry_waiting',
                    delivery_last_error: clampDeliveryText(fallbackError, 1000),
                    delivery_updated_at: new Date().toISOString()
                })
                .eq('id', task.order_id);
        }

        return {
            status: 'retry_waiting',
            next_attempt_at: fallbackNextAttemptAt,
            conflict_count: Number(task.conflict_count || 0),
            dead_lettered: false,
            fallback: true
        };
    }

    if (!data) return null;
    if (Array.isArray(data)) return data[0] || null;
    return data;
}

async function markShopDeliveryTaskSuccess(task, responseStatus, responseBody) {
    const now = new Date().toISOString();
    const updatePayload = {
        status: 'delivered',
        last_response_status: responseStatus,
        last_response_body: clampDeliveryText(responseBody, 4000),
        last_error: null,
        delivered_at: now,
        executed_at: now,
        updated_at: now,
        locked_at: null,
        lock_expires_at: null,
        lock_token: null,
        reservation_acquired_at: null,
        reservation_lock_token: null,
        reservation_worker_name: null
    };

    const { error: taskError } = await supabase
        .from('shop_webhook_tasks')
        .update(updatePayload)
        .eq('id', task.id)
        .eq('lock_token', task.lock_token);

    if (taskError) {
        throw taskError;
    }

    const { error: orderError } = await supabase
        .from('shop_orders')
        .update({
            delivery_status: 'delivered',
            delivery_task_id: task.id,
            delivery_attempt_count: Number(task.attempt_count || 0),
            delivery_last_error: null,
            delivery_completed_at: now,
            delivery_updated_at: now
        })
        .eq('id', task.order_id);

    if (orderError) {
        throw orderError;
    }
}

async function markShopDeliveryTaskFailure(task, failure = {}, strategy = null) {
    const now = new Date();
    const config = strategy || await getShopDeliveryStrategy();
    const retryable = failure.retryable !== false && isRetryableDeliveryStatus(failure.status);
    const maxAttempts = Math.max(1, Number(task.max_attempts || config?.max_attempts || 5));
    const attemptCount = Math.max(1, Number(task.attempt_count || 1));
    const exhausted = attemptCount >= maxAttempts;
    const shouldDeadLetter = !retryable || exhausted;
    const nextAttemptAt = new Date(now.getTime() + buildShopDeliveryBackoffSeconds(attemptCount, config) * 1000).toISOString();
    const status = shouldDeadLetter ? 'dead_letter' : 'retry_waiting';
    const errorMessage = clampDeliveryText(failure.message || '履约推送失败', 1000);
    const responseBody = clampDeliveryText(failure.body, 4000);

    const { error: taskError } = await supabase
        .from('shop_webhook_tasks')
        .update({
            status,
            next_attempt_at: shouldDeadLetter ? nextAttemptAt : nextAttemptAt,
            last_error: errorMessage,
            last_response_status: failure.status || null,
            last_response_body: responseBody,
            updated_at: now.toISOString(),
            dead_lettered_at: shouldDeadLetter ? now.toISOString() : null,
            locked_at: null,
            lock_expires_at: null,
            lock_token: null,
            reservation_acquired_at: null,
            reservation_lock_token: null,
            reservation_worker_name: null
        })
        .eq('id', task.id)
        .eq('lock_token', task.lock_token);

    if (taskError) {
        throw taskError;
    }

    const { error: orderError } = await supabase
        .from('shop_orders')
        .update({
            delivery_status: status,
            delivery_task_id: task.id,
            delivery_attempt_count: attemptCount,
            delivery_last_error: errorMessage,
            delivery_updated_at: now.toISOString()
        })
        .eq('id', task.order_id);

    if (orderError) {
        throw orderError;
    }
}

async function executeShopDeliveryTask(task, strategy = null) {
    const config = strategy || await getShopDeliveryStrategy();
    const startedAt = new Date();
    const orderContext = await loadShopDeliveryContext(task.order_id);

    if (orderContext?.delivery_status === 'delivered') {
        const finishedAt = new Date();
        await markShopDeliveryTaskSuccess(task, 208, 'order already marked delivered');
        await recordShopDeliveryAttempt({
            task,
            success: true,
            responseStatus: 208,
            responseBody: 'order already marked delivered',
            startedAt: startedAt.toISOString(),
            finishedAt: finishedAt.toISOString(),
            durationMs: finishedAt.getTime() - startedAt.getTime()
        });
        return;
    }

    if (!task.target_url) {
        const finishedAt = new Date();
        await markShopDeliveryTaskFailure(task, {
            status: 400,
            retryable: false,
            message: '未配置履约目标地址'
        }, config);
        await recordShopDeliveryAttempt({
            task,
            success: false,
            responseStatus: 400,
            errorMessage: '未配置履约目标地址',
            startedAt: startedAt.toISOString(),
            finishedAt: finishedAt.toISOString(),
            durationMs: finishedAt.getTime() - startedAt.getTime()
        });
        return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(3000, Number(config?.http_timeout_ms || 15000)));
    let responseStatus = null;
    let responseBody = '';

    try {
        const response = await fetch(task.target_url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Zaoyoe-Shop-Delivery-Worker/1.0',
                'X-Zaoyoe-Delivery-Task': String(task.id),
                'X-Zaoyoe-Order-Id': String(task.order_id),
                'Idempotency-Key': task.dedupe_key || `shop_delivery:${task.order_id}`
            },
            body: JSON.stringify(buildShopDeliveryPayload(task, orderContext)),
            signal: controller.signal
        });

        responseStatus = response.status;
        responseBody = await response.text();
        clearTimeout(timeout);

        if (response.ok) {
            const finishedAt = new Date();
            await markShopDeliveryTaskSuccess(task, responseStatus, responseBody);
            await recordShopDeliveryAttempt({
                task,
                success: true,
                responseStatus,
                responseBody,
                startedAt: startedAt.toISOString(),
                finishedAt: finishedAt.toISOString(),
                durationMs: finishedAt.getTime() - startedAt.getTime()
            });
            return;
        }

        const finishedAt = new Date();
        await markShopDeliveryTaskFailure(task, {
            status: responseStatus,
            body: responseBody,
            retryable: isRetryableDeliveryStatus(responseStatus),
            message: `履约接口返回 ${responseStatus}`
        }, config);
        await recordShopDeliveryAttempt({
            task,
            success: false,
            responseStatus,
            responseBody,
            errorMessage: `履约接口返回 ${responseStatus}`,
            startedAt: startedAt.toISOString(),
            finishedAt: finishedAt.toISOString(),
            durationMs: finishedAt.getTime() - startedAt.getTime()
        });
    } catch (error) {
        clearTimeout(timeout);
        const finishedAt = new Date();
        const isAbort = error?.name === 'AbortError';
        await markShopDeliveryTaskFailure(task, {
            status: isAbort ? 408 : null,
            retryable: true,
            message: isAbort ? '履约请求超时' : (error?.message || '履约请求失败')
        }, config);
        await recordShopDeliveryAttempt({
            task,
            success: false,
            responseStatus: isAbort ? 408 : null,
            errorMessage: isAbort ? '履约请求超时' : (error?.message || '履约请求失败'),
            startedAt: startedAt.toISOString(),
            finishedAt: finishedAt.toISOString(),
            durationMs: finishedAt.getTime() - startedAt.getTime()
        });
    }
}

async function handleShopDeliveryExecutionConflict(task, conflict = {}, strategy = null) {
    const config = strategy || await getShopDeliveryStrategy();
    const result = await recordShopDeliveryConflict(task, conflict, config);

    if (result?.dead_lettered) {
        console.warn(
            `[ShopDeliveryWorker] Task ${task.id} moved to dead letter by conflict strategy:`,
            `${conflict.scope || 'worker'}/${conflict.reasonKey || 'unknown_conflict'}`
        );
        return;
    }

    console.info(
        `[ShopDeliveryWorker] Task ${task.id} requeued by conflict strategy:`,
        `${conflict.scope || 'worker'}/${conflict.reasonKey || 'unknown_conflict'}`,
        conflict.detail || ''
    );
}

async function processShopDeliveryTaskBatch(tasks = [], strategy = null) {
    const config = strategy || await getShopDeliveryStrategy();
    const queue = Array.isArray(tasks) ? [...tasks] : [];
    if (!queue.length) return;

    const parallelism = Math.min(
        queue.length,
        Math.max(1, Number(config?.worker_parallelism || 1))
    );

    const workers = Array.from({ length: parallelism }, async () => {
        while (queue.length) {
            const task = queue.shift();
            if (!task) return;

            let reservation;
            try {
                reservation = await acquireShopDeliveryExecutionReservation(task, config);
            } catch (error) {
                console.error(`[ShopDeliveryWorker] Failed to acquire reservation for task ${task.id}:`, error);
                continue;
            }

            if (!reservation?.acquired) {
                if (reservation?.stale) {
                    console.info(`[ShopDeliveryWorker] Skip stale reservation for task ${task.id}`);
                    continue;
                }

                try {
                    await handleShopDeliveryExecutionConflict(task, reservation?.conflict, config);
                } catch (error) {
                    console.error(`[ShopDeliveryWorker] Failed to apply conflict strategy for task ${task.id}:`, error);
                }
                continue;
            }

            try {
                await executeShopDeliveryTask(task, config);
            } catch (error) {
                console.error(`[ShopDeliveryWorker] Task ${task.id} failed unexpectedly:`, error);
            }
        }
    });

    await Promise.all(workers);
}

async function sweepShopDeliveryTasks() {
    if (shopDeliverySweepRunning) return;
    shopDeliverySweepRunning = true;

    try {
        const strategy = await getShopDeliveryStrategy();
        const tasks = await claimShopDeliveryTasks(strategy?.sweep_batch_size, strategy);
        await processShopDeliveryTaskBatch(tasks, strategy);
    } catch (error) {
        console.error('[ShopDeliveryWorker] Sweep failed:', error);
    } finally {
        shopDeliverySweepRunning = false;
    }
}

async function queueNextShopDeliverySweep(delayMs = null) {
    if (shopDeliverySweepTimer) return;

    const strategy = await getShopDeliveryStrategy();
    const nextDelay = Math.max(1000, Number(delayMs ?? strategy?.sweep_interval_ms ?? 10000));

    shopDeliverySweepTimer = setTimeout(() => {
        shopDeliverySweepTimer = null;
        sweepShopDeliveryTasks()
            .catch((error) => {
                console.error('[ShopDeliveryWorker] Sweep tick failed:', error);
            })
            .finally(() => {
                queueNextShopDeliverySweep().catch((error) => {
                    console.error('[ShopDeliveryWorker] Failed to schedule next sweep:', error);
                });
            });
    }, nextDelay);
}

function startShopDeliverySweep() {
    if (shopDeliverySweepTimer) return;

    queueNextShopDeliverySweep(1800).catch((error) => {
        console.error('[ShopDeliveryWorker] Failed to start sweep:', error);
    });
}

function getOpsAlertWorkerName() {
    return String(
        process.env.OPS_ALERT_WORKER_NAME
        || process.env.RAILWAY_STATIC_URL
        || process.env.HOSTNAME
        || 'ops-alert-worker'
    ).trim();
}

async function sweepExternalOpsAlerts() {
    if (opsAlertSweepRunning) return;
    opsAlertSweepRunning = true;

    try {
        const result = await sweepOpsAlertJobs(supabase, {
            env: process.env,
            workerName: getOpsAlertWorkerName()
        });

        if (Number(result?.claimed || 0) > 0) {
            console.log('[OpsAlertWorker] Sweep complete:', JSON.stringify(result));
        }
    } catch (error) {
        console.error('[OpsAlertWorker] Sweep failed:', error);
    } finally {
        opsAlertSweepRunning = false;
    }
}

async function queueNextOpsAlertSweep(delayMs = null) {
    if (opsAlertSweepTimer) return;

    let nextDelay = 15000;
    try {
        const runtime = await loadOpsAlertsRuntimeConfig(supabase, process.env);
        nextDelay = Math.max(1000, Number(delayMs ?? runtime?.config?.sweep_interval_ms ?? 15000));
    } catch (error) {
        nextDelay = Math.max(1000, Number(delayMs ?? 15000));
        console.warn('[OpsAlertWorker] Failed to load runtime config for next sweep:', error.message);
    }

    opsAlertSweepTimer = setTimeout(() => {
        opsAlertSweepTimer = null;
        sweepExternalOpsAlerts()
            .catch((error) => {
                console.error('[OpsAlertWorker] Sweep tick failed:', error);
            })
            .finally(() => {
                queueNextOpsAlertSweep().catch((error) => {
                    console.error('[OpsAlertWorker] Failed to schedule next sweep:', error);
                });
            });
    }, nextDelay);
}

function startOpsAlertSweep() {
    if (opsAlertSweepTimer) return;

    queueNextOpsAlertSweep(2200).catch((error) => {
        console.error('[OpsAlertWorker] Failed to start sweep:', error);
    });
}

async function sweepPaymentConfigChangeHealth() {
    if (paymentConfigChangeSweepRunning) return;
    paymentConfigChangeSweepRunning = true;

    try {
        const result = await runPaymentConfigChangedSweep(supabase, {
            env: process.env
        });

        if (
            Number(result?.change_count || 0) > 0
            || Number(result?.queued || 0) > 0
            || Number(result?.incident_count || 0) > 0
            || Number(result?.incident_queued || 0) > 0
            || Number(result?.incident_recovered_count || 0) > 0
            || Number(result?.incident_recovered_queued || 0) > 0
            || Number(result?.recovery_count || 0) > 0
            || Number(result?.recovered_queued || 0) > 0
            || Number(result?.admin_notifications_created || 0) > 0
        ) {
            console.log('[PaymentConfigChangeMonitor] Sweep complete:', JSON.stringify(result));
        }
    } catch (error) {
        console.error('[PaymentConfigChangeMonitor] Sweep failed:', error);
    } finally {
        paymentConfigChangeSweepRunning = false;
    }
}

async function queueNextPaymentConfigChangeSweep(delayMs = null) {
    if (paymentConfigChangeSweepTimer) return;

    const monitorConfig = normalizePaymentConfigChangeMonitorConfig({}, process.env);
    const nextDelay = Math.max(10000, Number(delayMs ?? monitorConfig.sweep_interval_ms ?? 10 * 60 * 1000));

    paymentConfigChangeSweepTimer = setTimeout(() => {
        paymentConfigChangeSweepTimer = null;
        sweepPaymentConfigChangeHealth()
            .catch((error) => {
                console.error('[PaymentConfigChangeMonitor] Sweep tick failed:', error);
            })
            .finally(() => {
                queueNextPaymentConfigChangeSweep().catch((error) => {
                    console.error('[PaymentConfigChangeMonitor] Failed to schedule next sweep:', error);
                });
            });
    }, nextDelay);
}

function startPaymentConfigChangeSweep() {
    if (paymentConfigChangeSweepTimer) return;

    queueNextPaymentConfigChangeSweep(2800).catch((error) => {
        console.error('[PaymentConfigChangeMonitor] Failed to start sweep:', error);
    });
}

async function sweepPaymentGatewayHealth() {
    if (paymentGatewaySweepRunning) return;
    paymentGatewaySweepRunning = true;

    try {
        const result = await runPaymentGatewayDegradationSweep(supabase, {
            env: process.env
        });

        if (
            Number(result?.degraded_count || 0) > 0
            || Number(result?.queued || 0) > 0
            || Number(result?.recovered_count || 0) > 0
            || Number(result?.recovered_queued || 0) > 0
            || Number(result?.admin_notifications_created || 0) > 0
        ) {
            console.log('[PaymentGatewayMonitor] Sweep complete:', JSON.stringify(result));
        }
    } catch (error) {
        console.error('[PaymentGatewayMonitor] Sweep failed:', error);
    } finally {
        paymentGatewaySweepRunning = false;
    }
}

async function queueNextPaymentGatewaySweep(delayMs = null) {
    if (paymentGatewaySweepTimer) return;

    let monitorConfig = normalizePaymentGatewayMonitorConfig({}, process.env);
    try {
        const runtime = await loadOpsAlertsRuntimeConfig(supabase, process.env);
        monitorConfig = normalizePaymentGatewayMonitorConfig(
            runtime?.config?.payment_gateway && typeof runtime.config.payment_gateway === 'object'
                ? runtime.config.payment_gateway
                : {},
            process.env
        );
    } catch (error) {
        console.warn('[PaymentGatewayMonitor] Failed to load runtime config for scheduling, falling back to default config:', error.message || error);
    }
    const nextDelay = Math.max(10000, Number(delayMs ?? monitorConfig.sweep_interval_ms ?? 5 * 60 * 1000));

    paymentGatewaySweepTimer = setTimeout(() => {
        paymentGatewaySweepTimer = null;
        sweepPaymentGatewayHealth()
            .catch((error) => {
                console.error('[PaymentGatewayMonitor] Sweep tick failed:', error);
            })
            .finally(() => {
                queueNextPaymentGatewaySweep().catch((error) => {
                    console.error('[PaymentGatewayMonitor] Failed to schedule next sweep:', error);
                });
            });
    }, nextDelay);
}

function startPaymentGatewaySweep() {
    if (paymentGatewaySweepTimer) return;

    queueNextPaymentGatewaySweep(3200).catch((error) => {
        console.error('[PaymentGatewayMonitor] Failed to start sweep:', error);
    });
}

async function sweepVerifyQuotaHealth() {
    if (verifyQuotaSweepRunning) return;
    verifyQuotaSweepRunning = true;

    try {
        const verifyConfig = await getVerifyConfig();
        const result = await runVerifyQuotaLowSweep(supabase, {
            env: process.env,
            verifyConfig
        });

        if (Number(result?.low_quota_count || 0) > 0 || Number(result?.queued || 0) > 0) {
            console.log('[VerifyQuotaMonitor] Sweep complete:', JSON.stringify(result));
        }
    } catch (error) {
        console.error('[VerifyQuotaMonitor] Sweep failed:', error);
    } finally {
        verifyQuotaSweepRunning = false;
    }
}

async function queueNextVerifyQuotaSweep(delayMs = null) {
    if (verifyQuotaSweepTimer) return;

    const verifyConfig = await getVerifyConfig();
    let monitorConfig = normalizeVerifyQuotaMonitorConfig(verifyConfig?.monitorConfig, process.env);
    try {
        const runtime = await loadOpsAlertsRuntimeConfig(supabase, process.env);
        monitorConfig = normalizeVerifyQuotaMonitorConfig({
            ...(verifyConfig?.monitorConfig && typeof verifyConfig.monitorConfig === 'object' ? verifyConfig.monitorConfig : {}),
            ...(runtime?.config?.verify_quota && typeof runtime.config.verify_quota === 'object' ? runtime.config.verify_quota : {})
        }, process.env);
    } catch (error) {
        console.warn('[VerifyQuotaMonitor] Failed to load runtime config for scheduling, falling back to legacy config:', error.message || error);
    }
    const nextDelay = Math.max(10000, Number(delayMs ?? monitorConfig.sweep_interval_ms ?? 15 * 60 * 1000));

    verifyQuotaSweepTimer = setTimeout(() => {
        verifyQuotaSweepTimer = null;
        sweepVerifyQuotaHealth()
            .catch((error) => {
                console.error('[VerifyQuotaMonitor] Sweep tick failed:', error);
            })
            .finally(() => {
                queueNextVerifyQuotaSweep().catch((error) => {
                    console.error('[VerifyQuotaMonitor] Failed to schedule next sweep:', error);
                });
            });
    }, nextDelay);
}

function startVerifyQuotaSweep() {
    if (verifyQuotaSweepTimer) return;

    queueNextVerifyQuotaSweep(4200).catch((error) => {
        console.error('[VerifyQuotaMonitor] Failed to start sweep:', error);
    });
}

async function sweepVerifyServiceHealth() {
    if (verifyServiceSweepRunning) return;
    verifyServiceSweepRunning = true;

    try {
        const verifyConfig = await getVerifyConfig();
        const result = await runVerifyServiceDisabledSweep(supabase, {
            env: process.env,
            verifyConfig
        });

        if (Number(result?.disabled_count || 0) > 0 || Number(result?.queued || 0) > 0) {
            console.log('[VerifyServiceMonitor] Sweep complete:', JSON.stringify(result));
        }
    } catch (error) {
        console.error('[VerifyServiceMonitor] Sweep failed:', error);
    } finally {
        verifyServiceSweepRunning = false;
    }
}

async function queueNextVerifyServiceSweep(delayMs = null) {
    if (verifyServiceSweepTimer) return;

    const verifyConfig = await getVerifyConfig();
    const monitorConfig = normalizeVerifyServiceMonitorConfig(verifyConfig?.serviceMonitorConfig, process.env);
    const nextDelay = Math.max(10000, Number(delayMs ?? monitorConfig.sweep_interval_ms ?? 10 * 60 * 1000));

    verifyServiceSweepTimer = setTimeout(() => {
        verifyServiceSweepTimer = null;
        sweepVerifyServiceHealth()
            .catch((error) => {
                console.error('[VerifyServiceMonitor] Sweep tick failed:', error);
            })
            .finally(() => {
                queueNextVerifyServiceSweep().catch((error) => {
                    console.error('[VerifyServiceMonitor] Failed to schedule next sweep:', error);
                });
            });
    }, nextDelay);
}

function startVerifyServiceSweep() {
    if (verifyServiceSweepTimer) return;

    queueNextVerifyServiceSweep(4700).catch((error) => {
        console.error('[VerifyServiceMonitor] Failed to start sweep:', error);
    });
}

async function sweepVerifyQueueHealth() {
    if (verifyQueueSweepRunning) return;
    verifyQueueSweepRunning = true;

    try {
        const verifyConfig = await getVerifyConfig();
        const result = await runVerifyQueueBacklogSweep(supabase, {
            env: process.env,
            verifyConfig
        });

        if (Number(result?.backlog_count || 0) > 0 || Number(result?.queued || 0) > 0) {
            console.log('[VerifyQueueMonitor] Sweep complete:', JSON.stringify(result));
        }
    } catch (error) {
        console.error('[VerifyQueueMonitor] Sweep failed:', error);
    } finally {
        verifyQueueSweepRunning = false;
    }
}

async function queueNextVerifyQueueSweep(delayMs = null) {
    if (verifyQueueSweepTimer) return;

    const verifyConfig = await getVerifyConfig();
    let monitorConfig = normalizeVerifyQueueMonitorConfig(verifyConfig?.queueMonitorConfig, process.env);
    try {
        const runtime = await loadOpsAlertsRuntimeConfig(supabase, process.env);
        monitorConfig = normalizeVerifyQueueMonitorConfig({
            ...(verifyConfig?.queueMonitorConfig && typeof verifyConfig.queueMonitorConfig === 'object' ? verifyConfig.queueMonitorConfig : {}),
            ...(runtime?.config?.verify_queue && typeof runtime.config.verify_queue === 'object' ? runtime.config.verify_queue : {})
        }, process.env);
    } catch (error) {
        console.warn('[VerifyQueueMonitor] Failed to load runtime config for scheduling, falling back to legacy config:', error.message || error);
    }
    const nextDelay = Math.max(10000, Number(delayMs ?? monitorConfig.sweep_interval_ms ?? 10 * 60 * 1000));

    verifyQueueSweepTimer = setTimeout(() => {
        verifyQueueSweepTimer = null;
        sweepVerifyQueueHealth()
            .catch((error) => {
                console.error('[VerifyQueueMonitor] Sweep tick failed:', error);
            })
            .finally(() => {
                queueNextVerifyQueueSweep().catch((error) => {
                    console.error('[VerifyQueueMonitor] Failed to schedule next sweep:', error);
                });
            });
    }, nextDelay);
}

function startVerifyQueueSweep() {
    if (verifyQueueSweepTimer) return;

    queueNextVerifyQueueSweep(5200).catch((error) => {
        console.error('[VerifyQueueMonitor] Failed to start sweep:', error);
    });
}

async function sweepVerifyFailureHealth() {
    if (verifyFailureSweepRunning) return;
    verifyFailureSweepRunning = true;

    try {
        const verifyConfig = await getVerifyConfig();
        const result = await runVerifyFailureRateSpikeSweep(supabase, {
            env: process.env,
            verifyConfig
        });

        if (Number(result?.spike_count || 0) > 0 || Number(result?.queued || 0) > 0) {
            console.log('[VerifyFailureMonitor] Sweep complete:', JSON.stringify(result));
        }
    } catch (error) {
        console.error('[VerifyFailureMonitor] Sweep failed:', error);
    } finally {
        verifyFailureSweepRunning = false;
    }
}

async function queueNextVerifyFailureSweep(delayMs = null) {
    if (verifyFailureSweepTimer) return;

    const verifyConfig = await getVerifyConfig();
    let monitorConfig = normalizeVerifyFailureMonitorConfig(verifyConfig?.failureMonitorConfig, process.env);
    try {
        const runtime = await loadOpsAlertsRuntimeConfig(supabase, process.env);
        monitorConfig = normalizeVerifyFailureMonitorConfig({
            ...(verifyConfig?.failureMonitorConfig && typeof verifyConfig.failureMonitorConfig === 'object' ? verifyConfig.failureMonitorConfig : {}),
            ...(runtime?.config?.verify_failure && typeof runtime.config.verify_failure === 'object' ? runtime.config.verify_failure : {})
        }, process.env);
    } catch (error) {
        console.warn('[VerifyFailureMonitor] Failed to load runtime config for scheduling, falling back to legacy config:', error.message || error);
    }
    const nextDelay = Math.max(10000, Number(delayMs ?? monitorConfig.sweep_interval_ms ?? 10 * 60 * 1000));

    verifyFailureSweepTimer = setTimeout(() => {
        verifyFailureSweepTimer = null;
        sweepVerifyFailureHealth()
            .catch((error) => {
                console.error('[VerifyFailureMonitor] Sweep tick failed:', error);
            })
            .finally(() => {
                queueNextVerifyFailureSweep().catch((error) => {
                    console.error('[VerifyFailureMonitor] Failed to schedule next sweep:', error);
                });
            });
    }, nextDelay);
}

function startVerifyFailureSweep() {
    if (verifyFailureSweepTimer) return;

    queueNextVerifyFailureSweep(5700).catch((error) => {
        console.error('[VerifyFailureMonitor] Failed to start sweep:', error);
    });
}

async function sweepVerifyIncidentHealth() {
    if (verifyIncidentSweepRunning) return;
    verifyIncidentSweepRunning = true;

    try {
        const verifyConfig = await getVerifyConfig();
        const result = await runVerifyIncidentEscalationSweep(supabase, {
            env: process.env,
            verifyConfig
        });

        if (
            Number(result?.incident_count || 0) > 0
            || Number(result?.queued || 0) > 0
            || Number(result?.recovered_count || 0) > 0
            || Number(result?.recovered_queued || 0) > 0
            || Number(result?.admin_notifications_created || 0) > 0
        ) {
            console.log('[VerifyIncidentMonitor] Sweep complete:', JSON.stringify(result));
        }
    } catch (error) {
        console.error('[VerifyIncidentMonitor] Sweep failed:', error);
    } finally {
        verifyIncidentSweepRunning = false;
    }
}

async function queueNextVerifyIncidentSweep(delayMs = null) {
    if (verifyIncidentSweepTimer) return;

    const verifyConfig = await getVerifyConfig();
    const monitorConfig = normalizeVerifyIncidentMonitorConfig(verifyConfig?.incidentMonitorConfig, process.env);
    const nextDelay = Math.max(10000, Number(delayMs ?? monitorConfig.sweep_interval_ms ?? 10 * 60 * 1000));

    verifyIncidentSweepTimer = setTimeout(() => {
        verifyIncidentSweepTimer = null;
        sweepVerifyIncidentHealth()
            .catch((error) => {
                console.error('[VerifyIncidentMonitor] Sweep tick failed:', error);
            })
            .finally(() => {
                queueNextVerifyIncidentSweep().catch((error) => {
                    console.error('[VerifyIncidentMonitor] Failed to schedule next sweep:', error);
                });
            });
    }, nextDelay);
}

function startVerifyIncidentSweep() {
    if (verifyIncidentSweepTimer) return;

    queueNextVerifyIncidentSweep(6200).catch((error) => {
        console.error('[VerifyIncidentMonitor] Failed to start sweep:', error);
    });
}

async function sweepTicketSlaHealth() {
    if (ticketSlaSweepRunning) return;
    ticketSlaSweepRunning = true;

    try {
        const result = await runTicketSlaOverdueSweep(supabase, {
            env: process.env
        });

        if (
            Number(result?.overdue_count || 0) > 0
            || Number(result?.queued || 0) > 0
            || Number(result?.recovered_count || 0) > 0
            || Number(result?.recovered_queued || 0) > 0
            || Number(result?.admin_notifications_created || 0) > 0
        ) {
            console.log('[TicketSlaMonitor] Sweep complete:', JSON.stringify(result));
        }
    } catch (error) {
        console.error('[TicketSlaMonitor] Sweep failed:', error);
    } finally {
        ticketSlaSweepRunning = false;
    }
}

async function queueNextTicketSlaSweep(delayMs = null) {
    if (ticketSlaSweepTimer) return;

    let monitorConfig = normalizeTicketSlaMonitorConfig({}, process.env);
    try {
        const runtime = await loadOpsAlertsRuntimeConfig(supabase, process.env);
        monitorConfig = normalizeTicketSlaMonitorConfig(runtime?.config?.tickets || {}, process.env);
    } catch (error) {
        console.error('[TicketSlaMonitor] Failed to load runtime config for scheduling, falling back to env defaults:', error);
    }
    const nextDelay = Math.max(10000, Number(delayMs ?? monitorConfig.sweep_interval_ms ?? 10 * 60 * 1000));

    ticketSlaSweepTimer = setTimeout(() => {
        ticketSlaSweepTimer = null;
        sweepTicketSlaHealth()
            .catch((error) => {
                console.error('[TicketSlaMonitor] Sweep tick failed:', error);
            })
            .finally(() => {
                queueNextTicketSlaSweep().catch((error) => {
                    console.error('[TicketSlaMonitor] Failed to schedule next sweep:', error);
                });
            });
    }, nextDelay);
}

function startTicketSlaSweep() {
    if (ticketSlaSweepTimer) return;

    queueNextTicketSlaSweep(5200).catch((error) => {
        console.error('[TicketSlaMonitor] Failed to start sweep:', error);
    });
}

async function sweepShopInventoryHealth() {
    if (shopInventorySweepRunning) return;
    shopInventorySweepRunning = true;

    try {
        const runtime = await loadOpsAlertsRuntimeConfig(supabase, process.env);
        const result = await runShopInventoryLowSweep(supabase, {
            runtime,
            config: runtime?.config?.shop_inventory,
            env: process.env
        });

        if (
            Number(result?.low_stock_count || 0) > 0
            || Number(result?.empty_stock_count || 0) > 0
            || Number(result?.queued || 0) > 0
            || Number(result?.recovered_count || 0) > 0
            || Number(result?.recovered_queued || 0) > 0
            || Number(result?.admin_notifications_created || 0) > 0
        ) {
            console.log('[ShopInventoryMonitor] Sweep complete:', JSON.stringify(result));
        }
    } catch (error) {
        console.error('[ShopInventoryMonitor] Sweep failed:', error);
    } finally {
        shopInventorySweepRunning = false;
    }
}

async function queueNextShopInventorySweep(delayMs = null) {
    if (shopInventorySweepTimer) return;

    let monitorConfig = normalizeShopInventoryMonitorConfig({}, process.env);
    try {
        const runtime = await loadOpsAlertsRuntimeConfig(supabase, process.env);
        monitorConfig = normalizeShopInventoryMonitorConfig(runtime?.config?.shop_inventory || {}, process.env);
    } catch (error) {
        console.warn('[ShopInventoryMonitor] Failed to load runtime config for next sweep delay:', error.message || error);
    }
    const nextDelay = Math.max(10000, Number(delayMs ?? monitorConfig.sweep_interval_ms ?? 15 * 60 * 1000));

    shopInventorySweepTimer = setTimeout(() => {
        shopInventorySweepTimer = null;
        sweepShopInventoryHealth()
            .catch((error) => {
                console.error('[ShopInventoryMonitor] Sweep tick failed:', error);
            })
            .finally(() => {
                queueNextShopInventorySweep().catch((error) => {
                    console.error('[ShopInventoryMonitor] Failed to schedule next sweep:', error);
                });
            });
    }, nextDelay);
}

function startShopInventorySweep() {
    if (shopInventorySweepTimer) return;

    queueNextShopInventorySweep(6200).catch((error) => {
        console.error('[ShopInventoryMonitor] Failed to start sweep:', error);
    });
}

async function sweepShopOrderDeliveryHealth() {
    if (shopOrderDeliverySweepRunning) return;
    shopOrderDeliverySweepRunning = true;

    try {
        const result = await runShopOrderDeliveryFailedSweep(supabase, {
            env: process.env
        });

        if (
            Number(result?.failure_count || 0) > 0
            || Number(result?.queued || 0) > 0
            || Number(result?.incident_count || 0) > 0
            || Number(result?.incident_recovered_count || 0) > 0
            || Number(result?.recovered_count || 0) > 0
            || Number(result?.admin_notifications_created || 0) > 0
        ) {
            console.log('[ShopOrderDeliveryMonitor] Sweep complete:', JSON.stringify(result));
        }
    } catch (error) {
        console.error('[ShopOrderDeliveryMonitor] Sweep failed:', error);
    } finally {
        shopOrderDeliverySweepRunning = false;
    }
}

async function queueNextShopOrderDeliverySweep(delayMs = null) {
    if (shopOrderDeliverySweepTimer) return;

    let monitorConfig = normalizeShopOrderDeliveryMonitorConfig({}, process.env);
    try {
        const runtime = await loadOpsAlertsRuntimeConfig(supabase, process.env);
        monitorConfig = normalizeShopOrderDeliveryMonitorConfig(runtime?.config?.shop_order_delivery || {}, process.env);
    } catch (error) {
        console.warn('[ShopOrderDeliveryMonitor] Failed to load runtime config for scheduling, falling back to env defaults:', error.message || error);
    }
    const nextDelay = Math.max(10000, Number(delayMs ?? monitorConfig.sweep_interval_ms ?? 10 * 60 * 1000));

    shopOrderDeliverySweepTimer = setTimeout(() => {
        shopOrderDeliverySweepTimer = null;
        sweepShopOrderDeliveryHealth()
            .catch((error) => {
                console.error('[ShopOrderDeliveryMonitor] Sweep tick failed:', error);
            })
            .finally(() => {
                queueNextShopOrderDeliverySweep().catch((error) => {
                    console.error('[ShopOrderDeliveryMonitor] Failed to schedule next sweep:', error);
                });
            });
    }, nextDelay);
}

function startShopOrderDeliverySweep() {
    if (shopOrderDeliverySweepTimer) return;

    queueNextShopOrderDeliverySweep(6700).catch((error) => {
        console.error('[ShopOrderDeliveryMonitor] Failed to start sweep:', error);
    });
}

async function sweepShopOrderRiskHealth() {
    if (shopOrderRiskSweepRunning) return;
    shopOrderRiskSweepRunning = true;

    try {
        const runtime = await loadOpsAlertsRuntimeConfig(supabase, process.env);
        const result = await runShopOrderRiskSweep(supabase, {
            runtime,
            config: runtime?.config?.shop_order_risk || {},
            env: process.env
        });

        if (
            Number(result?.anomaly_count || 0) > 0
            || Number(result?.queued || 0) > 0
            || Number(result?.recovered_count || 0) > 0
            || Number(result?.recovered_queued || 0) > 0
            || Number(result?.admin_notifications_created || 0) > 0
        ) {
            console.log('[ShopOrderRiskMonitor] Sweep complete:', JSON.stringify(result));
        }
    } catch (error) {
        console.error('[ShopOrderRiskMonitor] Sweep failed:', error);
    } finally {
        shopOrderRiskSweepRunning = false;
    }
}

async function queueNextShopOrderRiskSweep(delayMs = null) {
    if (shopOrderRiskSweepTimer) return;

    let monitorConfig = normalizeShopOrderRiskMonitorConfig({}, process.env);
    try {
        const runtime = await loadOpsAlertsRuntimeConfig(supabase, process.env);
        monitorConfig = normalizeShopOrderRiskMonitorConfig(runtime?.config?.shop_order_risk || {}, process.env);
    } catch (error) {
        console.warn('[ShopOrderRiskMonitor] Failed to load stored runtime config, falling back to env defaults:', error?.message || error);
    }
    const nextDelay = Math.max(10000, Number(delayMs ?? monitorConfig.sweep_interval_ms ?? 5 * 60 * 1000));

    shopOrderRiskSweepTimer = setTimeout(() => {
        shopOrderRiskSweepTimer = null;
        sweepShopOrderRiskHealth()
            .catch((error) => {
                console.error('[ShopOrderRiskMonitor] Sweep tick failed:', error);
            })
            .finally(() => {
                queueNextShopOrderRiskSweep().catch((error) => {
                    console.error('[ShopOrderRiskMonitor] Failed to schedule next sweep:', error);
                });
            });
    }, nextDelay);
}

function startShopOrderRiskSweep() {
    if (shopOrderRiskSweepTimer) return;

    queueNextShopOrderRiskSweep(6950).catch((error) => {
        console.error('[ShopOrderRiskMonitor] Failed to start sweep:', error);
    });
}

async function sweepAdminLoginAnomalyHealth() {
    if (adminLoginAnomalySweepRunning) return;
    adminLoginAnomalySweepRunning = true;

    try {
        const result = await runAdminLoginAnomalySweep(supabase, {
            env: process.env
        });

        if (Number(result?.anomaly_count || 0) > 0 || Number(result?.queued || 0) > 0) {
            console.log('[AdminLoginAnomalyMonitor] Sweep complete:', JSON.stringify(result));
        }
    } catch (error) {
        console.error('[AdminLoginAnomalyMonitor] Sweep failed:', error);
    } finally {
        adminLoginAnomalySweepRunning = false;
    }
}

async function queueNextAdminLoginAnomalySweep(delayMs = null) {
    if (adminLoginAnomalySweepTimer) return;

    const monitorConfig = normalizeAdminLoginAnomalyMonitorConfig({}, process.env);
    const nextDelay = Math.max(10000, Number(delayMs ?? monitorConfig.sweep_interval_ms ?? 10 * 60 * 1000));

    adminLoginAnomalySweepTimer = setTimeout(() => {
        adminLoginAnomalySweepTimer = null;
        sweepAdminLoginAnomalyHealth()
            .catch((error) => {
                console.error('[AdminLoginAnomalyMonitor] Sweep tick failed:', error);
            })
            .finally(() => {
                queueNextAdminLoginAnomalySweep().catch((error) => {
                    console.error('[AdminLoginAnomalyMonitor] Failed to schedule next sweep:', error);
                });
            });
    }, nextDelay);
}

function startAdminLoginAnomalySweep() {
    if (adminLoginAnomalySweepTimer) return;

    queueNextAdminLoginAnomalySweep(7200).catch((error) => {
        console.error('[AdminLoginAnomalyMonitor] Failed to start sweep:', error);
    });
}

async function sweepCustomerChatMessageAlerts() {
    if (customerChatMessageSweepRunning) return;
    customerChatMessageSweepRunning = true;

    try {
        const runtime = await loadOpsAlertsRuntimeConfig(supabase, process.env);
        const result = await runCustomerChatMessageSweep(supabase, {
            runtime,
            config: runtime?.config?.customer_chat_message || {},
            env: process.env
        });

        if (Number(result?.message_count || 0) > 0 || Number(result?.queued || 0) > 0) {
            console.log('[CustomerChatMessageMonitor] Sweep complete:', JSON.stringify(result));
        }
    } catch (error) {
        console.error('[CustomerChatMessageMonitor] Sweep failed:', error);
    } finally {
        customerChatMessageSweepRunning = false;
    }
}

async function queueNextCustomerChatMessageSweep(delayMs = null) {
    if (customerChatMessageSweepTimer) return;

    let monitorConfig = normalizeChatMessageMonitorConfig({}, process.env);
    try {
        const runtime = await loadOpsAlertsRuntimeConfig(supabase, process.env);
        monitorConfig = normalizeChatMessageMonitorConfig(runtime?.config?.customer_chat_message || {}, process.env);
    } catch (error) {
        console.warn('[CustomerChatMessageMonitor] Failed to load runtime config for next sweep delay:', error.message || error);
    }
    const nextDelay = Math.max(10000, Number(delayMs ?? monitorConfig.sweep_interval_ms ?? 60 * 1000));

    customerChatMessageSweepTimer = setTimeout(() => {
        customerChatMessageSweepTimer = null;
        sweepCustomerChatMessageAlerts()
            .catch((error) => {
                console.error('[CustomerChatMessageMonitor] Sweep tick failed:', error);
            })
            .finally(() => {
                queueNextCustomerChatMessageSweep().catch((error) => {
                    console.error('[CustomerChatMessageMonitor] Failed to schedule next sweep:', error);
                });
            });
    }, nextDelay);
}

function startCustomerChatMessageSweep() {
    if (customerChatMessageSweepTimer) return;

    queueNextCustomerChatMessageSweep(7800).catch((error) => {
        console.error('[CustomerChatMessageMonitor] Failed to start sweep:', error);
    });
}

async function sweepShopPurchaseSuccessAlerts() {
    if (shopPurchaseSuccessSweepRunning) return;
    shopPurchaseSuccessSweepRunning = true;

    try {
        const runtime = await loadOpsAlertsRuntimeConfig(supabase, process.env);
        const result = await runCommerceSuccessSweep(supabase, {
            runtime,
            purchaseConfig: runtime?.config?.shop_purchase_success || {},
            rechargeConfig: { enabled: false },
            env: process.env
        });

        if (Number(result?.purchase_count || 0) > 0 || Number(result?.queued || 0) > 0) {
            console.log('[ShopPurchaseSuccessMonitor] Sweep complete:', JSON.stringify(result));
        }
    } catch (error) {
        console.error('[ShopPurchaseSuccessMonitor] Sweep failed:', error);
    } finally {
        shopPurchaseSuccessSweepRunning = false;
    }
}

async function queueNextShopPurchaseSuccessSweep(delayMs = null) {
    if (shopPurchaseSuccessSweepTimer) return;

    let monitorConfig = normalizeCommerceSuccessMonitorConfig({}, process.env);
    try {
        const runtime = await loadOpsAlertsRuntimeConfig(supabase, process.env);
        monitorConfig = normalizeCommerceSuccessMonitorConfig(runtime?.config?.shop_purchase_success || {}, process.env);
    } catch (error) {
        console.warn('[ShopPurchaseSuccessMonitor] Failed to load runtime config for next sweep delay:', error.message || error);
    }
    const nextDelay = Math.max(10000, Number(delayMs ?? monitorConfig.sweep_interval_ms ?? 2 * 60 * 1000));

    shopPurchaseSuccessSweepTimer = setTimeout(() => {
        shopPurchaseSuccessSweepTimer = null;
        sweepShopPurchaseSuccessAlerts()
            .catch((error) => {
                console.error('[ShopPurchaseSuccessMonitor] Sweep tick failed:', error);
            })
            .finally(() => {
                queueNextShopPurchaseSuccessSweep().catch((error) => {
                    console.error('[ShopPurchaseSuccessMonitor] Failed to schedule next sweep:', error);
                });
            });
    }, nextDelay);
}

function startShopPurchaseSuccessSweep() {
    if (shopPurchaseSuccessSweepTimer) return;

    queueNextShopPurchaseSuccessSweep(8300).catch((error) => {
        console.error('[ShopPurchaseSuccessMonitor] Failed to start sweep:', error);
    });
}

async function sweepWalletRechargeSuccessAlerts() {
    if (walletRechargeSuccessSweepRunning) return;
    walletRechargeSuccessSweepRunning = true;

    try {
        const runtime = await loadOpsAlertsRuntimeConfig(supabase, process.env);
        const result = await runCommerceSuccessSweep(supabase, {
            runtime,
            purchaseConfig: { enabled: false },
            rechargeConfig: runtime?.config?.wallet_recharge_success || {},
            env: process.env
        });

        if (Number(result?.recharge_count || 0) > 0 || Number(result?.queued || 0) > 0) {
            console.log('[WalletRechargeSuccessMonitor] Sweep complete:', JSON.stringify(result));
        }
    } catch (error) {
        console.error('[WalletRechargeSuccessMonitor] Sweep failed:', error);
    } finally {
        walletRechargeSuccessSweepRunning = false;
    }
}

async function queueNextWalletRechargeSuccessSweep(delayMs = null) {
    if (walletRechargeSuccessSweepTimer) return;

    let monitorConfig = normalizeCommerceSuccessMonitorConfig({}, process.env);
    try {
        const runtime = await loadOpsAlertsRuntimeConfig(supabase, process.env);
        monitorConfig = normalizeCommerceSuccessMonitorConfig(runtime?.config?.wallet_recharge_success || {}, process.env);
    } catch (error) {
        console.warn('[WalletRechargeSuccessMonitor] Failed to load runtime config for next sweep delay:', error.message || error);
    }
    const nextDelay = Math.max(10000, Number(delayMs ?? monitorConfig.sweep_interval_ms ?? 2 * 60 * 1000));

    walletRechargeSuccessSweepTimer = setTimeout(() => {
        walletRechargeSuccessSweepTimer = null;
        sweepWalletRechargeSuccessAlerts()
            .catch((error) => {
                console.error('[WalletRechargeSuccessMonitor] Sweep tick failed:', error);
            })
            .finally(() => {
                queueNextWalletRechargeSuccessSweep().catch((error) => {
                    console.error('[WalletRechargeSuccessMonitor] Failed to schedule next sweep:', error);
                });
            });
    }, nextDelay);
}

function startWalletRechargeSuccessSweep() {
    if (walletRechargeSuccessSweepTimer) return;

    queueNextWalletRechargeSuccessSweep(8800).catch((error) => {
        console.error('[WalletRechargeSuccessMonitor] Failed to start sweep:', error);
    });
}

async function hasLoggedJobResult(userId, jobId, site = 'cn') {
    if (!userId || !jobId) return false;

    try {
        const { data, error } = await supabase
            .from('verification_logs')
            .select('message')
            .eq('user_id', userId)
            .eq('site', site)
            .order('created_at', { ascending: false })
            .limit(50);

        if (error) {
            console.warn('[Verify] Failed to inspect history for dedupe:', error.message);
            return false;
        }

        return (data || []).some((row) => parseHistoryMessage(row.message)?.job_id === jobId);
    } catch (error) {
        console.warn('[Verify] History dedupe check failed:', error.message);
        return false;
    }
}

async function logVerificationResult({
    userId,
    site = 'cn',
    email,
    jobId,
    status,
    url = '',
    errorCode = '',
    errorMessage = '',
    stageLabel = '',
    rawStatus = '',
    pointsDeducted = 0
}) {
    if (!userId) return;

    const message = buildHistoryMessage({
        email: email || '',
        job_id: jobId || '',
        url: url || '',
        error_code: errorCode || '',
        error_message: errorMessage || '',
        stage_label: stageLabel || '',
        raw_status: rawStatus || status || '',
        logged_at: new Date().toISOString()
    });

    try {
        await supabase.from('verification_logs').insert({
            user_id: userId,
            verification_id: email || jobId || '--',
            status,
            message,
            points_deducted: pointsDeducted,
            batch_count: 1,
            batch_success: status === 'success' ? 1 : 0,
            batch_failed: status === 'success' ? 0 : 1,
            site
        });
    } catch (error) {
        console.warn('[Verify] Failed to log verification result:', error.message);
    }
}

async function validateUserBalance(userId, requiredPoints, site = 'cn') {
    if (!userId) {
        return { valid: false, error: '请先登录', status: 400 };
    }

    const { data: balanceData, error: balanceError } = await getUserBalance({
        supabase,
        userId,
        site
    });

    if (balanceError) {
        console.error('[Verify] Balance check error:', balanceError);
        return { valid: false, error: '查询积分失败', status: 500 };
    }

    const currentBalance = balanceData?.total_balance || 0;

    if (currentBalance < requiredPoints) {
        return {
            valid: false,
            error: `积分不足，需要 ${requiredPoints} 积分，当前余额 ${currentBalance}`,
            status: 400,
            balance: currentBalance
        };
    }

    return { valid: true, balance: currentBalance };
}

// =============================================
// POST /api/verify — Submit a Google One job
// =============================================
app.post('/api/verify', async (req, res) => {
    const authenticatedUser = await requireAuthenticatedUser(req, res);
    if (!authenticatedUser) return;

    const { email, password, totpSecret, totp_secret, priority, site, taskType, task_type } = req.body || {};
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const normalizedPassword = String(password || '');
    const normalizedTotpSecret = String(totpSecret || totp_secret || '').trim();
    const normalizedPriority = Number(priority) === 1 ? 1 : 0;
    const normalizedTaskType = normalizeVerifyTaskType(taskType || task_type);
    const currentSite = resolveSecureRequestSite(req, site);

    if (!normalizedEmail || !normalizedPassword || !normalizedTotpSecret) {
        return res.status(400).json({
            success: false,
            message: '请提供邮箱、密码和 TOTP 密钥',
            code: 'missing_fields'
        });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        return res.status(400).json({
            success: false,
            message: '邮箱格式无效',
            code: 'invalid_email'
        });
    }

    try {
        const config = await getVerifyConfig();

        if (!config.apiKeys?.length) {
            return res.status(500).json({
                success: false,
                message: 'Google One 服务商 CDKey 未配置',
                code: 'api_key_missing'
            });
        }

        const priceForTask = getVerifyPriceForTaskType(config, normalizedTaskType);
        const balanceCheck = await validateUserBalance(authenticatedUser.id, priceForTask, currentSite);
        if (!balanceCheck.valid) {
            return res.status(balanceCheck.status).json({ success: false, message: balanceCheck.error });
        }

        const requiredUses = getVerifyUnitCost(normalizedTaskType);
        const credentialSelection = await selectVerifyCredentialForTask(config, requiredUses);
        const selectedCredential = credentialSelection.selected;

        if (!selectedCredential?.apiKey) {
            return res.status(400).json({
                success: false,
                message: '当前所有已激活 CDKey 余额都不足，请先补充卡密额度',
                code: 'insufficient_balance'
            });
        }

        console.log(`[Verify] Submitting Google One ${normalizedTaskType} job: ${normalizedEmail}`);

        const upstream = await postVerifyProviderAction(config, {
            action: 'submit_task',
            cdkey: selectedCredential.apiKey,
            email: normalizedEmail,
            password: normalizedPassword,
            twofa: normalizedTotpSecret,
            priority: normalizedPriority,
            task_type: normalizedTaskType
        });

        if (!upstream.ok) {
            console.error('[Verify] API error:', upstream.payload);
            return res.status(upstream.status || 502).json({
                success: false,
                message: getApiErrorMessage(upstream.payload, '任务提交失败'),
                code: getApiErrorCode(upstream.payload)
            });
        }

        const apiData = normalizeVerifyJobPayload(upstream.payload, {
            status: 'queued',
            task_type: normalizedTaskType,
            provider_key_fingerprint: buildVerifyCredentialFingerprint(selectedCredential.apiKey),
            provider_key_name: selectedCredential.keyName || maskVerifyCredential(selectedCredential.apiKey)
        });
        const jobId = String(apiData.job_id || apiData.task_id || '').trim();
        if (jobId) {
            await syncTrackedJobStatus({
                userId: authenticatedUser.id,
                site: currentSite,
                email: normalizedEmail,
                jobId,
                apiData,
                config
            });
        }

        return res.json({
            success: true,
            task_id: jobId,
            job_id: jobId,
            status: apiData.status || 'queued',
            task_type: apiData.task_type || normalizedTaskType,
            queue_position: apiData.queue_position ?? -1,
            estimated_wait_seconds: apiData.estimated_wait_seconds ?? 0,
            message: apiData.message || '任务已提交',
            pricePerVerify: priceForTask
        });

    } catch (error) {
        console.error('[Verify] Submit error:', error);
        return res.status(500).json({
            success: false,
            message: error.message || '验证服务暂时不可用'
        });
    }
});

// =============================================
// GET /api/verify/status/:taskId — Poll job status
// =============================================
app.get('/api/verify/status/:taskId', async (req, res) => {
    const authenticatedUser = await requireAuthenticatedUser(req, res);
    if (!authenticatedUser) return;

    const { taskId } = req.params;
    const { site } = req.query;
    const currentSite = resolveSecureRequestSite(req, site);

    try {
        const trackedRecord = await findTrackedJobLog(authenticatedUser.id, taskId, currentSite);
        if (!trackedRecord) {
            return res.status(404).json({
                success: false,
                message: '任务不存在或无权访问',
                code: 'job_not_found'
            });
        }

        const trackedPayload = parseHistoryMessage(trackedRecord.message) || {};
        const config = await getVerifyConfig();

        if (!config.apiKeys?.length) {
            return res.status(500).json({ success: false, message: '验证服务未配置', code: 'api_key_missing' });
        }

        const preferredApiKey = resolveVerifyApiKeyByFingerprint(config, trackedPayload.provider_key_fingerprint);
        const upstream = await fetchUpstreamJobStatus(config, taskId, {
            apiKey: preferredApiKey,
            taskType: trackedPayload.task_type || DEFAULT_VERIFY_TASK_TYPE
        });
        if (!upstream.ok) {
            return res.status(upstream.status).json({
                success: false,
                message: upstream.message,
                code: upstream.code
            });
        }

        const apiData = upstream.data;
        const syncResult = await syncTrackedJobStatus({
            userId: authenticatedUser.id,
            site: currentSite,
            email: String(trackedPayload.email || '').trim().toLowerCase(),
            jobId: taskId,
            apiData: normalizeVerifyJobPayload(apiData, {
                task_type: trackedPayload.task_type || DEFAULT_VERIFY_TASK_TYPE,
                provider_key_fingerprint: trackedPayload.provider_key_fingerprint,
                provider_key_name: trackedPayload.provider_key_name
            }),
            config
        });
        const pointsDeducted = Number(syncResult?.pointsDeducted) || 0;
        const normalizedApiData = normalizeVerifyJobPayload(apiData, {
            task_type: trackedPayload.task_type || DEFAULT_VERIFY_TASK_TYPE,
            provider_key_fingerprint: trackedPayload.provider_key_fingerprint,
            provider_key_name: trackedPayload.provider_key_name
        });

        return res.json({
            success: normalizedApiData.status === 'success',
            job_id: normalizedApiData.job_id || taskId,
            status: normalizedApiData.status,
            stage: normalizedApiData.stage,
            total_stages: normalizedApiData.total_stages,
            stage_label: normalizedApiData.stage_label,
            task_type: normalizedApiData.task_type,
            has_offer_url: normalizedApiData.has_offer_url === true,
            url: normalizedApiData.url || '',
            error: normalizedApiData.error || '',
            created_at: normalizedApiData.created_at,
            elapsed_seconds: normalizedApiData.elapsed_seconds,
            queue_position: normalizedApiData.queue_position,
            estimated_wait_seconds: normalizedApiData.estimated_wait_seconds,
            message: buildClientStatusMessage(normalizedApiData),
            pointsDeducted
        });

    } catch (error) {
        console.error('[Verify] Status check error:', error);
        return res.status(500).json({
            success: false,
            message: error.message || '查询状态失败'
        });
    }
});

// =============================================
// GET /api/quota — Check current API key balance
// =============================================
app.get('/api/quota', async (req, res) => {
    const quotaAccess = await requireAdminOrVerifyMonitorInternalAccess(req, res);
    if (!quotaAccess) return;

    try {
        const config = await getVerifyConfig();

        if (!config.apiKeys?.length) {
            return res.status(500).json({ success: false, message: '验证服务未配置 CDKey' });
        }

        const snapshots = await fetchVerifyQuotaStates(config);
        const healthySnapshots = snapshots.filter((snapshot) => snapshot.ok);
        const firstError = snapshots.find((snapshot) => !snapshot.ok);

        if (!healthySnapshots.length) {
            return res.status(firstError?.status || 502).json({
                success: false,
                message: firstError?.message || '查询额度失败',
                code: firstError?.code || 'quota_unavailable'
            });
        }

        const remainingUses = healthySnapshots.reduce((sum, snapshot) => sum + Number(snapshot.remainingUses || 0), 0);
        const totalUsed = healthySnapshots.reduce((sum, snapshot) => sum + Number(snapshot.totalUsed || 0), 0);
        const usageSummary = buildVerifyUsageSummary(remainingUses);
        const keyStates = snapshots.map((snapshot) => {
            const snapshotRemainingUses = Number(snapshot.remainingUses);
            const safeRemainingUses = Number.isFinite(snapshotRemainingUses)
                ? Math.max(0, Math.round(snapshotRemainingUses * 100) / 100)
                : null;
            const snapshotUsageSummary = safeRemainingUses != null
                ? buildVerifyUsageSummary(safeRemainingUses)
                : null;
            const snapshotTotalUsed = Number(snapshot.totalUsed);

            return {
                api_key: String(snapshot.apiKey || '').trim(),
                masked_key: maskVerifyCredential(snapshot.apiKey),
                key_name: String(snapshot.keyName || maskVerifyCredential(snapshot.apiKey)).trim(),
                ok: snapshot.ok === true,
                status: Number.isFinite(Number(snapshot.status || 0)) ? Number(snapshot.status || 0) : null,
                code: String(snapshot.code || '').trim() || null,
                message: String(snapshot.message || '').trim(),
                balance: safeRemainingUses,
                credits: safeRemainingUses,
                remaining_uses: safeRemainingUses,
                remaining_extract_jobs: snapshotUsageSummary?.remaining_extract_jobs ?? null,
                remaining_full_jobs: snapshotUsageSummary?.remaining_full_jobs ?? null,
                total_used: Number.isFinite(snapshotTotalUsed) ? Math.max(0, snapshotTotalUsed) : null
            };
        });
        return res.json({
            success: true,
            credits: usageSummary.remaining_uses,
            balance: usageSummary.remaining_uses,
            remaining_uses: usageSummary.remaining_uses,
            remaining_extract_jobs: usageSummary.remaining_extract_jobs,
            remaining_full_jobs: usageSummary.remaining_full_jobs,
            total_used: totalUsed,
            cost_per_job: getVerifyUnitCost('full'),
            extract_cost_per_job: usageSummary.extract_cost_per_job,
            full_cost_per_job: usageSummary.full_cost_per_job,
            key_name: Number(config.keyCount || 0) > 1
                ? `CDKey 池（${healthySnapshots.length}/${config.keyCount}）`
                : healthySnapshots[0]?.keyName || maskVerifyCredential(config.apiKey),
            key_count: Number(config.keyCount || healthySnapshots.length || 0),
            healthy_key_count: healthySnapshots.length,
            key_states: keyStates
        });

    } catch (error) {
        console.error('[Verify] Quota check error:', error);
        return res.status(500).json({
            success: false,
            message: error.message || '查询额度失败'
        });
    }
});

// =============================================
// GET /api/queue — Inspect upstream queue status
// =============================================
app.get('/api/queue', async (req, res) => {
    const queueAccess = await requireAdminOrVerifyMonitorInternalAccess(req, res);
    if (!queueAccess) return;

    try {
        const config = await getVerifyConfig();

        if (!config.apiKeys?.length) {
            return res.status(500).json({ success: false, message: '验证服务未配置 CDKey' });
        }

        const queueSnapshot = await buildLocalVerifyQueueSnapshot(config);

        return res.json({
            success: true,
            ...queueSnapshot,
            key_name: queueSnapshot.key_name,
            api_base_url: config.apiBaseUrl,
            source: 'local_tracked_jobs'
        });

    } catch (error) {
        console.error('[Verify] Queue check error:', error);
        return res.status(500).json({
            success: false,
            message: error.message || '查询队列失败'
        });
    }
});

// =============================================
// GET /api/admin/network/request-context — Inspect proxy/IP resolution
// =============================================
app.get('/api/admin/network/request-context', async (req, res) => {
    const adminUser = await requireAdminOrInternalAccess(req, res);
    if (!adminUser) return;

    const appContext = buildRequestNetworkContext(req, {
        trustedProxies: process.env.TRUSTED_PROXY_IPS || process.env.TRUSTED_PROXY_CIDRS || ''
    });
    const webhookContext = buildRequestNetworkContext(req, {
        trustedProxies: getAfdianWebhookTrustedProxies(),
        allowedIps: String(process.env.AFDIAN_WEBHOOK_ALLOWED_IPS || '').trim()
    });

    return res.json({
        success: true,
        request_context: {
            app_proxy: appContext,
            afdian_webhook: webhookContext
        },
        findings: buildNetworkDiagnosticFindings({
            appContext,
            webhookContext
        })
    });
});

// =============================================
// POST /api/redeem — Legacy endpoint kept for compatibility
// =============================================
app.post('/api/redeem', async (req, res) => {
    return res.status(410).json({
        success: false,
        message: '新版 Google One API 不再支持卡密兑换，请在上游后台管理 API Key 余额。',
        code: 'redeem_not_supported'
    });
});

// =============================================
// POST /api/cancel — Legacy endpoint kept for compatibility
// =============================================
app.post('/api/cancel', async (req, res) => {
    return res.status(410).json({
        success: false,
        message: '新版 Google One API 不支持取消已提交任务，请等待任务结束。',
        code: 'cancel_not_supported'
    });
});

// POST /api/payments/hupijiao/webhook
app.post('/api/payments/hupijiao/webhook', async (req, res) => {
    console.log('[Hupijiao] Webhook received');

    const webhookTrustedProxies = getHupijiaoWebhookTrustedProxies();
    const webhookAllowedIps = String(process.env.HUPIJIAO_WEBHOOK_ALLOWED_IPS || '').trim();
    if (isProductionLikeRuntime() && !webhookAllowedIps) {
        console.warn('[Hupijiao] Webhook blocked because HUPIJIAO_WEBHOOK_ALLOWED_IPS is missing in a production-like runtime');
        return res.status(503).end('webhook source allowlist not configured');
    }
    const webhookContext = buildRequestNetworkContext(req, {
        trustedProxies: webhookTrustedProxies,
        allowedIps: webhookAllowedIps
    });
    const webhookClientIp = webhookContext.resolved_client_ip;
    if (webhookAllowedIps && (!webhookClientIp || !isIpAllowed(webhookClientIp, webhookAllowedIps))) {
        console.warn('[Hupijiao] Webhook blocked due to IP allowlist mismatch:', JSON.stringify(webhookContext));
        return res.status(403).end('forbidden');
    }

    const webhookRateLimit = await applyRequestRateLimit(req, res, {
        keyPrefix: 'hupijiao-webhook',
        limit: Math.max(1, Number(process.env.HUPIJIAO_WEBHOOK_RATE_LIMIT_MAX || 180)),
        windowMs: Math.max(10_000, Number(process.env.HUPIJIAO_WEBHOOK_RATE_LIMIT_WINDOW_MS || 60_000)),
        trustedProxies: webhookTrustedProxies
    });
    if (!webhookRateLimit.rateLimit.allowed) {
        return res.status(429).end('rate limited');
    }

    const payload = req.body && typeof req.body === 'object' ? req.body : {};
    const orderNo = String(payload.trade_order_id || '').trim();
    const transactionId = String(payload.transaction_id || '').trim();
    const statusRaw = String(payload.status || '').trim().toUpperCase();
    const eventKey = hupijiaoProvider.buildEventKey({
        providerOrderNo: orderNo,
        transactionId,
        status: statusRaw,
        payload
    });

    try {
        const eventInsert = await recordPaymentEvent({
            provider: 'hupijiao',
            provider_order_no: orderNo || null,
            event_key: eventKey,
            event_type: 'webhook',
            signature_valid: false,
            payload,
            processing_result: 'received'
        });

        if (eventInsert.duplicate) {
            console.log('[Hupijiao] Duplicate webhook ignored:', eventKey);
            return res.end('success');
        }

        if (!orderNo) {
            await finalizePaymentEvent(eventKey, {
                processing_result: 'invalid_order_no',
                error_message: 'missing trade_order_id',
                response_status: 400
            });
            return res.status(400).end('missing trade_order_id');
        }

        const runtimeContext = await hupijiaoProvider.resolveRuntimeContext({
            supabase,
            env: process.env
        });
        const signatureCheck = hupijiaoProvider.verifyWebhook({
            payload,
            runtimeContext
        });
        if (signatureCheck.supported === false && signatureCheck.reason === 'missing_secret') {
            await finalizePaymentEvent(eventKey, {
                processing_result: 'missing_hupijiao_secret',
                error_message: 'HUPIJIAO_SECRET_KEY is not configured',
                response_status: 503
            });
            return res.status(503).end('payment webhook not configured');
        }

        const signatureValid = signatureCheck.valid === true;
        const paymentState = normalizeHupijiaoPaymentStatus(statusRaw);
        const attachData = parseHupijiaoAttach(payload.attach);
        const currentSite = getCurrentSite(req, attachData.site);
        const amount = roundPaymentCurrencyAmount(payload.total_fee || 0);
        let paymentOrder = await loadPaymentOrderSnapshotByProviderOrderNo('hupijiao', orderNo);
        if (!paymentOrder && signatureValid) {
            paymentOrder = await ensureHupijiaoRecoveredPaymentOrder({
                providerOrderNo: orderNo,
                attachData,
                payload,
                amount,
                signatureValid,
                currentSite
            });
        }
        const expectedAmount = roundPaymentCurrencyAmount(
            paymentOrder?.expected_amount ?? attachData.expected_amount ?? amount
        );
        const amountValid = expectedAmount > 0
            ? paymentAmountsMatch(expectedAmount, amount)
            : false;
        const gatewayOpenOrderId = getHupijiaoGatewayOrderId(payload);
        let processingResult = paymentState === 'paid' ? 'pending_review' : `ignored_${paymentState}`;
        let errorMessage = null;
        let responseStatus = 200;
        let rechargeBreakdown = null;

        if (!signatureValid) {
            processingResult = 'signature_mismatch';
            errorMessage = 'signature_mismatch';
            responseStatus = 401;
        } else if (paymentState !== 'paid') {
            processingResult = `ignored_${paymentState}`;
        } else if (!paymentOrder?.user_id) {
            processingResult = 'pending_review';
            errorMessage = 'missing_payment_owner';
        } else if (!amountValid) {
            processingResult = 'amount_mismatch';
            errorMessage = `amount_mismatch_expected_${expectedAmount}`;
        } else {
            rechargeBreakdown = deriveHupijiaoPointBreakdown(paymentOrder, attachData);
            const currentOrderStatus = String(paymentOrder.status || '').trim().toLowerCase();
            if (!['paid', 'redeemed'].includes(currentOrderStatus)) {
                const { error: rechargeError } = await rechargePointsForPayment({
                    supabase,
                    userId: paymentOrder.user_id,
                    paidPoints: rechargeBreakdown.paidPoints,
                    bonusPoints: rechargeBreakdown.bonusPoints,
                    reason: attachData.charge_type === 'custom'
                        ? 'custom_recharge'
                        : `虎皮椒充值: ${String(paymentOrder.package_name || '充值订单').trim() || '充值订单'}`,
                    referenceId: `hupijiao_${orderNo}`,
                    site: paymentOrder.site || currentSite
                });

                if (rechargeError) {
                    throw new Error(rechargeError.message || 'Failed to credit Hupijiao payment points');
                }
            }

            processingResult = 'processed_paid';
        }

        if (paymentOrder?.id) {
            const nowIso = new Date().toISOString();
            const existingMetadata = paymentOrder.provider_metadata && typeof paymentOrder.provider_metadata === 'object'
                ? paymentOrder.provider_metadata
                : {};
            const existingRawPayload = paymentOrder.raw_payload && typeof paymentOrder.raw_payload === 'object'
                ? paymentOrder.raw_payload
                : {};
            const nextStatus = processingResult === 'processed_paid'
                ? 'redeemed'
                : (paymentState === 'paid' && signatureValid && !amountValid
                    ? 'amount_mismatch'
                    : (paymentState === 'paid' && signatureValid ? 'pending_review' : paymentOrder.status));

            const orderPatch = {
                status: nextStatus,
                sign_verified: signatureValid,
                amount_verified: paymentState === 'paid' ? amountValid : paymentOrder.amount_verified === true,
                paid_amount: paymentState === 'paid'
                    ? amount
                    : (paymentOrder.paid_amount ?? amount),
                expected_amount: expectedAmount > 0
                    ? expectedAmount
                    : paymentOrder.expected_amount,
                paid_at: paymentState === 'paid' && signatureValid
                    ? (paymentOrder.paid_at || nowIso)
                    : paymentOrder.paid_at,
                verified_at: signatureValid
                    ? (paymentOrder.verified_at || nowIso)
                    : paymentOrder.verified_at,
                claimed_at: processingResult === 'processed_paid'
                    ? (paymentOrder.claimed_at || nowIso)
                    : paymentOrder.claimed_at,
                last_error: errorMessage,
                raw_payload: mergePaymentObjects(existingRawPayload, {
                    hupijiao_webhook: payload,
                    attach: attachData
                }),
                provider_metadata: mergePaymentObjects(existingMetadata, {
                    provider_order_no: orderNo,
                    transaction_id: transactionId || null,
                    gateway_open_order_id: gatewayOpenOrderId || null,
                    checkout_session_id: paymentOrder.checkout_session_id || attachData.checkout_session_id || null,
                    checkout_session_key: existingMetadata.checkout_session_key || attachData.checkout_session_key || null,
                    payment_status: paymentState,
                    payment_status_raw: statusRaw || null,
                    webhook_received_at: nowIso
                })
            };

            const { error: orderUpdateError } = await supabase
                .from('payment_orders')
                .update(orderPatch)
                .eq('id', paymentOrder.id);

            if (orderUpdateError) {
                throw new Error(orderUpdateError.message || 'Failed to update Hupijiao payment order');
            }

            if (processingResult === 'processed_paid') {
                try {
                    await reconcileCheckoutSessionForPaymentOrder({
                        supabase,
                        providerKey: 'hupijiao',
                        paymentOrderId: paymentOrder.id,
                        providerOrderNo: orderNo,
                        userId: paymentOrder.user_id,
                        site: paymentOrder.site || currentSite,
                        packageId: paymentOrder.package_id,
                        packageName: paymentOrder.package_name,
                        expectedAmount,
                        paidAmount: amount,
                        pointsAmount: paymentOrder.points_amount,
                        orderStatus: 'redeemed',
                        linkedBy: 'hupijiao_webhook',
                        allowHeuristic: true,
                        lookbackMinutes: 1440
                    });
                } catch (linkError) {
                    console.warn('[Hupijiao] Failed to link checkout session from webhook:', linkError.message);
                }

                await maybeIssueRechargeDiscountAssets({
                    supabase,
                    userId: paymentOrder.user_id,
                    site: paymentOrder.site || currentSite,
                    paidPoints: rechargeBreakdown?.paidPoints || 0,
                    bonusPoints: rechargeBreakdown?.bonusPoints || 0,
                    paidAmount: amount,
                    paymentOrderId: paymentOrder.id,
                    paymentProvider: 'hupijiao',
                    paymentOrderNo: orderNo
                });
                await maybeIssueAffiliateDiscountAssetsForRecharge({
                    supabase,
                    site: paymentOrder.site || currentSite,
                    rechargeReferenceId: `hupijiao_${orderNo}`
                });
            }
        }

        await finalizePaymentEvent(eventKey, {
            payment_order_id: paymentOrder?.id || null,
            signature_valid: signatureValid,
            amount_valid: paymentState === 'paid' ? amountValid : null,
            processing_result: processingResult,
            error_message: errorMessage,
            response_status: responseStatus
        });

        if (!signatureValid) {
            return res.status(401).end('invalid signature');
        }

        return res.end('success');
    } catch (error) {
        console.error('[Hupijiao] Webhook error:', error);
        await finalizePaymentEvent(eventKey, {
            processing_result: 'webhook_exception',
            error_message: error.message,
            response_status: 500
        });
        return res.status(500).end('error');
    }
});

// GET or POST /api/payments/zpay/webhook
app.all('/api/payments/zpay/webhook', zpayWebhookHandler);

// POST /api/afdian/webhook
app.post('/api/afdian/webhook', async (req, res) => {
    console.log('[Afdian] Webhook received');

    const webhookTrustedProxies = getAfdianWebhookTrustedProxies();
    const webhookAllowedIps = String(process.env.AFDIAN_WEBHOOK_ALLOWED_IPS || '').trim();
    if (isProductionLikeRuntime() && !webhookAllowedIps) {
        console.warn('[Afdian] Webhook blocked because AFDIAN_WEBHOOK_ALLOWED_IPS is missing in a production-like runtime');
        return res.status(503).json({ ec: 503, em: 'webhook source allowlist not configured' });
    }
    const webhookContext = buildRequestNetworkContext(req, {
        trustedProxies: webhookTrustedProxies,
        allowedIps: webhookAllowedIps
    });
    const webhookClientIp = webhookContext.resolved_client_ip;
    if (webhookAllowedIps && (!webhookClientIp || !isIpAllowed(webhookClientIp, webhookAllowedIps))) {
        console.warn('[Afdian] Webhook blocked due to IP allowlist mismatch:', JSON.stringify(webhookContext));
        return res.status(403).json({ ec: 403, em: 'forbidden' });
    }

    const webhookRateLimit = await applyRequestRateLimit(req, res, {
        keyPrefix: 'afdian-webhook',
        limit: Math.max(1, Number(process.env.AFDIAN_WEBHOOK_RATE_LIMIT_MAX || 180)),
        windowMs: Math.max(10_000, Number(process.env.AFDIAN_WEBHOOK_RATE_LIMIT_WINDOW_MS || 60_000)),
        trustedProxies: webhookTrustedProxies
    });
    if (!webhookRateLimit.rateLimit.allowed) {
        return res.status(429).json({
            ec: 429,
            em: 'rate limited'
        });
    }

    const payload = req.body || {};
    const data = payload.data || {};
    const order = data.order || {};
    const orderNo = String(order.out_trade_no || '').trim();
    const status = Number(order.status);
    const eventKey = buildAfdianEventKey(orderNo, status, payload);

    try {
        console.log('[Afdian] Raw payload:', JSON.stringify(payload).substring(0, 500));

        const eventInsert = await recordPaymentEvent({
            provider: 'afdian',
            provider_order_no: orderNo || null,
            event_key: eventKey,
            event_type: 'webhook',
            signature_valid: false,
            payload,
            processing_result: 'received'
        });

        if (eventInsert.duplicate) {
            console.log('[Afdian] Duplicate webhook ignored:', eventKey);
            return res.json({ ec: 200, em: '' });
        }

        if (!orderNo) {
            await finalizePaymentEvent(eventKey, {
                processing_result: 'invalid_order_no',
                error_message: 'missing out_trade_no',
                response_status: 400
            });
            return res.status(400).json({ ec: 400, em: 'missing order number' });
        }

        if (payload.ec !== 200) {
            console.warn('[Afdian] Non-success payload:', payload.ec, payload.em);
            await finalizePaymentEvent(eventKey, {
                processing_result: 'ignored_non_success_ec',
                error_message: payload.em || 'non-success ec',
                response_status: 200
            });
            return res.json({ ec: 200, em: '' });
        }

        if (data?.type !== 'order' || !data?.order) {
            await finalizePaymentEvent(eventKey, {
                processing_result: 'ignored_non_order_event',
                response_status: 200
            });
            return res.json({ ec: 200, em: '' });
        }

        if (status !== 2) {
            await finalizePaymentEvent(eventKey, {
                processing_result: 'ignored_non_paid_status',
                response_status: 200
            });
            return res.json({ ec: 200, em: '' });
        }

        const afdianRuntime = await afdianProvider.resolveRuntimeContext({
            supabase,
            env: process.env
        });
        const afdianToken = afdianRuntime.secretValues?.afdian_token || process.env.AFDIAN_TOKEN;
        if (!afdianToken) {
            await finalizePaymentEvent(eventKey, {
                processing_result: 'missing_afdian_token',
                error_message: 'AFDIAN_TOKEN is not configured',
                response_status: 503
            });
            return res.status(503).json({ ec: 503, em: 'payment webhook not configured' });
        }

        if (!payload.sign) {
            await finalizePaymentEvent(eventKey, {
                processing_result: 'missing_signature',
                error_message: 'missing sign',
                response_status: 401
            });
            return res.status(401).json({ ec: 401, em: 'missing signature' });
        }

        const signatureCheck = afdianProvider.verifyWebhook({
            payload,
            token: afdianToken
        });
        const signatureValid = signatureCheck.valid;
        const amount = roundCurrencyAmount(order.total_amount || 0);
        const resolvedPackage = await resolveAfdianPackage({
            planId: order.plan_id,
            amount
        });
        const amountValid = !!resolvedPackage && amountsMatch(resolvedPackage.expectedAmount, amount);
        const processError = afdianProvider.deriveProcessError({
            signatureValid,
            resolvedPackage,
            amount,
            amountValid
        });
        const { currentSite, pendingPaymentOrder } = await resolveAfdianWebhookContext({
            orderNo,
            resolvedPackage,
            amount
        });

        if (!currentSite) {
            console.warn('[Afdian] Webhook site resolution failed for order:', orderNo);
            await deletePaymentEvent(eventKey);
            return res.status(503).json({
                ec: 503,
                em: 'payment site unresolved'
            });
        }

        const { data: processResult, error: processRpcError } = await processAfdianPayment({
            supabase,
            orderNo,
            afdianUserId: String(order.user_id || ''),
            planId: order.plan_id || null,
            paidAmount: amount,
            expectedAmount: resolvedPackage?.expectedAmount ?? amount,
            points: resolvedPackage?.pointsTotal ?? 0,
            packageId: resolvedPackage?.packageId ?? null,
            packageName: resolvedPackage?.packageName ?? null,
            site: currentSite,
            signatureValid,
            amountValid,
            payload,
            processError,
            paymentOrderId: pendingPaymentOrder?.paymentOrderId || null
        });

        if (processRpcError) {
            await finalizePaymentEvent(eventKey, {
                processing_result: 'process_rpc_failed',
                error_message: processRpcError.message,
                response_status: 500
            });
            console.error('[Afdian] Failed to process payment:', processRpcError);
            return res.status(500).json({ ec: 500, em: 'internal error' });
        }

        if (processResult?.payment_order_id) {
            try {
                await reconcileCheckoutSessionForPaymentOrder({
                    supabase,
                    providerKey: 'afdian',
                    paymentOrderId: processResult.payment_order_id,
                    providerOrderNo: orderNo,
                    site: currentSite,
                    packageId: resolvedPackage?.packageId ?? null,
                    packageName: resolvedPackage?.packageName ?? null,
                    expectedAmount: resolvedPackage?.expectedAmount ?? amount,
                    paidAmount: amount,
                    pointsAmount: resolvedPackage?.pointsTotal ?? 0,
                    orderStatus: processResult?.status || (signatureValid && amountValid ? 'paid' : 'pending_review'),
                    linkedBy: 'afdian_webhook',
                    allowHeuristic: true,
                    lookbackMinutes: 120
                });
            } catch (linkError) {
                console.warn('[Afdian] Failed to link checkout session from webhook:', linkError.message);
            }
        }

        await finalizePaymentEvent(eventKey, {
            payment_order_id: processResult?.payment_order_id || null,
            signature_valid: signatureValid,
            amount_valid: amountValid,
            processing_result: signatureValid && amountValid ? 'processed_paid' : (processResult?.status || 'pending_review'),
            error_message: processError || null,
            response_status: signatureValid ? 200 : 401
        });

        if (!signatureValid) {
            return res.status(401).json({ ec: 401, em: 'invalid signature' });
        }

        if (!amountValid) {
            return res.json({ ec: 200, em: 'pending review' });
        }

        return res.json({ ec: 200, em: '' });
    } catch (error) {
        console.error('[Afdian] Webhook error:', error);
        await finalizePaymentEvent(eventKey, {
            processing_result: 'webhook_exception',
            error_message: error.message,
            response_status: 500
        });
        return res.status(500).json({ ec: 500, em: 'internal error' });
    }
});

async function handleAfdianQueryRequest(req, res) {
    const { orderNo, quoteTokens, claimTokens } = extractAfdianQueryRequest(req);
    const currentSite = getCurrentSite(req);

    async function sendQueryResponse(statusCode, payload, audit = {}) {
        await recordPaymentQueryAttempt({
            provider: 'afdian',
            site: currentSite,
            orderNo,
            userId: audit.userId || null,
            paymentOrderId: audit.paymentOrderId || null,
            checkoutSessionId: audit.checkoutSessionId || null,
            success: audit.success === true,
            responseStatus: statusCode,
            outcomeCode: audit.outcomeCode || (audit.success ? 'success' : 'unknown'),
            message: audit.message || payload?.message || null,
            metadata: {
                payment_status: audit.paymentStatus || null,
                source: 'afdian_query_api',
                quote_token_count: quoteTokens.length,
                claim_token_count: claimTokens.length
            }
        });
        return res.status(statusCode).json(payload);
    }

    const queryRateLimit = await applyRequestRateLimit(req, res, {
        keyPrefix: 'afdian-query',
        limit: Math.max(1, Number(process.env.AFDIAN_QUERY_RATE_LIMIT_MAX || 25)),
        windowMs: Math.max(10_000, Number(process.env.AFDIAN_QUERY_RATE_LIMIT_WINDOW_MS || 60_000))
    });
    if (!queryRateLimit.rateLimit.allowed) {
        return sendQueryResponse(429, {
            success: false,
            code: 'rate_limited',
            message: '查询过于频繁，请稍后再试',
            retry_after_seconds: queryRateLimit.rateLimit.retryAfterSeconds
        }, {
            outcomeCode: 'rate_limited'
        });
    }

    if (!orderNo) {
        return sendQueryResponse(400, { success: false, message: '请输入订单号' }, {
            outcomeCode: 'missing_order_no'
        });
    }

    try {
        const user = await getAuthenticatedUser(req);
        if (!user) {
            return sendQueryResponse(401, { success: false, message: '请先登录后再查询订单' }, {
                outcomeCode: 'unauthenticated'
            });
        }

        let { afdianOrder, paymentOrder: linkedPaymentOrder } = await loadAfdianQuerySnapshot(orderNo);
        if (!afdianOrder) {
            return sendQueryResponse(200, { success: false, message: '未找到该订单' }, {
                userId: user.id,
                outcomeCode: 'not_found'
            });
        }

        let consumedPaymentClaimIds = [];
        let ownership = deriveAfdianOwnershipState({
            userId: user.id,
            afdianOrder,
            paymentOrder: linkedPaymentOrder
        });
        if (ownership.state === 'denied') {
            return sendQueryResponse(403, { success: false, message: '该订单已归属其他账号，无法查询' }, {
                userId: user.id,
                paymentOrderId: linkedPaymentOrder?.id || afdianOrder?.payment_order_id || null,
                checkoutSessionId: linkedPaymentOrder?.checkout_session_id || null,
                outcomeCode: 'access_denied'
            });
        }

        let orderInfo = buildAfdianQueryOrderInfo({
            afdianOrder,
            paymentOrder: linkedPaymentOrder
        });
        const initialStatus = String(orderInfo?.payment_status || 'pending_review');
        let claimResolution = null;

        if (ownership.state === 'unowned' && initialStatus !== 'rejected') {
            try {
                claimResolution = await resolveAfdianPaymentIntentClaim({
                    user,
                    claimTokens,
                    linkedPaymentOrder,
                    afdianOrder
                });
            } catch (claimResolutionError) {
                console.warn('[Afdian] Failed to resolve payment intent claim:', claimResolutionError.message);
            }
        }

        if (!orderInfo.code) {
            const currentStatus = String(orderInfo?.payment_status || 'pending_review');
            if (ownership.state === 'unowned' && currentStatus !== 'rejected') {
                try {
                    const finalizedCustomRecharge = await tryFinalizeCustomRechargeFromQuote({
                        orderNo,
                        user,
                        site: claimResolution?.site || linkedPaymentOrder?.site || afdianOrder?.site || currentSite,
                        linkedPaymentOrder,
                        orderInfo,
                        quoteTokens
                    });

                    if (finalizedCustomRecharge?.code) {
                        return sendQueryResponse(200, {
                            success: true,
                            code: finalizedCustomRecharge.code,
                            points: finalizedCustomRecharge.points,
                            is_redeemed: false,
                            created_at: orderInfo?.created_at || afdianOrder?.created_at || null,
                            payment_status: 'paid',
                            consumed_custom_quote_ids: finalizedCustomRecharge.quoteId ? [finalizedCustomRecharge.quoteId] : []
                        }, {
                            userId: user.id,
                            paymentOrderId: finalizedCustomRecharge.paymentOrderId || linkedPaymentOrder?.id || null,
                            checkoutSessionId: finalizedCustomRecharge.checkoutSessionId || linkedPaymentOrder?.checkout_session_id || null,
                            paymentStatus: 'paid',
                            success: true,
                            outcomeCode: 'custom_quote_resolved'
                        });
                    }
                } catch (customFinalizeError) {
                    console.warn('[Afdian] Failed to finalize custom recharge from quote:', customFinalizeError.message);
                }

                ({ afdianOrder, paymentOrder: linkedPaymentOrder } = await loadAfdianQuerySnapshot(orderNo));
                ownership = deriveAfdianOwnershipState({
                    userId: user.id,
                    afdianOrder,
                    paymentOrder: linkedPaymentOrder
                });
                if (ownership.state === 'denied') {
                    return sendQueryResponse(403, { success: false, message: '该订单已归属其他账号，无法查询' }, {
                        userId: user.id,
                        paymentOrderId: linkedPaymentOrder?.id || afdianOrder?.payment_order_id || null,
                        checkoutSessionId: linkedPaymentOrder?.checkout_session_id || null,
                        outcomeCode: 'access_denied'
                    });
                }
                orderInfo = buildAfdianQueryOrderInfo({
                    afdianOrder,
                    paymentOrder: linkedPaymentOrder
                });
            }
        }

        if (ownership.state === 'unowned'
            && String(orderInfo?.payment_status || initialStatus || 'pending_review') !== 'rejected'
            && claimResolution) {
            try {
                const appliedClaim = await applyAfdianPaymentIntentClaim({
                    orderNo,
                    user,
                    linkedPaymentOrder,
                    afdianOrder,
                    claimResolution
                });
                if (appliedClaim?.intentId) {
                    consumedPaymentClaimIds = [appliedClaim.intentId];
                    ({ afdianOrder, paymentOrder: linkedPaymentOrder } = await loadAfdianQuerySnapshot(orderNo));
                    ownership = deriveAfdianOwnershipState({
                        userId: user.id,
                        afdianOrder,
                        paymentOrder: linkedPaymentOrder
                    });
                    if (ownership.state === 'denied') {
                        return sendQueryResponse(403, { success: false, message: '该订单已归属其他账号，无法查询' }, {
                            userId: user.id,
                            paymentOrderId: linkedPaymentOrder?.id || afdianOrder?.payment_order_id || null,
                            checkoutSessionId: linkedPaymentOrder?.checkout_session_id || null,
                            outcomeCode: 'access_denied'
                        });
                    }
                    orderInfo = buildAfdianQueryOrderInfo({
                        afdianOrder,
                        paymentOrder: linkedPaymentOrder
                    });
                }
            } catch (claimApplyError) {
                console.warn('[Afdian] Failed to apply payment intent claim:', claimApplyError.message);
            }
        }

        if (linkedPaymentOrder?.id && ownership.state === 'owned') {
            try {
                await reconcileCheckoutSessionForPaymentOrder({
                    supabase,
                    providerKey: 'afdian',
                    paymentOrderId: linkedPaymentOrder.id,
                    providerOrderNo: orderNo,
                    userId: user.id,
                    site: linkedPaymentOrder.site,
                    packageId: linkedPaymentOrder.package_id,
                    packageName: linkedPaymentOrder.package_name,
                    expectedAmount: linkedPaymentOrder.expected_amount,
                    paidAmount: linkedPaymentOrder.paid_amount,
                    pointsAmount: linkedPaymentOrder.points_amount,
                    orderStatus: linkedPaymentOrder.status,
                    linkedBy: consumedPaymentClaimIds.length > 0 ? 'afdian_query_claimed' : 'afdian_query_owned',
                    allowHeuristic: true,
                    lookbackMinutes: 1440
                });
            } catch (linkError) {
                console.warn('[Afdian] Failed to link checkout session for owned order query:', linkError.message);
            }
        }

        const effectiveStatus = String(orderInfo?.payment_status || initialStatus || 'pending_review');
        if (ownership.state !== 'owned') {
            const pendingOwnershipMessage = effectiveStatus === 'rejected'
                ? '订单验签失败，已拦截，请联系客服'
                : '订单已记录，但尚未安全匹配到当前账号的支付意图，请确认使用本账号创建支付并稍后重试；如仍未到账请联系客服。';
            return sendQueryResponse(200, {
                success: false,
                message: pendingOwnershipMessage,
                status: effectiveStatus,
                consumed_payment_claim_ids: consumedPaymentClaimIds
            }, {
                userId: user.id,
                paymentOrderId: linkedPaymentOrder?.id || afdianOrder?.payment_order_id || null,
                checkoutSessionId: linkedPaymentOrder?.checkout_session_id || null,
                paymentStatus: effectiveStatus,
                outcomeCode: effectiveStatus === 'rejected' ? 'rejected' : 'ownership_pending'
            });
        }

        if (!orderInfo.code) {
            const message = effectiveStatus === 'rejected'
                ? '订单验签失败，已拦截，请联系客服'
                : effectiveStatus === 'amount_mismatch'
                    ? '订单金额校验异常；如果这是自定义充值，请确认支付金额与钱包报价一致后稍后重试'
                    : '订单已记录，兑换码生成中，请稍后再试';
            return sendQueryResponse(200, {
                success: false,
                message,
                status: effectiveStatus,
                consumed_payment_claim_ids: consumedPaymentClaimIds
            }, {
                userId: user.id,
                paymentOrderId: linkedPaymentOrder?.id || null,
                checkoutSessionId: linkedPaymentOrder?.checkout_session_id || null,
                paymentStatus: effectiveStatus,
                outcomeCode: effectiveStatus === 'rejected'
                    ? 'rejected'
                    : effectiveStatus === 'amount_mismatch'
                        ? 'amount_mismatch'
                        : 'code_pending'
            });
        }

        return sendQueryResponse(200, {
            success: true,
            code: orderInfo.code,
            points: orderInfo.points,
            is_redeemed: orderInfo.is_redeemed,
            created_at: orderInfo.created_at,
            payment_status: orderInfo.payment_status,
            consumed_payment_claim_ids: consumedPaymentClaimIds
        }, {
            userId: user.id,
            paymentOrderId: linkedPaymentOrder?.id || null,
            checkoutSessionId: linkedPaymentOrder?.checkout_session_id || null,
            paymentStatus: orderInfo.payment_status,
            success: true,
            outcomeCode: 'success'
        });

    } catch (error) {
        console.error('[Afdian] Query exception:', error);
        return sendQueryResponse(500, { success: false, message: '服务暂时不可用' }, {
            outcomeCode: 'query_exception'
        });
    }
}

// GET/POST /api/afdian/query - Query redemption code by order number
app.get('/api/afdian/query', handleAfdianQueryRequest);
app.post('/api/afdian/query', handleAfdianQueryRequest);

function startServer(port = PORT) {
    return app.listen(port, () => {
        console.log(`🚀 Verify proxy server running on port ${port}`);
        startPendingJobSweep();
        startShopDeliverySweep();
        startOpsAlertSweep();
        startPaymentConfigChangeSweep();
        startPaymentGatewaySweep();
        startVerifyQuotaSweep();
        startVerifyServiceSweep();
        startVerifyQueueSweep();
        startVerifyFailureSweep();
        startVerifyIncidentSweep();
        startTicketSlaSweep();
        startShopInventorySweep();
        startShopOrderDeliverySweep();
        startShopOrderRiskSweep();
        startAdminLoginAnomalySweep();
        startCustomerChatMessageSweep();
        startShopPurchaseSuccessSweep();
        startWalletRechargeSuccessSweep();
    });
}

if (require.main === module) {
    startServer();
}

module.exports = {
    app,
    startServer
};
