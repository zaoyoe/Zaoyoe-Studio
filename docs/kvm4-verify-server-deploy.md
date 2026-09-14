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
5. Default install enables the timer but does not start it. Start only after
   readiness, secrets, port `127.0.0.1:3001`, and health checks.
6. Rollback of guest checkout is closing the product/SKU switch. Rolling back a
   verify release does not by itself refund or un-fulfill guest orders.

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
- `docs/guest-purchase-task-2.0.md`
