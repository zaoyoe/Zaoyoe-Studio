const test = require('node:test');
const assert = require('node:assert/strict');

const {
    buildSiteScopedSystemConfigEnvelope,
    resolveSiteScopedSystemConfigForRead,
    resolveSiteScopedSystemConfigRequestSite,
    resolveSiteScopedSystemConfigValue,
    upsertSiteScopedSystemConfigValue
} = require('../server/api-handlers/_site-scoped-system-config');

test('site-scoped system config resolves per-site override with legacy default fallback', () => {
    const wrapped = buildSiteScopedSystemConfigEnvelope({
        commission_rate_shop: 0.1
    });
    wrapped.sites.intl = {
        commission_rate_shop: 0.2
    };

    assert.deepEqual(resolveSiteScopedSystemConfigForRead('affiliate_program', wrapped, 'all'), {
        commission_rate_shop: 0.1
    });
    assert.deepEqual(resolveSiteScopedSystemConfigValue(wrapped, 'cn'), {
        commission_rate_shop: 0.1
    });
    assert.deepEqual(resolveSiteScopedSystemConfigValue(wrapped, 'intl'), {
        commission_rate_shop: 0.2
    });
});

test('site-scoped upsert preserves legacy default while writing a site override', () => {
    const stored = upsertSiteScopedSystemConfigValue({
        active_provider: 'afdian'
    }, 'intl', {
        active_provider: 'nowpayments'
    });

    assert.equal(stored.__site_scoped, true);
    assert.deepEqual(stored.default, {
        active_provider: 'afdian'
    });
    assert.deepEqual(stored.sites.intl, {
        active_provider: 'nowpayments'
    });
    assert.deepEqual(resolveSiteScopedSystemConfigForRead('payment_channels', stored, 'cn'), {
        active_provider: 'afdian'
    });
    assert.deepEqual(resolveSiteScopedSystemConfigForRead('payment_channels', stored, 'intl'), {
        active_provider: 'nowpayments'
    });
});

test('site-scoped request site prefers explicit query site and falls back to host detection', () => {
    const explicitUrl = new URL('https://example.com/api/public?scope=config&route=site-system-config&site=intl');
    const explicitSite = resolveSiteScopedSystemConfigRequestSite({
        headers: {
            host: 'www.zaoyoe.com'
        }
    }, explicitUrl, { fallback: 'cn' });
    assert.equal(explicitSite, 'intl');

    const hostUrl = new URL('https://example.com/api/public?scope=config&route=site-system-config');
    const hostSite = resolveSiteScopedSystemConfigRequestSite({
        headers: {
            host: 'www.zaoyoe.xyz'
        }
    }, hostUrl, { fallback: 'cn' });
    assert.equal(hostSite, 'intl');
});
