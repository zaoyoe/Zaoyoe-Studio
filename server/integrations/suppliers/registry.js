'use strict';

const { createSupplierAdapterRegistry, SupplierAdapterError } = require('./contract');
const { create16688AdapterFromEnv } = require('./16688/client');
const { createXiarengAdapter } = require('./xiareng/client');

const PROVIDERS = Object.freeze([
    Object.freeze({ providerId: '16688', name: '16688', readOnly: false }),
    Object.freeze({ providerId: 'xiareng', name: '虾仁', readOnly: true })
]);

function resolveSupplierAccountEnv(account, env = process.env) {
    const providerId = String(account?.provider_id || '');
    const providerPrefix = { '16688': 'SUPPLIER_16688', xiareng: 'SUPPLIER_XIARENG' }[providerId];
    const reference = String(account?.credential_ref || '');
    const prefix = reference.startsWith('env:') ? reference.slice(4) : '';
    // A persisted account cannot read unrelated environment secrets or select
    // another provider's credentials. Account keys never become env names.
    if (!providerPrefix || !new RegExp(`^${providerPrefix}(?:_[A-Z][A-Z0-9_]{0,40})?$`).test(prefix)) {
        throw new SupplierAdapterError('供应商账号凭据引用无效。', { providerId, operation: 'resolve_account', code: 'supplier_credential_ref_invalid' });
    }
    const appId = String(env[`${prefix}_APP_ID`] || '').trim();
    const secretSuffix = providerId === 'xiareng' ? 'APP_KEY' : 'SECRET';
    const secret = String(env[`${prefix}_${secretSuffix}`] || '');
    if (!appId || !secret) throw new SupplierAdapterError('供应商账号尚未配置凭据。', { providerId, operation: 'resolve_account', code: 'supplier_not_configured' });
    if (providerId === 'xiareng') {
        return { providerId, appId, appKey: secret, currency: String(env[`${prefix}_CURRENCY`] || ''), timeoutMs: env[`${prefix}_TIMEOUT_MS`] };
    }
    return { providerId, env: {
        SUPPLIER_16688_APP_ID: appId,
        SUPPLIER_16688_SECRET: secret,
        SUPPLIER_16688_GATEWAY: env[`${prefix}_GATEWAY`],
        SUPPLIER_16688_TIMEOUT_MS: env[`${prefix}_TIMEOUT_MS`]
    } };
}

function getSupplierAccountConfiguration(account, env = process.env) {
    try {
        resolveSupplierAccountEnv(account, env);
        return { configured: true, configurationCode: 'configured' };
    } catch (error) {
        return { configured: false, configurationCode: error.code || 'supplier_not_configured' };
    }
}

/** Create one isolated client per persisted account; never cache by provider. */
function createConfiguredSupplierAdapterRegistry({ env = process.env, options = {}, account = null } = {}) {
    const adapters = [];
    if (account) {
        const config = resolveSupplierAccountEnv(account, env);
        const providerOptions = options[config.providerId] || {};
        adapters.push(config.providerId === 'xiareng'
            ? createXiarengAdapter({ ...providerOptions, ...config })
            : create16688AdapterFromEnv(config.env, providerOptions));
    } else {
        // Compatibility for existing provider-only callers. Non-default accounts
        // must always be resolved from their persisted credential_ref.
        for (const provider of PROVIDERS) {
            const prefix = provider.providerId === '16688' ? 'SUPPLIER_16688' : 'SUPPLIER_XIARENG';
            const configured = getSupplierAccountConfiguration({ provider_id: provider.providerId, credential_ref: `env:${prefix}` }, env);
            if (!configured.configured) continue;
            const config = resolveSupplierAccountEnv({ provider_id: provider.providerId, credential_ref: `env:${prefix}` }, env);
            adapters.push(provider.providerId === 'xiareng'
                ? createXiarengAdapter({ ...(options.xiareng || {}), ...config })
                : create16688AdapterFromEnv(config.env, options['16688'] || {}));
        }
    }
    return createSupplierAdapterRegistry(adapters);
}

module.exports = { PROVIDERS, resolveSupplierAccountEnv, getSupplierAccountConfiguration, createConfiguredSupplierAdapterRegistry };
