const {
    fetchVerifyQuotaSnapshot
} = require('../../api/_lib/verify-quota-alerts');
const {
    getSiteScopedSystemConfigDefaultValue,
    normalizeSiteScopedSystemConfigSite,
    resolveSiteScopedSystemConfigValue
} = require('./_site-scoped-system-config');

const ACTIVE_VERIFY_STATUSES = Object.freeze(['queued', 'running', 'processing', 'pending', 'assigned']);
const VERIFY_PROVIDER_AIDONE = 'aidone';
const VERIFY_PROVIDER_CATCARD = 'catcard';
const VERIFY_ADAPTER_AIDONE_OPENAPI = 'aidone_openapi';
const VERIFY_ADAPTER_PIXEL_BRIDGE_REST = 'pixel_bridge_rest';
const VERIFY_PROVIDER_LABELS = Object.freeze({
    [VERIFY_PROVIDER_AIDONE]: '通道 1 · aidone',
    [VERIFY_PROVIDER_CATCARD]: '通道 2 · 1free'
});

function normalizeText(value) {
    return String(value || '').trim();
}

function isPlainVerifyRuntimeConfig(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeVerifyProvider(value, fallback = VERIFY_PROVIDER_AIDONE) {
    const normalized = normalizeText(value).toLowerCase();
    if (['catcard', '1free', 'pixel', 'pixel_bridge', 'pixel_bridge_rest', 'qzz'].includes(normalized)) {
        return VERIFY_PROVIDER_CATCARD;
    }
    if (['aidone', 'primary', 'legacy', 'openapi', 'aidone_openapi'].includes(normalized)) {
        return VERIFY_PROVIDER_AIDONE;
    }
    return fallback === VERIFY_PROVIDER_CATCARD ? VERIFY_PROVIDER_CATCARD : VERIFY_PROVIDER_AIDONE;
}

function normalizeVerifyAdapter(value, provider = VERIFY_PROVIDER_AIDONE) {
    const normalized = normalizeText(value).toLowerCase();
    if (['pixel_bridge_rest', 'pixel-bridge-rest', 'catcard', '1free', 'pixel'].includes(normalized)) {
        return VERIFY_ADAPTER_PIXEL_BRIDGE_REST;
    }
    if (['aidone_openapi', 'aidone-openapi', 'openapi', 'aidone'].includes(normalized)) {
        return VERIFY_ADAPTER_AIDONE_OPENAPI;
    }
    return normalizeVerifyProvider(provider) === VERIFY_PROVIDER_CATCARD
        ? VERIFY_ADAPTER_PIXEL_BRIDGE_REST
        : VERIFY_ADAPTER_AIDONE_OPENAPI;
}

function isPixelBridgeAdapter(adapter) {
    return normalizeVerifyAdapter(adapter, VERIFY_PROVIDER_AIDONE) === VERIFY_ADAPTER_PIXEL_BRIDGE_REST;
}

function getVerifyProviderLabel(provider, adapter = '') {
    const normalizedProvider = normalizeVerifyProvider(provider);
    if (adapter && isPixelBridgeAdapter(adapter)) {
        return VERIFY_PROVIDER_LABELS[VERIFY_PROVIDER_CATCARD];
    }
    return VERIFY_PROVIDER_LABELS[normalizedProvider] || VERIFY_PROVIDER_LABELS[VERIFY_PROVIDER_AIDONE];
}

function getVerifyProviderCapabilities(provider, adapter = '') {
    const normalizedAdapter = normalizeVerifyAdapter(adapter, provider);
    if (normalizedAdapter === VERIFY_ADAPTER_PIXEL_BRIDGE_REST) {
        return {
            keyBalance: true,
            keyTypes: true,
            serviceStatus: true,
            batchSubmit: true,
            remarks: true,
            cancelTask: false,
            failedLinkPurchase: false
        };
    }

    return {
        keyBalance: true,
        keyTypes: false,
        serviceStatus: false,
        batchSubmit: true,
        remarks: false,
        cancelTask: true,
        failedLinkPurchase: true
    };
}

function getVerifyProviderUnitCosts(provider, adapter = '') {
    const normalizedAdapter = normalizeVerifyAdapter(adapter, provider);
    if (normalizedAdapter === VERIFY_ADAPTER_PIXEL_BRIDGE_REST) {
        return {
            extract: 1,
            full: 1
        };
    }

    return {
        extract: 0.5,
        full: 1
    };
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

function normalizeVerifyModeVisibility(value) {
    const normalized = normalizeText(value).toLowerCase();
    return ['both', 'extract_only', 'full_only'].includes(normalized) ? normalized : 'both';
}

function normalizeVerifyProviderVisibility(value) {
    const normalized = normalizeText(value).toLowerCase();
    if (normalized === VERIFY_PROVIDER_AIDONE || normalized === VERIFY_PROVIDER_CATCARD) {
        return normalized;
    }
    return 'both';
}

function normalizeVerifyCredentialList(value) {
    const values = [];
    const appendValue = (entry) => {
        if (Array.isArray(entry)) {
            entry.forEach(appendValue);
            return;
        }
        String(entry || '').split(/[\n,;]+/).forEach((part) => {
            const normalized = normalizeText(part);
            if (normalized) values.push(normalized);
        });
    };

    appendValue(value);
    return [...new Set(values)];
}

function maskVerifyCredential(value) {
    const normalized = normalizeText(value);
    if (!normalized) return '';
    if (normalized.length <= 8) return normalized;
    return `${normalized.slice(0, 4)}...${normalized.slice(-4)}`;
}

function getVerifyRemainingTaskCount(balance, unitCost) {
    const numericBalance = Number(balance);
    const numericUnitCost = Number(unitCost);
    if (!Number.isFinite(numericBalance) || !Number.isFinite(numericUnitCost) || numericUnitCost <= 0) {
        return 0;
    }

    return Math.max(0, Math.floor((numericBalance + 1e-9) / numericUnitCost));
}

function buildVerifyUsageSummary(remainingUses, unitCosts = {}) {
    const numericRemainingUses = Number(remainingUses);
    const safeRemainingUses = Number.isFinite(numericRemainingUses)
        ? Math.max(0, Math.round(numericRemainingUses * 100) / 100)
        : 0;
    const extractCost = Math.max(0.01, Number(unitCosts.extract || unitCosts.extract_cost_per_job || 0.5) || 0.5);
    const fullCost = Math.max(0.01, Number(unitCosts.full || unitCosts.full_cost_per_job || 1) || 1);

    return {
        remaining_uses: safeRemainingUses,
        extract_cost_per_job: extractCost,
        full_cost_per_job: fullCost,
        remaining_extract_jobs: getVerifyRemainingTaskCount(safeRemainingUses, extractCost),
        remaining_full_jobs: getVerifyRemainingTaskCount(safeRemainingUses, fullCost)
    };
}

function getVerifySnapshotRemainingUses(snapshot = {}) {
    const remainingUses = Number(snapshot.remaining_uses ?? snapshot.balance ?? snapshot.credits ?? snapshot.remainingUses);
    return Number.isFinite(remainingUses)
        ? Math.max(0, Math.round(remainingUses * 100) / 100)
        : 0;
}

function buildVerifyTypedUsageSummary(snapshots = [], unitCosts = {}) {
    const totalRemainingUses = (Array.isArray(snapshots) ? snapshots : [])
        .reduce((sum, snapshot) => sum + getVerifySnapshotRemainingUses(snapshot), 0);
    const extractRemainingUses = (Array.isArray(snapshots) ? snapshots : [])
        .filter((snapshot) => snapshotSupportsTaskType(snapshot, 'extract'))
        .reduce((sum, snapshot) => sum + getVerifySnapshotRemainingUses(snapshot), 0);
    const fullRemainingUses = (Array.isArray(snapshots) ? snapshots : [])
        .filter((snapshot) => snapshotSupportsTaskType(snapshot, 'full'))
        .reduce((sum, snapshot) => sum + getVerifySnapshotRemainingUses(snapshot), 0);
    const totalSummary = buildVerifyUsageSummary(totalRemainingUses, unitCosts);
    const extractSummary = buildVerifyUsageSummary(extractRemainingUses, unitCosts);
    const fullSummary = buildVerifyUsageSummary(fullRemainingUses, unitCosts);

    return {
        ...totalSummary,
        remaining_extract_uses: extractSummary.remaining_uses,
        remaining_full_uses: fullSummary.remaining_uses,
        remaining_extract_jobs: extractSummary.remaining_extract_jobs,
        remaining_full_jobs: fullSummary.remaining_full_jobs
    };
}

function buildVerifyQuotaKeyState(snapshot = {}) {
    const remainingUses = Number(snapshot.remaining_uses ?? snapshot.balance ?? snapshot.credits ?? snapshot.remainingUses);
    const safeRemainingUses = Number.isFinite(remainingUses)
        ? Math.max(0, Math.round(remainingUses * 100) / 100)
        : null;
    const usageSummary = safeRemainingUses != null
        ? buildVerifyUsageSummary(safeRemainingUses, {
            extract: snapshot.extract_cost_per_job,
            full: snapshot.full_cost_per_job
        })
        : null;
    const totalUsed = Number(snapshot.total_used ?? snapshot.totalUsed ?? snapshot.used);
    const total = Number(snapshot.total ?? snapshot.total_uses);
    const keyType = normalizeText(snapshot.key_type || snapshot.keyType);
    const supportsExtract = snapshotSupportsTaskType({ key_type: keyType }, 'extract');
    const supportsFull = snapshotSupportsTaskType({ key_type: keyType }, 'full');

    return {
        api_key: normalizeText(snapshot.apiKey),
        masked_key: normalizeText(snapshot.masked_key || snapshot.key_name || maskVerifyCredential(snapshot.apiKey)),
        key_name: normalizeText(snapshot.key_name || snapshot.keyName || snapshot.label || maskVerifyCredential(snapshot.apiKey)),
        provider: normalizeVerifyProvider(snapshot.provider),
        adapter: normalizeVerifyAdapter(snapshot.adapter, snapshot.provider),
        key_type: keyType,
        ok: snapshot?.ok === true,
        status: Number.isFinite(Number(snapshot.status || 0)) ? Number(snapshot.status || 0) : null,
        state: normalizeText(snapshot.state || snapshot.key_status),
        code: normalizeText(snapshot.code) || null,
        message: normalizeText(snapshot.error || snapshot.message) || '',
        balance: safeRemainingUses,
        credits: safeRemainingUses,
        remaining_uses: safeRemainingUses,
        remaining_extract_uses: safeRemainingUses != null && supportsExtract ? safeRemainingUses : 0,
        remaining_full_uses: safeRemainingUses != null && supportsFull ? safeRemainingUses : 0,
        remaining_extract_jobs: supportsExtract ? (usageSummary?.remaining_extract_jobs ?? null) : 0,
        remaining_full_jobs: supportsFull ? (usageSummary?.remaining_full_jobs ?? null) : 0,
        total: Number.isFinite(total) ? Math.max(0, total) : null,
        total_used: Number.isFinite(totalUsed) ? Math.max(0, totalUsed) : null
    };
}

function normalizeVerifySnapshotError(error) {
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
        return '查询额度超时';
    }

    return normalizeText(error?.message || error) || '查询额度失败';
}

function getProviderConfigSource(config = {}, provider = VERIFY_PROVIDER_AIDONE) {
    const providers = config.providers && typeof config.providers === 'object' && !Array.isArray(config.providers)
        ? config.providers
        : {};
    const normalizedProvider = normalizeVerifyProvider(provider);
    if (normalizedProvider === VERIFY_PROVIDER_CATCARD) {
        return providers.catcard || providers['1free'] || providers.pixel || providers.pixel_bridge || {};
    }
    return providers.aidone || providers.primary || providers.legacy || {};
}

function buildKeyTypeHints(entries = []) {
    const hints = {};
    entries.forEach(({ keys, keyType }) => {
        normalizeVerifyCredentialList(keys).forEach((key) => {
            hints[key] = keyType;
        });
    });
    return hints;
}

function buildRuntimeProviderConfig({
    config = {},
    fallbackConfig = {},
    provider = VERIFY_PROVIDER_AIDONE,
    prices = {},
    modeVisibility = 'both',
    site = 'cn',
    env = process.env
} = {}) {
    const normalizedProvider = normalizeVerifyProvider(provider);
    const providerSource = getProviderConfigSource(config, normalizedProvider);
    const adapter = normalizeVerifyAdapter(
        providerSource.adapter
        || providerSource.provider_adapter
        || config[`verify_provider_${normalizedProvider}_adapter`],
        normalizedProvider
    );
    const fallbackBaseUrl = normalizedProvider === VERIFY_PROVIDER_CATCARD
        ? normalizeText(env?.VERIFY_CATCARD_API_BASE_URL || env?.VERIFY_1FREE_API_BASE_URL || 'https://1free.qzz.io')
        : fallbackConfig.apiBaseUrl;
    const legacyKeys = normalizedProvider === VERIFY_PROVIDER_AIDONE
        ? [
            ...(Array.isArray(config.verify_cdkeys) ? config.verify_cdkeys : []),
            config.verify_cdkey,
            config.verify_api_key,
            fallbackConfig.apiKey
        ]
        : [
            config.verify_catcard_api_key,
            config.verify_provider_catcard_api_key,
            ...(String(env?.VERIFY_CATCARD_CDKEYS || '').trim() ? String(env.VERIFY_CATCARD_CDKEYS).split(/[\n,;]+/) : []),
            env?.VERIFY_CATCARD_CDKEY,
            env?.VERIFY_1FREE_CDKEY
        ];
    const subscribeKeys = normalizeVerifyCredentialList([
        providerSource.subscribe_cdkeys,
        providerSource.full_cdkeys,
        providerSource.subscribe_keys,
        config.verify_provider_catcard_subscribe_cdkeys,
        config.verify_provider_catcard_full_cdkeys
    ]);
    const extractKeys = normalizeVerifyCredentialList([
        providerSource.extract_cdkeys,
        providerSource.extract_link_cdkeys,
        providerSource.extract_keys,
        config.verify_provider_catcard_extract_cdkeys
    ]);
    const providerKeys = normalizeVerifyCredentialList([
        providerSource.verify_cdkeys,
        providerSource.cdkeys,
        providerSource.apiKeys,
        providerSource.api_keys,
        providerSource.keys,
        providerSource.verify_cdkey,
        providerSource.verify_api_key,
        providerSource.apiKey,
        providerSource.api_key,
        normalizedProvider === VERIFY_PROVIDER_CATCARD ? [...subscribeKeys, ...extractKeys] : [],
        legacyKeys
    ]);
    const keyTypeHints = {
        ...(providerSource.key_type_hints && typeof providerSource.key_type_hints === 'object' ? providerSource.key_type_hints : {}),
        ...buildKeyTypeHints([
            { keys: subscribeKeys, keyType: 'subscribe' },
            { keys: extractKeys, keyType: 'extract_link' }
        ])
    };
    const apiBaseUrl = normalizeText(
        providerSource.api_base_url
        || providerSource.apiBaseUrl
        || config[`verify_provider_${normalizedProvider}_api_base_url`]
        || (normalizedProvider === VERIFY_PROVIDER_AIDONE ? config.verify_api_base_url : config.verify_catcard_api_base_url)
        || fallbackBaseUrl
    ).replace(/\/+$/, '');
    const unitCosts = getVerifyProviderUnitCosts(normalizedProvider, adapter);

    return {
        site,
        enabled: providerSource.enabled !== false,
        provider: normalizedProvider,
        providerLabel: normalizeText(providerSource.label) || getVerifyProviderLabel(normalizedProvider, adapter),
        provider_label: normalizeText(providerSource.label) || getVerifyProviderLabel(normalizedProvider, adapter),
        adapter,
        provider_adapter: adapter,
        apiKey: providerKeys[0] || '',
        apiKeys: providerKeys,
        keyCount: providerKeys.length,
        apiBaseUrl,
        pricePerVerify: prices.extract,
        pricePerVerifyExtract: prices.extract,
        pricePerVerifyFull: prices.full,
        modeVisibility,
        mode_visibility: modeVisibility,
        keyTypeHints,
        unitCosts,
        extractCostPerJob: unitCosts.extract,
        fullCostPerJob: unitCosts.full,
        capabilities: getVerifyProviderCapabilities(normalizedProvider, adapter)
    };
}

function activateVerifyProviderConfig(runtimeConfig = {}, provider = '') {
    const normalizedProvider = normalizeVerifyProvider(provider || runtimeConfig.provider);
    const providerConfig = runtimeConfig.providers?.[normalizedProvider];
    if (!providerConfig) {
        return runtimeConfig;
    }

    return {
        ...runtimeConfig,
        ...providerConfig,
        providers: runtimeConfig.providers,
        activeProvider: normalizedProvider,
        active_provider: normalizedProvider,
        providerVisibility: runtimeConfig.providerVisibility,
        provider_visibility: runtimeConfig.provider_visibility,
        modeVisibility: runtimeConfig.modeVisibility,
        mode_visibility: runtimeConfig.mode_visibility,
        pricePerVerify: runtimeConfig.pricePerVerify,
        pricePerVerifyExtract: runtimeConfig.pricePerVerifyExtract,
        pricePerVerifyFull: runtimeConfig.pricePerVerifyFull
    };
}

async function loadVerifyRuntimeConfig(supabase, env = process.env, options = {}) {
    const site = normalizeSiteScopedSystemConfigSite(options?.site, { fallback: 'cn' });
    const fallbackKeys = normalizeVerifyCredentialList([
        env?.VERIFY_CDKEY,
        env?.VERIFY_API_KEY,
        env?.VERIFY_API_TOKEN,
        ...(String(env?.VERIFY_CDKEYS || '').trim() ? String(env.VERIFY_CDKEYS).split(/[\n,;]+/) : [])
    ]);
    const fallbackConfig = {
        site,
        enabled: true,
        modeVisibility: 'both',
        apiKey: fallbackKeys[0] || '',
        apiKeys: fallbackKeys,
        apiBaseUrl: normalizeText(env?.VERIFY_API_BASE_URL || 'https://aidone.lol')
    };

    if (!supabase?.from) {
        const prices = getVerifyPriceMap({});
        const providerConfig = buildRuntimeProviderConfig({
            config: {},
            fallbackConfig,
            provider: VERIFY_PROVIDER_AIDONE,
            prices,
            site,
            env
        });
        return {
            ...providerConfig,
            enabled: true,
            activeProvider: VERIFY_PROVIDER_AIDONE,
            active_provider: VERIFY_PROVIDER_AIDONE,
            providers: {
                [VERIFY_PROVIDER_AIDONE]: providerConfig
            }
        };
    }

    const { data, error } = await supabase
        .from('system_config')
        .select('config_value')
        .eq('config_key', 'verify_settings')
        .maybeSingle();

    if (error) {
        throw error;
    }

    const storedConfig = data?.config_value && typeof data.config_value === 'object'
        ? data.config_value
        : {};
    const defaultConfig = isPlainVerifyRuntimeConfig(getSiteScopedSystemConfigDefaultValue(storedConfig))
        ? getSiteScopedSystemConfigDefaultValue(storedConfig)
        : {};
    const resolvedConfig = resolveSiteScopedSystemConfigValue(storedConfig, site);
    const config = resolvedConfig && typeof resolvedConfig === 'object' && !Array.isArray(resolvedConfig)
        ? resolvedConfig
        : {};
    const mergedForDefaults = {
        ...defaultConfig,
        ...config
    };
    const prices = getVerifyPriceMap(mergedForDefaults);
    const modeVisibility = normalizeVerifyModeVisibility(
        config.mode_visibility
        || config.modeVisibility
        || defaultConfig.mode_visibility
        || defaultConfig.modeVisibility
    );
    const activeProvider = normalizeVerifyProvider(
        config.active_provider
        || config.activeProvider
        || config.verify_active_provider
        || defaultConfig.active_provider
        || defaultConfig.activeProvider
        || env?.VERIFY_ACTIVE_PROVIDER
        || VERIFY_PROVIDER_AIDONE
    );
    const providerVisibility = normalizeVerifyProviderVisibility(
        config.provider_visibility
        || config.providerVisibility
        || config.verify_provider_visibility
        || defaultConfig.provider_visibility
        || defaultConfig.providerVisibility
        || defaultConfig.verify_provider_visibility
        || env?.VERIFY_PROVIDER_VISIBILITY
    );
    const providers = {
        [VERIFY_PROVIDER_AIDONE]: buildRuntimeProviderConfig({
            config: mergedForDefaults,
            fallbackConfig,
            provider: VERIFY_PROVIDER_AIDONE,
            prices,
            modeVisibility,
            site,
            env
        }),
        [VERIFY_PROVIDER_CATCARD]: buildRuntimeProviderConfig({
            config: mergedForDefaults,
            fallbackConfig,
            provider: VERIFY_PROVIDER_CATCARD,
            prices,
            modeVisibility,
            site,
            env
        })
    };
    const activeConfig = providers[activeProvider] || providers[VERIFY_PROVIDER_AIDONE];

    return {
        ...activeConfig,
        site,
        enabled: config.enabled !== false,
        activeProvider,
        active_provider: activeProvider,
        providers,
        pricePerVerify: prices.extract,
        pricePerVerifyExtract: prices.extract,
        pricePerVerifyFull: prices.full,
        modeVisibility,
        mode_visibility: modeVisibility,
        providerVisibility,
        provider_visibility: providerVisibility
    };
}

function buildFetchOptions(timeoutMs) {
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' && Number(timeoutMs) > 0) {
        return {
            signal: AbortSignal.timeout(Number(timeoutMs))
        };
    }
    return {};
}

