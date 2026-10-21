'use strict';
const { grokError } = require('./grok-checkout-state');
const { normalizeNativeBillingAddress } = require('./grok-billing-address');
const { checkoutDialog, uniqueVisible, visibleMatches } = require('./grok-native-checkout');
const fieldSelectors = {
    line1: 'input[autocomplete~="address-line1"],input[name="addressLine1"]',
    line2: 'input[autocomplete~="address-line2"],input[name="addressLine2"]',
    city: 'input[autocomplete~="address-level2"],input[name="city"]',
    zip: 'input[autocomplete~="postal-code"],input[name="postalCode"]',
    name: 'input[autocomplete~="cc-name"],input[autocomplete~="name"]',
    email: 'input[type="email"]'
};
const invalid = message => { throw grokError('GROK_BILLING_UNCONFIRMED', message); };
const ACTION_TIMEOUT = 3000;
async function isElementActive(locator) {
    return locator.evaluate(el => {
        if (!el || !el.isConnected) return false;
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        if (style.opacity === '0' || style.pointerEvents === 'none') return false;
        if (el.getAttribute('data-state') === 'closed' || el.getAttribute('aria-hidden') === 'true') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }).catch(() => false);
}
async function leaveAddressInput(page, dialog, { recoverSuggestions = true } = {}) {
    await checkoutDialog(page);
    // Base UI owns the typeahead popup's focus separately from the form's
    // onBlur callback. A real pointer focus transition closes that popup even
    // when its asynchronous suggestion response arrives after the blur.
    try {
        const headings = await visibleMatches(dialog.getByRole('heading', {
            name: /^(账单信息|帳單資訊|Billing information)$/i
        }));
        if (headings.length === 1) {
            await headings[0].click({ timeout: 1500 });
        }
    } catch (_) {
        // Heading click may time out when an address typeahead overlay covers it;
        // selectCustom / fillNativeBilling will explicitly validate and close suggestions.
    }
    await page.evaluate(() => {
        if (document.activeElement && document.activeElement.blur && document.activeElement !== document.body) {
            document.activeElement.blur();
        }
    }).catch(() => {});
    await checkoutDialog(page);
}
async function fillAndBlur(page, input, value) {
    await input.fill(value, { timeout: ACTION_TIMEOUT });
    await checkoutDialog(page);
    // The official address typeahead expands manual fields on blur. Escape can
    // dismiss the parent Checkout dialog and route back to the home page.
    if (await input.getAttribute('name') === 'addressLine1') await leaveAddressInput(page, await checkoutDialog(page));
    else await input.blur({ timeout: ACTION_TIMEOUT });
    await checkoutDialog(page);
}
async function selectionValue(dialog, name) {
    const mirrors = dialog.locator(`input[name="${name}"],select[name="${name}"]`);
    if (await mirrors.count() !== 1) invalid(`账单 ${name} 选择值无法确认`);
    return mirrors.inputValue({ timeout: ACTION_TIMEOUT });
}
const MANUAL_ADDRESS_LABEL = /^(Enter address manually|手动输入地址|手动填写地址|手动输入完整地址)$/i;
async function findManualAddressActions(list) {
    let actions = await visibleMatches(list.getByRole('option', { name: MANUAL_ADDRESS_LABEL }));
    if (!actions.length) actions = await visibleMatches(list.getByRole('button', { name: MANUAL_ADDRESS_LABEL }));
    if (!actions.length) actions = await visibleMatches(list.locator('button, [role="button"], [role="option"], div, a').filter({ hasText: MANUAL_ADDRESS_LABEL }));
    const activeActions = [];
    for (const a of actions) {
        if (await isElementActive(a)) activeActions.push(a);
    }
    return activeActions;
}
async function addressSuggestions(page, dialog) {
    const streets = await visibleMatches(dialog.locator(fieldSelectors.line1));
    if (streets.length !== 1) invalid('街道地址输入框无法唯一确认');
    const street = streets[0];
    const controls = String(await street.getAttribute('aria-controls') || await street.getAttribute('aria-owns') || '').split(/\s+/).filter(Boolean);
    const candidateLocators = [
        page.getByRole('listbox'),
        page.locator('.pac-container, [data-slot*="autocomplete"], [data-slot*="typeahead"], [data-slot*="suggestions"]')
    ];
    const lists = [];
    for (const locator of candidateLocators) {
        for (const list of await visibleMatches(locator)) {
            if (!await isElementActive(list)) continue;
            let duplicate = false;
            for (const existing of lists) {
                if (await existing.evaluate((a, b) => a === b, await list.elementHandle()).catch(() => false)) {
                    duplicate = true;
                    break;
                }
            }
            if (duplicate) continue;
            if (controls.length) {
                const linked = await list.evaluate((el, ids) => ids.some(id => {
                    const owner = document.getElementById(id);
                    return owner === el || owner?.contains(el);
                }), controls);
                if (linked) { lists.push(list); continue; }
            }
            if ((await findManualAddressActions(list)).length) {
                // Older components omit aria-controls. The exact manual action must
                // still belong to one visible listbox and one street field.
                lists.push(list);
            }
        }
    }
    if (lists.length > 1) invalid('街道地址建议弹层存在多个匹配');
    return lists[0] ? { street, list: lists[0] } : null;
}
async function closeAddressSuggestions(page, dialog) {
    await checkoutDialog(page);
    const popup = await addressSuggestions(page, dialog);
    if (!popup) return false;
    const actions = await findManualAddressActions(popup.list);
    if (actions.length !== 1) invalid('地址建议中无法唯一确认手动输入入口，尚未提交支付');
    const streetValue = await popup.street.inputValue({ timeout: ACTION_TIMEOUT });
    try {
        await actions[0].click({ timeout: ACTION_TIMEOUT });
    } catch (err) {
        if (!await addressSuggestions(page, dialog)) {
            console.log('[Grok] 地址建议已自行关闭，继续使用指定的手动账单地址...');
            return true;
        }
        throw err;
    }
    await checkoutDialog(page);
    // Manual selection can return focus to the typeahead input. Leave through
    // the official noninteractive heading so late rows cannot reopen it.
    if (await popup.street.inputValue({ timeout: ACTION_TIMEOUT }) !== streetValue) invalid('手动输入操作改变了目标街道，尚未提交支付');
    await leaveAddressInput(page, dialog, { recoverSuggestions: false });
    const deadline = Date.now() + ACTION_TIMEOUT;
    while (await addressSuggestions(page, dialog)) {
        if (Date.now() >= deadline) invalid('手动地址入口未关闭建议弹层，尚未提交支付');
        await checkoutDialog(page); await page.waitForTimeout(60);
    }
    if (await popup.street.inputValue({ timeout: ACTION_TIMEOUT }) !== streetValue) invalid('手动输入操作改变了目标街道，尚未提交支付');
    console.log('[Grok] 地址建议已关闭，继续使用指定的手动账单地址...');
    return true;
}
async function getSelectTrigger(dialog, mirrors, name, timeoutMs = 3000) {
    const deadline = Date.now() + timeoutMs;
    do {
        await checkoutDialog(dialog.page());
        const candidates = await visibleMatches(mirrors.locator('..').getByRole('combobox'));
        if (candidates.length === 1) return candidates[0];
        if (candidates.length > 1) {
            const triggers = await visibleMatches(mirrors.locator('..').locator('[data-slot="xds-select-trigger"]'));
            if (triggers.length === 1) return triggers[0];
        }
        if (Date.now() < deadline) await dialog.page().waitForTimeout(100);
    } while (Date.now() < deadline);
    return uniqueVisible(mirrors.locator('..').getByRole('combobox'), `账单 ${name}`);
}
async function selectCustom(page, dialog, name, value, optionName) {
    const mirrors = dialog.locator(`input[name="${name}"],select[name="${name}"]`);
    if (await mirrors.count() !== 1) invalid(`账单 ${name} 选择器未就绪`);
    if (await selectionValue(dialog, name) === value) return;
    if (await mirrors.evaluate(el => el.tagName) === 'SELECT') { await mirrors.selectOption(value, { timeout: ACTION_TIMEOUT }); }
    else {
        // If an address suggestion popup is open, close it first so it does not block the trigger
        if (name === 'state') await closeAddressSuggestions(page, dialog);
        // The official XDS trigger and hidden readback mirror share this parent.
        const trigger = await getSelectTrigger(dialog, mirrors, name);
        try { await trigger.click({ timeout: ACTION_TIMEOUT }); }
        catch (error) {
            // A pending address lookup can open its portal after the initial
            // check. Recover this specific obstruction once without force-click
            // or Escape, then require the official selector's readback below.
            if (name !== 'state' || error?.name !== 'TimeoutError' || !await closeAddressSuggestions(page, dialog)) throw error;
            await checkoutDialog(page);
            if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click({ timeout: ACTION_TIMEOUT });
        }
        const options = page.getByRole('listbox').getByRole('option', { name: optionName });
        await options.first().waitFor({ state: 'visible', timeout: 3000 });
        const option = await uniqueVisible(options, `账单 ${name} 选项`);
        await option.click({ timeout: 3000 });
    }
    await checkoutDialog(page);
    const deadline = Date.now() + 3000;
    while (await selectionValue(dialog, name) !== value && Date.now() < deadline) await page.waitForTimeout(60);
    if (await selectionValue(dialog, name) !== value) invalid(`账单 ${name} 选择未生效`);
}
async function field(dialog, key, { required = true, timeoutMs = 0 } = {}) {
    const deadline = Date.now() + timeoutMs;
    do {
        await checkoutDialog(dialog.page());
        const matches = await visibleMatches(dialog.locator(fieldSelectors[key]));
        if (matches.length > 1) invalid(`账单 ${key} 存在多个匹配`);
        if (matches[0]) return matches[0];
        if (!required) return null;
        if (Date.now() < deadline) await dialog.page().waitForTimeout(Math.min(100, deadline - Date.now()));
    } while (Date.now() < deadline);
    invalid(`必需的账单 ${key} 尚未展开，尚未提交支付`);
}
async function fillNativeBilling(page, address, name, email) {
    address = normalizeNativeBillingAddress(address);
    const dialog = await checkoutDialog(page);
    const expected = { country: 'US', state: 'OR', line1: address.line1 || '', line2: address.line2 || '',
        city: address.city || '', zip: address.postal_code || '', name, email };
    let billingStage = 'country';
    try {
        await selectCustom(page, dialog, 'country', 'US', /^(美国|United States(?: of America)?)$/i);
        billingStage = 'line1';
        const street = await field(dialog, 'line1', { timeoutMs: 5000 });
        await fillAndBlur(page, street, expected.line1);
        // These fields are mandatory for the audited US address form, including when
        // they do not exist until line1 loses focus. Absence is never "optional".
        for (const key of ['city', 'zip']) {
            billingStage = key;
            const input = await field(dialog, key, { timeoutMs: 5000 });
            await fillAndBlur(page, input, expected[key]);
        }
        billingStage = 'state';
        const stateDeadline = Date.now() + 5000;
        while (await dialog.locator('input[name="state"],select[name="state"]').count() !== 1 && Date.now() < stateDeadline) {
            await checkoutDialog(page); await page.waitForTimeout(100);
        }
        await selectCustom(page, dialog, 'state', 'OR', /^(Oregon|俄勒冈(?:州)?)$/i);
        const filled = ['line1', 'city', 'zip'];
        for (const key of ['line2', 'name', 'email']) {
            billingStage = key;
            const input = await field(dialog, key, { required: false });
            if (!input) continue;
            if (!expected[key] && await input.getAttribute('required') !== null) invalid(`缺少必填账单 ${key}`);
            if (await input.getAttribute('readonly') !== null || !await input.isEnabled()) {
                if ((await input.inputValue({ timeout: ACTION_TIMEOUT })).trim().toLowerCase() !== String(expected[key]).trim().toLowerCase()) invalid(`账单 ${key} 与目标信息不一致`);
            } else { await fillAndBlur(page, input, expected[key] || ''); }
            filled.push(key);
        }
        billingStage = 'suggestions';
        const suggestionDeadline = Date.now() + 4000;
        while (!await addressSuggestions(page, dialog)
            && await street.getAttribute('aria-busy').catch(() => null) === 'true'
            && Date.now() < suggestionDeadline) {
            await checkoutDialog(page);
            await page.waitForTimeout(60);
        }
        if (await addressSuggestions(page, dialog)) {
            await closeAddressSuggestions(page, dialog);
        }
        await leaveAddressInput(page, dialog);
        billingStage = 'readback';
        await assertNativeBilling(page, { filled, expected });
        return { filled, expected };
    } catch (error) {
        // Preserve our safe guard messages; do not expose Playwright call logs,
        // which can include filled card/address values or session URLs.
        const timeout = error?.name === 'TimeoutError';
        const failure = /^GROK_[A-Z_]+$/.test(error?.code || '') ? error
            : grokError('GROK_BILLING_UNCONFIRMED', `账单 ${billingStage} 操作${timeout ? '超时' : '失败'}，尚未提交支付`);
        failure.billingStage = billingStage;
        failure.billingFailure = timeout ? 'timeout' : 'guard_or_operation';
        throw failure;
    }
}
async function assertNativeBilling(page, billing) {
    const dialog = await checkoutDialog(page);
    if (await addressSuggestions(page, dialog)) {
        await closeAddressSuggestions(page, dialog);
    }
    for (const key of ['country', 'state']) if (await selectionValue(dialog, key) !== billing.expected[key]) invalid(`账单 ${key} 在提交前发生变化`);
    for (const key of billing.filled) {
        const input = await field(dialog, key);
        if ((await input.inputValue({ timeout: ACTION_TIMEOUT })).trim().toLowerCase() !== String(billing.expected[key]).trim().toLowerCase()
            || !await input.evaluate(el => el.checkValidity() && el.getAttribute('aria-invalid') !== 'true')) invalid(`账单 ${key} 在提交前未通过校验`);
    }
    const missing = await dialog.evaluate(el => [...el.querySelectorAll('input,select,textarea')]
        .some(input => input.getClientRects().length && (!input.checkValidity() || input.getAttribute('aria-invalid') === 'true')));
    if (missing) invalid('账单表单仍有未通过校验的字段');
}
async function recommitNativeTaxAddress(page, billing, assertCurrent) {
    assertCurrent();
    await assertNativeBilling(page, billing);
    const dialog = await checkoutDialog(page);
    const city = await field(dialog, 'city');
    const value = await city.inputValue({ timeout: ACTION_TIMEOUT });
    if (await city.getAttribute('readonly') !== null || !await city.isEnabled()) invalid('账单地址无法重新确认，尚未提交支付');
    // The audited form commits only an edited draft on blur. Change and restore
    // one plain input while focused, then commit the same full address through
    // the visible UI. No suggestion selection, hidden input or direct RPC write.
    assertCurrent();
    await city.fill(value + ' ', { timeout: ACTION_TIMEOUT });
    assertCurrent();
    await city.fill(value, { timeout: ACTION_TIMEOUT });
    assertCurrent();
    await assertNativeBilling(page, billing);
    await leaveAddressInput(page, dialog);
    assertCurrent();
    await assertNativeBilling(page, billing);
}
module.exports = { fillNativeBilling, assertNativeBilling, recommitNativeTaxAddress, closeAddressSuggestions };
