'use strict';

// Offline file generation only. This script never connects to a database.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const migrationDir = path.join(root, 'supabase/migrations');
const outputName = '20261017_tg_runtime_recovery.sql';
const sources = [
    '20261016_tg_purchase_zpay_reconciliation.sql',
    '20261016_tg_purchase_fulfillment_review.sql',
    '20261017_tg_purchase_review_resolution.sql',
    '20261017_tg_runtime_reconciliation.sql',
    '20261017_verify_tg_runtime_reconciliation.sql'
];

const preflight = `DO $$
DECLARE v_relation TEXT; v_signature TEXT; v_required RECORD;
BEGIN
    -- Check schema prerequisites, not the readiness function this recovery repairs.
    FOREACH v_relation IN ARRAY ARRAY[
        'public.profiles', 'public.tg_purchase_orders', 'public.tg_purchase_quotes',
        'public.tg_purchase_network_quotes', 'public.tg_purchase_order_stats',
        'public.tg_redemption_orders', 'public.tg_redemption_codes',
        'public.tg_fulfillment_attempts', 'public.tg_audit_events'
    ] LOOP
        IF to_regclass(v_relation) IS NULL THEN
            RAISE EXCEPTION 'TG recovery prerequisite missing relation: %; no repair has been committed', v_relation;
        END IF;
    END LOOP;
    FOR v_required IN SELECT * FROM (VALUES
        ('tg_purchase_orders', 'subtotal_minor', '20261015_tg_purchase_z_fees.sql'),
        ('tg_purchase_orders', 'payment_fee_minor', '20261015_tg_purchase_z_fees.sql'),
        ('tg_purchase_orders', 'payment_fee_rate_bps', '20261015_tg_purchase_z_fees.sql'),
        ('tg_purchase_quotes', 'subtotal_minor', '20261015_tg_purchase_z_fees.sql'),
        ('tg_purchase_quotes', 'payment_fee_minor', '20261015_tg_purchase_z_fees.sql'),
        ('tg_purchase_quotes', 'payment_fee_rate_bps', '20261015_tg_purchase_z_fees.sql'),
        ('tg_purchase_orders', 'cancelled_at', '20261016_tg_purchase_cancellation_expiry.sql'),
        ('tg_purchase_orders', 'crypto_checkout', '20261015_tg_purchase_usdt_payments.sql'),
        ('tg_purchase_orders', 'verified_payment', '20261015_tg_purchase_domain.sql'),
        ('tg_purchase_network_quotes', 'quote_id', '20261016_payment_usdt_network_selection.sql'),
        ('tg_purchase_network_quotes', 'pay_currency', '20261016_payment_usdt_network_selection.sql'),
        ('tg_redemption_orders', 'purchase_id', '20261015_tg_purchase_domain.sql'),
        ('tg_redemption_orders', 'provider_payment_currency', '20261015_tg_payment_currency_guard.sql'),
        ('tg_redemption_orders', 'submitted_at', '20261015_tg_redemption_worker.sql')
    ) AS required(table_name, column_name, migration) LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_attribute a
            WHERE a.attrelid = to_regclass('public.' || v_required.table_name)
                AND a.attname = v_required.column_name AND a.attnum > 0 AND NOT a.attisdropped) THEN
            RAISE EXCEPTION 'TG recovery prerequisite missing %.%; check %; no repair has been committed',
                v_required.table_name, v_required.column_name, v_required.migration;
        END IF;
    END LOOP;
    FOREACH v_signature IN ARRAY ARRAY[
        'public.fn_tg_preview_code(character)',
        'public.fn_tg_review_order(uuid,text,timestamp with time zone,uuid,text,jsonb)',
        'public.fn_tg_bind_purchase_network_quote(uuid,text)',
        'public.fn_tg_finish_order(uuid,uuid,text,text,jsonb,text,text,timestamp with time zone)'
    ] LOOP
        IF to_regprocedure(v_signature) IS NULL THEN
            RAISE EXCEPTION 'TG recovery prerequisite missing function: %; check operations, network and worker migrations; no repair has been committed', v_signature;
        END IF;
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM pg_index i
        WHERE i.indexrelid = to_regclass('public.idx_tg_redemption_orders_purchase')
            AND i.indrelid = 'public.tg_redemption_orders'::regclass AND i.indisunique AND i.indisvalid
            AND i.indnatts = 1 AND pg_get_indexdef(i.indexrelid, 1, true) = 'purchase_id'
            AND pg_get_expr(i.indpred, i.indrelid) = '(purchase_id IS NOT NULL)') THEN
        RAISE EXCEPTION 'TG recovery prerequisite missing valid unique purchase fulfillment index; no repair has been committed';
    END IF;
END;
$$;`;

