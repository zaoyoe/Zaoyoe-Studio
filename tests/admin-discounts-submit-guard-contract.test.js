const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('discount generate submit is single-flight and delegated from bootstrap', () => {
    const discountsSource = readRepoFile('admin-discounts.js');
    const bootstrapSource = readRepoFile('js/admin-studio-bootstrap.js');

    const requiredDiscountMarkers = [
        'generateSubmitInFlight: false',
        'setGenerateSubmitBusyState: function (busy = false)',
        "const form = document.getElementById('discountGenerateForm');",
        "form.addEventListener('click', (event) => {",
        'if (this.generateSubmitInFlight) {',
        'this.generateSubmitInFlight = true;',
        'this.setGenerateSubmitBusyState(true);',
        'this.generateSubmitInFlight = false;',
        'this.setGenerateSubmitBusyState(false);',
        'Submit is delegated centrally from admin-studio-bootstrap.js to avoid duplicate create requests.',
        'this.controlsBound = true;'
    ];

    for (const marker of requiredDiscountMarkers) {
        assert.equal(
            discountsSource.includes(marker),
            true,
            `admin-discounts.js should contain ${marker}`
        );
    }

    assert.equal(
        discountsSource.includes('await this.submitGenerate();'),
        false,
        'admin-discounts.js should not bind duplicate local submitGenerate listeners'
    );

    assert.equal(
        bootstrapSource.includes(`bindClick('[data-admin-action="discounts-submit-generate"]'`),
        true,
        'admin-studio-bootstrap.js should own the generate button click binding'
    );
    assert.equal(
        bootstrapSource.includes(`bindSubmit('discountGenerateForm'`),
        true,
        'admin-studio-bootstrap.js should own the generate form submit binding'
    );
});
