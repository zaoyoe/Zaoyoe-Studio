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
    assert.match(publicPage, /id="tgPurchaseCheckout"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/);
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
