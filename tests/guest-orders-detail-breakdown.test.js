const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const REPO_ROOT = path.resolve(__dirname, '..');
const clientSource = fs.readFileSync(path.join(REPO_ROOT, 'js', 'guest-orders-client.js'), 'utf8');
const cssSource = fs.readFileSync(path.join(REPO_ROOT, 'css', 'guest-orders.css'), 'utf8');

// Extract helper functions for focused testing
function extractFunction(src, name) {
    const startIdx = src.indexOf(`function ${name}(`);
    assert.ok(startIdx >= 0, `function ${name} must exist`);
    let braceCount = 0;
    let foundFirstBrace = false;
    let endIdx = startIdx;
    for (let i = startIdx; i < src.length; i++) {
        if (src[i] === '{') {
            braceCount++;
            foundFirstBrace = true;
        } else if (src[i] === '}') {
            braceCount--;
            if (foundFirstBrace && braceCount === 0) {
                endIdx = i + 1;
                break;
            }
        }
    }
    return src.slice(startIdx, endIdx);
}

function createTestHarness(catalogProducts = []) {
    const catalogMap = new Map();
    for (const p of catalogProducts) {
        if (p.id) catalogMap.set(String(p.id), p);
        if (p.name) catalogMap.set(String(p.name), p);
    }

    const context = {
        catalogProductsMap: catalogMap,
        normalizeText: (v, max = 2000) => String(v || '').trim().slice(0, max),
        formatAmount: (amount) => {
            const v = Number(amount);
            if (!Number.isFinite(v) || v <= 0) return '-';
            return `¥${v.toFixed(2)}`;
        },
        createNode: (tag, className, text) => {
            return {
                tag,
                className,
                textContent: text,
                children: [],
                appendChild(c) { this.children.push(c); return c; }
            };
        },
        Math,
        Number,
        Array,
        String
    };

    const fnCode = extractFunction(clientSource, 'resolveOrderDiscounts');
    vm.runInNewContext(`${fnCode}; globalThis.resolveOrderDiscounts = resolveOrderDiscounts;`, context);
    return context;
}

