const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

function collectAssetUrls(html, regex) {
    return [...html.matchAll(regex)].map((match) => match[1]);
}

test('admin studio local static assets are cache-bustable before enabling browser caching', () => {
    const html = readRepoFile('admin-studio.html');
    const scriptUrls = collectAssetUrls(html, /<script[^>]+src=["']([^"']+)["']/g);
    const styleUrls = collectAssetUrls(html, /<link[^>]+href=["']([^"']+)["']/g)
        .filter((href) => /\.css(?:\?|$)/.test(href));

    const localStaticScripts = scriptUrls.filter((src) => !/^(https?:)?\/\//.test(src) && !src.startsWith('/api/'));
    const localStaticStyles = styleUrls.filter((href) => !/^(https?:)?\/\//.test(href) && !href.startsWith('/api/'));
    const unversionedLocalStaticScripts = localStaticScripts.filter((src) => !/[?&]v=/.test(src));
    const unversionedLocalStaticStyles = localStaticStyles.filter((href) => !/[?&]v=/.test(href));

    assert.deepEqual(unversionedLocalStaticScripts, [], 'Every local static script in admin-studio.html should carry a version query');
    assert.deepEqual(unversionedLocalStaticStyles, [], 'Every local static stylesheet in admin-studio.html should carry a version query');
    assert.equal(scriptUrls.includes('/api/runtime/supabase-config'), true, 'Dynamic runtime config should stay unversioned and request-scoped');
});
