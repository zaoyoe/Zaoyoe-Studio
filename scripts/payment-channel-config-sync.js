const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const {
    loadStoredPaymentConfigs,
    normalizePaymentChannelsConfig,
    normalizeRechargeOptionsConfig
} = require('../api/_lib/payments/providers');

const DEFAULT_ENV_FILE = path.resolve(__dirname, '../server/.env.production');

function parseArgs(argv = []) {
    const options = {
        envFile: DEFAULT_ENV_FILE,
        execute: false,
        json: false,
        provider: ''
    };

    for (let index = 0; index < argv.length; index += 1) {
        const value = String(argv[index] || '').trim();
        if (!value) continue;

        if (value === '--env-file') {
            options.envFile = path.resolve(process.cwd(), String(argv[index + 1] || '').trim());
            index += 1;
            continue;
        }

        if (value === '--execute' || value === '--apply') {
            options.execute = true;
            continue;
        }

        if (value === '--json') {
            options.json = true;
            continue;
        }

        if (value === '--provider') {
            options.provider = String(argv[index + 1] || '').trim().toLowerCase();
            index += 1;
        }
    }

    return options;
}

function loadEnvFile(envFile) {
    if (!envFile || !fs.existsSync(envFile)) {
        return {};
    }

    return dotenv.parse(fs.readFileSync(envFile, 'utf8'));
}

function getRequiredEnv(envValues, name) {
    const value = String(envValues?.[name] || process.env[name] || '').trim();
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}

function buildSupabaseClient(envValues = {}) {
    return createClient(
        getRequiredEnv(envValues, 'SUPABASE_URL'),
        getRequiredEnv(envValues, 'SUPABASE_SERVICE_ROLE_KEY'),
        {
            auth: {
                persistSession: false,
                autoRefreshToken: false
            }
        }
    );
}

function resolveTargetProvider(paymentChannels = {}, explicitProvider = '') {
    if (explicitProvider === 'afdian' || explicitProvider === 'hupijiao') {
        return explicitProvider;
    }

    const providers = paymentChannels?.providers || {};
    const afdianCheckoutUrl = String(providers.afdian?.checkout_url || '').trim();
    if (afdianCheckoutUrl) {
        return 'afdian';
    }

    const hupijiaoConfigured = Boolean(
        String(providers.hupijiao?.checkout_url || '').trim()
        || String(providers.hupijiao?.gateway_url || '').trim()
        || String(providers.hupijiao?.merchant_id || '').trim()
    );
    if (hupijiaoConfigured) {
        return 'hupijiao';
    }

    return 'afdian';
}

function buildSyncPlan(paymentChannels, rechargeOptions, options = {}) {
    const normalizedPaymentChannels = normalizePaymentChannelsConfig(paymentChannels, rechargeOptions);
    const normalizedRechargeOptions = normalizeRechargeOptionsConfig(rechargeOptions);
    const targetProvider = resolveTargetProvider(normalizedPaymentChannels, options.provider);
    const nextPaymentChannels = JSON.parse(JSON.stringify(normalizedPaymentChannels));
    const nextRechargeOptions = {
        ...normalizedRechargeOptions,
        mock_payment_enabled: false
    };

    nextPaymentChannels.active_provider = targetProvider;
    if (nextPaymentChannels.providers?.mock) {
        nextPaymentChannels.providers.mock.enabled = false;
    }
    if (nextPaymentChannels.providers?.[targetProvider]) {
        nextPaymentChannels.providers[targetProvider].enabled = true;
    }

    const changed = JSON.stringify(nextPaymentChannels) !== JSON.stringify(normalizedPaymentChannels)
        || JSON.stringify(nextRechargeOptions) !== JSON.stringify(normalizedRechargeOptions);

    return {
        changed,
        targetProvider,
        current: {
            paymentChannels: normalizedPaymentChannels,
            rechargeOptions: normalizedRechargeOptions
        },
        next: {
            paymentChannels: nextPaymentChannels,
            rechargeOptions: nextRechargeOptions
        }
    };
}

