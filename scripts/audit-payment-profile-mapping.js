#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

const DEFAULT_ENV_FILE = path.resolve(__dirname, '../server/.env.production');
const DEFAULT_SAMPLE_LIMIT = 10;
const DEFAULT_LOOKBACK_DAYS = 90;
const DEFAULT_PAGE_SIZE = 500;
const DEFAULT_STATUSES = Object.freeze(['paid', 'redeemed']);

function printHelp() {
    console.log(`Usage: node scripts/audit-payment-profile-mapping.js [options]

Options:
  --env-file <path>      Env file with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
  --days <number>        Look back N days when scanning payment orders (default: ${DEFAULT_LOOKBACK_DAYS})
  --status <csv>         Comma-separated statuses to scan (default: ${DEFAULT_STATUSES.join(',')})
  --order-id <uuid>      Inspect a single payment order by id
  --sample-limit <n>     Number of anomaly samples to print per section (default: ${DEFAULT_SAMPLE_LIMIT})
  --json                 Print JSON instead of human-readable text
  --fail-on-anomaly      Exit with code 2 when anomalies are found
  --no-auth-check        Skip auth.users existence lookup for missing profiles
  --help                 Show this help message
`);
}

function parseArgs(argv = []) {
    const options = {
        envFile: DEFAULT_ENV_FILE,
        days: DEFAULT_LOOKBACK_DAYS,
        statuses: [...DEFAULT_STATUSES],
        orderId: '',
        sampleLimit: DEFAULT_SAMPLE_LIMIT,
        json: false,
        failOnAnomaly: false,
        skipAuthCheck: false,
        help: false
    };

    for (let index = 0; index < argv.length; index += 1) {
        const value = String(argv[index] || '').trim();
        if (!value) continue;

        if (value === '--env-file') {
            options.envFile = path.resolve(process.cwd(), String(argv[index + 1] || '').trim());
            index += 1;
            continue;
        }

        if (value === '--days') {
            const parsed = Number.parseInt(String(argv[index + 1] || '').trim(), 10);
            if (Number.isFinite(parsed) && parsed >= 0) {
                options.days = parsed;
            }
            index += 1;
            continue;
        }

        if (value === '--status') {
            const statuses = String(argv[index + 1] || '')
                .split(',')
                .map((item) => item.trim().toLowerCase())
                .filter(Boolean);
            if (statuses.length) {
                options.statuses = statuses;
            }
            index += 1;
            continue;
        }

        if (value === '--order-id') {
            options.orderId = String(argv[index + 1] || '').trim();
            index += 1;
            continue;
        }

        if (value === '--sample-limit') {
            const parsed = Number.parseInt(String(argv[index + 1] || '').trim(), 10);
            if (Number.isFinite(parsed) && parsed > 0) {
                options.sampleLimit = Math.min(parsed, 50);
            }
            index += 1;
            continue;
        }

        if (value === '--json') {
            options.json = true;
            continue;
        }

        if (value === '--fail-on-anomaly') {
            options.failOnAnomaly = true;
            continue;
        }

        if (value === '--no-auth-check') {
            options.skipAuthCheck = true;
            continue;
        }

        if (value === '--help' || value === '-h') {
            options.help = true;
        }
    }

    return options;
}

