# TG operations release — 2026-10-17

This is an append-only release record for the complete TG changes collected in
`codex/guest-shop-tg-operations-release`. The candidate SHA, PR number, final main
SHA and production evidence are recorded in the associated PR release manifest;
this source document does not claim a deployment before it has happened.

## Source, backup and scope

- Canonical remote: `origin` / `https://github.com/zaoyoe/Zaoyoe-Studio.git`.
- Reviewed main base: `6e322240721059eac6909d923cf61148077ef5c0`.
- Pre-release backup: `refs/codex/backups/tg-release-20261017T153728Z` /
  `e54b27d74c311698feed9bfe265e9ecd991954ea`.
- Evidence directory: `/Users/wangyongchao/.codex/backups/tg-release-20261017T153728Z`.
- All 135 original changed paths were read back from the backup; none is missing.
  Only `vercel.json` changed afterward to fix the function includeFiles length.
  `.gitignore` additionally excludes the local node_modules symlink. Dependencies
  are installed from package-lock.json, not published as a local symlink.
- Existing main is preserved as the candidate's ancestor. Open PR #665 is an
  older rollback deleting cart checkout routes and migrations; it is not part of
  this release. Open PR #663 is also outside this release. Neither is merged,
  closed or used as a source snapshot.

| Approved capability | Runtime surfaces and preservation check |
| --- | --- |
| TG purchasing | tg.html, js/tg.js, css/tg.css; Premium/Stars, two payment methods, mobile two-column choices, hover/press, smooth transitions, fee rows and initial skeletons |
| USDT | All four network icons, immutable network/FX quotes, precise saved amounts, list/detail consistency and honest historical missing-amount display |
| User orders | Email/password and original credential lookup, clear-query persistence, shared order cards and detail modals, completion state and administrator completion note |
| Admin shell | Compact sidebar, centered content, custom selects, aligned filters, data center, refined refresh, modal skeletons and consistent actions |
| Review and completion | Payment recheck, close eligibility, same-operation idempotent retries, purchase and redemption completion, user-facing notes and audit records |
| Upstream recovery | Original-order inspection/linking, explicit nonacceptance evidence, conflict checks and frozen unknown submissions |
| Codes and batches | Preview, click-to-copy without revealing full code, transient bottom capsule, outside-click modal close, revocation spacing and usage-rate column |
| Shared shop styling | shop.html explicitly loads css/cash-payment-dialog.css; extracted guest payment styles remain available in both pages |
| Operational tooling | Readiness, local callback relay, deterministic runtime recovery builder, worker safeguards and documentation/SQL/test contracts |

## Artifact integrity

The temporary candidate-tree build completed with 820 static files. All 67 local
resource references in tg.html, tg-admin.html and shop.html exist in the output;
all 20 changed public surfaces reach that output. API, server/tg, shared js,
scripts, documentation and migration files are included by the Verify archive
and corresponding Docker COPY inputs. Systemd artifacts are installed on the
host after Verify is on matching main; they are intentionally not copied into
the compact container. Tests are repository/CI evidence, not static assets.

Vercel includeFiles was 268 characters after adding the shared pricing module.
The AVIF WASM glob now keeps the decoder and required runtime inputs within the
256-character schema limit (admin 254, public 235). The decoder file exists.
No failing assertion was removed or weakened. The production build guard still
requires VERCEL_GIT_COMMIT_REF=main. The build sample used a disposable snapshot
and base-derived asset versions; it is build validation, not production proof.
Production resources must be checked against the resulting merged main SHA.

## Validation before PR

| Check | Result |
| --- | --- |
| Initial complete security suite | 4,812 PASS / 1 FAIL / 0 cancelled / 0 skipped / 0 todo, 519 test files; packaging length failure preserved in full-security-tests.tap |
| Complete suite after packaging fix | 4,813 PASS / 0 FAIL / 0 cancelled / 0 skipped / 0 todo, 519 test files; full-security-tests-recheck.tap |
| Both historical promo archive files, separate record | 32 PASS / 0 FAIL / 0 cancelled / 0 skipped / 0 todo; includes the separately required historical archive contracts; guest-promo-archive-18.log |
| git diff --check | PASS |
| CI production-env script with CI placeholder values | PASS; no production secrets loaded |
| Guarded payment rollout planner | PASS, dry plan only, no database command executed |
| Static build and artifact manifest | PASS; static-build.log and artifact-manifest-check.json |
| TG offline source readiness | invalid 0; 64 ok, 18 pending, ready=false |
| Guest-shop offline source readiness | invalid 0, ready=false; warnings/manual evidence retain their actual status |
| Changed-source sensitive-pattern scan | No private keys, GitHub tokens or JWT credentials found |

