(function exposeTgPaymentPricing(scope) {
    'use strict';
    const rates = Object.freeze({ alipay: 100, wxpay: 0, usdt_bep20: 100 });
    function breakdown(subtotal, channel) {
        if (!Number.isSafeInteger(subtotal) || subtotal < 1 || subtotal > 100000000 || !Object.hasOwn(rates, channel)) return null;
        const rate = rates[channel];
        const fee = Number((BigInt(subtotal) * BigInt(rate) + 9999n) / 10000n);
        if (subtotal + fee > 100000000) return null;
        return { subtotal_minor: subtotal, payment_fee_minor: fee, payment_fee_rate_bps: rate, total_minor: subtotal + fee };
    }
    function valid(value, { quote = false } = {}) {
        if (!value || !Object.hasOwn(rates, value.payment_channel)) return false;
        if (!Number.isSafeInteger(value.subtotal_minor) || value.subtotal_minor < 1 || value.subtotal_minor > 100000000
            || !Number.isSafeInteger(value.payment_fee_minor) || !Number.isSafeInteger(value.total_minor)) return false;
        // Existing payable orders retain the exact fee-free snapshot accepted
        // before this migration. New quotes always use the channel's rate.
        if (!quote && value.payment_fee_rate_bps === 0) return value.payment_fee_minor === 0 && value.total_minor === value.subtotal_minor;
        const expected = breakdown(value.subtotal_minor, value.payment_channel);
        if (!expected) return false;
        return Object.keys(expected).every((key) => value[key] === expected[key]);
    }
    function displayCryptoAmount(value, precision = 4) {
        if (typeof value !== 'string' || !/^\d{1,20}(?:\.\d{1,18})?$/.test(value)
            || !/[1-9]/.test(value) || !Number.isInteger(precision) || precision < 0 || precision > 18) return null;
        const [major, fraction = ''] = value.split('.');
        const scale = 10n ** BigInt(precision);
        const kept = fraction.slice(0, precision).padEnd(precision, '0');
        let units = BigInt(major) * scale + BigInt(kept || '0');
        if (fraction.length > precision && /[1-9]/.test(fraction.slice(precision))) units += 1n;
        const shownMajor = units / scale;
        const shownFraction = precision ? String(units % scale).padStart(precision, '0') : '';
        return precision ? `${shownMajor}.${shownFraction}` : String(shownMajor);
    }
    function usdtPayAmount(totalMinor, rate) {
        if (!Number.isSafeInteger(totalMinor) || totalMinor < 1 || totalMinor > 100000000 || typeof rate !== 'string'
            || !/^(?:0|[1-9]\d{0,7})(?:\.\d{1,8})?$/.test(rate)) return null;
        const [major, fraction = ''] = rate.split('.');
        const units = BigInt(major) * 100000000n + BigInt(fraction.padEnd(8, '0'));
        if (units < 1n || units >= 1000000000n) return null;
        // Merchant USDT price. Quote and pay in usdtbsc so there is no
        // second USD-to-USDT conversion at the payment provider.
        const cents = (BigInt(totalMinor) * units + 99999999n) / 100000000n;
        return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
    }
    function cryptoAmountsEqual(left, right) {
        function units(value) {
            if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,19})(?:\.\d{1,18})?$/.test(value) || !/[1-9]/.test(value)) return null;
            const [major, fraction = ''] = value.split('.');
            return BigInt(major) * 10n ** 18n + BigInt(fraction.padEnd(18, '0'));
        }
        const expected = units(left); return expected !== null && expected === units(right);
    }
    const api = Object.freeze({ breakdown, valid, displayCryptoAmount, usdtPayAmount, cryptoAmountsEqual });
    if (typeof module === 'object' && module.exports) module.exports = api;
    else scope.TgPaymentPricing = api;
})(typeof window === 'object' ? window : globalThis);
