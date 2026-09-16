const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const {
    EVENT_COLUMNS,
    ORDER_COLUMNS,
    PAYMENT_COLUMNS,
    parseReconcileArgs,
    reconcileGuestShopRecords,
    sanitizeValue,
    main
} = require('../scripts/guest-shop-reconcile');

test('reconcile CLI defaults to local-only and never selects secrets', () => {
    assert.deepEqual(parseReconcileArgs([]), {
        localOnly: true,
        queryProvider: false,
        json: false,
        lookbackDays: 14,
        envFile: path.resolve(process.cwd(), '.env')
    });
    const queried = parseReconcileArgs(['--query-provider', '--json', '--lookback-days', '7']);
    assert.equal(queried.queryProvider, true);
    assert.equal(queried.localOnly, false);
    assert.equal(queried.json, true);
    assert.equal(queried.lookbackDays, 7);
    assert.doesNotMatch(ORDER_COLUMNS, /claim_secret|recovery_code/);
    assert.doesNotMatch(PAYMENT_COLUMNS, /response_payload|claim_secret/);
    assert.doesNotMatch(EVENT_COLUMNS, /payload_redacted|response_payload|recovery_code/);
    const source = fs.readFileSync(path.join(__dirname, '../scripts/guest-shop-reconcile.js'), 'utf8');
    assert.match(source, /--local-only/);
    assert.match(source, /queryGuestPayment/);
});

test('local reconcile detects order/payment/event/amount/purpose mismatches', () => {
    const result = reconcileGuestShopRecords({
        orders: [
            {
                id: 'ord-1',
                order_no: 'G1',
                site: 'cn',
                currency: 'CNY',
                total_amount: 9.9,
                payment_status: 'confirmed'
            },
            {
                id: 'ord-orphan',
                order_no: 'G-ORPHAN',
                site: 'cn',
                currency: 'CNY',
                total_amount: 1,
                payment_status: 'pending'
            }
        ],
        payments: [
            {
                id: 'pay-1',
                guest_order_id: 'ord-1',
                merchant_order_no: 'M1',
                purpose: 'shop_direct',
                provider: 'zpay',
                site: 'intl',
                currency: 'USD',
                expected_amount: 8.8,
                paid_amount: 8.8,
                status: 'confirmed'
            },
            {
                id: 'pay-orphan',
                guest_order_id: 'missing-order',
                merchant_order_no: 'M-ORPHAN',
                purpose: 'recharge',
                provider: 'zpay',
                site: 'cn',
                currency: 'CNY',
                expected_amount: 1,
                status: 'pending'
            }
        ],
        events: [
            {
                id: 'evt-1',
                payment_order_id: 'pay-1',
                merchant_order_no: 'M1',
                event_key: 'evt-1',
                signature_verified: false,
                final_status_verified: false,
                processing_status: 'received'
            },
            {
                id: 'evt-orphan',
                payment_order_id: null,
                merchant_order_no: 'ghost',
                event_key: 'evt-orphan',
                signature_verified: true
            }
        ]
    });

    const codes = result.findings.map((item) => item.code).sort();
    assert.equal(result.summary.finding_count > 0, true);
    assert.equal(codes.includes('order_without_payment'), true);
    assert.equal(codes.includes('payment_without_order'), true);
    assert.equal(codes.includes('event_without_payment'), true);
    assert.equal(codes.includes('confirmed_without_verified_event'), true);
    assert.equal(codes.includes('amount_mismatch'), true);
    assert.equal(codes.includes('currency_mismatch'), true);
    assert.equal(codes.includes('site_mismatch'), true);
    assert.equal(codes.includes('purpose_not_shop_direct'), true);
    assert.equal(JSON.stringify(result).includes('recovery_code'), false);
});

