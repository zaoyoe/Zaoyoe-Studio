const crypto = require('crypto');

const SECRET_ALGORITHM = 'aes-256-gcm';
const GEMINI_SECRET_KEY = 'gemini_api_key';

function wrapSecretStoreError(error, fallbackMessage) {
    const message = error?.message || fallbackMessage || 'Admin secret store failed';
    if (message.includes('admin_secret_store')) {
        return new Error('后台密钥仓未初始化，请先执行 20260319_admin_secret_store.sql');
    }
    return new Error(message);
}

function getEncryptionSeed() {
    return process.env.ADMIN_CONFIG_ENCRYPTION_KEY
        || process.env.SUPABASE_SERVICE_ROLE_KEY
        || '';
}

function getEncryptionKey() {
    const seed = getEncryptionSeed();
    if (!seed) {
        throw new Error('请先在 Vercel 环境变量中配置 ADMIN_CONFIG_ENCRYPTION_KEY，用于加密后台密钥存储');
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

async function getStoredAdminSecret(supabase, secretKey) {
    const { data, error } = await supabase
        .from('admin_secret_store')
        .select('secret_key, encrypted_value, metadata, description, updated_at, updated_by')
        .eq('secret_key', secretKey)
        .maybeSingle();

    if (error) {
        throw wrapSecretStoreError(error, 'Failed to load admin secret');
    }

    if (!data) return null;

    return {
        ...data,
        value: decryptSecretValue(data.encrypted_value)
    };
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

async function resolveGeminiRuntimeConfig(supabase) {
    let storedSecret = null;

    try {
        storedSecret = await getStoredAdminSecret(supabase, GEMINI_SECRET_KEY);
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
        updatedBy: storedSecret?.updated_by || null
    };
}

module.exports = {
    GEMINI_SECRET_KEY,
    deleteStoredAdminSecret,
    resolveGeminiRuntimeConfig,
    upsertStoredAdminSecret
};
