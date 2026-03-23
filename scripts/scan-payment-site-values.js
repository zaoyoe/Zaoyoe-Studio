const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

const SUPPORTED_SITES = Object.freeze(['cn', 'intl']);
const DEFAULT_ENV_FILE = path.resolve(__dirname, '../server/.env.production');
const DEFAULT_SAMPLE_LIMIT = 10;

function parseArgs(argv = []) {
    const options = {
        envFile: DEFAULT_ENV_FILE,
        json: false,
        failOnAnomaly: false,
        sampleLimit: DEFAULT_SAMPLE_LIMIT
    };

    for (let index = 0; index < argv.length; index += 1) {
        const value = String(argv[index] || '').trim();
        if (!value) continue;

        if (value === '--json') {
            options.json = true;
            continue;
        }

        if (value === '--fail-on-anomaly') {
            options.failOnAnomaly = true;
            continue;
        }

        if (value === '--env-file') {
            options.envFile = path.resolve(process.cwd(), String(argv[index + 1] || '').trim());
            index += 1;
            continue;
        }

        if (value === '--sample-limit') {
            const parsed = Number.parseInt(String(argv[index + 1] || '').trim(), 10);
            if (Number.isFinite(parsed) && parsed > 0) {
                options.sampleLimit = Math.min(parsed, 50);
            }
            index += 1;
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

function buildUnsupportedFilter() {
    return `(${SUPPORTED_SITES.join(',')})`;
}

async function scanTable({
    supabase,
    table,
    sampleColumns,
    sampleLimit = DEFAULT_SAMPLE_LIMIT
}) {
    const unsupportedFilter = buildUnsupportedFilter();
    const countSelect = 'id';
    const sampleSelect = sampleColumns.join(', ');

    const [
        total,
        cnCount,
        intlCount,
        nullCount,
        unsupportedCount,
        unsupportedSamples,
        nullSamples
    ] = await Promise.all([
        countRows(
            supabase.from(table).select(countSelect, { count: 'exact', head: true }),
            `${table} total`
        ),
        countRows(
            supabase.from(table).select(countSelect, { count: 'exact', head: true }).eq('site', 'cn'),
            `${table} cn`
        ),
        countRows(
            supabase.from(table).select(countSelect, { count: 'exact', head: true }).eq('site', 'intl'),
            `${table} intl`
        ),
        countRows(
            supabase.from(table).select(countSelect, { count: 'exact', head: true }).is('site', null),
            `${table} null`
        ),
        countRows(
            supabase.from(table).select(countSelect, { count: 'exact', head: true }).not('site', 'in', unsupportedFilter),
            `${table} unsupported`
        ),
        selectRows(
            supabase
                .from(table)
                .select(sampleSelect)
                .not('site', 'in', unsupportedFilter)
                .order('created_at', { ascending: false })
                .limit(sampleLimit),
            `${table} unsupported samples`
        ),
        selectRows(
            supabase
                .from(table)
                .select(sampleSelect)
                .is('site', null)
                .order('created_at', { ascending: false })
                .limit(sampleLimit),
            `${table} null samples`
        )
    ]);

    return {
        total,
        supported: {
            cn: cnCount,
            intl: intlCount
        },
        anomalies: {
            null_or_missing: nullCount,
            unsupported_non_null: unsupportedCount
        },
        samples: {
            unsupported: unsupportedSamples,
            null_or_missing: nullSamples
        }
    };
}

function formatJson(summary) {
    return JSON.stringify(summary, null, 2);
}

function formatHuman(summary) {
    const lines = [
        `Payment Site Scan @ ${summary.scanned_at}`,
        `Project: ${summary.project_host}`,
        `Supported sites: ${summary.supported_sites.join(', ')}`,
        ''
    ];

    for (const [table, result] of Object.entries(summary.tables || {})) {
        lines.push(`${table}`);
        lines.push(`  total: ${result.total}`);
        lines.push(`  cn: ${result.supported.cn}`);
        lines.push(`  intl: ${result.supported.intl}`);
        lines.push(`  anomalies.null_or_missing: ${result.anomalies.null_or_missing}`);
        lines.push(`  anomalies.unsupported_non_null: ${result.anomalies.unsupported_non_null}`);

        if (result.samples.unsupported.length) {
            lines.push('  unsupported samples:');
            for (const row of result.samples.unsupported) {
                lines.push(`    - ${JSON.stringify(row)}`);
            }
        }

        if (result.samples.null_or_missing.length) {
            lines.push('  null_or_missing samples:');
            for (const row of result.samples.null_or_missing) {
                lines.push(`    - ${JSON.stringify(row)}`);
            }
        }

        lines.push('');
    }

    return lines.join('\n').trimEnd();
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    loadEnvFile(options.envFile);

    const supabaseUrl = getRequiredEnv('SUPABASE_URL');
    const projectHost = new URL(supabaseUrl).host;
    const supabase = buildSupabaseClient();

    const tables = {
        payment_checkout_sessions: await scanTable({
            supabase,
            table: 'payment_checkout_sessions',
            sampleColumns: ['id', 'site', 'provider', 'session_key', 'user_id', 'created_at'],
            sampleLimit: options.sampleLimit
        }),
        payment_orders: await scanTable({
            supabase,
            table: 'payment_orders',
            sampleColumns: ['id', 'site', 'provider', 'provider_order_no', 'user_id', 'created_at'],
            sampleLimit: options.sampleLimit
        })
    };

    const summary = {
        scanned_at: new Date().toISOString(),
        project_host: projectHost,
        env_file: options.envFile,
        supported_sites: [...SUPPORTED_SITES],
        tables
    };

    const anomalyCount = Object.values(tables).reduce(
        (sum, tableSummary) => sum + tableSummary.anomalies.null_or_missing + tableSummary.anomalies.unsupported_non_null,
        0
    );

    console.log(options.json ? formatJson(summary) : formatHuman(summary));

    if (options.failOnAnomaly && anomalyCount > 0) {
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
    buildUnsupportedFilter,
    formatHuman,
    parseArgs
};
