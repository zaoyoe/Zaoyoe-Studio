import schema from '../../grok-commerce-schema.json';
import { getGrokPlan } from '../../grok-checkout-state.js';
import { taxAddress } from '../../grok-commerce.js';

export const methods = Object.fromEntries(Object.keys(schema.methods).map(method => [method.split('/').at(-1), method]));
export const address = { country: 'US', state: 'OR', city: 'Fixture', postal_code: '97000', line1: '123 Fixture Street' };
export const account = { ok: true, email: 'fixture@example.test', accountId: 'fixture-user', platformMode: 'grok_web' };
export const card = { number: '4242424242424242', expiry: '12/30', cvc: '123', holder: 'Offline Fixture' };
export const money = amount => ({ currencyCode: 'USD', unitMicros: String(Math.round(amount * 1000000)) });
export function quote(key = 'grok_bundle_premium_monthly', { promo = false, now = Date.now() } = {}) {
    const plan = getGrokPlan(key), skuId = 'sku_fixture_' + plan.tier;
    const period = { count: 1, unit: plan.interval === 'year' ? 'UNIT_YEAR' : 'UNIT_MONTH' };
    const expiresAt = { seconds: String(Math.floor(now / 1000) + 3600), nanos: 0 };
    const first = promo ? plan.amount / 2 : plan.amount;
    const session = { request: { country: 'US', billingPlatforms: ['BILLING_PLATFORM_STRIPE'] },
        data: { checkoutSession: { token: 'offline-session', expiresAt }, skuPricings: [{
            skuId, pricing: { id: 'price_fixture', skuId, status: 'PRICING_STATUS_ACTIVE',
                details: { amount: money(plan.amount), country: 'US', interval: period, billingPlatform: 'BILLING_PLATFORM_STRIPE' } },
            benefits: promo ? [{ benefitId: 'benefit_fixture', value: { discount: { percent: 50, times: 1 } } }] : []
        }] } };
    // The official session includes both periods for one SKU; non-seat checkout
    // omits quantity rather than sending 1. Keep fixtures representative of it.
    const alternatePlan = getGrokPlan(key.replace(/_(monthly|annual)$/, plan.interval === 'year' ? '_monthly' : '_annual'));
    session.data.skuPricings.push({ skuId, pricing: { id: 'alternate_price_fixture', skuId, status: 'PRICING_STATUS_ACTIVE',
        details: { amount: money(alternatePlan.amount), country: 'US',
            interval: { count: 1, unit: alternatePlan.interval === 'year' ? 'UNIT_YEAR' : 'UNIT_MONTH' },
            billingPlatform: 'BILLING_PLATFORM_STRIPE' } }, benefits: [] });
    const cart = { request: { sessionToken: 'offline-session', selections: [{ skuId, recurrence: period }],
        billingPlatform: 'BILLING_PLATFORM_STRIPE' },
        data: { cartId: 'offline-cart', teamId: 'offline-personal-subject', subtotal: money(first), tax: money(0), total: money(first), expiresAt,
            catalogVersion: 'offline-catalog', stripe: {},
            chargeSchedule: { startTime: { seconds: String(Math.floor(now / 1000)) },
                segments: [...(promo ? [{ amount: money(first), period, count: 1, benefitId: 'benefit_fixture' }] : []),
                    { amount: money(plan.amount), period, count: 0 }] } } };
    // Production establishes this provenance only from an observed successful
    // CreateCheckoutSession and stable GetCart response for that session.
    session.origin = { request: session.request, token: session.data.checkoutSession.token,
        cartTeamId: cart.data.teamId };
    const tax = { request: { cartId: cart.data.cartId, billingAddress: taxAddress(address) },
        data: { subtotal: money(first), tax: money(0), total: money(first), taxLines: [] } };
    return { plan, skuId, session, cart, tax, address: taxAddress(address), first };
}

// Test-only encoder. No vendor runtime or network access is used by fixtures.
function varint(value) {
    let n = BigInt.asUintN(64, BigInt(value)), bytes = [];
    do { const byte = Number(n & 127n); n >>= 7n; bytes.push(byte | (n ? 128 : 0)); } while (n);
    return Buffer.from(bytes);
}
export function encodeMessage(type, data) {
    const output = [];
    for (const [number, field] of Object.entries(schema.messages[type])) {
        if (data[field.name] == null) continue;
        for (const value of field.repeated ? data[field.name] : [data[field.name]]) {
            let payload, wire;
            if (field.type === 11 || field.type === 9) {
                wire = 2; payload = field.type === 11 ? encodeMessage(field.ref, value) : Buffer.from(value);
                payload = Buffer.concat([varint(payload.length), payload]);
            } else if (field.type === 1) { wire = 1; payload = Buffer.alloc(8); payload.writeDoubleLE(value); }
            else {
                wire = 0;
                const n = field.type === 14 ? Object.entries(schema.enums[field.ref]).find(([,name]) => name === value)?.[0] ?? value : value;
                payload = varint(typeof n === 'boolean' ? Number(n) : n);
            }
            output.push(varint(Number(number) * 8 + wire), payload);
        }
    }
    return Buffer.concat(output);
}
export function envelope(payload, flags = 0) {
    const header = Buffer.alloc(5); header[0] = flags; header.writeUInt32BE(payload.length, 1);
    return Buffer.concat([header, payload]);
}
export function rpc(name, direction, data, trailer = 'grpc-status: 0\r\n') {
    const payload = encodeMessage(schema.methods[methods[name]][direction], data);
    return direction === 'output' ? Buffer.concat([envelope(payload), envelope(Buffer.from(trailer), 128)]) : envelope(payload);
}
