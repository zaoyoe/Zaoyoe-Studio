'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');

function read(rel) {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function section(source, heading) {
    const start = source.indexOf(heading);
    assert.ok(start >= 0, `missing ${heading}`);
    const next = source.indexOf('\n### ', start + heading.length);
    return source.slice(start, next === -1 ? source.length : next);
}

test('promo TTL migration only changes the guest order created_at default', () => {
    const sql = read('supabase/migrations/20260926_guest_shop_promo_ttl_clock.sql');
    assert.match(sql, /ALTER TABLE public\.guest_shop_orders\s+ALTER COLUMN created_at SET DEFAULT clock_timestamp\(\);/u);
    assert.equal((sql.match(/ALTER TABLE/gu) || []).length, 1);
    assert.doesNotMatch(sql, /^(?:INSERT|UPDATE|DELETE|TRUNCATE)\s+/imu);
    assert.doesNotMatch(sql, /allow_guest_purchase\s*=\s*true/iu);
    assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION/u);
    assert.doesNotMatch(sql, /20260925_guest_shop_promo_gates/u);
});

test('applied create function still omits created_at so the new default is used', () => {
    const sql = read('supabase/migrations/20260923_guest_shop_promo_l1l2.sql');
    const marker = 'INSERT INTO public.guest_shop_orders (';
    const start = sql.indexOf(marker);
    assert.ok(start >= 0);
    const values = sql.indexOf(') VALUES (', start);
    assert.ok(values > start);
    const columns = sql.slice(start, values);
    assert.doesNotMatch(columns, /\bcreated_at\b/u);
    assert.match(columns, /\bexpires_at\b/u);
    assert.match(sql, /v_now TIMESTAMPTZ := clock_timestamp\(\);/u);
    assert.match(sql, /v_expires_at := v_now \+ make_interval\(secs => p_ttl_seconds\);/u);
    const original = read('supabase/migrations/20260913_add_guest_shop_cash_purchase.sql');
    const tableStart = original.indexOf('CREATE TABLE IF NOT EXISTS public.guest_shop_orders');
    const tableEnd = original.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS ux_guest_shop_orders_site_idempotency', tableStart);
    assert.ok(tableStart >= 0 && tableEnd > tableStart);
    assert.match(original.slice(tableStart, tableEnd), /created_at TIMESTAMPTZ NOT NULL DEFAULT NOW\(\),/u);
});

test('ttl clock verify is read-only and checks the default the trigger compares', () => {
    const sql = read('supabase/migrations/20260926_verify_guest_shop_promo_ttl_clock.sql');
    assert.match(sql, /SELECT check_name, ok, detail/u);
    assert.match(sql, /'created_at_default'/u);
    assert.match(sql, /'create_order_omits_created_at'/u);
    assert.match(sql, /'create_order_uses_clock_timestamp'/u);
    assert.match(sql, /expr = 'clock_timestamp\(\)'/u);
    assert.match(sql, /fn_guest_shop_create_order\(text,uuid,uuid,text,text,text,text,text,text,uuid,text,text,integer,integer,text\)/u);
    assert.doesNotMatch(sql, /^(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE)\s+/imu);
});

