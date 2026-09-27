# KVM4 Verify Server Deployment

KVM4 runs the persistent API and worker process behind `https://verify-api.zaoyoe.com`.
The public site still enters through `https://www.zaoyoe.com`, and Vercel rewrites
selected dynamic API paths to this service.

## What Gets Deployed

The deploy script builds a compact release from the latest clean `main`:

- `package.json`
- `package-lock.json`
- `api/`
- `server/`
- `js/`
- `scripts/`
- `docs/`
- `supabase/`

Secrets are not packaged. Runtime secrets stay on KVM4 in:

```text
/opt/zaoyoe-verify-server/.env
```

## Deploy

Run from local `main` after it has been fast-forwarded to `origin/main`:

```bash
npm run deploy:kvm4:verify
```

The script:

- refuses to deploy from non-`main`
- refuses to deploy if local `main` is not latest `origin/main`
- refuses to deploy with a dirty worktree
- creates a timestamped release under `/opt/zaoyoe-verify-server/releases`
- keeps the previous app path for rollback
- rebuilds `zaoyoe-verify-server`
- checks `http://127.0.0.1:3001/healthz`

Default SSH settings:

```bash
KVM4_HOST=76.13.188.218
KVM4_PORT=2222
KVM4_USER=root
KVM4_KEY=~/.ssh/hostinger_sub2api
KVM4_ROOT=/opt/zaoyoe-verify-server
```

Override any of these as environment variables when needed.

## Automatic Main Deploy

GitHub Actions deploys KVM4 automatically after a pull request is merged into
`main`. The workflow is:

```text
PR merge -> push to main -> Deploy KVM4 Verify Server workflow -> npm run deploy:kvm4:verify
```

Required repository secret:

```text
KVM4_SSH_PRIVATE_KEY
```

Optional repository variables can override the defaults:

```text
KVM4_HOST=76.13.188.218
KVM4_PORT=2222
KVM4_USER=root
KVM4_ROOT=/opt/zaoyoe-verify-server
KVM4_KEEP_RELEASES=8
```

The workflow checks out the latest `origin/main`, writes the SSH private key to
a temporary file on the runner, runs the same guarded deploy script used for
manual deploys, then verifies:

```text
https://verify-api.zaoyoe.com/healthz
https://www.zaoyoe.com/api/payments/config?site=cn
https://www.zaoyoe.com/api/shop/catalog?site=cn
```

Manual deploy remains available for emergency use after `main` is current.

## Rollback

Rollback to the previous release:

```bash
npm run rollback:kvm4:verify
```

Rollback to a specific release id:

```bash
npm run rollback:kvm4:verify -- 20260519090000-abcdef12
```

## Verify

After deploy or rollback:

```bash
curl -fsS https://verify-api.zaoyoe.com/healthz
curl -fsS 'https://www.zaoyoe.com/api/payments/config?site=cn'
curl -fsS 'https://www.zaoyoe.com/api/shop/catalog?site=cn'
```

On KVM4:

```bash
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
systemctl list-timers --all --no-pager | grep zaoyoe
```

## Health Watchdog

KVM4 can run a systemd watchdog that checks the persistent API and `sub2api`
every minute. If either service stops responding or enters Docker `unhealthy`,
the watchdog recreates the affected container through Docker Compose and logs
the result to journald.

Install or update it from local `main`:

```bash
npm run install:kvm4:watchdog
```

Useful checks:

```bash
systemctl status zaoyoe-kvm4-health-watchdog.timer --no-pager
systemctl status zaoyoe-kvm4-health-watchdog.service --no-pager
journalctl -u zaoyoe-kvm4-health-watchdog.service --no-pager -n 80
```

## Guest Shop Worker

Guest-shop API, webhooks, and the fulfillment worker run on KVM4 Verify Server,
not on Vercel. Historical examples in this file still mention `zaoyoe.com`;
current canonical guest-shop hostnames are:

- `https://verify-api.fatherkey.com`
- public `/api/shop/:path*` rewrite from Vercel production to that host

Deploying verify is **not** permission to open guest checkout, and it is **not**
an instruction to execute SQL.

### Hard rules

1. Install or start `zaoyoe-guest-shop-worker` only after
   `/opt/zaoyoe-verify-server/.current-release` equals the latest `main` commit
   that contains the guest-shop worker code.
