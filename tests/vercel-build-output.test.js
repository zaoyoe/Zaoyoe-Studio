const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
    assertSafeProductionSource,
    buildStaticOutput,
    shouldCopyStaticAsset
} = require('../api/_lib/vercel-build');

function writeTempFile(rootDir, relativePath, contents = '') {
    const targetPath = path.join(rootDir, relativePath);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, contents);
}

test('vercel static output keeps public assets while excluding function sources', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vercel-static-output-'));

    writeTempFile(tempRoot, 'index.html', '<!doctype html><title>ok</title>');
    writeTempFile(tempRoot, 'js/site-config.js', 'window.SiteConfig = {};');
    writeTempFile(tempRoot, 'assets/verify-preview.png', 'png');
    writeTempFile(tempRoot, 'vendor/supabase/2.95.3/supabase.js', 'window.supabase = {};');
    writeTempFile(tempRoot, 'vendor/fontawesome/6.4.0/webfonts/fa-solid-900.woff2', 'font');
    writeTempFile(tempRoot, 'api/public.js', 'module.exports = {};');
    writeTempFile(tempRoot, 'server/api-handlers/public/runtime-supabase-config.js', 'module.exports = {};');
    writeTempFile(tempRoot, 'scripts/local-preview-server.js', 'console.log("preview");');
    writeTempFile(tempRoot, 'deploy/kvm4/tg-worker/zaoyoe-tg-worker.cjs', 'module.exports = {};');
    writeTempFile(tempRoot, 'deploy/kvm4/tg-worker/zaoyoe-tg-worker.service', '[Service]');
    writeTempFile(tempRoot, 'deploy/kvm4/tg-worker/zaoyoe-tg-worker.timer', '[Timer]');
    writeTempFile(tempRoot, 'deploy/kvm4/tg-worker/zaoyoe-tg-worker', '#!/bin/sh');
    writeTempFile(tempRoot, 'tests/example.test.js', 'assert.ok(true);');
    writeTempFile(tempRoot, 'package.json', '{}');
    writeTempFile(tempRoot, 'debug-realtime.html', '<!doctype html>');

    const result = buildStaticOutput({ rootDir: tempRoot });
    const files = new Set(result.files);

    assert.equal(files.has('index.html'), true);
    assert.equal(files.has('js/site-config.js'), true);
    assert.equal(files.has('assets/verify-preview.png'), true);
    assert.equal(files.has('vendor/supabase/2.95.3/supabase.js'), true);
    assert.equal(files.has('vendor/fontawesome/6.4.0/webfonts/fa-solid-900.woff2'), true);
    assert.equal(files.has('api/public.js'), false);
    assert.equal(files.has('server/api-handlers/public/runtime-supabase-config.js'), false);
    assert.equal(files.has('scripts/local-preview-server.js'), false);
    for (const file of ['zaoyoe-tg-worker.cjs', 'zaoyoe-tg-worker.service', 'zaoyoe-tg-worker.timer', 'zaoyoe-tg-worker']) {
        assert.equal(files.has(`deploy/kvm4/tg-worker/${file}`), false);
    }
    assert.equal(files.has('tests/example.test.js'), false);
    assert.equal(files.has('package.json'), false);
    assert.equal(files.has('debug-realtime.html'), false);
});


test('vercel static output excludes dotted test and spec fixtures without removing public modules', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vercel-static-fixtures-'));
    const privateMarker = 'FIXTURE_ONLY_NOT_FOR_PUBLIC_STATIC_OUTPUT';
    const privateFiles = [
        'js/admin-access.test.js',
        'js/admin-access.spec.js',
        'js/session.test.mjs',
        'js/session.spec.cjs',
        'js/test.mjs',
        'js/SPEC.cjs',
        'css/admin.test.css',
        'admin.spec.html'
    ];
    const publicFiles = ['js/admin-access.js', 'js/glass-mutations.mjs', 'js/contest.js', 'js/inspect.cjs'];

    try {
        for (const file of privateFiles) writeTempFile(tempRoot, file, privateMarker);
        for (const file of publicFiles) writeTempFile(tempRoot, file, '/* public module */');

        const result = buildStaticOutput({ rootDir: tempRoot });
        const files = new Set(result.files);
        for (const file of privateFiles) assert.equal(files.has(file), false, file);
        for (const file of publicFiles) assert.equal(files.has(file), true, file);
        for (const file of result.files) {
            assert.equal(fs.readFileSync(path.join(result.outputRoot, file), 'utf8').includes(privateMarker), false, file);
        }
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test('vercel static asset filter does not treat real image assets as preview harnesses', () => {
    assert.equal(shouldCopyStaticAsset('assets/verify-preview.png'), true);
    assert.equal(shouldCopyStaticAsset('preview-hero-effects.html'), false);
    assert.equal(shouldCopyStaticAsset('css/preview-hero-effects.css'), false);
    assert.equal(shouldCopyStaticAsset('js/preview-icons-page.js'), false);
});

test('vercel static asset filter excludes heavy raw prompt images and intermediate optimization folders', () => {
    assert.equal(shouldCopyStaticAsset('assets/prompts'), false);
    assert.equal(shouldCopyStaticAsset('assets/prompts/3D_chibi_style______1_1.png'), false);
    assert.equal(shouldCopyStaticAsset('assets/prompts-optimized'), false);
    assert.equal(shouldCopyStaticAsset('assets/prompts-optimized/banner.webp'), false);
    assert.equal(shouldCopyStaticAsset('assets/prompts-home/example.webp'), true);
    assert.equal(shouldCopyStaticAsset('assets/prompts-card/example.webp'), true);
});

test('vercel production builds are only allowed from main', () => {
    assert.deepEqual(
        assertSafeProductionSource({
            VERCEL_ENV: 'production',
            VERCEL_GIT_COMMIT_REF: 'main'
        }),
        {
            checked: true,
            production: true,
            ref: 'main'
        }
    );

    assert.throws(
        () => assertSafeProductionSource({
            VERCEL_ENV: 'production',
            VERCEL_GIT_COMMIT_REF: 'codex/dark-hero-liquid-matrix'
        }),
        /Blocked Vercel production build from codex\/dark-hero-liquid-matrix/
    );

    assert.deepEqual(
        assertSafeProductionSource({
            VERCEL_ENV: 'preview',
            VERCEL_GIT_COMMIT_REF: 'codex/example'
        }),
        {
            checked: false,
            production: false,
            ref: 'codex/example'
        }
    );
});