test('guest-orders-detail-rows CSS defines 3 columns desktop and aligned narrow layout', () => {
    // Desktop layout
    assert.match(cssSource, /\.guest-orders-detail-rows\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);/);
    // Narrow window layout
    assert.match(cssSource, /@media\s*\(max-width:\s*680px\)\s*\{[\s\S]*?\.guest-orders-detail-rows\s*\{[\s\S]*?grid-template-columns:\s*repeat\(6,\s*minmax\(0,\s*1fr\)\);/);
    assert.match(cssSource, /\.guest-orders-detail-row--order-no\s*\{[\s\S]*?order:\s*1;[\s\S]*?grid-column:\s*span 6;/);
    assert.match(cssSource, /\.guest-orders-detail-row--payment\s*\{[\s\S]*?order:\s*2;[\s\S]*?grid-column:\s*span 2;/);
    assert.match(cssSource, /\.guest-orders-detail-row--original-amount\s*\{[\s\S]*?order:\s*3;[\s\S]*?grid-column:\s*span 2;/);
    assert.match(cssSource, /\.guest-orders-detail-row--status\s*\{[\s\S]*?order:\s*4;[\s\S]*?grid-column:\s*span 2;/);
    // Row 3: discount-amount span 4, paid-amount span 2 (aligned vertically with status in columns 5..6)
    assert.match(cssSource, /\.guest-orders-detail-row--discount-amount\s*\{[\s\S]*?order:\s*5;[\s\S]*?grid-column:\s*span 4;/);
    assert.match(cssSource, /\.guest-orders-detail-row--paid-amount\s*\{[\s\S]*?order:\s*6;[\s\S]*?grid-column:\s*span 2;/);
    assert.match(cssSource, /\.guest-orders-detail-discount-dt/);
    // Popover sizing and nowrap prevention
    assert.match(cssSource, /\.guest-orders-discount-popover\s*\{[\s\S]*?min-width:\s*240px;[\s\S]*?width:\s*max-content;/);
    assert.match(cssSource, /\.guest-orders-discount-popover__row\s*\.disc-name\s*\{[\s\S]*?white-space:\s*nowrap;/);
    assert.match(cssSource, /\.guest-orders-discount-popover__row\s*\.disc-amt\s*\{[\s\S]*?white-space:\s*nowrap;/);
    // Colors: paid amount is green, discount amount is black/inherit
    assert.match(cssSource, /\.guest-orders-detail-row--paid-amount\s+dd\s*\{[\s\S]*?color:\s*var\(--go-ok,\s*#10b981\);/);
    assert.match(cssSource, /html:not\(\[data-theme="dark"\]\)\s+body\.guest-orders-page\s+\.guest-orders-detail-row--paid-amount\s+dd\s*\{[\s\S]*?color:\s*#16a34a;/);
    assert.match(cssSource, /html:not\(\[data-theme="dark"\]\)\s+body\.guest-orders-page\s+\.guest-orders-detail-amount-num\s*\{[\s\S]*?color:\s*#0f172a;/);
    // Delivery title enlarged while copy button remains untouched
    assert.match(cssSource, /\.guest-orders-delivery-title\s*\{[\s\S]*?font-size:\s*15\.5px;/);
    assert.match(cssSource, /\.guest-orders-delivery-title\s+i\s*\{[\s\S]*?font-size:\s*17px;/);
});

test('resolveOrderDiscounts resolves coupon discount and original amount from amount_breakdown', () => {
    const { resolveOrderDiscounts } = createTestHarness();

    const order = {
        total_amount: 0.25,
        amount_breakdown: {
            quantity: 3,
            unit_amount: 0.08,
            net_amount: 0.24,
            discount_amount: 0.05,
            payment_fee_amount: 0.01,
            total_amount: 0.25,
            list_unit_amount: 0.10,
            list_amount: 0.30,
            discount_code: 'TESTPROMO'
        }
    };

    const res = resolveOrderDiscounts(order);
    assert.equal(res.originalAmount, 0.30, 'original amount must equal list_amount');
    assert.equal(res.discountAmount, 0.05, 'discount amount must equal discount_amount');
    assert.equal(res.paidAmount, 0.25, 'paid amount must equal total_amount');
    assert.equal(res.discountItems.length, 1);
    assert.match(res.discountItems[0].label, /TESTPROMO/);
    assert.equal(res.discountItems[0].text, '-¥0.05');
});

test('resolveOrderDiscounts returns zero discount when no discounts apply', () => {
    const { resolveOrderDiscounts } = createTestHarness();

    const order = {
        total_amount: 19.90,
        amount: 19.90
    };

    const res = resolveOrderDiscounts(order);
    assert.equal(res.originalAmount, 19.90);
    assert.equal(res.discountAmount, 0);
    assert.equal(res.paidAmount, 19.90);
    assert.equal(res.discountItems.length, 0);
});

test('resolveOrderDiscounts recognizes applied_discounts from discount_snapshot', () => {
    const { resolveOrderDiscounts } = createTestHarness();

    const order = {
        total_amount: 80.00,
        amount_breakdown: {
            quantity: 1,
            unit_amount: 80.00,
            total_amount: 80.00,
            list_amount: 100.00,
            discount_amount: 20.00
        },
        discount_snapshot: {
            applied_discounts: [
                { type: 'coupon', code: 'VIP20', discount_amount: 20.00 }
            ]
        }
    };

    const res = resolveOrderDiscounts(order);
    assert.equal(res.originalAmount, 100.00);
    assert.equal(res.discountAmount, 20.00);
    assert.equal(res.paidAmount, 80.00);
    assert.equal(res.discountItems.length, 1);
    assert.match(res.discountItems[0].label, /VIP20/);
    assert.equal(res.discountItems[0].text, '-¥20.00');
});

test('resolveOrderDiscounts identifies flash sale discount against catalog original price', () => {
    const catalog = [
        {
            id: 'prod-flash-1',
            price_points: 100.00,
            product_flash_sale_price: 80.00
        }
    ];
    const { resolveOrderDiscounts } = createTestHarness(catalog);

    const order = {
        product_id: 'prod-flash-1',
        quantity: 1,
        total_amount: 80.00,
        unit_amount: 80.00,
        list_unit_amount: 80.00
    };

    const res = resolveOrderDiscounts(order);
    assert.equal(res.originalAmount, 100.00, 'original amount should be catalog base price');
    assert.equal(res.discountAmount, 20.00, 'discount should be 20');
    assert.equal(res.paidAmount, 80.00);
    assert.ok(res.discountItems.some((d) => d.label.includes('秒杀')));
});

test('resolveOrderDiscounts identifies tier pricing discount against catalog original price', () => {
    const catalog = [
        {
            id: 'prod-tier-1',
            price_points: 50.00,
            quantity_rules: [
                { qty: 2, price: 40.00 }
            ]
        }
    ];
    const { resolveOrderDiscounts } = createTestHarness(catalog);

    const order = {
        product_id: 'prod-tier-1',
        quantity: 2,
        total_amount: 80.00,
        unit_amount: 40.00,
        list_unit_amount: 40.00
    };

    const res = resolveOrderDiscounts(order);
    assert.equal(res.originalAmount, 100.00, 'original amount should be 50 * 2 = 100');
    assert.equal(res.discountAmount, 20.00, 'discount should be 20');
    assert.equal(res.paidAmount, 80.00);
    assert.ok(res.discountItems.some((d) => d.label.includes('阶梯')));
});

test('resolveOrderDiscounts identifies SKU-level tier pricing for multi-qty orders (user case)', () => {
    const catalog = [
        {
            id: 'prod-d1',
            name: 'D1-多件原子预占-测试',
            price_points: 10.00,
            skus: [
                {
                    id: 'sku-d1-success',
                    sku_name: 'D1-成功路径',
                    price_points: 10.00,
                    quantity_rules: [
                        { qty: 1, price: 0.1 },
                        { qty: 3, price: 0.08 }
                    ]
                }
            ]
        }
    ];
    const { resolveOrderDiscounts } = createTestHarness(catalog);

    const order = {
        product_name: 'D1-多件原子预占-测试',
        sku_name: 'D1-成功路径',
        quantity: 3,
        total_amount: 0.25,
        unit_amount: 0.08,
        list_unit_amount: 10.00
    };

    const res = resolveOrderDiscounts(order);
    assert.equal(res.originalAmount, 30.00, 'original amount should be 10 * 3 = 30.00');
    assert.equal(res.discountAmount, 29.75, 'discount should be 30.00 - 0.25 = 29.75');
    assert.equal(res.paidAmount, 0.25);
    assert.equal(res.discountItems.length, 1);
    assert.equal(res.discountItems[0].label, '阶梯价优惠 (满3件)');
    assert.equal(res.discountItems[0].text, '-¥29.75');
});

test('client places discount help icon in dt and not in dd', () => {
    // Assert client source attaches help icon to dt
    assert.match(clientSource, /dt\.appendChild\(help\)/);
    assert.match(clientSource, /dt\.className\s*=\s*'guest-orders-detail-discount-dt'/);
    // Assert dd does not contain help
    assert.doesNotMatch(clientSource, /dd\.appendChild\(help\)/);
    // Assert help does not set title attribute to prevent native browser tooltip rectangle
    assert.doesNotMatch(clientSource, /help\.title\s*=/);
});