test('card 7 zero-order readback stays partial until the clock default is verified', () => {
    const plan = read('docs/guest-purchase-task-2.0.md');
    const evidence = read('docs/guest-shop-promo-evidence.md');
    const sandbox = read('docs/guest-shop-promo-sandbox-runbook.md');
    const hardening = read('docs/guest-shop-promo-hardening-plan.md');
    const payment = read('docs/guest-shop-payment-fulfillment-runbook.md');
    const current = section(plan, '### 61.37 ');
    const evidenceCurrent = section(evidence, '### 2.25 ');

    for (const source of [current, evidenceCurrent, sandbox, hardening, payment]) {
        assert.match(source, /没有留下订单/u);
        assert.match(source, /guest_promo_order_ttl_invalid/u);
        assert.match(source, /20260926_guest_shop_promo_ttl_clock\.sql/u);
        assert.match(source, /20260926_verify_guest_shop_promo_ttl_clock\.sql/u);
    }
    assert.match(current, /阶段 5 保持 `in_progress`/u);
    assert.match(current, /80%（4\/5）/u);
    assert.match(current, /不得改写成整卡 PASS/u);
    assert.match(current, /验证通过前不要建单/u);
    assert.doesNotMatch(current, /阶段 5 保持 `complete`|总进度保持 \*\*100%/u);
    assert.match(evidenceCurrent, /卡 7 继续 PARTIAL/u);
    assert.match(plan, /现行记录见 §61\.38/u);
    assert.match(current, /现行记录见 §61\.37/u);
    assert.match(evidence, /### 2\.24 卡 7「沙箱CD7」确认通过，促销 commit 返回 500（2026-09-22，回读已由 §2\.25 闭合）/u);
});

test('card 7 clock verification is archived without opening a new order', () => {
    const plan = read('docs/guest-purchase-task-2.0.md');
    const evidence = read('docs/guest-shop-promo-evidence.md');
    const sandbox = read('docs/guest-shop-promo-sandbox-runbook.md');
    const hardening = read('docs/guest-shop-promo-hardening-plan.md');
    const payment = read('docs/guest-shop-payment-fulfillment-runbook.md');
    const current = section(plan, '### 61.38 ');
    const evidenceCurrent = section(evidence, '### 2.26 ');

    for (const source of [current, evidenceCurrent]) {
        assert.match(source, /clock_timestamp\(\)/u);
        assert.match(source, /15-arg INSERT omits created_at/u);
        assert.match(source, /v_now is clock_timestamp and expires_at adds p_ttl_seconds/u);
        assert.match(source, /下一笔还没打/u);
        assert.match(source, /尚未建单/u);
        assert.match(source, /80%（4\/5）/u);
        assert.match(source, /卡 7 继续 PARTIAL/u);
        assert.match(source, /S154_cd7_promo_hold_readback\.sql/u);
        assert.match(source, /S154_cd7_promo_expiry_readback\.sql/u);
        assert.match(source, /未到 `expires_at` 不是失败/u);
        assert.match(source, /不要提前截止时间/u);
        assert.match(source, /不要付款/u);
        assert.doesNotMatch(source, /阶段 5 保持 `complete`|总进度保持 \*\*100%/u);
    }
    for (const source of [sandbox, hardening, payment]) {
        assert.match(source, /S154_cd7_promo_hold_readback\.sql/u);
        assert.match(source, /S154_cd7_promo_expiry_readback\.sql/u);
        assert.match(source, /尚未建单/u);
    }
    assert.match(evidence, /### 2\.24 卡 7「沙箱CD7」确认通过，促销 commit 返回 500（2026-09-22，回读已由 §2\.25 闭合）/u);
    assert.match(evidence, /卡 7 继续是 PARTIAL/u);
});

test('card 7 promo readbacks stay read-only and name both outcomes', () => {
    for (const rel of [
        'supabase/sandbox/S154_cd7_promo_hold_readback.sql',
        'supabase/sandbox/S154_cd7_promo_expiry_readback.sql'
    ]) {
        const sql = read(rel);
        assert.equal((sql.match(/;/g) || []).length, 1);
        assert.match(sql, /SELECT\s+target_present,/u);
        assert.doesNotMatch(sql, /(?:^|[\n;])\s*(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE)\b/iu);
        assert.doesNotMatch(sql, /\b(buyer_email|contact_email|client_ip|credential|cookie|payment_url|card_secret|query_password)\b/iu);
    }
    const hold = read('supabase/sandbox/S154_cd7_promo_hold_readback.sql');
    assert.match(hold, /还没有这 1 笔/u);
    assert.match(hold, /持有已闭合/u);
    assert.match(hold, /这不是归还失败/u);
    const expiry = read('supabase/sandbox/S154_cd7_promo_expiry_readback.sql');
    assert.match(expiry, /仍在 TTL 内/u);
    assert.match(expiry, /归还已闭合/u);
    assert.match(expiry, /这仍不是整卡 PASS/u);
    assert.match(expiry, /只归还了一边，这是泄漏/u);
    assert.match(expiry, /worker 还没跑，不是失败/u);
    assert.match(expiry, /不要手工改行/u);
});

test('card 7 one unpaid promo order is waiting on the hold readback', () => {
    const plan = read('docs/guest-purchase-task-2.0.md');
    const evidence = read('docs/guest-shop-promo-evidence.md');
    const sandbox = read('docs/guest-shop-promo-sandbox-runbook.md');
    const hardening = read('docs/guest-shop-promo-hardening-plan.md');
    const payment = read('docs/guest-shop-payment-fulfillment-runbook.md');
    const current = section(plan, '### 61.39 ');
    const evidenceCurrent = section(evidence, '### 2.27 ');
    const historical = section(plan, '### 61.38 ');

    assert.match(plan, /现行记录见 §61\.39/u);
    assert.match(historical, /尚未建单/u);
    for (const source of [current, evidenceCurrent, sandbox, hardening, payment]) {
        assert.match(source, /GS2026092207342938190F2B83D5ACF/u);
        assert.match(source, /不要再打第二笔/u);
        assert.match(source, /不要付款/u);
        assert.match(source, /S154_cd7_promo_hold_readback\.sql/u);
        assert.match(source, /持有回读还没贴回/u);
    }
    assert.match(current, /commit HTTP 201/u);
    assert.match(current, /应付 9\.09/u);
    assert.match(current, /2026-09-22T07:44:29\.38158\+00:00/u);
    assert.match(current, /卡 7 继续 PARTIAL/u);
    assert.match(current, /80%（4\/5）/u);
    assert.match(current, /未到 `expires_at` 不是失败/u);
    assert.doesNotMatch(current, /阶段 5 保持 `complete`|总进度保持 \*\*100%/u);
});

test('card 7 hold readback is archived and expiry is still open', () => {
    const plan = read('docs/guest-purchase-task-2.0.md');
    const evidence = read('docs/guest-shop-promo-evidence.md');
    const sandbox = read('docs/guest-shop-promo-sandbox-runbook.md');
    const hardening = read('docs/guest-shop-promo-hardening-plan.md');
    const payment = read('docs/guest-shop-payment-fulfillment-runbook.md');
    const current = section(plan, '### 61.40 ');
    const evidenceCurrent = section(evidence, '### 2.28 ');
    const previous = section(plan, '### 61.39 ');

    assert.match(plan, /现行记录见 §61\.40/u);
    assert.match(plan, /现行记录见 §61\.39/u);
    assert.match(previous, /持有回读还没贴回/u);
    for (const source of [current, evidenceCurrent, sandbox, hardening, payment]) {
        assert.match(source, /持有已闭合/u);
        assert.match(source, /GS2026092207342938190F2B83D5ACF/u);
        assert.match(source, /599\.848/u);
        assert.match(source, /S154_cd7_promo_expiry_readback\.sql/u);
        assert.match(source, /到期回读还没贴回/u);
        assert.match(source, /不要再打第二笔/u);
        assert.match(source, /不要付款/u);
        assert.match(source, /不要提前截止时间/u);
        assert.match(source, /卡 7 继续 PARTIAL/u);
    }
    assert.match(current, /不要把 Node 的 600 改成 599/u);
    assert.match(current, /不是丢卡/u);
    assert.match(current, /未到 `expires_at` 不是失败/u);
    assert.match(current, /80%（4\/5）/u);
    assert.doesNotMatch(current, /阶段 5 保持 `complete`|总进度保持 \*\*100%/u);
    assert.match(current, /不得改写成整卡 PASS/u);
});

test('card 7 expiry return is archived and the guest switch is still open', () => {
    const plan = read('docs/guest-purchase-task-2.0.md');
    const evidence = read('docs/guest-shop-promo-evidence.md');
    const sandbox = read('docs/guest-shop-promo-sandbox-runbook.md');
    const hardening = read('docs/guest-shop-promo-hardening-plan.md');
    const payment = read('docs/guest-shop-payment-fulfillment-runbook.md');
    const current = section(plan, '### 61.41 ');
    const evidenceCurrent = section(evidence, '### 2.29 ');
    const previous = section(plan, '### 61.40 ');

    assert.match(plan, /现行记录见 §61\.41/u);
    assert.match(plan, /现行记录见 §61\.40/u);
    assert.match(previous, /到期回读还没贴回/u);
    for (const source of [current, evidenceCurrent, sandbox, hardening, payment]) {
        assert.match(source, /归还已闭合/u);
        assert.match(source, /GS2026092207342938190F2B83D5ACF/u);
        assert.match(source, /-128\.353/u);
        assert.match(source, /expired/u);
        assert.match(source, /cn_budget_is_today/u);
        assert.match(source, /S154_cd7_switch_off_readonly\.sql/u);
        assert.match(source, /不要回写九项历史表/u);
        assert.match(source, /游客开关还没关/u);
        assert.match(source, /不要付款/u);
        assert.match(source, /不要再打一笔/u);
        assert.match(source, /卡 7 继续 PARTIAL/u);
    }
    assert.match(current, /不是丢卡/u);
    assert.match(current, /订单行仍记着抵扣 1\.00/u);
    assert.match(current, /80%（4\/5）/u);
    assert.match(current, /不得改写成整卡 PASS/u);
    assert.doesNotMatch(current, /阶段 5 保持 `complete`|总进度保持 \*\*100%/u);

    const sql = read('supabase/sandbox/S154_cd7_switch_off_readonly.sql');
    assert.equal((sql.match(/;/g) || []).length, 1);
    assert.match(sql, /SELECT\s+target_present,/u);
    assert.match(sql, /游客开关已关/u);
    assert.match(sql, /游客开关还开着/u);
    assert.match(sql, /不要用 SQL 关/u);
    assert.doesNotMatch(sql, /(?:^|[\n;])\s*(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE)\b/iu);
    assert.doesNotMatch(sql, /\b(buyer_email|contact_email|client_ip|credential|cookie|payment_url|card_secret|query_password)\b/iu);
});

test('card 7 guest switch close is archived and card 8 stays unauthorized', () => {
    const plan = read('docs/guest-purchase-task-2.0.md');
    const evidence = read('docs/guest-shop-promo-evidence.md');
    const sandbox = read('docs/guest-shop-promo-sandbox-runbook.md');
    const hardening = read('docs/guest-shop-promo-hardening-plan.md');
    const payment = read('docs/guest-shop-payment-fulfillment-runbook.md');
    const current = section(plan, '### 61.42 ');
    const evidenceCurrent = section(evidence, '### 2.30 ');
    const previous = section(plan, '### 61.41 ');

    assert.match(plan, /现行记录见 §61\.42/u);
    assert.match(plan, /现行记录见 §61\.41/u);
    assert.match(previous, /游客开关还没关/u);
    assert.match(current, /上一节写入时的现行记录见 §61\.41/u);
    for (const source of [current, evidenceCurrent, sandbox, hardening, payment]) {
        assert.match(source, /游客开关已关/u);
        assert.match(source, /5f940176-8059-443a-b5fd-79adc883a810/u);
        assert.match(source, /c955f03a-8cd6-44b8-b751-06e2ad66d4cd/u);
        assert.match(source, /product_allow_guest=false/u);
        assert.match(source, /guest_switch_off=true/u);
        assert.match(source, /登录积分商城可能还能看到这 6 张/u);
        assert.match(source, /不要再打开/u);
        assert.match(source, /不要建单/u);
        assert.match(source, /不要付款/u);
        assert.match(source, /卡 7 继续 PARTIAL/u);
        assert.match(source, /不要回写九项历史表/u);
        assert.match(source, /卡 8/u);
    }
    assert.match(current, /GS2026092207342938190F2B83D5ACF/u);
    assert.match(current, /订单行仍记着抵扣 1\.00/u);
    assert.match(current, /80%（4\/5）/u);
    assert.match(current, /不得改写成整卡 PASS/u);
    assert.match(current, /GUEST_SHOP_DISCOUNT_ENABLED/u);
    assert.match(current, /GUEST_SHOP_MAX_QUANTITY` 保持 1/u);
    assert.match(current, /不得应用 `supabase\/migrations\/20260925_guest_shop_promo_gates\.sql`/u);
    assert.doesNotMatch(current, /阶段 5 保持 `complete`|总进度保持 \*\*100%/u);
    assert.match(sandbox, /游客开关还没关/u);
    assert.match(hardening, /游客开关还没关/u);
    assert.match(payment, /游客开关还没关/u);
});

test('card 8 breaker baseline is read-only and does not reopen the guest switch', () => {
    const plan = read('docs/guest-purchase-task-2.0.md');
    const evidence = read('docs/guest-shop-promo-evidence.md');
    const sandbox = read('docs/guest-shop-promo-sandbox-runbook.md');
    const hardening = read('docs/guest-shop-promo-hardening-plan.md');
    const payment = read('docs/guest-shop-payment-fulfillment-runbook.md');
    const current = section(plan, '### 61.43 ');
    const evidenceCurrent = section(evidence, '### 2.31 ');
    const previous = section(plan, '### 61.42 ');

    assert.match(plan, /现行记录见 §61\.43/u);
    assert.match(plan, /现行记录见 §61\.42/u);
    assert.match(previous, /卡 8 不作为下一步/u);
    assert.match(current, /上一节写入时的现行记录见 §61\.42/u);
    for (const source of [current, evidenceCurrent, sandbox, hardening, payment]) {
        assert.match(source, /S154_cd8_breaker_baseline_readonly\.sql/u);
        assert.match(source, /基线通过/u);
        assert.match(source, /fn_guest_shop_promo_status/u);
        assert.match(source, /guest_promo_halted/u);
        assert.match(source, /不要打开熔断/u);
        assert.match(source, /沙箱CD7/u);
        assert.match(source, /不要建单/u);
        assert.match(source, /不要付款/u);
        assert.match(source, /GUEST_SHOP_DISCOUNT_ENABLED/u);
        assert.match(source, /GS2026092207342938190F2B83D5ACF/u);
        assert.match(source, /卡 7 继续 PARTIAL/u);
        assert.match(source, /80%（4\/5）/u);
    }
    assert.match(current, /各加 1/u);
    assert.match(current, /不得改写成整卡 PASS/u);
    assert.match(current, /GUEST_SHOP_MAX_QUANTITY` 保持 1/u);
    assert.match(current, /不得应用 `supabase\/migrations\/20260925_guest_shop_promo_gates\.sql`/u);
    assert.match(current, /卡 9 还没开始/u);
    assert.doesNotMatch(current, /阶段 5 保持 `complete`|总进度保持 \*\*100%/u);

    const sql = read('supabase/sandbox/S154_cd8_breaker_baseline_readonly.sql');
    assert.equal((sql.match(/;/g) || []).length, 1);
    assert.match(sql, /AS breaker_present,/u);
    assert.match(sql, /基线通过/u);
    assert.match(sql, /缺行/u);
    assert.match(sql, /熔断不是 closed/u);
    assert.doesNotMatch(sql, /fn_guest_shop_promo_status/u);
    assert.doesNotMatch(sql, /fn_guest_shop_promo_set_breaker/u);
    assert.doesNotMatch(sql, /(?:^|[\n;])\s*(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE)\b/iu);
    assert.doesNotMatch(sql, /\b(buyer_email|contact_email|client_ip|credential|cookie|payment_url|card_secret|query_password)\b/iu);
});

test('card 8 breaker open is one audited write plus a read-only review', () => {
    const plan = read('docs/guest-purchase-task-2.0.md');
    const evidence = read('docs/guest-shop-promo-evidence.md');
    const sandbox = read('docs/guest-shop-promo-sandbox-runbook.md');
    const hardening = read('docs/guest-shop-promo-hardening-plan.md');
    const payment = read('docs/guest-shop-payment-fulfillment-runbook.md');
    const toolbox = read('supabase/sandbox/s154-guest-promo-toolbox.js');
    const fixture = read('supabase/sandbox/S154_fixture_setup.sql');
    const current = section(plan, '### 61.44 ');
    const evidenceCurrent = section(evidence, '### 2.32 ');
    const previous = section(plan, '### 61.43 ');
    const evidencePrevious = section(evidence, '### 2.31 ');

    assert.match(plan, /现行记录见 §61\.44/u);
    assert.match(plan, /现行记录见 §61\.43/u);
    assert.match(previous, /尚未贴回/u);
    assert.match(previous, /不要打开熔断/u);
    assert.match(previous, /基线回读还没贴回/u);
    assert.match(evidencePrevious, /尚未贴回/u);
    assert.match(evidencePrevious, /不要打开熔断/u);
    assert.doesNotMatch(previous, /S154_cd8_breaker_open_readonly\.sql/u);
    assert.match(current, /上一节写入时的现行记录见 §61\.43/u);
    for (const source of [current, evidenceCurrent, sandbox, hardening, payment]) {
        assert.match(source, /S154_cd8_breaker_open_readonly\.sql/u);
        assert.match(source, /打开半步通过/u);
        assert.match(source, /基线通过/u);
        assert.match(source, /s154-card8/u);
        assert.match(source, /S154 第8项/u);
        assert.match(source, /guest_promo_halted/u);
        assert.match(source, /正好一次/u);
        assert.match(source, /manual_open_count/u);
        assert.match(source, /不要合闸/u);
        assert.match(source, /不要建单/u);
        assert.match(source, /不要付款/u);
        assert.match(source, /沙箱CD7/u);
        assert.match(source, /GUEST_SHOP_DISCOUNT_ENABLED/u);
        assert.match(source, /GS2026092207342938190F2B83D5ACF/u);
        assert.match(source, /卡 7 继续 PARTIAL/u);
        assert.match(source, /80%（4\/5）/u);
    }
    assert.match(current, /gate --site cn --amount 1\.00/u);
    assert.match(current, /未通过/u);
    assert.match(current, /不得改写成整卡 PASS/u);
    assert.match(current, /GUEST_SHOP_MAX_QUANTITY` 保持 1/u);
    assert.match(current, /不得应用 `supabase\/migrations\/20260925_guest_shop_promo_gates\.sql`/u);
    assert.match(current, /卡 9 还没开始/u);
    assert.match(current, /status\.budgets/u);
    assert.doesNotMatch(current, /阶段 5 保持 `complete`|总进度保持 \*\*100%/u);

    const sql = read('supabase/sandbox/S154_cd8_breaker_open_readonly.sql');
    assert.equal((sql.match(/;/g) || []).length, 1);
    assert.match(sql, /AS open_verdict/u);
    assert.match(sql, /打开半步通过/u);
    assert.match(sql, /还是 closed/u);
    assert.match(sql, /s154-card8/u);
    assert.match(sql, /S154 第8项/u);
    assert.match(sql, /5f940176-8059-443a-b5fd-79adc883a810/u);
    assert.match(sql, /c373b8b7-ebce-4709-b8d4-c192abd36869/u);
    assert.match(sql, /GS2026092207342938190F2B83D5ACF/u);
    assert.doesNotMatch(sql, /fn_guest_shop_promo_status/u);
    assert.doesNotMatch(sql, /fn_guest_shop_promo_set_breaker/u);
    assert.doesNotMatch(sql, /(?:^|[\n;])\s*(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE)\b/iu);
    assert.doesNotMatch(sql, /\b(buyer_email|contact_email|client_ip|credential|cookie|payment_url|card_secret|query_password)\b/iu);

    assert.match(toolbox, /budget_after: status && status\.budgets/u);
    assert.doesNotMatch(toolbox, /budget_after: status && status\.budget\b/u);
    assert.match(fixture, /breaker closed --actor <名字>/u);
    assert.doesNotMatch(fixture, /SELECT public\.fn_guest_shop_promo_set_breaker/u);
});

test('card 8 breaker close is one audited write plus a read-only review', () => {
    const plan = read('docs/guest-purchase-task-2.0.md');
    const evidence = read('docs/guest-shop-promo-evidence.md');
    const sandbox = read('docs/guest-shop-promo-sandbox-runbook.md');
    const hardening = read('docs/guest-shop-promo-hardening-plan.md');
    const payment = read('docs/guest-shop-payment-fulfillment-runbook.md');
    const current = section(plan, '### 61.45 ');
    const evidenceCurrent = section(evidence, '### 2.33 ');
    const previous = section(plan, '### 61.44 ');
    const evidencePrevious = section(evidence, '### 2.32 ');

    assert.match(plan, /现行记录见 §61\.45/u);
    assert.match(plan, /现行记录见 §61\.44/u);
    assert.match(previous, /尚未贴回/u);
    assert.match(previous, /不要合闸/u);
    assert.match(previous, /打开结果尚未贴回|打开熔断、gate 和打开回读还没贴回/u);
    assert.match(evidencePrevious, /尚未贴回/u);
    assert.match(evidencePrevious, /不要合闸/u);
    assert.doesNotMatch(previous, /S154_cd8_breaker_close_readonly\.sql/u);
    assert.match(current, /上一节写入时的现行记录见 §61\.44/u);
    for (const source of [current, evidenceCurrent, sandbox, hardening, payment]) {
        assert.match(source, /S154_cd8_breaker_close_readonly\.sql/u);
        assert.match(source, /合闸半步通过/u);
        assert.match(source, /打开半步通过/u);
        assert.match(source, /s154-card8/u);
        assert.match(source, /S154 第8项恢复/u);
        assert.match(source, /正好一次/u);
        assert.match(source, /manual_close_count/u);
        assert.match(source, /不要再打开/u);
        assert.match(source, /不要建单/u);
        assert.match(source, /不要付款/u);
        assert.match(source, /沙箱CD7/u);
        assert.match(source, /GUEST_SHOP_DISCOUNT_ENABLED/u);
        assert.match(source, /GS2026092207342938190F2B83D5ACF/u);
        assert.match(source, /卡 7 继续 PARTIAL/u);
        assert.match(source, /80%（4\/5）/u);
        assert.match(source, /allowed=true/u);
    }
    assert.match(current, /gate --site cn --amount 1\.00/u);
    assert.match(current, /还是 open/u);
    assert.match(current, /reason 为空是预期|熔断行 reason 为空|熔断行的 `reason`/u);
    assert.match(current, /不得改写成整卡 PASS/u);
    assert.match(current, /GUEST_SHOP_MAX_QUANTITY` 保持 1/u);
    assert.match(current, /不得应用 `supabase\/migrations\/20260925_guest_shop_promo_gates\.sql`/u);
    assert.match(current, /卡 9 还没开始/u);
    assert.match(current, /5f940176-8059-443a-b5fd-79adc883a810/u);
    assert.doesNotMatch(current, /阶段 5 保持 `complete`|总进度保持 \*\*100%/u);

    const sql = read('supabase/sandbox/S154_cd8_breaker_close_readonly.sql');
    assert.equal((sql.match(/;/g) || []).length, 1);
    assert.match(sql, /AS close_verdict/u);
    assert.match(sql, /合闸半步通过/u);
    assert.match(sql, /还是 open/u);
    assert.match(sql, /s154-card8/u);
    assert.match(sql, /S154 第8项恢复/u);
    assert.match(sql, /5f940176-8059-443a-b5fd-79adc883a810/u);
    assert.match(sql, /c373b8b7-ebce-4709-b8d4-c192abd36869/u);
    assert.match(sql, /GS2026092207342938190F2B83D5ACF/u);
    assert.doesNotMatch(sql, /fn_guest_shop_promo_status/u);
    assert.doesNotMatch(sql, /fn_guest_shop_promo_set_breaker/u);
    assert.doesNotMatch(sql, /(?:^|[\n;])\s*(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE)\b/iu);
    assert.doesNotMatch(sql, /\b(buyer_email|contact_email|client_ip|credential|cookie|payment_url|card_secret|query_password)\b/iu);
});

test('card 9 budget baseline is read-only and does not tighten the daily budget', () => {
    const plan = read('docs/guest-purchase-task-2.0.md');
    const evidence = read('docs/guest-shop-promo-evidence.md');
    const sandbox = read('docs/guest-shop-promo-sandbox-runbook.md');
    const hardening = read('docs/guest-shop-promo-hardening-plan.md');
    const payment = read('docs/guest-shop-payment-fulfillment-runbook.md');
    const current = section(plan, '### 61.46 ');
    const evidenceCurrent = section(evidence, '### 2.34 ');
    const previous = section(plan, '### 61.45 ');
    const evidencePrevious = section(evidence, '### 2.33 ');

    assert.match(plan, /现行记录见 §61\.46/u);
    assert.match(plan, /现行记录见 §61\.45/u);
    assert.match(previous, /合闸回读尚未贴回/u);
    assert.match(previous, /卡 9 还没开始/u);
    assert.match(evidencePrevious, /合闸回读尚未贴回/u);
    assert.match(evidencePrevious, /卡 9 还没开始/u);
    assert.doesNotMatch(previous, /S154_cd9_budget_baseline_readonly\.sql/u);
    assert.doesNotMatch(evidencePrevious, /S154_cd9_budget_baseline_readonly\.sql/u);
    assert.match(current, /上一节写入时的现行记录见 §61\.45/u);
    assert.match(evidenceCurrent, /上一节/u);
    for (const source of [current, evidenceCurrent, sandbox, hardening, payment]) {
        assert.match(source, /S154_cd9_budget_baseline_readonly\.sql/u);
        assert.match(source, /基线通过/u);
        assert.match(source, /合闸半步通过/u);
        assert.match(source, /2026-09-22 09:18:20\.678679\+00/u);
        assert.match(source, /s154-card8/u);
        assert.match(source, /BUDGET_TIGHT/u);
        assert.match(source, /v_phase/u);
        assert.match(source, /不要跑夹具/u);
        assert.match(source, /cleanup/u);
        assert.match(source, /不要打开熔断/u);
        assert.match(source, /不要建单/u);
        assert.match(source, /不要付款/u);
        assert.match(source, /沙箱CD7/u);
        assert.match(source, /GUEST_SHOP_DISCOUNT_ENABLED/u);
        assert.match(source, /GS2026092207342938190F2B83D5ACF/u);
        assert.match(source, /卡 7 继续 PARTIAL/u);
        assert.match(source, /不得改写成整卡 PASS/u);
        assert.match(source, /80%（4\/5）/u);
        assert.match(source, /GUEST_SHOP_MAX_QUANTITY` 保持 1/u);
        assert.match(source, /20260925_guest_shop_promo_gates\.sql/u);
        assert.match(source, /guest_promo_budget_exhausted/u);
        assert.match(source, /告警/u);
    }
    assert.match(current, /5f940176-8059-443a-b5fd-79adc883a810/u);
    assert.match(current, /c373b8b7-ebce-4709-b8d4-c192abd36869/u);
    assert.doesNotMatch(current, /阶段 5 保持 `complete`|总进度保持 \*\*100%/u);

    const sql = read('supabase/sandbox/S154_cd9_budget_baseline_readonly.sql');
    assert.equal((sql.match(/;/g) || []).length, 1);
    assert.match(sql, /AS baseline_verdict/u);
    assert.match(sql, /基线通过/u);
    assert.match(sql, /不要改 v_phase/u);
    assert.match(sql, /BUDGET_TIGHT/u);
    assert.match(sql, /20\.00/u);
    assert.match(sql, /s154-card8/u);
    assert.match(sql, /2026-09-22 09:18:20\.678679\+00/u);
    assert.match(sql, /5f940176-8059-443a-b5fd-79adc883a810/u);
    assert.match(sql, /c373b8b7-ebce-4709-b8d4-c192abd36869/u);
    assert.match(sql, /GS2026092207342938190F2B83D5ACF/u);
    assert.doesNotMatch(sql, /fn_guest_shop_promo_status/u);
    assert.doesNotMatch(sql, /fn_guest_shop_promo_set_breaker/u);
    assert.doesNotMatch(sql, /(?:^|[\n;])\s*(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE)\b/iu);
    assert.doesNotMatch(sql, /\b(buyer_email|contact_email|client_ip|credential|cookie|payment_url|card_secret|query_password)\b/iu);
});
test('card 9 budget baseline row is archived without tightening the daily budget', () => {
    const plan = read('docs/guest-purchase-task-2.0.md');
    const evidence = read('docs/guest-shop-promo-evidence.md');
    const sandbox = read('docs/guest-shop-promo-sandbox-runbook.md');
    const hardening = read('docs/guest-shop-promo-hardening-plan.md');
    const payment = read('docs/guest-shop-payment-fulfillment-runbook.md');
    const current = section(plan, '### 61.47 ');
    const evidenceCurrent = section(evidence, '### 2.35 ');
    const previous = section(plan, '### 61.46 ');
    const evidencePrevious = section(evidence, '### 2.34 ');

    assert.match(plan, /现行记录见 §61\.47/u);
    assert.match(plan, /现行记录见 §61\.46/u);
    assert.match(plan, /现行记录见 §61\.45/u);
    assert.match(previous, /基线尚未贴回/u);
    assert.match(previous, /还没贴回/u);
    assert.match(previous, /现行步骤只跑 `supabase\/sandbox\/S154_cd9_budget_baseline_readonly\.sql`/u);
    assert.match(evidencePrevious, /基线尚未贴回/u);
    assert.match(evidencePrevious, /现行步骤只跑 `supabase\/sandbox\/S154_cd9_budget_baseline_readonly\.sql`/u);
    assert.doesNotMatch(previous, /没有新的 SQL/u);
    assert.doesNotMatch(evidencePrevious, /没有新的 SQL/u);
    assert.match(current, /上一节写入时的现行记录见 §61\.46/u);
    assert.match(evidenceCurrent, /上一节写入时的现行记录见 §2\.34/u);
    assert.doesNotMatch(current, /现行步骤只跑/u);
    for (const source of [current, evidenceCurrent, sandbox, hardening, payment]) {
        assert.match(source, /基线通过/u);
        assert.match(source, /没有新的 SQL/u);
        assert.match(source, /2026-09-22 09:18:20\.678679\+00/u);
        assert.match(source, /s154-card8/u);
        assert.match(source, /manual_open=1/u);
        assert.match(source, /manual_close=1/u);
        assert.match(source, /20\.00/u);
        assert.match(source, /0\.00/u);
        assert.match(source, /不要改 `v_phase`/u);
        assert.match(source, /不要切 `BUDGET_TIGHT`/u);
        assert.match(source, /不要跑夹具/u);
        assert.match(source, /cleanup/u);
        assert.match(source, /不要打开熔断/u);
        assert.match(source, /不要建单/u);
        assert.match(source, /不要付款/u);
        assert.match(source, /沙箱CD7/u);
        assert.match(source, /GUEST_SHOP_DISCOUNT_ENABLED/u);
        assert.match(source, /GS2026092207342938190F2B83D5ACF/u);
        assert.match(source, /卡 7 继续 PARTIAL/u);
        assert.match(source, /不得改写成整卡 PASS/u);
        assert.match(source, /不是整卡 PASS/u);
        assert.match(source, /80%（4\/5）/u);
        assert.match(source, /GUEST_SHOP_MAX_QUANTITY` 保持 1/u);
        assert.match(source, /20260925_guest_shop_promo_gates\.sql/u);
        assert.match(source, /guest_promo_budget_exhausted/u);
        assert.match(source, /告警/u);
        assert.match(source, /6 张/u);
        assert.match(source, /卡 4/u);
        assert.match(source, /未执行/u);
        assert.match(source, /抵扣 1\.00/u);
    }
    assert.match(current, /5f940176-8059-443a-b5fd-79adc883a810/u);
    assert.match(current, /c373b8b7-ebce-4709-b8d4-c192abd36869/u);
    assert.match(current, /商品净额 9\.00/u);
    assert.match(current, /通道费 0\.09/u);
    assert.match(current, /应付 9\.09/u);
    assert.doesNotMatch(current, /阶段 5 保持 `complete`|总进度保持 \*\*100%/u);
});

test('card 9 pre-budget card 4 snapshot is read-only and does not tighten the daily budget', () => {
    const plan = read('docs/guest-purchase-task-2.0.md');
    const evidence = read('docs/guest-shop-promo-evidence.md');
    const sandbox = read('docs/guest-shop-promo-sandbox-runbook.md');
    const hardening = read('docs/guest-shop-promo-hardening-plan.md');
    const payment = read('docs/guest-shop-payment-fulfillment-runbook.md');
    const current = section(plan, '### 61.48 ');
    const evidenceCurrent = section(evidence, '### 2.36 ');
    const previous = section(plan, '### 61.47 ');
    const evidencePrevious = section(evidence, '### 2.35 ');

    assert.match(plan, /现行记录见 §61\.48/u);
    assert.match(plan, /现行记录见 §61\.47/u);
    assert.match(plan, /现行记录见 §61\.46/u);
    assert.match(plan, /现行记录见 §61\.45/u);
    assert.match(previous, /没有新的 SQL/u);
    assert.match(previous, /基线通过/u);
    assert.match(evidencePrevious, /没有新的 SQL/u);
    assert.match(evidencePrevious, /基线通过/u);
    assert.doesNotMatch(previous, /S154_cd9_card4_snapshot_readonly\.sql/u);
    assert.doesNotMatch(evidencePrevious, /S154_cd9_card4_snapshot_readonly\.sql/u);
    assert.match(current, /上一节写入时的现行记录见 §61\.47/u);
    assert.match(evidenceCurrent, /上一节写入时的现行记录见 §2\.35/u);
    for (const source of [current, evidenceCurrent, sandbox, hardening, payment]) {
        assert.match(source, /S154_cd9_card4_snapshot_readonly\.sql/u);
        assert.match(source, /抄录通过/u);
        assert.match(source, /抄录尚未贴回/u);
        assert.match(source, /基线通过/u);
        assert.match(source, /没有新的 SQL/u);
        assert.match(source, /2026-09-22 09:18:20\.678679\+00/u);
        assert.match(source, /s154-card8/u);
        assert.match(source, /manual_open=1/u);
        assert.match(source, /manual_close=1/u);
        assert.match(source, /20\.00/u);
        assert.match(source, /0\.00/u);
        assert.match(source, /不要改 `v_phase`/u);
        assert.match(source, /不要切 `BUDGET_TIGHT`/u);
        assert.match(source, /不要跑夹具/u);
        assert.match(source, /cleanup/u);
        assert.match(source, /不要打开熔断/u);
        assert.match(source, /不要建单/u);
        assert.match(source, /不要付款/u);
        assert.match(source, /沙箱CD7/u);
        assert.match(source, /沙箱CD3/u);
        assert.match(source, /GUEST_SHOP_DISCOUNT_ENABLED/u);
        assert.match(source, /GS2026092207342938190F2B83D5ACF/u);
        assert.match(source, /卡 7 继续 PARTIAL/u);
        assert.match(source, /不得改写成整卡 PASS/u);
        assert.match(source, /不是整卡 PASS/u);
        assert.match(source, /80%（4\/5）/u);
        assert.match(source, /GUEST_SHOP_MAX_QUANTITY` 保持 1/u);
        assert.match(source, /20260925_guest_shop_promo_gates\.sql/u);
        assert.match(source, /guest_promo_budget_exhausted/u);
        assert.match(source, /告警/u);
        assert.match(source, /6 张/u);
        assert.match(source, /卡 4/u);
        assert.match(source, /未执行/u);
        assert.match(source, /抵扣 1\.00/u);
        assert.match(source, /SBXPROMO10/u);
        assert.match(source, /SBXQUOTA2/u);
        assert.match(source, /写着异常不是邀请去修/u);
        assert.match(source, /fn_guest_shop_promo_status/u);
        assert.match(source, /fn_guest_shop_promo_set_breaker/u);
    }
    assert.match(current, /5f940176-8059-443a-b5fd-79adc883a810/u);
    assert.match(current, /c373b8b7-ebce-4709-b8d4-c192abd36869/u);
    assert.match(current, /商品净额 9\.00/u);
    assert.match(current, /通道费 0\.09/u);
    assert.match(current, /应付 9\.09/u);
    assert.doesNotMatch(current, /阶段 5 保持 `complete`|总进度保持 \*\*100%/u);

    const sql = read('supabase/sandbox/S154_cd9_card4_snapshot_readonly.sql');
    assert.equal((sql.match(/;/g) || []).length, 1);
    assert.match(sql, /AS snapshot_verdict/u);
    assert.match(sql, /抄录通过/u);
    assert.match(sql, /不是卡 4 PASS/u);
    assert.match(sql, /不要改写 §2\.6/u);
    assert.match(sql, /不要切 BUDGET_TIGHT/u);
    assert.match(sql, /留下本行/u);
    assert.match(sql, /写着异常不是邀请去修/u);
    assert.match(sql, /SBXPROMO10/u);
    assert.match(sql, /SBXQUOTA2/u);
    assert.match(sql, /guest_used_count/u);
    assert.match(sql, /guest_discount_total/u);
    assert.match(sql, /20\.00/u);
    assert.match(sql, /s154-card8/u);
    assert.match(sql, /2026-09-22 09:18:20\.678679\+00/u);
    assert.match(sql, /5f940176-8059-443a-b5fd-79adc883a810/u);
    assert.match(sql, /c373b8b7-ebce-4709-b8d4-c192abd36869/u);
    assert.match(sql, /GS2026092207342938190F2B83D5ACF/u);
    assert.match(sql, /1\.00/u);
    assert.doesNotMatch(sql, /fn_guest_shop_promo_status/u);
    assert.doesNotMatch(sql, /fn_guest_shop_promo_set_breaker/u);
    assert.doesNotMatch(sql, /updated_at/u);
    assert.doesNotMatch(sql, /(?:^|[\n;])\s*(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE)\b/iu);
    assert.doesNotMatch(sql, /\b(buyer_email|contact_email|client_ip|credential|cookie|payment_url|card_secret|query_password)\b/iu);
    assert.doesNotMatch(sql, /buyer_contact_hash|request_ip_hash/u);
});

test('card 9 pre-budget card 4 snapshot row is archived without tightening the daily budget', () => {
    const plan = read('docs/guest-purchase-task-2.0.md');
    const evidence = read('docs/guest-shop-promo-evidence.md');
    const sandbox = read('docs/guest-shop-promo-sandbox-runbook.md');
    const hardening = read('docs/guest-shop-promo-hardening-plan.md');
    const payment = read('docs/guest-shop-payment-fulfillment-runbook.md');
    const current = section(plan, '### 61.49 ');
    const evidenceCurrent = section(evidence, '### 2.37 ');
    const previous = section(plan, '### 61.48 ');
    const evidencePrevious = section(evidence, '### 2.36 ');

    assert.match(plan, /现行记录见 §61\.49/u);
    assert.match(plan, /现行记录见 §61\.48/u);
    assert.match(plan, /现行记录见 §61\.47/u);
    assert.match(plan, /现行记录见 §61\.46/u);
    assert.match(plan, /现行记录见 §61\.45/u);
    assert.match(previous, /抄录尚未贴回/u);
    assert.match(previous, /现行步骤只跑 `supabase\/sandbox\/S154_cd9_card4_snapshot_readonly\.sql`/u);
    assert.match(previous, /没有新的 SQL/u);
    assert.match(previous, /基线通过/u);
    assert.doesNotMatch(previous, /用户贴回 `supabase\/sandbox\/S154_cd9_card4_snapshot_readonly\.sql`，正好 1 行/u);
    assert.match(evidencePrevious, /抄录尚未贴回/u);
    assert.match(evidencePrevious, /现行步骤只跑 `supabase\/sandbox\/S154_cd9_card4_snapshot_readonly\.sql`/u);
    assert.doesNotMatch(evidencePrevious, /用户贴回 `supabase\/sandbox\/S154_cd9_card4_snapshot_readonly\.sql`，正好 1 行/u);
    assert.match(current, /上一节写入时的现行记录见 §61\.48/u);
    assert.match(current, /本节取代 §61\.48 的「抄录尚未贴回」/u);
    assert.match(evidenceCurrent, /上一节写入时的现行记录见 §2\.36/u);
    assert.match(evidenceCurrent, /本节取代 §2\.36 的「抄录尚未贴回」/u);
    assert.doesNotMatch(current, /现行步骤只跑/u);
    assert.doesNotMatch(evidenceCurrent, /现行步骤只跑/u);
    for (const source of [current, evidenceCurrent, sandbox, hardening, payment]) {
        assert.match(source, /用户贴回 `supabase\/sandbox\/S154_cd9_card4_snapshot_readonly\.sql`，正好 1 行/u);
        assert.match(source, /Codex 没有执行这条 SQL/u);
        assert.match(source, /S154_cd9_card4_snapshot_readonly\.sql/u);
        assert.match(source, /snapshot_verdict` 以「抄录通过」开头/u);
        assert.match(source, /这一轮没有新的 SQL/u);
        assert.match(source, /基线通过/u);
        assert.match(source, /2026-09-22 09:18:20\.678679\+00/u);
        assert.match(source, /s154-card8/u);
        assert.match(source, /manual_open=1/u);
        assert.match(source, /manual_close=1/u);
        assert.match(source, /20\.00/u);
        assert.match(source, /0\.00/u);
        assert.match(source, /不要改 `v_phase`/u);
        assert.match(source, /不要切 `BUDGET_TIGHT`/u);
        assert.match(source, /不要跑夹具/u);
        assert.match(source, /cleanup/u);
        assert.match(source, /不要打开熔断/u);
        assert.match(source, /不要建单/u);
        assert.match(source, /不要付款/u);
        assert.match(source, /沙箱CD7/u);
        assert.match(source, /沙箱CD3/u);
        assert.match(source, /GUEST_SHOP_DISCOUNT_ENABLED/u);
        assert.match(source, /GS2026092207342938190F2B83D5ACF/u);
        assert.match(source, /卡 7 继续 PARTIAL/u);
        assert.match(source, /不得改写成整卡 PASS/u);
        assert.match(source, /不是整卡 PASS/u);
        assert.match(source, /80%（4\/5）/u);
        assert.match(source, /GUEST_SHOP_MAX_QUANTITY` 保持 1/u);
        assert.match(source, /20260925_guest_shop_promo_gates\.sql/u);
        assert.match(source, /guest_promo_budget_exhausted/u);
        assert.match(source, /告警/u);
        assert.match(source, /6 张/u);
        assert.match(source, /卡 4/u);
        assert.match(source, /未执行/u);
        assert.match(source, /抵扣 1\.00/u);
        assert.match(source, /SBXPROMO10/u);
        assert.match(source, /SBXQUOTA2/u);
        assert.match(source, /guest_used_count/u);
        assert.match(source, /写着异常不是邀请去修/u);
        assert.match(source, /fn_guest_shop_promo_status/u);
        assert.match(source, /fn_guest_shop_promo_set_breaker/u);
        assert.match(source, /0\/9/u);
        assert.match(source, /测试 2/u);
    }
    assert.match(current, /5f940176-8059-443a-b5fd-79adc883a810/u);
    assert.match(current, /c373b8b7-ebce-4709-b8d4-c192abd36869/u);
    assert.match(current, /52246f1d-b98d-4920-9129-581296f43de9/u);
    assert.match(current, /c16212d8-6ad8-4b3c-831c-3cc68b2d7a52/u);
    assert.match(current, /商品净额 9\.00/u);
    assert.match(current, /通道费 0\.09/u);
    assert.match(current, /应付 9\.09/u);
    assert.match(current, /也不另写预算 SQL/u);
    assert.doesNotMatch(current, /阶段 5 保持 `complete`|总进度保持 \*\*100%/u);
    assert.doesNotMatch(evidenceCurrent, /阶段 5 保持 `complete`|总进度保持 \*\*100%/u);
});
test('card 9 budget tighten script is ready and the result is not yet pasted back', () => {
    const plan = read('docs/guest-purchase-task-2.0.md');
    const evidence = read('docs/guest-shop-promo-evidence.md');
    const sandbox = read('docs/guest-shop-promo-sandbox-runbook.md');
    const hardening = read('docs/guest-shop-promo-hardening-plan.md');
    const payment = read('docs/guest-shop-payment-fulfillment-runbook.md');
    const sql = read('supabase/sandbox/S154_cd9_cd7_budget_tighten.sql');
    const current = section(plan, '### 61.50 ');
    const evidenceCurrent = section(evidence, '### 2.38 ');
    const previous = section(plan, '### 61.49 ');
    const evidencePrevious = section(evidence, '### 2.37 ');

    assert.match(plan, /现行记录见 §61\.50/u);
    assert.match(plan, /### 61\.49 /u);
    assert.match(plan, /现行记录见 §61\.49/u);
    assert.match(previous, /这一轮没有新的 SQL/u);
    assert.match(previous, /也不另写预算 SQL/u);
    assert.doesNotMatch(previous, /现行步骤只跑/u);
    assert.doesNotMatch(previous, /S154_cd9_cd7_budget_tighten\.sql/u);
    assert.doesNotMatch(previous, /收紧半步通过/u);
    assert.match(evidencePrevious, /这一轮没有新的 SQL/u);
    assert.match(evidencePrevious, /也不另写预算 SQL/u);
    assert.doesNotMatch(evidencePrevious, /现行步骤只跑/u);
    assert.doesNotMatch(evidencePrevious, /S154_cd9_cd7_budget_tighten\.sql/u);
    assert.doesNotMatch(evidencePrevious, /收紧半步通过/u);
    assert.match(current, /本节取代 §61\.49 的「也不另写预算 SQL」/u);
    assert.match(current, /上一节写入时的现行记录见 §61\.49/u);
    assert.match(current, /结果尚未贴回/u);
    assert.match(evidenceCurrent, /本节取代 §2\.37 的「也不另写预算 SQL」/u);
    assert.match(evidenceCurrent, /上一节写入时的现行记录见 §2\.37/u);
    assert.match(evidenceCurrent, /结果尚未贴回/u);
    assert.doesNotMatch(current, /阶段 5 保持 `complete`|总进度保持 \*\*100%/u);
    assert.doesNotMatch(evidenceCurrent, /阶段 5 保持 `complete`|总进度保持 \*\*100%/u);

    for (const source of [current, evidenceCurrent, sandbox, hardening, payment]) {
        assert.match(source, /S154_cd9_cd7_budget_tighten\.sql/u);
        assert.match(source, /收紧半步通过/u);
        assert.match(source, /本次没有再改/u);
        assert.match(source, /看不清/u);
        assert.match(source, /不要把 20\.00 写回去/u);
        assert.match(source, /整份执行/u);
        assert.match(source, /全站上限/u);
        assert.match(source, /52246f1d-b98d-4920-9129-581296f43de9/u);
        assert.match(source, /c16212d8-6ad8-4b3c-831c-3cc68b2d7a52/u);
        assert.match(source, /¥144/u);
        assert.match(source, /原价不消耗预算/u);
        assert.match(source, /6 张/u);
        assert.match(source, /guest_promo_budget_exhausted/u);
        assert.match(source, /告警/u);
        assert.match(source, /webhook/u);
        assert.match(source, /GS2026092207342938190F2B83D5ACF/u);
        assert.match(source, /0\/9/u);
        assert.match(source, /写着异常不是邀请去修/u);
        assert.match(source, /80%（4\/5）/u);
        assert.match(source, /结果尚未贴回/u);
        assert.match(source, /fn_guest_shop_promo_status/u);
        assert.match(source, /fn_guest_shop_promo_set_breaker/u);
        assert.match(source, /guest_shop_promo_gate/u);
        assert.match(source, /GUEST_SHOP_MAX_QUANTITY` 保持 1/u);
        assert.match(source, /20260925_guest_shop_promo_gates\.sql/u);
        assert.match(source, /不要改 `v_phase`/u);
        assert.match(source, /不要切 `BUDGET_TIGHT`/u);
        assert.match(source, /不要建单/u);
        assert.match(source, /不要付款/u);
    }

    assert.equal((sql.match(/\bUPDATE\b/g) || []).length, 1);
    assert.match(sql, /UPDATE public\.guest_shop_promo_budget/u);
    assert.match(sql, /updated_at = clock_timestamp\(\)/u);
    assert.doesNotMatch(sql, /FOR UPDATE/u);
    assert.doesNotMatch(sql, /\b(?:INSERT|DELETE|TRUNCATE|ALTER|DROP|CREATE)\b/u);
    assert.doesNotMatch(sql, /spent_cny\s*=/u);
    assert.match(sql, /ROUND\(b\.spent_cny, 2\) = 0\.00/u);
    assert.match(sql, /ROUND\(bg\.cn_spent_cny, 2\) = 0\.00/u);
    assert.doesNotMatch(sql, /daily_budget_cny\s*=\s*20/u);
    assert.doesNotMatch(sql, /fn_guest_shop_promo_status/u);
    assert.doesNotMatch(sql, /fn_guest_shop_promo_set_breaker/u);
    assert.doesNotMatch(sql, /guest_shop_promo_gate/u);
    assert.doesNotMatch(sql, /联系人|密钥/u);
    assert.doesNotMatch(sql, /\bIP\b/u);
    assert.doesNotMatch(sql, /\b(buyer_email|contact_email|client_ip|credential|cookie|payment_url|card_secret|query_password)\b/iu);
    assert.doesNotMatch(sql, /allow_guest_purchase\s*=\s*true/iu);
    assert.match(sql, /DO \$cd9\$/u);
    assert.match(sql, /\$guard\$/u);
    assert.match(sql, /set_config\('s154\.cd9_budget_tighten', 'updated', false\)/u);
    assert.match(sql, /set_config\('s154\.cd9_budget_tighten', 'already', false\)/u);
    assert.equal((sql.match(/set_config\('s154\.cd9_budget_tighten'/g) || []).length, 2);
    assert.match(sql, /AS tighten_verdict/u);
    assert.match(sql, /收紧半步通过/u);
    assert.match(sql, /本次没有再改/u);
    assert.match(sql, /看不清/u);
    assert.match(sql, /不要把 20\.00 写回去/u);
});

test('card 9 budget tighten result is archived without restoring 20 or opening checkout', () => {
    const plan = read('docs/guest-purchase-task-2.0.md');
    const evidence = read('docs/guest-shop-promo-evidence.md');
    const sandbox = read('docs/guest-shop-promo-sandbox-runbook.md');
    const hardening = read('docs/guest-shop-promo-hardening-plan.md');
    const payment = read('docs/guest-shop-payment-fulfillment-runbook.md');
    const sql = read('supabase/sandbox/S154_cd9_cd7_budget_tighten.sql');
    const current = section(plan, '### 61.51 ');
    const evidenceCurrent = section(evidence, '### 2.39 ');
    const previous = section(plan, '### 61.50 ');
    const evidencePrevious = section(evidence, '### 2.38 ');
    assert.match(plan, /现行记录见 §61\.50/u);
    assert.match(current, /本节取代 §61\.50 的「结果尚未贴回」/u);
    assert.match(current, /上一节写入时的现行记录见 §61\.50/u);
    assert.match(evidenceCurrent, /本节取代 §2\.38 的「结果尚未贴回」/u);
    assert.match(evidenceCurrent, /上一节写入时的现行记录见 §2\.38/u);
    assert.match(previous, /结果尚未贴回/u);
    assert.match(previous, /整份执行 `supabase\/sandbox\/S154_cd9_cd7_budget_tighten\.sql`/u);
    assert.doesNotMatch(previous, /用户贴回 `supabase\/sandbox\/S154_cd9_cd7_budget_tighten\.sql`/u);
    assert.doesNotMatch(previous, /tighten_marker=updated/u);
    assert.match(evidencePrevious, /结果尚未贴回/u);
    assert.match(evidencePrevious, /整份执行 `supabase\/sandbox\/S154_cd9_cd7_budget_tighten\.sql`/u);
    assert.doesNotMatch(evidencePrevious, /用户贴回 `supabase\/sandbox\/S154_cd9_cd7_budget_tighten\.sql`/u);
    assert.doesNotMatch(evidencePrevious, /tighten_marker=updated/u);
    assert.doesNotMatch(current, /阶段 5 保持 `complete`|总进度保持 \*\*100%/u);
    assert.doesNotMatch(evidenceCurrent, /阶段 5 保持 `complete`|总进度保持 \*\*100%/u);

    function pastedParagraph(source) {
        const hits = source.split(/\n\s*\n/u).filter((part) => (
            part.includes('tighten_marker=updated')
            && part.includes('52246f1d-b98d-4920-9129-581296f43de9')
            && part.includes('用户贴回 `supabase/sandbox/S154_cd9_cd7_budget_tighten.sql`')
        ));
        assert.equal(hits.length, 1);
        return hits[0];
    }

    const sources = [
        pastedParagraph(current),
        pastedParagraph(evidenceCurrent),
        pastedParagraph(sandbox),
        pastedParagraph(hardening),
        pastedParagraph(payment),
    ];
    for (const source of sources) {
        assert.match(source, /用户贴回 `supabase\/sandbox\/S154_cd9_cd7_budget_tighten\.sql`，正好 1 行/u);
        assert.match(source, /Codex 没有执行这条 SQL/u);
        assert.match(source, /tighten_marker=updated/u);
        assert.match(source, /收紧半步通过/u);
        assert.match(source, /closed_by=s154-card8/u);
        assert.match(source, /1\.00/u);
        assert.match(source, /0\.00/u);
        assert.match(source, /2026-09-22/u);
        assert.match(source, /intl 关闭/u);
        assert.match(source, /不要把 20\.00 写回去/u);
        assert.match(source, /这一轮没有新的 SQL/u);
        assert.match(source, /全站上限/u);
        assert.match(source, /52246f1d-b98d-4920-9129-581296f43de9/u);
        assert.match(source, /c16212d8-6ad8-4b3c-831c-3cc68b2d7a52/u);
        assert.match(source, /¥144/u);
        assert.match(source, /原价不消耗预算/u);
        assert.match(source, /6 张/u);
        assert.match(source, /guest_promo_budget_exhausted/u);
        assert.match(source, /webhook/u);
        assert.match(source, /邮件/u);
        assert.match(source, /GS2026092207342938190F2B83D5ACF/u);
        assert.match(source, /抵扣 1\.00/u);
        assert.match(source, /0\/9/u);
        assert.match(source, /未执行/u);
        assert.match(source, /写着异常不是邀请去修/u);
        assert.match(source, /80%（4\/5）/u);
        assert.match(source, /fn_guest_shop_promo_status/u);
        assert.match(source, /fn_guest_shop_promo_set_breaker/u);
        assert.match(source, /guest_shop_promo_gate/u);
        assert.match(source, /GUEST_SHOP_MAX_QUANTITY` 保持 1/u);
        assert.match(source, /20260925_guest_shop_promo_gates\.sql/u);
        assert.match(source, /不要改 `v_phase`/u);
        assert.match(source, /不要切 `BUDGET_TIGHT`/u);
        assert.match(source, /不要跑夹具/u);
        assert.match(source, /cleanup/u);
        assert.match(source, /不要打开熔断/u);
        assert.match(source, /不要建单/u);
        assert.match(source, /不要付款/u);
        assert.match(source, /沙箱CD7/u);
        assert.match(source, /沙箱CD3/u);
        assert.match(source, /GUEST_SHOP_DISCOUNT_ENABLED/u);
        assert.match(source, /卡 7 继续 PARTIAL/u);
        assert.match(source, /不是整卡 PASS/u);
        assert.doesNotMatch(source, /阶段 5 保持 `complete`|总进度保持 \*\*100%/u);
    }
    for (const source of sources) {
        assert.match(source, /breaker_state=closed/u);
        assert.match(source, /本次没有再改/u);
        assert.match(source, /看不清/u);
        assert.match(source, /本贴回不授权/u);
        assert.match(source, /0\.00 加 1\.00/u);
        assert.doesNotMatch(source, /结果尚未贴回/u);
        assert.doesNotMatch(source, /整份执行/u);
    }

    assert.equal((sql.match(/\bUPDATE\b/g) || []).length, 1);
    assert.match(sql, /UPDATE public\.guest_shop_promo_budget/u);
    assert.match(sql, /SET daily_budget_cny = 1\.00/u);
    assert.doesNotMatch(sql, /daily_budget_cny\s*=\s*20/u);
    assert.doesNotMatch(sql, /fn_guest_shop_promo_status/u);
    assert.doesNotMatch(sql, /fn_guest_shop_promo_set_breaker/u);
    assert.doesNotMatch(sql, /guest_shop_promo_gate/u);
    assert.doesNotMatch(sql, /allow_guest_purchase\s*=\s*true/iu);
});

test('card 9 payment readback is a sanitized single read-only SELECT and current instruction', () => {
    const plan = read('docs/guest-purchase-task-2.0.md');
    const evidence = read('docs/guest-shop-promo-evidence.md');
    const sql = read('supabase/sandbox/S154_cd9_payment_readback.sql');
    const current = section(plan, '### 61.53 ');
    const previous = section(plan, '### 61.52 ');
    const evidenceCurrent = section(evidence, '### 2.41 ');

    assert.match(current, /本节记录支付回读结果/u);
    assert.ok(plan.indexOf('现行记录见 §61.53') < plan.indexOf('### 61.53 '));
    assert.match(current, /GS20260922120128080254E4D17280D/u);
    assert.match(current, /支付半步通过/u);
    assert.match(current, /不要踢 worker/u);
    assert.match(current, /2026-09-22/u);
    assert.match(previous, /结果尚未贴回/u);
    assert.match(evidenceCurrent, /支付半步已通过/u);
    assert.match(evidenceCurrent, /S154_cd9_payment_readback\.sql/u);
    assert.match(evidenceCurrent, /9\.09/u);

    assert.equal((sql.match(/^SELECT\b/gmu) || []).length, 1);
    assert.match(sql, /GS20260922120128080254E4D17280D/u);
    assert.match(sql, /GS2026092207342938190F2B83D5ACF/u);
    assert.match(sql, /2026-09-22/u);
    assert.match(sql, /2026-09-22/u);
    assert.match(sql, /sign_verified/u);
    assert.match(sql, /amount_verified/u);
    assert.match(sql, /currency_verified/u);
    assert.match(sql, /final_status_verified/u);
    assert.match(sql, /payment_fee/u);
    assert.match(sql, /readback_verdict/u);
    assert.match(sql, /支付半步通过/u);
    assert.match(sql, /2026-09-22/u);
    assert.match(sql, /泄漏/u);
    assert.match(sql, /风险/u);
    assert.match(sql, /paid_unfulfillable/u);
    assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE)\b/iu);
    assert.doesNotMatch(sql, /\b(?:fn_guest_shop_promo_status|fn_guest_shop_promo_set_breaker|guest_shop_promo_gate|guest_shop_reservation_rollup)\b/u);
    assert.doesNotMatch(sql, /\bIP\b|联系人|密钥/u);
    assert.doesNotMatch(sql, /provider_metadata|payment_url|buyer_contact_hash|request_ip_hash|claim_secret_hash|last_error_message/u);

    for (const [source, marker] of [
        [plan, '现行记录见 §61.53'],
        [evidence, '### 2.41 '],
        [read('docs/guest-shop-promo-sandbox-runbook.md'), '2026-09-23 支付回读已贴回'],
        [read('docs/guest-shop-promo-hardening-plan.md'), '2026-09-23 卡 9 支付回读已经由用户贴回'],
        [read('docs/guest-shop-payment-fulfillment-runbook.md'), '2026-09-23 用户贴回卡 9 支付回读'],
    ]) {
        const archived = marker.startsWith('### ')
            ? section(source, marker)
            : source.split(/\n\s*\n/u).find((part) => part.includes(marker));
        assert.ok(archived, `missing archive marker: ${marker}`);
        assert.match(archived, /支付半步通过/u);
        assert.match(archived, /不要再次付款|不要重复付款|不要重试付款|不要再付款|不再付款/u);
        assert.match(archived, /2026-09-22/u);
        if (!archived.includes('2026-09-23 用户贴回卡 9 支付回读')) {
            assert.match(archived, /80%（4\/5）|总进度 80%（4\/5）|阶段 5 当前范围计划见 §61\.54/u);
        }
    }
});
