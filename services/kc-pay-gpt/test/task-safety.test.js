import { describe, expect, it } from 'vitest';
import {
    classifyPaymentResult,
    shouldRetainCdk,
    classifyAutoRenewCancellation,
    classifyInterruptedTask,
    mergePaymentState,
    classifyCheckoutFailure,
    classifyOpenAiCardMethodFailure,
    classifyGrokFailure
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

        expect(classifyPaymentResult({ submitted: true, captchaRequired: true })).toBe('unknown');
        expect(classifyPaymentResult({ submitted: true, error: '安全验证未完成，因此您的购买未成功。您可以重试。' })).toBe('unknown');
        expect(classifyPaymentResult({ submissionAttempted: true, previousState: 'started', error: '触发 Cloudflare/hCaptcha 人机验证' })).toBe('unknown');
        expect(classifyPaymentResult({ submissionAttempted: true, previousState: 'started', error: 'form_validation_failed' })).toBe('unknown');
    });

    it.each(['验证码未完成', 'timeout', 'page closed', 'form_validation_failed'])('preserves prior submission after %s', error => {
        expect(classifyPaymentResult({ submitted: false, submissionAttempted: false, previousState: 'started', error })).toBe('unknown');
        expect(classifyPaymentResult({ submitted: false, previousState: 'unknown', captchaRequired: true, error })).toBe('unknown');
        expect(classifyPaymentResult({ submitted: false, previousState: 'not_started', captchaRequired: true, error })).toBe('not_started');
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

describe('OpenAI Card method failures are not proxy failures or card declines', () => {
    it.each(['METHOD_AMBIGUOUS', 'METHOD_NOT_FOUND', 'METHOD_NOT_SELECTED', 'METHOD_CHANGED', 'FIELDS_CHANGED', 'FIELDS_NOT_READY', 'FIELDS_INCOMPLETE'])('stops %s before payment without asset deletion or proxy retry', suffix => {
        const message = `收银台无法确认信用卡付款方式 [OPENAI_CARD_${suffix}]`;
        expect(classifyOpenAiCardMethodFailure(message, 'not_started')).toEqual({ status: 'manual', message,
            reachedPayment: false, shouldRetry: false, deletePhone: false, deleteCard: false, paymentState: 'not_started' });
    });
    it.each(['started', 'unknown', 'succeeded', 'declined'])('cannot reset prior payment activity %s', state => {
        expect(classifyOpenAiCardMethodFailure('收银台付款方式改变 [OPENAI_CARD_METHOD_CHANGED]', state)).toBeNull();
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


describe('checkout failures before payment submission', () => {
    it('does not retry or destroy resources for an unconfirmed Grok checkout scope', () => {
        const message = '本次官方结账会话的个人归属无法确认 [GROK_CHECKOUT_SCOPE_UNCONFIRMED]';
        expect(classifyGrokFailure(message, 'not_started')).toMatchObject({
            status: 'failed', shouldRetry: false, reachedPayment: false,
            deletePhone: false, deleteCard: false, paymentState: 'not_started'
        });
        expect(classifyGrokFailure(message, 'started')).toBeNull();
        expect(shouldRetainCdk({ executionMode: 'local_card_pool', paymentState: 'unknown' })).toBe(true);
    });
    const codes = ['HTTP_ERROR', 'UNUSUAL_ACTIVITY', 'NETWORK_ERROR', 'NO_REQUEST', 'REQUEST_PENDING', 'NAVIGATION_TIMEOUT', 'AUTH_REQUIRED', 'PAGE_ERROR', 'PAGE_CLOSED'];
    it.each(codes)('classifies CHECKOUT_%s as not submitted without destroying payment resources', code => {
        const message = `Checkout 创建失败 [CHECKOUT_${code}]`;
        expect(classifyCheckoutFailure(message, 'not_started')).toEqual({
            status: 'failed', message, reachedPayment: false, shouldRetry: false,
            deletePhone: false, deleteCard: false, paymentState: 'not_started'
        });
        expect(classifyCheckoutFailure(message, null)).toMatchObject({ paymentState: 'not_started' });
    });

    it.each(['started', 'unknown', 'succeeded', 'STARTED', 'legacy_invalid'])('never overrides payment state %s', state => {
        expect(classifyCheckoutFailure('HTTP 400 [CHECKOUT_HTTP_ERROR]', state)).toBeNull();
    });

    it.each(['普通错误', 'card declined [STRIPE_CARD_DECLINED]', '[CHECKOUT_HTTP_ERROR] extra text', '[CHECKOUT_INVALID_CODE]'])('requires a recognized trailing creation-error code', message => {
        expect(classifyCheckoutFailure(message, 'not_started')).toBeNull();
    });
});