function buildProviderRootUrl(value = '') {
    return normalizeText(value).replace(/\/+$/, '');
}

async function fetchJson(url, {
    method = 'GET',
    body = null,
    fetchImpl = global.fetch,
    timeoutMs = 0
} = {}) {
    if (typeof fetchImpl !== 'function') {
        throw new Error('Fetch is unavailable');
    }

    const response = await fetchImpl(url, {
        method,
        headers: {
            'Content-Type': 'application/json'
        },
        body: body ? JSON.stringify(body) : undefined,
        ...buildFetchOptions(timeoutMs)
    });
    const raw = await response.text().catch(() => '');
    let payload = {};
    if (raw) {
        try {
            payload = JSON.parse(raw);
        } catch (_) {
            payload = { raw };
        }
    }

    return {
        ok: response.ok,
        status: Number(response.status || 0),
        payload,
        raw
    };
}

async function fetchPixelBridgeKeySnapshot(config = {}, apiKey = '', options = {}) {
    const apiBaseUrl = buildProviderRootUrl(config.apiBaseUrl || config.api_base_url || 'https://1free.qzz.io');
    const endpoint = `${apiBaseUrl}/api/pixel-keys/verify`;
    const result = await fetchJson(endpoint, {
        method: 'POST',
        body: { key: apiKey },
        fetchImpl: options.fetchImpl,
        timeoutMs: options.timeoutMs
    });
    const payload = result.payload || {};
    const data = payload.data && typeof payload.data === 'object' ? payload.data : {};
    const ok = result.ok && Number(payload.code) === 0 && normalizeText(data.status || 'active').toLowerCase() === 'active';
    const remaining = Number(data.remaining ?? data.remaining_uses ?? data.balance);
    const used = Number(data.used ?? data.total_used);
    const total = Number(data.total);
    const keyType = normalizeText(data.key_type || config.keyTypeHints?.[apiKey]);
    const unitCosts = getVerifyProviderUnitCosts(VERIFY_PROVIDER_CATCARD, VERIFY_ADAPTER_PIXEL_BRIDGE_REST);

    return {
        ok,
        status: result.status,
        code: normalizeText(payload.code),
        message: normalizeText(payload.msg || payload.message || (ok ? '' : '卡密验证失败')),
        api_base_url: apiBaseUrl,
        upstream_endpoint: endpoint,
        apiKey,
        provider: VERIFY_PROVIDER_CATCARD,
        adapter: VERIFY_ADAPTER_PIXEL_BRIDGE_REST,
        key_name: normalizeText(data.label || data.key || maskVerifyCredential(apiKey)),
        key_type: keyType,
        state: normalizeText(data.status),
        balance: Number.isFinite(remaining) ? remaining : 0,
        credits: Number.isFinite(remaining) ? remaining : 0,
        remaining_uses: Number.isFinite(remaining) ? remaining : 0,
        total: Number.isFinite(total) ? total : null,
        total_used: Number.isFinite(used) ? used : null,
        extract_cost_per_job: unitCosts.extract,
        full_cost_per_job: unitCosts.full,
        checked_at: new Date(options.now || Date.now()).toISOString(),
        raw: payload
    };
}

