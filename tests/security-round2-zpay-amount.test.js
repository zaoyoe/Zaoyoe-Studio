'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { zpayAmountCents, zpayAmountsMatch } = require('../api/_lib/payments/zpay-amount');

for (const [name, value, cents] of [
    ['minimum cent string', '0.01', 1],
    ['minimum cent number', 0.01, 1],
    ['ordinary decimal string', '12.34', 1234],
    ['ordinary decimal number', 12.34, 1234],
    ['binary multiplication residue', 1.01, 101],
    ['whole units', '12', 1200],
    ['one decimal place', '12.3', 1230],
    ['leading zeros and outer whitespace', ' 00012.30 ', 1230],
    ['extremely long leading zeros', '0'.repeat(1000) + '1.01', 101],
    ['exact large decimal', '90071992547409.90', 9007199254740990],
    ['large decimal lost by numeric forwarding', '90071992547409.91', null],
    ['unsafe cents', '90071992547409.92', null],
    ['oversized integer', '9'.repeat(1000), null],
    ['zero number', 0, null],
    ['zero string', '0.00', null],
    ['sub-cent positive number', 1e-10, null],
    ['sub-cent string', '0.001', null],
    ['extra decimal precision', '12.3401', null],
    ['extra number precision', 12.3401, null],
    ['arithmetic residue fails closed', 0.1 + 0.2, null],
    ['scientific string', '1e2', null],
    ['negative amount', '-0.01', null],
    ['boolean', true, null],
    ['missing amount', null, null],
    ['non-finite amount', Infinity, null],
    ['not-a-number', NaN, null],
]) {
    test(`zpay exact amount: ${name}`, () => assert.equal(zpayAmountCents(value), cents));
}

test('zpay compares cents without collapsing adjacent large amounts', () => {
    assert.equal(zpayAmountsMatch('90071992547409.90', '90071992547409.91'), false);
    assert.equal(zpayAmountsMatch('12.34', 12.34), true);
    assert.equal(zpayAmountsMatch(1e-10, 1e-10), false);
});

test('every accepted string survives the adapter numeric amount representation', () => {
    for (const text of ['0.01', '1.01', '12.34', '90071992547409.89', '90071992547409.90', '90071992547409.91']) {
        const cents = zpayAmountCents(text);
        if (cents !== null) assert.equal(zpayAmountCents(cents / 100), cents, text);
    }
});
