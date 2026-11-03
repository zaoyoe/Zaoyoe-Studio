'use strict';
// Source contracts protect the migration boundary. No SQL is executed here.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (file) => fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');
const sql = read('supabase/migrations/20261019_shop_supplier_platform_v2_delivery_settlement.sql');
const verify = read('supabase/migrations/20261019_verify_shop_supplier_platform_v2_delivery_settlement.sql');
const runtime = read('server/integrations/suppliers/delivery.js');
const operations = read('server/integrations/suppliers/operations.js');
function body(name) {
    const start = sql.indexOf('CREATE OR REPLACE FUNCTION public.' + name + '(');
    assert.ok(start >= 0, name);
    const finish = sql.indexOf('\n$$;', start);
    assert.ok(finish > start, name);
    return sql.slice(start, finish);
}
function ordered(source, ...anchors) {
    let previous = -1;
    for (const anchor of anchors) {
        const next = source.indexOf(anchor, previous + 1);
        assert.ok(next > previous, `missing/out of order: ${anchor}`);
        previous = next;
    }
}
test('delivery installs only private immutable encrypted receipts and unseeded qualification', () => {
    assert.match(sql, /BEGIN;[\s\S]*COMMIT;/);
    for (const table of ['shop_supplier_delivery_verifications', 'shop_supplier_delivery_receipts', 'shop_supplier_delivery_access_events']) {
        assert.match(sql, new RegExp('ALTER TABLE public\\.' + table + ' ENABLE ROW LEVEL SECURITY'));
        assert.match(sql, new RegExp('GRANT SELECT ON TABLE[^;]*public\\.' + table + '[^;]*TO service_role'));
    }
    assert.doesNotMatch(sql, /INSERT INTO public\.shop_supplier_delivery_verifications|GRANT (?:INSERT|UPDATE|ALL)|SET\s+(?:dispatch_enabled|checkout_enabled)\s*=\s*true/i);
    assert.match(sql, /BEFORE UPDATE OR DELETE ON public\.shop_supplier_delivery_receipts/);
    assert.match(body('shop_supplier_delivery_receipt_immutable_v2'), /RAISE EXCEPTION 'supplier_delivery_receipt_immutable'/);
    assert.match(sql, /UNIQUE \(supplier_account_id, original_request_id\)/);
    assert.match(sql, /UNIQUE \(supplier_account_id, supplier_order_no\)/);
    assert.match(sql, /UNIQUE REFERENCES public\.shop_supplier_procurement_intents/);
});
test('sealed payload rejects null, excess fields, noncanonical encodings and mismatched fingerprints', () => {
    assert.match(sql, /sealed JSONB NOT NULL CONSTRAINT shop_supplier_delivery_sealed_check CHECK \(COALESCE\(/);
    for (const anchor of ["sealed - ARRAY['version','algorithm','keyId','nonce','ciphertext','tag','fingerprint']",
        "sealed ?& ARRAY['version','algorithm','keyId','nonce','ciphertext','tag','fingerprint']",
        "sealed->>'algorithm' = 'aes-256-gcm'", "octet_length(decode(sealed->>'ciphertext','base64')) BETWEEN 1 AND 32768",
        "sealed->>'fingerprint' = content_fingerprint, false)"]) assert.ok(sql.includes(anchor), anchor);
    assert.match(sql, /WHERE disposition = 'delivered'/);
    assert.doesNotMatch(sql, /\b(?:plaintext|card_content|card_secret)\s+(?:TEXT|JSONB)/i);
});
test('delivery qualification follows the frozen original account and expires independently of intake', () => {
    const ticket = body('fn_shop_supplier_delivery_ticket_v2');
    ordered(ticket, "COALESCE(auth.role(), '') <> 'service_role'", 'SELECT * INTO v_receipt', "'awaiting_acceptance'", 'SELECT * INTO v_proof', "'status','ready'");
    for (const anchor of ['v_attempt.account_snapshot', 'v_attempt.original_request_id', 'v_attempt.supplier_order_no',
        "v_proof.credential_ref IS DISTINCT FROM v_attempt.account_snapshot->>'credential_ref'", 'v_proof.valid_until <= clock_timestamp()']) assert.ok(ticket.includes(anchor), anchor);
    assert.doesNotMatch(ticket, /is_enabled|dispatch_enabled|checkout_enabled|FROM public\.shop_supplier_product_mappings/);
});
test('delivery locks native first and atomically writes evidence, debit, exposure, outbox and exact completion', () => {
    const record = body('fn_shop_supplier_record_delivery_v2');
    ordered(record, 'FROM public.shop_orders WHERE', 'FOR UPDATE',
        'FROM public.shop_supplier_fulfillment_units WHERE id = v_unit.id FOR UPDATE',
        'FROM public.shop_supplier_transaction_policies', 'FROM public.shop_supplier_procurement_intents WHERE id = p_intent_id FOR UPDATE',
        'FROM public.shop_supplier_dispatch_attempts WHERE intent_id = p_intent_id FOR UPDATE',
        'INSERT INTO public.shop_supplier_delivery_receipts', 'actual_cost_cny = v_cost',
        'UPDATE public.shop_supplier_transaction_outbox', 'UPDATE public.shop_orders SET delivery_status');
    assert.match(record, /UPDATE public\.guest_shop_orders SET fulfillment_status = 'delivered'/);
    assert.match(record, /supplier_dispatch_version = supplier_dispatch_version \+ 1/);
    assert.doesNotMatch(record, /COMMIT|INSERT INTO public\.(?:shop_inventory|shop_order_profit_ledger)|fn_.*(?:refund|reward|commission)/);
});
test('accepted and funded original identity, final cost ceiling and content ownership gate completion', () => {
    const record = body('fn_shop_supplier_record_delivery_v2');
    for (const anchor of ["v_unit.funding_state <> 'funded'", "v_intent.status <> 'accepted'", "v_attempt.state <> 'accepted'",
        'v_attempt.request_started_at IS NULL', "p_receipt->>'requestId' IS DISTINCT FROM v_intent.original_request_id::TEXT",
        "p_receipt->>'accountId' IS DISTINCT FROM v_intent.supplier_account_id::TEXT", "p_receipt->>'orderNo' IS DISTINCT FROM v_intent.supplier_order_no",
        'v_cost > v_unit.cost_ceiling_cny', 'native_not_deliverable', 'cost_above_ceiling', 'duplicate_content',
        "reserved_cost_cny = CASE WHEN v_reason IS NULL THEN 0 ELSE reserved_cost_cny END"]) assert.ok(record.includes(anchor), anchor);
    ordered(record, 'pg_advisory_xact_lock', 'content_fingerprint =', 'INSERT INTO public.shop_supplier_delivery_receipts');
    assert.match(record, /supplier_delivery_result_conflict/);
    assert.match(record, /'duplicate',true/);
    const hash = record.slice(record.indexOf('v_result_hash :='), record.indexOf('SELECT * INTO v_existing'));
    assert.match(hash, /'content',p_receipt->'sealed'->>'fingerprint'/);
    assert.doesNotMatch(hash, /ciphertext|nonce|tag/);
});
test('delivery exception preserves refund and native financial guards without caller GUC bypass', () => {
    const guard = body('shop_supplier_dispatch_native_guard_v2');
    for (const anchor of ['NEW.refund_status IS DISTINCT FROM OLD.refund_status', 'NEW.user_id IS DISTINCT FROM OLD.user_id',
        'NEW.price_paid IS DISTINCT FROM OLD.price_paid', 'NEW.payment_status IS DISTINCT FROM OLD.payment_status',
        'NEW.currency IS DISTINCT FROM OLD.currency', 'NEW.paid_at IS DISTINCT FROM OLD.paid_at',
        'to_jsonb(NEW) - ARRAY', 'to_jsonb(OLD) - ARRAY', 'supplier_dispatch_resolution_required']) assert.ok(guard.includes(anchor), anchor);
    assert.doesNotMatch(guard, /current_setting|set_config/);
    const native = body('shop_supplier_native_order_guard_v2');
    assert.match(native, /supplier_source_immutable/);
    assert.match(native, /supplier_local_fulfillment_forbidden/);
    assert.match(native, /supplier_verified_delivery_required/);
    assert.match(body('shop_supplier_delivery_projection_matches_v2'), /r\.disposition = 'delivered'/);
});
test('customer delivery requires native ownership, exact delivered projection and nonsecret access audit', () => {
    const customer = body('fn_shop_supplier_customer_delivery_v2');
    ordered(customer, "COALESCE(auth.role(), '') <> 'service_role'", 'user_id = p_buyer_user_id',
        'buyer_user_id = p_buyer_user_id', "v_receipt.disposition <> 'delivered'", 'shop_supplier_delivery_projection_matches_v2',
        'INSERT INTO public.shop_supplier_delivery_access_events', "'sealed',v_receipt.sealed");
    assert.match(customer, /IF p_buyer_user_id IS NOT NULL THEN RAISE EXCEPTION/);
    const audit = customer.slice(customer.indexOf('INSERT INTO public.shop_supplier_delivery_access_events'), customer.indexOf('RETURN jsonb_build_object(\'status\',\'delivered\''));
    assert.doesNotMatch(audit, /sealed|content|token|password|fingerprint/);
});
test('bounded operations projection supports historical disabled accounts and excludes content and credentials', () => {
    const projection = body('fn_shop_supplier_operations_v2');
    assert.match(projection, /p_limit NOT BETWEEN 1 AND 100/);
    assert.match(projection, /LIMIT p_limit \+ 1/);
    assert.match(projection, /a\.provider_id = p_provider_id/);
    assert.match(projection, /a\.account_key = p_account_key/);
    assert.match(projection, /u\.funding_kind = p_funding_kind/);
    assert.match(projection, /u\.site = p_site/);
    assert.match(projection, /'canRefund',false/);
    assert.doesNotMatch(projection, /is_enabled|credential|sealed|content|claim_token|lookup_password/);
    assert.doesNotMatch(operations, /require\(['"].*(?:registry|client)|queryDelivery|resolveAdapter/);
});
test('private functions are revoked for public clients and helpers stay private even from service role', () => {
    const grants = sql.slice(sql.lastIndexOf('REVOKE ALL ON FUNCTION public.shop_supplier_delivery_receipt_immutable_v2'));
    assert.match(grants, /shop_supplier_delivery_projection_matches_v2\(TEXT,JSONB\)[\s\S]*FROM PUBLIC, anon, authenticated, service_role/);
    assert.match(grants, /GRANT EXECUTE ON FUNCTION public\.fn_shop_supplier_delivery_ticket_v2[\s\S]*TO service_role/);
    assert.doesNotMatch(grants.slice(grants.indexOf('GRANT EXECUTE')), /GRANT EXECUTE[^;]*shop_supplier_delivery_projection_matches_v2/);
});
test('default-off crypto/query module is not a worker or a qualified production adapter', () => {
    assert.match(runtime, /SHOP_SUPPLIER_DELIVERY_V2_ENABLED !== 'true'/);
    assert.match(runtime, /aes-256-gcm/);
    assert.match(runtime, /cipher\.setAAD/);
    assert.match(runtime, /decipher\.setAAD/);
    assert.match(runtime, /SHOP_SUPPLIER_DELIVERY_FINGERPRINT_KEY/);
    for (const file of ['server/integrations/suppliers/xiareng/client.js', 'server/integrations/suppliers/16688/client.js']) {
        assert.doesNotMatch(read(file), /async queryDelivery\(|deliveryContract\s*:/);
    }
    for (const file of ['server/guest-shop-worker.js', 'server/index.js']) {
        if (fs.existsSync(path.resolve(__dirname, '..', file))) assert.doesNotMatch(read(file), /createDeliveryRunner|supplier.*delivery.*\.reconcile/);
    }
});
test('readonly verifier inspects constraints, triggers, privileges and preserves acceptance limits', () => {
    assert.match(verify, /SET TRANSACTION READ ONLY/);
    for (const anchor of ['has_any_column_privilege', 'pg_get_constraintdef', 'convalidated', 'pg_index', 'indisunique',
        'pg_trigger', 'prosecdef', 'has_function_privilege', 'supplier_dispatch_resolution_required',
        'Supplier delivery cost/identity/native projection mismatch', 'dispatch_enabled OR checkout_enabled']) assert.ok(verify.includes(anchor), anchor);
    assert.match(verify, /DB concurrency, key recovery, merchant and business acceptance remain NOT RUN/);
    assert.doesNotMatch(verify, /INSERT INTO|UPDATE public\.|DELETE FROM|CREATE TABLE|CREATE OR REPLACE/);
});
test('operator record keeps user-reported SQL separate from actual acceptance and unfinished scope', () => {
    const runbook = read('docs/shop-supplier-platform-2.0-delivery-settlement-runbook.md');
    const plan = read('docs/shop-supplier-platform-2.0-plan.md');
    for (const anchor of ['用户报告执行', 'NOT RUN', 'P2 整阶段尚未完成', '42 PASS / 1 FAIL',
        'P2D-2', '游客详情', '未推送、未部署', '32768', 'SHOP_SUPPLIER_DELIVERY_FINGERPRINT_KEY']) assert.ok(runbook.includes(anchor), anchor);
    assert.match(plan, /## 21\. 2026-10-19 P2D-1/);
    for (const section of ['## 18.', '## 19.', '## 20.']) assert.ok(plan.includes(section), section);
});
test('Xiareng P1B remains gated on sanitized category semantics and an isolated schema baseline', () => {
    const plan = read('docs/shop-supplier-platform-2.0-plan.md');
    const gate = plan.slice(plan.indexOf('### 38.7 下一阶段证据包与放行门'));
    for (const anchor of ['至少两次不同时间的脱敏', '唯一范围及改名、重排、删除重建后的稳定性确认',
        '应用源码 commit SHA', 'schema-only 导出 SHA-256', '应用迁移账本中的已应用版本清单',
        '只做离线完整性与依赖比对', '不连接数据库、不执行 SQL', 'NOT RECEIVED']) {
        assert.ok(gate.includes(anchor), anchor);
    }
    assert.match(gate, /本节不是 SQL 执行或真实商户调用授权/);
});
test('production migration-ledger evidence stays read-only and does not satisfy the isolated G0 baseline', () => {
    const plan = read('docs/shop-supplier-platform-2.0-plan.md');
    const section = plan.slice(plan.indexOf('## 38.9 2026-11-01 zaoyoe 生产迁移账本只读结果更正'));
    const ledgerSql = read('supabase/acceptance/20261101_supplier_remote_migration_ledger_readonly.sql');
    const executable = ledgerSql.replace(/--[^\n]*/g, '');
    assert.ok(section.length > 0, 'missing appended evidence correction');
    assert.match(section, /main PRODUCTION/);
    assert.match(section, /G0 仍未通过/);
    assert.match(section, /不能排除有人曾在 SQL Editor 手动执行/);
    assert.match(section, /分类身份继续 `unverified`/);
    assert.match(section, /321 个 SQL 文件/);
    assert.match(section, /不能组成可证明从空库重建当前商城的基线/);
    for (const [version, name] of [
        ['202606171905', 'prompt_free_unlock_daily_limit_hotfix'],
        ['202606171922', 'unlock_prompt_v2_drop_varchar_overload'],
        ['20260628', 'ai_image_video_constraints'],
        ['20260712', 'prompt_gallery_video_assets'],
        ['20260727', 'prompt_gallery_import_dedupe_timeout_fix'],
        ['20260731', 'ai_workbench_fast_admission'],
    ]) {
        assert.ok(section.includes('`' + version + '`'), version);
        assert.ok(section.includes('`' + name + '`'), name);
    }
    assert.match(ledgerSql, /BEGIN TRANSACTION READ ONLY;/);
    assert.match(ledgerSql, /FROM supabase_migrations\.schema_migrations/);
    assert.match(ledgerSql, /ROLLBACK;/);
    assert.doesNotMatch(executable, /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE)\b/i);
});

test('observed 8000 Xiareng catalog evidence updates P1A without opening P1B', () => {
    const plan = read('docs/shop-supplier-platform-2.0-plan.md');
    const evidence = read('supabase/acceptance/20261101_supplier_baseline_evidence.md');
    const correction = plan.slice(plan.indexOf('## 38.12 2026-11-02 8000 目录只读观察更正'));
    assert.ok(correction.length > 0, 'missing 8000 catalog correction');
    for (const anchor of ['2026-11-02 08:25:26', '2026-11-02 08:33:01', '181', '3665',
        'OBSERVED / READ-ONLY', 'P1B 持久分类树、分类映射和按分类持久化导入：**BLOCKED ON UPSTREAM EVIDENCE**',
        'G0 supplier-focused 本地隔离基线：**PASS（范围受限）**']) assert.ok(correction.includes(anchor), anchor);
    for (const anchor of ['categoryCount=181', 'itemCount=3665', 'stable=true',
        'identityStatus=unverified', 'categoryIdentityStatus=unverified',
        'b7ee5175ea9fcddd50898f46f2286cc9dc2d1628a48152b82b624c538091752c',
        'b74029f46ff8a2a38ea40d0aeea673728fbb97449bd922ef91e3be6220b0490e']) {
        assert.ok(evidence.includes(anchor), anchor);
    }
    assert.match(correction, /不执行生产写 SQL/);
    assert.match(correction, /不建立持久分类映射/);
});