async function fetchVerifyProviderQuotaSnapshot(config = {}, apiKey = '', options = {}) {
    const adapter = normalizeVerifyAdapter(config.adapter || config.provider_adapter, config.provider);
    if (adapter === VERIFY_ADAPTER_PIXEL_BRIDGE_REST) {
        return fetchPixelBridgeKeySnapshot(config, apiKey, options);
    }

    const snapshot = await fetchVerifyQuotaSnapshot({
        apiKey,
        apiBaseUrl: config.apiBaseUrl,
        provider: config.provider,
        adapter
    }, options);
    const unitCosts = getVerifyProviderUnitCosts(config.provider, adapter);
    return {
        ...snapshot,
        apiKey,
        provider: VERIFY_PROVIDER_AIDONE,
        adapter,
        extract_cost_per_job: unitCosts.extract,
        full_cost_per_job: unitCosts.full
    };
}

async function fetchVerifyQuotaStates(config = {}, options = {}) {
    const apiKeys = normalizeVerifyCredentialList(config.apiKeys || config.apiKey);

    const snapshots = await Promise.all(apiKeys.map(async (apiKey) => {
        try {
            const snapshot = await fetchVerifyProviderQuotaSnapshot(config, apiKey, options);

            return {
                ...snapshot,
                apiKey,
                key_type: normalizeText(snapshot?.key_type || config.keyTypeHints?.[apiKey]),
                key_name: normalizeText(snapshot?.key_name) || maskVerifyCredential(apiKey)
            };
        } catch (error) {
            return {
                ok: false,
                apiKey,
                provider: config.provider,
                adapter: config.adapter,
                key_type: normalizeText(config.keyTypeHints?.[apiKey]),
                key_name: maskVerifyCredential(apiKey),
                status: error?.name === 'AbortError' || error?.name === 'TimeoutError' ? 504 : 502,
                code: normalizeText(error?.name) || null,
                error: normalizeVerifySnapshotError(error),
                message: normalizeVerifySnapshotError(error),
                checked_at: new Date(options.now || Date.now()).toISOString()
            };
        }
    }));

    return snapshots;
}

