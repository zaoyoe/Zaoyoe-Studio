const test = require('node:test');
const assert = require('node:assert/strict');

const {
    clearNewApiQuotaPerUnitCache,
    fetchNewApiTokenUsageRecord
} = require('../server/api-handlers/_newapi-billing');

function jsonResponse(payload, { status = 200, headers = {} } = {}) {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: {
            get(name = '') {
                return headers[String(name).toLowerCase()] || '';
            }
        },
        json: async () => payload
    };
}

test('NewAPI billing reads the exact X-OneAPI request log and converts quota to USD', async () => {
    clearNewApiQuotaPerUnitCache();
    const requests = [];
    const result = await fetchNewApiTokenUsageRecord({
        baseUrl: 'https://new.fatherkey.com/v1',
        apiKey: 'sk-newapi-test',
        response: jsonResponse({}, {
            headers: { 'x-oneapi-request-id': 'newapi-request-159' }
        }),
        env: {
            AI_IMAGE_NEWAPI_BILLING_LOOKUP_ATTEMPTS: '1',
            AI_IMAGE_NEWAPI_BILLING_LOOKUP_INTERVAL_MS: '0'
        },
        fetchImpl: async (url, options = {}) => {
            requests.push({ url: String(url), headers: options.headers || {} });
            if (String(url).endsWith('/api/log/token')) {
                return jsonResponse({
                    success: true,
                    data: [
                        { type: 2, request_id: 'unrelated-request', quota: 999999 },
                        { type: 2, request_id: 'newapi-request-159', quota: 159 }
                    ]
                });
            }
            if (String(url).endsWith('/api/status')) {
                return jsonResponse({
                    success: true,
                    data: { quota_per_unit: 500000 }
                });
            }
            throw new Error(`Unexpected NewAPI URL: ${url}`);
        },
        returnLookupResult: true
    });

    assert.equal(result.status, 'found');
    assert.equal(result.record.gateway, 'newapi');
    assert.equal(result.record.request_id, 'newapi-request-159');
    assert.equal(result.record.quota, 159);
    assert.equal(result.record.actual_cost, 0.000318);
    assert.equal(requests[0].url, 'https://new.fatherkey.com/api/log/token');
    assert.equal(requests[0].headers.Authorization, 'Bearer sk-newapi-test');
    assert.equal(requests[1].url, 'https://new.fatherkey.com/api/status');
});

test('NewAPI billing does not substitute another token log or settle an unresolved request', async () => {
    clearNewApiQuotaPerUnitCache();
    const result = await fetchNewApiTokenUsageRecord({
        baseUrl: 'https://new.fatherkey.com/v1',
        apiKey: 'sk-newapi-test',
        response: jsonResponse({}, {
            headers: { 'x-oneapi-request-id': 'missing-request-id' }
        }),
        env: {
            AI_IMAGE_NEWAPI_BILLING_LOOKUP_ATTEMPTS: '1',
            AI_IMAGE_NEWAPI_BILLING_LOOKUP_INTERVAL_MS: '0'
        },
        fetchImpl: async (url) => {
            assert.equal(String(url), 'https://new.fatherkey.com/api/log/token');
            return jsonResponse({
                success: true,
                data: [{ type: 2, request_id: 'different-request-id', quota: 5000 }]
            });
        },
        returnLookupResult: true
    });

    assert.equal(result.status, 'not_found');
    assert.equal(result.record, null);
});

test('NewAPI billing keeps an application-level log error pending instead of treating it as a missing charge', async () => {
    clearNewApiQuotaPerUnitCache();
    const result = await fetchNewApiTokenUsageRecord({
        baseUrl: 'https://new.fatherkey.com/v1',
        apiKey: 'sk-newapi-test',
        response: jsonResponse({}, {
            headers: { 'x-oneapi-request-id': 'newapi-log-api-error' }
        }),
        env: {
            AI_IMAGE_NEWAPI_BILLING_LOOKUP_ATTEMPTS: '1',
            AI_IMAGE_NEWAPI_BILLING_LOOKUP_INTERVAL_MS: '0'
        },
        fetchImpl: async () => jsonResponse({
            success: false,
            message: 'temporary log store failure'
        }),
        returnLookupResult: true
    });

    assert.equal(result.status, 'unavailable');
    assert.equal(result.record, null);
});

