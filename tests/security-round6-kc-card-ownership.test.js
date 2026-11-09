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
const asset = (patch = {}) => ({ id: 55, in_use: 1, is_active: 1, status: '正常',
    locked_by: owner, locked_at: 'offline-held', usage_count: 0, daily_usage_count: 0,
    daily_usage_reset_at: null, cooldown_until: null, ...patch });

// Evaluate the complete store against a bounded SQL state model. It implements
// WHERE predicates from the actual statements, including the old unguarded ID
// path, and permits a transfer immediately before an UPDATE. This is offline
// application evidence, not a MySQL/InnoDB or distributed-lock simulator.
function harness({ card = asset(), phone = asset(), beforeUpdate, failUsageWrite = false, profileChangedRows = 1 } = {}) {
    const state = { card: clone(card), phone: clone(phone) };
    const events = [];
    let snapshot, poolOptions;
    const matches = (row, sql, params) => {
        const where = sql.slice(sql.indexOf('WHERE'));
        const offset = (sql.slice(0, sql.indexOf('WHERE')).match(/\?/g) || []).length;
        if (!row || row.id !== Number(params[offset])) return false;
        if (/in_use = 1/.test(where) && row.in_use !== 1) return false;
        if (/is_active = 1/.test(where) && row.is_active !== 1) return false;
        if (/status = '正常'/.test(where) && row.status !== '正常') return false;
        const allowedStatuses = where.match(/\bstatus IN \(([^)]+)\)/);
        if (allowedStatuses && ![...allowedStatuses[1].matchAll(/'([^']*)'/g)].some(match => match[1] === row.status)) return false;
        if (/CAST\(locked_by AS BINARY\) = CAST\(\? AS BINARY\)/.test(where)) {
            if (row.locked_by !== params[offset + 1]) return false;
        } else if (/locked_by = \?/.test(where)) {
            if (String(row.locked_by).trimEnd().toLowerCase() !== String(params[offset + 1]).trimEnd().toLowerCase()) return false;
        }
        return true;
    };
    const query = async (rawSql, params = []) => {
        const sql = rawSql.replace(/\s+/g, ' ').trim();
        events.push({ sql, params: [...params] });
        if (/SELECT proxy_url FROM proxy_assets/.test(sql)) return [[]];
        if (/SELECT id, card_number/.test(sql)) {
            const row = state.card;
            return [row && !row.in_use && row.is_active === 1 && row.status === '正常' && !row.cooldown_until ? [clone(row)] : []];
        }
        if (/SELECT daily_usage_count/.test(sql)) return [matches(state.card, sql, params) ? [clone(state.card)] : []];
        if (/^UPDATE (card_assets|phone_assets) SET /.test(sql)) {
            const key = sql.startsWith('UPDATE phone_assets') ? 'phone' : 'card';
            beforeUpdate?.(state, sql, params);
            const row = state[key];
            if (!matches(row, sql, params)) return [{ affectedRows: 0 }];
            if (failUsageWrite && /SET daily_usage_count/.test(sql)) throw new Error('offline usage write failure');
            if (/SET in_use = 1/.test(sql)) Object.assign(row, { in_use: 1, locked_by: params[0], locked_at: 'offline-new' });
            if (/SET payment_holder_name/.test(sql)) Object.assign(row, { payment_holder_name: params[0], payment_address_id: params[5] });
            if (/SET daily_usage_count/.test(sql)) Object.assign(row, {
                daily_usage_count: /daily_usage_count = 1,/.test(sql) ? 1 : row.daily_usage_count + 1,
                usage_count: row.usage_count + 1, daily_usage_reset_at: new Date().toISOString() });
            if (/SET cooldown_until/.test(sql)) row.cooldown_until = 'offline-cooled';
            if (/status = '待人工复核'/.test(sql.split('WHERE')[0])) Object.assign(row, { is_active: 0, status: '待人工复核', in_use: 1, locked_by: `manual_review:${params[0]}` });
            if (/status = '已报废'/.test(sql.split('WHERE')[0])) Object.assign(row, { is_active: 0, status: '已报废' });
            if (/in_use = 0/.test(sql.split('WHERE')[0])) Object.assign(row, { in_use: 0, locked_by: null, locked_at: null });
            return [{ affectedRows: 1, changedRows: /SET payment_holder_name/.test(sql) ? profileChangedRows : 1 }];
        }
        throw new Error(`Unsupported offline query: ${sql}`);
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
        require: name => name === 'mysql2/promise' ? { createPool: options => { poolOptions = options; return pool; } } : runtimeRequire(name) }, { filename: runtimePath });
    return { store: module.exports, state, events, getPoolOptions: () => poolOptions };
}

