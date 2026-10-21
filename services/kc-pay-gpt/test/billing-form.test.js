import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { chromium } from 'playwright';
import {
    readBillingInputValues, getBillingFieldStatus, listBillingMissing, syncFilledFlags,
    isOpenAiBillingFormComplete, assertOpenAiBillingReady, verifyBillingAfterTax, clickCheckoutSubmitButton, waitForBillingFields,
    getCurrentBillingCountryValue, selectBillingCountry, selectBillingState, fillOpenAiCheckoutBilling, ensureCheckoutTaxFreeAmount,
    estimateTaxFreeAmount, isCheckoutTaxZero, isPhTaxFreeNet, readCheckoutDueAmount, assertCheckoutDueCurrency,
    isTaxFreeDueAmount
} from '../stripe-payment.js';

let browser;
const contexts = [];
const name = 'Example Customer';
const address = { line1: '123 Example Street', city: 'Example City', state: 'OR', postal_code: '97000', country: 'US' };
const filled = Object.fromEntries(['name', 'line1', 'city', 'postal', 'state', 'country'].map(key => [key, true]));
function billing({ country = 'US', cityState = true, empty = false, wrap = true } = {}) {
    const val = value => empty ? '' : value;
    return `<section id="billing"><h2>${wrap ? '<span>Billing address</span>' : 'Billing address'}</h2>
        <h3>Name</h3><label for="customer">Name</label><input id="customer" autocomplete="billing name" value="${val(name)}">
        <h3>Address details</h3><input id="street" autocomplete="billing address-line1" value="${val(address.line1)}">
        ${cityState ? `<input id="city" autocomplete="billing address-level2" value="${val(address.city)}"><select id="state" autocomplete="billing address-level1"><option value="">Select state</option><option value="OR" ${empty ? '' : 'selected'}>Oregon</option></select>` : ''}
        <input id="zip" type="number" autocomplete="billing postal-code" value="${val(address.postal_code)}">
        <select id="country" autocomplete="billing country"><option value="">Select country</option><option value="${country}" ${empty ? '' : 'selected'}>${country === 'SG' ? 'Singapore' : 'United States'}</option></select>
        </section>`;
}
async function fixture(html = billing()) {
    const context = await browser.newContext(); contexts.push(context);
    await context.route('**/*', route => route.abort());
    const page = await context.newPage(); await page.setContent(html); return page;
}
beforeAll(async () => { browser = await chromium.launch({ headless: true }); });
afterEach(async () => { await Promise.all(contexts.splice(0).map(context => context.close())); });
afterAll(async () => { await browser?.close(); });

describe('wait for actual billing fields', () => {
    it('waits for fields inserted after the billing heading', async () => {
        const page = await fixture('<section><h2>Billing address</h2><div id="loading">Loading</div></section>');
        await page.evaluate(() => { setTimeout(() => { document.querySelector('#loading').outerHTML = '<input autocomplete="billing address-line1">'; }, 300); });
        expect(await waitForBillingFields(page, 1500)).toBe(true);
        expect(await page.locator('#loading').count()).toBe(0);
    });
    it('ignores billing copy and contact/shipping fields outside the billing section', async () => {
        const page = await fixture('<section><h2>Billing address</h2><p>Loading</p></section><section><h2>Shipping address</h2><input autocomplete="address-line1"><select name="country"><option>US</option></select></section><h2>Contact information</h2><label>Name<input name="name"></label>');
        expect(await waitForBillingFields(page, 300)).toBe(false);
    });
    it('recognizes visible billing fields inside an iframe', async () => {
        const page = await fixture('<h2>Contact information</h2><input name="name"><iframe></iframe>');
        await page.frames()[1].setContent(billing());
        expect(await waitForBillingFields(page, 500)).toBe(true);
    });
    it('reports a closed checkout page immediately', async () => {
        const page = await fixture(); await page.close();
        await expect(waitForBillingFields(page, 500)).rejects.toThrow('CHECKOUT_PAGE_CLOSED');
    });
});