function snapshotSupportsTaskType(snapshot = {}, taskType = '') {
    const normalizedTaskType = normalizeText(taskType).toLowerCase();
    if (!normalizedTaskType) return true;

    const keyType = normalizeText(snapshot.key_type || snapshot.keyType).toLowerCase();
    if (!keyType) return true;
    if (keyType === 'subscribe' || keyType === 'full') return normalizedTaskType === 'full';
    if (keyType === 'extract_link' || keyType === 'extract') return normalizedTaskType === 'extract';
    return true;
}

async function selectVerifyCredentialForTask(config = {}, requiredUses = 0, options = {}) {
    const snapshots = await fetchVerifyQuotaStates(config, options);
    const healthySnapshots = snapshots
        .filter((snapshot) => snapshot?.ok)
        .map((snapshot) => ({
            ...snapshot,
            balance: Number(snapshot.balance || 0)
        }));
    const sortedHealthySnapshots = healthySnapshots
        .filter((snapshot) => Number.isFinite(snapshot.balance))
        .filter((snapshot) => snapshotSupportsTaskType(snapshot, options.taskType || options.task_type))
        .sort((left, right) => right.balance - left.balance);
    const selected = sortedHealthySnapshots.find((snapshot) => snapshot.balance + 1e-9 >= Number(requiredUses || 0));

    return {
        selected: selected || null,
        snapshots,
        healthySnapshots: sortedHealthySnapshots,
        totalRemainingUses: sortedHealthySnapshots.reduce((sum, snapshot) => sum + Math.max(0, Number(snapshot.balance || 0)), 0)
    };
}

