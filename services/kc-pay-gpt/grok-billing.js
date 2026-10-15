'use strict';

const { grokError } = require('./grok-checkout-state');
const selectors = {
    country: 'select[autocomplete="country"],select[autocomplete="country-name"],#billingCountry,select[name="billingCountry"],#billingAddress-countryInput',
    name: '#billingName,input[name="billingName"],input[autocomplete="cc-name"],input[autocomplete="name"],#billingAddress-nameInput',
    line1: 'input[autocomplete="address-line1"],#billingAddressLine1,input[name="billingAddressLine1"],#billingAddress-addressLine1Input',
    line2: 'input[autocomplete="address-line2"],#billingAddressLine2,input[name="billingAddressLine2"],#billingAddress-addressLine2Input',
    city: 'input[autocomplete="address-level2"],#billingLocality,input[name="billingLocality"],#billingAddress-localityInput',
    state: 'select[autocomplete="address-level1"],input[autocomplete="address-level1"],#billingAdministrativeArea,input[name="billingAdministrativeArea"],#billingAddress-administrativeAreaInput',
    zip: 'input[autocomplete="postal-code"],#billingPostalCode,input[name="billingPostalCode"],#billingAddress-postalCodeInput',
    email: 'input[type="email"],#email,input[name="email"]'
};

async function discoverBilling(page) {
    const contexts = [page];
    for (const frame of page.frames()) {
        if (frame === page.mainFrame() || frame.isDetached()) continue;
        const element = await frame.frameElement().catch(() => null);
        if (element && await element.isVisible() && /^https:\/\/(?:js|hooks)\.stripe\.com\//.test(frame.url())
            && /address|accessory/.test(frame.url())) contexts.push(frame);
    }
    const fields = {};
    for (const [key, selector] of Object.entries(selectors)) {
        const matches = [];
        for (const context of contexts) {
            const locator = context.locator(selector);
            for (let i = 0, count = await locator.count(); i < count; i++) {
                if (await locator.nth(i).isVisible()) matches.push(locator.nth(i));
            }
        }
        if (matches.length > 1) throw grokError('GROK_BILLING_UNCONFIRMED', '账单字段存在多个匹配，尚未提交支付');
        if (matches.length) fields[key] = matches[0];
    }
    return fields;
}

function billingValues(address, name, email) {
    return { country: String(address.country || '').toUpperCase(), name, email, line1: address.line1 || '',
        line2: address.line2 || '', city: address.city || '', state: address.state || '', zip: address.postal_code || '' };
}

async function fillGrokBilling(page, address, name, email) {
    const expected = billingValues(address, name, email);
    const filled = {};
    const initialFields = await discoverBilling(page);
    const countryBefore = initialFields.country ? await initialFields.country.inputValue() : '';
    const countryChanged = countryBefore && countryBefore.toUpperCase() !== expected.country;
    // Country first: changing it can remount state/postal fields and change tax.
    for (const key of ['country', 'name', 'line1', 'line2', 'city', 'state', 'zip', 'email']) {
        let field = (await discoverBilling(page))[key];
        // A field that existed before the country switch is temporarily absent
        // during React's remount, rather than optional. Wait for its replacement.
        if (!field && countryChanged && key !== 'country' && initialFields[key]) {
            const deadline = Date.now() + 4000;
            do {
                await page.waitForTimeout(Math.min(100, Math.max(1, deadline - Date.now())));
                field = (await discoverBilling(page))[key];
            } while (!field && Date.now() < deadline);
            if (!field) throw grokError('GROK_BILLING_UNCONFIRMED', `切换国家后账单 ${key} 未重新就绪，尚未提交支付`);
        }
        if (!field) continue;
        const value = String(expected[key]);
        if (!value && await field.getAttribute('required') !== null) throw grokError('GROK_BILLING_UNCONFIRMED', `缺少必填账单字段 ${key}，尚未提交支付`);
        if (!value && key !== 'line2') continue;
        const tag = await field.evaluate(el => el.tagName);
        if (tag === 'SELECT') {
            const option = await field.evaluate((el, wanted) => {
                const options = [...el.options];
                const match = options.find(option => option.value.toLowerCase() === wanted.toLowerCase()
                    || option.text.trim().toLowerCase() === wanted.toLowerCase()
                    || wanted.toUpperCase() === 'OR' && /^Oregon$/i.test(option.text.trim()));
                return match?.value ?? null;
            }, value);
            if (option === null) throw grokError('GROK_BILLING_UNCONFIRMED', `账单 ${key} 选项无法确认，尚未提交支付`);
            if (await field.inputValue() !== option) await field.selectOption(option);
            filled[key] = option;
        } else {
            const readonly = await field.getAttribute('readonly') !== null || !await field.isEnabled();
            if (readonly && (await field.inputValue()).toLowerCase() !== value.toLowerCase()) {
                throw grokError('GROK_BILLING_UNCONFIRMED', `账单 ${key} 与目标信息不一致，尚未提交支付`);
            }
            if (!readonly && await field.inputValue() !== value) await field.fill(value);
            filled[key] = value;
        }
    }
    await page.keyboard.press('Tab');
    await assertGrokBillingReady(page, filled, expected);
    return { filled, expected };
}

async function assertGrokBillingReady(page, filled, expected) {
    const fields = await discoverBilling(page);
    for (const [key, value] of Object.entries(filled)) {
        if (!fields[key] || (await fields[key].inputValue()).trim().toLowerCase() !== String(value).trim().toLowerCase()) {
            throw grokError('GROK_BILLING_UNCONFIRMED', `账单 ${key} 在提交前发生变化，已停止支付`);
        }
    }
    for (const [key, field] of Object.entries(fields)) {
        if (await field.evaluate(el => !el.checkValidity())) throw grokError('GROK_BILLING_UNCONFIRMED', `账单 ${key} 未通过校验，已停止支付`);
        if (key === 'email' && expected.email && (await field.inputValue()).toLowerCase() !== expected.email.toLowerCase()) {
            throw grokError('GROK_BILLING_UNCONFIRMED', 'Checkout 邮箱与官方账号不一致，已停止支付');
        }
    }
    return true;
}

module.exports = { fillGrokBilling, assertGrokBillingReady };