describe('billing values from the live billing group', () => {
    it('reads a wrapped heading, internal subheadings, native selections and numeric postal code', async () => {
        const page = await fixture();
        expect(await readBillingInputValues(page)).toMatchObject({ name, line1: address.line1, city: address.city, state: 'Oregon', postal: address.postal_code, country: 'United States' });
        expect(await isOpenAiBillingFormComplete(page, {}, address, name)).toBe(true);
    });
    it('supports a nonsemantic wrapped billing title', async () => {
        const page = await fixture(billing().replace('<h2><span>Billing address</span></h2>', '<div><span>Billing address</span></div>'));
        expect(await isOpenAiBillingFormComplete(page, {}, address, name)).toBe(true);
    });
    it('supports the exact Name label when autocomplete is absent', async () => {
        const page = await fixture(billing().replace('autocomplete="billing name"', ''));
        expect((await readBillingInputValues(page)).name).toBe(name);
    });
    it('does not borrow required values from optional Link or shipping fields', async () => {
        const page = await fixture(`${billing({ empty: true })}<section><h2>Personal information (optional)</h2>
            <input name="billing_name" value="${name}"><input name="billing_line1" value="${address.line1}">
            <input name="billing_city" value="${address.city}"><input name="billing_state" value="Oregon">
            <input name="billing_postal" value="${address.postal_code}"><input name="billing_country" value="US"></section>`);
        const actual = await readBillingInputValues(page);
        expect(actual.name).toBe('');
        expect(actual.line1).toBe('');
        expect(await isOpenAiBillingFormComplete(page, filled, address, name)).toBe(false);
    });
    it('reads the billing frame without merging contact fields in the main page', async () => {
        const page = await fixture('<h2>Contact information</h2><input name="name" value="Wrong Person"><iframe></iframe>');
        await page.frames()[1].setContent(billing());
        const actual = await readBillingInputValues(page);
        expect(actual.name).toBe(name);
        expect(await isOpenAiBillingFormComplete(page, {}, address, name)).toBe(true);
    });
    it('clears stale flags after React replaces the form with empty fields', async () => {
        const page = await fixture();
        const flags = { ...filled };
        await page.locator('#billing').evaluate((node, html) => node.outerHTML = html, billing({ empty: true }));
        expect(await isOpenAiBillingFormComplete(page, flags, address, name)).toBe(false);
        await syncFilledFlags(page, flags);
        expect(Object.values(flags).every(value => value === false)).toBe(true);
    });
    it('allows absent city/state for Singapore, but rejects displayed empty controls', async () => {
        const target = { ...address, country: 'SG' };
        const page = await fixture(billing({ country: 'SG', cityState: false }));
        expect(await isOpenAiBillingFormComplete(page, {}, target, name)).toBe(true);
        await page.setContent(billing({ country: 'SG' }));
        await page.locator('#city').fill(''); await page.locator('#state').selectOption('');
        const status = getBillingFieldStatus(await readBillingInputValues(page), filled, 'SG', target, name);
        expect(listBillingMissing(status)).toEqual(['city', 'state']);
    });
    it('reads custom country/state comboboxes', async () => {
        const page = await fixture(billing().replace(/<select id="state"[\s\S]*?<\/select>/, '<div role="combobox" aria-label="State" aria-valuetext="Oregon">OR</div>')
            .replace(/<select id="country"[\s\S]*?<\/select>/, '<div role="combobox" aria-label="Country" aria-valuetext="United States">US</div>'));
        expect(await isOpenAiBillingFormComplete(page, {}, address, name)).toBe(true);
    });
    it.each(['name', 'line1', 'city', 'postal', 'state', 'country'])('rejects empty %s despite a successful earlier fill', async key => {
        const actual = { name, line1: address.line1, city: address.city, postal: address.postal_code, state: 'Oregon', country: 'US', present: Object.keys(filled), [key]: '' };
        expect(listBillingMissing(getBillingFieldStatus(actual, filled, 'US', address, name))).toContain(key);
    });
    it.each(['name', 'line1', 'city', 'postal', 'state', 'country'])('rejects incorrect %s', async key => {
        const actual = { name, line1: address.line1, city: address.city, postal: address.postal_code, state: 'Oregon', country: 'US', present: Object.keys(filled), [key]: 'Wrong' };
        expect(listBillingMissing(getBillingFieldStatus(actual, filled, 'US', address, name))).toContain(key);
    });
    it('checks fields again after tax refresh before reporting fill success', async () => {
        const page = await fixture();
        const result = { ok: true, dueAmount: { amount: 20, currency: 'USD' } };
        expect(await verifyBillingAfterTax(page, address, name, result)).toEqual(result);
        await page.locator('#street').fill('');
        expect(await verifyBillingAfterTax(page, address, name, result)).toMatchObject({ ok: false, error: expect.stringContaining('line1') });
    });
});

