# Native scheduler migration runbook

This runbook migrates only legacy Sub2API accounts that are reachable through
the migration-managed type-59 bridge groups. It does not migrate user data,
tokens, pricing, or legal settings; those remain covered by the existing
`sub2api-migrate` path.

## 1. Read-only plan

Set `SOURCE_SQL_DSN` to the legacy database. Either set
`NATIVE_SCHEDULER_GROUP_IDS` to a comma-separated list of bridge group IDs, or
set `TARGET_SQL_DSN` so the command can discover `sub2api-bridge:<group-id>`
tags from the NewAPI database.

```bash
PLAN_ONLY=true SOURCE_SQL_DSN="$SOURCE_SQL_DSN" TARGET_SQL_DSN="$TARGET_SQL_DSN" \
  /sub2api-migrate > native-scheduler-plan.json
```

The plan contains no credential values. It reports unsupported platforms,
missing model lists, unsupported groups, and state that cannot be represented
by a NewAPI channel. Review every warning before proceeding. Existing error or
active cooldown state is preserved as a disabled channel status; expired
cooldowns are not treated as active. Userinfo is removed from the shareable
plan, while URLs containing query parameters or fragments are rejected because
NewAPI appends endpoint paths to the channel base URL and cannot preserve those
URL components safely.

## 2. Import after review

The importer reads credentials only in memory and writes them directly to the
target `channels.key` column inside one transaction. It accepts only legacy
`apikey`, `api_key`, and `upstream` accounts with an API key field. OAuth,
setup-token, cookie, and other account types remain unsupported until a
verified NewAPI adaptor exists.

By default, any skipped account aborts the import. Only set
`NATIVE_SCHEDULER_ALLOW_SKIPS=true` after reviewing the plan report.

```bash
NATIVE_SCHEDULER_IMPORT=true \
  SOURCE_SQL_DSN="$SOURCE_SQL_DSN" TARGET_SQL_DSN="$TARGET_SQL_DSN" \
  NATIVE_SCHEDULER_GROUP_IDS="$NATIVE_SCHEDULER_GROUP_IDS" \
  /sub2api-migrate
```

Each imported account is represented by one channel tagged
`sub2api-native:<account-id>`. Re-running the command updates that exact
managed channel and rebuilds its abilities. A type mismatch, duplicate tag,
missing credential, or write error aborts and rolls back the complete import.

## 3. Shadow comparison

Run this after import and before any traffic cutover. It never selects or logs
the target channel key.

```bash
SHADOW_COMPARE=true \
  SOURCE_SQL_DSN="$SOURCE_SQL_DSN" TARGET_SQL_DSN="$TARGET_SQL_DSN" \
  NATIVE_SCHEDULER_GROUP_IDS="$NATIVE_SCHEDULER_GROUP_IDS" \
  /sub2api-migrate
```

The command exits non-zero for missing, unexpected, unsupported, or mismatched
channels. Do not disable the type-59 bridge or remove `legacy-sub2api` until
the comparison is clean and real requests have validated model mapping,
failover, rate-limit recovery, and billing behavior.

`PLAN_ONLY`, `NATIVE_SCHEDULER_IMPORT`, and `SHADOW_COMPARE` are explicit,
mutually exclusive modes. The normal migration command remains unchanged when
none of these variables is enabled.

## 4. Group-option repair only

When a previously completed migration has an incomplete bridge-channel state,
run the narrow repair mode instead of re-running the complete migration. It
reads active standard groups from the legacy database and atomically appends
only missing `GroupRatio`, `UserUsableGroups`, and `AutoGroups` entries. Existing
administrator values are preserved.

```bash
GROUP_OPTIONS_REPAIR_ONLY=true \
  SOURCE_SQL_DSN="$SOURCE_SQL_DSN" TARGET_SQL_DSN="$TARGET_SQL_DSN" \
  /sub2api-migrate
```

The production cutover script sets `PRESERVE_PARTIAL_BRIDGE_STATE=true` only
when the target already has a completed NewAPI migration. This keeps an
explicitly verified partial bridge topology intact while native scheduler
channels are being validated; a first migration still requires complete bridge
coverage and refuses partial state.