2. The installer must use canonical root `/opt/zaoyoe-verify-server`. Do not pass
   `--root`, and do not set a different `KVM4_ROOT`.
3. Deploy scripts and the worker installer must not execute SQL, must not rerun
   20260913/20260914 migrations, and must not enable
   `allow_guest_purchase`.
4. Secrets stay in `/opt/zaoyoe-verify-server/.env` with mode `0600`. Do not put
   `GUEST_SHOP_WORKER_SECRET` in the unit file, shell history, or monitor labels.
   Never print secret values.
5. After adding or rotating `GUEST_SHOP_*` keys, recreate verify-server so
   Docker Compose reloads `env_file`. A plain `docker restart` or
   `docker compose restart` will not reread `.env`.
6. Never reuse `CRON_SECRET` or `SUPABASE_SERVICE_ROLE_KEY` for
   `GUEST_SHOP_CLAIM_PEPPER`, `GUEST_SHOP_CLAIM_DERIVATION_PEPPER`,
   `GUEST_SHOP_CONTACT_HASH_PEPPER`, `GUEST_SHOP_REQUEST_HASH_PEPPER`, or
   `GUEST_SHOP_WORKER_SECRET`.
7. Compact verify images may omit `deploy/kvm4/guest-shop-worker/*`. Those
   missing files are not a worker start failure; the host installer lands the
   systemd units, and that is the start source of truth.
8. Default install enables the timer but does not start it. Start only after
   readiness, secrets, port `127.0.0.1:3001`, and health checks.
9. Rollback of guest checkout is closing the product/SKU switch. Rolling back a
   verify release does not by itself refund or un-fulfill guest orders.
10. `GUEST_SHOP_BUYER_ACCESS_AUDIT_RETENTION_ENABLED` is independent from the
    buyer-credential switch. Buyer credentials require retention explicitly ON
    after its migration and read-only verify report **7/7 PASS**. During a
    credential rollback, leave retention ON until historical access-attempt rows
    have aged through the configured retention window and cleanup has caught up.

### Reload guest-shop secrets or switches

`verify-server` reads `/opt/zaoyoe-verify-server/.env` through compose
`env_file`. Writing a new key or changing a feature/retention switch in `.env`
is not enough.

```bash
# 1. backup .env (mode 0600). Append or rotate keys without printing values.
install -o root -g root -m 0600 /opt/zaoyoe-verify-server/.env \
  /opt/zaoyoe-verify-server/backups/env.guest-shop-pre-secrets.$(date -u +%Y%m%d%H%M%S).bak

# 2. pause watchdog so it does not fight the recreate
systemctl stop zaoyoe-kvm4-health-watchdog.timer zaoyoe-kvm4-health-watchdog.service

# 3. recreate only verify-server; do not rebuild, do not touch sibling workers
cd /opt/zaoyoe-verify-server
docker compose up -d --no-deps --force-recreate --no-build verify-server

# 4. health then restore watchdog
curl -fsS http://127.0.0.1:3001/healthz
systemctl start zaoyoe-kvm4-health-watchdog.timer
```

Do not use `docker restart zaoyoe-verify-server`. Confirm inside the new
container that the five guest-shop keys are set, strong, and distinct, without
printing their values. Guest payment adapters call
`resolvePaymentProviderSecrets` and prefer stored admin secrets; environment
variables are only a fallback. Missing `ZPAY_PKEY` / `NOWPAYMENTS_API_KEY` in
`.env` is expected when those live in stored secrets. Do not copy login-payment
keys into guest-shop env "just in case".

### Buyer credential retention lifecycle

The retention switch defaults OFF. Apply
`supabase/migrations/20260924_guest_shop_access_attempt_retention.sql` and run
the read-only `supabase/migrations/20260924_verify_guest_shop_access_attempt_retention.sql`
first; all **7** rows must be `PASS` before setting
`GUEST_SHOP_BUYER_ACCESS_AUDIT_RETENTION_ENABLED=true`. Codex deployment does
not execute either SQL file.

The supported matrix is:

| Buyer credentials | Retention | Result |
|---|---|---|
| OFF | OFF | Default; no retention RPC |
| ON | OFF | Invalid; readiness fails closed |
| ON | ON | Allowed only after migration + 7/7 verify |
| OFF | ON | Required rollback-drain mode; historical rows continue to expire |

