const test = require('node:test');
const assert = require('node:assert/strict');

const {
    SITE_CANONICAL_ORIGINS,
    classifyManagedSite,
    resolveSiteRequestOrigin,
    rewriteManagedUrlForOrigin
} = require('../api/_lib/payments/site-origins');

test('fatherkey is the canonical cn origin while xyz remains intl', () => {
    assert.equal(SITE_CANONICAL_ORIGINS.cn, 'https://www.fatherkey.com');
    assert.equal(SITE_CANONICAL_ORIGINS.intl, 'https://www.zaoyoe.xyz');
    assert.equal(classifyManagedSite('https://www.fatherkey.com'), 'cn');
    assert.equal(classifyManagedSite('https://verify-api.fatherkey.com'), 'cn');
    assert.equal(classifyManagedSite('https://www.zaoyoe.xyz'), 'intl');
});

test('legacy zaoyoe com still classifies as cn during cutover', () => {
    assert.equal(classifyManagedSite('https://www.zaoyoe.com'), 'cn');
    assert.equal(classifyManagedSite('https://verify-api.zaoyoe.com'), 'cn');
});

test('site origin rewrite keeps cn and intl separated', () => {
    assert.equal(
        resolveSiteRequestOrigin({ site: 'cn', requestHost: 'www.fatherkey.com' }),
        'https://www.fatherkey.com'
    );
    assert.equal(
        resolveSiteRequestOrigin({ site: 'intl', requestHost: 'www.zaoyoe.xyz' }),
        'https://www.zaoyoe.xyz'
    );
    assert.equal(
        rewriteManagedUrlForOrigin(
            'https://www.fatherkey.com/api/payments/nowpayments/webhook',
            'https://www.zaoyoe.xyz',
            '/api/payments/nowpayments/webhook'
        ),
        'https://www.zaoyoe.xyz/api/payments/nowpayments/webhook'
    );
});