function loadEnvFile(envFile) {
    if (!envFile || !fs.existsSync(envFile)) {
        return;
    }

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

function chunkArray(items = [], size = 100) {
    const chunks = [];
    for (let index = 0; index < items.length; index += size) {
        chunks.push(items.slice(index, index + size));
    }
    return chunks;
}

function uniqueStrings(values = []) {
    return [...new Set(
        values
            .map((value) => String(value || '').trim())
            .filter(Boolean)
    )];
}

function toIsoDaysAgo(days) {
    return new Date(Date.now() - (days * 24 * 60 * 60 * 1000)).toISOString();
}

async function selectRows(query, label) {
    const { data, error } = await query;
    if (error) {
        throw new Error(error.message || `Failed to fetch ${label}`);
    }
    return Array.isArray(data) ? data : [];
}

async function maybeSingleRow(query, label) {
    const { data, error } = await query;
    if (error) {
        throw new Error(error.message || `Failed to fetch ${label}`);
    }
    return data || null;
}

async function listPaymentOrders(supabase, options = {}) {
    const normalizedOrderId = String(options.orderId || '').trim();
    const statuses = Array.isArray(options.statuses) && options.statuses.length
        ? options.statuses
        : [...DEFAULT_STATUSES];

    if (normalizedOrderId) {
        const record = await maybeSingleRow(
            supabase
                .from('payment_orders')
                .select('id, provider, provider_order_no, user_id, checkout_session_id, site, package_id, package_name, expected_amount, paid_amount, points_amount, status, created_at, paid_at, claimed_at, verified_at, provider_metadata')
                .eq('id', normalizedOrderId)
                .maybeSingle(),
            'payment order'
        );
        return record ? [record] : [];
    }

    const rows = [];
    let from = 0;

    while (true) {
        let query = supabase
            .from('payment_orders')
            .select('id, provider, provider_order_no, user_id, checkout_session_id, site, package_id, package_name, expected_amount, paid_amount, points_amount, status, created_at, paid_at, claimed_at, verified_at, provider_metadata')
            .in('status', statuses)
            .order('created_at', { ascending: false })
            .range(from, from + DEFAULT_PAGE_SIZE - 1);

        if (Number.isFinite(options.days) && options.days > 0) {
            query = query.gte('created_at', toIsoDaysAgo(options.days));
        }

        const batch = await selectRows(query, 'payment orders');
        rows.push(...batch);

        if (batch.length < DEFAULT_PAGE_SIZE) {
            break;
        }
        from += DEFAULT_PAGE_SIZE;
    }

    return rows;
}

async function fetchCheckoutSessionsByIds(supabase, checkoutSessionIds = []) {
    const ids = uniqueStrings(checkoutSessionIds);
    const sessionMap = new Map();

    for (const chunk of chunkArray(ids, 100)) {
        const rows = await selectRows(
            supabase
                .from('payment_checkout_sessions')
                .select('id, user_id, session_key, status, payment_order_id, created_at, completed_at')
                .in('id', chunk),
            'payment checkout sessions'
        );
        rows.forEach((row) => {
            sessionMap.set(String(row.id || '').trim(), row);
        });
    }

    return sessionMap;
}

async function fetchProfilesByIds(supabase, userIds = []) {
    const ids = uniqueStrings(userIds);
    const profileMap = new Map();

    for (const chunk of chunkArray(ids, 100)) {
        const rows = await selectRows(
            supabase
                .from('profiles')
                .select('id')
                .in('id', chunk),
            'profiles'
        );
        rows.forEach((row) => {
            profileMap.set(String(row.id || '').trim(), row);
        });
    }

    return profileMap;
}

async function inspectAuthUsers(supabase, userIds = []) {
    const ids = uniqueStrings(userIds);
    const authMap = new Map();

    await Promise.all(ids.map(async (userId) => {
        try {
            const { data, error } = await supabase.auth.admin.getUserById(userId);
            if (error) {
                if (/not found/i.test(String(error.message || ''))) {
                    authMap.set(userId, {
                        exists: false,
                        email: '',
                        created_at: '',
                        error: ''
                    });
                    return;
                }
                authMap.set(userId, {
                    exists: false,
                    email: '',
                    created_at: '',
                    error: error.message || 'Failed to inspect auth user'
                });
                return;
            }

            const user = data?.user || null;
            authMap.set(userId, {
                exists: Boolean(user),
                email: String(user?.email || '').trim(),
                created_at: String(user?.created_at || '').trim(),
                error: ''
            });
        } catch (error) {
            authMap.set(userId, {
                exists: false,
                email: '',
                created_at: '',
                error: error.message || 'Failed to inspect auth user'
            });
        }
    }));

    return authMap;
}

function normalizeOrderSample(order = {}, session = null, authInfo = null) {
    return {
        order_id: String(order.id || '').trim(),
        status: String(order.status || '').trim(),
        provider: String(order.provider || '').trim(),
        provider_order_no: String(order.provider_order_no || '').trim(),
        site: String(order.site || '').trim(),
        package_name: String(order.package_name || '').trim(),
        order_user_id: String(order.user_id || '').trim(),
        checkout_session_id: String(order.checkout_session_id || '').trim(),
        checkout_session_user_id: String(session?.user_id || '').trim(),
        checkout_session_status: String(session?.status || '').trim(),
        expected_amount: order.expected_amount ?? null,
        paid_amount: order.paid_amount ?? null,
        points_amount: order.points_amount ?? null,
        created_at: String(order.created_at || '').trim(),
        paid_at: String(order.paid_at || '').trim(),
        claimed_at: String(order.claimed_at || '').trim(),
        auth_user_exists: authInfo?.exists === true,
        auth_user_email: String(authInfo?.email || '').trim(),
        auth_user_created_at: String(authInfo?.created_at || '').trim(),
        auth_lookup_error: String(authInfo?.error || '').trim()
    };
}

function buildAuditSummary({
    orders = [],
    checkoutSessionMap = new Map(),
    profileMap = new Map(),
    authMap = new Map(),
    options = {}
}) {
    const missingOrderUserId = [];
    const missingProfile = [];
    const recoverableFromCheckoutSession = [];
    const missingAuthUser = [];
    const authExistsButProfileMissing = [];

    for (const order of orders) {
        const orderUserId = String(order.user_id || '').trim();
        const checkoutSessionId = String(order.checkout_session_id || '').trim();
        const session = checkoutSessionId ? checkoutSessionMap.get(checkoutSessionId) || null : null;
        const sessionUserId = String(session?.user_id || '').trim();

        if (!orderUserId) {
            const sample = normalizeOrderSample(order, session, null);
            missingOrderUserId.push(sample);

            if (sessionUserId) {
                recoverableFromCheckoutSession.push({
                    ...sample,
                    checkout_session_profile_exists: profileMap.has(sessionUserId)
                });
            }
            continue;
        }

        if (profileMap.has(orderUserId)) {
            continue;
        }

        const authInfo = authMap.get(orderUserId) || null;
        const sample = normalizeOrderSample(order, session, authInfo);
        missingProfile.push(sample);

        if (authInfo?.exists) {
            authExistsButProfileMissing.push(sample);
        } else {
            missingAuthUser.push(sample);
        }
    }

    const hasSingleOrder = Boolean(String(options.orderId || '').trim());
    const firstOrder = hasSingleOrder ? orders[0] || null : null;
    const firstOrderSession = firstOrder
        ? checkoutSessionMap.get(String(firstOrder.checkout_session_id || '').trim()) || null
        : null;
    const firstOrderUserId = String(firstOrder?.user_id || '').trim();
    const firstOrderSessionUserId = String(firstOrderSession?.user_id || '').trim();

    const singleOrder = !hasSingleOrder
        ? null
        : !firstOrder
            ? {
                found: false,
                order: null,
                order_profile_exists: false,
                checkout_session_profile_exists: false
            }
            : {
                found: true,
                order: normalizeOrderSample(firstOrder, firstOrderSession, authMap.get(firstOrderUserId) || null),
                order_profile_exists: firstOrderUserId ? profileMap.has(firstOrderUserId) : false,
                checkout_session_profile_exists: firstOrderSessionUserId ? profileMap.has(firstOrderSessionUserId) : false
            };

    return {
        scanned_at: new Date().toISOString(),
        project_host: new URL(getRequiredEnv('SUPABASE_URL')).host,
        filters: {
            env_file: options.envFile,
            days: hasSingleOrder ? null : options.days,
            statuses: hasSingleOrder ? null : options.statuses,
            order_id: options.orderId || null,
            sample_limit: options.sampleLimit,
            auth_lookup_enabled: options.skipAuthCheck !== true
        },
        totals: {
            orders_scanned: orders.length,
            orders_with_missing_user_id: missingOrderUserId.length,
            orders_with_missing_profile: missingProfile.length,
            orders_recoverable_from_checkout_session_user: recoverableFromCheckoutSession.length,
            orders_with_auth_user_but_missing_profile: authExistsButProfileMissing.length,
            orders_with_missing_auth_user: missingAuthUser.length
        },
        single_order: singleOrder,
        samples: {
            missing_user_id: missingOrderUserId.slice(0, options.sampleLimit),
            missing_profile: missingProfile.slice(0, options.sampleLimit),
            recoverable_from_checkout_session_user: recoverableFromCheckoutSession.slice(0, options.sampleLimit),
            auth_user_but_missing_profile: authExistsButProfileMissing.slice(0, options.sampleLimit),
            missing_auth_user: missingAuthUser.slice(0, options.sampleLimit)
        }
    };
}

function formatSampleLine(sample = {}) {
    const parts = [
        `order=${sample.order_id || '-'}`,
        `status=${sample.status || '-'}`,
        `provider=${sample.provider || '-'}`,
        `order_user=${sample.order_user_id || '-'}`,
        `session_user=${sample.checkout_session_user_id || '-'}`,
        `email=${sample.auth_user_email || '-'}`,
        `checkout_session=${sample.checkout_session_id || '-'}`,
        `provider_order=${sample.provider_order_no || '-'}`,
        `paid_at=${sample.paid_at || sample.created_at || '-'}`
    ];
    return `  - ${parts.join(' | ')}`;
}

function pushSection(lines, title, samples = []) {
    lines.push(title);
    if (!samples.length) {
        lines.push('  - none');
        lines.push('');
        return;
    }

    samples.forEach((sample) => {
        lines.push(formatSampleLine(sample));
    });
    lines.push('');
}

function formatHuman(summary = {}) {
    const lines = [
        `Payment/Profile Mapping Audit @ ${summary.scanned_at || ''}`,
        `Project: ${summary.project_host || ''}`,
        `Orders scanned: ${summary.totals?.orders_scanned || 0}`,
        `Missing order.user_id: ${summary.totals?.orders_with_missing_user_id || 0}`,
        `Missing profile: ${summary.totals?.orders_with_missing_profile || 0}`,
        `Recoverable from checkout session user: ${summary.totals?.orders_recoverable_from_checkout_session_user || 0}`,
        `Auth user exists but profile missing: ${summary.totals?.orders_with_auth_user_but_missing_profile || 0}`,
        `Auth user missing: ${summary.totals?.orders_with_missing_auth_user || 0}`,
        ''
    ];

    if (summary.single_order && summary.single_order.found === false) {
        lines.push('Single order inspection');
        lines.push('  - order not found');
        lines.push('');
    } else if (summary.single_order?.order) {
        const order = summary.single_order.order;
        lines.push('Single order inspection');
        lines.push(formatSampleLine(order));
        lines.push(`  - order_profile_exists=${summary.single_order.order_profile_exists ? 'yes' : 'no'} | checkout_session_profile_exists=${summary.single_order.checkout_session_profile_exists ? 'yes' : 'no'}`);
        lines.push('');
    }

    pushSection(lines, 'Missing order.user_id samples', summary.samples?.missing_user_id || []);
    pushSection(lines, 'Missing profile samples', summary.samples?.missing_profile || []);
    pushSection(lines, 'Recoverable from checkout session user samples', summary.samples?.recoverable_from_checkout_session_user || []);
    pushSection(lines, 'Auth user exists but profile missing samples', summary.samples?.auth_user_but_missing_profile || []);
    pushSection(lines, 'Missing auth user samples', summary.samples?.missing_auth_user || []);

    return lines.join('\n').trimEnd();
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
        printHelp();
        return;
    }

    loadEnvFile(options.envFile);
    const supabase = buildSupabaseClient();

    const orders = await listPaymentOrders(supabase, options);
    const checkoutSessionMap = await fetchCheckoutSessionsByIds(
        supabase,
        orders.map((order) => order.checkout_session_id)
    );

    const userIds = uniqueStrings([
        ...orders.map((order) => order.user_id),
        ...[...checkoutSessionMap.values()].map((session) => session.user_id)
    ]);
    const profileMap = await fetchProfilesByIds(supabase, userIds);
    const missingProfileUserIds = userIds.filter((userId) => !profileMap.has(userId));
    const authMap = options.skipAuthCheck
        ? new Map()
        : await inspectAuthUsers(supabase, missingProfileUserIds);

    const summary = buildAuditSummary({
        orders,
        checkoutSessionMap,
        profileMap,
        authMap,
        options
    });

    if (options.json) {
        console.log(JSON.stringify(summary, null, 2));
    } else {
        console.log(formatHuman(summary));
    }

    const anomalyCount = Number(summary.totals?.orders_with_missing_user_id || 0)
        + Number(summary.totals?.orders_with_missing_profile || 0);
    if (options.failOnAnomaly && anomalyCount > 0) {
        process.exitCode = 2;
    }
}

main().catch((error) => {
    console.error('[audit-payment-profile-mapping] Failed:', error.message || error);
    process.exitCode = 1;
});
