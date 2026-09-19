'use strict';

/**
 * Read-only production readiness gate for the guest-shop cash channel.
 *
 * This checker intentionally does not create a Supabase client and does not
 * call a provider.  A production deploy can run it before exposing a guest
 * product; the output only contains configuration names/statuses and never a
 * secret value.  Provider enablement and rate-limit RPC existence still live
 * in the database, so those items are reported as explicit operator checks
 * rather than being guessed from environment variables.
 */

const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const {
    BUYER_CREDENTIAL_RUNTIME_SETTING_NAMES,
    GUEST_SHOP_RUNTIME_SETTINGS,
    PROMO_RUNTIME_SETTING_NAMES,
    parseRuntimeNumericSetting
} = require('../api/_lib/guest-shop/runtime-config');
// Promo L1/L2 switches. The switch names and the quantity ceiling come from the
// runtime module (never re-typed here) so readiness and the HTTP layer can never
// disagree about what "off" means.
const {
    GUEST_DISCOUNT_SWITCH,
    GUEST_MAX_QUANTITY_CEILING,
    GUEST_QUANTITY_SWITCH,
    parseGuestDiscountSwitch,
    resolveGuestMaxQuantity
} = require('../api/_lib/guest-shop/promo');

const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_ENV_FILE = path.resolve(__dirname, '../server/.env.production');

const SUPPORTED_PROVIDERS = Object.freeze(['zpay', 'nowpayments']);
const MEMORY_RATE_LIMIT_BACKENDS = new Set(['memory', 'in-memory', 'local']);
const PERSISTENT_RATE_LIMIT_BACKENDS = new Set([
    'supabase',
    'postgres',
    'postgresql',
    'redis',
    'upstash',
    'database',
    'durable'
]);
const PLACEHOLDER_SECRET_PATTERN = /^(?:__configured__|mock|test|fake|changeme|change[-_ ]?me|replace[-_ ]?me|your[-_ ]?|example|placeholder)[-_ :]/iu;
const PROVIDER_TOKEN_PATTERN = /^[a-z][a-z0-9._:-]{0,79}$/u;
const TRUE_VALUES = new Set(['1', 'true', 'yes', 'y', 'on', 'enabled']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'n', 'off', 'disabled']);

// Keep the exit codes distinct so automation can tell a malformed/unsafe
// configuration from an otherwise valid configuration that still needs
// production/operator evidence.  Any non-zero code remains a hard stop for
// launch scripts; the distinction is for diagnostics and remediation.
const READINESS_EXIT_CODES = Object.freeze({
    INVALID: 2,
    NOT_READY: 3
});

const REQUIRED_REPO_FILES = Object.freeze([
    'api/public.js',
    'api/_lib/guest-shop/security.js',
    'api/_lib/guest-shop/runtime-config.js',
    'api/_lib/payments/guest-shop-adapter.js',
    'api/_lib/guest-shop-alerts.js',
    'api/shop/guest/preview.js',
    'api/shop/guest/orders.js',
    'api/shop/guest/status.js',
    'api/shop/guest/recover.js',
    'api/shop/guest/claim.js',
    'api/shop/guest/webhooks/zpay.js',
    'api/shop/guest/webhooks/nowpayments.js',
    'api/shop/guest/worker.js',
    'server/api-handlers/public/guest-shop.js',
    'server/guest-shop-worker.js',
    'deploy/kvm4/guest-shop-worker/zaoyoe-guest-shop-worker',
    'deploy/kvm4/guest-shop-worker/zaoyoe-guest-shop-worker.service',
    'deploy/kvm4/guest-shop-worker/zaoyoe-guest-shop-worker.timer',
    'scripts/install-kvm4-guest-shop-worker.sh',
    'scripts/guest-shop-reconcile.js',
    'supabase/migrations/20260913_add_guest_shop_cash_purchase.sql',
    'supabase/migrations/20260913_guest_shop_atomic_rpcs.sql',
    'api/_lib/guest-shop/promo.js',
    'supabase/migrations/20260923_guest_shop_promo_l1l2.sql',
    'supabase/migrations/20260923_verify_guest_shop_promo_l1l2.sql',
    'docs/guest-shop-payment-fulfillment-runbook.md',
    'docs/guest-shop-promo-hardening-plan.md'
]);

const REQUIRED_TEST_FILES = Object.freeze([
    'tests/guest-shop-security.test.js',
    'tests/guest-shop-payment-adapter.test.js',
    'tests/guest-shop-webhook.test.js',
    'tests/guest-shop-worker-contract.test.js',
    'tests/guest-shop-worker-scheduler-contract.test.js',
    'tests/guest-shop-runtime-config.test.js',
    'tests/guest-shop-readiness.test.js',
    'tests/guest-shop-alerts.test.js',
    'tests/guest-shop-reconcile.test.js',
    'tests/guest-shop-status-recovery.test.js',
    'tests/guest-shop-frontend-contract.test.js',
    'tests/guest-shop-public-route-contract.test.js'
]);

const BUYER_CREDENTIAL_MIGRATION = 'supabase/migrations/20260920_guest_shop_buyer_credentials.sql';
const BUYER_CREDENTIAL_VERIFY_MIGRATION = 'supabase/migrations/20260920_verify_guest_shop_buyer_credentials.sql';

// Static assertions about the Order Access 2.0 migration. The readiness gate
// never connects to a database (that stays a manual check on the paired
// verify script), so the migration file on disk is the only thing it can
// prove. Each entry is [key, pattern, human label]; `mustNotMatch` entries are
// [key, pattern, label] asserted to be ABSENT.
const BUYER_CREDENTIAL_MIGRATION_REQUIREMENTS = Object.freeze([
    ['buyers-table', /CREATE TABLE IF NOT EXISTS public\.guest_shop_buyers/u, 'guest_shop_buyers 建表'],
    ['access-attempts-table', /CREATE TABLE IF NOT EXISTS public\.guest_shop_access_attempts/u, 'guest_shop_access_attempts 建表'],
    ['credential-group-unique', /UNIQUE \(site, contact_hash, credential_group_no\)/u, '凭证分组 UNIQUE(site, contact_hash, credential_group_no)'],
    ['password-format-norm-version', /norm=v[0-9]+/u, 'password_hash 格式含 norm=v1 归一化版本号'],
    ['contact-hash-format', /guest_shop_buyers_hash_check/u, 'contact_hash 64 位十六进制 CHECK'],
    ['buyers-rls', /ALTER TABLE public\.guest_shop_buyers ENABLE ROW LEVEL SECURITY/u, 'guest_shop_buyers 启用 RLS'],
    ['attempts-rls', /ALTER TABLE public\.guest_shop_access_attempts ENABLE ROW LEVEL SECURITY/u, 'guest_shop_access_attempts 启用 RLS'],
    ['buyers-revoke-public', /REVOKE ALL ON TABLE public\.guest_shop_buyers FROM PUBLIC, anon, authenticated/u, 'guest_shop_buyers 对 anon/authenticated 撤权'],
    ['attempts-revoke-public', /REVOKE ALL ON TABLE public\.guest_shop_access_attempts FROM PUBLIC, anon, authenticated/u, 'guest_shop_access_attempts 对 anon/authenticated 撤权'],
    ['buyers-grant-service-role', /GRANT ALL ON TABLE public\.guest_shop_buyers TO service_role/u, 'guest_shop_buyers 仅授予 service_role'],
    ['outcome-credential-conflict', /'credential_conflict'/u, '审计 outcome 允许 credential_conflict'],
    ['orders-buyer-id-fk', /ADD COLUMN IF NOT EXISTS buyer_id UUID\s+REFERENCES public\.guest_shop_buyers\(id\) ON DELETE SET NULL/u, 'guest_shop_orders.buyer_id 外键（ON DELETE SET NULL）'],
    ['orders-buyer-index', /CREATE INDEX IF NOT EXISTS guest_shop_orders_buyer_idx/u, 'guest_shop_orders_buyer_idx 索引'],
    ['rpc-drop-legacy-signature', /DROP FUNCTION IF EXISTS public\.fn_guest_shop_create_order\(\s*TEXT, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER\s*\)/u, '按精确签名 DROP 旧 12 参数 RPC'],
    ['rpc-buyer-id-param', /p_buyer_id UUID DEFAULT NULL/u, 'RPC 新增 p_buyer_id 参数'],
    ['rpc-contact-required-guard', /guest_buyer_contact_required/u, 'RPC buyer_id 必须携带 contact_hash 的守卫'],
    ['rpc-mismatch-guard', /guest_buyer_mismatch/u, 'RPC buyer_id 与 contact_hash 不匹配即拒绝的守卫'],
    ['rpc-grant-reapplied', /GRANT EXECUTE ON FUNCTION public\.fn_guest_shop_create_order\(TEXT, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, INTEGER\) TO service_role/u, '新 13 参数签名重新授予 service_role EXECUTE']
]);

// Absence assertions. These are the "deploy must not change behaviour" guards
// from AGENTS.md: the A0 migration may only add schema, it may never enable a
// guest product, flip a switch, backfill a row, or schedule a job.
const BUYER_CREDENTIAL_MIGRATION_PROHIBITIONS = Object.freeze([
    ['no-guest-product-enablement', /allow_guest_purchase\s*=\s*true/iu, '迁移不得打开游客商品开关'],
    ['no-product-update', /UPDATE\s+public\.shop_products/iu, '迁移不得 UPDATE shop_products'],
    ['no-sku-update', /UPDATE\s+public\.shop_product_skus/iu, '迁移不得 UPDATE shop_product_skus'],
    ['no-order-backfill', /UPDATE\s+public\.guest_shop_orders/iu, '迁移不得回填历史订单 buyer_id'],
    ['no-scheduled-job', /pg_cron|cron\.schedule/iu, '迁移不得创建清理定时任务'],
    ['no-cascade', /DROP\s+FUNCTION[\s\S]{0,200}CASCADE/iu, '迁移不得使用 DROP ... CASCADE'],
    ['no-denormalised-order-count', /order_count\s+INTEGER/iu, 'guest_shop_buyers 不得再引入会漂移的 order_count 计数列']
]);

const BUYER_CREDENTIAL_VERIFY_REQUIREMENTS = Object.freeze([
    ['verify-checks-function', /fn_guest_shop_create_order/u, 'verify 脚本检查下单 RPC 签名'],
    ['verify-checks-rls', /rls_and_privileges_closed/u, 'verify 脚本检查 RLS 与权限收口'],
    ['verify-checks-realtime', /realtime_published/u, 'verify 脚本检查新表未进入 realtime 发布'],
    ['verify-checks-legacy-absent', /legacy_12_param_signature_absent/u, 'verify 脚本检查旧 12 参数签名已消失'],
    // 2026-09-23 探针勘误：verify 曾被 13 参精确签名钉死，L1/L2 迁移换成 15 参后
    // 第 8/9/10 行对**正确的库**报假 FAIL。时代清单（fn_era）是修复方式，必须留在这里，
    // 否则下一次签名变更会重演同一场事故。
    ['verify-era-aware-signature', /\), fn_era AS \(/u, 'verify 用 fn_era 时代清单识别 create_order 签名（不按单一签名钉死）'],
    ['verify-known-signature-key', /known_signature_present/u, 'verify 断言已安装签名属于已知时代'],
    ['verify-era-aware-quantity', /quantity_policy_matches_era/u, 'verify 的数量策略断言随时代推导（A0 固定 1 件 / L1L2 服务端限量）']
]);

