const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const RUNTIME_SCAN_ROOTS = [
    path.join(REPO_ROOT, 'api'),
    path.join(REPO_ROOT, 'server'),
    path.join(REPO_ROOT, 'supabase', 'functions')
];
const ALLOWED_RPC_FILES = new Set([
    path.join(REPO_ROOT, 'api', '_lib', 'payments', 'rpc.js')
]);
const RESTRICTED_RPC_PATTERN = /\.rpc\(['"]fn_(recharge_points|deduct_points|deduct_points_admin_site|get_user_balance|process_afdian_payment|apply_payment_order_review|finalize_afdian_custom_payment)['"]/g;
const FORBIDDEN_POINTS_MUTATION_PATTERNS = [
    /\.from\(['"]points_balance['"]\)\.(insert|update|upsert|delete)\(/g,
    /\.from\(['"]points_ledger['"]\)\.(insert|update|upsert|delete)\(/g
];

function collectRuntimeFiles(rootDir, files = []) {
    if (!fs.existsSync(rootDir)) return files;

    for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
        if (entry.name === 'node_modules') continue;

        const absolutePath = path.join(rootDir, entry.name);
        if (entry.isDirectory()) {
            collectRuntimeFiles(absolutePath, files);
            continue;
        }

        if (!/\.(js|ts)$/i.test(entry.name)) continue;
        files.push(absolutePath);
    }

    return files;
}

function relativePath(absolutePath) {
    return path.relative(REPO_ROOT, absolutePath) || absolutePath;
}

test('payment-sensitive RPC entrypoints stay centralized', () => {
    const violations = [];
    const files = RUNTIME_SCAN_ROOTS.flatMap((rootDir) => collectRuntimeFiles(rootDir));

    for (const filePath of files) {
        const source = fs.readFileSync(filePath, 'utf8');

        if (!ALLOWED_RPC_FILES.has(filePath)) {
            const rpcMatches = [...source.matchAll(RESTRICTED_RPC_PATTERN)];
            for (const match of rpcMatches) {
                violations.push(`${relativePath(filePath)} -> ${match[0]}`);
            }
        }

        for (const pattern of FORBIDDEN_POINTS_MUTATION_PATTERNS) {
            const mutationMatches = [...source.matchAll(pattern)];
            for (const match of mutationMatches) {
                violations.push(`${relativePath(filePath)} -> ${match[0]}`);
            }
        }
    }

    assert.deepEqual(
        violations,
        [],
        `Found legacy payment/points entrypoints outside the centralized payment RPC module:\n${violations.join('\n')}`
    );
});
