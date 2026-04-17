const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const preflightPath = path.resolve(__dirname, '../scripts/payment-rollout-preflight.js');
const preflightSource = fs.readFileSync(preflightPath, 'utf8');

test('payment rollout preflight invokes the payment readiness gate before passing', () => {
    assert.equal(
        preflightSource.includes("runNodeScript('./payment-readiness-gate.js'"),
        true,
        'payment rollout preflight should invoke the readiness gate script'
    );
    assert.equal(
        preflightSource.includes("'--fail-on-missing'"),
        true,
        'payment rollout preflight should fail closed when required payment RPCs are missing'
    );
});
