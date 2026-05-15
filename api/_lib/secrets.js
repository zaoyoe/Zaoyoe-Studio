const crypto = require('crypto');
const {
    normalizeSiteValue,
    SUPPORTED_SITES
} = require('./site');

const SECRET_ALGORITHM = 'aes-256-gcm';
const GEMINI_SECRET_KEY = 'gemini_api_key';
const CODEX_SECRET_KEY = 'codex_api_key';
const PAYMENT_CHANNEL_SECRET_KEYS = {
    afdian_token: 'payment_provider_afdian_token',
    hupijiao_api_key: 'payment_provider_hupijiao_api_key',
    hupijiao_secret_key: 'payment_provider_hupijiao_secret_key',
    zpay_pkey: 'payment_provider_zpay_pkey',
    nowpayments_api_key: 'payment_provider_nowpayments_api_key',
    nowpayments_ipn_secret: 'payment_provider_nowpayments_ipn_secret'
};
const OPS_ALERT_SECRET_KEYS = {
    telegram_bot_token: 'ops_alert_telegram_bot_token',
    feishu_webhook_url: 'ops_alert_feishu_webhook_url',
    email_api_key: 'ops_alert_email_api_key'
};
const SUPPORTED_PAYMENT_SECRET_SITES = new Set(SUPPORTED_SITES || ['cn', 'intl']);

function wrapSecretStoreError(error, fallbackMessage) {
    const message = error?.message || fallbackMessage || 'Admin secret store failed';
    if (message.includes('admin_secret_store')) {
        return new Error('后台密钥仓未初始化，请先执行 20260319_admin_secret_store.sql');
    }
    return new Error(message);
}

function isSecretDecryptAuthenticationError(error) {
    return String(error?.message || '').trim() === 'Unsupported state or unable to authenticate data';
}

function buildSecretDecryptFailureMessage(secretKey = '') {
    const label = secretKey === GEMINI_SECRET_KEY
        ? 'Gemini Key'
        : (secretKey === CODEX_SECRET_KEY ? 'Codex API Key' : '后台密钥');
    return `${label} 无法解密。通常是 ADMIN_CONFIG_ENCRYPTION_KEY 已轮换，请重新录入该密钥。`;
}

