const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('TG public and admin entry pages stay independent from the existing shop', () => {
    const publicPage = read('tg.html');
    const adminPage = read('tg-admin.html');
    assert.match(publicPage, /\/js\/tg\.js/);
    assert.match(adminPage, /\/js\/tg-admin\.js/);
    assert.doesNotMatch(publicPage, /redemption_codes|shopSku|shop\.js|points\.js/i);
    assert.doesNotMatch(adminPage, /redemption_codes|shopSku|admin-studio\.js/i);
    assert.match(publicPage, /name="referrer" content="no-referrer"/);
    assert.match(publicPage, /id="tgStatusToken" type="password"/);
});

test('TG domains route their roots to separate pages', () => {
    const vercel = JSON.parse(read('vercel.json'));
    for (const [host, destination] of [['tg.fatherkey.com', '/tg'], ['tg.adm.fatherkey.com', '/tg-admin']]) {
        const route = vercel.redirects.find((route) => route.source === '/' && route.has?.some((condition) => condition.type === 'host' && condition.value === host));
        assert.equal(route?.destination, destination);
        assert.equal(route.permanent, false);
        assert.ok(fs.existsSync(path.join(root, `${destination}.html`)), 'canonical redirect must resolve to an actual TG static page');
    }
});

test('Telegram product previews cannot alter code-bound entitlements', () => {
    const publicPage = read('tg.html');
    assert.match(publicPage, /id="tgStarsPreview"[^>]*aria-pressed="false"/);
    assert.match(publicPage, /上方切换仅展示产品说明/);
    assert.doesNotMatch(publicPage, /name="(?:stars_quantity|term_months|product_family)"/);
    const adminPage = read('tg-admin.html');
    assert.match(adminPage, /name="product_family"/);
    assert.match(adminPage, /name="stars_quantity"[^>]*min="50"[^>]*max="1000000"/);
    assert.match(adminPage, /兑换码张数/);
});

test('TG public entry has independent purchase and code redemption modes', () => {
    const publicPage = read('tg.html');
    assert.match(publicPage, /id="tgModePurchase"[^>]*aria-pressed="true"/);
    assert.match(publicPage, /id="tgModeRedeem"[^>]*aria-pressed="false"/);
    assert.match(publicPage, /id="tgRedeemPanel"[^>]*hidden/);
    assert.match(publicPage, /id="tgRedeemStatusPanel"[^>]*hidden/);
    assert.match(publicPage, /id="tgPurchaseConfirmation"[^>]*hidden/);
    assert.match(publicPage, /<button id="tgPurchaseCheckout"[^>]*type="button"/);
    assert.match(publicPage, /id="tgPurchaseStatusToken" type="password"/);
    const adminPage = read('tg-admin.html');
    for (const id of ['premium_3', 'premium_6', 'premium_12', 'stars']) assert.ok(adminPage.includes(`id="tgPrice-${id}"`));
    assert.match(adminPage, /id="tgPurchasesBody"/);
    assert.match(adminPage, /id="tgPurchasesPager"/);
});

test('TG order lookup opens as a dedicated subpage instead of a popover modal', () => {
    const publicPage = read('tg.html');
    assert.match(publicPage, /id="tgWorkspaceView"/);
    assert.match(publicPage, /id="tgOrderLookupPage"[^>]*hidden/);
    assert.match(publicPage, /id="tgOrderLookupToggle"[^>]*href="\?view=orders"/);
    assert.match(publicPage, /id="tgOrderLookupBack"/);
    assert.doesNotMatch(publicPage, /id="tgOrderLookupPopover"/);
    assert.doesNotMatch(publicPage, /id="tgOrderLookupBackdrop"/);
});

test('TG admin query method custom select is not nested in an activating label', () => {
    const adminPage = read('tg-admin.html');
    const selectScript = read('js/tg-admin-selects.js');
    const field = adminPage.match(/<div class="tg-orders-field"><span id="tgAdminQuerySearchByLabel">[\s\S]*?<\/div>/)?.[0] || '';
    assert.ok(field, 'query method field uses a non-label wrapper');
    assert.match(field, /id="tgAdminQuerySearchBy" aria-label="查询方式"/);
    assert.doesNotMatch(field, /<label\b|\bfor="tgAdminQuerySearchBy"/);
    assert.match(selectScript, /item\.addEventListener\('click', event => \{ event\.preventDefault\(\); event\.stopPropagation\(\); choose\(control, index\); \}\)/);
    assert.match(selectScript, /trigger\.addEventListener\('click', event => \{ event\.preventDefault\(\); event\.stopPropagation\(\);/);
    assert.match(selectScript, /control\.select\.dispatchEvent\(new scope\.Event\('change', \{ bubbles: true \}\)\)/);
});

test('TG checkout is an accessible in-page dialog with the same local QR dependency as guest checkout', () => {
    const html = read('tg.html'); const shop = read('shop.html');
    assert.match(html, /<dialog id="tgPaymentDialog"[^>]*aria-labelledby="tgPaymentTitle"/);
    for (const id of ['tgPaymentClose', 'tgPaymentRefresh', 'tgPaymentContent', 'tgPaymentCountdown', 'tgPaymentCountdownValue']) assert.ok(html.includes(`id="${id}"`));
    assert.ok(html.includes('/css/cash-payment-dialog.css'));
    assert.ok(shop.includes('css/cash-payment-dialog.css'));
    for (const phase of ['configure', 'payment', 'delivery']) assert.ok(html.includes(`data-step-key="${phase}"`));
    const qrPath = '/js/vendor/qrcode-generator-2.0.4.js';
    assert.ok(html.includes(qrPath)); assert.ok(shop.includes(qrPath.slice(1)));
    assert.ok(html.indexOf(qrPath) < html.indexOf('/js/tg.js'));
    assert.ok(html.indexOf('/js/tg-payment-pricing.js') < html.indexOf('/js/tg.js'));
    assert.doesNotMatch(html, /<a[^>]*id="tgPurchaseCheckout"/);
    const vercel = JSON.parse(read('vercel.json'));
    for (const fn of ['api/public.js', 'api/admin.js']) assert.ok(vercel.functions[fn].includeFiles.includes('js/tg-payment-pricing.js'));
    assert.ok(read('scripts/deploy-kvm4-verify-server.sh').includes('\n  js\n'));
    assert.ok(read('deploy/kvm4/verify-server.Dockerfile').includes('COPY js ./js'));
});
