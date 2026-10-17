'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildRecovery, sources, transactionBody } = require('../scripts/build-tg-runtime-recovery');
const migrations = path.resolve(__dirname, '../supabase/migrations');
const read = name => fs.readFileSync(path.join(migrations, name), 'utf8');
const recovery = read('20261017_tg_runtime_recovery.sql');
const zpay = read('20261016_tg_purchase_zpay_reconciliation.sql');
const closure = read('20261017_tg_operations_closure.sql');
const finalRuntime = read('20261017_tg_runtime_reconciliation.sql');
function definitions(source) {
    return [...source.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\([\s\S]*?\bAS\s+\$\$[\s\S]*?\$\$;/g)]
        .map(match => ({ name: match[1], source: match[0], index: match.index }));
}
function definition(source, name) {
    const fn = definitions(source).find(fn => fn.name === name);
    assert.ok(fn, `Missing function ${name}`);
    return fn.source;
}
function paymentProofMarkersReady(state) {
    return state.get('fn_tg_confirm_purchase_payment').includes('authenticated_query')
        && state.get('fn_tg_confirm_purchase_payment').includes('checkout_trade_no')
        && state.get('tg_guard_purchase_identity').includes('authenticated_query')
        && state.get('tg_guard_purchase_identity').includes('NEW.verified_payment');
}

test('regression: operations closure overwrites the proof markers required by payment readiness', () => {
    const state = new Map(definitions(zpay).map(fn => [fn.name, fn.source]));
    assert.equal(paymentProofMarkersReady(state), true);
    for (const fn of definitions(closure)) state.set(fn.name, fn.source);
    assert.equal(paymentProofMarkersReady(state), false);
    const gate = definition(zpay, 'fn_tg_purchase_payment_reconciliation_ready');
    for (const marker of ['authenticated_query', 'checkout_trade_no', 'NEW.verified_payment']) assert.ok(gate.includes(marker));
    assert.ok(definition(read('20261016_tg_purchase_fulfillment_review.sql'), 'fn_tg_purchase_fulfillment_review_ready')
        .includes('public.fn_tg_purchase_payment_reconciliation_ready()'));
});

test('recovery restores payment proof before existing approval and resolution readiness gates', () => {
    const repaired = recovery.indexOf('CREATE OR REPLACE FUNCTION public.fn_tg_confirm_purchase_payment(');
    const approvalGate = recovery.indexOf('IF NOT public.fn_tg_purchase_payment_reconciliation_ready()');
    const resolutionGate = recovery.indexOf('IF NOT public.fn_tg_purchase_fulfillment_review_ready()');
    const finalGate = recovery.indexOf('IF NOT public.fn_tg_purchase_resolution_ready()');
    assert.ok(repaired > 0 && repaired < approvalGate && approvalGate < resolutionGate && resolutionGate < finalGate);
    const state = new Map(definitions(closure).map(fn => [fn.name, fn.source]));
    for (const fn of definitions(recovery.slice(0, approvalGate))) state.set(fn.name, fn.source);
    assert.equal(paymentProofMarkersReady(state), true);
    for (const fn of definitions(recovery)) state.set(fn.name, fn.source);
    assert.equal(paymentProofMarkersReady(state), true);
});

test('preflight diagnoses schema and uniqueness prerequisites without requiring broken readiness to pass', () => {
    const preflight = recovery.slice(0, recovery.indexOf('-- BEGIN SOURCE:'));
    for (const marker of ['pg_attribute', 'attisdropped', 'subtotal_minor', 'cancelled_at', 'crypto_checkout',
        'tg_purchase_network_quotes', 'fn_tg_preview_code(character)', 'fn_tg_finish_order(',
        'idx_tg_redemption_orders_purchase', 'i.indisunique AND i.indisvalid', '(purchase_id IS NOT NULL)',
        'RAISE EXCEPTION', 'no repair has been committed']) assert.ok(preflight.includes(marker), marker);
    assert.doesNotMatch(preflight, /IF NOT public\.fn_tg_purchase_(?:fulfillment_review|payment_reconciliation|resolution)_ready\(\)/);
    assert.doesNotMatch(preflight, /CREATE OR REPLACE|ALTER TABLE|GRANT |REVOKE |UPDATE public\.|INSERT INTO/);
});

