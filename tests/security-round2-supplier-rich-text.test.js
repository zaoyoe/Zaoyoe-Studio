'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { resolveFullMediaUrl, DEFAULT_GATEWAY, syncHtmlMediaToR2 } = require('../server/api-handlers/admin/shop/_r2-media');
const backend = fs.readFileSync(require.resolve('../server/api-handlers/admin/shop/supplier-catalog'), 'utf8');
const frontend = fs.readFileSync(require.resolve('../js/admin-shop.js'), 'utf8');
function namedFunction(name) {
    let start = backend.indexOf(`function ${name}(`);
    if (backend.slice(start - 6, start) === 'async ') start -= 6;
    assert.ok(start >= 0);
    return backend.slice(start, backend.indexOf('\n}', start) + 2);
}
function runtime(overrides = {}) {
    const context = vm.createContext({ URL, crypto, resolveFullMediaUrl, DEFAULT_GATEWAY, process: { env: {} }, ...overrides });
    vm.runInContext(['normalizeText', 'escapeHtmlBasic', 'sanitizeSupplierRichTextHtml', 'prepareSupplierMediaForR2'].map(namedFunction).join('\n'), context);
    const start = frontend.indexOf('    formatSupplierCatalogDescriptionHtml: function');
    const end = frontend.indexOf('    renderSupplierCatalogRows:', start);
    vm.runInContext(`globalThis.admin = {escapeHtml: escapeHtmlBasic, ${frontend.slice(start, end)}};`, context);
    return context;
}
for (const side of ['backend', 'admin-preview']) {
    function sanitize(html) {
        const c = runtime();
        return side === 'backend' ? c.sanitizeSupplierRichTextHtml(html) : c.admin.formatSupplierCatalogDescriptionHtml(html);
    }
    test(`${side}: link content cannot bypass escaping or retain script/event handlers`, () => {
        for (const payload of [
            '<a href="https://example.com/"><script>alert(1)</script><b onclick="bad()">hello</b></a>',
            '<a href="https://example.com/"><svg onload=bad()></svg><img src="/x.png" onerror="bad()"></a>',
            '<a data-href="https://example.com/" href="javascript:bad()">unsafe</a>',
            '<a href="https://example.com/"><a href="https://other.example.com/"><iframe srcdoc="bad"></iframe></a></a>'
        ]) {
            const result = sanitize(payload);
            assert.doesNotMatch(result, /<(?:script|svg|iframe)\b|<[^>]+\bon(?:click|error|load)\s*=|href="javascript:/i);
        }
        const result = sanitize('<a href="https://example.com/"><b>hello</b><img src="/x.png"></a>');
        assert.match(result, /<a href="https:\/\/example.com\/" target="_blank" rel="noopener noreferrer"><b>hello<\/b><img /);
        assert.doesNotMatch(result, /___SUPPLIER_|___SAFE_TAG_/);
    });
    test(`${side}: CSS is allowlisted while legacy formatting and media survive`, () => {
        const result = sanitize('<center><font size="5" color="#ff0000" style="position:fixed;z-index:9999;background-image:url(https://bad.example.com/);font-style:italic">hi</font><img src="/x.png" style="width:100%;height:auto;border-radius:8px;position:fixed;background:url(https://bad.example.com/);-moz-binding:url(x)"></center>');
        assert.match(result, /font-size:18px;font-weight:600;color:#ff0000;font-style:italic/);
        assert.match(result, /width:100%;height:auto;border-radius:8px/);
        assert.doesNotMatch(result, /position:|z-index:|url\(|binding/);
        assert.match(result, /<div style="text-align:center;">/);
    });
    test(`${side}: entity quotes remain attribute text and synthetic placeholders cannot be injected`, () => {
        const result = sanitize('<img data-src="/wrong.png" src="/x.png?a=1&amp;b=2" alt="&quot; onerror=&quot;bad()"><a href="https://example.com/?a=1&amp;b=2">$& ___SAFE_TAG_0___</a>');
        assert.match(result, /src="https:\/\/xiareng.cc\/x.png\?a=1&amp;b=2"/);
        assert.match(result, /alt="&quot; onerror=&quot;bad\(\)"/);
        assert.doesNotMatch(result, /alt=""|src="[^"]*wrong/);
        assert.match(result, /\$&amp; ___SAFE_TAG_0___/);
    });
    test(`${side}: unsupported media protocols cannot become active attributes`, () => {
        for (const source of ['javascript:alert(1)', 'data:image/svg+xml,evil', 'file:///etc/passwd', 'https://user:pass@example.com/a']) {
            assert.doesNotMatch(sanitize(`<img src="${source}">`), /<img /);
        }
        assert.doesNotMatch(sanitize('<img data-src="/wrong.png">'), /<img /);
    });
}
test('supplier import never restores rejected covers or cleared HTML and propagates unexpected sync errors', async () => {
    const base = { uploadProductImageAssets: async () => null, syncHtmlMediaToR2: async () => '' };
    const c = runtime(base);
    const result = await c.prepareSupplierMediaForR2({ imageUrl: 'http://127.0.0.1/x', rawDescription: '<img src="/x.png">', rawPurchaseNotes: '<b>notes</b>', env: {} });
    assert.equal(result.imageUrl, ''); assert.equal(result.imageAssets, null);
    assert.equal(result.description, ''); assert.equal(result.purchaseNotes, '');
    const failed = runtime({ ...base, syncHtmlMediaToR2: async () => { throw new Error('synthetic sync failure'); } });
    await assert.rejects(failed.prepareSupplierMediaForR2({ rawDescription: '<p>description</p>', env: {} }), /synthetic sync failure/);
});
test('sanitized signed-query URLs round-trip once and encoded loopback URLs are removed', async () => {
    const c = runtime();
    const html = c.sanitizeSupplierRichTextHtml('<img src="https://images.example.com/a.png?token=abc&amp;expires=123">');
    const synced = await syncHtmlMediaToR2(html, { env: {} });
    assert.match(synced, /token=abc&amp;expires=123/);
    assert.doesNotMatch(synced, /&amp;amp;/);
    const blocked = await syncHtmlMediaToR2('<img src="http://&#49;27.0.0.1/x">', { env: {} });
    assert.doesNotMatch(blocked, /src=/);
});
