'use strict';

import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const {
    createStripePaymentMethod,
    syncCheckoutBillingTax,
    getDefaultPlanDisplayAmount,
    executeWithProxyRetry,
    paymentResultUnknown
} = require('../stripe-protocol-payment');

describe('Stripe pure protocol payment integration', () => {
    it('rejects unregistered device fingerprints before any PaymentMethod request', async () => {
        const card = { number: '4000000000008043', expiry: '05/29', cvc: '123' };
        const billing = { name: 'John Doe', country: 'US', line1: '100 Main St', city: 'Portland', state: 'Oregon', postal_code: '97201' };

        await expect(createStripePaymentMethod(card, billing, {
            fingerprint: {
                guid: 'guid_local',
                muid: 'muid_local',
                sid: 'sid_local',
                source: 'local_fallback'
            }
        })).rejects.toMatchObject({
            code: 'STRIPE_DEVICE_FINGERPRINT_UNAVAILABLE'
        });
    });

    it('keeps the full attempt correlation without retaining the raw confirmation token', () => {
        const result = paymentResultUnknown({
            attemptId: 'attempt_test',
            sessionId: 'cs_test_session',
            paymentIntentId: 'pi_test_intent',
            paymentMethodId: 'pm_test_method',
            confirmationTokenHash: 'sha256:test-hash',
            error: 'offline test result',
            submitted: true
        });

        expect(result).toMatchObject({
            attemptId: 'attempt_test',
            sessionId: 'cs_test_session',
            paymentIntentId: 'pi_test_intent',
            paymentMethodId: 'pm_test_method',
            confirmationTokenHash: 'sha256:test-hash',
            code: 'PAYMENT_RESULT_UNKNOWN',
            submitted: true,
            manualIntervention: true
        });
        expect(result.confirmationToken).toBeUndefined();
    });

    it('syncCheckoutBillingTax coordinates /taxes and /update_tax_id for Oregon tax-free billing', async () => {
        const mockPage = {
            isClosed: () => false,
            evaluate: vi.fn().mockImplementation(async (fn, args) => {
                expect(args.taxUrl).toContain('/backend-api/payments/checkout/taxes');
                expect(args.updateTaxIdUrl).toContain('/backend-api/payments/checkout/update_tax_id');
                expect(args.updateBodyObj).toEqual({
                    checkout_session_id: 'oaics_tax_sync_test',
                    tax_id_info: null
                });
                return {
                    tax: {
                        status: 200,
                        ok: true,
                        data: {
                            checkout_session: {
                                amount_total: 98214,
                                total_details: { amount_tax: 0 }
                            }
                        }
                    },
                    update: {
                        status: 200,
                        ok: true,
                        data: {}
                    }
                };
            })
        };

        const taxRes = await syncCheckoutBillingTax({
            page: mockPage,
            sessionId: 'oaics_tax_sync_test',
            billing: { country: 'US', state: 'Oregon', postal_code: '97123' },
            currency: 'PHP',
            targetHeaders: { authorization: 'Bearer test' },
            protocolOnly: false
        });

        expect(mockPage.evaluate).toHaveBeenCalledTimes(1);
        expect(taxRes.ok).toBe(true);
        expect(taxRes.taxAmount).toBe(0);
        expect(taxRes.amountTotal).toBe(98214);
    });

    it('executeWithProxyRetry automatically rotates proxy SID upon transient socket/TLS failure', async () => {
        let attempts = 0;
        const initialProxy = 'http://user-region-ph-sid-old123:pass@gateway.proxy.com:3010';
        const recordedProxies = [];

        const result = await executeWithProxyRetry(async (_client, currentProxy) => {
            attempts++;
            recordedProxies.push(currentProxy);
            if (attempts === 1) {
                const err = new Error('Client network socket disconnected before secure TLS connection was established');
                err.code = 'ECONNRESET';
                throw err;
            }
            return { ok: true, attempts, proxy: currentProxy };
        }, {
            proxy: initialProxy,
            maxRetries: 3
        });

        expect(result.ok).toBe(true);
        expect(attempts).toBe(2);
        expect(recordedProxies[0]).toBe(initialProxy);
        expect(recordedProxies[1]).not.toBe(initialProxy);
        expect(recordedProxies[1]).toContain('-sid-');
    });

    it('calibrates default and fallback amounts accurately across all ChatGPT plan types (Go, Plus, Pro 100/200/500, Team)', () => {
        // PHP Tax-Free (Oregon)
        expect(getDefaultPlanDisplayAmount('go', 'PHP', true)).toBe(267.86);
        expect(getDefaultPlanDisplayAmount('plus', 'PHP', true)).toBe(982.14);
        expect(getDefaultPlanDisplayAmount('pro_100', 'PHP', true)).toBe(5794.64);
        expect(getDefaultPlanDisplayAmount('chatgptprolite', 'PHP', true)).toBe(5794.64);
        expect(getDefaultPlanDisplayAmount('pro_200', 'PHP', true)).toBe(8919.64);
        expect(getDefaultPlanDisplayAmount('chatgptpro', 'PHP', true)).toBe(8919.64);
        expect(getDefaultPlanDisplayAmount('pro_500', 'PHP', true)).toBe(29008.93);
        expect(getDefaultPlanDisplayAmount('chatgptpromax', 'PHP', true)).toBe(29008.93);
        expect(getDefaultPlanDisplayAmount('team_2', 'PHP', true)).toBe(2900);
        expect(getDefaultPlanDisplayAmount('team_5', 'PHP', true)).toBe(7250);

        // USD
        expect(getDefaultPlanDisplayAmount('go', 'USD', true)).toBe(8);
        expect(getDefaultPlanDisplayAmount('plus', 'USD', true)).toBe(20);
        expect(getDefaultPlanDisplayAmount('pro_100', 'USD', true)).toBe(100);
        expect(getDefaultPlanDisplayAmount('pro_200', 'USD', true)).toBe(200);
        expect(getDefaultPlanDisplayAmount('pro_500', 'USD', true)).toBe(500);
        expect(getDefaultPlanDisplayAmount('team_2', 'USD', true)).toBe(60);
        expect(getDefaultPlanDisplayAmount('team_5', 'USD', true)).toBe(150);
    });
});


