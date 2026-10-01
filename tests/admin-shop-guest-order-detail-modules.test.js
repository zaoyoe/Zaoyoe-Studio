const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const shopScript = fs.readFileSync(path.join(root, 'js/admin-shop.js'), 'utf8');
const shopStyles = fs.readFileSync(path.join(root, 'css/admin-studio-page.css'), 'utf8');
const guestOrdersHandler = fs.readFileSync(
    path.join(root, 'server/api-handlers/admin/shop/guest-orders.js'),
    'utf8'
);
const guestOrdersViewMigration = fs.readFileSync(
    path.join(root, 'supabase/migrations/20260925_guest_shop_admin_order_detail_financials.sql'),
    'utf8'
);

function functionSource(name) {
    const start = shopScript.indexOf(`${name}: function`);
    assert.notEqual(start, -1, `missing ${name}`);
    const next = shopScript.indexOf('\n    },', start);
    assert.notEqual(next, -1, `could not delimit ${name}`);
    return shopScript.slice(start, next);
}

test('guest order detail exposes the same fulfillment and operations surface as point orders', () => {
    const fulfillment = functionSource('renderGuestOrderFulfillmentSection');
    const detailStart = shopScript.indexOf('renderGuestExceptionDetailBody: function');
    const detailEnd = shopScript.indexOf('copyGuestExceptionOrder: async function', detailStart);
    assert.ok(detailStart >= 0 && detailEnd > detailStart, 'guest detail renderer is present');
    const detail = shopScript.slice(detailStart, detailEnd);

    assert.match(fulfillment, /履约与动作/);
    for (const field of [
        'payment_status',
        'reservation_status',
        'reservation_row_status',
        'fulfillment_status',
        'refund_status',
        'last_error_code',
        'fulfilled_at',
        'reserved_until',
        'expires_at'
    ]) {
        assert.match(fulfillment, new RegExp(`row(?:\\?\\.|\\.)${field}`), `fulfillment section must show ${field}`);
    }
    assert.match(fulfillment, /renderGuestExceptionWriteButtons\(row\)/);
    assert.match(fulfillment, /renderGuestBuyerAccessButton\(row\)/);
    assert.match(detail, /renderGuestOrderFulfillmentSection\(row\)/);
});

test('guest order detail exposes profit and reconciliation with an explicit no-cost state', () => {
    const profit = functionSource('renderGuestOrderProfitDetailSection');
    const detailStart = shopScript.indexOf('renderGuestExceptionDetailBody: function');
    const detailEnd = shopScript.indexOf('copyGuestExceptionOrder: async function', detailStart);
    const detail = shopScript.slice(detailStart, detailEnd);

    assert.match(profit, /利润与对账/);
    for (const field of [
        'recognized_revenue_amount',
        'gross_amount',
        'discount_amount',
        'payment_fee_amount',
        'purchase_cost_cny',
        'net_profit_cny',
        'refund_status'
    ]) {
        assert.match(profit, new RegExp(field), `profit section must account for ${field}`);
    }
    assert.match(profit, /待核对/);
    assert.match(profit, /缺少成本/);
    assert.match(profit, /未关联库存/);
    assert.match(profit, /净利润需在对账数据补齐后确认/);
    assert.match(profit, /商品毛利/);
    assert.match(profit, /不是支付平台的实际结算费/);
    assert.match(detail, /renderGuestOrderProfitDetailSection\(row\)/);
});

test('guest order detail has its own section-based loading skeleton and keeps guest close behavior', () => {
    const guestLoading = functionSource('buildGuestExceptionDetailLoadingMarkup');
    const renderGuestLoading = vm.runInNewContext(`({${guestLoading}}}).buildGuestExceptionDetailLoadingMarkup`);
    const markup = renderGuestLoading.call({
        escapeHtml: (value) => String(value ?? ''),
        getShopSkeletonWidthClass: (width) => `shop-table-skeleton-wp-${String(width).replace('%', '')}`
    }, 'GS-1');

    assert.match(guestLoading, /shop-guest-detail-loading/);
    for (const section of ['guest-summary', 'guest-payment', 'guest-inventory', 'guest-timeline', 'guest-fulfillment', 'profit']) {
        assert.match(markup, new RegExp(`shop-order-detail-section--${section}`));
    }
    assert.match(markup, /guest-exception-detail-close/);
    assert.doesNotMatch(markup, /shop-order-detail-loading__(?:hero|grid)/);
    assert.match(markup, /shop-order-detail-grid shop-guest-detail-loading__grid/);
    assert.match(shopStyles, /\.shop-guest-detail-loading__hero/);
    assert.match(shopStyles, /\.shop-guest-detail-loading__fields/);
});

