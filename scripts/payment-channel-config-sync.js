const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const {
    buildPaymentProviderActivationCheck,
    buildPaymentSecretStatus,
    loadStoredPaymentConfigs,
    normalizePaymentChannelsConfig,
    normalizeRechargeOptionsConfig
} = require('../api/_lib/payments/providers');
const {
    getMockPaymentRuntimeState
} = require('../api/_lib/payments/orders');

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

function resolveTargetProvider(paymentChannels = {}, explicitProvider = '', secretStatus = {}, env = process.env) {
    if (explicitProvider === 'mock' || explicitProvider === 'afdian' || explicitProvider === 'hupijiao' || explicitProvider === 'zpay' || explicitProvider === 'nowpayments') {
        return explicitProvider;
    }

    const providers = paymentChannels?.providers || {};
    const nowpaymentsReadiness = buildPaymentProviderActivationCheck('nowpayments', paymentChannels, secretStatus, env);
    if (providers.nowpayments?.enabled === true && nowpaymentsReadiness.ready) {
        return 'nowpayments';
    }

    const zpayReadiness = buildPaymentProviderActivationCheck('zpay', paymentChannels, secretStatus, env);
    if (providers.zpay?.enabled === true && zpayReadiness.ready) {
        return 'zpay';
    }

    const hupijiaoReadiness = buildPaymentProviderActivationCheck('hupijiao', paymentChannels, secretStatus, env);
    if (providers.hupijiao?.enabled === true && hupijiaoReadiness.ready) {
        return 'hupijiao';
    }

    const afdianReadiness = buildPaymentProviderActivationCheck('afdian', paymentChannels, secretStatus, env);
    if (providers.afdian?.enabled === true && afdianReadiness.ready) {
        return 'afdian';
    }

    return 'afdian';
}

function buildSyncPlan(paymentChannels, rechargeOptions, options = {}) {
    const normalizedPaymentChannels = normalizePaymentChannelsConfig(paymentChannels, rechargeOptions);
    const normalizedRechargeOptions = normalizeRechargeOptionsConfig(rechargeOptions);
    const runtimeEnv = options.env || process.env;
    const secretStatus = options.secretStatus || {};
    const targetProvider = resolveTargetProvider(
        normalizedPaymentChannels,
        options.provider,
        secretStatus,
        runtimeEnv
    );
    const nextPaymentChannels = JSON.parse(JSON.stringify(normalizedPaymentChannels));
    const nextRechargeOptions = {
        ...normalizedRechargeOptions,
        mock_payment_enabled: targetProvider === 'mock'
    };

    nextPaymentChannels.active_provider = targetProvider;
    if (nextPaymentChannels.providers?.mock && targetProvider !== 'mock') {
        nextPaymentChannels.providers.mock.enabled = false;
    }
    if (nextPaymentChannels.providers?.[targetProvider]) {
        nextPaymentChannels.providers[targetProvider].enabled = true;
    }

    const changed = JSON.stringify(nextPaymentChannels) !== JSON.stringify(normalizedPaymentChannels)
        || JSON.stringify(nextRechargeOptions) !== JSON.stringify(normalizedRechargeOptions);
    const targetProviderValidation = buildPaymentProviderActivationCheck(
        targetProvider,
        nextPaymentChannels,
        secretStatus,
        runtimeEnv
    );

    return {
        changed,
        targetProvider,
        targetProviderValidation,
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

function getRuntimeEnv(envValues = {}) {
    return {
        ...process.env,
        ...envValues
    };
}

function getMockRuntimeForEnv(envValues = {}) {
    const env = getRuntimeEnv(envValues);
    return getMockPaymentRuntimeState({
        requestHost: String(env.APP_BASE_URL || '').trim(),
        env
    });
}

function assertExecuteAllowed(plan, envValues = {}, options = {}) {
    if (!options.execute) {
        return null;
    }

    if (plan?.targetProvider === 'mock') {
        const runtime = getMockRuntimeForEnv(envValues);
        if (runtime.allowed === true) {
            return runtime;
        }

        throw new Error(
            `Refusing to switch stored payment config to mock because runtime mock payments are still blocked (${runtime.reason || 'unknown'}). `
            + '请先设置 ALLOW_REMOTE_MOCK_PAYMENTS_UNTIL 并完成 redeploy。'
        );
    }

    if (plan?.targetProviderValidation && plan.targetProviderValidation.ready !== true) {
        throw new Error(
            `Refusing to switch stored payment config to ${plan.targetProvider} because `
            + `${plan.targetProviderValidation.issues.join('；') || 'the provider is not ready'}.`
        );
    }

    return null;
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
    lines.push(`target_ready: ${result.plan?.targetProviderValidation?.ready === true ? 'yes' : 'no'}`);
    lines.push(`changed: ${result.plan?.changed ? 'yes' : 'no'}`);
    if (Array.isArray(result.plan?.targetProviderValidation?.issues) && result.plan.targetProviderValidation.issues.length) {
        lines.push(`target_issues: ${result.plan.targetProviderValidation.issues.join('；')}`);
    }
    if (Array.isArray(result.plan?.targetProviderValidation?.warnings) && result.plan.targetProviderValidation.warnings.length) {
        lines.push(`target_warnings: ${result.plan.targetProviderValidation.warnings.join('；')}`);
    }
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
    if (result.runtime) {
        lines.push('');
        lines.push('runtime');
        lines.push(`  mock_allowed: ${result.runtime.allowed === true ? 'yes' : 'no'}`);
        lines.push(`  mock_reason: ${result.runtime.reason || ''}`);
    }
    return lines.join('\n');
}

async function runSync(options = {}) {
    const envValues = loadEnvFile(options.envFile);
    const supabase = buildSupabaseClient(envValues);
    const runtimeEnv = getRuntimeEnv(envValues);
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
    const secretStatus = await buildPaymentSecretStatus(supabase, runtimeEnv);
    const plan = buildSyncPlan(loaded.rawPaymentChannels, loaded.rawRechargeOptions, {
        ...options,
        env: runtimeEnv,
        secretStatus
    });
    const runtime = plan.targetProvider === 'mock' ? getMockRuntimeForEnv(envValues) : null;
    const result = {
        mode: options.execute ? 'execute' : 'preview',
        project_host: new URL(getRequiredEnv(envValues, 'SUPABASE_URL')).host,
        plan,
        runtime
    };

    assertExecuteAllowed(plan, envValues, options);

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
    assertExecuteAllowed,
    buildSyncPlan,
    formatHumanReport,
    getMockRuntimeForEnv,
    parseArgs,
    resolveTargetProvider,
    runSync
};
