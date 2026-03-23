const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

const DEFAULT_ENV_FILE = path.resolve(__dirname, '../server/.env.production');
const DEFAULT_SAMPLE_LIMIT = 20;
const SUPPORTED_SITES = Object.freeze(['cn', 'intl']);

function parseArgs(argv = []) {
    const options = {
        envFile: DEFAULT_ENV_FILE,
        json: false,
        failOnFinding: false,
        sampleLimit: DEFAULT_SAMPLE_LIMIT
    };

    for (let index = 0; index < argv.length; index += 1) {
        const value = String(argv[index] || '').trim();
        if (!value) continue;

        if (value === '--env-file') {
            options.envFile = path.resolve(process.cwd(), String(argv[index + 1] || '').trim());
            index += 1;
            continue;
        }

        if (value === '--sample-limit') {
            const parsed = Number.parseInt(String(argv[index + 1] || '').trim(), 10);
            if (Number.isFinite(parsed) && parsed > 0) {
                options.sampleLimit = Math.min(parsed, 100);
            }
            index += 1;
            continue;
        }

        if (value === '--fail-on-finding') {
            options.failOnFinding = true;
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

async function countRows(query, label) {
    const { count, error } = await query;
    if (error) {
        throw new Error(error.message || `Failed to count ${label}`);
    }
    return Number(count || 0);
}

async function selectRows(query, label) {
    const { data, error } = await query;
    if (error) {
        throw new Error(error.message || `Failed to fetch ${label}`);
    }
    return Array.isArray(data) ? data : [];
}

function buildSupportedSitesFilter() {
    return `(${SUPPORTED_SITES.join(',')})`;
}

async function scanSiteTable({
    supabase,
    table,
    sampleColumns,
    sampleLimit = DEFAULT_SAMPLE_LIMIT
}) {
    const supportedSitesFilter = buildSupportedSitesFilter();
    const sampleSelect = sampleColumns.join(', ');

    const [
        total,
        cnCount,
        intlCount,
        nullCount,
        unsupportedCount,
        anomalySamples
    ] = await Promise.all([
        countRows(
            supabase.from(table).select('id', { count: 'exact', head: true }),
            `${table} total`
        ),
        countRows(
            supabase.from(table).select('id', { count: 'exact', head: true }).eq('site', 'cn'),
            `${table} cn`
        ),
        countRows(
            supabase.from(table).select('id', { count: 'exact', head: true }).eq('site', 'intl'),
            `${table} intl`
        ),
        countRows(
            supabase.from(table).select('id', { count: 'exact', head: true }).or('site.is.null,site.eq.'),
            `${table} null_or_blank`
        ),
        countRows(
            supabase
                .from(table)
                .select('id', { count: 'exact', head: true })
                .not('site', 'is', null)
                .not('site', 'eq', '')
                .not('site', 'in', supportedSitesFilter),
            `${table} unsupported`
        ),
        selectRows(
            supabase
                .from(table)
                .select(sampleSelect)
                .or(`site.is.null,site.eq.,site.not.in.${supportedSitesFilter}`)
                .order('created_at', { ascending: false })
                .limit(sampleLimit),
            `${table} anomaly samples`
        )
    ]);

    return {
        total,
        supported: {
            cn: cnCount,
            intl: intlCount
        },
        anomalies: {
            null_or_blank: nullCount,
            unsupported: unsupportedCount
        },
        samples: anomalySamples
    };
}

async function verifyPrematureRedemptionCodes(supabase, sampleLimit = DEFAULT_SAMPLE_LIMIT) {
    const count = await countRows(
        supabase
            .from('payment_orders')
            .select('id', { count: 'exact', head: true })
            .not('redemption_code', 'is', null)
            .or('status.is.null,status.not.in.(paid,redeemed)'),
        'payment_orders with premature redemption codes'
    );

    const samples = await selectRows(
        supabase
            .from('payment_orders')
            .select('id, provider, provider_order_no, status, sign_verified, amount_verified, points_amount, redemption_code, user_id, created_at, updated_at')
            .not('redemption_code', 'is', null)
            .or('status.is.null,status.not.in.(paid,redeemed)')
            .order('updated_at', { ascending: false })
            .limit(sampleLimit),
        'payment_orders with premature redemption codes'
    );

    return {
        count,
        samples
    };
}

async function verifyUnresolvedLinkedCodes(supabase, sampleLimit = DEFAULT_SAMPLE_LIMIT) {
    const paymentOrders = await selectRows(
        supabase
            .from('payment_orders')
            .select('id, provider, provider_order_no, status, sign_verified, amount_verified, redemption_code, created_at')
            .not('redemption_code', 'is', null)
            .or('status.is.null,status.not.in.(paid,redeemed),sign_verified.eq.false,amount_verified.eq.false')
            .order('created_at', { ascending: false })
            .limit(sampleLimit),
        'unresolved payment orders with linked redemption codes'
    );

    const codes = [...new Set(paymentOrders.map((row) => String(row.redemption_code || '').trim()).filter(Boolean))];
    const codeRows = codes.length
        ? await selectRows(
            supabase
                .from('redemption_codes')
                .select('code, status, used_by, used_at, external_order_id')
                .in('code', codes),
            'linked redemption codes'
        )
        : [];
    const codesByValue = new Map(codeRows.map((row) => [String(row.code || '').trim(), row]));

    return {
        count: paymentOrders.length,
        samples: paymentOrders.map((row) => ({
            ...row,
            code_status: codesByValue.get(String(row.redemption_code || '').trim())?.status || null,
            code_used_by: codesByValue.get(String(row.redemption_code || '').trim())?.used_by || null,
            code_used_at: codesByValue.get(String(row.redemption_code || '').trim())?.used_at || null,
            code_external_order_id: codesByValue.get(String(row.redemption_code || '').trim())?.external_order_id || null
        }))
    };
}

async function verifyPendingSyntheticExternalOrderIds(supabase, sampleLimit = DEFAULT_SAMPLE_LIMIT) {
    const count = await countRows(
        supabase
            .from('redemption_codes')
            .select('code', { count: 'exact', head: true })
            .like('external_order_id', 'PENDING_%'),
        'redemption codes linked to PENDING_* external order ids'
    );

    const samples = await selectRows(
        supabase
            .from('redemption_codes')
            .select('code, status, external_order_id, used_by, used_at, created_at')
            .like('external_order_id', 'PENDING_%')
            .order('created_at', { ascending: false })
            .limit(sampleLimit),
        'redemption codes linked to PENDING_* external order ids'
    );

    return {
        count,
        samples
    };
}

async function verifyMissingLedgerSites(supabase, sampleLimit = DEFAULT_SAMPLE_LIMIT) {
    const count = await countRows(
        supabase
            .from('points_ledger')
            .select('id', { count: 'exact', head: true })
            .like('reference_id', 'redeem_%')
            .or('site.is.null,site.eq.'),
        'redeem ledger rows missing site'
    );

    const samples = await selectRows(
        supabase
            .from('points_ledger')
            .select('id, user_id, amount, reason, reference_id, site, created_at')
            .like('reference_id', 'redeem_%')
            .or('site.is.null,site.eq.')
            .order('created_at', { ascending: false })
            .limit(sampleLimit),
        'redeem ledger rows missing site'
    );

    return {
        count,
        samples
    };
}

async function fetchRecentCustomCodeBatches(supabase, sampleLimit = DEFAULT_SAMPLE_LIMIT) {
    const samples = await selectRows(
        supabase
            .from('redemption_batches')
            .select('id, name, channel, custom_points_amount, total_count, used_count, created_by, site, created_at')
            .is('package_id', null)
            .gt('custom_points_amount', 0)
            .order('created_at', { ascending: false })
            .limit(sampleLimit),
        'recent custom redemption batches'
    );

    return {
        count: samples.length,
        samples
    };
}

function buildVerificationSummary({
    envFile,
    projectHost,
    siteSummary,
    prematureRedemptionCodes,
    unresolvedLinkedCodes,
    pendingSyntheticCodes,
    missingLedgerSites,
    customCodeBatches
}) {
    const findings = [];

    for (const [tableName, tableSummary] of Object.entries(siteSummary)) {
        const anomalyCount = tableSummary.anomalies.null_or_blank + tableSummary.anomalies.unsupported;
        if (anomalyCount > 0) {
            findings.push({
                severity: 'high',
                key: `site_anomalies_${tableName}`,
                message: `${tableName} still contains unsupported or blank site values`,
                count: anomalyCount
            });
        }
    }

    if (prematureRedemptionCodes.count > 0) {
        findings.push({
            severity: 'high',
            key: 'premature_redemption_codes',
            message: 'Some payment orders own redemption codes before reaching paid/redeemed status',
            count: prematureRedemptionCodes.count
        });
    }

    if (unresolvedLinkedCodes.count > 0) {
        findings.push({
            severity: 'high',
            key: 'unresolved_linked_codes',
            message: 'Some unresolved or unverified payment orders already link redemption codes',
            count: unresolvedLinkedCodes.count
        });
    }

    if (pendingSyntheticCodes.count > 0) {
        findings.push({
            severity: 'high',
            key: 'pending_synthetic_codes',
            message: 'Some redemption codes are still linked to synthetic PENDING_* external order ids',
            count: pendingSyntheticCodes.count
        });
    }

    if (missingLedgerSites.count > 0) {
        findings.push({
            severity: 'high',
            key: 'missing_ledger_sites',
            message: 'Some redeem_* ledger rows still miss site attribution',
            count: missingLedgerSites.count
        });
    }

    if (customCodeBatches.count > 0) {
        findings.push({
            severity: 'medium',
            key: 'recent_custom_code_batches',
            message: 'Recent custom redemption batches should be spot-checked for creator identity and site attribution',
            count: customCodeBatches.count
        });
    }

    return {
        verified_at: new Date().toISOString(),
        env_file: envFile,
        project_host: projectHost,
        supported_sites: [...SUPPORTED_SITES],
        site_summary: siteSummary,
        payment_orders_with_premature_redemption_code: prematureRedemptionCodes,
        unresolved_payment_orders_with_linked_codes: unresolvedLinkedCodes,
        redemption_codes_with_pending_external_order_id: pendingSyntheticCodes,
        redeem_ledger_rows_missing_site: missingLedgerSites,
        recent_custom_code_batches: customCodeBatches,
        findings,
        ok: findings.filter((finding) => finding.severity === 'high').length === 0
    };
}

function formatSection(label, result) {
    const lines = [`${label}`, `  count: ${result.count}`];

    if (Array.isArray(result.samples) && result.samples.length) {
        lines.push('  samples:');
        for (const row of result.samples) {
            lines.push(`    - ${JSON.stringify(row)}`);
        }
    }

    return lines.join('\n');
}

function formatHuman(summary = {}) {
    const lines = [
        'Payment Rollout Verification',
        '',
        `project_host: ${summary.project_host || '(missing)'}`,
        `env_file: ${summary.env_file || DEFAULT_ENV_FILE}`,
        `verified_at: ${summary.verified_at || ''}`,
        ''
    ];

    for (const [tableName, tableSummary] of Object.entries(summary.site_summary || {})) {
        lines.push(tableName);
        lines.push(`  total: ${tableSummary.total}`);
        lines.push(`  cn: ${tableSummary.supported.cn}`);
        lines.push(`  intl: ${tableSummary.supported.intl}`);
        lines.push(`  anomalies.null_or_blank: ${tableSummary.anomalies.null_or_blank}`);
        lines.push(`  anomalies.unsupported: ${tableSummary.anomalies.unsupported}`);
        if (tableSummary.samples.length) {
            lines.push('  samples:');
            for (const row of tableSummary.samples) {
                lines.push(`    - ${JSON.stringify(row)}`);
            }
        }
        lines.push('');
    }

    lines.push(formatSection(
        'payment_orders_with_premature_redemption_code',
        summary.payment_orders_with_premature_redemption_code || { count: 0, samples: [] }
    ));
    lines.push('');
    lines.push(formatSection(
        'unresolved_payment_orders_with_linked_codes',
        summary.unresolved_payment_orders_with_linked_codes || { count: 0, samples: [] }
    ));
    lines.push('');
    lines.push(formatSection(
        'redemption_codes_with_pending_external_order_id',
        summary.redemption_codes_with_pending_external_order_id || { count: 0, samples: [] }
    ));
    lines.push('');
    lines.push(formatSection(
        'redeem_ledger_rows_missing_site',
        summary.redeem_ledger_rows_missing_site || { count: 0, samples: [] }
    ));
    lines.push('');
    lines.push(formatSection(
        'recent_custom_code_batches',
        summary.recent_custom_code_batches || { count: 0, samples: [] }
    ));
    lines.push('');

    if (!summary.findings?.length) {
        lines.push('findings: none');
    } else {
        lines.push('findings:');
        for (const finding of summary.findings) {
            lines.push(`- [${finding.severity}] ${finding.message} (${finding.count})`);
        }
    }

    lines.push('');
    lines.push(`result: ${summary.ok ? 'PASS' : 'FAIL'}`);
    return lines.join('\n');
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    loadEnvFile(options.envFile);

    const projectHost = new URL(getRequiredEnv('SUPABASE_URL')).host;
    const supabase = buildSupabaseClient();

    const siteSummary = {
        payment_checkout_sessions: await scanSiteTable({
            supabase,
            table: 'payment_checkout_sessions',
            sampleColumns: ['id', 'site', 'provider', 'session_key', 'user_id', 'created_at'],
            sampleLimit: options.sampleLimit
        }),
        payment_orders: await scanSiteTable({
            supabase,
            table: 'payment_orders',
            sampleColumns: ['id', 'site', 'provider', 'provider_order_no', 'user_id', 'created_at'],
            sampleLimit: options.sampleLimit
        })
    };

    const [
        prematureRedemptionCodes,
        unresolvedLinkedCodes,
        pendingSyntheticCodes,
        missingLedgerSites,
        customCodeBatches
    ] = await Promise.all([
        verifyPrematureRedemptionCodes(supabase, options.sampleLimit),
        verifyUnresolvedLinkedCodes(supabase, options.sampleLimit),
        verifyPendingSyntheticExternalOrderIds(supabase, options.sampleLimit),
        verifyMissingLedgerSites(supabase, options.sampleLimit),
        fetchRecentCustomCodeBatches(supabase, options.sampleLimit)
    ]);

    const summary = buildVerificationSummary({
        envFile: options.envFile,
        projectHost,
        siteSummary,
        prematureRedemptionCodes,
        unresolvedLinkedCodes,
        pendingSyntheticCodes,
        missingLedgerSites,
        customCodeBatches
    });

    console.log(options.json ? JSON.stringify(summary, null, 2) : formatHuman(summary));

    if (options.failOnFinding && !summary.ok) {
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
    DEFAULT_ENV_FILE,
    SUPPORTED_SITES,
    buildSupportedSitesFilter,
    buildVerificationSummary,
    formatHuman,
    parseArgs
};
