'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const runtimePath = path.resolve(__dirname, '../services/kc-pay-gpt/mysql-store.js');
const runtimeRequire = createRequire(runtimePath);
const source = fs.readFileSync(process.env.KC_ATOMIC_STORE_SOURCE || runtimePath, 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const owner = 'payment_Job-1';
const card = (patch = {}) => ({ id: 55, is_active: 1, in_use: 1, status: '正常', locked_by: owner,
    locked_at: '2000-01-01T00:00:00.000Z', usage_count: 0, daily_usage_count: 0,
    daily_usage_reset_at: null, cooldown_until: null, ...patch });
const task = (patch = {}) => ({ job_key: 'Job-1', execution_mode: 'local_card_pool',
    status: 'failed', payment_state: 'not_started', recovery_required: 0, ...patch });
const sqlValues = text => [...text.matchAll(/'([^']*)'/g)].map(match => match[1]);

// Bounded interpreter for the actual store's SQL predicates and SET operations.
// Unknown statements fail the fixture. This tests application transitions and
// injected schedules only: it does not implement MySQL, InnoDB, crash durability,
// isolation levels, concurrent connections, or an ambiguous COMMIT outcome.
function harness({ cards = [card()], tasks = [task()], beforeUpdate, fault } = {}) {
    const state = { cards: clone(cards), tasks: clone(tasks) };
    const events = [];
    let snapshot;
    const matches = (row, sql, params) => {
        const whereIndex = sql.indexOf(' WHERE ');
        assert.ok(whereIndex >= 0, 'writes and locking reads must have a WHERE');
        const wholeWhere = sql.slice(whereIndex + 7);
        const outerWhere = wholeWhere.split(/ AND \(LEFT\(| AND NOT EXISTS/)[0];
        const offset = (sql.slice(0, whereIndex).match(/\?/g) || []).length;
        let parameter = offset;
        if (/\bid = \?/.test(outerWhere) && row.id !== Number(params[parameter++])) return false;
        for (const field of ['in_use', 'is_active']) {
            const equal = outerWhere.match(new RegExp(`\\b${field} = ([01])`));
            if (equal && row[field] !== Number(equal[1])) return false;
        }
        const equalStatus = outerWhere.match(/\bstatus = '([^']+)'/);
        const statusList = outerWhere.match(/\bstatus IN \(([^)]+)\)/);
        if (equalStatus && row.status !== equalStatus[1]) return false;
        if (statusList && !sqlValues(statusList[1]).includes(row.status)) return false;
        if (/CAST\(locked_by AS BINARY\) = CAST\(\? AS BINARY\)/.test(outerWhere)) {
            if (row.locked_by !== params[parameter++]) return false;
        } else if (/\blocked_by = \?/.test(outerWhere)) {
            if (String(row.locked_by).trimEnd().toLowerCase() !== String(params[parameter++]).trimEnd().toLowerCase()) return false;
        }
        if (/locked_at < \?/.test(outerWhere) && row.locked_at != null &&
            new Date(row.locked_at) >= new Date(params[parameter])) return false;
        if (/local_task/.test(wholeWhere) && String(row.locked_by || '').toLowerCase().startsWith('payment_')) {
            const candidates = state.tasks.filter(record =>
                /CAST\(card_assets.locked_by AS BINARY\)/.test(wholeWhere)
                    ? row.locked_by === `payment_${record.job_key}`
                    : String(row.locked_by).toLowerCase() === `payment_${record.job_key}`.toLowerCase());
            if (!candidates.some(record => {
                for (const field of ['execution_mode', 'status', 'payment_state']) {
                    const equal = wholeWhere.match(new RegExp(`local_task\\.${field} = '([^']+)'`));
                    const list = wholeWhere.match(new RegExp(`local_task\\.${field} IN \\(([^)]+)\\)`));
                    if (equal && record[field] !== equal[1]) return false;
                    if (list && !sqlValues(list[1]).includes(record[field])) return false;
                }
                return !/local_task.recovery_required = 0/.test(wholeWhere) || record.recovery_required === 0;
            })) return false;
        }
        if (/NOT EXISTS.*provider_task/.test(wholeWhere)) {
            const protectedTask = state.tasks.some(record => {
                if (row.locked_by !== `gptapi_${record.job_key}` ||
                    !(record.execution_mode === 'third_party_api' || record.gpt_api_order_id || record.gpt_api_task_id)) return false;
                let attempt = {};
                try { attempt = JSON.parse(record.gpt_api_raw || '{}').attempt || {}; } catch (_) {}
                return !['success', 'no_charge'].includes(attempt.settlement) &&
                    (['running', 'manual'].includes(record.status) || record.recovery_required === 1 ||
                        ['started', 'unknown'].includes(record.payment_state) || record.gpt_api_order_id ||
                        record.gpt_api_task_id || attempt.dispatchStarted === true);
            });
            if (protectedTask) return false;
        }
        return true;
    };
    const query = async (rawSql, params = []) => {
        const sql = rawSql.replace(/\s+/g, ' ').trim();
        events.push({ sql, params: [...params] });
        if (/^UPDATE (phone_assets|pool_emails) SET /.test(sql)) return [{ affectedRows: 0 }];
        if (/^SELECT proxy_url FROM proxy_assets/.test(sql)) return [[]];
        if (/^SELECT id, card_number/.test(sql)) {
            return [clone(state.cards.filter(row => row.is_active === 1 && row.in_use === 0 &&
                row.status === '正常' && !row.cooldown_until).slice(0, 1))];
        }
        if (/^SELECT daily_usage_count/.test(sql)) return [clone(state.cards.filter(row => matches(row, sql, params)))];
        if (!/^UPDATE card_assets SET /.test(sql)) throw new Error(`Unsupported offline statement: ${sql}`);
        beforeUpdate?.(state, sql, params);
        const selected = state.cards.filter(row => matches(row, sql, params));
        if (fault?.when(sql) && fault.phase === 'before') throw new Error('offline write rejected');
        const set = sql.slice(0, sql.indexOf(' WHERE '));
        for (const row of selected) {
            const status = set.match(/status = '([^']+)'/);
            if (status) row.status = status[1];
            const active = set.match(/is_active = ([01])/);
            if (active) row.is_active = Number(active[1]);
            if (/in_use = 0/.test(set)) Object.assign(row, { in_use: 0, locked_by: null, locked_at: null });
            if (/in_use = 1/.test(set)) row.in_use = 1;
            if (/CONCAT\('manual_review:', \?\)/.test(set)) row.locked_by = `manual_review:${params[0]}`;
            if (/SET payment_holder_name/.test(set)) Object.assign(row, { payment_holder_name: params[0], payment_address_id: params[5] });
            if (/SET daily_usage_count/.test(set)) Object.assign(row, {
                daily_usage_count: /daily_usage_count = 1,/.test(set) ? 1 : row.daily_usage_count + 1,
                usage_count: row.usage_count + 1, daily_usage_reset_at: new Date().toISOString() });
            if (/SET cooldown_until/.test(set)) {
                const proposed = Date.now() + (/INTERVAL 24 HOUR/.test(set) ? 24 * 60 : Number(params[0])) * 60000;
                row.cooldown_until = new Date(/GREATEST/.test(set) ? Math.max(proposed, new Date(row.cooldown_until || 0).getTime()) : proposed).toISOString();
            }
            if (/cooldown_until = NULL/.test(set)) row.cooldown_until = null;
        }
        if (fault?.when(sql) && fault.phase === 'after') throw new Error('offline durable write response lost');
        return [{ affectedRows: selected.length, changedRows: selected.length }];
    };
    const connection = { query, execute: query,
        beginTransaction: async () => { snapshot = clone(state); events.push({ tx: 'begin' }); },
        commit: async () => events.push({ tx: 'commit' }),
        rollback: async () => { Object.assign(state, clone(snapshot)); events.push({ tx: 'rollback' }); },
        release: () => events.push({ tx: 'release' }) };
    const pool = { query, execute: query, getConnection: async () => connection };
    const module = { exports: {} };
    vm.runInNewContext(source, { module, exports: module.exports, __dirname: path.dirname(runtimePath),
        process: { env: {} }, Buffer, URL, console,
        require: name => name === 'mysql2/promise' ? { createPool: () => pool } : runtimeRequire(name)
    }, { filename: runtimePath });
    return { store: module.exports, state, events };
}
const held = h => {
    assert.equal(h.state.cards[0].in_use, 1);
    assert.equal(h.state.cards[0].locked_by, owner);
};
const ownershipLost = promise => assert.rejects(promise, { code: 'CARD_LOCK_OWNERSHIP_LOST' });
const cleanups = {
    ordinary: h => h.store.releaseCard(55, owner),
    runtime: h => h.store.releaseRuntimeAssets({ cardAssetId: 55, ownerKey: owner }),
    stale: h => h.store.releaseStaleAssetLocks(),
    restart: h => h.store.resetAllAssetLocks(),
    bulk: h => h.store.releaseCardsByOwner('Job-1')
};