test('NewAPI billing keeps an explicit zero-quota usage record as a free request', async () => {
    clearNewApiQuotaPerUnitCache();
    const result = await fetchNewApiTokenUsageRecord({
        baseUrl: 'https://new.fatherkey.com/v1',
        apiKey: 'sk-newapi-test',
        response: jsonResponse({}, {
            headers: { 'x-oneapi-request-id': 'free-request-id' }
        }),
        env: {
            AI_IMAGE_NEWAPI_BILLING_LOOKUP_ATTEMPTS: '1',
            AI_IMAGE_NEWAPI_BILLING_LOOKUP_INTERVAL_MS: '0'
        },
        fetchImpl: async (url) => {
            if (String(url).endsWith('/api/log/token')) {
                return jsonResponse({
                    success: true,
                    data: [{ type: 2, request_id: 'free-request-id', quota: 0 }]
                });
            }
            return jsonResponse({ success: true, data: { quota_per_unit: 500000 } });
        },
        returnLookupResult: true
    });

    assert.equal(result.status, 'found');
    assert.equal(result.record.actual_cost, 0);
});

test('NewAPI billing never settles a multi-request task with an untracked request', async () => {
    clearNewApiQuotaPerUnitCache();
    let fetchCount = 0;
    const result = await fetchNewApiTokenUsageRecord({
        baseUrl: 'https://new.fatherkey.com/v1',
        apiKey: 'sk-newapi-test',
        payload: {
            newapi: {
                records: [
                    { request_id: 'newapi-tracked-request', actual_cost: 0.001 },
                    { lookup_status: 'no_request_id', billing_status: 'pricing_pending' }
                ]
            }
        },
        fetchImpl: async () => {
            fetchCount += 1;
            throw new Error('billing lookup must not run without every request ID');
        },
        returnLookupResult: true
    });

    assert.equal(result.status, 'no_request_id');
    assert.equal(result.record, null);
    assert.deepEqual(result.requestIds, ['newapi-tracked-request']);
    assert.equal(fetchCount, 0);
});

test('NewAPI billing aggregates only when every persisted request ID has an exact log', async () => {
    clearNewApiQuotaPerUnitCache();
    let logLookupCount = 0;
    const result = await fetchNewApiTokenUsageRecord({
        baseUrl: 'https://new.fatherkey.com/v1',
        apiKey: 'sk-newapi-test',
        payload: {
            newapi: {
                records: [
                    { request_id: 'newapi-multi-1' },
                    { request_id: 'newapi-multi-2' }
                ]
            }
        },
        env: {
            AI_IMAGE_NEWAPI_BILLING_LOOKUP_ATTEMPTS: '2',
            AI_IMAGE_NEWAPI_BILLING_LOOKUP_INTERVAL_MS: '0'
        },
        fetchImpl: async (url) => {
            if (String(url).endsWith('/api/log/token')) {
                logLookupCount += 1;
                return jsonResponse({
                    success: true,
                    data: logLookupCount === 1
                        ? [{ type: 2, request_id: 'newapi-multi-1', quota: 159 }]
                        : [
                            { type: 2, request_id: 'newapi-multi-1', quota: 159 },
                            { type: 2, request_id: 'newapi-multi-2', quota: 341 }
                        ]
                });
            }
            return jsonResponse({ success: true, data: { quota_per_unit: 500000 } });
        },
        returnLookupResult: true
    });

    assert.equal(result.status, 'found');
    assert.equal(result.record.actual_cost, 0.001);
    assert.equal(result.record.quota, 500);
    assert.deepEqual(result.record.request_ids, ['newapi-multi-1', 'newapi-multi-2']);
    assert.equal(result.record.records.length, 2);
    assert.equal(logLookupCount, 2);
});