describe('last billing check runs immediately before a submit action', () => {
    it('blocks submission when fields reset while the button is disabled', async () => {
        const page = await fixture(`${billing()}<button id="submit" disabled>Upgrade to Plus</button><button onclick="window.fallback=true">Subscribe</button>`);
        await page.evaluate(() => { setTimeout(() => { document.querySelector('#street').value = ''; document.querySelector('#submit').disabled = false; }, 600); });
        await expect(clickCheckoutSubmitButton(page, '', () => assertOpenAiBillingReady(page, address, name))).rejects.toMatchObject({ code: 'BILLING_FORM_CHANGED' });
        expect(await page.evaluate(() => window.fallback)).toBeUndefined();
    });
    it('does not try another button after the first click throws', async () => {
        const page = await fixture(`${billing()}<button>Upgrade to Plus</button><button>Subscribe</button>`);
        const proto = Object.getPrototypeOf(page.getByRole('button').first());
        const originalClick = proto.click;
        const spy = vi.spyOn(proto, 'click').mockImplementation(function (...args) {
            if (this.toString().includes('Upgrade to')) throw new Error('submit click already dispatched');
            return originalClick.apply(this, args);
        });
        const before = vi.fn(() => assertOpenAiBillingReady(page, address, name));
        try {
            await expect(clickCheckoutSubmitButton(page, '', before)).rejects.toThrow('submit click already dispatched');
            expect(before).toHaveBeenCalledOnce();
            expect(spy.mock.calls.filter((_, i) => spy.mock.contexts[i].toString().includes('Upgrade to'))).toHaveLength(1);
        } finally { spy.mockRestore(); }
    });
});


function countryForm(country = 'PH', { us = true } = {}) {
    return billing({ empty: true })
        .replace(/<select id="country"[\s\S]*?<\/select>/, `<select id="country" autocomplete="billing country">
            <option value="PH" ${country === 'PH' ? 'selected' : ''}>Philippines</option>
            ${us ? `<option value="US" ${country === 'US' ? 'selected' : ''}>United States</option>` : ''}</select>`)
        .replace(/<select id="state"[\s\S]*?<\/select>/, `<select id="state" autocomplete="billing address-level1">
            <option value="">Select ${country === 'PH' ? 'province' : 'state'}</option>
            ${country === 'US' ? '<option value="OR">Oregon</option>' : '<option value="CEB">Cebu</option>'}</select>`);
}

function nativeStateForm(optionValue, optionLabel) {
    return countryForm('US').replace('<option value="OR">Oregon</option>', `<option value="${optionValue}">${optionLabel}</option>`);
}

function customStateForm({ popupRole = 'listbox', optionRole = 'option', optionAttrs = '' } = {}) {
    const popupRoleAttr = popupRole ? `role="${popupRole}"` : '';
    const optionRoleAttr = optionRole ? `role="${optionRole}"` : '';
    const popupClass = popupRole ? '' : ' class="state-menu"';
    return `<section id="billing"><h2>Billing address</h2>
        <input id="street" autocomplete="billing address-line1" value="${address.line1}">
        <button id="state" type="button" role="combobox" aria-label="State" aria-valuetext="Select state" aria-controls="state-options"
            onclick="document.querySelector('#state-options').hidden=false">Select state</button>
        <div id="state-options" ${popupRoleAttr}${popupClass} hidden>
            <div ${optionRoleAttr} ${optionAttrs}
                onclick="const state=document.querySelector('#state'); state.setAttribute('aria-valuetext','Oregon'); state.textContent='Oregon'; this.parentElement.hidden=true">Oregon</div>
        </div>
        <select id="country" autocomplete="billing country"><option value="US" selected>United States</option></select>
    </section>`;
}