async function upsertSystemConfig(supabase, existingRow = {}, configValue) {
    const payload = {
        config_key: existingRow.config_key,
        config_value: configValue,
        description: existingRow.description || null,
        updated_at: new Date().toISOString()
    };

    if (existingRow.updated_by) {
        payload.updated_by = existingRow.updated_by;
    }

    const { error } = await supabase
        .from('system_config')
        .upsert(payload, { onConflict: 'config_key' });

    if (error) {
        throw new Error(error.message || `Failed to save ${existingRow.config_key}`);
    }
}

function formatHumanReport(result = {}) {
    const lines = [];
    lines.push('Payment Channel Config Sync');
    lines.push('');
    lines.push(`mode: ${result.mode || 'preview'}`);
    lines.push(`project_host: ${result.project_host || ''}`);
    lines.push(`target_provider: ${result.plan?.targetProvider || ''}`);
    lines.push(`changed: ${result.plan?.changed ? 'yes' : 'no'}`);
    lines.push('');
    lines.push('current');
    lines.push(`  active_provider: ${result.plan?.current?.paymentChannels?.active_provider || ''}`);
    lines.push(`  mock_enabled: ${result.plan?.current?.paymentChannels?.providers?.mock?.enabled === true ? 'yes' : 'no'}`);
    lines.push(`  recharge_mock_enabled: ${result.plan?.current?.rechargeOptions?.mock_payment_enabled === true ? 'yes' : 'no'}`);
    lines.push('');
    lines.push('next');
    lines.push(`  active_provider: ${result.plan?.next?.paymentChannels?.active_provider || ''}`);
    lines.push(`  mock_enabled: ${result.plan?.next?.paymentChannels?.providers?.mock?.enabled === true ? 'yes' : 'no'}`);
    lines.push(`  recharge_mock_enabled: ${result.plan?.next?.rechargeOptions?.mock_payment_enabled === true ? 'yes' : 'no'}`);
    return lines.join('\n');
}

async function runSync(options = {}) {
    const envValues = loadEnvFile(options.envFile);
    const supabase = buildSupabaseClient(envValues);
    const { data, error } = await supabase
        .from('system_config')
        .select('config_key, config_value, description, updated_by')
        .in('config_key', ['payment_channels', 'recharge_options']);

    if (error) {
        throw new Error(error.message || 'Failed to load system_config');
    }

    const rows = Array.isArray(data) ? data : [];
    const rowMap = Object.fromEntries(rows.map((row) => [row.config_key, row]));
    const loaded = await loadStoredPaymentConfigs(supabase);
    const plan = buildSyncPlan(loaded.rawPaymentChannels, loaded.rawRechargeOptions, options);
    const result = {
        mode: options.execute ? 'execute' : 'preview',
        project_host: new URL(getRequiredEnv(envValues, 'SUPABASE_URL')).host,
        plan
    };

    if (options.execute && plan.changed) {
        await upsertSystemConfig(supabase, {
            ...rowMap.payment_channels,
            config_key: 'payment_channels'
        }, plan.next.paymentChannels);
        await upsertSystemConfig(supabase, {
            ...rowMap.recharge_options,
            config_key: 'recharge_options'
        }, plan.next.rechargeOptions);
    }

    return result;
}

if (require.main === module) {
    const options = parseArgs(process.argv.slice(2));
    runSync(options)
        .then((result) => {
            if (options.json) {
                console.log(JSON.stringify(result, null, 2));
                return;
            }
            console.log(formatHumanReport(result));
        })
        .catch((error) => {
            console.error(error.message || String(error));
            process.exitCode = 1;
        });
}

module.exports = {
    buildSyncPlan,
    formatHumanReport,
    parseArgs,
    resolveTargetProvider,
    runSync
};