const BUYER_CREDENTIAL_VERIFY_PROHIBITIONS = Object.freeze([
    ['verify-read-only', /^\s*(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|GRANT|REVOKE|TRUNCATE|CALL)\b/imu, 'verify 脚本必须是只读的（不得出现写操作语句）'],
    ['verify-no-signature-pinned-cte', /WHERE\s+p\.oid\s*=\s*to_regprocedure\(\s*'public\.fn_guest_shop_create_order/u, 'verify 不得按精确签名解析 create_order CTE（签名一变即整片假 FAIL）'],
    ['verify-no-era-pinned-arity', /'arity', 13,/u, 'verify 的 arity 期望值必须由 fn_era 推导，不得写死 13'],
    ['verify-retired-13-param-key', /new_13_param_signature_present/u, '已退休的时代钉死键 new_13_param_signature_present 不得复活'],
    ['verify-retired-quantity-key', /quantity_still_hardcoded_to_one/u, '已退休的时代钉死键 quantity_still_hardcoded_to_one 不得复活']
]);

// ---------------------------------------------------------------------------
// Order Access 2.0 (A1b): the atomic credential-group allocation RPC. Like A0,
// the readiness gate never connects to a database, so the migration file on
// disk is the only thing it can prove statically; the paired verify script
// stays a manual operator step against the target Supabase. A1b is additive:
// it creates one SECURITY DEFINER function and writes nothing else, so the
// prohibitions below are the "a function migration must not reshape schema or
// flip a switch" guards from AGENTS.md.
// ---------------------------------------------------------------------------
const BUYER_GROUP_UPSERT_MIGRATION = 'supabase/migrations/20260921_guest_shop_buyer_group_upsert.sql';
const BUYER_GROUP_UPSERT_VERIFY_MIGRATION = 'supabase/migrations/20260921_verify_guest_shop_buyer_group_upsert.sql';

const BUYER_GROUP_UPSERT_MIGRATION_REQUIREMENTS = Object.freeze([
    ['upsert-fn-created', /CREATE OR REPLACE FUNCTION public\.fn_guest_shop_upsert_buyer_group\(/u, 'fn_guest_shop_upsert_buyer_group 建函数'],
    ['upsert-security-definer', /SECURITY DEFINER/u, '函数声明为 SECURITY DEFINER'],
    ['upsert-search-path-pinned', /SET search_path = public, pg_temp/u, '固定 search_path 防止对象劫持'],
    ['upsert-advisory-lock', /pg_advisory_xact_lock\(hashtextextended\(/u, '按 (site, contact_hash) 取事务级 advisory lock 串行化分配'],
    ['upsert-site-invalid-token', /guest_buyer_site_invalid/u, 'site 非法的命名错误令牌'],
    ['upsert-contact-required-token', /guest_buyer_contact_required/u, 'contact_hash 缺失/非法的命名错误令牌'],
    ['upsert-password-malformed-token', /guest_buyer_password_malformed/u, 'password_hash 格式非法的命名错误令牌'],
    ['upsert-password-required-token', /guest_buyer_password_required/u, '新建/回收分组缺少 password_hash 的命名错误令牌'],
    ['upsert-conflict-token', /guest_buyer_credential_conflict/u, '分组达上限的命名 409 令牌'],
    ['upsert-on-conflict-constraint', /ON CONFLICT ON CONSTRAINT guest_shop_buyers_site_contact_group_uniq DO NOTHING/u, '按约束名 ON CONFLICT DO NOTHING（避免列表达式歧义）'],
    ['upsert-registered-match-record-only', /registered_user_match = COALESCE\(p_registered_user_match, false\)/u, 'registered_user_match 仅记录、默认 false（§10.1 反价格歧视）'],
    ['upsert-revoke-public', /REVOKE ALL ON FUNCTION public\.fn_guest_shop_upsert_buyer_group\(TEXT, TEXT, SMALLINT, TEXT, INTEGER, INTEGER, BOOLEAN\) FROM PUBLIC, anon, authenticated/u, 'upsert 函数对 anon/authenticated 撤权'],
    ['upsert-grant-service-role', /GRANT EXECUTE ON FUNCTION public\.fn_guest_shop_upsert_buyer_group\(TEXT, TEXT, SMALLINT, TEXT, INTEGER, INTEGER, BOOLEAN\) TO service_role/u, 'upsert 函数仅授予 service_role EXECUTE']
]);

const BUYER_GROUP_UPSERT_MIGRATION_PROHIBITIONS = Object.freeze([
    ['upsert-no-do-update', /ON CONFLICT[^;]*DO UPDATE/iu, 'upsert 不得用 DO UPDATE 覆写既有分组密码（N2 防卡密串读）'],
    ['upsert-no-create-table', /CREATE TABLE/iu, 'A1b 为纯函数迁移，不得建表'],
    ['upsert-no-alter-table', /ALTER TABLE/iu, 'A1b 不得改表（A0 已建好结构）'],
    ['upsert-no-drop-table', /DROP TABLE/iu, 'A1b 不得删表'],
    ['upsert-no-guest-product-enablement', /allow_guest_purchase\s*=\s*true/iu, '迁移不得打开游客商品开关'],
    ['upsert-no-product-update', /UPDATE\s+public\.shop_products/iu, '迁移不得 UPDATE shop_products'],
    ['upsert-no-sku-update', /UPDATE\s+public\.shop_product_skus/iu, '迁移不得 UPDATE shop_product_skus'],
    ['upsert-no-order-backfill', /UPDATE\s+public\.guest_shop_orders/iu, '迁移不得回填历史订单 buyer_id'],
    ['upsert-no-scheduled-job', /pg_cron|cron\.schedule/iu, '迁移不得创建清理定时任务']
]);

const BUYER_GROUP_UPSERT_VERIFY_REQUIREMENTS = Object.freeze([
    ['verify-upsert-fn-present', /upsert_fn_present_and_unique/u, 'verify 检查 upsert 函数存在且唯一重载'],
    ['verify-upsert-signature', /upsert_fn_signature/u, 'verify 检查 upsert 函数签名/参数名/返回列'],
    ['verify-upsert-security-posture', /upsert_fn_security_posture/u, 'verify 检查 SECURITY DEFINER / search_path / 非 IMMUTABLE'],
    ['verify-upsert-grants', /upsert_fn_grants/u, 'verify 检查仅 service_role 可 EXECUTE'],
    ['verify-upsert-body-guarantees', /upsert_fn_body_guarantees/u, 'verify 检查 advisory lock / 命名错误 / DO NOTHING / record-only 不变量'],
    ['verify-a1b-additive', /a1b_is_additive/u, 'verify 检查 A1b 未改动 A0 结构（纯增量）'],
    // 同上：A1b 的「create_order 仍可调」必须认时代，不能钉 13 参签名。
    ['verify-a1b-era-aware-rpc', /create_order_rpc_known_signature/u, 'verify 断言 create_order RPC 属于已知签名时代（A0 13 参 / L1L2 15 参）']
]);

const BUYER_GROUP_UPSERT_VERIFY_PROHIBITIONS = Object.freeze([
    ['verify-read-only', /^\s*(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|GRANT|REVOKE|TRUNCATE|CALL)\b/imu, 'A1b verify 脚本必须是只读的（不得出现写操作语句）'],
    ['verify-a1b-retired-rpc-key', /create_order_rpc_still_13_params/u, '已退休的时代钉死键 create_order_rpc_still_13_params 不得复活']
]);

// ---------------------------------------------------------------------------
// Promo L1/L2 gate (docs/guest-shop-promo-hardening-plan.md §12.4 / §13).
//
// L1 = guest quantity > 1 with tiered/flash pricing. L2 = guest discount codes.
// Both ship OFF and both stay behaviour-neutral until an operator flips the
// matching env switch AND opens the paired database row:
//
//   env  GUEST_SHOP_DISCOUNT_ENABLED   L2 master switch (restart to take effect)
//   env  GUEST_SHOP_MAX_QUANTITY       L1 operator ceiling (default 1, hard max 5)
//   DB   guest_shop_promo_budget       seeded enabled=false / daily_budget=0
//   DB   guest_shop_promo_breaker      seeded state='closed'
//   DB   discount_codes.allow_guest    per-code whitelist, default false
//
// Like A0/A1b this checker never connects to a database: the migration files on
// disk are the only thing it can prove statically, so every runtime/database
// invariant below is an explicit operator check and readiness stays fail-closed.
//
// Two prohibitions are deliberately NOT asserted here, because both strings occur
// legitimately inside SECURITY DEFINER function bodies (the atomic
// guest_used_count increment and the order state machine). Asserting them would
// either fail on the correct migration or force a regex so weak that it misses a
// real data backfill:
//   UPDATE public.discount_codes / UPDATE public.guest_shop_orders
// The equivalent protection is 'no-top-level-dml', anchored to a statement start
// so it only matches DML outside a $$ body, plus the paired verify script's
// existing_rows_satisfy_new_checks / no_side_effects rows, which the operator
// asserts against the live database.
// ---------------------------------------------------------------------------
const PROMO_MIGRATION = 'supabase/migrations/20260923_guest_shop_promo_l1l2.sql';
const PROMO_VERIFY_MIGRATION = 'supabase/migrations/20260923_verify_guest_shop_promo_l1l2.sql';

const PROMO_MIGRATION_REQUIREMENTS = Object.freeze([
    ['orders-list-unit-amount-column', /ADD COLUMN IF NOT EXISTS list_unit_amount NUMERIC\(14,2\)/u, 'guest_shop_orders.list_unit_amount 折前单价列'],
    ['orders-discount-amount-column', /ADD COLUMN IF NOT EXISTS discount_amount NUMERIC\(14,2\) NOT NULL DEFAULT 0/u, 'guest_shop_orders.discount_amount 折扣列（NOT NULL DEFAULT 0）'],
    ['orders-discount-code-column', /ADD COLUMN IF NOT EXISTS discount_code VARCHAR\(64\)/u, 'guest_shop_orders.discount_code 已用券码列'],
    ['orders-discount-snapshot-column', /ADD COLUMN IF NOT EXISTS discount_snapshot JSONB/u, 'guest_shop_orders.discount_snapshot 不可变审计快照列'],
    ['orders-payment-fee-column', /ADD COLUMN IF NOT EXISTS payment_fee_amount NUMERIC\(14,2\) NOT NULL DEFAULT 0/u, 'guest_shop_orders.payment_fee_amount 通道费独立列'],
    ['orders-amount-check', /guest_shop_orders_amount_check/u, '订单金额 CHECK（total_amount = unit_amount*quantity + payment_fee_amount）'],
    ['orders-quantity-ceiling', /guest_shop_orders_quantity_check[\s\S]{0,80}CHECK \(quantity >= 1 AND quantity <= 5\)/u, '订单数量硬顶 CHECK(quantity BETWEEN 1 AND 5)'],
    ['orders-discount-code-shape', /ADD CONSTRAINT guest_shop_orders_discount_code_check/u, '券码字符集 CHECK（大写白名单）'],
    ['zero-purchase-floor', /discount_amount < ROUND\(list_unit_amount \* quantity, 2\)/u, '零元购地板：折扣必须严格小于折前总额（永不产生 0 元单）'],
    ['discount-half-cap', /discount_amount <= ROUND\(list_unit_amount \* quantity \* 0\.5, 2\)/u, '折扣硬顶：单笔最多折 50%（数据库层地板价）'],
    ['fee-cap', /payment_fee_amount <= ROUND\(unit_amount \* quantity \* 0\.1, 2\) \+ 0\.01/u, '通道费硬顶 10%（含 0.01 进位余量）'],
    ['ledger-table', /CREATE TABLE IF NOT EXISTS public\.guest_shop_discount_redemptions \(/u, 'guest_shop_discount_redemptions 游客用券台账建表'],
    ['ledger-buyer-attribution', /buyer_contact_hash/u, '用券台账带 buyer_contact_hash 归属列（配额地基）'],
    ['ledger-return-columns', /returned_at/u, '用券台账带 returned_at 归还列（TTL 到期退券退预算）'],
    ['discount-codes-allow-guest', /ADD COLUMN IF NOT EXISTS allow_guest BOOLEAN/u, 'discount_codes.allow_guest 券级白名单列（默认 false）'],
    ['discount-codes-guest-max-uses', /ADD COLUMN IF NOT EXISTS guest_max_uses INTEGER/u, 'discount_codes.guest_max_uses 券级次数硬预算列（0 = 关闭）'],
    ['discount-codes-guest-used-count', /ADD COLUMN IF NOT EXISTS guest_used_count/u, 'discount_codes.guest_used_count 已用次数计数列'],
    ['discount-codes-guest-budget', /ADD COLUMN IF NOT EXISTS guest_max_total_discount NUMERIC/u, 'discount_codes.guest_max_total_discount 券级金额硬预算列'],
    ['sku-guest-max-quantity', /guest_max_quantity/u, '商品/SKU 级 guest_max_quantity 游客件数上限列'],
    ['budget-table', /CREATE TABLE IF NOT EXISTS public\.guest_shop_promo_budget \(/u, 'guest_shop_promo_budget 站点日预算建表'],
    ['budget-seed-closed', /VALUES \('cn', false, 0\), \('intl', false, 0\)/u, '站点日预算种子为「关闭 + 0 元」（cn/intl 双站）'],
    ['breaker-table', /CREATE TABLE IF NOT EXISTS public\.guest_shop_promo_breaker \(/u, 'guest_shop_promo_breaker 熔断单行表建表'],
    ['breaker-seed-closed', /VALUES \(1, 'closed'\)/u, '熔断种子为 closed（未跳闸）'],
    ['breaker-state-two-values', /guest_shop_promo_breaker_state_check CHECK \(state IN \('closed', 'open'\)\)/u, '熔断状态只有 closed/open 两值（无自动半开）'],
    ['breaker-events-table', /CREATE TABLE IF NOT EXISTS public\.guest_shop_promo_breaker_events \(/u, 'guest_shop_promo_breaker_events 滚动窗口计数/审计建表'],
    ['gate-fn', /CREATE OR REPLACE FUNCTION public\.guest_shop_promo_gate\(/u, 'guest_shop_promo_gate 促销总闸函数'],
    ['evaluate-fn', /CREATE OR REPLACE FUNCTION public\.fn_guest_shop_evaluate_discount\(/u, 'fn_guest_shop_evaluate_discount 只读报价函数'],
    ['reserve-fn', /CREATE OR REPLACE FUNCTION public\.fn_guest_shop_reserve_discount\(/u, 'fn_guest_shop_reserve_discount 原子扣减预占函数'],
    ['return-reservation-fn', /CREATE OR REPLACE FUNCTION public\.fn_guest_shop_return_discount_reservation\(/u, 'fn_guest_shop_return_discount_reservation 预占归还函数'],
    ['record-event-fn', /CREATE OR REPLACE FUNCTION public\.fn_guest_shop_promo_record_event\(/u, 'fn_guest_shop_promo_record_event 滚动窗口事件计数函数'],
    ['set-breaker-fn', /CREATE OR REPLACE FUNCTION public\.fn_guest_shop_promo_set_breaker\(/u, 'fn_guest_shop_promo_set_breaker 人工跳闸/恢复函数'],
    ['status-fn', /CREATE OR REPLACE FUNCTION public\.fn_guest_shop_promo_status\(\)/u, 'fn_guest_shop_promo_status 只读状态函数'],
    ['resolver-fn', /CREATE OR REPLACE FUNCTION public\.guest_shop_resolve_credit_unit_amount\(/u, 'guest_shop_resolve_credit_unit_amount 唯一定价权威函数（L1 放开 quantity）'],
    ['reservation-rollup-fn', /CREATE OR REPLACE FUNCTION public\.guest_shop_reservation_rollup\(/u, 'guest_shop_reservation_rollup 多行预占汇总函数'],
    ['release-held-fn', /CREATE OR REPLACE FUNCTION public\.guest_shop_release_held_reservations\(/u, 'guest_shop_release_held_reservations 到期释放函数（同时退券退预算）'],
    ['create-order-quantity-arg', /p_quantity INTEGER DEFAULT 1/u, 'fn_guest_shop_create_order 新增 p_quantity（默认 1 = P0 行为）'],
    ['create-order-code-arg', /p_discount_code TEXT DEFAULT NULL/u, 'fn_guest_shop_create_order 新增 p_discount_code（默认 NULL = P0 行为）'],
    ['legacy-create-order-dropped', /DROP FUNCTION IF EXISTS public\.fn_guest_shop_create_order\([\s\S]{0,120}TEXT, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, INTEGER\s*\)/u, '旧 13 参数 create_order 重载被显式 DROP（避免 PostgREST 重载歧义）'],
    ['security-definer', /SECURITY DEFINER/u, '促销函数声明为 SECURITY DEFINER'],
    ['search-path-pinned', /SET search_path = public, pg_temp/u, '促销函数固定 search_path 防止对象劫持'],
    ['budget-closed-token', /guest_promo_budget_closed/u, '预算未开的命名错误令牌'],
    ['breaker-halted-token', /guest_promo_halted/u, '熔断跳闸的命名错误令牌'],
    ['identity-required-token', /guest_discount_identity_required/u, '折扣无法归属身份的命名错误令牌'],
    ['quantity-not-allowed-token', /guest_quantity_not_allowed/u, '数量超限的命名错误令牌'],
    ['privilege-leak-guard', /guest_shop_privilege_leak/u, '权限泄漏断言（浏览器不可达促销表）'],
    ['ledger-rls', /ALTER TABLE public\.guest_shop_discount_redemptions ENABLE ROW LEVEL SECURITY/u, '用券台账开启 RLS'],
    ['budget-rls', /ALTER TABLE public\.guest_shop_promo_budget ENABLE ROW LEVEL SECURITY/u, '预算表开启 RLS'],
    ['breaker-rls', /ALTER TABLE public\.guest_shop_promo_breaker ENABLE ROW LEVEL SECURITY/u, '熔断表开启 RLS'],
    ['breaker-events-rls', /ALTER TABLE public\.guest_shop_promo_breaker_events ENABLE ROW LEVEL SECURITY/u, '熔断事件表开启 RLS'],
    ['ledger-revoke-browser', /REVOKE ALL ON TABLE public\.guest_shop_discount_redemptions FROM PUBLIC, anon, authenticated/u, '用券台账对 anon/authenticated 撤权'],
    ['budget-revoke-browser', /REVOKE ALL ON TABLE public\.guest_shop_promo_budget FROM PUBLIC, anon, authenticated/u, '预算表对 anon/authenticated 撤权'],
    ['breaker-revoke-browser', /REVOKE ALL ON TABLE public\.guest_shop_promo_breaker FROM PUBLIC, anon, authenticated/u, '熔断表对 anon/authenticated 撤权'],
    ['breaker-events-revoke-browser', /REVOKE ALL ON TABLE public\.guest_shop_promo_breaker_events FROM PUBLIC, anon, authenticated/u, '熔断事件表对 anon/authenticated 撤权'],
    ['gate-fn-service-only', /GRANT EXECUTE ON FUNCTION public\.guest_shop_promo_gate\(TEXT, NUMERIC\) TO service_role/u, 'gate 函数仅授予 service_role EXECUTE'],
    ['evaluate-fn-service-only', /GRANT EXECUTE ON FUNCTION public\.fn_guest_shop_evaluate_discount\(TEXT, UUID, UUID, INTEGER, NUMERIC, TEXT, UUID, TEXT, TEXT, INTEGER, INTEGER\) TO service_role/u, 'evaluate 函数仅授予 service_role EXECUTE'],
    ['reserve-fn-service-only', /GRANT EXECUTE ON FUNCTION public\.fn_guest_shop_reserve_discount\(TEXT, UUID, UUID, INTEGER, NUMERIC, TEXT, UUID, TEXT, TEXT, TEXT, UUID, INTEGER, INTEGER\) TO service_role/u, 'reserve 函数仅授予 service_role EXECUTE'],
    ['create-order-fn-service-only', /GRANT EXECUTE ON FUNCTION public\.fn_guest_shop_create_order\(TEXT, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, INTEGER, INTEGER, TEXT\) TO service_role/u, '15 参数 create_order 仅授予 service_role EXECUTE'],
    ['resolver-fn-service-only', /GRANT EXECUTE ON FUNCTION public\.guest_shop_resolve_credit_unit_amount\(TEXT, NUMERIC, NUMERIC, BOOLEAN, JSONB, JSONB, JSONB, JSONB, NUMERIC, NUMERIC, TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE, INTEGER, TIMESTAMP WITH TIME ZONE\) TO service_role/u, '定价 resolver 仅授予 service_role EXECUTE']
]);

const PROMO_MIGRATION_PROHIBITIONS = Object.freeze([
    ['no-guest-product-enablement', /allow_guest_purchase\s*=\s*true/iu, '迁移不得打开游客商品/SKU 开关'],
    ['no-product-update', /UPDATE\s+public\.shop_products/iu, '迁移不得 UPDATE shop_products'],
    ['no-sku-update', /UPDATE\s+public\.shop_product_skus/iu, '迁移不得 UPDATE shop_product_skus'],
    ['no-top-level-dml', /^(?:UPDATE|DELETE|TRUNCATE)[ \t]+public\./mu, '迁移不得在顶层（$ 函数体之外）做数据回填/删除'],
    ['no-drop-table', /DROP\s+TABLE/iu, '迁移不得删表（只允许按精确签名 DROP 旧函数重载）'],
    ['no-drop-schema', /DROP\s+SCHEMA/iu, '迁移不得删 schema'],
    ['no-drop-amount-check-without-readd', /DROP CONSTRAINT IF EXISTS guest_shop_orders_amount_check;(?![\s\S]{0,600}ADD CONSTRAINT guest_shop_orders_amount_check)/iu, '金额 CHECK 不得只删不加（AGENTS.md 禁止 DROP CONSTRAINT 了事）'],
    ['no-browser-policy', /CREATE POLICY/iu, '迁移不得为促销表创建任何 RLS 策略（浏览器必须完全不可达）'],
    ['no-anon-grant', /GRANT[^;]*\bTO\s+(?:anon|authenticated)\b/iu, '迁移不得向 anon/authenticated 授权'],
    ['no-scheduled-job', /pg_cron|cron\.schedule/iu, '迁移不得创建定时任务（清理由运维调度）'],
    ['no-auto-half-open', /'half[_-]open'/iu, '熔断状态不得引入半开值（恢复必须人工 + 二次确认 + 审计）'],
    ['no-budget-seed-open', /VALUES \('(?:cn|intl)', true/iu, '预算种子不得预置为已开启'],
    ['no-breaker-seed-open', /VALUES \(1, 'open'\)/iu, '熔断种子不得预置为已跳闸'],
    ['no-code-default-allow-guest', /allow_guest BOOLEAN[^,\n]*DEFAULT true/iu, 'allow_guest 默认值不得为 true（默认全开）'],
    // The old form of this prohibition matched a column that this batch never
    // creates, so it passed vacuously while two SQL comments told operators to
    // tune an env switch that does not exist either. Asserting the phantom names
    // are ABSENT is the check that actually protects an operator: the only
    // percent bound is guest_shop_orders_amount_check's 50% floor, and it is
    // tightened by the per-code / per-site budgets, not by a knob.
    ['no-phantom-percent-knob', /GUEST_SHOP_DISCOUNT_MAX_PERCENT|guest_max_discount_percent/iu, '迁移不得引用未实现的折扣率 env 旋钮或券级折扣率列（本批折扣率边界只有数据库 50% 硬顶，引用不存在的开关会误导运维）']
]);

const PROMO_VERIFY_REQUIREMENTS = Object.freeze([
    ['verify-orders-new-columns', /'orders_new_columns'/u, 'verify 检查 guest_shop_orders 5 个新列'],
    ['verify-orders-amount-check', /'orders_amount_check'/u, 'verify 检查订单金额 CHECK（含零元购地板与 50% 硬顶）'],
    ['verify-orders-quantity-and-code', /'orders_quantity_and_code_checks'/u, 'verify 检查数量硬顶与券码字符集 CHECK'],
    ['verify-reservations-multi-row', /'reservations_multi_row'/u, 'verify 检查库存预占支持一单多行'],
    ['verify-ledger-table-columns', /'ledger_table_columns'/u, 'verify 检查用券台账列（且不含明文邮箱/密码/claim_secret）'],
    ['verify-ledger-constraints', /'ledger_constraints'/u, 'verify 检查用券台账约束'],
    ['verify-ledger-indexes', /'ledger_indexes'/u, 'verify 检查用券台账 24h 配额索引'],
    ['verify-ledger-rls-and-privileges', /'ledger_rls_and_privileges'/u, 'verify 检查用券台账 RLS 与权限收口'],
    ['verify-function-arity', /'function_arity_single_overload'/u, 'verify 检查促销函数各自唯一重载（签名无歧义）'],
    ['verify-function-privileges', /'function_privileges'/u, 'verify 检查促销函数仅 service_role 可执行'],
    ['verify-function-hardening', /'function_hardening'/u, 'verify 检查 SECURITY DEFINER / search_path / 非 IMMUTABLE'],
    ['verify-zero-purchase-guards', /'zero_purchase_guards'/u, 'verify 检查零元购防线（地板 + 硬顶 + total_amount > 0）'],
    ['verify-resolver-parity', /'resolver_tier_flash_parity'/u, 'verify 检查阶梯价/闪购在游客与登录链路等价'],
    ['verify-replay-return-types', /'replay_return_types_cast'/u, 'verify 检查幂等重放返回类型与 CAST 一致'],
    ['verify-existing-rows-satisfy-checks', /'existing_rows_satisfy_new_checks'/u, 'verify 检查历史行满足新 CHECK（无需回填）'],
    ['verify-no-side-effects', /'no_side_effects'/u, 'verify 检查迁移无副作用（无新触发器/无定时任务）'],
    ['verify-discount-codes-guest-columns', /'discount_codes_guest_columns'/u, 'verify 检查 discount_codes 游客列与「0 = 关闭」语义'],
    ['verify-promo-budget-table', /'promo_budget_table'/u, 'verify 检查预算表结构与种子关闭'],
    ['verify-promo-breaker-table', /'promo_breaker_table'/u, 'verify 检查熔断表结构与种子 closed'],
    ['verify-promo-breaker-events-table', /'promo_breaker_events_table'/u, 'verify 检查熔断事件表结构与窗口索引'],
    ['verify-ledger-return-columns', /'ledger_return_columns'/u, 'verify 检查台账归还列（退券退预算闭环）'],
    ['verify-promo-function-guards', /'promo_function_guards'/u, 'verify 检查促销函数体的命名错误令牌与闸序不变量'],
    // 2026-09-23 首次执行后的两类探针缺陷修复（假 FAIL 第 3、4 类）。
    // pg_proc.prosrc 保留函数自己的 SQL 注释，拿关键字正则扫原始 prosrc 会把
    // 注释当代码：fn_guest_shop_evaluate_discount 的原子性说明里有一句
    // "the atomic UPDATE pair"，于是只读函数被报成 evaluate_is_read_only=false。
    // 修法只能是「先剥注释再扫」（CTE fn_code），并且保留 fail-closed 键证明
    // 剥离没有吃掉函数体；绝不允许靠删注释或删只读断言让它变绿。
    ['verify-body-scans-strip-comments', /regexp_replace\(f\.prosrc, '--\.\*', ' ', 'gn'\)/u, 'fn_code CTE：函数体探针先剥行注释'],
    ['verify-body-scans-strip-block-comments', /'\/\[\*\]\.\*\?\[\*\]\/', ' ', 'gs'/u, 'fn_code CTE：函数体探针再剥块注释'],
    ['verify-fn-code-superset', /\), fn_code AS \([\s\S]{0,2000}?SELECT f\.\*,/u, 'fn_code 是 guest_fns 的严格超集（所有探针统一走它）'],
    ['verify-evaluate-no-dynamic-sql', /'evaluate_has_no_dynamic_sql'/u, 'verify 检查 evaluate 无动态 SQL（EXECUTE）'],
    ['verify-evaluate-strip-keeps-guards', /'evaluate_strip_keeps_guards'/u, 'verify 保留 fail-closed 键：剥注释后角色守卫与共享定价器调用仍在'],
    ['verify-promo-functions-never-write-products', /'promo_functions_never_write_products'/u, 'verify 检查任何 guest_shop 函数都不得写 shop_products / shop_product_skus（机制断言）'],
    // 运维状态（开了几个游客商品/ SKU / 券）不是迁移的性质，不能作为 PASS/FAIL
    // 常量；沿用 20260915_verify_guest_shop_credit_pricing.sql 第 8 行的 REVIEW 约定。
    ['verify-operator-state-review-row', /'operator_state_review'/u, 'verify 第 23 行以 REVIEW 形式输出运维状态'],
    ['verify-operator-state-review-branch', /THEN 'PASS' ELSE 'REVIEW'/u, 'verify 的判分 CASE 对运维状态行走 PASS/REVIEW 分支（永不 FAIL）'],
    ['verify-operator-state-names-products', /'guest_enabled_products'/u, 'verify 点名具体游客商品（光有计数无法据此行动）']
]);

const PROMO_VERIFY_PROHIBITIONS = Object.freeze([
    ['verify-read-only', /^[ \t]*(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|GRANT|REVOKE|TRUNCATE|CALL)\b/imu, '促销 verify 脚本必须是只读的（不得出现写操作语句）'],
    // 运维状态钉死成常量，会让正确的迁移在「有人开过游客商品」时必然 FAIL；
    // FAIL 一旦成为常态，运维就会开始忽略所有 FAIL —— 这本身就是安全事故的前置条件。
    ['verify-no-pinned-operator-count', /'guest_products_enabled',\s*0\b/u, '促销 verify 不得把游客商品计数钉成常量 0（运维状态只能进 REVIEW 行）'],
    // 直接扫原始 prosrc：注释会被当成代码。负向探针因此假 FAIL，正向探针
    // 因此可能假 PASS（更危险）。所有函数体扫描必须走 fn_code.code。
    ['verify-no-raw-prosrc-regex', /prosrc\s*~\*?\s*'/u, '促销 verify 不得对原始 prosrc 做关键字正则扫描（必须先剥注释）'],
    ['verify-no-raw-prosrc-position', /\bin\s+(?:[fp]\.)?prosrc\b/u, '促销 verify 不得对原始 prosrc 做 position 扫描（必须先剥注释）']
]);

// js/guest-shop-client.js is the only browser script allowed to carry a guest
// discount code, and only inside a POST body. Each pattern below is a
// single-line "sink + code identifier" test: it fires only when a code-ish name
// is used together with a persistent/URL sink, so an ordinary
// `normalizeGuestDiscountCode(body.discountCode)` never trips it. The same
// invariants are asserted by tests/guest-shop-frontend-contract.test.js; keeping
// them here too means a release cannot ship a leaked code even if the contract
// test is skipped.
const GUEST_SHOP_CLIENT_FILE = 'js/guest-shop-client.js';
const PROMO_CLIENT_CODE_LEAK_PATTERNS = Object.freeze([
    ['local-storage', /localStorage\b[^\n]*(?:discount|coupon|promo)[_-]?code/iu],
    ['session-storage', /sessionStorage\b[^\n]*(?:discount|coupon|promo)[_-]?code/iu],
    ['url-search-params', /URLSearchParams[^\n]*(?:discount|coupon|promo)[_-]?code/iu],
    ['location-url', /location\.(?:search|href|assign|replace)[^\n]*(?:discount|coupon|promo)[_-]?code/iu],
    ['history-or-window-open', /(?:history\.pushState|window\.open)[^\n]*(?:discount|coupon|promo)[_-]?code/iu],
    ['literal-query-param', /[?&](?:discount|coupon|promo)[_-]?code=/iu],
    ['anchor-href', /\.href\s*=[^\n]*(?:discount|coupon|promo)[_-]?code/iu]
]);

const BUYER_CREDENTIAL_FRONTEND_FILES = Object.freeze([
    'guest-orders.html',
    'js/guest-orders-client.js'
]);

function parseArgs(argv = []) {
    const options = {
        envFile: DEFAULT_ENV_FILE,
        json: false,
        failOnInvalid: false,
        failOnNotReady: false
    };

    for (let index = 0; index < argv.length; index += 1) {
        const value = String(argv[index] || '').trim();
        if (!value) continue;

        if (value === '--env-file') {
            const next = String(argv[index + 1] || '').trim();
            if (next) options.envFile = path.resolve(process.cwd(), next);
            index += 1;
            continue;
        }

        if (value === '--json') {
            options.json = true;
            continue;
        }

        if (value === '--fail-on-invalid') {
            options.failOnInvalid = true;
            continue;
        }

        if (value === '--fail-on-not-ready') {
            options.failOnNotReady = true;
        }
    }

    return options;
}

/**
 * Merge a dotenv file over a base environment without mutating process.env.
 * Missing files are intentionally ignored here; callers can expose that fact
 * as a non-secret readiness check and still use environment-injected values.
 */
function loadEnvFile(envFile = DEFAULT_ENV_FILE, baseEnv = process.env) {
    const merged = { ...(baseEnv && typeof baseEnv === 'object' ? baseEnv : {}) };
    const filePath = String(envFile || '').trim();
    if (!filePath || !fs.existsSync(filePath)) return merged;

    try {
        const parsed = dotenv.parse(fs.readFileSync(filePath));
        Object.assign(merged, parsed);
    } catch (_) {
        // The CLI adds a dedicated env-file check.  Keeping this helper
        // side-effect free makes it safe to use in unit tests.
    }
    return merged;
}

function normalizeText(value, maxLength = 500) {
    if (value === undefined || value === null) return '';
    return String(value).trim().slice(0, Math.max(0, Number(maxLength) || 0));
}

function envValue(env, name, maxLength = 1000) {
    return normalizeText(env?.[name], maxLength);
}

function firstEnvValue(env, names = []) {
    for (const name of names) {
        const value = envValue(env, name);
        if (value) return { name, value };
    }
    return { name: '', value: '' };
}

function parseBoolean(value) {
    const normalized = normalizeText(value, 40).toLowerCase();
    if (TRUE_VALUES.has(normalized)) return true;
    if (FALSE_VALUES.has(normalized)) return false;
    return null;
}

function productionMarkers(env = {}) {
    return ['VERCEL_ENV', 'RAILWAY_ENVIRONMENT_NAME', 'DEPLOYMENT_TIER', 'APP_ENV']
        .map((name) => ({ name, value: envValue(env, name, 80).toLowerCase() }))
        .filter((entry) => entry.value);
}

function isProductionLikeRuntime(env = {}) {
    return productionMarkers(env).some((entry) => entry.value === 'production');
}

function looksLikePlaceholderSecret(value) {
    const normalized = normalizeText(value, 1000);
    if (!normalized) return true;
    if (PLACEHOLDER_SECRET_PATTERN.test(normalized)) return true;
    return ['__configured__', 'mock', 'test', 'fake', 'changeme', 'placeholder'].includes(normalized.toLowerCase());
}

function secretIsStrong(value, minimumBytes = 32) {
    const normalized = normalizeText(value, 4096);
    return Boolean(normalized)
        && !looksLikePlaceholderSecret(normalized)
        && Buffer.byteLength(normalized, 'utf8') >= minimumBytes;
}

function isHttpsUrl(value) {
    const normalized = normalizeText(value, 2000);
    if (!normalized) return false;
    try {
        const parsed = new URL(normalized);
        return parsed.protocol === 'https:' && Boolean(parsed.hostname) && !parsed.username && !parsed.password;
    } catch (_) {
        return false;
    }
}

function isLocalUrl(value) {
    try {
        const parsed = new URL(String(value || ''));
        return ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname.toLowerCase());
    } catch (_) {
        return false;
    }
}

function isManagedHostname(hostname) {
    const normalized = normalizeText(hostname, 255).toLowerCase().replace(/^www\./u, '');
    return normalized === 'fatherkey.com'
        || normalized.endsWith('.fatherkey.com')
        || normalized === 'zaoyoe.xyz'
        || normalized.endsWith('.zaoyoe.xyz');
}

function buildCheck(area, key, ok, status, message, detail = {}) {
    const normalizedOk = ok === true;
    const blocking = detail.blocking === undefined ? !normalizedOk : detail.blocking === true;
    const severity = detail.severity || (blocking ? 'high' : 'info');
    const result = {
        area,
        key,
        ok: normalizedOk,
        status,
        severity,
        blocking,
        message
    };
    Object.entries(detail).forEach(([name, value]) => {
        if (!['blocking', 'severity'].includes(name)) result[name] = value;
    });
    return result;
}

function optionalCheck(area, key, message, detail = {}) {
    return buildCheck(area, key, true, 'optional_not_configured', message, {
        severity: 'info',
        blocking: false,
        ...detail
    });
}

function warningCheck(area, key, message, detail = {}) {
    return buildCheck(area, key, true, 'warning', message, {
        severity: detail.severity || 'medium',
        blocking: false,
        ...detail
    });
}

function manualCheck(area, key, message, detail = {}) {
    return buildCheck(area, key, true, 'manual_review', message, {
        severity: detail.severity || 'high',
        blocking: false,
        requires_manual_review: true,
        ...detail
    });
}

function invalidCheck(area, key, message, detail = {}) {
    return buildCheck(area, key, false, 'invalid', message, {
        severity: detail.severity || 'high',
        blocking: true,
        ...detail
    });
}

function inspectRuntime(env = {}) {
    const markers = productionMarkers(env);
    const production = markers.some((entry) => entry.value === 'production');
    const unknown = markers.length === 0;
    const conflicting = new Set(markers.map((entry) => entry.value)).size > 1;

    if (unknown) {
        return warningCheck(
            'runtime',
            'production-marker',
            '未检测到 production 环境标识；仅可作为本地/预发布检查，不能据此放行生产游客购买。',
            { production_like: false, markers, requires_manual_review: true }
        );
    }

    if (!production) {
        return warningCheck(
            'runtime',
            'production-marker',
            '当前不是 production-like 环境；生产专用密钥检查按非生产模式处理。',
            { production_like: false, markers }
        );
    }

    return buildCheck(
        'runtime',
        'production-marker',
        true,
        conflicting ? 'configured_with_conflict' : 'configured',
        conflicting
            ? '已识别 production，但环境标识彼此不一致；请核对部署平台变量。'
            : '已识别 production-like 运行环境。',
        { production_like: true, markers, severity: conflicting ? 'medium' : 'info', blocking: false }
    );
}

function inspectEnvFile(envFile = '', env = {}) {
    const filePath = String(envFile || '').trim();
    if (!filePath) return optionalCheck('runtime', 'env-file', '未指定环境文件，使用进程环境变量。');
    if (!fs.existsSync(filePath)) {
        return warningCheck('runtime', 'env-file', '环境文件不存在；将只使用进程环境变量。', {
            path: filePath,
            severity: 'medium'
        });
    }
    try {
        fs.accessSync(filePath, fs.constants.R_OK);
        return buildCheck('runtime', 'env-file', true, 'readable', '环境文件可读，未输出其中的敏感值。', {
            path: filePath,
            blocking: false,
            severity: 'info'
        });
    } catch (_) {
        return invalidCheck('runtime', 'env-file', '环境文件存在但不可读。', { path: filePath });
    }
}

function inspectSupabase(env, production) {
    const url = firstEnvValue(env, ['SUPABASE_URL']);
    const key = firstEnvValue(env, ['SUPABASE_SERVICE_ROLE_KEY']);
    const checks = [];

    if (!url.value) {
        checks.push(production
            ? invalidCheck('env', 'supabase-url', '生产环境缺少 SUPABASE_URL。', { env_name: 'SUPABASE_URL' })
            : optionalCheck('env', 'supabase-url', '未配置 SUPABASE_URL（非生产环境）。', { env_name: 'SUPABASE_URL' }));
    } else {
        let valid = false;
        let local = false;
        try {
            const parsed = new URL(url.value);
            valid = Boolean(parsed.hostname) && !parsed.username && !parsed.password
                && (parsed.protocol === 'https:' || (!production && parsed.protocol === 'http:'));
            local = isLocalUrl(url.value);
        } catch (_) {
            valid = false;
        }
        checks.push(valid
            ? buildCheck('env', 'supabase-url', true, 'configured', production || !local
                ? 'SUPABASE_URL 格式正确。'
                : 'SUPABASE_URL 使用本地 HTTP（仅适用于非生产）。', { env_name: 'SUPABASE_URL', host: new URL(url.value).hostname, blocking: false, severity: 'info' })
            : invalidCheck('env', 'supabase-url', production
                ? '生产环境 SUPABASE_URL 必须是无凭据的 HTTPS URL。'
                : 'SUPABASE_URL 不是有效 URL。', { env_name: 'SUPABASE_URL' }));
    }

    if (!key.value) {
        checks.push(production
            ? invalidCheck('env', 'supabase-service-role-key', '生产环境缺少 SUPABASE_SERVICE_ROLE_KEY。', { env_name: 'SUPABASE_SERVICE_ROLE_KEY' })
            : optionalCheck('env', 'supabase-service-role-key', '未配置 SUPABASE_SERVICE_ROLE_KEY（非生产环境）。', { env_name: 'SUPABASE_SERVICE_ROLE_KEY' }));
    } else {
        checks.push(secretIsStrong(key.value, 16)
            ? buildCheck('env', 'supabase-service-role-key', true, 'configured', 'SUPABASE_SERVICE_ROLE_KEY 已配置（值已隐藏）。', { env_name: 'SUPABASE_SERVICE_ROLE_KEY', blocking: false, severity: 'info' })
            : invalidCheck('env', 'supabase-service-role-key', 'SUPABASE_SERVICE_ROLE_KEY 为空、占位值或强度不足。', { env_name: 'SUPABASE_SERVICE_ROLE_KEY' }));
    }

    return checks;
}

function inspectPepper(env, name, production, options = {}) {
    const value = envValue(env, name, 4096);
    const label = options.label || name;
    const minimumBytes = Number(options.minimumBytes) || 32;
    if (!value) {
        return production
            ? invalidCheck('secrets', name.toLowerCase(), `生产环境缺少 ${name}。`, { env_name: name })
            : optionalCheck('secrets', name.toLowerCase(), `未配置 ${name}（非生产环境）。`, { env_name: name });
    }
    if (!secretIsStrong(value, minimumBytes)) {
        return invalidCheck('secrets', name.toLowerCase(), `${label} 必须是至少 ${minimumBytes} 字节的非占位密钥。`, { env_name: name });
    }
    return buildCheck('secrets', name.toLowerCase(), true, 'configured', `${label} 已配置（值已隐藏）。`, {
        env_name: name,
        blocking: false,
        severity: 'info'
    });
}

function inspectGuestSecrets(env, production) {
    const checks = [
        inspectPepper(env, 'GUEST_SHOP_CLAIM_PEPPER', production, { label: '游客取货 pepper' }),
        inspectPepper(env, 'GUEST_SHOP_CLAIM_DERIVATION_PEPPER', production, { label: '游客取货派生 pepper' })
    ];
    const claim = envValue(env, 'GUEST_SHOP_CLAIM_PEPPER', 4096);
    const derivation = envValue(env, 'GUEST_SHOP_CLAIM_DERIVATION_PEPPER', 4096);
    const serviceRole = envValue(env, 'SUPABASE_SERVICE_ROLE_KEY', 4096);

    if (claim && derivation && claim === derivation) {
        checks.push(invalidCheck('secrets', 'claim-pepper-distinct', 'GUEST_SHOP_CLAIM_PEPPER 与 GUEST_SHOP_CLAIM_DERIVATION_PEPPER 必须使用不同密钥。', {
            env_name: 'GUEST_SHOP_CLAIM_PEPPER,GUEST_SHOP_CLAIM_DERIVATION_PEPPER'
        }));
    } else {
        checks.push(buildCheck('secrets', 'claim-pepper-distinct', true, 'configured', '两个游客 pepper 已通过不相同检查（值已隐藏）。', {
            blocking: false,
            severity: 'info'
        }));
    }

    if (claim && serviceRole && claim === serviceRole) {
        checks.push(invalidCheck('secrets', 'claim-pepper-not-service-role', '游客取货 pepper 不能复用 SUPABASE_SERVICE_ROLE_KEY。', {
            env_name: 'GUEST_SHOP_CLAIM_PEPPER,SUPABASE_SERVICE_ROLE_KEY'
        }));
    } else if (claim && serviceRole) {
        checks.push(buildCheck('secrets', 'claim-pepper-not-service-role', true, 'configured', '游客取货 pepper 未复用 service-role 密钥。', {
            blocking: false,
            severity: 'info'
        }));
    }

    if (derivation && serviceRole && derivation === serviceRole) {
        checks.push(invalidCheck('secrets', 'derivation-pepper-not-service-role', '游客取货派生 pepper 不能复用 SUPABASE_SERVICE_ROLE_KEY。', {
            env_name: 'GUEST_SHOP_CLAIM_DERIVATION_PEPPER,SUPABASE_SERVICE_ROLE_KEY'
        }));
    } else if (derivation && serviceRole) {
        checks.push(buildCheck('secrets', 'derivation-pepper-not-service-role', true, 'configured', '游客取货派生 pepper 未复用 service-role 密钥。', {
            blocking: false,
            severity: 'info'
        }));
    }

    // Dedicated contact/request peppers are recommended for blast-radius
    // separation. Existing runtime safely falls back to claim pepper, so a
    // missing dedicated value is a warning rather than an accidental outage.
    for (const name of ['GUEST_SHOP_CONTACT_HASH_PEPPER', 'GUEST_SHOP_REQUEST_HASH_PEPPER']) {
        const value = envValue(env, name, 4096);
        if (!value) {
            checks.push(warningCheck('secrets', name.toLowerCase(), `${name} 未配置；运行时会回退到 claim pepper，建议上线前使用独立密钥。`, {
                env_name: name,
                severity: production ? 'medium' : 'low'
            }));
            continue;
        }
        if (!secretIsStrong(value, 32) || value === claim || value === serviceRole) {
            checks.push(invalidCheck('secrets', name.toLowerCase(), `${name} 必须是独立且至少 32 字节的非占位密钥。`, { env_name: name }));
        } else {
            checks.push(buildCheck('secrets', name.toLowerCase(), true, 'configured', `${name} 已配置（值已隐藏）。`, {
                env_name: name,
                blocking: false,
                severity: 'info'
            }));
        }
    }

    return checks;
}

/**
 * Remove SQL comments while preserving string literals and dollar-quoted
 * function bodies.
 *
 * The prohibition checks below look for statements such as `DROP ... CASCADE`.
 * The migration header explains in prose that it drops WITHOUT cascade, so a
 * naive regex over the raw file reports a false violation. Prose must never be
 * able to fail a gate, and neither must a comment be able to satisfy one, so
 * every structural pattern runs against the comment-stripped source.
 */
function readRepoFile(repoRoot = REPO_ROOT, relativePath = '') {
    if (!relativePath) return '';
    try {
        return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
    } catch (_) {
        return '';
    }
}

function stripSqlComments(source = '') {
    const text = String(source || '');
    let out = '';
    let index = 0;
    let inSingleQuote = false;
    let dollarTag = '';
    while (index < text.length) {
        const ch = text[index];
        if (dollarTag) {
            if (text.startsWith(dollarTag, index)) {
                out += dollarTag;
                index += dollarTag.length;
                dollarTag = '';
                continue;
            }
            out += ch;
            index += 1;
            continue;
        }
        if (inSingleQuote) {
            if (ch === "'") {
                if (text[index + 1] === "'") { out += "''"; index += 2; continue; }
                inSingleQuote = false;
            }
            out += ch;
            index += 1;
            continue;
        }
        if (ch === '-' && text.startsWith('--', index)) {
            const newline = text.indexOf('\n', index);
            index = newline < 0 ? text.length : newline;
            continue;
        }
        if (ch === '/' && text.startsWith('/*', index)) {
            const end = text.indexOf('*/', index + 2);
            index = end < 0 ? text.length : end + 2;
            out += ' ';
            continue;
        }
        if (ch === "'") { inSingleQuote = true; out += ch; index += 1; continue; }
        if (ch === '$') {
            const matched = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(text.slice(index, index + 80));
            if (matched) {
                dollarTag = matched[0];
                out += dollarTag;
                index += dollarTag.length;
                continue;
            }
        }
        out += ch;
        index += 1;
    }
    return out;
}

/**
 * Order Access 2.0 gate (docs/guest-shop-order-access-2.0.md §15.2).
 *
 * Two independent switches control this feature and BOTH default to off, so
 * the whole block is behaviour-neutral until an operator opts in:
 *
 *   GUEST_SHOP_BUYER_CREDENTIAL_ENABLED  collect + verify the query password
 *   GUEST_SHOP_GUEST_ORDERS_PAGE_ENABLED serve /guest-orders.html
 *
 * The page switch without the credential switch is invalid: it would publish
 * an order-lookup endpoint with no credential to check. The credential switch
 * without a dedicated GUEST_SHOP_CONTACT_HASH_PEPPER is also invalid, because
 * the runtime falls back to the claim pepper and a fallback that changes later
 * silently re-keys every stored contact_hash, making existing guest orders
 * permanently unreachable. That is a fail-closed rule, not a warning.
 */
function inspectBuyerCredentials(env, production, repoRoot = REPO_ROOT) {
    const checks = [];

    const parseSwitch = (name) => {
        const raw = envValue(env, name, 40);
        if (!raw) return { present: false, value: false };
        const parsed = parseBoolean(raw);
        return { present: true, value: parsed === true, parsed };
    };

    const credential = parseSwitch('GUEST_SHOP_BUYER_CREDENTIAL_ENABLED');
    const page = parseSwitch('GUEST_SHOP_GUEST_ORDERS_PAGE_ENABLED');

    if (credential.present && credential.parsed === null) {
        checks.push(invalidCheck('buyer_credentials', 'credential-switch-boolean', 'GUEST_SHOP_BUYER_CREDENTIAL_ENABLED 必须是布尔值；无法解析时按关闭处理会掩盖配置错误。', {
            env_name: 'GUEST_SHOP_BUYER_CREDENTIAL_ENABLED'
        }));
    } else if (credential.value) {
        checks.push(buildCheck('buyer_credentials', 'credential-switch-boolean', true, 'enabled', '游客邮箱 + 查询密码链路已显式启用；下方全部前置条件必须为真。', {
            env_name: 'GUEST_SHOP_BUYER_CREDENTIAL_ENABLED',
            blocking: false,
            severity: 'info',
            requires_manual_review: true
        }));
    } else {
        checks.push(optionalCheck('buyer_credentials', 'credential-switch-boolean', credential.present
            ? 'GUEST_SHOP_BUYER_CREDENTIAL_ENABLED 已显式关闭（等于现状）。'
            : '未设置 GUEST_SHOP_BUYER_CREDENTIAL_ENABLED；默认关闭，线上行为与现状一致。', {
            env_name: 'GUEST_SHOP_BUYER_CREDENTIAL_ENABLED'
        }));
    }

    if (page.present && page.parsed === null) {
        checks.push(invalidCheck('buyer_credentials', 'orders-page-switch-boolean', 'GUEST_SHOP_GUEST_ORDERS_PAGE_ENABLED 必须是布尔值。', {
            env_name: 'GUEST_SHOP_GUEST_ORDERS_PAGE_ENABLED'
        }));
    } else if (page.value && !credential.value) {
        checks.push(invalidCheck('buyer_credentials', 'orders-page-requires-credentials', '开启 /guest-orders.html 前必须先开启 GUEST_SHOP_BUYER_CREDENTIAL_ENABLED，否则查询页没有任何可校验的凭证。', {
            env_name: 'GUEST_SHOP_GUEST_ORDERS_PAGE_ENABLED,GUEST_SHOP_BUYER_CREDENTIAL_ENABLED'
        }));
    } else if (page.value) {
        checks.push(buildCheck('buyer_credentials', 'orders-page-requires-credentials', true, 'enabled', '游客订单查询页与凭证链路同时启用。', {
            env_name: 'GUEST_SHOP_GUEST_ORDERS_PAGE_ENABLED',
            blocking: false,
            severity: 'info',
            requires_manual_review: true
        }));
    } else {
        checks.push(optionalCheck('buyer_credentials', 'orders-page-requires-credentials', '未开启游客订单查询页（默认关闭）。', {
            env_name: 'GUEST_SHOP_GUEST_ORDERS_PAGE_ENABLED'
        }));
    }

    // §15.2-1: the contact pepper becomes mandatory (not advisory) the moment
    // credentials are collected, because contact_hash is the group key.
    if (credential.value) {
        const contact = envValue(env, 'GUEST_SHOP_CONTACT_HASH_PEPPER', 4096);
        const claim = envValue(env, 'GUEST_SHOP_CLAIM_PEPPER', 4096);
        const serviceRole = envValue(env, 'SUPABASE_SERVICE_ROLE_KEY', 4096);
        if (!contact) {
            checks.push(invalidCheck('buyer_credentials', 'contact-pepper-required', '启用游客查询密码后必须显式配置 GUEST_SHOP_CONTACT_HASH_PEPPER；回退到 claim pepper 会在 pepper 变更时让全部历史 contact_hash 失效、游客订单永久查不到。', {
                env_name: 'GUEST_SHOP_CONTACT_HASH_PEPPER'
            }));
        } else if (!secretIsStrong(contact, 32) || contact === claim || contact === serviceRole) {
            checks.push(invalidCheck('buyer_credentials', 'contact-pepper-required', 'GUEST_SHOP_CONTACT_HASH_PEPPER 必须是独立且至少 32 字节的非占位密钥。', {
                env_name: 'GUEST_SHOP_CONTACT_HASH_PEPPER'
            }));
        } else {
            checks.push(buildCheck('buyer_credentials', 'contact-pepper-required', true, 'configured', 'GUEST_SHOP_CONTACT_HASH_PEPPER 已配置为独立强密钥（值已隐藏）。', {
                env_name: 'GUEST_SHOP_CONTACT_HASH_PEPPER',
                blocking: false,
                severity: 'info'
            }));
        }

        for (const relativePath of BUYER_CREDENTIAL_FRONTEND_FILES) {
            checks.push(fs.existsSync(path.join(repoRoot, relativePath))
                ? buildCheck('buyer_credentials', `frontend:${relativePath}`, true, 'present', `${relativePath} 已存在。`, {
                    relative_path: relativePath,
                    blocking: false,
                    severity: 'info'
                })
                : invalidCheck('buyer_credentials', `frontend:${relativePath}`, `启用凭证链路后 ${relativePath} 必须存在（A2 交付物）。`, { relative_path: relativePath }));
        }
    }

    for (const name of BUYER_CREDENTIAL_RUNTIME_SETTING_NAMES) {
        checks.push(inspectRuntimeNumericSetting(env, name, { production }));
    }

    // Step-up challenge must fire BEFORE the lockout, otherwise the captcha
    // threshold is dead configuration and the operator believes they have
    // protection they do not. Mirrors the webhook-limit-order invariant above.
    const numeric = (name) => parseRuntimeNumericSetting(env, name);
    const captchaPairs = [
        ['buyer-captcha-before-lockout', 'GUEST_SHOP_BUYER_CAPTCHA_BUYER_THRESHOLD', 'GUEST_SHOP_BUYER_LOGIN_MAX_FAILURES', '买家'],
        ['buyer-captcha-ip-before-lockout', 'GUEST_SHOP_BUYER_CAPTCHA_IP_THRESHOLD', 'GUEST_SHOP_BUYER_IP_MAX_FAILURES', 'IP']
    ];
    for (const [key, captchaName, lockName, scope] of captchaPairs) {
        const captcha = numeric(captchaName);
        const lock = numeric(lockName);
        if (!captcha.valid || !lock.valid) {
            checks.push(invalidCheck('buyer_credentials', key, `${scope}验证码阈值与锁定阈值无法比较，请先修正数值配置。`, {
                env_name: `${captchaName},${lockName}`
            }));
            continue;
        }
        if (captcha.value >= lock.value) {
            checks.push(invalidCheck('buyer_credentials', key, `${scope}验证码阈值（${captchaName}=${captcha.value}）必须小于锁定阈值（${lockName}=${lock.value}），否则账号会先被锁定、验证码永远不触发。`, {
                env_name: `${captchaName},${lockName}`,
                captcha_threshold: captcha.value,
                lock_threshold: lock.value
            }));
        } else {
            checks.push(buildCheck('buyer_credentials', key, true, 'consistent', `${scope}验证码阈值 ${captcha.value} 早于锁定阈值 ${lock.value} 触发。`, {
                env_name: `${captchaName},${lockName}`,
                blocking: false,
                severity: 'info'
            }));
        }
    }

    // §15.2-2..6 are database facts. This script never connects to a database,
    // so it proves what it can from the migration file on disk and turns the
    // rest into an explicit operator check against the paired verify script.
    const read = (relativePath) => {
        try { return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'); } catch (_) { return ''; }
    };
    const rawMigration = read(BUYER_CREDENTIAL_MIGRATION);
    const rawVerify = read(BUYER_CREDENTIAL_VERIFY_MIGRATION);
    const migration = stripSqlComments(rawMigration);
    const verify = stripSqlComments(rawVerify);

    if (!rawMigration) {
        checks.push(invalidCheck('buyer_credentials', 'migration-file', `${BUYER_CREDENTIAL_MIGRATION} 缺失；guest_shop_buyers / buyer_id 无法在目标库建立。`, {
            relative_path: BUYER_CREDENTIAL_MIGRATION
        }));
    } else {
        checks.push(buildCheck('buyer_credentials', 'migration-file', true, 'present', `${BUYER_CREDENTIAL_MIGRATION} 已存在。`, {
            relative_path: BUYER_CREDENTIAL_MIGRATION,
            blocking: false,
            severity: 'info'
        }));
        for (const [key, pattern, label] of BUYER_CREDENTIAL_MIGRATION_REQUIREMENTS) {
            checks.push(pattern.test(migration)
                ? buildCheck('buyer_credentials', `migration:${key}`, true, 'present', `迁移已包含${label}。`, {
                    relative_path: BUYER_CREDENTIAL_MIGRATION,
                    blocking: false,
                    severity: 'info'
                })
                : invalidCheck('buyer_credentials', `migration:${key}`, `迁移缺少${label}。`, { relative_path: BUYER_CREDENTIAL_MIGRATION }));
        }
        for (const [key, pattern, label] of BUYER_CREDENTIAL_MIGRATION_PROHIBITIONS) {
            checks.push(pattern.test(migration)
                ? invalidCheck('buyer_credentials', `migration:${key}`, `迁移违反约束：${label}。`, { relative_path: BUYER_CREDENTIAL_MIGRATION })
                : buildCheck('buyer_credentials', `migration:${key}`, true, 'absent', `迁移未违反约束：${label}。`, {
                    relative_path: BUYER_CREDENTIAL_MIGRATION,
                    blocking: false,
                    severity: 'info'
                }));
        }
    }

    if (!rawVerify) {
        checks.push(invalidCheck('buyer_credentials', 'verify-migration-file', `${BUYER_CREDENTIAL_VERIFY_MIGRATION} 缺失；无法在目标库验证 A0 迁移结果。`, {
            relative_path: BUYER_CREDENTIAL_VERIFY_MIGRATION
        }));
    } else {
        for (const [key, pattern, label] of BUYER_CREDENTIAL_VERIFY_REQUIREMENTS) {
            checks.push(pattern.test(verify)
                ? buildCheck('buyer_credentials', `verify:${key}`, true, 'present', `verify 脚本已包含${label}。`, {
                    relative_path: BUYER_CREDENTIAL_VERIFY_MIGRATION,
                    blocking: false,
                    severity: 'info'
                })
                : invalidCheck('buyer_credentials', `verify:${key}`, `verify 脚本缺少${label}。`, { relative_path: BUYER_CREDENTIAL_VERIFY_MIGRATION }));
        }
        for (const [key, pattern, label] of BUYER_CREDENTIAL_VERIFY_PROHIBITIONS) {
            checks.push(pattern.test(verify)
                ? invalidCheck('buyer_credentials', `verify:${key}`, `verify 脚本违反约束：${label}。`, { relative_path: BUYER_CREDENTIAL_VERIFY_MIGRATION })
                : buildCheck('buyer_credentials', `verify:${key}`, true, 'absent', `verify 脚本未违反约束：${label}。`, {
                    relative_path: BUYER_CREDENTIAL_VERIFY_MIGRATION,
                    blocking: false,
                    severity: 'info'
                }));
        }
    }

    // -----------------------------------------------------------------------
    // Order Access 2.0 (A1b): atomic credential-group allocation RPC. Same
    // contract as A0 — prove statically what the file on disk can prove, and
    // turn the rest into an explicit operator step against the paired verify
    // script. These run regardless of the enable switch: a malformed migration
    // on disk is a release blocker even while the feature stays off.
    // -----------------------------------------------------------------------
    const rawUpsert = read(BUYER_GROUP_UPSERT_MIGRATION);
    const rawUpsertVerify = read(BUYER_GROUP_UPSERT_VERIFY_MIGRATION);
    const upsert = stripSqlComments(rawUpsert);
    const upsertVerify = stripSqlComments(rawUpsertVerify);

    if (!rawUpsert) {
        checks.push(invalidCheck('buyer_credentials', 'upsert-migration-file', `${BUYER_GROUP_UPSERT_MIGRATION} 缺失；凭证分组无法原子分配，启用凭证链路后会退化为有竞态的多次往返。`, {
            relative_path: BUYER_GROUP_UPSERT_MIGRATION
        }));
    } else {
        checks.push(buildCheck('buyer_credentials', 'upsert-migration-file', true, 'present', `${BUYER_GROUP_UPSERT_MIGRATION} 已存在。`, {
            relative_path: BUYER_GROUP_UPSERT_MIGRATION,
            blocking: false,
            severity: 'info'
        }));
        for (const [key, pattern, label] of BUYER_GROUP_UPSERT_MIGRATION_REQUIREMENTS) {
            checks.push(pattern.test(upsert)
                ? buildCheck('buyer_credentials', `upsert-migration:${key}`, true, 'present', `A1b 迁移已包含${label}。`, {
                    relative_path: BUYER_GROUP_UPSERT_MIGRATION,
                    blocking: false,
                    severity: 'info'
                })
                : invalidCheck('buyer_credentials', `upsert-migration:${key}`, `A1b 迁移缺少${label}。`, { relative_path: BUYER_GROUP_UPSERT_MIGRATION }));
        }
        for (const [key, pattern, label] of BUYER_GROUP_UPSERT_MIGRATION_PROHIBITIONS) {
            checks.push(pattern.test(upsert)
                ? invalidCheck('buyer_credentials', `upsert-migration:${key}`, `A1b 迁移违反约束：${label}。`, { relative_path: BUYER_GROUP_UPSERT_MIGRATION })
                : buildCheck('buyer_credentials', `upsert-migration:${key}`, true, 'absent', `A1b 迁移未违反约束：${label}。`, {
                    relative_path: BUYER_GROUP_UPSERT_MIGRATION,
                    blocking: false,
                    severity: 'info'
                }));
        }
    }

    if (!rawUpsertVerify) {
        checks.push(invalidCheck('buyer_credentials', 'upsert-verify-migration-file', `${BUYER_GROUP_UPSERT_VERIFY_MIGRATION} 缺失；无法在目标库验证 A1b upsert 函数。`, {
            relative_path: BUYER_GROUP_UPSERT_VERIFY_MIGRATION
        }));
    } else {
        for (const [key, pattern, label] of BUYER_GROUP_UPSERT_VERIFY_REQUIREMENTS) {
            checks.push(pattern.test(upsertVerify)
                ? buildCheck('buyer_credentials', `upsert-verify:${key}`, true, 'present', `A1b verify 脚本已包含${label}。`, {
                    relative_path: BUYER_GROUP_UPSERT_VERIFY_MIGRATION,
                    blocking: false,
                    severity: 'info'
                })
                : invalidCheck('buyer_credentials', `upsert-verify:${key}`, `A1b verify 脚本缺少${label}。`, { relative_path: BUYER_GROUP_UPSERT_VERIFY_MIGRATION }));
        }
        for (const [key, pattern, label] of BUYER_GROUP_UPSERT_VERIFY_PROHIBITIONS) {
            checks.push(pattern.test(upsertVerify)
                ? invalidCheck('buyer_credentials', `upsert-verify:${key}`, `A1b verify 脚本违反约束：${label}。`, { relative_path: BUYER_GROUP_UPSERT_VERIFY_MIGRATION })
                : buildCheck('buyer_credentials', `upsert-verify:${key}`, true, 'absent', `A1b verify 脚本未违反约束：${label}。`, {
                    relative_path: BUYER_GROUP_UPSERT_VERIFY_MIGRATION,
                    blocking: false,
                    severity: 'info'
                }));
        }
    }

    checks.push(manualCheck('buyer_credentials', 'upsert-schema-applied', `必须在目标 Supabase 中、于 ${BUYER_CREDENTIAL_MIGRATION} 之后执行 ${BUYER_GROUP_UPSERT_MIGRATION}，并运行 ${BUYER_GROUP_UPSERT_VERIFY_MIGRATION} 确认 6 项检查全部 PASS（函数唯一重载、签名、SECURITY DEFINER/search_path、仅 service_role 可执行、body 不变量、A1b 纯增量）。本脚本不连接数据库。`, {
        relative_path: BUYER_GROUP_UPSERT_VERIFY_MIGRATION,
        severity: credential.value ? 'critical' : 'high'
    }));

    checks.push(manualCheck('buyer_credentials', 'database-schema-applied', `必须在目标 Supabase 中执行 ${BUYER_CREDENTIAL_MIGRATION}，并运行 ${BUYER_CREDENTIAL_VERIFY_MIGRATION} 确认 11 项检查全部 PASS（含 RLS 收口、create_order RPC 属于已知签名时代【A0=13 参 / 20260923 L1L2=15 参】、旧 12 参数签名已消失）。本脚本不连接数据库。`, {
        relative_path: BUYER_CREDENTIAL_VERIFY_MIGRATION,
        severity: credential.value ? 'critical' : 'high'
    }));
    checks.push(manualCheck('buyer_credentials', 'access-attempt-purge', `guest_shop_access_attempts 的 ${parseRuntimeNumericSetting(env, 'GUEST_SHOP_BUYER_ACCESS_AUDIT_RETENTION_DAYS').value} 天清理由运维调度，迁移不会创建定时任务；启用凭证链路前必须确认清理方式已落地。`, {
        severity: 'medium'
    }));

    return checks;
}

/**
 * Promo L1/L2 gate (docs/guest-shop-promo-hardening-plan.md §12.4).
 *
 * L1 (guest quantity > 1 with tiered/flash pricing) and L2 (guest discount
 * codes) are shipped in one batch because splitting them produces a priced
 * quote the order cannot honour - i.e. `amount_mismatch`, paid-but-undelivered.
 * Both stay OFF by default, so this whole block is behaviour-neutral until an
 * operator opts in AND opens the paired database row.
 *
 * Fail-closed rules asserted here (exit code 2, INVALID):
 *   - an unparsable switch value (a typo must not silently read as OFF/ON),
 *   - GUEST_SHOP_DISCOUNT_ENABLED=true without GUEST_SHOP_BUYER_CREDENTIAL_ENABLED
 *     (the database refuses an unattributable discount: guest_discount_identity_required),
 *   - a quantity ceiling that disagrees with the database CHECK bound,
 *   - a promo migration/verify file that is missing or violates a static guard.
 *
 * Everything that can only be proven against a live database stays an explicit
 * operator check (exit code 3, NOT_READY): budget opened, breaker closed, dirty
 * coupon scan, per-SKU quantity ceilings, and archived sandbox evidence.
 */
function inspectPromo(env, production, repoRoot = REPO_ROOT) {
    const checks = [];

    // ---- L2 master switch -------------------------------------------------
    const discount = parseGuestDiscountSwitch(env);
    const credentialRaw = envValue(env, 'GUEST_SHOP_BUYER_CREDENTIAL_ENABLED', 40);
    const credentialEnabled = credentialRaw ? parseBoolean(credentialRaw) === true : false;

    if (discount.present && !discount.valid) {
        checks.push(invalidCheck('promo', 'discount-switch-boolean', `${GUEST_DISCOUNT_SWITCH} 必须是布尔值（1/true/yes/on 或 0/false/no/off）；无法解析的值必须报错而不是被当成关闭。`, {
            env_name: GUEST_DISCOUNT_SWITCH
        }));
    } else if (discount.enabled && !credentialEnabled) {
        checks.push(invalidCheck('promo', 'discount-requires-buyer-credentials', `开启 ${GUEST_DISCOUNT_SWITCH} 前必须先开启 GUEST_SHOP_BUYER_CREDENTIAL_ENABLED：折扣必须能归属到一个买家身份分组，否则数据库会以 guest_discount_identity_required 拒绝，前端却已经把券码收走了。`, {
            env_name: `${GUEST_DISCOUNT_SWITCH},GUEST_SHOP_BUYER_CREDENTIAL_ENABLED`
        }));
    } else if (discount.enabled) {
        checks.push(buildCheck('promo', 'discount-switch-boolean', true, 'enabled', `游客优惠码通道（L2）已显式启用；下方预算、熔断、脏券扫描全部必须为真。`, {
            env_name: GUEST_DISCOUNT_SWITCH,
            blocking: false,
            severity: 'info',
            requires_manual_review: true
        }));
    } else {
        checks.push(optionalCheck('promo', 'discount-switch-boolean', discount.present
            ? `${GUEST_DISCOUNT_SWITCH} 已显式关闭（等于现状）；提交的券码会被 403 guest_discount_disabled 拒绝，而不是被静默丢弃。`
            : `未设置 ${GUEST_DISCOUNT_SWITCH}；默认关闭，线上行为与现状一致。`, {
            env_name: GUEST_DISCOUNT_SWITCH
        }));
    }

    // ---- L1 quantity ceiling ---------------------------------------------
    for (const name of PROMO_RUNTIME_SETTING_NAMES) {
        checks.push(inspectRuntimeNumericSetting(env, name, { area: 'promo', production }));
    }

    const quantitySpec = GUEST_SHOP_RUNTIME_SETTINGS[GUEST_QUANTITY_SWITCH];
    const ceilingConsistent = Boolean(quantitySpec)
        && quantitySpec.max === GUEST_MAX_QUANTITY_CEILING
        && quantitySpec.min === 1
        && quantitySpec.defaultValue === 1;
    checks.push(ceilingConsistent
        ? buildCheck('promo', 'quantity-ceiling-consistent', true, 'consistent', `${GUEST_QUANTITY_SWITCH} 的 env 上限（max=${GUEST_MAX_QUANTITY_CEILING}, default=1）与 guest_shop_orders_quantity_check 的数据库硬顶一致；env 只能收紧、不能放宽。`, {
            env_name: GUEST_QUANTITY_SWITCH,
            database_ceiling: GUEST_MAX_QUANTITY_CEILING,
            blocking: false,
            severity: 'info'
        })
        : invalidCheck('promo', 'quantity-ceiling-consistent', `${GUEST_QUANTITY_SWITCH} 的运行时配置表与数据库硬顶 ${GUEST_MAX_QUANTITY_CEILING} 不一致；放宽 env 上限只会让下单在 CHECK 处失败，必须改迁移而不是改配置表。`, {
            env_name: GUEST_QUANTITY_SWITCH,
            database_ceiling: GUEST_MAX_QUANTITY_CEILING
        }));

    const operatorQuantity = resolveGuestMaxQuantity(env);
    if (operatorQuantity > 1) {
        checks.push(manualCheck('promo', 'quantity-inventory-gate', `${GUEST_QUANTITY_SWITCH}=${operatorQuantity} 已放开游客单笔多件（掏鸟蛋面）。启用前必须确认：单 SKU guest_max_quantity 已按需收紧、per-IP 未付款件数上限与库存占比闸生效、TTL 到期同时释放库存与归还券预算。有效上限仍是 min(env, sku.guest_max_quantity, product.guest_max_quantity, product.max_purchase_quantity, ${GUEST_MAX_QUANTITY_CEILING})，且 fn_guest_shop_create_order 会重算并拒绝越界值。`, {
            env_name: GUEST_QUANTITY_SWITCH,
            effective_value: operatorQuantity,
            severity: production ? 'high' : 'medium'
        }));
    } else {
        checks.push(buildCheck('promo', 'quantity-inventory-gate', true, 'default', `${GUEST_QUANTITY_SWITCH} 生效值为 1（P0 行为）：每单只预占一行库存，阶梯价最多只能命中 qty=1 规则。`, {
            env_name: GUEST_QUANTITY_SWITCH,
            effective_value: operatorQuantity,
            blocking: false,
            severity: 'info'
        }));
    }

    // ---- Client-side leak guard (static, cheap, always asserted) ----------
    // A discount code in a URL/query/storage key is a leaked code: it lands in
    // browser history, proxy logs and provider metadata. This is asserted here
    // as well as in the contract test so a release cannot ship it by accident.
    const clientSource = readRepoFile(repoRoot, GUEST_SHOP_CLIENT_FILE);
    if (!clientSource) {
        checks.push(invalidCheck('promo', 'client-file-present', `${GUEST_SHOP_CLIENT_FILE} 缺失；游客结账前端不可用。`, {
            relative_path: GUEST_SHOP_CLIENT_FILE
        }));
    } else {
        const leaks = PROMO_CLIENT_CODE_LEAK_PATTERNS.filter(([, pattern]) => pattern.test(clientSource));
        checks.push(leaks.length === 0
            ? buildCheck('promo', 'client-code-not-leaked', true, 'absent', `${GUEST_SHOP_CLIENT_FILE} 未把优惠码写入 URL/query/localStorage/sessionStorage。`, {
                relative_path: GUEST_SHOP_CLIENT_FILE,
                blocking: false,
                severity: 'info'
            })
            : invalidCheck('promo', 'client-code-not-leaked', `${GUEST_SHOP_CLIENT_FILE} 疑似把优惠码写入 ${leaks.map(([key]) => key).join(', ')}；优惠码只能出现在 POST body 中。`, {
                relative_path: GUEST_SHOP_CLIENT_FILE,
                matched: leaks.map(([key]) => key)
            }));
    }

    // ---- Migration / verify static assertions -----------------------------
    const read = (relativePath) => readRepoFile(repoRoot, relativePath);
    const rawMigration = read(PROMO_MIGRATION);
    const rawVerify = read(PROMO_VERIFY_MIGRATION);
    const migration = stripSqlComments(rawMigration);
    const verify = stripSqlComments(rawVerify);

    if (!rawMigration) {
        checks.push(invalidCheck('promo', 'migration-file', `${PROMO_MIGRATION} 缺失；游客阶梯价/闪购/优惠码没有任何数据库授权，L1+L2 不得发布。`, {
            relative_path: PROMO_MIGRATION
        }));
    } else {
        checks.push(buildCheck('promo', 'migration-file', true, 'present', `${PROMO_MIGRATION} 已存在。`, {
            relative_path: PROMO_MIGRATION,
            blocking: false,
            severity: 'info'
        }));
        for (const [key, pattern, label] of PROMO_MIGRATION_REQUIREMENTS) {
            checks.push(pattern.test(migration)
                ? buildCheck('promo', `migration:${key}`, true, 'present', `促销迁移已包含${label}。`, {
                    relative_path: PROMO_MIGRATION,
                    blocking: false,
                    severity: 'info'
                })
                : invalidCheck('promo', `migration:${key}`, `促销迁移缺少${label}。`, { relative_path: PROMO_MIGRATION }));
        }
        for (const [key, pattern, label] of PROMO_MIGRATION_PROHIBITIONS) {
            checks.push(pattern.test(migration)
                ? invalidCheck('promo', `migration:${key}`, `促销迁移违反约束：${label}。`, { relative_path: PROMO_MIGRATION })
                : buildCheck('promo', `migration:${key}`, true, 'absent', `促销迁移未违反约束：${label}。`, {
                    relative_path: PROMO_MIGRATION,
                    blocking: false,
                    severity: 'info'
                }));
        }
    }

    if (!rawVerify) {
        checks.push(invalidCheck('promo', 'verify-migration-file', `${PROMO_VERIFY_MIGRATION} 缺失；无法在目标库验证 L1/L2 迁移结果。`, {
            relative_path: PROMO_VERIFY_MIGRATION
        }));
    } else {
        for (const [key, pattern, label] of PROMO_VERIFY_REQUIREMENTS) {
            checks.push(pattern.test(verify)
                ? buildCheck('promo', `verify:${key}`, true, 'present', `促销 verify 脚本已包含${label}。`, {
                    relative_path: PROMO_VERIFY_MIGRATION,
                    blocking: false,
                    severity: 'info'
                })
                : invalidCheck('promo', `verify:${key}`, `促销 verify 脚本缺少${label}。`, { relative_path: PROMO_VERIFY_MIGRATION }));
        }
        for (const [key, pattern, label] of PROMO_VERIFY_PROHIBITIONS) {
            checks.push(pattern.test(verify)
                ? invalidCheck('promo', `verify:${key}`, `促销 verify 脚本违反约束：${label}。`, { relative_path: PROMO_VERIFY_MIGRATION })
                : buildCheck('promo', `verify:${key}`, true, 'absent', `促销 verify 脚本未违反约束：${label}。`, {
                    relative_path: PROMO_VERIFY_MIGRATION,
                    blocking: false,
                    severity: 'info'
                }));
        }
    }

    // ---- Database facts: explicit operator checks -------------------------
    // 23 行是 verify 脚本自己的行数，不能写成 PROMO_VERIFY_REQUIREMENTS.length：
    // 后者是本脚本对 verify 文本做的静态断言条数（现在 31 条），两者不是一回事，
    // 混用会让运维照着错误的数字去核对报告。
    checks.push(manualCheck('promo', 'promo-schema-applied', `必须在目标 Supabase 中、于 ${'supabase/migrations/20260922_guest_shop_access_resets.sql'} 之后执行 ${PROMO_MIGRATION}，并运行 ${PROMO_VERIFY_MIGRATION} 确认 23 行报告里第 1-22 行全部 PASS（含零元购地板、50% 折扣硬顶、促销函数唯一重载与仅 service_role 可执行、evaluate 只读、历史行满足新 CHECK、无副作用），第 23 行 operator_state_review 为 PASS 或 REVIEW：REVIEW 表示需要人工确认列出的游客商品/SKU/优惠码都是有意开启的，它不是迁移失败。Codex 不执行 SQL；本脚本不连接数据库。`, {
        relative_path: PROMO_VERIFY_MIGRATION,
        severity: discount.enabled ? 'critical' : 'high'
    }));

    checks.push(manualCheck('promo', 'promo-budget-opened', `L2 生效前必须把 guest_shop_promo_budget 目标站点行改为 enabled=true 且 daily_budget_cny>0（迁移种子是 cn/intl 双站 enabled=false、daily_budget=0）。未开预算时 gate 返回 guest_promo_budget_closed，游客只能按原价购买——这是有意的 fail-closed，不是故障。`, {
        severity: discount.enabled ? 'critical' : 'medium'
    }));

    checks.push(manualCheck('promo', 'promo-breaker-closed', `启用前确认 guest_shop_promo_breaker 单行为 state='closed'；存在 open 行即为 NOT_READY（readiness 退出码 3）。恢复只能人工执行 fn_guest_shop_promo_set_breaker('closed', actor, reason)，没有自动半开。`, {
        severity: discount.enabled ? 'critical' : 'medium'
    }));

    checks.push(manualCheck('promo', 'promo-dirty-coupon-scan', `只读脏券扫描：不得存在 allow_guest=true 且 (guest_max_uses=0 OR guest_max_total_discount<=0) 的券。按 §8.1，0 表示「关闭」而不是「无限」，所以「开了游客白名单却没给次数/金额预算」就是脏券；扫到任何一行都是 INVALID（readiness 退出码 2），必须先修券再启用。折扣率无需扫描：本批唯一的折扣率边界是 guest_shop_orders_amount_check 的 50% 硬顶，券表没有折扣率列。`, {
        severity: discount.enabled ? 'critical' : 'high'
    }));

    checks.push(manualCheck('promo', 'promo-sku-quantity-scan', `只读扫描：对 allow_guest_purchase=true 的商品/SKU，确认 COALESCE(sku.guest_max_quantity, product.guest_max_quantity, 1) 不超过运营预期的 ${operatorQuantity} 件，且 product.max_purchase_quantity 未被误设为大值。有效上限取三者与 ${GUEST_MAX_QUANTITY_CEILING} 的最小值，任何一处收紧都会生效。`, {
        env_name: GUEST_QUANTITY_SWITCH,
        effective_value: operatorQuantity,
        severity: operatorQuantity > 1 ? 'high' : 'medium'
    }));

    checks.push(manualCheck('promo', 'promo-parity-evidence', `L2/L3 必须同批发布：只有前端能报价、后端不认账会直接产生 amount_mismatch（已付款不发货）。启用前必须归档 ≥40 条黄金向量 parity 测试结果与 §15.4 沙箱实机证据到 docs/guest-shop-promo-evidence.md；没有实机证据不得宣称完成。任一阶段出现 amount_mismatch >= 1 立即回到全部开关关闭并跳闸。`, {
        relative_path: 'docs/guest-shop-promo-evidence.md',
        severity: discount.enabled ? 'critical' : 'high'
    }));

    return checks;
}

function inspectWorkerSecret(env, production) {
    const explicit = envValue(env, 'GUEST_SHOP_WORKER_SECRET', 4096);
    const fallback = firstEnvValue(env, ['GUEST_SHOP_CRON_SECRET', 'CRON_SECRET']);
    const serviceRole = envValue(env, 'SUPABASE_SERVICE_ROLE_KEY', 4096);
    if (!explicit) {
        if (fallback.value) {
            return invalidCheck('worker', 'worker-secret-explicit', '生产 worker 不能只依赖通用 GUEST_SHOP_CRON_SECRET/CRON_SECRET，必须配置专用 GUEST_SHOP_WORKER_SECRET。', {
                env_name: 'GUEST_SHOP_WORKER_SECRET',
                fallback_env_name: fallback.name
            });
        }
        return production
            ? invalidCheck('worker', 'worker-secret-explicit', '生产环境缺少 GUEST_SHOP_WORKER_SECRET。', { env_name: 'GUEST_SHOP_WORKER_SECRET' })
            : optionalCheck('worker', 'worker-secret-explicit', '未配置 GUEST_SHOP_WORKER_SECRET（非生产环境）。', { env_name: 'GUEST_SHOP_WORKER_SECRET' });
    }
    if (!secretIsStrong(explicit, 32)) {
        return invalidCheck('worker', 'worker-secret-strength', 'GUEST_SHOP_WORKER_SECRET 必须是至少 32 字节的非占位密钥。', { env_name: 'GUEST_SHOP_WORKER_SECRET' });
    }
    if (serviceRole && explicit === serviceRole) {
        return invalidCheck('worker', 'worker-secret-not-service-role', 'GUEST_SHOP_WORKER_SECRET 不能复用 SUPABASE_SERVICE_ROLE_KEY。', { env_name: 'GUEST_SHOP_WORKER_SECRET' });
    }
    return buildCheck('worker', 'worker-secret-explicit', true, 'configured', '已配置专用 GUEST_SHOP_WORKER_SECRET（值已隐藏）。', {
        env_name: 'GUEST_SHOP_WORKER_SECRET',
        blocking: false,
        severity: 'info'
    });
}

function strictInteger(value, name) {
    const raw = normalizeText(value, 80);
    if (!raw) return { present: false, valid: true, value: null };
    if (!/^\d+$/u.test(raw)) return { present: true, valid: false, value: null, reason: `${name} 必须是十进制整数` };
    const parsed = Number(raw);
    if (!Number.isSafeInteger(parsed)) return { present: true, valid: false, value: null, reason: `${name} 超出安全整数范围` };
    return { present: true, valid: true, value: parsed };
}

function inspectRuntimeNumericSetting(env, name, {
    area = 'limits',
    key,
    label,
    production
} = {}) {
    const spec = GUEST_SHOP_RUNTIME_SETTINGS[name];
    if (!spec) return invalidCheck(area, key || name, `${name} 不是受支持的游客运行时配置。`, { env_name: name });

    const parsed = parseRuntimeNumericSetting(env, name);
    const displayLabel = label || spec.label || name;
    if (!parsed.present) {
        return buildCheck(area, key || spec.key, true, 'default', `${name} 未设置，将使用安全默认值 ${spec.defaultValue}。`, {
            env_name: name,
            effective_value: spec.defaultValue,
            blocking: false,
            severity: production ? 'medium' : 'info'
        });
    }
    if (!parsed.valid) {
        const observed = Number.isFinite(parsed.value) ? parsed.value : undefined;
        const detail = {
            env_name: name,
            ...(observed === undefined ? {} : { observed }),
            min: spec.min,
            max: spec.max
        };
        // Keep the existing readiness convention for non-production range
        // tuning, while malformed syntax remains a hard failure everywhere.
        if (parsed.code === 'numeric_out_of_range' && !production) {
            return warningCheck(area, key || spec.key, `${displayLabel} 超出建议范围 ${spec.min}-${spec.max}（非生产环境）。`, {
                ...detail,
                severity: 'low'
            });
        }
        return invalidCheck(area, key || spec.key, parsed.reason || `${displayLabel} 配置无效。`, detail);
    }
    return buildCheck(area, key || spec.key, true, 'configured', `${displayLabel}=${parsed.value} 在建议范围内。`, {
        env_name: name,
        observed: parsed.value,
        min: spec.min,
        max: spec.max,
        blocking: false,
        severity: 'info'
    });
}

function inspectNumericSetting(env, {
    name,
    key,
    label,
    defaultValue,
    min,
    max,
    production
}) {
    // `defaultValue`/`min`/`max` are retained in this signature for callers
    // and documentation; the shared runtime-config table is canonical.
    return inspectRuntimeNumericSetting(env, name, { key, label, production });
}

function inspectLimits(env, production) {
    const checks = [
        inspectNumericSetting(env, {
            name: 'GUEST_SHOP_ORDER_TTL_SECONDS',
            key: 'order-ttl',
            label: '游客订单 TTL',
            defaultValue: 1800,
            min: 300,
            max: 7200,
            production
        }),
        inspectNumericSetting(env, {
            name: 'GUEST_SHOP_WEBHOOK_GLOBAL_LIMIT',
            key: 'webhook-global-limit',
            label: '游客 webhook 全局每分钟上限',
            defaultValue: 1200,
            min: 10,
            max: 100000,
            production
        }),
        inspectNumericSetting(env, {
            name: 'GUEST_SHOP_WEBHOOK_IP_LIMIT',
            key: 'webhook-ip-limit',
            label: '游客 webhook 单 IP 每分钟上限',
            defaultValue: 120,
            min: 5,
            max: 10000,
            production
        })
    ];

    // Worker settings are deployment-controlled too.  They govern how many
    // paid orders can be claimed/refunded in one pass and how quickly a
    // failed fulfillment is retried, so malformed values must be visible in
    // the same readiness report as the public HTTP limits.
    const workerSettings = [
        ['GUEST_SHOP_WORKER_BATCH_SIZE', 'worker-batch-size', '游客履约 Worker 批量大小'],
        ['GUEST_SHOP_WORKER_MAX_ATTEMPTS', 'worker-max-attempts', '游客履约最大重试次数'],
        ['GUEST_SHOP_WORKER_REFUND_MAX_ATTEMPTS', 'worker-refund-max-attempts', '游客退款最大重试次数'],
        ['GUEST_SHOP_WORKER_BASE_BACKOFF_MS', 'worker-base-backoff', '游客履约基础退避时间'],
        ['GUEST_SHOP_WORKER_MAX_BACKOFF_MS', 'worker-max-backoff', '游客履约最大退避时间'],
        ['GUEST_SHOP_WORKER_LEASE_MS', 'worker-lease', '游客履约租约时间'],
        ['GUEST_SHOP_WORKER_RETRY_JITTER_RATIO', 'worker-jitter-ratio', '游客履约重试抖动比例']
    ];
    for (const [name, key, label] of workerSettings) {
        checks.push(inspectRuntimeNumericSetting(env, name, { key, label, production }));
    }

    const global = parseRuntimeNumericSetting(env, 'GUEST_SHOP_WEBHOOK_GLOBAL_LIMIT');
    const ip = parseRuntimeNumericSetting(env, 'GUEST_SHOP_WEBHOOK_IP_LIMIT');
    const globalValue = global.valid ? global.value : null;
    const ipValue = ip.valid ? ip.value : null;
    if (global.valid && ip.valid && globalValue < ipValue) {
        checks.push(invalidCheck('limits', 'webhook-limit-order', 'GUEST_SHOP_WEBHOOK_GLOBAL_LIMIT 不能小于单 IP 上限。', {
            env_name: 'GUEST_SHOP_WEBHOOK_GLOBAL_LIMIT,GUEST_SHOP_WEBHOOK_IP_LIMIT',
            global_limit: globalValue,
            ip_limit: ipValue
        }));
    } else if (!global.valid || !ip.valid) {
        checks.push(invalidCheck('limits', 'webhook-limit-order', '游客 webhook 全局/单 IP 上限无法验证，请先修复数值配置。', {
            env_name: 'GUEST_SHOP_WEBHOOK_GLOBAL_LIMIT,GUEST_SHOP_WEBHOOK_IP_LIMIT',
            severity: 'high'
        }));
    } else {
        checks.push(buildCheck('limits', 'webhook-limit-order', true, 'consistent', '游客 webhook 全局/单 IP 上限关系正常。', {
            blocking: false,
            severity: 'info'
        }));
    }

    const workerBase = parseRuntimeNumericSetting(env, 'GUEST_SHOP_WORKER_BASE_BACKOFF_MS');
    const workerMax = parseRuntimeNumericSetting(env, 'GUEST_SHOP_WORKER_MAX_BACKOFF_MS');
    if (workerBase.valid && workerMax.valid && workerMax.value < workerBase.value) {
        checks.push(invalidCheck('limits', 'worker-backoff-order', 'GUEST_SHOP_WORKER_MAX_BACKOFF_MS 不能小于基础退避时间。', {
            env_name: 'GUEST_SHOP_WORKER_BASE_BACKOFF_MS,GUEST_SHOP_WORKER_MAX_BACKOFF_MS',
            base_backoff_ms: workerBase.value,
            max_backoff_ms: workerMax.value
        }));
    } else if (!workerBase.valid || !workerMax.valid) {
        checks.push(invalidCheck('limits', 'worker-backoff-order', 'Worker 最大/基础退避关系无法验证，请先修复数值配置。', {
            env_name: 'GUEST_SHOP_WORKER_BASE_BACKOFF_MS,GUEST_SHOP_WORKER_MAX_BACKOFF_MS',
            severity: 'high'
        }));
    } else {
        checks.push(buildCheck('limits', 'worker-backoff-order', true, 'consistent', 'Worker 最大/基础退避关系正常。', {
            blocking: false,
            severity: 'info'
        }));
    }

    // Payment creation lease uses the same canonical parser as the other
    // public limits.  Keep its historical key/message for operator scripts.
    checks.push(inspectRuntimeNumericSetting(env, 'GUEST_SHOP_PAYMENT_CREATE_LEASE_MS', {
        key: 'payment-create-lease',
        label: '支付创建租约',
        production
    }));

    return checks;
}

function inspectPersistentRateLimit(env, production) {
    const disabledRaw = envValue(env, 'DISABLE_PERSISTENT_RATE_LIMITS', 80);
    const disabled = parseBoolean(disabledRaw);
    const backendEntry = firstEnvValue(env, ['RATE_LIMIT_BACKEND', 'RATE_LIMIT_STORE']);
    const checks = [];

    if (disabled === true) {
        checks.push(production
            ? invalidCheck('rate_limit', 'persistent-disabled', '生产环境禁止 DISABLE_PERSISTENT_RATE_LIMITS=true。', { env_name: 'DISABLE_PERSISTENT_RATE_LIMITS' })
            : warningCheck('rate_limit', 'persistent-disabled', '持久化限流已禁用（仅适用于本地/测试）。', { env_name: 'DISABLE_PERSISTENT_RATE_LIMITS', severity: 'low' }));
    } else if (disabled === null && disabledRaw) {
        checks.push(invalidCheck('rate_limit', 'persistent-disabled', 'DISABLE_PERSISTENT_RATE_LIMITS 必须是布尔值。', { env_name: 'DISABLE_PERSISTENT_RATE_LIMITS' }));
    } else {
        checks.push(buildCheck('rate_limit', 'persistent-disabled', true, disabled === false ? 'enabled' : 'default', '未检测到禁用持久化限流的配置。', {
            env_name: 'DISABLE_PERSISTENT_RATE_LIMITS',
            blocking: false,
            severity: 'info'
        }));
    }

    if (!backendEntry.value) {
        checks.push(manualCheck('rate_limit', 'persistent-backend', '未显式指定限流后端；运行时默认尝试 Supabase 持久化 RPC，必须在目标数据库确认 take_rate_limit_tokens 可用。', {
            env_name: 'RATE_LIMIT_BACKEND,RATE_LIMIT_STORE'
        }));
    } else {
        const backend = backendEntry.value.toLowerCase();
        if (MEMORY_RATE_LIMIT_BACKENDS.has(backend)) {
            checks.push(production
                ? invalidCheck('rate_limit', 'persistent-backend', `生产环境不能使用内存限流后端 ${backend}。`, { env_name: backendEntry.name, observed: backend })
                : warningCheck('rate_limit', 'persistent-backend', `当前使用内存限流后端 ${backend}（仅适用于本地/测试）。`, { env_name: backendEntry.name, observed: backend, severity: 'low' }));
        } else if (!PERSISTENT_RATE_LIMIT_BACKENDS.has(backend)) {
            checks.push(production
                ? invalidCheck('rate_limit', 'persistent-backend', `无法识别的限流后端 ${backend}；生产必须明确使用持久化实现。`, { env_name: backendEntry.name, observed: backend })
                : warningCheck('rate_limit', 'persistent-backend', `无法识别的限流后端 ${backend}，请人工确认不会回退到内存。`, { env_name: backendEntry.name, observed: backend, severity: 'low' }));
        } else {
            checks.push(buildCheck('rate_limit', 'persistent-backend', true, 'configured', `已配置持久化限流后端 ${backend}；仍需确认对应 RPC/存储可用。`, {
                env_name: backendEntry.name,
                observed: backend,
                blocking: false,
                severity: 'info'
            }));
        }
    }

    checks.push(manualCheck('rate_limit', 'persistent-rpc', '必须在目标 Supabase 中确认 take_rate_limit_tokens RPC、权限和持久化表已存在；本脚本不连接数据库。', {
        rpc_name: 'take_rate_limit_tokens'
    }));
    return checks;
}

function parseProviderList(env) {
    const entry = firstEnvValue(env, [
        'GUEST_SHOP_ENABLED_PROVIDERS',
        'GUEST_SHOP_PAYMENT_PROVIDERS',
        'GUEST_SHOP_PROVIDERS'
    ]);
    if (!entry.value) return { name: '', values: [], invalid: [] };
    const values = entry.value.split(/[\s,;]+/u).map((value) => value.trim().toLowerCase()).filter(Boolean);
    const invalid = values.filter((value) => !SUPPORTED_PROVIDERS.includes(value));
    return { name: entry.name, values: [...new Set(values)], invalid };
}

function providerActivation(env, provider) {
    const list = parseProviderList(env);
    if (list.name) {
        return { explicit: true, enabled: list.values.includes(provider), source: list.name, invalid: list.invalid };
    }
    const candidates = [
        `GUEST_SHOP_${provider.toUpperCase()}_ENABLED`,
        `GUEST_SHOP_PROVIDER_${provider.toUpperCase()}_ENABLED`
    ];
    for (const name of candidates) {
        const raw = envValue(env, name, 80);
        if (!raw) continue;
        const parsed = parseBoolean(raw);
        return { explicit: true, enabled: parsed === true, source: name, invalid: parsed === null ? [raw] : [] };
    }
    return { explicit: false, enabled: false, source: '', invalid: list.invalid };
}

function inspectCallbackUrl(env, provider, production) {
    const name = provider === 'zpay' ? 'GUEST_SHOP_ZPAY_WEBHOOK_URL' : 'GUEST_SHOP_NOWPAYMENTS_WEBHOOK_URL';
    const value = envValue(env, name, 2000);
    const expectedPath = `/api/shop/guest/webhooks/${provider}`;
    if (!value) {
        return buildCheck('provider', `${provider}-callback-url`, true, 'derived_default', `未设置 ${name}；适配器将使用 canonical origin 自动生成 ${expectedPath}，需在支付平台后台核对最终 URL。`, {
            env_name: name,
            expected_path: expectedPath,
            blocking: false,
            severity: production ? 'medium' : 'info',
            requires_manual_review: true
        });
    }
    let parsed;
    try {
        parsed = new URL(value);
    } catch (_) {
        return invalidCheck('provider', `${provider}-callback-url`, `${name} 不是有效 URL。`, { env_name: name });
    }
    const pathMatches = parsed.pathname.replace(/\/+$/u, '') === expectedPath;
    const hostAllowed = isManagedHostname(parsed.hostname) || (!production && isLocalUrl(value));
    const protocolAllowed = parsed.protocol === 'https:' && !parsed.username && !parsed.password;
    if (!protocolAllowed || !pathMatches || !hostAllowed) {
        return invalidCheck('provider', `${provider}-callback-url`, `${name} 必须是受管域名上的 HTTPS ${expectedPath} URL。`, {
            env_name: name,
            expected_path: expectedPath,
            observed_host: parsed.hostname
        });
    }
    return buildCheck('provider', `${provider}-callback-url`, true, 'configured', `${name} 已配置为 HTTPS guest webhook URL。`, {
        env_name: name,
        expected_path: expectedPath,
        host: parsed.hostname,
        blocking: false,
        severity: 'info'
    });
}

function inspectProvider(env, provider, production) {
    const activation = providerActivation(env, provider);
    const checks = [];
    if (activation.invalid.length) {
        checks.push(invalidCheck('provider', `${provider}-activation`, `游客支付 provider 配置包含未知或非法值：${activation.invalid.join(', ')}。`, {
            env_name: activation.source || 'GUEST_SHOP_ENABLED_PROVIDERS'
        }));
    }

    const secretNames = provider === 'zpay'
        ? ['ZPAY_PKEY', 'ZPAY_KEY']
        : ['NOWPAYMENTS_API_KEY', 'NOWPAYMENTS_IPN_SECRET'];
    const values = secretNames.map((name) => ({ name, value: envValue(env, name, 4096) }));
    const configuredCount = values.filter((entry) => Boolean(entry.value)).length;
    const anyPlaceholder = values.some((entry) => entry.value && looksLikePlaceholderSecret(entry.value));

    if (provider === 'zpay') {
        const pkey = values.find((entry) => entry.value)?.value || '';
        const bothAliases = values.every((entry) => entry.value);
        if (bothAliases && values[0].value !== values[1].value) {
            checks.push(invalidCheck('provider', 'zpay-secret-alias', 'ZPAY_PKEY 与 ZPAY_KEY 同时存在但不一致；请只保留一个真实密钥。', { env_name: 'ZPAY_PKEY,ZPAY_KEY' }));
        } else if (pkey && (anyPlaceholder || !secretIsStrong(pkey, 16))) {
            checks.push(invalidCheck('provider', 'zpay-secret', 'ZPay 密钥为空、占位值或强度不足。', { env_name: 'ZPAY_PKEY/ZPAY_KEY' }));
        } else if (activation.enabled && !pkey) {
            checks.push(invalidCheck('provider', 'zpay-secret', '已显式启用 ZPay，但缺少 ZPAY_PKEY（或兼容别名 ZPAY_KEY）。', { env_name: 'ZPAY_PKEY/ZPAY_KEY' }));
        } else if (pkey) {
            checks.push(buildCheck('provider', 'zpay-secret', true, 'configured', 'ZPay 密钥已配置（值已隐藏）。', { env_name: 'ZPAY_PKEY/ZPAY_KEY', blocking: false, severity: 'info' }));
        } else {
            checks.push(activation.explicit && !activation.enabled
                ? optionalCheck('provider', 'zpay-secret', 'ZPay 未启用，未配置密钥。', { env_name: 'ZPAY_PKEY/ZPAY_KEY' })
                : manualCheck('provider', 'zpay-secret', 'ZPay 是否启用由后台/数据库配置决定；请人工确认并补齐 ZPAY_PKEY。', { env_name: 'ZPAY_PKEY/ZPAY_KEY' }));
        }
    } else {
        if (configuredCount > 0 && configuredCount < values.length) {
            checks.push(invalidCheck('provider', 'nowpayments-secret-pair', 'NOWPayments_API_KEY 与 NOWPAYMENTS_IPN_SECRET 必须同时配置，不能只配置一项。', { env_name: 'NOWPAYMENTS_API_KEY,NOWPAYMENTS_IPN_SECRET' }));
        } else if (anyPlaceholder || values.some((entry) => entry.value && !secretIsStrong(entry.value, 16))) {
            checks.push(invalidCheck('provider', 'nowpayments-secret-pair', 'NOWPayments 密钥为空、占位值或强度不足。', { env_name: 'NOWPAYMENTS_API_KEY,NOWPAYMENTS_IPN_SECRET' }));
        } else if (activation.enabled && configuredCount < values.length) {
            checks.push(invalidCheck('provider', 'nowpayments-secret-pair', '已显式启用 NOWPayments，但缺少 API Key 或 IPN Secret。', { env_name: 'NOWPAYMENTS_API_KEY,NOWPAYMENTS_IPN_SECRET' }));
        } else if (configuredCount === values.length) {
            checks.push(buildCheck('provider', 'nowpayments-secret-pair', true, 'configured', 'NOWPayments API Key 与 IPN Secret 均已配置（值已隐藏）。', { env_name: 'NOWPAYMENTS_API_KEY,NOWPAYMENTS_IPN_SECRET', blocking: false, severity: 'info' }));
        } else {
            checks.push(activation.explicit && !activation.enabled
                ? optionalCheck('provider', 'nowpayments-secret-pair', 'NOWPayments 未启用，未配置密钥。', { env_name: 'NOWPAYMENTS_API_KEY,NOWPAYMENTS_IPN_SECRET' })
                : manualCheck('provider', 'nowpayments-secret-pair', 'NOWPayments 是否启用由后台/数据库配置决定；请人工确认并补齐 API Key/IPN Secret。', { env_name: 'NOWPAYMENTS_API_KEY,NOWPAYMENTS_IPN_SECRET' }));
        }

        const currencyEntry = firstEnvValue(env, ['GUEST_SHOP_NOWPAYMENTS_PAY_CURRENCY', 'NOWPAYMENTS_PAY_CURRENCY']);
        if (currencyEntry.value && currencyEntry.value.toLowerCase() !== 'usdtbsc') {
            checks.push(invalidCheck('provider', 'nowpayments-network', '游客 NOWPayments 只允许 usdtbsc（USDT-BEP20 / BNB Smart Chain）。', { env_name: currencyEntry.name, observed: currencyEntry.value.toLowerCase() }));
        } else if (currencyEntry.value) {
            checks.push(buildCheck('provider', 'nowpayments-network', true, 'configured', 'NOWPayments 游客支付网络为 usdtbsc。', { env_name: currencyEntry.name, observed: 'usdtbsc', blocking: false, severity: 'info' }));
        } else {
            checks.push(manualCheck('provider', 'nowpayments-network', '未显式设置 NOWPayments pay_currency；适配器默认 usdtbsc，但必须在后台/数据库和支付平台核对网络。', { env_name: 'NOWPAYMENTS_PAY_CURRENCY', expected: 'usdtbsc' }));
        }
        checks.push(warningCheck('provider', 'nowpayments-refund', 'NOWPayments 游客退款当前需要人工核验收款地址和出款凭证，不能把自动退款当作已就绪。', { severity: 'high', requires_manual_review: true }));
    }

    checks.push(inspectCallbackUrl(env, provider, production));

    const allowlistName = provider === 'zpay' ? 'ZPAY_WEBHOOK_ALLOWED_IPS' : 'NOWPAYMENTS_WEBHOOK_ALLOWED_IPS';
    const trustedName = provider === 'zpay' ? 'ZPAY_WEBHOOK_TRUSTED_PROXIES' : 'NOWPAYMENTS_WEBHOOK_TRUSTED_PROXIES';
    const allowlist = envValue(env, allowlistName, 2000);
    const trusted = envValue(env, trustedName, 2000);
    if (production && activation.enabled && !allowlist) {
        checks.push(provider === 'nowpayments'
            ? invalidCheck('provider', `${provider}-ip-allowlist`, `生产已启用 ${provider}，必须配置 ${allowlistName}。`, { env_name: allowlistName })
            : warningCheck('provider', `${provider}-ip-allowlist`, `未配置 ${allowlistName}；ZPay 将退回严格查单模式，建议补充最小来源 IP 白名单。`, { env_name: allowlistName, severity: 'high', requires_manual_review: true }));
    } else if (activation.enabled && allowlist) {
        checks.push(buildCheck('provider', `${provider}-ip-allowlist`, true, 'configured', `${allowlistName} 已配置（不输出具体 IP）。`, { env_name: allowlistName, blocking: false, severity: 'info' }));
    } else {
        checks.push(optionalCheck('provider', `${provider}-ip-allowlist`, `${allowlistName} 未显式配置；provider 未确认启用。`, { env_name: allowlistName }));
    }
    if (production && activation.enabled && !trusted) {
        checks.push(warningCheck('provider', `${provider}-trusted-proxies`, `建议配置 ${trustedName}，并核对反向代理链；当前脚本不猜测代理 IP。`, { env_name: trustedName, severity: 'medium', requires_manual_review: true }));
    }

    if (!activation.explicit) {
        checks.push(manualCheck('provider', `${provider}-database-activation`, `${provider} 启用状态存储在后台/数据库；本脚本未连接数据库，请确认商品 allowlist、provider enabled、PID/回调等配置。`, {
            provider,
            config_source: 'database'
        }));
    } else if (activation.enabled) {
        checks.push(buildCheck('provider', `${provider}-activation`, true, 'enabled', `${provider} 已由 ${activation.source} 显式标记启用；仍需核对数据库中的 provider 配置。`, {
            env_name: activation.source,
            provider,
            blocking: false,
            severity: 'info',
            requires_manual_review: true
        }));
    } else {
        checks.push(optionalCheck('provider', `${provider}-activation`, `${provider} 已显式关闭。`, { env_name: activation.source, provider }));
    }

    return checks;
}

function inspectRepo(repoRoot = REPO_ROOT) {
    const checks = [];
    for (const relativePath of REQUIRED_REPO_FILES) {
        const exists = fs.existsSync(path.join(repoRoot, relativePath));
        checks.push(exists
            ? buildCheck('repo', `file:${relativePath}`, true, 'present', `${relativePath} 已存在。`, { relative_path: relativePath, blocking: false, severity: 'info' })
            : invalidCheck('repo', `file:${relativePath}`, `${relativePath} 缺失。`, { relative_path: relativePath }));
    }
    for (const relativePath of REQUIRED_TEST_FILES) {
        const exists = fs.existsSync(path.join(repoRoot, relativePath));
        checks.push(exists
            ? buildCheck('repo', `test:${relativePath}`, true, 'present', `${relativePath} 已存在。`, { relative_path: relativePath, blocking: false, severity: 'info' })
            : warningCheck('repo', `test:${relativePath}`, `${relativePath} 缺失；无法确认游客回归覆盖。`, { relative_path: relativePath, severity: 'high', requires_manual_review: true }));
    }

    const read = (relativePath) => {
        try { return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'); } catch (_) { return ''; }
    };
    const router = read('api/public.js');
    checks.push(router.includes("'guest/preview'")
        && router.includes("'guest/orders'")
        && router.includes("'guest/status'")
        && router.includes("'guest/recover'")
        && router.includes("'guest/claim'")
        && router.includes("'guest/webhooks/zpay'")
        && router.includes("'guest/webhooks/nowpayments'")
        ? buildCheck('repo', 'guest-routes-registered', true, 'present', '游客 preview/order/status/recover/claim 与 provider webhook 路由均已注册。', { blocking: false, severity: 'info' })
        : invalidCheck('repo', 'guest-routes-registered', 'api/public.js 未完整注册游客路由。'));

    const handler = read('server/api-handlers/public/guest-shop.js');
    checks.push(handler.includes('fn_guest_shop_create_order')
        && handler.includes('fn_guest_shop_confirm_payment')
        && handler.includes('readRawBodyWithLimit')
        && handler.includes('paymentAdapter')
        ? buildCheck('repo', 'guest-handler-security-boundary', true, 'present', '游客 handler 使用原子 RPC、原始 body 限制和独立 payment adapter。', { blocking: false, severity: 'info' })
        : invalidCheck('repo', 'guest-handler-security-boundary', '游客 handler 缺少独立支付/原始 body/原子 RPC 安全边界。'));

    const worker = read('server/guest-shop-worker.js');
    checks.push(worker.includes('fn_guest_shop_claim_fulfillment')
        && worker.includes('fn_guest_shop_release_expired_reservations')
        && worker.includes('GUEST_SHOP_WORKER_SECRET')
        ? buildCheck('repo', 'guest-worker-contract', true, 'present', '游客 worker 具备租约、履约与过期释放入口。', { blocking: false, severity: 'info' })
        : invalidCheck('repo', 'guest-worker-contract', '游客 worker 契约不完整。'));

    const adapter = read('api/_lib/payments/guest-shop-adapter.js');
    checks.push(adapter.includes("GUEST_PURPOSE = 'shop_direct'")
        && adapter.includes('NOWPAYMENTS_GUEST_PAY_CURRENCY')
        && adapter.includes('verifyGuestWebhook')
        ? buildCheck('repo', 'guest-payment-adapter-contract', true, 'present', '游客支付 adapter 与 shop_direct/USDT-BEP20 验证逻辑存在。', { blocking: false, severity: 'info' })
        : invalidCheck('repo', 'guest-payment-adapter-contract', '游客支付 adapter 契约不完整。'));

    let packageScripts = {};
    try {
        packageScripts = JSON.parse(read('package.json')).scripts || {};
    } catch (_) {
        packageScripts = {};
    }
    const readinessScript = String(packageScripts['readiness:guest-shop'] || '').trim();
    checks.push(readinessScript === 'node -- scripts/guest-shop-readiness.js'
        ? buildCheck('repo', 'guest-readiness-npm-script', true, 'present', 'readiness:guest-shop 使用 node -- 转发参数，避免 Node 25 把闸门参数当成运行时选项。', { blocking: false, severity: 'info' })
        : invalidCheck('repo', 'guest-readiness-npm-script', 'package.json 的 readiness:guest-shop 必须是 node -- scripts/guest-shop-readiness.js。'));

    const reconcileScript = String(packageScripts['reconcile:guest-shop'] || '').trim();
    checks.push(reconcileScript === 'node -- scripts/guest-shop-reconcile.js'
        ? buildCheck('repo', 'guest-reconcile-npm-script', true, 'present', 'reconcile:guest-shop 使用 node -- 转发参数。', { blocking: false, severity: 'info' })
        : invalidCheck('repo', 'guest-reconcile-npm-script', 'package.json 的 reconcile:guest-shop 必须是 node -- scripts/guest-shop-reconcile.js。'));

    const serverIndex = read('server/index.js');
    checks.push(serverIndex.includes('startGuestShopAlertSweep()')
        && serverIndex.includes("require('../api/_lib/guest-shop-alerts')")
        ? buildCheck('repo', 'guest-shop-alert-sweep-wired', true, 'present', 'verify server 已接线独立游客告警 sweep。', { blocking: false, severity: 'info' })
        : invalidCheck('repo', 'guest-shop-alert-sweep-wired', 'server/index.js 必须 import guest-shop-alerts 并调用 startGuestShopAlertSweep()。'));

    return checks;
}

function inspectRunbook(repoRoot = REPO_ROOT) {
    const relativePath = 'docs/guest-shop-payment-fulfillment-runbook.md';
    let source = '';
    try { source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'); } catch (_) { return [invalidCheck('docs', 'runbook', '游客支付运行手册缺失。', { relative_path: relativePath })]; }
    const requirements = [
        ['worker-endpoint', /\/api\/shop\/guest\/worker/i, 'worker endpoint'],
        ['worker-schedule', /cron|systemd|scheduler|调度|每分钟|1 分钟|1分钟/i, 'worker schedule'],
        ['worker-secret', /GUEST_SHOP_WORKER_SECRET/i, 'dedicated worker secret'],
        ['provider-console', /ZPay|NOWPayments|支付平台|控制台/i, 'provider console callback configuration'],
        ['nowpayments-manual-refund', /NOWPayments[\s\S]{0,240}(人工|手工|manual)[\s\S]{0,240}退款/i, 'NOWPayments manual refund'],
        ['dead-letter-alert', /dead[_ -]?letter|死信/i, 'dead-letter alert'],
        ['readiness-command', /readiness:guest-shop|guest-shop-readiness/i, 'readiness command'],
        ['readiness-strict-gate', /--fail-on-not-ready/i, 'strict readiness gate'],
        ['deploy-enable-separation', /发布不等于启用|不得打开游客商品|关闭游客/i, 'deploy does not enable guest products'],
        ['env-file-recreate', /docker compose up -d --no-deps --force-recreate --no-build verify-server/i, 'verify-server env_file recreate after secret changes'],
        ['no-docker-restart-reload', /docker restart[\s\S]{0,80}(不会重读|不会重新读取|does not reread|will not reread)/i, 'docker restart does not reload env_file'],
        ['stored-secret-preferred', /resolvePaymentProviderSecrets/i, 'payment stored secret preferred over env'],
        ['paid-unfulfilled-10m', /paid_unfulfilled_count[\s\S]{0,80}10\s*分钟/i, 'paid-unfulfilled 10 minute alert'],
        ['fulfillment-p95-p99', /P95\s*>\s*120[\s\S]{0,80}P99\s*>\s*300/i, 'fulfillment P95/P99 thresholds'],
        ['refund-hanging', /refund_pending_age_seconds[\s\S]{0,80}30\s*分钟[\s\S]{0,80}2\s*小时/i, 'refund hanging alert'],
        ['digital-goods-refund-policy', /数字商品退款与争议/i, 'digital goods refund policy'],
        ['privacy-retention-deletion', /HMAC[\s\S]{0,200}财务[\s\S]{0,200}(不删|保留)/i, 'privacy retention and deletion'],
        ['reconcile-command', /npm run reconcile:guest-shop/i, 'reconcile command'],
        ['independent-guest-alerts', /api\/_lib\/guest-shop-alerts\.js[\s\S]{0,240}guest_shop_monitor[\s\S]{0,240}shop_order_delivery/i, 'independent guest-shop-alerts not merged into shop_order_delivery']
    ];
    return requirements.map(([key, pattern, label]) => pattern.test(source)
        ? buildCheck('docs', `runbook:${key}`, true, 'documented', `运行手册已说明 ${label}。`, { relative_path: relativePath, blocking: false, severity: 'info' })
        : invalidCheck('docs', `runbook:${key}`, `运行手册缺少 ${label} 说明。`, { relative_path: relativePath }));
}

function inspectProductionCallbacks(env, production) {
    const checks = [];
    const baseEntry = firstEnvValue(env, ['APP_BASE_URL']);
    if (!baseEntry.value) {
        checks.push(production
            ? manualCheck('callback', 'app-base-url', '未显式设置 APP_BASE_URL；请核对生产 canonical origin 与两个站点回调地址。', { env_name: 'APP_BASE_URL' })
            : optionalCheck('callback', 'app-base-url', '未设置 APP_BASE_URL（非生产环境）。', { env_name: 'APP_BASE_URL' }));
    } else if (!isHttpsUrl(baseEntry.value) || (!isManagedHostname(new URL(baseEntry.value).hostname) && production)) {
        checks.push(invalidCheck('callback', 'app-base-url', '生产 APP_BASE_URL 必须是受管域名上的 HTTPS URL。', { env_name: 'APP_BASE_URL' }));
    } else {
        checks.push(buildCheck('callback', 'app-base-url', true, 'configured', 'APP_BASE_URL 使用受管 HTTPS origin。', { env_name: 'APP_BASE_URL', host: new URL(baseEntry.value).hostname, blocking: false, severity: 'info' }));
    }
    return checks;
}

function runReadiness({ env = process.env, repoRoot = REPO_ROOT, envFile = '', now = new Date() } = {}) {
    const production = isProductionLikeRuntime(env);
    const checks = [
        inspectEnvFile(envFile, env),
        inspectRuntime(env),
        ...inspectSupabase(env, production),
        ...inspectGuestSecrets(env, production),
        inspectWorkerSecret(env, production),
        ...inspectBuyerCredentials(env, production, repoRoot),
        ...inspectPromo(env, production, repoRoot),
        ...inspectPersistentRateLimit(env, production),
        ...inspectLimits(env, production),
        ...inspectProductionCallbacks(env, production),
        ...SUPPORTED_PROVIDERS.flatMap((provider) => inspectProvider(env, provider, production)),
        ...inspectRepo(repoRoot),
        ...inspectRunbook(repoRoot)
    ];

    const blockingChecks = checks.filter((check) => check.blocking === true && check.ok !== true);
    const warnings = checks.filter((check) => check.status === 'warning');
    const manualReview = checks.filter((check) => check.requires_manual_review === true);
    const findings = blockingChecks.map((check) => ({
        severity: check.severity || 'high',
        key: check.key,
        message: check.message,
        area: check.area,
        env_name: check.env_name || ''
    }));

    const checkedAt = now instanceof Date && Number.isFinite(now.getTime()) ? now.toISOString() : new Date().toISOString();
    return {
        checked_at: checkedAt,
        production_like: production,
        providers: SUPPORTED_PROVIDERS,
        checks,
        findings,
        warnings: warnings.map((check) => ({ key: check.key, message: check.message, severity: check.severity, area: check.area })),
        manual_review: manualReview.map((check) => ({ key: check.key, message: check.message, area: check.area })),
        invalid_count: blockingChecks.length,
        warning_count: warnings.length,
        manual_review_count: manualReview.length,
        // `ok` means automated checks found no hard-invalid values. `ready`
        // additionally requires a production marker and completion of all
        // operator/database checks, which cannot be proven offline.
        ok: blockingChecks.length === 0,
        ready: production && blockingChecks.length === 0 && manualReview.length === 0
    };
}

function formatHumanReport(summary = {}) {
    const lines = [
        'Guest Shop Production Readiness',
        '',
        `checked_at: ${summary.checked_at || ''}`,
        `production_like: ${summary.production_like === true ? 'true' : 'false'}`,
        ''
    ];
    for (const check of summary.checks || []) {
        const marker = check.ok ? (check.status === 'warning' || check.status === 'manual_review' ? '[WARN]' : '[OK]') : '[FAIL]';
        lines.push(`${marker} ${check.area}/${check.key}: ${check.message}`);
    }
    lines.push('');
    lines.push(summary.findings?.length ? 'findings:' : 'findings: none');
    for (const finding of summary.findings || []) {
        lines.push(`- [${finding.severity}] ${finding.key}: ${finding.message}`);
    }
    lines.push('');
    lines.push(`result: ${summary.ok === true ? 'PASS (automated)' : 'FAIL'}`);
    lines.push(`operational_ready: ${summary.ready === true ? 'true' : 'false; complete manual/database checks before enabling guest products'}`);
    lines.push(`manual_review_count: ${Number(summary.manual_review_count) || 0}`);
    return lines.join('\n');
}

/**
 * Resolve the process exit code for the optional strict CLI gates.
 *
 * `ok` only describes hard-invalid automated findings.  `ready` is the
 * stronger launch invariant and also requires a production marker plus zero
 * manual/database review items.  Preserve the historical code 2 for the
 * explicit `--fail-on-invalid` gate; code 3 identifies a strict readiness
 * failure when no hard-invalid finding took precedence.
 */
function getReadinessExitCode(options = {}, summary = {}) {
    if (options.failOnInvalid === true && summary.ok !== true) {
        return READINESS_EXIT_CODES.INVALID;
    }
    if (options.failOnNotReady === true && summary.ready !== true) {
        return READINESS_EXIT_CODES.NOT_READY;
    }
    return 0;
}

function main() {
    const options = parseArgs(process.argv.slice(2));
    const env = loadEnvFile(options.envFile, process.env);
    const summary = runReadiness({ env, repoRoot: REPO_ROOT, envFile: options.envFile });
    process.stdout.write(`${options.json ? JSON.stringify(summary, null, 2) : formatHumanReport(summary)}\n`);
    const exitCode = getReadinessExitCode(options, summary);
    if (exitCode > 0) process.exitCode = exitCode;
}

if (require.main === module) {
    try {
        main();
    } catch (error) {
        // Do not echo arbitrary parser/env contents; only expose a generic
        // failure line suitable for CI logs.
        console.error(`guest-shop-readiness failed: ${error?.message || 'unknown error'}`);
        process.exitCode = 1;
    }
}

module.exports = {
    DEFAULT_ENV_FILE,
    READINESS_EXIT_CODES,
    PROMO_MIGRATION,
    PROMO_MIGRATION_PROHIBITIONS,
    PROMO_MIGRATION_REQUIREMENTS,
    PROMO_VERIFY_MIGRATION,
    PROMO_VERIFY_PROHIBITIONS,
    PROMO_VERIFY_REQUIREMENTS,
    REQUIRED_REPO_FILES,
    REQUIRED_TEST_FILES,
    SUPPORTED_PROVIDERS,
    formatHumanReport,
    getReadinessExitCode,
    inspectBuyerCredentials,
    inspectCallbackUrl,
    inspectGuestSecrets,
    inspectLimits,
    inspectPersistentRateLimit,
    inspectProductionCallbacks,
    inspectPromo,
    inspectProvider,
    inspectRepo,
    inspectRunbook,
    inspectSupabase,
    inspectWorkerSecret,
    isProductionLikeRuntime,
    loadEnvFile,
    parseArgs,
    parseProviderList,
    runReadiness,
    stripSqlComments
};