const operations = {
    release: (h, expected = owner, id = 55) => h.store.releaseCard(id, expected),
    cooldown: (h, expected = owner, id = 55) => h.store.cooldownCard(id, 30, expected),
    quarantine: (h, expected = owner, id = 55) => h.store.quarantineCardForReview(id, 'offline_unknown', expected),
    exhaust: (h, expected = owner, id = 55) => h.store.markCardExhausted(id, expected),
    usage: (h, expected = owner, id = 55) => h.store.recordCardUsage(id, expected),
    profile: (h, expected = owner, id = 55) => h.store.bindCardPaymentProfile(id, { holderName: 'Offline', address: { id: 3 } }, expected)
};

for (const [name, operation] of Object.entries(operations)) {
    for (const currentOwner of ['payment_next-job', owner.toLowerCase(), `${owner}-extra`, `${owner} `, null]) {
        test(`${name}: an old task cannot change a card owned by ${JSON.stringify(currentOwner)}`, async () => {
            const h = harness({ card: asset({ locked_by: currentOwner }) });
            const before = clone(h.state);
            if (name === 'release') assert.equal(await operation(h), 0);
            else await assert.rejects(operation(h), { code: 'CARD_LOCK_OWNERSHIP_LOST' });
            assert.deepEqual(h.state, before);
        });
    }
    for (const patch of [{ in_use: 0 }, { is_active: 0 }, { status: '待人工复核' }, { status: '已冻结' }, { status: '已报废' }]) {
        test(`${name}: ordinary task cannot mutate protected state ${JSON.stringify(patch)}`, async () => {
            const h = harness({ card: asset(patch) });
            const before = clone(h.state);
            if (name === 'release') assert.equal(await operation(h), 0);
            else await assert.rejects(operation(h), { code: 'CARD_LOCK_OWNERSHIP_LOST' });
            assert.deepEqual(h.state, before);
        });
    }
    for (const invalidOwner of ['', null, true, 'payment_bad key', 'x'.repeat(65), {}, ['payment_Job-1']]) {
        test(`${name}: invalid/missing owner fails before persistence (${JSON.stringify(invalidOwner)})`, async () => {
            const h = harness();
            await assert.rejects(operation(h, invalidOwner), { code: 'ASSET_LOCK_OWNER_INVALID' });
            assert.equal(h.events.length, 0);
        });
    }
    for (const invalidId of [true, -1, 1.5, '55 OR 1=1', [], Number.MAX_SAFE_INTEGER + 1]) {
        test(`${name}: invalid asset ID fails before persistence (${JSON.stringify(invalidId)})`, async () => {
            const h = harness();
            await assert.rejects(operation(h, owner, invalidId), { code: 'ASSET_LOCK_ID_INVALID' });
            assert.equal(h.events.length, 0);
        });
    }
}

test('owned release is idempotent and cannot release a subsequent owner', async () => {
    const h = harness();
    assert.equal(await h.store.releaseCard('55', owner), 1);
    assert.equal(await h.store.releaseCard(55, owner), 0);
    Object.assign(h.state.card, asset({ locked_by: 'payment_next-job' }));
    assert.equal(await h.store.releaseCard(55, owner), 0);
    assert.equal(h.state.card.locked_by, 'payment_next-job');
});

test('an ownership transfer just before release is checked by the UPDATE itself', async () => {
    const h = harness({ beforeUpdate: state => { state.card.locked_by = 'payment_next-job'; } });
    assert.equal(await h.store.releaseCard(55, owner), 0);
    assert.equal(h.state.card.in_use, 1);
});

test('matching owner can cool down, exhaust and quarantine, preserving the respective states', async () => {
    for (const [name, check] of [
        ['cooldown', row => row.in_use === 0 && row.cooldown_until && row.status === '正常'],
        ['exhaust', row => row.in_use === 0 && row.status === '已报废' && row.is_active === 0],
        ['quarantine', row => row.in_use === 1 && row.status === '待人工复核' && row.locked_by === 'manual_review:offline_unknown']
    ]) {
        const h = harness();
        assert.equal(await operations[name](h), 1);
        assert.ok(check(h.state.card));
        assert.equal(await h.store.releaseCard(55, owner), 0);
    }
});

test('usage and payment profile require ownership and retain the lock for final release', async () => {
    const h = harness();
    await h.store.bindCardPaymentProfile(55, { holderName: 'Offline', address: { id: 3 } }, owner);
    const result = await h.store.recordCardUsage(55, owner);
    assert.equal(result.dailyUsageCount, 1);
    assert.equal(h.state.card.payment_address_id, 3);
    assert.equal(h.state.card.usage_count, 1);
    assert.equal(h.state.card.in_use, 1);
    assert.equal(h.state.card.locked_by, owner);
    assert.ok(h.events.some(event => event.sql?.includes('FOR UPDATE')));
    assert.equal(await h.store.releaseCard(55, owner), 1);
});

