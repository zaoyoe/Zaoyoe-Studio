'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createLedger, LedgerError, MAX_VERSION } = require('../services/kc-pay-gpt/lib/payment-attempt-ledger');
const { SQL } = require('../services/kc-pay-gpt/lib/payment-attempt-settlement');
const clone = structuredClone;
const attemptId = 'd'.repeat(32), fulfillment = 'e'.repeat(64);
const identity = patch => ({ attemptId, jobKey: 'JobA', cardId: 1, version: 2, ...patch });
const code = value => e => e instanceof LedgerError && e.code === value;

// Exact-statement transactional model, not MySQL, DDL, network or crash proof.
// The connection is never shared concurrently; each transaction sees a copy.
function fixture(kind = 'paid', timeoutMs = 30) {
    let db = {
        task: { job_key: 'JobA', cdk_code: 'offline-only-cdk', execution_mode: 'local_card_pool', status: 'running',
            payment_state: 'started', recovery_required: 0, finished_at: null,
            gpt_api_order_id: null, gpt_api_task_id: null, gpt_api_raw: null,
            session_payload: 'synthetic-session', session_payload_encrypted: 'synthetic-ciphertext' },
        cdk: { cdk_code: 'offline-only-cdk', is_active: 1, type: '自助', used_at: 'synthetic-used', platform: 'chatgpt', plan_type: 'plus' },
        owner: 'JobA', blockers: [],
        card: { id: 1, is_active: 1, in_use: 1, status: '支付处理中', locked_by: 'payment_JobA',
            payment_attempt_id: attemptId, card_last4: '0000', usage_count: 6, daily_usage_count: 2, reset_daily: 0,
            cooldown_until: 0 },
        attempt: { attempt_id: attemptId, job_key: 'JobA', card_id: 1, attempt_no: 1, amount_minor: 2000,
            currency: 'USD', platform: 'chatgpt', plan_type: 'plus', checkout_hash: 'a'.repeat(64),
            idempotency_key: `kcpa_v1_${attemptId}`, state: kind, version: 2,
            provider_reference_hash: 'b'.repeat(64), evidence_hash: 'c'.repeat(64),
            settlement_billing_id: null, settlement_daily_count: null, settlement_cooled_down: null, fulfillment_evidence_hash: null },
        bills: []
    };
    const events = [], faults = {};
    let queue = Promise.resolve(), acquisitions = 0;
    const pool = { async getConnection() {
        acquisitions++;
        if (faults.acquire) throw Error('synthetic-private-driver-data');
        const prior = queue; let unlock; queue = new Promise(resolve => { unlock = resolve; }); await prior;
        let tx, closed = false, writes = 0;
        const close = () => { if (!closed) { closed = true; unlock(); } };
        const statement = (options, params) => {
            assert.equal(options.timeout, timeoutMs); assert.ok(Array.isArray(params));
            const name = Object.keys(SQL).find(k => SQL[k] === options.sql);
            assert.ok(name, 'unexpected SQL'); events.push(name); return name;
        };
        return {
            async beginTransaction() { events.push('begin'); tx = clone(db); if (faults.begin) throw Error('synthetic begin'); },
            async query(options, p) {
                const name = statement(options, p);
                if (faults.pending === name) return new Promise(() => {});
                if (faults.query === name) throw Error('synthetic-private-driver-data');
                if (name === 'hint') return [[{ job_key: tx.task.job_key, cdk_code: tx.task.cdk_code }]];
                if (name === 'cdk') return [tx.cdk ? [clone(tx.cdk)] : []];
                if (name === 'task') { if (faults.rebind) tx.task.cdk_code = 'different-cdk'; return [[clone(tx.task)]]; }
                if (name === 'owner') return [tx.owner ? [{ job_key: tx.owner }] : []];
                if (name === 'blockers') return [clone(tx.blockers)];
                if (name === 'attempt') return [tx.attempt.attempt_id === p[0] ? [clone(tx.attempt)] : []];
                if (name === 'card') return [tx.card ? [clone(tx.card)] : []];
                if (name === 'billing') return [clone(tx.bills.filter(b => b.local_payment_attempt_id === p[0]))];
                assert.fail('write through query');
            },
            async execute(options, p) {
                const name = statement(options, p); writes++;
                if (faults.pending === name) return new Promise(() => {});
                if (faults.writeAt === writes) throw Error('synthetic-private-driver-data');
                if (faults.zeroAt === writes) return [{ affectedRows: 0 }];
                if (faults.twoAt === writes) return [{ affectedRows: 2 }];
                if (name === 'insertBilling') {
                    if (tx.bills.some(b => b.local_payment_attempt_id === p[0])) throw Error('duplicate');
                    tx.bills.push({ id: 17, local_payment_attempt_id: p[0], card_last4: p[1], amount: p[2], currency: p[3], platform: p[4], plan_type: p[5], status: 'success' });
                } else if (name === 'paidCard' || name === 'noChargeCard') {
                    const offset = name === 'paidCard' ? 3 : 0, card = tx.card;
                    if (!card || card.id !== p[offset] || card.is_active !== 1 || card.in_use !== 1
                        || card.status !== '支付处理中' || card.locked_by !== p[offset + 1] || card.payment_attempt_id !== p[offset + 2]) return [{ affectedRows: 0 }];
                    if (name === 'paidCard') {
                        card.usage_count++; card.daily_usage_count = p[0]; if (p[1]) card.reset_daily = 0;
                        if (p[2]) card.cooldown_until = Math.max(card.cooldown_until, 24 * 60);
                    } else card.cooldown_until = Math.max(card.cooldown_until, 30);
                    Object.assign(card, { in_use: 0, locked_by: null, payment_attempt_id: null, status: '正常' });
                } else if (name === 'paidCdk' || name === 'noChargeCdk') {
                    if (!tx.cdk || tx.cdk.cdk_code !== p[0] || tx.cdk.is_active !== 1 || !tx.cdk.used_at) return [{ affectedRows: 0 }];
                    if (name === 'noChargeCdk') tx.cdk.used_at = null;
                    else Object.assign(tx.cdk, { fail_count: 0, cooldown_until: null });
                } else if (name === 'terminalTask') {
                    const task = tx.task;
                    if (task.job_key !== p[4] || task.cdk_code !== p[5] || task.execution_mode !== 'local_card_pool'
                        || !['running', 'manual'].includes(task.status) || task.finished_at || !['started', 'unknown'].includes(task.payment_state)
                        || task.gpt_api_order_id != null || task.gpt_api_task_id != null || task.gpt_api_raw != null) return [{ affectedRows: 0 }];
                    Object.assign(task, { status: p[0], payment_state: p[1], recovery_required: 0, progress: p[2], message: p[3],
                        finished_at: 'synthetic-finished', session_payload: null, session_payload_encrypted: null });
                } else if (name === 'terminalAttempt') {
                    const a = tx.attempt;
                    if (a.attempt_id !== p[5] || a.version !== p[6] || a.state !== p[7]) return [{ affectedRows: 0 }];
                    Object.assign(a, { state: p[0], version: a.version + 1, settlement_billing_id: p[1],
                        settlement_daily_count: p[2], settlement_cooled_down: p[3], fulfillment_evidence_hash: p[4] });
                } else assert.fail('read through execute');
                return [{ affectedRows: 1 }];
            },
            async commit() { events.push('commit'); if (faults.commit === 'before') throw Error('synthetic commit rejected');
                db = tx; if (faults.commit === 'after') throw Error('synthetic ACK lost'); },
            async rollback() { events.push('rollback'); if (faults.rollback) throw Error('synthetic rollback'); },
            release() { events.push('release'); close(); if (faults.release) throw Error('synthetic release'); },
            destroy() { events.push('destroy'); close(); }
        };
    } };
    const ledger = createLedger(pool, { timeoutMs });
    return { ledger, faults, events, acquisitions: () => acquisitions, state: () => clone(db), mutate: fn => fn(db),
        settle: (i = identity(), hash = fulfillment) => kind === 'paid' ? ledger.settlePaid(i, hash) : ledger.settleNoCharge(i) };
}

