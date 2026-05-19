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
