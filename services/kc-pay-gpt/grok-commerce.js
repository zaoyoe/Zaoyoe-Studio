'use strict';

const { decodeRpc, commerceMethod, hasRpcField } = require('./grok-commerce-wire');
const { getGrokPlan, grokError } = require('./grok-checkout-state');

const fail = (message, code = 'GROK_COMMERCE_UNCONFIRMED') => { throw grokError(code, message); };
const clean = value => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
function micros(money) {
    if (money?.currencyCode !== 'USD' || !/^(?:0|[1-9]\d*)$/.test(String(money.unitMicros))) fail('官方金额或币种无法确认');
    const value = Number(money.unitMicros);
    if (!Number.isSafeInteger(value) || value % 10000 !== 0) fail('官方金额精度无法确认');
    return value;
}
function unexpired(timestamp, now = Date.now()) {
    const seconds = Number(timestamp?.seconds), nanos = Number(timestamp?.nanos || 0);
    return Number.isSafeInteger(seconds) && seconds > 0 && Number.isInteger(nanos) && nanos >= 0 && nanos < 1e9
        && seconds * 1000 + nanos / 1e6 > now + 10000;
}
function periodMatches(period, plan) {
    return period?.count === 1 && period.unit === (plan.interval === 'year' ? 'UNIT_YEAR' : 'UNIT_MONTH');
}
function taxAddress(address) {
    return { regionCode: String(address.country || '').toUpperCase(), postalCode: address.postal_code || '',
        administrativeAreaCode: address.state || '', addressLines: [address.line1 || '', address.line2 || ''].filter(Boolean),
        locality: address.city || '' };
}
function addressMatches(a, b) {
    return !!a && !!b && ['regionCode', 'postalCode', 'administrativeAreaCode', 'locality'].every(key => clean(a[key]) === clean(b[key]))
        && (a.addressLines || []).filter(Boolean).map(clean).join('\n') === (b.addressLines || []).filter(Boolean).map(clean).join('\n');
}
function rpcError(data) { return !!(data?.error?.code || data?.error?.message); }
// Official isAddressRefusal/refusedAddressPart semantics, with a strict output
// allowlist. Error messages and unfamiliar codes may contain private values.
function classifyTaxError(detail) {
    const known = ['ADDRESS_INVALID', 'BILLING_COUNTRY_MISMATCH', 'TRANSPORT_FAILURE',
        'AUTHENTICATION_UNAVAILABLE', 'CART_EXPIRED', 'OFFER_REVIEW_REQUIRED'];
    const code = known.includes(detail?.code) ? detail.code : 'UNKNOWN';
    const retriable = detail?.retriable === true;
    const refusal = ['ADDRESS_INVALID', 'BILLING_COUNTRY_MISMATCH'].includes(code);
    let refusedField = code === 'BILLING_COUNTRY_MISMATCH' ? 'regionCode' : null;
    if (code === 'ADDRESS_INVALID' && typeof detail?.message === 'string' && detail.message.length <= 2048) {
        try {
            const fields = { address_line: 'addressLines', administrative_area: 'administrativeAreaCode',
                country: 'regionCode', locality: 'locality', postal_code: 'postalCode' };
            const message = detail.message.startsWith('ADDRESS_INVALID: ') ? detail.message.slice(17) : detail.message;
            const value = JSON.parse(message)?.field;
            if (typeof value === 'string' && Object.hasOwn(fields, value)) refusedField = fields[value];
        } catch (_) { /* never expose unparsed upstream details */ }
    }
    const canRetry = code === 'TRANSPORT_FAILURE' && retriable;
    return { code, category: refusal ? 'address_refused' : canRetry ? 'temporary' : code === 'UNKNOWN' ? 'unknown' : 'terminal',
        retriable, canRetry, refusedField };
}
// Keep diagnostics to an allowlist of field names and known enum labels. Never
// include session tokens, account/team/subscription IDs or timestamp values.
function checkoutRiskSignals(session, cart) {
    const signals = [];
    if (session?.origin?.request?.teamId || session?.request?.teamId) signals.push('session.teamId');
    if (cart?.request?.migratedFrom) signals.push('cartRequest.migratedFrom');
    if (cart?.request?.crossgrade) signals.push('cartRequest.crossgrade');
    if (cart?.data?.planFamilyConflict) signals.push('cart.planFamilyConflict');
    const flavor = cart?.data?.crossgradeFlavor;
    if (flavor && flavor !== 'FLAVOR_UNSPECIFIED') {
        signals.push(`cart.crossgradeFlavor=${['SCHEDULED', 'IMMEDIATE'].includes(flavor) ? flavor : 'UNKNOWN'}`);
    }
    return signals;
}
function checkoutScopeSignals(session, cart) {
    const signals = [];
    const origin = session?.origin;
    if (!origin || origin.token !== session?.data?.checkoutSession?.token || origin.request?.teamId) signals.push('session.origin');
    if (origin?.cartTeamId === undefined || origin.cartTeamId !== (cart?.data?.teamId || '')) signals.push('cart.teamId');
    return signals;
}

