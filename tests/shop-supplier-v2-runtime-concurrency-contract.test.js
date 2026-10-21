'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const files = {
    seed: 'supabase/acceptance/20261020_supplier_runtime_p2e_concurrency_session_a_seed.sql',
    hold: 'supabase/acceptance/20261020_supplier_runtime_p2e_concurrency_session_a_hold.sql',
    sameJob: 'supabase/acceptance/20261020_supplier_runtime_p2e_concurrency_session_b_same_job.sql',
    sameAccount: 'supabase/acceptance/20261020_supplier_runtime_p2e_concurrency_session_b_same_account.sql',
    cleanup: 'supabase/acceptance/20261020_supplier_runtime_p2e_concurrency_cleanup.sql'
};

const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const sql = Object.fromEntries(Object.entries(files).map(([key, file]) => [key, read(file)]));
const allSql = Object.values(sql).join('\n');

test('P2E concurrency acceptance has a complete five-file session inventory', () => {
    for (const file of Object.values(files)) {
        assert.ok(fs.existsSync(path.join(root, file)), file);
    }
    assert.match(sql.seed, /BEGIN;[\s\S]*COMMIT;/);
    assert.match(sql.hold, /BEGIN;[\s\S]*pg_sleep\(45\)[\s\S]*COMMIT;/);
    assert.match(sql.sameJob, /BEGIN;[\s\S]*ROLLBACK;\s*$/);
    assert.match(sql.sameAccount, /BEGIN;[\s\S]*ROLLBACK;\s*$/);
    assert.match(sql.cleanup, /BEGIN;[\s\S]*COMMIT;\s*$/);
});

test('P2E concurrency scripts stay inside the closed disabled-fixture boundary', () => {
    for (const [name, source] of Object.entries(sql)) {
        assert.match(source, /a\.is_enabled\s*=\s*false/, name);
        assert.match(source, /test\|fixture\|sandbox/, name);
        assert.match(source, /not_submitted/, name);
        assert.match(source, /funded/, name);
        assert.doesNotMatch(source, /SHOP_SUPPLIER_(?:RUNTIME|DISPATCH|RECONCILE|DELIVERY)_V2_ENABLED\s*=\s*true/i, name);
        assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY|app_key|(?:secret|password)\s*[:=]/i, name);
        assert.doesNotMatch(source, /\b(?:fetch|curl|wget|https?:\/\/|createPurchase|queryPurchase|queryDelivery)\b/i, name);
    }
});

test('seed commits only the coordinator claim and preserves the session handoff table', () => {
    assert.match(sql.seed, /CREATE TEMP TABLE _supplier_runtime_concurrency_seed[\s\S]*ON COMMIT PRESERVE ROWS/);
    assert.match(sql.seed, /FROM public\.shop_supplier_runtime_plan_v2\(\) AS plan/);
    assert.doesNotMatch(sql.seed, /\bp\.(?:intent_id|supplier_account_id|phase|ready_at|deadline_at)\b/);
    assert.match(sql.seed, /p_action\s*=>\s*'claim'/);
    assert.match(sql.seed, /claim_acquired\s*=\s*true/);
    assert.match(sql.seed, /array_agg\(intent_id ORDER BY intent_id\)/);
    assert.match(sql.seed, /array_agg\(account_id ORDER BY account_id\)/);
    assert.doesNotMatch(sql.seed, /\bmin\((?:intent_id|account_id)\)\b/);
    assert.match(sql.seed, /CASE WHEN count\(\*\) = 1 AND bool_and\(claim_acquired\) THEN 'PASS'/);
    assert.match(sql.seed, /ELSE 'NOT RUN'/);
    assert.match(sql.seed, /COMMIT;\s*$/);
});

test('session A holds account then job locks in the runtime function order', () => {
    assert.match(sql.hold, /SELECT supplier_account_id, intent_id INTO v_account_id, v_intent_id/);
    assert.doesNotMatch(sql.hold, /SELECT account_id, intent_id INTO/);

    const accountLock = sql.hold.indexOf('WHERE supplier_account_id = v_account_id FOR UPDATE');
    const jobLock = sql.hold.indexOf('WHERE intent_id = v_intent_id FOR UPDATE');
    assert.ok(accountLock >= 0, 'account lock is required');
    assert.ok(jobLock > accountLock, 'job lock must follow account lock');
    assert.match(sql.hold, /pg_sleep\(45\)/);
});

test('both independent competitors require a delayed false claim before PASS', () => {
    for (const source of [sql.sameJob, sql.sameAccount]) {
        assert.match(source, /SET LOCAL lock_timeout\s*=\s*'60s'/);
        assert.match(source, /SET LOCAL statement_timeout\s*=\s*'90s'/);
        assert.match(source, /p_action\s*=>\s*'claim'/);
        assert.match(source, /coalesce\(\(v_claim->>'acquired'\)::BOOLEAN, false\) IS FALSE/);
        assert.match(source, /v_elapsed\s*>=\s*1/);
        assert.match(source, /THEN 'PASS'/);
        assert.match(source, /ELSE 'FAIL'/);
        assert.match(source, /ROLLBACK;\s*$/);
    }
    assert.match(sql.sameAccount, /JOIN public\.shop_supplier_runtime_plan_v2\(\) AS plan/);
    assert.match(sql.sameAccount, /plan\.supplier_account_id\s*=\s*t\.supplier_account_id/);
    assert.match(sql.sameAccount, /plan\.intent_id\s*<>\s*t\.intent_id/);
});

test('cleanup is uniquely targeted and only removes runtime coordinator rows', () => {
    assert.match(sql.cleanup, /v_count <> 1/);
    assert.match(sql.cleanup, /v_job_count NOT BETWEEN 1 AND 2/);
    assert.match(sql.cleanup, /v_receipt_count <> 0/);

    const deletes = [...sql.cleanup.matchAll(/\bDELETE\s+FROM\s+public\.([a-z0-9_]+)/gi)].map((match) => match[1]);
    assert.deepEqual(new Set(deletes), new Set(['shop_supplier_runtime_jobs', 'shop_supplier_runtime_accounts']));
    assert.doesNotMatch(sql.cleanup, /DELETE\s+FROM\s+public\.(?!shop_supplier_runtime_(?:jobs|accounts)\b)[a-z0-9_]+/i);
    assert.match(sql.cleanup, /COMMIT;\s*$/);
});

test('concurrency acceptance cannot be mistaken for supplier or production acceptance', () => {
    assert.match(allSql, /No supplier is called/);
    assert.match(allSql, /未启动上游请求/);
    assert.match(allSql, /未把超时伪造为并发 PASS/);
    assert.match(allSql, /不把结果当作并发通过/);
    assert.doesNotMatch(allSql, /INSERT\s+INTO\s+public\.(?!shop_supplier_runtime_(?:accounts|jobs)\b)/i);
    assert.doesNotMatch(allSql, /UPDATE\s+public\.(?!shop_supplier_runtime_(?:accounts|jobs)\b)/i);
});
