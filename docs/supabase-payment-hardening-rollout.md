# Supabase Payment Hardening Rollout

This runbook is for applying and validating the March 22, 2026 payment / redemption / points hardening changes in a target Supabase project.

## Scope

The current hardening set covers:

- payment checkout session / pending order creation hardening
- verify / payment order review entrypoints
- payment site value constraints
- points mutation RPC hardening
- site-aware balance and redemption RPCs
- retirement of legacy redemption overloads

Key files:

- [/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260322_harden_shop_purchase_identity.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260322_harden_shop_purchase_identity.sql)
- [/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260322_harden_points_mutation_rpcs.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260322_harden_points_mutation_rpcs.sql)
- [/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260322_harden_payment_creation_entrypoints.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260322_harden_payment_creation_entrypoints.sql)
- [/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260322_harden_payment_redemption_entrypoints.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260322_harden_payment_redemption_entrypoints.sql)
- [/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260322_constrain_payment_sites.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260322_constrain_payment_sites.sql)
- [/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260322_retire_legacy_redemption_overloads.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260322_retire_legacy_redemption_overloads.sql)
- [/Volumes/chao/AI/xianyu_profit_calculator/supabase/inspect_payment_site_values.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/inspect_payment_site_values.sql)
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
5. Before applying `20260322_constrain_payment_sites.sql`, scan the target project for historical `site` anomalies:
   - Cross-env drift audit: `npm run audit:env-drift -- --check-live --fail-on-drift`
     - By default this now auto-discovers `server/.env`, `server/.env.staging`, and `server/.env.production` when they exist locally.
     - The drift audit now fails fast if `SUPABASE_SERVICE_ROLE_KEY` looks like a `sb_publishable_*` or `sb_anon_*` key instead of a service-role key.
   - SQL editor: [/Volumes/chao/AI/xianyu_profit_calculator/supabase/inspect_payment_site_values.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/inspect_payment_site_values.sql)
   - CLI / service-role env: `npm run scan:payment-sites -- --env-file server/.env.production --fail-on-anomaly`
   - Combined preflight: `npm run preflight:payment-rollout -- --env-file server/.env.production`
     - If `APP_BASE_URL` or `PAYMENT_SMOKE_BASE_URL` is present, preflight now also probes `/api/runtime/supabase-config`, `/api/payments/config`, and `/api/payments/auth-check` so Vercel runtime drift and missing redeploys show up before rollout.
6. If the repository is only linked to the production project, do not treat that linked project as staging by default. Confirm the target project ref first.
7. Keep real `.env.local` / `server/.env.production` files out of Git. Use the committed `*.example` templates instead.
8. For deployed app smoke tests, prefer a staging or preview base URL. The smoke runner refuses production-like hosts unless you explicitly pass `--allow-production-like`.
9. Before touching a remote database, generate a guarded rollout plan and confirm the linked Supabase project ref matches the target:
   - Plan only: `npm run rollout:payment -- --env-file server/.env.production --set incremental`
   - CLI dry-run: `npm run rollout:payment -- --env-file server/.env.production --set incremental --execute`
   - Actual apply: `npm run rollout:payment -- --env-file server/.env.production --set incremental --apply --run-smoke --run-verify --smoke-config-only`

## Apply Order

If the target database already includes the earlier March 22 migrations, apply only:

1. [/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260322_harden_payment_creation_entrypoints.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260322_harden_payment_creation_entrypoints.sql)
2. [/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260322_constrain_payment_sites.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260322_constrain_payment_sites.sql)
3. [/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260322_retire_legacy_redemption_overloads.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260322_retire_legacy_redemption_overloads.sql)

If the target database is behind the current hardened baseline, apply in this order:

1. [/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260322_harden_shop_purchase_identity.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260322_harden_shop_purchase_identity.sql)
2. [/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260322_harden_points_mutation_rpcs.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260322_harden_points_mutation_rpcs.sql)
3. [/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260322_harden_payment_creation_entrypoints.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260322_harden_payment_creation_entrypoints.sql)
4. [/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260322_harden_payment_redemption_entrypoints.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260322_harden_payment_redemption_entrypoints.sql)
5. [/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260322_constrain_payment_sites.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260322_constrain_payment_sites.sql)
6. [/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260322_retire_legacy_redemption_overloads.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260322_retire_legacy_redemption_overloads.sql)

