const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

const DEFAULT_ENV_FILE = path.resolve(__dirname, '../server/.env.production');
const CAPABILITY_DEFINITIONS = Object.freeze([
    Object.freeze({
        key: 'payment_checkout_session',
        rpcName: 'fn_create_payment_checkout_session',
        label: '支付 checkout session 创建 RPC',
        migration: '20260418_enable_decimal_payment_and_redemption_precision.sql',
        buildProbeArgs() {
            return {
                p_payload: {},
                p_user_id: null
            };
        }
    }),
    Object.freeze({
        key: 'payment_redemption_code',
        rpcName: 'fn_ensure_redemption_code_for_payment_order',
        label: '支付订单兑换码补发/确认 RPC',
        migration: '20260418_enable_decimal_payment_and_redemption_precision.sql',
        buildProbeArgs() {
            return {
                p_payment_order_id: null,
                p_package_id: null,
                p_points: 0.01,
                p_site: 'cn',
                p_external_order_id: 'readiness_probe'
            };
        }
    }),
    Object.freeze({
        key: 'points_recharge',
        rpcName: 'fn_recharge_points',
        label: '积分充值入账 RPC',
        migration: '20260416_enable_decimal_shop_points_precision.sql',
        buildProbeArgs() {
            return {
                target_user_id: null,
                p_paid: 0.01,
                p_bonus: 0,
                p_reason: 'readiness_probe',
                p_reference_id: 'readiness_probe',
                p_site: 'cn'
            };
        }
    }),
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
        key: 'shop_admin_refund',
        rpcName: 'fn_admin_refund_order',
        label: '商城订单退款/库存恢复 RPC',
        migration: '20260416_enable_decimal_shop_points_precision.sql',
        buildProbeArgs() {
            return {
                p_order_id: null,
                p_admin_id: null,
                p_target_status: 'frozen',
                p_remark: 'readiness_probe'
            };
        }
    }),
    Object.freeze({
        key: 'admin_refund_reclaim',
        rpcName: 'fn_deduct_points_admin_site_with_breakdown',
        label: '后台退款积分扣回 RPC',
        migration: '20260418_enable_decimal_refund_reclaim_rpc.sql',
        buildProbeArgs() {
            return {
                p_target_user_id: null,
                p_amount: 0.01,
                p_reason: 'readiness_probe',
                p_reference_id: null,
                p_site: 'cn'
            };
        }
    })
]);
const RECOVERY_AUDIT_RELATIONS = Object.freeze([
    Object.freeze({
        key: 'payment_order_recovery_audit',
        relationName: 'admin_payment_order_recovery_audit_view',
        label: '支付订单恢复审计视图',
        migration: '20260510_add_financial_recovery_audit_views.sql'
    }),
    Object.freeze({
        key: 'points_balance_recovery_audit',
        relationName: 'admin_points_balance_recovery_audit_view',
        label: '积分余额恢复审计视图',
        migration: '20260510_add_financial_recovery_audit_views.sql'
    }),
    Object.freeze({
        key: 'shop_inventory_recovery_audit',
        relationName: 'admin_shop_inventory_recovery_audit_view',
        label: '商城库存恢复审计视图',
        migration: '20260510_add_financial_recovery_audit_views.sql'
    }),
    Object.freeze({
        key: 'financial_recovery_audit_summary',
        relationName: 'admin_financial_recovery_audit_summary_view',
        label: '支付/积分/商城恢复审计汇总视图',
        migration: '20260510_add_financial_recovery_audit_views.sql'
    })
]);
const RECOVERY_AUDIT_VISIBILITY_CHECKS = Object.freeze([
    Object.freeze({
        key: 'payment_order_recovery_audit',
        sourceRelations: ['payment_orders'],
        migration: '20260511_allow_service_role_financial_recovery_audit_views.sql'
    }),
    Object.freeze({
        key: 'points_balance_recovery_audit',
        sourceRelations: ['points_balance', 'points_ledger'],
        migration: '20260511_allow_service_role_financial_recovery_audit_views.sql'
    }),
    Object.freeze({
        key: 'shop_inventory_recovery_audit',
        sourceRelations: ['shop_orders'],
        migration: '20260511_allow_service_role_financial_recovery_audit_views.sql'
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

    if (
        normalizedRpcName === 'fn_deduct_points_admin_site_with_breakdown'
        && normalizedMessage.includes('invalid input syntax for type integer')
    ) {
        return true;
    }

    if (normalizedMessage.includes('could not find the function') || normalizedMessage.includes('schema cache')) {
        return true;
    }

    return normalizedMessage.includes('function')
        && normalizedMessage.includes('does not exist')
        && (!normalizedRpcName || normalizedMessage.includes(normalizedRpcName));
}

function isMissingRelationCapabilityError(error, relationName = '') {
    const normalizedCode = String(error?.code || '').trim().toUpperCase();
    const normalizedMessage = [
        error?.message,
        error?.details,
        error?.hint
    ].filter(Boolean).join(' ').trim().toLowerCase();
    const normalizedRelationName = String(relationName || '').trim().toLowerCase();

    if (['42P01', 'PGRST106', 'PGRST205'].includes(normalizedCode)) {
        return true;
    }

    if (normalizedMessage.includes('could not find the table') || normalizedMessage.includes('schema cache')) {
        return true;
    }

    return normalizedMessage.includes('relation')
        && normalizedMessage.includes('does not exist')
        && (!normalizedRelationName || normalizedMessage.includes(normalizedRelationName));
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

async function probeRelationCapability(supabase, definition = {}) {
    let count = null;
    let error = null;

    try {
        const result = await supabase
            .from(definition.relationName)
            .select('*', { count: 'exact', head: true });
        count = result?.count ?? null;
        error = result?.error ?? null;
    } catch (thrownError) {
        error = thrownError;
    }

    const missing = isMissingRelationCapabilityError(error, definition.relationName);

    return {
        key: definition.key,
        relation_name: definition.relationName,
        label: definition.label,
        migration: definition.migration,
        available: !missing,
        row_count: Number.isFinite(Number(count)) ? Number(count) : null,
        outcome: missing
            ? 'missing'
            : (error ? 'rejected' : 'readable'),
        probe: {
            code: String(error?.code || '').trim() || '',
            message: String(error?.message || '').trim()
        }
    };
}

async function probeSourceRelationCount(supabase, relationName = '') {
    let count = null;
    let error = null;

    try {
        const result = await supabase
            .from(relationName)
            .select('*', { count: 'exact', head: true });
        count = result?.count ?? null;
        error = result?.error ?? null;
    } catch (thrownError) {
        error = thrownError;
    }

    return {
        relation_name: relationName,
        available: !error,
        row_count: Number.isFinite(Number(count)) ? Number(count) : null,
        probe: {
            code: String(error?.code || '').trim() || '',
            message: String(error?.message || '').trim()
        }
    };
}

function buildRecoveryAuditVisibilityFindings(recoveryAuditRelations = {}, sourceCounts = {}) {
    return RECOVERY_AUDIT_VISIBILITY_CHECKS.flatMap((check) => {
        const auditRelation = recoveryAuditRelations[check.key];
        if (!auditRelation || auditRelation.available !== true || Number(auditRelation.row_count || 0) > 0) {
            return [];
        }

        const sourceTotal = check.sourceRelations.reduce((sum, relationName) => {
            const source = sourceCounts[relationName] || {};
            return sum + (Number(source.row_count || 0) || 0);
        }, 0);

        if (sourceTotal <= 0) {
            return [];
        }

        return [{
            severity: 'high',
            key: `filtered_${check.key}`,
            message: `${auditRelation.label} 可读但在 service_role 下返回 0 行；源表已有 ${sourceTotal} 行，请执行 ${check.migration}`,
            relation_name: auditRelation.relation_name,
            source_relations: check.sourceRelations,
            migration: check.migration
        }];
    });
}

function buildReadinessSummary({
    envFile,
    projectHost,
    capabilityResults = [],
    relationResults = [],
    sourceCountResults = []
}) {
    const capabilities = Object.fromEntries(
        capabilityResults.map((result) => [result.key, result])
    );
    const recovery_audit_relations = Object.fromEntries(
        relationResults.map((result) => [result.key, result])
    );
    const source_counts = Object.fromEntries(
        sourceCountResults.map((result) => [result.relation_name, result])
    );
    const findings = [
        ...capabilityResults
        .filter((result) => result.available !== true)
        .map((result) => ({
            severity: 'high',
            key: `missing_${result.key}`,
            message: `${result.label} 缺失，请先执行 ${result.migration}`,
            rpc_name: result.rpc_name,
            migration: result.migration
        })),
        ...relationResults
            .filter((result) => result.available !== true)
            .map((result) => ({
                severity: 'high',
                key: `missing_${result.key}`,
                message: `${result.label} 缺失，请先执行 ${result.migration}`,
                relation_name: result.relation_name,
                migration: result.migration
            })),
        ...buildRecoveryAuditVisibilityFindings(recovery_audit_relations, source_counts)
    ];

    return {
        checked_at: new Date().toISOString(),
        env_file: envFile,
        project_host: projectHost,
        capabilities,
        recovery_audit_relations,
        source_counts,
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

    const relations = Object.values(summary.recovery_audit_relations || {});
    if (relations.length) {
        lines.push('recovery_audit_relations');
        for (const relation of relations) {
            lines.push(`  ${relation.key}`);
            lines.push(`    relation_name: ${relation.relation_name}`);
            lines.push(`    label: ${relation.label}`);
            lines.push(`    migration: ${relation.migration}`);
            lines.push(`    available: ${relation.available === true ? 'yes' : 'no'}`);
            lines.push(`    outcome: ${relation.outcome || ''}`);
            if (Number.isFinite(Number(relation.row_count))) {
                lines.push(`    row_count: ${relation.row_count}`);
            }
            if (relation.probe?.code) {
                lines.push(`    probe.code: ${relation.probe.code}`);
            }
            if (relation.probe?.message) {
                lines.push(`    probe.message: ${relation.probe.message}`);
            }
        }
        lines.push('');
    }

    const sourceCounts = Object.values(summary.source_counts || {});
    if (sourceCounts.length) {
        lines.push('source_counts');
        for (const source of sourceCounts) {
            lines.push(`  ${source.relation_name}: ${Number.isFinite(Number(source.row_count)) ? source.row_count : '(unknown)'}`);
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
    const relationResults = [];
    const sourceCountResults = [];

    for (const definition of CAPABILITY_DEFINITIONS) {
        capabilityResults.push(await probeRpcCapability(supabase, definition));
    }
    for (const definition of RECOVERY_AUDIT_RELATIONS) {
        relationResults.push(await probeRelationCapability(supabase, definition));
    }
    for (const relationName of [...new Set(RECOVERY_AUDIT_VISIBILITY_CHECKS.flatMap((check) => check.sourceRelations))]) {
        sourceCountResults.push(await probeSourceRelationCount(supabase, relationName));
    }

    return buildReadinessSummary({
        envFile,
        projectHost,
        capabilityResults,
        relationResults,
        sourceCountResults
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
    RECOVERY_AUDIT_RELATIONS,
    RECOVERY_AUDIT_VISIBILITY_CHECKS,
    buildRecoveryAuditVisibilityFindings,
    buildReadinessSummary,
    formatHumanReport,
    isMissingRelationCapabilityError,
    isMissingRpcCapabilityError,
    parseArgs,
    probeRelationCapability,
    probeRpcCapability,
    probeSourceRelationCount,
    runReadinessGate
};
