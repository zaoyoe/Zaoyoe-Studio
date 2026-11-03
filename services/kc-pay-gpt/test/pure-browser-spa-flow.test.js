'use strict';

const { shouldFallbackToPricingCheckout } = require('../chatgpt');

describe('ChatGPT execution mode resolution & fallback guard', () => {
    function resolveExecutionModes({ checkoutMode = 'auto', fastProtocolEnv = '1', platform = 'chatgpt', debugOnly = false }) {
        const mode = String(checkoutMode || 'auto').trim().toLowerCase();
        const fastEnv = String(fastProtocolEnv ?? '').trim().toLowerCase();
        const fastProtocolExplicitlyDisabled = fastEnv === 'false' || fastEnv === '0';
        const protocolCheckoutRequested = platform === 'chatgpt'
            && !debugOnly
            && mode !== 'ui'
            && mode !== 'browser'
            && mode !== 'spa';
        const protocolOnlyMode = protocolCheckoutRequested
            && mode !== 'hybrid'
            && !fastProtocolExplicitlyDisabled;
        const canUseProtocolCheckout = protocolCheckoutRequested;

        return {
            protocolCheckoutRequested,
            protocolOnlyMode,
            canUseProtocolCheckout
        };
    }

    it('enables Fast Hybrid mode (API Checkout + Browser Payment) when FAST_PROTOCOL_ENABLED=0 under default auto mode', () => {
        const modes = resolveExecutionModes({ checkoutMode: 'auto', fastProtocolEnv: '0' });
        expect(modes.protocolCheckoutRequested).toBe(true);
        expect(modes.protocolOnlyMode).toBe(false);
        expect(modes.canUseProtocolCheckout).toBe(true);
    });

    it('bypasses API Checkout when explicitly requested via CHECKOUT_MODE=ui, browser, or spa', () => {
        for (const mode of ['browser', 'spa', 'ui']) {
            const modes = resolveExecutionModes({ checkoutMode: mode, fastProtocolEnv: '1' });
            expect(modes.protocolCheckoutRequested).toBe(false);
            expect(modes.protocolOnlyMode).toBe(false);
            expect(modes.canUseProtocolCheckout).toBe(false);
        }
    });

    it('preserves protocol-only mode when FAST_PROTOCOL_ENABLED=1 and auto mode is active', () => {
        const modes = resolveExecutionModes({ checkoutMode: 'auto', fastProtocolEnv: '1' });
        expect(modes.protocolCheckoutRequested).toBe(true);
        expect(modes.protocolOnlyMode).toBe(true);
        expect(modes.canUseProtocolCheckout).toBe(true);
    });

    it('preserves hybrid mode when explicitly configured with checkoutMode=hybrid', () => {
        const modes = resolveExecutionModes({ checkoutMode: 'hybrid', fastProtocolEnv: '1' });
        expect(modes.protocolCheckoutRequested).toBe(true);
        expect(modes.protocolOnlyMode).toBe(false);
        expect(modes.canUseProtocolCheckout).toBe(true);
    });

    it('allows fallback to pricing checkout for browser and spa modes on recoverable errors', () => {
        const recoverableError = Object.assign(new Error('Checkout API temporary failure'), { code: 'CHECKOUT_HTTP_ERROR' });
        expect(shouldFallbackToPricingCheckout(recoverableError, { checkoutMode: 'browser' })).toBe(true);
        expect(shouldFallbackToPricingCheckout(recoverableError, { checkoutMode: 'spa' })).toBe(true);
    });

    it('blocks fallback when error indicates unusual activity or auth expired across all modes', () => {
        const unusualError = Object.assign(new Error('unusual activity'), { code: 'CHECKOUT_UNUSUAL_ACTIVITY' });
        const authError = Object.assign(new Error('token expired'), { code: 'CHATGPT_SESSION_EXPIRED' });

        for (const mode of ['browser', 'spa', 'auto', 'hybrid']) {
            expect(shouldFallbackToPricingCheckout(unusualError, { checkoutMode: mode })).toBe(false);
            expect(shouldFallbackToPricingCheckout(authError, { checkoutMode: mode })).toBe(false);
        }
    });
});
