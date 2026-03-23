const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

const DEFAULT_ENV_FILE = path.resolve(__dirname, '../server/.env.production');
const DEFAULT_ORDER_PREFIXES = ['AUTO_CDX_', 'SMOKE_'];
const DEFAULT_SMOKE_EMAIL_PATTERNS = [
    /^codex\..+@example\.com$/i,
    /^smoke-payment-.+@zaoyoe\.invalid$/i
];

function parseArgs(argv = []) {
    const options = {
        envFile: DEFAULT_ENV_FILE,
        execute: false,
        json: false,
        orderPrefixes: [...DEFAULT_ORDER_PREFIXES],
        smokeEmail: ''
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

        if (value === '--order-prefix') {
            const nextValue = String(argv[index + 1] || '').trim();
            if (nextValue) {
                options.orderPrefixes = nextValue
                    .split(',')
                    .map((item) => item.trim())
                    .filter(Boolean);
            }
            index += 1;
            continue;
        }

        if (value === '--smoke-email') {
            options.smokeEmail = String(argv[index + 1] || '').trim();
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

function matchesFixtureUser(user = {}, explicitEmail = '') {
    const email = String(user?.email || '').trim();
    if (!email) return false;
    if (explicitEmail && email.toLowerCase() === explicitEmail.toLowerCase()) {
        return true;
    }

    return DEFAULT_SMOKE_EMAIL_PATTERNS.some((pattern) => pattern.test(email));
}

async function listFixtureUsers(supabaseAdmin, explicitEmail = '') {
    const matchedUsers = [];
    let page = 1;
    const perPage = 200;

    while (true) {
        const { data, error } = await supabaseAdmin.auth.admin.listUsers({
            page,
            perPage
        });

        if (error) {
            throw new Error(error.message || 'Failed to list auth users');
        }

        const users = data?.users || [];
        matchedUsers.push(...users.filter((user) => matchesFixtureUser(user, explicitEmail)));

        if (users.length < perPage) break;
        page += 1;
    }

    return matchedUsers;
}

function isMissingRelationError(error) {
    const message = String(error?.message || '').toLowerCase();
    return error?.code === '42P01'
        || message.includes('does not exist')
        || message.includes('failed to count')
        || message.includes('could not find the table');
}

async function countInOptional(supabase, table, column, values) {
    if (!Array.isArray(values) || !values.length) return 0;

    const { count, error } = await supabase
        .from(table)
        .select('*', { count: 'exact', head: true })
        .in(column, values);

    if (error) {
        if (isMissingRelationError(error)) return 0;
        throw new Error(error.message || `Failed to count ${table}`);
    }

    return Number(count || 0);
}

async function countLikePatterns(supabase, table, column, prefixes = []) {
    const counts = await Promise.all(
        prefixes
            .map((prefix) => String(prefix || '').trim())
            .filter(Boolean)
            .map(async (prefix) => {
                const { count, error } = await supabase
                    .from(table)
                    .select('*', { count: 'exact', head: true })
                    .like(column, `${prefix}%`);

                if (error) {
                    if (isMissingRelationError(error)) return 0;
                    throw new Error(error.message || `Failed to count ${table}`);
                }

                return Number(count || 0);
            })
    );

    return counts.reduce((sum, value) => sum + Number(value || 0), 0);
}

async function selectLikePatterns(supabase, table, column, prefixes = [], limit = 10) {
    const safeLimit = Math.max(1, Number.parseInt(limit, 10) || 10);
    const rows = (await Promise.all(
        prefixes
            .map((prefix) => String(prefix || '').trim())
            .filter(Boolean)
            .map(async (prefix) => {
                const { data, error } = await supabase
                    .from(table)
                    .select('id, provider_order_no, status, paid_amount, points_amount, user_id, created_at')
                    .like(column, `${prefix}%`)
                    .order('created_at', { ascending: false })
                    .limit(safeLimit);

                if (error) {
                    if (isMissingRelationError(error)) return [];
                    throw new Error(error.message || `Failed to fetch ${table}`);
                }

                return Array.isArray(data) ? data : [];
            })
    )).flat();

    const deduped = [];
    const seen = new Set();

    for (const row of rows.sort((left, right) => {
        const leftValue = Date.parse(left?.created_at || 0) || 0;
        const rightValue = Date.parse(right?.created_at || 0) || 0;
        return rightValue - leftValue;
    })) {
        const key = String(row?.id || row?.provider_order_no || JSON.stringify(row));
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(row);
        if (deduped.length >= safeLimit) break;
    }

    return deduped;
}

async function safeDeleteInOptional(supabase, table, column, values) {
    if (!Array.isArray(values) || !values.length) return 0;

    const { data, error } = await supabase
        .from(table)
        .delete()
        .in(column, values)
        .select('*');

    if (error) {
        if (isMissingRelationError(error)) return 0;
        throw new Error(error.message || `Failed to delete ${table}`);
    }

    return Array.isArray(data) ? data.length : 0;
}

async function safeDeleteLikePatternsOptional(supabase, table, column, prefixes = []) {
    const deletedCounts = await Promise.all(
        prefixes
            .map((prefix) => String(prefix || '').trim())
            .filter(Boolean)
            .map(async (prefix) => {
                const { data, error } = await supabase
                    .from(table)
                    .delete()
                    .like(column, `${prefix}%`)
                    .select('*');

                if (error) {
                    if (isMissingRelationError(error)) return 0;
                    throw new Error(error.message || `Failed to delete ${table}`);
                }

                return Array.isArray(data) ? data.length : 0;
            })
    );

    return deletedCounts.reduce((sum, value) => sum + Number(value || 0), 0);
}

async function buildPreview(supabaseAdmin, options = {}) {
    const orderPrefixes = Array.isArray(options.orderPrefixes) && options.orderPrefixes.length
        ? options.orderPrefixes
        : [...DEFAULT_ORDER_PREFIXES];
    const fixtureUsers = await listFixtureUsers(supabaseAdmin, options.smokeEmail || '');
    const fixtureUserIds = fixtureUsers.map((user) => user.id);

    const counts = {
        payment_checkout_sessions: await countInOptional(supabaseAdmin, 'payment_checkout_sessions', 'user_id', fixtureUserIds),
        payment_orders: await countLikePatterns(supabaseAdmin, 'payment_orders', 'provider_order_no', orderPrefixes),
        payment_events: await countLikePatterns(supabaseAdmin, 'payment_events', 'provider_order_no', orderPrefixes),
        afdian_orders: await countLikePatterns(supabaseAdmin, 'afdian_orders', 'out_trade_no', orderPrefixes),
        auth_users: fixtureUsers.length,
        profiles: await countInOptional(supabaseAdmin, 'profiles', 'id', fixtureUserIds),
        points_balance: await countInOptional(supabaseAdmin, 'points_balance', 'user_id', fixtureUserIds),
        points_ledger: await countInOptional(supabaseAdmin, 'points_ledger', 'user_id', fixtureUserIds),
        user_checkins: await countInOptional(supabaseAdmin, 'user_checkins', 'user_id', fixtureUserIds),
        user_events: await countInOptional(supabaseAdmin, 'user_events', 'user_id', fixtureUserIds)
    };

    return {
        order_prefixes: [...orderPrefixes],
        user_email_patterns: DEFAULT_SMOKE_EMAIL_PATTERNS.map((pattern) => pattern.toString()),
        explicit_smoke_email: String(options.smokeEmail || '').trim(),
        test_user_ids: fixtureUserIds,
        counts,
        samples: {
            orders: await selectLikePatterns(supabaseAdmin, 'payment_orders', 'provider_order_no', orderPrefixes, 10),
            users: fixtureUsers.slice(0, 10).map((user) => ({
                id: user.id,
                email: user.email || '',
                created_at: user.created_at || null
            }))
        }
    };
}

async function executeCleanup(supabaseAdmin, preview) {
    const deleted = {
        payment_checkout_sessions: 0,
        payment_events: 0,
        afdian_orders: 0,
        payment_orders: 0,
        points_ledger_user: 0,
        points_ledger_reference: 0,
        points_ledger_created_by: 0,
        points_balance: 0,
        user_checkins: 0,
        user_events: 0,
        system_notifications: 0,
        admin_notes_target: 0,
        admin_notes_admin: 0,
        admin_audit_logs_target: 0,
        admin_audit_logs_admin: 0,
        auth_users: 0
    };
    const warnings = [];

    deleted.payment_checkout_sessions = await safeDeleteInOptional(supabaseAdmin, 'payment_checkout_sessions', 'user_id', preview.test_user_ids);
    deleted.payment_events = await safeDeleteLikePatternsOptional(supabaseAdmin, 'payment_events', 'provider_order_no', preview.order_prefixes);
    deleted.afdian_orders = await safeDeleteLikePatternsOptional(supabaseAdmin, 'afdian_orders', 'out_trade_no', preview.order_prefixes);
    deleted.payment_orders = await safeDeleteLikePatternsOptional(supabaseAdmin, 'payment_orders', 'provider_order_no', preview.order_prefixes);
    deleted.points_ledger_reference = await safeDeleteLikePatternsOptional(
        supabaseAdmin,
        'points_ledger',
        'reference_id',
        preview.order_prefixes.map((prefix) => `mock_${prefix}`)
    );

    if (preview.test_user_ids.length) {
        deleted.points_ledger_user = await safeDeleteInOptional(supabaseAdmin, 'points_ledger', 'user_id', preview.test_user_ids);
        deleted.points_ledger_created_by = await safeDeleteInOptional(supabaseAdmin, 'points_ledger', 'created_by', preview.test_user_ids);
        deleted.points_balance = await safeDeleteInOptional(supabaseAdmin, 'points_balance', 'user_id', preview.test_user_ids);
        deleted.user_checkins = await safeDeleteInOptional(supabaseAdmin, 'user_checkins', 'user_id', preview.test_user_ids);
        deleted.user_events = await safeDeleteInOptional(supabaseAdmin, 'user_events', 'user_id', preview.test_user_ids);
        deleted.system_notifications = await safeDeleteInOptional(supabaseAdmin, 'system_notifications', 'user_id', preview.test_user_ids);
        deleted.admin_notes_target = await safeDeleteInOptional(supabaseAdmin, 'admin_notes', 'target_user_id', preview.test_user_ids);
        deleted.admin_notes_admin = await safeDeleteInOptional(supabaseAdmin, 'admin_notes', 'admin_id', preview.test_user_ids);
        deleted.admin_audit_logs_target = await safeDeleteInOptional(supabaseAdmin, 'admin_audit_logs', 'target_user_id', preview.test_user_ids);
        deleted.admin_audit_logs_admin = await safeDeleteInOptional(supabaseAdmin, 'admin_audit_logs', 'admin_id', preview.test_user_ids);

        for (const userId of preview.test_user_ids) {
            const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
            if (error) {
                warnings.push({
                    user_id: userId,
                    message: error.message || 'Failed to delete auth user'
                });
            } else {
                deleted.auth_users += 1;
            }
        }
    }

    return { deleted, warnings };
}

function formatHumanReport(result = {}) {
    const lines = [];
    lines.push('Payment Fixture Cleanup');
    lines.push('');
    lines.push(`mode: ${result.mode || 'preview'}`);
    lines.push(`project_host: ${result.project_host || ''}`);
    if (result.preview?.explicit_smoke_email) {
        lines.push(`smoke_email: ${result.preview.explicit_smoke_email}`);
    }
    lines.push(`order_prefixes: ${(result.preview?.order_prefixes || []).join(', ')}`);
    lines.push('');
    lines.push('preview');
    const counts = result.preview?.counts || {};
    Object.keys(counts).forEach((key) => {
        lines.push(`  ${key}: ${Number(counts[key] || 0)}`);
    });
    const sampleOrders = result.preview?.samples?.orders || [];
    if (sampleOrders.length) {
        lines.push('  sample_orders:');
        sampleOrders.forEach((row) => {
            lines.push(`    - ${JSON.stringify(row)}`);
        });
    }
    const sampleUsers = result.preview?.samples?.users || [];
    if (sampleUsers.length) {
        lines.push('  sample_users:');
        sampleUsers.forEach((row) => {
            lines.push(`    - ${JSON.stringify(row)}`);
        });
    }

    if (result.deleted) {
        lines.push('');
        lines.push('deleted');
        Object.keys(result.deleted).forEach((key) => {
            lines.push(`  ${key}: ${Number(result.deleted[key] || 0)}`);
        });
    }

    if (Array.isArray(result.warnings) && result.warnings.length) {
        lines.push('');
        lines.push('warnings');
        result.warnings.forEach((item) => {
            lines.push(`  - ${JSON.stringify(item)}`);
        });
    }

    return lines.join('\n');
}

async function runCleanup(options = {}) {
    const envValues = loadEnvFile(options.envFile);
    const supabaseAdmin = buildSupabaseClient(envValues);
    const preview = await buildPreview(supabaseAdmin, options);
    const result = {
        mode: options.execute ? 'execute' : 'preview',
        project_host: new URL(getRequiredEnv(envValues, 'SUPABASE_URL')).host,
        preview,
        deleted: null,
        warnings: []
    };

    if (options.execute) {
        const execution = await executeCleanup(supabaseAdmin, preview);
        result.deleted = execution.deleted;
        result.warnings = execution.warnings;
    }

    return result;
}

if (require.main === module) {
    runCleanup(parseArgs(process.argv.slice(2)))
        .then((result) => {
            if (parseArgs(process.argv.slice(2)).json) {
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
    DEFAULT_ORDER_PREFIXES,
    DEFAULT_SMOKE_EMAIL_PATTERNS,
    buildPreview,
    executeCleanup,
    formatHumanReport,
    loadEnvFile,
    matchesFixtureUser,
    parseArgs,
    runCleanup
};
