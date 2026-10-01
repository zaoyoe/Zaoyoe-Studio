'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const migration = fs.readFileSync(
    path.join(ROOT, 'supabase/migrations/20260924_guest_shop_promo_safety_gates.sql'),
    'utf8'
);
const scopedGuardMigration = fs.readFileSync(
    path.join(ROOT, 'supabase/migrations/20260928_guest_shop_promo_guard_scope.sql'),
    'utf8'
);
const verify = fs.readFileSync(
    path.join(ROOT, 'supabase/migrations/20260924_verify_guest_shop_promo_safety_gates.sql'),
    'utf8'
);

test('promo safety migration keeps all three gates in one deferred transaction trigger', () => {
    assert.match(migration, /CREATE OR REPLACE FUNCTION public\.fn_guest_shop_enforce_promo_safety_gates\(\)/u);
    assert.match(migration, /CREATE CONSTRAINT TRIGGER guest_shop_promo_safety_gates[\s\S]*DEFERRABLE INITIALLY DEFERRED/u);
    assert.match(migration, /CREATE CONSTRAINT TRIGGER guest_shop_promo_safety_reservation_gates[\s\S]*DEFERRABLE INITIALLY DEFERRED/u);
    assert.match(migration, /guest_stock_hold_limit/u);
    assert.match(migration, /guest_open_orders_limit/u);
    assert.match(migration, /guest_promo_order_ttl_invalid/u);
});

