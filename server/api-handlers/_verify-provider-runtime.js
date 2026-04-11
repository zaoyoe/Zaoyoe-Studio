const {
    fetchVerifyQuotaSnapshot
} = require('../../api/_lib/verify-quota-alerts');

const ACTIVE_VERIFY_STATUSES = Object.freeze(['queued', 'running', 'processing', 'pending']);

function normalizeText(value) {
    return String(value || '').trim();
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

function normalizeVerifyCredentialList(value) {
    const values = Array.isArray(value)
        ? value
        : String(value || '').split(/[\n,;]+/);

    return [...new Set(
        values
            .map((entry) => normalizeText(entry))
            .filter(Boolean)
    )];
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

function buildVerifyUsageSummary(remainingUses) {
    const numericRemainingUses = Number(remainingUses);
    const safeRemainingUses = Number.isFinite(numericRemainingUses)
        ? Math.max(0, Math.round(numericRemainingUses * 100) / 100)
        : 0;

    return {
        remaining_uses: safeRemainingUses,
        extract_cost_per_job: 0.5,
        full_cost_per_job: 1,
        remaining_extract_jobs: getVerifyRemainingTaskCount(safeRemainingUses, 0.5),
        remaining_full_jobs: getVerifyRemainingTaskCount(safeRemainingUses, 1)
    };
}

function buildVerifyQuotaKeyState(snapshot = {}) {
    const remainingUses = Number(snapshot.remaining_uses ?? snapshot.balance ?? snapshot.credits ?? snapshot.remainingUses);
    const safeRemainingUses = Number.isFinite(remainingUses)
        ? Math.max(0, Math.round(remainingUses * 100) / 100)
        : null;
    const usageSummary = safeRemainingUses != null
        ? buildVerifyUsageSummary(safeRemainingUses)
        : null;
    const totalUsed = Number(snapshot.total_used ?? snapshot.totalUsed);

    return {
        api_key: normalizeText(snapshot.apiKey),
        masked_key: normalizeText(snapshot.masked_key || snapshot.key_name || maskVerifyCredential(snapshot.apiKey)),
        key_name: normalizeText(snapshot.key_name || snapshot.keyName || maskVerifyCredential(snapshot.apiKey)),
        ok: snapshot?.ok === true,
        status: Number.isFinite(Number(snapshot.status || 0)) ? Number(snapshot.status || 0) : null,
        code: normalizeText(snapshot.code) || null,
        message: normalizeText(snapshot.error || snapshot.message) || '',
        balance: safeRemainingUses,
        credits: safeRemainingUses,
        remaining_uses: safeRemainingUses,
        remaining_extract_jobs: usageSummary?.remaining_extract_jobs ?? null,
        remaining_full_jobs: usageSummary?.remaining_full_jobs ?? null,
        total_used: Number.isFinite(totalUsed) ? Math.max(0, totalUsed) : null
    };
}

async function loadVerifyRuntimeConfig(supabase, env = process.env) {
    const fallbackKeys = normalizeVerifyCredentialList([
        env?.VERIFY_CDKEY,
        env?.VERIFY_API_KEY,
        env?.VERIFY_API_TOKEN,
        ...(String(env?.VERIFY_CDKEYS || '').trim() ? String(env.VERIFY_CDKEYS).split(/[\n,;]+/) : [])
    ]);
    const fallbackConfig = {
        enabled: true,
        apiKey: fallbackKeys[0] || '',
        apiKeys: fallbackKeys,
        apiBaseUrl: normalizeText(env?.VERIFY_API_BASE_URL || 'https://aidone.lol')
    };

    if (!supabase?.from) {
        return fallbackConfig;
    }

    const { data, error } = await supabase
        .from('system_config')
        .select('config_value')
        .eq('config_key', 'verify_settings')
        .maybeSingle();

    if (error) {
        throw error;
    }

    const config = data?.config_value && typeof data.config_value === 'object'
        ? data.config_value
        : {};
    const prices = getVerifyPriceMap(config);
    const apiKeys = normalizeVerifyCredentialList([
        ...(Array.isArray(config.verify_cdkeys) ? config.verify_cdkeys : []),
        config.verify_cdkey,
        config.verify_api_key,
        fallbackConfig.apiKey
    ]);

    return {
        enabled: config.enabled !== false,
        apiKey: apiKeys[0] || '',
        apiKeys,
        keyCount: apiKeys.length,
        apiBaseUrl: normalizeText(config.verify_api_base_url || fallbackConfig.apiBaseUrl),
        pricePerVerify: prices.extract,
        pricePerVerifyExtract: prices.extract,
        pricePerVerifyFull: prices.full
    };
}

async function fetchVerifyQuotaStates(config = {}, options = {}) {
    const apiKeys = normalizeVerifyCredentialList(config.apiKeys || config.apiKey);
    const fetchImpl = options.fetchImpl || global.fetch;

    const snapshots = await Promise.all(apiKeys.map(async (apiKey) => {
        const snapshot = await fetchVerifyQuotaSnapshot({
            apiKey,
            apiBaseUrl: config.apiBaseUrl
        }, {
            fetchImpl,
            timeoutMs: options.timeoutMs,
            now: options.now
        });

        return {
            ...snapshot,
            apiKey,
            key_name: normalizeText(snapshot?.key_name) || maskVerifyCredential(apiKey)
        };
    }));

    return snapshots;
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
    const config = await loadVerifyRuntimeConfig(supabase, options.env || process.env);
    if (!config.apiKey || !config.apiBaseUrl) {
        return {
            success: false,
            status: 500,
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
            message: normalizeText(firstFailedSnapshot?.error) || '查询额度失败'
        };
    }

    const totalRemainingUses = healthySnapshots.reduce((sum, snapshot) => sum + Math.max(0, Number(snapshot.balance || 0)), 0);
    const usageSummary = buildVerifyUsageSummary(totalRemainingUses);
    return {
        success: true,
        status: 200,
        balance: usageSummary.remaining_uses,
        credits: usageSummary.remaining_uses,
        remaining_uses: usageSummary.remaining_uses,
        remaining_extract_jobs: usageSummary.remaining_extract_jobs,
        remaining_full_jobs: usageSummary.remaining_full_jobs,
        total_used: healthySnapshots.reduce((sum, snapshot) => sum + Math.max(0, Number(snapshot.total_used || 0)), 0),
        cost_per_job: usageSummary.full_cost_per_job,
        extract_cost_per_job: usageSummary.extract_cost_per_job,
        full_cost_per_job: usageSummary.full_cost_per_job,
        key_name: healthySnapshots.length > 1
            ? `CDKey 池（${healthySnapshots.length}/${config.keyCount || healthySnapshots.length}）`
            : (healthySnapshots[0]?.key_name || maskVerifyCredential(config.apiKey)),
        checked_at: new Date(options.now || Date.now()).toISOString(),
        api_base_url: config.apiBaseUrl,
        key_count: Number(config.keyCount || healthySnapshots.length || 0),
        healthy_key_count: healthySnapshots.length,
        key_states: snapshots.map((snapshot) => buildVerifyQuotaKeyState(snapshot))
    };
}

async function buildLocalVerifyQueueSnapshot(supabase, options = {}) {
    const config = await loadVerifyRuntimeConfig(supabase, options.env || process.env);

    if (!supabase?.from) {
        return {
            success: false,
            status: 503,
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
    const queueSize = rows.filter((row) => ['queued', 'pending'].includes(normalizeText(row?.status).toLowerCase())).length;
    const runningJobs = rows.filter((row) => ['running', 'processing'].includes(normalizeText(row?.status).toLowerCase())).length;

    return {
        success: true,
        status: 200,
        queue_size: queueSize,
        running_jobs: runningJobs,
        key_name: Number(config.keyCount || 0) > 1
            ? `CDKey 池（${config.keyCount}）`
            : maskVerifyCredential(config.apiKey),
        api_base_url: config.apiBaseUrl,
        checked_at: new Date(options.now || Date.now()).toISOString(),
        message: ''
    };
}

module.exports = {
    ACTIVE_VERIFY_STATUSES,
    buildLocalVerifyQueueSnapshot,
    buildVerifyUsageSummary,
    buildVerifyQuotaKeyState,
    fetchDirectVerifyQuotaState,
    fetchVerifyQuotaStates,
    getVerifyPriceMap,
    loadVerifyRuntimeConfig,
    maskVerifyCredential,
    normalizeVerifyCredentialList,
    selectVerifyCredentialForTask
};