async function fetchDirectVerifyQuotaState(supabase, options = {}) {
    const config = options.config && typeof options.config === 'object' && !Array.isArray(options.config)
        ? options.config
        : await loadVerifyRuntimeConfig(supabase, options.env || process.env, {
            site: options.site
        });
    let providerStatus = null;
    if (isPixelBridgeAdapter(config.adapter || config.provider_adapter)) {
        try {
            providerStatus = await fetchPixelBridgeServiceStatus(config, options);
        } catch (error) {
            providerStatus = {
                ok: false,
                service_status: 'unavailable',
                message: normalizeVerifySnapshotError(error)
            };
        }
    }
    if (!config.apiKey || !config.apiBaseUrl) {
        return {
            success: false,
            status: 500,
            site: config.site,
            provider: config.provider,
            provider_label: config.provider_label,
            service_status: providerStatus?.service_status || '',
            queue_size: Number(providerStatus?.queue_size || 0) || 0,
            running_jobs: Number(providerStatus?.running_jobs || 0) || 0,
            worker_count: Number(providerStatus?.worker_count || 0) || 0,
            online_servers: Number(providerStatus?.online_servers || 0) || 0,
            message: '验证服务未配置 CDKey 或 Base URL'
        };
    }

    const snapshots = await fetchVerifyQuotaStates(config, options);
    const healthySnapshots = snapshots.filter((snapshot) => snapshot?.ok);

    if (!healthySnapshots.length) {
        const firstFailedSnapshot = snapshots.find((snapshot) => !snapshot?.ok) || {};
        return {
            success: false,
            status: Number(firstFailedSnapshot?.status || 502) || 502,
            provider: config.provider,
            provider_label: config.provider_label,
            adapter: config.adapter,
            service_status: providerStatus?.service_status || '',
            queue_size: Number(providerStatus?.queue_size || 0) || 0,
            running_jobs: Number(providerStatus?.running_jobs || 0) || 0,
            worker_count: Number(providerStatus?.worker_count || 0) || 0,
            online_servers: Number(providerStatus?.online_servers || 0) || 0,
            message: normalizeText(firstFailedSnapshot?.error || firstFailedSnapshot?.message) || '查询额度失败'
        };
    }

    const usageSummary = buildVerifyTypedUsageSummary(healthySnapshots, config.unitCosts);
    return {
        success: true,
        status: 200,
        site: config.site,
        provider: config.provider,
        provider_label: config.provider_label,
        adapter: config.adapter,
        capabilities: config.capabilities,
        balance: usageSummary.remaining_uses,
        credits: usageSummary.remaining_uses,
        remaining_uses: usageSummary.remaining_uses,
        remaining_extract_uses: usageSummary.remaining_extract_uses,
        remaining_full_uses: usageSummary.remaining_full_uses,
        remaining_extract_jobs: usageSummary.remaining_extract_jobs,
        remaining_full_jobs: usageSummary.remaining_full_jobs,
        total_used: healthySnapshots.reduce((sum, snapshot) => sum + Math.max(0, Number(snapshot.total_used || 0)), 0),
        cost_per_job: usageSummary.full_cost_per_job,
        extract_cost_per_job: usageSummary.extract_cost_per_job,
        full_cost_per_job: usageSummary.full_cost_per_job,
        key_name: healthySnapshots.length > 1
            ? `${config.provider_label || 'CDKey 池'}（${healthySnapshots.length}/${config.keyCount || healthySnapshots.length}）`
            : (healthySnapshots[0]?.key_name || maskVerifyCredential(config.apiKey)),
        checked_at: new Date(options.now || Date.now()).toISOString(),
        api_base_url: config.apiBaseUrl,
        key_count: Number(config.keyCount || healthySnapshots.length || 0),
        healthy_key_count: healthySnapshots.length,
        key_states: snapshots.map((snapshot) => buildVerifyQuotaKeyState(snapshot)),
        queue_size: Number(providerStatus?.queue_size || 0) || 0,
        running_jobs: Number(providerStatus?.running_jobs || 0) || 0,
        worker_count: Number(providerStatus?.worker_count || 0) || 0,
        online_servers: Number(providerStatus?.online_servers || 0) || 0,
        service_status: providerStatus?.service_status || (providerStatus?.ok === false ? 'unavailable' : ''),
        service_message: providerStatus?.message || '',
        service_checked_at: providerStatus?.checked_at || ''
    };
}

