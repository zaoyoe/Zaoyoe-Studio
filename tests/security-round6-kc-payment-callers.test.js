'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const kcRoot = path.resolve(__dirname, '../services/kc-pay-gpt');
const syntheticCdk = 'OFFLINE-REDEEM-CODE-NOT-A-LOCK-OWNER-'.repeat(3);
const cases = [
    ['normal task', 'job_123-ABC'],
    ['missing task', undefined],
    ['empty task', ''],
    ['invalid task remains invalid', 'invalid task'],
    ['oversized task remains invalid', 'X'.repeat(49)]
];

function loadChatGpt(jobKey) {
    const calls = [];
    const module = { exports: {} };
    const dependencies = {
        axios: {},
        './mysql-store': { getPaymentRegion: async () => 'US' },
        './region-config': { getRegionConfig: () => ({ currency: 'USD' }) },
        './payment-retry': { executePaymentWithRetry: async (page, options) => {
            calls.push({ page, options });
            return { success: true };
        } },
        './checkout-diagnostics': {},
        './chatgpt-auth-state': {}
    };
    vm.runInNewContext(readFileSync(path.join(kcRoot, 'chatgpt.js'), 'utf8'), {
        module, exports: module.exports,
        process: { env: jobKey === undefined ? {} : { JOB_KEY: jobKey } },
        console: { log() {}, warn() {}, error() {} },
        require(name) {
            assert.ok(Object.hasOwn(dependencies, name), 'unexpected runtime dependency');
            return dependencies[name];
        }
    });
    module.exports.prototype.createCheckoutSession = async () => ({
        checkoutUrl: 'https://checkout.invalid/offline-fixture', sessionId: 'offline-session'
    });
    return { api: module.exports, calls };
}

for (const [label, jobKey] of cases) {
    for (const caller of ['processStripePayment', 'activateSubscription']) {
        test(`KC payment caller ${caller}: ${label}`, async () => {
            const { api, calls } = loadChatGpt(jobKey);
            const page = {
                context: () => ({ request: {} }),
                goto: async () => {},
                waitForLoadState: async () => {}
            };
            if (caller === 'processStripePayment') {
                await new api({}, 'offline-placeholder').processStripePayment(page, {
                    planType: 'plus', cdkCode: syntheticCdk, email: 'fixture@example.invalid'
                });
            } else {
                await api.activateSubscription({ page, accessToken: 'offline-placeholder',
                    planType: 'plus', cdkCode: syntheticCdk, email: 'fixture@example.invalid' });
            }
            assert.equal(calls.length, 1);
            assert.equal(calls[0].page, page);
            assert.equal(calls[0].options.ownerKey, jobKey || undefined);
            assert.equal(calls[0].options.cdkCode, syntheticCdk,
                'redemption identity must remain separate from the lock owner');
        });
    }

    test(`KC CLI owner declaration contract: ${label}`, () => {
        // Only the owner expression is executed. This is not a full CLI/browser run.
        const source = readFileSync(path.join(kcRoot, 'index.js'), 'utf8');
        const declarations = [...source.matchAll(/\bconst ownerKey = ([^;]+);/g)];
        assert.equal(declarations.length, 1);
        const owner = vm.runInNewContext(declarations[0][1], {
            process: { env: jobKey === undefined ? {} : { JOB_KEY: jobKey } },
            cdkCode: syntheticCdk
        });
        assert.equal(owner, jobKey || undefined);
        assert.match(source, /executePaymentWithRetry\([\s\S]*?\bownerKey,/,
            'the declared owner must reach the payment module');
    });
}
