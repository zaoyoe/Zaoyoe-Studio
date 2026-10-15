# Grok Migration Guard Diagnostic Fix (2026-10-13)

Task `tlef8gfx` selected the official X Subscription Plus monthly offer and then
failed with `GROK_MIGRATION_REQUIRED` before card entry. The screenshot showed a
normal Plus monthly checkout and did not show a migration notice. The saved
application log did not include which Commerce response field caused the
guard, so the exact account/cart condition cannot be reconstructed from this
attempt. The failure happened after the official account login and plan
selection; there is no evidence that proxy connectivity caused it.

The previous guard grouped team IDs, migration/crossgrade requests, family
conflicts, crossgrade flavors, and any `effectiveAt` timestamp under one
message. The official regular `getCartForSession` adapter sends session token,
selection, billing platform, castle token, and marketing context. Its common
cart decoder validates and retains the cart ID, totals, expiry, platform
payload, and charge schedule; it does not classify a standalone `effectiveAt`
as migration. The change-SKU path separately sends explicit crossgrade data and
requires a known `SCHEDULED` or `IMMEDIATE` flavor.

Changes:

- Team membership, explicit `migratedFrom` / `crossgrade`, `planFamilyConflict`,
  and non-unspecified crossgrade flavors remain blocked as migration or
  subscription changes.
- A standalone `effectiveAt` remains fail-closed, but now returns
  `GROK_EFFECTIVE_TIME_UNCONFIRMED` instead of claiming that migration was
  detected. Its exact semantics in ordinary carts remain unverified.
- The first contract check for each cart logs only which allowlisted fields are
  present and the safe flavor label. It never logs timestamp values, session
  tokens, or team/subscription identifiers.
- Added JSON/protobuf contract regressions and native-flow coverage proving no
  card or payment submission occurs while effective-time semantics are
  unknown.

This change diagnoses and corrects the error classification; it does not
confirm whether `tlef8gfx` contained a genuine migration marker, nor does it
approve bypassing the effective-time payment gate.

Validation:

- Focused Commerce, native-flow, Grok flow/auth, payment retry safety and task
  safety regressions passed: 6 files, 185 tests.
- `node --check grok-commerce.js` and `git diff --check` passed.
- The local service was restarted only after confirming zero active foreground
  jobs and no server child processes. PID 93294 was replaced by PID 98217;
  `/api/public/runtime`, `/`, `/admin`, and `/grok-plan-catalog.js` returned HTTP
  200. No live purchase or account migration was performed.