test('point-order modules receive distinct colored top accents', () => {
    const detailStart = shopScript.indexOf('renderOrderDetailBody: function');
    const detailEnd = shopScript.indexOf('// Show order detail in a modal', detailStart);
    assert.ok(detailStart >= 0 && detailEnd > detailStart);
    const detail = shopScript.slice(detailStart, detailEnd);
    const profitRenderer = functionSource('renderOrderProfitDetailSection');

    for (const section of ['point-inventory', 'point-fulfillment', 'point-tickets', 'point-risk']) {
        assert.match(detail, new RegExp(`shop-order-detail-section--${section}`), `${section} needs a semantic accent class`);
        assert.match(shopStyles, new RegExp(`shop-order-detail-section--${section}[^}]*--point-detail-accent`));
    }
    assert.match(profitRenderer, /shop-order-detail-section--point-profit/, 'point-profit needs a semantic accent class');
    assert.match(shopStyles, /shop-order-detail-section--point-profit[^}]*--point-detail-accent/);
    assert.match(shopStyles, /border-top: 2px solid rgba\(var\(--point-detail-accent\), 0\.68\)/);
    assert.match(shopStyles, /html\[data-theme="light"\].*shop-order-detail-modal/s);
});

test('guest order timeline adds a colored refund event without inventing its timestamp', () => {
    const refundEvent = functionSource('renderGuestOrderRefundTimelineEvent');
    const renderRefundEvent = vm.runInNewContext(`({${refundEvent}}}).renderGuestOrderRefundTimelineEvent`);
    const detailStart = shopScript.indexOf('renderGuestExceptionDetailBody: function');
    const detailEnd = shopScript.indexOf('copyGuestExceptionOrder: async function', detailStart);
    const detail = shopScript.slice(detailStart, detailEnd);
    const rendererContext = {
        escapeForAttr: (value) => String(value ?? '').replaceAll('"', '&quot;'),
        escapeHtml: (value) => String(value ?? '').replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
        formatGuestExceptionStatus: (value) => ({
            failed: '退款失败',
            manual_review: '人工复核',
            pending: '处理中'
        }[value] || String(value || '—'))
    };

    assert.match(refundEvent, /row\?\.refund_status/);
    assert.match(refundEvent, /row\?\.payment_status/);
    assert.match(refundEvent, /row\?\.fulfillment_status/);
    assert.match(refundEvent, /\['succeeded', 'refunded', 'full_refund'\]/);
    assert.match(refundEvent, /\['failed', 'manual_review'\]/);
    assert.match(refundEvent, /退款时间未单独记录/);
    assert.match(refundEvent, /Number\.isFinite\(parsedRefundAt\.getTime\(\)\)/);
    assert.doesNotMatch(refundEvent, /row\?\.updated_at|row\?\.last_event_at/);
    assert.match(detail, /\$\{refundTimelineEvent\}/);
    assert.match(shopStyles, /\.shop-guest-order-refund-event--success/);
    assert.match(shopStyles, /\.shop-guest-order-refund-event--danger/);
    assert.match(shopStyles, /\.shop-guest-order-refund-event--warn/);
    assert.match(shopStyles, /html\[data-theme="light"\] \.shop-guest-order-refund-event--success/);
    assert.ok(shopStyles.includes('html:not([data-theme="dark"]) .shop-guest-order-refund-event--success'));
    assert.ok(shopStyles.includes('@media (max-width: 640px)'));

    const render = (row) => renderRefundEvent.call(rendererContext, row);
    assert.equal(render({ refund_status: 'none', payment_status: 'pending' }), '');
    assert.match(render({ refund_status: 'succeeded', refunded_at: '2026-01-02T03:04:05Z' }), /shop-guest-order-refund-event--success/);
    assert.match(render({ refund_status: 'failed' }), /shop-guest-order-refund-event--danger/);
    assert.match(render({ refund_status: 'manual_review' }), /人工复核/);
    assert.match(render({ refund_status: 'pending' }), /shop-guest-order-refund-event--warn/);
    assert.match(render({ refund_status: 'not_applicable', payment_status: 'refunded' }), /data-refund-state="refunded"/);
    assert.match(render({ refund_status: 'failed', payment_status: 'refunded' }), /支付记录显示已退款，请核对订单退款状态/);
    assert.match(render({ refund_status: 'succeeded', refunded_at: 'invalid-time' }), /退款时间未单独记录/);
    assert.doesNotMatch(render({ refund_status: 'succeeded', refunded_at: 'invalid-time' }), /Invalid Date/);
});