async function fetchPixelBridgeServiceStatus(config = {}, options = {}) {
    const apiBaseUrl = buildProviderRootUrl(config.apiBaseUrl || config.api_base_url || 'https://1free.qzz.io');
    const endpoint = `${apiBaseUrl}/api/pixel-bridge/status`;
    const result = await fetchJson(endpoint, {
        method: 'GET',
        fetchImpl: options.fetchImpl,
        timeoutMs: options.timeoutMs
    });
    const payload = result.payload || {};
    const data = payload.data && typeof payload.data === 'object' ? payload.data : {};
    const ok = result.ok && Number(payload.code) === 0 && data.online !== false && normalizeText(data.service_status || 'running').toLowerCase() !== 'paused';

    return {
        ok,
        status: result.status,
        provider: VERIFY_PROVIDER_CATCARD,
        adapter: VERIFY_ADAPTER_PIXEL_BRIDGE_REST,
        api_base_url: apiBaseUrl,
        upstream_endpoint: endpoint,
        queue_size: Math.max(0, Number(data.global_queued || 0) || 0),
        running_jobs: Math.max(0, Number(data.global_processing || 0) || 0),
        worker_count: Math.max(0, Number(data.workerCount || data.worker_count || 0) || 0),
        online_servers: Math.max(0, Number(data.online_servers || 0) || 0),
        service_status: normalizeText(data.service_status || (ok ? 'running' : 'unavailable')),
        announcement: normalizeText(data.announcement),
        checked_at: new Date(options.now || Date.now()).toISOString(),
        message: normalizeText(payload.msg || payload.message || '')
    };
}

