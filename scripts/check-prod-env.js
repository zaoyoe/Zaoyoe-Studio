const crypto = require('crypto');

function readEnv(name) {
    return String(process.env[name] || '').trim();
}

function readFirstAvailableEnv(names = []) {
    for (const name of names) {
        const value = readEnv(name);
        if (value) {
            return { name, value };
        }
    }

    return { name: '', value: '' };
}

function fingerprintSecret(value) {
    const normalized = String(value || '').trim();
    if (!normalized) return 'missing';

    return crypto
        .createHash('sha256')
        .update(normalized)
        .digest('hex')
        .slice(0, 12);
}

function isProductionLikeRuntime(env = process.env) {
    const vercelEnv = String(env.VERCEL_ENV || '').trim().toLowerCase();
    const railwayEnv = String(env.RAILWAY_ENVIRONMENT_NAME || '').trim().toLowerCase();
    const deploymentTier = String(env.DEPLOYMENT_TIER || env.APP_ENV || '').trim().toLowerCase();

    return {
        productionLike: vercelEnv === 'production'
            || railwayEnv === 'production'
            || deploymentTier === 'production',
        source: vercelEnv === 'production'
            ? 'VERCEL_ENV'
            : railwayEnv === 'production'
                ? 'RAILWAY_ENVIRONMENT_NAME'
                : deploymentTier === 'production'
                    ? (readEnv('DEPLOYMENT_TIER') ? 'DEPLOYMENT_TIER' : 'APP_ENV')
                    : ''
    };
}

function printCheck(label, ok, details) {
    const status = ok ? '[OK]  ' : '[FAIL]';
    console.log(`${status} ${label}: ${details}`);
}

function main() {
    const args = new Set(process.argv.slice(2));
    const allowNonProduction = args.has('--allow-non-production');

    const serviceRoleKey = readEnv('SUPABASE_SERVICE_ROLE_KEY');
    const adminEncryptionKey = readEnv('ADMIN_CONFIG_ENCRYPTION_KEY');
    const adminStudioAccessSecret = readEnv('ADMIN_STUDIO_ACCESS_SECRET');
    const quoteSecret = readFirstAvailableEnv([
        'PAYMENT_CUSTOM_RECHARGE_QUOTE_SECRET',
        'PAYMENT_CUSTOM_QUOTE_SECRET',
        'PAYMENT_QUOTE_SECRET'
    ]);
    const runtime = isProductionLikeRuntime(process.env);

    const checks = [
        {
            label: 'SUPABASE_SERVICE_ROLE_KEY',
            ok: Boolean(serviceRoleKey),
            details: serviceRoleKey
                ? `set, fingerprint=${fingerprintSecret(serviceRoleKey)}`
                : 'missing'
        },
        {
            label: 'ADMIN_CONFIG_ENCRYPTION_KEY',
            ok: Boolean(adminEncryptionKey) && adminEncryptionKey !== serviceRoleKey,
            details: !adminEncryptionKey
                ? 'missing'
                : adminEncryptionKey === serviceRoleKey
                    ? 'must not equal SUPABASE_SERVICE_ROLE_KEY'
                    : `set, independent, fingerprint=${fingerprintSecret(adminEncryptionKey)}`
        },
        {
            label: 'PAYMENT_CUSTOM_RECHARGE_QUOTE_SECRET',
            ok: Boolean(quoteSecret.value) && quoteSecret.value !== serviceRoleKey,
            details: !quoteSecret.value
                ? 'missing (checked PAYMENT_CUSTOM_RECHARGE_QUOTE_SECRET / PAYMENT_CUSTOM_QUOTE_SECRET / PAYMENT_QUOTE_SECRET)'
                : quoteSecret.value === serviceRoleKey
                    ? `source=${quoteSecret.name}, but it must not equal SUPABASE_SERVICE_ROLE_KEY`
                    : `set via ${quoteSecret.name}, independent, fingerprint=${fingerprintSecret(quoteSecret.value)}`
        },
        {
            label: 'ADMIN_STUDIO_ACCESS_SECRET',
            ok: Boolean(adminStudioAccessSecret)
                && adminStudioAccessSecret !== serviceRoleKey
                && adminStudioAccessSecret !== adminEncryptionKey,
            details: !adminStudioAccessSecret
                ? 'missing'
                : adminStudioAccessSecret === serviceRoleKey
                    ? 'must not equal SUPABASE_SERVICE_ROLE_KEY'
                    : adminStudioAccessSecret === adminEncryptionKey
                        ? 'should be independent from ADMIN_CONFIG_ENCRYPTION_KEY'
                        : `set, independent, fingerprint=${fingerprintSecret(adminStudioAccessSecret)}`
        },
        {
            label: 'production-like runtime',
            ok: runtime.productionLike || allowNonProduction,
            details: runtime.productionLike
                ? `enabled via ${runtime.source}`
                : allowNonProduction
                    ? 'not production-like, but allowed by --allow-non-production'
                    : 'missing production marker (set DEPLOYMENT_TIER=production if VERCEL_ENV / RAILWAY_ENVIRONMENT_NAME are unavailable)'
        }
    ];

    console.log('Production Environment Check');
    console.log('Compare ADMIN_CONFIG_ENCRYPTION_KEY, PAYMENT_CUSTOM_RECHARGE_QUOTE_SECRET, and ADMIN_STUDIO_ACCESS_SECRET fingerprints across Vercel and Railway; they should match.');
    console.log('');

    checks.forEach((check) => {
        printCheck(check.label, check.ok, check.details);
    });

    console.log('');
    console.log('Runtime flags:');
    console.log(`- VERCEL_ENV=${readEnv('VERCEL_ENV') || '(empty)'}`);
    console.log(`- RAILWAY_ENVIRONMENT_NAME=${readEnv('RAILWAY_ENVIRONMENT_NAME') || '(empty)'}`);
    console.log(`- DEPLOYMENT_TIER=${readEnv('DEPLOYMENT_TIER') || '(empty)'}`);
    console.log(`- APP_ENV=${readEnv('APP_ENV') || '(empty)'}`);
    console.log(`- ALLOW_REMOTE_MOCK_PAYMENTS=${readEnv('ALLOW_REMOTE_MOCK_PAYMENTS') || '(empty)'}`);
    console.log(`- ALLOW_REMOTE_MOCK_PAYMENTS_UNTIL=${readEnv('ALLOW_REMOTE_MOCK_PAYMENTS_UNTIL') || '(empty)'}`);
    console.log(`- PAYMENT_ALLOW_REMOTE_MOCK=${readEnv('PAYMENT_ALLOW_REMOTE_MOCK') || '(empty)'}`);
    console.log(`- PAYMENT_ALLOW_REMOTE_MOCK_UNTIL=${readEnv('PAYMENT_ALLOW_REMOTE_MOCK_UNTIL') || '(empty)'}`);
    console.log(`- PAYMENT_MOCK_ALLOW_REMOTE=${readEnv('PAYMENT_MOCK_ALLOW_REMOTE') || '(empty)'}`);
    console.log(`- PAYMENT_MOCK_ALLOW_REMOTE_UNTIL=${readEnv('PAYMENT_MOCK_ALLOW_REMOTE_UNTIL') || '(empty)'}`);

    const failedChecks = checks.filter((check) => !check.ok);
    if (failedChecks.length) {
        console.log('');
        console.log(`Result: FAIL (${failedChecks.length} issue${failedChecks.length > 1 ? 's' : ''})`);
        process.exitCode = 1;
        return;
    }

    console.log('');
    console.log('Result: PASS');
}

main();