The guarded rollout helper enforces these same migration sets:

- `--set incremental`: only the three payment rollout migrations needed on an already-hardened March 22 baseline
- `--set full`: the full six-step hardening chain above

## Database Verification

Run:

1. [/Volumes/chao/AI/xianyu_profit_calculator/supabase/verify_payment_redemption_hardening.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/verify_payment_redemption_hardening.sql)
2. [/Volumes/chao/AI/xianyu_profit_calculator/supabase/inspect_payment_site_values.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/inspect_payment_site_values.sql)
3. JS verifier (service-role based): `npm run verify:payment-rollout -- --env-file server/.env.production --fail-on-finding`

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
- `payment_checkout_sessions.site` and `payment_orders.site` should only contain `cn` / `intl`.
- `20260322_constrain_payment_sites.sql` should not find legacy rows with blank / unsupported site values before the constraint is added.

## App Smoke Tests

After the SQL rollout, verify these flows in the deployed app:

1. Logged-in user redeems a code in the wallet UI and receives points on the correct `site`.
2. Non-authenticated user cannot redeem a code.
3. Admin payment review still works for `pending_review` orders.
4. A normal payment recharge still credits points and writes the expected ledger rows.
5. Verify polling still deducts points only once per `jobId`.

Recommended automated staging smoke test:

1. Fill the optional `PAYMENT_SMOKE_*` values in `server/.env.production` for the target deployment.
2. If the deployed `/api/runtime/supabase-config` endpoint is unhealthy or missing `SUPABASE_PUBLISHABLE_KEY`, put `SUPABASE_PUBLISHABLE_KEY` directly in the local env file used by the smoke runner so auth can still bootstrap locally.
3. If the target smoke user is OAuth-only or password login is disabled, the smoke runner can fall back to an admin-generated magic link as long as the env file also contains a valid `SUPABASE_SERVICE_ROLE_KEY`.
4. Run config-only validation first:
   - `npm run smoke:payment -- --env-file server/.env.production --config-only`
5. If the target deployment exposes mock payments for remote smoke usage, run the guarded end-to-end flow:
   - `npm run smoke:payment -- --env-file server/.env.production`
6. If you intentionally need to run against a production-like host, add `--allow-production-like` and confirm the mock-payment override window is still active before proceeding.
7. After smoke passes, run the post-rollout verifier:
   - `npm run verify:payment-rollout -- --env-file server/.env.production --fail-on-finding`
8. If you only need to audit the public deployment from a machine without private Vercel / Railway env files, use runtime-only mode:
   - `npm run check:prod-env -- --base-url https://www.zaoyoe.com --check-app-runtime --runtime-only`

The automated smoke runner validates:

- `/api/payments/config` is reachable
- remote mock-payment runtime is explicitly allowed
- a test user can authenticate with Supabase
- `/api/payments/create` completes a mock recharge and closes the checkout session

The post-rollout verifier validates:

- `payment_checkout_sessions.site` / `payment_orders.site` contain only `cn` / `intl`
- no unpaid / unresolved payment orders already own redemption codes
- no redemption codes are still linked to `PENDING_*` synthetic order ids
- `redeem_*` ledger rows do not miss `site`

## If Verification Fails

- Stop before running deprecated root SQL scripts to “patch” the issue.
- Re-check whether the target database is missing one of the earlier March 22 migrations.
- Compare the live function signature and grants against:
  - [/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260322_harden_points_mutation_rpcs.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260322_harden_points_mutation_rpcs.sql)
  - [/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260322_harden_payment_redemption_entrypoints.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260322_harden_payment_redemption_entrypoints.sql)
  - [/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260322_retire_legacy_redemption_overloads.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260322_retire_legacy_redemption_overloads.sql)
- If necessary, restore from backup or re-run the correct migration chain in order.
