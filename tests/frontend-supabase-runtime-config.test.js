const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const HARD_CODED_SUPABASE_HOST = 'mmkugdibsaeoevliebzk.supabase.co';
const HARD_CODED_SUPABASE_KEY = 'sb_publishable_lwkiF-sQ80z8e9oMcejFPQ_j7oezjcF';

const RUNTIME_PAGES = [
    'index.html',
    'guestbook.html',
    'admin-entry.html',
    'verify.html',
    'shop.html',
    'prompts.html',
    'debug-realtime.html',
    'admin-studio.html',
    'auth-callback.html',
    'privacy.html',
    'reset-password.html'
];

const RUNTIME_SCRIPTS = [
    'supabase-client.js',
    'js/admin-shop.js',
    'js/avatar-uploader.js',
    'supabase-auth-functions.js',
    'admin-config.js',
    'admin-studio.js'
];

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

test('active frontend runtime files no longer hardcode the production Supabase host or publishable key', () => {
    const violations = [];

    for (const relativePath of [...RUNTIME_PAGES, ...RUNTIME_SCRIPTS, 'vercel.json']) {
        const source = readRepoFile(relativePath);

        if (source.includes(HARD_CODED_SUPABASE_HOST)) {
            violations.push(`${relativePath} still hardcodes the production Supabase host`);
        }

        if (source.includes(HARD_CODED_SUPABASE_KEY)) {
            violations.push(`${relativePath} still hardcodes the production publishable key`);
        }
    }

    assert.deepEqual(violations, [], violations.join('\n'));
});

test('frontend entry pages load the shared Supabase runtime config before initialization', () => {
    const missing = [];

    for (const relativePath of RUNTIME_PAGES) {
        const source = readRepoFile(relativePath);

        if (!source.includes('/api/runtime/supabase-config')) {
            missing.push(`${relativePath} is missing /api/runtime/supabase-config`);
        }

        if (!source.includes('runtime-supabase-config.js')) {
            missing.push(`${relativePath} is missing js/runtime-supabase-config.js`);
        }
    }

    assert.deepEqual(missing, [], missing.join('\n'));
});

test('shared frontend scripts depend on the unified runtime Supabase helpers', () => {
    const expectations = new Map([
        ['supabase-client.js', 'requireZaoyoeSupabaseConfig'],
        ['js/admin-shop.js', 'requireZaoyoeSupabaseConfig'],
        ['js/avatar-uploader.js', 'getZaoyoeSupabaseFunctionUrl'],
        ['supabase-auth-functions.js', 'getZaoyoeSupabaseFunctionUrl'],
        ['admin-config.js', 'getZaoyoeSupabaseFunctionUrl'],
        ['admin-studio.js', 'getZaoyoeSupabaseFunctionUrl']
    ]);
    const missing = [];

    for (const [relativePath, marker] of expectations.entries()) {
        const source = readRepoFile(relativePath);
        if (!source.includes(marker)) {
            missing.push(`${relativePath} should reference ${marker}`);
        }
    }

    assert.deepEqual(missing, [], missing.join('\n'));
});
