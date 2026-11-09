'use strict';

const MAX_SAFE_CENTS = BigInt(Number.MAX_SAFE_INTEGER);

function decimalCents(text) {
    const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text);
    if (!match) return null;
    const units = match[1].replace(/^0+(?=\d)/, '');
    // Bound BigInt parsing even when an upstream sends a very long number.
    if (units.length > 14) return null;
    const cents = BigInt(units) * 100n + BigInt((match[2] || '').padEnd(2, '0'));
    return cents > 0n && cents <= MAX_SAFE_CENTS ? cents : null;
}

// ZPay settles in CNY cents. Parse decimals before any floating-point conversion.
function zpayAmountCents(value) {
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    if (typeof value === 'number' && !Number.isFinite(value)) return null;
    const cents = decimalCents(String(value).trim());
    if (cents === null) return null;
    // The provider adapter exposes paidAmount as a number. Reject an amount if
    // that representation cannot retain its cents; never merge adjacent amounts.
    const numberCents = Number(cents);
    if (decimalCents(String(numberCents / 100)) !== cents) return null;
    return numberCents;
}

function zpayAmountsMatch(expected, actual) {
    const expectedCents = zpayAmountCents(expected);
    return expectedCents !== null && expectedCents === zpayAmountCents(actual);
}

module.exports = { zpayAmountCents, zpayAmountsMatch };
