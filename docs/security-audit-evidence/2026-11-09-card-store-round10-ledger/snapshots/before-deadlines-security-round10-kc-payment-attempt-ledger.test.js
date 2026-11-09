'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createLedger, LedgerError, validateIntent, validateIdentity, validateOutcome, SQL, STATES,
    MAX_MINOR, MAX_VERSION } = require('../services/kc-pay-gpt/lib/payment-attempt-ledger');
const clone = v => structuredClone(v);
const intent = patch => ({ jobKey: 'JobA', cardId: 1, amountMinor: 2000, currency: 'USD',
    platform: 'chatgpt', planType: 'plus', checkoutHash: 'a'.repeat(64), ...patch });
const identity = row => ({ attemptId: row.attemptId, jobKey: row.jobKey, cardId: row.cardId, version: row.version });
const proof = kind => kind === 'unknown' ? { kind } : { kind, amountMinor: 2000, currency: 'USD',
    checkoutHash: 'a'.repeat(64), providerReferenceHash: 'b'.repeat(64), evidenceHash: 'c'.repeat(64) };
const errorCode = code => error => error instanceof LedgerError && error.code === code;
function row(patch = {}) {
    const state = patch.state || 'prepared';
    const observed = ['paid', 'no_charge', 'settled_paid', 'settled_no_charge'].includes(state);
    return { attempt_id: 'd'.repeat(32), job_key: 'JobA', card_id: 1, attempt_no: 1,
        amount_minor: 2000, currency: 'USD', platform: 'chatgpt', plan_type: 'plus',
        checkout_hash: 'a'.repeat(64), idempotency_key: `kcpa_v1_${'d'.repeat(32)}`,
        state, version: 1, provider_reference_hash: observed ? 'b'.repeat(64) : null,
        evidence_hash: observed ? 'c'.repeat(64) : null, ...patch };
}
// Transactional in-memory interpreter for the exact exported statement set.
// This is NOT MySQL/InnoDB, real index validation, network or crash evidence.
function fixture() {
    let db = { tasks: [{ job_key: 'JobA', execution_mode: 'local_card_pool', status: 'running',
        payment_state: 'not_started', recovery_required: 0, finished_at: null,
        gpt_api_order_id: null, gpt_api_task_id: null, gpt_api_raw: null }],
        cards: [{ id: 1, is_active: 1, in_use: 1, status: '正常', locked_by: 'payment_JobA', payment_attempt_id: null }], attempts: [] };
    const events = [], faults = {};
    let queue = Promise.resolve(), acquisitions = 0;
    const pool = { async getConnection() {
        acquisitions++;
        if (faults.acquire) throw Object.assign(Error('synthetic-private-driver-message'), { code: 'ECONNREFUSED', sql: 'synthetic-secret' });
        const previous = queue; let unlock;
        queue = new Promise(resolve => { unlock = resolve; }); await previous;
        let tx, closed = false, writes = 0;
        const close = () => { if (!closed) { closed = true; unlock(); } };
        const statement = (options, params) => {
            assert.equal(options.timeout, 5000); assert.ok(Array.isArray(params));
            const name = Object.keys(SQL).find(key => SQL[key] === options.sql);
            assert.ok(name, 'unknown SQL must fail the fixture'); events.push(name);
            if (faults.query) throw Error('synthetic query failure'); return name;
        };
        return {
            async beginTransaction() { events.push('begin'); tx = clone(db); if (faults.begin) throw Error('synthetic begin failure'); },
            async query(options, params) {
                const name = statement(options, params);
                if (name === 'task') return [clone(tx.tasks.filter(t => t.job_key.toLowerCase() === params[0].toLowerCase()).slice(0, 1))];
                if (name === 'card') return [clone(tx.cards.filter(c => c.id === params[0]).slice(0, 1))];
                if (name === 'attempt') return [clone(tx.attempts.filter(a => a.attempt_id === params[0]).slice(0, 1))];
                if (name === 'latest') return [clone(tx.attempts.filter(a => a.job_key === params[0]).sort((a, b) => b.attempt_no - a.attempt_no).slice(0, 1))];
                assert.fail('write used through query');
            },
            async execute(options, p) {
                const name = statement(options, p); writes++;
                if (faults.writeAt === writes) throw Error('synthetic write failure');
                if (faults.zeroAt === writes) return [{ affectedRows: 0 }];
                if (faults.twoAt === writes) return [{ affectedRows: 2 }];
                let changed = 0;
                if (name === 'insert') {
                    const a = { attempt_id: p[0], job_key: p[1], card_id: p[2], attempt_no: p[3], amount_minor: p[4],
                        currency: p[5], platform: p[6], plan_type: p[7], checkout_hash: p[8], idempotency_key: p[9],
                        state: 'prepared', version: 0, provider_reference_hash: null, evidence_hash: null };
                    const jobBlocked = x => !['settled_no_charge', 'cancelled'].includes(x.state);
                    const cardBlocked = x => !['settled_paid', 'settled_no_charge', 'cancelled'].includes(x.state);
                    if (tx.attempts.some(x => x.attempt_id === a.attempt_id || x.idempotency_key === a.idempotency_key
                        || (x.job_key === a.job_key && x.attempt_no === a.attempt_no)
                        || (jobBlocked(x) && (x.job_key === a.job_key || x.checkout_hash === a.checkout_hash))
                        || (cardBlocked(x) && x.card_id === a.card_id))) throw Object.assign(Error('synthetic duplicate'), { code: 'ER_DUP_ENTRY' });
                    tx.attempts.push(a); changed = 1;
                } else if (name === 'bind' || name === 'hold') {
                    const id = name === 'bind' ? p[1] : p[0], owner = name === 'bind' ? p[2] : p[1];
                    const c = tx.cards.find(c => c.id === id && c.is_active === 1 && c.in_use === 1 && c.status === '正常'
                        && c.locked_by === owner && (name === 'bind' ? c.payment_attempt_id === null : c.payment_attempt_id === p[2]));
                    if (c) { if (name === 'bind') c.payment_attempt_id = p[0]; else c.status = '支付处理中'; changed = 1; }
                } else if (name === 'started') {
                    const t = tx.tasks.find(t => t.job_key === p[0] && t.status === 'running' && t.recovery_required === 0
                        && t.finished_at === null && ['not_started', 'declined'].includes(t.payment_state));
                    if (t) { t.payment_state = 'started'; changed = 1; }
                } else if (name === 'transition') {
                    const a = tx.attempts.find(a => a.attempt_id === p[3] && a.version === p[4] && a.state === p[5]);
                    if (a) { a.state = p[0]; a.version++; a.provider_reference_hash = p[1]; a.evidence_hash = p[2]; changed = 1; }
                } else assert.fail('read used through execute');
                return [{ affectedRows: changed }];
            },
            async commit() { events.push('commit'); if (faults.commit === 'before') throw Error('synthetic commit failure');
                db = tx; if (faults.commit === 'after') throw Error('synthetic ACK loss'); },
            async rollback() { events.push('rollback'); if (faults.rollback) throw Error('synthetic rollback failure'); },
            release() { events.push('release'); close(); if (faults.release) throw Error('synthetic release failure'); },
            destroy() { events.push('destroy'); close(); if (faults.destroy) throw Error('synthetic destroy failure'); }
        };
    } };
    return { ledger: createLedger(pool), events, faults, state: () => clone(db), mutate: fn => fn(db), acquisitions: () => acquisitions };
}
test('intent and identity copies are immutable, with no normalization of owner or amount', () => {
    const i = intent(); const copy = validateIntent(i); i.amountMinor = 1;
    assert.equal(copy.amountMinor, 2000); assert.ok(Object.isFrozen(copy));
    assert.ok(Object.isFrozen(validateIdentity({ attemptId: 'd'.repeat(32), jobKey: 'JobA', cardId: 1, version: 0 })));
});
for (const patch of [{ jobKey: 'JobA ' }, { jobKey: '' }, { jobKey: 'a'.repeat(49) }, { cardId: '1' }, { cardId: 0 },
    { amountMinor: '2000' }, { amountMinor: 0 }, { amountMinor: -1 }, { amountMinor: 1.2 }, { amountMinor: NaN },
    { amountMinor: MAX_MINOR + 1 }, { currency: 'usd' }, { currency: ' US' }, { platform: 'unknown' },
    { planType: '../plus' }, { checkoutHash: 'cs_test_synthetic' }, { cardNumber: 'must-not-accept' }, { token: 'must-not-accept' }]) {
    test(`invalid intent rejected before adapter access ${JSON.stringify(patch)}`, async () => {
        const f = fixture(); await assert.rejects(() => f.ledger.prepare(intent(patch)), errorCode('ATTEMPT_INPUT_INVALID'));
        assert.equal(f.acquisitions(), 0);
    });
}
for (const value of [null, [], {}, { kind: 'unknown', evidenceHash: 'c'.repeat(64) },
    { ...proof('paid'), verified: true }, { ...proof('paid'), amountMinor: '2000' },
    { ...proof('paid'), providerReferenceHash: 'raw-provider-token' }, { ...proof('no_charge'), currency: 'usd' }]) {
    test(`reject untrusted outcome shape ${JSON.stringify(value)}`, () => assert.throws(() => validateOutcome(value), errorCode('ATTEMPT_INPUT_INVALID')));
}
test('prepare binds a random attempt without holding/submitting or writing sensitive columns', async () => {
    const f = fixture(); const prepared = await f.ledger.prepare(intent());
    assert.match(prepared.attemptId, /^[a-f0-9]{32}$/); assert.equal(prepared.idempotencyKey, `kcpa_v1_${prepared.attemptId}`);
    assert.equal(prepared.state, 'prepared'); assert.equal(prepared.version, 0);
    assert.equal(f.state().cards[0].payment_attempt_id, prepared.attemptId);
    assert.equal(f.state().cards[0].status, '正常'); assert.equal(f.state().tasks[0].payment_state, 'not_started');
    assert.deepEqual(f.events, ['begin', 'task', 'latest', 'card', 'insert', 'bind', 'commit', 'release']);
    assert.doesNotMatch(Object.values(SQL).join('\n'), /card_number|card_cvc|session_payload|email|cdk_code/);
});
test('same task concurrent preparation cannot allocate a second unresolved attempt in the model', async () => {
    const f = fixture(); const results = await Promise.allSettled([f.ledger.prepare(intent()), f.ledger.prepare(intent())]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(f.state().attempts.length, 1);
});
for (const patch of [{ job_key: 'joba' }, { status: 'manual' }, { recovery_required: 1 }, { finished_at: 'synthetic' },
    { execution_mode: 'third_party_api' }, { gpt_api_raw: '{}' }, { payment_state: 'started' }, { payment_state: 'declined' }]) {
    test(`prepare refuses wrong/legacy/unsafe task ${JSON.stringify(patch)}`, async () => {
        const f = fixture(); f.mutate(db => Object.assign(db.tasks[0], patch));
        await assert.rejects(() => f.ledger.prepare(intent())); assert.equal(f.state().attempts.length, 0);
    });
}
for (const patch of [{ locked_by: 'payment_joba' }, { locked_by: 'payment_JobA ' }, { in_use: 0 },
    { is_active: 0 }, { status: '支付处理中' }, { payment_attempt_id: 'e'.repeat(32) }]) {
    test(`prepare refuses non-owned card ${JSON.stringify(patch)}`, async () => {
        const f = fixture(); f.mutate(db => Object.assign(db.cards[0], patch));
        await assert.rejects(() => f.ledger.prepare(intent()), errorCode('ATTEMPT_CARD_OWNERSHIP_LOST'));
        assert.equal(f.state().attempts.length, 0);
    });
}
test('active checkout cannot be used by a different task/card in the constraint model', async () => {
    const f = fixture(); await f.ledger.prepare(intent());
    f.mutate(db => { db.tasks.push({ ...db.tasks[0], job_key: 'JobB' }); db.cards.push({ ...db.cards[0], id: 2, locked_by: 'payment_JobB', payment_attempt_id: null }); });
    await assert.rejects(() => f.ledger.prepare(intent({ jobKey: 'JobB', cardId: 2 })), errorCode('ATTEMPT_STORAGE_UNCONFIRMED'));
    assert.equal(f.state().attempts.length, 1); assert.equal(f.state().cards[1].payment_attempt_id, null);
});
test('dispatch commits card hold, task start and one-shot state before the callback', async () => {
    const f = fixture(); const prepared = await f.ledger.prepare(intent()); let calls = 0;
    const out = await f.ledger.dispatch(identity(prepared), async armed => {
        calls++; assert.equal(armed.state, 'armed'); assert.ok(Object.isFrozen(armed));
        assert.equal(f.events.at(-1), 'release'); assert.equal(f.state().cards[0].status, '支付处理中');
        assert.equal(f.state().tasks[0].payment_state, 'started'); assert.equal(f.state().attempts[0].state, 'armed'); return 'synthetic-result';
    });
    assert.equal(out.result, 'synthetic-result'); assert.equal(out.attempt.version, 1);
    await assert.rejects(() => f.ledger.dispatch(identity(prepared), async () => { calls++; })); assert.equal(calls, 1);
});
test('two concurrent dispatches never authorize two callback invocations in the transaction model', async () => {
    const f = fixture(); const p = await f.ledger.prepare(intent()); let calls = 0;
    const results = await Promise.allSettled([0, 1].map(() => f.ledger.dispatch(identity(p), async () => { calls++; })));
    assert.equal(calls, 1); assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
});
for (const patch of [{ attemptId: 'e'.repeat(32) }, { cardId: 2 }, { jobKey: 'joba' }, { version: 1 }]) {
    test(`dispatch rejects stale/cross-resource identity ${JSON.stringify(patch)}`, async () => {
        const f = fixture(); const p = await f.ledger.prepare(intent()); let called = false;
        await assert.rejects(() => f.ledger.dispatch({ ...identity(p), ...patch }, async () => { called = true; }));
        assert.equal(called, false); assert.equal(f.state().attempts[0].state, 'prepared');
    });
}
test('same-owner ABA with a changed attempt fence blocks an old continuation', async () => {
    const f = fixture(); const p = await f.ledger.prepare(intent()); let called = false;
    f.mutate(db => { db.cards[0].payment_attempt_id = 'e'.repeat(32); });
    await assert.rejects(() => f.ledger.dispatch(identity(p), async () => { called = true; }), errorCode('ATTEMPT_CARD_OWNERSHIP_LOST'));
    assert.equal(called, false); assert.equal(f.state().cards[0].status, '正常');
});
for (const fault of ['writeAt', 'zeroAt', 'twoAt']) for (const step of [1, 2, 3]) {
    test(`atomic arm failure ${fault}=${step} never dispatches or leaves partial state in model`, async () => {
        const f = fixture(); const p = await f.ledger.prepare(intent()); const before = f.state(); let called = false;
        f.faults[fault] = step;
        await assert.rejects(() => f.ledger.dispatch(identity(p), async () => { called = true; }));
        assert.equal(called, false); assert.deepEqual(f.state(), before);
    });
}
for (const phase of ['before', 'after']) {
    test(`ambiguous ${phase}-commit failure never dispatches even if rollback/destroy fail`, async () => {
        const f = fixture(); const p = await f.ledger.prepare(intent()); let calls = 0;
        Object.assign(f.faults, { commit: phase, rollback: true, destroy: true });
        await assert.rejects(() => f.ledger.dispatch(identity(p), async () => { calls++; }), errorCode('ATTEMPT_STORAGE_UNCONFIRMED'));
        assert.equal(calls, 0); assert.equal(f.state().attempts[0].state, phase === 'after' ? 'armed' : 'prepared');
        if (phase === 'after') assert.equal(f.state().cards[0].status, '支付处理中');
    });
}
test('lost preparation ACK leaves the durable prepared attempt blocking a blind retry', async () => {
    const f = fixture(); f.faults.commit = 'after';
    await assert.rejects(() => f.ledger.prepare(intent()), errorCode('ATTEMPT_STORAGE_UNCONFIRMED'));
    f.faults.commit = null;
    await assert.rejects(() => f.ledger.prepare(intent()), errorCode('ATTEMPT_PREVIOUS_UNRESOLVED'));
    assert.equal(f.state().attempts.length, 1);
});
test('release failure after commit withholds dispatch permission', async () => {
    const f = fixture(); const p = await f.ledger.prepare(intent()); f.faults.release = true; let called = false;
    await assert.rejects(() => f.ledger.dispatch(identity(p), async () => { called = true; }), errorCode('ATTEMPT_STORAGE_UNCONFIRMED'));
    assert.equal(called, false); assert.equal(f.state().attempts[0].state, 'armed');
});
for (const observationFails of [false, true]) {
    test(`callback exception is unknown with no unlock or fallback; observationFails=${observationFails}`, async () => {
        const f = fixture(); const p = await f.ledger.prepare(intent()); let calls = 0;
        await assert.rejects(() => f.ledger.dispatch(identity(p), async () => {
            calls++; if (observationFails) f.faults.acquire = true; throw Error('synthetic raw token');
        }), errorCode('ATTEMPT_RESULT_UNKNOWN'));
        assert.equal(calls, 1); assert.equal(f.state().attempts[0].state, observationFails ? 'armed' : 'unknown');
        assert.equal(f.state().cards[0].status, '支付处理中'); assert.equal(f.state().tasks[0].payment_state, 'started');
    });
}
for (const state of STATES) for (const kind of ['unknown', 'paid', 'no_charge']) {
    test(`outcome state matrix ${state} -> ${kind}`, async () => {
        const f = fixture(); const stored = row({ state }); f.mutate(db => { db.attempts = [stored]; db.tasks[0].payment_state = 'started'; });
        const id = { attemptId: stored.attempt_id, jobKey: stored.job_key, cardId: 1, version: 1 };
        const same = state === kind; const allowed = ['armed', 'unknown'].includes(state) || same;
        if (allowed) {
            const result = await f.ledger.observe(id, proof(kind)); assert.equal(result.state, kind);
            assert.equal(result.version, same ? 1 : 2);
        } else await assert.rejects(() => f.ledger.observe(id, proof(kind)), errorCode('ATTEMPT_TRANSITION_REFUSED'));
        assert.equal(f.state().cards[0].status, '正常', 'observation never mutates/releases a card');
    });
}
for (const patch of [{ amountMinor: 1 }, { currency: 'EUR' }, { checkoutHash: 'f'.repeat(64) }]) {
    test(`proof binding mismatch refuses settlement evidence ${JSON.stringify(patch)}`, async () => {
        const f = fixture(); const p = await f.ledger.prepare(intent()); const armed = (await f.ledger.dispatch(identity(p), async () => null)).attempt;
        await assert.rejects(() => f.ledger.observe(identity(armed), { ...proof('paid'), ...patch }), errorCode('ATTEMPT_EVIDENCE_MISMATCH'));
        assert.equal(f.state().attempts[0].state, 'armed');
    });
}
test('identical evidence may be replayed but never reopens dispatch or releases a card', async () => {
    const f = fixture(); const p = await f.ledger.prepare(intent()); let calls = 0;
    const armed = (await f.ledger.dispatch(identity(p), async () => { calls++; })).attempt;
    const paid = await f.ledger.observe(identity(armed), proof('paid'));
    const again = await f.ledger.observe(identity(armed), proof('paid')); assert.deepEqual(again, paid);
    await assert.rejects(() => f.ledger.dispatch(identity(p), async () => { calls++; }));
    await assert.rejects(() => f.ledger.observe(identity(paid), proof('unknown')), errorCode('ATTEMPT_TRANSITION_REFUSED'));
    assert.equal(calls, 1); assert.equal(f.state().cards[0].status, '支付处理中');
});
test('version overflow fails closed', async () => {
    const f = fixture(); const p = await f.ledger.prepare(intent()); f.mutate(db => { db.attempts[0].version = MAX_VERSION; }); let called = false;
    await assert.rejects(() => f.ledger.dispatch({ ...identity(p), version: MAX_VERSION }, async () => { called = true; }), errorCode('ATTEMPT_VERSION_EXHAUSTED'));
    assert.equal(called, false);
});
test('adapter failure errors do not retain raw SQL, credentials, cause or driver message', async () => {
    const f = fixture(); f.faults.acquire = true;
    await assert.rejects(() => f.ledger.prepare(intent()), error => {
        assert.equal(error.code, 'ATTEMPT_STORAGE_UNCONFIRMED');
        assert.doesNotMatch(JSON.stringify(error) + error.stack, /synthetic-private|synthetic-secret/);
        assert.equal(error.cause, undefined); return true;
    });
});
test('draft is not bootstrap, has unresolved-uniqueness/fence design and no live wiring', () => {
    const root = path.resolve(__dirname, '..');
    const sql = fs.readFileSync(path.join(root, 'services/kc-pay-gpt/acceptance/payment-attempt-ledger/20261109-ledger-DRAFT.sql'), 'utf8');
    for (const key of ['uq_kc_attempt_active_job', 'uq_kc_attempt_active_card', 'uq_kc_attempt_active_checkout', 'payment_attempt_id']) assert.ok(sql.includes(key));
    assert.match(sql, /DRAFT \/ REVIEW ONLY \/ NOT EXECUTED/);
    for (const file of ['mysql-store.js', 'payment-retry.js', 'index.js', 'server.js', 'chatgpt.js']) {
        assert.doesNotMatch(fs.readFileSync(path.join(root, 'services/kc-pay-gpt', file), 'utf8'), /require\([^\n]*payment-attempt-ledger/);
    }
    assert.doesNotMatch(fs.readFileSync(path.join(root, 'services/kc-pay-gpt/mysql-schema.sql'), 'utf8'), /kc_local_payment_attempts/);
});