test('C-D3 uses the exact 20 percent boundary and only non-shared stock', () => {
    assert.match(migration, /COALESCE\(i\.is_shared, false\) = false/u);
    assert.match(migration, /v_held \* 100 >= v_total \* 20/u);
    assert.match(migration, /status = 'available'/u);
    assert.match(migration, /status = 'reserve'/u);
    assert.match(migration, /fn_resolve_shop_sku_inventory_sources\(v_order\.sku_id, v_order\.site\)/u);
    assert.match(migration, /r\.inventory_source_sku_id/u);
    assert.match(migration, /guest-promo-stock:' \|\| COALESCE\(v_order\.product_id/u);
});

test('C-D4 caps both contact and IP open orders at two', () => {
    assert.match(migration, /buyer_contact_hash = v_order\.buyer_contact_hash/u);
    assert.match(migration, /request_ip_hash = v_order\.request_ip_hash/u);
    assert.match(migration, /v_open_contact >= 2/u);
    assert.match(migration, /v_open_ip >= 2/u);
    assert.match(migration, /payment_status IN \('pending', 'created', 'review'\)/u);
    assert.match(migration, /reservation_status = 'held'/u);
    assert.match(migration, /expires_at > v_now/u);
});

test('C-D5 hard caps discounted orders at 600 seconds', () => {
    assert.match(migration, /v_order\.expires_at > v_order\.created_at \+ INTERVAL '600 seconds'/u);
    assert.match(migration, /r\.reserved_until > v_promo_deadline/u);
    assert.match(migration, /NULLIF\(BTRIM\(COALESCE\(v_order\.discount_code/u);
    assert.match(migration, /UPDATE OF buyer_contact_hash[\s\S]*discount_amount/u);
    assert.match(migration, /REVOKE ALL ON FUNCTION public\.fn_guest_shop_enforce_promo_safety_gates\(\)/u);
});

test('safety migration does not enable guest products or run data DML', () => {
    assert.doesNotMatch(migration, /allow_guest_purchase\s*=\s*true/iu);
    assert.doesNotMatch(migration, /^(?:UPDATE|DELETE|TRUNCATE)\s+public\./mu);
    assert.doesNotMatch(migration, /DROP\s+TABLE/iu);
});

test('the follow-up promo guard excludes ordinary list-price orders', () => {
    assert.match(scopedGuardMigration, /CREATE OR REPLACE FUNCTION public\.fn_guest_shop_enforce_promo_safety_gates\(\)/u);
    assert.match(
        scopedGuardMigration,
        /v_order\.payment_status NOT IN \('pending', 'created', 'review'\)[\s\S]*NULLIF\(BTRIM\(COALESCE\(v_order\.discount_code, ''\)\), ''\) IS NULL[\s\S]*AND COALESCE\(v_order\.discount_amount, 0\) <= 0[\s\S]*RETURN NEW;/u
    );
    assert.match(scopedGuardMigration, /guest_stock_hold_limit/u);
    assert.match(scopedGuardMigration, /guest_open_orders_limit/u);
    assert.match(scopedGuardMigration, /REVOKE ALL ON FUNCTION public\.fn_guest_shop_enforce_promo_safety_gates\(\)/u);
    assert.doesNotMatch(scopedGuardMigration, /allow_guest_purchase\s*=\s*true/iu);
    assert.doesNotMatch(scopedGuardMigration, /guest_shop_promo_policy/u);
    assert.doesNotMatch(scopedGuardMigration, /^(?:INSERT|UPDATE|DELETE|TRUNCATE)\s+public\./imu);
});

test('the scoped C-D3/C-D4 queries only count discounted orders', () => {
    const fnStart = scopedGuardMigration.indexOf('CREATE OR REPLACE FUNCTION public.fn_guest_shop_enforce_promo_safety_gates()');
    const fnEnd = scopedGuardMigration.indexOf('REVOKE ALL ON FUNCTION public.fn_guest_shop_enforce_promo_safety_gates()', fnStart);
    assert.ok(fnStart >= 0 && fnEnd > fnStart, 'scoped promo guard body must be present');
    const fn = scopedGuardMigration.slice(fnStart, fnEnd);
    const openStart = fn.indexOf('SELECT COUNT(DISTINCT o.id)');
    const openEnd = fn.indexOf('IF v_open >', openStart);
    assert.ok(openStart >= 0 && openEnd > openStart, 'C-D4 open-order query must be present');
    const openQuery = fn.slice(openStart, openEnd);
    assert.match(openQuery, /NULLIF\(BTRIM\(COALESCE\(o\.discount_code, ''\)\), ''\) IS NOT NULL[\s\S]*OR COALESCE\(o\.discount_amount, 0\) > 0/u);

    const heldStart = fn.indexOf('SELECT COUNT(*)\n    INTO v_held');
    const heldEnd = fn.indexOf('SELECT COUNT(*)\n    INTO v_available', heldStart);
    assert.ok(heldStart >= 0 && heldEnd > heldStart, 'C-D3 held-stock query must be present');
    const heldQuery = fn.slice(heldStart, heldEnd);
    assert.match(heldQuery, /NULLIF\(BTRIM\(COALESCE\(o\.discount_code, ''\)\), ''\) IS NOT NULL[\s\S]*OR COALESCE\(o\.discount_amount, 0\) > 0/u);
});

test('safety verify is read-only and checks the deferred trigger contract', () => {
    assert.match(verify, /SELECT check_name, ok, detail/u);
    assert.match(verify, /tgdeferrable/u);
    assert.match(verify, /tginitdeferred/u);
    assert.match(verify, /guest_stock_hold_limit/u);
    assert.match(verify, /guest_open_orders_limit/u);
    assert.doesNotMatch(verify, /^(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE)\s+/imu);
});

test('C-D4 counts other open orders and rejects the third', () => {
    assert.match(migration, /may not hold more than 2 open guest orders/u);
    assert.match(migration, /o\.id <> v_order\.id/u);
    assert.match(migration, /v_open_contact >= 2/u);
    assert.match(migration, /v_open_ip >= 2/u);
});

test('function_security verify uses prosecdef and proconfig, not deparsed SET text', () => {
    assert.match(verify, /p\.prosecdef/u);
    assert.match(verify, /unnest\(COALESCE\(p\.proconfig, ARRAY\[\]::TEXT\[\]\)\) AS item/u);
    assert.match(verify, /split_part\(item, '=', 1\) = 'search_path'/u);
    assert.match(verify, /regexp_replace\(split_part\(item, '=', 2\), '\[\[:space:\]\]', '', 'g'\)/u);
    assert.match(verify, /= 'public,pg_temp'/u);
    assert.doesNotMatch(verify, /SET search_path \(TO\|=\) public, pg_temp/u);
    assert.match(verify, /prosecdef=' \|\| p\.prosecdef::TEXT/u);
    assert.match(verify, /search_path=' \|\| COALESCE/u);
    assert.doesNotMatch(verify, /^(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE)\s+/imu);
});

test('archives the 11-row safety verify without enabling promo or rewriting card 7', () => {
    const plan = fs.readFileSync(path.join(ROOT, 'docs/guest-purchase-task-2.0.md'), 'utf8');
    const evidence = fs.readFileSync(path.join(ROOT, 'docs/guest-shop-promo-evidence.md'), 'utf8');
    const hardening = fs.readFileSync(path.join(ROOT, 'docs/guest-shop-promo-hardening-plan.md'), 'utf8');
    const sandbox = fs.readFileSync(path.join(ROOT, 'docs/guest-shop-promo-sandbox-runbook.md'), 'utf8');
    const payment = fs.readFileSync(path.join(ROOT, 'docs/guest-shop-payment-fulfillment-runbook.md'), 'utf8');
    const section = plan.slice(plan.indexOf('### 61.25 2026-09-22 促销安全闸只读 verify 归档（11/11）'));
    const evidenceSection = evidence.slice(evidence.indexOf('### 2.13 目标库只读 verify（2026-09-22，11/11）'));

    assert.notEqual(section.indexOf('| contact_index |'), -1);
    assert.notEqual(evidenceSection.indexOf('| contact_index |'), -1);

    const rows = [
        ['contact_index', 'open-contact index uses the global identity key'],
        ['deferred_trigger', 'constraint trigger is deferred until transaction commit'],
        ['function_security', 'prosecdef=true; search_path=public,pg_temp'],
        ['ip_index', 'open-IP index uses the global identity key'],
        ['open_order_guard', 'contact/IP open-order cap is present'],
        ['promo_reservation_ttl_guard', 'discounted reservations cannot outlive the 600-second order deadline'],
        ['reservation_deferred_trigger', 'reservation status and TTL updates are covered by the same deferred guard'],
        ['stock_gate_function', 'C-D3/C-D4/C-D5 trigger function exists'],
        ['stock_index', 'reservation source-snapshot stock-gate index exists'],
        ['stock_ratio_guard', 'guest stock hold ratio rejects at 20 percent'],
        ['ttl_hard_ceiling', 'discounted orders have a 600-second maximum TTL']
    ];
    assert.equal(rows.length, 11);
    for (const [name, detail] of rows) {
        const line = `| ${name} | true | ${detail} |`;
        assert.ok(section.includes(line), `task archive missing ${name}`);
        assert.ok(evidenceSection.includes(line), `evidence archive missing ${name}`);
        assert.match(verify, new RegExp(`'${name}'`));
    }

    assert.match(section, /阶段 5 保持 `in_progress`/u);
    assert.match(section, /80%（4\/5）/u);
    assert.match(section, /不是卡 7 实机拒绝 PASS/u);
    assert.match(section, /不得应用 `supabase\/migrations\/20260925_guest_shop_promo_gates\.sql`/u);
    assert.match(section, /GUEST_SHOP_MAX_QUANTITY` 保持 1/u);
    assert.match(section, /先前交接里的「12\/12」是计数错误/u);
    assert.doesNotMatch(section, /阶段 5 保持 `complete`|总进度保持 \*\*100%/u);

    assert.match(evidenceSection, /卡 7 继续是 PARTIAL/u);
    assert.match(evidenceSection, /不得应用 `20260925_guest_shop_promo_gates\.sql`/u);
    assert.match(hardening, /11\/11 `ok=true`/u);
    assert.match(hardening, /不得单独替代它/u);
    assert.match(payment, /schema 通过不等于卡 7 的实机拒绝通过/u);
    assert.doesNotMatch(payment, /目标库尚未完成落库、verify 和实机证据/u);

    assert.match(sandbox, /\| 7 \| TTL 归还 \| ⚠️ \*\*PARTIAL\*\* \| 归还半项 PASS；\*\*C-D3\/C-D4 尚未完成落库、verify 和实机\*\*/u);
    assert.match(sandbox, /2026-09-22 后续事实（不改写本卡 PARTIAL）/u);
    assert.match(sandbox, /不得改写成 PASS/u);
    assert.match(sandbox, /不得应用 `20260925_guest_shop_promo_gates\.sql`/u);
});

function stockHoldRejects(held, available) {
    const total = held + available;
    return total > 0 && held * 100 >= total * 20;
}

test('card 7 rejection preflight keeps C-D3 and C-D4 separable', () => {
    const fnStart = migration.indexOf('CREATE OR REPLACE FUNCTION public.fn_guest_shop_enforce_promo_safety_gates()');
    const fnEnd = migration.indexOf('COMMENT ON FUNCTION public.fn_guest_shop_enforce_promo_safety_gates()', fnStart);
    assert.ok(fnStart >= 0 && fnEnd > fnStart);
    const fn = migration.slice(fnStart, fnEnd);
    const ttlRaise = fn.indexOf("RAISE EXCEPTION 'guest_promo_order_ttl_invalid'");
    const openReturn = fn.indexOf('OR v_order.expires_at <= v_now THEN');
    const openRaise = fn.indexOf("RAISE EXCEPTION 'guest_open_orders_limit'");
    const stockRaise = fn.indexOf("RAISE EXCEPTION 'guest_stock_hold_limit'");
    assert.ok(ttlRaise >= 0 && openReturn > ttlRaise && openRaise > openReturn && stockRaise > openRaise);
    assert.match(fn, /IF v_total > 0 AND v_held \* 100 >= v_total \* 20 THEN/u);
    assert.equal((fn.match(/COALESCE\(i\.is_shared, false\) = false/gu) || []).length, 2);

    // Same boundary as the SQL gate. These counts are what a live card 7 must use.
    assert.equal(stockHoldRejects(1, 4), true);
    assert.equal(stockHoldRejects(1, 5), false);
    assert.equal(stockHoldRejects(2, 8), true);
    assert.equal(stockHoldRejects(2, 4), true);
    assert.equal(stockHoldRejects(2, 9), false);
    assert.equal(stockHoldRejects(0, 0), false);

    const promo = fs.readFileSync(path.join(ROOT, 'api/_lib/guest-shop/promo.js'), 'utf8');
    assert.match(promo, /guest_stock_hold_limit: GUEST_PROMO_SAFETY_LIMIT_RESPONSE/u);
    assert.match(promo, /guest_open_orders_limit: GUEST_PROMO_SAFETY_LIMIT_RESPONSE/u);
    assert.match(promo, /code: 'guest_promo_safety_limit'/u);
    assert.match(promo, /暂时不能创建订单。这个商品当前可售数量较少，或你还有未支付的游客订单。请稍后再试。/u);
    assert.doesNotMatch(promo, /当前游客购买较多/u);

    const plan = fs.readFileSync(path.join(ROOT, 'docs/guest-purchase-task-2.0.md'), 'utf8');
    const evidence = fs.readFileSync(path.join(ROOT, 'docs/guest-shop-promo-evidence.md'), 'utf8');
    const sandbox = fs.readFileSync(path.join(ROOT, 'docs/guest-shop-promo-sandbox-runbook.md'), 'utf8');
    const payment = fs.readFileSync(path.join(ROOT, 'docs/guest-shop-payment-fulfillment-runbook.md'), 'utf8');
    for (const source of [plan, evidence, sandbox, payment]) {
        assert.match(source, /guest_promo_safety_limit/u);
        assert.match(source, /至少 11 张|至少要 11 张/u);
    }
    assert.match(plan, /### 61\.26 2026-09-22 卡 7 拒绝半项预检（未实机）/u);
    assert.match(evidence, /### 2\.14 卡 7 拒绝半项预检（2026-09-22，未实机）/u);
    assert.match(sandbox, /### 卡 7 拒绝半项预检（2026-09-22，未实机）/u);
    assert.match(plan, /阶段 5 保持 `in_progress`/u);
    assert.match(plan, /80%（4\/5）/u);
    assert.match(evidence, /卡 7 继续是 PARTIAL/u);
    assert.doesNotMatch(evidence, /卡 7 拒绝半项 PASS/u);
});