function typeaheadStateForm() {
    return `<section id="billing"><h2>Billing address</h2>
        <input id="street" autocomplete="billing address-line1" value="${address.line1}">
        <input id="state" role="combobox" aria-label="State" aria-controls="state-options" autocomplete="billing address-level1">
        <div id="state-options" role="listbox" hidden><div id="oregon-option" role="option" hidden>Oregon</div></div>
        <select id="country" autocomplete="billing country"><option value="US" selected>United States</option></select>
        <script>
            const state = document.querySelector('#state');
            const options = document.querySelector('#state-options');
            const option = document.querySelector('#oregon-option');
            state.addEventListener('keydown', event => {
                if (event.key === 'ArrowDown') {
                    options.hidden = false;
                    option.hidden = false;
                    state.setAttribute('aria-activedescendant', 'oregon-option');
                }
                if (event.key === 'Enter') {
                    state.value = 'Oregon';
                    options.hidden = true;
                }
            });
        </script>
    </section>`;
}

describe('billing state selection accepts codes, labels, and custom controls', () => {
    it.each([
        ['OR', 'Oregon'],
        ['Oregon', 'OR'],
        ['Oregon (OR)', 'Oregon (OR)'],
        ['OR - Oregon', 'OR - Oregon']
    ])('selects a native state option when value=%s and label=%s', async (value, label) => {
        const page = await fixture(nativeStateForm(value, label));
        expect(await selectBillingState(page, 'Oregon', 'OR', 800)).toBe(true);
        expect(await page.locator('#state').inputValue()).toBe(value);
    });

    it.each([
        ['Oregon', 'OR'],
        ['OR', 'Oregon'],
        ['Oregon (OR)', 'Oregon (OR)'],
        ['OR - Oregon', 'OR - Oregon']
    ])('treats equivalent US state representations as a match (%s / %s)', (actualState, targetState) => {
        const actual = { ...address, state: actualState, present: Object.keys(filled) };
        expect(getBillingFieldStatus(actual, filled, 'US', { ...address, state: targetState }, name).state).toBe(true);
    });

    it.each([
        ['listbox', 'option', ''],
        ['menu', 'menuitem', ''],
        ['menu', 'menuitemradio', ''],
        ['', '', 'data-value="OR"']
    ])('selects a custom state option from %s/%s controls', async (popupRole, optionRole, optionAttrs) => {
        const page = await fixture(customStateForm({ popupRole, optionRole, optionAttrs }));
        expect(await selectBillingState(page, 'Oregon', 'OR', 1000)).toBe(true);
        expect(await page.locator('#state').getAttribute('aria-valuetext')).toBe('Oregon');
    });

    it('selects an input typeahead state through its active descendant', async () => {
        const page = await fixture(typeaheadStateForm());
        expect(await selectBillingState(page, 'Oregon', 'OR', 1000)).toBe(true);
        expect(await page.locator('#state').inputValue()).toBe('Oregon');
    });

    it('re-reads the billing group after the state control is replaced', async () => {
        const page = await fixture(countryForm('US'));
        const replacement = nativeStateForm('OR', 'Oregon').replace('id="billing"', 'id="billing-replaced"');
        await page.evaluate(html => {
            document.querySelector('#state').addEventListener('change', () => {
                document.querySelector('#billing').outerHTML = html;
            });
        }, replacement);
        expect(await selectBillingState(page, 'Oregon', 'OR', 1000)).toBe(true);
        expect(await page.locator('#billing-replaced #state').inputValue()).toBe('OR');
    });

    it('selects state when control is a button with State label and Select value in portal popup', async () => {
        const html = `<section id="billing"><h2>Billing address</h2>
            <input id="street" autocomplete="billing address-line1" value="${address.line1}">
            <div class="row">
                <div class="col">
                    <button id="r2" type="button" aria-haspopup="listbox" class="p-Input-state"
                        onclick="document.querySelector('#portal-options').hidden=false">
                        <span>State</span><span>Select</span>
                    </button>
                </div>
                <div class="col">
                    <input id="zip" autocomplete="billing postal-code" value="${address.postal_code}">
                </div>
            </div>
            <select id="country" autocomplete="billing country"><option value="US" selected>United States</option></select>
        </section>
        <div id="portal-options" role="listbox" hidden>
            <div role="option" onclick="document.querySelector('#r2').textContent='Oregon'; this.parentElement.hidden=true">Oregon</div>
        </div>`;
        const page = await fixture(html);
        expect(await selectBillingState(page, 'Oregon', 'OR', 1500)).toBe(true);
        expect(await page.locator('#r2').textContent()).toBe('Oregon');
    });
});