Full-suite testing includes TG, guest-shop, admin guest orders, readiness,
feature-specific SQL/verify contracts and historical documentation contracts.
The local Node version was 25.9.0; the PR suite must also pass its configured Node
20 jobs for this exact candidate. Offline readiness does not certify live
payments, concurrency or new feature enablement.

## Production database compatibility, read-only evidence

Read-only Supabase REST metadata and zero-row GET probes from the existing
Verify container confirmed all 51 RPCs referenced by the TG code, the current
purchase/redemption completion columns, query buyers, recovery events, FX and
network quote schema. Eight readiness RPC GETs returned true. The query-access
and native-USDT contracts returned version 1. Business, operations, inventory
and the data-center listing RPCs returned HTTP 200. FX current/quote and network
quote read-only RPCs also returned HTTP 200.

Direct table reads for immutable FX/network quote tables correctly returned
42501/403: the migrations explicitly revoke direct table access even from
service_role and grant access via controlled RPCs. This is the expected ACL.
The first diagnostic draft queried invented column names (contact_hash and
fee_snapshot on purchases, resolution_* and later completion operation columns
on redemption orders). Those drafts are preserved; the final probe uses the
actual source schema, reports no missing columns and is authoritative. These
probe corrections did not alter any code, schema, ACL or business order.

This proves deployed schema compatibility, not which individual historical
script was originally executed. The operator's earlier runtime recovery /
reconciliation outputs remain recorded in tg-preview-reconciliation-20261017.md.
Codex did not execute SQL or reapply migrations. Exact standalone migration
execution records not supplied by the operator remain unverified. The following
files are shipped together with the implementation. Earlier overlapping function
definitions must not be replayed over the reconciled/current completion logic.
Verify SQL files were not executed by Codex; corresponding source contracts and
read-only application capability checks passed.

| Shipped SQL file | Database application / verification status |
| --- | --- |
| `supabase/migrations/20261015_tg_purchase_z_fees.sql` | Compatible capability present by read-only probes; exact standalone execution history not independently established; not reapplied |
| `supabase/migrations/20261015_verify_tg_z_purchase_fees.sql` | NOT RUN as SQL in this release; source contract and corresponding read-only capability checks PASS |
| `supabase/migrations/20261016_payment_usdt_market_fx.sql` | Compatible capability present by read-only probes; exact standalone execution history not independently established; not reapplied |
| `supabase/migrations/20261016_payment_usdt_network_selection.sql` | Compatible capability present by read-only probes; exact standalone execution history not independently established; not reapplied |
| `supabase/migrations/20261016_tg_order_email_query.sql` | Compatible capability present by read-only probes; exact standalone execution history not independently established; not reapplied |
| `supabase/migrations/20261016_tg_purchase_cancellation_expiry.sql` | Compatible capability present by read-only probes; exact standalone execution history not independently established; not reapplied |
| `supabase/migrations/20261016_tg_purchase_fulfillment_review.sql` | Compatible capability present by read-only probes; exact standalone execution history not independently established; not reapplied |
| `supabase/migrations/20261016_tg_purchase_usdt_native_pricing.sql` | Compatible capability present by read-only probes; exact standalone execution history not independently established; not reapplied |
| `supabase/migrations/20261016_tg_purchase_zpay_reconciliation.sql` | Compatible capability present by read-only probes; exact standalone execution history not independently established; not reapplied |
| `supabase/migrations/20261016_verify_tg_order_email_query.sql` | NOT RUN as SQL in this release; source contract and corresponding read-only capability checks PASS |
| `supabase/migrations/20261016_verify_tg_purchase_cancellation_expiry.sql` | NOT RUN as SQL in this release; source contract and corresponding read-only capability checks PASS |
| `supabase/migrations/20261016_verify_tg_purchase_fulfillment_review.sql` | NOT RUN as SQL in this release; source contract and corresponding read-only capability checks PASS |
| `supabase/migrations/20261016_verify_tg_purchase_usdt_native_pricing.sql` | NOT RUN as SQL in this release; source contract and corresponding read-only capability checks PASS |
| `supabase/migrations/20261017_tg_data_center.sql` | Compatible capability present by read-only probes; exact standalone execution history not independently established; not reapplied |
| `supabase/migrations/20261017_tg_operations_closure.sql` | Compatible capability present by read-only probes; exact standalone execution history not independently established; not reapplied |
| `supabase/migrations/20261017_tg_purchase_manual_completion.sql` | Compatible capability present by read-only probes; exact standalone execution history not independently established; not reapplied |
| `supabase/migrations/20261017_tg_purchase_payment_review_completion.sql` | Compatible capability present by read-only probes; exact standalone execution history not independently established; not reapplied |
| `supabase/migrations/20261017_tg_purchase_review_resolution.sql` | Compatible capability present by read-only probes; exact standalone execution history not independently established; not reapplied |
| `supabase/migrations/20261017_tg_purchase_upstream_recovery.sql` | Compatible capability present by read-only probes; exact standalone execution history not independently established; not reapplied |
| `supabase/migrations/20261017_tg_redemption_resolution.sql` | Compatible capability present by read-only probes; exact standalone execution history not independently established; not reapplied |
| `supabase/migrations/20261017_tg_redemption_resolution_confirmation.sql` | Compatible capability present by read-only probes; exact standalone execution history not independently established; not reapplied |
| `supabase/migrations/20261017_tg_runtime_reconciliation.sql` | Earlier operator-reported success; current combined runtime readiness true |
| `supabase/migrations/20261017_tg_runtime_recovery.sql` | Earlier operator-reported success; current combined runtime readiness true |
| `supabase/migrations/20261017_verify_tg_data_center.sql` | NOT RUN as SQL in this release; source contract and corresponding read-only capability checks PASS |
| `supabase/migrations/20261017_verify_tg_operations_closure.sql` | NOT RUN as SQL in this release; source contract and corresponding read-only capability checks PASS |
| `supabase/migrations/20261017_verify_tg_purchase_manual_completion.sql` | NOT RUN as SQL in this release; source contract and corresponding read-only capability checks PASS |
| `supabase/migrations/20261017_verify_tg_purchase_payment_review_completion.sql` | NOT RUN as SQL in this release; source contract and corresponding read-only capability checks PASS |
| `supabase/migrations/20261017_verify_tg_purchase_upstream_recovery.sql` | NOT RUN as SQL in this release; source contract and corresponding read-only capability checks PASS |
| `supabase/migrations/20261017_verify_tg_redemption_resolution.sql` | NOT RUN as SQL in this release; source contract and corresponding read-only capability checks PASS |
| `supabase/migrations/20261017_verify_tg_redemption_resolution_confirmation.sql` | NOT RUN as SQL in this release; source contract and corresponding read-only capability checks PASS |
| `supabase/migrations/20261017_verify_tg_runtime_reconciliation.sql` | NOT RUN as SQL in this release; source contract and corresponding read-only capability checks PASS |

