const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

const DEFAULT_ENV_FILE = path.resolve(__dirname, '../server/.env.production');
const DEFAULT_SAMPLE_LIMIT = 10;
const DEFAULT_ORDER_PREFIX = 'SMOKE_';
const DEFAULT_SMOKE_EMAIL_REGEX = /^smoke-payment-.+@zaoyoe\.invalid$/i;

function parseArgs(argv = []) {
    const options = {
        envFile: DEFAULT_ENV_FILE,
        baseUrl: '',
        smokeEmail: '',
        orderPrefix: DEFAULT_ORDER_PREFIX,
        sampleLimit: DEFAULT_SAMPLE_LIMIT,
        json: false
    };

    for (let index = 0; index < argv.length; index += 1) {
        const value = String(argv[index] || '').trim();
        if (!value) continue;

        if (value === '--env-file') {
            options.envFile = path.resolve(process.cwd(), String(argv[index + 1] || '').trim());
            index += 1;
            continue;
        }

        if (value === '--base-url') {
            options.baseUrl = String(argv[index + 1] || '').trim();
            index += 1;
            continue;
        }

        if (value === '--smoke-email') {
            options.smokeEmail = String(argv[index + 1] || '').trim();
            index += 1;
            continue;
        }

        if (value === '--order-prefix') {
            options.orderPrefix = String(argv[index + 1] || '').trim() || DEFAULT_ORDER_PREFIX;
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

        if (value === '--json') {
            options.json = true;
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

function normalizeBaseUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    return candidate.replace(/\/+$/, '');
}

function getRequiredEnv(values, name) {
    const value = String(values?.[name] || process.env[name] || '').trim();
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

function matchesSmokeUser(user = {}, explicitEmail = '') {
    const email = String(user?.email || '').trim();
    if (!email) return false;
    if (explicitEmail && email.toLowerCase() === explicitEmail.toLowerCase()) {
        return true;
    }
    return DEFAULT_SMOKE_EMAIL_REGEX.test(email);
}

async function listSmokeUsers(supabaseAdmin, explicitEmail = '') {
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
        matchedUsers.push(...users.filter((user) => matchesSmokeUser(user, explicitEmail)));

        if (users.length < perPage) break;
        page += 1;
    }

    return matchedUsers;
}

async function countQuery(query, label) {
    const { count, error } = await query;
    if (error) {
        throw new Error(error.message || `Failed to count ${label}`);
    }
    return Number(count || 0);
}

async function selectQuery(query, label) {
    const { data, error } = await query;
    if (error) {
        throw new Error(error.message || `Failed to fetch ${label}`);
    }
    return Array.isArray(data) ? data : [];
}

async function fetchPaymentConfig(baseUrl = '', timeoutMs = 10000, fetchImpl = globalThis.fetch) {
    const resolvedBaseUrl = normalizeBaseUrl(baseUrl);
    if (!resolvedBaseUrl) {
        return {
            ok: false,
            status: 0,
            statusText: '',
            payload: null,
            text: '',
            error: 'missing APP_BASE_URL / PAYMENT_SMOKE_BASE_URL'
        };
    }

    const response = await fetchImpl(`${resolvedBaseUrl}/api/payments/config`, {
        method: 'GET',
        headers: {
            Accept: 'application/json'
        },
        signal: AbortSignal.timeout(timeoutMs)
    });
    const text = await response.text();
    let payload = null;
    if (text) {
        try {
            payload = JSON.parse(text);
        } catch (_) {
            payload = null;
        }
    }

    return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        payload,
        text,
        error: ''
    };
}

function buildFindings(summary = {}) {
    const findings = [];
    const mockAllowed = summary.runtime?.mock_payment?.allowed === true;
    const artifactCounts = summary.artifacts?.counts || {};
    const artifactTotal = [
        artifactCounts.payment_orders,
        artifactCounts.payment_events,
        artifactCounts.payment_checkout_sessions,
        artifactCounts.points_ledger
    ].reduce((sum, value) => sum + Number(value || 0), 0);
    const smokeUsers = Number(summary.artifacts?.auth_users || 0);

    if (mockAllowed) {
        findings.push({
            severity: 'high',
            key: 'remote_mock_payment_still_enabled',
            message: `Production-like runtime still allows remote mock payments${summary.runtime?.mock_payment?.reason ? ` (${summary.runtime.mock_payment.reason})` : ''}`
        });
    }

    if (artifactTotal > 0) {
        findings.push({
            severity: 'medium',
            key: 'smoke_payment_artifacts_present',
            message: `Found ${artifactTotal} smoke-test payment artifacts that should be reviewed and cleaned`
        });
    }

    if (smokeUsers > 0) {
        findings.push({
            severity: 'medium',
            key: 'smoke_users_still_present',
            message: `Found ${smokeUsers} smoke auth user(s) still present`
        });
    }

    return findings;
}

function formatHumanReport(summary = {}) {
    const lines = ['Payment Postdeploy Audit', ''];
    lines.push(`project_host: ${summary.projectHost || '(missing)'}`);
    lines.push(`base_url: ${summary.baseUrl || '(missing)'}`);
    lines.push(`order_prefix: ${summary.orderPrefix || DEFAULT_ORDER_PREFIX}`);
    lines.push(`smoke_email: ${summary.smokeEmail || '(auto-detect regex)'}`);
    lines.push('');

    const runtime = summary.runtime || {};
    const mockRuntime = runtime.mock_payment || null;
    lines.push('runtime');
    if (runtime.error) {
        lines.push(`  error: ${runtime.error}`);
    } else if (!runtime.checked) {
        lines.push('  checked: no');
    } else {
        lines.push(`  checked: yes`);
        lines.push(`  status: ${runtime.status} ${runtime.statusText || ''}`.trim());
        lines.push(`  mock_allowed: ${mockRuntime?.allowed === true ? 'yes' : 'no'}`);
        if (mockRuntime?.reason) {
            lines.push(`  mock_reason: ${mockRuntime.reason}`);
        }
    }
    lines.push('');

    const artifacts = summary.artifacts || {};
    const counts = artifacts.counts || {};
    lines.push('artifacts');
    lines.push(`  auth_users: ${artifacts.auth_users || 0}`);
    lines.push(`  payment_checkout_sessions: ${counts.payment_checkout_sessions || 0}`);
    lines.push(`  payment_orders: ${counts.payment_orders || 0}`);
    lines.push(`  payment_events: ${counts.payment_events || 0}`);
    lines.push(`  points_ledger: ${counts.points_ledger || 0}`);

    const sampleSections = [
        ['users', artifacts.samples?.users || []],
        ['payment_orders', artifacts.samples?.payment_orders || []],
        ['payment_events', artifacts.samples?.payment_events || []],
        ['points_ledger', artifacts.samples?.points_ledger || []]
    ];
    for (const [label, rows] of sampleSections) {
        if (!rows.length) continue;
        lines.push(`  ${label}_samples:`);
        rows.forEach((row) => {
            lines.push(`    - ${JSON.stringify(row)}`);
        });
    }

    lines.push('');
    if ((summary.findings || []).length) {
        lines.push('findings:');
        summary.findings.forEach((finding) => {
            lines.push(`- [${finding.severity}] ${finding.message}`);
        });
    } else {
        lines.push('findings: none');
    }

    lines.push('');
    lines.push(`result: ${(summary.findings || []).length ? 'ACTION_REQUIRED' : 'PASS'}`);
    return lines.join('\n');
}

async function runAudit({
    envValues = {},
    baseUrl = '',
    smokeEmail = '',
    orderPrefix = DEFAULT_ORDER_PREFIX,
    sampleLimit = DEFAULT_SAMPLE_LIMIT,
    fetchImpl = globalThis.fetch
} = {}) {
    const supabaseAdmin = buildSupabaseClient(envValues);
    const resolvedBaseUrl = normalizeBaseUrl(
        baseUrl
        || envValues.APP_BASE_URL
        || envValues.PAYMENT_SMOKE_BASE_URL
        || ''
    );
    const resolvedSmokeEmail = String(smokeEmail || envValues.PAYMENT_SMOKE_EMAIL || '').trim();
    const normalizedOrderPrefix = String(orderPrefix || DEFAULT_ORDER_PREFIX).trim() || DEFAULT_ORDER_PREFIX;
    const likePattern = `${normalizedOrderPrefix}%`;

    const smokeUsers = await listSmokeUsers(supabaseAdmin, resolvedSmokeEmail);
    const smokeUserIds = smokeUsers.map((user) => user.id).filter(Boolean);

    const [
        paymentConfig,
        paymentCheckoutSessions,
        paymentOrders,
        paymentEvents,
        pointsLedger,
        paymentOrderSamples,
        paymentEventSamples,
        pointsLedgerSamples
    ] = await Promise.all([
        fetchPaymentConfig(resolvedBaseUrl, 10000, fetchImpl).catch((error) => ({
            ok: false,
            status: 0,
            statusText: '',
            payload: null,
            text: '',
            error: error.message || 'fetch failed'
        })),
        smokeUserIds.length
            ? countQuery(
                supabaseAdmin.from('payment_checkout_sessions').select('id', { count: 'exact', head: true }).in('user_id', smokeUserIds),
                'payment_checkout_sessions'
            )
            : 0,
        countQuery(
            supabaseAdmin.from('payment_orders').select('id', { count: 'exact', head: true }).like('provider_order_no', likePattern),
            'payment_orders'
        ),
        countQuery(
            supabaseAdmin.from('payment_events').select('id', { count: 'exact', head: true }).like('provider_order_no', likePattern),
            'payment_events'
        ),
        smokeUserIds.length
            ? countQuery(
                supabaseAdmin
                    .from('points_ledger')
                    .select('id', { count: 'exact', head: true })
                    .or(`user_id.in.(${smokeUserIds.join(',')}),reference_id.like.mock_${normalizedOrderPrefix}%`),
                'points_ledger'
            )
            : countQuery(
                supabaseAdmin
                    .from('points_ledger')
                    .select('id', { count: 'exact', head: true })
                    .like('reference_id', `mock_${normalizedOrderPrefix}%`),
                'points_ledger'
            ),
        selectQuery(
            supabaseAdmin
                .from('payment_orders')
                .select('id, provider_order_no, status, paid_amount, points_amount, user_id, created_at')
                .like('provider_order_no', likePattern)
                .order('created_at', { ascending: false })
                .limit(sampleLimit),
            'payment order samples'
        ),
        selectQuery(
            supabaseAdmin
                .from('payment_events')
                .select('id, provider_order_no, processing_result, response_status, created_at')
                .like('provider_order_no', likePattern)
                .order('created_at', { ascending: false })
                .limit(sampleLimit),
            'payment event samples'
        ),
        selectQuery(
            (smokeUserIds.length
                ? supabaseAdmin
                    .from('points_ledger')
                    .select('id, user_id, amount, reason, reference_id, site, created_at')
                    .or(`user_id.in.(${smokeUserIds.join(',')}),reference_id.like.mock_${normalizedOrderPrefix}%`)
                : supabaseAdmin
                    .from('points_ledger')
                    .select('id, user_id, amount, reason, reference_id, site, created_at')
                    .like('reference_id', `mock_${normalizedOrderPrefix}%`))
                .order('created_at', { ascending: false })
                .limit(sampleLimit),
            'points ledger samples'
        )
    ]);

    const summary = {
        auditedAt: new Date().toISOString(),
        projectHost: getRequiredEnv(envValues, 'SUPABASE_URL').replace(/^https?:\/\//i, '').replace(/\/+$/, ''),
        baseUrl: resolvedBaseUrl,
        smokeEmail: resolvedSmokeEmail,
        orderPrefix: normalizedOrderPrefix,
        runtime: paymentConfig.error
            ? {
                checked: false,
                error: paymentConfig.error
            }
            : {
                checked: true,
                status: paymentConfig.status,
                statusText: paymentConfig.statusText,
                mock_payment: paymentConfig.payload?.runtime?.mock_payment || null
            },
        artifacts: {
            auth_users: smokeUsers.length,
            counts: {
                payment_checkout_sessions: paymentCheckoutSessions,
                payment_orders: paymentOrders,
                payment_events: paymentEvents,
                points_ledger: pointsLedger
            },
            samples: {
                users: smokeUsers.slice(0, sampleLimit).map((user) => ({
                    id: user.id,
                    email: user.email || '',
                    created_at: user.created_at || null,
                    last_sign_in_at: user.last_sign_in_at || null
                })),
                payment_orders: paymentOrderSamples,
                payment_events: paymentEventSamples,
                points_ledger: pointsLedgerSamples
            }
        }
    };

    summary.findings = buildFindings(summary);
    return summary;
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    const envValues = loadEnvFile(options.envFile);
    const summary = await runAudit({
        envValues,
        baseUrl: options.baseUrl,
        smokeEmail: options.smokeEmail,
        orderPrefix: options.orderPrefix,
        sampleLimit: options.sampleLimit
    });

    if (options.json) {
        console.log(JSON.stringify(summary, null, 2));
        return;
    }

    console.log(formatHumanReport(summary));
}

if (require.main === module) {
    main().catch((error) => {
        console.error(error.message || error);
        process.exitCode = 1;
    });
}

module.exports = {
    buildFindings,
    DEFAULT_ORDER_PREFIX,
    formatHumanReport,
    loadEnvFile,
    matchesSmokeUser,
    normalizeBaseUrl,
    parseArgs,
    runAudit
};