const phoneAndShipping = `<section><h2>Contact information</h2><label>Phone country<select id="phone-country" name="phoneCountry">
    <option value="PH" selected>Philippines (+63)</option><option value="US">United States (+1)</option></select></label></section>
    <section><h2>Shipping address</h2><select id="shipping-country" autocomplete="shipping country">
    <option value="PH" selected>Philippines</option><option value="US">United States</option></select>
    <input autocomplete="shipping address-line1" value="Shipping Street"><input name="city" value="Shipping City"></section>`;
const usLabels = ['United States', '美国', 'US'];

describe('billing country is scoped and confirmed before entering an Oregon address', () => {
    it('reads the selected billing country, ignoring the full phone-country list and unselected options', async () => {
        const page = await fixture(`${phoneAndShipping}${countryForm()}`);
        expect(await getCurrentBillingCountryValue(page)).toEqual({ value: 'PH', label: 'Philippines' });
        expect((await readBillingInputValues(page)).country).toBe('Philippines');
        expect(await selectBillingCountry(page, usLabels, 1500)).toBe(true);
        expect(await page.locator('#country').inputValue()).toBe('US');
        expect(await page.locator('#phone-country').inputValue()).toBe('PH');
        expect(await page.locator('#shipping-country').inputValue()).toBe('PH');
    });
    it('reads a hidden native backing select when no visible country control exists', async () => {
        const page = await fixture(countryForm().replace('id="country"', 'id="country" style="display:none"'));
        expect((await getCurrentBillingCountryValue(page)).value).toBe('PH');
        expect(await selectBillingCountry(page, usLabels, 1500)).toBe(true);
        expect((await getCurrentBillingCountryValue(page)).value).toBe('US');
    });
    it('prefers the visible country value over a stale hidden backing select', async () => {
        const page = await fixture(countryForm('US').replace('id="country"', 'id="country" style="visibility:hidden"')
            .replace('</section>', '<button role="combobox" aria-label="Country">Philippines</button></section>'));
        expect((await getCurrentBillingCountryValue(page)).value).toBe('PH');
    });
    it('reads a custom combobox display without its labels or hidden options', async () => {
        const page = await fixture(countryForm().replace(/<select id="country"[\s\S]*?<\/select>/, `<label>
            <button id="country" type="button" role="combobox" aria-label="Country"><label>Country or region</label><span>Philippines</span>
            <div style="display:none"><div role="option">United States</div><div role="option">Singapore</div></div></button></label>`));
        expect(await getCurrentBillingCountryValue(page)).toEqual({ value: 'PH', label: 'Philippines' });
    });
    it('selects a custom country only from its associated popup', async () => {
        const page = await fixture(countryForm().replace(/<select id="country"[\s\S]*?<\/select>/, `
            <button id="country" type="button" role="combobox" aria-label="Country" aria-controls="billing-countries"
                onclick="document.querySelector('#billing-countries').hidden=false">Country or region <span>Philippines</span></button>
            <div id="billing-countries" role="listbox" hidden><div role="option" onclick="document.querySelector('#country span').textContent='United States';this.parentElement.hidden=true">United States</div></div>`)
            + `<div role="listbox" id="phone-options"><div role="option" onclick="window.phoneTouched=true">United States</div></div>`);
        expect(await selectBillingCountry(page, usLabels, 1500)).toBe(true);
        expect((await getCurrentBillingCountryValue(page)).value).toBe('US');
        expect(await page.evaluate(() => window.phoneTouched)).toBeUndefined();
    });
    it('selects billing country and state within an iframe without modifying main-page fields', async () => {
        const page = await fixture(`${phoneAndShipping}<iframe></iframe>`);
        const frame = page.frames()[1];
        await frame.setContent(countryForm('US'));
        await frame.locator('#country').selectOption('PH');
        expect((await getCurrentBillingCountryValue(page)).value).toBe('PH');
        expect(await selectBillingCountry(page, usLabels, 1500)).toBe(true);
        expect(await selectBillingState(page, 'Oregon', 'OR', 600)).toBe(true);
        expect(await frame.locator('#state').inputValue()).toBe('OR');
        expect(await page.locator('#phone-country').inputValue()).toBe('PH');
        expect(await page.locator('#shipping-country').inputValue()).toBe('PH');
    });
    it.each(['main page', 'iframe'])('fills the rebuilt %s after PH to US switching clears the fields', async location => {
        const page = await fixture(location === 'main page'
            ? `${phoneAndShipping}${countryForm()}<p>Due today $20.00</p>`
            : `${phoneAndShipping}<p>Due today $20.00</p><h2>Billing address</h2><iframe></iframe>`);
        const frame = location === 'main page' ? page.mainFrame() : page.frames()[1];
        if (location === 'iframe') await frame.setContent(countryForm());
        await frame.evaluate(({ html, fullName }) => {
            document.querySelector('#customer').value = fullName;
            document.querySelector('#country').addEventListener('change', () => {
                window.countryChanges = (window.countryChanges || 0) + 1;
                setTimeout(() => document.querySelector('#billing').outerHTML = html, 250);
            });
        }, { html: countryForm('US'), fullName: name });
        const result = await fillOpenAiCheckoutBilling(page, address, name);
        expect(result.ok).toBe(true);
        expect(await readBillingInputValues(page)).toMatchObject({
            name, country: 'United States', state: 'Oregon', line1: address.line1, city: address.city, postal: address.postal_code
        });
        expect(await frame.evaluate(() => window.countryChanges)).toBe(1);
        expect(await page.locator('#phone-country').inputValue()).toBe('PH');
        expect(await page.locator('#shipping-country').inputValue()).toBe('PH');
        expect(await page.locator('input[autocomplete="shipping address-line1"]').inputValue()).toBe('Shipping Street');
        expect(await page.locator('input[name="city"]').inputValue()).toBe('Shipping City');
    });
    it.each([true, false])('uses the street fallback inside the billing iframe (heading=%s) without borrowing shipping fields', async hasHeading => {
        const page = await fixture(`${phoneAndShipping}<p>Due today $20.00</p><iframe></iframe>`);
        const frame = page.frames()[1];
        const html = countryForm('US');
        await frame.setContent(hasHeading ? html : html.replace('<h2>Billing address</h2>', ''));
        await frame.evaluate(() => {
            const street = document.querySelector('#street');
            window.streetInputs = 0;
            street.addEventListener('input', () => {
                if (street.value && ++window.streetInputs <= 2) street.value = '';
            });
        });
        const result = await fillOpenAiCheckoutBilling(page, address, name);
        expect(result.ok).toBe(true);
        expect(await frame.evaluate(() => window.streetInputs)).toBe(3);
        expect(await readBillingInputValues(page)).toMatchObject({
            name, country: 'United States', state: 'Oregon', line1: address.line1, city: address.city, postal: address.postal_code
        });
        expect(await page.locator('input[autocomplete="shipping address-line1"]').inputValue()).toBe('Shipping Street');
        expect(await page.locator('input[name="city"]').inputValue()).toBe('Shipping City');
    });
    it('retries tax recalculation using only the postal field in the billing iframe', async () => {
        const page = await fixture(`<section><h2>Shipping address</h2>
            <label>Postal code<input id="shipping-zip" autocomplete="shipping postal-code" value="12345"></label></section>
            <p id="due">Due today $22.00</p><iframe></iframe>`);
        const frame = page.frames()[1];
        await frame.setContent(billing().replace(`value="${address.postal_code}"`, 'value=""'));
        await frame.evaluate(() => document.querySelector('#zip').addEventListener('input', () => {
            parent.document.querySelector('#due').textContent = 'Due today $20.00';
        }));
        const result = await ensureCheckoutTaxFreeAmount(page, address, 20, 'USD');
        expect(result).toMatchObject({ ok: true, due: { amount: 20, currency: 'USD' } });
        expect(await frame.locator('#zip').inputValue()).toBe(address.postal_code);
        expect(await page.locator('#shipping-zip').inputValue()).toBe('12345');
    });
    it('confirms a country selection when its native control is synchronously replaced', async () => {
        const page = await fixture(countryForm());
        await page.evaluate(html => document.querySelector('#country').addEventListener('change', () => {
            document.querySelector('#billing').outerHTML = html;
        }), countryForm('US'));
        expect(await selectBillingCountry(page, usLabels, 1500)).toBe(true);
        expect((await getCurrentBillingCountryValue(page)).value).toBe('US');
    });
    it('does not fill an Oregon address when the US country option is unavailable', async () => {
        const page = await fixture(`${countryForm('PH', { us: false })}<button onclick="window.submitted=true">Subscribe</button>`);
        const result = await fillOpenAiCheckoutBilling(page, address, name);
        expect(result).toMatchObject({ ok: false, error: expect.stringContaining('[BILLING_COUNTRY_MISMATCH]') });
        expect((await getCurrentBillingCountryValue(page)).value).toBe('PH');
        for (const id of ['customer', 'street', 'city', 'zip', 'state']) expect(await page.locator(`#${id}`).inputValue()).toBe('');
        expect(await page.evaluate(() => window.submitted)).toBeUndefined();
    });
    it('rejects a country switch that the page asynchronously reverts', async () => {
        const page = await fixture(countryForm());
        await page.evaluate(() => document.querySelector('#country').addEventListener('change', () => {
            setTimeout(() => document.querySelector('#country').value = 'PH', 80);
        }));
        const result = await fillOpenAiCheckoutBilling(page, address, name);
        expect(result).toMatchObject({ ok: false, error: expect.stringContaining('目标 US，当前 PH') });
        expect(await page.locator('#zip').inputValue()).toBe('');
        expect(await page.locator('#state').inputValue()).toBe('');
    });
    it('does not wait in selectOption for an Oregon option missing from a province list', async () => {
        const page = await fixture(countryForm());
        const proto = Object.getPrototypeOf(page.locator('#state'));
        const spy = vi.spyOn(proto, 'selectOption');
        const start = Date.now();
        try {
            expect(await selectBillingState(page, 'Oregon', 'OR', 400)).toBe(false);
            expect(Date.now() - start).toBeLessThan(2000);
            expect(spy).not.toHaveBeenCalled();
        } finally { spy.mockRestore(); }
    });
});