test('durable hold is a single-use transition and completes only from its own pending state', async () => {
    const h = harness();
    await ownershipLost(h.store.completeCardPayment(55, owner));
    assert.equal(await h.store.markCardPaymentStarted(55, owner), 1);
    assert.equal(h.state.cards[0].status, '支付处理中');
    await ownershipLost(h.store.markCardPaymentStarted(55, owner));
    assert.equal(await h.store.completeCardPayment(55, owner), 1);
    assert.equal(h.state.cards[0].status, '正常');
    assert.equal(h.state.cards[0].in_use, 0);
    assert.equal(h.state.cards[0].locked_by, null);
    await ownershipLost(h.store.completeCardPayment(55, owner));
});
for (const name of ['markCardPaymentStarted', 'completeCardPayment']) {
    for (const patch of [ { locked_by: 'payment_other' }, { locked_by: owner.toLowerCase() },
        { locked_by: `${owner} ` }, { in_use: 0 }, { is_active: 0 }, { status: '待人工复核' } ]) {
        test(`${name} rejects ownership/state mismatch: ${JSON.stringify(patch)}`, async () => {
            const h = harness({ cards: [card({ status: name === 'completeCardPayment' ? '支付处理中' : '正常', ...patch })] });
            const before = clone(h.state);
            await ownershipLost(h.store[name](55, owner));
            assert.deepEqual(h.state, before);
        });
    }
}
for (const [name, cleanup] of Object.entries(cleanups)) {
    test(`${name} cleanup cannot reclaim a durable payment hold`, async () => {
        const h = harness();
        await h.store.markCardPaymentStarted(55, owner);
        await cleanup(h);
        held(h);
        assert.equal(h.state.cards[0].status, '支付处理中');
        assert.equal(await h.store.reserveCard('payment_new'), null);
    });
}
const safeTasks = [];
for (const status of ['failed', 'cancelled']) for (const payment_state of ['not_started', 'declined']) {
    safeTasks.push({ status, payment_state });
}
for (const cleanupName of ['stale', 'restart', 'bulk']) {
    for (const patch of safeTasks) {
        test(`${cleanupName} reclaims a normal lock with exact safe terminal task ${JSON.stringify(patch)}`, async () => {
            const h = harness({ tasks: [task(patch)] });
            await cleanups[cleanupName](h);
            assert.equal(h.state.cards[0].in_use, 0);
            assert.equal(h.state.cards[0].locked_by, null);
        });
    }
    const unsafeTasks = [null, { execution_mode: 'debug' }, { execution_mode: 'third_party_api' },
        { status: 'running' }, { status: 'manual' }, { status: 'succeeded' }, { status: 'success' },
        { payment_state: 'started' }, { payment_state: 'unknown' }, { payment_state: 'succeeded' },
        { recovery_required: 1 }, { recovery_required: null }, { job_key: 'job-1' }, { job_key: 'Job-1 ' }];
    for (const patch of unsafeTasks) {
        test(`${cleanupName} retains normal lock without safe task evidence ${JSON.stringify(patch)}`, async () => {
            const h = harness({ tasks: patch ? [task(patch)] : [] });
            await cleanups[cleanupName](h);
            held(h);
        });
    }
    test(`${cleanupName} retains normal lock if terminal task becomes uncertain before UPDATE`, async () => {
        const h = harness({ beforeUpdate: (state, sql) => {
            if (/UPDATE card_assets/.test(sql)) state.tasks[0].payment_state = 'unknown';
        } });
        await cleanups[cleanupName](h);
        held(h);
    });
    test(`${cleanupName} cannot treat differently cased owner as a nonpayment owner`, async () => {
        const h = harness({ cards: [card({ locked_by: owner.toUpperCase() })] });
        await cleanups[cleanupName](h);
        assert.equal(h.state.cards[0].in_use, 1);
    });
}
for (const cleanupName of ['stale', 'restart']) {
    test(`${cleanupName} retains an unresolved GPT provider lock`, async () => {
        const h = harness({ cards: [card({ locked_by: 'gptapi_Job-1' })],
            tasks: [task({ execution_mode: 'third_party_api', status: 'running' })] });
        await cleanups[cleanupName](h);
        assert.equal(h.state.cards[0].in_use, 1);
    });
    test(`${cleanupName} releases an ordinary nonpayment stale lock`, async () => {
        const h = harness({ cards: [card({ locked_by: 'registration_Job-1' })], tasks: [] });
        await cleanups[cleanupName](h);
        assert.equal(h.state.cards[0].in_use, 0);
    });
}
for (const freeze of [true, false]) {
    for (const patch of [ { status: '支付处理中' }, { status: '待人工复核', is_active: 0 },
        { status: '正常' }, { status: '已冻结', is_active: 0 }, { status: '支付处理中', in_use: 0 } ]) {
        test(`${freeze ? 'freeze' : 'unfreeze'} cannot erase held or pending state ${JSON.stringify(patch)}`, async () => {
            const h = harness({ cards: [card(patch)] });
            const before = clone(h.state);
            assert.equal((await h.store.setCardFrozen(55, freeze)).success, false);
            assert.deepEqual(h.state, before);
        });
    }
}
test('an idle normal card can be frozen and then unfrozen', async () => {
    const h = harness({ cards: [card({ in_use: 0, locked_by: null })] });
    assert.equal((await h.store.setCardFrozen(55, true)).success, true);
    assert.equal(h.state.cards[0].status, '已冻结');
    assert.equal((await h.store.setCardFrozen(55, false)).success, true);
    assert.equal(h.state.cards[0].status, '正常');
    assert.equal(h.state.cards[0].is_active, 1);
});
const mutations = {
    quarantine: h => h.store.quarantineCardForReview(55, 'offline', owner),
    cooldown: h => h.store.cooldownCard(55, 30, owner),
    exhaust: h => h.store.markCardExhausted(55, owner),
    profile: h => h.store.bindCardPaymentProfile(55, { holderName: 'Offline', address: { id: 9 } }, owner),
    usage: h => h.store.recordCardUsage(55, owner)
};
for (const [name, invoke] of Object.entries(mutations)) {
    test(`pending card supports owner-scoped ${name}`, async () => {
        const h = harness({ cards: [card({ status: '支付处理中' })] });
        await invoke(h);
        const row = h.state.cards[0];
        if (name === 'quarantine') { assert.equal(row.status, '待人工复核'); assert.equal(row.in_use, 1); assert.equal(row.is_active, 0); }
        if (name === 'cooldown') { assert.equal(row.status, '正常'); assert.equal(row.in_use, 0); assert.ok(row.cooldown_until); }
        if (name === 'exhaust') { assert.equal(row.status, '已报废'); assert.equal(row.is_active, 0); }
        if (name === 'profile') { assert.equal(row.payment_holder_name, 'Offline'); held(h); }
        if (name === 'usage') { assert.equal(row.usage_count, 1); assert.equal(row.daily_usage_count, 1); held(h); }
    });
    for (const foreignOwner of ['payment_other', owner.toLowerCase(), `${owner} `]) {
        test(`pending ${name} cannot mutate another owner ${foreignOwner}`, async () => {
            const h = harness({ cards: [card({ status: '支付处理中', locked_by: foreignOwner })] });
            const before = clone(h.state);
            await ownershipLost(invoke(h));
            assert.deepEqual(h.state, before);
        });
    }
}
test('usage transaction failure rolls back counters without clearing the payment hold', async () => {
    const h = harness({ cards: [card({ status: '支付处理中', daily_usage_count: 2, daily_usage_reset_at: new Date().toISOString() })],
        fault: { when: sql => /SET cooldown_until/.test(sql), phase: 'before' } });
    await assert.rejects(h.store.recordCardUsage(55, owner), /offline write rejected/);
    assert.equal(h.state.cards[0].usage_count, 0);
    assert.equal(h.state.cards[0].daily_usage_count, 2);
    held(h);
    assert.ok(h.events.some(event => event.tx === 'rollback'));
});
test('cooldown preserves a longer existing cooldown when explicitly settling a decline', async () => {
    const until = new Date(Date.now() + 12 * 3600000).toISOString();
    const h = harness({ cards: [card({ status: '支付处理中', cooldown_until: until })] });
    await h.store.cooldownCard(55, 30, owner);
    assert.equal(h.state.cards[0].cooldown_until, until);
});
for (const phase of ['before', 'after']) {
    test(`hold write ${phase === 'after' ? 'response lost after persistence' : 'rejected'} cannot be reclaimed without safe task evidence`, async () => {
        const h = harness({ tasks: [task({ status: 'running' })],
            fault: { when: sql => /SET status = '支付处理中'/.test(sql), phase } });
        await assert.rejects(h.store.markCardPaymentStarted(55, owner), /offline/);
        for (const name of ['stale', 'restart', 'bulk']) await cleanups[name](h);
        held(h);
        assert.equal(h.state.cards[0].status, phase === 'after' ? '支付处理中' : '正常');
    });
}
test('failed completion update leaves the durable hold intact', async () => {
    const h = harness({ cards: [card({ status: '支付处理中' })],
        fault: { when: sql => /SET status = '正常', in_use = 0/.test(sql), phase: 'before' } });
    await assert.rejects(h.store.completeCardPayment(55, owner), /offline write rejected/);
    held(h);
    assert.equal(h.state.cards[0].status, '支付处理中');
});
test('ownership transfer immediately before the hold write rejects the stale worker', async () => {
    const h = harness({ beforeUpdate: state => { state.cards[0].locked_by = 'payment_next'; } });
    await ownershipLost(h.store.markCardPaymentStarted(55, owner));
    assert.equal(h.state.cards[0].locked_by, 'payment_next');
    assert.equal(h.state.cards[0].status, '正常');
});
