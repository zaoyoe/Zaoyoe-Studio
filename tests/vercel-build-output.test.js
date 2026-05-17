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
    writeTempFile(tempRoot, 'api/public.js', 'module.exports = {};');
    writeTempFile(tempRoot, 'server/api-handlers/public/runtime-supabase-config.js', 'module.exports = {};');
    writeTempFile(tempRoot, 'scripts/local-preview-server.js', 'console.log("preview");');
    writeTempFile(tempRoot, 'tests/example.test.js', 'assert.ok(true);');
    writeTempFile(tempRoot, 'package.json', '{}');
    writeTempFile(tempRoot, 'debug-realtime.html', '<!doctype html>');

    const result = buildStaticOutput({ rootDir: tempRoot });
    const files = new Set(result.files);

    assert.equal(files.has('index.html'), true);
    assert.equal(files.has('js/site-config.js'), true);
    assert.equal(files.has('assets/verify-preview.png'), true);
    assert.equal(files.has('api/public.js'), false);
    assert.equal(files.has('server/api-handlers/public/runtime-supabase-config.js'), false);
    assert.equal(files.has('scripts/local-preview-server.js'), false);
    assert.equal(files.has('tests/example.test.js'), false);
    assert.equal(files.has('package.json'), false);
    assert.equal(files.has('debug-realtime.html'), false);
});

test('vercel static asset filter does not treat real image assets as preview harnesses', () => {
    assert.equal(shouldCopyStaticAsset('assets/verify-preview.png'), true);
    assert.equal(shouldCopyStaticAsset('preview-hero-effects.html'), false);
    assert.equal(shouldCopyStaticAsset('css/preview-hero-effects.css'), false);
    assert.equal(shouldCopyStaticAsset('js/preview-icons-page.js'), false);
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