async function buildLocalVerifyQueueSnapshot(supabase, options = {}) {
    const config = await loadVerifyRuntimeConfig(supabase, options.env || process.env, {
        site: options.site
    });

    if (!supabase?.from) {
        return {
            success: false,
            status: 503,
            site: config.site,
            provider: config.provider,
            provider_label: config.provider_label,
            message: '验证服务本地队列不可用'
        };
    }

    const { data, error } = await supabase
        .from('verification_logs')
        .select('status')
        .in('status', ACTIVE_VERIFY_STATUSES)
        .limit(5000);

    if (error) {
        throw error;
    }

    const rows = Array.isArray(data) ? data : [];
    const localQueueSize = rows.filter((row) => ['queued', 'pending'].includes(normalizeText(row?.status).toLowerCase())).length;
    const localRunningJobs = rows.filter((row) => ['running', 'processing', 'assigned'].includes(normalizeText(row?.status).toLowerCase())).length;
    let providerStatus = null;
    if (isPixelBridgeAdapter(config.adapter)) {
        try {
            providerStatus = await fetchPixelBridgeServiceStatus(config, options);
        } catch (error) {
            providerStatus = {
                ok: false,
                message: normalizeVerifySnapshotError(error)
            };
        }
    }

    return {
        success: true,
        status: 200,
        site: config.site,
        provider: config.provider,
        provider_label: config.provider_label,
        adapter: config.adapter,
        queue_size: Number.isFinite(Number(providerStatus?.queue_size)) ? Number(providerStatus.queue_size) : localQueueSize,
        running_jobs: Number.isFinite(Number(providerStatus?.running_jobs)) ? Number(providerStatus.running_jobs) : localRunningJobs,
        local_queue_size: localQueueSize,
        local_running_jobs: localRunningJobs,
        worker_count: Number(providerStatus?.worker_count || 0) || 0,
        online_servers: Number(providerStatus?.online_servers || 0) || 0,
        service_status: providerStatus?.service_status || '',
        key_name: Number(config.keyCount || 0) > 1
            ? `${config.provider_label || 'CDKey 池'}（${config.keyCount}）`
            : maskVerifyCredential(config.apiKey),
        api_base_url: config.apiBaseUrl,
        checked_at: new Date(options.now || Date.now()).toISOString(),
        message: providerStatus?.message || ''
    };
}

module.exports = {
    ACTIVE_VERIFY_STATUSES,
    VERIFY_ADAPTER_AIDONE_OPENAPI,
    VERIFY_ADAPTER_PIXEL_BRIDGE_REST,
    VERIFY_PROVIDER_AIDONE,
    VERIFY_PROVIDER_CATCARD,
    activateVerifyProviderConfig,
    buildLocalVerifyQueueSnapshot,
    buildVerifyTypedUsageSummary,
    buildVerifyUsageSummary,
    buildVerifyQuotaKeyState,
    fetchDirectVerifyQuotaState,
    fetchPixelBridgeServiceStatus,
    fetchVerifyQuotaStates,
    getVerifyPriceMap,
    getVerifyProviderCapabilities,
    getVerifyProviderLabel,
    getVerifyProviderUnitCosts,
    loadVerifyRuntimeConfig,
    maskVerifyCredential,
    normalizeVerifyAdapter,
    normalizeVerifyModeVisibility,
    normalizeVerifyProvider,
    normalizeVerifyCredentialList,
    selectVerifyCredentialForTask
};
