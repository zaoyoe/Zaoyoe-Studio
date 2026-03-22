# Supabase Payment Hardening Rollout

This runbook is for applying and validating the March 22, 2026 payment / redemption / points hardening changes in a target Supabase project.

## Scope

The current hardening set covers:

- verify / payment order review entrypoints
- points mutation RPC hardening
- site-aware balance and redemption RPCs
- retirement of legacy redemption overloads

Key files:

- [/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260322_harden_shop_purchase_identity.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260322_harden_shop_purchase_identity.sql)
- [/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260322_harden_points_mutation_rpcs.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260322_harden_points_mutation_rpcs.sql)
- [/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260322_harden_payment_redemption_entrypoints.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260322_harden_payment_redemption_entrypoints.sql)
- [/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260322_retire_legacy_redemption_overloads.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260322_retire_legacy_redemption_overloads.sql)
- [/Volumes/chao/AI/xianyu_profit_calculator/supabase/verify_payment_redemption_hardening.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/verify_payment_redemption_hardening.sql)

Deprecated scripts that must not be executed anymore:

- [/Volumes/chao/AI/xianyu_profit_calculator/commercial_points_functions.sql](/Volumes/chao/AI/xianyu_profit_calculator/commercial_points_functions.sql)
- [/Volumes/chao/AI/xianyu_profit_calculator/redemption_functions.sql](/Volumes/chao/AI/xianyu_profit_calculator/redemption_functions.sql)
- [/Volumes/chao/AI/xianyu_profit_calculator/6.5_affiliate_dashboard_upgrade.sql](/Volumes/chao/AI/xianyu_profit_calculator/6.5_affiliate_dashboard_upgrade.sql)

## Before You Start

1. Confirm you are targeting the correct Supabase project.
2. Take a database backup or create a branch/snapshot.
3. Make sure the app rollout that depends on these SQL changes is ready to deploy.
4. Do not run deprecated root SQL scripts from the repository root.

## Apply Order

If the target database already includes the earlier March 22 migrations, apply only:

1. [/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260322_retire_legacy_redemption_overloads.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260322_retire_legacy_redemption_overloads.sql)

If the target database is behind the current hardened baseline, apply in this order:

1. [/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260322_harden_shop_purchase_identity.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260322_harden_shop_purchase_identity.sql)
2. [/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260322_harden_points_mutation_rpcs.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260322_harden_points_mutation_rpcs.sql)
3. [/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260322_harden_payment_redemption_entrypoints.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260322_harden_payment_redemption_entrypoints.sql)
4. [/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260322_retire_legacy_redemption_overloads.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260322_retire_legacy_redemption_overloads.sql)

## Database Verification

Run:

1. [/Volumes/chao/AI/xianyu_profit_calculator/supabase/verify_payment_redemption_hardening.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/verify_payment_redemption_hardening.sql)

Expected function results:

- `public.fn_redeem_code(character varying)` should be `FAIL` if it exists. The correct target state is `exists_now = false`.
- `public.fn_redeem_code(character varying, character varying)` should be present and callable by `authenticated`, not `anon`.
- `public.fn_get_user_balance(uuid)` and `public.fn_get_user_balance(character varying)` should be absent.
- `public.fn_get_user_balance(uuid, character varying)` should be present.
- `public.fn_add_points(...)` should stay `service_role` only.
- `public.fn_deduct_points_admin_site(...)` should stay `service_role` only.
- `public.fn_recharge_points(...)` should stay `service_role` only.

Expected data checks:

- No `payment_orders` should have `redemption_code` before status reaches `paid` or `redeemed`.
- No unresolved / unverified payment orders should already own usable redemption codes.
- `points_ledger` rows with `reference_id like 'redeem_%'` should not be missing `site`.

## App Smoke Tests

After the SQL rollout, verify these flows in the deployed app:

1. Logged-in user redeems a code in the wallet UI and receives points on the correct `site`.
2. Non-authenticated user cannot redeem a code.
3. Admin payment review still works for `pending_review` orders.
4. A normal payment recharge still credits points and writes the expected ledger rows.
5. Verify polling still deducts points only once per `jobId`.

## If Verification Fails

- Stop before running deprecated root SQL scripts to “patch” the issue.
- Re-check whether the target database is missing one of the earlier March 22 migrations.
- Compare the live function signature and grants against:
  - [/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260322_harden_points_mutation_rpcs.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260322_harden_points_mutation_rpcs.sql)
  - [/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260322_harden_payment_redemption_entrypoints.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260322_harden_payment_redemption_entrypoints.sql)
  - [/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260322_retire_legacy_redemption_overloads.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260322_retire_legacy_redemption_overloads.sql)
- If necessary, restore from backup or re-run the correct migration chain in order.