// Pure contract validator, independent of DOM advertisements and display-name aliases.
function validateCommerceContract(plan, skuId, session, cart, tax, address, now = Date.now()) {
    if (plan.productFamily !== 'x_subscription' || !skuId || !session || !cart) fail('官方结账会话或购物车尚未就绪');
    if (session.request?.country && session.request.country !== 'US') fail('官方结账会话地区与卡密不一致');
    if (!unexpired(session.data.checkoutSession?.expiresAt, now) || !unexpired(cart.data.expiresAt, now)) fail('官方结账会话或购物车已过期');
    const selection = cart.request.selections;
    if (cart.request.sessionToken !== session.data.checkoutSession?.token) fail('本次购物车不属于当前官方结账会话');
    if (selection?.length !== 1) fail('本次购物车不是单一订阅商品');
    if (selection[0].skuId !== skuId) fail('本次购物车 SKU 与选定套餐不一致');
    // The official non-seat CheckoutProvider omits quantity. Proto3 decodes it
    // as zero; only an absent field may use that official single-SKU default.
    // Team/migration, recurrence, full price and tax gates still apply below.
    const omittedQuantity = !hasRpcField(selection[0], 'quantity')
        && (selection[0].quantity === undefined || selection[0].quantity === 0);
    if (selection[0].quantity !== 1 && !omittedQuantity) fail('本次购物车数量不符合单人订阅要求');
    if (!periodMatches(selection[0].recurrence, plan)) fail('本次购物车计费周期与选定套餐不一致');
    if (cart.request.billingPlatform !== 'BILLING_PLATFORM_STRIPE') fail('本次购物车支付平台与预期不一致');
    if (checkoutRiskSignals(session, cart).length) {
        fail('本次结账涉及团队、迁移或已有订阅变更，请联系客服处理', 'GROK_MIGRATION_REQUIRED');
    }
    // GetCart's teamId is response metadata, not a migration flag. The official
    // adapter ez() omits it from ordinary carts; the checkout path takes its
    // team scope from CreateCheckoutSession instead. Accept that metadata only
    // for an observed personal creation request and the same session token.
    // A read/adopt operation alone cannot establish personal scope.
    if (checkoutScopeSignals(session, cart).length) {
        fail('本次官方结账会话的个人归属无法确认，已停止支付，请联系客服核对', 'GROK_CHECKOUT_SCOPE_UNCONFIRMED');
    }
    const creationRequest = session.origin.request;
    if (creationRequest?.country !== 'US' || !creationRequest.billingPlatforms?.includes('BILLING_PLATFORM_STRIPE')) {
        fail('官方结账会话地区或支付平台与卡密不一致');
    }
    // An effective timestamp alone does not establish migration. Its semantics
    // are not confirmed for ordinary carts, so keep payment blocked separately.
    if (cart.data.effectiveAt) {
        fail('官方购物车返回了尚未确认的订阅生效时间，已停止支付，请联系客服核对', 'GROK_EFFECTIVE_TIME_UNCONFIRMED');
    }
    if (rpcError(session.data) || rpcError(cart.data) || !cart.data.cartId || !cart.data.stripe || !cart.data.catalogVersion) fail('官方购物车未提供完整可用报价');
    const matches = (session.data.skuPricings || []).filter(sku => sku.skuId === skuId
        && !sku.displayOnly && sku.pricing?.details?.billingPlatform === 'BILLING_PLATFORM_STRIPE'
        && sku.pricing.details.country === 'US' && periodMatches(sku.pricing.details.interval, plan));
    if (matches.length !== 1) fail('无法唯一关联当前地区、周期与支付平台的官方 SKU 报价');
    const sku = matches[0], details = sku.pricing.details, standard = plan.amount * 1000000;
    if (sku.displayOnly || sku.relation?.fromSkuId || sku.pricing.skuId !== skuId || sku.pricing.status !== 'PRICING_STATUS_ACTIVE'
        || details.country !== 'US' || !periodMatches(details.interval, plan) || micros(details.amount) !== standard) fail('官方 SKU 标价、地区或计费周期与卡密不一致');
    const segments = cart.data.chargeSchedule?.segments || [];
    if (cart.data.chargeSchedule && (!cart.data.chargeSchedule.startTime || !segments.length)) fail('官方扣款安排不完整');
    let first = standard;
    if (segments.length) {
        if (segments.length > 2 || !segments.every(segment => periodMatches(segment.period, plan))) fail('官方扣款周期无法确认');
        const recurring = segments.at(-1);
        if (recurring.count !== 0 || micros(recurring.amount) !== standard || recurring.benefitId) fail('官方后续续费金额无法确认');
        first = micros(segments[0].amount);
        if (segments.length === 2) {
            const initial = segments[0];
            const benefit = (sku.benefits || []).find(item => item.benefitId === initial.benefitId);
            const discount = benefit?.value?.discount;
            if (!discount || initial.count !== 1 || discount.times !== 1 || first <= 0 || first >= standard
                || benefit.redeemBy && !unexpired(benefit.redeemBy, now)) fail('首期优惠缺少可确认的官方依据');
            const hasPercent = Number(discount.percent) > 0, hasFixed = !!discount.fixedAmount;
            if (hasPercent === hasFixed) fail('首期优惠计算方式无法确认');
            const expected = hasPercent ? standard * (1 - Number(discount.percent) / 100) : standard - micros(discount.fixedAmount);
            if (!Number.isFinite(expected) || Math.abs(expected - first) > 0.1) fail('首期优惠与官方扣款安排不一致');
        }
    }
    const subtotal = micros(cart.data.subtotal), cartTotal = micros(cart.data.total);
    // The initial official cart may omit tax before an address exists. Accept
    // that only as an untaxed preview; final submission still requires EstimateTax.
    const cartTax = cart.data.tax == null && subtotal === cartTotal ? 0 : micros(cart.data.tax);
    if (subtotal !== first || subtotal + cartTax !== cartTotal) fail('购物车首期金额或税费不一致');
    let total = cartTotal, taxMicros = cartTax;
    if (address) {
        if (!tax || tax.request.cartId !== cart.data.cartId || !addressMatches(tax.request.billingAddress, address)) fail('当前账单地址的官方税费尚未确认');
        if (rpcError(tax.data)) {
            const detail = classifyTaxError(tax.data.error);
            if (detail.category === 'address_refused') fail('官方未接受当前账单地址，税费尚未确认，尚未提交支付', 'GROK_TAX_ADDRESS_REFUSED');
            if (detail.canRetry) fail('官方税费计算临时失败，尚未提交支付', 'GROK_TAX_RETRYABLE');
            fail('官方税费计算失败，税费尚未确认，尚未提交支付', 'GROK_TAX_FAILED');
        }
        taxMicros = micros(tax.data.tax); total = micros(tax.data.total);
        if (micros(tax.data.subtotal) !== first || first + taxMicros !== total) fail('地址税费和今日应付金额不一致');
        if ((tax.data.taxLines || []).reduce((sum, line) => sum + micros(line.amount), 0) !== taxMicros) fail('官方税费明细不一致');
    }
    if (total <= 0 || total > standard) fail('本次应付超过套餐标价上限或无法确认，已停止支付');
    return { amount: total / 1000000, currency: 'USD', firstAmount: first / 1000000,
        recurringAmount: plan.amount, interval: plan.interval, tax: taxMicros / 1000000,
        cartId: cart.data.cartId, skuId };
}

