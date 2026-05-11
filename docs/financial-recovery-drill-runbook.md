# Financial Recovery Drill Runbook

Use this monthly for payment, points, and shop inventory recovery readiness. The goal is to verify that an operator can find inconsistencies quickly without touching production write paths.

## Before The Drill

1. Confirm the latest migrations have been applied:
   - `20260510_add_financial_recovery_audit_views.sql`
   - `20260511_allow_service_role_financial_recovery_audit_views.sql`
   - latest payment, points, and shop purchase migrations
2. Run the drill readiness gate:
   - `npm run readiness:financial-recovery-drill`
3. Run the live payment/points/shop readiness gate:
   - `npm run readiness:payment-recovery`
4. Save a Supabase backup restore point or confirm PITR/backups are available before any manual correction.

## Pro / PITR Fallback Rule

PITR is useful, but it is not a runtime dependency. If Supabase Pro or the PITR add-on expires, the site should keep using the current payment, points, shop, and Realtime fallback paths. What you lose is only the convenience of point-in-time restore for operator recovery.

Keep the fallback path ready:

- The audit views and `npm run readiness:payment-recovery` remain the required baseline.
- Before any manual correction, export affected rows and confirm a current Supabase backup or manual snapshot.
- Use `npm run readiness:financial-recovery-drill` as a non-writing monthly check. Missing PITR is an advisory by default, not a production blocker.
- For a stricter pre-maintenance check, run `node scripts/financial-recovery-drill-readiness.js --fail-on-missing-backup --fail-on-stale`.

Optional environment markers for the drill report:

```dotenv
SUPABASE_PITR_ENABLED=false
FINANCIAL_RECOVERY_BACKUP_CONFIRMED=true
FINANCIAL_RECOVERY_BACKUP_CONFIRMED_AT=2026-05-11
FINANCIAL_RECOVERY_DRILL_LAST_AT=2026-05-11
```

## Scheduled Readiness Sweep

Production has a protected cron endpoint:

- Path: `/api/ops/recovery-readiness-sweep`
- Schedule: daily from `vercel.json`
- Secret: `RECOVERY_READINESS_CRON_SECRET` or `CRON_SECRET`

The sweep reuses the Admin Studio recovery readiness checks, then writes admin notifications and optional `ops_alert_jobs` only when a real gap appears. PITR missing, Supabase Pro missing, or external monitoring not configured remain advisory/fail-open states; they should not block frontend, payment, wallet, order, or Admin Studio runtime.

Manual smoke command after deployment:

```bash
curl -fsS \
  -H "Authorization: Bearer $CRON_SECRET" \
  https://www.zaoyoe.com/api/ops/recovery-readiness-sweep
```

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