describe('round7 actual protocol entrypoint persistence gate', () => {
    it.each(['cs_test_offline_hold', 'oaics_offline_hold'])('propagates hold failure with zero network/browser work (%s)', async sessionId => {
        const network = vi.fn(() => { throw new Error('unexpected offline network request'); });
        const page = { evaluate: network, goto: network, request: { post: network, get: network } };
        const runtimeRequire = createRequire(new URL('../stripe-protocol-payment.js', import.meta.url));
        const module = { exports: {} };
        vm.runInNewContext(fs.readFileSync(new URL('../stripe-protocol-payment.js', import.meta.url), 'utf8'), {
            module, exports: module.exports, process: { env: {} }, Buffer, URL, URLSearchParams,
            console: { log() {}, warn() {}, error() {} },
            setTimeout: network,
            require: name => {
                if (name === 'axios') return { create: network, get: network, post: network, request: network };
                if (name === './sentinel/sentinel-client') return { mintSentinelToken: network };
                if (name === './stripe-device-fingerprint') return { registerStripeDeviceFingerprint: network };
                if (name === './playwright-proxy') return { substituteProxySession: network, resetActiveProxyTunnels: network };
                return runtimeRequire(name);
            }
        });
        const failure = Object.assign(new Error('offline durable hold persistence failed'), { code: 'CARD_PAYMENT_HOLD_FAILED' });
        const gate = vi.fn(async () => { throw failure; });
        await expect(module.exports.executeStripeProtocolPayment({
            page, card: { number: 'offline-card-fixture', expiry: '01/30', cvc: '000' },
            sessionId, accessToken: 'offline-fixture', onPaymentAttemptStarted: gate, protocolOnly: false
        })).rejects.toBe(failure);
        expect(gate).toHaveBeenCalledOnce();
        expect(network).not.toHaveBeenCalled();
    });
});
