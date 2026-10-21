'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const file = path.resolve(__dirname, '../supabase/acceptance/20261019_supplier_runtime_p2e_acceptance.sql');
const sql = fs.readFileSync(file, 'utf8');

test('P2E acceptance script is rollback-only and never enables or invokes a supplier', () => {
    assert.match(sql, /^BEGIN;/m);
    assert.match(sql, /SET LOCAL lock_timeout/);
    assert.match(sql, /SET LOCAL statement_timeout/);
    assert.match(sql, /ROLLBACK;\s*$/);
    assert.doesNotMatch(sql, /\bCOMMIT\s*;/i);
    assert.doesNotMatch(sql, /SHOP_SUPPLIER_(?:RUNTIME|DISPATCH|RECONCILE|DELIVERY)_V2_ENABLED\s*=\s*true/i);
    assert.doesNotMatch(sql, /\b(?:http|https|fetch|curl|wget|createPurchase|queryPurchase|queryDelivery)\b/i);
    assert.doesNotMatch(sql, /SUPABASE_SERVICE_ROLE_KEY|app_key|credential_ref\s*=|token\s*[:=]\s*['"]/i);
});

test('P2E acceptance script has an explicit closed fixture boundary and redacts unresolved evidence', () => {
    assert.match(sql, /a\.is_enabled\s*=\s*false/);
    assert.match(sql, /test\|fixture\|sandbox/);
    assert.match(sql, /i\.status\s*=\s*'not_submitted'/);
    assert.match(sql, /u\.funding_state\s*=\s*'funded'/);
    assert.match(sql, /'NOT RUN'/);
    assert.match(sql, /双会话竞争仍需单独验收/);
    assert.match(sql, /真实上游/);
    assert.match(sql, /worker_output_redaction/);
    assert.match(sql, /未输出数据库错误或敏感值/);
});

test('P2E acceptance script covers serial fencing, marker cleanup, retry recovery and projection checks', () => {
    for (const marker of [
        'finish_without_start_ack_reject',
        'claim_start_finish',
        'finish_clears_request_marker',
        'wrong_token_reject',
        'expired_lease_reject',
        'lease_expiry_reclaim',
        'timeout_backoff_and_circuit',
        'resume_same_operation_replay',
        'admin_projection_authoritative'
    ]) assert.match(sql, new RegExp(`'${marker}'`));
    assert.match(sql, /p_action\s*=>\s*'claim'/);
    assert.match(sql, /p_action\s*=>\s*'start'/);
    assert.match(sql, /p_action\s*=>\s*'finish'/);
    assert.match(sql, /p_action\s*=>\s*'resume'/);
    assert.match(sql, /request_started_at\s+IS\s+NULL/);
    assert.match(sql, /circuit_until\s+>\s*clock_timestamp\(\)/);
});

test('P2E acceptance script does not rewrite structural results into business acceptance', () => {
    assert.match(sql, /runtime_structural_prerequisites/);
    assert.match(sql, /不代表并发、worker 或真实业务通过/);
    assert.match(sql, /real_supplier_business_acceptance/);
    assert.match(sql, /本脚本禁止调用虾仁、16688 或任何真实上游/);
    assert.match(sql, /concurrent|business/i);
});
