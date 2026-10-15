import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
import { estimateTaxFreeAmount } from '../stripe-payment.js';

const oregon = { id: 1, region: 'US', country: 'US', state: 'Oregon', line1: '123 Fixture Street', city: 'Fixture', postal_code: '97000' };
const delaware = { id: 2, region: 'US', country: 'US', state: 'Delaware', line1: '456 Fixture Street', city: 'Dover', postal_code: '19901' };

// Every address-pool call stays in this mock store, including configuration
// writes. These tests never read or mutate the application's real database.
function harness({ rows = [], poolFailure = false, env = {} } = {}) {
    const store = {
        runQuery: vi.fn(async (sql, params) => {
            if (poolFailure) throw new Error('offline pool unavailable');
            const oregonOnly = sql.includes("country = 'US'") && sql.includes('LOWER(TRIM(state))');
            return rows.filter(row => row.is_active !== 0 && !row.is_bound && (oregonOnly
                ? row.country === 'US' && /^(OR|Oregon)$/i.test(row.state.trim())
                : row.region === params?.[0])).map(row => ({ ...row }));
        }),
        setAppConfigValue: vi.fn(async () => {})
    };
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(new URL('../tax-free-address.js', import.meta.url), 'utf8'), {
        module, exports: module.exports,
        require: key => { if (key !== './mysql-store') throw new Error('Unexpected dependency'); return store; },
        process: { env }, console
    });
    return { ...module.exports, store };
}

describe('Philippines Oregon Tax-Free Mode', () => {
    describe('estimateTaxFreeAmount', () => {
        it('calculates net tax-free amount for PHP 1100 Plus plan (982.14 PHP)', () => {
            const netAmount = estimateTaxFreeAmount(1100, 'PHP');
            expect(netAmount).toBe(982.14);
        });

        it('preserves already tax-free PHP amount (982.14 PHP)', () => {
            const netAmount = estimateTaxFreeAmount(982.14, 'PHP');
            expect(netAmount).toBe(982.14);
        });

        it('calculates net tax-free amount for PHP 11000 annual plan (9821.43 PHP)', () => {
            const netAmount = estimateTaxFreeAmount(11000, 'PHP');
            expect(netAmount).toBe(9821.43);
        });

        it('preserves baseline amount for USD orders (20 USD)', () => {
            const netAmount = estimateTaxFreeAmount(20, 'USD');
            expect(netAmount).toBe(20);
        });
    });

    describe('generateRandomOregonTaxFreeAddress', () => {
        it('generates a valid US Oregon address with valid postal code', () => {
            const { generateRandomOregonTaxFreeAddress, OREGON_LOCATIONS } = harness();
            const addr = generateRandomOregonTaxFreeAddress();
            expect(addr.country).toBe('US');
            expect(addr.state).toBe('Oregon');
            expect(addr.city).toBeTruthy();
            expect(addr.line1).toBeTruthy();
            expect(addr.postal_code).toBeTruthy();

            const allValidZipCodes = OREGON_LOCATIONS.flatMap(l => l.postalCodes);
            expect(allValidZipCodes).toContain(addr.postal_code);
        });
    });

    describe('pickBillingAddressForCheckout with region PH', () => {
        it('picks an Oregon US tax-free address when region is PH', async () => {
            const { pickBillingAddressForCheckout } = harness({ rows: [oregon, delaware] });
            const addr = await pickBillingAddressForCheckout('PH');
            expect(addr.country).toBe('US');
            expect(addr.state).toBe('Oregon');
            expect(addr.line1).toBeTruthy();
            expect(addr.postal_code).toBeTruthy();
        });
    });
});

describe('explicit Oregon checkout address policy', () => {
    it('selects a whole Oregon address from a mixed-state pool', async () => {
        const fixture = harness({ rows: [delaware, oregon,
            { ...oregon, id: 3, is_bound: 1 }, { ...oregon, id: 4, is_active: 0 },
            { ...oregon, id: 5, country: 'CA' }] });
        const selected = await fixture.pickBillingAddressForCheckout('US', null, { strategy: 'oregon' });
        expect(selected).toEqual(oregon);
        expect(selected.city).not.toBe(delaware.city);
        expect(selected.postal_code).not.toBe(delaware.postal_code);
        expect(fixture.store.setAppConfigValue).toHaveBeenCalledWith('last_used_address_id', '1');
    });
    it('accepts an OR code and excludes the previous address when an alternative exists', async () => {
        const alternate = { ...oregon, id: 3, state: ' OR ', city: 'Other Fixture', postal_code: '97201' };
        const fixture = harness({ rows: [oregon, alternate, delaware] });
        expect(await fixture.pickBillingAddressForCheckout('US', 1, { strategy: 'oregon' }))
            .toEqual({ ...alternate, state: 'Oregon' });
        expect(fixture.store.setAppConfigValue).toHaveBeenCalledWith('last_used_address_id', '3');
    });
    it.each([false, true])('keeps the generated fallback in Oregon when the pool is empty or unavailable (%s)', async poolFailure => {
        const fixture = harness({ rows: [delaware], poolFailure });
        const selected = await fixture.pickBillingAddressForCheckout('US', null, { strategy: 'oregon' });
        expect(selected).toMatchObject({ id: 0, generated: true, country: 'US', state: 'Oregon' });
        expect(fixture.OREGON_LOCATIONS.some(loc => loc.city === selected.city && loc.postalCodes.includes(selected.postal_code))).toBe(true);
        expect(selected.line1).toBeTruthy();
        expect(fixture.store.setAppConfigValue).not.toHaveBeenCalled();
    });
    it('keeps ordinary US selection and the legacy numeric signature on the regional policy', async () => {
        const fixture = harness({ rows: [delaware] });
        expect(await fixture.pickBillingAddressForCheckout('US')).toEqual(delaware);
        expect(await fixture.pickBillingAddressForCheckout(1)).toEqual(delaware);
    });
    it('keeps the configured local Philippines policy', async () => {
        const ph = { ...oregon, id: 3, region: 'PH', country: 'PH', state: 'Metro Manila', city: 'Manila', postal_code: '1000' };
        const fixture = harness({ rows: [oregon, ph], env: { PH_BILLING_ADDRESS_STRATEGY: 'local' } });
        expect(await fixture.pickBillingAddressForCheckout('PH')).toEqual(ph);
    });
    it.each(['EG', 'CL', 'SG', 'MY'])('selects the existing %s pool without substituting a US address', async region => {
        const local = { ...oregon, id: 8, region, country: region, state: 'Fixture State' };
        const fixture = harness({ rows: [oregon, local] });
        expect(await fixture.pickBillingAddressForCheckout(region)).toEqual(local);
    });
    it.each(['PH', 'EG', 'CL', 'SG', 'MY'])('fails closed when the %s local pool is unavailable', async region => {
        const fixture = harness({ poolFailure: true, env: { PH_BILLING_ADDRESS_STRATEGY: 'local' } });
        await expect(fixture.pickBillingAddressForCheckout(region)).rejects.toThrow('offline pool unavailable');
        expect(fixture.store.setAppConfigValue).not.toHaveBeenCalled();
    });
    it.each([
        ['PH', 'oregon'], ['US', 'unknown']
    ])('rejects an incompatible explicit %s/%s policy before querying the pool', async (region, strategy) => {
        const fixture = harness();
        await expect(fixture.pickBillingAddressForCheckout(region, null, { strategy })).rejects.toThrow();
        expect(fixture.store.runQuery).not.toHaveBeenCalled();
    });
});