## Merge and production acceptance

The PR must contain the exact candidate SHA, BASE..HEAD commits and full changed
file manifest. Before merge, refetch origin/main, check ancestry and verify the
PR head has not changed. After merge, archive each deployment identity/run ID,
main SHA, runtime release markers, health results, resource hashes and worker
status in the PR. Final verification refetches main again.

The pre-release Verify and NewAPI markers and TG scheduler expected-release all
were 6e322240721059eac6909d923cf61148077ef5c0. Required containers were healthy;
no sub2api-legacy container was running. Both TG and guest-shop timers were
active/enabled, and TG purchasing/redemption/fulfillment were already enabled.
Maintenance restores those existing timer states after matching-release
installation, health and configuration checks. No new business switch is enabled,
no production secret is changed, and no real order is created or manually altered
for acceptance. Existing automatic workers continue their authorized operation.

Real payment/refund/fulfillment scenarios, double-administrator concurrency,
unknown-upstream resolution and other missing business acceptance evidence remain
NOT RUN. A deployment PASS is not a claim that those scenarios have been tested,
and is not authorization to enable a currently disabled guest product or SKU.

## Final candidate additions after the first validation

The production baseline guest readiness check reported one hard-invalid hosted
page identity finding. Direct inspection established that both the live page and
the preserved main source use `<body class="guest-orders-page guestbook-page">`.
All required form markers and the baseline main asset version were present. The
checker incorrectly required an exact single-class body string. This was a
checker false negative, not evidence of an old deployed page.

`scripts/guest-shop-readiness.js` now verifies the actual body class token while
retaining required form markers, canonical origin, matching asset commit and
client security contracts. Two new regression tests accept the shipped page and
reordered layout classes, and reject missing, lookalike and data-only classes.
No existing assertions or historical archive checks were removed. The original
baseline failure and red regression result are retained in the evidence backup.
The focused readiness suite passed 43/43. The final complete suite passed
**4,815/4,815 tests across 519 files**, with zero failures, cancellations, skipped
or todo tests (`full-security-tests-final.tap`). The prior 4,813-test result above
remains evidence for the earlier candidate snapshot.

These two files are additional changes after the original backup comparison;
all originally authorized capability files remain included. The final release
contains 138 changed files and must be committed, clean and identified by SHA
before PR creation. The live guest readiness check will be rerun after both
Vercel and Verify deploy the matching main commit; the pre-release invalid result
is not relabeled as a production PASS.