function readIndependentSecret(secretValue, label, env = process.env) {
    const normalizedSecret = String(secretValue || '').trim();
    if (!normalizedSecret) return '';

    const serviceRoleKey = String(env?.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    if (serviceRoleKey && normalizedSecret === serviceRoleKey) {
        throw new Error(`${label} 不能复用 SUPABASE_SERVICE_ROLE_KEY，请配置独立密钥`);
    }

    return normalizedSecret;
}

function getEncryptionSeed() {
    return readIndependentSecret(
        process.env.ADMIN_CONFIG_ENCRYPTION_KEY,
        'ADMIN_CONFIG_ENCRYPTION_KEY'
    );
}

function getEncryptionKey() {
    const seed = getEncryptionSeed();
    if (!seed) {
        throw new Error('请先配置独立的 ADMIN_CONFIG_ENCRYPTION_KEY，用于加密后台密钥存储');
    }

    return crypto.createHash('sha256').update(seed).digest();
}

function encryptSecretValue(value) {
    const normalized = String(value || '').trim();
    if (!normalized) {
        throw new Error('Secret value is required');
    }

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(SECRET_ALGORITHM, getEncryptionKey(), iv);
    const ciphertext = Buffer.concat([
        cipher.update(normalized, 'utf8'),
        cipher.final()
    ]);

    return {
        version: 1,
        algorithm: SECRET_ALGORITHM,
        iv: iv.toString('base64'),
        ciphertext: ciphertext.toString('base64'),
        tag: cipher.getAuthTag().toString('base64')
    };
}

function decryptSecretValue(payload) {
    if (!payload || typeof payload !== 'object') {
        throw new Error('Stored secret payload is invalid');
    }

    if (payload.algorithm !== SECRET_ALGORITHM) {
        throw new Error('Unsupported secret encryption algorithm');
    }

    const decipher = crypto.createDecipheriv(
        SECRET_ALGORITHM,
        getEncryptionKey(),
        Buffer.from(String(payload.iv || ''), 'base64')
    );
    decipher.setAuthTag(Buffer.from(String(payload.tag || ''), 'base64'));

    const plaintext = Buffer.concat([
        decipher.update(Buffer.from(String(payload.ciphertext || ''), 'base64')),
        decipher.final()
    ]);

    return plaintext.toString('utf8');
}

async function getStoredAdminSecret(supabase, secretKey, options = {}) {
    const { data, error } = await supabase
        .from('admin_secret_store')
        .select('secret_key, encrypted_value, metadata, description, updated_at, updated_by')
        .eq('secret_key', secretKey);

    if (error) {
        throw wrapSecretStoreError(error, 'Failed to load admin secret');
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;

    try {
        return {
            ...row,
            value: decryptSecretValue(row.encrypted_value),
            decryptErrorMessage: ''
        };
    } catch (error) {
        if (options.allowDecryptFailure === true && isSecretDecryptAuthenticationError(error)) {
            return {
                ...row,
                value: '',
                decryptErrorMessage: buildSecretDecryptFailureMessage(secretKey)
            };
        }
        throw error;
    }
}

async function upsertStoredAdminSecret({
    supabase,
    secretKey,
    secretValue,
    adminId,
    description = '',
    metadata = {}
}) {
    const payload = {
        secret_key: secretKey,
        encrypted_value: encryptSecretValue(secretValue),
        metadata,
        description: description || null,
        updated_by: adminId,
        updated_at: new Date().toISOString()
    };

    const { error } = await supabase
        .from('admin_secret_store')
        .upsert(payload, { onConflict: 'secret_key' });

    if (error) {
        throw wrapSecretStoreError(error, 'Failed to save admin secret');
    }
}

async function deleteStoredAdminSecret(supabase, secretKey) {
    const { error } = await supabase
        .from('admin_secret_store')
        .delete()
        .eq('secret_key', secretKey);

    if (error) {
        throw wrapSecretStoreError(error, 'Failed to delete admin secret');
    }
}

function normalizePaymentSecretSite(value, options = {}) {
    const allowEmpty = options.allowEmpty === true;
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) {
        return allowEmpty ? '' : 'cn';
    }
    return normalizeSiteValue(normalized, { fallback: allowEmpty ? '' : 'cn' });
}

function buildPaymentSiteSecretKey(secretName, site = 'cn') {
    const baseSecretKey = PAYMENT_CHANNEL_SECRET_KEYS[secretName];
    if (!baseSecretKey) {
        return '';
    }
    const normalizedSite = normalizePaymentSecretSite(site, { allowEmpty: false });
    return `${baseSecretKey}__${normalizedSite}`;
}

function getPaymentSecretLookupKeys(secretName, site = '') {
    const baseSecretKey = PAYMENT_CHANNEL_SECRET_KEYS[secretName];
    if (!baseSecretKey) {
        return [];
    }

    const normalizedSite = normalizePaymentSecretSite(site, { allowEmpty: true });
    const keys = [];
    if (SUPPORTED_PAYMENT_SECRET_SITES.has(normalizedSite)) {
        keys.push(buildPaymentSiteSecretKey(secretName, normalizedSite));
    }
    keys.push(baseSecretKey);
    return Array.from(new Set(keys.filter(Boolean)));
}

async function resolveStoredPaymentSecret(supabase, secretName, options = {}) {
    const lookupKeys = getPaymentSecretLookupKeys(secretName, options.site);

    for (const candidateKey of lookupKeys) {
        const storedSecret = await getStoredAdminSecret(supabase, candidateKey).catch(() => null);
        if (!storedSecret?.value) {
            continue;
        }

        const scopedSite = candidateKey === PAYMENT_CHANNEL_SECRET_KEYS[secretName]
            ? ''
            : normalizePaymentSecretSite(candidateKey.split('__').slice(-1)[0], { allowEmpty: true });

        return {
            ...storedSecret,
            secret_name: secretName,
            secret_key: candidateKey,
            site: scopedSite || null,
            scope: scopedSite ? 'site' : 'global'
        };
    }

    return null;
}

async function resolveGeminiRuntimeConfig(supabase) {
    let storedSecret = null;

    try {
        storedSecret = await getStoredAdminSecret(supabase, GEMINI_SECRET_KEY, {
            allowDecryptFailure: true
        });
    } catch (error) {
        if (!process.env.GEMINI_API_KEY) {
            throw error;
        }
    }

    const envApiKey = String(process.env.GEMINI_API_KEY || '').trim();
    const apiKey = storedSecret?.value || envApiKey || '';
    const source = storedSecret?.value
        ? 'stored'
        : (envApiKey ? 'environment' : 'missing');
    const configured = Boolean(apiKey);
    const storedModel = typeof storedSecret?.metadata?.model === 'string'
        ? storedSecret.metadata.model.trim()
        : '';
    const model = storedModel || process.env.GEMINI_MODEL || 'gemini-2.0-flash';

    return {
        configured,
        source,
        model,
        apiKey,
        updatedAt: storedSecret?.updated_at || null,
        updatedBy: storedSecret?.updated_by || null,
        decryptErrorMessage: storedSecret?.decryptErrorMessage || ''
    };
}

function normalizeOptionalUrl(value) {
    return String(value || '').trim().replace(/\/+$/, '');
}

function normalizeCodexApiFormat(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized === 'responses' ? 'responses' : 'chat.completions';
}

async function resolveCodexRuntimeConfig(supabase) {
    let storedSecret = null;

    try {
        storedSecret = await getStoredAdminSecret(supabase, CODEX_SECRET_KEY, {
            allowDecryptFailure: true
        });
    } catch (error) {
        if (!process.env.CODEX_API_KEY) {
            throw error;
        }
    }

    const envApiKey = String(process.env.CODEX_API_KEY || process.env.OPENAI_API_KEY || '').trim();
    const envBaseUrl = normalizeOptionalUrl(
        process.env.CODEX_API_BASE_URL
        || process.env.OPENAI_API_BASE_URL
        || process.env.OPENAI_BASE_URL
    );
    const envModel = String(process.env.CODEX_MODEL || process.env.OPENAI_MODEL || '').trim();
    const envApiFormat = normalizeCodexApiFormat(
        process.env.CODEX_API_FORMAT
        || process.env.OPENAI_API_FORMAT
        || process.env.OPENAI_WIRE_API
        || 'responses'
    );
    const metadata = storedSecret?.metadata && typeof storedSecret.metadata === 'object'
        ? storedSecret.metadata
        : {};
    const apiKey = storedSecret?.value || envApiKey || '';
    const baseUrl = normalizeOptionalUrl(metadata.baseUrl || metadata.base_url || envBaseUrl);
    const source = storedSecret?.value
        ? 'stored'
        : (envApiKey ? 'environment' : 'missing');
    const configured = Boolean(apiKey && baseUrl);
    const model = String(metadata.model || envModel || 'gpt-5.4').trim() || 'gpt-5.4';
    const apiFormat = normalizeCodexApiFormat(metadata.apiFormat || metadata.api_format || envApiFormat || 'responses');

    return {
        configured,
        source,
        model,
        apiKey,
        baseUrl,
        apiFormat,
        updatedAt: storedSecret?.updated_at || null,
        updatedBy: storedSecret?.updated_by || null,
        decryptErrorMessage: storedSecret?.decryptErrorMessage || ''
    };
}

module.exports = {
    __testUtils: {
        getEncryptionKey,
        isSecretDecryptAuthenticationError,
        readIndependentSecret
    },
    CODEX_SECRET_KEY,
    GEMINI_SECRET_KEY,
    OPS_ALERT_SECRET_KEYS,
    PAYMENT_CHANNEL_SECRET_KEYS,
    buildPaymentSiteSecretKey,
    deleteStoredAdminSecret,
    getPaymentSecretLookupKeys,
    getStoredAdminSecret,
    normalizePaymentSecretSite,
    resolveCodexRuntimeConfig,
    resolveGeminiRuntimeConfig,
    resolveStoredPaymentSecret,
    upsertStoredAdminSecret
};
