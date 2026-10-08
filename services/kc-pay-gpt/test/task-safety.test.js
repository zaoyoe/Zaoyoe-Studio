import { describe, expect, it } from 'vitest';
import {
    classifyPaymentResult,
    shouldRetainCdk,
    classifyAutoRenewCancellation,
    classifyInterruptedTask,
    mergePaymentState
} from '../task-safety.js';

describe('payment and recovery safety decisions', () => {
    it('keeps unknown, in-flight, and succeeded local payments reserved', () => {
        for (const paymentState of ['started', 'unknown', 'succeeded']) {
            expect(shouldRetainCdk({ executionMode: 'local_card_pool', paymentState })).toBe(true);
        }
    });

    it('releases local CDKs only when payment never started or was explicitly declined', () => {
        expect(shouldRetainCdk({ executionMode: 'local_card_pool', paymentState: 'not_started' })).toBe(false);
        expect(shouldRetainCdk({ executionMode: 'local_card_pool', paymentState: 'declined' })).toBe(false);
        expect(shouldRetainCdk({ executionMode: 'local_card_pool', paymentState: 'legacy' })).toBe(true);
    });

    it('classifies submission results conservatively', () => {
        expect(classifyPaymentResult({ success: true, submitted: true })).toBe('succeeded');
        expect(classifyPaymentResult({ declined: true, submitted: true })).toBe('declined');
        expect(classifyPaymentResult({ submitted: false, previousState: 'declined' })).toBe('declined');
        expect(classifyPaymentResult({ submitted: false })).toBe('not_started');
        expect(classifyPaymentResult({ submitted: true })).toBe('unknown');
    });

    it('never allows payment state to move backwards', () => {
        expect(mergePaymentState('started', 'not_started')).toBe('started');
        expect(mergePaymentState('unknown', 'declined')).toBe('unknown');
        expect(mergePaymentState('succeeded', 'failed')).toBe('succeeded');
        expect(mergePaymentState('not_started', 'started')).toBe('started');
        expect(mergePaymentState('started', 'unknown')).toBe('unknown');
    });

    it('holds interrupted third-party and legacy tasks for review', () => {
        expect(classifyInterruptedTask({ execution_mode: 'third_party_api', payment_state: 'not_started' })).toMatchObject({ status: 'manual', retainCdk: true });
        expect(classifyInterruptedTask({ payment_state: 'not_started' })).toMatchObject({ status: 'manual', retainCdk: true });
        expect(classifyInterruptedTask({ execution_mode: 'local_card_pool', payment_state: 'unknown' })).toMatchObject({ status: 'manual', retainCdk: true, retainCardLocks: true });
        expect(classifyInterruptedTask({ execution_mode: 'local_card_pool', payment_state: 'declined' })).toMatchObject({ status: 'failed', retainCdk: false });
    });
});

describe('automatic renewal cancellation state', () => {
    it('reports disabled only when the provider state is confirmed off', () => {
        expect(classifyAutoRenewCancellation({ ok: true, data: { autoRenewRaw: false } })).toBe('already_disabled');
        expect(classifyAutoRenewCancellation({ ok: true, data: { alreadyCancelled: true } })).toBe('already_disabled');
        expect(classifyAutoRenewCancellation({ ok: true, data: { cancelled: true, verificationUnknown: true } })).toBe('verification_unknown');
        expect(classifyAutoRenewCancellation({ ok: false })).toBe('verification_unknown');
    });
});
