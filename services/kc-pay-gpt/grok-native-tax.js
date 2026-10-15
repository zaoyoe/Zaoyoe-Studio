'use strict';
const { grokError } = require('./grok-checkout-state');
const { assertNativeCheckoutReady } = require('./grok-native-checkout');
const { assertNativeBilling, recommitNativeTaxAddress } = require('./grok-native-billing');

async function waitNativeTaxReady(page, observer, billing, { timeoutMs = 15000 } = {}) {
    const scope = observer.taxRecoveryScope();
    const deadline = Date.now() + timeoutMs;
    let retries = 0;
    const tick = () => page.waitForTimeout(Math.min(120, Math.max(1, deadline - Date.now())));
    do {
        scope.assertCurrent();
        try { return await assertNativeCheckoutReady(page, observer, { final: true }); }
        catch (error) {
            if (error.code === 'GROK_TAX_RETRYABLE') {
                if (retries >= 2 || Date.now() >= deadline) {
                    throw grokError('GROK_TAX_RETRY_EXHAUSTED', '官方税费计算仍未恢复，尚未提交支付');
                }
                const failed = scope.diagnostics();
                // The response can advance while DOM reads are in flight. Only
                // retry the same correlated failure, never a pending/new quote.
                if (failed.state !== 'rpc_error' || !failed.error?.canRetry) continue;
                const backoff = Math.min(deadline, Date.now() + (retries === 0 ? 500 : 1000));
                while (Date.now() < backoff) { scope.assertCurrent(); await tick(); }
                const fresh = scope.diagnostics();
                if (fresh.tracked !== failed.tracked || fresh.state !== 'rpc_error' || !fresh.error?.canRetry) continue;
                if (Date.now() >= deadline) throw error;
                await assertNativeCheckoutReady(page, observer);
                await assertNativeBilling(page, billing);
                scope.assertCurrent();
                // Recheck after asynchronous guards. A new quote supersedes the
                // failed response and must be observed rather than retriggered.
                const current = scope.diagnostics();
                if (current.tracked !== failed.tracked || current.state !== 'rpc_error' || !current.error?.canRetry) continue;
                ++retries;
                console.log(`[Grok/tax] 官方临时税费错误，重新确认同一账单地址 (${retries}/2)，尚未提交支付`);
                await recommitNativeTaxAddress(page, billing, scope.assertCurrent);
                const requestDeadline = Math.min(deadline, Date.now() + 2000);
                while (scope.diagnostics().tracked === failed.tracked && Date.now() < requestDeadline) await tick();
                if (scope.diagnostics().tracked === failed.tracked) {
                    throw grokError('GROK_TAX_RETRY_UNCONFIRMED', '未观测到新的官方税费请求，尚未提交支付');
                }
                continue;
            }
            if (!['GROK_PRICE_UNCONFIRMED', 'GROK_COMMERCE_UNCONFIRMED', 'GROK_ENTRY_AMBIGUOUS'].includes(error.code)
                || Date.now() >= deadline) throw error;
        }
        await tick();
    } while (Date.now() < deadline);
    scope.assertCurrent();
    return assertNativeCheckoutReady(page, observer, { final: true });
}
module.exports = { waitNativeTaxReady };
