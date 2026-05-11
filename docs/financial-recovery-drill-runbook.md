# Financial Recovery Drill Runbook

Use this monthly for payment, points, and shop inventory recovery readiness. The goal is to verify that an operator can find inconsistencies quickly without touching production write paths.

## Before The Drill

1. Confirm the latest migrations have been applied:
   - `20260510_add_financial_recovery_audit_views.sql`
   - `20260511_allow_service_role_financial_recovery_audit_views.sql`
   - latest payment, points, and shop purchase migrations
2. Run the readiness gate:
   - `npm run readiness:payment-recovery`
3. Save a Supabase backup restore point or confirm PITR/backups are available before any manual correction.

## Audit Queries

Run these in Supabase SQL Editor as an admin user:

```sql
SELECT * FROM public.admin_financial_recovery_audit_summary_view;

SELECT *
FROM public.admin_payment_order_recovery_audit_view
WHERE recovery_status <> 'healthy'
ORDER BY updated_at DESC
LIMIT 50;

SELECT *
FROM public.admin_points_balance_recovery_audit_view
WHERE recovery_status <> 'healthy'
ORDER BY COALESCE(balance_updated_at, last_ledger_at) DESC
LIMIT 50;

SELECT *
FROM public.admin_shop_inventory_recovery_audit_view
WHERE recovery_status <> 'healthy'
ORDER BY created_at DESC
LIMIT 50;
```

## Drill Checklist

1. Payment recovery:
   - Find any paid order without a redemption code.
   - Find any redeemed code without a matching points ledger credit.
   - Confirm amount mismatch rows are either reviewed or intentionally pending.
2. Points recovery:
   - Compare `points_balance` totals with `points_ledger` sums.
   - Investigate negative balances and balances without ledger history.
3. Shop recovery:
   - Confirm paid shop orders have matching ledger debits.
   - Confirm KEY orders have the expected number of sold inventory items.
   - Confirm sold inventory buyer IDs match the order user.
4. Record outcome:
   - Date, operator, affected rows, root cause, action taken.
   - If no issues, record `0 review_required_rows` from the summary view.

## Correction Rule

Do not update generated columns such as `points_balance.total_balance`. Correct only source columns or rerun the appropriate RPC after identifying the root cause.

Use manual SQL only after exporting affected rows and confirming a rollback path.
