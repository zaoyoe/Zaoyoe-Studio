const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const migrationPath = path.resolve(
    __dirname,
    '../supabase/migrations/20260514_fix_shop_delivery_claim_return_types.sql'
);

function readMigration() {
    return fs.readFileSync(migrationPath, 'utf8');
}

test('shop delivery claim RPC casts varchar columns to its TEXT return contract', () => {
    const sql = readMigration();

    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.fn_claim_shop_webhook_tasks\(/);
    assert.match(sql, /status TEXT,/);
    assert.match(sql, /dedupe_key TEXT,/);
    assert.match(sql, /lock_token TEXT,/);
    assert.match(sql, /worker_name TEXT,/);

    for (const cast of [
        't.status::TEXT',
        't.dedupe_key::TEXT',
        't.lock_token::TEXT',
        't.worker_name::TEXT'
    ]) {
        assert.equal(sql.includes(cast), true, `migration should return ${cast}`);
    }
});