test('guest order detail keeps sensitive inventory and claim fields outside the normal module', () => {
    const detailStart = shopScript.indexOf('renderGuestExceptionDetailBody: function');
    const detailEnd = shopScript.indexOf('copyGuestExceptionOrder: async function', detailStart);
    assert.ok(detailStart >= 0 && detailEnd > detailStart);
    const detail = shopScript.slice(detailStart, detailEnd);

    for (const forbidden of [
        'row.content',
        'row.claim_secret',
        'row.claim_secret_hash',
        'row.raw_payload',
        'row.webhook_body'
    ]) {
        assert.doesNotMatch(detail, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
    assert.match(detail, /guest-exception-sensitive-detail/);
    assert.match(detail, /敏感排障资料，默认隐藏/);
});

test('guest order safe projection carries financial inputs without exposing secrets', () => {
    const fieldBlock = guestOrdersHandler.match(/const SAFE_VIEW_FIELDS = Object\.freeze\(\[([\s\S]*?)\]\);/);
    assert.ok(fieldBlock, 'guest order safe field projection exists');
    const fields = fieldBlock[1];
    for (const field of ['expected_amount', 'paid_amount', 'payment_last_error_code']) {
        assert.match(fields, new RegExp(`'${field}'`));
    }
    for (const field of ['payment_currency', 'list_unit_amount', 'payment_fee_amount', 'inventory_purchase_unit_cost_cny']) {
        assert.match(fields, new RegExp(`'${field}'`));
    }
    assert.match(guestOrdersViewMigration, /p\.currency\s+AS\s+payment_currency/);
    assert.match(guestOrdersViewMigration, /\bo\.list_unit_amount\b/);
    assert.match(guestOrdersViewMigration, /\bo\.payment_fee_amount\b/);
    assert.match(guestOrdersViewMigration, /i\.purchase_unit_cost_cny\s+AS\s+inventory_purchase_unit_cost_cny/);
    for (const forbidden of ['content', 'claim_secret', 'claim_secret_hash', 'raw_payload', 'webhook_body']) {
        assert.doesNotMatch(fields, new RegExp(`['"]${forbidden}['"]`));
    }
});

test('guest order admin view returns one row per order when quantity has multiple reservations', () => {
    assert.match(guestOrdersViewMigration, /LEFT JOIN LATERAL\s*\([\s\S]*?FROM public\.guest_shop_inventory_reservations reservation[\s\S]*?WHERE reservation\.order_id = o\.id[\s\S]*?LIMIT 1\s*\) r ON TRUE/);
    assert.doesNotMatch(guestOrdersViewMigration, /LEFT JOIN public\.guest_shop_inventory_reservations r ON r\.order_id = o\.id/);
});

test('guest order detail text actions override compact table icon sizing', () => {
    const fulfillment = functionSource('renderGuestOrderFulfillmentSection');
    const detailStart = shopScript.indexOf('renderGuestExceptionDetailBody: function');
    const detailEnd = shopScript.indexOf('copyGuestExceptionOrder: async function', detailStart);
    const detail = shopScript.slice(detailStart, detailEnd);
    const detailActionStyles = shopStyles.slice(shopStyles.lastIndexOf('/* Guest exception detail actions:'));

    assert.match(fulfillment, /shop-order-detail-inline-btn[^\"]*" data-shop-action="guest-exception-copy-order/);
    assert.match(detail, /shop-guest-exception-action--sensitive[^\"]*shop-order-detail-inline-btn/);
    assert.match(detailActionStyles, /\.shop-order-detail-modal \.shop-guest-exception-copy-order,[\s\S]*?width:\s*auto;[\s\S]*?height:\s*auto;[\s\S]*?white-space:\s*nowrap;/);
});

test('guest exception summary and promo status provide light-theme surfaces and readable status colors', () => {
    const lightGuestStyles = shopStyles.slice(shopStyles.lastIndexOf('/* Guest exception detail actions:'));
    for (const selector of [
        'html[data-theme="light"] .shop-guest-promo-status',
        'html[data-theme="light"] .shop-guest-promo-status-budget',
        'html[data-theme="light"] .shop-guest-promo-status-events li',
        'html[data-theme="light"] .shop-guest-exception-metric',
        'html[data-theme="light"] .shop-guest-exceptions-notice'
    ]) {
        assert.ok(lightGuestStyles.includes(selector), `missing light-theme style ${selector}`);
    }
    assert.match(lightGuestStyles, /\.shop-guest-promo-status-breaker--success[\s\S]*?color:\s*#15803d/);
    assert.match(lightGuestStyles, /\.shop-guest-promo-status-breaker--danger[\s\S]*?color:\s*#b91c1c/);
});
