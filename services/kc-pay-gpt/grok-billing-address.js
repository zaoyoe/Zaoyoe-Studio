'use strict';

const { grokError } = require('./grok-checkout-state');
const invalid = message => { throw grokError('GROK_BILLING_UNCONFIRMED', message); };

function assertNativeBillingRegion(region, currency) {
    if (String(region || '').trim().toUpperCase() !== 'US'
        || String(currency || '').trim().toUpperCase() !== 'USD') {
        invalid('新版组合订阅当前只支持已核验的 US/USD 账单流程');
    }
}

// Normalize equivalent labels only. Never relabel a different state's address
// as Oregon: the address picker must supply the entire supported address.
function normalizeNativeBillingAddress(address) {
    if (!address || typeof address !== 'object' || Array.isArray(address)
        || typeof address.country !== 'string' || address.country.trim().toUpperCase() !== 'US'
        || typeof address.state !== 'string' || !/^(OR|Oregon)$/i.test(address.state.trim())) {
        invalid('新版组合订阅当前只启用已核验的美国俄勒冈账单流程');
    }
    for (const [key, limit] of [['line1', 200], ['city', 100], ['postal_code', 20]]) {
        if (typeof address[key] !== 'string' || !address[key].trim() || address[key].trim().length > limit) {
            invalid(`缺少有效的账单 ${key}，尚未提交支付`);
        }
    }
    if (!/^\d{5}(?:-\d{4})?$/.test(address.postal_code.trim())) invalid('美国账单邮编格式无法确认，尚未提交支付');
    if (address.line2 != null && (typeof address.line2 !== 'string' || address.line2.trim().length > 200)) {
        invalid('账单 line2 格式无法确认，尚未提交支付');
    }
    return { ...address, country: 'US', state: 'OR', line1: address.line1.trim(),
        line2: address.line2?.trim() || '', city: address.city.trim(), postal_code: address.postal_code.trim() };
}

module.exports = { assertNativeBillingRegion, normalizeNativeBillingAddress };
