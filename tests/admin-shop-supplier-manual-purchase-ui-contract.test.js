'use strict';

// Contract test for the operator-controlled manual purchase flow (plan B).
// It locks the static surfaces only: migration shape, admin HTML cache-bust,
// drawer markup/CSS pairing and the registered admin actions. Business
// acceptance (real supplier call, real deduction) stays NOT RUN here.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const MIGRATION = 'supabase/migrations/20261021_shop_supplier_platform_v2_manual_purchase.sql';
const STAGE = 'supabase/migrations/20261021_shop_supplier_platform_v2_manual_purchase_stage.sql';
const ACCEPTANCE = 'supabase/acceptance/20261021_supplier_manual_purchase_structural_check.sql';
const HANDLER = 'server/api-handlers/admin/shop/supplier-manual-purchase.js';
const CACHE_TOKEN = 'supplierManualPurchase=20261021_SUPPLIER_MANUAL_PURCHASE_1';

test('manual purchase migrations declare the operator RPCs and keep them service_role only', () => {
    const sql = read(MIGRATION);
    for (const fn of [
        'fn_shop_supplier_manual_context_v2',
        'fn_shop_supplier_manual_quote_v2',
        'fn_shop_supplier_manual_confirm_v2',
        'fn_shop_supplier_manual_stage_v2',
        'fn_shop_supplier_manual_record_v2'
    ]) {
        assert.match(sql, new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\(`), `${fn} must be declared`);
        assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon, authenticated, service_role;`),
            `${fn} must be revoked from every role before the explicit grant`);
        assert.match(sql, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\(`), `${fn} must be granted to service_role`);
    }
    assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.shop_supplier_manual_purchases \(/);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.shop_supplier_manual_purchase_events \(/);
    assert.match(sql, /tr_supplier_manual_events_immutable_v2/);
    // The stage migration exists so a crashed confirm can be finished from the recorded order number.
    const stage = read(STAGE);
    assert.match(stage, /CREATE OR REPLACE FUNCTION public\.fn_shop_supplier_manual_stage_v2\(/);
});

test('structural acceptance script keeps 13 explicit checks and never claims business PASS', () => {
    const sql = read(ACCEPTANCE);
    const ids = new Set();
    for (const match of sql.matchAll(/SELECT '([a-z0-9_]+)' AS check_id/g)) ids.add(match[1]);
    for (const match of sql.matchAll(/UNION ALL SELECT '([a-z0-9_]+)'/g)) ids.add(match[1]);
    assert.equal(ids.size, 13, `expected 13 structural checks, got ${[...ids].join(',')}`);
    assert.match(sql, /Business acceptance stays NOT RUN/);
    assert.doesNotMatch(sql, /\bPASS\b/, 'the script must not hard-code a PASS verdict');
});

test('admin studio loads the drawer CSS and JS with a fresh cache-bust token', () => {
    const html = read('admin-studio.html');
    const occurrences = html.split(CACHE_TOKEN).length - 1;
    assert.equal(occurrences, 2, 'both the stylesheet and the admin-shop script must carry the new token');
    // The previous supplier catalog token must survive: dropping it would let a stale CSS/JS pair win.
    assert.equal(html.split('supplierCatalog=20261019_SUPPLIER_PLATFORM_V2_READONLY_1').length - 1, 2);
    assert.match(html, /css\/admin-studio-page\.css\?[^"]*supplierManualPurchase=/);
    assert.match(html, /js\/admin-shop\.js\?[^"]*supplierManualPurchase=/);
});

test('every class used by the manual drawer markup has a style rule', () => {
    const js = read('js/admin-shop.js');
    const start = js.indexOf('renderSupplierManualEntry: function');
    const end = js.indexOf('loadSupplierOperations: async function');
    assert.ok(start > 0 && end > start, 'manual drawer block must sit between the resolution entry and the operations list');
    const css = read('css/admin-studio-page.css');
    const block = js.slice(start, end);
    const classes = new Set();
    for (const match of block.matchAll(/class="([^"]*)"/g)) {
        for (const name of match[1].split(/\s+/)) {
            if (!name || name.includes('${')) continue;
            classes.add(name);
        }
    }
    assert.ok(classes.has('shop-drawer'), 'drawer shell must be present');
    assert.ok(classes.has('shop-supplier-manual__amount'), 'quoted amount must be present');
    for (const name of classes) {
        if (!name.startsWith('shop-')) continue;
        assert.ok(css.includes(`.${name}`), `missing style rule for .${name}`);
    }
});

test('the drawer uses the overlay shell that the global dismiss handler expects', () => {
    const js = read('js/admin-shop.js');
    assert.match(js, /overlay\.className = 'shop-drawer-overlay'/);
    assert.match(js, /<aside class="shop-drawer shop-supplier-manual"/);
    assert.match(js, /id="supplierManualBody"/);
    assert.match(js, /this\.bindOverlayDismiss\(overlay, \(\) => this\.closeSupplierManualPurchase\(\)\)/);
});

test('admin actions for the manual flow are registered once each', () => {
    const js = read('js/admin-shop.js');
    for (const action of ['open', 'close', 'quote', 'confirm', 'finalize']) {
        const needle = `case 'supplier-manual-${action}':`;
        assert.equal(js.split(needle).length - 1, 1, `${needle} must be registered exactly once`);
    }
});

test('handler stays off by default and requires an explicit confirm flag', () => {
    const handler = read(HANDLER);
    assert.match(handler, /SHOP_SUPPLIER_MANUAL_PURCHASE_ENABLED/);
    assert.match(handler, /supplier_manual_disabled/);
    assert.match(handler, /sendJson\(res, 503/);
    assert.match(handler, /requireAdmin\(req, \{ permission: 'shop\.manage' \}\)/);
    assert.match(handler, /writeAdminAuditLog\(/);
    assert.match(handler, /body\.confirm !== true/);
    for (const action of ['context', 'quote', 'confirm', 'finalize']) {
        assert.match(handler, new RegExp(`'${action}'`), `handler must implement the ${action} action`);
    }
});

test('adapter never returns the card secret from a purchase call', () => {
    const client = read('server/integrations/suppliers/xiareng/client.js');
    const start = client.indexOf('async createPurchase(');
    const end = client.indexOf('async fetchDelivery(');
    assert.ok(start > 0 && end > start, 'createPurchase and fetchDelivery must both exist');
    // Comments explain the rule; only the executable body is checked.
    const createPurchase = client.slice(start, end).replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(createPurchase, /secret/i, 'purchase must not surface the delivered secret; delivery is a separate call');
    assert.match(createPurchase, /actualAmountCny/);
    assert.match(createPurchase, /requestId/);
});

test('the 人工采购 entry only appears for an unsubmitted order awaiting acceptance', () => {
    const vm = require('node:vm');
    const source = read('js/admin-shop.js');
    const method = (name) => {
        const found = source.match(new RegExp(`^    ${name}: (?:async )?function \\([^\\n]*\\) \\{[\\s\\S]*?^    \\},`, 'm'));
        assert.ok(found, `${name} must exist`);
        return found[0];
    };
    const shop = vm.runInNewContext(`({${method('canManualPurchase')}${method('renderSupplierManualEntry')}})`, {});
    shop.escapeForAttr = (value) => String(value);

    const base = {
        procurementState: 'not_submitted', deliveryState: 'awaiting_acceptance',
        intentId: '0b6f5f1e-9a5c-4d1f-9d33-4a1c0f7b1a11',
        orderNo: 'TG-1224A9A53E5A435D9E09', nativeOrderId: '0b6f5f1e-9a5c-4d1f-9d33-4a1c0f7b1a12',
        fundingKind: 'points', site: 'cn'
    };
    const html = shop.renderSupplierManualEntry(base);
    assert.match(html, /data-shop-action="supplier-manual-open"/);
    assert.match(html, /人工采购/);
    assert.match(html, /data-intent-id="0b6f5f1e-9a5c-4d1f-9d33-4a1c0f7b1a11"/);

    // Already submitted, already delivered, or a non-UUID intent must never offer a second purchase.
    for (const patch of [{ procurementState: 'accepted' }, { procurementState: 'review' },
        { deliveryState: 'delivered' }, { deliveryState: 'awaiting_delivery' }, { intentId: 'nope' }, { intentId: '' }]) {
        assert.equal(shop.renderSupplierManualEntry({ ...base, ...patch }), '',
            `no entry for ${JSON.stringify(patch)}`);
    }
    assert.equal(shop.renderSupplierManualEntry(null), '');
});
