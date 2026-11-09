'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const evidencePath = path.join(root, 'docs/security-audit-evidence/2026-11-09-card-store-round11-settlement/kc-mysql-preflight-20261109-v4.tsv');
const preflightPath = path.join(root, 'services/kc-pay-gpt/acceptance/payment-attempt-ledger/20261109-migration-preflight-READONLY.sql');
const candidatePath = path.join(root, 'services/kc-pay-gpt/acceptance/payment-attempt-ledger/20261109-payment-attempt-ledger-CANDIDATE-DRAFT.sql');

function lines(file) { return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean); }
function rowSet(file) { return new Set(lines(file)); }

test('archived KC preflight is a MySQL 8.0.46 read-only evidence set', () => {
    const rows = rowSet(evidencePath);
    assert.ok(rows.has('8.0.46\tMySQL Community Server - GPL'));
    assert.ok(rows.has('plus_papay'));
    assert.ok(rows.has('card_assets\tInnoDB\tutf8mb4_unicode_ci\t3'));
    assert.ok(rows.has('billing_records\tInnoDB\tutf8mb4_unicode_ci\t72'));
    assert.ok(rows.has('3\t0\t0\t2'));
    assert.ok(rows.has('100\t63\t3'));
    assert.ok(rows.has('21\t9'));
    assert.ok(!lines(evidencePath).some(line => /kc_local_payment_attempts|payment_attempt_id|local_payment_attempt_id/.test(line)
        && !line.startsWith('TABLE_NAME')));
});

test('candidate migration has four checkpoints and no circular billing FK', () => {
    const sql = fs.readFileSync(candidatePath, 'utf8');
    for (const marker of ['CHECKPOINT L1', 'CHECKPOINT L2', 'CHECKPOINT S1', 'CHECKPOINT S2']) assert.match(sql, new RegExp(marker));
    assert.match(sql, /CREATE TABLE kc_local_payment_attempts/);
    assert.match(sql, /ADD COLUMN payment_attempt_id/);
    assert.match(sql, /ADD COLUMN local_payment_attempt_id/);
    assert.match(sql, /fk_kc_attempt_settlement_bill/);
    assert.doesNotMatch(sql, /fk_billing_local_payment_attempt/);
    assert.equal((sql.match(/FOREIGN KEY/g) || []).length, 1);
    assert.match(sql, /No existing local attempt is backfilled/);
    assert.match(sql, /MySQL DDL has\s+--      implicit commits/);
});

test('read-only preflight contains no mutation statement', () => {
    const sql = fs.readFileSync(preflightPath, 'utf8').toUpperCase();
    for (const token of ['CREATE ', 'ALTER ', 'INSERT ', 'UPDATE ', 'DELETE ', 'DROP ', 'TRUNCATE ', 'GRANT ', 'REVOKE ']) {
        assert.equal(sql.includes(token), false, `unexpected mutation token ${token}`);
    }
    assert.match(sql, /INFORMATION_SCHEMA/);
});

test('candidate remains review-only and production schema source stays unchanged', () => {
    const candidate = fs.readFileSync(candidatePath, 'utf8');
    const schema = fs.readFileSync(path.join(root, 'services/kc-pay-gpt/mysql-schema.sql'), 'utf8');
    assert.match(candidate, /CANDIDATE DRAFT \/ REVIEW ONLY \/ NOT EXECUTED/);
    assert.doesNotMatch(schema, /kc_local_payment_attempts|payment_attempt_id|local_payment_attempt_id|settlement_billing_id/);
});