function observeGrokCommerce(page, planType) {
    const plan = getGrokPlan(planType);
    if (plan.productFamily !== 'x_subscription') fail('该商品不是新版组合订阅');
    const requests = new Map(), sessionOrigins = new Map();
    let session = null, cart = null, tax = null, skuId = '', address = null, error = null;
    let cartRequest = null, taxRequest = null;
    const taxCounts = { requested: 0, tracked: 0, completed: 0, ignored: 0 };
    let sessionSeq = 0, cartSeq = 0, taxSeq = 0, disposed = false, submission = null, outcome = null;
    let acquisitionPending = false, acquisitionInFlight = false;
    const diagnosedCarts = new WeakSet();
    const pendingStatus = [];
    const current = entry => !disposed && (['CreateCheckoutSession', 'GetCheckoutSession', 'AdoptCheckoutSession'].includes(entry.name)
        ? entry.seq === sessionSeq : entry.name === 'GetCartForSession' ? entry.seq === cartSeq && entry.sessionSeq === sessionSeq
            : entry.name === 'EstimateTax' ? entry.seq === taxSeq && entry.cartSeq === cartSeq && entry.sessionSeq === sessionSeq
                : entry.submission === submission);
    function setError(code = 'GROK_COMMERCE_UNCONFIRMED') {
        error = grokError(code, '本次官方 Commerce 状态无法确认，已停止自动操作');
        if (submission) outcome = { success: false, code: 'PAYMENT_RESULT_UNKNOWN', submitted: true,
            error: '支付结果未知，请人工核对，系统不会再次提交' };
    }
    function consumeOutcome(data, requestedPurchase = null) {
        if (error || !submission || !data.purchaseId || requestedPurchase && requestedPurchase !== data.purchaseId) return;
        if (requestedPurchase && !submission.purchaseId) { if (pendingStatus.length < 10) pendingStatus.push([data, requestedPurchase]); return; }
        if (submission.purchaseId && submission.purchaseId !== data.purchaseId) return;
        if (!requestedPurchase) submission.purchaseId = data.purchaseId;
        acquisitionPending = (data.status === 'ACQUISITION_STATUS_PENDING');
        if (outcome?.success || outcome?.declined) return;
        if (data.status === 'ACQUISITION_STATUS_SUCCEEDED' && data.subscriptionId && !rpcError(data)) {
            outcome = { success: true, submitted: true, canRetryCard: false, subscriptionId: data.subscriptionId };
        } else if (data.status === 'ACQUISITION_STATUS_FAILED' && rpcError(data)
            && /^DECLINE_REASON_/.test(data.declineReason || '') && data.declineReason !== 'DECLINE_REASON_UNSPECIFIED') {
            outcome = { success: false, submitted: true, declined: true, canRetryCard: true,
                error: '支付卡被官方系统拒付' };
        }
        if (!requestedPurchase) for (const [pending, id] of pendingStatus.splice(0)) consumeOutcome(pending, id);
    }
    const onRequest = request => {
        const method = commerceMethod(request.url());
        if (disposed || !method || request.method() !== 'POST') return;
        try {
            if (request.frame().page() !== page || request.frame() !== page.mainFrame()) return;
            const data = decodeRpc(method, 'input', request.postDataBuffer(), request.headers());
            const name = method.split('/').at(-1);
            const entry = { method, name, data };
            if (['CreateCheckoutSession', 'GetCheckoutSession', 'AdoptCheckoutSession'].includes(name)) {
                entry.priorSession = session; entry.seq = ++sessionSeq; session = cart = tax = null;
                cartRequest = taxRequest = null;
            } else if (name === 'GetCartForSession') {
                if (!skuId) return;
                entry.seq = ++cartSeq; entry.sessionSeq = sessionSeq; cart = tax = null; ++taxSeq;
                cartRequest = entry; taxRequest = null;
            } else if (name === 'EstimateTax') {
                ++taxCounts.requested;
                // The app may receive the cart and request tax before our async
                // response.body() finishes. Bind to the current cart request
                // generation now; the full contract still requires the decoded
                // cart ID, session, address and amounts to match before payment.
                if (!cartRequest || cartRequest.sessionSeq !== sessionSeq || !data.cartId
                    || cart && data.cartId !== cart.data.cartId) { ++taxCounts.ignored; return; }
                entry.seq = ++taxSeq; entry.cartSeq = cartSeq; entry.sessionSeq = sessionSeq; tax = null;
                taxRequest = entry; ++taxCounts.tracked;
            } else if (name === 'Acquire') {
                if (!submission || data.cartId !== submission.cartId || !data.idempotencyKey || !data.native?.paymentMethodId
                    || data.store || !addressMatches(data.billingAddress, submission.address)
                    || clean(data.billingEmail) !== clean(submission.email)
                    || submission.idempotencyKey && submission.idempotencyKey !== data.idempotencyKey) {
                    setError(); return;
                }
                acquisitionInFlight = true;
                submission.idempotencyKey = data.idempotencyKey; entry.submission = submission;
            } else if (name === 'GetAcquisitionStatus') {
                if (!submission || !data.purchaseId || submission.purchaseId && data.purchaseId !== submission.purchaseId) return;
                entry.submission = submission;
            }
            requests.set(request, entry);
        } catch (_) { setError('GROK_COMMERCE_PROTOCOL_UNSUPPORTED'); }
    };
    const onResponse = async response => {
        const entry = requests.get(response.request());
        if (!entry) return;
        if (!current(entry)) { requests.delete(response.request()); return; }
        try {
            if (!response.ok()) throw new Error('RPC HTTP failure');
            const data = decodeRpc(entry.method, 'output', await response.body(), response.headers());
            if (!current(entry)) return;
            if (['CreateCheckoutSession', 'GetCheckoutSession', 'AdoptCheckoutSession'].includes(entry.name)) {
                if (rpcError(data) || !data.checkoutSession?.token) throw new Error('Invalid session');
                const prior = entry.priorSession?.data;
                const sameSession = entry.data.sessionToken === data.checkoutSession.token
                    && prior?.checkoutSession?.token === data.checkoutSession.token;
                let origin = sameSession ? entry.priorSession?.origin : null;
                if (entry.name === 'CreateCheckoutSession') {
                    const token = data.checkoutSession.token;
                    origin = sessionOrigins.get(token);
                    if (!origin) {
                        if (sessionOrigins.size >= 32) throw new Error('Too many checkout sessions');
                        origin = { request: entry.data, token };
                        sessionOrigins.set(token, origin);
                    } else if ((origin.request?.teamId || '') !== (entry.data.teamId || '')) {
                        setError('GROK_CHECKOUT_SCOPE_UNCONFIRMED');
                    }
                    // Retain the first proven scope even when overlapping
                    // creation requests return the same previously seen token.
                }
                session = { request: entry.name === 'AdoptCheckoutSession' ? entry.priorSession?.request : entry.data,
                    origin, data: { ...data, skuPricings: entry.name === 'AdoptCheckoutSession' ? prior?.skuPricings : data.skuPricings } };
                if (entry.name !== 'CreateCheckoutSession' && (entry.data.sessionToken !== data.checkoutSession.token
                    || prior && prior.checkoutSession.token !== data.checkoutSession.token)) setError();
            } else if (entry.name === 'GetCartForSession') {
                cart = { request: entry.data, data };
                // Bind the response's opaque subject metadata once per proven
                // session. A later change cannot be accepted during repricing.
                if (session?.origin && entry.data.sessionToken === session.origin.token
                    && session.origin.cartTeamId === undefined) session.origin.cartTeamId = data.teamId || '';
            }
            else if (entry.name === 'EstimateTax') { tax = { request: entry.data, data }; ++taxCounts.completed; }
            else if (entry.name === 'Acquire') { acquisitionInFlight = false; consumeOutcome(data); }
            else if (entry.name === 'GetAcquisitionStatus') consumeOutcome(data, entry.data.purchaseId);
        } catch (_) { if (current(entry)) setError('GROK_COMMERCE_PROTOCOL_UNSUPPORTED'); }
        finally { requests.delete(response.request()); }
    };
    const onFailed = request => {
        const entry = requests.get(request);
        requests.delete(request);
        if (!entry) return;
        if (entry.name === 'Acquire') acquisitionInFlight = false;
        if (current(entry)) setError('GROK_CHECKOUT_NETWORK_ERROR');
    };
    page.on('request', onRequest); page.on('response', onResponse); page.on('requestfailed', onFailed);
    return {
        plan,
        bindSku(value) {
            if (submission || skuId || !/^[a-zA-Z0-9_-]{1,160}$/.test(value || '')) fail('官方套餐 SKU 无法唯一确认');
            skuId = value; cart = tax = null;
        },
        setBillingAddress(value) { address = taxAddress(value); },
        taxDiagnostics() {
            const mismatchedFields = [];
            if (tax && address) {
                for (const key of ['regionCode', 'postalCode', 'administrativeAreaCode', 'locality']) {
                    if (clean(tax.request.billingAddress?.[key]) !== clean(address[key])) mismatchedFields.push(key);
                }
                if ((tax.request.billingAddress?.addressLines || []).filter(Boolean).map(clean).join('\n')
                    !== address.addressLines.filter(Boolean).map(clean).join('\n')) mismatchedFields.push('addressLines');
            }
            const state = error ? 'observer_error' : !cart ? 'cart_pending' : !taxRequest ? 'not_requested'
                : !tax ? 'response_pending' : tax.request.cartId !== cart.data.cartId ? 'cart_mismatch'
                    : mismatchedFields.length ? 'address_mismatch' : rpcError(tax.data) ? 'rpc_error' : 'ready';
            return { state, ...taxCounts, mismatchedFields,
                ...(state === 'rpc_error' ? { error: classifyTaxError(tax.data.error) } : {}) };
        },
        taxRecoveryScope() {
            this.contract();
            if (!address || submission || disposed) fail('税费重试上下文无法确认，已停止操作', 'GROK_TAX_CONTEXT_CHANGED');
            const expectedSession = sessionSeq, expectedCart = cartSeq, expectedAddress = structuredClone(address);
            const observer = this;
            const assertCurrent = () => {
                if (disposed || submission || sessionSeq !== expectedSession || cartSeq !== expectedCart
                    || !addressMatches(address, expectedAddress)
                    || taxRequest && (!addressMatches(taxRequest.data.billingAddress, expectedAddress)
                        || cart && taxRequest.data.cartId !== cart.data.cartId)) {
                    fail('税费重试上下文发生变化，已停止操作', 'GROK_TAX_CONTEXT_CHANGED');
                }
                observer.contract();
            };
            return Object.freeze({ assertCurrent, diagnostics() { assertCurrent(); return observer.taxDiagnostics(); } });
        },
        contract({ final = false } = {}) {
            if (error) throw error;
            try {
                return validateCommerceContract(plan, skuId, session, cart, tax, final ? address : null);
            } catch (failure) {
                if (cart && ['GROK_MIGRATION_REQUIRED', 'GROK_EFFECTIVE_TIME_UNCONFIRMED', 'GROK_CHECKOUT_SCOPE_UNCONFIRMED'].includes(failure.code)
                    && !diagnosedCarts.has(cart)) {
                    diagnosedCarts.add(cart);
                    const fields = failure.code === 'GROK_CHECKOUT_SCOPE_UNCONFIRMED'
                        ? checkoutScopeSignals(session, cart) : checkoutRiskSignals(session, cart);
                    if (cart.data.effectiveAt) fields.push('cart.effectiveAt');
                    console.warn(`[Grok/commerce] 安全拦截命中字段: ${fields.join(', ')}; code=${failure.code}`);
                }
                throw failure;
            }
        },
        arm(contract, email) {
            if (submission && !outcome?.declined) fail('本次支付已提交，不允许重复提交');
            const fresh = this.contract({ final: true });
            if (!address || !email || fresh.cartId !== contract.cartId || fresh.amount !== contract.amount) fail('提交前订单信息发生变化');
            pendingStatus.length = 0;
            acquisitionPending = false;
            acquisitionInFlight = false;
            submission = { cartId: fresh.cartId, address, email, purchaseId: '', idempotencyKey: '' }; outcome = null;
        },
        result: () => outcome,
        isPending: () => Boolean(acquisitionPending || acquisitionInFlight),
        recordDecline(reason = '支付卡被官方系统拒付') {
            if (submission && !outcome) {
                acquisitionPending = false;
                acquisitionInFlight = false;
                outcome = {
                    success: false,
                    submitted: true,
                    declined: true,
                    canRetryCard: true,
                    error: reason
                };
            }
        },
        dispose() { disposed = true; page.off('request', onRequest); page.off('response', onResponse); page.off('requestfailed', onFailed);
            requests.clear(); sessionOrigins.clear(); pendingStatus.length = 0;
            acquisitionPending = false; acquisitionInFlight = false;
            session = cart = tax = submission = null;
            cartRequest = taxRequest = null; }
    };
}

module.exports = { observeGrokCommerce, validateCommerceContract, taxAddress, addressMatches, micros, periodMatches, classifyTaxError };
