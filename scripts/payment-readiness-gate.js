const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

const DEFAULT_ENV_FILE = path.resolve(__dirname, '../server/.env.production');
const CAPABILITY_DEFINITIONS = Object.freeze([
    Object.freeze({
        key: 'shop_multi_discount_purchase',
        rpcName: 'fn_purchase_shop_item_with_discounts',
        label: '商城多券叠加购买 RPC',
        migration: '20260416_enable_multi_discount_shop_stacking.sql',
        buildProbeArgs() {
            return {
                p_product_id: null,
                p_user_id: null,
                p_site: 'cn',
                p_quantity: 1,
                p_discount_inputs: [],
                p_agent_id: null
            };
        }
    }),
    Object.freeze({
        key: 'admin_refund_reclaim',
        rpcName: 'fn_deduct_points_admin_site_with_breakdown',
        label: '后台退款积分扣回 RPC',
        migration: '20260324_add_admin_refund_reclaim_rpc.sql',
        buildProbeArgs() {
            return {
                p_target_user_id: null,
                p_amount: 1,
                p_reason: 'readiness_probe',
                p_reference_id: null,
                p_site: 'cn'
            };
        }
    })
]);

function parseArgs(argv = []) {
    const options = {
        envFile: DEFAULT_ENV_FILE,
        json: false,
        failOnMissing: false
    };

    for (let index = 0; index < argv.length; index += 1) {
        const value = String(argv[index] || '').trim();
        if (!value) continue;

        if (value === '--env-file') {
            options.envFile = path.resolve(process.cwd(), String(argv[index + 1] || '').trim());
            index += 1;
            continue;
        }

        if (value === '--fail-on-missing') {
            options.failOnMissing = true;
            continue;
        }

        if (value === '--json') {
            options.json = true;
        }
    }

    return options;
}

function loadEnvFile(envFile) {
    if (!envFile) return;
    dotenv.config({
        path: envFile,
        override: true
    });
}

function getRequiredEnv(name) {
    const value = String(process.env[name] || '').trim();
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}

function buildSupabaseClient() {
    return createClient(
        getRequiredEnv('SUPABASE_URL'),
        getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
        {
            auth: {
                persistSession: false,
                autoRefreshToken: false
            }
        }
    );
}

function isMissingRpcCapabilityError(error, rpcName = '') {
    const normalizedCode = String(error?.code || '').trim().toUpperCase();
    const normalizedMessage = [
        error?.message,
        error?.details,
        error?.hint
    ].filter(Boolean).join(' ').trim().toLowerCase();
    const normalizedRpcName = String(rpcName || '').trim().toLowerCase();

    if (normalizedCode === '42883' || normalizedCode === 'PGRST202') {
        return true;
    }

    if (normalizedMessage.includes('could not find the function') || normalizedMessage.includes('schema cache')) {
        return true;
    }

    return normalizedMessage.includes('function')
        && normalizedMessage.includes('does not exist')
        && (!normalizedRpcName || normalizedMessage.includes(normalizedRpcName));
}

function getRpcProbePayload(data) {
    if (Array.isArray(data)) {
        return data[0] || null;
    }
    return data || null;
}

async function probeRpcCapability(supabase, definition = {}) {
    let data = null;
    let error = null;

    try {
        const result = await supabase.rpc(definition.rpcName, definition.buildProbeArgs());
        data = result?.data ?? null;
        error = result?.error ?? null;
    } catch (thrownError) {
        error = thrownError;
    }

    const payload = getRpcProbePayload(data);
    const missing = isMissingRpcCapabilityError(error, definition.rpcName);

    return {
        key: definition.key,
        rpc_name: definition.rpcName,
        label: definition.label,
        migration: definition.migration,
        available: !missing,
        outcome: missing
            ? 'missing'
            : (error ? 'rejected_as_expected' : 'returned_payload'),
        probe: {
            code: String(error?.code || '').trim() || '',
            message: String(error?.message || payload?.message || '').trim(),
            payload
        }
    };
}

function buildReadinessSummary({
    envFile,
    projectHost,
    capabilityResults = []
}) {
    const capabilities = Object.fromEntries(
        capabilityResults.map((result) => [result.key, result])
    );
    const findings = capabilityResults
        .filter((result) => result.available !== true)
        .map((result) => ({
            severity: 'high',
            key: `missing_${result.key}`,
            message: `${result.label} 缺失，请先执行 ${result.migration}`,
            rpc_name: result.rpc_name,
            migration: result.migration
        }));

    return {
        checked_at: new Date().toISOString(),
        env_file: envFile,
        project_host: projectHost,
        capabilities,
        findings,
        ok: findings.length === 0
    };
}

function formatHumanReport(summary = {}) {
    const lines = [
        'Payment RPC Readiness Gate',
        '',
        `project_host: ${summary.project_host || '(missing)'}`,
        `env_file: ${summary.env_file || DEFAULT_ENV_FILE}`,
        `checked_at: ${summary.checked_at || ''}`,
        ''
    ];

    for (const capability of Object.values(summary.capabilities || {})) {
        lines.push(capability.key);
        lines.push(`  rpc_name: ${capability.rpc_name}`);
        lines.push(`  label: ${capability.label}`);
        lines.push(`  migration: ${capability.migration}`);
        lines.push(`  available: ${capability.available === true ? 'yes' : 'no'}`);
        lines.push(`  outcome: ${capability.outcome || ''}`);
        if (capability.probe?.code) {
            lines.push(`  probe.code: ${capability.probe.code}`);
        }
        if (capability.probe?.message) {
            lines.push(`  probe.message: ${capability.probe.message}`);
        }
        lines.push('');
    }

    if (!summary.findings?.length) {
        lines.push('findings: none');
    } else {
        lines.push('findings:');
        for (const finding of summary.findings) {
            lines.push(`- [${finding.severity}] ${finding.message}`);
        }
    }

    lines.push('');
    lines.push(`result: ${summary.ok ? 'PASS' : 'FAIL'}`);
    return lines.join('\n');
}

async function runReadinessGate({ envFile = DEFAULT_ENV_FILE } = {}) {
    loadEnvFile(envFile);

    const projectHost = new URL(getRequiredEnv('SUPABASE_URL')).host;
    const supabase = buildSupabaseClient();
    const capabilityResults = [];

    for (const definition of CAPABILITY_DEFINITIONS) {
        capabilityResults.push(await probeRpcCapability(supabase, definition));
    }

    return buildReadinessSummary({
        envFile,
        projectHost,
        capabilityResults
    });
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    const summary = await runReadinessGate({ envFile: options.envFile });

    console.log(options.json ? JSON.stringify(summary, null, 2) : formatHumanReport(summary));

    if (options.failOnMissing && !summary.ok) {
        process.exitCode = 2;
    }
}

if (require.main === module) {
    main().catch((error) => {
        console.error(error.message || error);
        process.exitCode = 1;
    });
}

module.exports = {
    CAPABILITY_DEFINITIONS,
    DEFAULT_ENV_FILE,
    buildReadinessSummary,
    formatHumanReport,
    isMissingRpcCapabilityError,
    parseArgs,
    probeRpcCapability,
    runReadinessGate
};