test('provider snapshots keep query failures in review and never auto-confirm', () => {
    const result = reconcileGuestShopRecords({
        orders: [{
            id: 'ord-1',
            order_no: 'G1',
            site: 'cn',
            currency: 'CNY',
            total_amount: 9.9,
            payment_status: 'pending'
        }],
        payments: [{
            id: 'pay-1',
            guest_order_id: 'ord-1',
            merchant_order_no: 'M1',
            purpose: 'shop_direct',
            provider: 'zpay',
            site: 'cn',
            currency: 'CNY',
            expected_amount: 9.9,
            status: 'pending'
        }],
        events: [{
            payment_order_id: 'pay-1',
            signature_verified: true,
            final_status_verified: true,
            processing_status: 'processed',
            event_key: 'ok'
        }],
        providerSnapshots: [{
            merchant_order_no: 'M1',
            provider: 'zpay',
            query_error: 'timeout talking to zpay',
            response_payload: { secret: 'should-not-leak' },
            recovery_code: 'should-not-leak'
        }]
    });
    assert.equal(result.findings.some((item) => item.code === 'provider_query_failed'), true);
    assert.equal(result.findings.some((item) => item.code === 'provider_paid_local_pending'), false);
    assert.equal(JSON.stringify(result).includes('should-not-leak'), false);
    assert.equal(JSON.stringify(result).includes('response_payload'), false);
});

test('provider paid vs local pending and provider unpaid vs local confirmed are flagged', () => {
    const result = reconcileGuestShopRecords({
        orders: [
            { id: 'ord-paid', order_no: 'G-PAID', site: 'cn', currency: 'CNY', total_amount: 9.9, payment_status: 'pending' },
            { id: 'ord-conf', order_no: 'G-CONF', site: 'cn', currency: 'CNY', total_amount: 9.9, payment_status: 'confirmed' }
        ],
        payments: [
            { id: 'pay-paid', guest_order_id: 'ord-paid', merchant_order_no: 'M-PAID', purpose: 'shop_direct', provider: 'zpay', site: 'cn', currency: 'CNY', expected_amount: 9.9, status: 'pending' },
            { id: 'pay-conf', guest_order_id: 'ord-conf', merchant_order_no: 'M-CONF', purpose: 'shop_direct', provider: 'nowpayments', site: 'cn', currency: 'CNY', expected_amount: 9.9, status: 'confirmed' }
        ],
        events: [
            { payment_order_id: 'pay-conf', signature_verified: true, final_status_verified: true, processing_status: 'processed', event_key: 'ok' }
        ],
        providerSnapshots: [
            { merchant_order_no: 'M-PAID', status: 'paid', amount: 9.9, currency: 'CNY', site: 'cn', purpose: 'shop_direct' },
            { merchant_order_no: 'M-CONF', status: 'expired', amount: 9.9, currency: 'CNY', site: 'cn', purpose: 'shop_direct' }
        ]
    });
    const codes = result.findings.map((item) => item.code);
    assert.equal(codes.includes('provider_paid_local_pending'), true);
    assert.equal(codes.includes('provider_unpaid_local_confirmed'), true);
});

test('sanitizeValue strips secrets even from nested objects', () => {
    const sanitized = sanitizeValue({
        order_no: 'G1',
        recovery_code: 'abc',
        nested: { claim_secret_hash: 'hash', ok: 1, response_payload: { a: 1 } }
    });
    assert.deepEqual(sanitized, { order_no: 'G1', nested: { ok: 1 } });
});

test('main local-only path prints findings and does not query provider', async () => {
    const queried = [];
    const stdout = { chunks: [], write(value) { this.chunks.push(String(value)); return true; } };
    const supabase = {
        from(table) {
            const rows = {
                guest_shop_orders: [{ id: 'ord-1', order_no: 'G1', site: 'cn', currency: 'CNY', total_amount: 1, payment_status: 'pending', updated_at: '2026-09-14T00:00:00.000Z' }],
                guest_shop_payment_orders: [],
                guest_shop_payment_events: []
            };
            const builder = {
                select() { return builder; },
                gte() { return builder; },
                order() { return builder; },
                range() { return Promise.resolve({ data: rows[table] || [], error: null }); }
            };
            return builder;
        }
    };
    const code = await main(['--local-only'], {
        env: { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-role' },
        supabase,
        adapter: {
            async queryGuestPayment(input) {
                queried.push(input);
                return { status: 'paid' };
            }
        },
        stdout
    });
    assert.equal(code, 1);
    assert.equal(queried.length, 0);
    assert.match(stdout.chunks.join(''), /order_without_payment/);
    assert.doesNotMatch(stdout.chunks.join(''), /recovery_code|claim_secret/);
});