test('paid settlement commits one bill, usage, release, task, credential clearing and receipt together', async () => {
    const f = fixture(); const r = await f.settle(); const db = f.state();
    assert.equal(r.state, 'settled_paid'); assert.equal(r.version, 3); assert.equal(r.billingId, 17);
    assert.equal(r.dailyUsageCount, 3); assert.equal(r.cooledDown, true); assert.ok(Object.isFrozen(r));
    assert.equal(db.bills.length, 1); assert.equal(db.bills[0].amount, '20.00');
    assert.equal(db.card.usage_count, 7); assert.equal(db.card.payment_attempt_id, null); assert.equal(db.card.in_use, 0);
    assert.equal(db.task.status, 'success'); assert.equal(db.task.payment_state, 'succeeded'); assert.equal(db.task.session_payload, null);
    assert.equal(db.task.session_payload_encrypted, null); assert.ok(db.cdk.used_at);
    assert.deepEqual(f.events.slice(0, 9), ['begin', 'hint', 'cdk', 'task', 'owner', 'blockers', 'attempt', 'billing', 'card']);
    assert.deepEqual(f.events.slice(-2), ['commit', 'release']);
    assert.doesNotMatch(JSON.stringify(r), /offline-only-cdk|synthetic-session|synthetic-ciphertext/);
    assert.doesNotMatch(SQL.insertBilling, /card_number|card_cvc|session|email|cdk_code/);
});
test('confirmed no-charge returns CDK and card, does not bill/count usage, and clears credentials', async () => {
    const f = fixture('no_charge'); const r = await f.settle(); const db = f.state();
    assert.equal(r.state, 'settled_no_charge'); assert.equal(r.billingId, null); assert.equal(r.dailyUsageCount, null);
    assert.equal(db.bills.length, 0); assert.equal(db.card.usage_count, 6); assert.equal(db.card.cooldown_until, 30);
    assert.equal(db.cdk.used_at, null); assert.equal(db.task.status, 'failed'); assert.equal(db.task.session_payload_encrypted, null);
});
for (const kind of ['paid', 'no_charge']) {
    test(`${kind}: concurrent settlement and later replay never repeat effects`, async () => {
        const f = fixture(kind); const [a, b] = await Promise.all([f.settle(), f.settle()]);
        assert.deepEqual(a, b);
        f.mutate(db => { db.card = { id: 1, in_use: 1, locked_by: 'payment_JobB', payment_attempt_id: 'f'.repeat(32) };
            db.owner = 'JobB'; db.cdk.used_at = 'owned-by-new-job'; db.blockers = [{ job_key: 'JobB' }]; });
        const before = f.state(), eventStart = f.events.length;
        assert.deepEqual(await f.settle(), a); assert.deepEqual(await f.settle(identity({ version: 3 })), a);
        assert.deepEqual(f.state(), before); assert.ok(!f.events.slice(eventStart).some(e => ['card', 'paidCard', 'noChargeCard', 'terminalTask', 'terminalAttempt'].includes(e)));
    });
    for (const faultName of ['writeAt', 'zeroAt', 'twoAt']) {
        for (let n = 1; n <= (kind === 'paid' ? 5 : 4); n++) {
            test(`${kind}: ${faultName} ${n} rolls back the complete settlement`, async () => {
                const f = fixture(kind), before = f.state(); f.faults[faultName] = n;
                await assert.rejects(f.settle()); assert.deepEqual(f.state(), before);
                assert.ok(f.events.includes('rollback')); assert.ok(f.events.includes('destroy')); assert.ok(!f.events.includes('release'));
            });
        }
    }
    for (const phase of ['before', 'after']) {
        test(`${kind}: COMMIT ${phase} failure returns unconfirmed and a retry settles once`, async () => {
            const f = fixture(kind), before = f.state(); f.faults.commit = phase;
            await assert.rejects(f.settle(), code('ATTEMPT_STORAGE_UNCONFIRMED'));
            if (phase === 'before') assert.deepEqual(f.state(), before);
            else assert.equal(f.state().attempt.state, `settled_${kind}`);
            delete f.faults.commit; await f.settle();
            assert.equal(f.state().bills.length, kind === 'paid' ? 1 : 0); assert.equal(f.state().card.usage_count, kind === 'paid' ? 7 : 6);
        });
    }
}
for (const [name, mutate, expected] of [
    ['owner changed', db => { db.owner = 'JobB'; }, 'ATTEMPT_CDK_OWNER_MISMATCH'],
    ['case-sensitive owner', db => { db.card.locked_by = 'payment_joba'; }, 'ATTEMPT_CARD_OWNERSHIP_LOST'],
    ['same-owner new fence', db => { db.card.payment_attempt_id = 'f'.repeat(32); }, 'ATTEMPT_CARD_OWNERSHIP_LOST'],
    ['unowned', db => { db.card.in_use = 0; }, 'ATTEMPT_CARD_OWNERSHIP_LOST'],
    ['manual card', db => { db.card.status = '待人工复核'; }, 'ATTEMPT_CARD_OWNERSHIP_LOST'],
    ['inactive card', db => { db.card.is_active = 0; }, 'ATTEMPT_CARD_OWNERSHIP_LOST'],
    ['missing card', db => { db.card = null; }, 'ATTEMPT_CARD_OWNERSHIP_LOST'],
    ['other task blocked', db => { db.blockers.push({ job_key: 'old-job' }); }, 'ATTEMPT_OTHER_TASK_BLOCKED'],
    ['inactive CDK', db => { db.cdk.is_active = 0; }, 'ATTEMPT_CDK_MISMATCH'],
    ['unused CDK', db => { db.cdk.used_at = null; }, 'ATTEMPT_CDK_MISMATCH'],
    ['CDK plan changed', db => { db.cdk.plan_type = 'pro'; }, 'ATTEMPT_CDK_MISMATCH'],
    ['CDK platform changed', db => { db.cdk.platform = 'grok'; }, 'ATTEMPT_CDK_MISMATCH'],
    ['finished task', db => { db.task.finished_at = 'synthetic'; }, 'ATTEMPT_TASK_BLOCKED'],
    ['not started task', db => { db.task.payment_state = 'not_started'; }, 'ATTEMPT_TASK_BLOCKED'],
    ['provider task', db => { db.task.execution_mode = 'third_party_api'; }, 'ATTEMPT_TASK_MISMATCH'],
    ['legacy provider evidence', db => { db.task.gpt_api_raw = '{}'; }, 'ATTEMPT_TASK_MISMATCH'],
    ['stale version', db => { db.attempt.version = 3; }, 'ATTEMPT_VERSION_CONFLICT'],
    ['exhausted version', db => { db.attempt.version = MAX_VERSION; }, 'ATTEMPT_VERSION_EXHAUSTED']
]) {
    test(`settlement refuses ${name} without partial effects`, async () => {
        const f = fixture(); f.mutate(mutate); const before = f.state();
        const id = name === 'exhausted version' ? identity({ version: MAX_VERSION }) : identity();
        await assert.rejects(f.settle(id), code(expected)); assert.deepEqual(f.state(), before);
    });
}
for (const state of ['prepared', 'armed', 'unknown', 'no_charge', 'cancelled']) {
    test(`paid settlement never infers success from ${state}`, async () => {
        const f = fixture(state);
        f.mutate(db => { if (!['paid', 'no_charge'].includes(state)) Object.assign(db.attempt, { provider_reference_hash: null, evidence_hash: null }); });
        const before = f.state(); await assert.rejects(f.ledger.settlePaid(identity(), fulfillment)); assert.deepEqual(f.state(), before);
    });
}
test('paid evidence alone cannot assert fulfillment', async () => {
    const f = fixture(); for (const hash of [null, '', {}, 'verified', 'E'.repeat(64)]) await assert.rejects(f.settle(identity(), hash), code('ATTEMPT_FULFILLMENT_UNCONFIRMED'));
    assert.equal(f.acquisitions(), 0);
});
test('CDK locator is rechecked after the lock, never switched under a stale hint', async () => {
    const f = fixture(); f.faults.rebind = true; const before = f.state();
    await assert.rejects(f.settle(), code('ATTEMPT_TASK_MISMATCH')); assert.deepEqual(f.state(), before);
});
test('verified unknown manual task can be reconciled without a second payment', async () => {
    const f = fixture(); f.mutate(db => Object.assign(db.task, { status: 'manual', payment_state: 'unknown', recovery_required: 1 }));
    await f.settle(); assert.equal(f.state().task.status, 'success'); assert.equal(f.state().task.recovery_required, 0);
});
test('release ACK failure remains unconfirmed; durable settlement is replayable', async () => {
    const f = fixture(); f.faults.release = true; await assert.rejects(f.settle(), code('ATTEMPT_STORAGE_UNCONFIRMED'));
    delete f.faults.release; await f.settle(); assert.equal(f.state().card.usage_count, 7);
});
for (const [currency, minor, amount] of [['USD', 1, '0.01'], ['PHP', 2000, '20.00'], ['CLP', 123, '123.00'], ['USD', 9999999999, '99999999.99']]) {
    test(`exact decimal conversion ${currency}/${minor}`, async () => {
        const f = fixture(); f.mutate(db => Object.assign(db.attempt, { currency, amount_minor: minor }));
        await f.settle(); assert.equal(f.state().bills[0].amount, amount);
    });
}
for (const patch of [{ currency: 'JPY' }, { amount_minor: 10000000000 }, { currency: 'CLP', amount_minor: 100000000 }]) {
    test(`unsupported or unrepresentable billing amount is held ${JSON.stringify(patch)}`, async () => {
        const f = fixture(); f.mutate(db => Object.assign(db.attempt, patch)); const before = f.state();
        await assert.rejects(f.settle()); assert.deepEqual(f.state(), before);
    });
}
test('reset daily count and an existing longer cooldown are preserved', async () => {
    const f = fixture(); f.mutate(db => Object.assign(db.card, { reset_daily: 1, daily_usage_count: 9, cooldown_until: 5000 }));
    const r = await f.settle(); assert.equal(r.dailyUsageCount, 1); assert.equal(r.cooledDown, false); assert.equal(f.state().card.cooldown_until, 5000);
});
for (const corrupt of [db => { db.bills[0].amount = '20.01'; }, db => { db.attempt.settlement_daily_count = null; },
    db => { db.bills.length = 0; }, db => { db.attempt.settlement_billing_id = 99; }]) {
    test('corrupt receipt/billing never authorizes replay effects', async () => {
        const f = fixture(); await f.settle(); f.mutate(corrupt); const before = f.state();
        await assert.rejects(f.settle()); assert.deepEqual(f.state(), before);
    });
}
test('replay cannot change fulfillment evidence or settlement kind', async () => {
    const f = fixture(); await f.settle(); await assert.rejects(f.settle(identity(), 'f'.repeat(64)), code('ATTEMPT_SETTLEMENT_CONFLICT'));
    await assert.rejects(f.ledger.settleNoCharge(identity()), code('ATTEMPT_SETTLEMENT_CONFLICT'));
});
test('storage failures and query deadlines remain bounded and redact raw driver data', async () => {
    for (const fault of [{ acquire: true }, { begin: true }, { query: 'billing', rollback: true }, { pending: 'card' }]) {
        const f = fixture('paid', 10); Object.assign(f.faults, fault); const before = f.state();
        await assert.rejects(f.settle(), e => code('ATTEMPT_STORAGE_UNCONFIRMED')(e) && !e.cause && !JSON.stringify(e).includes('synthetic-private'));
        assert.deepEqual(f.state(), before);
    }
});
test('both schema drafts remain review-only and live callers remain absent', () => {
    const root = path.resolve(__dirname, '..');
    const draft = fs.readFileSync(path.join(root, 'services/kc-pay-gpt/acceptance/payment-attempt-ledger/20261109-settlement-DRAFT.sql'), 'utf8');
    assert.match(draft, /DRAFT ONLY \/ NOT EXECUTED/); assert.match(draft, /UNIQUE KEY uq_billing_local_payment_attempt/);
    assert.match(draft, /ON DELETE RESTRICT/); assert.match(draft, /ck_kc_attempt_settlement_receipt/);
    for (const file of ['server.js', 'index.js', 'chatgpt.js', 'payment-retry.js', 'stripe-protocol-payment.js', 'mysql-store.js']) {
        assert.doesNotMatch(fs.readFileSync(path.join(root, 'services/kc-pay-gpt', file), 'utf8'), /require\([^)]*payment-attempt-(?:ledger|settlement)/);
    }
    assert.doesNotMatch(fs.readFileSync(path.join(root, 'services/kc-pay-gpt/mysql-schema.sql'), 'utf8'), /local_payment_attempt_id|settlement_billing_id/);
});
