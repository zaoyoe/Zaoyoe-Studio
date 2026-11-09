'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const runtime = path.resolve(__dirname, '../services/kc-pay-gpt/mysql-store.js');
const source = fs.readFileSync(runtime, 'utf8'), runtimeRequire = createRequire(runtime);
const clone = structuredClone;
const owner = 'payment_JobA';
const base = patch => ({ id: 1, card_number: 'offline-card', status: '正常', in_use: 1, is_active: 1,
    locked_by: owner, payment_attempt_id: 'd'.repeat(32), usage_count: 0, daily_usage_count: 0,
    daily_usage_reset_at: null, cooldown_until: null, ...patch });

// Bounded SQL predicate model for the legacy store. The guard column can be
// declared absent to prove that default-off paths do not require draft DDL.
function fixture({ mode = 'enforce', card = base(), schemaMissing = false, duplicate = false, provider = false } = {}) {
    let state = { card: clone(card), touches: 0, inserted: 0 };
    const events = []; let snapshot;
    const task = { id: 3, job_key: 'JobA', cdk_code: 'offline-cdk', execution_mode: 'third_party_api',
        gpt_api_raw: JSON.stringify({ attempt: { version: 1, jobKey: 'JobA', cardAssetId: 1, dispatchStarted: false } }) };
    const query = async (raw, params = []) => {
        const sql = raw.replace(/\s+/g, ' ').trim(); events.push(sql);
        if (schemaMissing && /payment_attempt_id/.test(sql)) throw Error('synthetic unknown column');
        if (/FROM task_logs WHERE job_key/.test(sql)) return [[clone(task)]];
        if (/FROM task_logs WHERE cdk_code/.test(sql)) return [[{ job_key: 'JobA' }]];
        if (/FROM cdk_codes/.test(sql)) return [[{ is_active: 1, used_at: 'synthetic-used', cdk_code: 'offline-cdk' }]];
        if (/FROM proxy_assets|FROM app_config/.test(sql)) return [[]];
        if (/FROM phone_assets/.test(sql)) return [[]];
        if (/^(UPDATE|DELETE FROM) (phone_assets|pool_emails)/.test(sql)) return [{ affectedRows: 0 }];
        if (/^(UPDATE|INSERT INTO) task_logs/.test(sql)) return [{ affectedRows: 1 }];
        if (/^(UPDATE|INSERT INTO) cdk_codes/.test(sql)) throw Error('unexpected CDK mutation');
        if (/^DELETE FROM billing_records/.test(sql)) return [{ affectedRows: 0 }];
        if (!/\bcard_assets\b/.test(sql)) throw Error(`unmodelled SQL: ${sql}`);
        if (/^SELECT id FROM card_assets WHERE card_number = \? FOR UPDATE$/.test(sql)) {
            return [state.card ? duplicate ? [{ id: 1 }, { id: 2 }] : [{ id: 1 }] : []];
        }
        if (/^INSERT INTO card_assets/.test(sql)) { state.inserted++; return [{ affectedRows: 1 }]; }
        const where = sql.slice(sql.indexOf(' WHERE '));
        const card = state.card;
        let eligible = Boolean(card);
        if (/payment_attempt_id IS NULL/.test(where) && card?.payment_attempt_id != null) eligible = false;
        if (/\bin_use = 0/.test(where) && card?.in_use !== 0) eligible = false;
        if (/\bin_use = 1/.test(where) && card?.in_use !== 1) eligible = false;
        if (/\blocked_by IS NULL/.test(where) && card?.locked_by != null) eligible = false;
        if (/\bis_active = 1/.test(where) && card?.is_active !== 1) eligible = false;
        const status = where.match(/\bstatus = '([^']+)'/);
        if (status && card?.status !== status[1]) eligible = false;
        const statuses = where.match(/\bstatus IN \(([^)]+)\)/);
        if (statuses && ![...statuses[1].matchAll(/'([^']+)'/g)].some(x => x[1] === card?.status)) eligible = false;
        const set = sql.slice(0, sql.indexOf(' WHERE '));
        const offset = (set.match(/\?/g) || []).length;
        if (/WHERE id = \?/.test(where) && card?.id !== params[offset]) eligible = false;
        if (/CAST\(locked_by AS BINARY\) = CAST\(\? AS BINARY\)/.test(where)
            && card?.locked_by !== params[offset + (/WHERE id = \?/.test(where) ? 1 : 0)]) eligible = false;
        if (/^SELECT/.test(sql)) return [eligible ? [clone(card)] : []];
        if (!eligible) return [{ affectedRows: 0 }];
        state.touches++;
        if (/^DELETE/.test(sql)) state.card = null;
        else {
            if (/SET in_use = 1/.test(set)) Object.assign(card, { in_use: 1, locked_by: params[0] });
            if (/in_use = 0/.test(set)) Object.assign(card, { in_use: 0, locked_by: null });
            const nextStatus = set.match(/status = '([^']+)'/); if (nextStatus) card.status = nextStatus[1];
            if (/card_expiry = \?/.test(set)) card.card_expiry = params[0];
            if (/cooldown_until = NULL/.test(set)) card.cooldown_until = null;
        }
        return [{ affectedRows: 1 }];
    };
    const connection = { query, execute: query,
        beginTransaction: async () => { snapshot = clone(state); }, commit: async () => {},
        rollback: async () => { state = clone(snapshot); }, release: () => {} };
    const pool = { query, execute: query, getConnection: async () => connection };
    const module = { exports: {} };
    vm.runInNewContext(source, { module, exports: module.exports, __dirname: path.dirname(runtime), Buffer, URL, console,
        process: { env: mode == null ? {} : { KC_PAYMENT_ATTEMPT_ASSET_GUARD: mode } },
        require: name => name === 'mysql2/promise' ? { createPool: () => pool } : runtimeRequire(name)
    }, { filename: runtime });
    return { store: module.exports, events, state: () => clone(state), provider };
}
const calls = {
    release: f => f.store.releaseCard(1, owner),
    runtimeRelease: f => f.store.releaseRuntimeAssets({ cardAssetId: 1, ownerKey: owner }),
    staleCleanup: f => f.store.releaseStaleAssetLocks(),
    startupCleanup: f => f.store.resetAllAssetLocks(),
    ownerCleanup: f => f.store.releaseCardsByOwner('JobA'),
    markStarted: f => f.store.markCardPaymentStarted(1, owner),
    complete: f => f.store.completeCardPayment(1, owner),
    cooldown: f => f.store.cooldownCard(1, 30, owner),
    quarantine: f => f.store.quarantineCardForReview(1, 'synthetic', owner),
    exhausted: f => f.store.markCardExhausted(1, owner),
    usage: f => f.store.recordCardUsage(1, owner),
    profile: f => f.store.bindCardPaymentProfile(1, {}, owner),
    freeze: f => f.store.setCardFrozen(1),
    unfreeze: f => f.store.setCardFrozen(1, false),
    resetCooldown: f => f.store.resetIdleCardCooldown(1),
    deleteById: f => f.store.deleteIdleCardById(1),
    deleteByPan: f => f.store.deleteCardAsset('offline-card'),
    bulkEmpty: f => f.store.saveConfig({ card_pool: [] }),
    bulkUpdate: f => f.store.saveConfig({ card_pool: [{ number: 'offline-card', expiry: '', cvc: '' }] }),
    legacyIncrement: f => f.store.incrementAssetSuccessCount({ cardNumber: 'offline-card' }),
    reserve: f => f.store.reserveCard(owner),
    runtimeReserve: f => f.store.reserveRuntimeAssets(owner),
    availability: f => f.store.hasAvailableCard(),
    runtimeSnapshot: f => f.store.getRuntimeAssets(),
    providerReserve: f => f.store.reserveGptApiCard('JobA'),
    providerFinalize: f => f.store.finalizeGptApiAttempt('JobA', { outcome: 'no_charge' })
};
for (const [name, call] of Object.entries(calls)) {
    test(`${name}: legacy path cannot mutate or select a fenced card in enforce mode`, async () => {
        const idle = ['freeze', 'resetCooldown', 'deleteById', 'deleteByPan', 'bulkEmpty', 'bulkUpdate', 'legacyIncrement', 'reserve', 'runtimeReserve', 'availability', 'runtimeSnapshot'].includes(name);
        const card = base(idle ? { in_use: 0, locked_by: null } : name === 'complete' ? { status: '支付处理中' } : name === 'unfreeze' ? { in_use: 0, locked_by: null, status: '已冻结' } : {});
        const f = fixture({ card }); const before = f.state();
        try { await call(f); } catch (e) {
            assert.ok(['CARD_LOCK_OWNERSHIP_LOST', 'GPT_API_CARD_OWNER_MISMATCH'].includes(e.code), `unexpected error ${e.message}`);
        }
        assert.deepEqual(f.state(), before);
        const statements = f.events.filter(sql => /\bcard_assets\b/.test(sql) && !/^SELECT id FROM card_assets WHERE card_number/.test(sql));
        assert.ok(statements.length > 0, 'must reach the protected card statement');
        for (const sql of statements) assert.match(sql, /card_assets\.payment_attempt_id IS NULL/);
    });
    test(`${name}: guard off issues no draft-column SQL against an unmigrated schema`, async () => {
        const f = fixture({ mode: null, schemaMissing: true, card: base({ in_use: 0, locked_by: null }) });
        try { await call(f); } catch (e) {
            // Ownership failures are legitimate. Unsupported statements expose
            // a gap in this model rather than being silently accepted.
            assert.ok(['CARD_LOCK_OWNERSHIP_LOST', 'GPT_API_CARD_OWNER_MISMATCH'].includes(e.code), `unexpected error ${e.message}`);
        }
        assert.ok(!f.events.some(sql => /payment_attempt_id/.test(sql)));
    });
}
test('enforce mode with missing schema fails closed, with no unguarded retry', async () => {
    const f = fixture({ schemaMissing: true, card: base({ in_use: 0, locked_by: null }) });
    await assert.rejects(f.store.reserveCard(owner), /synthetic unknown column/);
    assert.equal(f.state().touches, 0); assert.equal(f.events.length, 1);
});
test('invalid mode cannot silently disable the guard', () => assert.throws(() => fixture({ mode: 'enabled' }), /KC_ATTEMPT_ASSET_GUARD_INVALID/));
for (const name of ['deleteById', 'deleteByPan', 'resetCooldown', 'freeze']) {
    for (const patch of [{ in_use: 1, locked_by: owner }, { in_use: 0, locked_by: owner },
        { status: '支付处理中' }, { status: '待人工复核' }, { status: '支付结果未知' }]) {
        test(`${name}: admin safety applies without ledger schema ${JSON.stringify(patch)}`, async () => {
            const f = fixture({ mode: null, schemaMissing: true, card: base({ payment_attempt_id: null, in_use: 0, locked_by: null, ...patch }) });
            const before = f.state(); await calls[name](f); assert.deepEqual(f.state(), before);
        });
    }
}
test('reset cannot unfreeze an idle card', async () => {
    const f = fixture({ mode: null, card: base({ in_use: 0, locked_by: null, status: '已冻结' }) });
    assert.equal(await f.store.resetIdleCardCooldown(1), false); assert.equal(f.state().touches, 0);
});
for (const name of ['deleteById', 'resetCooldown']) {
    test(`${name}: an idle unbound card remains administrable`, async () => {
        const f = fixture({ card: base({ in_use: 0, locked_by: null, payment_attempt_id: null }) });
        assert.equal(await calls[name](f), true); assert.equal(f.state().touches, 1);
    });
}
test('bulk update cannot turn a blocked existing PAN into a duplicate insert', async () => {
    const f = fixture(); await assert.rejects(calls.bulkUpdate(f), { code: 'CARD_LOCK_OWNERSHIP_LOST' });
    assert.equal(f.state().inserted, 0); assert.ok(!f.events.some(sql => /^INSERT INTO card_assets/.test(sql)));
});
test('ambiguous duplicate PAN rows abort the entire batch', async () => {
    const f = fixture({ duplicate: true }); await assert.rejects(calls.bulkUpdate(f), { code: 'CARD_LOCK_OWNERSHIP_LOST' });
    assert.equal(f.state().touches, 0); assert.equal(f.state().inserted, 0);
});
test('ledger-linked billing records are excluded from legacy delete paths', async () => {
    const f = fixture(); await f.store.deleteBillingRecord(1); await f.store.deleteFailedBillingRecords();
    assert.ok(f.events.every(sql => /AND local_payment_attempt_id IS NULL/.test(sql)));
});
test('admin routes use safe store methods and no longer clear ownership directly', () => {
    const server = fs.readFileSync(path.resolve(__dirname, '../services/kc-pay-gpt/server.js'), 'utf8');
    const routes = server.slice(server.indexOf("app.delete('/api/admin/cards/:id'"), server.indexOf("app.post('/api/admin/cards/:id/freeze'"));
    assert.match(routes, /store.deleteIdleCardById/); assert.match(routes, /store.resetIdleCardCooldown/);
    assert.doesNotMatch(routes, /FROM card_assets/);
    assert.match(server, /store\.getIdleCardSecret/);
    assert.doesNotMatch(server.slice(server.indexOf("app.get('/api/admin/cards/:id/secret'"), server.indexOf("app.post('/api/admin/cards/import'")), /FROM card_assets/);
    assert.match(routes, /Number.isSafeInteger/); assert.doesNotMatch(routes, /store.runExecute|locked_by = NULL|message: error.message/);
});
