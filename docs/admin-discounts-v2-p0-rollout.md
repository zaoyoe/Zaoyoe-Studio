# Admin Discounts V2 P0 Rollout

## Scope

This rollout covers:

- discount lifecycle fields and status semantics
- order-side discount snapshots
- refund-side discount usage restoration bookkeeping
- risk auto-restore / observation support
- Admin Studio P0 state visibility

## SQL Execution Order

Run these in order:

1. [20260409_discount_v2_p0_lifecycle_snapshot_refund.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260409_discount_v2_p0_lifecycle_snapshot_refund.sql)
2. [20260409_discount_v2_p0_reconcile_usage_counts.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260409_discount_v2_p0_reconcile_usage_counts.sql)

The second script is the companion reconciliation pass. It is strongly recommended if the environment already has historical refunded discount orders, because old `used_count` values may still reflect gross historical usage instead of net active usage.

## Expected Outcomes

After rollout:

- `discount_codes` supports `starts_at`, lifecycle state, recovery policy, observation windows, and versioning.
- `shop_orders` stores `discount_snapshot`, `discount_version`, `discount_usage_restored`, and `discount_refund_amount`.
- `fn_validate_discount_code` rejects not-yet-started, risk-paused, and manually-paused coupons with clearer semantics.
- `fn_purchase_shop_item` stores an immutable discount snapshot per successful discounted order.
- `fn_admin_refund_order` restores discount usage counts for newly refunded discounted orders.
- `discount_codes.used_count` is reconciled to net non-refunded discounted orders.

## Post-SQL Verification Queries

### 1. Check new discount columns exist

```sql
select
  column_name,
  data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'discount_codes'
  and column_name in (
    'starts_at',
    'lifecycle_status',
    'status_reason',
    'version_no',
    'recovery_strategy',
    'observation_window_hours',
    'observation_ends_at',
    'last_paused_at',
    'last_restored_at'
  )
order by column_name;
```

### 2. Check new shop order columns exist

```sql
select
  column_name,
  data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'shop_orders'
  and column_name in (
    'discount_snapshot',
    'discount_version',
    'discount_usage_restored',
    'discount_refund_amount'
  )
order by column_name;
```

### 3. Check lifecycle distribution

```sql
select
  lifecycle_status,
  count(*) as coupon_count
from public.discount_codes
group by lifecycle_status
order by lifecycle_status;
```

### 4. Check discount orders missing snapshots

```sql
select count(*) as missing_snapshot_count
from public.shop_orders
where nullif(btrim(coalesce(discount_code, '')), '') is not null
  and coalesce(discount_amount, 0) > 0
  and discount_snapshot is null;
```

### 5. Check refunded discounted orders not yet marked restored

```sql
select count(*) as pending_restore_flag_count
from public.shop_orders
where nullif(btrim(coalesce(discount_code, '')), '') is not null
  and coalesce(discount_amount, 0) > 0
  and coalesce(refund_status, 'none') in ('refunded', 'full_refund')
  and coalesce(discount_usage_restored, false) = false;
```

### 6. Check coupons whose stored used_count still disagrees with net order reality

```sql
select
  dc.code,
  dc.used_count,
  coalesce(count(so.id) filter (
    where nullif(btrim(coalesce(so.discount_code, '')), '') is not null
      and coalesce(so.discount_amount, 0) > 0
      and coalesce(so.refund_status, 'none') not in ('refunded', 'full_refund')
  ), 0)::int as expected_used_count
from public.discount_codes dc
left join public.shop_orders so
  on upper(btrim(coalesce(so.discount_code, ''))) = dc.code
group by dc.code, dc.used_count
having coalesce(dc.used_count, 0) <> coalesce(count(so.id) filter (
  where nullif(btrim(coalesce(so.discount_code, '')), '') is not null
    and coalesce(so.discount_amount, 0) > 0
    and coalesce(so.refund_status, 'none') not in ('refunded', 'full_refund')
), 0)::int
order by dc.code;
```

## App Verification Order

Run these after SQL is applied and the latest code is deployed:

1. Create a coupon with a future `starts_at` and confirm it shows as `待生效`.
2. Create a live coupon and confirm it shows as `生效中`.
3. Manually pause a coupon and confirm it shows as `手动停用`.
4. Trigger a risk auto-pause flow and confirm it shows as `风控停用`.
5. Set `manual_only` recovery and confirm recovery alerts do not auto-enable the coupon.
6. Set `auto_restore` recovery and confirm recovery alerts auto-enable the coupon.
7. Set `observation_then_restore` recovery and confirm recovery alerts auto-enable the coupon with an observation deadline.
8. Place a discounted order and confirm the row stores `discount_snapshot` and `discount_version`.
9. Refund a discounted order and confirm usage restoration bookkeeping is applied.
10. Re-check Admin Studio list, detail, and restore approval views for the new state copy.

## Code-Level Regression Command

```bash
node --test tests/admin-discounts-mutate-handler.test.js tests/admin-discounts-list-handler.test.js tests/admin-discounts-detail-handler.test.js tests/shop-order-risk-alerts.test.js tests/frontend-supabase-runtime-config.test.js
```