test('daily usage cooldown and write rollback retain their existing safety behavior', async () => {
    const h = harness({ card: asset({ daily_usage_count: 2, daily_usage_reset_at: new Date().toISOString() }) });
    assert.equal((await h.store.recordCardUsage(55, owner)).cooledDown, true);
    assert.equal(h.state.card.in_use, 1);
    const failing = harness({ failUsageWrite: true });
    await assert.rejects(failing.store.recordCardUsage(55, owner), /offline usage write failure/);
    assert.deepEqual(failing.state.card, asset());
    assert.ok(failing.events.some(event => event.tx === 'rollback'));
});

test('runtime release checks phone and card ownership separately', async () => {
    const h = harness({ phone: asset({ locked_by: 'phone_next-job' }) });
    assert.equal(await h.store.releaseRuntimeAssets({ cardAssetId: 55, phoneAssetId: 55, ownerKey: owner }), 1);
    assert.equal(h.state.card.in_use, 0);
    assert.equal(h.state.phone.in_use, 1);
    assert.equal(h.state.phone.locked_by, 'phone_next-job');
});

test('runtime release with no owner cannot clear either asset', async () => {
    const h = harness();
    await assert.rejects(h.store.releaseRuntimeAssets({ cardAssetId: 55, phoneAssetId: 55 }), { code: 'ASSET_LOCK_OWNER_INVALID' });
    assert.equal(h.events.length, 0);
});

for (const method of ['reserveCard', 'reserveRuntimeAssets']) {
    test(`${method}: return the exact owner as a reservation receipt`, async () => {
        const h = harness({ card: asset({ in_use: 0, locked_by: null }) });
        const result = await h.store[method](owner);
        assert.equal(result.ownerKey, owner);
        assert.equal(h.state.card.locked_by, owner);
        assert.equal(h.state.card.in_use, 1);
    });
    for (const badOwner of [undefined, '', true, 'x'.repeat(65), 'bad owner']) {
        test(`${method}: never truncate or accept unowned reservations (${JSON.stringify(badOwner)})`, async () => {
            const h = harness({ card: asset({ in_use: 0 }) });
            await assert.rejects(h.store[method](badOwner), { code: 'ASSET_LOCK_OWNER_INVALID' });
            assert.equal(h.events.length, 0);
        });
    }
}


test('unchanged owned profile accepts matched rows even when changedRows is zero', async () => {
    const h = harness({ profileChangedRows: 0 });
    const profile = { holderName: 'Offline', address: { id: 3 } };
    assert.equal(await h.store.bindCardPaymentProfile(55, profile, owner), 1);
    assert.equal(await h.store.bindCardPaymentProfile(55, profile, owner), 1);
    assert.equal(h.state.card.in_use, 1);
    assert.equal(h.state.card.locked_by, owner);
});

test('the installed mysql2 config keeps FOUND_ROWS for the actual store pool options (no connection)', async () => {
    const h = harness();
    await h.store.bindCardPaymentProfile(55, {}, owner);
    const driverRoot = path.dirname(runtimeRequire.resolve('mysql2'));
    const ConnectionConfig = runtimeRequire(path.join(driverRoot, 'lib/connection_config.js'));
    const { FOUND_ROWS } = runtimeRequire(path.join(driverRoot, 'lib/constants/client.js'));
    const config = new ConnectionConfig(h.getPoolOptions());
    assert.equal(config.clientFlags & FOUND_ROWS, FOUND_ROWS);
});

for (const name of ['cooldown', 'exhaust', 'quarantine', 'profile']) {
    test(`${name}: transfer immediately before UPDATE cannot mutate a new owner's card`, async () => {
        const h = harness({ beforeUpdate: state => { state.card.locked_by = 'payment_next_job'; } });
        await assert.rejects(operations[name](h), { code: 'CARD_LOCK_OWNERSHIP_LOST' });
        assert.deepEqual(h.state.card, asset({ locked_by: 'payment_next_job' }));
    });
}

test('runtime release validates both IDs before clearing either asset', async () => {
    const h = harness();
    await assert.rejects(h.store.releaseRuntimeAssets({ phoneAssetId: 55, cardAssetId: '55junk', ownerKey: owner }), { code: 'ASSET_LOCK_ID_INVALID' });
    assert.equal(h.events.length, 0);
    assert.deepEqual(h.state.phone, asset());
    assert.deepEqual(h.state.card, asset());
});