function transactionBody(source, name) {
    const starts = [...source.matchAll(/^BEGIN(?: READ ONLY)?;\s*$/gm)];
    const commits = [...source.matchAll(/^COMMIT;\s*$/gm)];
    if (starts.length !== 1 || commits.length !== 1 || starts[0].index >= commits[0].index
        || source.slice(commits[0].index + commits[0][0].length).trim()) {
        throw new Error(`Unexpected transaction boundaries in ${name}`);
    }
    let body = source.slice(starts[0].index + starts[0][0].length, commits[0].index).trim();
    body = body.replace(/^NOTIFY pgrst, 'reload schema';\s*$/gm, '').trim();
    if (name.startsWith('20261017_verify_')) {
        const result = "SELECT 'TG reconciled runtime structural checks passed; concurrent/business acceptance remains NOT RUN' AS result;";
        if (!body.endsWith(result)) throw new Error(`Unexpected verification result in ${name}`);
        body = body.slice(0, -result.length).trim();
    }
    return body;
}

function buildRecovery() {
    const sections = sources.map(name => {
        const source = fs.readFileSync(path.join(migrationDir, name), 'utf8');
        const sha = crypto.createHash('sha256').update(source).digest('hex');
        return `-- BEGIN SOURCE: ${name}\n-- SHA256: ${sha}\n${transactionBody(source, name)}\n-- END SOURCE: ${name}`;
    });
    return `-- Operator-applied recovery for "TG purchase fulfillment review is not ready".
-- Generated offline by scripts/build-tg-runtime-recovery.js; do not edit source sections.
-- Run this WHOLE file in the SQL editor, not selected fragments. No database is accessed by the generator.
-- Replaces the failed resolution -> reconciliation sequence when operations_closure overwrote payment readiness.
-- One transaction restores payment proof, approval, closed-order resolution, and the final combined runtime.
-- Original readiness/ACL checks remain enforced; the final structural checks run BEFORE COMMIT.
-- No order/payment/fulfillment RPC is called, no existing order is replayed, and no switch is enabled.
-- Base fee/cancellation/network/worker/operations schemas must already exist; preflight reports missing prerequisites.
BEGIN;
SET LOCAL lock_timeout = '10s';

${preflight}

${sections.join('\n\n')}

NOTIFY pgrst, 'reload schema';
COMMIT;
SELECT 'TG runtime recovery committed; structural checks passed; concurrent/business acceptance remains NOT RUN' AS result;
`;
}

if (require.main === module) {
    if (process.argv.slice(2).some(arg => arg !== '--check')) throw new Error('Usage: node scripts/build-tg-runtime-recovery.js [--check]');
    const output = path.join(migrationDir, outputName);
    const source = buildRecovery();
    if (process.argv.includes('--check')) {
        if (!fs.existsSync(output) || fs.readFileSync(output, 'utf8') !== source) {
            throw new Error('TG recovery SQL is missing or stale; run node scripts/build-tg-runtime-recovery.js');
        }
        console.log('TG recovery SQL matches all source migrations; no SQL executed');
    } else {
        fs.writeFileSync(output, source);
        console.log(`Generated ${output}; no SQL executed`);
    }
}
module.exports = { buildRecovery, sources, transactionBody };