test('one transaction encloses every install and safety assertion; only committed recovery prints success', () => {
    assert.equal((recovery.match(/^BEGIN;$/gm) || []).length, 1);
    assert.equal((recovery.match(/^COMMIT;$/gm) || []).length, 1);
    assert.equal((recovery.match(/^NOTIFY pgrst,/gm) || []).length, 1);
    assert.doesNotMatch(recovery, /^BEGIN READ ONLY;$/m);
    const verifyStart = recovery.indexOf('-- BEGIN SOURCE: 20261017_verify_tg_runtime_reconciliation.sql');
    const commit = recovery.indexOf('\nCOMMIT;');
    assert.ok(verifyStart > recovery.lastIndexOf('CREATE OR REPLACE FUNCTION'));
    assert.ok(recovery.indexOf('Legacy approval must require the provider-rechecked review path', verifyStart) < commit);
    assert.ok(recovery.indexOf('Purchase resolution is not ready', verifyStart) < commit);
    assert.ok(recovery.indexOf("SELECT 'TG runtime recovery committed;") > commit);
    assert.ok(recovery.includes('concurrent/business acceptance remains NOT RUN'));
});

test('installed definitions end on the combined runtime, preserving closure, networks and exact payment proof', () => {
    const state = new Map();
    for (const fn of definitions(recovery)) state.set(fn.name, fn.source);
    for (const fn of definitions(finalRuntime)) assert.equal(state.get(fn.name), fn.source, fn.name);
    for (const marker of ['v_order.closed_at IS NOT NULL', 'payment_received_after_close', 'payment_received_after_cancellation',
        'payment_received_after_expiry', 'authenticated_query', 'checkout_trade_no']) {
        assert.ok(state.get('fn_tg_confirm_purchase_payment').includes(marker), marker);
    }
    for (const network of ['usdtbsc', 'usdtton', 'usdtmatic', 'usdttrc20']) {
        assert.ok(state.get('tg_valid_purchase_crypto_checkout').includes(network));
    }
    assert.ok(state.get('fn_tg_review_purchase').includes('payment_recheck_required'));
    assert.doesNotMatch(state.get('fn_tg_review_purchase'), /INSERT INTO public\.tg_redemption_orders/);
});

test('original source bodies, readiness checks, grants and verification are retained without weakening', () => {
    assert.equal(recovery, buildRecovery());
    for (const name of sources) {
        const start = recovery.indexOf(`-- BEGIN SOURCE: ${name}\n`);
        const end = recovery.indexOf(`-- END SOURCE: ${name}`, start);
        assert.ok(start >= 0 && end > start);
        assert.ok(recovery.slice(start, end).includes(transactionBody(read(name), name)), name);
    }
    assert.match(recovery, /IF NOT public\.fn_tg_purchase_fulfillment_review_ready\(\) THEN\s+RAISE EXCEPTION 'TG purchase fulfillment review is not ready'/);
    assert.ok(recovery.includes('IF strpos(v_source, v_marker) = 0 THEN RAISE EXCEPTION'));
    assert.doesNotMatch(recovery, /EXCEPTION WHEN (?:OTHERS|raise_exception)|DISABLE TRIGGER|DROP TABLE|TRUNCATE/i);
});

test('recovery installs capabilities without directly invoking business RPCs or enabling switches', () => {
    // Function and DO bodies are inspected separately; these are top-level statements.
    const topLevel = recovery.replace(/\$\$[\s\S]*?\$\$/g, "'body'").replace(/^--.*$/gm, '');
    assert.doesNotMatch(topLevel, /^\s*(?:UPDATE|INSERT INTO|DELETE FROM|CALL|TRUNCATE)\b/im);
    assert.doesNotMatch(topLevel, /(?:SELECT|PERFORM)\s+public\.fn_tg_(?:approve|resolve|confirm|close|review|finish|claim|reserve|create)/i);
    assert.doesNotMatch(recovery, /UPDATE public\.tg_(?:settings|product_prices)/i);
});

test('builder rejects extra transaction boundaries and unexpected trailing SQL', () => {
    for (const invalid of ['BEGIN;\nBEGIN;\nCOMMIT;\n', 'BEGIN;\nCOMMIT;\nCOMMIT;\n', 'BEGIN;\nCOMMIT;\nSELECT 1;\n']) {
        assert.throws(() => transactionBody(invalid, 'invalid.sql'), /Unexpected transaction/);
    }
});