Every `.env` transition in this matrix uses the watchdog pause and
`docker compose up -d --no-deps --force-recreate --no-build verify-server`
sequence above. Never use `docker restart` or `docker compose restart` as an
environment reload. On rollback, turn buyer credentials and the orders page
OFF but keep retention and the guest-shop timer ON. Review retention OFF only
after the configured retention period has elapsed and there is no cleanup
error or backlog evidence.

Retention runs every ten minutes and may drain at most 10 batches of 1000 rows
per sweep. A cleanup/config/RPC error returns HTTP 503 with stable code
`guest_access_audit_cleanup_failed`; a remaining backlog after 10 batches
returns HTTP 503 with `guest_access_audit_backlog_degraded`. The systemd
oneshot is failed for that tick even if fulfillment work completed safely.
Inspect both records without replaying orders:

```bash
systemctl status zaoyoe-guest-shop-worker.service --no-pager
journalctl -u zaoyoe-guest-shop-worker.service -n 80 --no-pager
docker logs --since 30m zaoyoe-verify-server 2>&1 \
  | grep -E 'guest_access_audit_(cleanup_failed|backlog_degraded)'
```

The systemd journal establishes the failed/HTTP 503 tick; the verify container
`maintenance degraded` record carries the stable code, completed batch/delete
counts, and `has_more`. Do not widen guest SKUs or disable retention while
either condition persists.

### KVM4 runtime readiness

The local checkout command below is a source-tree gate. Because a complete
checkout contains `guest-orders.html` and `js/guest-orders-client.js`, it checks
those local files and deliberately does not require the generated
`server/.release-commit` or fetch the live Vercel page.

When buyer credentials and the guest-orders page are both enabled, run the
production gate inside the actual KVM4 `verify-server` container. The compact
image intentionally omits `guest-orders.html`, while deployment writes the
exact release commit to `/app/server/.release-commit`; this makes readiness
fetch the Vercel page and its same-origin client and compare their 12-character
asset version with the KVM4 release commit.

```bash
cd /opt/zaoyoe-verify-server

host_release="$(tr -d '\r\n' < .current-release)"
container_release="$(docker compose exec -T verify-server \
  sh -c 'tr -d "\r\n" < /app/server/.release-commit')"
test -n "$host_release" && test "$host_release" = "$container_release"

docker compose exec -T verify-server \
  npm run readiness:guest-shop -- --fail-on-invalid
```

Before accepting the result, confirm the container uses a canonical HTTPS
`APP_BASE_URL`. The report must show the Vercel `guest-orders.html` as
`hosted_verified`, its same-origin `js/guest-orders-client.js` as
`hosted_verified`, and `frontend:guest-orders-commit` as `aligned`. A request
failure, cross-origin result, missing contract marker, missing release marker,
or asset-version drift is a hard failure. This container check supplements the
local source-tree gate; neither one applies SQL or grants permission to enable
a product/SKU.

### Install

From a local checkout that matches the live verify commit:

```bash
npm run readiness:guest-shop -- --env-file server/.env.production --fail-on-invalid
npm run install:kvm4:guest-shop-worker -- --host <KVM4_HOST> --port <SSH_PORT> --key <SSH_KEY>
# review unit, ConditionPathExists, .env mode, /healthz, then:
npm run install:kvm4:guest-shop-worker -- --start --host <KVM4_HOST> --port <SSH_PORT> --key <SSH_KEY>
```

`--fail-on-not-ready` returning `3` is the expected fail-closed result until
sandbox, database, worker, and manual evidence are archived. Do not bypass it
with `|| true`.

### Verify

```bash
systemctl status zaoyoe-guest-shop-worker.timer --no-pager
systemctl list-timers --all --no-pager | grep zaoyoe-guest-shop-worker
journalctl -u zaoyoe-guest-shop-worker.service -n 50 --no-pager
curl -fsS https://verify-api.fatherkey.com/healthz
```

If the timer returns 503 or timeouts, stop the timer first. Do not widen guest
SKUs, and do not batch-replay dead letters.

See also:

- `AGENTS.md` Guest Shop Deployment Rules
- `docs/guest-shop-payment-fulfillment-runbook.md`
- `docs/guest-purchase-task-2.0.md`（任务 2.1 内容版本；路径兼容旧引用）
