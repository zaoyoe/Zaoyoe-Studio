'use strict';

// Synthetic reporting records only. Never used by a live API or dashboard.
const AS_OF = '2026-10-17T07:30:00.000Z';
function payload(module = 'business', options = {}) {
    const window = { module, range: '7d', timezone: 'Asia/Shanghai', from: '2026-10-10T16:00:00.000Z', to: AS_OF,
        previous_from: '2026-10-03T16:00:00.000Z', previous_to: '2026-10-10T07:30:00.000Z', as_of: AS_OF, ...options.window };
    const metric = { paid_count: 28, completed_count: 31, unverified_count: 0, review_count: 1, cny: '2860.50', usdt: '182.76543210', review_cny: '100.00', review_usdt: '0' };
    const data = module === 'business' ? { version: 1, module, comparable: true,
        metrics: { current: metric, previous: { ...metric, paid_count: 20, completed_count: 24, cny: '2320.20', usdt: '140', review_count: 0 } },
        trend: ['11', '12', '13', '14', '15', '16', '17'].map((day, index) => ({ date: '2026-10-' + day, cny: ['220', '380', '160', '600', '450', '720', '330.50'][index], usdt: ['12', '0', '25', '31', '49', '20', '45.76543210'][index] })),
        products: [3, 6, 12, null].map((term, index) => ({ product_family: term ? 'telegram_premium' : 'telegram_stars', term_months: term,
            paid_count: [9, 7, 6, 6][index], completed_count: [10, 8, 7, 6][index], cny: ['900', '700', '1000', '260.50'][index], usdt: ['32', '40', '80', '30.76543210'][index], stars_sold: term ? 0 : 2400 })),
        channels: [{ payment_channel: 'alipay', pay_currency: null, receipt_currency: 'CNY', paid_count: 22, amount: '2860.50' },
            { payment_channel: 'usdt_bep20', pay_currency: 'usdtton', receipt_currency: 'USDT', paid_count: 3, amount: '82' },
            { payment_channel: 'usdt_bep20', pay_currency: 'usdttrc20', receipt_currency: 'USDT', paid_count: 2, amount: '100.76543210' },
            { payment_channel: 'usdt_bep20', pay_currency: null, receipt_currency: 'USDT', paid_count: 1, amount: '0' }] }
        : module === 'operations' ? { version: 1, module, total_attention: 9, normal_queue: 3, oldest_since: '2026-10-16T01:20:00.000Z',
            groups: ['payment_review', 'fulfillment_review', 'failed', 'overdue'].map((reason, index) => ({ reason, purchase_count: [2, 3, 1, 1][index], redemption_count: [0, 1, 0, 1][index], oldest_since: '2026-10-16T01:20:00.000Z' })) }
        : { version: 1, module, generated: 120, used: 42, available: 65, in_flight: 5, expiring: 8, usage_rate: 35 };
    return { success: true, window, snapshot_at: window.as_of, data: { ...data, ...options.data } };
}
module.exports = { AS_OF, payload };
