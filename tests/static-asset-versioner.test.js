const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
    applyStaticAssetVersion,
    collectDeployTextFiles,
    normalizeStaticAssetVersion,
    rewriteStaticAssetVersionsInText,
    shouldRewriteStaticAssetUrl
} = require('../api/_lib/static-asset-versioner');

function writeFile(rootDir, relativePath, contents) {
    const absolutePath = path.join(rootDir, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, contents);
}

test('static asset versioner rewrites only same-site versioned CSS and JS URLs', () => {
    const source = [
        '<script src="./js/app.js?v=OLD_1&siteAssetCdn=KEEP"></script>',
        '<script src="../js/app.js?v=OLD_8"></script>',
        '<link rel="stylesheet" href="/css/app.css?v=OLD_2">',
        '<script src="https://www.fatherkey.com/js/site.js?v=OLD_3"></script>',
        '<script src="https://cdn.jsdelivr.net/npm/pkg/app.js?v=OLD_4"></script>',
        '<script src="https://unpkg.com/pkg/app.js?v=OLD_5"></script>',
        '<script src="/api/public.js?v=OLD_6"></script>',
        '<img src="assets/logo.png?v=OLD_7">'
    ].join('\n');

    const result = rewriteStaticAssetVersionsInText(source, 'sha-123');

    assert.equal(result.replacements, 4);
    assert.equal(result.text.includes('./js/app.js?v=sha-123&siteAssetCdn=KEEP'), true);
    assert.equal(result.text.includes('../js/app.js?v=sha-123'), true);
    assert.equal(result.text.includes('/css/app.css?v=sha-123'), true);
    assert.equal(result.text.includes('https://www.fatherkey.com/js/site.js?v=sha-123'), true);
    assert.equal(result.text.includes('https://cdn.jsdelivr.net/npm/pkg/app.js?v=OLD_4'), true);
    assert.equal(result.text.includes('https://unpkg.com/pkg/app.js?v=OLD_5'), true);
    assert.equal(result.text.includes('/api/public.js?v=OLD_6'), true);
    assert.equal(result.text.includes('assets/logo.png?v=OLD_7'), true);
});

test('static asset versioner applies deploy versions to public entry files without touching ignored harnesses', () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-versioner-'));

    writeFile(rootDir, 'index.html', '<script src="./js/app.js?v=OLD&foo=bar"></script>');
    writeFile(rootDir, 'debug-realtime.html', '<script src="./js/debug.js?v=OLD"></script>');
    writeFile(rootDir, 'js/app.js', "const css = 'css/app.css?v=OLD';\nconst external = 'https://cdnjs.cloudflare.com/x.css?v=OLD';");
    writeFile(rootDir, 'update_title.js', "const css = './css/app.css?v=OLD';");
    writeFile(rootDir, 'css/app.css', '.app{color:red}');

    const files = collectDeployTextFiles(rootDir);
    assert.deepEqual(files, ['css/app.css', 'index.html', 'js/app.js']);

    const result = applyStaticAssetVersion({ rootDir, version: 'deploy123', dryRun: false });

    assert.equal(result.replacements, 2);
    assert.deepEqual(result.changedFiles, ['index.html', 'js/app.js']);
    assert.equal(fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8').includes('./js/app.js?v=deploy123&foo=bar'), true);
    assert.equal(fs.readFileSync(path.join(rootDir, 'js/app.js'), 'utf8').includes('css/app.css?v=deploy123'), true);
    assert.equal(fs.readFileSync(path.join(rootDir, 'update_title.js'), 'utf8').includes('./css/app.css?v=OLD'), true);
    assert.equal(fs.readFileSync(path.join(rootDir, 'js/app.js'), 'utf8').includes('https://cdnjs.cloudflare.com/x.css?v=OLD'), true);
    assert.equal(fs.readFileSync(path.join(rootDir, 'debug-realtime.html'), 'utf8').includes('debug.js?v=OLD'), true);
});

test('static asset versioner keeps URL filtering and version normalization conservative', () => {
    assert.equal(normalizeStaticAssetVersion(' abc.DEF-123_456!? '), 'abcDEF-123_456');
    assert.equal(shouldRewriteStaticAssetUrl('./js/app.js?v='), true);
    assert.equal(shouldRewriteStaticAssetUrl('/css/app.css?v='), true);
    assert.equal(shouldRewriteStaticAssetUrl('https://zaoyoe.com/js/app.js?v='), true);
    assert.equal(shouldRewriteStaticAssetUrl('https://example.com/js/app.js?v='), false);
    assert.equal(shouldRewriteStaticAssetUrl('/api/admin.js?v='), false);
});