describe('tax recalculation and zero-tax detection', () => {
    it.each([
        ['Due today ₱982.14', { amount: 982.14, currency: 'PHP' }],
        ['Due today USD 20.00', { amount: 20, currency: 'USD' }],
        ['Due today CAD 20.00', { amount: 20, currency: 'CAD' }],
        ['Due today CL$ 2,000.00', { amount: 2000, currency: 'CLP' }],
        ['Due today E£ 500.00', { amount: 500, currency: 'EGP' }]
    ])('reads the explicit Checkout currency without assuming USD (%s)', async (text, expected) => {
        const page = await fixture(`<p>${text}</p>`);
        await expect(readCheckoutDueAmount(page)).resolves.toEqual(expected);
    });

    it('does not infer a currency from an unrecognized symbol', async () => {
        const page = await fixture('<p>Due today ¤20.00</p>');
        await expect(readCheckoutDueAmount(page)).resolves.toBeNull();
    });

    it('rejects a Checkout amount when its currency differs from the card target', async () => {
        const page = await fixture('<p>Due today $20.00</p>');
        await expect(assertCheckoutDueCurrency(page, 'PHP')).rejects.toMatchObject({ code: 'PAYMENT_CURRENCY_MISMATCH' });
    });

    it('stops before filling billing details when the payment amount cannot be confirmed', async () => {
        const page = await fixture(countryForm());
        const result = await fillOpenAiCheckoutBilling(page, address, name, 'PHP');
        expect(result).toMatchObject({ ok: false, code: 'CHECKOUT_CURRENCY_UNCONFIRMED' });
        expect(await page.locator('#street').inputValue()).toBe('');
    });

    it('rejects a currency change caused by tax recalculation', async () => {
        const page = await fixture(`${billing().replace('value="97000"', 'value="00000"')}<p id="due">Due today $22.00</p>`);
        await page.locator('#zip').evaluate(input => input.addEventListener('input', () => {
            document.querySelector('#due').textContent = 'Due today CAD 20.00';
        }));
        const result = await ensureCheckoutTaxFreeAmount(page, address, 20, 'USD', 'USD');
        expect(result).toMatchObject({ ok: false, code: 'PAYMENT_CURRENCY_MISMATCH' });
    });

    it('requires the Philippine net amount, not just a lower amount or a zero-tax label', async () => {
        expect(isTaxFreeDueAmount({ amount: 900, currency: 'PHP' }, 1100, 'PHP')).toBe(false);
        expect(isTaxFreeDueAmount({ amount: 1000, currency: 'PHP' }, 1100, 'PHP')).toBe(false);
        expect(isTaxFreeDueAmount({ amount: 982.14, currency: 'PHP' }, 1100, 'PHP')).toBe(true);
        expect(isTaxFreeDueAmount({ amount: 5794.64, currency: 'PHP' }, 1100, 'PHP')).toBe(false);
        expect(isTaxFreeDueAmount({ amount: 20, currency: 'USD' }, 20, 'USD')).toBe(true);
        expect(isTaxFreeDueAmount({ amount: 19, currency: 'USD' }, 20, 'USD')).toBe(false);

        let now = Date.now();
        const dateNow = vi.spyOn(Date, 'now').mockImplementation(() => {
            now += 20_000;
            return now;
        });
        try {
            const page = await fixture(`<div>VAT (0%) ₱0.00</div><p>Due today ₱1,100.00</p>${billing()}`);
            const result = await fillOpenAiCheckoutBilling(page, address, name, 'PHP');
            expect(result).toMatchObject({
                ok: false,
                code: 'BILLING_TAX_NOT_REMOVED',
                skipped: true,
                error: expect.stringContaining('免税应约 982.14')
            });
        } finally {
            dateNow.mockRestore();
        }
    });

    it('estimates tax free amount for PHP plans and avoids secondary discount', () => {
        // PHP Plus: 1100 -> 982.14, and 982.14 stays 982.14
        expect(estimateTaxFreeAmount(1100, 'PHP')).toBe(982.14);
        expect(estimateTaxFreeAmount(982.14, 'PHP')).toBe(982.14);

        // PHP Pro 100 (Standard): 6490 -> 5794.64, and 5794.64 stays 5794.64
        expect(estimateTaxFreeAmount(6490, 'PHP')).toBe(5794.64);
        expect(estimateTaxFreeAmount(5794.64, 'PHP')).toBe(5794.64);

        // PHP Pro 200 (More usage): 9990 -> 8919.64, and 8919.64 stays 8919.64 (not 7963.96!)
        expect(estimateTaxFreeAmount(9990, 'PHP')).toBe(8919.64);
        expect(estimateTaxFreeAmount(8919.64, 'PHP')).toBe(8919.64);

        // PHP Pro 500 (Max usage): 32490 -> 29008.93, and 29008.93 stays 29008.93
        expect(estimateTaxFreeAmount(32490, 'PHP')).toBe(29008.93);
        expect(estimateTaxFreeAmount(29008.93, 'PHP')).toBe(29008.93);

        // USD prices remain unchanged
        expect(estimateTaxFreeAmount(20, 'USD')).toBe(20);
        expect(estimateTaxFreeAmount(200, 'USD')).toBe(200);
    });

    it('identifies net prices correctly with isPhTaxFreeNet', () => {
        expect(isPhTaxFreeNet(8919.64)).toBe(true);
        expect(isPhTaxFreeNet(5794.64)).toBe(true);
        expect(isPhTaxFreeNet(982.14)).toBe(true);
        expect(isPhTaxFreeNet(29008.93)).toBe(true);
        expect(isPhTaxFreeNet(9990)).toBe(false);
        expect(isPhTaxFreeNet(1100)).toBe(false);
    });

    it('detects explicit zero tax from checkout summary', async () => {
        const page1 = await fixture('<div><div>Monthly subscription</div><div>₱8,919.64</div><div>Sales Tax (0%)</div><div>₱0.00</div><div>Due today</div><div>₱8,919.64</div></div>');
        expect(await isCheckoutTaxZero(page1)).toBe(true);

        const page2 = await fixture('<div><div>Estimated tax</div><div>$0.00</div><div>Due today</div><div>$20.00</div></div>');
        expect(await isCheckoutTaxZero(page2)).toBe(true);

        const page3 = await fixture('<div><div>Sales Tax (12%)</div><div>₱1,070.36</div><div>Due today</div><div>₱9,990.00</div></div>');
        expect(await isCheckoutTaxZero(page3)).toBe(false);
    });

    it('passes ensureCheckoutTaxFreeAmount when PHP checkout already displays net price (e.g. 8919.64)', async () => {
        const page = await fixture('<div><div>Sales Tax (0%)</div><div>₱0.00</div><div>Due today</div><div>₱8,919.64</div></div>');
        const res = await ensureCheckoutTaxFreeAmount(page, address, 8919.64, 'PHP');
        expect(res).toMatchObject({ ok: true, due: { amount: 8919.64, currency: 'PHP' } });
    });
});

